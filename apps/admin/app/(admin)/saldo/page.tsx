import {
  getBalance,
  getLedgerCounts,
  getMovements,
  getPayoutContext,
  getPayouts,
  getPendingFunds,
  type LedgerFilters,
  type LedgerStatus,
  type SaldoTab,
} from "@/lib/data/ledger";
import { SaldoClient } from "./saldo-client";

export const dynamic = "force-dynamic";

const TABS: SaldoTab[] = ["mutasi", "proses", "penarikan"];
const STATUSES: LedgerStatus[] = ["semua", "proses", "belum", "ditarik"];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const asDate = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

/**
 * Filter + page state lives in the URL, not in React state, for three reasons that all matter here:
 * the server does the paging (so it has to *see* the page), a filtered view is a thing a merchant
 * bookmarks and sends to their accountant, and the back button then does what they expect.
 *
 * Only the ACTIVE tab is queried. Fetching all three lists on every keystroke of a date filter
 * would triple the DB work to render rows nobody is looking at.
 */
export default async function SaldoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  const tabParam = one(sp.tab);
  const tab: SaldoTab | "rekening" =
    tabParam === "rekening" ? "rekening" : TABS.includes(tabParam as SaldoTab) ? (tabParam as SaldoTab) : "mutasi";

  const statusParam = one(sp.status) as LedgerStatus | undefined;
  const status: LedgerStatus = statusParam && STATUSES.includes(statusParam) ? statusParam : "semua";

  const pageNum = Math.max(1, Number(one(sp.hal) ?? 1) || 1);

  const filters: LedgerFilters = {
    from: asDate(one(sp.dari)),
    to: asDate(one(sp.sampai)),
    status,
    page: pageNum,
  };

  const [balance, counts, ctx] = await Promise.all([getBalance(), getLedgerCounts(), getPayoutContext()]);

  const [movements, pending, payouts] = await Promise.all([
    tab === "mutasi" ? getMovements(filters) : null,
    tab === "proses" ? getPendingFunds(filters) : null,
    tab === "penarikan" ? getPayouts(filters) : null,
  ]);

  return (
    <SaldoClient
      balance={balance}
      counts={counts}
      ctx={ctx}
      tab={tab}
      filters={filters}
      movements={movements}
      pending={pending}
      payouts={payouts}
    />
  );
}
