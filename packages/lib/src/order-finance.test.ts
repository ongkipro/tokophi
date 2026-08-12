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

  it("pins the self-inclusive COD fee and fee VAT rounding", () => {
    const money = calculateOrderFinance({
      subtotalIdr: 100_000,
      shippingListIdr: 20_000,
      paymentKind: "cod",
    });
    expect(money.codFeeBeforeVatIdr).toBe(3_711);
    expect(money.codFeeVatIdr).toBe(408);
    expect(money.codFeeFinalIdr).toBe(4_119);
    expect(money.buyerPayableIdr).toBe(124_119);
  });

  it("excludes inclusive and exclusive sales-tax liabilities from seller proceeds", () => {
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
    expect(inclusive.goodsProceedsIdr).toBe(100_000);
    expect(exclusive.goodsProceedsIdr).toBe(100_000);
    expect(inclusive.orderPayableIdr).toBe(111_000);
    expect(exclusive.orderPayableIdr).toBe(111_000);
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
