import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { textWithoutComments } from "../../../../test/source-code";

// T-10 — product imagery is LOCKED to 1:1 platform-wide… with ONE owner-ruled exception (2026-08-24):
// the PDP GALLERY's main image is merchant-configurable to 1:1 / 4:5 / 2:3, set in /tema and stored
// in `stores.theme` jsonb. The lock still holds everywhere it was written for — product CARDS and
// GRIDS stay square, no `ratio` prop may creep back — and the PDP may reach a non-square shape ONLY
// through the validated `resolveGalleryAspect` map, never through a hardcoded class or a forwarded
// stored ratio. That is what the PDP clauses below now pin.
//
// `textWithoutComments`, NOT `codeOnly`: the claim here is about MARKUP. `aspect-[3/4]` lives inside a
// class string that really is emitted into the page, and `codeOnly` renders literal contents inert —
// it would make this guard pass over the exact bug it exists to catch. Comments still have to go: the
// files below discuss the old ratios by name, and a raw-text scan would fail on the explanation.
const ROOT = join(__dirname, "../../../..");
const LOCKED_SITES = [
  "apps/storefront/src/components/ProductCard.astro",
  "apps/storefront/src/components/sections/ProductGrid.astro",
];
const PDP = "apps/storefront/src/pages/produk/[handle].astro";

describe("product imagery is locked to 1:1", () => {
  for (const rel of LOCKED_SITES) {
    it(`${rel} emits no non-square product aspect`, () => {
      const emitted = textWithoutComments(readFileSync(join(ROOT, rel), "utf8"));
      expect(emitted).not.toMatch(/aspect-\[3\/4\]/);
      expect(emitted).not.toMatch(/aspect-\[4\/5\]/);
    });
  }

  // The PDP exception is NARROW: each configurable shape may appear exactly once — inside the
  // GALLERY_ASPECT_CLASS lookup — and the file must route through resolveGalleryAspect, the
  // validator that turns jsonb garbage back into 1:1. A second occurrence of any of these literals
  // is a hardcoded ratio sneaking in beside the sanctioned path; 3:4 was never sanctioned at all.
  it(`${PDP} reaches non-square ONLY through the validated gallery-aspect map`, () => {
    const emitted = textWithoutComments(readFileSync(join(ROOT, PDP), "utf8"));
    // The CALL, not the token: after a bypass mutation the dead IMPORT still contains the name, and
    // this guard was measured green over exactly that. Token-joined text renders a call as
    // `resolveGalleryAspect (`.
    expect(emitted).toMatch(/resolveGalleryAspect\s*\(/);
    expect(emitted).toMatch(/GALLERY_ASPECT_CLASS/);
    expect(emitted).not.toMatch(/aspect-\[3\/4\]/);
    expect(emitted.match(/aspect-\[4\/5\]/g) ?? []).toHaveLength(1);
    expect(emitted.match(/aspect-\[2\/3\]/g) ?? []).toHaveLength(1);
  });

  // Defaulting to 1:1 is not the requirement — IGNORING a stored ratio is. A `ratio` prop back on the
  // card is how the lock would quietly come undone: one call site passes the merchant's old value and
  // nothing else has to change for a 4:5 card to reappear.
  it("ProductCard takes no ratio prop at all", () => {
    const card = textWithoutComments(
      readFileSync(join(ROOT, "apps/storefront/src/components/ProductCard.astro"), "utf8"),
    );
    expect(card).not.toMatch(/\bratio\s*[?:=]/);
  });

  it("ProductGrid never forwards a stored imageRatio", () => {
    const grid = textWithoutComments(
      readFileSync(join(ROOT, "apps/storefront/src/components/sections/ProductGrid.astro"), "utf8"),
    );
    expect(grid).not.toMatch(/imageRatio/);
  });
});
