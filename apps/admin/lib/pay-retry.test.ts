import { describe, expect, it } from "vitest";
import { parseAlExpiry } from "@tokophi/lib/autolaris";
import {
  IN_PROGRESS_STALE_MS,
  MAX_PAY_ATTEMPTS,
  ORDER_TTL_MS,
  UNKNOWN_EXPIRY_BOUND_MS,
  hashPayToken,
  instructionState,
  mintPayToken,
  payTokenMatches,
  retryDecision,
  retryReffId,
  type InstructionRow,
} from "./pay-retry";

// PAY-RETRY — the pure rules. The DB-coupled claims (row lock, the callback's refund, the cron's
// wait) live in app/api/public/pay/retry/route.test.ts and pay/callback/route.retry.test.ts.

const NOW = new Date("2026-11-13T10:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const later = (ms: number) => new Date(NOW.getTime() + ms);
const H = 3600_000;

const row = (over: Partial<InstructionRow> = {}): InstructionRow => ({
  status: "menunggu",
  method: "qris",
  expiresAt: null,
  requestState: null,
  requestUpdatedAt: null,
  ...over,
});
const order = (over: Partial<{ status: string; financialStatus: string; placedAt: Date }> = {}) => ({
  status: "baru",
  financialStatus: "pending",
  placedAt: ago(3 * H),
  ...over,
});

describe("instructionState — is this bill still payable?", () => {
  it("reads the provider's expiry when we have it", () => {
    expect(instructionState(row({ expiresAt: later(1) }), ago(H), NOW)).toBe("live");
    expect(instructionState(row({ expiresAt: NOW }), ago(H), NOW)).toBe("expired");
  });

  it("an UNKNOWN expiry is presumed payable for the bound, from issue time — never guessed dead", () => {
    // The order API's own row: no request stamp, anchored on placed_at.
    expect(instructionState(row(), ago(UNKNOWN_EXPIRY_BOUND_MS - 1), NOW)).toBe("unknown");
    expect(instructionState(row(), ago(UNKNOWN_EXPIRY_BOUND_MS), NOW)).toBe("expired");
    // A retried/seller row: anchored on its own request stamp, not on the (older) order.
    expect(
      instructionState(row({ requestState: "failed", requestUpdatedAt: ago(H) }), ago(20 * H), NOW),
    ).toBe("unknown");
  });

  it("a request in flight blocks; a crashed one stops blocking after the stale window", () => {
    expect(instructionState(row({ requestState: "in_progress", requestUpdatedAt: ago(1000) }), ago(H), NOW)).toBe("starting");
    expect(
      instructionState(row({ requestState: "in_progress", requestUpdatedAt: ago(IN_PROGRESS_STALE_MS) }), ago(H), NOW),
    ).toBe("unknown");
  });

  it("paid and failed are what they say", () => {
    expect(instructionState(row({ status: "berhasil", expiresAt: ago(H) }), ago(H), NOW)).toBe("paid");
    expect(instructionState(row({ status: "gagal", expiresAt: later(H) }), ago(H), NOW)).toBe("failed");
  });
});

describe("retryDecision — the case table", () => {
  const expired = row({ expiresAt: ago(1000) });

  it("expired → a new bill, built from the LATEST attempt", () => {
    const a = row({ status: "gagal" });
    const b = { ...expired, channelCode: "QRIS" };
    const d = retryDecision(order(), [a, b], NOW);
    expect(d).toEqual({ ok: true, from: b });
  });

  it("failed (gateway refused) → a new bill", () => {
    expect(retryDecision(order(), [row({ status: "gagal" })], NOW).ok).toBe(true);
  });

  it("refusals, in the order a shopper should read them", () => {
    const code = (o: ReturnType<typeof order>, p: InstructionRow[]) => {
      const d = retryDecision(o, p, NOW);
      return d.ok ? "ok" : d.code;
    };
    expect(code(order(), [row({ method: "cod" })])).toBe("cod");
    expect(code(order({ status: "batal" }), [row({ status: "berhasil" })])).toBe("order_closed");
    expect(code(order({ status: "retur" }), [expired])).toBe("order_closed");
    expect(code(order(), [expired, row({ status: "berhasil" })])).toBe("already_paid");
    expect(code(order({ financialStatus: "dibayar" }), [expired])).toBe("already_paid");
    expect(code(order({ status: "diproses" }), [expired])).toBe("order_closed");
    expect(code(order(), [expired, row({ expiresAt: later(H) })])).toBe("still_live");
    expect(code(order(), [row({ requestState: "in_progress", requestUpdatedAt: ago(1) })])).toBe("in_progress");
    expect(code(order(), [row()])).toBe("unknown_outcome");
    expect(code(order(), [])).toBe("no_payment");
    expect(code(order({ placedAt: ago(ORDER_TTL_MS - 60_000) }), [expired])).toBe("order_expired");
    expect(code(order(), Array.from({ length: MAX_PAY_ATTEMPTS }, () => expired))).toBe("attempt_limit");
  });

  it("still_live hands back THE live row (a double tap re-shows it, never mints a second)", () => {
    const live = row({ expiresAt: later(H) });
    expect(retryDecision(order(), [expired, live], NOW)).toEqual({ ok: false, code: "still_live", live });
  });
});

describe("retryReffId — one provider reference per attempt", () => {
  it("attempt 1 is the order number the order API always sent; later ones are suffixed", () => {
    expect(retryReffId("PHI-555925447U5H", 1)).toBe("PHI-555925447U5H");
    expect(retryReffId("PHI-555925447U5H", 2)).toBe("PHI-555925447U5H-2");
    // Inside the vendor's 30-character reff_id cap (autolaris-submit.test.ts) at the attempt ceiling.
    expect(retryReffId("PHI-555925447U5H", MAX_PAY_ATTEMPTS).length).toBeLessThanOrEqual(30);
  });
});

describe("the shopper's token", () => {
  it("matches only its own hash, and refuses shapes that are not a minted token", () => {
    const t = mintPayToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const h = hashPayToken(t);
    expect(payTokenMatches(t, h)).toBe(true);
    expect(payTokenMatches(mintPayToken(), h)).toBe(false);
    expect(payTokenMatches(t, null)).toBe(false); // COD / pre-0117 order
    expect(payTokenMatches("PHI-555925447U5H", h)).toBe(false); // an order number is not a key
    expect(payTokenMatches(undefined, h)).toBe(false);
    expect(payTokenMatches(h, h)).toBe(false); // the stored hash itself does not open the door
  });
});

describe("parseAlExpiry — the vendor's zoneless wall clock is WIB", () => {
  it("reads the /submit shape as +07:00", () => {
    expect(parseAlExpiry("2026-07-23 14:09:05")?.toISOString()).toBe("2026-07-23T07:09:05.000Z");
    // The production test order: created 14:45 WIB, "Bayar sebelum 16.45 WIB".
    expect(parseAlExpiry("2026-11-13 16:45:00")?.toISOString()).toBe("2026-11-13T09:45:00.000Z");
  });
  it("reads the compact create_payment shape, and a string that carries its own zone", () => {
    expect(parseAlExpiry("20260818235959")?.toISOString()).toBe("2026-08-18T16:59:59.000Z");
    expect(parseAlExpiry("2026-08-18T23:59:59+07:00")?.toISOString()).toBe("2026-08-18T16:59:59.000Z");
  });
  it("anything else is unknown — never a guess", () => {
    for (const bad of ["", "besok", "2026-02-31 10:00:00", "13/11/2026 16:45", null, 1763030700]) {
      expect(parseAlExpiry(bad)).toBeNull();
    }
  });
});
