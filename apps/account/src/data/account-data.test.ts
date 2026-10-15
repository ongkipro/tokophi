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
