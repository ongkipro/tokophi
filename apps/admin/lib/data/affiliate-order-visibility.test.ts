import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import type { Db } from "../ledger-credit";

/**
 * WHAT THE SELLER SEES OF AN AFFILIATE: the sidebar badge, the chip on a Pesanan row, the card on an
 * order's detail. Real Postgres, every case rolled back, and the reads run THROUGH RLS
 * (`SET LOCAL ROLE tokophi_app` + the `app.store_id` GUC) — a screen that quietly showed another
 * store's affiliate would be a cross-tenant leak that `tsc` cannot see.
 *
 *   TEST_DATABASE_URL=postgresql://tokophi:tokophi@localhost:5433/tokophi_test \
 *     npx vitest run apps/admin/lib/data/affiliate-order-visibility.test.ts
 */

const h = vi.hoisted(() => ({ db: null as unknown as Db, storeId: "" }));

// withCurrentTenant, minus the session: hand the callback the current store's id and a transaction.
vi.mock("@/lib/tenant", () => ({
  withCurrentTenant: async (fn: (db: Db, storeId: string) => unknown) => fn(h.db, h.storeId),
}));
vi.mock("@/lib/auth", () => ({ getSession: async () => ({ role: "owner" }) }));

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

let client: Sql;
let root: Db;
let affiliates: typeof import("./affiliates");
let detail: typeof import("./order-detail");
let list: typeof import("./orders");

beforeAll(async () => {
  if (!URL) return;
  client = postgres(URL, { max: 1 });
  root = drizzle(client, { casing: "snake_case" }) as unknown as Db;
  process.env.DATABASE_URL = URL;
  affiliates = await import("./affiliates");
  detail = await import("./order-detail");
  list = await import("./orders");
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
/** From here on every statement runs as the restricted role, scoped to one store — i.e. through RLS. */
const asTenant = async (tx: Db, storeId: string) => {
  h.storeId = storeId;
  await tx.execute(sql`select set_config('app.store_id', ${storeId}, true)`);
  await tx.execute(sql`set local role tokophi_app`);
};
const asOwner = (tx: Db) => tx.execute(sql`reset role`);

let seq = 0;
async function store(tx: Db) {
  const n = ++seq;
  const [account] = await rows(tx, sql`insert into accounts (name) values ('Aff Vis') returning id`);
  const [s] = await rows(tx, sql`insert into stores (account_id, name, slug) values (${account.id}, 'Aff', ${"aff-vis-" + n}) returning id`);
  const storeId = s.id as string;
  await tx.execute(sql`insert into store_settings (store_id, affiliate_enabled, affiliate_rate_bps, affiliate_hold_days) values (${storeId}, true, 1000, 3)`);
  const aff = async (code: string, status: string) =>
    (
      await rows(
        tx,
        sql`insert into affiliates (store_id, code, name, phone, status) values (${storeId}, ${code}, ${"Nama " + code}, ${"62812" + String(++seq).padStart(8, "0")}, ${status}::affiliate_status) returning id`,
      )
    )[0].id as string;
  /** An order, optionally carrying a commission in the given state. */
  const order = async (c?: { affiliateId: string; status?: "pending" | "dibayar" | "batal"; eligible?: "past" | "future" | null; source?: "kode" | "link" }) => {
    const number = `AFFVIS-${n}-${++seq}`;
    const [o] = await rows(
      tx,
      sql`insert into orders (store_id, number, status, subtotal_idr, total_idr) values (${storeId}, ${number}, 'selesai', 100000, 100000) returning id`,
    );
    if (c) {
      const eligible = c.eligible === null ? sql`null` : c.eligible === "future" ? sql`now() + interval '2 days'` : sql`now() - interval '1 day'`;
      await tx.execute(
        sql`insert into affiliate_commissions (store_id, affiliate_id, order_id, source, base_idr, commission_idr, rate_note, status, eligible_at)
            values (${storeId}, ${c.affiliateId}, ${o.id}, ${c.source ?? "kode"}, 100000, 10000, '10%', ${c.status ?? "pending"}::affiliate_commission_status, ${eligible})`,
      );
    }
    return number;
  };
  return { storeId, aff, order };
}

suite("getPendingAffiliateCount — the sidebar badge", () => {
  it("counts only this store's applicants still waiting for a yes/no", async () => {
    await inTxn(async (tx) => {
      const a = await store(tx);
      const b = await store(tx);
      await a.aff("A1", "menunggu");
      await a.aff("A2", "menunggu");
      await a.aff("A3", "aktif");
      await a.aff("A4", "ditolak");
      await a.aff("A5", "nonaktif");
      await b.aff("B1", "menunggu");
      await b.aff("B2", "menunggu");
      await b.aff("B3", "menunggu");
      await asTenant(tx, a.storeId);
      expect(await affiliates.getPendingAffiliateCount()).toBe(2);
      await asOwner(tx);
      await asTenant(tx, b.storeId);
      expect(await affiliates.getPendingAffiliateCount()).toBe(3);
    });
  });

  it("is 0, not null or an error, for a store with no applicants", async () => {
    await inTxn(async (tx) => {
      const a = await store(tx);
      await asTenant(tx, a.storeId);
      expect(await affiliates.getPendingAffiliateCount()).toBe(0);
    });
  });
});

suite("getOrderDetail — the Affiliate card", () => {
  it("carries the commission frozen on the order, in every state the screens label", async () => {
    await inTxn(async (tx) => {
      const a = await store(tx);
      const f = await a.aff("RINA10", "aktif");
      const ready = await a.order({ affiliateId: f, eligible: "past" });
      const held = await a.order({ affiliateId: f, eligible: "future", source: "link" });
      const running = await a.order({ affiliateId: f, eligible: null });
      const paid = await a.order({ affiliateId: f, status: "dibayar", eligible: "past" });
      const voided = await a.order({ affiliateId: f, status: "batal", eligible: null });
      await asTenant(tx, a.storeId);
      const state = async (n: string) => (await detail.getOrderDetail(n))?.affiliate?.state;
      expect(await state(ready)).toBe("siap");
      expect(await state(held)).toBe("ditahan");
      expect(await state(running)).toBe("belum_selesai");
      expect(await state(paid)).toBe("dibayar");
      expect(await state(voided)).toBe("batal");
      expect((await detail.getOrderDetail(held))?.affiliate).toMatchObject({
        code: "RINA10",
        name: "Nama RINA10",
        source: "link",
        baseIdr: 100_000,
        commissionIdr: 10_000,
        rateNote: "10%",
      });
    });
  });

  it("is null for an order nobody referred", async () => {
    await inTxn(async (tx) => {
      const a = await store(tx);
      const plain = await a.order();
      await asTenant(tx, a.storeId);
      const d = await detail.getOrderDetail(plain);
      expect(d).not.toBeNull();
      expect(d?.affiliate).toBeNull();
    });
  });
});

suite("getOrderList — the chip on a Pesanan row", () => {
  it("marks attributed rows, leaves the rest null, and never fans a row out", async () => {
    await inTxn(async (tx) => {
      const a = await store(tx);
      const f = await a.aff("DIMAS", "aktif");
      const withAff = await a.order({ affiliateId: f, eligible: "past" });
      const held = await a.order({ affiliateId: f, eligible: "future" });
      const running = await a.order({ affiliateId: f, eligible: null });
      const paid = await a.order({ affiliateId: f, status: "dibayar", eligible: "past" });
      const voided = await a.order({ affiliateId: f, status: "batal", eligible: "past" });
      const plainOne = await a.order();
      const plainTwo = await a.order();
      await asTenant(tx, a.storeId);
      const res = await list.getOrderList({ pageSize: 50 });
      const byNo = new Map(res.rows.map((r) => [r.number, r]));
      expect(res.rows).toHaveLength(7); // a join on commissions must not duplicate an order
      expect(byNo.get(withAff)?.affiliate).toEqual({ code: "DIMAS", name: "Nama DIMAS", commissionIdr: 10_000, state: "siap" });
      // The "ready" test lives in SQL here and in drizzle on the Affiliate screen — they must agree.
      expect(byNo.get(held)?.affiliate?.state).toBe("ditahan");
      expect(byNo.get(running)?.affiliate?.state).toBe("belum_selesai");
      expect(byNo.get(paid)?.affiliate?.state).toBe("dibayar");
      expect(byNo.get(voided)?.affiliate?.state).toBe("batal");
      expect(byNo.get(plainOne)?.affiliate).toBeNull();
      expect(byNo.get(plainTwo)?.affiliate).toBeNull();
    });
  });

  it("never shows another store's affiliate on this store's orders", async () => {
    await inTxn(async (tx) => {
      const mine = await store(tx);
      const theirs = await store(tx);
      const foreign = await theirs.aff("THEIRS", "aktif");
      await theirs.order({ affiliateId: foreign, eligible: "past" });
      const myPlain = await mine.order();
      await asTenant(tx, mine.storeId);
      const res = await list.getOrderList({ pageSize: 50 });
      expect(res.rows.map((r) => r.number)).toEqual([myPlain]);
      expect(res.rows[0].affiliate).toBeNull();
    });
  });
});
