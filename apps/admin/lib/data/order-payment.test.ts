import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql, desc, eq } from "drizzle-orm";

// "The order's payment" — the ONE thing the Pesanan list and the order detail must agree on.
//
// This is a DB test because nothing else can see the bug. The two sites had orderings that differed
// by `nulls last`, which `tsc`, ESLint, `next build` and every existing test call identical — only
// Postgres, and only on an order with an unpaid payment row beside a collected one, gives two
// different answers. The dev DB has 827 payments and none of that shape, so the screens agree today
// and would have started disagreeing on the first order that took a second payment.
//
// ISOLATION: everything runs in a transaction that is ALWAYS rolled back. It needs an isolated DB —
// set TEST_DATABASE_URL to a throwaway database (NEVER the shared dev DB — see AGENTS.md). Without
// it the suite SKIPS rather than fails, so a plain `vitest run` stays green.
//
//   TEST_DATABASE_URL=postgresql://tokophi:tokophi@localhost:5433/tokophi_test \
//     npx vitest run apps/admin/lib/data/order-payment.test.ts

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;
// `order-payment.ts` imports `schema` from @tokophi/db as a VALUE, and that module throws at import
// time when DATABASE_URL is unset — so both are dynamic-imported after pointing it at the throwaway
// DB, exactly as ledger-credit.test.ts does for order-status.
let latestPaymentFirst: (typeof import("./order-payment"))["latestPaymentFirst"];
let schema: (typeof import("@tokophi/db"))["schema"];

beforeAll(async () => {
  if (!URL) return;
  process.env.DATABASE_URL ??= URL;
  ({ latestPaymentFirst } = await import("./order-payment"));
  ({ schema } = await import("@tokophi/db"));
  client = postgres(URL, { max: 1 });
  // Must match @tokophi/db's client, or the query builder emits "orderId" instead of "order_id".
  db = drizzle(client, { casing: "snake_case" });
});
afterAll(async () => {
  if (client) await client.end();
});

class Rollback extends Error {}
async function inTxn(fn: (tx: typeof db) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      await fn(tx as unknown as typeof db);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

/** An order carrying an unpaid VA bill AND a collected COD row — the shape that splits the two reads. */
async function mkOrderWithTwoPayments(tx: typeof db): Promise<string> {
  const [acc] = await tx.execute<{ id: string }>(sql`insert into accounts (name) values ('Test Acc') returning id`);
  const [store] = await tx.execute<{ id: string }>(
    sql`insert into stores (account_id, name, slug) values (${acc.id}, 'Test Store', ${"pay-" + Math.random()}) returning id`,
  );
  const [o] = await tx.execute<{ id: string }>(
    sql`insert into orders (store_id, number, status) values (${store.id}, ${"PAY-" + Math.random()}, 'baru') returning id`,
  );
  // Inserted unpaid-first so row order alone cannot produce the right answer.
  await tx.execute(
    sql`insert into payments (order_id, store_id, method, status, paid_at) values (${o.id}, ${store.id}, 'va', 'menunggu', null)`,
  );
  await tx.execute(
    sql`insert into payments (order_id, store_id, method, status, paid_at) values (${o.id}, ${store.id}, 'cod', 'berhasil', now())`,
  );
  return o.id;
}

suite("latestPaymentFirst — one order, one answer", () => {
  it("the LIST's subquery and the DETAIL's select name the SAME method", async () => {
    await inTxn(async (tx) => {
      const orderId = await mkOrderWithTwoPayments(tx);

      // The list's shape (lib/data/orders.ts): a correlated scalar subquery, `payments` UNALIASED.
      const [listRow] = await tx.execute<{ m: string }>(sql`
        select (select payments.method::text from payments where payments.order_id = ${orderId}
                order by ${latestPaymentFirst()} limit 1) as "m"`);

      // The detail's shape (lib/data/order-detail.ts): a drizzle select of the whole row.
      const [detailRow] = await tx
        .select({ m: schema.payments.method })
        .from(schema.payments)
        .where(eq(schema.payments.orderId, orderId))
        .orderBy(latestPaymentFirst())
        .limit(1);

      // The collected payment, on both screens. The cost of them disagreeing is that the merchant
      // reads one method on the Pesanan list and another on the order's own detail page, with
      // nothing to say which is right. (It is NOT the courier's cash-collection instruction —
      // `createShipment` derives that from an `exists(… method = 'cod')`, which no ORDER BY moves.)
      expect(listRow.m).toBe("cod");
      expect(detailRow.m).toBe("cod");
      expect(listRow.m).toBe(detailRow.m);
    });
  });

  it("unpaid rows sort LAST — which a bare DESC does NOT do (this is the whole bug)", async () => {
    await inTxn(async (tx) => {
      const orderId = await mkOrderWithTwoPayments(tx);
      const ordered = async (by: ReturnType<typeof latestPaymentFirst>) =>
        (
          await tx
            .select({ m: schema.payments.method })
            .from(schema.payments)
            .where(eq(schema.payments.orderId, orderId))
            .orderBy(by)
        ).map((r) => r.m);

      expect(await ordered(latestPaymentFirst())).toEqual(["cod", "va"]);
      // Postgres sorts DESC as NULLS FIRST, so drizzle's `desc()` — which emits a bare `desc` — puts
      // the UNPAID row on top. This assertion exists so nobody "simplifies" the fragment back to it.
      expect(await ordered(sql`${desc(schema.payments.paidAt)}, ${desc(schema.payments.id)}`)).toEqual(["va", "cod"]);
    });
  });
});
