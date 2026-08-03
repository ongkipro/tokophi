import { pathToFileURL } from "node:url";
import postgres from "postgres";

/**
 * VERIFY THE MONEY BOOK — orphaned children of `orders`, and what they do to a merchant's balance.
 *
 * Run:  npm run verify-ledger -w @tokophi/db                        (uses DATABASE_URL)
 *       DATABASE_URL=…production… npm run verify-ledger -w @tokophi/db
 *
 * READ-ONLY. It never writes, so it is safe to point at production.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
 * On 2026-08-03 production held 48 rows whose parent `orders` row did not exist: 10 `payments`,
 * 30 `order_line_items` and 8 `ledger_entries`, all from ten orders numbered `INV-47xx` — the
 * pre-rebrand numbering, gone from `orders`, which today holds only `PHI-` rows.
 *
 * Eight of those were ledger `sale` entries, and that is the part that costs money. The balance is
 * DERIVED — `Σ amount_idr` grouped by status, no stored-balance column (CLAUDE.md) — and NOT ONE of
 * the queries that sums it joins `orders`. `getBalance`, the topbar chip, super-admin's
 * `getPlatformFloat`/`getStoreBalance`, and `requestPayout`'s "do you have enough?" test all read the
 * ledger straight. So the orphans were real money on screen: Rp810.000 sitting in **available**, i.e.
 * withdrawable, backed by no order at all, plus Rp2.302.000 in **pending**.
 *
 * ⚠️ **The fix is NOT to make the reads join `orders`.** A `payout` entry has `order_id IS NULL` by
 * design — it belongs to a payout, not an order — so an inner join drops every withdrawal ever made
 * and the available balance JUMPS by the total already paid out (Rp23.500.000 on production the day
 * this was written: Rp21.043.271 → Rp43.733.271). The reads are right; the rows were wrong.
 *
 * ── WHAT IT CHECKS ─────────────────────────────────────────────────────────────────────────────
 * 1. **Orphans**, for every table with a foreign key to `orders(id)` — the child list is read from
 *    the catalog, not hard-coded, so a child table added tomorrow is covered without touching this
 *    file. `order_id IS NULL` is counted SEPARATELY and never reported as an orphan: `not exists
 *    (select 1 from orders where id = child.order_id)` is TRUE for a NULL, which miscounts every
 *    payout entry as corruption and is the exact trap that has to be walked around here.
 * 2. **The constraint behind check 1.** Those FKs exist and are `convalidated`, and a probe proves
 *    Postgres refuses a dangling insert TODAY. So no application path can create these rows; only a
 *    trigger-bypassing load can (a data-only restore with `--disable-triggers`, or a session in
 *    `session_replication_role = replica`). An unvalidated or missing FK is itself a finding.
 * 3. **The rupiah**, per store: what each balance reads now versus with the orphans excluded. A count
 *    of bad rows is not a severity; the number a merchant can withdraw is.
 *
 * Exits non-zero on any finding, so it can gate a release or run from cron.
 */

type Sql = postgres.Sql<Record<string, never>>;

export type OrphanCount = {
  table: string;
  column: string;
  constraint: string;
  validated: boolean;
  dangling: number; // order_id points at an orders row that does not exist — CORRUPTION
  nullParent: number; // order_id IS NULL — legitimate for payouts, NEVER an orphan
};

/**
 * Every child of `orders`, straight from the catalog, with its orphan split.
 *
 * The identifiers come from `pg_constraint`, so they are the database's own and cannot be injected;
 * they still go through `sql()` for quoting rather than raw interpolation.
 */
export async function orphanCounts(sql: Sql): Promise<OrphanCount[]> {
  const children = await sql<
    { table: string; column: string; constraint: string; validated: boolean }[]
  >`
    select c.conrelid::regclass::text as "table",
           a.attname::text            as "column",
           c.conname::text            as "constraint",
           c.convalidated             as "validated"
    from pg_constraint c
    join lateral unnest(c.conkey) as k(attnum) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.contype = 'f'
      and c.confrelid = 'orders'::regclass
      and array_length(c.conkey, 1) = 1
    order by 1
  `;

  const out: OrphanCount[] = [];
  for (const ch of children) {
    const [row] = await sql<{ dangling: number; nullParent: number }[]>`
      select
        count(*) filter (
          where ${sql(ch.column)} is not null
            and not exists (select 1 from orders o where o.id = x.${sql(ch.column)})
        )::int as "dangling",
        count(*) filter (where ${sql(ch.column)} is null)::int as "nullParent"
      from ${sql(ch.table)} x
    `;
    out.push({ ...ch, dangling: row.dangling, nullParent: row.nullParent });
  }
  return out;
}

export type BalanceImpact = {
  storeId: string;
  available: number; // as every screen renders it today
  availableClean: number; // with dangling-parent entries removed
  pending: number;
  pendingClean: number;
};

/**
 * What the orphans are worth, per store, in the two numbers a merchant actually sees.
 *
 * Every sum is cast to `text`, not to `int`. `amount_idr` is `bigint` because IDR needs it, and a
 * store holding more than Rp2,1 milyar would overflow `int4` — the verifier would then throw on
 * exactly the account where being wrong costs the most.
 */
export async function balanceImpact(sql: Sql): Promise<BalanceImpact[]> {
  const rows = await sql<Record<keyof BalanceImpact, string>[]>`
    select
      store_id::text as "storeId",
      coalesce(sum(amount_idr) filter (where status = 'available'), 0)::text as "available",
      coalesce(sum(amount_idr) filter (where status = 'pending'),   0)::text as "pending",
      coalesce(sum(amount_idr) filter (
        where status = 'available' and (order_id is null or exists (select 1 from orders o where o.id = l.order_id))
      ), 0)::text as "availableClean",
      coalesce(sum(amount_idr) filter (
        where status = 'pending' and (order_id is null or exists (select 1 from orders o where o.id = l.order_id))
      ), 0)::text as "pendingClean"
    from ledger_entries l
    group by store_id
    order by 1
  `;
  return rows.map((r) => ({
    storeId: r.storeId,
    available: Number(r.available),
    availableClean: Number(r.availableClean),
    pending: Number(r.pending),
    pendingClean: Number(r.pendingClean),
  }));
}

/**
 * Does the FK actually bite RIGHT NOW? Asked by trying, inside a transaction that always rolls back.
 *
 * `convalidated` says the constraint was checked once; this says the trigger fires today. They can
 * disagree — that gap is precisely how a `--disable-triggers` restore leaves a validated constraint
 * standing over rows it would have refused.
 *
 * It creates its OWN store rather than reusing one, because a freshly migrated database has none and
 * a probe that quietly turns into "no store to test with" is a probe that always passes. The store is
 * rolled back with everything else.
 */
export async function refusesDanglingInsert(sql: Sql): Promise<boolean> {
  const NOWHERE = "00000000-0000-0000-0000-000000000001";
  try {
    await sql.begin(async (tx) => {
      const [a] = await tx<{ id: string }[]>`insert into accounts (name) values ('fk probe') returning id`;
      const [s] = await tx<{ id: string }[]>`
        insert into stores (account_id, name, slug) values (${a.id}, 'fk probe', ${`fk-probe-${Date.now()}`}) returning id`;
      await tx`insert into ledger_entries (store_id, order_id, kind, status, amount_idr)
               values (${s.id}, ${NOWHERE}, 'sale', 'pending', 1)`;
      throw new Error("THE FOREIGN KEY DID NOT FIRE");
    });
    return false;
  } catch (e) {
    // `23503` = foreign_key_violation, and it must be the ORDERS one: `store_id` has an FK too, so a
    // bare code check would pass on a probe that never reached the column under test.
    const err = e as { code?: string; constraint_name?: string };
    return err.code === "23503" && err.constraint_name === "ledger_entries_order_id_orders_id_fk";
  }
}

const idr = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

function assert(label: string, ok: boolean) {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("[verify-ledger] DATABASE_URL is not set");
  const sql = postgres(url, { max: 1 }) as unknown as Sql;

  try {
    const counts = await orphanCounts(sql);
    for (const c of counts) {
      assert(
        `${c.table}.${c.column} — ${c.dangling} orphan(s)` +
          (c.nullParent ? `, ${c.nullParent} row(s) with a NULL parent (legitimate, not an orphan)` : ""),
        c.dangling === 0,
      );
      assert(`${c.constraint} is VALIDATED — the constraint that keeps check 1 true`, c.validated);
    }

    assert("a dangling ledger insert is REFUSED by Postgres right now", await refusesDanglingInsert(sql));

    for (const b of await balanceImpact(sql)) {
      const dA = b.available - b.availableClean;
      const dP = b.pending - b.pendingClean;
      assert(
        `store ${b.storeId}: available ${idr(b.available)}` +
          (dA ? ` — ${idr(dA)} of it has NO order behind it and is WITHDRAWABLE` : " (all backed by an order)"),
        dA === 0,
      );
      assert(
        `store ${b.storeId}: pending ${idr(b.pending)}` +
          (dP ? ` — ${idr(dP)} of it has NO order behind it, so the itemised list cannot show it` : " (all backed by an order)"),
        dP === 0,
      );
    }

    console.log(`\n${process.exitCode ? "LEDGER VERIFY FAILED" : "Ledger verified ✅"}`);
  } finally {
    await sql.end();
  }
}

// Only when run as a script. `verify-rls.ts` calls `main()` at module scope, which is fine for a file
// nothing imports — this one is imported by its own test suite, and connecting to DATABASE_URL as a
// side effect of an import is how a test run ends up talking to the shared dev database.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
