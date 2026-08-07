import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { textWithoutComments } from "../../../../test/source-code";

// T-10 — product imagery is LOCKED to 1:1 platform-wide.
//
// `textWithoutComments`, NOT `codeOnly`: the claim here is about MARKUP. `aspect-[3/4]` lives inside a
// class string that really is emitted into the page, and `codeOnly` renders literal contents inert —
// it would make this guard pass over the exact bug it exists to catch. Comments still have to go: the
// files below discuss the old ratios by name, and a raw-text scan would fail on the explanation.
const ROOT = join(__dirname, "../../../..");
const SITES = [
  "apps/storefront/src/components/ProductCard.astro",
  "apps/storefront/src/components/sections/ProductGrid.astro",
  "apps/storefront/src/pages/produk/[handle].astro",
];

describe("product imagery is locked to 1:1", () => {
  for (const rel of SITES) {
    it(`${rel} emits no non-square product aspect`, () => {
      const emitted = textWithoutComments(readFileSync(join(ROOT, rel), "utf8"));
      expect(emitted).not.toMatch(/aspect-\[3\/4\]/);
      expect(emitted).not.toMatch(/aspect-\[4\/5\]/);
    });
  }

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
