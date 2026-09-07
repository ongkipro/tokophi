// Product feed for **TikTok Catalog Manager** (ADR 0013). Same builder as `/feed/google.xml`, different
// profile — TikTok is the one provider whose requirements cannot be met inside Google's:
//   • its documented required identifier field is `sku_id`, not `id`;
//   • `google_product_category` "only supports three levels", while Google wants the most specific leaf
//     (ADR 0011 maps apparel to 4-level leaves), so truncating for TikTok would degrade Google.
// Everything else — the item shape, the ids, the values — comes from the shared builder, so the two
// feeds cannot drift into disagreeing about what a product is.
import type { APIRoute } from "astro";
import { feedDocument, feedItems, PROFILES } from "../../lib/product-feed";
import type { CatalogIdScheme } from "@tokophi/lib/tracking-ids";

export const GET: APIRoute = async ({ locals }) => {
  // Store, catalog and PRIMARY origin from the middleware, like `sitemap.xml.ts` and `google.xml.ts`
  // (see the note there — SF-1: a raw-Host origin disagreed with the canonicals under a custom domain).
  const { store, catalog, origin } = locals;
  const scheme = (store.catalogIdScheme === "number" ? "number" : "handle") as CatalogIdScheme;

  const items = catalog.products.flatMap((p) =>
    feedItems({ product: p, origin, storeName: store.name, scheme, profile: PROFILES.tiktok }),
  );

  return new Response(feedDocument({ storeName: store.name, origin, items }), {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
