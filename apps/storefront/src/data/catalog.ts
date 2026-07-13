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
import { and, asc, eq, ne } from "drizzle-orm";
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
  bestseller?: boolean;
  options?: { name: string; values: string[] }[]; // real variant option types (e.g. Warna, Ukuran)
  variants?: VariantRow[]; // one row per option combo (price + stock)
  createdAt: number; // epoch ms — for the "terbaru" Grid Produk mode (ADR 0009)
  /** ADR 0009 — the named `product` template this product renders with (null = store default). */
  templateId: string | null;
};
export type Rating = { value: number; count: number };

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
   * `category` template → null (= the hand-built category page). Virtual collections
   * ("semua", "promo-gajian") have no row, so they get the store default.
   */
  categoryTemplate: (handle: string) => StoredTemplateData | null;
  /** Template for /produk/<handle>: the product's `template_id` → store default `product` → null. */
  productTemplate: (p: Product) => StoredTemplateData | null;
  /** 11-shade scale derived from the store's brand hex — injected as CSS vars by Layout.astro. */
  brandShades: Record<string, string>;
  productRating: (p: Product | string) => Rating;
  bestsellers: (list?: Product[]) => Product[];
  byCollection: (handle: string) => Product[];
  findProduct: (handle: string) => Product | undefined;
  findCollection: (handle: string) => Collection | undefined;
};

// The 6 shopper-facing category collections (in display order).
const CATEGORY_ORDER = ["dress", "atasan", "bawahan", "busana-muslim", "outerwear", "loungewear"];

// Merchant-uploaded media is stored as a relative /api/uploads/<name> path served by the ADMIN app.
// The storefront runs on a different origin, so rewrite those to absolute (admin base derived from
// PUBLIC_ONGKIR_API — no extra env). Seeded /products/*.webp stay relative (served from public/).
const ADMIN_BASE = (() => {
  try {
    return new URL(import.meta.env.PUBLIC_ONGKIR_API || "http://localhost:3000").origin;
  } catch {
    return "";
  }
})();
/** Absolute-ize an admin-served upload path (product media + the store logo). */
export const mediaUrl = (u: string) => (u.startsWith("/api/uploads/") ? ADMIN_BASE + u : u);

async function loadCatalog(store: StoreInfo): Promise<Catalog> {
  const storeId = store.id;

  const colRows = await db.select().from(schema.collections).where(eq(schema.collections.storeId, storeId));
  const collections: Collection[] = CATEGORY_ORDER.map((h) => colRows.find((c) => c.handle === h))
    .filter((c): c is (typeof colRows)[number] => Boolean(c))
    .map((c) => ({
      handle: c.handle,
      name: c.title,
      emoji: c.emoji ?? "",
      blurb: c.description ?? "",
      templateId: c.templateId,
    }));

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
    .where(and(eq(schema.products.storeId, storeId), ne(schema.products.status, "archived")))
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
      image: mediaUrl(r.image ?? `/products/${r.handle}.webp`),
      description: r.description ?? "",
      sizes: (r.sizes as string[] | null) ?? [],
      badge: r.badge ?? undefined,
      bestseller: r.bestseller,
      options: options.length ? options : undefined,
      variants: variants.length ? variants : undefined,
      createdAt: r.createdAt.getTime(),
      templateId: r.templateId,
    };
  });

  // ratings (aggregate score + count, denormalized on products)
  const ratings: Record<string, Rating> = Object.fromEntries(
    rows.map((r) => [r.handle, { value: r.ratingValue ?? 4.5, count: r.ratingCount }]),
  );

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
    productRating: (p) => ratings[typeof p === "string" ? p : p.handle] ?? { value: 4.5, count: 40 },
    bestsellers: (list = products) => list.filter((p) => p.bestseller),
    byCollection: (handle) => products.filter((p) => p.categoryHandle === handle),
    findProduct: (handle) => products.find((p) => p.handle === handle),
    findCollection: (handle) => collections.find((c) => c.handle === handle),
  };
}

/** The resolved store's catalog. Memoized per store id (short TTL) — see src/data/cache.ts. */
export async function getCatalog(store: StoreInfo): Promise<Catalog> {
  return cached(`catalog:${store.id}`, () => loadCatalog(store));
}

// ---- pure helpers (no store scope needed) ----

// Deterministic 5→1 star distribution that sums to `count` (for the review summary).
export const ratingBreakdown = (r: Rating): number[] => {
  const skew = (r.value - 4) / 1;
  const weights = [0.55 + skew * 0.35, 0.28 - skew * 0.12, 0.1, 0.045, 0.025];
  const raw = weights.map((w) => Math.round(w * r.count));
  const diff = r.count - raw.reduce((a, b) => a + b, 0);
  raw[0] += diff;
  return raw;
};

// Seeded products have a 5-image gallery by convention (base + -2..-5). Merchant-uploaded images
// (absolute /api/uploads/) have no such siblings, so show just the primary.
export const productImages = (p: Product): string[] =>
  p.image.includes("/products/")
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

// Payment channels the platform (super-admin) has enabled — offered at checkout (+ COD).
// Platform-wide (not store-scoped), so it gets its own cache key.
export async function enabledPaymentChannels(): Promise<{ code: string; label: string; kind: string }[]> {
  return cached("platform:payment-channels", async () => {
    const rows = await db
      .select()
      .from(schema.platformPaymentChannels)
      .where(eq(schema.platformPaymentChannels.enabled, true))
      .orderBy(asc(schema.platformPaymentChannels.id));
    return rows.map((r) => ({ code: r.channel, label: r.label, kind: r.kind }));
  });
}
