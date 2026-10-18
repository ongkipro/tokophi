import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Sql } from "postgres";
import type { Db } from "./account";
import * as acct from "./account";
import * as addr from "./addresses";

// /addresses (spec §18.4, ACC-7) — real Postgres, every case rolled back. The CRUD/isolation basics
// live in buyer-data.test.ts; this file pins what the screen now PROMISES: the delete confirm names
// the address that becomes primary, so the list order and deleteAddress's pick must be the same rule.
const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

let client: Sql;
let db: Db;
beforeAll(() => {
  if (!URL) return;
  client = postgres(URL, { max: 1, onnotice: () => {} });
  db = drizzle(client, { casing: "snake_case" }) as unknown as Db;
});
afterAll(async () => {
  await client?.end();
});

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

let seq = 0;
const account = async (tx: Db, email: string) => (await acct.upsertAccountBySub(tx, { sub: `dev:${email}`, email, name: email }))!;
async function district(tx: Db) {
  const id = 980000 + (++seq % 9000);
  await tx.execute(sql`insert into kiriminaja_areas (id, district_name, city_type, city_name, province_name)
                       values (${id}, 'Sewon', 'Kabupaten', 'Bantul', 'DI Yogyakarta') on conflict (id) do nothing`);
  return id;
}
const input = (districtId: number, label: string) => ({
  label,
  recipient: "Sari Dewi",
  phone: "0812-3456-7890",
  address: "Jl. Melati No. 12, RT 03/RW 05",
  districtId,
  postalCode: "55185",
});
async function three(tx: Db, me: string) {
  const dist = await district(tx);
  const ids: string[] = [];
  for (const l of ["Rumah", "Kantor", "Kos"]) {
    const r = await addr.saveAddress(tx, me, input(dist, l));
    if (!r.ok) throw new Error("save failed");
    ids.push(r.id);
  }
  return ids;
}
const primaryOf = async (tx: Db, me: string) =>
  (await rows(tx, sql`select id from buyer_addresses where buyer_id = ${me} and is_primary`)).map((r) => r.id);

suite("a closed account saves no address", () => {
  it("saveAddress is refused after closure and leaves no row", async () => {
    await inTxn(async (tx) => {
      const me = await account(tx, "addr-gone@demo.local");
      const dist = await district(tx);
      expect(await acct.closeAccount(tx, me)).toEqual({ ok: true });
      const r = await addr.saveAddress(tx, me, input(dist, "Rumah"));
      expect(r.ok).toBe(false);
      expect((await rows(tx, sql`select count(*)::int n from buyer_addresses where buyer_id = ${me}`))[0].n).toBe(0);
    });
  });
});

suite("deleting the primary — the confirm dialog's promise", () => {
  it("the next primary is the first non-primary row of the list, also when updated_at ties (one txn ⇒ one now())", async () => {
    await inTxn(async (tx) => {
      const me = await account(tx, "succ-tie@demo.local");
      const ids = await three(tx, me);
      const list = await addr.myAddresses(tx, me);
      expect(list[0].id).toBe(ids[0]);
      const promised = list.find((a) => !a.isPrimary)!.id;
      expect(await addr.deleteAddress(tx, me, ids[0])).toBe(true);
      expect(await primaryOf(tx, me)).toEqual([promised]);
    });
  });

  it("the most recently updated other address takes over", async () => {
    await inTxn(async (tx) => {
      const me = await account(tx, "succ-recent@demo.local");
      const ids = await three(tx, me);
      await tx.execute(sql`update buyer_addresses set updated_at = now() - interval '2 days' where id = ${ids[2]}`);
      await tx.execute(sql`update buyer_addresses set updated_at = now() - interval '1 day' where id = ${ids[1]}`);
      const promised = (await addr.myAddresses(tx, me)).find((a) => !a.isPrimary)!.id;
      expect(promised).toBe(ids[1]);
      await addr.deleteAddress(tx, me, ids[0]);
      expect(await primaryOf(tx, me)).toEqual([ids[1]]);
    });
  });

  it("deleting a non-primary leaves the primary alone; deleting the last leaves none; the next one added is primary", async () => {
    await inTxn(async (tx) => {
      const me = await account(tx, "succ-last@demo.local");
      const ids = await three(tx, me);
      await addr.deleteAddress(tx, me, ids[2]);
      expect(await primaryOf(tx, me)).toEqual([ids[0]]);
      await addr.deleteAddress(tx, me, ids[1]);
      await addr.deleteAddress(tx, me, ids[0]);
      expect(await primaryOf(tx, me)).toEqual([]);
      const r = await addr.saveAddress(tx, me, input(await district(tx), "Baru"));
      expect(r.ok && (await primaryOf(tx, me))).toEqual([r.ok && r.id]);
    });
  });

  it("another account's delete changes nothing of mine, primary included", async () => {
    await inTxn(async (tx) => {
      const me = await account(tx, "succ-me@demo.local");
      const other = await account(tx, "succ-other@demo.local");
      const ids = await three(tx, me);
      expect(await addr.deleteAddress(tx, other, ids[0])).toBe(false);
      expect(await primaryOf(tx, me)).toEqual([ids[0]]);
      expect((await addr.myAddresses(tx, me)).length).toBe(3);
    });
  });
});
