// THE CART'S `variant` MUST BE A REAL `product_variants.title`, OR NOTHING AT ALL.
//
// `/api/public/order` matches `i.variant` against `product_variants.title` EXACTLY and refuses a miss
// — deliberately: a silently re-substituted variant is how a shopper is charged for something they did
// not choose. The storefront broke that contract from the other side. `produk/[handle].astro` rendered
// the legacy display-only `products.sizes` column as an "Ukuran" picker whenever a product had no
// `product_options` rows, and `addToCart` parked the chosen SIZE STRING in `cart.variant`. Those
// products have exactly ONE variant, titled `Default`, so the cart said "All Size", the database said
// "Default", and every order died at Bayar with
//   Varian "All Size" untuk "…" sudah tidak tersedia. Muat ulang halaman produk.
// — advice that cannot work, because reloading restores the same string from localStorage.
//
// Measured on production 2026-08-03: **10 of batik-nusantara's 22 active products, 0 line items ever
// sold between them**, against 170 for the other 12. Zero sales across ten products is the bug's own
// footprint — and `astro check`, lint and `astro build` were all green on it the whole time. That is
// why this file reads the SOURCE as well as testing the logic: the picker was markup, and the fix is
// the ABSENCE of markup, which no type-checker has an opinion about.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { noVariantChoice } from "./cart-variant";
import { codeOnly } from "../../../../test/source-code";

// ⚠️ BOTH FILES GO THROUGH `codeOnly`, AND THE ONE THAT DID NOT IS WHAT THIS NOTE IS ABOUT.
//
// The PDP half was filtered line-by-line for comment prefixes; `CHECKOUT` was matched RAW. So an
// audit commented out the `normalizeCart(...)` call inside `readCart()` — killing the repair for
// every shopper already holding a poisoned cart — and all seven tests stayed green, because the text
// of the call was still on the line. That is the same defect the same PR fixed in
// `section-renderer-exhaustive.test.ts` one commit later, reintroduced one commit earlier: a guard
// hand-rolls its own idea of "ignore the comments", and the hand-rolled one has a hole.
//
// The rule and the one implementation are in `test/source-code.ts`: a guard asserts against a file's
// CODE, never its TEXT. `codeOnly` drops comments (trivia to a lexer, so there is nothing to strip
// wrongly) and makes every literal's contents inert. It joins tokens with spaces, so every assertion
// below is written whitespace-tolerantly — `d\s*\.\s*variant`, not `d\.variant`.
const src = (p: string) => codeOnly(readFileSync(new URL(p, import.meta.url), "utf8"));
const PDP = src("../pages/produk/[handle].astro");
const CHECKOUT = src("../pages/checkout.astro");

describe("noVariantChoice — which cart lines may have their variant cleared", () => {
  const one = [{ stock: 3 }];
  const many = [{ stock: 3 }, { stock: 1 }];

  it("is true for a legacy sizes product with a single (Default) variant — the 10 unbuyable ones", () => {
    expect(noVariantChoice({ sizes: ["All Size"], variants: one })).toBe(true);
    expect(noVariantChoice({ sizes: ["S", "M", "L", "XL"], variants: one })).toBe(true);
  });

  // THE HALF THAT MATTERS. Without the variant-count guard this predicate would clear a stale
  // "Hitam / L" on a real 12-variant product, and the order API would then resolve the now-unnamed
  // line to position 0 — silent substitution, moved client-side. The 12 products that work today all
  // land here.
  it("is FALSE for a product with real variants, however its sizes column reads", () => {
    expect(noVariantChoice({ sizes: ["S", "M", "L"], variants: many })).toBe(false);
  });

  it("is false with no legacy sizes list — nothing ever poisoned those carts", () => {
    expect(noVariantChoice({ sizes: [], variants: one })).toBe(false);
    expect(noVariantChoice({})).toBe(false);
  });
});

describe("the PDP cannot offer a size that is not a variant", () => {
  it("renders no picker built from products.sizes", () => {
    // Each of these is a piece of the deleted fallback picker. `products.sizes` has exactly one
    // reader left in the repo (`noVariantChoice`), and it must never become a control again.
    // Both spellings of each marker are covered: `class="size-options"` keeps its hyphen inside the
    // literal, while the attribute NAME `data-size` lexes as three tokens.
    expect(PDP).not.toMatch(/product\s*\.\s*sizes/);
    expect(PDP).not.toMatch(/size\s*-\s*options|size\s*-\s*btn|data\s*-\s*size/);
  });

  it("puts only a real variant title in the cart", () => {
    // `d.variant` is written by updateVariant() from the REAL option rows. The old `|| selectedSize`
    // is the bug; empty is the correct answer for a product with nothing to pick, because
    // /api/public/order reads an unnamed line as "the position-0 variant".
    expect(PDP).toMatch(/var\s+variant\s*=\s*d\s*\.\s*variant\s*\|\|\s*""\s*;/);
    expect(PDP).not.toMatch(/selectedSize/);
  });
});

describe("checkout repairs carts poisoned before the picker was deleted", () => {
  it("clears the variant on READ and writes the repaired cart back", () => {
    // On read, not at submit: the poisoned string also drives the ongkir quote, the pixel's
    // content_ids and the summary. Written back, or the next page load restores the broken cart and
    // the shopper is stuck forever.
    expect(CHECKOUT).toMatch(/function\s+normalizeCart\s*\(/);
    // ⚠️ NOT a character budget. This assertion used to be `readCart\(\) \{[\s\S]{0,200}normalizeCart\(`
    // and the 200 was calibrated against RAW text — with the comments gone the window reached past the
    // end of `readCart` and matched the `function normalizeCart(` DECLARATION below it, so the guard
    // was green over the very mutation it was being repaired for. `[^}]` is the honest scope: it stops
    // at the first close brace, i.e. at the end of `readCart`'s `try`, and it is only trustworthy
    // because this is code — a brace inside a comment or a string cannot reach it.
    expect(CHECKOUT).toMatch(/function\s+readCart\s*\(\s*\)\s*\{[^}]*?\breturn\s+normalizeCart\s*\(/);
    expect(CHECKOUT).toMatch(
      /function\s+normalizeCart\s*\([\s\S]*?localStorage\s*\.\s*setItem\s*\(\s*"cart"/,
    );
  });

  it("scopes the repair with noVariantChoice, never a hand-rolled copy of it", () => {
    expect(CHECKOUT).toMatch(/catalog\s*\.\s*products\s*\.\s*filter\s*\(\s*noVariantChoice\s*\)/);
  });
});
