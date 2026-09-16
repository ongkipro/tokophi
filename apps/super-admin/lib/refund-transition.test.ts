import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { sql } from "drizzle-orm";
import { codeOnly } from "../../../test/source-code";
import {
  markRefundPaidInTxn,
  processRefundInTxn,
  rejectRefundInTxn,
  type RefundDb,
  type RefundStatus,
} from "./refund-transition";

/**
 * REFUND TRANSITIONS, DRIVEN AGAINST REAL POSTGRES (Task 8.31) — the payout lesson (F-M15) applied
 * before the same bug can ship a second time: every transition is decided by its UPDATE's WHERE,
 * `diproses` is the ONLY source of `selesai`, every refusal writes nothing, and NO path touches the
 * ledger — this is the buyer's money and it never entered the seller's book.
 *
 * All four source statuses are driven through all three transitions. Every test rolls back.
 */

const DB_URL = process.env.TEST_DATABASE_URL;
const suite = DB_URL ? describe : describe.skip;

let client: Sql;
let db: PostgresJsDatabase;
beforeAll(() => {
  if (!DB_URL) return;
  client = postgres(DB_URL, { max: 2 });
  db = drizzle(client, { casing: "snake_case" });
});
afterAll(async () => {
  await client?.end();
});

const ROLLBACK = Symbol("rollback");
async function inTxn(fn: (tx: RefundDb) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      await fn(tx as unknown as RefundDb);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}
const rows = async <T>(tx: RefundDb, q: ReturnType<typeof sql>): Promise<T[]> => (await tx.execute(q)) as unknown as T[];

let seq = 0;
/** A store, a paid VA order, and one refund row in `status`. Plus a ledger row so "untouched" is provable. */
async function fixture(tx: RefundDb, status: RefundStatus, amount = 120_000) {
  seq += 1;
  const [account] = await rows<{ id: string }>(tx, sql`insert into accounts (name) values ('Refund Transition') returning id`);
  const [store] = await rows<{ id: string }>(
    tx,
    sql`insert into stores (account_id, name, slug) values (${account.id}, 'Refund Transition', ${`refund-transition-${seq}-${account.id.slice(0, 8)}`}) returning id`,
  );
  const [order] = await rows<{ id: string }>(
    tx,
    sql`insert into orders (store_id, number, status, subtotal_idr, total_idr) values (${store.id}, ${`RT-${seq}`}, 'batal', ${amount}, ${amount}) returning id`,
  );
  const [payment] = await rows<{ id: string }>(
    tx,
    sql`insert into payments (order_id, store_id, method, amount_idr, total, status, paid_at)
        values (${order.id}, ${store.id}, 'va', ${amount}, ${amount + 6500}, 'berhasil', now()) returning id`,
  );
  const paidAt = status === "selesai" ? sql`now() - interval '2 days'` : sql`null`;
  const note = status === "gagal" ? "Ditolak sebelumnya" : status === "selesai" ? "REF-OLD" : null;
  const [refund] = await rows<{ id: string }>(
    tx,
    sql`insert into refunds (store_id, order_id, payment_id, amount_idr, status, reason, note, paid_at)
        values (${store.id}, ${order.id}, ${payment.id}, ${amount}, ${status}, 'Pesanan dibatalkan', ${note}, ${paidAt}) returning id`,
  );
  await tx.execute(sql`
    insert into ledger_entries (store_id, component, kind, status, amount_idr, available_at)
    values (${store.id}, 'refund-transition-fixture', 'adjustment', 'available', 500000, now())`);
  return { storeId: store.id, orderId: order.id, refundId: refund.id, amount };
}

async function snapshot(tx: RefundDb, storeId: string, refundId: string) {
  const [r] = await rows<{ status: RefundStatus; note: string | null; paidAt: string | number | null }>(
    tx,
    sql`select status, note, (extract(epoch from paid_at) * 1000)::bigint as "paidAt" from refunds where id = ${refundId}`,
  );
  const [book] = await rows<{ entries: number; total: string | number }>(
    tx,
    sql`select count(*)::int as entries, coalesce(sum(amount_idr), 0)::bigint as total from ledger_entries where store_id = ${storeId}`,
  );
  return { status: r?.status ?? null, note: r?.note ?? null, paidAt: r?.paidAt == null ? null : Number(r.paidAt), entries: Number(book.entries), total: Number(book.total) };
}

const ALL: RefundStatus[] = ["menunggu", "diproses", "selesai", "gagal"];

suite("refund transitions — one CAS each, nothing to the ledger (real Postgres)", () => {
  it("process: menunggu → diproses, and only from menunggu", async () => {
    for (const from of ALL) {
      await inTxn(async (tx) => {
        const f = await fixture(tx, from);
        const before = await snapshot(tx, f.storeId, f.refundId);
        const r = await processRefundInTxn(tx, f.refundId);
        const after = await snapshot(tx, f.storeId, f.refundId);
        if (from === "menunggu") {
          expect(r.ok).toBe(true);
          expect(after.status).toBe("diproses");
        } else {
          expect(r.ok).toBe(false);
          if (r.ok) return;
          expect(r.from).toBe(from);
          expect(r.conflict).toBe({ diproses: "sudah_diproses", selesai: "sudah_lunas", gagal: "sudah_ditolak" }[from]);
          expect(after).toEqual(before); // a refusal writes NOTHING
        }
        expect(after.entries).toBe(before.entries);
        expect(after.total).toBe(before.total);
      });
    }
  });

  it("mark paid: diproses → selesai with paid_at + reference, and only from diproses", async () => {
    for (const from of ALL) {
      await inTxn(async (tx) => {
        const f = await fixture(tx, from);
        const before = await snapshot(tx, f.storeId, f.refundId);
        const r = await markRefundPaidInTxn(tx, f.refundId, "REF-123");
        const after = await snapshot(tx, f.storeId, f.refundId);
        if (from === "diproses") {
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          expect(r.amount).toBe(f.amount);
          expect(r.storeId).toBe(f.storeId);
          expect(after.status).toBe("selesai");
          expect(after.note).toBe("REF-123");
          expect(after.paidAt).not.toBeNull();
        } else {
          expect(r.ok).toBe(false);
          if (r.ok) return;
          expect(r.conflict).toBe({ menunggu: "belum_diproses", selesai: "sudah_lunas", gagal: "sudah_ditolak" }[from]);
          // `menunggu → selesai` is the exact hole the payout queue shipped with. It must stay shut,
          // and a repeat click on an already-paid row must not move `paid_at`.
          expect(after).toEqual(before);
        }
        expect(after.entries).toBe(before.entries);
        expect(after.total).toBe(before.total);
      });
    }
  });

  it("mark paid without a reference keeps whatever note was there", async () => {
    await inTxn(async (tx) => {
      const f = await fixture(tx, "diproses");
      await tx.execute(sql`update refunds set note = 'catatan operator' where id = ${f.refundId}`);
      const r = await markRefundPaidInTxn(tx, f.refundId, null);
      expect(r.ok).toBe(true);
      const after = await snapshot(tx, f.storeId, f.refundId);
      expect(after.note).toBe("catatan operator");
    });
  });

  it("reject: menunggu|diproses → gagal with the reason, never from selesai or gagal", async () => {
    for (const from of ALL) {
      await inTxn(async (tx) => {
        const f = await fixture(tx, from);
        const before = await snapshot(tx, f.storeId, f.refundId);
        const r = await rejectRefundInTxn(tx, f.refundId, "Sudah dikembalikan via jalur lain");
        const after = await snapshot(tx, f.storeId, f.refundId);
        if (from === "menunggu" || from === "diproses") {
          expect(r.ok).toBe(true);
          expect(after.status).toBe("gagal");
          expect(after.note).toBe("Sudah dikembalikan via jalur lain");
        } else {
          expect(r.ok).toBe(false);
          if (r.ok) return;
          expect(r.conflict).toBe(from === "selesai" ? "sudah_lunas" : "sudah_ditolak");
          expect(after).toEqual(before);
        }
        expect(after.entries).toBe(before.entries);
        expect(after.total).toBe(before.total);
      });
    }
  });

  it("an unknown id is refused as tidak_ditemukan on every transition", async () => {
    await inTxn(async (tx) => {
      const ghost = "00000000-0000-0000-0000-000000000000";
      for (const r of [await processRefundInTxn(tx, ghost), await markRefundPaidInTxn(tx, ghost), await rejectRefundInTxn(tx, ghost, "x")]) {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.conflict).toBe("tidak_ditemukan");
      }
    });
  });

  it("two operators marking the same refund paid: exactly one wins", async () => {
    // A committed fixture is needed for two CONNECTIONS to contend; cleaned up in `finally`.
    let ids: { storeId: string; refundId: string; accountId: string } | null = null;
    try {
      const [account] = (await db.execute(sql`insert into accounts (name) values ('Refund Race') returning id`)) as unknown as { id: string }[];
      const [store] = (await db.execute(sql`insert into stores (account_id, name, slug) values (${account.id}, 'Refund Race', ${`refund-race-${account.id.slice(0, 8)}`}) returning id`)) as unknown as { id: string }[];
      const [order] = (await db.execute(sql`insert into orders (store_id, number, status) values (${store.id}, ${`RACE-${account.id.slice(0, 8)}`}, 'batal') returning id`)) as unknown as { id: string }[];
      const [payment] = (await db.execute(sql`insert into payments (order_id, store_id, method, amount_idr, status, paid_at) values (${order.id}, ${store.id}, 'va', 1000, 'berhasil', now()) returning id`)) as unknown as { id: string }[];
      const [refund] = (await db.execute(sql`insert into refunds (store_id, order_id, payment_id, amount_idr, status) values (${store.id}, ${order.id}, ${payment.id}, 1000, 'diproses') returning id`)) as unknown as { id: string }[];
      ids = { storeId: store.id, refundId: refund.id, accountId: account.id };

      const results = await Promise.all([
        db.transaction((tx) => markRefundPaidInTxn(tx as unknown as RefundDb, refund.id, "A")),
        db.transaction((tx) => markRefundPaidInTxn(tx as unknown as RefundDb, refund.id, "B")),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const loser = results.find((r) => !r.ok);
      expect(loser && !loser.ok && loser.conflict).toBe("sudah_lunas");
    } finally {
      if (ids) {
        await db.execute(sql`delete from refunds where store_id = ${ids.storeId}`);
        await db.execute(sql`delete from payments where store_id = ${ids.storeId}`);
        await db.execute(sql`delete from orders where store_id = ${ids.storeId}`);
        await db.execute(sql`delete from stores where id = ${ids.storeId}`);
        await db.execute(sql`delete from accounts where id = ${ids.accountId}`);
      }
    }
  });
});

describe("refund transitions — source claims", () => {
  const code = codeOnly(readFileSync(new URL("./refund-transition.ts", import.meta.url), "utf8"));
  it("the module never touches the ledger and never imports the db singleton", () => {
    expect(code).not.toMatch(/ledger_entries|ledgerEntries/);
    expect(code).not.toMatch(/@tokophi\/db/);
  });
  it("the actions delegate: actions.ts writes no refund status of its own", () => {
    const actions = codeOnly(readFileSync(new URL("./actions.ts", import.meta.url), "utf8"));
    expect(actions).toMatch(/processRefundInTxn/);
    expect(actions).toMatch(/markRefundPaidInTxn/);
    expect(actions).toMatch(/rejectRefundInTxn/);
    expect(actions).not.toMatch(/update\s*\(\s*schema\s*\.\s*refunds\s*\)/);
  });
});
