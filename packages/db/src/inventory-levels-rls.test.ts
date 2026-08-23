import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

/**
 * `inventory_levels` IS TENANT-ISOLATED BY THE DATABASE NOW — Task 6.2 / F-T8, migration 0100.
 *
 * Before it, this table had no `store_id`, no policy, and `tokophi_app` held full DML on it. Its only
 * boundary was the application remembering to read the RLS-protected parent first — the rule AGENTS.md
 * records as broken and SHIPPED seven times. `verify-rls` could not police it either: that check
 * derives its table list from `store_id` columns, so a table without one is invisible to the very
 * verifier meant to catch this.
 *
 * The claim proved here is the one the task asks for and the one no type-checker can see: **a known
 * row id belonging to another store returns and affects ZERO rows** under the restricted role, for
 * SELECT, UPDATE and DELETE alike — while the owning store's own operations still work.
 *
 * ISOLATION: every test runs inside a transaction that is ALWAYS rolled back, against the throwaway
 * `*_test` database `test/db-setup.ts` derives — never the shared dev one.
 */
const DB_URL = process.env.TEST_DATABASE_URL;
const suite = DB_URL ? describe : describe.skip;

let sql: postgres.Sql<Record<string, never>>;
beforeAll(() => {
  if (DB_URL) sql = postgres(DB_URL, { max: 1 });
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
type Fixture = { storeId: string; variantId: string; locationId: string; inventoryId: string };

/** One store owning one product → variant → location → inventory row. Built as the OWNER. */
async function mkStore(tx: postgres.Sql<Record<string, never>>): Promise<Fixture> {
  const n = ++seq;
  const [a] = await tx<{ id: string }[]>`insert into accounts (name) values ('InvRLS Acc') returning id`;
  const [s] = await tx<{ id: string }[]>`
    insert into stores (account_id, name, slug) values (${a.id}, 'InvRLS Store', ${"inv-rls-" + n}) returning id`;
  const [p] = await tx<{ id: string }[]>`
    insert into products (store_id, title, handle, number)
    values (${s.id}, 'InvRLS Product', ${"inv-rls-p-" + n}, ${900000 + n}) returning id`;
  const [v] = await tx<{ id: string }[]>`
    insert into product_variants (product_id, store_id, seq) values (${p.id}, ${s.id}, 1) returning id`;
  const [l] = await tx<{ id: string }[]>`
    insert into locations (store_id, name) values (${s.id}, 'Gudang') returning id`;
  const [inv] = await tx<{ id: string }[]>`
    insert into inventory_levels (variant_id, location_id, available) values (${v.id}, ${l.id}, 7) returning id`;
  return { storeId: s.id, variantId: v.id, locationId: l.id, inventoryId: inv.id };
}

/**
 * Run a statement that is EXPECTED to be refused, and return the message.
 *
 * ⚠️ A savepoint, not a try/finally. An RLS violation ABORTS the transaction, so every later command
 * — including the `reset role` a naive cleanup runs — fails with *"current transaction is aborted"*
 * and that message replaces the real one. The first draft of this file did exactly that and reported
 * a passing policy as a failing test. `ROLLBACK TO SAVEPOINT` is one of the few commands an aborted
 * transaction still accepts, and it restores the `SET LOCAL ROLE` as well.
 */
async function refusal(
  tx: postgres.Sql<Record<string, never>>,
  storeId: string,
  stmt: () => Promise<unknown>,
): Promise<string> {
  await tx`savepoint rls_probe`;
  await tx`select set_config('app.store_id', ${storeId}, true)`;
  await tx`set local role tokophi_app`;
  let message = "NO ERROR — the write was ACCEPTED";
  try {
    await stmt();
  } catch (e) {
    message = (e as Error).message;
  }
  await tx`rollback to savepoint rls_probe`;
  return message;
}

/** Exactly what `withTenant` does: pin the GUC, drop to the non-owner role, then run. */
async function asTenant<T>(
  tx: postgres.Sql<Record<string, never>>,
  storeId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await tx`select set_config('app.store_id', ${storeId}, true)`;
  await tx`set local role tokophi_app`;
  try {
    return await fn();
  } finally {
    await tx`reset role`;
  }
}

suite("inventory_levels: a foreign row id is worth nothing under the restricted role", () => {
  it("SELECT by a known foreign id returns 0 rows; the owner's own row is still readable", async () => {
    await inTxn(async (tx) => {
      const a = await mkStore(tx);
      const b = await mkStore(tx);

      const [own, foreign] = await asTenant(tx, a.storeId, async () => {
        const o = await tx`select id from inventory_levels where id = ${a.inventoryId}`;
        // The id is KNOWN and correct — this is not a guessing test. Only the policy hides it.
        const f = await tx`select id from inventory_levels where id = ${b.inventoryId}`;
        return [o.length, f.length];
      });
      expect(own).toBe(1);
      expect(foreign).toBe(0);
    });
  });

  it("UPDATE and DELETE by a known foreign id affect 0 rows, and the row survives intact", async () => {
    await inTxn(async (tx) => {
      const a = await mkStore(tx);
      const b = await mkStore(tx);

      const { updated, deleted } = await asTenant(tx, a.storeId, async () => {
        const u = await tx`update inventory_levels set available = 999 where id = ${b.inventoryId}`;
        const d = await tx`delete from inventory_levels where id = ${b.inventoryId}`;
        return { updated: u.count, deleted: d.count };
      });
      expect(updated).toBe(0);
      expect(deleted).toBe(0);

      // Read back as the OWNER: silence is not enough, the row must be unharmed.
      const [row] = await tx<{ available: number }[]>`
        select available from inventory_levels where id = ${b.inventoryId}`;
      expect(row?.available).toBe(7);
    });
  });

  it("the owning store can still read, update and delete its own row", async () => {
    await inTxn(async (tx) => {
      const a = await mkStore(tx);
      const after = await asTenant(tx, a.storeId, async () => {
        const u = await tx`update inventory_levels set available = 11 where id = ${a.inventoryId}`;
        const [r] = await tx<{ available: number }[]>`select available from inventory_levels where id = ${a.inventoryId}`;
        const d = await tx`delete from inventory_levels where id = ${a.inventoryId}`;
        return { updated: u.count, seen: r?.available, deleted: d.count };
      });
      expect(after).toEqual({ updated: 1, seen: 11, deleted: 1 });
    });
  });

  it("INSERT for a foreign variant is REFUSED by WITH CHECK, not silently accepted", async () => {
    await inTxn(async (tx) => {
      const a = await mkStore(tx);
      const b = await mkStore(tx);
      const msg = await refusal(tx, a.storeId, () =>
        tx`insert into inventory_levels (variant_id, location_id, available) values (${b.variantId}, ${b.locationId}, 5)`);
      expect(msg).toMatch(/row-level security/i);
    });
  });

  it("INSERT pairing OUR variant with a FOREIGN location is refused too — the WITH CHECK half that USING deliberately omits", async () => {
    await inTxn(async (tx) => {
      const a = await mkStore(tx);
      const b = await mkStore(tx);
      // The variant is ours, so a variant-only rule would accept this and quietly file our stock at
      // someone else's warehouse. That is why WITH CHECK is stricter than USING (migration 0100).
      const msg = await refusal(tx, a.storeId, () =>
        tx`insert into inventory_levels (variant_id, location_id, available) values (${a.variantId}, ${b.locationId}, 5)`);
      expect(msg).toMatch(/row-level security/i);
    });
  });

  it("with NO tenant context the table is empty — fail closed, like every other policy here", async () => {
    await inTxn(async (tx) => {
      const a = await mkStore(tx);
      const seen = await asTenant(tx, "00000000-0000-0000-0000-000000000000", async () => {
        const rows = await tx`select id from inventory_levels where id = ${a.inventoryId}`;
        return rows.length;
      });
      expect(seen).toBe(0);
    });
  });
});
