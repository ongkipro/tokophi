import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

/**
 * EVERY FOREIGN KEY HAS AN INDEX THAT LEADS WITH ITS COLUMN — migration 0116.
 *
 * Measured 2026-10-29: 67 FK columns had none, including `customers.store_id` (the RLS predicate on
 * every tenant read of that table), `store_users.user_id` and `orders.customer_id`. Nothing noticed,
 * because nothing looked: the index census in `schema-indexes.test.ts` classifies indexes that EXIST
 * and cannot see one that was never written. `order_line_items.order_id` (0096) was the same miss.
 *
 * So this reads the CATALOG of the migrated `*_test` database — every FK in `public`, whatever
 * migration created it — and fails on any whose first column is not the first column of some index.
 * No table list, no name list: a FK added tomorrow is covered the moment its migration runs.
 *
 * An exception must be NAMED below with the reason (a table that never grows, say). There are none.
 */
const DB_URL = process.env.TEST_DATABASE_URL;
const suite = DB_URL ? describe : describe.skip;

/** `<table>.<column>` → why it is fine without an index. */
const EXEMPT: Record<string, string> = {};

let sql: postgres.Sql<Record<string, never>>;
beforeAll(() => {
  if (DB_URL) sql = postgres(DB_URL, { max: 1 });
});
afterAll(async () => {
  await sql?.end();
});

suite("foreign keys are indexed", () => {
  it("reads a real catalog (a check that scans zero FKs is green forever)", async () => {
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from pg_constraint
       where contype = 'f' and connamespace = 'public'::regnamespace`;
    expect(n).toBeGreaterThan(50);
  });

  it("every FK column leads some index on its table", async () => {
    const rows = await sql<{ fk: string }[]>`
      select c.conrelid::regclass::text || '.' || a.attname as fk
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       where c.contype = 'f' and c.connamespace = 'public'::regnamespace
         and not exists (
           select 1 from pg_index i
            where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])
       order by 1`;
    const missing = rows.map((r) => r.fk).filter((fk) => !(fk in EXEMPT));
    expect(
      missing,
      "FK without an index leading on its column: add `create index if not exists` in a hand-written " +
        "migration (see 0116), mirror it in schema.ts, classify it in schema-indexes.test.ts — or name " +
        "it in EXEMPT with the reason.",
    ).toEqual([]);
  });

  it("does not keep stale exemptions", async () => {
    const rows = await sql<{ fk: string }[]>`
      select c.conrelid::regclass::text || '.' || a.attname as fk
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       where c.contype = 'f' and c.connamespace = 'public'::regnamespace`;
    const all = new Set(rows.map((r) => r.fk));
    expect(Object.keys(EXEMPT).filter((fk) => !all.has(fk))).toEqual([]);
  });
});
