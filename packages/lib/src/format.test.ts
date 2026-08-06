import { describe, expect, it } from "vitest";
import { IDR, NO_FIGURE, num, pct, share } from "./format";

// "A FIGURE WITH NO SOURCE IS '—', NEVER A NUMBER" — measured on merchant-facing screens before the
// floor existed: IDR(NaN) → "RpNaN", IDR(Infinity, {compact}) → "RpInfinity M", num(NaN) → "NaN",
// share(NaN) → "NaN%", and pct(NaN) → "NaN%" **with the sign dropped**, which is the single thing
// `pct` exists to guarantee.
describe("non-finite input renders as no figure at all", () => {
  const nonFinite = [NaN, Infinity, -Infinity];

  it("IDR — plain and compact", () => {
    for (const n of nonFinite) {
      expect(IDR(n)).toBe(NO_FIGURE);
      expect(IDR(n, { compact: true })).toBe(NO_FIGURE);
    }
  });

  it("num, pct and share", () => {
    for (const n of nonFinite) {
      expect(num(n)).toBe(NO_FIGURE);
      expect(pct(n)).toBe(NO_FIGURE);
      expect(share(n)).toBe(NO_FIGURE);
    }
  });

  // `null` is the DELTA producer's "there was no previous period to divide by" (lib/data/dashboard).
  // It lands on the same floor rather than an em dash re-typed at each call site — the empty seeded
  // store used to read "Penjualan hari ini +0,0%", a measurement of "unchanged" over no history.
  it("pct(null) — nothing to compare to", () => {
    expect(pct(null)).toBe(NO_FIGURE);
    expect(pct(null)).not.toBe("0,0%");
    expect(pct(null)).not.toContain("+");
  });

  it("⚠️ a real ZERO is a measurement and must survive", () => {
    expect(IDR(0)).not.toBe(NO_FIGURE);
    expect(IDR(0, { compact: true })).not.toBe(NO_FIGURE);
    expect(num(0)).toBe("0");
    expect(pct(0)).toBe("0,0%");
    expect(share(0)).toBe("0,0%");
    expect(pct(-0)).toBe("0,0%");
  });
});

// ⚠️ `pct()` is the DELTA formatter and `share()` the part-of-a-whole one. Feeding a share to `pct()`
// is what made the control plane read "Ditangguhkan 5 +83,3%" — a plus sign claiming suspensions were
// climbing when nothing had moved. The floor above must not blur them.
describe("pct is a delta, share is a part of a whole", () => {
  it("pct always carries its own sign; share never does", () => {
    expect(pct(16.9)).toBe("+16,9%");
    expect(pct(-6.4)).toBe("−6,4%"); // U+2212, not an ASCII hyphen
    expect(share(83.3)).toBe("83,3%");
    expect(share(83.3)).not.toContain("+");
  });

  // The product editor's gross margin is a share of the price and goes negative when cost exceeds it.
  // `toFixed()` alone gave it an ASCII hyphen, two lines under a `pct()` printing U+2212.
  it("a negative share draws the minus it already has — as a minus, not a hyphen", () => {
    expect(share(-12.5)).toBe("−12,5%");
    expect(share(-12.5)).not.toContain("-"); // ASCII hyphen
    // Same rule as `pct`: the sign comes off the number, so a true −0 (and a real 0) carries none.
    expect(share(-0)).toBe("0,0%");
    expect(share(-0)).not.toContain("−");
  });
});
