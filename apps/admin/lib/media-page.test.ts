import { describe, expect, it } from "vitest";
import { clampMediaPage, MEDIA_PAGE_SIZE } from "./media-page";

describe("clampMediaPage", () => {
  it("defaults to page 1 for a missing, junk, zero or negative value", () => {
    for (const raw of [undefined, "", "abc", "0", "-3", "NaN"]) expect(clampMediaPage(raw, 100)).toBe(1);
  });
  it("keeps a page that exists", () => {
    expect(clampMediaPage("2", MEDIA_PAGE_SIZE * 3)).toBe(2);
  });
  it("clamps a page past the end to the last page (the page a deleted file used to be on)", () => {
    expect(clampMediaPage("9", MEDIA_PAGE_SIZE * 2 + 1)).toBe(3);
    expect(clampMediaPage("2", MEDIA_PAGE_SIZE)).toBe(1);
  });
  it("an empty library is page 1, not page 0", () => {
    expect(clampMediaPage("5", 0)).toBe(1);
  });
});
