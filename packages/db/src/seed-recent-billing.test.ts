import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { computeBilling, type StoreBillingRow } from "@tokophi/lib/billing";
import { codeOnly } from "../../../test/source-code";
import { RECENT_PERIOD_DAYS, seedBillingPeriod } from "./seed-recent";

// Task 8.13 — `npm run seed:recent` must be enough to make an admin save succeed again.
//
// The main seed writes `stores.current_period_end = now() + 20d`. Twenty days later that period has
// lapsed, `computeBilling()` reports `readOnly` (3-day grace, then suspended), and every admin write
// throws `SuspendedError` — "Gagal menyimpan produk" on a store nobody suspended. `seed:recent` used
// to refresh orders, carts, vouchers and the ledger while leaving that one column alone, so the
// charts came back to life and the save button stayed dead.
//
// Postgres half: the REAL exported statement, against the throwaway `_test` database, inside a
// transaction that is always rolled back (same discipline as `daily-stats.test.ts`). The verdict is
// taken from `computeBilling` itself — the function the admin's write gate calls — not from the
// column value, so the claim is "the write path opens", not "a date moved".

const DB_URL = process.env.TEST_DATABASE_URL;
const suite = DB_URL ? describe : describe.skip;

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;
type Db = typeof db;

beforeAll(() => {
  if (!DB_URL) return;
  client = postgres(DB_URL, { max: 1 });
  db = drizzle(client, { casing: "snake_case" });
});
afterAll(async () => {
  if (client) await client.end();
});

class Rollback extends Error {}
async function inTxn(fn: (tx: Db) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      await fn(tx as unknown as Db);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

const rows = async (tx: Db, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as Record<string, unknown>[];

const DAY = 86_400_000;
let seq = 0;

/** A store whose period end is `days` from now (null = still on trial, never paid). */
async function mkStore(tx: Db, days: number | null): Promise<string> {
  const [acc] = await rows(tx, sql`insert into accounts (name) values ('8.13') returning id`);
  const end = days === null ? null : new Date(Date.now() + days * DAY).toISOString();
  const [st] = await rows(tx, sql`
    insert into stores (account_id, name, slug, trial_ends_at, current_period_end, first_invoice_paid)
    values (${acc.id}, 'Seed Recent Billing', ${`srb-${process.pid}-${++seq}`},
            now() - interval '60 days', ${end}::timestamptz, true)
    returning id`);
  return String(st.id);
}

async function billing(tx: Db, storeId: string): Promise<StoreBillingRow & { rawEnd: string | null }> {
  const [r] = await rows(tx, sql`
    select trial_ends_at, current_period_end, first_invoice_paid, comped, suspended_at,
           to_json(current_period_end) #>> '{}' as raw_end
      from stores where id = ${storeId}`);
  return {
    trialEndsAt: r.trial_ends_at ? new Date(String(r.trial_ends_at)) : null,
    currentPeriodEnd: r.current_period_end ? new Date(String(r.current_period_end)) : null,
    firstInvoicePaid: Boolean(r.first_invoice_paid),
    comped: Boolean(r.comped),
    suspendedAt: r.suspended_at ? new Date(String(r.suspended_at)) : null,
    rawEnd: r.raw_end == null ? null : String(r.raw_end),
  };
}

suite("seed:recent re-opens the write path of a store whose seeded period has lapsed", () => {
  it("a period end 10 days in the past: readOnly before, active and writable after, +30d", async () => {
    await inTxn(async (tx) => {
      const id = await mkStore(tx, -10);
      const before = computeBilling(await billing(tx, id));
      expect(before.readOnly).toBe(true); // the exact blocker: past the 3-day grace → SuspendedError
      expect(before.status).toBe("suspended");

      const until = await seedBillingPeriod(tx, id);
      expect(until).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      const row = await billing(tx, id);
      const after = computeBilling(row);
      expect(after.readOnly).toBe(false);
      expect(after.status).toBe("active");
      expect(after.operatorSuspended).toBe(false);
      // now()+30d, to the minute — not "some future date".
      const expected = Date.now() + RECENT_PERIOD_DAYS * DAY;
      expect(Math.abs(row.currentPeriodEnd!.getTime() - expected)).toBeLessThan(60_000);
    });
  });

  it("a period end still in the future is NOT touched — not even re-stamped to the same window", async () => {
    await inTxn(async (tx) => {
      const id = await mkStore(tx, 5);
      const before = await billing(tx, id);
      expect(computeBilling(before).readOnly).toBe(false);

      expect(await seedBillingPeriod(tx, id)).toBeNull();

      const after = await billing(tx, id);
      expect(after.rawEnd).toBe(before.rawEnd); // byte-identical timestamp
    });
  });

  it("a trial store (no period end) stays a trial — NULL is not 'in the past'", async () => {
    await inTxn(async (tx) => {
      const id = await mkStore(tx, null);
      await rows(tx, sql`update stores set trial_ends_at = now() + interval '1 day', first_invoice_paid = false where id = ${id}`);
      expect(computeBilling(await billing(tx, id)).status).toBe("trial");

      expect(await seedBillingPeriod(tx, id)).toBeNull();

      const after = await billing(tx, id);
      expect(after.currentPeriodEnd).toBeNull();
      expect(computeBilling(after).status).toBe("trial");
    });
  });

  it("is idempotent: the second run matches nothing", async () => {
    await inTxn(async (tx) => {
      const id = await mkStore(tx, -40);
      expect(await seedBillingPeriod(tx, id)).not.toBeNull();
      const once = (await billing(tx, id)).rawEnd;
      expect(await seedBillingPeriod(tx, id)).toBeNull();
      expect((await billing(tx, id)).rawEnd).toBe(once);
    });
  });

  it("touches ONE store: a sibling with a lapsed period is left lapsed", async () => {
    await inTxn(async (tx) => {
      const target = await mkStore(tx, -10);
      const sibling = await mkStore(tx, -10);
      await seedBillingPeriod(tx, target);
      expect(computeBilling(await billing(tx, sibling)).readOnly).toBe(true);
    });
  });
});

// Source claim, no DB: importing `seed-recent.ts` (as this file does) must not RUN the top-up
// against whatever DATABASE_URL is in scope. The entrypoint guard is the only thing preventing that.
describe("seed-recent.ts runs main() only as an entrypoint", () => {
  const code = codeOnly(readFileSync(new URL("./seed-recent.ts", import.meta.url), "utf8"));
  it("main() is behind the import.meta.url === argv[1] guard", () => {
    expect(code).toMatch(/if\s*\(\s*import\s*\.\s*meta\s*\.\s*url\s*===\s*pathToFileURL\s*\(\s*process\s*\.\s*argv\s*\[\s*1\s*\]/);
    // No bare top-level `main()` call: every CALL (the declaration is excluded) sits after the guard.
    const calls = [...code.matchAll(/(?<!function\s*)main\s*\(\s*\)/g)].map((m) => m.index!);
    expect(calls.length).toBeGreaterThan(0);
    const guard = code.search(/if\s*\(\s*import\s*\.\s*meta\s*\.\s*url/);
    expect(guard).toBeGreaterThan(-1);
    for (const at of calls) expect(at).toBeGreaterThan(guard);
  });
});
