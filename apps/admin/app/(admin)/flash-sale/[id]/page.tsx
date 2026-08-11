import { notFound } from "next/navigation";
import { isUuid } from "@/lib/uuid";
import { getFlashSale, getStoreProductsForFlash } from "@/lib/data/flash";
import { FlashEditor } from "./flash-editor";

export const dynamic = "force-dynamic";

export default async function EditFlashSale({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // A non-UUID segment reaches `eq(x.id, id)` and Postgres THROWS 22P02 — a 500 where a 404 belongs.
  // `/produk/…` takes the catalog NUMBER, so merchants do try `/<this route>/1042`. See lib/uuid.ts.
  if (!isUuid(id)) notFound();
  const [sale, products] = await Promise.all([getFlashSale(id), getStoreProductsForFlash()]);
  if (!sale) notFound();
  // Async SERVER component: computed once per request, never hydrated — the comment above documents
  // the design. The purity rule doesn't know RSC, so this is a recorded false positive, not a waiver.
  // eslint-disable-next-line react-hooks/purity -- server-only, per-request timestamp
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
