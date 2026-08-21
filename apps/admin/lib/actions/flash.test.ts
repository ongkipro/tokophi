import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { createFlashSale, updateFlashSale, deleteFlashSale } from "./flash";

// Flash sale — the two actions that reported SUCCESS over a write that did not happen.
//
// `updateFlashSale` read `owned` specifically to prove tenancy and then used it for the CHILD rows
// only: the parent `UPDATE … WHERE id = $1` ran unconditionally, matched zero rows under RLS for an
// id that is gone (or another store's), and the action still returned `{ ok: true, id }`. The editor
// toasts "Flash sale disimpan." on that and navigates away. `deleteFlashSale` was `Promise<void>`,
// so both of its callers announced a deletion they could not observe.
//
// Neither is visible to `tsc`, ESLint or `next build`: a zero-row UPDATE/DELETE is not an error in
// Postgres, and under RLS a foreign id is indistinguishable from a missing one. Only driving the
// action against a real database, as the non-owning tenant, tells them apart.
//
//   TEST_DATABASE_URL=postgresql://tokophi:tokophi@localhost:5433/tokophi_test \
//     npx vitest run apps/admin/lib/actions/flash.test.ts

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
    if (capability !== "discounts:write")
      throw new Error(`unexpected capability: ${capability}`);
    return { storeId: h.storeId };
  },
}));
vi.mock("@/lib/tenant", () => ({
  withTenant: <T>(storeId: string, fn: (db: PostgresJsDatabase) => Promise<T>) =>
    h.tenant(storeId, fn),
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
  h.tenant = async <T>(storeId: string, fn: (tenantDb: PostgresJsDatabase) => Promise<T>) =>
    db.transaction(async (tx) => {
      if (storeId !== h.storeId) throw new Error("action escaped its authenticated store");
      await tx.execute(sql`select set_config('app.store_id', ${storeId}, true)`);
      await tx.execute(sql`set local role tokophi_app`);
      return fn(tx as unknown as PostgresJsDatabase);
    });
});
afterAll(async () => {
  if (client) await client.end();
});

async function mkStore(): Promise<string> {
  const [account] = await client<{ id: string }[]>`
    insert into accounts (name) values (${`Flash ${randomUUID()}`}) returning id`;
  const [store] = await client<{ id: string }[]>`
    insert into stores (account_id, name, slug)
    values (${account.id}, 'Flash Store', ${`flash-${randomUUID()}`}) returning id`;
  return store.id;
}

const input = (name: string) => ({
  name,
  status: "aktif" as const,
  startsAt: new Date(Date.now() + 3_600_000).toISOString(),
  endsAt: new Date(Date.now() + 7_200_000).toISOString(),
  items: [],
});

suite("flash sale actions report what they WROTE", () => {
  it("an id that no longer exists is REFUSED, not reported as saved", async () => {
    h.storeId = await mkStore();
    const missing = randomUUID();
    const r = await updateFlashSale(missing, input("Promo hantu"));
    // The shipped code answered `{ ok: true, id }` here and the editor toasted "Flash sale disimpan."
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("sudah tidak ada");
  });

  it("ANOTHER store's sale is refused too — RLS makes it indistinguishable from missing", async () => {
    const other = await mkStore();
    h.storeId = other;
    const created = await createFlashSale(input("Milik toko lain"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    h.storeId = await mkStore(); // a different tenant now holds the session
    const r = await updateFlashSale(created.id, input("Dibajak"));
    expect(r.ok).toBe(false);

    // And the foreign row is untouched — the refusal is real, not cosmetic.
    const [row] = await client<{ name: string }[]>`
      select name from flash_sales where id = ${created.id}`;
    expect(row.name).toBe("Milik toko lain");
  });

  it("the tenant's OWN sale still saves, and the write lands", async () => {
    h.storeId = await mkStore();
    const created = await createFlashSale(input("Gajian"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const r = await updateFlashSale(created.id, input("Gajian Akhir Bulan"));
    expect(r.ok).toBe(true);
    const [row] = await client<{ name: string }[]>`
      select name from flash_sales where id = ${created.id}`;
    expect(row.name).toBe("Gajian Akhir Bulan");
  });

  it("deleteFlashSale returns its outcome — a missing id is not a deletion", async () => {
    h.storeId = await mkStore();
    const r = await deleteFlashSale(randomUUID());
    // It used to be `Promise<void>`, so both callers toasted "Flash sale dihapus." here.
    expect(r.ok).toBe(false);
  });

  it("deleting the tenant's own sale reports ok, and the row is gone", async () => {
    h.storeId = await mkStore();
    const created = await createFlashSale(input("Sekali pakai"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(await deleteFlashSale(created.id)).toEqual({ ok: true });
    const rows = await client`select id from flash_sales where id = ${created.id}`;
    expect(rows.length).toBe(0);
  });
});
