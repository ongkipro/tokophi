import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Sql } from "postgres";
import { newInvite } from "@tokophi/lib/affiliate-invite";
import type { Db } from "./auth";
import * as auth from "./auth";
import * as aff from "./affiliate";

// Affiliate area (ADR 0022, AFFILIATE-P2) — real Postgres, every case rolled back. Affiliate accounts
// are cross-tenant on the owner connection, so `account_id = me` IS the boundary; a session is an opaque
// token whose sha256 alone is stored. Ported from the PR #424 account-app suite, re-keyed to the
// affiliate's OWN account (email + password) — no buyer_accounts row is created anywhere here.
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
const uniq = () => `${Date.now()}-${++seq}`;
async function account(tx: Db, label: string, phone = `0813${String(++seq).padStart(8, "0")}`): Promise<string> {
  const r = await auth.signUp(tx, { name: "Rina Wulandari", email: `${label}-${uniq()}@demo.local`, phone, password: "rahasia-123" });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.accountId;
}
async function store(tx: Db, opts: { whatsapp?: string | null; enabled?: boolean } = {}) {
  const n = uniq();
  const [acc] = await rows(tx, sql`insert into accounts (name) values ('Aff Test') returning id`);
  const [s] = await rows(
    tx,
    sql`insert into stores (account_id, name, slug, whatsapp) values (${acc.id}, ${"Toko " + n}, ${"aff-test-" + n}, ${opts.whatsapp ?? null}) returning id, slug`,
  );
  await tx.execute(sql`insert into store_settings (store_id, affiliate_enabled, affiliate_hold_days) values (${s.id}, ${opts.enabled ?? true}, 5)`);
  return { id: s.id as string, slug: s.slug as string };
}
async function affiliate(tx: Db, storeId: string, accountId: string | null, code: string, bank?: { name: string; account: string; holder: string }) {
  const [r] = await rows(
    tx,
    sql`insert into affiliates (store_id, code, name, phone, status, account_id, bank_name, bank_account, bank_holder)
        values (${storeId}, ${code}, ${code}, ${"6281300000" + String(++seq).padStart(3, "0")}, 'aktif', ${accountId},
                ${bank?.name ?? null}, ${bank?.account ?? null}, ${bank?.holder ?? null}) returning id`,
  );
  return r.id as string;
}
type Kind = "siap" | "ditahan" | "belum_selesai" | "dibayar" | "batal";
async function commission(tx: Db, storeId: string, affiliateId: string, amount: number, kind: Kind) {
  const number = `PHI-AFF${uniq()}`;
  const [o] = await rows(tx, sql`insert into orders (store_id, number, status, subtotal_idr) values (${storeId}, ${number}, 'selesai', ${amount * 10}) returning id`);
  const status = kind === "dibayar" || kind === "batal" ? kind : "pending";
  const eligible =
    kind === "ditahan" ? sql`now() + interval '2 days'` : kind === "belum_selesai" ? sql`null` : sql`now() - interval '1 day'`;
  await tx.execute(sql`
    insert into affiliate_commissions (store_id, affiliate_id, order_id, source, base_idr, commission_idr, status, eligible_at, paid_at)
    values (${storeId}, ${affiliateId}, ${o.id}, 'kode', ${amount * 10}, ${amount}, ${status}::affiliate_commission_status,
            ${eligible}, ${kind === "dibayar" ? sql`now()` : sql`null`})`);
  return number;
}

/** Two accounts, two stores: A is in both, B is in store 1 only. One commission per state for A. */
async function world(tx: Db) {
  const A = await account(tx, "aff-a");
  const B = await account(tx, "aff-b");
  const s1 = await store(tx, { whatsapp: "6281299990000" });
  const s2 = await store(tx);
  const a1 = await affiliate(tx, s1.id, A, "AFFA1", { name: "BCA", account: "1234567801", holder: "Rina Wulandari" });
  const a2 = await affiliate(tx, s2.id, A, "AFFA2");
  const b1 = await affiliate(tx, s1.id, B, "AFFB1");
  const mine = {
    siap: await commission(tx, s1.id, a1, 10_000, "siap"),
    ditahan: await commission(tx, s1.id, a1, 5_000, "ditahan"),
    belum_selesai: await commission(tx, s2.id, a2, 3_000, "belum_selesai"),
    dibayar: await commission(tx, s2.id, a2, 7_000, "dibayar"),
    batal: await commission(tx, s1.id, a1, 2_000, "batal"),
  };
  const theirs = await commission(tx, s1.id, b1, 99_000, "siap");
  return { A, B, a1, a2, b1, mine, theirs };
}

suite("affiliate accounts — sign-up, sign-in, sessions (ADR 0022)", () => {
  it("signs up with a lower-cased email, refuses a duplicate and bad input, and never stores the password", async () => {
    await inTxn(async (tx) => {
      const email = `Mixed.Case-${uniq()}@Demo.Local`;
      const r = await auth.signUp(tx, { name: "Sari Dewi", email, phone: "0812 3456 7890", password: "rahasia-123" });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const [row] = await rows(tx, sql`select email, phone, password_hash from affiliate_accounts where id = ${r.accountId}`);
      expect(row.email).toBe(email.toLowerCase());
      expect(row.phone).toBe("6281234567890");
      expect(String(row.password_hash)).not.toContain("rahasia-123");
      expect(String(row.password_hash)).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
      const dup = await auth.signUp(tx, { name: "Lain", email: email.toUpperCase(), phone: "081200000000", password: "rahasia-456" });
      expect(dup).toMatchObject({ ok: false, errors: { email: expect.stringMatching(/sudah terdaftar/) } });
      const bad = await auth.signUp(tx, { name: "", email: "bukan-email", phone: "123", password: "short" });
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(["email", "name", "password", "phone"]);
      // No buyer account was touched by any of this.
      const [{ n }] = await rows(tx, sql`select count(*)::int as n from buyer_accounts where email = ${email.toLowerCase()}`);
      expect(n).toBe(0);
    });
  });

  it("checks credentials case-insensitively; a wrong password, an unknown email and a disabled account all answer null", async () => {
    await inTxn(async (tx) => {
      const email = `login-${uniq()}@demo.local`;
      const r = await auth.signUp(tx, { name: "Budi", email, phone: "081211112222", password: "rahasia-123" });
      if (!r.ok) throw new Error("signup");
      expect(await auth.checkCredentials(tx, email.toUpperCase(), "rahasia-123")).toBe(r.accountId);
      expect(await auth.checkCredentials(tx, email, "rahasia-124")).toBeNull();
      expect(await auth.checkCredentials(tx, `nobody-${uniq()}@demo.local`, "rahasia-123")).toBeNull();
      await tx.execute(sql`update affiliate_accounts set disabled_at = now() where id = ${r.accountId}`);
      expect(await auth.checkCredentials(tx, email, "rahasia-123")).toBeNull();
    });
  });

  it("a session row stores only the token's sha256; revoked, expired, disabled and forged tokens are signed out", async () => {
    await inTxn(async (tx) => {
      const A = await account(tx, "sess");
      const token = await auth.createSession(tx, A, "Mozilla/5.0 test");
      const [row] = await rows(tx, sql`select token_hash, expires_at > now() + interval '29 days' as long from affiliate_sessions where account_id = ${A}`);
      expect(row.token_hash).toBe(auth.hashSessionToken(token));
      expect(row.token_hash).not.toContain(token);
      expect(row.long).toBe(true);
      const s = await auth.loadSession(tx, token);
      expect(s?.account.id).toBe(A);
      // forged / malformed
      expect(await auth.loadSession(tx, token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"))).toBeNull();
      expect(await auth.loadSession(tx, "x")).toBeNull();
      expect(await auth.loadSession(tx, undefined)).toBeNull();
      // expired
      await tx.execute(sql`update affiliate_sessions set expires_at = now() - interval '1 second' where account_id = ${A}`);
      expect(await auth.loadSession(tx, token)).toBeNull();
      await tx.execute(sql`update affiliate_sessions set expires_at = now() + interval '1 day' where account_id = ${A}`);
      expect(await auth.loadSession(tx, token)).not.toBeNull();
      // disabled account
      await tx.execute(sql`update affiliate_accounts set disabled_at = now() where id = ${A}`);
      expect(await auth.loadSession(tx, token)).toBeNull();
      await tx.execute(sql`update affiliate_accounts set disabled_at = null where id = ${A}`);
      // revoked (sign out) — and only by its own account
      const B = await account(tx, "sess-b");
      await auth.revokeSession(tx, B, s!.sessionId);
      expect(await auth.loadSession(tx, token)).not.toBeNull();
      await auth.revokeSession(tx, A, s!.sessionId);
      expect(await auth.loadSession(tx, token)).toBeNull();
    });
  });

  it("changing the password needs the current one, refuses the same one, and signs out every OTHER device", async () => {
    await inTxn(async (tx) => {
      const email = `pw-${uniq()}@demo.local`;
      const r = await auth.signUp(tx, { name: "Dewi", email, phone: "081233334444", password: "lama-12345" });
      if (!r.ok) throw new Error("signup");
      const here = await auth.createSession(tx, r.accountId, null);
      const other = await auth.createSession(tx, r.accountId, null);
      const hereId = (await auth.loadSession(tx, here))!.sessionId;
      expect(await auth.changePassword(tx, r.accountId, hereId, "salah-12345", "baru-12345")).toMatchObject({ ok: false, field: "current" });
      expect(await auth.changePassword(tx, r.accountId, hereId, "lama-12345", "lama-12345")).toMatchObject({ ok: false, field: "next" });
      expect(await auth.changePassword(tx, r.accountId, hereId, "lama-12345", "pendek")).toMatchObject({ ok: false, field: "next" });
      expect(await auth.changePassword(tx, r.accountId, hereId, "lama-12345", "baru-12345")).toEqual({ ok: true, signedOutOthers: 1 });
      expect(await auth.loadSession(tx, here)).not.toBeNull();
      expect(await auth.loadSession(tx, other)).toBeNull();
      expect(await auth.checkCredentials(tx, email, "lama-12345")).toBeNull();
      expect(await auth.checkCredentials(tx, email, "baru-12345")).toBe(r.accountId);
    });
  });
});

suite("myCommissions — one ledger across MY programmes, nobody else's", () => {
  it("returns every one of my rows across both stores and none of B's; B sees only B's", async () => {
    await inTxn(async (tx) => {
      const w = await world(tx);
      const all = await aff.myCommissions(tx, w.A);
      expect(all.rows.map((r) => r.orderNumber).sort()).toEqual(Object.values(w.mine).sort());
      expect(all.rows.some((r) => r.orderNumber === w.theirs)).toBe(false);
      expect(all.count).toBe(5);
      expect(all.commissionIdr).toBe(10_000 + 5_000 + 3_000 + 7_000 + 2_000);
      expect(all.baseIdr).toBe(all.commissionIdr * 10);
      expect(new Set(all.rows.map((r) => r.affiliateId))).toEqual(new Set([w.a1, w.a2]));
      const b = await aff.myCommissions(tx, w.B);
      expect(b.rows.map((r) => r.orderNumber)).toEqual([w.theirs]);
      expect(b.count).toBe(1);
    });
  });

  it("a store filter carrying ANOTHER account's affiliate id answers empty, like an unknown id", async () => {
    await inTxn(async (tx) => {
      const w = await world(tx);
      const foreign = await aff.myCommissions(tx, w.A, { store: w.b1 });
      expect(foreign).toEqual({ rows: [], count: 0, baseIdr: 0, commissionIdr: 0 });
      expect(await aff.myCommissions(tx, w.A, { store: "00000000-0000-4000-8000-000000000000" })).toEqual(foreign);
      expect(await aff.myCommissions(tx, w.A, { store: "not-a-uuid" })).toEqual(foreign);
      const one = await aff.myCommissions(tx, w.A, { store: w.a2 });
      expect(one.rows.map((r) => r.orderNumber).sort()).toEqual([w.mine.belum_selesai, w.mine.dibayar].sort());
    });
  });

  it("state filter: each state selects exactly its row, and the tiles agree with the ledger (one derivation)", async () => {
    await inTxn(async (tx) => {
      const w = await world(tx);
      for (const state of aff.COMMISSION_STATES) {
        const r = await aff.myCommissions(tx, w.A, { state });
        expect(r.rows.map((x) => [x.orderNumber, x.state]), state).toEqual([[w.mine[state], state]]);
      }
      const stores = await aff.myAffiliateStores(tx, w.A);
      const ledger = (await aff.myCommissions(tx, w.A)).rows;
      const sumOf = (s: string) => ledger.filter((r) => r.state === s).reduce((t, r) => t + r.commissionIdr, 0);
      expect(stores.reduce((t, s) => t + s.readyIdr, 0)).toBe(sumOf("siap"));
      expect(stores.reduce((t, s) => t + s.paidIdr, 0)).toBe(sumOf("dibayar"));
      expect(stores.reduce((t, s) => t + s.heldIdr, 0)).toBe(sumOf("ditahan") + sumOf("belum_selesai"));
      expect(stores.every((s) => s.holdDays === 5)).toBe(true);
    });
  });
});

suite("myAffiliateDetail — masked payout account, no buyer data, 404 for strangers", () => {
  it("never hands out the full account number or a buyer's details; another account answers like an unknown id", async () => {
    await inTxn(async (tx) => {
      const w = await world(tx);
      const d = (await aff.myAffiliateDetail(tx, w.A, w.a1))!;
      expect(d.payout).toEqual({ bankName: "BCA", account: "•••• 7801", holder: "R*** W***" });
      expect(JSON.stringify(d)).not.toContain("1234567801");
      expect(d.storeWhatsapp).toBe("6281299990000");
      expect(d.commissionCount).toBe(3);
      // A commission row carries the order NUMBER and money only.
      expect(Object.keys(d.commissions[0]!).sort()).toEqual(
        ["affiliateId", "baseIdr", "commissionIdr", "eligibleAt", "orderNumber", "paidAt", "placedAt", "rateNote", "state", "storeName"].sort(),
      );
      expect(await aff.myAffiliateDetail(tx, w.B, w.a1)).toBeNull();
      expect(await aff.myAffiliateDetail(tx, w.A, w.b1)).toBeNull();
      expect(await aff.myAffiliateDetail(tx, w.A, "not-a-uuid")).toBeNull();
    });
  });
});

suite("joinProgramme — apply by slug while signed in", () => {
  const input = { bankName: null, bankAccount: null, bankHolder: null, note: "TikTok @rina" };

  it("creates ONE menunggu row with the account's own name and phone; again = member; programme off = closed", async () => {
    await inTxn(async (tx) => {
      const A = await account(tx, "join", "081377700001");
      const s = await store(tx);
      expect(await aff.joinProgramme(tx, A, s.slug, input)).toBe("created");
      const [row] = await rows(tx, sql`select status::text as status, phone, name, account_id, note from affiliates where store_id = ${s.id}`);
      expect(row).toMatchObject({ status: "menunggu", phone: "6281377700001", name: "Rina Wulandari", account_id: A, note: "TikTok @rina" });
      expect(await aff.joinProgramme(tx, A, s.slug, input)).toBe("member");
      const off = await store(tx, { enabled: false });
      expect(await aff.joinProgramme(tx, A, off.slug, input)).toBe("closed");
      expect(await aff.joinProgramme(tx, A, "no-such-store-xyz", input)).toBe("closed");
      expect(await aff.joinProgramme(tx, A, "Bad Slug!", input)).toBe("closed");
    });
  });

  it("a same-phone row the seller added is NOT taken over, and the answer does not say why", async () => {
    await inTxn(async (tx) => {
      const A = await account(tx, "phone", "081377700002");
      const s = await store(tx);
      const [seller] = await rows(
        tx,
        sql`insert into affiliates (store_id, code, name, phone, status) values (${s.id}, 'BYSELLER', 'Seller Added', '6281377700002', 'aktif') returning id`,
      );
      expect(await aff.joinProgramme(tx, A, s.slug, input)).toBe("not_available");
      const [after] = await rows(tx, sql`select account_id, name from affiliates where id = ${seller.id}`);
      expect(after).toEqual({ account_id: null, name: "Seller Added" });
      expect((await rows(tx, sql`select count(*)::int as n from affiliates where store_id = ${s.id}`))[0].n).toBe(1);
    });
  });

  it("5 attempts per account per hour, counted in the DB before anything is looked at; per account", async () => {
    await inTxn(async (tx) => {
      const A = await account(tx, "limit");
      const B = await account(tx, "limit-b");
      const stores = [];
      for (let i = 0; i <= aff.JOIN_LIMIT_PER_HOUR; i++) stores.push(await store(tx));
      for (let i = 0; i < aff.JOIN_LIMIT_PER_HOUR; i++) expect(await aff.joinProgramme(tx, A, stores[i]!.slug, input)).toBe("created");
      expect(await aff.joinProgramme(tx, A, stores[aff.JOIN_LIMIT_PER_HOUR]!.slug, input)).toBe("rate_limited");
      expect(await aff.joinProgramme(tx, B, stores[aff.JOIN_LIMIT_PER_HOUR]!.slug, input)).toBe("created");
    });
  });
});

suite("invitations — the ONLY way an existing row is bound, never by email/phone", () => {
  async function invited(tx: Db, storeId: string, opts: { expired?: boolean; status?: string } = {}) {
    const inv = newInvite();
    const [r] = await rows(
      tx,
      sql`insert into affiliates (store_id, code, name, phone, status, invite_hash, invite_expires_at)
          values (${storeId}, ${"INV" + ++seq}, 'Diundang', ${"6281388800" + String(seq).padStart(3, "0")}, ${opts.status ?? "aktif"}::affiliate_status,
                  ${inv.hash}, ${opts.expired ? sql`now() - interval '1 minute'` : sql`now() + interval '7 days'`}) returning id`,
    );
    return { id: r.id as string, token: inv.token };
  }

  it("previews, binds once (hash cleared in the same statement), and a second account cannot reuse it", async () => {
    await inTxn(async (tx) => {
      const A = await account(tx, "inv-a");
      const B = await account(tx, "inv-b");
      const s = await store(tx);
      const inv = await invited(tx, s.id);
      expect(await aff.previewInvite(tx, inv.token)).toMatchObject({ affiliateName: "Diundang" });
      expect(await aff.acceptInvite(tx, A, inv.token)).toEqual({ ok: true, affiliateId: inv.id });
      const [row] = await rows(tx, sql`select account_id, invite_hash from affiliates where id = ${inv.id}`);
      expect(row).toEqual({ account_id: A, invite_hash: null });
      expect(await aff.previewInvite(tx, inv.token)).toBeNull();
      expect(await aff.acceptInvite(tx, B, inv.token)).toEqual({ ok: false, reason: "invalid" });
    });
  });

  it("refuses an expired link, a non-active row, junk, and an account already in that store", async () => {
    await inTxn(async (tx) => {
      const A = await account(tx, "inv-c");
      const s = await store(tx);
      expect(await aff.acceptInvite(tx, A, (await invited(tx, s.id, { expired: true })).token)).toEqual({ ok: false, reason: "invalid" });
      expect(await aff.acceptInvite(tx, A, (await invited(tx, s.id, { status: "nonaktif" })).token)).toEqual({ ok: false, reason: "invalid" });
      expect(await aff.acceptInvite(tx, A, "junk")).toEqual({ ok: false, reason: "invalid" });
      await affiliate(tx, s.id, A, "ALREADY");
      expect(await aff.acceptInvite(tx, A, (await invited(tx, s.id)).token)).toEqual({ ok: false, reason: "member" });
    });
  });
});
