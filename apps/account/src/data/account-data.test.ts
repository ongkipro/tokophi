import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Sql } from "postgres";
import type { Db } from "./account";
import * as acct from "./account";

// TokoΦ Account — real Postgres, every case rolled back (ADR 0016: isolation is held by these
// predicates and these tests, not by RLS — the account is cross-tenant).
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
async function store(tx: Db) {
  const n = `${Date.now()}-${++seq}`;
  const [acc] = await rows(tx, sql`insert into accounts (name) values ('Acc Test') returning id`);
  const [s] = await rows(tx, sql`insert into stores (account_id, name, slug) values (${acc.id}, ${"Toko " + n}, ${"acc-test-" + n}) returning id, slug`);
  return { id: s.id as string, slug: s.slug as string };
}
const account = (tx: Db, email: string) => acct.upsertAccountBySub(tx, { sub: `dev:${email}`, email, name: email });

suite("account closure (ADR 0016 two-layer closure)", () => {
  it("closes MY account: sessions, links, claims and identity go; store rows are untouched", async () => {
    await inTxn(async (tx) => {
      const A = (await account(tx, "close-a@demo.local"))!;
      const B = (await account(tx, "close-b@demo.local"))!;
      const s = await store(tx);
      const [o] = await rows(tx, sql`insert into orders (store_id, number, status, subtotal_idr) values (${s.id}, ${"CL-" + ++seq}, 'selesai', 100000) returning id`);
      const before = (await rows(tx, sql`select row_to_json(o)::text as j from orders o where id = ${o.id}`))[0].j;
      await tx.execute(sql`insert into buyer_store_links (buyer_id, store_id, status, consent_version) values (${A}, ${s.id}, 'active', 'v1'), (${B}, ${s.id}, 'active', 'v1')`);
      await tx.execute(sql`insert into buyer_order_claims (order_id, buyer_id, store_id) values (${o.id}, ${A}, ${s.id})`);
      const sess = await acct.createSession(tx, A, "ua");
      const sess2 = await acct.createSession(tx, A, "ua-2");
      const other = await acct.createSession(tx, B, "ua");

      expect(await acct.closeAccount(tx, A)).toEqual({ ok: true });

      expect(await acct.loadSession(tx, sess)).toBeNull();
      expect(await acct.loadSession(tx, sess2)).toBeNull();
      // The session ROW is revoked, not merely unusable because the account is closed.
      expect((await rows(tx, sql`select count(*)::int n from buyer_sessions where buyer_id = ${A} and revoked_at is null`))[0].n).toBe(0);
      expect((await rows(tx, sql`select count(*)::int n from buyer_sessions where buyer_id = ${A} and user_agent is not null`))[0].n).toBe(0); // device strings blanked
      expect((await rows(tx, sql`select count(*)::int n from buyer_sessions where buyer_id = ${B} and user_agent is not null`))[0].n).toBe(1); // B's untouched
      expect(await acct.loadSession(tx, other)).not.toBeNull(); // B is untouched
      const [acc] = await rows(tx, sql`select status, google_sub, email, name from buyer_accounts where id = ${A}`);
      expect(acc).toEqual({ status: "closed", google_sub: `closed:${A}`, email: null, name: null });
      expect((await rows(tx, sql`select count(*)::int n from buyer_store_links where buyer_id = ${A} and status = 'active'`))[0].n).toBe(0);
      expect((await rows(tx, sql`select count(*)::int n from buyer_store_links where buyer_id = ${B} and status = 'active'`))[0].n).toBe(1);
      expect((await rows(tx, sql`select count(*)::int n from buyer_order_claims where buyer_id = ${A}`))[0].n).toBe(0);
      // Store-owned rows: the order is byte-identical.
      expect((await rows(tx, sql`select row_to_json(o)::text as j from orders o where id = ${o.id}`))[0].j).toBe(before);
      // Nothing reactivates it: closing twice, and the same Google identity gets a NEW account.
      expect(await acct.closeAccount(tx, A)).toEqual({ ok: false, reason: "not_active" });
      const again = await account(tx, "close-a@demo.local");
      expect(typeof again).toBe("string");
      expect(again).not.toBe(A);
    });
  });
});

suite("accounts and sessions", () => {
  it("one row per sub, ever; the name is not overwritten by a later sign-in", async () => {
    await inTxn(async (tx) => {
      const a1 = await acct.upsertAccountBySub(tx, { sub: "g-1", email: "x@y.id", name: "First" });
      const a2 = await acct.upsertAccountBySub(tx, { sub: "g-1", email: "new@y.id", name: "Second" });
      expect(a2).toBe(a1);
      const [r] = await rows(tx, sql`select name, email from buyer_accounts where id = ${a1}`);
      expect(r).toEqual({ name: "First", email: "new@y.id" });
    });
  });

  it("the row decides: revoked or suspended ⇒ no session; revoke-others keeps the current one (ACC-3)", async () => {
    await inTxn(async (tx) => {
      const id = (await account(tx, "s@demo.local"))!;
      const s1 = await acct.createSession(tx, id, "ua1");
      const s2 = await acct.createSession(tx, id, "ua2");
      expect((await acct.loadSession(tx, s1))?.account.id).toBe(id);
      expect(await acct.revokeOtherSessions(tx, id, s1)).toBe(1);
      expect(await acct.loadSession(tx, s2)).toBeNull();
      expect(await acct.loadSession(tx, s1)).not.toBeNull();
      await tx.execute(sql`update buyer_accounts set status = 'suspended' where id = ${id}`);
      expect(await acct.loadSession(tx, s1)).toBeNull();
    });
  });

  it("another account cannot revoke my session", async () => {
    await inTxn(async (tx) => {
      const me = (await account(tx, "me@demo.local"))!;
      const other = (await account(tx, "other@demo.local"))!;
      const s = await acct.createSession(tx, me, null);
      await acct.revokeSession(tx, other, s);
      expect(await acct.loadSession(tx, s)).not.toBeNull();
    });
  });

  it("Keluarkan one device: only MY other session — never another account's, never the current one", async () => {
    await inTxn(async (tx) => {
      const me = (await account(tx, "one@demo.local"))!;
      const other = (await account(tx, "one-other@demo.local"))!;
      const cur = await acct.createSession(tx, me, "ua-current");
      const phone = await acct.createSession(tx, me, "ua-phone");
      const theirs = await acct.createSession(tx, other, "ua-theirs");
      const theirCur = await acct.createSession(tx, other, "ua-their-current");

      // Another account's session id, posted from MY session ⇒ nothing happens.
      expect(await acct.revokeOneSession(tx, me, cur, theirs)).toBe(false);
      expect(await acct.loadSession(tx, theirs)).not.toBeNull();
      // Even "their current" passed as mine-to-keep cannot widen the predicate to their row.
      expect(await acct.revokeOneSession(tx, me, theirCur, theirs)).toBe(false);
      expect(await acct.loadSession(tx, theirs)).not.toBeNull();
      // The current session is not revocable here (that is "Keluar dari akun").
      expect(await acct.revokeOneSession(tx, me, cur, cur)).toBe(false);
      expect(await acct.loadSession(tx, cur)).not.toBeNull();
      // Garbage ids are refused before Postgres sees them (no 22P02 → 500).
      expect(await acct.revokeOneSession(tx, me, cur, "not-a-uuid")).toBe(false);
      expect(await acct.revokeOneSession(tx, me, cur, null)).toBe(false);

      expect(await acct.revokeOneSession(tx, me, cur, phone)).toBe(true);
      expect(await acct.loadSession(tx, phone)).toBeNull();
      expect(await acct.loadSession(tx, cur)).not.toBeNull();
      expect(await acct.revokeOneSession(tx, me, cur, phone)).toBe(false); // already revoked
      expect((await acct.listSessions(tx, me)).map((s) => s.id)).toEqual([cur]);
    });
  });

  it("rename: trimmed, 1–80 characters, MY row only", async () => {
    await inTxn(async (tx) => {
      const me = (await account(tx, "name@demo.local"))!;
      const other = (await account(tx, "name-other@demo.local"))!;
      const nameOf = async (id: string) => (await rows(tx, sql`select name from buyer_accounts where id = ${id}`))[0].name;

      expect(await acct.renameAccount(tx, me, "  Sari \n  Dewi\t ")).toEqual({ ok: true, name: "Sari Dewi" });
      expect(await nameOf(me)).toBe("Sari Dewi");
      expect(await nameOf(other)).toBe("name-other@demo.local");

      expect((await acct.renameAccount(tx, me, "   ")).ok).toBe(false);
      expect((await acct.renameAccount(tx, me, undefined)).ok).toBe(false);
      expect((await acct.renameAccount(tx, me, "x".repeat(81))).ok).toBe(false);
      expect((await acct.renameAccount(tx, me, "x".repeat(80))).ok).toBe(true);
      expect(await nameOf(me)).toBe("x".repeat(80));
      // A refused rename writes nothing.
      await acct.renameAccount(tx, me, "");
      expect(await nameOf(me)).toBe("x".repeat(80));
      // A later sign-in keeps the chosen name (upsert coalesces).
      await acct.upsertAccountBySub(tx, { sub: "dev:name@demo.local", email: "name@demo.local", name: "From Google" });
      expect(await nameOf(me)).toBe("x".repeat(80));
    });
  });
});
