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
 * Tracking status → outcome. KiriminAja's `status` field arrives as either a numeric code OR free
 * text (the response shape is best-effort; both have been observed), so this accepts both.
 *
 * Numeric codes are the documented contract: 100–105 entry/processing, 106+ in transit, 200 delivered,
 * 300 canceled, 301/40x returned, 500/7xx/9xx problem.
 *
 * Text is treated CONSERVATIVELY: it can only move an order forward to at most `shipped` (in transit).
 * We never infer a money-moving outcome (delivered/returned/canceled/problem) from free text — "sampai
 * di kota tujuan" is not "delivered", and a false `selesai` would collect COD cash and credit the
 * ledger prematurely. Delivery/return/cancel require the numeric code or a manual status change.
 * Anything unrecognised → null (fill the AWB, change nothing).
 */
export function outcomeFromTrackingCode(raw: number | string | null | undefined): KaOutcome | null {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim();
  if (str === "") return null;
  if (/^\d+$/.test(str)) {
    const code = Number(str);
    if (code === 200) return "delivered";
    if (code === 300) return "canceled";
    if (code === 301 || (code >= 400 && code <= 406)) return "returned";
    if (code === 500 || (code >= 700 && code <= 905)) return "problem";
    if (code >= 106 && code < 200) return "shipped";   // picked up / in transit / re-delivery
    if (code >= 100 && code <= 105) return "booked";   // created / at DC / awaiting AWB
    return null;
  }
  const s = str.toLowerCase();
  // "pickup"/"pick up" is ambiguous ("menunggu pickup" = awaiting = booked), so it lives in booked, not
  // shipped. Only unmistakable in-transit wording advances to shipped.
  if (/(transit|perjalanan|dikirim|dijemput|di jemput|out for delivery|dalam pengiriman)/.test(s)) return "shipped";
  if (/(diproses|dibuat|created|pending|menunggu|booking|pick ?up)/.test(s)) return "booked";
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
 * merchant session) inside ONE transaction that locks the order row FOR UPDATE, and reuses
 * `applyOrderStatusChange` so inventory, the ledger and COD move exactly as they would on a manual
 * status change — and serialize against one. Fills the AWB the instant the courier issues it.
 * Advances state FORWARD only.
 *
 * ⚠️ Callers must do their tracking fetch BEFORE calling this. The lock is held for the whole call, so
 * a network round-trip inside it would hold a row lock across the internet.
 */
export async function syncOrderFromKa(
  orderNumber: string,
  outcome: KaOutcome | null,
  awb?: string | null,
  /** Merchant-facing Indonesian reason, stored on `orders.problem_note` when outcome is `problem`. */
  problemNote?: string | null,
): Promise<KaSyncResult> {
  const changed: string[] = [];
  let found = true;
  await db.transaction(async (tx) => {
    // FOR UPDATE, and the read lives INSIDE the transaction — same discipline as setOrderStatus
    // (9772246). The status read and the transition it decides must be one atomic step: this read used
    // to sit outside any lock, so the poller and a manual change (or two overlapping cron runs) could
    // both see `dikirim` and both transition — dikirim→selesai racing dikirim→retur, one crediting the
    // ledger while the other restored stock and reversed it. The loser now blocks here, re-reads the
    // already-updated status, and falls on the forward-only RANK check or applyOrderStatusChange's
    // same-status/terminal guards. Safe to hold: there is NO network call in this function — the cron
    // route finishes its KiriminAja pull (kaTrack) before calling us, so the txn only ever spans local
    // queries. Never move an HTTP call between this read and the write.
    const [order] = await tx
      .select({
        id: schema.orders.id,
        storeId: schema.orders.storeId,
        status: schema.orders.status,
        awb: schema.orders.awb,
        problemAt: schema.orders.problemAt,
      })
      .from(schema.orders)
      .where(eq(schema.orders.number, orderNumber))
      .for("update")
      .limit(1);
    if (!order) {
      found = false;
      return;
    }

    // AWB: a booking returns awb: null; the waybill exists only once a courier accepts the pickup.
    // Never overwrite a real waybill with our own booking ref echoed back.
    if (awb && awb !== order.awb) {
      await tx.update(schema.orders).set({ awb }).where(eq(schema.orders.id, order.id));
      changed.push(`awb:${awb}`);
    }
    // ── The problem flag (0062) ────────────────────────────────────────────────────────────────
    // `problem` maps to NO status change (OUTCOME_STATUS.problem === null) — it is a flag, and this
    // is the only place that raises or lowers it.
    //
    // ⚠️ The `outcome === null` case is deliberately absent from both branches. An unmapped status
    // means we do not know what the courier said (ee8a458): it fills the AWB and changes NOTHING.
    // Treating "unrecognised" as "moving again" would silently clear a real obstacle, and treating
    // it as a problem would flag every parcel whose status string we have not seen before.
    if (outcome === "problem") {
      // Do NOT re-stamp an obstacle that is already flagged. `problem_at` answers "macet sejak
      // kapan" — the seller's actual question — and re-stamping it every poll would reset the age
      // to zero every 15 minutes, so a parcel stuck for four days would forever read "baru saja".
      // The note is still refreshed: the courier may have a more specific reason now.
      await tx
        .update(schema.orders)
        .set({
          problemAt: order.problemAt ?? new Date(),
          problemNote: problemNote ?? "Kurir melaporkan kendala pengiriman.",
        })
        .where(eq(schema.orders.id, order.id));
      if (!order.problemAt) changed.push("problem:set");
    } else if (outcome && order.problemAt) {
      // The parcel is moving again (booked/shipped/delivered/returned/canceled all mean the courier
      // reported real progress). Clear it. A flag that only ever accumulates becomes noise nobody
      // reads — and an alarm that is always on is an alarm that is off.
      await tx
        .update(schema.orders)
        .set({ problemAt: null, problemNote: null })
        .where(eq(schema.orders.id, order.id));
      changed.push("problem:cleared");
    }

    const cur = order.status as OrderStatus;
    const target = outcome ? OUTCOME_STATUS[outcome] : null;
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
  if (!found) return { ok: false, changed: [], error: `order ${orderNumber} not found` };
  return { ok: true, changed };
}
