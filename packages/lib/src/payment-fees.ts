// Payment-gateway fees charged to the buyer on storefront transactions.
// White-label: shoppers see "biaya pembayaran", never the provider name.

export type FeeKind = "va" | "ewallet" | "qris" | "retail";
export type Fee = { kind: FeeKind; label: string; type: "flat" | "pct"; value: number; note: string };

// value: flat = IDR/transaksi; pct = fraction of the transaction amount.
export const PAYMENT_FEES: Record<FeeKind, Fee> = {
  va: { kind: "va", label: "Virtual Account (semua bank)", type: "flat", value: 4_000, note: "Rp4.000 / transaksi" },
  ewallet: { kind: "ewallet", label: "E-Wallet (OVO, DANA, ShopeePay, dll)", type: "pct", value: 0.024, note: "2,4% / transaksi" },
  qris: { kind: "qris", label: "QRIS", type: "pct", value: 0.01, note: "1% / transaksi" },
  retail: { kind: "retail", label: "Minimarket (Indomaret, Alfamart)", type: "flat", value: 4_000, note: "Rp4.000 / transaksi" },
};

// The fee (IDR) for a transaction of `amount` paid via `kind`.
export function paymentFee(kind: FeeKind, amount: number): number {
  const f = PAYMENT_FEES[kind];
  return f.type === "flat" ? f.value : Math.round(amount * f.value);
}
