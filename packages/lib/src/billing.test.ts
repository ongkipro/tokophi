import { describe, it, expect } from "vitest";
import { BILLING, withPpn, baseFromTotal, quote, storeSegment, computeBilling, type StoreBillingRow, subscriptionCharge } from "./billing";

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
    expect(storeSegment({ trialEndsAt: null, currentPeriodEnd: null, firstInvoicePaid: true, comped: true, suspendedAt: null }, NOW)).toBe("vip");
  });
  it("in trial → trial", () => {
    expect(storeSegment({ trialEndsAt: future(2), currentPeriodEnd: null, firstInvoicePaid: false, suspendedAt: null }, NOW)).toBe("trial");
  });
  it("paid once → regular; not yet → first_month", () => {
    expect(storeSegment({ trialEndsAt: null, currentPeriodEnd: future(20), firstInvoicePaid: true, suspendedAt: null }, NOW)).toBe("regular");
    expect(storeSegment({ trialEndsAt: null, currentPeriodEnd: future(20), firstInvoicePaid: false, suspendedAt: null }, NOW)).toBe("first_month");
  });
});

describe("computeBilling — trial → active → past_due → suspended, and VIP", () => {
  const base = (o: Partial<StoreBillingRow>): StoreBillingRow => ({ trialEndsAt: null, currentPeriodEnd: null, firstInvoicePaid: false, suspendedAt: null, ...o });

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

// 🔴 THE ONE THAT PINS THE BUG. Super Admin's "Tangguhkan" wrote `stores.status` + an audit row and
// changed nothing a merchant could feel, because THIS function — the one `requireCapability` asks
// before allowing a write — never looked at that column. It is not enough that a column exists: an
// operator suspension has to survive `computeBilling`, over every billing state including the ones
// that would otherwise return `active`, or the button is decorative again.
describe("operator suspension survives computeBilling", () => {
  const base = (o: Partial<StoreBillingRow>): StoreBillingRow => ({ trialEndsAt: null, currentPeriodEnd: null, firstInvoicePaid: false, suspendedAt: null, ...o });
  const SUSPENDED = { suspendedAt: past(1), suspendedReason: "dugaan barang palsu" };

  it("a PAID-UP store an operator suspended is suspended and read-only", () => {
    const s = computeBilling(base({ currentPeriodEnd: future(20), firstInvoicePaid: true, ...SUSPENDED }), NOW);
    expect(s.status).toBe("suspended");
    expect(s.readOnly).toBe(true);
    expect(s.operatorSuspended).toBe(true);
    expect(s.suspendedReason).toBe("dugaan barang palsu");
  });

  it("PAYING does not lift it — the subscription runs on underneath, untouched", () => {
    const s = computeBilling(base({ currentPeriodEnd: future(20), firstInvoicePaid: true, ...SUSPENDED }), NOW);
    // The store IS inside a paid period: billing says active, the effective state says suspended.
    // That is the whole design — one column would have had to choose, and billing always won.
    expect(s.billingStatus).toBe("active");
    expect(s.status).toBe("suspended");
  });

  it("VIP is a billing bypass, NOT an abuse shield", () => {
    const s = computeBilling(base({ comped: true, firstInvoicePaid: true, ...SUSPENDED }), NOW);
    expect(s.status).toBe("suspended");
    expect(s.readOnly).toBe(true);
    expect(s.comped).toBe(true); // still comped — we just refuse to let that unlock the panel
  });

  it("a store in its TRIAL can be suspended, and stays in the trial segment", () => {
    const row = base({ trialEndsAt: future(2), ...SUSPENDED });
    expect(computeBilling(row, NOW).status).toBe("suspended");
    expect(computeBilling(row, NOW).billingStatus).toBe("trial");
    expect(storeSegment(row, NOW)).toBe("trial"); // lockout ≠ moving them off the promo
  });

  it("lifting it restores the BILLING state, and only that", () => {
    // unpaid past the grace → still suspended after lifting, for the other reason
    const unpaid = computeBilling(base({ currentPeriodEnd: past(BILLING.GRACE_DAYS + 1), firstInvoicePaid: true }), NOW);
    expect(unpaid.status).toBe("suspended");
    expect(unpaid.operatorSuspended).toBe(false); // …and it is NOT ours, so "Cabut penangguhan" must not claim it fixed anything
    // paid-up → back to active the moment the operator's fact is removed
    const paid = computeBilling(base({ currentPeriodEnd: future(20), firstInvoicePaid: true }), NOW);
    expect(paid.status).toBe("active");
    expect(paid.readOnly).toBe(false);
  });

  it("the DEBT is still visible while locked, so the cron can still bill and the merchant can still pay", () => {
    const s = computeBilling(base({ currentPeriodEnd: past(BILLING.GRACE_DAYS + 1), firstInvoicePaid: true, ...SUSPENDED }), NOW);
    expect(s.billingStatus).toBe("suspended"); // overdue on its own account
    expect(s.nextAmount).toBe(BILLING.MONTHLY_IDR);
    expect(s.dueDate).not.toBeNull();
  });
});

// 🟠 THE SIGNUP QUEUE AND A PUNISHMENT SHARE ONE COLUMN (0090), and they must not share one word.
//
// Self-serve signup creates a store LOCKED, because nothing on the password path proves the person
// controls the email they typed. So `operatorSuspended` is true for a merchant who has done nothing
// at all — and the merchant banner, the sidebar badge and the operator's store list all read that
// flag. Without `pendingApproval` beside it, the first thing a new merchant sees after handing over
// their details is "Toko ditangguhkan oleh TokoΦ".
//
// The direction of the default is the load-bearing part: `approvedAt` is OPTIONAL on the row, and an
// ABSENT value must read as APPROVED. A read site that forgets to select the column then merely
// mislabels a queued store as suspended (rude); the opposite default would tell a merchant we
// suspended for cause that they are simply waiting on us (a lie, and it hides a real penalty).
describe("pending approval is distinguishable from a suspension for cause", () => {
  const base = (o: Partial<StoreBillingRow>): StoreBillingRow => ({ trialEndsAt: null, currentPeriodEnd: null, firstInvoicePaid: false, suspendedAt: null, ...o });
  const LOCKED = { suspendedAt: past(1), suspendedReason: "Menunggu persetujuan tim TokoΦ" };

  it("locked + never approved = the signup queue, with its own label", () => {
    const s = computeBilling(base({ trialEndsAt: future(3), ...LOCKED, approvedAt: null }), NOW);
    expect(s.pendingApproval).toBe(true);
    expect(s.label).toBe("Menunggu persetujuan");
    // It is still a real lock: writes are refused exactly as they are for a punished store.
    expect(s.status).toBe("suspended");
    expect(s.readOnly).toBe(true);
    // …and the subscription runs underneath, so the 3-day trial is not consumed by a billing state.
    expect(s.billingStatus).toBe("trial");
  });

  it("locked AFTER approval is a punishment, and keeps the punishing words", () => {
    const s = computeBilling(base({ currentPeriodEnd: future(20), firstInvoicePaid: true, suspendedAt: past(1), suspendedReason: "dugaan barang palsu", approvedAt: past(30) }), NOW);
    expect(s.pendingApproval).toBe(false);
    expect(s.label).toBe("Ditangguhkan oleh platform");
    expect(s.suspendedReason).toBe("dugaan barang palsu");
  });

  it("an UNSELECTED approvedAt reads as approved, never as queued", () => {
    // The row every existing read site builds today — no `approvedAt` key at all.
    const s = computeBilling(base({ currentPeriodEnd: future(20), firstInvoicePaid: true, suspendedAt: past(1), suspendedReason: "dugaan barang palsu" }), NOW);
    expect(s.pendingApproval).toBe(false);
    expect(s.label).toBe("Ditangguhkan oleh platform");
  });

  it("a store that is NOT locked is never in the queue, approved or not", () => {
    // `approved_at` is backfilled to `created_at` for every store that already existed, but a NULL
    // on a live store must not put it into a queue it never entered.
    const s = computeBilling(base({ trialEndsAt: future(2), approvedAt: null }), NOW);
    expect(s.pendingApproval).toBe(false);
    expect(s.status).toBe("trial");
    expect(s.readOnly).toBe(false);
  });
});

// Platform subscription-PPN toggle (owner ruling 2026-08-24): OFF at launch = flat DPP, no tax row;
// ON = the historical base + PPN 11%. Both numbers are stored on the invoice, never re-derived.
describe("subscriptionCharge", () => {
  it("OFF bills the flat DPP with zero tax", () => {
    expect(subscriptionCharge(275_000, false)).toEqual({ total: 275_000, taxIdr: 0 });
    expect(subscriptionCharge(50_000, false)).toEqual({ total: 50_000, taxIdr: 0 });
  });
  it("ON bills base + PPN 11% and reports the tax it added", () => {
    expect(subscriptionCharge(275_000, true)).toEqual({ total: 305_250, taxIdr: 30_250 });
    expect(subscriptionCharge(2_700_000, true)).toEqual({ total: 2_997_000, taxIdr: 297_000 });
  });
});
