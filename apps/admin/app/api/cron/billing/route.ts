import { NextResponse, type NextRequest } from "next/server";
import { db, schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
import { computeBilling, quote, withPpn } from "@tokophi/lib/billing";
import { alCreatePayment, autolarisConfigured } from "@tokophi/lib/autolaris";

import { payCallbackUrl } from "@tokophi/lib/pay-callback";
import { cronIntervalSec, recordCronRun } from "../record-run";
import { cronAuthorized } from "@/lib/cron-auth";
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
  // FAIL CLOSED in production, and HEADER ONLY. This used to read
  // `if (secret && provided !== secret)` — so with CRON_SECRET unset there was NO check at all, on a
  // route that is excluded from the auth middleware and walks EVERY store to suspend it or raise an
  // invoice against it. Anyone who guessed the path could bill the whole platform. It then accepted
  // the secret from `?secret=`, which is how every sidecar sent it. Both rules now live in ONE place —
  // `lib/cron-auth.ts` — because this check was copy-pasted into six route files.
  if (!cronAuthorized(req, "cron/billing")) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
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

    let statusSynced = 0;
    let invoicesCreated = 0;
    for (const s of stores) {
      const b = computeBilling(s);
      if (b.status !== s.status) {
        await db.update(schema.stores).set({ status: b.status }).where(eq(schema.stores.id, s.id));
        statusSynced++;
      }

      if ((b.billingStatus === "past_due" || b.billingStatus === "suspended") && autolarisConfigured()) {
        const [pending] = await db
          .select({ id: schema.invoices.id })
          .from(schema.invoices)
          .where(
            and(
              eq(schema.invoices.storeId, s.id),
              eq(schema.invoices.kind, "subscription"),
              eq(schema.invoices.status, "menunggu"),
            ),
          )
          .limit(1);

        if (!pending) {
          const q = quote("monthly", s.firstInvoicePaid);
          const totalWithPpn = withPpn(q.amount).total;
          const reffId = `SUB-${s.slug.slice(0, 8)}-${Date.now()}`;
          const number = "SUB-" + Date.now().toString().slice(-9);
          const callbackUrl = payCallbackUrl(reffId);
          const r = await alCreatePayment({
            reffId,
            channelCode: "BCA",
            amount: totalWithPpn,
            customerId: s.id,
            customerName: s.slug,
            customerPhone: "081200000000",
            customerEmail: "merchant@tokophi.id",
            callbackUrl,
          });
          if (r.ok) {
            await db.insert(schema.invoices).values({
              number,
              accountId: s.accountId,
              storeId: s.id,
              kind: "subscription",
              planKey: "bisnis",
              amountIdr: totalWithPpn,
              cycle: q.cycle,
              periodMonths: q.months,
              reffId,
              trxId: r.trxId,
              channel: "BCA",
              virtualAccount: r.virtualAccount ?? null,
              qr: r.qr ?? null,
              paymentUrl: r.url ?? null,
              status: "menunggu",
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
  } catch (error) {
    console.error("[cron/billing] sweep failed", error);
    await recordCronRun("billing", {
      ok: false,
      startedAt,
      intervalSec: cronIntervalSec(req),
      result: { error: error instanceof Error ? error.message : "sweep failed" },
    });
    return NextResponse.json({ ok: false, error: "sweep failed" }, { status: 500 });
  }
}
