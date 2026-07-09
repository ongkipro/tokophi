// Single-plan subscription (all features). Shopify-style:
//   monthly: 3-day free trial → Rp50rb first month (promo) → Rp275rb/month
//   annual : Rp225rb/month billed yearly = Rp2.700.000; paying annually straight after the trial
//            (first time) grants a bonus month → 13 months for the price of 12.
// Recurring via VA invoice; 3-day grace past due → read-only.
export const BILLING = {
  PLAN_NAME: "TokoΦ",
  TRIAL_DAYS: 3,
  FIRST_MONTH_IDR: 50_000,
  MONTHLY_IDR: 275_000,
  ANNUAL_MONTHLY_IDR: 225_000, // effective per-month when paying yearly
  ANNUAL_IDR: 2_700_000, // 225k × 12
  GRACE_DAYS: 3,
} as const;

export type Cycle = "monthly" | "annual";
export type Quote = { cycle: Cycle; amount: number; months: number; perMonth: number; bonusMonth: boolean; label: string };

// What a merchant pays + how long it covers, for a chosen cycle given their history.
export function quote(cycle: Cycle, firstInvoicePaid: boolean): Quote {
  if (cycle === "annual") {
    const bonusMonth = !firstInvoicePaid; // first-time annual (from trial) → +1 free month
    return { cycle, amount: BILLING.ANNUAL_IDR, months: bonusMonth ? 13 : 12, perMonth: BILLING.ANNUAL_MONTHLY_IDR, bonusMonth, label: "Tahunan" };
  }
  const amount = firstInvoicePaid ? BILLING.MONTHLY_IDR : BILLING.FIRST_MONTH_IDR;
  return { cycle, amount, months: 1, perMonth: amount, bonusMonth: false, label: "Bulanan" };
}

// Add N calendar months to a base date (keeps day-of-month; safe for period extension).
export function addMonths(base: Date, months: number): Date {
  const d = new Date(base.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
}

export type BillingStatus = "trial" | "active" | "past_due" | "suspended";
export type BillingState = {
  status: BillingStatus;
  label: string;
  daysLeft: number; // days left in trial / current period / grace
  nextAmount: number; // IDR the merchant pays next (monthly)
  isPromo: boolean; // next payment is the Rp50rb first-month promo
  dueDate: Date | null; // when the next payment is due
  readOnly: boolean; // grace exceeded → block writes (storefront stays up)
  firstInvoicePaid: boolean; // false = still on promo / annual-bonus eligible
};

export type StoreBillingRow = {
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  firstInvoicePaid: boolean;
};

const dayMs = 86_400_000;
const ceilDays = (ms: number) => Math.max(0, Math.ceil(ms / dayMs));

export function computeBilling(s: StoreBillingRow, now: Date = new Date()): BillingState {
  const isPromo = !s.firstInvoicePaid;
  const nextAmount = isPromo ? BILLING.FIRST_MONTH_IDR : BILLING.MONTHLY_IDR;

  // 1) inside a paid period → active
  if (s.currentPeriodEnd && now < s.currentPeriodEnd) {
    return { status: "active", label: "Aktif", daysLeft: ceilDays(s.currentPeriodEnd.getTime() - now.getTime()), nextAmount, isPromo, dueDate: s.currentPeriodEnd, readOnly: false, firstInvoicePaid: s.firstInvoicePaid };
  }
  // 2) inside the free trial (never paid) → trial
  if (!s.currentPeriodEnd && s.trialEndsAt && now < s.trialEndsAt) {
    return { status: "trial", label: "Masa uji coba", daysLeft: ceilDays(s.trialEndsAt.getTime() - now.getTime()), nextAmount: BILLING.FIRST_MONTH_IDR, isPromo: true, dueDate: s.trialEndsAt, readOnly: false, firstInvoicePaid: s.firstInvoicePaid };
  }
  // 3) overdue — 3-day grace (still full access), then suspended (read-only)
  const dueBase = s.currentPeriodEnd ?? s.trialEndsAt ?? now;
  const graceEnd = new Date(dueBase.getTime() + BILLING.GRACE_DAYS * dayMs);
  if (now < graceEnd) {
    return { status: "past_due", label: "Menunggu pembayaran", daysLeft: ceilDays(graceEnd.getTime() - now.getTime()), nextAmount, isPromo, dueDate: dueBase, readOnly: false, firstInvoicePaid: s.firstInvoicePaid };
  }
  return { status: "suspended", label: "Ditangguhkan", daysLeft: 0, nextAmount, isPromo, dueDate: dueBase, readOnly: true, firstInvoicePaid: s.firstInvoicePaid };
}
