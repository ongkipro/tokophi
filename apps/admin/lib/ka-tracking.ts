import "server-only";
import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { applyOrderStatusChange, type OrderStatus } from "./order-status";

// ─────────────────────────────────────────────────────────────────────────────
// KiriminAja shipment tracking → order state (BACKLOG shipping #1 + #2).
//
// The ONE place that turns "what the courier says" into "what the order is". The POLLER (cron/tracking)
// pulls tracking for booked orders whose waybill hasn't landed and feeds it here. Keeping the state
// logic in one module is what lets any future puller/pusher agree about an order.
//
// Status follows the COURIER, not the seller's clicks (user decision, 2026-07-16): a booking sits at
// `diproses`; it becomes `dikirim` the moment the courier accepts the pickup (the same moment the AWB
// appears); `selesai` on delivery. This module NEVER drags an order backward — a replayed tracking
// pull cannot pull a `selesai` order back to `dikirim`.
// ─────────────────────────────────────────────────────────────────────────────

// The courier outcomes we act on. A tracking status code collapses to one of these.
export type KaOutcome = "booked" | "shipped" | "delivered" | "returned" | "canceled" | "problem";

/**
 * Tracking status code → outcome (docs: important-notes/status-mapping). KiriminAja's detailed codes:
 * 100–105 entry/processing, 106+ in transit, 200 delivered, 300 canceled, 301/40x returned, 500/7xx/9xx
 * problem. Read off the numeric `status` of a tracking pull.
 */
export function outcomeFromTrackingCode(code: number): KaOutcome | null {
  if (!Number.isFinite(code)) return null;
  if (code === 200) return "delivered";
  if (code === 300) return "canceled";
  if (code === 301 || (code >= 400 && code <= 406)) return "returned";
  if (code === 500 || (code >= 700 && code <= 905)) return "problem";
  if (code >= 106 && code < 200) return "shipped";   // picked up / in transit / re-delivery
  if (code >= 100 && code <= 105) return "booked";   // created / at DC / awaiting AWB
  return null;
}

// Outcome → our order_status. `problem` maps to null: an obstacle is a flag, not a forced state change
// (a stuck parcel is neither delivered nor returned yet).
const OUTCOME_STATUS: Record<KaOutcome, OrderStatus | null> = {
  booked: "diproses",
  shipped: "dikirim",
  delivered: "selesai",
  returned: "retur",
  canceled: "batal",
  problem: null,
};

// Forward-only rank. A courier only ever carries an order onward; a late/replayed update must never
// walk it back (that would re-book stock or re-open a settled ledger). `retur`/`batal` are terminal.
const RANK: Record<OrderStatus, number> = { baru: 0, diproses: 1, dikirim: 2, selesai: 3, retur: 4, batal: 4 };

export type KaSyncResult = { ok: boolean; changed: string[]; error?: string };

/**
 * Apply ONE KiriminAja update to ONE order. Runs on the OWNER connection (the poller/webhook have no
 * merchant session) inside a transaction, and reuses `applyOrderStatusChange` so inventory, the ledger
 * and COD move exactly as they would on a manual status change. Fills the AWB the instant the courier
 * issues it. Advances state FORWARD only.
 */
export async function syncOrderFromKa(orderNumber: string, outcome: KaOutcome, awb?: string | null): Promise<KaSyncResult> {
  const [order] = await db
    .select({ id: schema.orders.id, storeId: schema.orders.storeId, status: schema.orders.status, awb: schema.orders.awb })
    .from(schema.orders)
    .where(eq(schema.orders.number, orderNumber))
    .limit(1);
  if (!order) return { ok: false, changed: [], error: `order ${orderNumber} not found` };

  const changed: string[] = [];
  await db.transaction(async (tx) => {
    // AWB: a booking returns awb: null; the waybill exists only once a courier accepts the pickup.
    // Never overwrite a real waybill with our own booking ref echoed back.
    if (awb && awb !== order.awb) {
      await tx.update(schema.orders).set({ awb }).where(eq(schema.orders.id, order.id));
      changed.push(`awb:${awb}`);
    }
    const cur = order.status as OrderStatus;
    const target = OUTCOME_STATUS[outcome];
    if (target && RANK[target] > RANK[cur]) {
      // The drizzle tx has the same query surface as the root db the state machine is typed against
      // (Tx === Db === typeof rootDb) — withTenant casts the same way. So the whole change (inventory,
      // payments, ledger) runs inside THIS transaction, atomic like a manual status change.
      await applyOrderStatusChange(tx as unknown as Parameters<typeof applyOrderStatusChange>[0], {
        storeId: order.storeId,
        order: { id: order.id, status: cur },
        status: target,
      });
      changed.push(`status:${cur}→${target}`);
    }
  });
  return { ok: true, changed };
}
