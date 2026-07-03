// Storefront catalog — reads the shared Postgres (@indostore/db) at build/SSR time.
// Same exports/shape as before; consumers (.astro pages) are unchanged. Single-tenant
// MVP: the one store. Later: scope by a STORE_SLUG env for per-client deploys (ADR 0008).
import { db, schema } from "@indostore/db";
import { and, asc, eq, ne } from "drizzle-orm";

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const storeRow = (await db.select().from(schema.stores).limit(1))[0];
const STORE_ID = storeRow!.id;

export const STORE = {
  name: storeRow?.name ?? "Batik Nusantara",
  tagline: "Busana wanita modern — batik & ready-to-wear",
  whatsapp: "6281234567890",
  city: storeRow?.city ?? "Yogyakarta",
};

export type Collection = { handle: string; name: string; emoji: string; blurb: string };

// The 6 shopper-facing category collections (in display order).
const CATEGORY_ORDER = ["dress", "atasan", "bawahan", "busana-muslim", "outerwear", "loungewear"];
const colRows = await db.select().from(schema.collections).where(eq(schema.collections.storeId, STORE_ID));
export const COLLECTIONS: Collection[] = CATEGORY_ORDER
  .map((h) => colRows.find((c) => c.handle === h))
  .filter((c): c is (typeof colRows)[number] => Boolean(c))
  .map((c) => ({ handle: c.handle, name: c.title, emoji: c.emoji ?? "", blurb: c.description ?? "" }));

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
};

// products ⋈ default variant (price/compareAt) ⋈ primary media (image); non-archived, oldest→newest.
const rows = await db
  .select({
    handle: schema.products.handle,
    name: schema.products.title,
    description: schema.products.description,
    category: schema.products.category,
    sizes: schema.products.sizes,
    badge: schema.products.badge,
    bestseller: schema.products.bestseller,
    ratingValue: schema.products.ratingValue,
    ratingCount: schema.products.ratingCount,
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
  .where(and(eq(schema.products.storeId, STORE_ID), ne(schema.products.status, "archived")))
  .orderBy(asc(schema.products.createdAt));

export const PRODUCTS: Product[] = rows.map((r) => ({
  handle: r.handle,
  name: r.name,
  price: r.price,
  compareAt: r.compareAt ?? undefined,
  category: r.category ?? "",
  categoryHandle: slugify(r.category ?? ""),
  image: r.image ?? `/products/${r.handle}.webp`,
  description: r.description ?? "",
  sizes: (r.sizes as string[] | null) ?? [],
  badge: r.badge ?? undefined,
  bestseller: r.bestseller,
}));

// ---- ratings (aggregate score + count, denormalized on products) ----
export type Rating = { value: number; count: number };
const RATINGS: Record<string, Rating> = Object.fromEntries(
  rows.map((r) => [r.handle, { value: r.ratingValue ?? 4.5, count: r.ratingCount }]),
);

export const productRating = (p: Product | string): Rating => {
  const handle = typeof p === "string" ? p : p.handle;
  return RATINGS[handle] ?? { value: 4.5, count: 40 };
};

// Deterministic 5→1 star distribution that sums to `count` (for the review summary).
export const ratingBreakdown = (r: Rating): number[] => {
  const skew = (r.value - 4) / 1;
  const weights = [0.55 + skew * 0.35, 0.28 - skew * 0.12, 0.1, 0.045, 0.025];
  const raw = weights.map((w) => Math.round(w * r.count));
  const diff = r.count - raw.reduce((a, b) => a + b, 0);
  raw[0] += diff;
  return raw;
};

// Each product has a 5-image gallery: base + -2..-5 (AI-generated catalog shots).
export const productImages = (p: Product): string[] => [
  p.image,
  ...[2, 3, 4, 5].map((n) => p.image.replace(/\.webp$/, `-${n}.webp`)),
];

export const bestsellers = () => PRODUCTS.filter((p) => p.bestseller);
export const byCollection = (handle: string) => PRODUCTS.filter((p) => p.categoryHandle === handle);
export const findProduct = (handle: string) => PRODUCTS.find((p) => p.handle === handle);
export const findCollection = (handle: string) => COLLECTIONS.find((c) => c.handle === handle);
