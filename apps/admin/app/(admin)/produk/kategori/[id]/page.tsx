import { notFound } from "next/navigation";
import { getCollectionDetail } from "@/lib/data/collections";
import { getProducts } from "@/lib/data/products";
import { CollectionEditor } from "./collection-editor";

export const dynamic = "force-dynamic";

export default async function CollectionEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [collection, products] = await Promise.all([getCollectionDetail(id), getProducts()]);
  if (!collection) notFound();
  return <CollectionEditor collection={collection} products={products} />;
}
