// Store affiliate programme — the pure half (specs/AFFILIATE_SPEC.md, F-A4/F-A6). No DB import, so the
// storefront, the order route and the Seller panel share ONE definition of a code and of the money.

/** What the shopper types and what `?ref=` carries: upper-case `[A-Z0-9]`, 3–20 chars. null = not a code. */
export function normalizeAffiliateCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z0-9]{3,20}$/.test(code) ? code : null;
}

/** Basis points → "10%" / "12,5%" (id-ID decimal comma). */
export function formatRateBps(bps: number): string {
  return `${(bps / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;
}

export type CommissionLine = {
  /** Line total BEFORE the order-level voucher (order_line_items.total_idr). */
  totalIdr: number;
  /** The product's override in basis points, or null for the store default. */
  rateBps: number | null;
};

export type CommissionResult = { baseIdr: number; commissionIdr: number; rateNote: string };

// F-A6: Σ line × (goodsProceeds / subtotal) × rate, floored to whole rupiah ONCE, at the end.
// The voucher is order-level, so it is spread over the lines pro rata — the same goods value the
// order's own `order_financials.goods_proceeds_idr` records, never the pre-discount subtotal.
export function computeAffiliateCommission(args: {
  lines: CommissionLine[];
  subtotalIdr: number;
  goodsProceedsIdr: number;
  defaultRateBps: number;
}): CommissionResult {
  const { lines, subtotalIdr, defaultRateBps } = args;
  const goods = Math.max(0, Math.min(args.goodsProceedsIdr, subtotalIdr));
  const rates = new Set<number>();
  if (subtotalIdr <= 0 || goods <= 0) return { baseIdr: 0, commissionIdr: 0, rateNote: formatRateBps(defaultRateBps) };
  // Work in rupiah × bps to keep every intermediate an integer-valued number until the final floor.
  let scaled = 0;
  for (const l of lines) {
    const bps = clampBps(l.rateBps ?? defaultRateBps);
    rates.add(bps);
    scaled += l.totalIdr * bps;
  }
  const commissionIdr = Math.floor((scaled * goods) / subtotalIdr / 10_000);
  const rateNote = [...rates].sort((a, b) => a - b).map(formatRateBps).join(" / ");
  return { baseIdr: goods, commissionIdr, rateNote };
}

/** 0–100% — a rate outside it is a data error, never a payout instruction. */
export function clampBps(bps: number): number {
  if (!Number.isFinite(bps)) return 0;
  return Math.min(10_000, Math.max(0, Math.round(bps)));
}

/**
 * A readable code from a name: up to 6 letters of it + 3 digits ("Sari Dewi" → "SARIDE482"). The caller
 * retries on the per-store unique constraint; `rand` is injectable so the shape is testable.
 */
export function suggestAffiliateCode(name: string, rand: () => number = Math.random): string {
  const letters = name.normalize("NFKD").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6);
  const stem = letters.length >= 3 ? letters : `AFF${letters}`.slice(0, 6);
  return `${stem}${String(Math.floor(rand() * 900) + 100)}`;
}
