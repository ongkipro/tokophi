// The store's own return window (store_settings.return_window_days, migration 0119). NULL = the store has
// not declared one, and nothing about returns is shown to a buyer — we never invent a promise.
export const RETURN_WINDOW_MAX_DAYS = 90;

export type ReturnWindowParse = { ok: true; days: number | null } | { ok: false; error: string };

const INVALID = `Isi angka bulat 1–${RETURN_WINDOW_MAX_DAYS} (hari), atau kosongkan bila toko tidak menjanjikan jendela retur.`;

/**
 * Form input → a stored value. Strict on purpose: this number is read by buyers as a promise, so anything
 * ambiguous is refused instead of guessed. "7,5" and "1.000" (Indonesian decimal / thousands separators)
 * used to collapse to 75 and 1 when non-digits were stripped; now they are errors the merchant sees.
 * Empty means "not declared" (null). A whole number 1–90, optionally followed by "hari", is accepted.
 */
export function parseReturnWindow(v: unknown): ReturnWindowParse {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return { ok: true, days: null };
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") {
    const m = /^\s*(\d{1,3})\s*(?:hari)?\s*$/i.exec(v);
    if (!m) return { ok: false, error: INVALID };
    n = Number(m[1]);
  } else return { ok: false, error: INVALID };
  if (!Number.isInteger(n) || n < 1 || n > RETURN_WINDOW_MAX_DAYS) return { ok: false, error: INVALID };
  return { ok: true, days: n };
}

/** What a buyer reads. The window starts at receipt; we hold no arrival date, so no date is computed. */
export function returnWindowLine(days: number | null | undefined): string | null {
  return days && days > 0 ? `Toko ini menerima pengajuan retur selama ${days} hari setelah barang diterima.` : null;
}
