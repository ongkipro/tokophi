import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// 🔴 DRIZZLE RENDERS AN INTERPOLATED COLUMN **UNQUALIFIED** INSIDE A `sql` TEMPLATE.
//
// `sql\`… where p.order_id = ${schema.orders.id}\`` emits `p.order_id = "id"` — not
// `"orders"."id"`. Measured with `.toSQL()`. In a plain WHERE that is harmless: the only table in
// scope is the outer one. Inside a **correlated subquery** it is not, because the INNER scope wins
// — and the inner table usually has a column of that name:
//
//   exists (select 1 from payments p where p.order_id = "id")   →  p.order_id = p.id   → never true
//   (select m.url from product_media m where m.product_id = "id") → m.product_id = m.id → never true
//
// It fails SILENTLY, in whichever direction the collision happens to point. Measured on real
// Postgres, three shipped consequences: `createShipment` refused a genuinely paid order
// ("Pembayaran belum berhasil"), every line item on the order detail rendered with NO image, and
// the order's service name came from `pc.courier = pc.courier` — the first courier row, not this
// order's. Seven sites across two files, all written the same plausible way.
//
// The rule pinned here is deliberately blunt and derived, not a list of the seven: **a `sql`
// template that carries its own FROM must not interpolate a schema column.** Qualify it by name
// (`"orders"."id"`) instead. Nothing legitimate in this repo needs the other shape — a template
// with no FROM of its own (`now() >= ${schema.flashSales.startsAt}`) is unaffected and stays legal.

const ROOT = join(import.meta.dirname, "../../..");
const SCAN = ["apps", "packages"];
const SKIP = new Set(["node_modules", ".next", "dist", ".astro", "drizzle"]);

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every `sql` template in a file, as raw text (these never nest a backtick — see below). */
function sqlTemplates(src: string): string[] {
  const out: string[] = [];
  const open = /\bsql(?:<[^>]*>)?`/g;
  for (let m = open.exec(src); m; m = open.exec(src)) {
    const end = src.indexOf("`", m.index + m[0].length);
    if (end === -1) continue;
    out.push(src.slice(m.index + m[0].length, end));
    open.lastIndex = end + 1;
  }
  return out;
}

// A template that opens its own FROM is correlated-subquery territory. `${schema.someTable}` (a
// TABLE, not a column) is how drizzle interpolates a table name and is fine — only a dotted column
// reference is the trap.
const hasOwnFrom = (t: string) => /\bfrom\s+/i.test(t);
const interpolatesColumn = (t: string) => /\$\{\s*schema\s*\.\s*\w+\s*\.\s*\w+\s*\}/.test(t);

describe("a sql template with its own FROM never interpolates a schema column", () => {
  const offenders = sources(join(ROOT, SCAN[0]))
    .concat(sources(join(ROOT, SCAN[1])))
    .flatMap((file) =>
      sqlTemplates(readFileSync(file, "utf8"))
        .filter((t) => hasOwnFrom(t) && interpolatesColumn(t))
        .map((t) => `${file.slice(ROOT.length + 1)}: ${t.replace(/\s+/g, " ").trim().slice(0, 90)}`),
    );

  it("no source file carries the shape", () => {
    expect(offenders, `${offenders.length} correlated subquery/subqueries interpolate an outer column`).toEqual([]);
  });

  // Proves the predicate fires — a guard nobody has seen red is green for reasons nobody checked.
  it("goes red on the shipped shape", () => {
    const shipped = "exists (select 1 from payments p where p.order_id = ${schema.orders.id})";
    expect(hasOwnFrom(shipped) && interpolatesColumn(shipped)).toBe(true);
  });

  // ...and does NOT fire on the legitimate shape, so it cannot be "fixed" by deleting real code.
  it("stays green on a template with no FROM of its own", () => {
    const fine = "now() >= ${schema.flashSales.startsAt}";
    expect(hasOwnFrom(fine) && interpolatesColumn(fine)).toBe(false);
  });
});
