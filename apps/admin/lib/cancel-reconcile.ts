// Type-only: esbuild elides it, so this module never touches `@tokophi/db` at import time.
import type { KaOutcome } from "./ka-tracking";

// ─────────────────────────────────────────────────────────────────────────────
// Shipment-cancellation RECONCILIATION — the decision, and only the decision (Task 5.1 / F-S12).
//
// `cancelShipment` asks KiriminAja to void a shipment and records `shipment_bookings.status =
// 'cancellation_requested'`. The vendor's `status: true` means "accepted for cancellation", not
// "cancelled" — a non-COD void is QUEUED for up to 48 h (their doc; see `kaCancelShipment`). Nothing
// used to read that row back, so the merchant saw "diminta" forever and the order could never be
// re-booked (`shipment_one_active_per_order` counts a pending cancellation as active).
//
// The poller (`cron/tracking`) already pulls tracking for every booked order; this is the rule that
// turns "the vendor's tracking reply for an order whose cancellation is pending" into "what we write".
// It lives in its OWN module with no db import — the `platform-rank.ts` split — so every branch is
// pinned by a table-driven test that needs no database.
//
// ⚠️ WHAT IS REAL AND WHAT IS ASSUMED ABOUT THE VENDOR'S CANCELLED-SHIPMENT SHAPE.
//   REAL (documented, transcribed into `ka-status-codes.test.ts`): tracking status 300 = "canceled by
//     client", 302 = "pickup canceled by seller" — both map to outcome `canceled`; 350 = "pickup
//     cancellation REQUESTED, not granted" — deliberately unmapped (`null`).
//   ASSUMED: that a void requested through `cancel_shipment` surfaces in tracking as 300/302 rather
//     than the shipment vanishing. Nobody has driven a real cancel to completion (the sandbox never
//     issues an AWB, so it cannot cancel anything — `cancel-shipment.test.ts`). That is why
//     "not found" is its own branch below and resolves to ATTENTION, never to "voided": a shipment
//     the vendor no longer knows may be a completed void or a lost booking, and only a human can say.
// ─────────────────────────────────────────────────────────────────────────────

/** How the vendor answered a tracking pull for the pending-cancellation order. Classified by the caller. */
export type CancelVendorReply =
  /** Transport error, 5xx, retryable 4xx, or `status:false` with no recognisable "not found" text. */
  | { kind: "down" }
  /** The vendor says it does not know the package (404, or "Paket tidak ditemukan"-shaped text). */
  | { kind: "not_found" }
  /** A tracking payload we could read; `outcome` is `outcomeFromTrackingCode(data.status)`. */
  | { kind: "tracked"; outcome: KaOutcome | null };

export type CancelReconcileDecision =
  /** Write nothing; poll again next tick. */
  | { action: "wait" }
  /** The vendor confirmed the void: booking → `voided`; the order drops its provider ids and can be re-booked. */
  | { action: "void" }
  /** The parcel moved anyway: the cancellation did not happen. Booking → `accepted`; ordinary tracking mapping continues. */
  | { action: "revert"; note: string }
  /** We cannot tell what happened: booking stays pending, the merchant gets the order's problem flag. */
  | { action: "attention"; note: string };

const REVERT_NOTE: Record<Exclude<KaOutcome, "canceled" | "booked">, string> = {
  shipped: "Pembatalan tidak terlaksana: kurir sudah menjemput paket. Booking dianggap tetap aktif.",
  delivered: "Pembatalan tidak terlaksana: paket sudah terkirim. Booking dianggap tetap aktif.",
  returned: "Pembatalan tidak terlaksana: paket dikembalikan oleh kurir. Booking dianggap tetap aktif.",
  problem: "Pembatalan tidak terlaksana: kurir melaporkan kendala pada paket. Booking dianggap tetap aktif.",
};

export const NOT_FOUND_NOTE =
  "Kurir tidak lagi menemukan paket setelah pembatalan diminta. Periksa manual di dashboard kurir sebelum booking ulang.";

/**
 * Given the vendor's reply for an order whose booking is `cancellation_requested`, what do we write?
 *
 * | reply                          | action    | why |
 * |--------------------------------|-----------|-----|
 * | down                           | wait      | nothing learned; the poller comes back in 15 min |
 * | not_found                      | attention | may be a completed void OR a lost booking — a human decides |
 * | tracked, outcome null          | wait      | 350 (requested, not granted) and unmapped codes say nothing yet |
 * | tracked, booked (100–105, 110) | wait      | still at origin: the queued void (≤48 h) can still land |
 * | tracked, canceled (300/302)    | void      | the vendor confirmed it |
 * | tracked, shipped/delivered/returned/problem | revert | the parcel moved: cancellation is only possible before pickup |
 *
 * ⚠️ There is NO age-based give-up ("still `booked` after 48 h ⇒ …"): `shipment_bookings` carries no
 * `cancellation_requested_at`, and adding one is a migration this task was told not to write. A parcel
 * that sits at origin with a void the courier never honours stays pending until it moves or a human
 * looks — recorded as the known ceiling in TASKS.md 5.1.
 */
export function decideCancelReconcile(reply: CancelVendorReply): CancelReconcileDecision {
  switch (reply.kind) {
    case "down":
      return { action: "wait" };
    case "not_found":
      return { action: "attention", note: NOT_FOUND_NOTE };
    case "tracked": {
      const o = reply.outcome;
      if (o === null || o === "booked") return { action: "wait" };
      if (o === "canceled") return { action: "void" };
      return { action: "revert", note: REVERT_NOTE[o] };
    }
  }
}

/**
 * Does a failed tracking pull read as "the vendor does not know this package"? The only measured
 * shape is the cancel endpoint's `"Paket tidak ditemukan"` (sandbox, `cancel-shipment.test.ts`);
 * the English spelling is a guess at the same message from the other half of their stack.
 */
export function isNotFoundReply(httpStatus: number, text: string | undefined): boolean {
  if (httpStatus === 404) return true;
  return /tidak ditemukan|not found/i.test(text ?? "");
}
