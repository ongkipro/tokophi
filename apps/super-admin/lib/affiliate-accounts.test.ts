import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { PUBLISHED_PASSWORDS } from "@tokophi/lib/password";
import { listAffiliateAccounts, resetAffiliatePassword, setAffiliateDisabled, type Db } from "./affiliate-accounts";
// The affiliate app's OWN sign-in and session reader — the claim is about what the affiliate experiences,
// so it is proven with the code that decides it there, not with a re-statement of its SQL.
import { checkCredentials, createSession, loadSession, signUp } from "../../affiliate/src/data/auth";

// Super Admin → Affiliate (AFFILIATE-PW-RESET interim, ADR 0022) — real Postgres, every case rolled back.
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
const OLD = "sandi-lama-123";
async function account(tx: Db, name = "Rina Wulandari") {
  const email = `aff-sa-${Date.now()}-${++seq}@demo.local`;
  const r = await signUp(tx, { name, email, phone: `0813${String(seq).padStart(8, "0")}`, password: OLD });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return { id: r.accountId, email };
}
const activity = async (tx: Db, like: string) =>
  (await rows(tx, sql`select text from platform_activity where store_id is null and text like ${like} order by ts desc`)).map((r) => String(r.text));

suite("resetAffiliatePassword — the one-time hand-over", () => {
  it("old password fails, the minted one works, every old session is gone, and the audit names the operator", async () => {
    await inTxn(async (tx) => {
      const a = await account(tx);
      const t1 = await createSession(tx, a.id, "hp lama");
      const t2 = await createSession(tx, a.id, "laptop");
      expect(await loadSession(tx, t1)).not.toBeNull();

      const r = await resetAffiliatePassword(tx, a.id, "op@tokophi.test");
      if (!r.ok) throw new Error(r.error);
      expect(r.email).toBe(a.email);
      expect(r.revokedSessions).toBe(2);
      expect(r.password).toMatch(/^tokophi-[0-9a-z]{12}$/);
      expect(PUBLISHED_PASSWORDS as readonly string[]).not.toContain(r.password);

      expect(await checkCredentials(tx, a.email, OLD)).toBeNull();
      expect(await checkCredentials(tx, a.email, r.password)).toBe(a.id);
      expect(await loadSession(tx, t1)).toBeNull();
      expect(await loadSession(tx, t2)).toBeNull();
      // Never the password in the log — the operator and the outcome only.
      const [line] = await activity(tx, `Password akun affiliate ${a.email}%`);
      expect(line).toBe(`Password akun affiliate ${a.email} direset oleh op@tokophi.test — 2 sesi dicabut`);
      expect(line).not.toContain(r.password);
    });
  });

  it("two resets mint two different passwords; an unknown or junk id writes nothing and logs nothing", async () => {
    await inTxn(async (tx) => {
      const a = await account(tx);
      const r1 = await resetAffiliatePassword(tx, a.id, "op@tokophi.test");
      const r2 = await resetAffiliatePassword(tx, a.id, "op@tokophi.test");
      expect(r1.ok && r2.ok && r1.password !== r2.password).toBe(true);
      const before = (await rows(tx, sql`select count(*)::int as n from platform_activity`))[0].n;
      expect(await resetAffiliatePassword(tx, "00000000-0000-4000-8000-00000000abcd", "op@tokophi.test")).toEqual({ ok: false, error: "Akun affiliate tidak ditemukan." });
      expect((await resetAffiliatePassword(tx, "bukan-uuid", "op@tokophi.test")).ok).toBe(false);
      expect((await rows(tx, sql`select count(*)::int as n from platform_activity`))[0].n).toBe(before);
    });
  });

  it("a reset does not re-open a disabled account", async () => {
    await inTxn(async (tx) => {
      const a = await account(tx);
      await setAffiliateDisabled(tx, a.id, true, "op@tokophi.test");
      const r = await resetAffiliatePassword(tx, a.id, "op@tokophi.test");
      if (!r.ok) throw new Error(r.error);
      expect(await checkCredentials(tx, a.email, r.password)).toBeNull();
      expect((await activity(tx, `Password akun affiliate ${a.email}%`))[0]).toMatch(/akun tetap nonaktif/);
    });
  });
});

suite("setAffiliateDisabled — cannot sign in, sessions revoked; enable restores sign-in", () => {
  it("disable refuses the right password and kills live sessions; enable lets the same password in again", async () => {
    await inTxn(async (tx) => {
      const a = await account(tx);
      const token = await createSession(tx, a.id, null);
      const off = await setAffiliateDisabled(tx, a.id, true, "op@tokophi.test");
      expect(off).toEqual({ ok: true, email: a.email, disabled: true, revokedSessions: 1 });
      expect(await checkCredentials(tx, a.email, OLD)).toBeNull();
      expect(await loadSession(tx, token)).toBeNull();
      const [s] = await rows(tx, sql`select revoked_at from affiliate_sessions where account_id = ${a.id}`);
      expect(s.revoked_at).not.toBeNull();

      // A second click changes nothing and says so.
      expect(await setAffiliateDisabled(tx, a.id, true, "op@tokophi.test")).toEqual({ ok: false, error: "Akun ini sudah nonaktif." });

      const on = await setAffiliateDisabled(tx, a.id, false, "op@tokophi.test");
      expect(on).toEqual({ ok: true, email: a.email, disabled: false, revokedSessions: 0 });
      expect(await checkCredentials(tx, a.email, OLD)).toBe(a.id);
      expect(await loadSession(tx, token)).toBeNull(); // the revoked session stays revoked
      expect(await setAffiliateDisabled(tx, a.id, false, "op@tokophi.test")).toEqual({ ok: false, error: "Akun ini sudah aktif." });
      // One line per write that happened (the two refused clicks wrote none); same `now()` in this txn, so sorted.
      expect((await activity(tx, `Akun affiliate ${a.email}%`)).sort()).toEqual([
        `Akun affiliate ${a.email} diaktifkan lagi oleh op@tokophi.test`,
        `Akun affiliate ${a.email} dinonaktifkan oleh op@tokophi.test — 1 sesi dicabut`,
      ]);
    });
  });

  it("only the named account is touched", async () => {
    await inTxn(async (tx) => {
      const a = await account(tx);
      const b = await account(tx);
      const tb = await createSession(tx, b.id, null);
      await setAffiliateDisabled(tx, a.id, true, "op@tokophi.test");
      await resetAffiliatePassword(tx, a.id, "op@tokophi.test");
      expect(await checkCredentials(tx, b.email, OLD)).toBe(b.id);
      expect(await loadSession(tx, tb)).not.toBeNull();
    });
  });
});

suite("listAffiliateAccounts", () => {
  it("searches email or name, treats % and _ literally, and lists the stores an account is bound to", async () => {
    await inTxn(async (tx) => {
      const a = await account(tx, "Sekar Ayu");
      const [acc] = await rows(tx, sql`insert into accounts (name) values ('SA aff') returning id`);
      const [s] = await rows(tx, sql`insert into stores (account_id, name, slug) values (${acc.id}, 'Toko Sekar', ${"sa-aff-" + seq}) returning id`);
      await tx.execute(sql`insert into affiliates (store_id, account_id, code, name, phone, status) values (${s.id}, ${a.id}, 'SEKAR1', 'Sekar Ayu', '6281300000999', 'aktif')`);

      const byName = await listAffiliateAccounts(tx, "sekar ayu");
      expect(byName.rows.map((r) => r.id)).toContain(a.id);
      const row = byName.rows.find((r) => r.id === a.id)!;
      expect(row.stores).toEqual([{ name: "Toko Sekar", slug: `sa-aff-${seq}`, status: "aktif" }]);
      expect(row.liveSessions).toBe(0);
      expect((await listAffiliateAccounts(tx, a.email.toUpperCase())).rows.map((r) => r.id)).toEqual([a.id]);
      expect((await listAffiliateAccounts(tx, "%")).rows.map((r) => r.id)).not.toContain(a.id);
    });
  });
});
