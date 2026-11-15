import { describe, expect, it } from "vitest";
import { parseBody } from "./content";

// The merchant's article/page body is plain text (a textarea): blank line = new block, "- " = list item.
describe("parseBody", () => {
  it("a lead-in line straight above its list is a paragraph FOLLOWED by a list (the shape merchants type)", () => {
    const body = "Yang perlu dihentikan:\n- Merendam lama.\n- Memeras.\n\nPenutup.";
    expect(parseBody(body)).toEqual([
      { kind: "p", text: "Yang perlu dihentikan:" },
      { kind: "ul", items: ["Merendam lama.", "Memeras."] },
      { kind: "p", text: "Penutup." },
    ]);
  });

  it("a block of only items is one list; soft-wrapped lines join into one paragraph", () => {
    expect(parseBody("- a\n- b")).toEqual([{ kind: "ul", items: ["a", "b"] }]);
    expect(parseBody("satu\ndua\r\n\r\ntiga")).toEqual([
      { kind: "p", text: "satu dua" },
      { kind: "p", text: "tiga" },
    ]);
  });

  it("text after a list in the same block is its own paragraph; a dash mid-sentence is NOT an item", () => {
    expect(parseBody("- a\n- b\nCatatan: kering — jangan diperas")).toEqual([
      { kind: "ul", items: ["a", "b"] },
      { kind: "p", text: "Catatan: kering — jangan diperas" },
    ]);
    expect(parseBody("harga 50-100 ribu")).toEqual([{ kind: "p", text: "harga 50-100 ribu" }]);
  });

  it("empty input yields nothing", () => {
    expect(parseBody(null)).toEqual([]);
    expect(parseBody("  \n\n  ")).toEqual([]);
  });
});
