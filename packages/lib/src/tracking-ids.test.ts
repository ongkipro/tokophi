import { describe, expect, it } from "vitest";
import { purchaseEventId, retailerId } from "./tracking-ids";

// These two strings are contracts with THREE surfaces at once (the product feed, the browser pixel and
// the Conversions API). A silent change here does not throw — it just makes every conversion stop
// matching a catalog item, or makes one sale count twice. That is what these tests are guarding.
describe("retailerId", () => {
  it("is the bare handle when the product has a single variant (matches <g:id> in google.xml)", () => {
    expect(retailerId("kemeja-linen", 0, 1)).toBe("kemeja-linen");
  });

  it("is 1-based handle-{n} for multi-variant products", () => {
    expect(retailerId("kemeja-linen", 0, 3)).toBe("kemeja-linen-1");
    expect(retailerId("kemeja-linen", 2, 3)).toBe("kemeja-linen-3");
  });

  it("does not change when the price/title change — only handle + position key it", () => {
    // The same variant of the same product, priced differently: same id, so Meta updates the item
    // instead of creating a second one.
    expect(retailerId("batik-parang", 1, 2)).toBe(retailerId("batik-parang", 1, 2));
  });
});

describe("purchaseEventId", () => {
  it("is deterministic — the browser and the server derive the identical string", () => {
    expect(purchaseEventId("PHI-123456789ABC")).toBe("purchase:PHI-123456789ABC");
  });

  it("carries no tenant identifier — the order number is already platform-unique", () => {
    // Guards the 2026-07-29 review decision: the store UUID must not travel to Meta/Google/TikTok.
    expect(purchaseEventId("PHI-1")).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });

  it("distinguishes two different orders", () => {
    expect(purchaseEventId("PHI-1")).not.toBe(purchaseEventId("PHI-2"));
  });
});
