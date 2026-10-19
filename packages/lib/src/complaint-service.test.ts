import { describe, expect, it } from "vitest";
import { COMPLAINT_DAYS_MAX, COMPLAINT_DAYS_MIN, complaintLine, parseComplaintDays } from "./complaint-service";
import { parseWorkingDays } from "./working-days";

describe("complaint resolution period", () => {
  it("accepts whole working days 1–60, optionally with 'hari' / 'hari kerja'", () => {
    expect(parseComplaintDays("1")).toEqual({ ok: true, days: 1 });
    expect(parseComplaintDays(" 3 hari kerja ")).toEqual({ ok: true, days: 3 });
    expect(parseComplaintDays(60)).toEqual({ ok: true, days: 60 });
  });
  it("empty means 'not declared'", () => {
    for (const v of ["", "  ", null, undefined]) expect(parseComplaintDays(v)).toEqual({ ok: true, days: null });
  });
  it("refuses ambiguity and out-of-range numbers instead of guessing or capping", () => {
    for (const v of ["0", 0, -1, "61", 61, 999, "7,5", "1.000", "abc", 2.5, NaN, {}, true]) expect(parseComplaintDays(v).ok, String(v)).toBe(false);
    expect([COMPLAINT_DAYS_MIN, COMPLAINT_DAYS_MAX]).toEqual([1, 60]);
  });
  it("says nothing when the store declared nothing, and never cites a law", () => {
    for (const v of [null, undefined, 0]) expect(complaintLine(v)).toBeNull();
    const line = complaintLine(5)!;
    expect(line).toBe("Jangka waktu penyelesaian komplain yang ditetapkan toko: 5 hari kerja.");
    expect(line).not.toMatch(/PP|undang|hukum|wajib/i);
  });
  it("the shared parser takes its range from the caller", () => {
    expect(parseWorkingDays("5", 2, 4, "x").ok).toBe(false);
    expect(parseWorkingDays("4", 2, 4, "x")).toEqual({ ok: true, days: 4 });
  });
});
