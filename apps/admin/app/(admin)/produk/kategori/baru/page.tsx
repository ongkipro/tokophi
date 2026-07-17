import { getProducts } from "@/lib/data/products";
import { CollectionEditor } from "../[id]/collection-editor";

export const dynamic = "force-dynamic";

export default async function NewCollectionPage() {
  const products = await getProducts();
  return <CollectionEditor products={products} />;
}
