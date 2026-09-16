import { describe, expect, it } from "vitest";
import { BILLING } from "@tokophi/lib/billing";
import { periodBackedBy, subscriptionKpiBucket, type KpiRow } from "./subscription-kpi";

// The dashboard's MRR rule, table-tested (finance audit 2026-09-16, F3). Production read
// MRR ≈ Rp600.000 over 12 stores whose only "paid" period was a Super Admin comp; this file pins
// that a comp is never MRR and a payment always is — by recency, not by date arithmetic.
const NOW = new Date("2026-09-17T00:00:00Z");
const day = 86_400_000;
const base: KpiRow = {
  trialEndsAt: new Date(NOW.getTime() - 40 * day),
  currentPeriodEnd: new Date(NOW.getTime() + 20 * day),
  firstInvoicePaid: false,
  comped: false,
  suspendedAt: null,
  isDemo: false,
  lastPaidAt: null,
  lastCompAt: null,
};

describe("periodBackedBy — the newer of last paid / last comp wins", () => {
  it("none, paid, comp, and both directions of recency", () => {
    expect(periodBackedBy({ lastPaidAt: null, lastCompAt: null })).toBe("none");
    expect(periodBackedBy({ lastPaidAt: new Date(1), lastCompAt: null })).toBe("paid");
    expect(periodBackedBy({ lastPaidAt: null, lastCompAt: new Date(1) })).toBe("comp");
    expect(periodBackedBy({ lastPaidAt: new Date(2), lastCompAt: new Date(1) })).toBe("paid");
    expect(periodBackedBy({ lastPaidAt: new Date(1), lastCompAt: new Date(2) })).toBe("comp");
  });
});

describe("subscriptionKpiBucket", () => {
  it("a period backed by a PAID invoice is MRR — promo price first, regular after", () => {
    const v = subscriptionKpiBucket({ ...base, lastPaidAt: new Date(NOW.getTime() - 5 * day) }, NOW);
    expect(v).toEqual({ bucket: "paid", mrr: BILLING.FIRST_MONTH_IDR, trialEndingSoon: false });
    const regular = subscriptionKpiBucket({ ...base, firstInvoicePaid: true, lastPaidAt: new Date(NOW.getTime() - 5 * day) }, NOW);
    expect(regular.mrr).toBe(BILLING.MONTHLY_IDR);
  });

  // THE production shape: active on "Gratis 1 bulan", no payment ever.
  it("a period granted by a comp is `comped` and contributes Rp0 — never MRR", () => {
    const v = subscriptionKpiBucket({ ...base, lastCompAt: new Date(NOW.getTime() - 5 * day) }, NOW);
    expect(v).toEqual({ bucket: "comped", mrr: 0, trialEndingSoon: false });
  });

  it("an active period with nothing on record behind it is `comped` too (no payment is known)", () => {
    expect(subscriptionKpiBucket(base, NOW).bucket).toBe("comped");
  });

  it("recency decides: paid then comped → comped; comped then paid → paid", () => {
    expect(subscriptionKpiBucket({ ...base, lastPaidAt: new Date(NOW.getTime() - 40 * day), lastCompAt: new Date(NOW.getTime() - 5 * day) }, NOW).bucket).toBe("comped");
    expect(subscriptionKpiBucket({ ...base, lastPaidAt: new Date(NOW.getTime() - 5 * day), lastCompAt: new Date(NOW.getTime() - 40 * day) }, NOW).bucket).toBe("paid");
  });

  it("the demo store is its own bucket, excluded from money, whatever else is true of it", () => {
    const v = subscriptionKpiBucket({ ...base, isDemo: true, firstInvoicePaid: true, lastPaidAt: new Date(NOW.getTime() - day) }, NOW);
    expect(v).toEqual({ bucket: "demo", mrr: 0, trialEndingSoon: false });
  });

  it("operator suspension outranks VIP and payment; VIP is never MRR", () => {
    expect(subscriptionKpiBucket({ ...base, comped: true, suspendedAt: new Date(NOW.getTime() - day), lastPaidAt: new Date(NOW.getTime() - day) }, NOW).bucket).toBe("suspended");
    expect(subscriptionKpiBucket({ ...base, comped: true, lastPaidAt: new Date(NOW.getTime() - day) }, NOW)).toEqual({ bucket: "vip", mrr: 0, trialEndingSoon: false });
  });

  it("trial (with the ≤1 day flag), past-due and lapsed contribute nothing", () => {
    const trial: KpiRow = { ...base, currentPeriodEnd: null, trialEndsAt: new Date(NOW.getTime() + 0.5 * day) };
    expect(subscriptionKpiBucket(trial, NOW)).toEqual({ bucket: "trial", mrr: 0, trialEndingSoon: true });
    const pastDue: KpiRow = { ...base, currentPeriodEnd: new Date(NOW.getTime() - day), lastPaidAt: new Date(NOW.getTime() - 40 * day) };
    expect(subscriptionKpiBucket(pastDue, NOW).bucket).toBe("pastDue");
    const lapsed: KpiRow = { ...base, currentPeriodEnd: new Date(NOW.getTime() - 10 * day) };
    expect(subscriptionKpiBucket(lapsed, NOW).bucket).toBe("lapsed");
  });
});
