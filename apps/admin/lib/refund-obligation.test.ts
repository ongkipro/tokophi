import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Sql } from "postgres";
import { textWithoutComments } from "../../../test/source-code";
import type { Db } from "./ledger-credit";
import type { OrderStatus, OrderStatusChangeArgs, OrderStatusChangeResult } from "./order-status";

/**
 * THE BUYER'S MONEY GETS A ROW (Task 8.31 / finance audit F12), DRIVEN AGAINST REAL POSTGRES.
 *
 * Cancelling a prepaid order that the buyer has ALREADY PAID used to: restore stock, fail any
 * `menunggu` payment, claw back the seller's sale — and leave the `berhasil` payment exactly where it
 * was. Money the platform holds, owed to somebody, recorded nowhere. This suite pins the fix:
 *
 *   · batal/retur on an order with a `berhasil` non-COD payment ⇒ exactly ONE open `refunds` row,
 *     in the same transaction, for the amount the buyer paid to us (`payments.amount_idr`).
 *   · a COD order ⇒ none (cash at the door — nothing was collected by us).
 *   · an unpaid order ⇒ none (nothing to give back; the `menunggu` payment is failed instead).
 *   · the obligation cannot be doubled: a second insert for the same payment is refused by the
 *     partial unique index `refunds_one_open_per_payment`, not by a check.
 *
 * Every assertion runs inside a transaction that is ALWAYS rolled back, against the throwaway
 * `*_test` database `test/db-setup.ts` derives.
 */

const DB_URL = process.env.TEST_DATABASE_URL;
const suite = DB_URL ? describe : describe.skip;

let client: Sql;
let db: Db;
let applyOrderStatusChange: (db: Db, args: OrderStatusChangeArgs) => Promise<OrderStatusChangeResult>;

beforeAll(async () => {
  if (!DB_URL) return;
  client = postgres(DB_URL, { max: 1 });
  db = drizzle(client, { casing: "snake_case" }) as unknown as Db;
  process.env.DATABASE_URL = DB_URL;
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
const rows = async <T = Record<string, unknown>>(tx: Db, query: SQL) => (await tx.execute(query)) as unknown as T[];

let seq = 0;
type Method = "va" | "qris" | "cod";
type PayStatus = "menunggu" | "berhasil";

/** A store with one order in `status` carrying one payment (`method`, `payStatus`) of `amount`. */
async function fixture(tx: Db, opts: { status: OrderStatus; method: Method; payStatus: PayStatus; amount?: number }) {
  seq += 1;
  const amount = opts.amount ?? 150_000;
  const [account] = await rows(tx, sql`insert into accounts (name) values ('Refund Obligation') returning id`);
  const [store] = await rows(
    tx,
    sql`insert into stores (account_id, name, slug)
        values (${account.id}, 'Refund Obligation', ${`refund-obligation-${seq}-${String(account.id).slice(0, 8)}`}) returning id`,
  );
  const [order] = await rows(
    tx,
    sql`insert into orders (store_id, number, status, subtotal_idr, total_idr)
        values (${store.id}, ${`REFUND-${seq}`}, ${opts.status}, ${amount}, ${amount}) returning id`,
  );
  const paidAt = opts.payStatus === "berhasil" ? sql`now()` : sql`null`;
  const [payment] = await rows(
    tx,
    sql`insert into payments (order_id, store_id, method, amount_idr, total, status, paid_at)
        values (${order.id}, ${store.id}, ${opts.method}, ${amount}, ${amount + 6_500}, ${opts.payStatus}, ${paidAt}) returning id`,
  );
  return { storeId: String(store.id), orderId: String(order.id), paymentId: String(payment.id), amount };
}

const refundsOf = (tx: Db, orderId: string) =>
  rows<{ paymentId: string; amount: string | number; status: string; reason: string | null }>(
    tx,
    sql`select payment_id as "paymentId", amount_idr as amount, status, reason from refunds where order_id = ${orderId}`,
  );

suite("refund obligation — a paid prepaid order that is cancelled owes the buyer (real Postgres)", () => {
  it("batal on a paid VA order writes exactly one open refund for what the buyer paid us", async () => {
    await inTxn(async (tx) => {
      const f = await fixture(tx, { status: "diproses", method: "va", payStatus: "berhasil" });
      const r = await applyOrderStatusChange(tx, { storeId: f.storeId, order: { id: f.orderId, status: "diproses" }, status: "batal" });
      expect(r).toEqual({ applied: true });

      const refunds = await refundsOf(tx, f.orderId);
      expect(refunds).toHaveLength(1);
      expect(refunds[0].paymentId).toBe(f.paymentId);
      expect(refunds[0].status).toBe("menunggu");
      // `payments.amount_idr`, NOT `payments.total`: the gateway's admin fee is theirs, not ours.
      expect(Number(refunds[0].amount)).toBe(f.amount);
      expect(refunds[0].reason).toBe("Pesanan dibatalkan");

      // The payment itself is untouched — it DID happen; the refund row is the record of undoing it.
      const [p] = await rows<{ status: string }>(tx, sql`select status from payments where id = ${f.paymentId}`);
      expect(p.status).toBe("berhasil");
    });
  });

  it("retur on a paid QRIS order writes the refund with the return reason", async () => {
    await inTxn(async (tx) => {
      const f = await fixture(tx, { status: "dikirim", method: "qris", payStatus: "berhasil", amount: 89_000 });
      const r = await applyOrderStatusChange(tx, {
        storeId: f.storeId,
        order: { id: f.orderId, status: "dikirim" },
        status: "retur",
        returnReason: "Barang rusak saat diterima",
      });
      expect(r).toEqual({ applied: true });
      const refunds = await refundsOf(tx, f.orderId);
      expect(refunds).toHaveLength(1);
      expect(Number(refunds[0].amount)).toBe(89_000);
      expect(refunds[0].reason).toBe("Retur — Barang rusak saat diterima");
    });
  });

  it("a COD order never produces a refund — nothing was collected by us", async () => {
    await inTxn(async (tx) => {
      // A delivered COD parcel that comes back: the payment reached `berhasil` at delivery, but the
      // cash is with the courier/merchant, never held by the platform.
      const f = await fixture(tx, { status: "selesai", method: "cod", payStatus: "berhasil" });
      const r = await applyOrderStatusChange(tx, { storeId: f.storeId, order: { id: f.orderId, status: "selesai" }, status: "retur" });
      expect(r).toEqual({ applied: true });
      expect(await refundsOf(tx, f.orderId)).toHaveLength(0);
    });
  });

  it("an unpaid prepaid order produces no refund; its pending payment is failed instead", async () => {
    await inTxn(async (tx) => {
      const f = await fixture(tx, { status: "baru", method: "va", payStatus: "menunggu" });
      const r = await applyOrderStatusChange(tx, { storeId: f.storeId, order: { id: f.orderId, status: "baru" }, status: "batal" });
      expect(r).toEqual({ applied: true });
      expect(await refundsOf(tx, f.orderId)).toHaveLength(0);
      const [p] = await rows<{ status: string }>(tx, sql`select status from payments where id = ${f.paymentId}`);
      expect(p.status).toBe("gagal");
    });
  });

  it("the obligation cannot be doubled: a replayed insert for the same payment is a no-op", async () => {
    await inTxn(async (tx) => {
      const f = await fixture(tx, { status: "diproses", method: "va", payStatus: "berhasil" });
      await applyOrderStatusChange(tx, { storeId: f.storeId, order: { id: f.orderId, status: "diproses" }, status: "batal" });
      expect(await refundsOf(tx, f.orderId)).toHaveLength(1);

      // The state machine refuses a second transition (terminal order) — that guard is tested
      // elsewhere. The DB-level claim is stronger: even the raw statement, replayed, adds nothing.
      await tx.execute(sql`
        insert into refunds (store_id, order_id, payment_id, amount_idr, reason)
        select p.store_id, p.order_id, p.id, p.amount_idr, 'replay'
          from payments p where p.order_id = ${f.orderId} and p.status = 'berhasil' and p.method <> 'cod'
        on conflict do nothing`);
      expect(await refundsOf(tx, f.orderId)).toHaveLength(1);

      // Once the open row is settled, a NEW obligation for the same payment is legal again — the
      // index is "one OPEN row", not "one row ever".
      await tx.execute(sql`update refunds set status = 'gagal', note = 'test' where order_id = ${f.orderId}`);
      await tx.execute(sql`insert into refunds (store_id, order_id, payment_id, amount_idr) values (${f.storeId}, ${f.orderId}, ${f.paymentId}, 1)`);
      expect(await refundsOf(tx, f.orderId)).toHaveLength(2);
    });
  });

  it("cancelling an order whose payment ALREADY has an open refund neither doubles it nor throws", async () => {
    // The state machine's terminal guard means a replayed cancellation never reaches the insert, so
    // the ON CONFLICT clause is only reachable when an open row already exists for the payment —
    // a duplicated event, a manual row, a restored backup. Then the cancellation must still APPLY
    // (stock back, seller clawed back) and the debt must stay ONE row. Without the clause, the
    // unique index throws 23505 out of the transaction and the whole cancellation rolls back.
    await inTxn(async (tx) => {
      const f = await fixture(tx, { status: "diproses", method: "va", payStatus: "berhasil" });
      await tx.execute(sql`insert into refunds (store_id, order_id, payment_id, amount_idr, reason) values (${f.storeId}, ${f.orderId}, ${f.paymentId}, ${f.amount}, 'pre-existing')`);
      const r = await applyOrderStatusChange(tx, { storeId: f.storeId, order: { id: f.orderId, status: "diproses" }, status: "batal" });
      expect(r).toEqual({ applied: true });
      const refunds = await refundsOf(tx, f.orderId);
      expect(refunds).toHaveLength(1);
      expect(refunds[0].reason).toBe("pre-existing");
      const [o] = await rows<{ status: string }>(tx, sql`select status from orders where id = ${f.orderId}`);
      expect(o.status).toBe("batal");
    });
  });

  it("a bare insert (no ON CONFLICT) is REFUSED by the partial unique index while a row is open", async () => {
    // Its own transaction: a refused statement aborts the txn, so nothing can follow it.
    await inTxn(async (tx) => {
      const f = await fixture(tx, { status: "diproses", method: "va", payStatus: "berhasil" });
      await applyOrderStatusChange(tx, { storeId: f.storeId, order: { id: f.orderId, status: "diproses" }, status: "batal" });
      await expect(
        tx.execute(sql`insert into refunds (store_id, order_id, payment_id, amount_idr) values (${f.storeId}, ${f.orderId}, ${f.paymentId}, 1)`),
      ).rejects.toMatchObject({ code: "23505", constraint_name: "refunds_one_open_per_payment" });
    });
  });

  it("the seller's own claw-back still runs beside the refund — both sides of the counter, one txn", async () => {
    await inTxn(async (tx) => {
      const f = await fixture(tx, { status: "diproses", method: "va", payStatus: "berhasil" });
      // The sale the callback would have credited when the payment landed.
      await tx.execute(sql`
        insert into ledger_entries (store_id, order_id, payment_id, kind, status, amount_idr, available_at)
        values (${f.storeId}, ${f.orderId}, ${f.paymentId}, 'sale', 'pending', ${f.amount}, now() + interval '7 days')`);
      await applyOrderStatusChange(tx, { storeId: f.storeId, order: { id: f.orderId, status: "diproses" }, status: "batal" });

      const [book] = await rows<{ total: string | number }>(tx, sql`select coalesce(sum(amount_idr), 0)::bigint as total from ledger_entries where store_id = ${f.storeId}`);
      expect(Number(book.total)).toBe(0); // seller's credit reversed…
      expect(await refundsOf(tx, f.orderId)).toHaveLength(1); // …and the buyer's debt recorded.
    });
  });
});

// ── SOURCE CLAIMS — read from the file's CODE, not its text (test/source-code.ts) ────────────────
// The insert is raw SQL inside a `sql` template, which Postgres executes the way a browser renders
// markup — so THAT claim reads `textWithoutComments` (literal contents kept), the documented case
// for SQL in `inventory-location.test.ts`. The SQL's own predicates (`berhasil`, `<> 'cod'`,
// `on conflict do nothing`) are proved by the Postgres cases above, not by matching text.
describe("refund obligation — source claims", () => {
  const src = readFileSync(new URL("./order-status.ts", import.meta.url), "utf8");

  it("the insert happens inside the batal/retur branch, before the order row is updated", () => {
    const text = textWithoutComments(src);
    const restoresAt = text.search(/if\s*\(\s*restores\s*\)/);
    const insertAt = text.search(/insert\s+into\s+refunds/i);
    const orderUpdateAt = text.search(/\.\s*update\s*\(\s*schema\s*\.\s*orders\s*\)/);
    expect(restoresAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(restoresAt);
    expect(orderUpdateAt).toBeGreaterThan(insertAt);
    // Self-check: a copy with the insert commented out must NOT satisfy this (a comment is text).
    const mutated = src.replace(/await db\.execute\(sql`\s*insert into refunds/, "/* await db.execute(sql` insert into refunds");
    expect(mutated).not.toBe(src);
    expect(textWithoutComments(mutated).search(/insert\s+into\s+refunds/i)).toBe(-1);
  });

  it("`refunds` has exactly one writer in the admin app: applyOrderStatusChange", () => {
    // Anything else inserting into `refunds` would be a second rule for when a buyer is owed money.
    const out = execSync("git grep -l -i -E 'insert\\s+into\\s+refunds' -- apps packages ':!*.test.ts' ':!*.sql' ':!*.md'", {
      cwd: new URL("../../..", import.meta.url).pathname,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(out).toEqual(["apps/admin/lib/order-status.ts"]);
  });
});
