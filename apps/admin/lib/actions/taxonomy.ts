"use server";
// Search the Google Product Taxonomy (ADR 0011) for the editor's category picker. Global reference
// data (no store_id, no RLS) — queried on the owner connection like the other reference lookups.
import { db, schema } from "@tokophi/db";
import { and, asc, ilike, sql } from "drizzle-orm";
import { likeContains } from "@tokophi/lib/like";
import { getSession } from "@/lib/auth";

export type TaxonomyOption = { id: number; path: string; name: string; isLeaf: boolean };

export async function searchTaxonomy(query: string): Promise<TaxonomyOption[]> {
  // Reference data, not tenant data — but it is still a `"use server"` door reachable by anyone who
  // can POST to the app, and the middleware's JWT check is the only thing in front of it. Bail on a
  // missing session the way every other read does (page-map AD-6), so the rule "no action runs
  // without a session" has no exception to remember.
  if (!(await getSession())) return [];
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
