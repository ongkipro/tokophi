// Payment-gateway fees charged to the buyer on storefront transactions.
// White-label: shoppers see "biaya pembayaran", never the provider name.
//
// ── FEE SCHEDULE — owner ruling 2026-08-24 ────────────────────────────────────────────────────────
// · QRIS       0,7% — of the GOODS OMSET (subtotal after goods discount), NOT of the payable total.
//              The owner's words were "0,7% dari nilai omset"; charging it on the payable would tax
//              the shipping and the fee itself.
// · VA         flat per transaction, PER BANK: BCA Rp6.500, every other bank Rp3.500. The bank is a
//              CHANNEL code (platform_payment_channels.channel, e.g. "VABCA"), so the split lives in
//              CHANNEL_FEE_OVERRIDES — adding a bank with its own price is a data edit, not a deploy.
// · E-wallet / retail unchanged (the ruling named only QRIS and VA).
// · COD is NOT here — it is 3% of (goods omset + shipping) + PPN 11% on the fee, computed inside
//   `calculateOrderFinance` (@tokophi/lib/order-finance), because it changes the ORDER total, not
//   just the gateway line.
//
// ⚠️ `base` is part of the fee's identity. A pct fee without a declared base is how QRIS was 1% of
// the payable for months: every caller picked its own denominator. Both the checkout mirror and the
// order API read THIS field; neither may hardcode a base again.

export type FeeKind = "va" | "ewallet" | "qris" | "retail";
export type FeeBase = "omset" | "payable";
export type Fee = { kind: FeeKind; label: string; type: "flat" | "pct"; value: number; base: FeeBase; note: string };

// value: flat = IDR/transaksi; pct = fraction of the declared base.
export const PAYMENT_FEES: Record<FeeKind, Fee> = {
  va: { kind: "va", label: "Virtual Account (semua bank)", type: "flat", value: 3_500, base: "payable", note: "Rp3.500 / transaksi (BCA Rp6.500)" },
  ewallet: { kind: "ewallet", label: "E-Wallet (OVO, DANA, ShopeePay, dll)", type: "pct", value: 0.024, base: "payable", note: "2,4% / transaksi" },
  qris: { kind: "qris", label: "QRIS", type: "pct", value: 0.007, base: "omset", note: "0,7% dari nilai barang" },
  retail: { kind: "retail", label: "Minimarket (Indomaret, Alfamart)", type: "flat", value: 4_000, base: "payable", note: "Rp4.000 / transaksi" },
};

/** Per-CHANNEL flat overrides, keyed by `platform_payment_channels.channel`. Flat fees only. */
export const CHANNEL_FEE_OVERRIDES: Record<string, number> = {
  VABCA: 6_500,
};

/** The flat value (or pct fraction) a specific channel charges — the override wins for flats. */
export function channelFeeValue(kind: FeeKind, channelCode?: string | null): number {
  const f = PAYMENT_FEES[kind];
  if (f.type === "flat" && channelCode && channelCode in CHANNEL_FEE_OVERRIDES) return CHANNEL_FEE_OVERRIDES[channelCode];
  return f.value;
}

/**
 * The fee (IDR) for one transaction. `amounts` carries BOTH candidate bases; the fee's own `base`
 * field decides which one is read — so a caller cannot quietly pick the wrong denominator.
 */
export function paymentFee(
  kind: FeeKind,
  amounts: { omsetIdr: number; payableIdr: number },
  channelCode?: string | null,
): number {
  const f = PAYMENT_FEES[kind];
  const value = channelFeeValue(kind, channelCode);
  if (f.type === "flat") return value;
  const base = f.base === "omset" ? amounts.omsetIdr : amounts.payableIdr;
  return Math.round(Math.max(0, base) * value);
}
