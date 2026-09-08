import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { codeOnly } from "../../../test/source-code";

/**
 * `isUuid` BEFORE `eq(table.id, param)` — page-map findings SA-3 + AD-1.
 *
 * Postgres throws `22P02` on a non-UUID string bound to a `uuid` column, so an id-keyed page that
 * hands the raw segment to its data read renders a 500 where a 404 belongs. The rule is one shared
 * function (`@tokophi/lib/uuid`); this suite pins that each id-keyed page CALLS it, above its first
 * data read, on the segment it was given. Same shape as `route-roles.test.ts` "gates … above its
 * first data read": source is read as CODE (`codeOnly`), so a commented-out guard cannot keep this
 * green.
 *
 * The list is explicit rather than derived from the directory because not every `[id]` route is
 * keyed on a UUID: `/pesanan/[id]` takes the order NUMBER and `/produk/[id]` the catalog number.
 * Both `[id]` pages listed under "guarded before this sweep" are covered too, so the older copies
 * cannot drift back either.
 */

const ROOT = new URL("../../../", import.meta.url);
const PAGES = [
  // guarded before this sweep
  "apps/admin/app/(admin)/diskon/[id]/page.tsx",
  "apps/admin/app/(admin)/flash-sale/[id]/page.tsx",
  "apps/admin/app/(admin)/promo/[id]/page.tsx",
  "apps/admin/app/(admin)/promo/html/[id]/page.tsx",
  // SA-3 + AD-1
  "apps/admin/app/(admin)/bantuan/[id]/page.tsx",
  "apps/admin/app/(admin)/blog/[id]/page.tsx",
  "apps/admin/app/(admin)/halaman/[id]/page.tsx",
  "apps/admin/app/(admin)/pelanggan/[id]/page.tsx",
  "apps/admin/app/(admin)/produk/kategori/[id]/page.tsx",
  "apps/admin/app/(admin)/tema/[id]/page.tsx",
  "apps/super-admin/app/(platform)/toko/[id]/page.tsx",
  "apps/super-admin/app/(platform)/tiket/[id]/page.tsx",
];

/** Identifiers imported from a module that reads the database. */
function dataIdentifiers(src: string): string[] {
  const names: string[] = [];
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
    if (!/^@\/lib\/(data|health)(\/|$)/.test(m[2])) continue;
    for (const raw of m[1].split(",")) {
      const name = raw.replace(/\btype\b/, "").split(/\s+as\s+/)[0].trim();
      if (name && name !== "type") names.push(name);
    }
  }
  return names;
}

const GUARD = codeOnly("if (!isUuid(id)) notFound();");

function check(src: string, label: string) {
  const body = src.slice(src.indexOf("export default"));
  const guardAt = body.indexOf(GUARD);
  expect(guardAt, `${label} must refuse a non-UUID id with notFound()`).toBeGreaterThan(-1);
  const reads = dataIdentifiers(src).filter((name) => body.includes(`${name} (`));
  expect(reads.length, `${label}: no data read found — the "above its first read" claim would be vacuous`).toBeGreaterThan(0);
  for (const name of reads) {
    expect(body.indexOf(`${name} (`), `${label}: ${name}() runs before isUuid`).toBeGreaterThan(guardAt);
  }
}

describe("every UUID-keyed page calls isUuid before its first data read", () => {
  it.each(PAGES)("%s", (rel) => {
    check(codeOnly(readFileSync(fileURLToPath(new URL(rel, ROOT)), "utf8")), rel);
  });

  it("the predicates fire against a page with the guard removed, or moved below the read", () => {
    // Mutation self-check on a COPY — a pattern that matches nothing is indistinguishable from one
    // that matches everything, which is how this repo's guards have gone green before.
    const real = readFileSync(fileURLToPath(new URL("apps/admin/app/(admin)/halaman/[id]/page.tsx", ROOT)), "utf8");
    expect(real).toContain("if (!isUuid(id)) notFound();");
    const removed = real.replace("if (!isUuid(id)) notFound();", "");
    expect(() => check(codeOnly(removed), "mutant")).toThrow(/must refuse a non-UUID/);
    const reordered = real
      .replace("if (!isUuid(id)) notFound();", "")
      .replace("if (!page) notFound();", "if (!isUuid(id)) notFound();\n  if (!page) notFound();");
    expect(() => check(codeOnly(reordered), "mutant")).toThrow(/runs before isUuid/);
  });
});
