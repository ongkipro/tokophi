// Payment-gateway fees charged per successful storefront transaction (AutoLaris PSP schedule).
// The merchant chooses who bears the fee: the seller (absorb), the buyer (added at checkout),
// or split 50:50. White-label — the client sees "biaya pembayaran", never the provider name.

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

export type FeeBearer = "seller" | "buyer" | "split";
export const FEE_BEARERS: { key: FeeBearer; label: string; desc: string }[] = [
  { key: "seller", label: "Penjual", desc: "Biaya dipotong dari hasil penjualan Anda" },
  { key: "buyer", label: "Pembeli", desc: "Biaya ditambahkan ke total yang dibayar pembeli" },
  { key: "split", label: "50 : 50", desc: "Biaya dibagi rata antara Anda dan pembeli" },
];
export const feeBearerLabel = (b: FeeBearer) => FEE_BEARERS.find((x) => x.key === b)?.label ?? b;

// How a fee splits into what the buyer adds vs what the seller absorbs, given the bearer choice.
export function splitFee(fee: number, bearer: FeeBearer): { buyer: number; seller: number } {
  if (bearer === "buyer") return { buyer: fee, seller: 0 };
  if (bearer === "split") { const buyer = Math.round(fee / 2); return { buyer, seller: fee - buyer }; }
  return { buyer: 0, seller: fee };
}
