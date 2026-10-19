import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/tenant";
import type { SearchItem } from "@/lib/search-model";

// The palette's index, through RLS. The display details (price, status, order count) exist only because
// the query really holds them; this file proves each is the right store's, and that nothing leaks.
// Pure part first (no DB), then the real query under `SET LOCAL ROLE tokophi_app`, always rolled back.
//
//   TEST_DATABASE_URL=postgresql://…/tokophi_test npx vitest run apps/admin/lib/data/search.test.ts

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;
type Db = typeof db;
let loadSearchIndex: (tx: Tx) => Promise<SearchItem[]>;
let phoneKeywords: (p: string | null) => string | undefined;

beforeAll(async () => {
  if (!URL) return;
  process.env.DATABASE_URL ??= URL; // `@tokophi/db` throws at import with no DATABASE_URL
  ({ loadSearchIndex, phoneKeywords } = await import("./search"));
  client = postgres(URL, { max: 1 });
  db = drizzle(client, { casing: "snake_case" });
});
afterAll(async () => {
  if (client) await client.end();
});

class Rollback extends Error {}
async function inTxn(fn: (tx: Db) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      await fn(tx as unknown as Db);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}
const rows = async (tx: Db, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as Record<string, unknown>[];
const asTenant = (tx: Db, storeId: string) =>
  tx.execute(sql`select set_config('app.store_id', ${storeId}, true)`).then(() => tx.execute(sql`set local role tokophi_app`));

let seq = 0;
async function mkStore(tx: Db): Promise<string> {
  const a = await rows(tx, sql`insert into accounts (name) values ('Search Acc') returning id`);
  const s = await rows(tx, sql`insert into stores (account_id, name, slug) values (${a[0].id}, 'Search Store', ${"srch-" + ++seq}) returning id`);
  return s[0].id as string;
}
async function mkProduct(tx: Db, storeId: string, n: number, title: string, status: string, prices: number[]) {
  const p = await rows(tx, sql`insert into products (store_id, title, handle, number, status) values (${storeId}, ${title}, ${"h-" + ++seq}, ${n}, ${status}::product_status) returning id`);
  let s = 0;
  for (const price of prices) {
    await tx.execute(sql`insert into product_variants (product_id, store_id, title, price_idr, weight_grams, position, seq) values (${p[0].id}, ${storeId}, 'v', ${price}, 100, ${s}, ${++s})`);
  }
}

describe("phone keywords (pure)", () => {
  it("gives the canonical 62… and the local 0… form, digits only, and nothing for a non-number", () => {
    // Imported lazily in the DB suite; this pure check needs the module too, so it is skipped with it.
    if (!URL) return;
    expect(phoneKeywords("6281234567890")).toBe("6281234567890 081234567890");
    expect(phoneKeywords("+62 812-3456-7890")).toBe("6281234567890 081234567890");
    expect(phoneKeywords("0812")).toBeUndefined();
    expect(phoneKeywords(null)).toBeUndefined();
    expect(phoneKeywords("")).toBeUndefined();
  });
});

suite("loadSearchIndex — the real query, through RLS", () => {
  it("returns only this store's rows, with the details the palette shows", async () => {
    await inTxn(async (tx) => {
      const A = await mkStore(tx);
      const B = await mkStore(tx);
      await mkProduct(tx, A, 1, "Kemeja Batik", "active", [150_000, 95_000, 120_000]);
      await mkProduct(tx, A, 2, "Rok Draf", "draft", [70_000]);
      await mkProduct(tx, A, 3, "Produk Lama", "archived", [10_000]);
      await mkProduct(tx, B, 1, "Produk Toko Lain", "active", [1_000]);
      const ca = await rows(tx, sql`insert into customers (store_id, name, email, phone, orders_count) values (${A}, 'Sari Dewi', 'sari@x.id', '6281234567890', 4) returning id`);
      await tx.execute(sql`insert into customers (store_id, name, email, phone) values (${B}, 'Orang Toko Lain', 'b@x.id', '6289999999999')`);
      await tx.execute(sql`insert into orders (store_id, number, customer_id, status, total_idr, subtotal_idr, city, placed_at) values (${A}, 'SR-1', ${ca[0].id}, 'dikirim', 233_000, 233_000, 'Bantul', now())`);
      await tx.execute(sql`insert into orders (store_id, number, status, total_idr, subtotal_idr, placed_at) values (${B}, 'SR-OTHER', 'baru', 1, 1, now())`);
      await asTenant(tx, A);

      const idx = await loadSearchIndex(tx as unknown as Tx);
      const labels = idx.map((i) => i.label).sort();
      expect(labels).toEqual(["Kemeja Batik", "Rok Draf", "SR-1", "Sari Dewi"].sort()); // no archived, nothing from store B

      const kemeja = idx.find((i) => i.label === "Kemeja Batik")!;
      expect(kemeja.meta).toEqual({ kind: "produk", priceIdr: 95_000, draft: false }); // the "from" price = the cheapest variant
      expect(kemeja.sub).toBe("#1 · Produk");
      expect(idx.find((i) => i.label === "Rok Draf")!.meta).toEqual({ kind: "produk", priceIdr: 70_000, draft: true });

      const order = idx.find((i) => i.label === "SR-1")!;
      expect(order.meta).toEqual({ kind: "pesanan", status: "dikirim", totalIdr: 233_000 });
      expect(order.sub).toBe("Sari Dewi");

      const sari = idx.find((i) => i.label === "Sari Dewi")!;
      expect(sari.meta).toEqual({ kind: "pelanggan", ordersCount: 4 });
      expect(sari.keywords).toBe("6281234567890 081234567890"); // searchable…
      expect(JSON.stringify({ label: sari.label, sub: sari.sub, meta: sari.meta })).not.toMatch(/62812|0812/); // …never displayed
    });
  });

  it("a product with no variants shows no price rather than an invented one", async () => {
    await inTxn(async (tx) => {
      const A = await mkStore(tx);
      await mkProduct(tx, A, 1, "Tanpa Varian", "active", []);
      await asTenant(tx, A);
      const p = (await loadSearchIndex(tx as unknown as Tx)).find((i) => i.label === "Tanpa Varian")!;
      expect(p.meta).toEqual({ kind: "produk", priceIdr: 0, draft: false });
    });
  });

  it("keeps the 80 NEWEST orders only (the palette offers the full list for older ones)", async () => {
    await inTxn(async (tx) => {
      const A = await mkStore(tx);
      await tx.execute(sql`
        insert into orders (store_id, number, status, total_idr, subtotal_idr, placed_at)
        select ${A}, 'BULK-' || g, 'baru', 1000, 1000, now() - (g || ' minutes')::interval from generate_series(1, 85) g`);
      await asTenant(tx, A);
      const orders = (await loadSearchIndex(tx as unknown as Tx)).filter((i) => i.type === "pesanan");
      expect(orders).toHaveLength(80);
      expect(orders.some((o) => o.label === "BULK-1")).toBe(true);
      expect(orders.some((o) => o.label === "BULK-85")).toBe(false);
    });
  });
});
