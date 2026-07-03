import "server-only";
import { schema } from "@indostore/db";
import { withCurrentTenant } from "@/lib/tenant";
import { asc, eq, sql } from "drizzle-orm";
import type { Collection } from "@/lib/mock/store";

const selectCollection = {
  id: schema.collections.id,
  name: schema.collections.title,
  emoji: schema.collections.emoji,
  type: schema.collections.type,
  published: schema.collections.published,
  products: sql<number>`count(${schema.collectionProducts.productId})`.mapWith(Number),
};

function toCollection(r: {
  id: string; name: string; emoji: string | null; type: "manual" | "otomatis"; published: boolean; products: number;
}): Collection {
  return { id: r.id, name: r.name, emoji: r.emoji ?? "📦", products: r.products, type: r.type, published: r.published };
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
