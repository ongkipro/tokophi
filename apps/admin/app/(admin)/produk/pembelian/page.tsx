import { getPurchaseOrders } from "@/lib/data/purchases";
import { PembelianClient } from "./pembelian-client";

export const dynamic = "force-dynamic";

export default async function PembelianPage() {
  const orders = await getPurchaseOrders();
  return <PembelianClient orders={orders} />;
}
