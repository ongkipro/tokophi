import { BILLING, computeBilling, type StoreBillingRow } from "@tokophi/lib/billing";

// ─────────────────────────────────────────────────────────────────────────────
// WHICH BUCKET A STORE FALLS IN ON THE PLATFORM DASHBOARD — and whether it is MRR.
//
// Pure, so it is table-tested. `getSubscriptionStats` feeds it one row per store; the row carries
// the billing columns `computeBilling` already reads PLUS two facts that used to be invisible:
//
//   · `lastPaidAt`  — the newest PAID subscription invoice (`invoices.kind='subscription',
//                     status='dibayar'`).
//   · `lastCompAt`  — the newest COMP invoice (`kind='comp'`, 0113): a period the platform GRANTED.
//
// THE RULE (finance audit 2026-09-16, F3): a store is a paying customer — counts toward MRR, ARPU
// and "Pelanggan berbayar" — only when its CURRENT period is backed by a payment, i.e. the newest
// thing that set `current_period_end` was a paid invoice, not a comp. Before this, `compStore` moved
// the period and nothing downstream could tell; production read MRR ≈ Rp600.000 over 12 stores whose
// only "paid" period was "Gratis 1 bulan" (26 audit lines), while real paying merchants were 0.
//
// "Backed by" is decided by RECENCY, not by arithmetic on dates: whichever of (last paid, last comp)
// is newer is what extended the period last. A store that paid and was later comped is `comped` for
// the comped period (no revenue this period); a store that was comped and later paid is `paid`.
// A period with neither behind it (seeded, or an operator edit outside the two actions) is `comped`
// too — the honest reading of "no payment is on record for this period".
// ─────────────────────────────────────────────────────────────────────────────

export type KpiRow = StoreBillingRow & {
  isDemo: boolean;
  lastPaidAt: Date | null;
  lastCompAt: Date | null;
};

export type KpiBucket =
  | "demo" // seeded demo store — excluded from every money figure, counted so the slices still sum
  | "suspended" // operator suspension (counted before VIP — a locked VIP is locked)
  | "vip" // comped=true: free forever, never MRR
  | "trial"
  | "paid" // active AND the current period is backed by a paid invoice → MRR
  | "comped" // active but the period was granted (or has no payment behind it) → NOT MRR
  | "pastDue"
  | "lapsed"; // billing status suspended (grace exceeded), not an operator act

export type KpiVerdict = { bucket: KpiBucket; mrr: number; trialEndingSoon: boolean };

/** What backs the store's current period: the newer of its last paid invoice and its last comp. */
export function periodBackedBy(row: Pick<KpiRow, "lastPaidAt" | "lastCompAt">): "paid" | "comp" | "none" {
  const paid = row.lastPaidAt?.getTime() ?? null;
  const comp = row.lastCompAt?.getTime() ?? null;
  if (paid === null && comp === null) return "none";
  if (paid !== null && (comp === null || paid > comp)) return "paid";
  return "comp";
}

export function subscriptionKpiBucket(row: KpiRow, now: Date = new Date()): KpiVerdict {
  const none = { mrr: 0, trialEndingSoon: false };
  if (row.isDemo) return { bucket: "demo", ...none };
  const b = computeBilling(row, now);
  if (b.operatorSuspended) return { bucket: "suspended", ...none };
  if (row.comped) return { bucket: "vip", ...none };
  if (b.status === "trial") return { bucket: "trial", mrr: 0, trialEndingSoon: b.daysLeft <= 1 };
  if (b.status === "active") {
    if (periodBackedBy(row) === "paid") {
      // The first paid month is the promo; every later one is the regular price.
      return { bucket: "paid", mrr: row.firstInvoicePaid ? BILLING.MONTHLY_IDR : BILLING.FIRST_MONTH_IDR, trialEndingSoon: false };
    }
    return { bucket: "comped", ...none };
  }
  if (b.status === "past_due") return { bucket: "pastDue", ...none };
  return { bucket: "lapsed", ...none };
}
