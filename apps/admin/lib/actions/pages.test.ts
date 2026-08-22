import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { createPage, deletePage, updatePage } from "./pages";

// Task 5.16 — a CMS page body survives the round trip, INCLUDING when it is deliberately empty.
//
// An empty page is a choice, not a gap: the storefront already renders `page.body.trim() ? <Prose/>
// : …`, so the editor must not disagree with it by manufacturing text. `seedBody(title)` — which
// produced "Selamat datang di halaman <judul>…" — is gone; it was one call away from the edit path,
// and wiring it back would persist invented prose over the merchant's deliberate emptiness the first
// time they pressed Simpan.
//
// Driven through the real actions against real PostgreSQL, because the claim is about what survives
// a WRITE and a READ — a mock would only agree with whatever this file assumed.

const h = vi.hoisted(() => ({
  storeId: "",
  tenant: null as unknown as <T>(s: string, fn: (db: PostgresJsDatabase) => Promise<T>) => Promise<T>,
}));
vi.mock("@tokophi/db", async () => ({ schema: await import("@tokophi/db/schema") }));
vi.mock("@/lib/rbac", () => ({
  requireCapability: async (capability: string) => {
    if (capability !== "content:write") throw new Error(`unexpected capability: ${capability}`);
    return { storeId: h.storeId };
  },
}));
vi.mock("@/lib/tenant", () => ({
  withTenant: <T>(s: string, fn: (db: PostgresJsDatabase) => Promise<T>) => h.tenant(s, fn),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const URL_ = process.env.TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;
let client: Sql;
let db: PostgresJsDatabase;

beforeAll(async () => {
  if (!URL_) return;
  client = postgres(URL_, { max: 4 });
  db = drizzle(client, { casing: "snake_case" });
  h.tenant = async <T>(s: string, fn: (tx: PostgresJsDatabase) => Promise<T>) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.store_id', ${s}, true)`);
      await tx.execute(sql`set local role tokophi_app`);
      return fn(tx as unknown as PostgresJsDatabase);
    });
  const t = randomUUID().slice(0, 8);
  const [acc] = (await db.execute(sql`insert into accounts (name) values (${`Pages ${t}`}) returning id`)) as unknown as { id: string }[];
  const [st] = (await db.execute(sql`
    insert into stores (account_id, name, slug) values (${acc.id}, ${`Pages ${t}`}, ${`pages-${t}`}) returning id`)) as unknown as { id: string }[];
  h.storeId = st.id;
});

afterAll(async () => {
  if (client) await client.end();
});

const read = async (id: string) => {
  const [row] = (await db.execute(sql`select title, body from pages where id = ${id}`)) as unknown as {
    title: string; body: string | null;
  }[];
  return row;
};

suite("CMS page bodies survive the round trip (real PostgreSQL)", () => {
  it("a written body comes back byte for byte", async () => {
    const body = "Kebijakan pengembalian:\n\n1. Barang utuh\n2. Maksimal 7 hari";
    const id = await createPage({ title: "Kebijakan", handle: `keb-${randomUUID().slice(0, 6)}`, body, published: true });
    expect((await read(id)).body).toBe(body);

    // Reopen and save WITHOUT touching the body — the editor round trip.
    const res = await updatePage(id, { title: "Kebijakan", handle: `keb-${randomUUID().slice(0, 6)}`, body, published: true });
    expect(res).toEqual({ ok: true });
    expect((await read(id)).body).toBe(body);
  });

  // 🔴 The one the removed filler would have broken: an empty page must STAY empty, not acquire
  // "Selamat datang di halaman …" the first time somebody presses Simpan.
  it("an intentionally empty body stays empty — no title-derived filler", async () => {
    const id = await createPage({ title: "Tentang Kami", handle: `ttg-${randomUUID().slice(0, 6)}`, body: "", published: true });
    const created = await read(id);
    expect(created.body ?? "").toBe("");
    expect(created.body ?? "").not.toMatch(/Selamat datang di halaman/);

    await updatePage(id, { title: "Tentang Kami", handle: `ttg-${randomUUID().slice(0, 6)}`, body: "", published: true });
    const saved = await read(id);
    expect(saved.body ?? "", "an empty page acquired text it never had").toBe("");
  });

  // Emptying a page ON PURPOSE is a save, not a no-op: the previous text must go.
  it("clearing a body persists the clearing", async () => {
    const id = await createPage({ title: "Draft", handle: `drf-${randomUUID().slice(0, 6)}`, body: "teks lama", published: false });
    await updatePage(id, { title: "Draft", handle: `drf-${randomUUID().slice(0, 6)}`, body: "", published: false });
    expect((await read(id)).body ?? "").toBe("");
  });

  it("saving a page that is gone is refused, not reported as saved", async () => {
    const res = await updatePage(randomUUID(), { title: "Hantu", handle: "hantu", body: "x", published: true });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it("deleting a page that is gone is refused, not reported as deleted", async () => {
    const id = await createPage({ title: "Sekali", handle: `skl-${randomUUID().slice(0, 6)}`, body: "x", published: true });
    expect(await deletePage(id)).toEqual({ ok: true });
    expect((await deletePage(id)).ok, "a second delete must not report success").toBe(false);
  });
});
