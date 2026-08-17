import { getProducts } from "@/lib/data/products";
import { getInventoryReceiptFacts } from "@/lib/data/inventory";
import { InventoriClient } from "./inventori-client";

export const dynamic = "force-dynamic";

export default async function InventoriPage() {
  const [products, receipts] = await Promise.all([
    getProducts(),
    getInventoryReceiptFacts(),
  ]);
  return <InventoriClient products={products} receipts={receipts} />;
}
