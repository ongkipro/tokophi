import { PRODUCTS } from "@/lib/mock/store";
import { notFound } from "next/navigation";
import { ProductEditor } from "./product-editor";

// Prerender an edit page per product; unknown ids render on demand.
export function generateStaticParams() {
  return PRODUCTS.map((p) => ({ id: p.id }));
}

export default async function ProductEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = PRODUCTS.find((p) => p.id === id);
  if (!product) notFound();
  return <ProductEditor product={product} />;
}
