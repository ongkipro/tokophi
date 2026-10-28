// The affiliate rate and hold are REFUSED, never guessed.
//
// `saveAffiliateSettings` used to take `Number(rate.replace(",", ".")) || 0`, so a seller who typed
// "10%" saved a 0% programme: `{ ok: true }`, a "disimpan" toast, and every order attributed afterwards
// froze `commission_idr = 0` into `affiliate_commissions`. A commission is frozen at order time, so
// correcting the setting later does not repair those orders — the affiliate is never paid for them.
// These are the inputs that used to produce that silence.
import { describe, expect, it } from "vitest";
import { AFFILIATE_HOLD_MAX_DAYS, parseAffiliateHoldDays, parseAffiliateRatePct } from "./affiliate";

describe("parseAffiliateRatePct", () => {
  it("refuses what Number() used to turn into a silent 0%", () => {
    for (const bad of ["10%x", "10 persen", "", "   ", "abc", "-5", "101", "1e2", "10.555", null, undefined, {}, NaN]) {
      const r = parseAffiliateRatePct(bad);
      expect(r.ok, `${JSON.stringify(bad)} must be refused, not saved as a rate`).toBe(false);
    }
  });

  it("accepts a plain percent and both decimal separators, in basis points", () => {
    expect(parseAffiliateRatePct("10")).toEqual({ ok: true, bps: 1000 });
    expect(parseAffiliateRatePct("12,5")).toEqual({ ok: true, bps: 1250 });
    expect(parseAffiliateRatePct("12.5")).toEqual({ ok: true, bps: 1250 });
    expect(parseAffiliateRatePct("10%")).toEqual({ ok: true, bps: 1000 });
    expect(parseAffiliateRatePct(" 7 ")).toEqual({ ok: true, bps: 700 });
    expect(parseAffiliateRatePct(0)).toEqual({ ok: true, bps: 0 });
    expect(parseAffiliateRatePct(100)).toEqual({ ok: true, bps: 10_000 });
  });

  it("rounds the SCALED value — 12.5 * 100 is 1250.0000000000002 in binary floating point", () => {
    // A non-integer bps would reach `affiliate_rate_bps integer` and be rounded by Postgres instead.
    for (const [input, bps] of [[12.5, 1250] as const, ["0,07", 7] as const, ["99,99", 9999] as const]) {
      const r = parseAffiliateRatePct(input);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(Number.isInteger(r.bps)).toBe(true);
      expect(r.bps).toBe(bps);
    }
  });
});

describe("parseAffiliateHoldDays", () => {
  it("accepts 0 (payable as soon as the order finishes) but refuses blank", () => {
    expect(parseAffiliateHoldDays("0")).toEqual({ ok: true, days: 0 });
    expect(parseAffiliateHoldDays("")).toMatchObject({ ok: false });
  });

  it("refuses what used to collapse to 0 days — no hold at all", () => {
    for (const bad of ["3 minggu", "tiga", "-1", String(AFFILIATE_HOLD_MAX_DAYS + 1), "2,5", null, undefined]) {
      expect(parseAffiliateHoldDays(bad).ok, `${JSON.stringify(bad)} must be refused`).toBe(false);
    }
  });

  it("accepts a whole number of days, with or without the word", () => {
    expect(parseAffiliateHoldDays("3")).toEqual({ ok: true, days: 3 });
    expect(parseAffiliateHoldDays("7 hari")).toEqual({ ok: true, days: 7 });
    expect(parseAffiliateHoldDays(AFFILIATE_HOLD_MAX_DAYS)).toEqual({ ok: true, days: AFFILIATE_HOLD_MAX_DAYS });
  });
});
