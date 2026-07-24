import { notFound } from "next/navigation";
import { getFlashSale, getStoreProductsForFlash } from "@/lib/data/flash";
import { FlashEditor } from "./flash-editor";

export const dynamic = "force-dynamic";

export default async function EditFlashSale({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [sale, products] = await Promise.all([getFlashSale(id), getStoreProductsForFlash()]);
  if (!sale) notFound();
  const now = Date.now();
  return (
    <FlashEditor
      sale={sale}
      products={products}
      defaultStartsAt={new Date(now).toISOString()}
      defaultEndsAt={new Date(now + 7 * 86_400_000).toISOString()}
    />
  );
}
