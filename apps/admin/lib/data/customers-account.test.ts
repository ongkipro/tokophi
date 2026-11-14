import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { sql, type SQL } from "drizzle-orm";
import { schema } from "@tokophi/db";
import type { Tx } from "@/lib/tenant";
import { accountCustomerRows, customerCols, customerOrderRows } from "./customers";

// BUYER-ACCOUNT-P1 (ADR 0016) — "no buyer PII leaks across stores". ONE person with ONE TokoΦ Account
// buys from TWO stores and saves both orders. Each Seller, running exactly as a request does
// (`SET LOCAL ROLE tokophi_app` + its own `app.store_id`, i.e. through RLS), must see:
//   · its own customer as connected, its own saved order — and nothing of the other store;
//   · NOTHING of the account itself: `buyer_accounts` / `buyer_sessions` have RLS with no policy;
//   · no way to write a claim or link into another store (WITH CHECK).
// Every case runs inside a transaction that is always rolled back.
//
//   TEST_DATABASE_URL=postgresql://tokophi:tokophi@localhost:5433/<db>_test \
//     npx vitest run apps/admin/lib/data/customers-account.test.ts
const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

let client: Sql;
let db: ReturnType<typeof drizzle>;
beforeAll(() => {
  if (!URL) return;
  client = postgres(URL, { max: 1, onnotice: () => {} });
  db = drizzle(client, { casing: "snake_case" });
});
afterAll(async () => {
  await client?.end();
});

type Db = typeof db;
const ROLLBACK = Symbol("rollback");
async function inTxn(fn: (tx: Db) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      await fn(tx as unknown as Db);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}
const rows = async (tx: Db, q: SQL) => (await tx.execute(q)) as unknown as Record<string, unknown>[];
const n = async (tx: Db, q: SQL) => Number((await rows(tx, q))[0].n);
/** Drop to the non-owner role with this store's GUC — precisely what `withTenant` does per request. */
const asTenant = async (tx: Db, storeId: string) => {
  await tx.execute(sql`select set_config('app.store_id', ${storeId}, true)`);
  await tx.execute(sql`set local role tokophi_app`);
};
const asOwner = (tx: Db) => tx.execute(sql`reset role`);
const T = (tx: Db) => tx as unknown as Tx;

let seq = 0;
async function store(tx: Db, label: string) {
  const k = `${Date.now()}-${++seq}`;
  const [acc] = await rows(tx, sql`insert into accounts (name) values (${"Iso " + label}) returning id`);
  const [s] = await rows(tx, sql`insert into stores (account_id, name, slug) values (${acc.id}, ${"Toko " + label + " " + k}, ${"iso-" + label.toLowerCase() + "-" + k}) returning id`);
  return s.id as string;
}
async function customerOrder(tx: Db, storeId: string, name: string) {
  const [c] = await rows(tx, sql`insert into customers (store_id, name, phone, city) values (${storeId}, ${name}, '6281233334444', 'Bandung') returning id`);
  const [o] = await rows(tx, sql`
    insert into orders (store_id, number, customer_id, status, subtotal_idr, total_idr)
    values (${storeId}, ${"ISO-" + Date.now() + "-" + ++seq}, ${c.id}, 'dikirim', 100000, 100000) returning id`);
  return { customerId: c.id as string, orderId: o.id as string };
}
/** What apps/account writes on a claim (owner connection): the claim + an active link, store_id from the order. */
async function claim(tx: Db, buyerId: string, storeId: string, orderId: string, customerId: string) {
  await tx.execute(sql`insert into buyer_order_claims (order_id, buyer_id, store_id) values (${orderId}, ${buyerId}, ${storeId})`);
  await tx.execute(sql`
    insert into buyer_store_links (buyer_id, store_id, customer_id, consent_version) values (${buyerId}, ${storeId}, ${customerId}, 'test')
    on conflict (buyer_id, store_id) do update set status = 'active', revoked_at = null`);
}

suite("Seller projection of the TokoΦ Account — two stores, one buyer (real Postgres, under RLS)", () => {
  it("each store sees only its own connected customer and saved order; never the account, never the other store", async () => {
    await inTxn(async (tx) => {
      const A = await store(tx, "A");
      const B = await store(tx, "B");
      const [buyer] = await rows(tx, sql`insert into buyer_accounts (google_sub, email, name) values (${"iso:" + ++seq}, 'sari@contoh.id', 'Sari Pribadi') returning id`);
      await tx.execute(sql`insert into buyer_sessions (buyer_id, user_agent) values (${buyer.id}, 'Chrome · Android')`);
      const a = await customerOrder(tx, A, "Sari di A");
      const b = await customerOrder(tx, B, "Sari di B");
      const aGuest = await customerOrder(tx, A, "Tamu di A"); // never claimed
      await claim(tx, buyer.id as string, A, a.orderId, a.customerId);
      await claim(tx, buyer.id as string, B, b.orderId, b.customerId);

      await asTenant(tx, A);
      // The Akun Pembeli list: A's customer, one saved order — B's customer is not there.
      const list = await accountCustomerRows(T(tx), A);
      expect(list.map((r) => [r.id, r.name, r.savedOrders])).toEqual([[a.customerId, "Sari di A", 1]]);
      // Asking for B's list from A's tenant returns nothing: the RLS net under the explicit WHERE.
      expect(await accountCustomerRows(T(tx), B)).toEqual([]);
      // The account itself is invisible to every Seller path — no email, name or device.
      expect(await n(tx, sql`select count(*) n from buyer_accounts`)).toBe(0);
      expect(await n(tx, sql`select count(*) n from buyer_sessions`)).toBe(0);
      expect(await n(tx, sql`select count(*) n from buyer_accounts a join buyer_store_links l on l.buyer_id = a.id`)).toBe(0);
      // Claims and links: A's rows only.
      expect((await rows(tx, sql`select distinct store_id from buyer_order_claims`)).map((r) => r.store_id)).toEqual([A]);
      expect((await rows(tx, sql`select distinct store_id from buyer_store_links`)).map((r) => r.store_id)).toEqual([A]);
      // Pelanggan list / detail columns: A's connected customer is connected, the guest is not.
      const custs = await tx.select({ id: schema.customers.id, linkedAt: customerCols.accountLinkedAt }).from(schema.customers);
      const linked = Object.fromEntries(custs.map((c) => [c.id, c.linkedAt !== null]));
      expect(linked).toEqual({ [a.customerId]: true, [aGuest.customerId]: false });
      expect((await customerOrderRows(T(tx), a.customerId)).map((o) => o.savedToAccount)).toEqual([true]);
      expect((await customerOrderRows(T(tx), aGuest.customerId)).map((o) => o.savedToAccount)).toEqual([false]);
      expect(await customerOrderRows(T(tx), b.customerId)).toEqual([]); // B's customer does not exist for A
      // A cannot plant a claim or a link in B's tenant.
      await expect(
        tx.transaction((sp) => sp.execute(sql`insert into buyer_store_links (buyer_id, store_id, consent_version) values (${buyer.id}, ${B}, 'x')`)),
      ).rejects.toThrow();
      await asOwner(tx);

      // Store B, symmetrically, sees only B.
      await asTenant(tx, B);
      expect((await accountCustomerRows(T(tx), B)).map((r) => r.id)).toEqual([b.customerId]);
      expect(await n(tx, sql`select count(*) n from buyer_order_claims where store_id = ${A}`)).toBe(0);
      await asOwner(tx);
    });
  });

  it("when the buyer unlinks a store, that store sees a guest again — the other store is unaffected", async () => {
    await inTxn(async (tx) => {
      const A = await store(tx, "A");
      const B = await store(tx, "B");
      const [buyer] = await rows(tx, sql`insert into buyer_accounts (google_sub) values (${"iso:" + ++seq}) returning id`);
      const a = await customerOrder(tx, A, "Budi di A");
      const b = await customerOrder(tx, B, "Budi di B");
      await claim(tx, buyer.id as string, A, a.orderId, a.customerId);
      await claim(tx, buyer.id as string, B, b.orderId, b.customerId);
      await tx.execute(sql`update buyer_store_links set status = 'revoked', revoked_at = now() where buyer_id = ${buyer.id} and store_id = ${A}`);

      await asTenant(tx, A);
      expect(await accountCustomerRows(T(tx), A)).toEqual([]);
      expect((await customerOrderRows(T(tx), a.customerId)).map((o) => o.savedToAccount)).toEqual([false]);
      await asOwner(tx);
      await asTenant(tx, B);
      expect((await accountCustomerRows(T(tx), B)).map((r) => r.savedOrders)).toEqual([1]);
      await asOwner(tx);
    });
  });
});
