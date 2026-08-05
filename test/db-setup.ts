import path from "node:path";
import { fileURLToPath } from "node:url";
import { readDatabaseUrl } from "@tokophi/lib/env-file";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

// Vitest globalSetup: make the DB-coupled suites RUN instead of silently skipping.
//
// WHY THIS EXISTS. `apps/admin/lib/ledger-credit.test.ts` guards the money path — the claim that a
// double-credit is a DB impossibility, and `select sum(…) for update`, which Postgres rejects outright
// and which `tsc` cannot see inside a SQL string. It skipped unless the developer happened to export
// TEST_DATABASE_URL by hand, so **22 tests over the ledger never ran**: not in any developer's default
// `vitest run`, and there is no CI here to catch it either. A test that nobody runs is documentation.
//
// This resolves the throwaway database, creates it if absent, migrates it to head, and exports
// TEST_DATABASE_URL for the worker processes. The container is already required to run the app at all,
// so on a normal dev machine the suites now simply run.
//
// ⚠️ THE GUARD BELOW IS THE IMPORTANT PART. These suites seed stores, orders and payments. They roll
// every transaction back, but the database they point at must still never be the shared dev one:
// AGENTS.md records that truncating it costs whoever else is mid-verification their afternoon and
// their session, silently. So the resolved name MUST end in `_test`, and if it does not this throws
// rather than "helpfully" continuing. Do not relax it.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const MIGRATIONS = path.join(ROOT, "packages/db/drizzle");

/** `…/tokophi` → `…/tokophi_test`. An explicit TEST_DATABASE_URL always wins. */
function resolveTestUrl(): string | undefined {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  // ⚠️ `readDatabaseUrl` is SHARED (`@tokophi/lib/env-file`) and that is the point. This file used to
  // read `<ROOT>/.env` and nothing else — and `.gitignore` is `.env*`, so a git worktree can never
  // have one. In a worktree the whole gate below therefore fell through to the SKIP banner and exited
  // 0: 36 tests, 22 of them the ledger's, silently not running, in the place this repo does nearly
  // all of its work. Do not re-inline the lookup here; fix it in the shared module.
  const base = readDatabaseUrl(ROOT);
  if (!base) return undefined;
  const u = new URL(base);
  const name = u.pathname.replace(/^\//, "");
  if (!name) return undefined;
  u.pathname = `/${name.endsWith("_test") ? name : `${name}_test`}`;
  return u.toString();
}

function banner(lines: string[]) {
  const width = Math.max(...lines.map((l) => l.length));
  const rule = "─".repeat(width + 2);
  console.warn(`\n┌${rule}┐`);
  for (const l of lines) console.warn(`│ ${l.padEnd(width)} │`);
  console.warn(`└${rule}┘\n`);
}

export default async function setup() {
  // Opt-in hard failure: `npm run test:db` sets this so a missing database can never pass quietly.
  const required = process.env.TEST_DB_REQUIRED === "1";
  const url = resolveTestUrl();

  if (!url) {
    const msg = "No DATABASE_URL (env, this root's .env, or the main checkout's) — cannot derive a test database.";
    if (required) throw new Error(`${msg} Start the container and copy .env.example to .env.`);
    banner(["DB-COUPLED SUITES SKIPPED — the ledger/money tests did NOT run.", msg]);
    return;
  }

  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    // Deliberately fatal. See the note at the top of this file.
    throw new Error(
      `Refusing to run DB tests against "${dbName}": the test database name must end with "_test". ` +
        `These suites write (inside rolled-back transactions) and must never be pointed at a shared database.`,
    );
  }

  const admin = new URL(url);
  admin.pathname = "/postgres";

  let root: ReturnType<typeof postgres> | undefined;
  try {
    root = postgres(admin.toString(), { max: 1, connect_timeout: 5, onnotice: () => {} });
    const [row] = await root`select 1 from pg_database where datname = ${dbName}`;
    if (!row) {
      // CREATE DATABASE cannot run inside a transaction, hence .unsafe.
      await root.unsafe(`create database "${dbName}"`);
      console.log(`[db-setup] created throwaway database "${dbName}"`);
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (required) throw new Error(`Test database unreachable: ${reason}`);
    banner([
      "DB-COUPLED SUITES SKIPPED — the ledger/money tests did NOT run.",
      `Reason: ${reason}`,
      "Start it with:  docker compose up -d db",
      "Then re-run. `npm run test:db` fails instead of skipping.",
    ]);
    return;
  } finally {
    await root?.end();
  }

  // Migrate to head. Idempotent: drizzle applies only entries newer than the last applied one.
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client, { casing: "snake_case" }), { migrationsFolder: MIGRATIONS });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (required) throw new Error(`Migrating ${dbName} failed: ${reason}`);
    banner([
      "DB-COUPLED SUITES SKIPPED — migrating the test database failed.",
      `Reason: ${reason}`,
      `Recreate it:  docker exec tokophi-db psql -U tokophi -d postgres -c 'drop database ${dbName}'`,
    ]);
    return;
  } finally {
    await client.end();
  }

  // Read by the suites at import time. Workers are spawned after globalSetup, so they inherit this.
  process.env.TEST_DATABASE_URL = url;
  console.log(`[db-setup] DB-coupled suites will run against "${dbName}"`);
}
