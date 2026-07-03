"use server";
import { schema } from "@indostore/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export type CollectionInput = {
  name: string;
  description?: string;
  type: "manual" | "otomatis";
  match: "all" | "any";
  published: boolean;
};

const fields = (i: CollectionInput) => ({
  title: i.name.trim(),
  handle: slugify(i.name),
  description: i.description || null,
  type: i.type,
  match: i.match,
  published: i.published,
});

export async function createCollection(input: CollectionInput): Promise<string> {
  const { storeId: sid } = await requireCapability("content:write");
  const id = await withTenant(sid, async (db) => {
    const [c] = await db.insert(schema.collections).values({ storeId: sid, ...fields(input) }).returning();
    return c.id;
  });
  revalidatePath("/produk/kategori");
  return id;
}

export async function updateCollection(id: string, input: CollectionInput): Promise<void> {
  const { storeId: sid } = await requireCapability("content:write");
  await withTenant(sid, (db) => db.update(schema.collections).set(fields(input)).where(eq(schema.collections.id, id)));
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
