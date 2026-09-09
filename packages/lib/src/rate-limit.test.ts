import { describe, it, expect } from "vitest";
import { bump, decide, bucketOf, onBackendFailure, type Window } from "./rate-limit";

// The DECISION half of the limiter, as a table.
//
// It had no test of its own for as long as it existed, because it was three lines inside a Map and
// the only way to make a claim about it was to hammer the Map and read the answer back. Everything
// here is a rule the endpoint quotas depend on: whether the Nth call is the one that is refused,
// whether a window that has expired starts a fresh one rather than continuing the old, and which
// buckets are allowed to fail closed.

describe("decide — the count INCLUDES the call being judged", () => {
  const w = (count: number, windowStart = 1_000): Window => ({ count, windowStart });

  // limit 3, window 60s, judged at t=1_000 (i.e. the window has just opened).
  const table: Array<[Window, boolean, number, number]> = [
    // window,   ok,    remaining, retryAfterMs
    [w(1), true, 2, 0],
    [w(2), true, 1, 0],
    [w(3), true, 0, 0], // the 3rd hit REACHES the limit — 15/min means 15 are served
    [w(4), false, 0, 60_000], // the 4th exceeds it
    [w(400), false, 0, 60_000],
  ];

  for (const [win, ok, remaining, retryAfterMs] of table) {
    it(`count ${win.count} → ok=${ok}, remaining=${remaining}, retryAfter=${retryAfterMs}`, () => {
      expect(decide(win, 3, 60_000, 1_000)).toEqual({ ok, remaining, retryAfterMs });
    });
  }

  it("retryAfterMs counts down to the window's end, never past it", () => {
    expect(decide(w(9), 3, 60_000, 1_000 + 45_000).retryAfterMs).toBe(15_000);
    expect(decide(w(9), 3, 60_000, 1_000 + 59_999).retryAfterMs).toBe(1);
  });

  it("an EXPIRED window is not a refusal, however big its count", () => {
    // The exact shape a stale row from the shared store arrives in: 900 hits, but from an hour ago.
    expect(decide(w(900), 3, 60_000, 1_000 + 60_000)).toEqual({ ok: true, remaining: 2, retryAfterMs: 0 });
  });
});

describe("bump — a window rolls, it does not accumulate forever", () => {
  it("first sighting opens a window at `now`", () => {
    expect(bump(undefined, 60_000, 5_000)).toEqual({ count: 1, windowStart: 5_000 });
  });

  it("inside the window it increments and keeps the ORIGINAL start", () => {
    expect(bump({ count: 4, windowStart: 5_000 }, 60_000, 20_000)).toEqual({ count: 5, windowStart: 5_000 });
  });

  it("at the boundary it starts over — 60_000ms after the start is a NEW window, not the last ms of the old", () => {
    expect(bump({ count: 400, windowStart: 5_000 }, 60_000, 65_000)).toEqual({ count: 1, windowStart: 65_000 });
    expect(bump({ count: 400, windowStart: 5_000 }, 60_000, 64_999)).toEqual({ count: 401, windowStart: 5_000 });
  });
});

describe("bucketOf — the key's first segment decides the policy", () => {
  const cases: Array<[string, string]> = [
    ["login:admin:1.2.3.4", "login"],
    ["login:platform:1.2.3.4", "login"],
    ["signup:admin:1.2.3.4", "signup"],
    ["order:1.2.3.4", "order"],
    ["ongkir:1.2.3.4", "ongkir"],
    ["promo:1.2.3.4", "promo"],
    ["paycb:1.2.3.4", "paycb"],
    ["chat:send:ip:1.2.3.4", "chat"],
    ["tracking-retry:some-uuid", "tracking-retry"],
    ["loginfail:seller:a@b.co", "loginfail"],
    ["nocolon", "nocolon"],
  ];
  for (const [key, bucket] of cases) it(`${key} → ${bucket}`, () => expect(bucketOf(key)).toBe(bucket));
});

// ── THE LIST THAT DECIDES WHO GOES DARK WHEN POSTGRES DOES ──────────────────────────────────────
// Widening this is a security decision (a login that fails open is not a login gate) and narrowing it
// is an availability decision (an order endpoint that fails closed refuses real sales for a fault
// that is ours). Either direction has to break a test, or it will happen by accident.
describe("onBackendFailure — the strict list, pinned in both directions", () => {
  const closed = ["login:admin:1.2.3.4", "login:platform:9.9.9.9", "signup:admin:1.2.3.4"];
  const open = [
    "order:1.2.3.4", // refusing this costs a real shopper a real sale
    "ongkir:1.2.3.4",
    "promo:1.2.3.4",
    "paycb:1.2.3.4", // a refused callback leaves a PAID order stuck at `menunggu`
    "chat:send:ip:1.2.3.4",
    "chat:poll:ip:1.2.3.4",
    "tracking-retry:store",
    "tracking-test:store:meta",
    "track:1.2.3.4",
    "checkout:1.2.3.4",
    // The per-account failed-login streak. NOT strict on purpose: a broken counter must never be
    // able to LOCK a merchant out of their own panel.
    "loginfail:seller:a@b.co",
  ];

  for (const k of closed) it(`${k} fails CLOSED`, () => expect(onBackendFailure(k)).toBe("closed"));
  for (const k of open) it(`${k} fails OPEN`, () => expect(onBackendFailure(k)).toBe("open"));

  it("an unknown bucket is OPEN — a gate added later must not be able to invent an outage", () => {
    expect(onBackendFailure("something-new:subject")).toBe("open");
  });
});
