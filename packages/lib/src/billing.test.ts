import { describe, it, expect } from "vitest";
import { BILLING, withPpn, baseFromTotal, quote, codeDiscountFor, storeSegment, computeBilling, type StoreBillingRow, subscriptionCharge } from "./billing";

// The subscription money math. Plan prices are the DPP (ex-tax); the merchant pays base + 11% PPN, and
// invoices store the PPN-inclusive total — so withPpn/baseFromTotal must round-trip. quote() encodes
// the single price (ADR 0020), the owed code discount and the annual bonus month; computeBilling() is the trial → active →
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

// ADR 0020 (owner 2026-11-13): Rp178.500/month, annual = monthly × 12 − 20%, NO first-month promo,
// trial stays 3 days, and a signup code may take a fixed amount off the FIRST PAID invoice only.
describe("ADR 0020 — the price list is the owner's numbers, and annual IS the formula", () => {
  it("pins every figure the owner named", () => {
    expect(BILLING.TRIAL_DAYS).toBe(3);
    expect(BILLING.MONTHLY_IDR).toBe(178_500);
    expect(BILLING.ANNUAL_IDR).toBe(1_713_600);
    expect(BILLING.ANNUAL_MONTHLY_IDR).toBe(142_800);
    expect(BILLING.SIGNUP_CODE_DISCOUNT_DEFAULT_IDR).toBe(100_000);
    expect("FIRST_MONTH_IDR" in BILLING).toBe(false); // the promo is gone, not merely unused
  });
  it("annual = monthly × 12 × (1 − 20%), and per-month × 12 = annual (no rounding drift)", () => {
    expect(BILLING.ANNUAL_IDR).toBe((BILLING.MONTHLY_IDR * 12 * (100 - BILLING.ANNUAL_DISCOUNT_PCT)) / 100);
    expect(BILLING.ANNUAL_MONTHLY_IDR * 12).toBe(BILLING.ANNUAL_IDR);
  });
});

describe("quote — one price + annual bonus month + an OWED code discount", () => {
  it("monthly: Rp178.500 whether or not anything was paid before (no promo)", () => {
    expect(quote("monthly", false)).toMatchObject({ amount: 178_500, listAmount: 178_500, codeDiscountIdr: 0, months: 1, bonusMonth: false });
    expect(quote("monthly", true)).toMatchObject({ amount: 178_500, months: 1 });
  });

  it("annual: first-time (from trial) grants 13 months; afterwards 12 — same Rp1.713.600", () => {
    expect(quote("annual", false)).toMatchObject({ amount: 1_713_600, months: 13, bonusMonth: true });
    expect(quote("annual", true)).toMatchObject({ amount: 1_713_600, months: 12, bonusMonth: false });
  });

  it("an owed Rp100.000 code discount: monthly 78.500, annual 1.613.600 (bonus month kept)", () => {
    expect(quote("monthly", false, 100_000)).toMatchObject({ listAmount: 178_500, codeDiscountIdr: 100_000, amount: 78_500 });
    expect(quote("annual", false, 100_000)).toMatchObject({ listAmount: 1_713_600, codeDiscountIdr: 100_000, amount: 1_613_600, months: 13 });
  });

  it("a discount is clamped to the price and never negative", () => {
    expect(quote("monthly", false, 999_999).amount).toBe(0); // the creator refuses a Rp0 bill
    expect(quote("monthly", false, -5).amount).toBe(178_500);
    expect(quote("monthly", false, Number.NaN).amount).toBe(178_500);
  });
});

describe("codeDiscountFor — the ONE rule for 'is the code discount still owed?'", () => {
  const fresh = { codeDiscountIdr: 100_000, firstInvoicePaid: false, hasPaidSubscription: false };
  it("owed to a never-paid store whose code carries a discount", () => {
    expect(codeDiscountFor(fresh)).toBe(100_000);
  });
  it("no code / a provider-only code (0) → 0", () => {
    expect(codeDiscountFor({ ...fresh, codeDiscountIdr: null })).toBe(0);
    expect(codeDiscountFor({ ...fresh, codeDiscountIdr: 0 })).toBe(0);
  });
  it("never twice: gone once the callback flagged a payment OR any subscription invoice is dibayar", () => {
    expect(codeDiscountFor({ ...fresh, firstInvoicePaid: true })).toBe(0);
    expect(codeDiscountFor({ ...fresh, hasPaidSubscription: true })).toBe(0); // manual "Lunas" flip
  });
  it("VIP is never billed, so owes nothing", () => {
    expect(codeDiscountFor({ ...fresh, comped: true })).toBe(0);
  });
});

describe("storeSegment — the 4 lifecycle buckets", () => {
  it("comped → vip regardless of everything else", () => {
    expect(storeSegment({ trialEndsAt: null, currentPeriodEnd: null, firstInvoicePaid: true, comped: true, suspendedAt: null }, NOW)).toBe("vip");
  });
  it("in trial → trial", () => {
    expect(storeSegment({ trialEndsAt: future(2), currentPeriodEnd: null, firstInvoicePaid: false, suspendedAt: null }, NOW)).toBe("trial");
  });
  it("paid once → regular; not yet → first_invoice (ADR 0020: was first_month, same predicate)", () => {
    expect(storeSegment({ trialEndsAt: null, currentPeriodEnd: future(20), firstInvoicePaid: true, suspendedAt: null }, NOW)).toBe("regular");
    expect(storeSegment({ trialEndsAt: null, currentPeriodEnd: future(20), firstInvoicePaid: false, suspendedAt: null }, NOW)).toBe("first_invoice");
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
    expect(s.nextAmount).toBe(178_500); // ADR 0020 regular price
  });

  it("in the free trial (never paid), no code → trial, the NORMAL price next (no promo)", () => {
    const s = computeBilling(base({ trialEndsAt: future(2) }), NOW);
    expect(s.status).toBe("trial");
    expect(s.readOnly).toBe(false);
    expect(s.codeDiscountIdr).toBe(0);
    expect(s.nextAmount).toBe(178_500);
  });

  it("in the trial with an owed code discount → the discounted first invoice next", () => {
    const s = computeBilling(base({ trialEndsAt: future(2), codeDiscountIdr: 100_000 }), NOW);
    expect(s.nextAmount).toBe(78_500);
    expect(s.codeDiscountIdr).toBe(100_000);
  });

  it("a caller that passes a discount for an ALREADY-paid store is ignored (belt over codeDiscountFor)", () => {
    const s = computeBilling(base({ currentPeriodEnd: future(10), firstInvoicePaid: true, codeDiscountIdr: 100_000 }), NOW);
    expect(s.nextAmount).toBe(178_500);
    expect(s.codeDiscountIdr).toBe(0);
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
  it("ADR 0020 truth table — PPN applies to the (discounted) DPP", () => {
    expect(subscriptionCharge(quote("monthly", false).amount, true)).toEqual({ total: 198_135, taxIdr: 19_635 });
    expect(subscriptionCharge(quote("annual", false).amount, true)).toEqual({ total: 1_902_096, taxIdr: 188_496 });
    expect(subscriptionCharge(quote("monthly", false, 100_000).amount, true)).toEqual({ total: 87_135, taxIdr: 8_635 });
    expect(subscriptionCharge(quote("annual", false, 100_000).amount, true)).toEqual({ total: 1_791_096, taxIdr: 177_496 });
    expect(subscriptionCharge(quote("monthly", false, 100_000).amount, false)).toEqual({ total: 78_500, taxIdr: 0 });
  });
});
