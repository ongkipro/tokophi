"use server";
import { schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";
import { alCreatePayment, autolarisConfigured } from "@tokophi/lib/autolaris";

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
        name: schema.customers.name, phone: schema.customers.phone, email: schema.customers.email,
      })
      .from(schema.orders)
      .leftJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
      .where(eq(schema.orders.number, orderNumber))
      .limit(1);
    return o;
  });
  if (!order) return { ok: false, error: "Pesanan tidak ditemukan." };

  const r = await alCreatePayment({
    reffId: order.number,
    channelCode,
    amount: order.total,
    customerId: order.id,
    customerName: order.name ?? "Pelanggan",
    customerPhone: order.phone ?? "081200000000",
    customerEmail: order.email ?? "order@tokophi.id",
    callbackUrl: (process.env.PUBLIC_APP_URL ?? "http://localhost:3000") + "/api/public/pay/callback",
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
