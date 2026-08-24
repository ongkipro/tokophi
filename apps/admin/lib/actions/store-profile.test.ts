// Task 6.9 / F-F7 — the per-store PUBLIC contact email (`stores.email`, migration 0070) round-trips
// through the real tenant-scoped profile action, against real PostgreSQL.
//
// The claims, each of which has shipped broken somewhere in this repo's history:
//   1. TWO stores persist DIFFERENT emails and each tenant reads back only its own — `stores` has no
//      `store_id` column, so the explicit `where id = storeId` in the action is the rule and the 0058
//      RLS policy is only the net (see AGENTS.md: two functions once did `.from(stores).limit(1)` and
//      served a stranger's shop).
//   2. Under the tenant role (`tokophi_app` + `app.store_id` GUC), another store's row is INVISIBLE
//      even to a raw query — the 0058 net actually catches.
//   3. An invalid address is REJECTED at the action (`{ok:false}` — the card shows the message) and
//      nothing is written.
//   4. CLEARING the field stores NULL, survives a re-read, and comes back as the empty string — never
//      any placeholder address. Empty is the NORMAL case, not an error.
//
// Same harness as purchases.test.ts: the RBAC/tenant wrappers are mocked at the boundary but the
// mock RUNS the real transaction shape (GUC + `set local role tokophi_app`), so the SQL executes
// under the same role and policies as production's withTenant/withCurrentTenant.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { getStoreProfile, saveStoreProfile } from "./store-profile";

const h = vi.hoisted(() => ({
  storeId: "",
  tenant: null as unknown as <T>(
    storeId: string,
    fn: (db: PostgresJsDatabase, storeId: string) => Promise<T>,
  ) => Promise<T>,
}));

vi.mock("@tokophi/db", async () => ({
  schema: await import("@tokophi/db/schema"),
}));
vi.mock("@/lib/rbac", () => ({
  requireCapability: async (capability: string) => {
    if (capability !== "settings:write")
      throw new Error(`unexpected capability: ${capability}`);
    return { storeId: h.storeId };
  },
}));
vi.mock("@/lib/tenant", () => ({
  withTenant: <T>(storeId: string, fn: (db: PostgresJsDatabase) => Promise<T>) =>
    h.tenant(storeId, fn),
  // The read half takes no storeId argument — it resolves the session's store itself. The mock hands
  // the callback the SAME authenticated store as the writes, which is exactly what lib/tenant.ts does.
  withCurrentTenant: <T>(fn: (db: PostgresJsDatabase, storeId: string) => Promise<T>) =>
    h.tenant(h.storeId, fn),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// Branding uploads touch sharp + the filesystem and are not under test here.
vi.mock("@/lib/image-store", () => ({
  saveImage: async () => {
    throw new Error("not under test");
  },
  saveFavicon: async () => {
    throw new Error("not under test");
  },
  deleteImageFile: async () => {},
  MAX_BYTES: 2 * 1024 * 1024,
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
    fn: (tenantDb: PostgresJsDatabase, storeId: string) => Promise<T>,
  ) =>
    db.transaction(async (tx) => {
      if (storeId !== h.storeId)
        throw new Error("action escaped its authenticated store");
      await tx.execute(sql`select set_config('app.store_id', ${storeId}, true)`);
      await tx.execute(sql`set local role tokophi_app`);
      return fn(tx as unknown as PostgresJsDatabase, storeId);
    });
});

afterAll(async () => {
  if (client) await client.end();
});

type Fixture = { accountId: string; storeId: string };

async function makeStore(label: string): Promise<Fixture> {
  const token = randomUUID();
  const [account] = (await db.execute(sql`
    insert into accounts (name) values (${`Email ${label}`}) returning id
  `)) as unknown as { id: string }[];
  const [store] = (await db.execute(sql`
    insert into stores (account_id, name, slug)
    values (${account.id}, ${`Email ${label}`}, ${`email-${token}`}) returning id
  `)) as unknown as { id: string }[];
  return { accountId: account.id, storeId: store.id };
}

async function cleanup(f: Fixture) {
  await db.execute(sql`delete from stores where id = ${f.storeId}`);
  await db.execute(sql`delete from accounts where id = ${f.accountId}`);
}

/** The row as the OWNER sees it — the ground truth the tenant-scoped reads are compared against. */
async function rawEmail(storeId: string): Promise<string | null> {
  const [row] = (await db.execute(
    sql`select email from stores where id = ${storeId}`,
  )) as unknown as { email: string | null }[];
  return row?.email ?? null;
}

const baseInput = { name: "Toko Uji", tagline: "", whatsapp: "" };

suite("store public email round-trip (real PostgreSQL)", () => {
  it("two stores persist different emails and each tenant reads back only its own", async () => {
    const a = await makeStore("A");
    const b = await makeStore("B");
    try {
      h.storeId = a.storeId;
      expect(
        await saveStoreProfile({ ...baseInput, name: "Toko A", email: "cs-a@example.com" }),
      ).toEqual({ ok: true });
      h.storeId = b.storeId;
      expect(
        await saveStoreProfile({ ...baseInput, name: "Toko B", email: "cs-b@example.com" }),
      ).toEqual({ ok: true });

      // Ground truth: each row holds its own address, neither overwrote the other.
      expect(await rawEmail(a.storeId)).toBe("cs-a@example.com");
      expect(await rawEmail(b.storeId)).toBe("cs-b@example.com");

      // Tenant-scoped read returns THIS store's email — never the other one's.
      h.storeId = a.storeId;
      expect((await getStoreProfile()).email).toBe("cs-a@example.com");
      h.storeId = b.storeId;
      expect((await getStoreProfile()).email).toBe("cs-b@example.com");
    } finally {
      await cleanup(a);
      await cleanup(b);
    }
  });

  it("under the tenant role, another store's row is invisible even to a raw query (0058)", async () => {
    const a = await makeStore("RLS-A");
    const b = await makeStore("RLS-B");
    try {
      h.storeId = a.storeId;
      const rows = await h.tenant(a.storeId, async (tenantDb) =>
        (await tenantDb.execute(
          sql`select email from stores where id = ${b.storeId}`,
        )) as unknown as { email: string | null }[],
      );
      expect(rows).toHaveLength(0);
    } finally {
      await cleanup(a);
      await cleanup(b);
    }
  });

  it("rejects an invalid address at the action and writes nothing", async () => {
    const a = await makeStore("Invalid");
    try {
      h.storeId = a.storeId;
      expect(
        await saveStoreProfile({ ...baseInput, email: "cs-valid@example.com" }),
      ).toEqual({ ok: true });

      const res = await saveStoreProfile({ ...baseInput, email: "bukan-alamat-email" });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/email tidak valid/i);
      // The rejected save must not have touched the row.
      expect(await rawEmail(a.storeId)).toBe("cs-valid@example.com");
    } finally {
      await cleanup(a);
    }
  });

  it("clearing the field stores NULL, survives a re-read, and exposes no placeholder", async () => {
    const a = await makeStore("Clear");
    try {
      h.storeId = a.storeId;
      expect(
        await saveStoreProfile({ ...baseInput, email: "cs-clear@example.com" }),
      ).toEqual({ ok: true });
      expect(await rawEmail(a.storeId)).toBe("cs-clear@example.com");

      expect(await saveStoreProfile({ ...baseInput, email: "" })).toEqual({ ok: true });
      // NULL in the column — "" would read as a published-but-blank address.
      expect(await rawEmail(a.storeId)).toBeNull();
      // The reload path: the profile comes back EMPTY, never any fallback address.
      expect((await getStoreProfile()).email).toBe("");
    } finally {
      await cleanup(a);
    }
  });
});
