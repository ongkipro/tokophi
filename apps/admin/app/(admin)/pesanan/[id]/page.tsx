import { notFound } from "next/navigation";
import { getOrder } from "@/lib/data/orders";
import { getOrderDetail } from "@/lib/data/order-detail";
import { OrderDetail } from "./order-detail";
import { getOrderReturn } from "./return-info";

export const dynamic = "force-dynamic";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOrder(id);
  if (!order) notFound();
  // Real line items / money / shipment / buyer / payment — nothing is derived from the order id.
  const detail = await getOrderDetail(id);
  if (!detail) notFound();
  const orderReturn = await getOrderReturn(id);
  return <OrderDetail order={order} detail={detail} orderReturn={orderReturn} />;
}
