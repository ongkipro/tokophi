import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// ── PAY-RETRY — "Bayar ulang" (2026-11-13) ──────────────────────────────────────────────────────────
//
// The RULES, and nothing else: no database, no provider. The public route
// (`app/api/public/pay/retry`), the Seller's re-bill (`actions/payments.ts`) and the order-expiry
// cron all read an instruction's state through `instructionState`, so "is this QR still payable?"
// has one answer on every path. Spec + case table: specs/docs/tasks/2026-11-13-pay-retry.md.

/** An unpaid prepaid order is cancelled (stock restored) this long after it was placed. Read by the
 *  order-expiry cron; a retry is refused once the order is about to reach it. */
export const ORDER_TTL_MS = 24 * 60 * 60 * 1000;

/** A retry this close to the cancellation would mint a bill for an order the cron is about to close. */
export const RETRY_CLOSE_MARGIN_MS = 15 * 60 * 1000;

/**
 * How long an instruction of UNKNOWN expiry is presumed payable, from the moment it was issued.
 *
 * Unknown = `expires_at` NULL: every pre-0118 row, an answer we could not parse, a provider call that
 * threw after the vendor may already have created the bill. 24 h is the longest window this account
 * has ever been given (`create_payment` +24 h; `/submit` answered +2 h). Presuming it payable for
 * that long is the conservative reading: a dead bill read as live costs a shopper a WhatsApp to the
 * seller, a live bill read as dead costs them a second charge.
 */
export const UNKNOWN_EXPIRY_BOUND_MS = 24 * 60 * 60 * 1000;

/** A claim (`request_state = in_progress`) older than this is a crashed request, not a live one. */
export const IN_PROGRESS_STALE_MS = 15 * 60 * 1000;

/** Instructions one order may ever hold — bounds what a leaked token can make us ask the vendor for. */
export const MAX_PAY_ATTEMPTS = 5;

export type InstructionRow = {
  status: "menunggu" | "berhasil" | "gagal";
  method: string;
  expiresAt: Date | null;
  requestState: "in_progress" | "accepted" | "failed" | null;
  requestUpdatedAt: Date | null;
};

/**
 * paid · failed · live (payable now) · starting (a request is in flight) · unknown (may be payable,
 * cannot tell) · expired (provably past its window).
 *
 * `placedAt` anchors an unknown expiry for the row the ORDER API wrote (it carries no request
 * timestamp: it was issued with the order). A COD row is `menunggu` until delivery and is never an
 * instruction — callers refuse COD before asking.
 */
export type InstructionState = "paid" | "failed" | "live" | "starting" | "unknown" | "expired";

export function instructionState(p: InstructionRow, placedAt: Date, now: Date): InstructionState {
  if (p.status === "berhasil") return "paid";
  if (p.status === "gagal") return "failed";
  const t = now.getTime();
  if (
    p.requestState === "in_progress" &&
    p.requestUpdatedAt &&
    t - p.requestUpdatedAt.getTime() < IN_PROGRESS_STALE_MS
  ) {
    return "starting";
  }
  if (p.expiresAt) return p.expiresAt.getTime() > t ? "live" : "expired";
  const anchor = (p.requestUpdatedAt ?? placedAt).getTime();
  return anchor + UNKNOWN_EXPIRY_BOUND_MS > t ? "unknown" : "expired";
}

/** Live or about to be: an order holding one of these must not be given a second bill, nor cancelled. */
export const blocksNewBill = (s: InstructionState) => s === "live" || s === "starting" || s === "unknown";
/** What the cron must wait for: a payable bill, or a request that may be minting one right now. */
export const blocksExpiry = (s: InstructionState) => s === "live" || s === "starting";

export type RetryRefusal =
  | "cod"
  | "order_closed"
  | "already_paid"
  | "still_live"
  | "in_progress"
  | "unknown_outcome"
  | "no_payment"
  | "order_expired"
  | "attempt_limit";

export type RetryDecision<P extends InstructionRow> =
  | { ok: true; from: P }
  | { ok: false; code: RetryRefusal; live?: P };

/**
 * May this order be given a NEW instruction right now? `payments` in attempt order (oldest first).
 *
 * Order of the checks is the order of the answers a shopper should read: a terminal order says so
 * before "already paid" (a paid-then-cancelled order is a refund, not a payment); money already in
 * beats every other state; then a bill that may still be payable; only then the soft limits.
 */
export function retryDecision<P extends InstructionRow>(
  order: { status: string; financialStatus: string; placedAt: Date },
  payments: P[],
  now: Date,
): RetryDecision<P> {
  if (payments.some((p) => p.method === "cod")) return { ok: false, code: "cod" };
  if (order.status === "batal" || order.status === "retur") return { ok: false, code: "order_closed" };
  const states = payments.map((p) => instructionState(p, order.placedAt, now));
  if (order.financialStatus === "dibayar" || states.includes("paid")) return { ok: false, code: "already_paid" };
  // The seller already moved it on (diproses/dikirim/selesai) — not ours to re-open from a public door.
  if (order.status !== "baru") return { ok: false, code: "order_closed" };
  const liveAt = states.indexOf("live");
  if (liveAt >= 0) return { ok: false, code: "still_live", live: payments[liveAt] };
  if (states.includes("starting")) return { ok: false, code: "in_progress" };
  if (states.includes("unknown")) return { ok: false, code: "unknown_outcome" };
  if (!payments.length) return { ok: false, code: "no_payment" };
  if (order.placedAt.getTime() + ORDER_TTL_MS - RETRY_CLOSE_MARGIN_MS <= now.getTime()) {
    return { ok: false, code: "order_expired" };
  }
  if (payments.length >= MAX_PAY_ATTEMPTS) return { ok: false, code: "attempt_limit" };
  return { ok: true, from: payments[payments.length - 1] };
}

/**
 * The provider reference for attempt `n` (1-based). Attempt 1 is the order number itself — what the
 * order API has always sent — and every later one appends `-n`, so the vendor never sees a reference
 * it already holds and the callback (`reff_id` match) resolves exactly one row. Order numbers are
 * globally unique and `n` is taken under the order's row lock, so the pair is too.
 */
export const retryReffId = (orderNumber: string, n: number) => (n <= 1 ? orderNumber : `${orderNumber}-${n}`);

// ── The shopper's secret ─────────────────────────────────────────────────────────────────────────
// An order NUMBER is printed on labels, quoted in chats and typed by the seller: it identifies, it
// never authorises. The token is 256 random bits handed to the checkout's browser once; only its
// sha256 is stored (`orders.pay_token_hash`), so a database read cannot replay it.

export const mintPayToken = () => randomBytes(32).toString("base64url");
export const hashPayToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

/** Constant-time. A missing hash (COD, pre-0118) or a malformed token is simply "no". */
export function payTokenMatches(token: unknown, storedHash: string | null | undefined): boolean {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  if (!storedHash || !/^[0-9a-f]{64}$/.test(storedHash)) return false;
  return timingSafeEqual(Buffer.from(hashPayToken(token), "hex"), Buffer.from(storedHash, "hex"));
}
