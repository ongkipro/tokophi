import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import type { Db } from "../ledger-credit";

/**
 * THE SELLER'S AFFILIATE ACTIONS, against real Postgres, every case rolled back (Task 9.4).
 *
 * These are the writes that move a merchant's money obligations — "mark paid", approve, set a rate — and
 * until now nothing exercised them (the attribution suite covers the two writes that ride the ORDER
 * transaction; the capability census only classifies the names). Every case reads the ROW back: the
 * claim is what the database holds, not what the action says.
 *
 * `requireCapability` and `withTenant` are replaced: the capability gate has its own census, and the
 * claim here is the explicit `store_id` predicate — the WHERE is the rule, RLS is only the net — so the
 * transaction runs as the owner and a foreign id must be refused by the action's own predicate.
 */

const h = vi.hoisted(() => ({ db: null as unknown as Db, storeId: "" }));

vi.mock("@/lib/rbac", () => ({ requireCapability: async () => ({ storeId: h.storeId }) }));
// The real withTenant opens its OWN transaction, so a failed statement (a duplicate code) undoes only
// that call. A nested transaction (a savepoint) reproduces that inside this test's outer, rolled-back one.
vi.mock("@/lib/tenant", () => ({
  withTenant: async (_sid: string, fn: (db: Db) => unknown) =>
    (h.db as unknown as { transaction: (f: (t: unknown) => unknown) => unknown }).transaction((t) => fn(t as Db)),
  withCurrentTenant: async (fn: (db: Db, storeId: string) => unknown) => fn(h.db, h.storeId),
}));
vi.mock("@/lib/auth", () => ({ getSession: async () => ({ storeId: h.storeId, role: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

let client: Sql;
let root: Db;
let act: typeof import("./affiliates");

beforeAll(async () => {
  if (!URL) return;
  client = postgres(URL, { max: 1 });
  root = drizzle(client, { casing: "snake_case" }) as unknown as Db;
  process.env.DATABASE_URL = URL;
  act = await import("./affiliates");
});
afterAll(async () => {
  await client?.end();
});

const ROLLBACK = Symbol("rollback");
async function inTxn(fn: (tx: Db) => Promise<void>) {
  try {
    await root.transaction(async (tx) => {
      h.db = tx as unknown as Db;
      await fn(tx as unknown as Db);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
}
const rows = async (tx: Db, q: SQL) => (await tx.execute(q)) as unknown as Record<string, unknown>[];

let seq = 0;
/** One store with one affiliate and a helper that hangs a commission on a fresh order. */
async function store(tx: Db) {
  const n = ++seq;
  const [account] = await rows(tx, sql`insert into accounts (name) values ('Aff Act') returning id`);
  const [s] = await rows(tx, sql`insert into stores (account_id, name, slug) values (${account.id}, 'Aff', ${"aff-act-" + n}) returning id`);
  const storeId = s.id as string;
  await tx.execute(sql`insert into store_settings (store_id, affiliate_enabled, affiliate_rate_bps, affiliate_hold_days) values (${storeId}, true, 1000, 3)`);
  const [a] = await rows(
    tx,
    sql`insert into affiliates (store_id, code, name, phone, status) values (${storeId}, ${"CODE" + n}, 'Aff', ${"62811" + String(n).padStart(8, "0")}, 'aktif') returning id`,
  );
  const [p] = await rows(tx, sql`insert into products (store_id, title, handle, number) values (${storeId}, 'P', ${"p" + n}, 1) returning id`);
  const commission = async (o: { status?: "pending" | "dibayar" | "batal"; eligible?: "past" | "future" | null } = {}) => {
    const [ord] = await rows(
      tx,
      sql`insert into orders (store_id, number, status, subtotal_idr) values (${storeId}, ${"AFFACT-" + n + "-" + ++seq}, 'selesai', 100000) returning id`,
    );
    const eligible =
      o.eligible === null ? sql`null` : o.eligible === "future" ? sql`now() + interval '2 days'` : sql`now() - interval '1 day'`;
    const [c] = await rows(
      tx,
      sql`insert into affiliate_commissions (store_id, affiliate_id, order_id, source, base_idr, commission_idr, status, eligible_at)
          values (${storeId}, ${a.id}, ${ord.id}, 'kode', 100000, 10000, ${o.status ?? "pending"}::affiliate_commission_status, ${eligible})
          returning id`,
    );
    return c.id as string;
  };
  return { storeId, affiliateId: a.id as string, productId: p.id as string, commission };
}
const commissionRow = async (tx: Db, id: string) =>
  (await rows(tx, sql`select status::text as status, paid_at, paid_note from affiliate_commissions where id = ${id}`))[0];
const affiliateRow = async (tx: Db, id: string) =>
  (await rows(tx, sql`select status::text as status, approved_at from affiliates where id = ${id}`))[0];

suite("markCommissionPaid (F-A8) — one statement decides", () => {
  it("pays a READY commission once, and a second click cannot pay it again", async () => {
    await inTxn(async (tx) => {
      const a = await store(tx);
      h.storeId = a.storeId;
      const id = await a.commission({ eligible: "past" });
      expect(await act.markCommissionPaid(id, "  transfer BCA  ")).toEqual({ ok: true });
      const first = await commissionRow(tx, id);
      expect(first.status).toBe("dibayar");
      expect(first.paid_note).toBe("transfer BCA");
      expect(first.paid_at).not.toBeNull();
      const again = await act.markCommissionPaid(id, "dua kali");
      expect(again.ok).toBe(false);
      const after = await commissionRow(tx, id);
      expect(after.paid_note).toBe("transfer BCA"); // the second call wrote nothing
      expect(String(after.paid_at)).toBe(String(first.paid_at));
    });
  });

  it("refuses a commission still inside the hold window, one with no hold window yet, and a cancelled one", async () => {
    await inTxn(async (tx) => {
      const a = await store(tx);
      h.storeId = a.storeId;
      for (const o of [{ eligible: "future" as const }, { eligible: null }, { status: "batal" as const, eligible: "past" as const }]) {
        const id = await a.commission(o);
        const before = await commissionRow(tx, id);
        expect((await act.markCommissionPaid(id)).ok).toBe(false);
        expect(await commissionRow(tx, id)).toEqual(before);
      }
    });
  });

  it("another store's commission id is refused and left untouched (tenant boundary)", async () => {
    await inTxn(async (tx) => {
      const mine = await store(tx);
      const theirs = await store(tx);
      h.storeId = mine.storeId;
      const foreign = await theirs.commission({ eligible: "past" });
      expect((await act.markCommissionPaid(foreign)).ok).toBe(false);
      expect((await commissionRow(tx, foreign)).status).toBe("pending");
    });
  });

  it("a non-UUID id and an over-long note are answered, not thrown", async () => {
    await inTxn(async (tx) => {
      const a = await store(tx);
      h.storeId = a.storeId;
      expect((await act.markCommissionPaid("not-a-uuid")).ok).toBe(false);
      const id = await a.commission({ eligible: "past" });
      expect((await act.markCommissionPaid(id, "x".repeat(201))).ok).toBe(false);
      expect((await commissionRow(tx, id)).status).toBe("pending");
    });
  });
});

suite("setAffiliateStatus (F-A3)", () => {
  it("approving stamps approved_at once; approving again keeps the first stamp", async () => {
    await inTxn(async (tx) => {
      const a = await store(tx);
      h.storeId = a.storeId;
      await tx.execute(sql`update affiliates set status = 'menunggu', approved_at = null where id = ${a.affiliateId}`);
      expect(await act.setAffiliateStatus(a.affiliateId, "aktif")).toEqual({ ok: true });
      const first = await affiliateRow(tx, a.affiliateId);
      expect(first.status).toBe("aktif");
      expect(first.approved_at).not.toBeNull();
      await act.setAffiliateStatus(a.affiliateId, "nonaktif");
      await act.setAffiliateStatus(a.affiliateId, "aktif");
      expect(String((await affiliateRow(tx, a.affiliateId)).approved_at)).toBe(String(first.approved_at));
    });
  });

  it("another store's affiliate is not found and keeps its status; junk input is answered, not thrown", async () => {
    await inTxn(async (tx) => {
      const mine = await store(tx);
      const theirs = await store(tx);
      h.storeId = mine.storeId;
      expect((await act.setAffiliateStatus(theirs.affiliateId, "nonaktif")).ok).toBe(false);
      expect((await affiliateRow(tx, theirs.affiliateId)).status).toBe("aktif");
      expect((await act.setAffiliateStatus("not-a-uuid", "aktif")).ok).toBe(false);
      expect((await act.setAffiliateStatus(mine.affiliateId, "menunggu" as never)).ok).toBe(false);
      expect((await affiliateRow(tx, mine.affiliateId)).status).toBe("aktif");
    });
  });
});

suite("createAffiliate", () => {
  it("a merchant-chosen code that is taken is refused with a message, not a crash", async () => {
    await inTxn(async (tx) => {
      const a = await store(tx);
      h.storeId = a.storeId;
      const r = await act.createAffiliate({ name: "Budi", phone: "081234567890", code: "budi10" });
      expect(r).toEqual({ ok: true, code: "BUDI10" });
      const clash = await act.createAffiliate({ name: "Budi 2", phone: "081234567891", code: "BUDI10" });
      expect(clash.ok).toBe(false);
      expect((await rows(tx, sql`select count(*)::int as n from affiliates where store_id = ${a.storeId} and code = 'BUDI10'`))[0].n).toBe(1);
    });
  });

  it("refuses a bad phone, a bad code, and a field longer than the storefront form allows", async () => {
    await inTxn(async (tx) => {
      const a = await store(tx);
      h.storeId = a.storeId;
      const before = (await rows(tx, sql`select count(*)::int as n from affiliates where store_id = ${a.storeId}`))[0].n;
      expect((await act.createAffiliate({ name: "X", phone: "abc" })).ok).toBe(false);
      expect((await act.createAffiliate({ name: "X", phone: "081234567890", code: "a b!" })).ok).toBe(false);
      expect((await act.createAffiliate({ name: "X", phone: "081234567890", bankAccount: "1".repeat(41) })).ok).toBe(false);
      expect((await act.createAffiliate({ name: "N".repeat(81), phone: "081234567890" })).ok).toBe(false);
      expect((await rows(tx, sql`select count(*)::int as n from affiliates where store_id = ${a.storeId}`))[0].n).toBe(before);
    });
  });

  it("a WhatsApp number already in this store's programme is refused with a message (0125 unique)", async () => {
    await inTxn(async (tx) => {
      const a = await store(tx);
      h.storeId = a.storeId;
      expect((await act.createAffiliate({ name: "Dewi", phone: "081234567899" })).ok).toBe(true);
      const dup = await act.createAffiliate({ name: "Dewi Lain", phone: "0812-3456-7899" });
      expect(dup).toEqual({ ok: false, error: "Nomor WhatsApp ini sudah terdaftar sebagai affiliate di toko ini." });
      expect((await rows(tx, sql`select count(*)::int as n from affiliates where store_id = ${a.storeId} and phone = '6281234567899'`))[0].n).toBe(1);
    });
  });

  it("a seller-added affiliate is active at once and trimmed", async () => {
    await inTxn(async (tx) => {
      const a = await store(tx);
      h.storeId = a.storeId;
      const r = await act.createAffiliate({ name: "  Sari  ", phone: "081234567893", email: " s@example.test ", bankName: " BCA " });
      expect(r.ok).toBe(true);
      const [row] = await rows(tx, sql`select name, email, bank_name, status::text as status, approved_at from affiliates where store_id = ${a.storeId} and phone = '6281234567893'`);
      expect(row).toMatchObject({ name: "Sari", email: "s@example.test", bank_name: "BCA", status: "aktif" });
      expect(row.approved_at).not.toBeNull();
    });
  });
});

suite("the seller's own switch (ADR 0022) — Pengaturan → Affiliate", () => {
  it("turns THIS store's programme on and off, upserting a missing settings row, never another store's", async () => {
    await inTxn(async (tx) => {
      const mine = await store(tx);
      const theirs = await store(tx);
      h.storeId = mine.storeId;
      const on = async (id: string) => (await rows(tx, sql`select affiliate_enabled as e from store_settings where store_id = ${id}`))[0]?.e;
      expect(await act.setAffiliateProgramEnabled(false)).toEqual({ ok: true });
      expect(await on(mine.storeId)).toBe(false);
      expect(await act.getAffiliateProgramEnabled()).toBe(false);
      expect(await on(theirs.storeId)).toBe(true);
      expect(await act.setAffiliateProgramEnabled(true)).toEqual({ ok: true });
      expect(await act.getAffiliateProgramEnabled()).toBe(true);
      // A store with no store_settings row yet gets one, off by default until switched.
      const [acc] = await rows(tx, sql`insert into accounts (name) values ('Fresh') returning id`);
      const [fresh] = await rows(tx, sql`insert into stores (account_id, name, slug) values (${acc.id}, 'Fresh', ${"aff-fresh-" + ++seq}) returning id`);
      h.storeId = fresh.id as string;
      expect(await act.getAffiliateProgramEnabled()).toBe(false);
      expect(await act.setAffiliateProgramEnabled(true)).toEqual({ ok: true });
      expect(await on(fresh.id as string)).toBe(true);
    });
  });
});

suite("setProductAffiliateRate (F-A9) and saveAffiliateSettings (F-A1)", () => {
  it("sets, clears and refuses; another store's product is untouched", async () => {
    await inTxn(async (tx) => {
      const mine = await store(tx);
      const theirs = await store(tx);
      h.storeId = mine.storeId;
      const rate = async (id: string) => (await rows(tx, sql`select affiliate_rate_bps as r from products where id = ${id}`))[0].r;
      expect(await act.setProductAffiliateRate(mine.productId, "12,5")).toEqual({ ok: true });
      expect(Number(await rate(mine.productId))).toBe(1250);
      expect((await act.setProductAffiliateRate(mine.productId, "10%%")).ok).toBe(false);
      expect(Number(await rate(mine.productId))).toBe(1250); // a refused value is not a silent 0
      expect(await act.setProductAffiliateRate(mine.productId, null)).toEqual({ ok: true });
      expect(await rate(mine.productId)).toBeNull();
      expect((await act.setProductAffiliateRate(theirs.productId, 50)).ok).toBe(false);
      expect(await rate(theirs.productId)).toBeNull();
      expect((await act.setProductAffiliateRate("not-a-uuid", 5)).ok).toBe(false);
    });
  });

  it("a mistyped rate is refused and the stored programme settings do not move", async () => {
    await inTxn(async (tx) => {
      const a = await store(tx);
      h.storeId = a.storeId;
      const read = async () => (await rows(tx, sql`select affiliate_enabled as e, affiliate_rate_bps as r, affiliate_hold_days as d from store_settings where store_id = ${a.storeId}`))[0];
      const before = await read();
      expect((await act.saveAffiliateSettings({ enabled: false, ratePct: "10%x", holdDays: 3 })).ok).toBe(false);
      expect((await act.saveAffiliateSettings({ enabled: false, ratePct: 10, holdDays: "abc" })).ok).toBe(false);
      expect(await read()).toEqual(before);
      expect(await act.saveAffiliateSettings({ enabled: false, ratePct: "7,5", holdDays: 5 })).toEqual({ ok: true });
      expect(await read()).toMatchObject({ e: false, r: 750, d: 5 });
    });
  });
});

suite("inviteAffiliateToAccount", () => {
  it("a non-UUID id is answered, not thrown", async () => {
    await inTxn(async (tx) => {
      const a = await store(tx);
      h.storeId = a.storeId;
      expect((await act.inviteAffiliateToAccount("not-a-uuid")).ok).toBe(false);
    });
  });
});

/** Today ± n days as WIB `YYYY-MM-DD` — the fixture orders are placed `now()`, the export filters on WIB days. */
const wibDay = (offsetDays: number) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() + offsetDays * 86_400_000));
/** Data rows of an exported CSV (BOM + header stripped). */
const dataRows = (csv: string) => csv.replace(/^﻿/, "").trimEnd().split("\r\n").slice(1);

suite("exportAffiliateCommissionsCsv (F-A11) — this store's rows only", () => {
  it("store A with 3 commissions and store B with 1: A's file has exactly A's 3 rows, with the derived state", async () => {
    await inTxn(async (tx) => {
      const a = await store(tx);
      const b = await store(tx);
      await a.commission({ eligible: "past" }); // siap
      await a.commission({ eligible: "future" }); // masa retur
      const paid = await a.commission({ status: "dibayar", eligible: "past" });
      await tx.execute(sql`update affiliate_commissions set paid_at = now(), paid_note = 'transfer BCA' where id = ${paid}`);
      await b.commission({ eligible: "past" });
      h.storeId = a.storeId;
      const r = await act.exportAffiliateCommissionsCsv({ from: wibDay(-1), to: wibDay(1) });
      if (!r.ok) throw new Error(r.error);
      expect(r.csv.startsWith("﻿Nomor pesanan,")).toBe(true);
      const lines = dataRows(r.csv);
      expect(r.rows).toBe(3);
      expect(lines).toHaveLength(3);
      const mine = (await rows(tx, sql`select number from orders where store_id = ${a.storeId}`)).map((o) => String(o.number));
      const [theirs] = await rows(tx, sql`select number from orders where store_id = ${b.storeId}`);
      for (const l of lines) expect(mine).toContain(l.split(",")[0]);
      expect(r.csv).not.toContain(String(theirs.number));
      expect(lines.some((l) => l.includes(",Siap dibayar,"))).toBe(true);
      expect(lines.some((l) => l.includes(",Masa retur,"))).toBe(true);
      expect(lines.find((l) => l.includes(",Dibayar,"))).toMatch(/,transfer BCA$/);
    });
  });

  it("a range that misses the orders yields the header only; a reversed or junk range is refused", async () => {
    await inTxn(async (tx) => {
      const a = await store(tx);
      await a.commission({ eligible: "past" });
      h.storeId = a.storeId;
      const old = await act.exportAffiliateCommissionsCsv({ from: "2020-01-01", to: "2020-01-31" });
      expect(old.ok && dataRows(old.csv)).toEqual([]);
      expect((await act.exportAffiliateCommissionsCsv({ from: wibDay(1), to: wibDay(-1) })).ok).toBe(false);
      expect((await act.exportAffiliateCommissionsCsv({ from: "2026-02-30", to: "2026-03-01" })).ok).toBe(false);
      expect((await act.exportAffiliateCommissionsCsv({ from: "'; drop table x; --", to: wibDay(0) })).ok).toBe(false);
    });
  });

  it("a formula typed as an affiliate name reaches the file inert", async () => {
    await inTxn(async (tx) => {
      const a = await store(tx);
      await a.commission({ eligible: "past" });
      await tx.execute(sql`update affiliates set name = '=HYPERLINK("http://x","klik")' where id = ${a.affiliateId}`);
      h.storeId = a.storeId;
      const r = await act.exportAffiliateCommissionsCsv({ from: wibDay(-1), to: wibDay(1) });
      if (!r.ok) throw new Error(r.error);
      expect(dataRows(r.csv)[0]).toContain(`,"'=HYPERLINK(""http://x"",""klik"")",`);
    });
  });
});

suite("updateAffiliate — the seller corrects an affiliate's details", () => {
  const read = async (tx: Db, id: string) =>
    (
      await rows(
        tx,
        sql`select name, phone, email, bank_name, bank_account, bank_holder, note, code, status::text as status, account_id from affiliates where id = ${id}`,
      )
    )[0];

  it("writes the details (phone canonical 62…, blanks → null) and leaves code, status and account link alone", async () => {
    await inTxn(async (tx) => {
      const a = await store(tx);
      h.storeId = a.storeId;
      const before = await read(tx, a.affiliateId);
      const r = await act.updateAffiliate(a.affiliateId, {
        name: "  Sari   Dewi ",
        phone: "0812-9999-0000",
        email: " Sari@Contoh.ID ",
        bankName: "BCA",
        bankAccount: "1234567890",
        bankHolder: "Sari Dewi",
        note: "   ",
      });
      expect(r).toEqual({ ok: true });
      const after = await read(tx, a.affiliateId);
      expect(after).toMatchObject({
        name: "Sari Dewi",
        phone: "6281299990000",
        email: "sari@contoh.id",
        bank_name: "BCA",
        bank_account: "1234567890",
        bank_holder: "Sari Dewi",
        note: null,
      });
      expect([after.code, after.status, after.account_id]).toEqual([before.code, before.status, before.account_id]);
    });
  });

  it("another store's affiliate is not found and unchanged; a phone already used in this store gets a plain message", async () => {
    await inTxn(async (tx) => {
      const mine = await store(tx);
      const theirs = await store(tx);
      h.storeId = mine.storeId;
      const foreign = await read(tx, theirs.affiliateId);
      expect(await act.updateAffiliate(theirs.affiliateId, { name: "Penyusup", phone: "081200000001" })).toEqual({ ok: false, error: "Affiliate tidak ditemukan." });
      expect(await read(tx, theirs.affiliateId)).toEqual(foreign);

      expect((await act.createAffiliate({ name: "Budi", phone: "081277776666" })).ok).toBe(true);
      const dup = await act.updateAffiliate(mine.affiliateId, { name: "Aff", phone: "0812 7777 6666" });
      expect(dup).toEqual({ ok: false, error: "Nomor WhatsApp ini sudah dipakai affiliate lain di toko ini." });
    });
  });

  it("refuses a bad phone, a bad email, a name with digits, an over-long bank account and a non-UUID id", async () => {
    await inTxn(async (tx) => {
      const a = await store(tx);
      h.storeId = a.storeId;
      const before = await read(tx, a.affiliateId);
      for (const input of [
        { name: "Sari", phone: "021 555 1234" },
        { name: "Sari", phone: "081234567890", email: "bukan-email" },
        { name: "Sari 2", phone: "081234567890" },
        { name: "Sari", phone: "081234567890", bankAccount: "9".repeat(41) },
      ]) {
        expect((await act.updateAffiliate(a.affiliateId, input)).ok).toBe(false);
      }
      expect((await act.updateAffiliate("not-a-uuid", { name: "Sari", phone: "081234567890" })).ok).toBe(false);
      expect(await read(tx, a.affiliateId)).toEqual(before);
    });
  });
});
