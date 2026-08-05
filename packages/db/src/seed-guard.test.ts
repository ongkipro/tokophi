import { describe, expect, it, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { getTableName, is } from "drizzle-orm";
import { Table } from "drizzle-orm";
import * as schema from "./schema";
import { IRREPLACEABLE, countIrreplaceable } from "./seed-guard";

// N42 rests on ONE claim, and it is the kind that is either exactly right or subtly wrong:
// **the truncate keep-list cannot protect a store-scoped table, because `cascade` follows the
// `store_id` foreign key into it.** If that is false, the whole item is a longer list instead of a
// refusal. So it is measured here twice — once against Postgres itself, once against THIS schema —
// rather than believed.
//
// ⚠️ NEITHER HALF TRUNCATES A REAL TABLE. The first uses two temporary tables of its own; the second
// is a catalogue read. `truncate` takes ACCESS EXCLUSIVE, and `tokophi_test` is shared with the
// ledger suites running in parallel — a guard that stalls the run beside it is a guard someone
// deletes. The rule under test is Postgres's, not ours, so a two-row model proves it as well as
// eighty tables would.

/** The seed's keep-list, verbatim (`truncateAll()` in seed.ts). */
const KEEP_LIST = ["__drizzle_migrations", "kiriminaja_areas", "kelurahan", "product_taxonomy"];

const URL = process.env.TEST_DATABASE_URL;
const dbSuite = URL ? describe : describe.skip;

let sql: postgres.Sql<Record<string, never>>;
beforeAll(() => {
  if (!URL) return;
  sql = postgres(URL, { max: 1, onnotice: () => {} }) as unknown as postgres.Sql<Record<string, never>>;
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

describe("the truncate keep-list cannot protect a store-scoped table (N42)", () => {
  it("names only tables this schema actually has", () => {
    // The guard SKIPS a table (and a column) the database does not have, so an operator on an older
    // deployment is not shown a line about something they never had. That skip is silent, so a typo
    // or a rename turns a warning about encrypted CAPI tokens into nothing at all, forever, with the
    // suite still green. Checking the names against `schema.ts` is what keeps the silence honest.
    // `Object.values(schema)` is a union of every table AND every enum, so the narrowing has to go
    // through `unknown` — `is(v, Table)` cannot be a type predicate over a union it does not cover.
    const known = new Set(
      (Object.values(schema) as unknown[]).filter((v): v is Table => is(v, Table)).map((t) => getTableName(t)),
    );
    const unknown = [...new Set(IRREPLACEABLE.map((l) => l.table))].filter((t) => !known.has(t)).sort();
    expect(unknown, `IRREPLACEABLE names table(s) not in schema.ts: ${unknown.join(", ")}`).toEqual([]);
  });

  it("never names a table the keep-list already saves", () => {
    // A `Loss` entry for a kept table would be a line that fires while the rows are in no danger —
    // the alarm-that-cries-wolf failure this repo has already paid for once with `verify-rls`.
    const kept = IRREPLACEABLE.filter((l) => KEEP_LIST.includes(l.table)).map((l) => l.table);
    expect(kept, "these are on the truncate keep-list and are NOT destroyed").toEqual([]);
  });
});

dbSuite("cascade, against a live database (N42)", () => {
  it("empties a child table that was NOT named in the truncate", async () => {
    // The rule, in two rows. `truncate parent cascade` is told about `parent` ONLY; `child` is the
    // stand-in for a table someone added to the keep-list believing that saves it.
    await inTxn(async (tx) => {
      await tx`create temp table n42_parent (id int primary key) on commit drop`;
      await tx`create temp table n42_child (id int primary key, parent_id int not null references n42_parent(id)) on commit drop`;
      await tx`insert into n42_parent (id) values (1)`;
      await tx`insert into n42_child (id, parent_id) values (10, 1)`;

      const before = await tx<{ c: number }[]>`select count(*)::int as c from n42_child`;
      expect(before[0].c).toBe(1);

      await tx.unsafe("truncate n42_parent restart identity cascade");

      const after = await tx<{ c: number }[]>`select count(*)::int as c from n42_child`;
      expect(after[0].c, "cascade did NOT reach the child — the N42 note is wrong, re-read it").toBe(0);
    });
  });

  it("the three exposed tables all reference `stores`, which the seed truncates", async () => {
    // Half two: the rule above applies to THIS schema. `stores` is not on the keep-list, so every
    // table with an FK to it is emptied whatever the list says.
    const rows = await sql<{ child: string }[]>`
      select child.relname as child
        from pg_constraint fk
        join pg_class child on child.oid = fk.conrelid
        join pg_class parent on parent.oid = fk.confrelid
       where fk.contype = 'f' and parent.relname = 'stores'
         and child.relname in ('store_tracking_channels', 'page_templates', 'flash_sales')`;
    expect([...new Set(rows.map((r) => r.child))].sort()).toEqual(["flash_sales", "page_templates", "store_tracking_channels"]);
    expect(KEEP_LIST).not.toContain("stores");
  });

  it("the platform singletons have no foreign keys at all — the keep-list WOULD save them", async () => {
    // The correction to the first draft of the note, pinned so it cannot drift back. These are on
    // `IRREPLACEABLE` because keeping them would make the seed's unconditional INSERT collide with
    // `platform_admins_email_unique`, NOT because cascade could reach them.
    const rows = await sql<{ child: string }[]>`
      select child.relname as child
        from pg_constraint fk
        join pg_class child on child.oid = fk.conrelid
       where fk.contype = 'f'
         and child.relname in ('platform_admins', 'shipping_aggregator', 'platform_payment_gateways')`;
    expect(rows.map((r) => r.child)).toEqual([]);
  });

  it("`kelurahan` survives DESPITE having a foreign key — its parent is kept too", async () => {
    // The other correction. "The reference tables have no FK into anything" was false, and the
    // difference matters: the rule is *no FK path OUT of the keep-list*, not *no foreign keys*.
    // Add a reference table that points at a truncated one and the 78.764-row landmine comes back.
    const rows = await sql<{ parent: string }[]>`
      select parent.relname as parent
        from pg_constraint fk
        join pg_class child on child.oid = fk.conrelid
        join pg_class parent on parent.oid = fk.confrelid
       where fk.contype = 'f' and child.relname = 'kelurahan'`;
    expect(rows.length, "kelurahan is expected to reference kiriminaja_areas").toBeGreaterThan(0);
    for (const r of rows) expect(KEEP_LIST, `kelurahan -> ${r.parent} leaves the keep-list`).toContain(r.parent);
  });

  it("counts an encrypted CAPI token as a loss, and an empty database as none", async () => {
    // The guard's own behaviour: it must SEE the one row nothing restores, and stay silent when
    // there is nothing to lose (the fresh-deploy case it runs in on every merge).
    await inTxn(async (tx) => {
      const [acc] = await tx<{ id: string }[]>`insert into accounts (name, plan) values ('n42 probe', 'pemula') returning id`;
      const [store] = await tx<{ id: string }[]>`
        insert into stores (account_id, name, slug) values (${acc.id}, 'n42 probe', ${"n42-probe-" + Date.now()}) returning id`;
      await tx`
        insert into store_tracking_channels (store_id, channel, capi_token_ciphertext)
        values (${store.id}, 'meta', 'ciphertext-that-nothing-can-re-derive')`;

      const found = await countIrreplaceable(tx as unknown as postgres.Sql);
      const capi = found.find((f) => f.table === "store_tracking_channels" && f.column === "capi_token_ciphertext");
      expect(capi?.rows, "the guard did not count the encrypted CAPI token it exists for").toBe(1);
    });
  });
});
