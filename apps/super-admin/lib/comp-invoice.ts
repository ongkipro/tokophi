import { randomUUID } from "node:crypto";

// THE RECORD A COMP LEAVES BEHIND (Task 8.26 / finance audit F3, migration 0113).
//
// "Gratiskan N bulan" used to move `stores.current_period_end` and write an audit line — nothing a
// KPI could read. So the dashboard's MRR counted every comped store as a paying one. A comp now also
// writes ONE `invoices` row shaped like this: Rp0, tax Rp0, already `dibayar`, `kind = 'comp'`,
// `cycle = 'comp'`, `period_months` = what was granted. `getSubscriptionStats` compares the newest
// comp against the newest PAID invoice to decide which one backs the current period.
//
// Pure (no DB import) so the shape is table-tested; `compStore` inserts it inside the same
// transaction as the period move, so the two cannot disagree even for a moment.
export type CompInvoiceInput = { storeId: string; accountId: string; months: number; at: Date };

export function buildCompInvoice({ storeId, accountId, months, at }: CompInvoiceInput) {
  if (!Number.isInteger(months) || months < 1) throw new Error(`comp months must be a positive integer, got ${months}`);
  return {
    // `invoices.number` is globally unique; COMP- + 12 hex is the same shape 0113's backfill used.
    number: `COMP-${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    accountId,
    storeId,
    planKey: "bisnis" as const, // the single plan; the column is a legacy enum, not a tier
    amountIdr: 0,
    taxIdr: 0,
    status: "dibayar" as const,
    kind: "comp",
    cycle: "comp",
    periodMonths: months,
    issuedAt: at,
    paidAt: at,
  };
}
