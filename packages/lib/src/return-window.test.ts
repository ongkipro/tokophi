import { describe, expect, it } from "vitest";
import { RETURN_WINDOW_MAX_DAYS, normalizeReturnWindow, returnWindowLine } from "./return-window";

describe("return window", () => {
  it("normalises form input; anything that is not a positive number means 'not declared'", () => {
    expect(normalizeReturnWindow("7")).toBe(7);
    expect(normalizeReturnWindow(14)).toBe(14);
    expect(normalizeReturnWindow(" 3 hari ")).toBe(3);
    expect(normalizeReturnWindow(2.6)).toBe(3);
    for (const v of ["", "  ", "abc", 0, -5, "0", NaN, null, undefined, {}]) expect(normalizeReturnWindow(v)).toBeNull();
  });
  it("caps at 90 days so a typo cannot promise a year", () => {
    expect(normalizeReturnWindow(9999)).toBe(RETURN_WINDOW_MAX_DAYS);
  });
  it("says nothing when the store declared nothing", () => {
    expect(returnWindowLine(null)).toBeNull();
    expect(returnWindowLine(undefined)).toBeNull();
    expect(returnWindowLine(0)).toBeNull();
    expect(returnWindowLine(7)).toBe("Toko ini menerima pengajuan retur selama 7 hari setelah barang diterima.");
  });
});
