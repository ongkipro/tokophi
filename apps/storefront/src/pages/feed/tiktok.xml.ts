// Product feed for **TikTok Catalog Manager** (ADR 0013). Same builder as `/feed/google.xml`, different
// profile — TikTok is the one provider whose requirements cannot be met inside Google's:
//   • its documented required identifier field is `sku_id`, not `id`;
//   • `google_product_category` "only supports three levels", while Google wants the most specific leaf
//     (ADR 0011 maps apparel to 4-level leaves), so truncating for TikTok would degrade Google.
// Everything else — the item shape, the ids, the values — comes from the shared builder, so the two
// feeds cannot drift into disagreeing about what a product is.
import type { APIRoute } from "astro";
import { getStoreByHost } from "../../data/store";
import { getCatalog } from "../../data/catalog";
import { feedDocument, feedItems, PROFILES } from "../../lib/product-feed";
import type { CatalogIdScheme } from "@tokophi/lib/tracking-ids";

export const GET: APIRoute = async ({ request }) => {
  const host = request.headers.get("host");
  const store = await getStoreByHost(host);
  if (!store) return new Response("Store not found", { status: 404 });
  const origin = `https://${host}`;
  const catalog = await getCatalog(store);
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
