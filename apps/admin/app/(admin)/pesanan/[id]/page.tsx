import { notFound } from "next/navigation";
import { getOrder } from "@/lib/data/orders";
import { getOrderDetail } from "@/lib/data/order-detail";
import { OrderDetail } from "./order-detail";
import { getOrderReturn } from "./return-info";
import { activeKaEnv } from "@tokophi/lib/provider-config";

export const dynamic = "force-dynamic";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOrder(id);
  if (!order) notFound();
  // Real line items / money / shipment / buyer / payment — nothing is derived from the order id.
  const detail = await getOrderDetail(id);
  if (!detail) notFound();
  const orderReturn = await getOrderReturn(id);
  // Demo "Isi resi contoh" is offered only in sandbox — a placeholder AWB must never reach a real
  // courier label in production.
  // Task 8.33: the live env comes from the same seam the booking uses (Super Admin's row first,
  // KIRIMINAJA_ENV second) — a demo button decided by a stale env var would offer a fake resi in production.
  const demoAllowed = (await activeKaEnv()) !== "production";
  return <OrderDetail order={order} detail={detail} orderReturn={orderReturn} demoAllowed={demoAllowed} />;
}
