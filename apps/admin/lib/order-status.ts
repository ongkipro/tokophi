import { schema } from "@tokophi/db";
import { and, eq, sql } from "drizzle-orm";
import { settleOrderLedger, type Db } from "./ledger-credit";

export type OrderStatus = "baru" | "diproses" | "dikirim" | "selesai" | "batal" | "retur";

// The order state machine — inventory + payments + ledger — minus the auth/tenant wrapper, so it is
// callable with a `db`/`tx` and can be exercised against a real Postgres. `setOrderStatus` (the server
// action in actions/orders.ts) does requireCapability + withTenant + the order lookup, then calls this
// INSIDE the tenant transaction. Same seam as `settleOrderLedger`.
//
// Call with the order's CURRENT status as `order.status` (read BEFORE this runs) — the guard below
// depends on it, and the row is updated to the new status here.
export async function applyOrderStatusChange(
  db: Db,
  args: { storeId: string; order: { id: string; status: OrderStatus }; status: OrderStatus; returnReason?: string },
): Promise<void> {
  const { storeId, order, status, returnReason } = args;

  // Cancelling OR returning a live order → put the stock back. `batal` never shipped; `retur` shipped
  // and came back — but in BOTH cases the goods are on the merchant's shelf again, so both must restore
  // inventory. Missing the `retur` case would quietly shrink real stock on every refused COD parcel.
  // Guarded on the previous status so a repeat click can't double-restore.
  const restores = status === "batal" || status === "retur";
  if (restores && order.status !== status) {
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

    // fail any still-pending payment so a cancelled/returned order can't be marked paid later. For a
    // refused COD parcel this is the whole point: the cash was never collected.
    await db
      .update(schema.payments)
      .set({ status: "gagal" })
      .where(and(eq(schema.payments.orderId, order.id), eq(schema.payments.status, "menunggu")));
  }

  await db
    .update(schema.orders)
    .set(
      status === "retur"
        ? { status, returnedAt: new Date(), returnReason: returnReason?.trim() || "Pembeli menolak paket" }
        : { status },
    )
    .where(eq(schema.orders.id, order.id));

  // ── Saldo (ledger, migrations 0040 + 0041) ────────────────────────────────
  // The order's money moves with its status — booked/released/clawed back — inside THIS transaction,
  // so the book can never disagree with the order it describes.
  await settleOrderLedger(db, { storeId, orderId: order.id, status, prevStatus: order.status });
}
