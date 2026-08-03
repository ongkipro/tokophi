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

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const PDP = src("../pages/produk/[handle].astro");
const CHECKOUT = src("../pages/checkout.astro");

// Only the executable half of the PDP. The comments explaining this bug name every identifier the
// assertions below forbid, and a test that greps the prose documenting it can never go green.
const pdpCode = PDP.split("\n")
  .filter((l) => !/^\s*(\/\/|\*|\{?\/\*|-->)/.test(l))
  .join("\n");

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
    expect(pdpCode).not.toMatch(/product\.sizes/);
    expect(pdpCode).not.toMatch(/size-options|size-btn|data-size/);
  });

  it("puts only a real variant title in the cart", () => {
    // `d.variant` is written by updateVariant() from the REAL option rows. The old `|| selectedSize`
    // is the bug; empty is the correct answer for a product with nothing to pick, because
    // /api/public/order reads an unnamed line as "the position-0 variant".
    expect(pdpCode).toMatch(/var variant = d\.variant \|\| "";/);
    expect(pdpCode).not.toMatch(/selectedSize/);
  });
});

describe("checkout repairs carts poisoned before the picker was deleted", () => {
  it("clears the variant on READ and writes the repaired cart back", () => {
    // On read, not at submit: the poisoned string also drives the ongkir quote, the pixel's
    // content_ids and the summary. Written back, or the next page load restores the broken cart and
    // the shopper is stuck forever.
    expect(CHECKOUT).toMatch(/function normalizeCart\(/);
    expect(CHECKOUT).toMatch(/readCart\(\) \{[\s\S]{0,200}normalizeCart\(/);
    expect(CHECKOUT).toMatch(/function normalizeCart\([\s\S]*?localStorage\.setItem\("cart"/);
  });

  it("scopes the repair with noVariantChoice, never a hand-rolled copy of it", () => {
    expect(CHECKOUT).toMatch(/catalog\.products\.filter\(noVariantChoice\)/);
  });
});
