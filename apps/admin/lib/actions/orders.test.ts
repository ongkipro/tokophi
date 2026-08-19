import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { setOrderStatus } from "./orders";
import { orderStatusRefusalMessage, type OrderStatusRefusal } from "../order-status-refusal";
import { codeOnly } from "../../../../test/source-code";

// `setOrderStatus` USED TO RETURN NOTHING, so all three merchant screens toasted success over
// changes the state machine had refused — including "Pesanan ditandai retur — stok dikembalikan."
// on a refusal that moved no stock. These drive the real action against real PostgreSQL, because
// the claim is about what the state machine answers for a row in a given state.

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
    if (capability !== "orders:write") throw new Error(`unexpected capability: ${capability}`);
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

async function makeOrder(status: string): Promise<string> {
  const token = randomUUID().slice(0, 8);
  const [account] = (await db.execute(
    sql`insert into accounts (name) values (${`Orders ${token}`}) returning id`,
  )) as unknown as { id: string }[];
  const [store] = (await db.execute(sql`
    insert into stores (account_id, name, slug)
    values (${account.id}, ${`Orders ${token}`}, ${`orders-${token}`}) returning id`)) as unknown as {
    id: string;
  }[];
  h.storeId = store.id;
  const number = `INV-${token}`;
  await db.execute(sql`
    insert into orders (store_id, number, status, channel)
    values (${store.id}, ${number}, ${sql.raw(`'${status}'`)}, 'meta_ads')`);
  return number;
}

suite("setOrderStatus reports what it wrote (real PostgreSQL)", () => {
  it("a legal move applies", async () => {
    const number = await makeOrder("baru");
    await expect(setOrderStatus(number, "diproses")).resolves.toEqual({ applied: true });
  });

  // 🔴 The dialog that says "stok dikembalikan". A cancelled order accepts no further transition,
  // and the refusal is silent — 0 rows, no throw. Before this, the merchant read that sentence.
  it("a terminal order refuses, and says why", async () => {
    const number = await makeOrder("batal");
    const res = await setOrderStatus(number, "retur", "Paket kembali");
    expect(res).toEqual({ applied: false, reason: "terminal-order" });
  });

  it("an illegal move refuses", async () => {
    const number = await makeOrder("baru");
    const res = await setOrderStatus(number, "selesai");
    expect(res).toEqual({ applied: false, reason: "transition-not-allowed" });
  });

  it("a repeat of the same status refuses", async () => {
    const number = await makeOrder("dikirim");
    const res = await setOrderStatus(number, "dikirim");
    expect(res).toEqual({ applied: false, reason: "status-unchanged" });
  });

  // RLS filters another store's order out of the lookup, so this is also the cross-tenant answer.
  // It was a bare `return`, i.e. indistinguishable from success at every call site.
  it("an order that is not there (or not ours) refuses", async () => {
    await makeOrder("baru"); // sets h.storeId to a store that does NOT own the number below
    const res = await setOrderStatus(`INV-${randomUUID().slice(0, 8)}`, "diproses");
    expect(res).toEqual({ applied: false, reason: "order-not-found" });
  });
});

// The action returning an outcome is worth nothing if a screen goes on ignoring it — that WAS the
// bug, and nothing in a type checker objects to `await someAction()` with the result dropped. There
// is no way to assert a client component's toast from here, so the claim is made about the CODE,
// the way this repo's other unreachable claims are (`apps/admin/lib/public-guard.test.ts`), with
// the same self-proof.
describe("no screen calls setOrderStatus and ignores the answer", () => {
  const SCREENS = [
    "app/(admin)/pesanan/pesanan-client.tsx",
    "app/(admin)/pesanan/[id]/order-detail.tsx",
  ];
  const read = (rel: string) =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../..", rel), "utf8");
  // Every call is bound to a name, and the file branches on `applied`. Counting rather than
  // pattern-matching one site: the detail screen has two calls and only one of them was the
  // expensive one, so "at least one is bound" would have passed on the shipped bug.
  const calls = (code: string) => [...code.matchAll(/setOrderStatus\s*\(/g)].length;
  const bound = (code: string) => [...code.matchAll(/=\s*await\s+setOrderStatus\s*\(/g)].length;

  it.each(SCREENS)("%s binds every call and reads .applied", (rel) => {
    const code = codeOnly(read(rel));
    expect(calls(code)).toBeGreaterThan(0);
    expect(bound(code)).toBe(calls(code));
    expect(code).toMatch(/\.\s*applied/);
  });

  // Put the shipped shape back and the count must diverge. A source guard nobody has seen red is
  // green for reasons nobody has checked.
  it("goes red on a call whose result is dropped", () => {
    const reverted = codeOnly(
      read(SCREENS[1]).replace("const res = await setOrderStatus", "await setOrderStatus"),
    );
    expect(bound(reverted)).toBeLessThan(calls(reverted));
  });
});

describe("every refusal owes the merchant a sentence", () => {
  const ALL: OrderStatusRefusal[] = [
    "order-not-found",
    "status-unchanged",
    "terminal-order",
    "transition-not-allowed",
  ];

  it.each(ALL)("%s has its own message", (reason) => {
    const message = orderStatusRefusalMessage(reason);
    expect(message.length).toBeGreaterThan(20);
    // Distinct, not one sentence wearing four names: a merchant who cannot tell "already done" from
    // "refused" has no idea whether to reload or to stop.
    expect(ALL.filter((r) => orderStatusRefusalMessage(r) === message)).toEqual([reason]);
  });
});
