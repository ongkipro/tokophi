import "server-only";
import { db, schema } from "@tokophi/db";
import { and, eq, like, sql } from "drizzle-orm";
import { applyOrderStatusChange, type OrderStatus } from "./order-status";
import { kaTrack } from "@tokophi/lib/kiriminaja";
import { normalizeSortingCode, realWaybill, sortingCodeFromHint } from "@tokophi/lib/kiriminaja-tracking";
import { decideCancelReconcile, type CancelVendorReply } from "./cancel-reconcile";

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
    // 302 "pickup canceled by seller" ends the shipment exactly as 300 "canceled by client" does.
    if (code === 300 || code === 302) return "canceled";
    // 310 "recipient did not order" and 311 "recipient unwilling to pay" are the two refusal codes;
    // 311 is the COD refusal. Both go to RTS, so they are `returned` — the same place 301 goes.
    if (code === 301 || code === 310 || code === 311 || (code >= 400 && code <= 406)) return "returned";
    // 333 (destroyed by courier) and 555 (confiscated by Customs) are documented FINAL states. They
    // were unmapped, so the order never left `dikirim` and the poller re-queued it every 15 minutes
    // forever — and the sweep takes only BATCH rows per tick, so parcels that can never resolve
    // accumulate at the head of the queue and starve the ones with work outstanding. `problem` does
    // not move the status (a destroyed parcel is neither delivered nor returned, and whether it
    // should settle as `batal` is a refund/claim decision we do not get to make here) but it does
    // raise `problem_at`/`problem_note`, so the merchant SEES it instead of it sitting silent.
    if (code === 333 || code === 500 || code === 555 || (code >= 700 && code <= 905)) return "problem";
    // 110 "pending direct pickup" is PRE-pickup and must be checked before the 106+ transit range it
    // falls inside. Mapping it to `shipped` told the merchant and the buyer the parcel was on its
    // way while it still sat at the origin — and RANK is forward-only, so that lie is permanent.
    if (code === 110) return "booked";
    if (code >= 106 && code < 200) return "shipped";   // picked up / in transit / re-delivery
    if (code >= 100 && code <= 105) return "booked";   // created / at DC / awaiting AWB
    // Deliberately unmapped: 210 (SOP violation / over SLA), 211 (violation resolved) and 350
    // (pickup cancellation REQUESTED — not granted; the courier may still collect). Flagging 210 as
    // a problem without a path that lowers the flag on 211 would leave a resolved violation showing
    // as stuck forever, and 350 is a request, not an outcome.
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
  /**
   * How the vendor answered, for the CANCELLATION reconciler (Task 5.1). Only consulted when the
   * order's booking is `cancellation_requested`. Defaults to `{ kind: "tracked", outcome }`, so an
   * ordinary caller need not know the reconciler exists; the poller passes `{ kind: "not_found" }`
   * explicitly on a failed pull, because that branch never reaches here otherwise.
   */
  cancelReply?: CancelVendorReply,
  /**
   * The courier's sorting code for this waybill (0110), already resolved by the caller from a
   * verified source — the tracking pull, or a webhook row bound to the verified AWB
   * (`sortingCodeFromHint`). Normalised again here, because this is the column's only writer.
   */
  sortingCode?: string | null,
): Promise<KaSyncResult> {
  const code = normalizeSortingCode(sortingCode);
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
        sortingCode: schema.orders.sortingCode,
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

    // ── A PENDING CANCELLATION IS RECONCILED BEFORE ANYTHING ELSE (Task 5.1 / F-S12) ─────────
    // `cancelShipment` recorded the merchant's intent as `shipment_bookings.status =
    // 'cancellation_requested'`; the vendor only QUEUED the void. This is the one place that reads
    // it back. It sits above the ordinary mapping on purpose: tracking code 300/302 maps to outcome
    // `canceled` → `batal`, which for a courier-side cancellation nobody asked for is right — but
    // for a void the MERCHANT requested it would restore stock and claw back the sale on an order
    // they mean to re-ship. The decision itself is pure (`cancel-reconcile.ts`); this block only
    // applies it, inside the same row lock every other tracking write takes.
    const [pendingCancel] = await tx
      .select({ id: schema.shipmentBookings.id })
      .from(schema.shipmentBookings)
      .where(
        and(
          eq(schema.shipmentBookings.orderId, order.id),
          eq(schema.shipmentBookings.status, "cancellation_requested"),
        ),
      )
      .limit(1);
    if (pendingCancel) {
      const decision = decideCancelReconcile(cancelReply ?? { kind: "tracked", outcome });
      if (decision.action === "void") {
        // The vendor confirmed the void. The booking is closed, the order drops its provider ids —
        // `createShipment` refuses while `ka_order_id` is set, and the poller's own query would keep
        // pulling 300 forever — and a `dikirim` order goes back to `diproses`, the transition the
        // ALLOWED table documents as "the shipment was VOIDED and the order needs (re)booking".
        // `diproses` moves no stock and books no money (`applyOrderStatusChange`'s own comment).
        // ⚠️ The seller's shipping debit on the booking is NOT reversed here: a confirmed void is
        // not a confirmed REFUND (`shipment_booking_status` has a separate `refunded` for that, and
        // nothing observes it yet). Reversing on a guess would hand back money the courier may keep.
        await tx
          .update(schema.shipmentBookings)
          .set({
            status: "voided",
            voidedAt: new Date(),
            failureNote: "Kurir mengonfirmasi pembatalan. Pesanan bisa dibooking ulang.",
          })
          .where(eq(schema.shipmentBookings.id, pendingCancel.id));
        await tx
          .update(schema.orders)
          // The sorting code belongs to the waybill being voided — it goes with it (0110).
          .set({ awb: null, kaOrderId: null, sortingCode: null, problemAt: null, problemNote: null })
          .where(eq(schema.orders.id, order.id));
        changed.push("cancel:voided");
        if (order.status === "dikirim") {
          const result = await applyOrderStatusChange(
            tx as unknown as Parameters<typeof applyOrderStatusChange>[0],
            { storeId: order.storeId, order: { id: order.id, status: "dikirim" }, status: "diproses" },
          );
          if (result.applied) changed.push("status:dikirim→diproses");
        }
        // Nothing below applies: the AWB was just cleared and the forward mapping (300 → batal) is
        // exactly what this block exists to pre-empt.
        return;
      }
      if (decision.action === "attention") {
        // Same shape as the `problem` flag below: stamp once, refresh the note, never re-age it.
        await tx
          .update(schema.orders)
          .set({ problemAt: order.problemAt ?? new Date(), problemNote: decision.note })
          .where(eq(schema.orders.id, order.id));
        changed.push("cancel:attention");
        return;
      }
      if (decision.action === "revert") {
        // The parcel moved, so the cancellation did not happen. The booking stands again and the
        // ordinary mapping below carries the order wherever the courier says it is.
        await tx
          .update(schema.shipmentBookings)
          .set({ status: "accepted", failureNote: decision.note })
          .where(eq(schema.shipmentBookings.id, pendingCancel.id));
        changed.push("cancel:reverted");
      }
      // `wait`: fall through — a `booked` outcome cannot move a `diproses`/`dikirim` order anyway.
    }

    // AWB: a booking returns awb: null; the waybill exists only once a courier accepts the pickup.
    // Never overwrite a real waybill with our own booking ref echoed back.
    if (awb && awb !== order.awb) {
      // A NEW waybill replaces the old one's sorting code too: a code routes one AWB, and carrying it
      // onto a different parcel number would print a routing the courier never assigned to it.
      await tx.update(schema.orders).set({ awb, sortingCode: code }).where(eq(schema.orders.id, order.id));
      changed.push(`awb:${awb}`);
      if (code) changed.push(`sorting:${code}`);
    } else if (code && code !== order.sortingCode && (awb ?? order.awb)) {
      // Same waybill, code now known (or corrected). Never written without a waybill to attach it to,
      // and never CLEARED by a pull that simply omits it — a later event without the field is silence,
      // not a retraction.
      await tx.update(schema.orders).set({ sortingCode: code }).where(eq(schema.orders.id, order.id));
      changed.push(`sorting:${code}`);
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
      const result = await applyOrderStatusChange(
        tx as unknown as Parameters<typeof applyOrderStatusChange>[0],
        {
          storeId: order.storeId,
          order: { id: order.id, status: cur },
          status: target,
        },
      );
      if (result.applied) changed.push(`status:${cur}→${target}`);
    }
  });
  if (!found) return { ok: false, changed: [], error: `order ${orderNumber} not found` };
  return { ok: true, changed };
}

// ── A "PERMANENT REJECTION" FLAG THAT IS NO LONGER TRUE (audit, 2026-09-14) ──────────────────────
// `cron/tracking` raises `problem_at` with a note built from this mark when the vendor refuses a
// tracking request with a non-retryable 4xx — in practice the 2026-09-07 IP allow-list lapse, which
// wrote "…menolak permintaan pelacakan secara permanen (HTTP 401): Your IP address … were not
// allowed" onto every polled order. The allow-list came back on 2026-09-09, but a failed pull never
// lowers a flag, and "Tracking tidak tersedia" (HTTP 200, `status:false`) is a failed pull — so on
// production one order still told its seller, weeks later, that the courier rejects it permanently,
// naming the provider's brand in a note written before the brand was hidden (ADR 0004).
//
// The rule: once the vendor ANSWERS (any HTTP 2xx), a permanent-rejection claim is false and is
// lowered. It touches ONLY notes carrying this mark — a courier-reported obstacle (code 5xx/7xx…) or
// a cancellation "attention" note is not a rejection and is left for its own owner to clear. The
// mark is matched without the provider label in front, so notes written before and after the brand
// rename both qualify. One conditional UPDATE: atomic, and a no-op on every order without the flag.
export const TRACKING_REJECTION_MARK = "menolak permintaan pelacakan secara permanen";

export async function clearStaleTrackingRejection(orderNumber: string): Promise<boolean> {
  const rows = await db
    .update(schema.orders)
    .set({ problemAt: null, problemNote: null })
    .where(
      and(
        eq(schema.orders.number, orderNumber),
        sql`${schema.orders.problemAt} is not null`,
        like(schema.orders.problemNote, `%${TRACKING_REJECTION_MARK}%`),
      ),
    )
    .returning({ id: schema.orders.id });
  return rows.length > 0;
}

// ── WEBHOOK HALF (KA-UAT, 2026-08-24) ────────────────────────────────────────────────────────────
// KiriminAja's webhook carries NO signature, NO HMAC and NO IP allowlist (their docs, verified) —
// and in this system a delivery event collects COD cash and credits the ledger. So the webhook is
// an UNTRUSTED HINT, exactly as the cron/tracking header comment prescribes: the payload names
// which order to look at, and the FACTS come from a verified pull of the same tracking endpoint
// the poller uses. Nothing from the webhook body is ever written to the database — with ONE bound
// exception, the sorting code, which the vendor delivers on `processed_packages`: it is taken from a
// row only when that row's `awb` equals the waybill verified for the order (`sortingCodeFromHint`),
// and the pull's own `details.sorting_code` wins whenever it is present.
//
// ⚠️ The pull → map → sync rules here MIRROR cron/tracking's loop and must move together:
//   · a waybill is only real if it isn't our own booking ref echoed back (`!== ref`);
//   · an unmapped status is `null` — it fills the AWB and changes nothing (never forced "shipped");
//   · syncOrderFromKa is the ONE writer, forward-only, atomic with the money.
// The cron keeps its richer loop (evidence logging, problem flags, per-store fairness); this is the
// single-order fast path a webhook tick needs.
export async function verifyKaHint(
  kaOrderId: string,
  /** The webhook row's own `awb` and `sorting_code` — UNTRUSTED, used only through `sortingCodeFromHint`. */
  hint?: { awb?: unknown; sortingCode?: unknown },
): Promise<{ known: boolean; changed: string[] }> {
  const [order] = await db
    .select({ number: schema.orders.number, awb: schema.orders.awb, status: schema.orders.status })
    .from(schema.orders)
    .where(eq(schema.orders.kaOrderId, kaOrderId))
    .limit(1);
  // Unknown id: not ours (or a replay for a deleted probe). Report "unknown", write nothing —
  // the caller answers 200 either way so KiriminAja does not retry-storm over foreign ids.
  if (!order) return { known: false, changed: [] };
  if (order.status !== "diproses" && order.status !== "dikirim") return { known: true, changed: [] };

  const r = await kaTrack(kaOrderId);
  if (!r.ok || !r.tracking) return { known: true, changed: [] }; // the poller will catch up on its own tick
  const t = r.tracking;
  // Not our own ref echoed back, not the sandbox's `MOCK-<ref>` (realWaybill).
  const realAwb = realWaybill(t.awb, kaOrderId);
  const outcome = outcomeFromTrackingCode(t.statusCode);
  // The verified pull's code first; the webhook row's only when it names the waybill we verified.
  const sortingCode =
    t.sortingCode ??
    // The STORED waybill passes the same test: a `DEMO…` preview resi (fillDemoResi) is not something a
    // courier routes, so it must not be able to bind a code either.
    sortingCodeFromHint({ hintAwb: hint?.awb, hintSortingCode: hint?.sortingCode, verifiedAwb: realAwb ?? realWaybill(order.awb, kaOrderId) });
  if (!realAwb && !outcome && !sortingCode) return { known: true, changed: [] };
  const s = await syncOrderFromKa(order.number, outcome, realAwb, null, undefined, sortingCode);
  return { known: true, changed: s.changed };
}
