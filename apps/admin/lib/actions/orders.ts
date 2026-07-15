"use server";
import { schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";
import { applyOrderStatusChange, type OrderStatus } from "@/lib/order-status";

export type { OrderStatus };

export async function setOrderStatus(orderId: string, status: OrderStatus, returnReason?: string): Promise<void> {
  const { storeId: sid } = await requireCapability("orders:write");
  const number = orderId.replace(/^#/, ""); // order.id is "#INV-4819"
  await withTenant(sid, async (db) => {
    const [order] = await db
      .select({ id: schema.orders.id, status: schema.orders.status })
      .from(schema.orders)
      .where(eq(schema.orders.number, number))
      .limit(1);
    if (!order) return;

    // The state machine (inventory restore + payment fail + order update + ledger) lives in
    // `lib/order-status.ts` so it can be unit-tested against a real Postgres. Runs in THIS tenant
    // transaction; prevStatus is the order's status read just above.
    await applyOrderStatusChange(db, {
      storeId: sid,
      order: { id: order.id, status: order.status as OrderStatus },
      status,
      returnReason,
    });
  });
  revalidatePath("/pesanan");
  revalidatePath(`/pesanan/${number}`);
}
