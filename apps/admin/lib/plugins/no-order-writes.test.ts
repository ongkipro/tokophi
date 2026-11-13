import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { codeOnly, textWithoutComments } from "../../../../test/source-code";

// ADR 0019 §2.7 — a plugin NEVER writes an order. `applyOrderStatusChange` is the one writer of
// `orders.status`, with ledger and COD logic behind it; a plugin is a mirror, not a second writer.
//
// Two helpers, chosen PER ASSERTION (AGENTS.md "choose per assertion, not per file"):
//   - raw SQL lives inside `sql` template literals and Postgres EXECUTES it, so the SQL claim reads
//     `textWithoutComments` — `codeOnly` would inert the very statement being hunted;
//   - the drizzle / function-call claim reads `codeOnly`, so a comment naming them is not a call.
const DIR = __dirname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

// `\borders\b` does not match inside `plugin_kelola_orders` — `_` is a word character.
const SQL_ORDER_WRITE = /\b(update\s+"?orders"?\b|insert\s+into\s+"?orders"?\b|delete\s+from\s+"?orders"?\b)/i;
const CODE_ORDER_WRITE = /\.\s*(update|insert|delete)\s*\(\s*schema\s*\.\s*orders\s*\)|applyOrderStatusChange\s*\(|setOrderStatus\s*\(/;

describe("lib/plugins/** never writes an order", () => {
  const files = sources(DIR);

  it("scans the plugin tree (a guard that scans nothing is green forever)", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
    expect(files.some((f) => f.endsWith(join("kelola", "sync.ts")))).toBe(true);
  });

  it.each(files.map((f) => [f.slice(DIR.length + 1), f]))("%s: no SQL write to orders", (_rel, file) => {
    expect(textWithoutComments(readFileSync(file, "utf8"))).not.toMatch(SQL_ORDER_WRITE);
  });

  it.each(files.map((f) => [f.slice(DIR.length + 1), f]))("%s: no drizzle write or status change on orders", (_rel, file) => {
    expect(codeOnly(readFileSync(file, "utf8"))).not.toMatch(CODE_ORDER_WRITE);
  });

  it("the predicates fire on the shapes they refuse — and not on the plugin's own table", () => {
    expect(textWithoutComments("await db.execute(sql`update orders set status = 'batal' where id = ${x}`);")).toMatch(SQL_ORDER_WRITE);
    expect(textWithoutComments("await db.execute(sql`update plugin_kelola_orders set synced_at = now()`);")).not.toMatch(SQL_ORDER_WRITE);
    expect(codeOnly("await tx.update(schema.orders).set({ status: 'batal' });")).toMatch(CODE_ORDER_WRITE);
    expect(codeOnly("await applyOrderStatusChange(tx, { storeId, order, next: 'batal' });")).toMatch(CODE_ORDER_WRITE);
    expect(codeOnly("// applyOrderStatusChange( is the one writer")).not.toMatch(CODE_ORDER_WRITE);
  });
});
