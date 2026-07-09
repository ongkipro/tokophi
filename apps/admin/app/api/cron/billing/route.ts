import { NextResponse, type NextRequest } from "next/server";
import { db, schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
import { computeBilling, quote } from "@tokophi/lib/billing";
import { alCreatePayment, autolarisConfigured } from "@tokophi/lib/autolaris";

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
  if (secret && provided !== secret) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const stores = await db
    .select({
      id: schema.stores.id,
      accountId: schema.stores.accountId,
      slug: schema.stores.slug,
      status: schema.stores.status,
      trialEndsAt: schema.stores.trialEndsAt,
      currentPeriodEnd: schema.stores.currentPeriodEnd,
      firstInvoicePaid: schema.stores.firstInvoicePaid,
    })
    .from(schema.stores);

  const callbackUrl = (process.env.PUBLIC_APP_URL ?? "http://localhost:3000") + "/api/public/pay/callback";
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
        const reffId = `SUB-${s.slug}-${Date.now().toString().slice(-8)}`;
        const r = await alCreatePayment({
          reffId,
          channelCode: "VABCA",
          amount: q.amount,
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
            amountIdr: q.amount,
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
