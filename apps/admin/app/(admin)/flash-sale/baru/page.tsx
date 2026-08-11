import { getStoreProductsForFlash } from "@/lib/data/flash";
import { FlashEditor } from "../[id]/flash-editor";

export const dynamic = "force-dynamic";

// Defaults computed on the SERVER (passed as ISO strings) so the client editor has no Date.now() in its
// initial render — no SSR/hydration mismatch. New sale: starts now, runs a week.
export default async function NewFlashSale() {
  const products = await getStoreProductsForFlash();
  // Async SERVER component: computed once per request, never hydrated — the comment above documents
  // the design. The purity rule doesn't know RSC, so this is a recorded false positive, not a waiver.
  // eslint-disable-next-line react-hooks/purity -- server-only, per-request timestamp
  const now = Date.now();
  return (
    <FlashEditor
      products={products}
      defaultStartsAt={new Date(now).toISOString()}
      defaultEndsAt={new Date(now + 7 * 86_400_000).toISOString()}
    />
  );
}
