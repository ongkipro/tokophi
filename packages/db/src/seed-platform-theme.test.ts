import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codeOnly } from "../../../test/source-code";

// The platform-theme seed's copy source is resolved ONE SLUG AT A TIME, in SOURCE_SLUGS order.
//
// It used to be `inArray(slug, SOURCE_SLUGS).limit(1)` — no ORDER BY, so which row an IN returns is
// plan-dependent. In the one state where BOTH slugs exist (the rename script refused because a
// FOREIGN store already holds `batiknusantara`, so the demo is still `batik-nusantara`), the wrong
// pick copies a MERCHANT's templates into the platform holder, which the storefront then serves as
// every store's default. Unreachable on prod today (the holder already has all three types), which
// is exactly why nothing but this test would ever notice the query shape sliding back.
// Audit: specs/docs/tasks/2026-08-12-postship-audit.md, D1.
//
// A source claim (`codeOnly`), not an import: the module runs `main()` at top level against the
// real DATABASE_URL, so importing it IS running the seed.

const src = readFileSync(new URL("./seed-platform-theme.ts", import.meta.url), "utf8");
const code = codeOnly(src);

// The three tokens that make the fix a fix: a loop over the declared order, a per-slug eq(), and
// stopping at the first hit. Whitespace-tolerant — codeOnly joins tokens with single spaces.
const SEQUENTIAL = [
  /for\s*\(\s*const\s+\w+\s+of\s+SOURCE_SLUGS\s*\)/,
  /eq\s*\(\s*schema\s*\.\s*stores\s*\.\s*slug\s*,/,
  /if\s*\(\s*source\s*\)\s*break/,
] as const;

describe("seed-platform-theme copy-source lookup", () => {
  it("tries each SOURCE_SLUGS entry sequentially, first hit wins — never an unordered IN", () => {
    for (const shape of SEQUENTIAL) expect(code).toMatch(shape);
    // The shape that was the bug. The import went with it, so one token covers both.
    expect(code).not.toMatch(/inArray/);
  });

  it("keeps the declared preference order — the OLD slug is the demo store in the only state where order matters", () => {
    // codeOnly keeps [A-Za-z0-9_.@/-] inside literals, so both slugs survive verbatim.
    expect(code).toMatch(/SOURCE_SLUGS\s*=\s*\[\s*"batik-nusantara"\s*,\s*"batiknusantara"\s*\]/);
  });

  it("fires on the old query shape (mutation self-check)", () => {
    // Put the shipped bug back on a COPY and assert this guard would go red — a guard converted on
    // faith can be green for want of matching anything (test/source-code.ts).
    const reverted = codeOnly(
      src
        .replace(/let source[\s\S]*?if \(source\) break;\s*\n\s*\}/, // the sequential block
          "const [source] = await db.select({ id: schema.stores.id, slug: schema.stores.slug })" +
            ".from(schema.stores).where(inArray(schema.stores.slug, SOURCE_SLUGS)).limit(1);")
        .replace('import { and, eq } from "drizzle-orm";', 'import { and, eq, inArray } from "drizzle-orm";'),
    );
    expect(reverted).toMatch(/inArray/);
    expect(reverted).not.toMatch(/if\s*\(\s*source\s*\)\s*break/);
  });
});
