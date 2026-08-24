import { describe, expect, it } from "vitest";
import { CHANNEL_FEE_OVERRIDES, PAYMENT_FEES, channelFeeValue, paymentFee } from "./payment-fees";

// Fee schedule — owner ruling 2026-08-24. These pin the NUMBERS and the BASES: the `base` field is
// part of a fee's identity (QRIS was 1% of the payable for months because every caller picked its
// own denominator), so a change here must be a deliberate re-ruling, not a refactor side-effect.
describe("payment fee schedule", () => {
  it("VA is flat per bank: BCA Rp6.500, every other bank Rp3.500", () => {
    expect(channelFeeValue("va", "VABCA")).toBe(6_500);
    expect(channelFeeValue("va", "VABNI")).toBe(3_500);
    expect(channelFeeValue("va", "VABRI")).toBe(3_500);
    expect(channelFeeValue("va", null)).toBe(3_500);
    // flat fees ignore both bases entirely
    expect(paymentFee("va", { omsetIdr: 1_000_000, payableIdr: 2_000_000 }, "VABCA")).toBe(6_500);
    expect(paymentFee("va", { omsetIdr: 1_000_000, payableIdr: 2_000_000 }, "VAPERMATA")).toBe(3_500);
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
    expect(paymentFee("ewallet", { omsetIdr: 100_000, payableIdr: 120_000 })).toBe(Math.round(120_000 * 0.024));
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
