import "server-only";
import { schema } from "@tokophi/db";
import { eq, desc } from "drizzle-orm";
import { withCurrentTenant } from "@/lib/tenant";

export type OrderPayment = {
  channelCode: string;
  virtualAccount: string | null;
  qr: string | null;
  url: string | null;
  paymentCode: string | null;
  amount: number;
  adminFee: number;
  total: number;
  status: "menunggu" | "berhasil" | "gagal";
  trxId: string | null;
};

// Latest real (gateway) payment for an order — only rows created via the AutoLaris gateway
// carry a channelCode; the legacy seed payment (method-only) is ignored.
export async function getOrderPayment(orderNumber: string): Promise<OrderPayment | null> {
  return withCurrentTenant(async (db) => {
    const [o] = await db.select({ id: schema.orders.id }).from(schema.orders).where(eq(schema.orders.number, orderNumber)).limit(1);
    if (!o) return null;
    const [p] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, o.id)).orderBy(desc(schema.payments.id)).limit(1);
    if (!p || !p.channelCode) return null;
    return {
      channelCode: p.channelCode,
      virtualAccount: p.virtualAccount ?? null,
      qr: p.qr ?? null,
      url: p.url ?? null,
      paymentCode: p.paymentCode ?? null,
      amount: p.amountIdr,
      adminFee: p.adminFee ?? 0,
      total: p.total ?? p.amountIdr,
      status: p.status,
      trxId: p.trxId ?? null,
    };
  });
}
