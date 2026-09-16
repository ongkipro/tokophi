import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/tenant";

// KEUANGAN COUNTS COLLECTED MONEY ONLY (Task 8.28).
//
// `getFinanceSummary` / `getEarnings` / `getChannelMix` used to sum the seller's entitlement over
// every order that was not `batal`/`retur` — including a `baru` order whose virtual account nobody
// ever paid. Measured on production 2026-09-16: 4 of a real store's 5 orders were unpaid, and all
// four sat in "Omzet 30 hari" (Rp873.100 of which Rp0 had arrived). The filter is
// `financial_status = 'dibayar'`, which the payment callback sets for prepaid and
// `collectCodOnDelivery` sets for COD at `selesai`. Real Postgres, under the tenant role, rolled
// back — the query is driven through the same seam the page uses (`financeSummaryRows`), never
// re-typed here.
const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;
type Db = typeof db;
let financeSummaryRows: (typeof import("./finance"))["financeSummaryRows"];
let earningsRows: (typeof import("./finance"))["earningsRows"];

beforeAll(async () => {
  if (!URL) return;
  process.env.DATABASE_URL ??= URL;
  ({ financeSummaryRows, earningsRows } = await import("./finance"));
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
let seq = 0;
async function mkStore(tx: Db): Promise<string> {
  const a = await rows(tx, sql`insert into accounts (name) values ('Collected Acc') returning id`);
  const s = await rows(tx, sql`insert into stores (account_id, name, slug) values (${a[0].id}, 'Collected Store', ${"fc-" + ++seq}) returning id`);
  return s[0].id as string;
}
/** A legacy-arm order (no order_financials): entitlement = subtotal − discount = the goods figure. */
async function mkOrder(tx: Db, storeId: string, goods: number, opts: { status?: string; financial?: string; shipping?: number; hoursAgo?: number } = {}) {
  await rows(tx, sql`
    insert into orders (store_id, number, status, financial_status, placed_at, subtotal_idr, shipping_idr, total_idr)
    values (${storeId}, ${"FC-" + ++seq}, ${opts.status ?? "baru"}::order_status, ${opts.financial ?? "pending"}::financial_status,
            now() - (${opts.hoursAgo ?? 1} || ' hours')::interval, ${goods}, ${opts.shipping ?? 0}, ${goods + (opts.shipping ?? 0)})`);
}
const asTenant = (tx: Db, storeId: string) =>
  tx.execute(sql`select set_config('app.store_id', ${storeId}, true)`).then(() => tx.execute(sql`set local role tokophi_app`));
const T = (tx: Db) => tx as unknown as Tx;

suite("Keuangan sums collected money only (real Postgres, under RLS)", () => {
  it("an unpaid VA order contributes Rp0 to revenue and shipping-in; a paid one contributes its entitlement", async () => {
    await inTxn(async (tx) => {
      const storeId = await mkStore(tx);
      await mkOrder(tx, storeId, 300_000, { status: "baru", financial: "pending", shipping: 20_000 }); // VA never paid
      await mkOrder(tx, storeId, 120_000, { status: "diproses", financial: "dibayar", shipping: 15_000 }); // paid
      await asTenant(tx, storeId);
      const s = await financeSummaryRows(T(tx), 30);
      expect(s.revenue).toBe(120_000);
      expect(s.shippingIn).toBe(15_000);
      expect(s.orders).toBe(1);
      // "Tertahan" still counts every in-flight order — that tile asks a different question.
      expect(s.heldOrders).toBe(2);
    });
  });

  it("a delivered COD order counts once it is collected at selesai, and a cancelled paid order never counts", async () => {
    await inTxn(async (tx) => {
      const storeId = await mkStore(tx);
      await mkOrder(tx, storeId, 90_000, { status: "dikirim", financial: "pending" }); // COD still with the courier
      await mkOrder(tx, storeId, 60_000, { status: "selesai", financial: "dibayar" }); // COD delivered → collected
      await mkOrder(tx, storeId, 45_000, { status: "batal", financial: "dibayar" }); // paid, then cancelled
      await asTenant(tx, storeId);
      const s = await financeSummaryRows(T(tx), 30);
      expect(s.revenue).toBe(60_000);
      const days = await earningsRows(T(tx), 7);
      expect(days.reduce((a, d) => a + d.gross, 0)).toBe(60_000);
      expect(days.reduce((a, d) => a + d.orders, 0)).toBe(1);
    });
  });
});
