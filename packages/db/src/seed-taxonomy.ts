// Load the Google Product Taxonomy into `product_taxonomy` (GLOBAL reference data, ADR 0011) and
// backfill any product that has no standard category yet, using the deterministic suggester.
//
// Source: packages/db/data/google-taxonomy.en-US.txt (Google Product Taxonomy 2021-09-21, committed).
// Idempotent: rows are inserted with ON CONFLICT DO NOTHING (id is Google's own numeric id), so a
// re-run adds only new ids and never touches products already classified. Wired into the deploy
// migrate chain AFTER drizzle migrate (so the columns/table exist) and BEFORE seed-products.
//   npm run seed:taxonomy -w @tokophi/db
import { promises as fs } from "node:fs";
import path from "node:path";
import { isNull, eq, sql } from "drizzle-orm";
import { db, client, schema } from "./client";
import { suggestGoogleCategory, suggestGender } from "@tokophi/lib/taxonomy-suggest";

const DATA = path.join(process.cwd(), "data", "google-taxonomy.en-US.txt");

type Node = { id: number; path: string; name: string; parentId: number | null; isLeaf: boolean };

async function loadNodes(): Promise<Node[]> {
  const text = await fs.readFile(DATA, "utf8");
  const byPath = new Map<string, number>(); // path -> id, to resolve parents
  const rows: { id: number; path: string; name: string }[] = [];
  for (const line of text.split("\n")) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;
    const dash = l.indexOf(" - ");
    if (dash < 0) continue;
    const id = Number(l.slice(0, dash));
    const p = l.slice(dash + 3).trim();
    if (!Number.isFinite(id) || !p) continue;
    byPath.set(p, id);
    rows.push({ id, path: p, name: p.split(" > ").pop()! });
  }
  const parentIds = new Set<number>();
  const nodes: Node[] = rows.map((r) => {
    const segs = r.path.split(" > ");
    const parentPath = segs.slice(0, -1).join(" > ");
    const parentId = parentPath ? byPath.get(parentPath) ?? null : null;
    if (parentId != null) parentIds.add(parentId);
    return { ...r, parentId, isLeaf: true };
  });
  // A node is a leaf iff nothing lists it as a parent.
  for (const n of nodes) n.isLeaf = !parentIds.has(n.id);
  return nodes;
}

async function main() {
  const nodes = await loadNodes();
  // Bulk insert in chunks; ON CONFLICT DO NOTHING makes it idempotent and cheap on re-run.
  const CHUNK = 500;
  for (let i = 0; i < nodes.length; i += CHUNK) {
    await db.insert(schema.productTaxonomy).values(nodes.slice(i, i + CHUNK)).onConflictDoNothing();
  }
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.productTaxonomy);
  console.log(`seed-taxonomy: ${nodes.length} kategori dimuat → product_taxonomy berisi ${count} baris.`);

  // Backfill: classify every product that has no standard category yet (existing + demo). Only touches
  // NULL rows, so it never overwrites a seller's manual pick. Unmatched stays NULL (honest).
  const unclassified = await db
    .select({ id: schema.products.id, title: schema.products.title, category: schema.products.category })
    .from(schema.products)
    .where(isNull(schema.products.googleCategoryId));
  let filled = 0;
  for (const p of unclassified) {
    const s = suggestGoogleCategory(p.title, p.category);
    if (!s) continue;
    await db
      .update(schema.products)
      .set({ googleCategoryId: s.id, googleCategoryPath: s.path })
      .where(eq(schema.products.id, p.id));
    filled++;
  }
  console.log(`seed-taxonomy: backfill → ${filled}/${unclassified.length} produk tak berkategori diklasifikasi otomatis.`);

  // Feed gender (ADR 0011 Phase 2): fill ONLY where the title confidently names a gender, and only on
  // NULL rows. No blanket "female"/"adult" default here — that would mis-tag a real merchant's men's or
  // kids' catalogue. The feed itself derives a fallback at read-time (never persisted), so a null is safe.
  const noGender = await db
    .select({ id: schema.products.id, title: schema.products.title })
    .from(schema.products)
    .where(isNull(schema.products.gender));
  let attrs = 0;
  for (const p of noGender) {
    const g = suggestGender(p.title);
    if (!g) continue;
    await db.update(schema.products).set({ gender: g }).where(eq(schema.products.id, p.id));
    attrs++;
  }
  console.log(`seed-taxonomy: gender feed → ${attrs}/${noGender.length} produk diisi dari judul.`);
  await client.end();
}

main();
