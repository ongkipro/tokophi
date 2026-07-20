// Storefront catalog — PER-REQUEST, PER-STORE (ADR 0009 / PROD_PLAN §5).
//
// Was: module-level top-level `await db.select(...)` for a hardcoded "batik-nusantara" slug, i.e.
// one store, loaded once at server boot. Now: `getCatalog(store)` for the store the middleware
// resolved from the request's Host header (src/data/store.ts), memoized in-process with a short
// TTL (src/data/cache.ts) so a page view is normally 0 queries.
//
// INVARIANT: nothing here runs at module scope / build time — `astro build` must stay DB-FREE
// (the Docker image is built without DATABASE_URL). All DB access happens inside these functions.
import { db, schema } from "@tokophi/db";
import { and, asc, eq } from "drizzle-orm";
import type { StoredTemplateData } from "@tokophi/sections";
import { cached } from "./cache";
import type { StoreInfo } from "./store";
import { brandShadesFor, getStoreTemplates, resolveTemplate, type StoreTemplates } from "./theme";

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export type Collection = {
  handle: string;
  name: string;
  emoji: string;
  blurb: string;
  /** Merchant-uploaded cover, already absolute via `mediaUrl` ("" = none, fall back to the emoji). */
  imageUrl: string;
  /** ADR 0009 — the named `category` template this collection renders with (null = store default). */
  templateId: string | null;
};

export type VariantRow = { option1: string | null; option2: string | null; price: number; stock: number };
export type Product = {
  handle: string;
  name: string;
  price: number;
  compareAt?: number;
  category: string;
  categoryHandle: string;
  image: string;
  description: string;
  sizes: string[];
  badge?: string;
  /** ⚠️ A merchant FLAG, and it disagrees with the data: the demo flags hijab-voal (321 sold) and
      not celana-kulot (869). `bestsellers()` no longer reads it — see there. */
  bestseller?: boolean;
  /** All-time units sold. THE number "Paling Dicari" is a claim about. */
  unitsSold: number;
  options?: { name: string; values: string[] }[]; // real variant option types (e.g. Warna, Ukuran)
  variants?: VariantRow[]; // one row per option combo (price + stock)
  createdAt: number; // epoch ms — for the "terbaru" Grid Produk mode (ADR 0009)
  /** ADR 0009 — the named `product` template this product renders with (null = store default). */
  templateId: string | null;
};
export type Rating = { value: number; count: number };
export type Review = { rating: number; author: string; body: string; reply: string | null; daysAgo: number };

/** Everything one store's pages need. Built once per store per TTL, then reused across requests. */
export type Catalog = {
  store: StoreInfo;
  collections: Collection[];
  products: Product[];
  /** Merchant's Store Builder homepage, or null → the hand-built default homepage. */
  homepageTemplate: StoredTemplateData | null;
  /** All of the store's templates, loaded once with the catalog (see src/data/theme.ts). */
  templates: StoreTemplates;
  /**
   * Template for /kategori/<handle>: the collection's own `template_id` → the store's default
   * `category` template → null (= the hand-built category page). `semua` has no row (it is the one
   * virtual handle left), so it gets the store default.
   */
  categoryTemplate: (handle: string) => StoredTemplateData | null;
  /** Template for /produk/<handle>: the product's `template_id` → store default `product` → null. */
  productTemplate: (p: Product) => StoredTemplateData | null;
  /** 11-shade scale derived from the store's brand hex — injected as CSS vars by Layout.astro. */
  brandShades: Record<string, string>;
  /** `null` = this product has no published reviews. Render NO stars — do not invent a default. */
  productRating: (p: Product | string) => Rating | null;
  /** Real 5★→1★ counts from the review rows. */
  ratingHistogram: (p: Product | string) => number[];
  /** Published reviews that have text (the testimonials shown on the PDP), newest first, capped. */
  productReviews: (p: Product | string) => Review[];
  bestsellers: (list?: Product[]) => Product[];
  byCollection: (handle: string) => Product[];
  findProduct: (handle: string) => Product | undefined;
  findCollection: (handle: string) => Collection | undefined;
};

/**
 * Handles `pages/kategori/[handle].astro` serves from its own VIRTUAL map — a computed view over the
 * store's products rather than a `collections` row. Excluded from `catalog.collections` (that list is
 * the store's REAL categories) and typed against [handle].astro's map so the two cannot drift.
 *
 * ⚠️ `promo-gajian` and `produk-terlaris` were on this list and are NOT any more. They are real rows
 * with real `collection_products` membership (8 and 10 products on the demo) — the only reason they
 * looked virtual is that `byCollection` could not see membership at all, so they came back empty and
 * the page invented a substitute. Now that membership is read they resolve like any other collection:
 * the merchant's curation, not our filter.
 *
 * `semua` is the only one left, and it earns it: no store has such a row, and "everything you sell"
 * is not a curation a merchant should have to maintain by hand.
 */
export const VIRTUAL_COLLECTION_HANDLES = ["semua"] as const;
export type VirtualCollectionHandle = (typeof VIRTUAL_COLLECTION_HANDLES)[number];
const isVirtualHandle = (h: string): boolean => (VIRTUAL_COLLECTION_HANDLES as readonly string[]).includes(h);

// Merchant-uploaded media is stored as a relative /api/uploads/<name> path served by the ADMIN app.
// The storefront runs on a different origin, so rewrite those to absolute (admin base derived from
// PUBLIC_ONGKIR_API — no extra env). Seeded /products/*.webp stay relative (served from public/).
const ADMIN_BASE = (() => {
  try {
    // RUNTIME env, not import.meta.env: built without env, the build-time read bakes in as undefined
    // and every merchant-uploaded product image would resolve against localhost. See store.ts.
    return new URL(process.env.PUBLIC_ONGKIR_API || "http://localhost:3000").origin;
  } catch {
    return "";
  }
})();
const UPLOAD_PATH = "/api/uploads/";
/** Absolute-ize an admin-served upload path (product media + the store logo). */
export const mediaUrl = (u: string) => (u.startsWith(UPLOAD_PATH) ? ADMIN_BASE + u : u);

// ── RESPONSIVE IMAGES ─────────────────────────────────────────────────────────────────────────────
//
// ⚠️ ONLY merchant uploads can be resized. `/api/uploads/*` is served by the ADMIN app, whose route
// understands `?w=`; seeded `/products/*.webp` are static files served by the STOREFRONT container,
// where `?w=` is a meaningless query string on the same full-size bytes — a srcset there would tell
// the browser four renditions exist, get four identical downloads' worth of nothing, and let it pick
// a "200w" candidate that is really 1000px. Worse than no srcset. The distinction is exactly the one
// `mediaUrl` already makes, so it is made ONCE, here — not re-derived per component.
const isUploadUrl = (u: string) =>
  u.startsWith(UPLOAD_PATH) || (!!ADMIN_BASE && u.startsWith(ADMIN_BASE + UPLOAD_PATH));

/** Must match WIDTHS in `apps/admin/app/api/uploads/[name]/route.ts` — that route REJECTS (400) any
 *  width not on its allow-list, so a value added here and not there is a broken candidate. */
const WIDTHS = [200, 400, 800, 1200];

/**
 * A `srcset` for a merchant upload, or `undefined` for anything else (seeded static images, and the
 * empty string a product with no photo carries). `undefined` is deliberate: Astro omits the
 * attribute entirely, so the no-image and seed paths render byte-identically to before.
 *
 * Takes a URL that has ALREADY been through `mediaUrl` — that is what the catalog hands out.
 */
export const imageSrcSet = (u: string): string | undefined =>
  u && isUploadUrl(u) ? WIDTHS.map((w) => `${u}?w=${w} ${w}w`).join(", ") : undefined;

async function loadCatalog(store: StoreInfo): Promise<Catalog> {
  const storeId = store.id;

  const colRows = await db.select().from(schema.collections).where(eq(schema.collections.storeId, storeId));

  // ── WHAT IS IN A COLLECTION — read from `collection_products`, never guessed ───────────────────
  //
  // `byCollection` used to be `products.filter(p => slugify(p.category) === handle)`: membership
  // inferred by SLUGIFYING A PRODUCT'S CATEGORY TEXT and hoping it equalled the collection's handle.
  // `collection_products` — the table the admin's Kategori editor writes, the merchant's actual
  // curation — was not read at all.
  //
  // It only ever worked for the demo, whose category strings happen to slugify onto its handles, and
  // it was wrong in the way that matters most: **"Promo Gajian" is a MANUAL collection**. The
  // merchant hand-picked 8 products into it; the storefront rendered
  // `PRODUCTS.filter(p => p.compareAt || p.bestseller)` — a guess, from a hardcoded VIRTUAL map. A
  // merchant built a promo and the shop showed different goods.
  //
  // Keyed by product HANDLE (not id) because that is what `Product` carries. Intersecting with the
  // loaded `products` — already filtered to active/non-archived — is what keeps a DRAFT product out:
  // `promo-gajian` really does list `gamis-syari`, which is a draft.
  const memberRows = await db
    .select({ collectionHandle: schema.collections.handle, productHandle: schema.products.handle })
    .from(schema.collectionProducts)
    .innerJoin(schema.collections, eq(schema.collections.id, schema.collectionProducts.collectionId))
    .innerJoin(schema.products, eq(schema.products.id, schema.collectionProducts.productId))
    .where(eq(schema.collections.storeId, storeId));
  const membersByHandle = new Map<string, Set<string>>();
  for (const m of memberRows) {
    const set = membersByHandle.get(m.collectionHandle) ?? new Set<string>();
    set.add(m.productHandle);
    membersByHandle.set(m.collectionHandle, set);
  }

  // The store's OWN categories — derived from its rows, never from a constant.
  //
  // Was: `CATEGORY_ORDER`, a hardcoded allowlist of the DEMO store's six handles ("dress", "atasan",
  // …). Any other merchant's real collections were INVISIBLE to their own storefront — no category
  // grid, no "Kategori" dropdown, and `/kategori/<their-handle>` 404'd, because `findCollection` is
  // built from this list. Last of the family: the demo's content living in a platform default.
  //
  // Two filters the allowlist silently bypassed, both of which are the shopper's business:
  //   · `published = false` — a DRAFT category. The seed ships `outerwear` as one, and the allowlist
  //     named it anyway, so the demo has been publishing a category its merchant had switched OFF.
  //   · `archived_at` — deleted. Nothing archives a collection today, but the column decides, not us.
  //
  // ORDER: `collections` has NO ordering column (no `position`, not even `created_at` — checked), so
  // there is nothing to honour and insertion order is a random uuid away from meaningless. Sorted by
  // TITLE, id-ID collation: stable across requests, identical for every tenant, and the one order a
  // shopper can predict when scanning a category list. It is deliberately NOT the demo's old order
  // (Dress first) — reproducing that requires exactly the constant this change removes. When the
  // merchant wants their own order, the fix is a `position` column + the Kategori editor, not a list
  // in the storefront's source.
  const collections: Collection[] = colRows
    .filter((c) => c.published && !c.archivedAt && !isVirtualHandle(c.handle))
    .map((c) => ({
      handle: c.handle,
      name: c.title,
      emoji: c.emoji ?? "",
      blurb: c.description ?? "",
      // The Kategori editor writes `collections.image_url`. Until now nothing read it, so a merchant
      // could upload a cover, see it saved in the admin, and never see it on their own shop — the
      // column was half-wired. `mediaUrl` makes the admin-served /api/uploads/ path absolute.
      imageUrl: c.imageUrl ? mediaUrl(c.imageUrl) : "",
      templateId: c.templateId,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "id-ID"));

  // handle → assigned category template, for EVERY collection row (not just the 6 in the nav).
  const collectionTemplateId = new Map(colRows.map((c) => [c.handle, c.templateId]));

  // products ⋈ default variant (price/compareAt) ⋈ primary media (image); non-archived, oldest→newest.
  const rows = await db
    .select({
      id: schema.products.id,
      handle: schema.products.handle,
      name: schema.products.title,
      description: schema.products.description,
      category: schema.products.category,
      sizes: schema.products.sizes,
      badge: schema.products.badge,
      bestseller: schema.products.bestseller,
      unitsSold: schema.products.unitsSold,
      ratingValue: schema.products.ratingValue,
      ratingCount: schema.products.ratingCount,
      createdAt: schema.products.createdAt,
      templateId: schema.products.templateId,
      price: schema.productVariants.priceIdr,
      compareAt: schema.productVariants.compareAtIdr,
      image: schema.productMedia.url,
    })
    .from(schema.products)
    .innerJoin(
      schema.productVariants,
      and(eq(schema.productVariants.productId, schema.products.id), eq(schema.productVariants.position, 0)),
    )
    .leftJoin(
      schema.productMedia,
      and(eq(schema.productMedia.productId, schema.products.id), eq(schema.productMedia.position, 0)),
    )
    // `= 'active'`, not `!= 'archived'`. The enum is active | draft | archived, and excluding only the
    // archived left DRAFTS on the shop: the demo publishes `gamis-syari` and `dress-batik` — 2 of its
    // 14 products — in the grid, on the PDP, and into the cart.
    //
    // The teeth were already in place and pointed the other way: `/api/public/order` looks products up
    // with `eq(status, "active")`, so a draft is NOT buyable. So the shopper could browse it, open it,
    // add it, fill in their name, address, kecamatan and payment — and only then be told the product
    // does not exist. The boundary was right; the shopfront was lying to it.
    //
    // Same rule the collections above now follow (`published`): the merchant's publication state
    // decides what a shopper is allowed to see, not us.
    .where(and(eq(schema.products.storeId, storeId), eq(schema.products.status, "active")))
    .orderBy(asc(schema.products.createdAt));

  // real variants: option types + a row per combo (price/stock), keyed by product id
  const optRows = await db
    .select({ productId: schema.productOptions.productId, name: schema.productOptions.name })
    .from(schema.productOptions)
    .innerJoin(schema.products, eq(schema.products.id, schema.productOptions.productId))
    .where(eq(schema.products.storeId, storeId))
    .orderBy(asc(schema.productOptions.position));
  const varRows = await db
    .select({
      productId: schema.productVariants.productId,
      option1: schema.productVariants.option1,
      option2: schema.productVariants.option2,
      price: schema.productVariants.priceIdr,
      stock: schema.inventoryLevels.available,
    })
    .from(schema.productVariants)
    .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
    .leftJoin(schema.inventoryLevels, eq(schema.inventoryLevels.variantId, schema.productVariants.id))
    .where(eq(schema.products.storeId, storeId))
    .orderBy(asc(schema.productVariants.position));

  const optNamesById = new Map<string, string[]>();
  for (const o of optRows) {
    const l = optNamesById.get(o.productId) ?? [];
    l.push(o.name);
    optNamesById.set(o.productId, l);
  }
  const variantsById = new Map<string, VariantRow[]>();
  for (const v of varRows) {
    const l = variantsById.get(v.productId) ?? [];
    l.push({ option1: v.option1, option2: v.option2, price: v.price, stock: v.stock ?? 0 });
    variantsById.set(v.productId, l);
  }

  const optionsFor = (id: string): { name: string; values: string[] }[] => {
    const names = optNamesById.get(id) ?? [];
    const vlist = variantsById.get(id) ?? [];
    return names.map((name, i) => {
      const key = (i === 0 ? "option1" : "option2") as "option1" | "option2";
      const seen = new Set<string>();
      const values: string[] = [];
      for (const v of vlist) {
        const val = v[key];
        if (val && !seen.has(val)) {
          seen.add(val);
          values.push(val);
        }
      }
      return { name, values };
    });
  };

  const products: Product[] = rows.map((r) => {
    const options = optionsFor(r.id);
    const variants = variantsById.get(r.id) ?? [];
    return {
      handle: r.handle,
      name: r.name,
      price: r.price,
      compareAt: r.compareAt ?? undefined,
      category: r.category ?? "",
      categoryHandle: slugify(r.category ?? ""),
      // "" = this product has no photo. It used to GUESS a filename from the handle
      // (`/products/${r.handle}.webp`), which is a convention only the SEED follows: `r.image` comes
      // from the product_media join, so a merchant who creates a product and does not upload a photo
      // has no row, the guess points at a file that was never written, and every card in every grid
      // renders the browser's broken-image glyph. Latent on the demo store (all 14 products have
      // media and the guessed files happen to exist) and guaranteed on the first real merchant.
      // Callers render a placeholder instead — never fabricate a URL you have not been given.
      image: r.image ? mediaUrl(r.image) : "",
      description: r.description ?? "",
      sizes: (r.sizes as string[] | null) ?? [],
      badge: r.badge ?? undefined,
      bestseller: r.bestseller,
      unitsSold: Number(r.unitsSold ?? 0),
      options: options.length ? options : undefined,
      variants: variants.length ? variants : undefined,
      createdAt: r.createdAt.getTime(),
      templateId: r.templateId,
    };
  });

  // RATINGS — aggregated from the REAL `reviews` table, published rows only.
  //
  // `products.rating_value` / `rating_count` are written by exactly one thing: the seed. Nothing ever
  // recomputes them from `reviews`, so the PDP was advertising "4.8 · 187 ulasan" on a catalog that
  // holds 8 reviews in total (5 published). Worse, the old fallbacks (`?? 4.5` and `{value:4.5,
  // count:40}`) handed a brand-new store 4.5 stars on a product with zero reviews, forever.
  //
  // A star rating is the strongest purchase signal on the page and an advertising claim under
  // Indonesian consumer law — and the merchant's real, moderated reviews were never reaching a
  // shopper at all. So: count what exists, and when nothing exists, say nothing.
  //
  // `null` (not a default) is the answer for "no reviews yet" — the UI must render no stars at all,
  // because "0 ulasan · ★☆☆☆☆" reads as a bad product rather than a new one.
  const reviewRows = await db
    .select({
      productId: schema.reviews.productId,
      rating: schema.reviews.rating,
      body: schema.reviews.body,
      reply: schema.reviews.reply,
      createdAt: schema.reviews.createdAt,
      author: schema.customers.name,
    })
    .from(schema.reviews)
    .leftJoin(schema.customers, eq(schema.customers.id, schema.reviews.customerId))
    .where(and(eq(schema.reviews.storeId, storeId), eq(schema.reviews.status, "terbit")));

  // First name + last initial ("Siti Nurhaliza" → "Siti N.") — the way a review site shows a buyer,
  // enough to feel real without publishing a full name.
  const authorName = (n: string | null): string => {
    if (!n?.trim()) return "Pelanggan";
    const parts = n.trim().split(/\s+/);
    return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
  };
  const nowMs = Date.now();

  const byProduct = new Map<string, number[]>();
  const reviewsByProduct = new Map<string, Review[]>();
  for (const r of reviewRows) {
    if (!r.productId) continue;
    const list = byProduct.get(r.productId) ?? [];
    list.push(r.rating);
    byProduct.set(r.productId, list);
    // Only rows WITH text become testimonials — a bare star still counts toward the average/histogram.
    if (r.body?.trim()) {
      const rl = reviewsByProduct.get(r.productId) ?? [];
      rl.push({
        rating: r.rating,
        author: authorName(r.author),
        body: r.body.trim(),
        reply: r.reply?.trim() || null,
        daysAgo: Math.max(0, Math.floor((nowMs - new Date(r.createdAt).getTime()) / 86_400_000)),
      });
      reviewsByProduct.set(r.productId, rl);
    }
  }
  const ratings: Record<string, Rating> = {};
  const starsByHandle: Record<string, number[]> = {};
  const reviewsByHandle: Record<string, Review[]> = {};
  for (const r of rows) {
    const stars = byProduct.get(r.id) ?? [];
    if (!stars.length) continue; // no reviews → no entry → productRating() returns null
    const sum = stars.reduce((a, b) => a + b, 0);
    ratings[r.handle] = { value: Math.round((sum / stars.length) * 10) / 10, count: stars.length };
    starsByHandle[r.handle] = stars;
    const rl = reviewsByProduct.get(r.id);
    if (rl) reviewsByHandle[r.handle] = rl.sort((a, b) => a.daysAgo - b.daysAgo).slice(0, 12);
  }

  // ADR 0009 — all page templates in one query, cached with the catalog: rendering a template
  // (any number of sections) costs ZERO extra DB round-trips at request time.
  const templates = await getStoreTemplates(storeId);

  return {
    store,
    collections,
    products,
    homepageTemplate: templates.homepage,
    templates,
    categoryTemplate: (handle) =>
      resolveTemplate(templates, collectionTemplateId.get(handle) ?? null, templates.categoryDefault),
    productTemplate: (p) => resolveTemplate(templates, p.templateId, templates.productDefault),
    brandShades: brandShadesFor(store.brandColor),
    productRating: (p) => ratings[typeof p === "string" ? p : p.handle] ?? null,
    // The real 5→1 histogram, counted from the actual review rows — not a curve fitted to a fake mean.
    ratingHistogram: (p) => {
      const stars = starsByHandle[typeof p === "string" ? p : p.handle] ?? [];
      const buckets = [0, 0, 0, 0, 0]; // index 0 = 5★ … index 4 = 1★
      for (const n of stars) {
        const i = 5 - Math.min(5, Math.max(1, n));
        buckets[i] += 1;
      }
      return buckets;
    },
    productReviews: (p) => reviewsByHandle[typeof p === "string" ? p : p.handle] ?? [],
    // SORTED BY units_sold, not filtered by a flag — so "Paling Dicari" is true by construction and
    // `limit` means "the top N" instead of "however many happen to be ticked".
    //
    // It was `list.filter(p => p.bestseller)`. Two things were wrong at once. The flag CONTRADICTS the
    // data sitting in the next column: the demo flags `hijab-voal` (321 sold) and `blouse-katun`, and
    // does NOT flag `celana-kulot` (869) or `kemeja-oversized` (818) — so the shop's "most wanted"
    // shelf was the merchant's guess, not their sales. And it returned however many were ticked (3),
    // so a 4-up grid had a hole in it; `keranjang.astro` had already grown a workaround to top the row
    // up from the rest of the catalogue, which is the symptom of exactly this.
    //
    // The registry's own comment on `mode: "terlaris"` claimed it "sorts the whole catalog by all-time
    // units_sold". It did not. Now it does, and the comment is true.
    bestsellers: (list = products) => list.slice().sort((a, b) => b.unitsSold - a.unitsSold),
    // The merchant's own membership. A handle with no rows returns [] — NOT "everything whose
    // category text happens to slugify to this", which is how a manual collection used to render
    // somebody else's guess.
    byCollection: (handle) => {
      const members = membersByHandle.get(handle);
      if (!members) return [];
      return products.filter((p) => members.has(p.handle));
    },
    findProduct: (handle) => products.find((p) => p.handle === handle),
    findCollection: (handle) => collections.find((c) => c.handle === handle),
  };
}

/** The resolved store's catalog. Memoized per store id (short TTL) — see src/data/cache.ts. */
export async function getCatalog(store: StoreInfo): Promise<Catalog> {
  return cached(`catalog:${store.id}`, () => loadCatalog(store));
}

// ---- pure helpers (no store scope needed) ----

// REMOVED: `ratingBreakdown()` fitted a plausible-looking star distribution to an aggregate score.
// It never counted anything — it manufactured a histogram. Use `catalog.ratingHistogram(product)`,
// which counts the real review rows.

// Seeded products have a 5-image gallery by convention (base + -2..-5). Merchant-uploaded images
// (absolute /api/uploads/) have no such siblings, so show just the primary.
export const productImages = (p: Product): string[] =>
  // No photo at all → no gallery. Returning [""] would render <img src=""> which the browser
  // resolves against the PAGE url, downloads the HTML, and shows as a broken image.
  !p.image
    ? []
    : p.image.includes("/products/")
      ? [p.image, ...[2, 3, 4, 5].map((n) => p.image.replace(/\.webp$/, `-${n}.webp`))]
      : [p.image];

// Newest first — for the Grid Produk "terbaru" mode.
export const recentProducts = (list: Product[]) => [...list].sort((a, b) => b.createdAt - a.createdAt);

// Shuffled — for the Grid Produk "acak" mode. Server-rendered only, no client hydration to
// mismatch (the admin's mock-data determinism rule is about a different, React SSR+CSR concern).
export const randomProducts = (list: Product[]) => {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

// Payment channels offered at checkout (+ COD). Platform-wide (not store-scoped) → own cache key.
//
// BOTH flags must hold, and the difference is the shopper's money:
//   `enabled` — WE (super-admin) chose to offer it.
//   `active`  — AUTOLARIS actually accepts it, from a live probe (`create_payment` → rc == "00").
//
// This used to filter on `enabled` alone. It only ever worked because the two sets happened to
// coincide (6 channels: QRIS + 5 VA). The moment anyone enables a channel the gateway has NOT
// activated — the obvious thing to do when you want to "turn everything on and test" — the shopper
// is shown a payment method that CANNOT be charged: they pick OVO, we call create_payment, AutoLaris
// answers rc=07, and the sale dies at the last step with the buyer's money already in hand mentally.
// Probed live 2026-07-14: 6 active (rc=00), 9 refused (rc=07 — BSI, CIMB, Danamon, DANA, ShopeePay,
// LinkAja, GoPay, Alfamart, Indomaret). An `enabled` flag is an intention; `active` is a fact. Offer
// only what the gateway will actually take.
//
// Note the asymmetry this fixes: the merchant's own SUBSCRIPTION payment (admin
// `lib/actions/payment-settings.ts`) already filtered on `enabled && active` — so we were protecting
// our own invoice while exposing the shopper's checkout. Backwards.
export async function enabledPaymentChannels(): Promise<{ code: string; label: string; kind: string }[]> {
  return cached("platform:payment-channels", async () => {
    const rows = await db
      .select()
      .from(schema.platformPaymentChannels)
      .where(and(eq(schema.platformPaymentChannels.enabled, true), eq(schema.platformPaymentChannels.active, true)))
      .orderBy(asc(schema.platformPaymentChannels.id));
    return rows.map((r) => ({ code: r.channel, label: r.label, kind: r.kind }));
  });
}

// COD (bayar di tempat) — what checkout needs to decide whether to OFFER the option.
//
// `enabled` = the MERCHANT switched it on (store_settings.cod_enabled, migration 0038, default
// false) AND the platform allows COD at all (platform_cod.enabled). The remaining limits are
// per-ORDER, so they are handed to the page and evaluated live as the shopper fills the form:
//   · maxAmountIdr    — platform_cod.max_amount_idr (0 = no cap), checked against subtotal + ongkir
//   · allowedProvinces — platform_cod.allowed_provinces ([] = anywhere), checked against the province
//   · per-service      — /api/public/ongkir stamps each rate with the EFFECTIVE `cod` flag
// Every one of these is re-checked by /api/public/order (apps/admin/lib/cod.ts) — THAT is the
// boundary; this only decides what to render, so a shopper is never offered a COD we would reject.
// Merchant PPN, read for the checkout display so the shopper sees the same total the order API charges
// (both use @tokophi/lib computeTax). OFF unless the merchant opted in. /api/public/order re-reads
// these columns and is the authoritative money — this only decides what the summary shows.
export type StoreTax = { enabled: boolean; ratePct: number; inclusive: boolean };

export async function storeTaxSettings(storeId: string): Promise<StoreTax> {
  // NOT cached: the order API reads these columns live, so a cached value here would let the checkout
  // render one PPN while the order charges another for the length of the TTL right after a merchant
  // changes the setting. A single PK lookup per checkout SSR is cheap; charging ≠ shown is not.
  const [ss] = await db
    .select({ enabled: schema.storeSettings.taxEnabled, ratePct: schema.storeSettings.taxRatePct, inclusive: schema.storeSettings.taxInclusive })
    .from(schema.storeSettings)
    .where(eq(schema.storeSettings.storeId, storeId))
    .limit(1);
  return { enabled: !!ss?.enabled, ratePct: Number(ss?.ratePct ?? 0), inclusive: !!ss?.inclusive };
}

export type StoreCodPolicy = { enabled: boolean; maxAmountIdr: number; allowedProvinces: string[] };

export async function storeCodPolicy(storeId: string): Promise<StoreCodPolicy> {
  return cached(`store:cod:${storeId}`, async () => {
    const [[ss], [pc]] = await Promise.all([
      db
        .select({ cod: schema.storeSettings.codEnabled })
        .from(schema.storeSettings)
        .where(eq(schema.storeSettings.storeId, storeId))
        .limit(1),
      db
        .select({
          enabled: schema.platformCod.enabled,
          maxAmountIdr: schema.platformCod.maxAmountIdr,
          allowedProvinces: schema.platformCod.allowedProvinces,
        })
        .from(schema.platformCod)
        .limit(1),
    ]);
    const list = Array.isArray(pc?.allowedProvinces) ? (pc.allowedProvinces as unknown[]) : [];
    return {
      enabled: !!ss?.cod && !!pc?.enabled,
      maxAmountIdr: Number(pc?.maxAmountIdr ?? 0),
      allowedProvinces: list.filter((p): p is string => typeof p === "string" && !!p.trim()),
    };
  });
}

/** Just the on/off bit (homepage values band — no order in scope there). */
export async function storeCodEnabled(storeId: string): Promise<boolean> {
  return (await storeCodPolicy(storeId)).enabled;
}
