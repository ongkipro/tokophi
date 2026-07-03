import { getProducts } from "@/lib/data/products";
import { ProdukClient } from "./produk-client";

export const dynamic = "force-dynamic";

export default async function ProdukPage() {
  const products = await getProducts();
  return <ProdukClient products={products} />;
}
