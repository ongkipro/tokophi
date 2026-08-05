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
  status: BillingStatus; // EFFECTIVE — what the merchant actually experiences
  // What the SUBSCRIPTION alone says, ignoring any operator suspension. The debt does not go away
  // because an operator locked the store, so the billing job still has to see it: renewal invoices
  // are raised off THIS, not off `status` (a paid-up store an operator suspended must not be billed
  // a month early just because it reads "suspended").
  billingStatus: BillingStatus;
  operatorSuspended: boolean; // a person at the platform suspended this store, deliberately
  // Locked because NOBODY HAS REVIEWED IT YET, not because anyone judged it (0090). A self-serve
  // signup is created suspended, so `operatorSuspended` is true for both cases and cannot tell them
  // apart — and they need opposite words: one screen apologises for a wait, the other explains a
  // penalty. Derived here so the merchant banner, the sidebar badge and the operator's queue all
  // read the same rule rather than each re-deriving `approvedAt === null` its own way.
  pendingApproval: boolean;
  suspendedReason: string | null; // why they did — shown to the merchant and in the audit line
  label: string;
  daysLeft: number; // days left in trial / current period / grace
  nextAmount: number; // IDR the merchant pays next (monthly)
  isPromo: boolean; // next payment is the Rp50rb first-month promo
  dueDate: Date | null; // when the next payment is due
  readOnly: boolean; // grace exceeded OR operator-suspended → block writes (storefront stays up)
  firstInvoicePaid: boolean; // false = still on promo / annual-bonus eligible
  comped: boolean; // VIP: billing bypassed by the platform
};

export type StoreBillingRow = {
  // When a human first cleared this store (0090). OPTIONAL, unlike `suspendedAt` below, and the
  // asymmetry is deliberate: forgetting `suspendedAt` unsuspends every store — a silent security
  // failure — while forgetting this one only makes a queued store read as plainly suspended. So
  // `tsc` is made to police the dangerous one and left permissive about the cosmetic one, instead
  // of forcing ~10 read sites that have no opinion about approval to select a column.
  approvedAt?: Date | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  firstInvoicePaid: boolean;
  comped?: boolean; // VIP: platform bypasses billing → always active, no charge
  // 🔴 OPERATOR SUSPENSION — REQUIRED, and required on purpose (2026-08-03).
  //
  // Suspension used to be DERIVED from billing alone, so super-admin's "Tangguhkan" button wrote
  // `stores.status` + an audit row and changed NOTHING: the merchant panel stayed fully writable,
  // and the nightly billing cron reverted the column within 24 hours. There was no working way to
  // suspend a store.
  //
  // This column is the operator's own fact, kept apart from billing because the two are different
  // facts that must coexist: a suspended store that then pays must NOT silently reactivate, and a
  // paid-up store suspended for abuse must stay suspended. `null` = not suspended by us.
  //
  // It is NOT optional in this type so that `tsc` fails on any read path that forgets to select it —
  // a missed `select` is invisible at runtime and silently unlocks the store it was meant to lock.
  suspendedAt: Date | null;
  suspendedReason?: string | null;
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
// Reads `billingStatus`, NOT `status`: an operator suspension does not move a store out of its trial
// or off the first-month promo — it locks the panel. Reading the effective status here would file
// every suspended trial store under "Bulan 1" in the Toko catalog.
export function storeSegment(s: StoreBillingRow, now: Date = new Date()): StoreSegment {
  if (s.comped) return "vip";
  const b = computeBilling(s, now);
  if (b.billingStatus === "trial") return "trial";
  return s.firstInvoicePaid ? "regular" : "first_month";
}

const dayMs = 86_400_000;
const ceilDays = (ms: number) => Math.max(0, Math.ceil(ms / dayMs));

// The EFFECTIVE state: the subscription's own state, then the operator's override on top.
//
// ⚠️ The override wins over `comped` too. VIP bypasses BILLING; it is not an abuse shield. A store
// we host for free that starts selling counterfeit goods must still be lockable, and the operator
// pressing "Tangguhkan" on a VIP store would otherwise get the same silent nothing this whole
// mechanism exists to fix.
export function computeBilling(s: StoreBillingRow, now: Date = new Date()): BillingState {
  const b = subscriptionState(s, now);
  if (!s.suspendedAt) {
    return { ...b, billingStatus: b.status, operatorSuspended: false, pendingApproval: false, suspendedReason: null };
  }
  // Never reviewed by a human AND locked ⇒ this is the signup queue, not a penalty (0090).
  // `approvedAt` is optional on the row type so the many read sites that do not care keep compiling;
  // absent is read as APPROVED, which is the safe direction — an unreviewed store mislabelled as
  // suspended is rude, a suspended store mislabelled as "just waiting" tells a merchant we punished
  // that nothing is wrong.
  const pendingApproval = s.approvedAt === null;
  return {
    ...b,
    status: "suspended",
    billingStatus: b.status,
    operatorSuspended: true,
    pendingApproval,
    suspendedReason: s.suspendedReason?.trim() || null,
    label: pendingApproval ? "Menunggu persetujuan" : "Ditangguhkan oleh platform",
    daysLeft: 0,
    readOnly: true,
    // `nextAmount`, `isPromo` and `dueDate` are deliberately carried over from `b`: the subscription
    // keeps running underneath, so the merchant can still pay while locked and the cron can still
    // raise the invoice they owe.
  };
}

// The subscription lifecycle on its own — trial → active → past_due → suspended, plus VIP.
type SubscriptionState = Omit<BillingState, "billingStatus" | "operatorSuspended" | "pendingApproval" | "suspendedReason">;
function subscriptionState(s: StoreBillingRow, now: Date): SubscriptionState {
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
