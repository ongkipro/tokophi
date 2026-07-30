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

  // Idempotent + terminal-safe. A repeat or concurrent call with the SAME status is a no-op, and a
  // TERMINAL order (batal/retur) accepts no further transition. This is what stops:
  //   · batal↔retur — each restores stock, so allowing the second would double-restore (phantom stock)
  //   · batal/retur → active — reactivating a cancelled order whose stock was already put back, giving
  //     an active order with nothing decremented (oversell)
  // The FOR UPDATE lock in setOrderStatus serializes concurrent calls, so the second one reads the
  // already-updated status and lands on one of these guards instead of re-running the restore.
  if (order.status === status) return;
  if (order.status === "batal" || order.status === "retur") return;

  // ── AND THE TRANSITION ITSELF MUST BE ONE WE ALLOW ──────────────────────────────────────────────
  //
  // The two guards above refuse a REPEAT and refuse leaving a terminal state. They do not say which
  // moves are legal, so everything else was permitted — including two that cost money out of
  // `selesai`, which is settled but deliberately NOT terminal (so a return can still be recorded):
  //   · `selesai → batal` restores stock AND claws back an `available` sale on a delivered COD order
  //     whose cash the merchant is holding.
  //   · `selesai → dikirim` silently un-completes a settled order.
  // `setOrderStatus` is a "use server" action taking `status` straight from the client with no
  // runtime check, so the UI hiding these is not the boundary — this is.
  const ALLOWED: Record<string, string[]> = {
    baru: ["diproses", "dikirim", "batal"],
    diproses: ["dikirim", "batal"],
    dikirim: ["selesai", "batal", "retur"],
    // Settled, but a parcel can still come back. `retur` is the ONLY way out, and it carries its own
    // claw-back that reverses the sale correctly.
    selesai: ["retur"],
  };
  if (!ALLOWED[order.status]?.includes(status)) return;

  // Cancelling OR returning a live order → put the stock back. `batal` never shipped; `retur` shipped
  // and came back — but in BOTH cases the goods are on the merchant's shelf again, so both must restore
  // inventory. Missing the `retur` case would quietly shrink real stock on every refused COD parcel.
  // (The same-status / terminal guards above already ensure we only reach here on the FIRST transition
  // into batal/retur, so this can't double-restore.)
  const restores = status === "batal" || status === "retur";
  if (restores) {
    const lines = await db
      .select({ variantId: schema.orderLineItems.variantId, qty: schema.orderLineItems.qty })
      .from(schema.orderLineItems)
      .where(eq(schema.orderLineItems.orderId, order.id));
    for (const l of lines) {
      if (!l.variantId) continue;
      // Restore to ONE row (the default location), mirroring the create-path decrement — a bare
      // `where variant_id = X` adds qty to EVERY location row, inflating stock N× under multi-location.
      await db
        .update(schema.inventoryLevels)
        .set({ available: sql`${schema.inventoryLevels.available} + ${l.qty}` })
        .where(sql`${schema.inventoryLevels.id} = (
          select il.id from inventory_levels il
          join locations loc on loc.id = il.location_id
          where il.variant_id = ${l.variantId}
          order by loc.is_default desc, il.id
          limit 1
        )`);
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
