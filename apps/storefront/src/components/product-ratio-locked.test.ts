import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { textWithoutComments } from "../../../../test/source-code";

// T-10 — product imagery was LOCKED to 1:1 platform-wide… with TWO owner-ruled exceptions now:
// the PDP GALLERY's main image (2026-08-24) and — ronde 2 the same day — the product CARD, both
// merchant-configurable to 1:1 / 4:5 / 2:3 in /tema, both STORE-level keys in `stores.theme` jsonb.
// What the lock still forbids, and what these clauses pin: a per-template/per-call-site `ratio`
// PROP (that is how one template quietly opts out of the store's own setting), a forwarded stored
// `imageRatio`, any hardcoded non-square class, and 3:4 anywhere. Each surface may reach a
// non-square shape ONLY through its validated resolver map (`resolveGalleryAspect` /
// `resolveCardAspect`), which turns jsonb garbage back into 1:1.
//
// `textWithoutComments`, NOT `codeOnly`: the claim here is about MARKUP. `aspect-[3/4]` lives inside a
// class string that really is emitted into the page, and `codeOnly` renders literal contents inert —
// it would make this guard pass over the exact bug it exists to catch. Comments still have to go: the
// files below discuss the old ratios by name, and a raw-text scan would fail on the explanation.
const ROOT = join(__dirname, "../../../..");
const CARD = "apps/storefront/src/components/ProductCard.astro";
const GRID = "apps/storefront/src/components/sections/ProductGrid.astro";
const PDP = "apps/storefront/src/pages/produk/[handle].astro";

describe("product imagery is locked to 1:1", () => {
  // ProductGrid renders ProductCard, so it follows the store's card aspect WITHOUT carrying any
  // ratio markup of its own — a non-square literal appearing here is a fork of the card's map.
  it(`${GRID} emits no non-square product aspect of its own`, () => {
    const emitted = textWithoutComments(readFileSync(join(ROOT, GRID), "utf8"));
    expect(emitted).not.toMatch(/aspect-\[3\/4\]/);
    expect(emitted).not.toMatch(/aspect-\[4\/5\]/);
  });

  // The CARD exception mirrors the PDP's: each shape exactly once, inside CARD_ASPECT_CLASS, routed
  // through the resolveCardAspect CALL (the call form, not the token — a dead import satisfied a
  // name check once).
  it(`${CARD} reaches non-square ONLY through the validated card-aspect map`, () => {
    const emitted = textWithoutComments(readFileSync(join(ROOT, CARD), "utf8"));
    expect(emitted).toMatch(/resolveCardAspect\s*\(/);
    expect(emitted).toMatch(/CARD_ASPECT_CLASS/);
    expect(emitted).not.toMatch(/aspect-\[3\/4\]/);
    expect(emitted.match(/aspect-\[4\/5\]/g) ?? []).toHaveLength(1);
    expect(emitted.match(/aspect-\[2\/3\]/g) ?? []).toHaveLength(1);
  });

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
