// Single-plan subscription (all features): 3-day free trial → Rp50rb first paid month →
// Rp275rb/month. Recurring via monthly VA invoice; 3-day grace past due → read-only.
export const BILLING = {
  PLAN_NAME: "TokoΦ",
  TRIAL_DAYS: 3,
  FIRST_MONTH_IDR: 50_000,
  MONTHLY_IDR: 275_000,
  GRACE_DAYS: 3,
} as const;

export type BillingStatus = "trial" | "active" | "past_due" | "suspended";
export type BillingState = {
  status: BillingStatus;
  label: string;
  daysLeft: number; // days left in trial / current period / grace
  nextAmount: number; // IDR the merchant pays next
  isPromo: boolean; // next payment is the Rp50rb first-month promo
  dueDate: Date | null; // when the next payment is due
  readOnly: boolean; // grace exceeded → block writes (storefront stays up)
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
    return { status: "active", label: "Aktif", daysLeft: ceilDays(s.currentPeriodEnd.getTime() - now.getTime()), nextAmount, isPromo, dueDate: s.currentPeriodEnd, readOnly: false };
  }
  // 2) inside the free trial (never paid) → trial
  if (!s.currentPeriodEnd && s.trialEndsAt && now < s.trialEndsAt) {
    return { status: "trial", label: "Masa uji coba", daysLeft: ceilDays(s.trialEndsAt.getTime() - now.getTime()), nextAmount: BILLING.FIRST_MONTH_IDR, isPromo: true, dueDate: s.trialEndsAt, readOnly: false };
  }
  // 3) overdue — 3-day grace (still full access), then suspended (read-only)
  const dueBase = s.currentPeriodEnd ?? s.trialEndsAt ?? now;
  const graceEnd = new Date(dueBase.getTime() + BILLING.GRACE_DAYS * dayMs);
  if (now < graceEnd) {
    return { status: "past_due", label: "Menunggu pembayaran", daysLeft: ceilDays(graceEnd.getTime() - now.getTime()), nextAmount, isPromo, dueDate: dueBase, readOnly: false };
  }
  return { status: "suspended", label: "Ditangguhkan", daysLeft: 0, nextAmount, isPromo, dueDate: dueBase, readOnly: true };
}
