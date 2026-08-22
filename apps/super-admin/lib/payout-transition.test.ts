import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { sql } from "drizzle-orm";
import { codeOnly } from "../../../test/source-code";
import { markPayoutPaidInTxn, type PayoutDb, type PayoutStatus } from "./payout-transition";

/**
 * THE PAID TRANSITION, DRIVEN AGAINST REAL POSTGRES (Task 5.10 / F-M15).
 *
 * The claim is not "the code reads correctly" — it is that `diproses` is the ONLY source state that
 * can produce a paid payout, that every refusal writes nothing, and that pressing the button twice
 * cannot move `paid_at` or a single rupiah of the ledger. All three are properties of one SQL
 * statement's WHERE clause, and none of them is visible to `tsc`: the old shape read the row and
 * refused two of the four states, which type-checks perfectly while letting `menunggu → selesai`
 * through.
 *
 * Every assertion below was proved RED first, against mutations of `payout-transition.ts` that put
 * the old behaviour back (the guard dropped from the WHERE; a read-then-check; `selesai` allowed to
 * re-claim; a ledger row posted on success). The results are in BUILD-LOG.md. A guard nobody has
 * seen fail is green for reasons nobody has checked.
 *
 * ISOLATION: every test runs inside a transaction that is ALWAYS rolled back, against the throwaway
 * `*_test` database `test/db-setup.ts` derives — never the shared dev one.
 */

const DB_URL = process.env.TEST_DATABASE_URL;
const suite = DB_URL ? describe : describe.skip;

let client: Sql;
let db: PostgresJsDatabase;

beforeAll(() => {
  if (!DB_URL) return;
  client = postgres(DB_URL, { max: 2 });
  db = drizzle(client, { casing: "snake_case" });
});
afterAll(async () => {
  await client?.end();
});

const ROLLBACK = Symbol("rollback");
async function inTxn(fn: (tx: PayoutDb) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      await fn(tx as unknown as PayoutDb);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}

const rows = async <T>(tx: PayoutDb, q: ReturnType<typeof sql>): Promise<T[]> =>
  (await tx.execute(q)) as unknown as T[];

let seq = 0;

/**
 * A store with one payout in `status`, plus the NEGATIVE `payout` ledger entry the merchant's own
 * withdrawal wrote. That entry is the thing every assertion here protects: it is the record that
 * the money left the available pool, and no transition — allowed or refused — may edit it.
 */
async function fixture(tx: PayoutDb, status: PayoutStatus, amount = 250_000) {
  seq += 1;
  const [account] = await rows<{ id: string }>(
    tx,
    sql`insert into accounts (name) values ('Payout Transition') returning id`,
  );
  const slug = `payout-transition-${seq}-${account.id.slice(0, 8)}`;
  const [store] = await rows<{ id: string }>(
    tx,
    sql`insert into stores (account_id, name, slug) values (${account.id}, 'Payout Transition', ${slug}) returning id`,
  );
  // A paid row must carry a stamp from before this test, so "unchanged" is provable.
  const paidAt = status === "selesai" ? sql`now() - interval '3 days'` : sql`null`;
  const [payout] = await rows<{ id: string }>(
    tx,
    sql`insert into payouts (store_id, amount_idr, status, bank_name, bank_account, bank_holder, paid_at)
        values (${store.id}, ${amount}, ${status}, 'Bank Test', '123456', 'Seller Test', ${paidAt})
        returning id`,
  );
  await tx.execute(sql`
    insert into ledger_entries (store_id, component, kind, status, amount_idr, available_at)
    values (${store.id}, 'payout-transition-fixture', 'adjustment', 'available', 1000000, now())`);
  await tx.execute(sql`
    insert into ledger_entries (store_id, payout_id, kind, status, amount_idr, note, available_at)
    values (${store.id}, ${payout.id}, 'payout', 'available', ${-amount}, 'Penarikan saldo', now())`);
  return { storeId: store.id, payoutId: payout.id, amount };
}

/** Everything a transition must not silently change: the row's own state and the store's book. */
async function snapshot(tx: PayoutDb, storeId: string, payoutId: string) {
  // `paid_at` as epoch milliseconds: a raw `execute` hands timestamps back as Postgres rendered
  // them (a string), so comparing the value itself would be comparing formatting, not the stamp.
  const [payout] = await rows<{ status: PayoutStatus; paidAt: string | number | null }>(
    tx,
    sql`select status, (extract(epoch from paid_at) * 1000)::bigint as "paidAt" from payouts where id = ${payoutId}`,
  );
  const [book] = await rows<{ entries: number; total: string | number }>(
    tx,
    sql`select count(*)::int as "entries", coalesce(sum(amount_idr), 0)::bigint as total
          from ledger_entries where store_id = ${storeId}`,
  );
  return {
    status: payout?.status ?? null,
    paidAt: payout?.paidAt == null ? null : Number(payout.paidAt),
    entries: Number(book.entries),
    total: Number(book.total),
  };
}

suite("markPayoutPaidInTxn — only diproses → selesai (real Postgres)", () => {
  it("completes a payout that is being processed", async () => {
    await inTxn(async (tx) => {
      const f = await fixture(tx, "diproses");
      const before = await snapshot(tx, f.storeId, f.payoutId);

      const r = await markPayoutPaidInTxn(tx, f.payoutId);

      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.storeId).toBe(f.storeId);
      expect(r.amount).toBe(f.amount);

      const after = await snapshot(tx, f.storeId, f.payoutId);
      expect(after.status).toBe("selesai");
      expect(after.paidAt).not.toBeNull();
      // Paying out settles an obligation the ledger already carries. Posting anything here would
      // debit the merchant twice for one withdrawal.
      expect(after.entries).toBe(before.entries);
      expect(after.total).toBe(before.total);
    });
  });

  it("REFUSES menunggu → selesai — THE DEFECT", async () => {
    await inTxn(async (tx) => {
      const f = await fixture(tx, "menunggu");
      const before = await snapshot(tx, f.storeId, f.payoutId);

      const r = await markPayoutPaidInTxn(tx, f.payoutId);

      expect(r.ok, "a payout nobody has started transferring cannot be lunas").toBe(false);
      if (r.ok) return;
      expect(r.conflict).toBe("belum_diproses");
      expect(r.from).toBe("menunggu");
      // The operator must be told what to do next, not merely that they cannot do this.
      expect(r.error).toMatch(/Proses/);

      const after = await snapshot(tx, f.storeId, f.payoutId);
      expect(after.status, "still waiting — Proses is still reachable").toBe("menunggu");
      expect(after.paidAt).toBeNull();
      expect(after.entries).toBe(before.entries);
      expect(after.total).toBe(before.total);
    });
  });

  it("refuses a rejected payout and leaves the returned money alone", async () => {
    await inTxn(async (tx) => {
      const f = await fixture(tx, "gagal");
      // A rejected payout carries the opposing `adjustment` entry that gave the money back.
      await tx.execute(sql`
        insert into ledger_entries (store_id, payout_id, kind, status, amount_idr, note, available_at)
        values (${f.storeId}, ${f.payoutId}, 'adjustment', 'available', ${f.amount}, 'Pembatalan penarikan: rekening salah', now())`);
      const before = await snapshot(tx, f.storeId, f.payoutId);

      const r = await markPayoutPaidInTxn(tx, f.payoutId);

      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.conflict).toBe("sudah_ditolak");
      expect(r.from).toBe("gagal");

      const after = await snapshot(tx, f.storeId, f.payoutId);
      expect(after.status).toBe("gagal");
      expect(after.paidAt).toBeNull();
      expect(after.entries).toBe(before.entries);
      expect(after.total, "the reversal stays exactly as it was").toBe(before.total);
    });
  });

  it("is idempotent AND non-mutating on a payout that is already lunas", async () => {
    await inTxn(async (tx) => {
      const f = await fixture(tx, "selesai");
      const before = await snapshot(tx, f.storeId, f.payoutId);
      expect(before.paidAt, "fixture must carry an older stamp for this to prove anything").not.toBeNull();

      const first = await markPayoutPaidInTxn(tx, f.payoutId);
      const second = await markPayoutPaidInTxn(tx, f.payoutId);

      for (const r of [first, second]) {
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.conflict).toBe("sudah_lunas");
        expect(r.from).toBe("selesai");
      }

      const after = await snapshot(tx, f.storeId, f.payoutId);
      expect(after.status).toBe("selesai");
      // The stamp is the evidence of WHEN the transfer happened. Re-clicking must not move it.
      expect(after.paidAt).toBe(before.paidAt);
      expect(after.entries).toBe(before.entries);
      expect(after.total).toBe(before.total);
    });
  });

  it("refuses an id that matches nothing instead of throwing", async () => {
    await inTxn(async (tx) => {
      const r = await markPayoutPaidInTxn(tx, "00000000-0000-4000-8000-000000000000");
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.conflict).toBe("tidak_ditemukan");
      expect(r.from).toBeNull();
    });
  });

  it("completes each payout exactly once across the four states", async () => {
    // The whole acceptance criterion in one table: every source status attempted, one success.
    const states: PayoutStatus[] = ["menunggu", "diproses", "selesai", "gagal"];
    const outcomes: Record<string, boolean> = {};
    for (const status of states) {
      await inTxn(async (tx) => {
        const f = await fixture(tx, status);
        const r = await markPayoutPaidInTxn(tx, f.payoutId);
        outcomes[status] = r.ok;
      });
    }
    expect(outcomes).toEqual({ menunggu: false, diproses: true, selesai: false, gagal: false });
  });

  it("lets exactly one of two concurrent completions win", async () => {
    // Two operators pressing "Tandai lunas" at the same instant. A read-then-check passes both
    // reads before either writes; the guard in the UPDATE's own WHERE cannot.
    const [account] = (await db.execute(
      sql`insert into accounts (name) values ('Payout Race Paid') returning id`,
    )) as unknown as { id: string }[];
    const slug = `payout-paid-race-${account.id.slice(0, 8)}`;
    const [store] = (await db.execute(sql`
      insert into stores (account_id, name, slug) values (${account.id}, 'Payout Race Paid', ${slug}) returning id
    `)) as unknown as { id: string }[];
    const [payout] = (await db.execute(sql`
      insert into payouts (store_id, amount_idr, status) values (${store.id}, 90000, 'diproses') returning id
    `)) as unknown as { id: string }[];
    try {
      const attempt = () =>
        db.transaction(async (tx) => markPayoutPaidInTxn(tx as unknown as PayoutDb, payout.id));
      const results = await Promise.all([attempt(), attempt()]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const refused = results.find((r) => !r.ok);
      expect(refused && !refused.ok && refused.conflict).toBe("sudah_lunas");
    } finally {
      await db.execute(sql`delete from payouts where store_id = ${store.id}`);
      await db.execute(sql`delete from stores where id = ${store.id}`);
      await db.execute(sql`delete from accounts where id = ${account.id}`);
    }
  });
});

/**
 * The action is the other half. `actions.ts` is `"use server"` and imports `@tokophi/db`,
 * `next/cache` and the session at module scope, so it cannot be imported here — the claim that the
 * gate and the transition are actually WIRED is a source claim, read as CODE (`test/source-code.ts`)
 * so a comment describing the old shape can never keep it green.
 *
 * Each claim carries a MUTATION SELF-CHECK: the same predicate is asserted to fire against a copy
 * with the old code put back, so the guard cannot be green for want of matching anything.
 */
const ACTIONS = codeOnly(readFileSync(new URL("./actions.ts", import.meta.url), "utf8"));

function actionSource(src: string, name: string): string {
  const opener = `export async function ${name}`;
  const start = src.indexOf(opener);
  expect(start, `${name} not found — this guard is pointed at the wrong file`).toBeGreaterThan(-1);
  const rest = src.slice(start + opener.length);
  const end = rest.indexOf("export async function");
  return end === -1 ? rest : rest.slice(0, end);
}

describe("markPayoutPaid delegates to the guarded transition", () => {
  const body = actionSource(ACTIONS, "markPayoutPaid");

  it("still gates the operator before touching money", () => {
    expect(body).toContain(codeOnly("platformGate()"));
  });

  it("calls the transition and writes no status of its own", () => {
    const delegates = (src: string) => src.includes(codeOnly("markPayoutPaidInTxn("));
    const setsStatusItself = (src: string) => /set\s*\(\s*\{\s*status\s*:\s*"selesai"/.test(src);

    expect(delegates(body)).toBe(true);
    expect(setsStatusItself(body), "the transition owns the write — a second writer is a second rule").toBe(false);

    // Mutation self-check: the shipped shape, before this task.
    const old = codeOnly(`
      const [p] = await tx.select().from(schema.payouts).where(eq(schema.payouts.id, payoutId)).for("update").limit(1);
      if (p.status === "selesai") return { ok: false as const, error: "Pencairan sudah lunas." };
      await tx.update(schema.payouts).set({ status: "selesai", paidAt }).where(eq(schema.payouts.id, payoutId));
    `);
    expect(delegates(old), "the predicate must fail on the old shape, or it proves nothing").toBe(false);
    expect(setsStatusItself(old)).toBe(true);
  });
});
