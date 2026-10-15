import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Sql } from "postgres";
import type { Db } from "./ledger-credit";

// Store affiliate programme, Tasks 9.2 + 9.3 — real Postgres, every case rolled back.
const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

let client: Sql;
let db: Db;
let mod: typeof import("./affiliate-attribution");
let applyOrderStatusChange: typeof import("./order-status").applyOrderStatusChange;

beforeAll(async () => {
  if (!URL) return;
  client = postgres(URL, { max: 1 });
  db = drizzle(client, { casing: "snake_case" }) as unknown as Db;
  process.env.DATABASE_URL = URL;
  mod = await import("./affiliate-attribution");
  ({ applyOrderStatusChange } = await import("./order-status"));
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
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
}
const rows = async (tx: Db, q: SQL) => (await tx.execute(q)) as unknown as Record<string, unknown>[];

let seq = 0;
async function fixture(tx: Db, opts: { enabled?: boolean } = {}) {
  const n = ++seq;
  const [account] = await rows(tx, sql`insert into accounts (name) values ('Aff Test') returning id`);
  const [store] = await rows(
    tx,
    sql`insert into stores (account_id, name, slug) values (${account.id}, 'Aff', ${"aff-test-" + n}) returning id`,
  );
  const storeId = store.id as string;
  await tx.execute(sql`insert into store_settings (store_id, affiliate_enabled, affiliate_rate_bps, affiliate_hold_days)
                       values (${storeId}, ${opts.enabled ?? true}, 1000, 3)`);
  const [p1] = await rows(tx, sql`insert into products (store_id, title, handle, number) values (${storeId}, 'A', 'a', 1) returning id`);
  const [p2] = await rows(
    tx,
    sql`insert into products (store_id, title, handle, number, affiliate_rate_bps) values (${storeId}, 'B', 'b', 2, 2000) returning id`,
  );
  const aff = async (code: string, status: string, phone = "6281111111111") =>
    (
      await rows(
        tx,
        sql`insert into affiliates (store_id, code, name, phone, status)
            values (${storeId}, ${code}, ${code}, ${phone}, ${status}::affiliate_status) returning id`,
      )
    )[0].id as string;
  const order = async (status = "baru") =>
    (
      await rows(
        tx,
        sql`insert into orders (store_id, number, status, subtotal_idr)
            values (${storeId}, ${"AFF-" + n + "-" + ++seq}, ${status}::order_status, 200000) returning id`,
      )
    )[0].id as string;
  const lines = [
    { productId: p1.id as string, totalIdr: 100_000 },
    { productId: p2.id as string, totalIdr: 100_000 },
  ];
  return { storeId, aff, order, lines };
}
const BUYER = "6289999999999";

suite("attachAffiliateCommission (F-A1, F-A4, F-A5, F-A6)", () => {
  it("freezes 27 000 for the spec example, per-product override included", async () => {
    await inTxn(async (tx) => {
      const f = await fixture(tx);
      const affId = await f.aff("SARI", "aktif");
      const orderId = await f.order();
      const row = await mod.attachAffiliateCommission(tx, {
        storeId: f.storeId, orderId, buyerPhone: BUYER, typedCode: "sari",
        lines: f.lines, subtotalIdr: 200_000, goodsProceedsIdr: 180_000,
      });
      expect(row).toMatchObject({ affiliateId: affId, source: "kode", baseIdr: 180_000, commissionIdr: 27_000, status: "pending" });
    });
  });

  it("a typed code beats a captured ref; an unresolvable typed code falls back to the ref", async () => {
    await inTxn(async (tx) => {
      const f = await fixture(tx);
      const a = await f.aff("AAA", "aktif");
      const b = await f.aff("BBB", "aktif");
      const o1 = await f.order();
      const r1 = await mod.attachAffiliateCommission(tx, {
        storeId: f.storeId, orderId: o1, buyerPhone: BUYER, typedCode: "BBB", refCode: "AAA",
        lines: f.lines, subtotalIdr: 200_000, goodsProceedsIdr: 200_000,
      });
      expect(r1).toMatchObject({ affiliateId: b, source: "kode" });
      const o2 = await f.order();
      const r2 = await mod.attachAffiliateCommission(tx, {
        storeId: f.storeId, orderId: o2, buyerPhone: BUYER, typedCode: "NOPE", refCode: "AAA",
        lines: f.lines, subtotalIdr: 200_000, goodsProceedsIdr: 200_000,
      });
      expect(r2).toMatchObject({ affiliateId: a, source: "link" });
    });
  });

  it("no commission when the programme is off, the code is inactive, or the buyer is the affiliate", async () => {
    await inTxn(async (tx) => {
      const off = await fixture(tx, { enabled: false });
      await off.aff("OFF", "aktif");
      const base = { buyerPhone: BUYER, lines: off.lines, subtotalIdr: 200_000, goodsProceedsIdr: 200_000 };
      expect(await mod.attachAffiliateCommission(tx, { ...base, storeId: off.storeId, orderId: await off.order(), typedCode: "OFF" })).toBeNull();

      const f = await fixture(tx);
      await f.aff("WAIT", "menunggu");
      await f.aff("SELF", "aktif", BUYER);
      const b2 = { ...base, lines: f.lines, storeId: f.storeId };
      expect(await mod.attachAffiliateCommission(tx, { ...b2, orderId: await f.order(), typedCode: "WAIT" })).toBeNull();
      expect(await mod.attachAffiliateCommission(tx, { ...b2, orderId: await f.order(), typedCode: "SELF" })).toBeNull();
      const [{ n }] = await rows(tx, sql`select count(*)::int as n from affiliate_commissions where store_id in (${off.storeId}, ${f.storeId})`);
      expect(n).toBe(0);
    });
  });

  it("another store's code never attributes (tenant boundary)", async () => {
    await inTxn(async (tx) => {
      const a = await fixture(tx);
      const b = await fixture(tx);
      await a.aff("SHARED", "aktif");
      const row = await mod.attachAffiliateCommission(tx, {
        storeId: b.storeId, orderId: await b.order(), buyerPhone: BUYER, typedCode: "SHARED",
        lines: b.lines, subtotalIdr: 200_000, goodsProceedsIdr: 200_000,
      });
      expect(row).toBeNull();
    });
  });

  it("one commission per order, even if attribution runs twice", async () => {
    await inTxn(async (tx) => {
      const f = await fixture(tx);
      await f.aff("ONCE", "aktif");
      const orderId = await f.order();
      const args = { storeId: f.storeId, orderId, buyerPhone: BUYER, typedCode: "ONCE", lines: f.lines, subtotalIdr: 200_000, goodsProceedsIdr: 200_000 };
      expect(await mod.attachAffiliateCommission(tx, args)).not.toBeNull();
      expect(await mod.attachAffiliateCommission(tx, args)).toBeNull();
      const [{ n }] = await rows(tx, sql`select count(*)::int as n from affiliate_commissions where order_id = ${orderId}`);
      expect(n).toBe(1);
    });
  });
});

suite("commission lifecycle through applyOrderStatusChange (F-A7)", () => {
  async function withCommission(tx: Db, status: "baru" | "diproses" | "dikirim") {
    const f = await fixture(tx);
    await f.aff("LIFE", "aktif");
    const orderId = await f.order(status);
    const row = await mod.attachAffiliateCommission(tx, {
      storeId: f.storeId, orderId, buyerPhone: BUYER, typedCode: "LIFE",
      lines: f.lines, subtotalIdr: 200_000, goodsProceedsIdr: 200_000,
    });
    return { f, orderId, commissionId: row!.id };
  }
  const commission = async (tx: Db, id: string) =>
    (await rows(tx, sql`select status, eligible_at between now() + interval '2 days 23 hours' and now() + interval '3 days 1 hour' as "inWindow", eligible_at as "eligibleAt" from affiliate_commissions where id = ${id}`))[0];

  it("batal and retur void the commission", async () => {
    await inTxn(async (tx) => {
      const c1 = await withCommission(tx, "baru");
      await applyOrderStatusChange(tx, { storeId: c1.f.storeId, order: { id: c1.orderId, status: "baru" }, status: "batal" });
      expect((await commission(tx, c1.commissionId)).status).toBe("batal");
      const c2 = await withCommission(tx, "dikirim");
      await applyOrderStatusChange(tx, { storeId: c2.f.storeId, order: { id: c2.orderId, status: "dikirim" }, status: "retur" });
      expect((await commission(tx, c2.commissionId)).status).toBe("batal");
    });
  });

  it("selesai (delivered) starts the hold window (now + 3 days, H+3) and keeps it pending", async () => {
    await inTxn(async (tx) => {
      const c = await withCommission(tx, "dikirim");
      await applyOrderStatusChange(tx, { storeId: c.f.storeId, order: { id: c.orderId, status: "dikirim" }, status: "selesai" });
      expect(await commission(tx, c.commissionId)).toMatchObject({ status: "pending", inWindow: true });
    });
  });

  it("a paid commission is never voided by a later return", async () => {
    await inTxn(async (tx) => {
      const c = await withCommission(tx, "dikirim");
      await tx.execute(sql`update affiliate_commissions set status = 'dibayar', paid_at = now() where id = ${c.commissionId}`);
      await applyOrderStatusChange(tx, { storeId: c.f.storeId, order: { id: c.orderId, status: "dikirim" }, status: "retur" });
      expect((await commission(tx, c.commissionId)).status).toBe("dibayar");
    });
  });
});
