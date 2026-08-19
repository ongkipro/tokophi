import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { bulkDeleteProducts, bulkSetProductStatus } from "./products";

// The Produk selection bar prints this number: "12 produk diarsipkan." It used to be `ids.length` —
// the count the CLIENT asked for — while the UPDATE ran under RLS, which clamps a foreign id to zero
// rows silently. So a forged or stale id was reported as swept. Same rule as `markLabelsPrinted`.

const h = vi.hoisted(() => ({
  storeId: "",
  tenant: null as unknown as <T>(
    storeId: string,
    fn: (db: PostgresJsDatabase) => Promise<T>,
  ) => Promise<T>,
}));

vi.mock("@tokophi/db", async () => ({ schema: await import("@tokophi/db/schema") }));
vi.mock("@/lib/rbac", () => ({
  requireCapability: async (capability: string) => {
    if (!capability.startsWith("products:")) throw new Error(`unexpected capability: ${capability}`);
    return { storeId: h.storeId };
  },
}));
vi.mock("@/lib/tenant", () => ({
  withTenant: <T>(storeId: string, fn: (db: PostgresJsDatabase) => Promise<T>) =>
    h.tenant(storeId, fn),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

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

// Two products in OUR store, one in a stranger's. RLS makes the third invisible to the UPDATE —
// which is exactly the case the old count reported as done.
async function fixture() {
  const mk = async (label: string) => {
    const token = randomUUID().slice(0, 8);
    const [account] = (await db.execute(
      sql`insert into accounts (name) values (${`Bulk ${label}`}) returning id`,
    )) as unknown as { id: string }[];
    const [store] = (await db.execute(sql`
      insert into stores (account_id, name, slug)
      values (${account.id}, ${`Bulk ${label}`}, ${`bulk-${token}`}) returning id`)) as unknown as {
      id: string;
    }[];
    return store.id;
  };
  const mine = await mk("mine");
  const theirs = await mk("theirs");
  const product = async (storeId: string, n: number) => {
    const token = randomUUID().slice(0, 8);
    const [row] = (await db.execute(sql`
      insert into products (store_id, title, handle, number, has_variants)
      values (${storeId}, ${`P ${token}`}, ${`p-${token}`}, ${n}, false) returning id`)) as unknown as {
      id: string;
    }[];
    return row.id;
  };
  h.storeId = mine;
  return { a: await product(mine, 1), b: await product(mine, 2), foreign: await product(theirs, 1) };
}

suite("bulk product actions count rows, not ids (real PostgreSQL)", () => {
  it("bulkSetProductStatus ignores an id RLS never let it touch", async () => {
    const f = await fixture();
    const res = await bulkSetProductStatus([f.a, f.b, f.foreign], "draft");
    expect(res).toEqual({ ok: true, count: 2 });
  });

  it("bulkDeleteProducts likewise", async () => {
    const f = await fixture();
    const res = await bulkDeleteProducts([f.a, f.foreign]);
    expect(res).toEqual({ ok: true, count: 1 });
  });

  it("an empty selection is still zero", async () => {
    await fixture();
    await expect(bulkSetProductStatus([], "active")).resolves.toEqual({ ok: true, count: 0 });
  });
});
