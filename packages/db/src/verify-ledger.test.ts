import { describe, expect, it, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { orphanCounts, balanceImpact, refusesDanglingInsert } from "./verify-ledger";

// `verify-ledger` reports rows in the money book whose `orders` parent is gone. This suite is the
// half that a green production run cannot give you: it PLANTS the corruption and checks the verifier
// sees it, and it plants the LOOKALIKE and checks the verifier stays quiet.
//
// The lookalike is the point. `not exists (select 1 from orders where id = child.order_id)` is TRUE
// when `order_id` is NULL, and a `payout` entry has `order_id` NULL by design — it belongs to a
// withdrawal, not to an order. A naive orphan query therefore reports every withdrawal on the
// platform as corruption, and "fixing" the balance reads by joining `orders` deletes every payout
// from the sum, so a merchant's withdrawable balance jumps by everything they have already taken out.
// Both halves are asserted below because the wrong version passes the first one.
//
// PLANTING IT AT ALL takes a superuser and `session_replication_role = 'replica'`, which is the
// honest part of this test: the foreign keys are present and validated, so no application path can
// produce these rows. Only a load with the referential triggers off can — a `pg_restore --data-only
// --disable-triggers`, or a session that switched the role by hand. Everything runs inside a
// transaction that is always rolled back.

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

let sql: postgres.Sql<Record<string, never>>;

beforeAll(() => {
  if (!URL) return;
  sql = postgres(URL, { max: 1 }) as unknown as postgres.Sql<Record<string, never>>;
});
afterAll(async () => {
  await sql?.end();
});

class Rollback extends Error {}
/** Run inside a transaction that NEVER commits. */
async function inTxn(fn: (tx: postgres.Sql<Record<string, never>>) => Promise<void>) {
  try {
    await sql.begin(async (tx) => {
      await fn(tx as unknown as postgres.Sql<Record<string, never>>);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

let seq = 0;
async function mkStore(tx: postgres.Sql<Record<string, never>>): Promise<string> {
  const [a] = await tx<{ id: string }[]>`insert into accounts (name) values ('Ledger Verify Acc') returning id`;
  const [s] = await tx<{ id: string }[]>`
    insert into stores (account_id, name, slug) values (${a.id}, 'Ledger Verify Store', ${"lv-" + ++seq}) returning id`;
  return s.id;
}

const NOWHERE = "00000000-0000-0000-0000-0000000000ff";
const ledgerOf = (rows: Awaited<ReturnType<typeof orphanCounts>>) =>
  rows.find((r) => r.table === "ledger_entries")!;

suite("verify-ledger sees an orphan, and does not invent one", () => {
  it("the foreign keys on every child of `orders` exist and are VALIDATED", async () => {
    const rows = await orphanCounts(sql);
    // The three that carry money history. If a child table is added later it appears here too — the
    // list is read from the catalog, which is the whole reason this assertion is a superset check.
    const tables = rows.map((r) => r.table);
    expect(tables).toEqual(expect.arrayContaining(["ledger_entries", "payments", "order_line_items"]));
    for (const r of rows) {
      expect(r.validated, `${r.constraint} must be validated, not NOT VALID`).toBe(true);
      expect(r.column, `${r.table} should hang off order_id`).toBe("order_id");
    }
  });

  it("Postgres refuses a dangling ledger insert TODAY — the constraint is not just declared", async () => {
    expect(await refusesDanglingInsert(sql)).toBe(true);
  });

  it("a planted orphan is COUNTED (triggers off is the only way to make one)", async () => {
    await inTxn(async (tx) => {
      const before = ledgerOf(await orphanCounts(tx)).dangling;
      const storeId = await mkStore(tx);
      await tx`set local session_replication_role = 'replica'`;
      await tx`insert into ledger_entries (store_id, order_id, kind, status, amount_idr)
               values (${storeId}, ${NOWHERE}, 'sale', 'available', 810000)`;
      await tx`set local session_replication_role = 'origin'`;

      const after = ledgerOf(await orphanCounts(tx));
      expect(after.dangling).toBe(before + 1);

      // …and it is worth exactly the rupiah it claims, in the number a merchant can withdraw.
      const impact = (await balanceImpact(tx)).find((b) => b.storeId === storeId)!;
      expect(impact.available).toBe(810_000);
      expect(impact.availableClean).toBe(0);
    });
  });

  it("a payout entry (order_id NULL) is NOT an orphan — the trap that miscounts every withdrawal", async () => {
    await inTxn(async (tx) => {
      const beforeDangling = ledgerOf(await orphanCounts(tx)).dangling;
      const storeId = await mkStore(tx);
      const [p] = await tx<{ id: string }[]>`
        insert into payouts (store_id, amount_idr, status) values (${storeId}, 500000, 'menunggu') returning id`;
      await tx`insert into ledger_entries (store_id, payout_id, kind, status, amount_idr)
               values (${storeId}, ${p.id}, 'payout', 'available', -500000)`;

      const after = ledgerOf(await orphanCounts(tx));
      expect(after.dangling, "a NULL parent is not a dangling parent").toBe(beforeDangling);
      expect(after.nullParent).toBeGreaterThan(0);

      // The other half: the withdrawal must stay INSIDE the balance. Joining `orders` to "exclude
      // orphans" drops it, and available goes from -500.000 to 0 — the money comes back.
      const impact = (await balanceImpact(tx)).find((b) => b.storeId === storeId)!;
      expect(impact.available).toBe(-500_000);
      expect(impact.availableClean).toBe(-500_000);
    });
  });
});
