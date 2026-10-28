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
  // `scaled * goods` passes 2^53 on ordinary Indonesian order sizes (first divergence measured at
  // subtotal 13.095.367 with a voucher: 1.178.582 instead of 1.178.583), so the product and the floor
  // are done in BigInt. Only vouchered orders can diverge — when goods === subtotal the division is exact.
  const commissionIdr = Number((BigInt(scaled) * BigInt(goods)) / (BigInt(subtotalIdr) * 10_000n));
  const rateNote = [...rates].sort((a, b) => a - b).map(formatRateBps).join(" / ");
  return { baseIdr: goods, commissionIdr, rateNote };
}

export const AFFILIATE_HOLD_MAX_DAYS = 90;

const RATE_INVALID = "Isi persentase 0–100, mis. 10 atau 12,5.";
const HOLD_INVALID = `Isi angka bulat 0–${AFFILIATE_HOLD_MAX_DAYS} (hari).`;

export type RateParse = { ok: true; bps: number } | { ok: false; error: string };
export type HoldParse = { ok: true; days: number } | { ok: false; error: string };

/**
 * Form input → `affiliate_rate_bps`. REFUSED, never guessed — an affiliate reads this number as their pay.
 *
 * `Number("10%")` is `NaN`, and the `|| 0` that used to follow it turned a seller's typo into a SILENT 0%
 * programme: the save succeeded, the toast said "disimpan", and every order attributed from that moment
 * froze `commission_idr = 0` into `affiliate_commissions`. Because a commission is frozen at order time,
 * fixing the setting afterwards does not repair those orders — the affiliate is simply never paid for them.
 * Same discipline as `parseWorkingDays`, for the same reason: a number somebody is owed money by.
 *
 * Basis points are the storage unit, so two decimals of a percent are exact and a third is refused rather
 * than rounded away.
 */
export function parseAffiliateRatePct(v: unknown): RateParse {
  let pct: number;
  if (typeof v === "number") pct = v;
  else if (typeof v === "string") {
    const m = /^\s*(\d{1,3})(?:[.,](\d{1,2}))?\s*%?\s*$/.exec(v);
    if (!m) return { ok: false, error: RATE_INVALID };
    pct = Number(`${m[1]}.${m[2] ?? "0"}`);
  } else return { ok: false, error: RATE_INVALID };
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { ok: false, error: RATE_INVALID };
  // Round the SCALED value: 12.5 * 100 is 1250.0000000000002 in binary floating point.
  return { ok: true, bps: Math.round(pct * 100) };
}

/** Form input → `affiliate_hold_days`. 0 is legitimate (payable as soon as the order finishes); blank is not. */
export function parseAffiliateHoldDays(v: unknown): HoldParse {
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") {
    const m = /^\s*(\d{1,3})\s*(?:hari)?\s*$/i.exec(v);
    if (!m) return { ok: false, error: HOLD_INVALID };
    n = Number(m[1]);
  } else return { ok: false, error: HOLD_INVALID };
  if (!Number.isInteger(n) || n < 0 || n > AFFILIATE_HOLD_MAX_DAYS) return { ok: false, error: HOLD_INVALID };
  return { ok: true, days: n };
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
