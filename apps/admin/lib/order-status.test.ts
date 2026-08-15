import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Sql } from "postgres";
import type { Db } from "./ledger-credit";
import type { OrderStatusChangeArgs, OrderStatusChangeResult } from "./order-status";

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

let client: Sql;
let db: Db;
let applyOrderStatusChange: (
  db: Db,
  args: OrderStatusChangeArgs,
) => Promise<OrderStatusChangeResult>;

beforeAll(async () => {
  if (!URL) return;
  // Dynamic by design: a skipped DB suite must not initialize @tokophi/db without DATABASE_URL.
  client = postgres(URL, { max: 1 });
  db = drizzle(client, { casing: "snake_case" }) as unknown as Db;
  process.env.DATABASE_URL = URL;
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

const rows = async (tx: Db, query: SQL) =>
  (await tx.execute(query)) as unknown as Record<string, unknown>[];

suite("applyOrderStatusChange", () => {
  it("applies a courier-confirmed diproses → selesai transition and collects COD", async () => {
    await inTxn(async (tx) => {
      const [account] = await rows(tx, sql`insert into accounts (name) values ('Order Status Test') returning id`);
      const [store] = await rows(
        tx,
        sql`insert into stores (account_id, name, slug)
            values (${account.id}, 'Order Status Test', 'order-status-transition-test') returning id`,
      );
      const [order] = await rows(
        tx,
        sql`insert into orders (store_id, number, status)
            values (${store.id}, 'ORDER-STATUS-1', 'diproses') returning id`,
      );
      await tx.execute(sql`
        insert into payments (order_id, store_id, method, amount_idr, total, status)
        values (${order.id}, ${store.id}, 'cod', 125000, 125000, 'menunggu')
      `);

      const result = await applyOrderStatusChange(tx, {
        storeId: store.id as string,
        order: { id: order.id as string, status: "diproses" },
        status: "selesai",
      });

      expect(result).toEqual({ applied: true });

      const [updatedOrder] = await rows(
        tx,
        sql`select status, financial_status as "financialStatus" from orders where id = ${order.id}`,
      );
      expect(updatedOrder).toMatchObject({ status: "selesai", financialStatus: "dibayar" });

      const [payment] = await rows(
        tx,
        sql`select status, paid_at as "paidAt" from payments where order_id = ${order.id}`,
      );
      expect(payment.status).toBe("berhasil");
      expect(payment.paidAt).not.toBeNull();

      const ledger = await rows(
        tx,
        sql`select kind, status, amount_idr::bigint as amount
              from ledger_entries where order_id = ${order.id}`,
      );
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({ kind: "sale", status: "available" });
      expect(Number(ledger[0].amount)).toBe(125_000);
    });
  });
});
