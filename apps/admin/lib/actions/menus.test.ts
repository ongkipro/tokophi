import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { createMenu, saveMenu } from "./menus";

const h = vi.hoisted(() => ({
  storeId: "",
  tenant: null as unknown as <T>(
    storeId: string,
    fn: (db: PostgresJsDatabase) => Promise<T>,
  ) => Promise<T>,
  revalidatedPaths: [] as string[],
}));

vi.mock("@tokophi/db", async () => ({
  schema: await import("@tokophi/db/schema"),
}));
vi.mock("@/lib/rbac", () => ({
  requireCapability: async (capability: string) => {
    if (capability !== "content:write") {
      throw new Error(`unexpected capability: ${capability}`);
    }
    return { storeId: h.storeId };
  },
}));
vi.mock("@/lib/tenant", () => ({
  withTenant: <T>(
    storeId: string,
    fn: (db: PostgresJsDatabase) => Promise<T>,
  ) => h.tenant(storeId, fn),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => h.revalidatedPaths.push(path),
}));

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;
let client: Sql;
let db: PostgresJsDatabase;

beforeAll(() => {
  if (!URL) return;
  client = postgres(URL, { max: 4 });
  db = drizzle(client, { casing: "snake_case" });
  h.tenant = async <T>(
    storeId: string,
    fn: (tenantDb: PostgresJsDatabase) => Promise<T>,
  ) =>
    db.transaction(async (tx) => {
      if (storeId !== h.storeId) {
        throw new Error("action escaped its authenticated store");
      }
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
  return { accountId: account.id, storeId: store.id };
}

async function cleanupFixture(fixture: Fixture) {
  await db.execute(sql`
    delete from menu_items
    where menu_id in (select id from menus where store_id = ${fixture.storeId})
  `);
  await db.execute(sql`delete from menus where store_id = ${fixture.storeId}`);
  await db.execute(sql`delete from stores where id = ${fixture.storeId}`);
  await db.execute(sql`delete from accounts where id = ${fixture.accountId}`);
}

async function menuRows(storeId: string, name: string) {
  return (await db.execute(sql`
    select m.id as menu_id, m.name, m.handle,
           mi.id as item_id, mi.parent_id, mi.label, mi.type, mi.target, mi.position
    from menus m
    left join menu_items mi on mi.menu_id = m.id
    where m.store_id = ${storeId} and m.name = ${name}
    order by mi.parent_id nulls first, mi.position
  `)) as unknown as {
    menu_id: string;
    name: string;
    handle: string;
    item_id: string | null;
    parent_id: string | null;
    label: string | null;
    type: string | null;
    target: string | null;
    position: number | null;
  }[];
}

suite("navigation menu persistence", () => {
  it("creates parent and items, then persists item edit and delete", async () => {
    const fixture = await makeFixture("lifecycle");
    h.storeId = fixture.storeId;
    const title = `Menu Promo ${randomUUID()}`;

    try {
      const created = await createMenu({
        title,
        items: [
          {
            title: "Promo",
            type: "koleksi",
            target: "/koleksi/promo",
            children: [
              {
                title: "Produk pilihan",
                type: "produk",
                target: "/produk/pilihan",
              },
            ],
          },
          { title: "Bantuan", type: "url", target: "/bantuan" },
        ],
      });

      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("expected accepted create");
      expect(h.revalidatedPaths).toEqual(["/navigasi"]);

      const inserted = await menuRows(fixture.storeId, title);
      expect(inserted).toHaveLength(3);
      const rootPromo = inserted.find((row) => row.label === "Promo");
      expect(rootPromo).toMatchObject({
        handle: created.handle,
        parent_id: null,
        type: "collection",
        target: "/koleksi/promo",
        position: 0,
      });
      expect(inserted.find((row) => row.label === "Produk pilihan")).toMatchObject({
        parent_id: rootPromo?.item_id,
        type: "product",
        position: 0,
      });
      expect(inserted.find((row) => row.label === "Bantuan")).toMatchObject({
        parent_id: null,
        position: 1,
      });

      h.revalidatedPaths.length = 0;
      const renamed = `${title} Pilihan`;
      const saved = await saveMenu({
        handle: created.handle,
        title: renamed,
        items: [{ title: "Sale", type: "url", target: "/sale" }],
      });
      expect(saved).toEqual({ ok: true });
      expect(h.revalidatedPaths).toEqual(["/navigasi"]);
      expect(await menuRows(fixture.storeId, renamed)).toMatchObject([
        { label: "Sale", target: "/sale", position: 0 },
      ]);

      h.revalidatedPaths.length = 0;
      expect(
        await saveMenu({ handle: created.handle, title: renamed, items: [] }),
      ).toEqual({ ok: true });
      expect(await menuRows(fixture.storeId, renamed)).toMatchObject([
        { item_id: null, label: null },
      ]);
      expect(h.revalidatedPaths).toEqual(["/navigasi"]);
    } finally {
      await cleanupFixture(fixture);
    }
  });


  it("allocates distinct bounded handles for concurrent creates", async () => {
    const fixture = await makeFixture("concurrent");
    h.storeId = fixture.storeId;
    const token = randomUUID().replaceAll("-", "");
    const functionName = `test_delay_menu_${token}`;
    const triggerName = `test_delay_menu_${token}`;
    const title = "x".repeat(120);
    let triggerCreated = false;

    try {
      await client.unsafe(`
        create function "${functionName}"() returns trigger language plpgsql as $$
        begin
          if new.name = '${title}' then
            perform pg_sleep(0.2);
          end if;
          return new;
        end
        $$
      `);
      await client.unsafe(`
        create trigger "${triggerName}"
        before insert on menus
        for each row execute function "${functionName}"()
      `);
      triggerCreated = true;

      const [first, second] = await Promise.all([
        createMenu({ title, items: [] }),
        createMenu({ title, items: [] }),
      ]);

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok || !second.ok) throw new Error("expected accepted creates");
      const handles = [first.handle, second.handle];
      expect(new Set(handles).size).toBe(2);
      expect(handles.every((handle) => handle.length <= 120)).toBe(true);
      expect(handles).toContain(title);
      expect(handles).toContain(`${"x".repeat(118)}-2`);
      expect(await menuRows(fixture.storeId, title)).toHaveLength(2);
      expect(h.revalidatedPaths).toEqual(["/navigasi", "/navigasi"]);
    } finally {
      if (triggerCreated) {
        await client.unsafe(
          `drop trigger if exists "${triggerName}" on menus`,
        );
      }
      await client.unsafe(`drop function if exists "${functionName}"()`);
      await cleanupFixture(fixture);
    }
  });
  it("rolls back the menu row when an initial item insert fails", async () => {
    const fixture = await makeFixture("rollback");
    h.storeId = fixture.storeId;
    const token = randomUUID().replaceAll("-", "");
    const functionName = `test_fail_menu_item_${token}`;
    const triggerName = `test_fail_menu_item_${token}`;
    const failureLabel = `task47_failure_${token}`;
    const title = `Rollback ${token}`;
    let triggerCreated = false;

    try {
      await client.unsafe(`
        create function "${functionName}"() returns trigger language plpgsql as $$
        begin
          if new.label = '${failureLabel}' then
            raise exception 'forced menu item failure';
          end if;
          return new;
        end
        $$
      `);
      await client.unsafe(`
        create trigger "${triggerName}"
        before insert on menu_items
        for each row execute function "${functionName}"()
      `);
      triggerCreated = true;

      const result = await createMenu({
        title,
        items: [{ title: failureLabel, type: "url", target: "/failure" }],
      });

      expect(result).toEqual({
        ok: false,
        code: "save_failed",
        error: "Gagal membuat menu. Coba lagi.",
      });
      expect(await menuRows(fixture.storeId, title)).toEqual([]);
      expect(h.revalidatedPaths).toEqual([]);
    } finally {
      if (triggerCreated) {
        await client.unsafe(
          `drop trigger if exists "${triggerName}" on menu_items`,
        );
      }
      await client.unsafe(`drop function if exists "${functionName}"()`);
      await cleanupFixture(fixture);
    }
  });
});
