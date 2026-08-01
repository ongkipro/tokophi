import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The default-location expression must exist ONCE — `lib/inventory-location.ts`.
//
// It had five hand-written copies and only one carried `locations.store_id`. Adding the filter to the
// other four would have fixed those four and left the class intact: `inventory_levels` has no
// `store_id`, so RLS cannot scope it (AGENTS.md, THE CHILD-TABLE RULE), which means every new copy is
// a fresh chance to write a stock change that lands on another store's shelf — silently, because the
// join still returns a row and `is_default desc` still orders it.
//
// A unit test cannot catch that: a sixth copy type-checks, lints, and passes everything else. What
// distinguishes it is that the expression appears somewhere it should not, so that is what is checked.
// Same shape of guard as `@tokophi/lib/like` and `lib/uuid.ts`, both of which cost sibling call sites
// the week this was written.

const ADMIN = fileURLToPath(new URL("..", import.meta.url));
const HELPER = "lib/inventory-location.ts";

// Both halves of the expression: the Drizzle form and the raw-SQL form it used to take in
// `order-status.ts`. A future copy will be written in one of the two.
const COPIES = [/schema\.locations\.isDefault/, /is_default\s+desc/i];

function sourceFiles(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next" || e.name === "public") continue;
      out.push(...sourceFiles(dir, path));
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      out.push(path);
    }
  }
  return out;
}

describe("the default-location expression lives in exactly one place", () => {
  it("no file outside the helper resolves an inventory row by `is_default`", () => {
    const offenders = sourceFiles(ADMIN)
      .filter((f) => f !== HELPER && !f.endsWith("inventory-location.test.ts"))
      .filter((f) => {
        const src = readFileSync(join(ADMIN, f), "utf8");
        return COPIES.some((re) => re.test(src));
      });
    // `provision.ts` CREATES the default location (`isDefault: true`) rather than resolving one, and
    // `theme.ts` uses `page_templates.is_default`, a different column entirely — neither reaches
    // `inventory_levels`, so neither is a copy. If this list ever needs a third entry, check that the
    // new file is really seeding rather than resolving before adding it.
    expect(offenders.filter((f) => f !== "lib/provision.ts" && f !== "lib/actions/theme.ts")).toEqual([]);
  });

  it("the helper still filters on the store — the boundary, not the ordering", () => {
    const src = readFileSync(join(ADMIN, HELPER), "utf8");
    // One per exported function. Losing either turns a tenant boundary back into a row picker.
    expect(src.match(/schema\.locations\.storeId/g) ?? []).toHaveLength(2);
  });
});
