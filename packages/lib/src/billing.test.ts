import { describe, it, expect } from "vitest";
import { BILLING, withPpn, baseFromTotal, quote, storeSegment, computeBilling, type StoreBillingRow } from "./billing";

// The subscription money math. Plan prices are the DPP (ex-tax); the merchant pays base + 11% PPN, and
// invoices store the PPN-inclusive total — so withPpn/baseFromTotal must round-trip. quote() encodes
// the promo (Rp50rb first month) and the annual bonus month; computeBilling() is the trial → active →
// past_due → suspended lifecycle that decides whether the shop is read-only. These are the numbers on
// real invoices — they must be exercised, not eyeballed.

const day = 86_400_000;
// A fixed clock — never `new Date()` in a test (nondeterministic; the same trap as in the render paths).
const NOW = new Date("2026-07-15T00:00:00.000Z");
const future = (days: number) => new Date(NOW.getTime() + days * day);
const past = (days: number) => new Date(NOW.getTime() - days * day);

describe("PPN — base + 11% round-trips with the stored total", () => {
  it("withPpn adds 11% and reports the split", () => {
    const b = withPpn(275_000);
    expect(b.base).toBe(275_000);
    expect(b.total).toBe(305_250); // round(275000 * 1.11)
    expect(b.ppn).toBe(30_250);
    expect(b.base + b.ppn).toBe(b.total);
  });

  it("baseFromTotal recovers the base from a PPN-inclusive total", () => {
    const b = baseFromTotal(305_250);
    expect(b.base).toBe(275_000);
    expect(b.ppn).toBe(30_250);
    expect(b.total).toBe(305_250);
  });

  it("PPN rate is 11%", () => {
    expect(BILLING.PPN_RATE).toBe(0.11);
  });
});

describe("quote — promo first month + annual bonus month", () => {
  it("monthly: Rp50rb the first time, Rp275rb after", () => {
    expect(quote("monthly", false)).toMatchObject({ amount: 50_000, months: 1, bonusMonth: false });
    expect(quote("monthly", true)).toMatchObject({ amount: 275_000, months: 1 });
  });

  it("annual: first-time (from trial) grants 13 months; afterwards 12", () => {
    expect(quote("annual", false)).toMatchObject({ amount: 2_700_000, months: 13, bonusMonth: true });
    expect(quote("annual", true)).toMatchObject({ amount: 2_700_000, months: 12, bonusMonth: false });
  });
});

describe("storeSegment — the 4 lifecycle buckets", () => {
  it("comped → vip regardless of everything else", () => {
    expect(storeSegment({ trialEndsAt: null, currentPeriodEnd: null, firstInvoicePaid: true, comped: true }, NOW)).toBe("vip");
  });
  it("in trial → trial", () => {
    expect(storeSegment({ trialEndsAt: future(2), currentPeriodEnd: null, firstInvoicePaid: false }, NOW)).toBe("trial");
  });
  it("paid once → regular; not yet → first_month", () => {
    expect(storeSegment({ trialEndsAt: null, currentPeriodEnd: future(20), firstInvoicePaid: true }, NOW)).toBe("regular");
    expect(storeSegment({ trialEndsAt: null, currentPeriodEnd: future(20), firstInvoicePaid: false }, NOW)).toBe("first_month");
  });
});

describe("computeBilling — trial → active → past_due → suspended, and VIP", () => {
  const base = (o: Partial<StoreBillingRow>): StoreBillingRow => ({ trialEndsAt: null, currentPeriodEnd: null, firstInvoicePaid: false, ...o });

  it("comped/VIP → active, never read-only, nothing due", () => {
    const s = computeBilling(base({ comped: true, firstInvoicePaid: true }), NOW);
    expect(s.status).toBe("active");
    expect(s.readOnly).toBe(false);
    expect(s.nextAmount).toBe(0);
    expect(s.comped).toBe(true);
  });

  it("inside a paid period → active, full access", () => {
    const s = computeBilling(base({ currentPeriodEnd: future(10), firstInvoicePaid: true }), NOW);
    expect(s.status).toBe("active");
    expect(s.readOnly).toBe(false);
    expect(s.daysLeft).toBe(10);
    expect(s.nextAmount).toBe(275_000); // already paid once → regular price next
  });

  it("in the free trial (never paid) → trial, promo price next", () => {
    const s = computeBilling(base({ trialEndsAt: future(2) }), NOW);
    expect(s.status).toBe("trial");
    expect(s.readOnly).toBe(false);
    expect(s.isPromo).toBe(true);
    expect(s.nextAmount).toBe(50_000);
  });

  it("overdue but within the 3-day grace → past_due, STILL full access", () => {
    const s = computeBilling(base({ currentPeriodEnd: past(1), firstInvoicePaid: true }), NOW);
    expect(s.status).toBe("past_due");
    expect(s.readOnly).toBe(false); // grace: the storefront stays up and writable
  });

  it("past the grace → suspended, read-only", () => {
    const s = computeBilling(base({ currentPeriodEnd: past(BILLING.GRACE_DAYS + 1), firstInvoicePaid: true }), NOW);
    expect(s.status).toBe("suspended");
    expect(s.readOnly).toBe(true);
  });
});
