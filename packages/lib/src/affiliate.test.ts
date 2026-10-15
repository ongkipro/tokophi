import { describe, expect, it } from "vitest";
import { clampBps, computeAffiliateCommission, formatRateBps, normalizeAffiliateCode } from "./affiliate";

describe("computeAffiliateCommission (F-A6)", () => {
  it("the spec's acceptance example: 200k subtotal, 20k voucher, 10% + 20% lines → 27 000", () => {
    const r = computeAffiliateCommission({
      lines: [
        { totalIdr: 100_000, rateBps: null },
        { totalIdr: 100_000, rateBps: 2000 },
      ],
      subtotalIdr: 200_000,
      goodsProceedsIdr: 180_000,
      defaultRateBps: 1000,
    });
    expect(r).toEqual({ baseIdr: 180_000, commissionIdr: 27_000, rateNote: "10% / 20%" });
  });

  it("floors once at the end, never per line", () => {
    // Two lines of 15 @ 10% = 3 in total; flooring each line first would give 1 + 1 = 2.
    const r = computeAffiliateCommission({
      lines: [
        { totalIdr: 15, rateBps: null },
        { totalIdr: 15, rateBps: null },
      ],
      subtotalIdr: 30,
      goodsProceedsIdr: 30,
      defaultRateBps: 1000,
    });
    expect(r.commissionIdr).toBe(3);
  });

  it("an override of 0 means no commission on that product, not the default", () => {
    const r = computeAffiliateCommission({
      lines: [{ totalIdr: 100_000, rateBps: 0 }],
      subtotalIdr: 100_000,
      goodsProceedsIdr: 100_000,
      defaultRateBps: 1000,
    });
    expect(r.commissionIdr).toBe(0);
  });

  it("a zero subtotal or a fully discounted order earns nothing (no division by zero)", () => {
    expect(
      computeAffiliateCommission({ lines: [], subtotalIdr: 0, goodsProceedsIdr: 0, defaultRateBps: 1000 }).commissionIdr,
    ).toBe(0);
    expect(
      computeAffiliateCommission({
        lines: [{ totalIdr: 50_000, rateBps: null }],
        subtotalIdr: 50_000,
        goodsProceedsIdr: 0,
        defaultRateBps: 1000,
      }).commissionIdr,
    ).toBe(0);
  });

  it("goods proceeds above the subtotal are capped — the base is never larger than the goods", () => {
    const r = computeAffiliateCommission({
      lines: [{ totalIdr: 100_000, rateBps: null }],
      subtotalIdr: 100_000,
      goodsProceedsIdr: 150_000,
      defaultRateBps: 1000,
    });
    expect(r).toMatchObject({ baseIdr: 100_000, commissionIdr: 10_000 });
  });

  it("an out-of-range rate is clamped to 0–100%", () => {
    expect(clampBps(-5)).toBe(0);
    expect(clampBps(25_000)).toBe(10_000);
    expect(clampBps(Number.NaN)).toBe(0);
  });
});

describe("normalizeAffiliateCode (F-A4)", () => {
  it("upper-cases and trims", () => expect(normalizeAffiliateCode("  sari10 ")).toBe("SARI10"));
  it("refuses junk rather than guessing", () => {
    for (const bad of ["", "ab", "kode-saya", "x".repeat(21), 123, null, "<script>"]) {
      expect(normalizeAffiliateCode(bad)).toBeNull();
    }
  });
});

describe("formatRateBps", () => {
  it("uses the Indonesian decimal comma", () => {
    expect(formatRateBps(1000)).toBe("10%");
    expect(formatRateBps(1250)).toBe("12,5%");
  });
});

describe("suggestAffiliateCode", () => {
  it("builds a valid code from a name, and from a name with too few letters", async () => {
    const { suggestAffiliateCode } = await import("./affiliate");
    expect(suggestAffiliateCode("Sari Dewi", () => 0.5)).toBe("SARIDE550");
    expect(normalizeAffiliateCode(suggestAffiliateCode("Nur'aini Ç", () => 0))).toBe("NURAIN100");
    expect(normalizeAffiliateCode(suggestAffiliateCode("李", () => 0.999))).toMatch(/^AFF\d{3}$/);
  });
});
