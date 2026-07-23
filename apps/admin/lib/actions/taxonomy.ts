"use server";
// Search the Google Product Taxonomy (ADR 0011) for the editor's category picker. Global reference
// data (no store_id, no RLS) — queried on the owner connection like the other reference lookups.
import { db, schema } from "@tokophi/db";
import { and, asc, ilike, sql } from "drizzle-orm";

export type TaxonomyOption = { id: number; path: string; name: string; isLeaf: boolean };

export async function searchTaxonomy(query: string): Promise<TaxonomyOption[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  // Match paths containing EVERY typed word (so "dress wanita" narrows), shortest path first so the
  // broadest sensible node surfaces above its children.
  const terms = q.split(/\s+/).filter(Boolean).slice(0, 6);
  return db
    .select({
      id: schema.productTaxonomy.id,
      path: schema.productTaxonomy.path,
      name: schema.productTaxonomy.name,
      isLeaf: schema.productTaxonomy.isLeaf,
    })
    .from(schema.productTaxonomy)
    .where(and(...terms.map((t) => ilike(schema.productTaxonomy.path, `%${t}%`))))
    .orderBy(asc(sql`length(${schema.productTaxonomy.path})`))
    .limit(25);
}
