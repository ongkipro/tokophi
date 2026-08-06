import { NextResponse, type NextRequest } from "next/server";
import { db, schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
import { computeBilling, quote, withPpn } from "@tokophi/lib/billing";
import { alCreatePayment, autolarisConfigured } from "@tokophi/lib/autolaris";

import { payCallbackUrl } from "@tokophi/lib/pay-callback";
import { cronIntervalSec, recordCronRun } from "../record-run";
// Daily billing job (schedule via Coolify Scheduled Task / external cron → GET with the secret):
//   1) sync each store's stored `status` to its real-time EFFECTIVE state
//   2) for stores whose period ended (past_due/suspended) with no pending subscription invoice,
//      generate a monthly VA invoice so the merchant can renew.
// Suspension enforcement itself is already real-time (computeBilling in requireCapability), so this
// job is for stored-status accuracy + recurring invoice generation.
//
// ⚠️ THIS JOB MUST NOT OVERRULE AN OPERATOR. It used to write `computeBilling(s).status` from the
// billing columns alone, so a store super-admin had suspended was flipped back to `active`/`trial`
// on the next nightly run — the operator's decision expiring in silence, with nothing in the audit
// log to say it had been undone. `computeBilling` now folds `stores.suspended_at` into `status`, so
// the sync propagates the operator's decision instead of erasing it, and the invoice branch below
// reads `billingStatus` so the money half stays keyed on the subscription alone.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("x-cron-secret") ?? req.nextUrl.searchParams.get("secret");

  // FAIL CLOSED in production. This used to read `if (secret && provided !== secret)` — so with
  // CRON_SECRET unset there was NO check at all, on a route that is excluded from the auth
  // middleware and walks EVERY store to suspend it or raise an invoice against it. Anyone who
  // guessed the path could bill the whole platform.
  //
  // This is the same fail-open shape that was already found and closed on the AutoLaris pay
  // callback. It survived here because the guard reads as if it works: a missing secret quietly
  // means "no gate" instead of "no entry". If it can mutate money, an absent secret must mean NO.
  // Dev/local still runs without one so the job can be exercised offline.
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error("[cron/billing] CRON_SECRET unset in production — REJECTING.");
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  } else if (provided !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const stores = await db
    .select({
      id: schema.stores.id,
      accountId: schema.stores.accountId,
      slug: schema.stores.slug,
      status: schema.stores.status,
      trialEndsAt: schema.stores.trialEndsAt,
      currentPeriodEnd: schema.stores.currentPeriodEnd,
      firstInvoicePaid: schema.stores.firstInvoicePaid,
      comped: schema.stores.comped,
      // 0086 — without this the job re-derives the status from billing ALONE and writes it back,
      // which is how an operator's "Tangguhkan" was silently reverted within 24 hours.
      suspendedAt: schema.stores.suspendedAt,
    })
    .from(schema.stores);

  const callbackUrl = payCallbackUrl();
  let statusSynced = 0;
  let invoicesCreated = 0;

  for (const s of stores) {
    const b = computeBilling(s);

    if (s.status !== b.status) {
      await db.update(schema.stores).set({ status: b.status }).where(eq(schema.stores.id, s.id));
      statusSynced++;
    }

    // ⚠️ `billingStatus`, NOT `status`. `status` now carries the operator's suspension on top of the
    // subscription, and a store an operator locked mid-period is fully paid up — raising a renewal
    // invoice against it would bill it weeks early, for a lock that has nothing to do with money.
    // A suspended store that genuinely IS overdue still reads `past_due`/`suspended` here and still
    // gets its invoice: being locked does not cancel the debt, and paying is how it gets unlocked
    // when the reason was non-payment.
    if ((b.billingStatus === "past_due" || b.billingStatus === "suspended") && autolarisConfigured()) {
      const [pending] = await db
        .select({ id: schema.invoices.id })
        .from(schema.invoices)
        .where(and(eq(schema.invoices.storeId, s.id), eq(schema.invoices.kind, "subscription"), eq(schema.invoices.status, "menunggu")))
        .limit(1);
      if (!pending) {
        const q = quote("monthly", s.firstInvoicePaid);
        // base + 11% PPN — MUST match createSubscriptionPayment (the manual path), or automatic
        // renewals under-collect the VAT the Langganan page prints as "termasuk PPN 11%".
        const amount = withPpn(q.amount).total;
        const reffId = `SUB-${s.slug}-${Date.now().toString().slice(-8)}`;
        const r = await alCreatePayment({
          reffId,
          channelCode: "VABCA",
          amount,
          customerId: s.id,
          customerName: "Merchant",
          customerPhone: "081200000000",
          customerEmail: "billing@tokophi.id",
          callbackUrl,
        });
        if (r.ok) {
          await db.insert(schema.invoices).values({
            number: "SUB-" + Date.now().toString().slice(-9),
            accountId: s.accountId,
            storeId: s.id,
            planKey: "bisnis",
            amountIdr: amount,
            status: "menunggu",
            kind: "subscription",
            cycle: q.cycle,
            periodMonths: q.months,
            reffId,
            trxId: r.trxId,
            virtualAccount: r.virtualAccount,
          });
          invoicesCreated++;
        }
      }
    }
  }

  // Liveness row (0091) — see `../record-run.ts`. A DAILY job is the one whose silence is hardest to
  // notice: a fortnight of no renewal invoices looks exactly like a fortnight where nothing was due.
  const summary = { stores: stores.length, statusSynced, invoicesCreated };
  await recordCronRun("billing", { ok: true, startedAt, intervalSec: cronIntervalSec(req), result: summary });
  return NextResponse.json({ ok: true, ...summary });
}
