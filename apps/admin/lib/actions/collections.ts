"use server";
import { schema } from "@tokophi/db";
import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export type CollectionCondition = { field: string; operator: string; value: string };
export type CollectionInput = {
  name: string;
  description?: string;
  handle?: string;
  type: "manual" | "otomatis";
  match: "all" | "any";
  published: boolean;
  seoTitle?: string;
  seoDesc?: string;
  memberIds?: string[];
  conditions?: CollectionCondition[];
};

const COND_FIELDS = ["tag", "title", "type", "price", "stock", "category"];
const COND_OPS = ["eq", "neq", "gt", "lt", "contains"];

const fields = (i: CollectionInput) => ({
  title: i.name.trim(),
  // A merchant-typed handle wins (re-slugified for safety); fall back to the title.
  handle: (i.handle?.trim() && slugify(i.handle)) || slugify(i.name),
  description: i.description?.trim() || null,
  type: i.type,
  match: i.match,
  published: i.published,
  seoTitle: i.seoTitle?.trim() || null,
  seoDesc: i.seoDesc?.trim() || null,
});

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

// Replace the collection's children to match the input: manual → membership rows (ordered), otomatis →
// condition rows. The unused side is cleared so switching type doesn't leave orphans. Only valid enum
// values survive (a bad field/operator would violate the pgEnum and fail the whole save).
async function syncChildren(db: Tx, collectionId: string, input: CollectionInput) {
  await db.delete(schema.collectionProducts).where(eq(schema.collectionProducts.collectionId, collectionId));
  const wanted = input.type === "manual" ? [...new Set(input.memberIds ?? [])] : [];
  // `memberIds` is CLIENT INPUT, and `collection_products` has no store_id / no RLS. e61df25 guarded
  // the collection id but not these child ids, so a foreign productId still landed in the row. It is
  // currently harmless only by accident: the storefront read (catalog.ts) runs on the OWNER connection
  // and its `products` join is not store-filtered — the foreign product survives that far and drops out
  // only because the result is later intersected with the store's own handles. Do not rely on an
  // accident two files away. Keep only products this tenant can actually see (`products` IS RLS'd).
  // Filter `wanted` rather than mapping the query result: `position` is the merchant's manual ordering,
  // so the input order is meaningful and must survive the check.
  const ours = wanted.length
    ? new Set((await db.select({ id: schema.products.id }).from(schema.products).where(inArray(schema.products.id, wanted))).map((p) => p.id))
    : new Set<string>();
  const ids = wanted.filter((id) => ours.has(id));
  if (ids.length) {
    await db.insert(schema.collectionProducts).values(ids.map((productId, i) => ({ collectionId, productId, position: i })));
  }
  await db.delete(schema.collectionConditions).where(eq(schema.collectionConditions.collectionId, collectionId));
  const conds = input.type === "otomatis"
    ? (input.conditions ?? []).filter((c) => COND_FIELDS.includes(c.field) && COND_OPS.includes(c.operator) && c.value.trim())
    : [];
  if (conds.length) {
    await db.insert(schema.collectionConditions).values(
      conds.map((c) => ({
        collectionId,
        field: c.field as typeof schema.collectionConditions.$inferInsert.field,
        operator: c.operator as typeof schema.collectionConditions.$inferInsert.operator,
        value: c.value.trim(),
      })),
    );
  }
}

export async function createCollection(input: CollectionInput): Promise<string> {
  const { storeId: sid } = await requireCapability("content:write");
  const id = await withTenant(sid, async (db) => {
    const [c] = await db.insert(schema.collections).values({ storeId: sid, ...fields(input) }).returning();
    await syncChildren(db, c.id, input);
    return c.id;
  });
  revalidatePath("/produk/kategori");
  return id;
}

export async function updateCollection(id: string, input: CollectionInput): Promise<void> {
  const { storeId: sid } = await requireCapability("content:write");
  await withTenant(sid, async (db) => {
    // collection_products / collection_conditions have no store_id/RLS, so confirm the parent is ours
    // under RLS before syncChildren rewrites them by raw id — else a foreign id corrupts another store.
    const [owned] = await db.select({ id: schema.collections.id }).from(schema.collections).where(eq(schema.collections.id, id)).limit(1);
    if (!owned) return;
    await db.update(schema.collections).set(fields(input)).where(eq(schema.collections.id, id));
    await syncChildren(db, id, input);
  });
  revalidatePath("/produk/kategori");
  revalidatePath(`/produk/kategori/${id}`);
}

export async function deleteCollection(id: string): Promise<void> {
  const { storeId: sid } = await requireCapability("content:write");
  await withTenant(sid, async (db) => {
    // Confirm ownership under RLS before deleting the un-RLS'd child rows by raw id.
    const [owned] = await db.select({ id: schema.collections.id }).from(schema.collections).where(eq(schema.collections.id, id)).limit(1);
    if (!owned) return;
    await db.delete(schema.collectionProducts).where(eq(schema.collectionProducts.collectionId, id));
    await db.delete(schema.collectionConditions).where(eq(schema.collectionConditions.collectionId, id));
    await db.delete(schema.collections).where(eq(schema.collections.id, id));
  });
  revalidatePath("/produk/kategori");
}
