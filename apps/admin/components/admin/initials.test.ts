import { describe, expect, it } from "vitest";
import { initials } from "./initials";

describe("initials", () => {
  it("takes the first letter of the first two words", () => {
    expect(initials("Batik Nusantara")).toBe("BN");
    expect(initials("Toko Kopi Senja")).toBe("TK");
  });
  it("handles a single word, stray whitespace and an empty name", () => {
    expect(initials("Ongki")).toBe("O");
    expect(initials("  snack   rumahan ")).toBe("SR");
    expect(initials("")).toBe("");
  });
});
