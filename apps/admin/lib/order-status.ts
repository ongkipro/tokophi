import { schema } from "@tokophi/db";
import { and, eq, sql } from "drizzle-orm";
import { settleOrderLedger, type Db } from "./ledger-credit";
import { onOrderStatusForAffiliate } from "./affiliate-attribution";
import { defaultInventoryLevelId } from "./inventory-location";
import type { OrderStatusRefusal } from "./order-status-refusal";

export type OrderStatus = "baru" | "diproses" | "dikirim" | "selesai" | "batal" | "retur";

// A DISCRIMINATED union, not `{ applied: boolean; reason?: string }`. `reason` used to be a free
// string, so a caller could neither exhaust it nor turn it into a message — which is part of why the
// merchant-facing caller ignored the whole result. The refusals and their wording live in the pure
// `order-status-refusal.ts` (no db import) so client components can read them too.
export type OrderStatusChangeResult =
  | { applied: true; reason?: undefined }
  | { applied: false; reason: OrderStatusRefusal };
export type OrderStatusChangeArgs = {
  storeId: string;
  order: { id: string; status: OrderStatus };
  status: OrderStatus;
  returnReason?: string;
};

// The order state machine — inventory + payments + ledger — minus the auth/tenant wrapper, so it is
// callable with a `db`/`tx` and can be exercised against a real Postgres. `setOrderStatus` (the server
// action in actions/orders.ts) does requireCapability + withTenant + the order lookup, then calls this
// INSIDE the tenant transaction. Same seam as `settleOrderLedger`.
//
// Call with the order's CURRENT status as `order.status` (read BEFORE this runs) — the guard below
// depends on it, and the row is updated to the new status here.
export async function applyOrderStatusChange(
  db: Db,
  args: OrderStatusChangeArgs,
): Promise<OrderStatusChangeResult> {
  const { storeId, order, status, returnReason } = args;

  // Idempotent + terminal-safe. A repeat or concurrent call with the SAME status is a no-op, and a
  // TERMINAL order (batal/retur) accepts no further transition. This is what stops:
  //   · batal↔retur — each restores stock, so allowing the second would double-restore (phantom stock)
  //   · batal/retur → active — reactivating a cancelled order whose stock was already put back, giving
  //     an active order with nothing decremented (oversell)
  // The FOR UPDATE lock in setOrderStatus serializes concurrent calls, so the second one reads the
  // already-updated status and lands on one of these guards instead of re-running the restore.
  if (order.status === status) return { applied: false, reason: "status-unchanged" };
  if (order.status === "batal" || order.status === "retur")
    return { applied: false, reason: "terminal-order" };

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
    // Tracking can skip pickup/in-transit events, so a courier-confirmed delivery or return may be
    // the first update after booking. Those outcomes must still run COD collection/ledger or restore.
    diproses: ["dikirim", "selesai", "batal", "retur"],
    // `diproses` = the shipment was VOIDED and the order needs (re)booking. `cancelShipment` routes
    // through here, and this transition was missing — so voiding a shipment on a `dikirim` order
    // silently did nothing: the AWB and courier were cleared while the status stayed "Dikirim", which
    // is the exact stuck state `actions/shipping.ts` says it was written to prevent (with `kaOrderId`
    // now null, the tracking poller can never move it either). It moves no stock, fails no payment and
    // books no money — `restores` is batal|retur only and `settleOrderLedger` matches none of its
    // branches for `diproses`. Found by a ledger test that had been silently dead since migration 0081.
    dikirim: ["selesai", "batal", "retur", "diproses"],
    // Settled, but a parcel can still come back. `retur` is the ONLY way out, and it carries its own
    // claw-back that reverses the sale correctly.
    selesai: ["retur"],
  };
  if (!ALLOWED[order.status]?.includes(status))
    return { applied: false, reason: "transition-not-allowed" };

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
      //
      // 🔴 The `storeId` argument IS THE TENANT BOUNDARY — the CHILD-TABLE RULE (AGENTS.md) — and
      // this path is why the helper takes it rather than reading it from a session: `ka-tracking.ts`
      // reaches here on the OWNER connection, where RLS is off entirely. See
      // `lib/inventory-location.ts`. (This used to be hand-written SQL here, and it was the ONLY one
      // of the expression's five copies that carried the filter at all.)
      const invId = await defaultInventoryLevelId(db, l.variantId, storeId);
      if (invId)
        await db
          .update(schema.inventoryLevels)
          .set({ available: sql`${schema.inventoryLevels.available} + ${l.qty}` })
          .where(eq(schema.inventoryLevels.id, invId));
    }

    // fail any still-pending payment so a cancelled/returned order can't be marked paid later. For a
    // refused COD parcel this is the whole point: the cash was never collected.
    await db
      .update(schema.payments)
      .set({ status: "gagal" })
      .where(and(eq(schema.payments.orderId, order.id), eq(schema.payments.status, "menunggu")));
    // ── THE BUYER'S MONEY GETS A ROW (0112, Task 8.31) ──────────────────────────────────────────
    // A payment that already reached `berhasil` is money we HOLD. Failing `menunggu` payments above
    // and clawing back the seller's sale below (`settleOrderLedger`) settled our side; nothing said
    // the buyer was owed anything. Written HERE, in the same transaction as the claw-back, so an
    // order cannot be cancelled with the seller's credit reversed and the buyer's debt unrecorded.
    // Never COD (collected at the door — a refused parcel collected nothing). One OPEN row per
    // payment: the partial unique index makes a replayed cancellation a no-op, not a doubled debt.
    // `amount_idr` is what the buyer paid TO US (pre-gateway-fee); the gateway's admin fee is theirs.
    await db.execute(sql`
      insert into refunds (store_id, order_id, payment_id, amount_idr, reason)
      select p.store_id, p.order_id, p.id, p.amount_idr,
             ${status === "retur" ? "Retur — " + (returnReason?.trim() || "Pembeli menolak paket") : "Pesanan dibatalkan"}
        from payments p
       where p.order_id = ${order.id}
         and p.status = 'berhasil'
         and p.method <> 'cod'
      on conflict do nothing
    `);
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
  // Affiliate commission (0116, F-A7): voided with the order, or its hold window started — same txn.
  await onOrderStatusForAffiliate(db, { storeId, orderId: order.id, status });

  return { applied: true };
}
