import { ORDERS } from "@/lib/mock/store";
import { notFound } from "next/navigation";
import { OrderDetail } from "./order-detail";

// Prerender a detail page per order (id without the leading "#").
export function generateStaticParams() {
  return ORDERS.map((o) => ({ id: o.id.replace("#", "") }));
}

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = ORDERS.find((o) => o.id.replace("#", "") === id);
  if (!order) notFound();
  return <OrderDetail order={order} />;
}
