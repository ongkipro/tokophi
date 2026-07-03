import { getOrders } from "@/lib/data/orders";
import { PesananClient } from "./pesanan-client";

export const dynamic = "force-dynamic";

export default async function PesananPage() {
  const orders = await getOrders();
  return <PesananClient orders={orders} />;
}
