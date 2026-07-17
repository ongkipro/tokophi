"use server";
import { schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
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
  const ids = input.type === "manual" ? [...new Set(input.memberIds ?? [])] : [];
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
    await db.update(schema.collections).set(fields(input)).where(eq(schema.collections.id, id));
    await syncChildren(db, id, input);
  });
  revalidatePath("/produk/kategori");
  revalidatePath(`/produk/kategori/${id}`);
}

export async function deleteCollection(id: string): Promise<void> {
  const { storeId: sid } = await requireCapability("content:write");
  await withTenant(sid, async (db) => {
    await db.delete(schema.collectionProducts).where(eq(schema.collectionProducts.collectionId, id));
    await db.delete(schema.collectionConditions).where(eq(schema.collectionConditions.collectionId, id));
    await db.delete(schema.collections).where(eq(schema.collections.id, id));
  });
  revalidatePath("/produk/kategori");
}
