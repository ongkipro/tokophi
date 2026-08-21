import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/tenant";

// "Penghematan Pelanggan" — the Diskon dashboard's money tile.
//
// Its own on-screen hint reads *"dari orders.discount_idr — nilai yang benar-benar dipotong"*, and
// the query behind it summed `discount_idr` over EVERY order of the store: no status predicate at
// all, while `applyOrderStatusChange` restores a cancelled order's stock and `settleOrderLedger`
// claws its sale back in the same transaction. So a merchant who cancels a large discounted order
// keeps seeing its voucher counted as money they gave away.
//
// A missing `WHERE` term is invisible to `tsc`, ESLint and `next build`, and on a store with no
// cancellations the number is right — which is why this runs the REAL exported query against real
// Postgres, on a fixture that has one of each status.
//
//   TEST_DATABASE_URL=postgresql://tokophi:tokophi@localhost:5433/tokophi_test \
//     npx vitest run apps/admin/lib/data/discounts.test.ts

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

let client: Sql;
let db: ReturnType<typeof drizzle>;
let discountSavingsFor: (db: Tx, storeId: string) => Promise<number>;

beforeAll(async () => {
  if (!URL) return;
  process.env.DATABASE_URL ??= URL;
  ({ discountSavingsFor } = await import("./discounts"));
  client = postgres(URL, { max: 1 });
  db = drizzle(client, { casing: "snake_case" });
});
afterAll(async () => {
  if (client) await client.end();
});

class Rollback extends Error {}
async function inTxn(fn: (tx: typeof db, storeId: string) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      const [acc] = await tx.execute<{ id: string }>(
        sql`insert into accounts (name) values (${`Disc ${randomUUID()}`}) returning id`,
      );
      const [store] = await tx.execute<{ id: string }>(
        sql`insert into stores (account_id, name, slug)
            values (${acc.id}, 'Disc Store', ${`disc-${randomUUID()}`}) returning id`,
      );
      // The real read path runs as the non-owner role with the tenant GUC set.
      await tx.execute(sql`select set_config('app.store_id', ${store.id}, true)`);
      await tx.execute(sql`set local role tokophi_app`);
      await fn(tx as unknown as typeof db, store.id);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

suite("Penghematan Pelanggan counts money that was actually given away", () => {
  it("a CANCELLED order's discount is not a customer saving", async () => {
    await inTxn(async (tx, storeId) => {
      await tx.execute(sql`
        insert into orders (store_id, number, status, discount_idr, total_idr) values
          (${storeId}, ${"D-" + randomUUID()}, 'selesai', 20000, 100000),
          (${storeId}, ${"D-" + randomUUID()}, 'batal',   50000, 100000)`);
      // The shipped query answered 70000 — the cancelled order's voucher included.
      expect(await discountSavingsFor(tx as unknown as Tx, storeId)).toBe(20000);
    });
  });

  it("live orders of every non-cancelled status still count", async () => {
    // `retur` (16000) is IN on purpose: the parcel was sold at the discounted price before it came
    // back. Whether a refunded order still counts as a customer saving is a business call, not a
    // bug — see the note on `discountSavingsFor`, and `lib/data/finance.ts` answers it the other
    // way. This pins the current answer so a change to it has to be deliberate.
    await inTxn(async (tx, storeId) => {
      await tx.execute(sql`
        insert into orders (store_id, number, status, discount_idr, total_idr) values
          (${storeId}, ${"D-" + randomUUID()}, 'baru',     1000, 100000),
          (${storeId}, ${"D-" + randomUUID()}, 'diproses', 2000, 100000),
          (${storeId}, ${"D-" + randomUUID()}, 'dikirim',  4000, 100000),
          (${storeId}, ${"D-" + randomUUID()}, 'selesai',  8000, 100000),
          (${storeId}, ${"D-" + randomUUID()}, 'retur',   16000, 100000),
          (${storeId}, ${"D-" + randomUUID()}, 'batal',   32000, 100000)`);
      expect(await discountSavingsFor(tx as unknown as Tx, storeId)).toBe(31000);
    });
  });

  it("a store with no orders reads 0, never null", async () => {
    await inTxn(async (tx, storeId) => {
      expect(await discountSavingsFor(tx as unknown as Tx, storeId)).toBe(0);
    });
  });
});
