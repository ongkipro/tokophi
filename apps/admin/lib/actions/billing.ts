"use server";
import { db, schema } from "@tokophi/db";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { getSession } from "@/lib/auth";
import { quote, withPpn, type Cycle } from "@tokophi/lib/billing";
import { alCreatePayment, autolarisConfigured, channelLabel } from "@tokophi/lib/autolaris";

// Everything a payment UI needs to show a VA / QRIS for one (unpaid) invoice.
export type PaymentDetail = {
  number: string; cycle: string | null; amount: number;
  channel: string | null; channelLabel: string;
  virtualAccount: string | null; qrImage: string | null; paymentUrl: string | null;
};

type InvRow = { number: string; cycle: string | null; amountIdr: number; channel: string | null; virtualAccount: string | null; qr: string | null; paymentUrl: string | null };
async function toDetail(inv: InvRow): Promise<PaymentDetail> {
  let qrImage: string | null = null;
  if (inv.qr) { try { qrImage = await QRCode.toDataURL(inv.qr, { margin: 1, width: 220 }); } catch { qrImage = null; } }
  return {
    number: inv.number, cycle: inv.cycle, amount: inv.amountIdr,
    channel: inv.channel, channelLabel: inv.channel ? channelLabel(inv.channel) : "—",
    virtualAccount: inv.virtualAccount, qrImage, paymentUrl: inv.paymentUrl,
  };
}

const SELECT = {
  number: schema.invoices.number, cycle: schema.invoices.cycle, amountIdr: schema.invoices.amountIdr,
  channel: schema.invoices.channel, virtualAccount: schema.invoices.virtualAccount, qr: schema.invoices.qr, paymentUrl: schema.invoices.paymentUrl,
};

// The store's current UNPAID subscription invoice (if any) — so we resume it instead of duplicating.
export async function getPendingSubscription(): Promise<PaymentDetail | null> {
  const session = await getSession();
  if (!session) return null;
  const [inv] = await db
    .select(SELECT)
    .from(schema.invoices)
    .where(and(eq(schema.invoices.storeId, session.storeId), eq(schema.invoices.kind, "subscription"), eq(schema.invoices.status, "menunggu")))
    .orderBy(desc(schema.invoices.issuedAt))
    .limit(1);
  return inv ? toDetail(inv) : null;
}

// The stored payment detail for a specific unpaid invoice (resume from the invoice page).
export async function getInvoicePayment(number: string): Promise<PaymentDetail | null> {
  const session = await getSession();
  if (!session) return null;
  const [inv] = await db
    .select({ ...SELECT, storeId: schema.invoices.storeId, status: schema.invoices.status })
    .from(schema.invoices)
    .where(eq(schema.invoices.number, number))
    .limit(1);
  if (!inv || inv.storeId !== session.storeId || inv.status !== "menunggu") return null;
  return toDetail(inv);
}

// Start (or resume) a subscription payment. If an unpaid subscription invoice already exists we
// RETURN IT — never create a duplicate. Otherwise create one AutoLaris payment via the chosen channel.
export async function createSubscriptionPayment(cycle: Cycle, channelCode: string): Promise<{ ok: boolean; detail?: PaymentDetail; reused?: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sesi berakhir." };
  if (!autolarisConfigured()) return { ok: false, error: "Pembayaran belum dikonfigurasi oleh platform." };
  if (!channelCode) return { ok: false, error: "Pilih metode pembayaran dulu." };

  const existing = await getPendingSubscription();
  if (existing) return { ok: true, detail: existing, reused: true };

  const [store] = await db
    .select({ id: schema.stores.id, accountId: schema.stores.accountId, slug: schema.stores.slug, firstInvoicePaid: schema.stores.firstInvoicePaid })
    .from(schema.stores).where(eq(schema.stores.id, session.storeId)).limit(1);
  if (!store) return { ok: false, error: "Toko tidak ditemukan." };

  const q = quote(cycle, store.firstInvoicePaid);
  const amount = withPpn(q.amount).total; // base + 11% PPN
  const reffId = `SUB-${store.slug}-${Date.now().toString().slice(-8)}`;
  const callbackUrl = (process.env.PUBLIC_APP_URL ?? "http://localhost:3000") + "/api/public/pay/callback";
  const r = await alCreatePayment({
    reffId, channelCode, amount,
    customerId: store.id, customerName: session.name || "Merchant", customerPhone: "081200000000", customerEmail: session.email, callbackUrl,
  });
  if (!r.ok) return { ok: false, error: r.error ?? "Gagal membuat tagihan." };

  const number = "SUB-" + Date.now().toString().slice(-9);
  await db.insert(schema.invoices).values({
    number, accountId: store.accountId, storeId: store.id, planKey: "bisnis", amountIdr: amount, status: "menunggu",
    kind: "subscription", cycle: q.cycle, periodMonths: q.months, reffId, trxId: r.trxId,
    channel: channelCode, virtualAccount: r.virtualAccount ?? null, qr: r.qr ?? null, paymentUrl: r.url ?? null,
  });
  revalidatePath("/akun/langganan");
  const detail = await toDetail({ number, cycle: q.cycle, amountIdr: amount, channel: channelCode, virtualAccount: r.virtualAccount ?? null, qr: r.qr ?? null, paymentUrl: r.url ?? null });
  return { ok: true, detail };
}

// Cancel an unpaid subscription invoice (so the merchant can start a different cycle).
export async function cancelSubscriptionInvoice(number: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sesi berakhir." };
  const [inv] = await db
    .select({ storeId: schema.invoices.storeId, kind: schema.invoices.kind, status: schema.invoices.status })
    .from(schema.invoices).where(eq(schema.invoices.number, number)).limit(1);
  if (!inv || inv.storeId !== session.storeId || inv.kind !== "subscription" || inv.status !== "menunggu") return { ok: false, error: "Tagihan tidak bisa dibatalkan." };
  await db.update(schema.invoices).set({ status: "gagal" }).where(eq(schema.invoices.number, number));
  revalidatePath("/akun/langganan");
  return { ok: true };
}
