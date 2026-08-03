import { getProducts, serverNowTs } from "@/lib/data/products";
import { ProdukClient } from "./produk-client";

export const dynamic = "force-dynamic";

export default async function ProdukPage() {
  const products = await getProducts();
  // The clock comes from the data layer, never from the seed's frozen TODAY — see `serverNowTs`.
  return <ProdukClient products={products} nowTs={serverNowTs()} />;
}
