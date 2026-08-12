import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Sql } from "postgres";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/tenant";
import type { PayoutResult } from "./payout";

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;
let client: Sql;
let db: PostgresJsDatabase;
let requestPayoutInTenant: (
  db: Tx,
  storeId: string,
  amount: number,
) => Promise<PayoutResult>;

beforeAll(async () => {
  if (!URL) return;
  // Dynamic by design: a skipped DB suite must not initialize @tokophi/db without DATABASE_URL.
  process.env.DATABASE_URL ??= URL;
  ({ requestPayoutInTenant } = await import("./payout"));
  client = postgres(URL, { max: 4 });
  db = drizzle(client, { casing: "snake_case" });
});
afterAll(async () => client?.end());

suite("payout serialization (real Postgres)", () => {
  it("allows only one of two withdrawals that race for the same balance", async () => {
    const [account] = (await db.execute(
      sql`insert into accounts (name) values ('Payout Race') returning id`,
    )) as unknown as { id: string }[];
    const slug = `payout-race-${account.id.slice(0, 8)}`;
    const [store] = (await db.execute(sql`
      insert into stores (account_id, name, slug) values (${account.id}, 'Payout Race', ${slug}) returning id
    `)) as unknown as { id: string }[];

    try {
      await db.execute(sql`
        insert into store_settings (store_id, bank_name, bank_account, bank_holder)
        values (${store.id}, 'Bank Test', '123456', 'Seller Test')`);
      await db.execute(sql`
        insert into ledger_entries (store_id, component, kind, status, amount_idr, available_at)
        values (${store.id}, 'race-fixture', 'adjustment', 'available', 100000, now())`);

      const attempt = () =>
        db.transaction(async (tx) => {
          await tx.execute(
            sql`select set_config('app.store_id', ${store.id}, true)`,
          );
          await tx.execute(sql`set local role tokophi_app`);
          return requestPayoutInTenant(tx as unknown as Tx, store.id, 80_000);
        });
      const results = await Promise.all([attempt(), attempt()]);

      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toHaveLength(1);
      const [truth] = (await db.execute(sql`
        select count(*)::int as "ledgerRows",
               coalesce(sum(amount_idr), 0)::bigint as balance
          from ledger_entries
         where store_id = ${store.id}
      `)) as unknown as { ledgerRows: number; balance: string | number }[];
      expect(Number(truth.ledgerRows)).toBe(2); // opening credit + exactly one payout debit
      expect(Number(truth.balance)).toBe(20_000);
    } finally {
      await db.execute(
        sql`delete from ledger_entries where store_id = ${store.id}`,
      );
      await db.execute(sql`delete from payouts where store_id = ${store.id}`);
      await db.execute(
        sql`delete from store_settings where store_id = ${store.id}`,
      );
      await db.execute(sql`delete from stores where id = ${store.id}`);
      await db.execute(sql`delete from accounts where id = ${account.id}`);
    }
  });
});
