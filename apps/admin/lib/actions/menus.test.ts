/**
 * Task 4.7 — the navigation editor's create path, against real PostgreSQL.
 *
 * "Buat menu" used to be pure client state: `handleCreateMenu` pushed a row into React and closed
 * the dialog, and nothing was ever written. The menu survived until the next page load and then
 * vanished, with a screen that had reported success.
 *
 * Every claim below was proved RED against a mutation of `menus.ts` before it was trusted (the
 * mutations are named in BUILD-LOG.md), because a test that has never failed is green for reasons
 * nobody checked.
 *
 * The two triggers are created on a THROWAWAY fixture's own rows: `pg_sleep` opens the window the
 * handle race needs, and `raise exception` is the injected child-insert failure. Both are dropped
 * in `finally`, both are keyed on a per-test UUID token so no other suite can collide with them.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { createMenu, saveMenu } from "./menus";

const h = vi.hoisted(() => ({
  storeId: "",
  tenant: null as unknown as <T>(storeId: string, fn: (db: PostgresJsDatabase) => Promise<T>) => Promise<T>,
  revalidatedPaths: [] as string[],
}));

vi.mock("@tokophi/db", async () => ({ schema: await import("@tokophi/db/schema") }));
vi.mock("@/lib/rbac", () => ({
  requireCapability: async (capability: string) => {
    if (capability !== "content:write") throw new Error(`unexpected capability: ${capability}`);
    return { storeId: h.storeId };
  },
}));
vi.mock("@/lib/tenant", () => ({
  withTenant: <T>(storeId: string, fn: (db: PostgresJsDatabase) => Promise<T>) => h.tenant(storeId, fn),
}));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => h.revalidatedPaths.push(path) }));

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;
let client: Sql;
let db: PostgresJsDatabase;

beforeAll(() => {
  if (!URL) return;
  // max ≥ 2: the concurrency test needs two transactions on two connections at the same time.
  client = postgres(URL, { max: 4 });
  db = drizzle(client, { casing: "snake_case" });
  h.tenant = async <T>(storeId: string, fn: (tenantDb: PostgresJsDatabase) => Promise<T>) =>
    db.transaction(async (tx) => {
      if (storeId !== h.storeId) throw new Error("action escaped its authenticated store");
      await tx.execute(sql`select set_config('app.store_id', ${storeId}, true)`);
      await tx.execute(sql`set local role tokophi_app`);
      return fn(tx as unknown as PostgresJsDatabase);
    });
});

beforeEach(() => {
  h.revalidatedPaths.length = 0;
});

afterAll(async () => {
  if (client) await client.end();
});

type Fixture = { accountId: string; storeId: string };

async function makeFixture(label: string): Promise<Fixture> {
  const token = randomUUID();
  const [account] = (await db.execute(sql`
    insert into accounts (name) values (${`Menu ${label}`}) returning id
  `)) as unknown as { id: string }[];
  const [store] = (await db.execute(sql`
    insert into stores (account_id, name, slug)
    values (${account.id}, ${`Menu ${label}`}, ${`menu-${token}`}) returning id
  `)) as unknown as { id: string }[];
  h.storeId = store.id;
  return { accountId: account.id, storeId: store.id };
}

async function cleanupFixture(fixture: Fixture) {
  await db.execute(sql`
    delete from menu_items where menu_id in (select id from menus where store_id = ${fixture.storeId})
  `);
  await db.execute(sql`delete from menus where store_id = ${fixture.storeId}`);
  await db.execute(sql`delete from stores where id = ${fixture.storeId}`);
  await db.execute(sql`delete from accounts where id = ${fixture.accountId}`);
}

/** What a RELOAD would read: the committed rows, in the order `getMenus` reads them. */
async function reload(storeId: string) {
  return (await db.execute(sql`
    select m.handle, m.name,
           mi.id as item_id, mi.parent_id, mi.label, mi.type, mi.target, mi.position
      from menus m
      left join menu_items mi on mi.menu_id = m.id
     where m.store_id = ${storeId}
     order by m.handle, mi.parent_id nulls first, mi.position
  `)) as unknown as {
    handle: string;
    name: string;
    item_id: string | null;
    parent_id: string | null;
    label: string | null;
    type: string | null;
    target: string | null;
    position: number | null;
  }[];
}

suite("navigation menu persistence", () => {
  it("persists the menu and its nested items, then the edit and the delete, as committed rows", async () => {
    const fixture = await makeFixture("lifecycle");
    const title = `Menu Promo ${randomUUID()}`;

    try {
      const created = await createMenu({
        title,
        items: [
          {
            title: "Promo",
            type: "koleksi",
            target: "/koleksi/promo",
            children: [{ title: "Produk pilihan", type: "produk", target: "/produk/pilihan" }],
          },
          { title: "Bantuan", type: "url", target: "/bantuan" },
        ],
      });

      expect(created).toEqual({ ok: true, handle: expect.any(String) });
      if (!created.ok) throw new Error("expected accepted create");
      expect(h.revalidatedPaths).toEqual(["/navigasi"]);

      const rows = await reload(fixture.storeId);
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.handle === created.handle && row.name === title)).toBe(true);
      const parent = rows.find((row) => row.label === "Promo");
      expect(parent).toMatchObject({ parent_id: null, type: "collection", target: "/koleksi/promo", position: 0 });
      // The child is keyed on the parent's REAL id, not on a client-side one.
      expect(rows.find((row) => row.label === "Produk pilihan")).toMatchObject({
        parent_id: parent?.item_id,
        type: "product",
        position: 0,
      });
      expect(rows.find((row) => row.label === "Bantuan")).toMatchObject({ parent_id: null, position: 1 });

      // EDIT — rename + replace the tree.
      h.revalidatedPaths.length = 0;
      const renamed = `${title} Pilihan`;
      expect(
        await saveMenu({ handle: created.handle, title: renamed, items: [{ title: "Sale", type: "url", target: "/sale" }] }),
      ).toEqual({ ok: true });
      expect(h.revalidatedPaths).toEqual(["/navigasi"]);
      expect(await reload(fixture.storeId)).toMatchObject([
        { name: renamed, label: "Sale", target: "/sale", position: 0 },
      ]);

      // DELETE the last item — the empty menu is a durable state, not a missing row.
      h.revalidatedPaths.length = 0;
      expect(await saveMenu({ handle: created.handle, title: renamed, items: [] })).toEqual({ ok: true });
      expect(await reload(fixture.storeId)).toMatchObject([{ name: renamed, item_id: null, label: null }]);
      expect(h.revalidatedPaths).toEqual(["/navigasi"]);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("rolls the menu row back when an initial item insert fails, and revalidates nothing", async () => {
    const fixture = await makeFixture("rollback");
    const token = randomUUID().replaceAll("-", "");
    const name = `test_fail_menu_item_${token}`;
    const failureLabel = `task47_failure_${token}`;
    const title = `Rollback ${token}`;
    let created = false;

    try {
      await client.unsafe(`
        create function "${name}"() returns trigger language plpgsql as $$
        begin
          if new.label = '${failureLabel}' then raise exception 'forced menu item failure'; end if;
          return new;
        end $$
      `);
      await client.unsafe(`create trigger "${name}" before insert on menu_items for each row execute function "${name}"()`);
      created = true;

      expect(
        await createMenu({ title, items: [{ title: failureLabel, type: "url", target: "/failure" }] }),
      ).toEqual({ ok: false, code: "save_failed", error: "Gagal membuat menu. Coba lagi." });

      // The parent went with it. A menu row with no items would be the half-write the dialog then
      // reports as success.
      expect(await reload(fixture.storeId)).toEqual([]);
      expect(h.revalidatedPaths).toEqual([]);
    } finally {
      if (created) await client.unsafe(`drop trigger if exists "${name}" on menu_items`);
      await client.unsafe(`drop function if exists "${name}"()`);
      await cleanupFixture(fixture);
    }
  });

  it("gives two concurrent creates of one title two distinct handles", async () => {
    const fixture = await makeFixture("concurrent");
    const token = randomUUID().replaceAll("-", "");
    const name = `test_delay_menu_${token}`;
    // 120 chars: also proves the suffix is taken OUT of the stem instead of pushing the handle past
    // the length the column is written with.
    const title = "x".repeat(120);
    let created = false;

    try {
      // Sleeps INSIDE the first transaction's INSERT — i.e. after it has read the taken handles —
      // which is exactly the window the second transaction used to read through.
      await client.unsafe(`
        create function "${name}"() returns trigger language plpgsql as $$
        begin
          if new.name = '${title}' and new.store_id = '${fixture.storeId}' then perform pg_sleep(0.25); end if;
          return new;
        end $$
      `);
      await client.unsafe(`create trigger "${name}" before insert on menus for each row execute function "${name}"()`);
      created = true;

      const [first, second] = await Promise.all([
        createMenu({ title, items: [] }),
        createMenu({ title, items: [] }),
      ]);

      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) throw new Error("expected two accepted creates");
      const handles = [first.handle, second.handle];
      expect(new Set(handles).size).toBe(2);
      expect(handles.every((handle) => handle.length <= 120)).toBe(true);
      expect(new Set(handles)).toEqual(new Set([title, `${"x".repeat(118)}-2`]));

      const stored = await db.execute(sql`select handle from menus where store_id = ${fixture.storeId}`);
      expect(new Set((stored as unknown as { handle: string }[]).map((row) => row.handle))).toEqual(new Set(handles));
    } finally {
      if (created) await client.unsafe(`drop trigger if exists "${name}" on menus`);
      await client.unsafe(`drop function if exists "${name}"()`);
      await cleanupFixture(fixture);
    }
  });

  it("refuses a save for a handle this store does not have, instead of reporting success", async () => {
    const fixture = await makeFixture("not-found");
    try {
      expect(await saveMenu({ handle: "menu-milik-toko-lain", title: "Menu", items: [] })).toEqual({
        ok: false,
        code: "not_found",
        error: "Menu tidak ditemukan. Muat ulang halaman ini.",
      });
      expect(h.revalidatedPaths).toEqual([]);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("refuses a third level and an unknown item type without writing anything", async () => {
    const fixture = await makeFixture("validation");
    try {
      const deep = await createMenu({
        title: "Terlalu dalam",
        items: [
          {
            title: "A",
            type: "url",
            target: "/a",
            children: [{ title: "B", type: "url", target: "/b", children: [{ title: "C", type: "url", target: "/c" }] }],
          },
        ],
      });
      expect(deep).toEqual({ ok: false, code: "invalid_request", error: "Susunan item menu tidak valid." });

      const bogus = await createMenu({
        title: "Tipe asing",
        items: [{ title: "A", type: "lookbook" as never, target: "/a" }],
      });
      expect(bogus).toEqual({ ok: false, code: "invalid_request", error: "Item menu tidak valid." });

      expect(await reload(fixture.storeId)).toEqual([]);
      expect(h.revalidatedPaths).toEqual([]);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
