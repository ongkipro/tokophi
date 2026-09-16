"use server";
import { db, schema } from "@tokophi/db";
import { createSubscriptionInvoice } from "@tokophi/db/subscription-invoice";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { getSession } from "@/lib/auth";
import { requireCapability } from "@/lib/rbac";
import { type Cycle } from "@tokophi/lib/billing";
import { autolarisConfigured, channelLabel } from "@tokophi/lib/autolaris";
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
  // These two actions RAISE and VOID the store's own subscription invoices — they are money, and
  // they were gated on nothing but "is someone logged in". A `gudang` (warehouse) user could bill
  // the shop or cancel its subscription invoice. Every other mutating action in this app goes
  // through requireCapability; these two were simply missed, and being missed is invisible.
  //
  // `allowSuspended` because a SUSPENDED store must still be able to pay its way back in — refusing
  // the payment that would un-suspend it is a trap that locks a paying merchant out permanently.
  const session = await requireCapability("settings:write", { allowSuspended: true });
  if (!autolarisConfigured()) return { ok: false, error: "Pembayaran belum dikonfigurasi oleh platform." };
  if (!channelCode) return { ok: false, error: "Pilih metode pembayaran dulu." };

  // ONE creator for the cron, this action and the Super Admin's manual invoice (Task 8.24). It
  // reuses a pending invoice, submits with a real channel code and the OWNER's e-mail as payer.
  const r = await createSubscriptionInvoice({ storeId: session.storeId, cycle, channelCode, actor: "merchant" });
  if (!r.ok) return { ok: false, error: r.error };
  if (!r.reused) revalidatePath("/akun/langganan");
  const d = r.detail;
  const detail = await toDetail({ number: d.number, cycle: d.cycle, amountIdr: d.amountIdr, channel: d.channel, virtualAccount: d.virtualAccount, qr: d.qr, paymentUrl: d.paymentUrl });
  return { ok: true, detail, reused: r.reused };
}

// Cancel an unpaid subscription invoice (so the merchant can start a different cycle).
export async function cancelSubscriptionInvoice(number: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireCapability("settings:write", { allowSuspended: true });
  const [inv] = await db
    .select({ storeId: schema.invoices.storeId, kind: schema.invoices.kind, status: schema.invoices.status })
    .from(schema.invoices).where(eq(schema.invoices.number, number)).limit(1);
  if (!inv || inv.storeId !== session.storeId || inv.kind !== "subscription" || inv.status !== "menunggu") return { ok: false, error: "Tagihan tidak bisa dibatalkan." };
  await db.update(schema.invoices).set({ status: "gagal" }).where(eq(schema.invoices.number, number));
  revalidatePath("/akun/langganan");
  return { ok: true };
}
