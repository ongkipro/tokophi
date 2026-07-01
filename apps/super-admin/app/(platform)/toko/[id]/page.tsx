import { notFound } from "next/navigation";

import { STORES } from "@/lib/mock";
import { StoreDetail } from "./store-detail";

export function generateStaticParams() {
  return STORES.map((s) => ({ id: s.id }));
}

export default async function StoreDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const store = STORES.find((s) => s.id === id);
  if (!store) notFound();
  return <StoreDetail store={store} />;
}
