import { notFound } from "next/navigation";
import { isUuid } from "@/lib/uuid";
import { getCollectionDetail } from "@/lib/data/collections";
import { getProducts } from "@/lib/data/products";
import { CollectionEditor } from "./collection-editor";

export const dynamic = "force-dynamic";

export default async function CollectionEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // A non-UUID segment reaches `eq(x.id, id)` and Postgres THROWS 22P02 — a 500 where a 404 belongs.
  // `/produk/…` takes the catalog NUMBER, so merchants do try `/<this route>/1042`. See @tokophi/lib/uuid.
  if (!isUuid(id)) notFound();
  const [collection, products] = await Promise.all([getCollectionDetail(id), getProducts()]);
  if (!collection) notFound();
  return <CollectionEditor collection={collection} products={products} />;
}
