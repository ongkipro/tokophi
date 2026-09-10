// Payment-gateway fees charged to the buyer on storefront transactions.
// White-label: shoppers see "biaya pembayaran", never the provider name.
//
// ── FEE SCHEDULE — owner ruling 2026-08-24 ────────────────────────────────────────────────────────
// · QRIS       0,7% — of the GOODS OMSET (subtotal after goods discount), NOT of the payable total.
//              The owner's words were "0,7% dari nilai omset"; charging it on the payable would tax
//              the shipping and the fee itself.
// · VA         flat per transaction, PER BANK: BCA Rp6.500, every other bank Rp3.000. The bank is a
//              CHANNEL code (platform_payment_channels.channel, e.g. "VABCA"), so the split lives in
//              CHANNEL_FEE_OVERRIDES — adding a bank with its own price is a data edit, not a deploy.
//              ⚠️ **LOWERED from Rp3.500 by owner ruling 2026-09-10, and it was an OVERCHARGE, not a
//              margin.** `GET /api/h2h/list_payment` reports what the provider actually bills THIS
//              account, and every non-BCA bank it offers is Rp3.000 `fix` (measured live 2026-09-10:
//              VABNI, VAPERMATA, VAMANDIRI, VABRI all `admin: "3000.0"`, VABCA `"6500.0"`). So for
//              two and a half weeks the buyer paid Rp500 more than the transaction cost us, on the
//              cheapest payment method we offer. The mirror image of the e-wallet defect below.
//              🔴 THE DEFAULT MOVED — four overrides were NOT added, deliberately. Of the five VA
//              banks the provider offers, four are Rp3.000 and one is Rp6.500; NONE is Rp3.500.
//              Four override rows all equal to a new default would leave that default matching no
//              bank at all, so the next bank the provider enables would be billed Rp3.500 silently.
//              The default is the common case; BCA is the exception, and it stays the only one.
// · E-wallet 3,0% — RAISED from 2,4% by owner ruling 2026-09-09, to match what the provider
//              actually charges the account: `GET /api/h2h/list_payment` reports OVO at 3,0%
//              `persen` (measured live 2026-09-09), so 2,4% meant the platform absorbed 0,6 pp on
//              every e-wallet sale. OVO is the ONLY e-wallet the account offers — DANA/ShopeePay/
//              LinkAja/GoPay are absent from `list_payment` — so this is an OVO figure in practice.
//              ⚠️ A per-channel PCT override does not exist (`CHANNEL_FEE_OVERRIDES` is flat-only);
//              adding a second e-wallet at a different rate needs that machinery first.
// · Retail unchanged (the 2026-08-24 ruling named only QRIS and VA).
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
  va: { kind: "va", label: "Virtual Account (semua bank)", type: "flat", value: 3_000, base: "payable", note: "Rp3.000 / transaksi (BCA Rp6.500)" },
  ewallet: { kind: "ewallet", label: "E-Wallet (OVO, DANA, ShopeePay, dll)", type: "pct", value: 0.03, base: "payable", note: "3% / transaksi" },
  qris: { kind: "qris", label: "QRIS", type: "pct", value: 0.007, base: "omset", note: "0,7% dari nilai barang" },
  retail: { kind: "retail", label: "Minimarket (Indomaret, Alfamart)", type: "flat", value: 4_000, base: "payable", note: "Rp4.000 / transaksi" },
};

/**
 * Per-CHANNEL flat overrides, keyed by `platform_payment_channels.channel`. Flat fees only.
 *
 * BCA is the ONLY entry and that is the point: it is the only bank the provider prices differently
 * from the rest (Rp6.500 against Rp3.000, measured on `list_payment` 2026-09-10). An override that
 * merely restates the default is not documentation, it is a second place for the number to rot.
 */
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
