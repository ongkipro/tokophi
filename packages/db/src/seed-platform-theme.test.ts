import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codeOnly } from "../../../test/source-code";

// 🔴 WHAT THIS FILE USED TO GUARD, AND WHY THAT CLAIM IS GONE.
//
// The seed used to COPY the demo store's `is_default` rows into the platform holder, resolving the
// source across two slugs. This suite pinned the LOOKUP ORDER — `for (const s of SOURCE_SLUGS)` with
// a per-slug `eq()` and a `break`, never an unordered `inArray(...).limit(1)` — because in the one
// state where both slugs exist, an unordered IN could copy a MERCHANT's templates into the holder,
// which the storefront then serves as every store's default (audit D1, 2026-08-12).
//
// That whole defect class was REMOVED on 2026-08-23, not re-guarded. The default is now AUTHORED in
// `platform-theme-default.ts`; the seed reads no store's templates at all, so "which store did we
// copy from" has no answer to get wrong. Pinning the loop would now pin code that does not exist.
//
// The reason it had to go is stronger than the ordering bug it was written for: copying WORKED, and
// it was the copy itself that was wrong. Measured on production with the fallback switched on,
// ELEVEN live stores were publishing the batik store's homepage as their own — `she-store`, which
// has zero products, rendered "Batik Modern untuk Hari-Harimu" over a button reading "Lihat Koleksi
// Dress" pointing at a collection it does not have. The right source picked correctly is still one
// shop's marketing on everybody else's shop.
//
// So this suite now asserts the property that makes the old one unnecessary: **the seed does not
// read another store's content, by any query shape.** `platform-theme-default.test.ts` guards what
// the authored default may CONTAIN; this guards where it may come FROM.
//
// A source claim (`codeOnly`), not an import: the module runs `main()` at top level against the real
// DATABASE_URL, so importing it IS running the seed.

const src = readFileSync(new URL("./seed-platform-theme.ts", import.meta.url), "utf8");
const code = codeOnly(src);

describe("seed-platform-theme takes its content from the authored default, never from a store", () => {
  it("inserts what `platform-theme-default.ts` declares", () => {
    expect(code).toMatch(/import\s*\{\s*PLATFORM_DEFAULT_TEMPLATES\s*\}\s*from\s*"\.\/platform-theme-default"/);
    expect(code).toMatch(/PLATFORM_DEFAULT_TEMPLATES\s*\[\s*type\s*\]/);
  });

  it("names no source store, by slug or by lookup", () => {
    // Every token the copy mechanism needed. One of them coming back means the copy came back.
    expect(code).not.toMatch(/SOURCE_SLUGS/);
    expect(code).not.toMatch(/inArray/);
    expect(code).not.toMatch(/batik/i);
  });

  it("never SELECTS another store's page_templates", () => {
    // The holder's OWN rows are still read — that is the insert-if-absent check, and it filters on
    // `holder.id`. What must never return is a read of `page_templates` scoped to anything else.
    const reads = code.match(/from\s*\(\s*schema\s*\.\s*pageTemplates\s*\)/g) ?? [];
    expect(reads.length, "expected exactly one pageTemplates read (the holder's own)").toBe(1);
    expect(code).toMatch(/eq\s*\(\s*schema\s*\.\s*pageTemplates\s*\.\s*storeId\s*,\s*holder\s*\.\s*id\s*\)/);
  });

  it("fires on the old copy shape (mutation self-check)", () => {
    // Put the copy back on a COPY of the source and assert this guard would go red — a guard written
    // against code that no longer exists can be green for want of matching anything
    // (test/source-code.ts).
    const reverted = codeOnly(
      src.replace(
        'import { PLATFORM_DEFAULT_TEMPLATES } from "./platform-theme-default";',
        'const SOURCE_SLUGS = ["batik-nusantara", "batiknusantara"];',
      ),
    );
    expect(reverted).toMatch(/SOURCE_SLUGS/);
    expect(reverted).not.toMatch(
      /import\s*\{\s*PLATFORM_DEFAULT_TEMPLATES\s*\}\s*from\s*"\.\/platform-theme-default"/,
    );
  });
});
