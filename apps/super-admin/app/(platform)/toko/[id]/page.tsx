import { notFound } from "next/navigation";

import { getStoreById } from "@/lib/data";
import { getStoreHealth } from "@/lib/health";
import { StoreDetail } from "./store-detail";

export const dynamic = "force-dynamic";

export default async function StoreDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [store, health] = await Promise.all([getStoreById(id), getStoreHealth(id)]);
  if (!store) notFound();
  return <StoreDetail store={store} health={health} />;
}
