import { notFound } from "next/navigation";
import { getProduct } from "@/lib/data/products";
import { ProductEditor } from "./product-editor";

export const dynamic = "force-dynamic";

export default async function ProductEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) notFound();
  return <ProductEditor product={product} />;
}
