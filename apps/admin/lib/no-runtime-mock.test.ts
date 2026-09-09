import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SOURCE_SCAN_TIMEOUT_MS, codeOfFile, codeOnly, isTestFile } from "../../../test/source-code";

// NO PRODUCTION FILE IN THE SELLER PANEL IMPORTS A VALUE FROM `lib/mock/**`. (Task 6.7 / NF-20)
//
// `lib/mock/store.ts` was the panel's demo dataset: mulberry32-seeded products, orders, customers,
// a `TODAY` anchored to 2026-06-30. Every screen moved to Postgres and the file stayed — by
// 2026-09-09 all 51 importers were `import type`, so the runtime fixtures had no consumer, yet the
// module still sat on every production type path and `AGENTS.md` still called it "the single source
// of demo data". Its types now live in `lib/types/domain.ts`; the fixtures are deleted.
//
// The guard has two claims, and both are needed:
//   1. `apps/admin/lib/mock/` holds nothing git tracks — the fixture source stays gone.
//   2. No non-test file under `app/`, `components/`, `lib/actions/`, `lib/data/` imports a VALUE from
//      a `mock/` path. A type-only import is allowed, because a type costs nothing at runtime and is
//      exactly what the 51 importers were doing; a value import is how a seeded `TODAY` or a
//      `PRODUCTS[0].price` reaches a live screen again.
//
// ⚠️ READS CODE, NOT TEXT. `codeOnly` drops comments and inerts literal CONTENTS, so the four data
// files whose comments say "used to read `TODAY` from `lib/mock/store.ts`" stay legal, and a module
// specifier — which keeps its `@/.-` characters through `codeOnly` — is still matchable. The file
// list is derived from the DIRECTORY — walked, not `git ls-files`, because the deletion this guard
// pins is a working-tree fact before it is a commit — never spelled out: a guard bound to a list of
// targets is how the 24-bit mint survived its own test.

const ADMIN = fileURLToPath(new URL("../", import.meta.url));
const ROOTS = ["app", "components", "lib/actions", "lib/data"] as const;
const SOURCE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** Every source file under `dir`, recursively; dot-directories and `node_modules` are not code. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith(".") || e.name === "node_modules") return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : SOURCE.test(e.name) ? [p] : [];
  });
}

/** A module specifier with a `mock/` path segment: `@/lib/mock/store`, `../mock/store`, `./mock/x`. */
const MOCK_SPECIFIER = /"[^"]*\bmock\/[^"]*"/;

/**
 * Every statement of `code` (the `codeOnly` form) that brings a VALUE in from a `mock/` path.
 * Pure, so the mutation proofs below can drive it with strings.
 */
export function runtimeMockImports(code: string): string[] {
  return code
    .split(" ; ")
    .map((s) => s.trim())
    .filter((s) => MOCK_SPECIFIER.test(s))
    .filter((s) => IMPORT_FORM.test(s) && !isTypeOnlyImport(s));
}

/**
 * A statement that can bind a module: static `import`/`export … from`, a dynamic `import(…)`, a
 * `require(…)`. A `const s = "…mock/store…"` is a string that happens to spell the path — its
 * contents were inerted by `codeOnly`, but the `@/.-` characters a specifier is made of survive, so
 * the FORM of the statement is what tells a literal from a binding.
 */
const IMPORT_FORM = /^(?:import|export)\s|\bimport\s*\(|\brequire\s*\(/;

function isTypeOnlyImport(statement: string): boolean {
  if (/^import\s+type\s/.test(statement)) return true;
  // `import { type A , type B } from "…"` — braces only (no default, no `* as`), every name typed.
  const m = /^import\s*\{([^}]*)\}\s*from\s/.exec(statement);
  if (!m) return false;
  return m[1]
    .split(",")
    .map((spec) => spec.trim())
    .filter(Boolean)
    .every((spec) => /^type\s/.test(spec));
}

describe("no runtime import from lib/mock/** in the Seller panel (Task 6.7)", () => {
  it("the fixture source is gone: apps/admin/lib/mock/ holds no source file", () => {
    const dir = join(ADMIN, "lib/mock");
    expect(existsSync(dir) ? walk(dir) : []).toEqual([]);
  });

  it(
    "no non-test file under app/, components/, lib/actions/, lib/data/ imports a value from a mock/ path",
    () => {
      const offenders = ROOTS.flatMap((r) => {
        const files = walk(join(ADMIN, r)).filter((f) => !isTestFile(f));
        // Not vacuous: every root must contribute, or a renamed directory would pass by scanning nothing.
        expect(files.length, r).toBeGreaterThan(0);
        return files.flatMap((f) =>
          runtimeMockImports(codeOfFile(f)).map((stmt) => `${relative(ADMIN, f)}: ${stmt}`),
        );
      });
      expect(offenders).toEqual([]);
    },
    SOURCE_SCAN_TIMEOUT_MS,
  );
});

// ── MUTATION PROOFS ────────────────────────────────────────────────────────────────────────────
// A guard converted on faith can be green for want of matching anything. Each shape below is the
// statement as a real file would carry it, run through the SAME `codeOnly` the sweep uses.
describe("the predicate fires on every value-import shape and on no type-only one", () => {
  const RED = [
    `import { PRODUCTS } from "@/lib/mock/store";`,
    `import { type Product, TODAY } from "@/lib/mock/store";`,
    `import store, { type Product } from "@/lib/mock/store";`,
    `import * as mock from "@/lib/mock/store";`,
    `import { DAYS } from "../mock/store";`,
    `export { ORDERS } from "@/lib/mock/store";`,
    `const m = await import("@/lib/mock/store");`,
  ];
  const GREEN = [
    `import type { Product, Order } from "@/lib/mock/store";`,
    `import { type Product, type Order } from "@/lib/mock/store";`,
    `import type { Product } from "@/lib/types/domain";`,
    `import { PRODUCTS } from "@/lib/data/products";`,
    `// import { PRODUCTS } from "@/lib/mock/store";`,
    `const s = \`import { PRODUCTS } from "@/lib/mock/store"\`;`,
  ];
  const wrap = (stmt: string) => `import { x } from "@/lib/x";\n${stmt}\nexport const y = x;\n`;

  it.each(RED)("RED: %s", (stmt) => {
    expect(runtimeMockImports(codeOnly(wrap(stmt)))).toHaveLength(1);
  });
  it.each(GREEN)("GREEN: %s", (stmt) => {
    expect(runtimeMockImports(codeOnly(wrap(stmt)))).toEqual([]);
  });
});
