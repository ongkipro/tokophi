import "server-only";
import { schema } from "@tokophi/db";
import { withCurrentTenant } from "@/lib/tenant";
import { asc, eq, sql } from "drizzle-orm";
import type { Collection, CollectionDetail } from "@/lib/mock/store";

const selectCollection = {
  id: schema.collections.id,
  name: schema.collections.title,
  handle: schema.collections.handle,
  emoji: schema.collections.emoji,
  type: schema.collections.type,
  published: schema.collections.published,
  products: sql<number>`count(${schema.collectionProducts.productId})`.mapWith(Number),
};

function toCollection(r: {
  id: string; name: string; handle: string; emoji: string | null; type: "manual" | "otomatis"; published: boolean; products: number;
}): Collection {
  return { id: r.id, name: r.name, handle: r.handle, emoji: r.emoji ?? "📦", products: r.products, type: r.type, published: r.published };
}

export async function getCollections(): Promise<Collection[]> {
  return withCurrentTenant(async (db) => {
    const rows = await db
      .select(selectCollection)
      .from(schema.collections)
      .leftJoin(schema.collectionProducts, eq(schema.collectionProducts.collectionId, schema.collections.id))
      .groupBy(schema.collections.id)
      .orderBy(asc(schema.collections.title));
    return rows.map(toCollection);
  });
}

export async function getCollection(id: string): Promise<Collection | null> {
  return withCurrentTenant(async (db) => {
    const rows = await db
      .select(selectCollection)
      .from(schema.collections)
      .leftJoin(schema.collectionProducts, eq(schema.collectionProducts.collectionId, schema.collections.id))
      .where(eq(schema.collections.id, id))
      .groupBy(schema.collections.id)
      .limit(1);
    return rows[0] ? toCollection(rows[0]) : null;
  });
}

// Full editor payload: scalar fields + manual membership (ordered) + automatic conditions.
export async function getCollectionDetail(id: string): Promise<CollectionDetail | null> {
  return withCurrentTenant(async (db) => {
    const [c] = await db
      .select({
        id: schema.collections.id,
        name: schema.collections.title,
        handle: schema.collections.handle,
        description: schema.collections.description,
        type: schema.collections.type,
        match: schema.collections.match,
        published: schema.collections.published,
        seoTitle: schema.collections.seoTitle,
        seoDesc: schema.collections.seoDesc,
        emoji: schema.collections.emoji,
        imageUrl: schema.collections.imageUrl,
      })
      .from(schema.collections)
      .where(eq(schema.collections.id, id))
      .limit(1);
    if (!c) return null;
    const members = await db
      .select({ productId: schema.collectionProducts.productId })
      .from(schema.collectionProducts)
      .where(eq(schema.collectionProducts.collectionId, id))
      .orderBy(asc(schema.collectionProducts.position));
    const conds = await db
      .select({
        field: schema.collectionConditions.field,
        operator: schema.collectionConditions.operator,
        value: schema.collectionConditions.value,
      })
      .from(schema.collectionConditions)
      .where(eq(schema.collectionConditions.collectionId, id));
    return {
      id: c.id,
      name: c.name,
      handle: c.handle,
      description: c.description ?? "",
      type: c.type,
      match: c.match,
      published: c.published,
      seoTitle: c.seoTitle ?? "",
      seoDesc: c.seoDesc ?? "",
      emoji: c.emoji ?? "📦",
      imageUrl: c.imageUrl ?? "",
      memberIds: members.map((m) => m.productId),
      conditions: conds.map((x) => ({ field: x.field, operator: x.operator, value: x.value })),
    };
  });
}
