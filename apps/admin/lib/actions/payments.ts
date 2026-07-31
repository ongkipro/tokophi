"use server";
import { schema } from "@tokophi/db";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";
import { alCreatePayment, autolarisConfigured } from "@tokophi/lib/autolaris";

import { payCallbackUrl } from "@tokophi/lib/pay-callback";
const channelToMethod = (code: string): "va" | "qris" | "dana" =>
  code === "QRIS" ? "qris" : code === "DANA" ? "dana" : "va";

// Merchant creates a real payment bill (VA/QRIS/DANA) for one of its orders → persisted + linked.
export async function createOrderPayment(orderNumber: string, channelCode: string): Promise<{ ok: boolean; error?: string }> {
  const { storeId } = await requireCapability("orders:write");
  if (!autolarisConfigured()) return { ok: false, error: "Payment gateway belum dikonfigurasi oleh platform." };

  const order = await withTenant(storeId, async (db) => {
    const [o] = await db
      .select({
        id: schema.orders.id, number: schema.orders.number, total: schema.orders.totalIdr,
        status: schema.orders.status, financialStatus: schema.orders.financialStatus,
        name: schema.customers.name, phone: schema.customers.phone, email: schema.customers.email,
      })
      .from(schema.orders)
      .leftJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
      .where(eq(schema.orders.number, orderNumber))
      .limit(1);
    return o;
  });
  if (!order) return { ok: false, error: "Pesanan tidak ditemukan." };

  // A TERMINAL order must never grow a live bill either. `batal` and `retur` are end states — the
  // stock is back and any sale has been clawed back — but nothing here looked at `status`, so pressing
  // this on a cancelled order minted a real VA at the gateway. The buyer can pay it, the callback
  // marks the payment `berhasil`, and `creditSaleForPayment` then deliberately skips `batal`/`retur`:
  // their money is collected and NO sale is credited. Refusing here is the only place this stops,
  // because the callback is right to skip it.
  if (order.status === "batal" || order.status === "retur")
    return { ok: false, error: `Pesanan ${order.number} sudah ${order.status} — tagihan baru tidak bisa dibuat.` };
  // …and `financial_status` is checked as well as the payment rows below: an order marked paid by hand
  // has no `berhasil` payment row for the live-bill guard to find.
  if (order.financialStatus === "dibayar")
    return { ok: false, error: `Pesanan ${order.number} sudah dibayar.` };

  // ⚠️ THE SERVER REFUSES A SECOND LIVE BILL. The order screen already hides the button once a payment
  // exists, but the UI is not the boundary — this is a `"use server"` action and anything that can
  // dispatch it can call it twice. Two live virtual accounts for one order are both payable and both
  // match on `reff_id = order.number` (there is no unique index on it): the buyer pays both, the
  // platform collects twice, `ledger_one_sale_per_order` credits the merchant once — correctly — and
  // nothing anywhere records the money owed back.
  const live = await withTenant(storeId, async (db) => {
    const [p] = await db
      .select({ status: schema.payments.status })
      .from(schema.payments)
      // `order_id` is proven ours by the store-scoped order read above (payments has no store_id of
      // its own in this query's shape) — the CHILD-TABLE rule.
      .where(and(eq(schema.payments.orderId, order.id), inArray(schema.payments.status, ["menunggu", "berhasil"])))
      .limit(1);
    return p ?? null;
  });
  if (live) {
    return {
      ok: false,
      error: live.status === "berhasil" ? "Pesanan ini sudah dibayar." : "Sudah ada tagihan aktif untuk pesanan ini.",
    };
  }


  const r = await alCreatePayment({
    reffId: order.number,
    channelCode,
    amount: order.total,
    customerId: order.id,
    customerName: order.name ?? "Pelanggan",
    customerPhone: order.phone ?? "081200000000",
    customerEmail: order.email ?? "order@tokophi.id",
    callbackUrl: payCallbackUrl(),
  });
  if (!r.ok) return { ok: false, error: r.error ?? "Gagal membuat tagihan." };

  await withTenant(storeId, (db) =>
    db.insert(schema.payments).values({
      orderId: order.id, storeId, method: channelToMethod(channelCode), amountIdr: order.total, status: "menunggu",
      provider: "autolaris", reffId: order.number, trxId: r.trxId, channelCode,
      adminFee: r.admin ?? 0, total: r.total ?? order.total,
      virtualAccount: r.virtualAccount, qr: r.qr, url: r.url, paymentCode: r.paymentCode,
    }),
  );
  revalidatePath(`/pesanan/${orderNumber}`);
  return { ok: true };
}
