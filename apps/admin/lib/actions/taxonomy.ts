"use server";
// Search the Google Product Taxonomy (ADR 0011) for the editor's category picker. Global reference
// data (no store_id, no RLS) — queried on the owner connection like the other reference lookups.
import { db, schema } from "@tokophi/db";
import { and, asc, ilike, sql } from "drizzle-orm";
import { likeContains } from "@tokophi/lib/like";

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
    // Escaped: the merchant types this, and a `%` or `_` in it is a literal character to them, not a
    // wildcard. This site was missed when the same fix landed in `data/areas.ts` and `data/orders.ts`.
    .where(and(...terms.map((t) => ilike(schema.productTaxonomy.path, likeContains(t)))))
    .orderBy(asc(sql`length(${schema.productTaxonomy.path})`))
    .limit(25);
}
