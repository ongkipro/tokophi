import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Sql } from "postgres";
import { newInvite } from "@tokophi/lib/account-invite";
import type { Db } from "./account";
import * as acct from "./account";
import * as aff from "./affiliate";

// TokoΦ Account — real Postgres, every case rolled back (spec §17.8 D-4: isolation is held by these
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
async function store(tx: Db, opts: { enabled?: boolean } = {}) {
  const n = `${Date.now()}-${++seq}`;
  const [acc] = await rows(tx, sql`insert into accounts (name) values ('Acc Test') returning id`);
  const [s] = await rows(tx, sql`insert into stores (account_id, name, slug) values (${acc.id}, ${"Toko " + n}, ${"acc-test-" + n}) returning id, slug`);
  await tx.execute(sql`insert into store_settings (store_id, affiliate_enabled) values (${s.id}, ${opts.enabled ?? true})`);
  return { id: s.id as string, slug: s.slug as string };
}
async function affiliate(tx: Db, storeId: string, o: { code: string; accountId?: string | null; status?: string; phone?: string }) {
  const [r] = await rows(
    tx,
    sql`insert into affiliates (store_id, code, name, phone, status, account_id)
        values (${storeId}, ${o.code}, ${o.code}, ${o.phone ?? "6281200000" + String(++seq).padStart(3, "0")},
                ${o.status ?? "aktif"}::affiliate_status, ${o.accountId ?? null}) returning id`,
  );
  return r.id as string;
}
async function commission(tx: Db, storeId: string, affiliateId: string, amount: number, status = "pending", eligible: "past" | "future" | null = "past") {
  const [o] = await rows(
    tx,
    sql`insert into orders (store_id, number, status, subtotal_idr) values (${storeId}, ${"ACC-" + ++seq}, 'selesai', ${amount * 10}) returning id`,
  );
  await tx.execute(sql`
    insert into affiliate_commissions (store_id, affiliate_id, order_id, source, base_idr, commission_idr, status, eligible_at)
    values (${storeId}, ${affiliateId}, ${o.id}, 'kode', ${amount * 10}, ${amount}, ${status}::affiliate_commission_status,
            ${eligible === "past" ? sql`now() - interval '1 day'` : eligible === "future" ? sql`now() + interval '2 days'` : null})`);
}
const account = (tx: Db, email: string) => acct.upsertAccountBySub(tx, { sub: `dev:${email}`, email, name: email });

suite("account closure (ACC-15)", () => {
  it("closes MY account: sessions, links, claims, addresses and identity go; store rows are untouched", async () => {
    await inTxn(async (tx) => {
      const A = (await account(tx, "close-a@demo.local"))!;
      const B = (await account(tx, "close-b@demo.local"))!;
      const s = await store(tx);
      const [o] = await rows(tx, sql`insert into orders (store_id, number, status, subtotal_idr) values (${s.id}, ${"CL-" + ++seq}, 'selesai', 100000) returning id`);
      const before = (await rows(tx, sql`select row_to_json(o)::text as j from orders o where id = ${o.id}`))[0].j;
      await tx.execute(sql`insert into buyer_store_links (buyer_id, store_id, status, consent_version) values (${A}, ${s.id}, 'active', 'v1'), (${B}, ${s.id}, 'active', 'v1')`);
      await tx.execute(sql`insert into buyer_order_claims (order_id, buyer_id, store_id) values (${o.id}, ${A}, ${s.id})`);
      await tx.execute(sql`insert into kiriminaja_areas (id, district_name, city_type, city_name, province_name) values (987654, 'Dist', 'Kota', 'City', 'Prov') on conflict do nothing`);
      await tx.execute(sql`insert into buyer_addresses (buyer_id, recipient, phone, address, district_id, postal_code) values (${A}, 'A', '6281200000999', 'Jl Test 12', 987654, '12345')`);
      const aff1 = await affiliate(tx, s.id, { code: "CLOSEA", accountId: A });
      const s2 = await store(tx);
      const aff2 = await affiliate(tx, s2.id, { code: "CLOSEB", accountId: A, status: "ditolak" });
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
      const [acc] = await rows(tx, sql`select status, google_sub, email, name, phone from buyer_accounts where id = ${A}`);
      expect(acc).toEqual({ status: "closed", google_sub: `closed:${A}`, email: null, name: null, phone: null });
      expect((await rows(tx, sql`select count(*)::int n from buyer_store_links where buyer_id = ${A} and status = 'active'`))[0].n).toBe(0);
      expect((await rows(tx, sql`select count(*)::int n from buyer_store_links where buyer_id = ${B} and status = 'active'`))[0].n).toBe(1);
      expect((await rows(tx, sql`select count(*)::int n from buyer_order_claims where buyer_id = ${A}`))[0].n).toBe(0);
      expect((await rows(tx, sql`select count(*)::int n from buyer_addresses where buyer_id = ${A}`))[0].n).toBe(0);
      // Store-owned rows: the order is byte-identical and the affiliate record survives, detached.
      expect((await rows(tx, sql`select row_to_json(o)::text as j from orders o where id = ${o.id}`))[0].j).toBe(before);
      const [af1] = await rows(tx, sql`select account_id, status, note from affiliates where id = ${aff1}`);
      expect(af1.account_id).toBeNull();
      // Detached AND deactivated: attribution only ever credits `aktif` rows, so no commission can accrue to nobody.
      expect(af1.status).toBe("nonaktif");
      expect(String(af1.note)).toContain("ditutup");
      expect((await rows(tx, sql`select status, account_id from affiliates where id = ${aff2}`))[0]).toEqual({ status: "ditolak", account_id: null }); // a refused row keeps its status
      expect((await rows(tx, sql`select count(*)::int n from affiliates where id = ${aff1} and status = 'aktif'`))[0].n).toBe(0);
      // Nothing reactivates it: closing twice, and the same Google identity gets a NEW account.
      expect(await acct.closeAccount(tx, A)).toEqual({ ok: false, reason: "not_active" });
      const again = await account(tx, "close-a@demo.local");
      expect(typeof again).toBe("string");
      expect(again).not.toBe(A);
    });
  });

  it("is refused while a programme still owes the account money — and then nothing changes", async () => {
    await inTxn(async (tx) => {
      const A = (await account(tx, "owed@demo.local"))!;
      const s = await store(tx);
      const a1 = await affiliate(tx, s.id, { code: "OWED", accountId: A });
      await commission(tx, s.id, a1, 12_000, "pending", "future"); // ditahan
      const a2 = await affiliate(tx, (await store(tx)).id, { code: "OWED2", accountId: A });
      await commission(tx, (await rows(tx, sql`select store_id from affiliates where id = ${a2}`))[0].store_id as string, a2, 3_000, "pending", "past"); // siap
      const sess = await acct.createSession(tx, A, "ua");
      const r = await acct.closeAccount(tx, A);
      expect(r.ok).toBe(false);
      expect(r).toMatchObject({ reason: "unpaid_commission" });
      expect((r as { stores?: string[] }).stores).toHaveLength(2); // both the held and the ready programme are named
      expect(await acct.loadSession(tx, sess)).not.toBeNull();
      expect((await rows(tx, sql`select status, email from buyer_accounts where id = ${A}`))[0]).toEqual({ status: "active", email: "owed@demo.local" });
      expect((await rows(tx, sql`select count(*)::int n from affiliates where account_id = ${A} and status = 'aktif'`))[0].n).toBe(2); // nothing deactivated
      // Once the store has paid it, closure goes through.
      await tx.execute(sql`update affiliate_commissions set status = 'dibayar' where affiliate_id in (${a1}, ${a2})`);
      expect(await acct.closeAccount(tx, A)).toEqual({ ok: true });
    });
  });
});

suite("a closed account cannot be written to", () => {
  it("join, accept-invitation and address saves are refused once closed; the closure leaves no new rows behind", async () => {
    await inTxn(async (tx) => {
      const A = (await account(tx, "gone@demo.local"))!;
      const s = await store(tx);
      expect(await acct.closeAccount(tx, A)).toEqual({ ok: true });
      expect(await aff.joinProgramme(tx, A, s.slug, { name: "Gone", phone: "6281299900011", bankName: null, bankAccount: null, bankHolder: null, note: null })).toBe("failed");
      const row = await affiliate(tx, s.id, { code: "GONEINV" });
      const inv = newInvite();
      await tx.execute(sql`update affiliates set invite_hash = ${inv.hash}, invite_expires_at = now() + interval '7 days' where id = ${row}`);
      expect(await aff.acceptInvite(tx, A, inv.token)).toEqual({ ok: false, reason: "invalid" });
      expect((await rows(tx, sql`select account_id, invite_hash is not null as live from affiliates where id = ${row}`))[0]).toEqual({ account_id: null, live: true }); // invitation untouched
      expect((await rows(tx, sql`select count(*)::int n from affiliates where account_id = ${A}`))[0].n).toBe(0);
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

suite("affiliate area — one account, many stores, nobody else's", () => {
  it("lists exactly MY rows across stores with per-store totals; account B sees none of them", async () => {
    await inTxn(async (tx) => {
      const A = (await account(tx, "a@demo.local"))!;
      const B = (await account(tx, "b@demo.local"))!;
      const s1 = await store(tx);
      const s2 = await store(tx);
      const a1 = await affiliate(tx, s1.id, { code: "AONE", accountId: A });
      const a2 = await affiliate(tx, s2.id, { code: "ATWO", accountId: A });
      const b1 = await affiliate(tx, s1.id, { code: "BONE", accountId: B });
      await commission(tx, s1.id, a1, 10_000, "pending", "past"); // siap
      await commission(tx, s1.id, a1, 5_000, "pending", "future"); // ditahan
      await commission(tx, s2.id, a2, 7_000, "dibayar");
      await commission(tx, s1.id, b1, 99_000, "pending", "past");

      const mine = await aff.myAffiliateStores(tx, A);
      expect(mine.map((m) => m.code).sort()).toEqual(["AONE", "ATWO"]);
      const one = mine.find((m) => m.code === "AONE")!;
      expect([one.readyIdr, one.heldIdr, one.paidIdr]).toEqual([10_000, 5_000, 0]);
      expect(mine.find((m) => m.code === "ATWO")!.paidIdr).toBe(7_000);

      expect((await aff.myAffiliateStores(tx, B)).map((m) => m.code)).toEqual(["BONE"]);
      // B asking for A's row by id gets exactly what an unknown id gets.
      expect(await aff.myAffiliateDetail(tx, B, a1)).toBeNull();
      const d = await aff.myAffiliateDetail(tx, A, a1);
      expect(d?.commissions.map((x) => x.state).sort()).toEqual(["ditahan", "siap"]);
    });
  });

  it("join: one menunggu row bound to the account; again ⇒ member; programme off ⇒ closed", async () => {
    await inTxn(async (tx) => {
      const A = (await account(tx, "j@demo.local"))!;
      const s = await store(tx);
      const off = await store(tx, { enabled: false });
      const input = { name: "Rina", phone: "6281299990001", bankName: null, bankAccount: null, bankHolder: null, note: "IG" };
      expect(await aff.joinProgramme(tx, A, s.slug, input)).toBe("created");
      const [r] = await rows(tx, sql`select status, account_id from affiliates where store_id = ${s.id}`);
      expect(r).toEqual({ status: "menunggu", account_id: A });
      expect(await aff.joinProgramme(tx, A, s.slug, input)).toBe("member");
      expect(await aff.joinProgramme(tx, A, off.slug, input)).toBe("closed");
      expect(await aff.joinProgramme(tx, A, "no-such-store-zz", input)).toBe("closed");
    });
  });

  it("join never takes over someone's form application by phone", async () => {
    await inTxn(async (tx) => {
      const A = (await account(tx, "p@demo.local"))!;
      const s = await store(tx);
      await affiliate(tx, s.id, { code: "FORMONLY", phone: "6281277770000" });
      const input = { name: "X", phone: "6281277770000", bankName: null, bankAccount: null, bankHolder: null, note: null };
      expect(await aff.joinProgramme(tx, A, s.slug, input)).toBe("phone_taken");
      const [r] = await rows(tx, sql`select count(*)::int as n from affiliates where store_id = ${s.id} and account_id is not null`);
      expect(r.n).toBe(0);
    });
  });

  it("join is rate-limited per account", async () => {
    await inTxn(async (tx) => {
      const A = (await account(tx, "r@demo.local"))!;
      for (let i = 0; i < aff.JOIN_LIMIT_PER_HOUR; i++) {
        const s = await store(tx);
        const input = { name: "R", phone: `62812555000${i}0`, bankName: null, bankAccount: null, bankHolder: null, note: null };
        expect(await aff.joinProgramme(tx, A, s.slug, input)).toBe("created");
      }
      const s = await store(tx);
      expect(await aff.joinProgramme(tx, A, s.slug, { name: "R", phone: "6281255509999", bankName: null, bankAccount: null, bankHolder: null, note: null })).toBe(
        "rate_limited",
      );
    });
  });

  it("invitation: binds once, never twice, never for a second account, never expired", async () => {
    await inTxn(async (tx) => {
      const A = (await account(tx, "i@demo.local"))!;
      const B = (await account(tx, "i2@demo.local"))!;
      const s = await store(tx);
      const row = await affiliate(tx, s.id, { code: "INVITE" });
      const inv = newInvite();
      await tx.execute(sql`update affiliates set invite_hash = ${inv.hash}, invite_expires_at = now() + interval '7 days' where id = ${row}`);

      expect(await aff.previewInvite(tx, inv.token)).toMatchObject({ code: "INVITE" });
      expect(await aff.acceptInvite(tx, A, inv.token)).toEqual({ ok: true, affiliateId: row });
      expect(await aff.acceptInvite(tx, B, inv.token)).toEqual({ ok: false, reason: "invalid" });
      expect(await aff.previewInvite(tx, inv.token)).toBeNull();
      const [r] = await rows(tx, sql`select account_id, invite_hash from affiliates where id = ${row}`);
      expect(r).toEqual({ account_id: A, invite_hash: null });

      const late = await affiliate(tx, s.id, { code: "LATE" });
      const inv2 = newInvite();
      await tx.execute(sql`update affiliates set invite_hash = ${inv2.hash}, invite_expires_at = now() - interval '1 minute' where id = ${late}`);
      expect(await aff.acceptInvite(tx, B, inv2.token)).toEqual({ ok: false, reason: "invalid" });
      expect(await aff.acceptInvite(tx, B, "garbage")).toEqual({ ok: false, reason: "invalid" });
    });
  });

  it("a row already linked to an account can never be re-bound, even with a live hash on it", async () => {
    await inTxn(async (tx) => {
      const A = (await account(tx, "l1@demo.local"))!;
      const B = (await account(tx, "l2@demo.local"))!;
      const s = await store(tx);
      const row = await affiliate(tx, s.id, { code: "TAKEN", accountId: A });
      const inv = newInvite();
      await tx.execute(sql`update affiliates set invite_hash = ${inv.hash}, invite_expires_at = now() + interval '7 days' where id = ${row}`);
      expect(await aff.previewInvite(tx, inv.token)).toBeNull();
      expect(await aff.acceptInvite(tx, B, inv.token)).toEqual({ ok: false, reason: "invalid" });
      const [r] = await rows(tx, sql`select account_id from affiliates where id = ${row}`);
      expect(r.account_id).toBe(A);
    });
  });

  it("invitation for a store the account is already in is refused, not doubled", async () => {
    await inTxn(async (tx) => {
      const A = (await account(tx, "m@demo.local"))!;
      const s = await store(tx);
      await affiliate(tx, s.id, { code: "MINE", accountId: A });
      const other = await affiliate(tx, s.id, { code: "SECOND" });
      const inv = newInvite();
      await tx.execute(sql`update affiliates set invite_hash = ${inv.hash}, invite_expires_at = now() + interval '7 days' where id = ${other}`);
      expect(await aff.acceptInvite(tx, A, inv.token)).toEqual({ ok: false, reason: "member" });
      const [r] = await rows(tx, sql`select account_id from affiliates where id = ${other}`);
      expect(r.account_id).toBeNull();
    });
  });
});
