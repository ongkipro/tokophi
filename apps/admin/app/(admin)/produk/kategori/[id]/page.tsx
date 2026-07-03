import { notFound } from "next/navigation";
import { getCollection } from "@/lib/data/collections";
import { CollectionEditor } from "./collection-editor";

export const dynamic = "force-dynamic";

export default async function CollectionEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const collection = await getCollection(id);
  if (!collection) notFound();
  return <CollectionEditor collection={collection} />;
}
