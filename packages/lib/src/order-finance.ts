export type OrderFinanceInput = {
  subtotalIdr: number;
  goodsDiscountIdr?: number;
  shippingListIdr: number;
  shippingDiscountIdr?: number;
  salesTaxLiabilityIdr?: number;
  salesTaxAddedIdr?: number;
  shippingActualIdr?: number | null;
  paymentKind?: "prepaid" | "cod";
  gatewayFeeIdr?: number;
};

export type OrderFinance = {
  goodsDiscountIdr: number;
  shippingDiscountIdr: number;
  includedSalesTaxIdr: number;
  goodsProceedsIdr: number;
  shippingChargedIdr: number;
  shippingActualIdr: number | null;
  shippingDeltaIdr: number;
  sellerShippingDebitIdr: number;
  platformShippingMarginIdr: number;
  sellerEntitlementIdr: number;
  orderPayableIdr: number;
  codFeeBeforeVatIdr: number;
  codFeeVatIdr: number;
  codFeeFinalIdr: number;
  gatewayFeeIdr: number;
  buyerPayableIdr: number;
};

const idr = (value: number | null | undefined): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value ?? 0));
};

/**
 * Canonical immutable order-money calculation.
 *
 * `subtotalIdr` is the catalog goods total before discounts. Inclusive sales tax is removed from
 * seller proceeds; exclusive sales tax is added to buyer payable. Shipping and every platform fee
 * stay outside seller-withdrawable proceeds.
 */
export function calculateOrderFinance(input: OrderFinanceInput): OrderFinance {
  const subtotalIdr = idr(input.subtotalIdr);
  const goodsDiscountIdr = Math.min(subtotalIdr, idr(input.goodsDiscountIdr));
  const shippingListIdr = idr(input.shippingListIdr);
  const shippingDiscountIdr = Math.min(
    shippingListIdr,
    idr(input.shippingDiscountIdr),
  );
  const salesTaxLiabilityIdr = idr(input.salesTaxLiabilityIdr);
  const salesTaxAddedIdr = Math.min(
    salesTaxLiabilityIdr,
    idr(input.salesTaxAddedIdr),
  );
  const includedSalesTaxIdr = salesTaxLiabilityIdr - salesTaxAddedIdr;

  // ── SELLER RECEIVES GOODS OMSET + GOODS PPN — owner ruling 2026-08-24 ─────────────────────────
  // "seller/tenant hanya menerima nilai omset barang + ppn barang untuk rekonsiliasi — biaya
  // pengiriman dan admin pembayaran masuk di kita." So the goods PPN STAYS with the seller (they
  // remit it), and shipping + every payment fee are platform money. Concretely: inclusive tax is no
  // longer stripped out of proceeds, and exclusive (added) tax is credited in below. The previous
  // shape subtracted includedSalesTax here and excluded added tax entirely.
  const goodsProceedsIdr = Math.max(0, subtotalIdr - goodsDiscountIdr);
  const shippingChargedIdr = shippingListIdr - shippingDiscountIdr;
  const shippingActualIdr =
    input.shippingActualIdr == null ? null : idr(input.shippingActualIdr);
  const shippingDeltaIdr =
    shippingActualIdr == null ? 0 : shippingActualIdr - shippingChargedIdr;
  const sellerShippingDebitIdr = Math.max(0, shippingDeltaIdr);
  const platformShippingMarginIdr = Math.max(0, -shippingDeltaIdr);
  const sellerEntitlementIdr = goodsProceedsIdr + salesTaxAddedIdr - sellerShippingDebitIdr;

  const orderPayableBeforeCodIdr =
    subtotalIdr - goodsDiscountIdr + salesTaxAddedIdr + shippingChargedIdr;
  // ── COD FEE — owner ruling 2026-08-24: 3% of (goods omset + shipping), PPN 11% on the fee ─────
  // Replaces the old gross-up `payable × 0.03 / 0.97`. The base is what the owner named — goods
  // after discount plus the shipping actually charged — NOT the payable (which would tax the goods
  // PPN), and NOT grossed up (the fee is 3% of the base, full stop).
  const codBaseIdr = subtotalIdr - goodsDiscountIdr + shippingChargedIdr;
  const codFeeBeforeVatIdr =
    input.paymentKind === "cod" ? Math.round(codBaseIdr * 0.03) : 0;
  const codFeeVatIdr =
    input.paymentKind === "cod" ? Math.round(codFeeBeforeVatIdr * 0.11) : 0;
  const codFeeFinalIdr = codFeeBeforeVatIdr + codFeeVatIdr;
  const orderPayableIdr = orderPayableBeforeCodIdr + codFeeFinalIdr;
  const gatewayFeeIdr =
    input.paymentKind === "cod" ? 0 : idr(input.gatewayFeeIdr);

  return {
    goodsDiscountIdr,
    shippingDiscountIdr,
    includedSalesTaxIdr,
    goodsProceedsIdr,
    shippingChargedIdr,
    shippingActualIdr,
    shippingDeltaIdr,
    sellerShippingDebitIdr,
    platformShippingMarginIdr,
    sellerEntitlementIdr,
    orderPayableIdr,
    codFeeBeforeVatIdr,
    codFeeVatIdr,
    codFeeFinalIdr,
    gatewayFeeIdr,
    buyerPayableIdr: orderPayableIdr + gatewayFeeIdr,
  };
}
