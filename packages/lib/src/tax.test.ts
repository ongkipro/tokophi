import { describe, it, expect } from "vitest";
import { computeTax } from "./tax";

// Merchant storefront PPN. The order API and the checkout display both call this, so the shopper is
// charged exactly what they were shown — these are real money, exercised not eyeballed.
describe("computeTax", () => {
  it("off by default → nothing added", () => {
    expect(computeTax(100_000, { enabled: false, ratePct: 11, inclusive: false })).toEqual({ taxIdr: 0, addToTotal: 0 });
  });
  it("rate 0 or empty cart → nothing added", () => {
    expect(computeTax(100_000, { enabled: true, ratePct: 0, inclusive: false })).toEqual({ taxIdr: 0, addToTotal: 0 });
    expect(computeTax(0, { enabled: true, ratePct: 11, inclusive: false })).toEqual({ taxIdr: 0, addToTotal: 0 });
  });
  it("exclusive: PPN added on top of the subtotal", () => {
    // 100_000 × 11% = 11_000 added → charged 111_000.
    expect(computeTax(100_000, { enabled: true, ratePct: 11, inclusive: false })).toEqual({ taxIdr: 11_000, addToTotal: 11_000 });
  });
  it("inclusive: tax broken out of the price, total unchanged", () => {
    // 111_000 already includes 11% → base 100_000, ppn 11_000, nothing added to the total.
    expect(computeTax(111_000, { enabled: true, ratePct: 11, inclusive: true })).toEqual({ taxIdr: 11_000, addToTotal: 0 });
  });
  it("honours a non-11 rate", () => {
    expect(computeTax(200_000, { enabled: true, ratePct: 5, inclusive: false })).toEqual({ taxIdr: 10_000, addToTotal: 10_000 });
  });
});
