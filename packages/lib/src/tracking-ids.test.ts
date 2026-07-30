import { describe, expect, it } from "vitest";
import { itemGroupId, purchaseEventId, retailerId } from "./tracking-ids";

// These strings are a contract with FOUR surfaces at once (the two product feeds, the browser pixel
// and the Conversions API) and, through them, with Google/Meta/TikTok — who key a catalog item by the
// id we send and offer no way to re-key it. A silent change here does not throw; it detaches every
// conversion from its catalog item, or destroys a product's ad history. That is what these guard.

const P = { handle: "kemeja-linen", number: 1042 };

describe("retailerId — number scheme (ADR 0013)", () => {
  it("is {number}-{seq}, always suffixed, even for a single-variant product", () => {
    // Always suffixing is the point: a bare `1042` would have to become `1042-1` the day the merchant
    // adds their first variant, which is exactly the re-key this scheme exists to abolish.
    expect(retailerId("number", P, { seq: 1, index: 0, count: 1 })).toBe("1042-1");
  });

  it("SURVIVES the edits that re-keyed the old scheme", () => {
    const before = retailerId("number", P, { seq: 3, index: 2, count: 3 });
    // …a handle rename
    expect(retailerId("number", { handle: "kemeja-linen-baru", number: 1042 }, { seq: 3, index: 2, count: 3 })).toBe(before);
    // …a reorder that moves this variant to the front
    expect(retailerId("number", P, { seq: 3, index: 0, count: 3 })).toBe(before);
    // …deleting a sibling, so this is now the 2nd of 2. THIS is the case that silently re-pointed a
    // live catalog item at a different SKU under the handle scheme.
    expect(retailerId("number", P, { seq: 3, index: 1, count: 2 })).toBe(before);
  });

  it("stays inside Google's 1–50 character limit and its recommended ASCII set", () => {
    const id = retailerId("number", { handle: "x".repeat(200), number: 999999 }, { seq: 9999, index: 0, count: 1 });
    expect(id.length).toBeLessThanOrEqual(50);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("gives every variant of a product the same item_group_id, and always emits one", () => {
    expect(itemGroupId("number", P, 1)).toBe("1042");
    expect(itemGroupId("number", P, 5)).toBe("1042");
  });
});

describe("retailerId — handle scheme (legacy stores)", () => {
  it("reproduces exactly what the feed emitted before ADR 0013", () => {
    expect(retailerId("handle", P, { seq: 1, index: 0, count: 1 })).toBe("kemeja-linen");
    expect(retailerId("handle", P, { seq: 1, index: 0, count: 3 })).toBe("kemeja-linen-1");
    expect(retailerId("handle", P, { seq: 3, index: 2, count: 3 })).toBe("kemeja-linen-3");
  });

  it("documents the instability it was replaced for — the ordinal follows POSITION, not the variant", () => {
    // Same variant (seq 3), one sibling deleted: the legacy id shifts to a DIFFERENT string, which to
    // Meta and Google means "this product was deleted and another appeared".
    expect(retailerId("handle", P, { seq: 3, index: 1, count: 2 })).toBe("kemeja-linen-2");
  });

  it("emits an item_group_id only for a product that already has several variants", () => {
    expect(itemGroupId("handle", P, 1)).toBeNull();
    expect(itemGroupId("handle", P, 2)).toBe("kemeja-linen");
  });
});

describe("purchaseEventId", () => {
  it("is deterministic — the browser and the server derive the identical string", () => {
    expect(purchaseEventId("PHI-123456789ABC")).toBe("purchase:PHI-123456789ABC");
  });

  it("carries no tenant identifier — the order number is already platform-unique", () => {
    expect(purchaseEventId("PHI-1")).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });

  it("distinguishes two different orders", () => {
    expect(purchaseEventId("PHI-1")).not.toBe(purchaseEventId("PHI-2"));
  });
});
