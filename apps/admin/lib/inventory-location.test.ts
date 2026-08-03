import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codeOnly, textWithoutComments } from "../../../test/source-code";

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
//
// ── THE TWO HALVES READ THE SOURCE DIFFERENTLY, AND THE SPLIT IS THE POINT ────────────────────────
// This file used to match RAW TEXT, and it was wrong in BOTH directions at once. Measured:
//   · Commenting `.where(eq(schema.locations.storeId, storeId))` out of the helper — deleting the
//     tenant boundary, i.e. the whole bug this file guards — left both tests GREEN, because
//     `toHaveLength(2)` counts characters and a commented-out line still has them.
//   · An explanatory COMMENT in `actions/inventory.ts` naming the expression turned it RED over a
//     file containing no copy at all. An alarm that cries wolf is the alarm somebody switches off;
//     `verify-rls` sat red here for weeks and two cross-tenant leaks shipped past it.
// So, per assertion (`test/source-code.ts`):
//   · The SWEEP uses `textWithoutComments`. Not `codeOnly` — and this is the interesting one. Half of
//     what it hunts is a RAW SQL copy (`order-status.ts` held `is_default desc` inside a `sql` tag),
//     and SQL inside a template literal is executed by Postgres exactly the way markup in a JS string
//     is emitted to a browser. `codeOnly` would inert that literal to `is_default·desc`, so the
//     pattern could never match a real copy again — a permanently green guard, which is worse than
//     the noisy one it replaced. Comments still go, which is the half that was broken.
//   · The HELPER assertions use `codeOnly`. `schema.locations.storeId` is the tenant boundary and the
//     claim is that it EXECUTES; a mention of it in this module's own long comment must not count.
const ADMIN = fileURLToPath(new URL("..", import.meta.url));
const HELPER = "lib/inventory-location.ts";

// Both halves of the expression: the Drizzle form and the raw-SQL form it used to take in
// `order-status.ts`. A future copy will be written in one of the two.
const COPIES = [/schema\s*\.\s*locations\s*\.\s*isDefault/, /is_default\s+desc/i];

/**
 * Every `.ts`/`.tsx` under `apps/admin`.
 *
 * ⚠️ `public` IS SKIPPED ONLY AT THE APP ROOT, and the version that skipped it at ANY depth is the
 * fourth blind guard this repo has found. `apps/admin/public` is images; `apps/admin/app/api/public`
 * is the PUBLIC API — four route files, invisible to this sweep for its whole life. Among them
 * `order/route.ts`, which is precisely where this class did its worst damage: it held the SIXTH copy
 * of the expression, the one copy with no `store_id` predicate at all, on the one path that runs on
 * the OWNER connection with RLS off. Measured: re-adding that copy there kept the old sweep green.
 * A guard bound to a NAME has the same hole as a guard bound to a LIST.
 */
function sourceFiles(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      if (e.name === "public" && rel === "") continue; // apps/admin/public — assets, not code
      out.push(...sourceFiles(dir, path));
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      out.push(path);
    }
  }
  return out;
}

describe("the default-location expression lives in exactly one place", () => {
  it("scans the public API routes too — the sweep must not silently skip a directory", () => {
    // The blind spot above, pinned so it cannot come back with the next "tidy the skip list".
    expect(sourceFiles(ADMIN)).toContain("app/api/public/order/route.ts");
  });

  it("no file outside the helper resolves an inventory row by `is_default`", () => {
    const offenders = sourceFiles(ADMIN)
      .filter((f) => f !== HELPER && !f.endsWith("inventory-location.test.ts"))
      .filter((f) => {
        const src = textWithoutComments(readFileSync(join(ADMIN, f), "utf8"));
        return COPIES.some((re) => re.test(src));
      });
    // `provision.ts` CREATES the default location (`isDefault: true`) rather than resolving one, and
    // `theme.ts` uses `page_templates.is_default`, a different column entirely — neither reaches
    // `inventory_levels`, so neither is a copy. If this list ever needs a third entry, check that the
    // new file is really seeding rather than resolving before adding it.
    expect(offenders.filter((f) => f !== "lib/provision.ts" && f !== "lib/actions/theme.ts")).toEqual([]);
  });

  it("the helper still filters on the store — the boundary, not the ordering", () => {
    const src = codeOnly(readFileSync(join(ADMIN, HELPER), "utf8"));
    // One per exported function. Losing either turns a tenant boundary back into a row picker — and
    // that loss is exactly what a text match cannot see, because the commented-out line reads the same.
    expect(src.match(/schema\s*\.\s*locations\s*\.\s*storeId/g) ?? []).toHaveLength(2);
  });
});
