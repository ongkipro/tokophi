"use server";
import { schema } from "@tokophi/db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";

export type VariantInput = {
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
  price: number;
  stock: number;
  sku?: string | null;
};

export type ProductInput = {
  name: string;
  description: string;
  status: "active" | "draft";
  category: string;
  productType?: string;
  vendor?: string;
  handle: string;
  price: number;
  compareAt?: number | null;
  cost?: number | null;
  sku?: string;
  weightGrams?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  stock: number;
  // real variants: option definitions (names + values) + one row per option-combo.
  // When empty/absent, the product has a single implicit "Default" variant (base price/stock).
  options?: { name: string; values: string[] }[];
  variants?: VariantInput[];
};

const comboKey = (o1: string | null, o2: string | null, o3: string | null) => [o1, o2, o3].filter(Boolean).join("");
const comboTitle = (o1: string | null, o2: string | null, o3: string | null) => [o1, o2, o3].filter(Boolean).join(" / ") || "Default";
const usesVariants = (i: ProductInput) => !!(i.variants && i.variants.length && i.options && i.options.length);

const productFields = (i: ProductInput) => ({
  title: i.name,
  handle: i.handle,
  description: i.description || null,
  status: i.status,
  category: i.category || null,
  productType: i.productType || null,
  vendor: i.vendor || null,
  lengthCm: i.lengthCm ?? null,
  widthCm: i.widthCm ?? null,
  heightCm: i.heightCm ?? null,
});
// The rows to persist: either the real variant matrix, or a single implicit "Default".
const variantRowsOf = (input: ProductInput): VariantInput[] =>
  usesVariants(input)
    ? input.variants!
    : [{ option1: null, option2: null, option3: null, price: input.price, stock: input.stock, sku: input.sku ?? null }];

export async function createProduct(input: ProductInput): Promise<string> {
  const { storeId: sid } = await requireCapability("products:write");
  const id = await withTenant(sid, async (db) => {
    const [p] = await db.insert(schema.products).values({ storeId: sid, hasVariants: usesVariants(input), ...productFields(input) }).returning();
    // Default location, not just any: new inventory rows must land where the merchant actually stocks.
    const [loc] = await db.select({ id: schema.locations.id }).from(schema.locations).where(eq(schema.locations.storeId, sid)).orderBy(desc(schema.locations.isDefault), asc(schema.locations.id)).limit(1);

    if (usesVariants(input)) {
      await db.insert(schema.productOptions).values(input.options!.map((o, i) => ({ productId: p.id, name: o.name, position: i })));
    }
    let pos = 0;
    for (const v of variantRowsOf(input)) {
      const [nv] = await db
        .insert(schema.productVariants)
        .values({
          productId: p.id, storeId: sid, title: comboTitle(v.option1 ?? null, v.option2 ?? null, v.option3 ?? null), position: pos++,
          option1: v.option1 ?? null, option2: v.option2 ?? null, option3: v.option3 ?? null,
          priceIdr: v.price, sku: v.sku || null, compareAtIdr: input.compareAt ?? null, costIdr: input.cost ?? null, weightGrams: input.weightGrams ?? null,
        })
        .returning();
      if (loc) await db.insert(schema.inventoryLevels).values({ variantId: nv.id, locationId: loc.id, available: v.stock });
    }
    await db.insert(schema.productMedia).values({ productId: p.id, url: `/products/${input.handle}.webp`, position: 0 });
    return p.id;
  });
  revalidatePath("/produk");
  return id;
}

export async function updateProduct(id: string, input: ProductInput): Promise<void> {
  const { storeId: sid } = await requireCapability("products:write");
  await withTenant(sid, async (db) => {
    // Verify the product belongs to THIS store BEFORE touching its children. product_options /
    // product_variants / inventory_levels have no store_id and no RLS, so a foreign id would let this
    // action delete+rewrite another store's rows — the `products` UPDATE below silently no-ops under
    // RLS but the child writes are keyed on the raw id. Read the parent under RLS first and bail if it
    // isn't ours (the pattern duplicateProduct already uses).
    const [owned] = await db.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.id, id)).limit(1);
    if (!owned) return;
    await db.update(schema.products).set({ ...productFields(input), hasVariants: usesVariants(input) }).where(eq(schema.products.id, id));
    // Default location, not just any: new inventory rows must land where the merchant actually stocks.
    const [loc] = await db.select({ id: schema.locations.id }).from(schema.locations).where(eq(schema.locations.storeId, sid)).orderBy(desc(schema.locations.isDefault), asc(schema.locations.id)).limit(1);

    // rebuild option definitions (no FK dependents)
    await db.delete(schema.productOptions).where(eq(schema.productOptions.productId, id));
    if (usesVariants(input)) {
      await db.insert(schema.productOptions).values(input.options!.map((o, i) => ({ productId: id, name: o.name, position: i })));
    }

    // reconcile variants by option-combo key (so historical order_line_items keep their variant)
    const existing = await db
      .select({ id: schema.productVariants.id, o1: schema.productVariants.option1, o2: schema.productVariants.option2, o3: schema.productVariants.option3 })
      .from(schema.productVariants)
      .where(eq(schema.productVariants.productId, id));
    const existingByKey = new Map(existing.map((v) => [comboKey(v.o1, v.o2, v.o3), v]));

    const isReferenced = async (vid: string) => {
      const [r] = await db.select({ id: schema.orderLineItems.id }).from(schema.orderLineItems).where(eq(schema.orderLineItems.variantId, vid)).limit(1);
      return !!r;
    };
    const setInventory = async (variantId: string, available: number) => {
      // Default-location row, explicitly: an unordered limit(1) writes the editor's stock number into
      // an ARBITRARY warehouse once a store has more than one location.
      const [inv] = await db
        .select({ id: schema.inventoryLevels.id })
        .from(schema.inventoryLevels)
        .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryLevels.locationId))
        .where(eq(schema.inventoryLevels.variantId, variantId))
        .orderBy(desc(schema.locations.isDefault), asc(schema.inventoryLevels.id))
        .limit(1);
      if (inv) await db.update(schema.inventoryLevels).set({ available }).where(eq(schema.inventoryLevels.id, inv.id));
      else if (loc) await db.insert(schema.inventoryLevels).values({ variantId, locationId: loc.id, available });
    };

    const keptKeys = new Set<string>();
    let pos = 0;
    for (const v of variantRowsOf(input)) {
      const o1 = v.option1 ?? null, o2 = v.option2 ?? null, o3 = v.option3 ?? null;
      const key = comboKey(o1, o2, o3);
      keptKeys.add(key);
      const fields = { title: comboTitle(o1, o2, o3), position: pos++, option1: o1, option2: o2, option3: o3, priceIdr: v.price, sku: v.sku || null, compareAtIdr: input.compareAt ?? null, costIdr: input.cost ?? null, weightGrams: input.weightGrams ?? null };
      const match = existingByKey.get(key);
      if (match) {
        await db.update(schema.productVariants).set(fields).where(eq(schema.productVariants.id, match.id));
        await setInventory(match.id, v.stock);
      } else {
        const [nv] = await db.insert(schema.productVariants).values({ productId: id, storeId: sid, ...fields }).returning();
        await setInventory(nv.id, v.stock);
      }
    }
    // drop variants no longer present — but keep any referenced by order history
    for (const ev of existing) {
      if (keptKeys.has(comboKey(ev.o1, ev.o2, ev.o3))) continue;
      if (await isReferenced(ev.id)) continue;
      await db.delete(schema.inventoryLevels).where(eq(schema.inventoryLevels.variantId, ev.id));
      await db.delete(schema.productVariants).where(eq(schema.productVariants.id, ev.id));
    }
  });
  revalidatePath("/produk");
  revalidatePath(`/produk/${id}`);
}

// Products may be referenced by historical order line-items, so "delete" = archive
// (soft delete). Archived products drop out of both the admin list and the storefront.
export async function deleteProduct(id: string): Promise<void> {
  const { storeId: sid } = await requireCapability("products:delete");
  await withTenant(sid, (db) =>
    db.update(schema.products).set({ status: "archived", archivedAt: new Date() }).where(eq(schema.products.id, id)),
  );
  revalidatePath("/produk");
}

// Shallow copy of a row minus the given keys (id/fks) — so a clone carries new columns automatically
// without naming every discarded field (which the lint would flag as unused).
function omit<T extends object>(row: T, keys: string[]): Record<string, unknown> {
  const out = { ...row } as Record<string, unknown>;
  for (const k of keys) delete out[k];
  return out;
}

// Full clone: product + options + variants + inventory + media. The copy is a DRAFT with a unique
// handle so it never collides with the original or shadows it on the storefront. Spread-copy each row
// (minus its id/createdAt) so new columns are carried automatically. Returns the new product id.
export async function duplicateProduct(id: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const { storeId: sid } = await requireCapability("products:write");
  const newId = await withTenant(sid, async (db) => {
    const [orig] = await db.select().from(schema.products).where(eq(schema.products.id, id)).limit(1);
    if (!orig) return null;

    // Unique handle: "<handle>-salinan", then -2/-3… if taken (handle is UNIQUE per store).
    let handle = `${orig.handle}-salinan`;
    for (let n = 2; ; n++) {
      const [clash] = await db.select({ id: schema.products.id }).from(schema.products)
        .where(and(eq(schema.products.storeId, sid), eq(schema.products.handle, handle))).limit(1);
      if (!clash) break;
      handle = `${orig.handle}-salinan-${n}`;
    }

    const [copy] = await db.insert(schema.products)
      .values({ ...omit(orig, ["id", "createdAt"]), storeId: sid, title: `${orig.title} (Salinan)`, handle, status: "draft", archivedAt: null } as typeof schema.products.$inferInsert)
      .returning({ id: schema.products.id });

    const options = await db.select().from(schema.productOptions).where(eq(schema.productOptions.productId, id));
    if (options.length) {
      await db.insert(schema.productOptions).values(options.map((o) => ({ ...omit(o, ["id"]), productId: copy.id } as typeof schema.productOptions.$inferInsert)));
    }

    const variants = await db.select().from(schema.productVariants).where(eq(schema.productVariants.productId, id));
    for (const v of variants) {
      const [nv] = await db.insert(schema.productVariants)
        .values({ ...omit(v, ["id"]), productId: copy.id, storeId: sid } as typeof schema.productVariants.$inferInsert).returning({ id: schema.productVariants.id });
      const levels = await db.select().from(schema.inventoryLevels).where(eq(schema.inventoryLevels.variantId, v.id));
      if (levels.length) {
        await db.insert(schema.inventoryLevels).values(levels.map((l) => ({ ...omit(l, ["id", "variantId"]), variantId: nv.id } as typeof schema.inventoryLevels.$inferInsert)));
      }
    }

    const media = await db.select().from(schema.productMedia).where(eq(schema.productMedia.productId, id));
    if (media.length) {
      await db.insert(schema.productMedia).values(media.map((m) => ({ ...omit(m, ["id", "productId"]), productId: copy.id } as typeof schema.productMedia.$inferInsert)));
    }
    return copy.id;
  });
  if (!newId) return { ok: false, error: "Produk tidak ditemukan." };
  revalidatePath("/produk");
  return { ok: true, id: newId };
}

// ── Bulk actions (the Produk selection bar) ──────────────────────────────────
// Same store-scoped writes as the single-product ones, just over a set. `inArray` on the store's own
// tenant connection so RLS still clamps to it — a forged id from another store can't be swept in.
export async function bulkSetProductStatus(ids: string[], status: "active" | "draft"): Promise<{ ok: boolean; count: number }> {
  const { storeId: sid } = await requireCapability("products:write");
  if (!ids.length) return { ok: true, count: 0 };
  await withTenant(sid, (db) =>
    db.update(schema.products).set({ status }).where(inArray(schema.products.id, ids)),
  );
  revalidatePath("/produk");
  return { ok: true, count: ids.length };
}

export async function bulkDeleteProducts(ids: string[]): Promise<{ ok: boolean; count: number }> {
  const { storeId: sid } = await requireCapability("products:delete");
  if (!ids.length) return { ok: true, count: 0 };
  // Delete = archive (products are referenced by order_line_items), same as the single delete.
  await withTenant(sid, (db) =>
    db.update(schema.products).set({ status: "archived", archivedAt: new Date() }).where(inArray(schema.products.id, ids)),
  );
  revalidatePath("/produk");
  return { ok: true, count: ids.length };
}
