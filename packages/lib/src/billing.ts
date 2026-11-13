// Single-plan subscription (all features). Pricing per ADR 0020 (owner, 2026-11-13):
//   monthly: 3-day free trial → Rp178.500/month. There is NO first-month promo any more (the Rp50rb
//            promo was removed): without a code the first invoice is the normal price.
//   annual : monthly × 12 with a 20% discount = Rp1.713.600 (Rp142.800/month effective); paying
//            annually straight after the trial (first time) still grants a bonus month → 13 months.
//   code   : a store that signed up with a signup code carrying `discount_first_invoice_idr` gets that
//            much off its FIRST PAID subscription invoice (monthly or annual), once — `codeDiscountFor()`.
// All prices are the DPP (ex-tax); `subscriptionCharge()` adds PPN on the DISCOUNTED DPP when the
// global toggle is on. Recurring via VA invoice; 3-day grace past due → read-only.
export const BILLING = {
  PLAN_NAME: "TokoΦ",
  TRIAL_DAYS: 3,
  MONTHLY_IDR: 178_500,
  ANNUAL_DISCOUNT_PCT: 20, // annual = monthly × 12 × (1 − 20%)
  ANNUAL_IDR: 1_713_600, // 178.500 × 12 × 0,8 — pinned to that formula in billing.test.ts
  ANNUAL_MONTHLY_IDR: 142_800, // effective per-month when paying yearly (1.713.600 / 12)
  // What the Super Admin "Kode Daftar" form pre-fills for a new code's first-invoice discount. The
  // amount actually granted is stored PER CODE (`signup_codes.discount_first_invoice_idr`); 0 = none.
  SIGNUP_CODE_DISCOUNT_DEFAULT_IDR: 100_000,
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
export type Quote = {
  cycle: Cycle;
  /** The plan price for the cycle (DPP), before any code discount. */
  listAmount: number;
  /** The signup-code discount taken off THIS invoice (0 = none), already clamped to `listAmount`. */
  codeDiscountIdr: number;
  /** What is billed (DPP) = `listAmount − codeDiscountIdr`. PPN, when on, is added on THIS. */
  amount: number;
  months: number;
  perMonth: number;
  bonusMonth: boolean;
  label: string;
};

// What a merchant pays + how long it covers, for a chosen cycle given their history.
// `codeDiscountIdr` is the discount the store is OWED — resolve it with `codeDiscountFor()` first;
// passing a code's raw amount here would discount a store that already used it.
export function quote(cycle: Cycle, firstInvoicePaid: boolean, codeDiscountIdr = 0): Quote {
  const listAmount = cycle === "annual" ? BILLING.ANNUAL_IDR : BILLING.MONTHLY_IDR;
  const owed = Number.isFinite(codeDiscountIdr) ? Math.trunc(codeDiscountIdr) : 0;
  const discount = Math.max(0, Math.min(owed, listAmount));
  const amount = listAmount - discount;
  if (cycle === "annual") {
    const bonusMonth = !firstInvoicePaid; // first-time annual (from trial) → +1 free month
    return { cycle, listAmount, codeDiscountIdr: discount, amount, months: bonusMonth ? 13 : 12, perMonth: BILLING.ANNUAL_MONTHLY_IDR, bonusMonth, label: "Tahunan" };
  }
  return { cycle, listAmount, codeDiscountIdr: discount, amount, months: 1, perMonth: BILLING.MONTHLY_IDR, bonusMonth: false, label: "Bulanan" };
}

/**
 * The signup-code discount a store is OWED on its next subscription invoice (ADR 0020) — the ONE rule,
 * read by the invoice creator (`@tokophi/db/subscription-invoice`) and by every screen that previews
 * the next amount, so the preview and the bill cannot disagree.
 *
 * The discount belongs to the store's FIRST PAID subscription invoice:
 *  - no code, or a code whose `discount_first_invoice_idr` is 0 → 0 (normal price);
 *  - the store has ever paid a subscription invoice — `firstInvoicePaid` (set by the payment callback)
 *    OR a `dibayar` subscription invoice on record (an operator's manual "Lunas" flip does not set the
 *    flag, ruling 2026-08-20, and must still consume the discount) → 0, forever;
 *  - VIP/comped stores are never billed → 0;
 *  - otherwise → the code's amount. An invoice cancelled or expired UNPAID did not use it, so the
 *    re-issued one carries it again (cancelling a monthly bill to pay annually must not forfeit it).
 *    The DB allows at most ONE live (`menunggu`) discounted invoice per store (migration 0119), and the
 *    creator reuses a live invoice instead of minting a second.
 * A code deactivated after signup is still honoured: the discount was granted when the store signed up.
 */
export function codeDiscountFor(s: { codeDiscountIdr: number | null | undefined; firstInvoicePaid: boolean; hasPaidSubscription: boolean; comped?: boolean | null }): number {
  if (s.comped || s.firstInvoicePaid || s.hasPaidSubscription) return 0;
  const d = Math.trunc(Number(s.codeDiscountIdr ?? 0));
  return Number.isFinite(d) && d > 0 ? d : 0;
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
  nextAmount: number; // IDR (DPP) of the next MONTHLY invoice, code discount already taken off
  codeDiscountIdr: number; // the signup-code discount inside `nextAmount` (0 = none) — ADR 0020
  dueDate: Date | null; // when the next payment is due
  readOnly: boolean; // grace exceeded OR operator-suspended → block writes (storefront stays up)
  firstInvoicePaid: boolean; // false = never paid: annual-bonus eligible; a code discount may still be owed
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
  // ADR 0020 — the signup-code discount the store is OWED on its next invoice, ALREADY resolved by
  // `codeDiscountFor()` (absent = 0). Optional on purpose: only screens that show the next amount read
  // it, and a read site that omits it shows the normal price — never a discount nobody is owed.
  codeDiscountIdr?: number;
};

// The 4 lifecycle "sessions" the store list is split into (Trial → Tagihan pertama → Reguler → VIP).
//
// ADR 0020: `first_invoice` was `first_month` while the Rp50rb first-month promo existed. The promo is
// gone but the STATE is still real and worth its own tab: the trial is over and the store has never
// paid a subscription invoice (unpaid, or living on a comped month). Same predicate as before — only
// the name and the price stopped claiming a promo — so the Super Admin segment counts do not move.
export type StoreSegment = "trial" | "first_invoice" | "regular" | "vip";
export const SEGMENT_META: Record<StoreSegment, { label: string; short: string; price: number; hint: string }> = {
  trial: { label: `Uji coba (${BILLING.TRIAL_DAYS} hari)`, short: "Trial", price: 0, hint: "Masa coba gratis" },
  first_invoice: { label: "Tagihan pertama (belum pernah bayar)", short: "Tagihan 1", price: BILLING.MONTHLY_IDR, hint: "Uji coba selesai, belum pernah membayar langganan — potongan kode daftar (bila ada) berlaku di tagihan ini" },
  regular: { label: `Reguler (${BILLING.MONTHLY_IDR.toLocaleString("id-ID")}/bln)`, short: "Reguler", price: BILLING.MONTHLY_IDR, hint: "Langganan berjalan" },
  vip: { label: "VIP (gratis)", short: "VIP", price: 0, hint: "Dibebaskan biaya oleh platform" },
};

// Which of the 4 lifecycle sessions a store belongs to (independent of active/past_due/suspended).
// Reads `billingStatus`, NOT `status`: an operator suspension does not move a store out of its trial
// or off its first invoice — it locks the panel. Reading the effective status here would file
// every suspended trial store under "Tagihan 1" in the Toko catalog.
export function storeSegment(s: StoreBillingRow, now: Date = new Date()): StoreSegment {
  if (s.comped) return "vip";
  const b = computeBilling(s, now);
  if (b.billingStatus === "trial") return "trial";
  return s.firstInvoicePaid ? "regular" : "first_invoice";
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
    // `nextAmount`, `codeDiscountIdr` and `dueDate` are deliberately carried over from `b`: the subscription
    // keeps running underneath, so the merchant can still pay while locked and the cron can still
    // raise the invoice they owe.
  };
}

// The subscription lifecycle on its own — trial → active → past_due → suspended, plus VIP.
type SubscriptionState = Omit<BillingState, "billingStatus" | "operatorSuspended" | "pendingApproval" | "suspendedReason">;
function subscriptionState(s: StoreBillingRow, now: Date): SubscriptionState {
  // 0) comped/VIP → billing bypassed: always active, nothing due, full access
  if (s.comped) {
    return { status: "active", label: "VIP (gratis)", daysLeft: 0, nextAmount: 0, codeDiscountIdr: 0, dueDate: null, readOnly: false, firstInvoicePaid: s.firstInvoicePaid, comped: true };
  }
  // ADR 0020: one price whatever the history. The only first-invoice difference left is a signup-code
  // discount, which the caller resolved with `codeDiscountFor()` — and which is 0 once anything is paid.
  const next = quote("monthly", s.firstInvoicePaid, s.firstInvoicePaid ? 0 : (s.codeDiscountIdr ?? 0));
  const nextAmount = next.amount;
  const codeDiscountIdr = next.codeDiscountIdr;

  // 1) inside a paid period → active
  if (s.currentPeriodEnd && now < s.currentPeriodEnd) {
    return { status: "active", label: "Aktif", daysLeft: ceilDays(s.currentPeriodEnd.getTime() - now.getTime()), nextAmount, codeDiscountIdr, dueDate: s.currentPeriodEnd, readOnly: false, firstInvoicePaid: s.firstInvoicePaid, comped: false };
  }
  // 2) inside the free trial (never paid) → trial
  if (!s.currentPeriodEnd && s.trialEndsAt && now < s.trialEndsAt) {
    return { status: "trial", label: "Masa uji coba", daysLeft: ceilDays(s.trialEndsAt.getTime() - now.getTime()), nextAmount, codeDiscountIdr, dueDate: s.trialEndsAt, readOnly: false, firstInvoicePaid: s.firstInvoicePaid, comped: false };
  }
  // 3) overdue — 3-day grace (still full access), then suspended (read-only)
  const dueBase = s.currentPeriodEnd ?? s.trialEndsAt ?? now;
  const graceEnd = new Date(dueBase.getTime() + BILLING.GRACE_DAYS * dayMs);
  if (now < graceEnd) {
    return { status: "past_due", label: "Menunggu pembayaran", daysLeft: ceilDays(graceEnd.getTime() - now.getTime()), nextAmount, codeDiscountIdr, dueDate: dueBase, readOnly: false, firstInvoicePaid: s.firstInvoicePaid, comped: false };
  }
  return { status: "suspended", label: "Ditangguhkan", daysLeft: 0, nextAmount, codeDiscountIdr, dueDate: dueBase, readOnly: true, firstInvoicePaid: s.firstInvoicePaid, comped: false };
}

/**
 * The charge for ONE subscription invoice under the platform PPN toggle (owner ruling 2026-08-24,
 * default OFF at launch). ON → the historical shape, base + 11% PPN; OFF → the flat DPP, zero tax.
 * Callers store BOTH numbers on the invoice (`amount_idr`, `tax_idr`) so the faktur renders what was
 * actually billed instead of deriving tax that may never have existed.
 */
export function subscriptionCharge(base: number, ppnEnabled: boolean): { total: number; taxIdr: number } {
  if (!ppnEnabled) return { total: base, taxIdr: 0 };
  const b = withPpn(base);
  return { total: b.total, taxIdr: b.ppn };
}
