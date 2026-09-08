// Product feed for **Google Merchant Center and Meta Commerce** (ADR 0011 Phase 3, ADR 0013).
// Meta documents this exact RSS 2.0 + `g:` namespace format and the same field names, so one document
// serves both. TikTok needs its own (`sku_id`, a 3-level category cap) — `/feed/tiktok.xml`, same
// builder, different profile.
//
// Per-tenant: the store, catalog and canonical origin come from `locals` (src/middleware.ts).
import type { APIRoute } from "astro";
import { feedDocument, feedItems, PROFILES } from "../../lib/product-feed";
import type { CatalogIdScheme } from "@tokophi/lib/tracking-ids";

export const GET: APIRoute = async ({ locals }) => {
  // The tenant, its catalog and its PRIMARY origin all come from the middleware, exactly as
  // `sitemap.xml.ts` takes them. This used to re-resolve the store from the raw `Host` and build the
  // origin as `https://${host}` — which ignored `x-forwarded-*` and the store's primary custom domain,
  // so under a custom domain the feed's `<link>`s named `<slug>.tokophi.com` while every canonical
  // named the custom domain: two origins for one catalogue, and Meta/Google/TikTok match on URL
  // (page-map finding SF-1). `locals.origin` is `primaryOrigin(store, …)`; there is one producer.
  const { store, catalog, origin } = locals;
  const scheme = (store.catalogIdScheme === "number" ? "number" : "handle") as CatalogIdScheme;

  const items = catalog.products.flatMap((p) =>
    feedItems({ product: p, origin, storeName: store.name, scheme, profile: PROFILES.google }),
  );

  return new Response(feedDocument({ storeName: store.name, origin, items }), {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Google fetches at most daily, so an hour of edge cache is invisible to it. Meta and TikTok
      // offer HOURLY schedules, where an hour of TTL can mean a stock-out takes up to two hours to
      // propagate — acceptable for a feed (which is a snapshot by nature), but do not claim
      // "near-real-time stock" while this is 3600.
      //
      // ⚠️ `public` is safe ONLY because the response is keyed by Host and Cloudflare caches on
      // scheme+host+path. This body is one tenant's catalog: if anything ever fronts several stores on
      // a single cache key, this line leaks one merchant's products to another.
      "Cache-Control": "public, max-age=3600",
    },
  });
};
