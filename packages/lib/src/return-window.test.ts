import { describe, expect, it } from "vitest";
import { RETURN_WINDOW_MAX_DAYS, RETURN_WINDOW_MIN_DAYS, parseReturnWindow, returnWindowLine } from "./return-window";

describe("return window", () => {
  it("accepts a whole number of working days 2–90, with an optional 'hari' / 'hari kerja'", () => {
    expect(parseReturnWindow("7")).toEqual({ ok: true, days: 7 });
    expect(parseReturnWindow(14)).toEqual({ ok: true, days: 14 });
    expect(parseReturnWindow(" 3 hari ")).toEqual({ ok: true, days: 3 });
    expect(parseReturnWindow("5 hari kerja")).toEqual({ ok: true, days: 5 });
    expect(parseReturnWindow("2")).toEqual({ ok: true, days: 2 });
    expect(parseReturnWindow("90")).toEqual({ ok: true, days: 90 });
  });
  it("never lets a store publish less than the 2-working-day floor of PP 80/2019 Pasal 69(1)", () => {
    expect(RETURN_WINDOW_MIN_DAYS).toBe(2);
    for (const v of ["1", 1, "0", " 1 hari "]) expect(parseReturnWindow(v).ok, String(v)).toBe(false);
  });
  it("empty means 'not declared'", () => {
    for (const v of ["", "   ", null, undefined]) expect(parseReturnWindow(v)).toEqual({ ok: true, days: null });
  });
  it("refuses anything ambiguous instead of guessing — a buyer reads this as a promise", () => {
    // Indonesian decimal and thousands separators used to collapse to 75 and 1.
    for (const v of ["7,5", "7.5", "1.000", "1-2", "abc", "tujuh", "7 minggu", 2.6, NaN, {}, [], true]) {
      expect(parseReturnWindow(v).ok, String(v)).toBe(false);
    }
  });
  it("refuses out-of-range numbers rather than silently capping them", () => {
    for (const v of [0, -5, "-5", 91, "91", 9999, `${RETURN_WINDOW_MAX_DAYS + 1}`]) {
      expect(parseReturnWindow(v).ok, String(v)).toBe(false);
    }
  });
  it("says nothing when the store declared nothing", () => {
    expect(returnWindowLine(null)).toBeNull();
    expect(returnWindowLine(undefined)).toBeNull();
    expect(returnWindowLine(0)).toBeNull();
    expect(returnWindowLine(7)).toBe("Toko ini menerima pengajuan retur selama 7 hari kerja setelah barang diterima.");
  });
});
