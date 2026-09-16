import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";

/**
 * 0113 RUN TWICE IS 0113 RUN ONCE (Tasks 8.26 / 8.27).
 *
 * AGENTS.md: drizzle applies the whole pending batch in ONE transaction, so a migration that fails on
 * its second encounter with a database (a column that arrived via `push`, a re-deploy after a
 * partial apply) rolls back everything behind it while printing "migrations applied successfully".
 * This drives the migration's own statements against the throwaway `*_test` database, which
 * `test/db-setup.ts` has already migrated to head — so the FIRST run here is already a re-run —
 * and then runs them again, asserting that the backfill inserted exactly one comp per audit line
 * and that a second pass adds nothing.
 *
 * Everything happens inside one transaction that is always rolled back.
 */
const DB_URL = process.env.TEST_DATABASE_URL;
const suite = DB_URL ? describe : describe.skip;

const MIGRATION = readFileSync(path.join(__dirname, "../drizzle/0113_comp_invoices_and_demo_flag.sql"), "utf8");
const STATEMENTS = MIGRATION.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);

let client: Sql;
beforeAll(() => {
  // The re-run is SUPPOSED to hit "already exists, skipping" notices — that is the claim. Keep them out of the log.
  if (DB_URL) client = postgres(DB_URL, { max: 1, onnotice: () => {} });
});
afterAll(async () => {
  await client?.end();
});

suite("0113 is idempotent and its backfill is keyed on the audit line", () => {
  it("applies twice on a head database without error and without a second comp row", async () => {
    expect(STATEMENTS.length).toBeGreaterThanOrEqual(5);
    const ROLLBACK = new Error("rollback");
    await client
      .begin(async (tx) => {
        const [acct] = await tx`insert into accounts (name) values ('0113 idem') returning id`;
        const [store] = await tx`insert into stores (account_id, name, slug) values (${acct.id}, '0113 idem', ${"m0113-" + acct.id.slice(0, 8)}) returning id`;
        // Two historical comps, 5 days apart, exactly as compStore logged them before 0113.
        await tx`insert into platform_activity (kind, text, store_id, ts)
                 values ('admin', 'Gratis 1 bulan diberikan (aktif s/d 1/10/2026)', ${store.id}, now() - interval '5 days'),
                        ('admin', 'Gratis 3 bulan diberikan (aktif s/d 1/1/2027)', ${store.id}, now())`;

        for (let pass = 0; pass < 2; pass++) {
          for (const stmt of STATEMENTS) await tx.unsafe(stmt);
          const comps = await tx`select period_months, amount_idr, tax_idr, status, kind, cycle from invoices where store_id = ${store.id} and kind = 'comp' order by issued_at`;
          expect(comps, `pass ${pass + 1}`).toHaveLength(2);
          expect(comps.map((c) => Number(c.period_months))).toEqual([1, 3]);
          for (const c of comps) expect(c).toMatchObject({ amount_idr: "0", tax_idr: "0", status: "dibayar", kind: "comp", cycle: "comp" });
        }
        // is_demo: column present, default false, the flagged slug is only ever the demo one.
        const [me] = await tx`select is_demo from stores where id = ${store.id}`;
        expect(me.is_demo).toBe(false);
        throw ROLLBACK;
      })
      .catch((e) => {
        if (e !== ROLLBACK) throw e;
      });
  });

  it("the comp uniqueness index refuses a second row for the same grant", async () => {
    const ROLLBACK = new Error("rollback");
    await client
      .begin(async (tx) => {
        const [acct] = await tx`insert into accounts (name) values ('0113 uniq') returning id`;
        const [store] = await tx`insert into stores (account_id, name, slug) values (${acct.id}, '0113 uniq', ${"u0113-" + acct.id.slice(0, 8)}) returning id`;
        const at = new Date("2026-09-10T03:00:00Z");
        const ins = (n: string) =>
          tx`insert into invoices (number, account_id, store_id, plan_key, amount_idr, tax_idr, status, kind, cycle, period_months, issued_at, paid_at)
             values (${n}, ${acct.id}, ${store.id}, 'bisnis', 0, 0, 'dibayar', 'comp', 'comp', 1, ${at}, ${at})`;
        await ins("COMP-uniq-a");
        await expect(ins("COMP-uniq-b")).rejects.toMatchObject({ code: "23505" });
        throw ROLLBACK;
      })
      .catch((e) => {
        if (e !== ROLLBACK) throw e;
      });
  });
});
