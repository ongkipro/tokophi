import { describe, expect, it } from "vitest";
import { EXPORT_MAX_DAYS, commissionCsv, csvCell, parseExportRange } from "./affiliate-commission-csv";

describe("csvCell — CSV-injection safe (F-A11)", () => {
  it.each([
    ["=1+1", "'=1+1"],
    ["+62812", "'+62812"],
    ["-5", "'-5"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\tx", "'\tx"],
    ["\rx", `"'\rx"`],
  ])("%j becomes %j", (input, out) => {
    expect(csvCell(input)).toBe(out);
  });

  it("quotes separators and doubles quotes; numbers stay numbers; null is empty", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(csvCell("baris\nbaru")).toBe('"baris\nbaru"');
    expect(csvCell(10000)).toBe("10000");
    expect(csvCell(null)).toBe("");
    expect(csvCell("Sari")).toBe("Sari");
  });
});

describe("parseExportRange", () => {
  it("takes real inclusive dates up to the cap and refuses everything else", () => {
    expect(parseExportRange("2026-11-01", "2026-11-01")).toEqual({ ok: true, from: "2026-11-01", to: "2026-11-01" });
    expect(parseExportRange("2024-01-01", "2024-12-31").ok).toBe(true); // 366 days, leap year
    expect(parseExportRange("2024-01-01", "2025-01-01").ok).toBe(false); // 367
    expect(EXPORT_MAX_DAYS).toBe(366);
    for (const [f, t] of [["2026-11-02", "2026-11-01"], ["2026-02-30", "2026-03-01"], ["", "2026-11-01"], [null, undefined], ["2026-1-01", "2026-11-01"]]) {
      expect(parseExportRange(f, t).ok).toBe(false);
    }
  });
});

describe("commissionCsv", () => {
  it("starts with a UTF-8 BOM, uses CRLF, and writes WIB times", () => {
    const csv = commissionCsv([
      {
        orderNumber: "TPH-1",
        placedAt: new Date("2026-11-13T17:30:00Z"), // 14 Nov 00:30 WIB
        affiliateName: "Sari",
        affiliateCode: "SARI10",
        source: "link",
        baseIdr: 100000,
        rateNote: "10%",
        commissionIdr: 10000,
        state: "siap",
        paidAt: null,
        paidNote: null,
      },
    ]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split("\r\n")[1]).toBe("TPH-1,2026-11-14 00:30,Sari,SARI10,Link,100000,10%,10000,Siap dibayar,,");
  });
});
