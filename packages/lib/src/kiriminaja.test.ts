import { describe, it, expect } from "vitest";
import { kaCodFee } from "./kiriminaja";

// N31 — the COD fee KiriminAja returns on every shipping_price rate, which nothing parsed for as
// long as the integration has existed. The shapes below are the vendor's own: the captured doc
// (~/Documents/kiriminaja → 04-pricing/01-express.md) shows `setting.cod_fee` as a STRING fraction
// already divided by 100 ("0.03" = 3%), `minimum_cod_fee` as a string of rupiah, and
// `cod_fee_amount` as a NUMBER computed by the vendor from item value + shipping cost + insurance.
// The parser must survive strings, numbers, junk and absence — and must never invent Rp0 out of
// `Number("")`/`Number(null)`, which are both 0.

describe("kaCodFee — parses the vendor's setting block", () => {
  it("parses the documented sample (strings for fee + minimum, number for amount)", () => {
    const fee = kaCodFee({
      setting: { cod_fee: "0.03", minimum_cod_fee: "2500", cod_fee_amount: 5466 },
    });
    expect(fee).toEqual({ amount: 5466, pct: 3, minimum: 2500 });
  });

  it("converts the fraction to a clean percent (0.028 → 2,8%, no float drift)", () => {
    expect(kaCodFee({ setting: { cod_fee: "0.028" } }).pct).toBe(2.8);
    // 0.03 * 100 === 3.0000000000000004 in raw floating point — the parser rounds it away.
    expect(kaCodFee({ setting: { cod_fee: 0.03 } }).pct).toBe(3);
  });

  it("accepts numeric strings for the amount too", () => {
    expect(kaCodFee({ setting: { cod_fee_amount: "7000" } }).amount).toBe(7000);
  });

  it("is all-null when the vendor sent no setting block", () => {
    expect(kaCodFee({})).toEqual({ amount: null, pct: null, minimum: null });
    expect(kaCodFee({ setting: null })).toEqual({ amount: null, pct: null, minimum: null });
    expect(kaCodFee({ setting: {} })).toEqual({ amount: null, pct: null, minimum: null });
  });

  it("never turns an empty or junk value into Rp0", () => {
    // Number("") and Number(null) are both 0 — an absent fee must stay null, not become "gratis".
    expect(kaCodFee({ setting: { cod_fee: "", minimum_cod_fee: "", cod_fee_amount: "" } })).toEqual({
      amount: null,
      pct: null,
      minimum: null,
    });
    expect(kaCodFee({ setting: { cod_fee: "abc", cod_fee_amount: "N/A" } })).toEqual({
      amount: null,
      pct: null,
      minimum: null,
    });
  });

  it("keeps a genuine zero — a real free-COD promo is a fact, not an absence", () => {
    expect(kaCodFee({ setting: { cod_fee_amount: 0 } }).amount).toBe(0);
  });
});
