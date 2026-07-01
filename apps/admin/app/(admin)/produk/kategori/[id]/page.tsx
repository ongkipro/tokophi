import { COLLECTIONS } from "@/lib/mock/store";
import { notFound } from "next/navigation";
import { CollectionEditor } from "./collection-editor";

export function generateStaticParams() {
  return COLLECTIONS.map((c) => ({ id: c.id }));
}

export default async function CollectionEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const collection = COLLECTIONS.find((c) => c.id === id);
  if (!collection) notFound();
  return <CollectionEditor collection={collection} />;
}
