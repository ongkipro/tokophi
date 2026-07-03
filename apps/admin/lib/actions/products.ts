"use server";
import { db, schema } from "@indostore/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

// Single-tenant MVP: everything is scoped to the one store.
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
  stock: number;
};

async function storeId() {
  const [s] = await db.select({ id: schema.stores.id }).from(schema.stores).limit(1);
  return s!.id;
}

const productFields = (i: ProductInput) => ({
  title: i.name,
  handle: i.handle,
  description: i.description || null,
  status: i.status,
  category: i.category || null,
  productType: i.productType || null,
  vendor: i.vendor || null,
});
const variantFields = (i: ProductInput) => ({
  priceIdr: i.price,
  compareAtIdr: i.compareAt ?? null,
  costIdr: i.cost ?? null,
  sku: i.sku || null,
  weightGrams: i.weightGrams ?? null,
});

export async function createProduct(input: ProductInput): Promise<string> {
  const sid = await storeId();
  const [p] = await db.insert(schema.products).values({ storeId: sid, ...productFields(input) }).returning();
  const [v] = await db
    .insert(schema.productVariants)
    .values({ productId: p.id, storeId: sid, title: "Default", position: 0, ...variantFields(input) })
    .returning();
  const [loc] = await db.select({ id: schema.locations.id }).from(schema.locations).where(eq(schema.locations.storeId, sid)).limit(1);
  if (loc) await db.insert(schema.inventoryLevels).values({ variantId: v.id, locationId: loc.id, available: input.stock });
  await db.insert(schema.productMedia).values({ productId: p.id, url: `/products/${input.handle}.webp`, position: 0 });
  revalidatePath("/produk");
  return p.id;
}

export async function updateProduct(id: string, input: ProductInput): Promise<void> {
  await db.update(schema.products).set(productFields(input)).where(eq(schema.products.id, id));
  const [v] = await db
    .select({ id: schema.productVariants.id })
    .from(schema.productVariants)
    .where(and(eq(schema.productVariants.productId, id), eq(schema.productVariants.position, 0)))
    .limit(1);
  if (v) {
    await db.update(schema.productVariants).set(variantFields(input)).where(eq(schema.productVariants.id, v.id));
    await db.update(schema.inventoryLevels).set({ available: input.stock }).where(eq(schema.inventoryLevels.variantId, v.id));
  }
  revalidatePath("/produk");
  revalidatePath(`/produk/${id}`);
}

// Products may be referenced by historical order line-items, so "delete" = archive
// (soft delete). Archived products drop out of both the admin list and the storefront.
export async function deleteProduct(id: string): Promise<void> {
  await db.update(schema.products).set({ status: "archived", archivedAt: new Date() }).where(eq(schema.products.id, id));
  revalidatePath("/produk");
}
