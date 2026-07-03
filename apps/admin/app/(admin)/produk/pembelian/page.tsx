import { getPurchaseOrders, getPurchaseProducts } from "@/lib/data/purchases";
import { PembelianClient } from "./pembelian-client";

export const dynamic = "force-dynamic";

export default async function PembelianPage() {
  const [orders, products] = await Promise.all([getPurchaseOrders(), getPurchaseProducts()]);
  return <PembelianClient orders={orders} products={products} />;
}
