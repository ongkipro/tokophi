import { notFound } from "next/navigation";
import { getOrder } from "@/lib/data/orders";
import { OrderDetail } from "./order-detail";

export const dynamic = "force-dynamic";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOrder(id);
  if (!order) notFound();
  return <OrderDetail order={order} />;
}
