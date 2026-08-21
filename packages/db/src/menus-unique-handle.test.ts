import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";

// One menu handle per store, enforced by the DATABASE (migration 0099).
//
// Task 4.7 closed the race that produced duplicates: `saveMenu` allocates the handle under
// `pg_advisory_xact_lock(4707, hashtext(store_id))`, so two concurrent "Buat menu" calls serialise.
// That lock protects exactly ONE code path. A data import, a fixture, or a future action that
// forgets it collides silently — and a duplicate handle is not cosmetic here: the storefront
// resolves a menu BY handle, so the second row is a menu nobody can reach and a merchant who
// cannot tell which one they are editing. A lock is a protocol; an index is a rule.

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;
let client: Sql;
let storeId = "";
let accountId = "";

beforeAll(async () => {
  if (!URL) return;
  client = postgres(URL, { max: 2 });
  const t = randomUUID().slice(0, 8);
  const [account] = await client<{ id: string }[]>`insert into accounts (name) values (${`Menus ${t}`}) returning id`;
  accountId = account.id;
  const [store] = await client<{ id: string }[]>`
    insert into stores (account_id, name, slug) values (${accountId}, ${`Menus ${t}`}, ${`menus-${t}`}) returning id`;
  storeId = store.id;
});

afterAll(async () => {
  if (!client) return;
  await client`delete from menus where store_id = ${storeId}`;
  await client`delete from stores where id = ${storeId}`;
  await client`delete from accounts where id = ${accountId}`;
  await client.end();
});

suite("menus: one handle per store (real PostgreSQL)", () => {
  it("refuses a second menu with the same handle in the same store", async () => {
    await client`insert into menus (store_id, name, handle) values (${storeId}, 'Menu Utama', 'utama')`;
    await expect(
      client`insert into menus (store_id, name, handle) values (${storeId}, 'Menu Utama Lagi', 'utama')`,
    ).rejects.toMatchObject({ code: "23505", constraint_name: "menus_store_handle_unique" });
  });

  // The scope is per STORE, and that is the half a plain `unique(handle)` would get wrong — every
  // shop wants a menu called "utama", and the first one to create it must not own the word.
  it("lets a DIFFERENT store use the same handle", async () => {
    const t = randomUUID().slice(0, 8);
    const [other] = await client<{ id: string }[]>`
      insert into stores (account_id, name, slug) values (${accountId}, ${`Menus ${t}`}, ${`menus-${t}`}) returning id`;
    await expect(
      client`insert into menus (store_id, name, handle) values (${other.id}, 'Menu Utama', 'utama')`,
    ).resolves.toBeDefined();
    await client`delete from menus where store_id = ${other.id}`;
    await client`delete from stores where id = ${other.id}`;
  });
});
