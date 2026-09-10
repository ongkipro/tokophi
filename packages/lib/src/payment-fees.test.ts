import { describe, expect, it } from "vitest";
import { CHANNEL_FEE_OVERRIDES, PAYMENT_FEES, channelFeeValue, paymentFee } from "./payment-fees";

// Fee schedule — owner ruling 2026-08-24. These pin the NUMBERS and the BASES: the `base` field is
// part of a fee's identity (QRIS was 1% of the payable for months because every caller picked its
// own denominator), so a change here must be a deliberate re-ruling, not a refactor side-effect.
describe("payment fee schedule", () => {
  // 🔴 THESE FOUR NUMBERS ARE THE PROVIDER'S, NOT OURS. `GET /api/h2h/list_payment` reports what the
  // account is actually billed, and on 2026-09-10 it answered `admin: "3000.0"` / `tipe_admin: "fix"`
  // for VABNI, VAPERMATA, VAMANDIRI and VABRI, and `"6500.0"` for VABCA. We charged Rp3.500 for the
  // four, so the buyer paid Rp500 above cost on every one of them. Owner ruling the same day lowered
  // it. If this test is ever changed, re-read `list_payment` first — the schedule is a mirror of the
  // provider's configuration, not an independent price list.
  it("VA is flat per bank: BCA Rp6.500, every other bank Rp3.000", () => {
    expect(channelFeeValue("va", "VABCA")).toBe(6_500);
    for (const bank of ["VABNI", "VABRI", "VAMANDIRI", "VAPERMATA"]) {
      expect(channelFeeValue("va", bank)).toBe(3_000);
    }
    expect(channelFeeValue("va", null)).toBe(3_000);
    // flat fees ignore both bases entirely
    expect(paymentFee("va", { omsetIdr: 1_000_000, payableIdr: 2_000_000 }, "VABCA")).toBe(6_500);
    expect(paymentFee("va", { omsetIdr: 1_000_000, payableIdr: 2_000_000 }, "VAPERMATA")).toBe(3_000);
  });

  // The DEFAULT moved rather than four overrides being added, and that is a decision worth pinning:
  // of the five VA banks the provider offers, four are Rp3.000 and one is Rp6.500 — none is Rp3.500.
  // Four rows all equal to the default would leave the default matching no bank at all, so the next
  // bank the provider enables would be billed at a price nothing charges.
  it("keeps BCA as the ONLY per-bank exception", () => {
    expect(Object.keys(CHANNEL_FEE_OVERRIDES)).toEqual(["VABCA"]);
    for (const [code, value] of Object.entries(CHANNEL_FEE_OVERRIDES)) {
      expect(value, `${code} restates the VA default and should be deleted`).not.toBe(PAYMENT_FEES.va.value);
    }
  });

  it("QRIS is 0,7% of the GOODS OMSET, never the payable", () => {
    expect(PAYMENT_FEES.qris.base).toBe("omset");
    expect(PAYMENT_FEES.qris.value).toBe(0.007);
    // omset 100k, payable 130k (shipping + PPN outside the base): the fee reads the omset
    expect(paymentFee("qris", { omsetIdr: 100_000, payableIdr: 130_000 })).toBe(700);
  });

  it("a pct fee reads the base ITS OWN schedule entry declares", () => {
    // e-wallet stays on the payable — the declared base decides, not the caller
    expect(PAYMENT_FEES.ewallet.base).toBe("payable");
    expect(paymentFee("ewallet", { omsetIdr: 100_000, payableIdr: 120_000 })).toBe(Math.round(120_000 * 0.03));
  });

  it("the per-bank override map only carries flats that differ from the VA default", () => {
    // VABCA is the single override today; adding a bank with its own price is a data edit here,
    // not a deploy of new logic — and an override must never silently apply to a pct fee.
    expect(CHANNEL_FEE_OVERRIDES.VABCA).toBe(6_500);
    expect(channelFeeValue("qris", "VABCA")).toBe(0.007); // pct fees ignore flat overrides
  });

  it("a negative base can never produce a negative fee", () => {
    expect(paymentFee("qris", { omsetIdr: -5_000, payableIdr: -5_000 })).toBe(0);
  });
});
