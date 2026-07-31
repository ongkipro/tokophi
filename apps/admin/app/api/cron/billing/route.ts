import { NextResponse, type NextRequest } from "next/server";
import { db, schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
import { computeBilling, quote, withPpn } from "@tokophi/lib/billing";
import { alCreatePayment, autolarisConfigured } from "@tokophi/lib/autolaris";

import { payCallbackUrl } from "@tokophi/lib/pay-callback";
// Daily billing job (schedule via Coolify Scheduled Task / external cron → GET with the secret):
//   1) sync each store's stored `status` to its real-time lifecycle state
//   2) for stores whose period ended (past_due/suspended) with no pending subscription invoice,
//      generate a monthly VA invoice so the merchant can renew.
// Suspension enforcement itself is already real-time (computeBilling in requireCapability), so this
// job is for stored-status accuracy + recurring invoice generation.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
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

    if ((b.status === "past_due" || b.status === "suspended") && autolarisConfigured()) {
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

  return NextResponse.json({ ok: true, stores: stores.length, statusSynced, invoicesCreated });
}
