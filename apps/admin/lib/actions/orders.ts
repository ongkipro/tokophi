"use server";
import { schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";
import {
  applyOrderStatusChange,
  type OrderStatus,
  type OrderStatusChangeResult,
} from "@/lib/order-status";

// ⚠️ Do NOT re-export the type from here. `export type { OrderStatus }` lived here from c86e831 until
// 2026-07-16 and it took production down: in a `"use server"` module the bundler turns EVERY export
// into a server-action reference, so it emitted a reference to a name TypeScript had already erased —
// `ReferenceError: OrderStatus is not defined`, thrown at module evaluation, which killed the whole
// Pesanan screen and every status change with it. tsc was green, `next build` was green, the ledger
// tests were green; only a click in the real app found it. Nothing imported the type from here anyway.
// Import it from `@/lib/order-status` (a plain module) instead.

// ⚠️ RETURNS THE OUTCOME, AND THE CALLERS MUST READ IT. This was `Promise<void>` and threw the
// state machine's answer away, so all three screens toasted success over changes that never
// happened — the worst being "Pesanan ditandai retur — stok dikembalikan." on a refusal that moved
// no stock. Both BACKGROUND callers of `applyOrderStatusChange` (ka-tracking, order-expiry cron)
// have always read `applied`; only the merchant's path did not, and the merchant is the one who
// acts on the sentence. Turning a silent action into a reported one is a change to every caller in
// the same commit — the repo's standing two-file rule; here it is four files.
export async function setOrderStatus(
  orderId: string,
  status: OrderStatus,
  returnReason?: string,
): Promise<OrderStatusChangeResult> {
  const { storeId: sid } = await requireCapability("orders:write");
  const number = orderId.replace(/^#/, ""); // order.id is "#INV-4819"
  const result = await withTenant(sid, async (db): Promise<OrderStatusChangeResult> => {
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
    // Nothing to lock. RLS filters another store's order out of this read, so this also covers
    // "not yours" — and it used to be a bare `return`, i.e. reported as success.
    if (!order) return { applied: false, reason: "order-not-found" };

    // The state machine (inventory restore + payment fail + order update + ledger) lives in
    // `lib/order-status.ts` so it can be unit-tested against a real Postgres. Runs in THIS tenant
    // transaction; prevStatus is the order's status read just above.
    return applyOrderStatusChange(db, {
      storeId: sid,
      order: { id: order.id, status: order.status as OrderStatus },
      status,
      returnReason,
    });
  });
  revalidatePath("/pesanan");
  revalidatePath(`/pesanan/${number}`);
  return result;
}
