"use server";
import { schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";
import { applyOrderStatusChange, type OrderStatus } from "@/lib/order-status";

// ⚠️ Do NOT re-export the type from here. `export type { OrderStatus }` lived here from c86e831 until
// 2026-07-16 and it took production down: in a `"use server"` module the bundler turns EVERY export
// into a server-action reference, so it emitted a reference to a name TypeScript had already erased —
// `ReferenceError: OrderStatus is not defined`, thrown at module evaluation, which killed the whole
// Pesanan screen and every status change with it. tsc was green, `next build` was green, the ledger
// tests were green; only a click in the real app found it. Nothing imported the type from here anyway.
// Import it from `@/lib/order-status` (a plain module) instead.

export async function setOrderStatus(orderId: string, status: OrderStatus, returnReason?: string): Promise<void> {
  const { storeId: sid } = await requireCapability("orders:write");
  const number = orderId.replace(/^#/, ""); // order.id is "#INV-4819"
  await withTenant(sid, async (db) => {
    // FOR UPDATE: two concurrent status changes on the same order (double-click, or the list + detail
    // views both firing) must serialize, or both read the same prevStatus and both run the inventory
    // restore → phantom stock. The loser now blocks here, then reads the already-updated status and
    // the guards in applyOrderStatusChange make it a no-op. Same discipline as the create path's lock.
    const [order] = await db
      .select({ id: schema.orders.id, status: schema.orders.status })
      .from(schema.orders)
      .where(eq(schema.orders.number, number))
      .for("update")
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
