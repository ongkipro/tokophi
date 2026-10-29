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
}));
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
