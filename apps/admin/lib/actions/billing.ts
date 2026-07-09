"use server";
import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { computeBilling } from "@tokophi/lib/billing";
import { alCreatePayment, autolarisConfigured, channelLabel } from "@tokophi/lib/autolaris";

// Create the current period's subscription invoice + an AutoLaris VA to pay it. On payment the
// callback (/api/public/pay/callback) marks the invoice paid and extends the subscription.
export async function paySubscription(channelCode = "VABCA"): Promise<{ ok: boolean; virtualAccount?: string; channel?: string; amount?: number; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sesi berakhir." };
  if (!autolarisConfigured()) return { ok: false, error: "Pembayaran belum dikonfigurasi oleh platform." };

  const [store] = await db
    .select({
      id: schema.stores.id,
      accountId: schema.stores.accountId,
      slug: schema.stores.slug,
      trialEndsAt: schema.stores.trialEndsAt,
      currentPeriodEnd: schema.stores.currentPeriodEnd,
      firstInvoicePaid: schema.stores.firstInvoicePaid,
    })
    .from(schema.stores)
    .where(eq(schema.stores.id, session.storeId))
    .limit(1);
  if (!store) return { ok: false, error: "Toko tidak ditemukan." };

  const amount = computeBilling(store).nextAmount;
  const reffId = `SUB-${store.slug}-${Date.now().toString().slice(-8)}`;
  const callbackUrl = (process.env.PUBLIC_APP_URL ?? "http://localhost:3000") + "/api/public/pay/callback";
  const r = await alCreatePayment({
    reffId,
    channelCode,
    amount,
    customerId: store.id,
    customerName: session.name || "Merchant",
    customerPhone: "081200000000",
    customerEmail: session.email,
    callbackUrl,
  });
  if (!r.ok) return { ok: false, error: r.error ?? "Gagal membuat tagihan." };

  await db.insert(schema.invoices).values({
    number: "SUB-" + Date.now().toString().slice(-9),
    accountId: store.accountId,
    storeId: store.id,
    planKey: "bisnis",
    amountIdr: amount,
    status: "menunggu",
    kind: "subscription",
    reffId,
    trxId: r.trxId,
    virtualAccount: r.virtualAccount,
  });
  revalidatePath("/pengaturan/langganan");
  return { ok: true, virtualAccount: r.virtualAccount, channel: channelLabel(channelCode), amount };
}

// Extend the subscription one month and mark it active (called on paid subscription invoice).
export async function activateSubscription(storeId: string): Promise<void> {
  const base = Date.now();
  await db
    .update(schema.stores)
    .set({ currentPeriodEnd: new Date(base + 30 * 86_400_000), firstInvoicePaid: true, status: "active" })
    .where(eq(schema.stores.id, storeId));
}
