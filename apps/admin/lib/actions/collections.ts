"use server";
import { db, schema } from "@indostore/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";

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
  const [c] = await db.insert(schema.collections).values({ storeId: sid, ...fields(input) }).returning();
  revalidatePath("/produk/kategori");
  return c.id;
}

export async function updateCollection(id: string, input: CollectionInput): Promise<void> {
  await requireCapability("content:write");
  await db.update(schema.collections).set(fields(input)).where(eq(schema.collections.id, id));
  revalidatePath("/produk/kategori");
  revalidatePath(`/produk/kategori/${id}`);
}

export async function deleteCollection(id: string): Promise<void> {
  await requireCapability("content:write");
  await db.delete(schema.collectionProducts).where(eq(schema.collectionProducts.collectionId, id));
  await db.delete(schema.collectionConditions).where(eq(schema.collectionConditions.collectionId, id));
  await db.delete(schema.collections).where(eq(schema.collections.id, id));
  revalidatePath("/produk/kategori");
}
