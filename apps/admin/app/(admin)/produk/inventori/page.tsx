import { getProducts } from "@/lib/data/products";
import { InventoriClient } from "./inventori-client";

export const dynamic = "force-dynamic";

export default async function InventoriPage() {
  const products = await getProducts();
  return <InventoriClient products={products} />;
}
