"use server";
import { schema } from "@tokophi/db";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";

export type OrderStatus = "baru" | "diproses" | "dikirim" | "selesai" | "batal";

export async function setOrderStatus(orderId: string, status: OrderStatus): Promise<void> {
  const { storeId: sid } = await requireCapability("orders:write");
  const number = orderId.replace(/^#/, ""); // order.id is "#INV-4819"
  await withTenant(sid, async (db) => {
    const [order] = await db
      .select({ id: schema.orders.id, status: schema.orders.status })
      .from(schema.orders)
      .where(eq(schema.orders.number, number))
      .limit(1);
    if (!order) return;

    // Cancelling a live order → return its reserved stock (mirrors the checkout decrement in
    // apps/admin/app/api/public/order/route.ts). Guarded on the previous status so a repeat
    // "batal" doesn't double-restore.
    if (status === "batal" && order.status !== "batal") {
      const lines = await db
        .select({ variantId: schema.orderLineItems.variantId, qty: schema.orderLineItems.qty })
        .from(schema.orderLineItems)
        .where(eq(schema.orderLineItems.orderId, order.id));
      for (const l of lines) {
        if (!l.variantId) continue;
        await db
          .update(schema.inventoryLevels)
          .set({ available: sql`${schema.inventoryLevels.available} + ${l.qty}` })
          .where(eq(schema.inventoryLevels.variantId, l.variantId));
      }
    }

    await db.update(schema.orders).set({ status }).where(eq(schema.orders.id, order.id));
  });
  revalidatePath("/pesanan");
  revalidatePath(`/pesanan/${number}`);
}
