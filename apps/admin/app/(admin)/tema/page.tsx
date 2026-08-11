import { DEFAULT_BRAND_COLOR } from "@tokophi/lib/colors";
import { getSession } from "@/lib/auth";
import {
  getBrandColor,
  getCollectionAssignments,
  getProductAssignments,
  getProductGalleryLayout,
  getStoreTheme,
  listTemplates,
} from "@/lib/data/theme";
import { TemaClient } from "./tema-client";

export const dynamic = "force-dynamic";

// ADR 0009 — /tema is the template MANAGER (list + create/rename/delete/set-default + assignment
// per kategori/produk); the drag-drop Puck builder itself lives at /tema/[id].
export default async function TemaPage() {
  const session = await getSession();
  const [templates, collections, products, brandColor, galleryLayout, storeTheme] = await Promise.all([
    listTemplates(),
    getCollectionAssignments(),
    getProductAssignments(),
    session ? getBrandColor(session.storeId) : Promise.resolve(null),
    session ? getProductGalleryLayout(session.storeId) : Promise.resolve("thumbnail-left"),
    session ? getStoreTheme(session.storeId) : Promise.resolve(null),
  ]);

  return (
    <TemaClient
      templates={templates}
      collections={collections}
      products={products}
      brandColor={brandColor ?? DEFAULT_BRAND_COLOR}
      galleryLayout={galleryLayout}
      storeTheme={storeTheme}
    />
  );
}
