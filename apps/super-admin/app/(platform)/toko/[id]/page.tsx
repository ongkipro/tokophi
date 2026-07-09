import { notFound } from "next/navigation";

import { getStoreById, getStoreBilling, getStoreInvoices, getStoreUsers, getStoreActivity, getStoreComp } from "@/lib/data";
import { getStoreHealth } from "@/lib/health";
import { StoreDetail } from "./store-detail";

export const dynamic = "force-dynamic";

export default async function StoreDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [store, health, billing, invoices, users, activity, comp] = await Promise.all([
    getStoreById(id),
    getStoreHealth(id),
    getStoreBilling(id),
    getStoreInvoices(id),
    getStoreUsers(id),
    getStoreActivity(id),
    getStoreComp(id),
  ]);
  if (!store) notFound();
  return <StoreDetail store={store} health={health} billing={billing} invoices={invoices} users={users} activity={activity} comp={comp} />;
}
