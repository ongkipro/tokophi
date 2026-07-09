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
  PPN_RATE: 0.11, // 11% VAT — plan prices above are the DPP (ex-tax); merchant pays base + PPN
} as const;

export type PpnBreakdown = { base: number; ppn: number; total: number };
// Add 11% PPN on top of a tax-exclusive base price → what the merchant actually pays.
export function withPpn(base: number): PpnBreakdown {
  const total = Math.round(base * (1 + BILLING.PPN_RATE));
  return { base, ppn: total - base, total };
}
// Recover the breakdown from a PPN-inclusive total (for invoices/faktur that store the total).
export function baseFromTotal(total: number): PpnBreakdown {
  const base = Math.round(total / (1 + BILLING.PPN_RATE));
  return { base, ppn: total - base, total };
}

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
  comped: boolean; // VIP: billing bypassed by the platform
};

export type StoreBillingRow = {
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  firstInvoicePaid: boolean;
  comped?: boolean; // VIP: platform bypasses billing → always active, no charge
};

// The 4 lifecycle "sessions" the store list is split into (Trial → Bulan pertama → Reguler → VIP).
export type StoreSegment = "trial" | "first_month" | "regular" | "vip";
export const SEGMENT_META: Record<StoreSegment, { label: string; short: string; price: number; hint: string }> = {
  trial: { label: "Uji coba (3 hari)", short: "Trial", price: 0, hint: "Masa coba gratis" },
  first_month: { label: `Bulan pertama (${BILLING.FIRST_MONTH_IDR.toLocaleString("id-ID")})`, short: "Bulan 1", price: BILLING.FIRST_MONTH_IDR, hint: "Promo bulan pertama" },
  regular: { label: `Reguler (${BILLING.MONTHLY_IDR.toLocaleString("id-ID")}/bln)`, short: "Reguler", price: BILLING.MONTHLY_IDR, hint: "Langganan berjalan" },
  vip: { label: "VIP (gratis)", short: "VIP", price: 0, hint: "Dibebaskan biaya oleh platform" },
};

// Which of the 4 lifecycle sessions a store belongs to (independent of active/past_due/suspended).
export function storeSegment(s: StoreBillingRow, now: Date = new Date()): StoreSegment {
  if (s.comped) return "vip";
  const b = computeBilling(s, now);
  if (b.status === "trial") return "trial";
  return s.firstInvoicePaid ? "regular" : "first_month";
}

const dayMs = 86_400_000;
const ceilDays = (ms: number) => Math.max(0, Math.ceil(ms / dayMs));

export function computeBilling(s: StoreBillingRow, now: Date = new Date()): BillingState {
  // 0) comped/VIP → billing bypassed: always active, nothing due, full access
  if (s.comped) {
    return { status: "active", label: "VIP (gratis)", daysLeft: 0, nextAmount: 0, isPromo: false, dueDate: null, readOnly: false, firstInvoicePaid: s.firstInvoicePaid, comped: true };
  }
  const isPromo = !s.firstInvoicePaid;
  const nextAmount = isPromo ? BILLING.FIRST_MONTH_IDR : BILLING.MONTHLY_IDR;

  // 1) inside a paid period → active
  if (s.currentPeriodEnd && now < s.currentPeriodEnd) {
    return { status: "active", label: "Aktif", daysLeft: ceilDays(s.currentPeriodEnd.getTime() - now.getTime()), nextAmount, isPromo, dueDate: s.currentPeriodEnd, readOnly: false, firstInvoicePaid: s.firstInvoicePaid, comped: false };
  }
  // 2) inside the free trial (never paid) → trial
  if (!s.currentPeriodEnd && s.trialEndsAt && now < s.trialEndsAt) {
    return { status: "trial", label: "Masa uji coba", daysLeft: ceilDays(s.trialEndsAt.getTime() - now.getTime()), nextAmount: BILLING.FIRST_MONTH_IDR, isPromo: true, dueDate: s.trialEndsAt, readOnly: false, firstInvoicePaid: s.firstInvoicePaid, comped: false };
  }
  // 3) overdue — 3-day grace (still full access), then suspended (read-only)
  const dueBase = s.currentPeriodEnd ?? s.trialEndsAt ?? now;
  const graceEnd = new Date(dueBase.getTime() + BILLING.GRACE_DAYS * dayMs);
  if (now < graceEnd) {
    return { status: "past_due", label: "Menunggu pembayaran", daysLeft: ceilDays(graceEnd.getTime() - now.getTime()), nextAmount, isPromo, dueDate: dueBase, readOnly: false, firstInvoicePaid: s.firstInvoicePaid, comped: false };
  }
  return { status: "suspended", label: "Ditangguhkan", daysLeft: 0, nextAmount, isPromo, dueDate: dueBase, readOnly: true, firstInvoicePaid: s.firstInvoicePaid, comped: false };
}
