import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

// Task 5.18 / F-S8 — per-courier return rates are computed ONLY from orders whose courier is known.
//
// `getReturnsByCourier` used to `coalesce(nullif(o.courier, ''), 'Tidak diketahui')`, i.e. it
// invented a courier for every legacy/manual shipment and published a return RATE for it, beside the
// real ones. The rule this file pins: a row with no courier is in NO courier's numerator or
// denominator; it is counted once, separately, as `unattributed`, so the screen can say how many
// were left out. Same pattern as `daily-stats.test.ts`: the real exported query, under
// `SET LOCAL ROLE tokophi_app` + the `app.store_id` GUC, inside a transaction that always rolls back.
//
//   npx vitest run apps/admin/lib/data/returns.test.ts

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;
type Db = typeof db;
// `returns.ts` pulls `@tokophi/db` transitively, which throws at import time with no DATABASE_URL.
let returnsByCourierRows: (typeof import("./returns"))["returnsByCourierRows"];

beforeAll(async () => {
  if (!URL) return;
  process.env.DATABASE_URL ??= URL;
  ({ returnsByCourierRows } = await import("./returns"));
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
  const a = await rows(tx, sql`insert into accounts (name) values ('Returns Acc') returning id`);
  const s = await rows(tx, sql`insert into stores (account_id, name, slug) values (${a[0].id}, 'Returns Store', ${"rt-" + ++seq}) returning id`);
  return s[0].id as string;
}
async function mkOrder(tx: Db, storeId: string, status: string, courier: string | null, opts: { cod?: boolean } = {}) {
  const [o] = await rows(tx, sql`
    insert into orders (store_id, number, status, placed_at, total_idr, subtotal_idr, courier)
    values (${storeId}, ${"RT-" + ++seq}, ${status}::order_status, now(), 100000, 100000, ${courier})
    returning id`);
  if (opts.cod) {
    await tx.execute(sql`
      insert into payments (store_id, order_id, method, amount_idr, status)
      values (${storeId}, ${o.id}, 'cod', 100000, 'menunggu')`);
  }
  return o.id as string;
}
const query = (tx: Db) => returnsByCourierRows(tx as unknown as Parameters<typeof returnsByCourierRows>[0]);
/** Drop to the non-owner role with this store's GUC — precisely what `withTenant` does per request. */
const asTenant = (tx: Db, storeId: string) =>
  tx.execute(sql`select set_config('app.store_id', ${storeId}, true)`).then(() => tx.execute(sql`set local role tokophi_app`));

suite("per-courier return rates (real Postgres, under RLS)", () => {
  it("counts only orders with a known courier; NULL and '' are reported once as `unattributed`, never as a courier", async () => {
    await inTxn(async (tx) => {
      const storeId = await mkStore(tx);
      await mkOrder(tx, storeId, "selesai", "spx", { cod: true });
      await mkOrder(tx, storeId, "retur", "spx", { cod: true });
      await mkOrder(tx, storeId, "dikirim", "jne");
      // The legacy shape: shipped, even RETURNED, with no courier on the row. Under the old
      // coalesce these became a "Tidak diketahui" courier running a 50% return rate.
      await mkOrder(tx, storeId, "retur", null);
      await mkOrder(tx, storeId, "selesai", "");
      // Not shipped yet — in nobody's denominator, and not unattributed either.
      await mkOrder(tx, storeId, "baru", null);
      await asTenant(tx, storeId);

      const { byCourier, unattributed } = await query(tx);

      expect(unattributed).toBe(2);
      expect(byCourier.map((r) => r.courier).sort()).toEqual(["jne", "spx"]);
      expect(byCourier.some((r) => /tidak diketahui/i.test(r.courier))).toBe(false);

      const spx = byCourier.find((r) => r.courier === "spx")!;
      expect(spx).toMatchObject({ shipped: 2, returned: 1, returnRate: 0.5, codShipped: 2, codReturned: 1, codReturnRate: 0.5 });
      const jne = byCourier.find((r) => r.courier === "jne")!;
      expect(jne).toMatchObject({ shipped: 1, returned: 0, returnRate: 0, codShipped: 0, codReturnRate: 0 });
      // The unattributed return is in NO rate: total returned across couriers is 1, not 2.
      expect(byCourier.reduce((a, r) => a + r.returned, 0)).toBe(1);
    });
  });

  it("RLS scopes it — another store's courier-less orders are not this store's `unattributed`", async () => {
    await inTxn(async (tx) => {
      const mine = await mkStore(tx);
      const theirs = await mkStore(tx);
      await mkOrder(tx, mine, "selesai", "spx");
      await mkOrder(tx, theirs, "selesai", null);
      await mkOrder(tx, theirs, "retur", "sicepat");
      await asTenant(tx, mine);

      const { byCourier, unattributed } = await query(tx);
      expect(unattributed).toBe(0);
      expect(byCourier.map((r) => r.courier)).toEqual(["spx"]);
    });
  });
});
