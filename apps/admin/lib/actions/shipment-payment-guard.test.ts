import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";

// 🔴 TWO UNALIASED `exists (…)` EXPRESSIONS IN ONE SELECT ARE ONE COLUMN.
//
// Postgres names an unaliased `exists (…)` **`exists`**, so a target list holding two of them comes
// back with a single `exists` column and the second value is gone. `createShipment` had exactly that
// shape, twice: `isCod` (first — read correctly) and `hasSuccessfulPayment` (second — lost). Two
// guards key off the lost one, so a genuinely PAID prepaid order was refused a waybill with
// "Pembayaran belum berhasil. Pengiriman tidak jadi direservasi." Found 2026-08-20 while building
// the N40 v6.2 verification booking, which could not get past it.
//
// ⚠️ WHY THIS IS A SOURCE GUARD AND NOT AN END-TO-END TEST — and the first attempt at one was GREEN
// FOR THE WRONG REASON, which is the whole reason this note exists. The refusing guard sits AFTER a
// live KiriminAja rate call and an exact re-price, so reaching it needs a seller pickup address, a
// destination district, line items with weight, and a rate that still matches to the rupiah. A
// fixture short of that is rejected earlier, the error text never matches, and the assertion passes
// while proving nothing: with both aliases deleted, that first draft stayed green. The runtime
// reproduction WAS done, by hand, once, and is recorded in BUILD-LOG — the durable claim is this
// one, and it is proved red below.
//
// Read as TEXT, not code (`test/source-code.ts` rule): the evidence lives INSIDE a SQL template
// literal, and `codeOnly` inerts string contents — it would erase the very thing being checked.

const SRC = readFileSync(new URL("./shipping.ts", import.meta.url), "utf8");

/**
 * Every `sql<…>` template whose body is an `exists (…)`, paired with what follows its closing
 * backtick. These templates contain no nested backticks, so the next one always closes it.
 */
function existsFields(src: string): { after: string }[] {
  const out: { after: string }[] = [];
  const opener = /sql<[^>]*>`\s*exists\s*\(/g;
  for (let m = opener.exec(src); m; m = opener.exec(src)) {
    const close = src.indexOf("`", m.index + m[0].length);
    if (close === -1) continue;
    out.push({ after: src.slice(close + 1, close + 40) });
  }
  return out;
}

describe("no two SQL expressions in one select can share a column name", () => {
  it("Postgres really does collapse two unaliased exists() into one column", async () => {
    // The premise, measured rather than asserted from memory. Needs no fixture and no app code.
    const URL_ = process.env.TEST_DATABASE_URL;
    if (!URL_) return; // no database on this machine — the source claim below still runs
    let client: Sql | undefined;
    try {
      client = postgres(URL_, { max: 1 });
      const rows = await client`
        select exists (select 1 from (values (1)) v(x) where false),
               exists (select 1 from (values (1)) v(x) where true)`;
      expect(Object.keys(rows[0])).toEqual(["exists"]);
    } finally {
      await client?.end();
    }
  });

  it("every exists() field in shipping.ts is aliased", () => {
    const fields = existsFields(SRC);
    expect(fields.length, "the guarded expressions have moved or been renamed").toBeGreaterThanOrEqual(4);
    const unaliased = fields.filter((f) => !f.after.trimStart().startsWith(".as("));
    expect(unaliased, `${unaliased.length} exists() field(s) without .as()`).toEqual([]);
  });

  // Proves the predicate can fire — the shipped shape put back.
  it("goes red on an exists() field with no alias", () => {
    const reverted = SRC.replace('`.as("has_successful_payment")', "`");
    expect(existsFields(reverted).some((f) => !f.after.trimStart().startsWith(".as("))).toBe(true);
  });
});
