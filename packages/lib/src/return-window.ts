// The store's own return window (store_settings.return_window_days, migration 0119). NULL = the store has
// not declared one, and nothing about returns is shown to a buyer — we never invent a promise.
export const RETURN_WINDOW_MAX_DAYS = 90;

/** Form input → a stored value: a whole number of days in 1…90, or null for "not declared". */
export function normalizeReturnWindow(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(/[^0-9.-]/g, "")) : NaN;
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(RETURN_WINDOW_MAX_DAYS, Math.round(n));
}

/** What a buyer reads. The window starts at receipt; we hold no arrival date, so no date is computed. */
export function returnWindowLine(days: number | null | undefined): string | null {
  return days && days > 0 ? `Toko ini menerima pengajuan retur selama ${days} hari setelah barang diterima.` : null;
}
