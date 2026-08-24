import { describe, expect, it } from "vitest";
import { calculateOrderFinance } from "./order-finance";

describe("calculateOrderFinance", () => {
  it.each([
    ["cheaper", 15_000, 0, 5_000, 100_000],
    ["equal", 20_000, 0, 0, 100_000],
    ["more expensive", 30_000, 10_000, 0, 90_000],
  ])("reconciles %s shipping", (_name, actual, debit, margin, entitlement) => {
    const money = calculateOrderFinance({
      subtotalIdr: 100_000,
      shippingListIdr: 20_000,
      shippingActualIdr: actual,
    });
    expect(money.sellerShippingDebitIdr).toBe(debit);
    expect(money.platformShippingMarginIdr).toBe(margin);
    expect(money.sellerEntitlementIdr).toBe(entitlement);
  });

  it("keeps goods and shipping discounts separately seller-funded", () => {
    const money = calculateOrderFinance({
      subtotalIdr: 100_000,
      goodsDiscountIdr: 10_000,
      shippingListIdr: 20_000,
      shippingDiscountIdr: 20_000,
      shippingActualIdr: 20_000,
    });
    expect(money.goodsProceedsIdr).toBe(90_000);
    expect(money.shippingChargedIdr).toBe(0);
    expect(money.sellerShippingDebitIdr).toBe(20_000);
    expect(money.sellerEntitlementIdr).toBe(70_000);
  });

  // Owner ruling 2026-08-24: COD fee = 3% of (goods after discount + shipping charged), then PPN 11%
  // ON THE FEE. Straight percentage — NOT the old gross-up (× 0.03 / 0.97), and NOT on the payable
  // (that would tax the goods PPN and the fee itself).
  it("pins the COD fee: 3% of (omset + ongkir), + PPN 11% on the fee", () => {
    const money = calculateOrderFinance({
      subtotalIdr: 100_000,
      shippingListIdr: 20_000,
      paymentKind: "cod",
    });
    expect(money.codFeeBeforeVatIdr).toBe(3_600); // 120_000 × 3%
    expect(money.codFeeVatIdr).toBe(396); // 3_600 × 11%
    expect(money.codFeeFinalIdr).toBe(3_996);
    expect(money.buyerPayableIdr).toBe(123_996);
  });

  // Owner ruling 2026-08-24: the seller receives GOODS OMSET + GOODS PPN (they remit the tax);
  // shipping and payment-admin fees are platform money. So inclusive tax is NOT stripped from
  // proceeds and exclusive (added) tax IS credited to the seller — both tax modes land the seller
  // on the same all-in goods figure.
  it("seller entitlement carries the goods PPN in both tax modes", () => {
    const inclusive = calculateOrderFinance({
      subtotalIdr: 111_000,
      shippingListIdr: 0,
      salesTaxLiabilityIdr: 11_000,
      salesTaxAddedIdr: 0,
    });
    const exclusive = calculateOrderFinance({
      subtotalIdr: 100_000,
      shippingListIdr: 0,
      salesTaxLiabilityIdr: 11_000,
      salesTaxAddedIdr: 11_000,
    });
    expect(inclusive.goodsProceedsIdr).toBe(111_000); // sticker price IS the goods payment
    expect(exclusive.goodsProceedsIdr).toBe(100_000);
    expect(inclusive.sellerEntitlementIdr).toBe(111_000);
    expect(exclusive.sellerEntitlementIdr).toBe(111_000); // 100k omset + 11k added PPN
    expect(inclusive.orderPayableIdr).toBe(111_000);
    expect(exclusive.orderPayableIdr).toBe(111_000);
  });

  // NO TAX-ON-TAX: with exclusive goods PPN active, the COD base stays (goods after discount +
  // shipping) — the added PPN line is NOT part of any admin-fee base. The PPN belongs to the seller
  // (for remittance); charging 3% over it would silently fee the state's money.
  it("excludes the added goods PPN from the COD fee base", () => {
    const money = calculateOrderFinance({
      subtotalIdr: 100_000,
      shippingListIdr: 20_000,
      salesTaxLiabilityIdr: 11_000,
      salesTaxAddedIdr: 11_000,
      paymentKind: "cod",
    });
    expect(money.codFeeBeforeVatIdr).toBe(3_600); // (100k + 20k) × 3% — the 11k PPN is outside
    expect(money.sellerEntitlementIdr).toBe(111_000);
    expect(money.orderPayableIdr).toBe(100_000 + 11_000 + 20_000 + 3_996);
  });

  it("adds the authoritative gateway fee only to buyer payable", () => {
    const money = calculateOrderFinance({
      subtotalIdr: 100_000,
      shippingListIdr: 20_000,
      gatewayFeeIdr: 4_000,
      paymentKind: "prepaid",
    });
    expect(money.goodsProceedsIdr).toBe(100_000);
    expect(money.gatewayFeeIdr).toBe(4_000);
    expect(money.buyerPayableIdr).toBe(124_000);
  });
});
