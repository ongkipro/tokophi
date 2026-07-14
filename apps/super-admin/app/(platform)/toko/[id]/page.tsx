import { notFound } from "next/navigation";

import {
  getStoreById, getStoreBilling, getStoreInvoices, getStoreUsers, getStoreActivity, getStoreComp,
  getStoreBalance, getStoreMovements, getStorePayouts, getStoreMoneySignals, getStoreCoverage,
} from "@/lib/data";
import { getStoreHealth } from "@/lib/health";
import { StoreDetail } from "./store-detail";

export const dynamic = "force-dynamic";

export default async function StoreDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  // `?tx=N` pages the ledger IN SQL — a busy store has thousands of movements and none of them
  // belong in the browser at once.
  searchParams: Promise<{ tx?: string }>;
}) {
  const { id } = await params;
  const { tx } = await searchParams;
  const [store, health, billing, invoices, users, activity, comp, balance, movements, payouts, signals, coverage] = await Promise.all([
    getStoreById(id),
    getStoreHealth(id),
    getStoreBilling(id),
    getStoreInvoices(id),
    getStoreUsers(id),
    getStoreActivity(id),
    getStoreComp(id),
    getStoreBalance(id),
    getStoreMovements(id, Number(tx) || 1),
    getStorePayouts(id),
    getStoreMoneySignals(id),
    getStoreCoverage(id),
  ]);
  if (!store) notFound();
  return (
    <StoreDetail
      store={store} health={health} billing={billing} invoices={invoices} users={users} activity={activity} comp={comp}
      balance={balance} movements={movements} payouts={payouts} signals={signals} coverage={coverage}
    />
  );
}
