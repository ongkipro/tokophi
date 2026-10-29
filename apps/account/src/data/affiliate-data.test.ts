import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Sql } from "postgres";
import type { Db } from "./account";
import * as acct from "./account";
import * as aff from "./affiliate";

// Affiliate workspace reads (spec §18.4 F) — real Postgres, every case rolled back. The account is
// cross-tenant on the owner connection, so `account_id = me` in myCommissions IS the boundary.
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
async function store(tx: Db, whatsapp: string | null = null) {
  const n = `${Date.now()}-${++seq}`;
  const [acc] = await rows(tx, sql`insert into accounts (name) values ('Aff Test') returning id`);
  const [s] = await rows(
    tx,
    sql`insert into stores (account_id, name, slug, whatsapp) values (${acc.id}, ${"Toko " + n}, ${"aff-test-" + n}, ${whatsapp}) returning id`,
  );
  await tx.execute(sql`insert into store_settings (store_id, affiliate_enabled, affiliate_hold_days) values (${s.id}, true, 5)`);
  return s.id as string;
}
async function affiliate(tx: Db, storeId: string, accountId: string, code: string, bank?: { name: string; account: string; holder: string }) {
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
  const number = `PHI-AFF${++seq}`;
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
const account = async (tx: Db, email: string) => (await acct.upsertAccountBySub(tx, { sub: `dev:${email}`, email, name: email }))!;

/** Two accounts, two stores: A is in both, B is in store 1 only. One commission per state for A. */
async function world(tx: Db) {
  const A = await account(tx, "aff-a@demo.local");
  const B = await account(tx, "aff-b@demo.local");
  const s1 = await store(tx, "6281299990000");
  const s2 = await store(tx);
  const a1 = await affiliate(tx, s1, A, "AFFA1", { name: "BCA", account: "1234567801", holder: "Rina Wulandari" });
  const a2 = await affiliate(tx, s2, A, "AFFA2");
  const b1 = await affiliate(tx, s1, B, "AFFB1");
  const mine = {
    siap: await commission(tx, s1, a1, 10_000, "siap"),
    ditahan: await commission(tx, s1, a1, 5_000, "ditahan"),
    belum_selesai: await commission(tx, s2, a2, 3_000, "belum_selesai"),
    dibayar: await commission(tx, s2, a2, 7_000, "dibayar"),
    batal: await commission(tx, s1, a1, 2_000, "batal"),
  };
  const theirs = await commission(tx, s1, b1, 99_000, "siap");
  return { A, B, a1, a2, b1, mine, theirs };
}

suite("myCommissions — one ledger across MY programmes, nobody else's (spec §18.4 F)", () => {
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
      // …and my own store filter narrows to that programme only.
      const one = await aff.myCommissions(tx, w.A, { store: w.a2 });
      expect(one.rows.map((r) => r.orderNumber).sort()).toEqual([w.mine.belum_selesai, w.mine.dibayar].sort());
    });
  });

  it("state filter: siap, ditahan, belum_selesai, dibayar and batal each select exactly their row", async () => {
    await inTxn(async (tx) => {
      const w = await world(tx);
      for (const state of aff.COMMISSION_STATES) {
        const r = await aff.myCommissions(tx, w.A, { state });
        expect(r.rows.map((x) => [x.orderNumber, x.state]), state).toEqual([[w.mine[state], state]]);
        expect(r.count, state).toBe(1);
      }
      // B's ready row never leaks into my "siap" filter, and filters combine.
      expect((await aff.myCommissions(tx, w.A, { state: "siap", store: w.a2 })).count).toBe(0);
      const held = (await aff.myCommissions(tx, w.A, { state: "ditahan" })).rows[0]!;
      expect(held.eligibleAt!.getTime()).toBeGreaterThan(Date.now());
      expect((await aff.myCommissions(tx, w.A, { state: "dibayar" })).rows[0]!.paidAt).toBeInstanceOf(Date);
    });
  });

  it("the ledger's states agree with the summary tiles (one derivation)", async () => {
    await inTxn(async (tx) => {
      const w = await world(tx);
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

suite("myAffiliateDetail — masked payout account, store contact, 404 for strangers", () => {
  it("never hands out the full account number; holder initials only; WhatsApp from the store", async () => {
    await inTxn(async (tx) => {
      const w = await world(tx);
      const d = (await aff.myAffiliateDetail(tx, w.A, w.a1))!;
      expect(d.payout).toEqual({ bankName: "BCA", account: "•••• 7801", holder: "R*** W***" });
      expect(JSON.stringify(d)).not.toContain("1234567801");
      expect(JSON.stringify(d)).not.toContain("Wulandari");
      expect(d.storeWhatsapp).toBe("6281299990000");
      expect(d.commissionCount).toBe(3);
      expect(d.commissions.map((c) => c.state).sort()).toEqual(["batal", "ditahan", "siap"]);
      // No bank on file ⇒ nulls, not empty masks; another account ⇒ exactly what an unknown id gets.
      expect((await aff.myAffiliateDetail(tx, w.A, w.a2))!.payout).toEqual({ bankName: null, account: null, holder: null });
      expect(await aff.myAffiliateDetail(tx, w.B, w.a1)).toBeNull();
      expect(await aff.myAffiliateDetail(tx, w.A, w.b1)).toBeNull();
    });
  });

  it("maskers keep only the last 4 digits and initials", () => {
    expect(aff.maskAccount("123-456 7890")).toBe("•••• 7890");
    expect(aff.maskAccount("1234")).toBe("••••");
    expect(aff.maskAccount("")).toBeNull();
    expect(aff.maskAccount(null)).toBeNull();
    expect(aff.maskHolder("  siti   nur'aini ")).toBe("S*** N***");
    expect(aff.maskHolder(null)).toBeNull();
  });
});

suite("joinProgramme — attempts are counted, so phone_taken is not an open oracle", () => {
  const input = (phone: string) => ({ name: "Penebak", phone, bankName: null, bankAccount: null, bankHolder: null, note: null });

  it("5 phone_taken answers use up the hour: the 6th attempt is refused before any lookup", async () => {
    await inTxn(async (tx) => {
      const A = await account(tx, "aff-guess@demo.local");
      const B = await account(tx, "aff-owner@demo.local");
      const s = await store(tx);
      const [{ slug }] = await rows(tx, sql`select slug from stores where id = ${s}`);
      // Five numbers that ARE affiliates of this store (form applications, no account).
      const taken: string[] = [];
      for (let i = 0; i < aff.JOIN_LIMIT_PER_HOUR; i++) {
        const phone = `62813777000${i}0`;
        await tx.execute(sql`insert into affiliates (store_id, code, name, phone, status) values (${s}, ${"FORM" + i}, 'Form', ${phone}, 'aktif')`);
        taken.push(phone);
      }
      for (const phone of taken) expect(await aff.joinProgramme(tx, A, slug as string, input(phone))).toBe("phone_taken");
      // 6th guess at a number that IS taken: no answer about the phone any more.
      await tx.execute(sql`insert into affiliates (store_id, code, name, phone, status) values (${s}, 'FORM9', 'Form', '6281377709990', 'aktif')`);
      expect(await aff.joinProgramme(tx, A, slug as string, input("6281377709990"))).toBe("rate_limited");
      // …and a perfectly valid application is refused too, so the answer carries no information.
      const s2 = await store(tx);
      const [{ slug: slug2 }] = await rows(tx, sql`select slug from stores where id = ${s2}`);
      expect(await aff.joinProgramme(tx, A, slug2 as string, input("6281377708880"))).toBe("rate_limited");
      expect((await rows(tx, sql`select count(*)::int as n from affiliates where account_id = ${A}`))[0].n).toBe(0);
      // The counter is per account: B is untouched.
      expect(await aff.joinProgramme(tx, B, slug2 as string, input("6281377708880"))).toBe("created");
    });
  });
});
