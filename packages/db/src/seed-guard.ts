// ── WHAT A TRUNCATE-AND-RESEED DESTROYS THAT NOTHING PUTS BACK (N42) ─────────────────────────────
//
// `SEED_FORCE=1 npm run seed` empties every table but four and writes the demo back. The four are
// `__drizzle_migrations`, `kiriminaja_areas`, `kelurahan`, `product_taxonomy` — REFERENCE data. The
// AC for N42 offered two ways out: put the exposed tables on that keep-list, or refuse and say what
// is about to be lost. **The first one does not work, and this file is the second.**
//
// 🔴 WHY A LONGER KEEP-LIST IS NOT THE FIX — MEASURED, not reasoned.
// `truncate … cascade` follows every foreign key INTO the truncated set, so a table excluded from the
// list is still emptied the moment it references one that is not. Probed on a throwaway database
// carrying this schema (2026-08-05): with `store_tracking_channels`, `page_templates` and `flash_sales`
// ADDED to the keep-list, Postgres printed
//     NOTICE:  truncate cascades to table "flash_sales"
//     NOTICE:  truncate cascades to table "page_templates"
//     NOTICE:  truncate cascades to table "store_tracking_channels"
// and all three ended at 0 rows. All three carry `store_id → stores(id)`. Keep-listing them is a
// no-op that READS like protection — which is worse than not doing it. `truncate-cascade.test.ts`
// pins this against a live database.
//
// ⚠️ TWO THINGS THE FIRST DRAFT OF THIS NOTE GOT WRONG, both corrected against the same probe:
//  ① "the keep-list works for the reference tables because they have no FK into anything" — FALSE.
//    `kelurahan.district_id` REFERENCES `kiriminaja_areas(id)`. It survives because its parent is
//    keep-listed too. The rule is not "no foreign keys", it is **no FK path out of the keep-list**.
//    (`products → product_taxonomy` is the harmless direction: cascade walks parent → child, so
//    truncating a child never reaches the parent it references.)
//  ② "the keep-list cannot protect ANY of this" — FALSE for the platform singletons.
//    `platform_admins`, `shipping_aggregator` and `platform_payment_gateways` have **no foreign keys
//    at all** and were measured surviving a keep-list in the same probe. They are not on it for a
//    different reason: `seed.ts` INSERTs `admin@tokophi.id` unconditionally and the table has a
//    UNIQUE constraint on `email`, so keeping the old row makes the reseed CRASH. Protecting them
//    means editing the seed's writes, not its delete — a bigger change than N42 is, and one nobody
//    asked for. The refusal below covers them today, honestly, in four lines.
//
// So the guard is a REFUSAL: count what is about to be lost, print it, and make the operator name the
// destruction in a second variable. `SEED_FORCE=1` is a flag someone copies out of a doc;
// `SEED_DESTROY_CONFIG=1` is a sentence they have to mean.
import type { Sql } from "postgres";

export type Loss = {
  /** Table name, exactly as it exists in `public`. Checked against the schema by the test. */
  table: string;
  /** When set, only rows where this column IS NOT NULL count — the secret, not the row holding it. */
  column?: string;
  /** What the operator loses. Printed verbatim. */
  what: string;
};

/**
 * Rows a reseed removes and no seed writes back. Ordered worst-first: this is read under pressure.
 *
 * ⚠️ Everything here is destroyed by `SEED_FORCE=1` TODAY — none of it is hypothetical, and none of
 * it is on the keep-list (see the note above for why two of the three reasons you would expect are
 * wrong). A table absent from the database is skipped, and so is a `column` the database does not
 * have: a deployment that predates a column has nothing to lose from it. That skip is only honest as
 * long as the names are real, which is what `seed-guard.test.ts` checks against `schema.ts`.
 */
export const IRREPLACEABLE: Loss[] = [
  { table: "orders", what: "ORDERS — buyer name, WhatsApp, delivery address, the money" },
  { table: "customers", what: "customer records" },
  { table: "ledger_entries", what: "ledger entries — the merchant's balance is DERIVED from these" },
  {
    table: "store_tracking_channels",
    column: "capi_token_ciphertext",
    what: "ENCRYPTED CAPI TOKENS — not re-derivable from anything, and re-entering one means going back to Meta",
  },
  {
    table: "store_tracking_channels",
    what: "pixel ids / channel config — `seed.ts` does not write this table AT ALL, so nothing restores it",
  },
  { table: "page_templates", what: "Store Builder templates — published merchant work (`seed:templates` rewrites only the demo store's)" },
  { table: "flash_sales", what: "flash sales — no seeder anywhere writes this table" },
  { table: "media", what: "media library rows (the FILES survive on disk; the rows pointing at them do not)" },
  { table: "platform_admins", what: "platform operator logins — replaced by ONE freshly seeded account" },
  { table: "shipping_aggregator", column: "api_key", what: "the courier aggregator API key — re-seeded NULL" },
  { table: "platform_payment_gateways", column: "credentials", what: "the payment gateway credentials — re-seeded NULL" },
  {
    table: "affiliate_commissions",
    what: "AFFILIATE COMMISSIONS — money the merchant owes an affiliate. Paid OUTSIDE TokoΦ (0116), so the ledger does not hold a second copy and nothing can reconstruct it",
  },
  { table: "affiliates", what: "affiliate programme members — their codes, bank details and the merchant's approvals" },
  { table: "buyer_accounts", what: "Akun TokoΦ identities — a Google `sub` binding is not re-derivable; the buyer must sign up again" },
  {
    table: "buyer_order_claims",
    what: "orders buyers attached to their account (`order_id` is UNIQUE — once a claim is gone nobody else can make it)",
  },
  { table: "buyer_store_links", what: "each buyer's recorded consent per store" },
  { table: "buyer_addresses", what: "buyers' saved delivery addresses" },
];

/** One `Loss` that this database actually holds rows for. */
export type Found = Loss & { rows: number };

/**
 * Count what a truncate would take from THIS database. Read-only; no locks beyond a shared read.
 *
 * One round trip resolves which tables and columns exist, so an older deployment (or a fresh empty
 * one) costs a single catalogue query and nothing else. Every identifier below is a literal from
 * `IRREPLACEABLE`, and it still goes through postgres.js's identifier escaping rather than string
 * concatenation — the previous version built `where ${predicate}` into a `client.unsafe(...)`, which
 * was safe by inspection only.
 */
export async function countIrreplaceable(sql: Sql): Promise<Found[]> {
  const columnsByTable = new Map<string, Set<string>>();
  const cols = await sql<{ table_name: string; column_name: string }[]>`
    select table_name, column_name from information_schema.columns where table_schema = 'public'`;
  for (const c of cols) {
    let set = columnsByTable.get(c.table_name);
    if (!set) columnsByTable.set(c.table_name, (set = new Set()));
    set.add(c.column_name);
  }

  const found: Found[] = [];
  for (const loss of IRREPLACEABLE) {
    const columns = columnsByTable.get(loss.table);
    if (!columns) continue; // the table does not exist here — nothing to lose
    if (loss.column && !columns.has(loss.column)) continue;
    const [row] = loss.column
      ? await sql<{ c: number }[]>`select count(*)::int as c from ${sql(loss.table)} where ${sql(loss.column)} is not null`
      : await sql<{ c: number }[]>`select count(*)::int as c from ${sql(loss.table)}`;
    if (row.c > 0) found.push({ ...loss, rows: row.c });
  }
  return found;
}

/**
 * Refuse to truncate a database that holds something no seed can put back.
 *
 * ⚠️ Runs before EVERY truncate, not only under `SEED_FORCE`. The skip in `main()` only looks at
 * `stores`, so a database with a rotated platform operator and no store yet sails past it and loses
 * the operator — which is exactly the shape `2026-08-03-rotate-exposed-owners.md` §② warns about,
 * where the operator row is the one that can lock you out of the platform outright. Silent and
 * ~free when there is nothing to lose, which is the fresh-database case this runs in on every deploy.
 *
 * Returns normally when the caller may proceed; otherwise it prints and never returns.
 */
export async function assertTruncateIsDeliberate(sql: Sql, onRefuse: () => Promise<void>): Promise<void> {
  const found = await countIrreplaceable(sql);
  if (!found.length) return;

  const width = Math.max(...found.map((f) => f.table.length));
  console.error("\n🔴 THE SEED TRUNCATES EVERY TABLE. This database holds rows nothing will put back:\n");
  for (const f of found) {
    console.error(`   ${String(f.rows).padStart(7)}  ${f.table.padEnd(width)}  ${f.what}`);
  }
  console.error(
    "\n   There is no backup step in this script and no restore path for any line above.\n" +
      "   Adding them to the truncate keep-list does NOT work: `cascade` follows the store_id\n" +
      "   foreign keys into them anyway. See the note at the top of src/seed-guard.ts.\n",
  );

  if (process.env.SEED_DESTROY_CONFIG) {
    console.error("   SEED_DESTROY_CONFIG=1 — proceeding, as instructed.\n");
    return;
  }
  console.error(
    "   REFUSING. If you meant it, re-run with SEED_DESTROY_CONFIG=1 as well.\n" +
      "   If the demo merely looks stale, you almost certainly want `npm run seed:recent -w @tokophi/db`\n" +
      "   instead — it only INSERTS, touches one store, and is idempotent.\n",
  );
  await onRefuse();
  process.exit(1);
}
