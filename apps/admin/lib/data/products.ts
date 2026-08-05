import "server-only";
import { schema } from "@tokophi/db";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Product } from "@/lib/mock/store";

// Flatten the normalized catalog (products ⋈ default variant ⋈ inventory ⋈ primary media)
// back into the admin's flat `Product` shape — signatures unchanged, screens untouched.
const selectProduct = {
  id: schema.products.id,
  name: schema.products.title,
  handle: schema.products.handle,
  // The merchant-facing catalog number (ADR 0013). This is the id a Merchant Center / Events Manager
  // error names, so it has to be visible somewhere the merchant can search — otherwise the number is
  // real but useless to the only person who needs it.
  number: schema.products.number,
  emoji: schema.products.emoji,
  status: schema.products.status,
  category: schema.products.category,
  unitsSold: schema.products.unitsSold,
  createdAt: schema.products.createdAt,
  price: schema.productVariants.priceIdr,
  stock: schema.inventoryLevels.available,
  image: schema.productMedia.url,
  // editor read-back: fields the editor writes but used to seed fake defaults on reopen
  description: schema.products.description,
  shortDescription: schema.products.shortDescription,
  productType: schema.products.productType,
  vendor: schema.products.vendor,
  seoTitle: schema.products.seoTitle,
  seoDesc: schema.products.seoDesc,
  googleCategoryId: schema.products.googleCategoryId,
  googleCategoryPath: schema.products.googleCategoryPath,
  gender: schema.products.gender,
  ageGroup: schema.products.ageGroup,
  material: schema.products.material,
  compareAt: schema.productVariants.compareAtIdr,
  cost: schema.productVariants.costIdr,
  sku: schema.productVariants.sku,
};

function base(db: Tx) {
  return db
    .select(selectProduct)
    .from(schema.products)
    .leftJoin(schema.productVariants, and(eq(schema.productVariants.productId, schema.products.id), eq(schema.productVariants.position, 0)))
    .leftJoin(schema.inventoryLevels, eq(schema.inventoryLevels.variantId, schema.productVariants.id))
    .leftJoin(schema.productMedia, and(eq(schema.productMedia.productId, schema.products.id), eq(schema.productMedia.position, 0)));
}

function toProduct(r: {
  id: string; name: string; handle: string; number?: number; emoji: string | null; status: "active" | "draft" | "archived";
  category: string | null; unitsSold: number; createdAt: Date; price: number | null; stock: number | null; image: string | null;
  weightMissing?: boolean; googleCategoryPath?: string | null;
}): Product {
  return {
    id: r.id,
    name: r.name,
    handle: r.handle,
    number: r.number ?? 0,
    emoji: r.emoji ?? "📦",
    image: r.image ?? `/products/${r.name}.webp`,
    // postgres returns aggregate numerics as strings unless a decoder is attached. Normalise at the
    // data boundary: `num("24")` deliberately renders "—" because a string is not a verified figure.
    price: Number(r.price ?? 0),
    stock: Number(r.stock ?? 0),
    status: r.status === "draft" ? "draft" : "active",
    category: r.category ?? "",
    unitsSold: r.unitsSold,
    addedTs: r.createdAt.getTime(),
    weightMissing: !!r.weightMissing,
    googleCategoryPath: r.googleCategoryPath ?? undefined,
  };
}

export async function getProducts(): Promise<Product[]> {
  return withCurrentTenant(async (db) => {
    // list shows the "from" price (min variant) + TOTAL stock across all variants
    const rows = await db
      .select({
        id: schema.products.id,
        name: schema.products.title,
        handle: schema.products.handle,
        number: schema.products.number,
        emoji: schema.products.emoji,
        status: schema.products.status,
        category: schema.products.category,
        unitsSold: schema.products.unitsSold,
        createdAt: schema.products.createdAt,
        googleCategoryPath: schema.products.googleCategoryPath, // functionally dependent on products.id (grouped) — no aggregate needed
        price: sql<number>`coalesce(min(${schema.productVariants.priceIdr}), 0)`.mapWith(Number),
        stock: sql<number>`coalesce(sum(${schema.inventoryLevels.available}), 0)`.mapWith(Number),
        // TRUE if ANY variant has no weight_grams — the checkout then prices that parcel with the 500g
        // fallback (lib/shipping-weight.ts), which can be wrong. Surfaced on the list so the fallback is
        // visible, not silent.
        weightMissing: sql<boolean>`bool_or(${schema.productVariants.weightGrams} is null)`,
        image: schema.productMedia.url,
      })
      .from(schema.products)
      .leftJoin(schema.productVariants, eq(schema.productVariants.productId, schema.products.id))
      .leftJoin(schema.inventoryLevels, eq(schema.inventoryLevels.variantId, schema.productVariants.id))
      .leftJoin(schema.productMedia, and(eq(schema.productMedia.productId, schema.products.id), eq(schema.productMedia.position, 0)))
      .where(ne(schema.products.status, "archived"))
      .groupBy(schema.products.id, schema.productMedia.url)
      .orderBy(desc(schema.products.createdAt));
    const productIds = rows.map((row) => row.id);
    const variants = productIds.length === 0 ? [] : await db
      .select({
        productId: schema.productVariants.productId,
        option1: schema.productVariants.option1,
        option2: schema.productVariants.option2,
        option3: schema.productVariants.option3,
        sku: schema.productVariants.sku,
        price: schema.productVariants.priceIdr,
        stock: schema.inventoryLevels.available,
      })
      .from(schema.productVariants)
      .leftJoin(schema.inventoryLevels, eq(schema.inventoryLevels.variantId, schema.productVariants.id))
      .where(inArray(schema.productVariants.productId, productIds))
      .orderBy(schema.productVariants.position);

    const variantsByProduct = new Map<string, Product["variants"]>();
    for (const variant of variants) {
      const rows = variantsByProduct.get(variant.productId) ?? [];
      rows.push({ ...variant, stock: variant.stock ?? 0 });
      variantsByProduct.set(variant.productId, rows);
    }

    return rows.map((row) => {
      const productVariants = variantsByProduct.get(row.id) ?? [];
      return { ...toProduct(row), hasVariants: productVariants.length > 1, variants: productVariants };
    });
  });
}

/**
 * Resolve a merchant-facing product NUMBER to its internal UUID (ADR 0013).
 *
 * The Seller's product URL is `/produk/1042`, Shopify-style — a number the merchant can read, search
 * for, and match against a Merchant Center disapproval. The UUID stays the primary key and every
 * foreign key; only the URL changed.
 *
 * ⚠️ The `store_id` filter is EXPLICIT, not left to RLS. `unique(store_id, number)` means `1042` is a
 * different product in every store, and a 4-digit number is enumerable in a way a UUID never was — so
 * this is precisely the query where "the WHERE is the rule and the policy is only the net" has to hold.
 */
export async function resolveProductIdByNumber(number: number): Promise<string | null> {
  // ⚠️ The UPPER bound is not decoration. `products.number` is `integer`, and Postgres answers a
  // larger literal with 22003 ("out of range") — a different error class from the 22P02 the route's
  // shape test guards, and it throws from inside the render, i.e. a 500 rather than a 404. A merchant
  // fat-fingering `/produk/10422222222` is all it takes.
  if (!Number.isInteger(number) || number <= 0 || number > 2_147_483_647) return null;
  return withCurrentTenant(async (db, storeId) => {
    const [row] = await db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(and(eq(schema.products.storeId, storeId), eq(schema.products.number, number)))
      .limit(1);
    return row?.id ?? null;
  });
}

/** The UUID → number direction, for redirecting an old bookmark to the canonical URL. */
export async function productNumberById(id: string): Promise<number | null> {
  return withCurrentTenant(async (db, storeId) => {
    const [row] = await db
      .select({ number: schema.products.number })
      .from(schema.products)
      .where(and(eq(schema.products.storeId, storeId), eq(schema.products.id, id)))
      .limit(1);
    return row?.number ?? null;
  });
}

export async function getProduct(id: string): Promise<Product | null> {
  return withCurrentTenant(async (db) => {
    const rows = await base(db).where(eq(schema.products.id, id)).limit(1);
    if (!rows[0]) return null;
    const media = await db
      .select({ id: schema.productMedia.id, url: schema.productMedia.url })
      .from(schema.productMedia)
      .where(eq(schema.productMedia.productId, id))
      .orderBy(schema.productMedia.position);

    const [prod] = await db
      .select({
        hasVariants: schema.products.hasVariants,
        lengthCm: schema.products.lengthCm,
        widthCm: schema.products.widthCm,
        heightCm: schema.products.heightCm,
      })
      .from(schema.products)
      .where(eq(schema.products.id, id))
      .limit(1);

    // option definitions (names, in order) + every variant with its option values + stock
    const optionRows = await db
      .select({ name: schema.productOptions.name, position: schema.productOptions.position })
      .from(schema.productOptions)
      .where(eq(schema.productOptions.productId, id))
      .orderBy(schema.productOptions.position);
    const variantRows = await db
      .select({
        option1: schema.productVariants.option1,
        option2: schema.productVariants.option2,
        option3: schema.productVariants.option3,
        sku: schema.productVariants.sku,
        price: schema.productVariants.priceIdr,
        position: schema.productVariants.position,
        weightGrams: schema.productVariants.weightGrams,
        stock: schema.inventoryLevels.available,
      })
      .from(schema.productVariants)
      .leftJoin(schema.inventoryLevels, eq(schema.inventoryLevels.variantId, schema.productVariants.id))
      .where(eq(schema.productVariants.productId, id))
      .orderBy(schema.productVariants.position);

    const variants = variantRows.map((v) => ({ option1: v.option1, option2: v.option2, option3: v.option3, sku: v.sku, price: v.price, stock: v.stock ?? 0 }));
    // per-option distinct values, derived from the variants (preserve first-seen order)
    const options = optionRows.map((o, i) => {
      const key = (`option${i + 1}`) as "option1" | "option2" | "option3";
      const seen = new Set<string>();
      const values: string[] = [];
      for (const v of variants) {
        const val = v[key];
        if (val && !seen.has(val)) { seen.add(val); values.push(val); }
      }
      return { name: o.name, values };
    });

    const defaultVariant = variantRows.slice().sort((a, b) => a.position - b.position)[0];
    return {
      ...toProduct(rows[0]), media, hasVariants: prod?.hasVariants ?? false, options, variants,
      weightGrams: defaultVariant?.weightGrams ?? null,
      lengthCm: prod?.lengthCm ?? null,
      widthCm: prod?.widthCm ?? null,
      heightCm: prod?.heightCm ?? null,
      // real values so the editor stops re-seeding fabricated defaults on reopen
      description: rows[0].description ?? "",
      shortDescription: rows[0].shortDescription ?? "",
      productType: rows[0].productType ?? "",
      vendor: rows[0].vendor ?? "",
      seoTitle: rows[0].seoTitle ?? "",
      seoDesc: rows[0].seoDesc ?? "",
      googleCategoryId: rows[0].googleCategoryId ?? null,
      googleCategoryPath: rows[0].googleCategoryPath ?? "",
      gender: rows[0].gender ?? "",
      ageGroup: rows[0].ageGroup ?? "",
      material: rows[0].material ?? "",
      compareAt: rows[0].compareAt ?? null,
      cost: rows[0].cost ?? null,
      sku: rows[0].sku ?? "",
    };
  });
}

/**
 * The SERVER's wall clock, for the Produk list's "Ditambahkan" filter.
 *
 * The filter compared `p.addedTs` against `TODAY` imported from `lib/mock/store.ts` — the seed's
 * frame, frozen at 2026-06-30 — so on 2026-08-03 "7 hari terakhir" was a 41-day window, and it grew
 * by a day every day. It cannot be read in the client component (`Date.now()` there renders one
 * value on the server and another in the browser: the hydration mismatch AGENTS.md forbids), and
 * reading it inline in the page trips the React Compiler's "impure function during render" rule.
 * The clock lives with the rest of the real-clock reads — `data/orders.ts`, `data/crm.ts`,
 * `data/articles.ts` and `data/reviews.ts` all do exactly this — and the page hands it down as a
 * prop. `/produk` is `force-dynamic`, so it is evaluated per request.
 */
export function serverNowTs(): number {
  return Date.now();
}
