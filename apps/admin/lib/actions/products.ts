"use server";
import { schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
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
    const [loc] = await db.select({ id: schema.locations.id }).from(schema.locations).where(eq(schema.locations.storeId, sid)).limit(1);

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
    await db.update(schema.products).set({ ...productFields(input), hasVariants: usesVariants(input) }).where(eq(schema.products.id, id));
    const [loc] = await db.select({ id: schema.locations.id }).from(schema.locations).where(eq(schema.locations.storeId, sid)).limit(1);

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
      const [inv] = await db.select({ id: schema.inventoryLevels.id }).from(schema.inventoryLevels).where(eq(schema.inventoryLevels.variantId, variantId)).limit(1);
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

// Duplicate a product into a fresh DRAFT copy — options, variants (with inventory) and media
// carried over, but performance rollups (unitsSold/rating/bestseller) reset and a unique handle
// minted. Returns the new product id so the caller can open the copy for editing.
export async function duplicateProduct(id: string): Promise<string> {
  const { storeId: sid } = await requireCapability("products:write");
  const newId = await withTenant(sid, async (db) => {
    const [src] = await db
      .select()
      .from(schema.products)
      .where(and(eq(schema.products.id, id), eq(schema.products.storeId, sid)))
      .limit(1);
    if (!src) throw new Error("Produk tidak ditemukan");

    // unique handle: "<handle>-salinan", then -2, -3… if taken (unique on store_id+handle)
    const taken = new Set(
      (await db.select({ handle: schema.products.handle }).from(schema.products).where(eq(schema.products.storeId, sid))).map((r) => r.handle),
    );
    let handle = `${src.handle}-salinan`;
    for (let n = 2; taken.has(handle); n++) handle = `${src.handle}-salinan-${n}`;

    const [p] = await db
      .insert(schema.products)
      .values({
        storeId: sid,
        title: `${src.title} (Salinan)`,
        handle,
        description: src.description,
        status: "draft",
        productType: src.productType,
        vendor: src.vendor,
        category: src.category,
        emoji: src.emoji,
        sizes: src.sizes,
        badge: src.badge,
        hasVariants: src.hasVariants,
        lengthCm: src.lengthCm,
        widthCm: src.widthCm,
        heightCm: src.heightCm,
        templateId: src.templateId,
      })
      .returning();

    const opts = await db.select().from(schema.productOptions).where(eq(schema.productOptions.productId, id)).orderBy(schema.productOptions.position);
    if (opts.length) {
      await db.insert(schema.productOptions).values(opts.map((o) => ({ productId: p.id, name: o.name, position: o.position })));
    }

    const [loc] = await db.select({ id: schema.locations.id }).from(schema.locations).where(eq(schema.locations.storeId, sid)).limit(1);
    const vars = await db.select().from(schema.productVariants).where(eq(schema.productVariants.productId, id)).orderBy(schema.productVariants.position);
    for (const v of vars) {
      const [nv] = await db
        .insert(schema.productVariants)
        .values({
          productId: p.id, storeId: sid, title: v.title, sku: v.sku, barcode: v.barcode,
          priceIdr: v.priceIdr, compareAtIdr: v.compareAtIdr, costIdr: v.costIdr, weightGrams: v.weightGrams,
          option1: v.option1, option2: v.option2, option3: v.option3, position: v.position,
        })
        .returning();
      const [inv] = await db.select({ available: schema.inventoryLevels.available }).from(schema.inventoryLevels).where(eq(schema.inventoryLevels.variantId, v.id)).limit(1);
      if (loc) await db.insert(schema.inventoryLevels).values({ variantId: nv.id, locationId: loc.id, available: inv?.available ?? 0 });
    }

    const media = await db.select().from(schema.productMedia).where(eq(schema.productMedia.productId, id)).orderBy(schema.productMedia.position);
    if (media.length) {
      await db.insert(schema.productMedia).values(media.map((m) => ({ productId: p.id, url: m.url, alt: m.alt, position: m.position })));
    }
    return p.id;
  });
  revalidatePath("/produk");
  return newId;
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
