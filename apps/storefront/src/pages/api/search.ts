// SEARCH SUGGESTIONS — what the ⌘K palette reads while the shopper types.
//
// Same shape as api/track.ts: the tenant comes from the Host header via src/middleware.ts
// (`locals.store` / `locals.catalog`) and NEVER from the request. A store id in a query string would
// let one shop's palette read another shop's catalogue.
//
// NO EXTRA DB WORK. `locals.catalog` is already built and cached per store per request, and
// `catalog.search()` is the same ranked, accent-insensitive matcher `/cari` renders — so the palette
// and the results page can never disagree about what matches. This endpoint is a projection of data
// already in memory, not a second search implementation.
//
// ⚠️ DELIBERATELY NOT RATE-LIMITED, and that is a decision rather than an oversight.
// `track.ts` and `checkout-session.ts` are gated because they WRITE — business metrics and a
// shopper's name/phone/address. This one reads a catalogue that is already public on `/produk`, in
// `sitemap.xml`, and on every category page. A gate here would add code and protect nothing; the real
// limits are the ones that bound the work: `q` capped at 100 chars, results capped below.
import type { APIRoute } from "astro";
import { imageSrcSet, inStock } from "../../data/catalog";

/** Enough for the palette to feel complete without turning it into the results page. */
const MAX_PRODUCTS = 6;
const MAX_CATEGORIES = 4;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Per-shopper, changes with the catalogue, and cheap to recompute — never cache it at the edge.
      "cache-control": "no-store",
    },
  });

export const GET: APIRoute = ({ url, locals }) => {
  const { catalog } = locals;

  // Trim then cap: it is a search string, not a validated field (AGENTS.md — normalise generously,
  // reject narrowly). The only guard is a sane length so a pathological URL cannot drive the matcher.
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);

  // Empty query → the store's real best-sellers, so opening the palette shows somewhere to GO rather
  // than an empty box. Same list the /cari landing uses, for the same reason.
  const products = q ? catalog.search(q) : catalog.bestsellers().slice(0, MAX_PRODUCTS);

  // Categories are matched here rather than in `catalog.search()` (which is products-only, and should
  // stay that way — `/cari` renders a product grid). Plain substring, accent-folded the same way.
  const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const needle = fold(q);
  const categories = q
    ? catalog.collections.filter((c) => fold(c.name).includes(needle)).slice(0, MAX_CATEGORIES)
    : [];

  return json({
    q,
    products: products.slice(0, MAX_PRODUCTS).map((p) => ({
      handle: p.handle,
      name: p.name,
      // `""` when the product has no photo — the palette draws its own placeholder rather than a
      // broken image, exactly like ProductCard. Never fabricate a URL from the handle.
      image: p.image,
      // ⚠️ THE SRCSET IS BUILT HERE, ON THE SERVER, AND THAT IS THE WHOLE DESIGN.
      // The palette assembles its rows as an HTML string in the browser, so it cannot call
      // `imageSrcSet` — that helper reads `STATIC_IMAGE_WIDTHS`, a 5,2 KB generated manifest of all
      // 75 static sources. Shipping the manifest to every visitor of every page to serve at most six
      // rows behind an interaction would be a 5 KB JS regression wearing a fix's clothes. Answering
      // it here costs ~110 B of JSON per row, only on the request that needs it, and keeps ONE
      // implementation of "which renditions exist" (AGENTS.md: a descriptor is the one field in a
      // candidate the browser cannot verify).
      // `undefined` for an image with no ladder — `JSON.stringify` drops the key, and the palette
      // then renders a bare `src`, byte-identically to before. No claim beats a wrong one.
      srcset: imageSrcSet(p.image),
      price: p.price,
      category: p.category,
      // Sold out is decided by the ONE rule (data/catalog.ts). The palette must not invite a click on
      // something the order endpoint would refuse, and it must not re-derive the test.
      soldOut: !inStock(p),
    })),
    categories: categories.map((c) => ({ handle: c.handle, name: c.name })),
  });
};
