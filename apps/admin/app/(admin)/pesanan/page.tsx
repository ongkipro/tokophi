import { getOrders } from "@/lib/data/orders";
import { getReturnsByCourier } from "@/lib/data/returns";
import { PesananClient } from "./pesanan-client";

export const dynamic = "force-dynamic";

export default async function PesananPage() {
  const [orders, returns] = await Promise.all([getOrders(), getReturnsByCourier()]);
  return <PesananClient orders={orders} returns={returns} />;
}
