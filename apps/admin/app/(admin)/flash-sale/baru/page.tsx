import { getStoreProductsForFlash } from "@/lib/data/flash";
import { FlashEditor } from "../[id]/flash-editor";

export const dynamic = "force-dynamic";

// Defaults computed on the SERVER (passed as ISO strings) so the client editor has no Date.now() in its
// initial render — no SSR/hydration mismatch. New sale: starts now, runs a week.
export default async function NewFlashSale() {
  const products = await getStoreProductsForFlash();
  const now = Date.now();
  return (
    <FlashEditor
      products={products}
      defaultStartsAt={new Date(now).toISOString()}
      defaultEndsAt={new Date(now + 7 * 86_400_000).toISOString()}
    />
  );
}
