// The store's own return window (store_settings.return_window_days, migrations 0119 + 0120). NULL = the
// store has not declared one, and nothing about returns is shown to a buyer — we never invent a promise.
//
// Unit and floor come from the primary text of PP 80/2019 Pasal 69 ayat (1), read 2026-10-19: a merchant and
// an e-commerce operator must give "jangka waktu paling sedikit 2 (dua) hari kerja" for exchanging goods or
// cancelling a purchase, counted from receipt. So a declared window is in HARI KERJA and is at least 2; a
// declared 1 would promise less than the regulation's floor. (Whether the floor applies to a given store is a
// legal question — see spec §20.5 — but the product must never let a store publish a number below it.)
export const RETURN_WINDOW_MIN_DAYS = 2;
export const RETURN_WINDOW_MAX_DAYS = 90;

export type ReturnWindowParse = { ok: true; days: number | null } | { ok: false; error: string };

const INVALID = `Isi angka bulat ${RETURN_WINDOW_MIN_DAYS}–${RETURN_WINDOW_MAX_DAYS} (hari kerja), atau kosongkan bila toko tidak menjanjikan jendela retur.`;

/**
 * Form input → a stored value. Strict on purpose: this number is read by buyers as a promise, so anything
 * ambiguous is refused instead of guessed. "7,5" and "1.000" (Indonesian decimal / thousands separators)
 * used to collapse to 75 and 1 when non-digits were stripped; now they are errors the merchant sees.
 * Empty means "not declared" (null). A whole number of working days 2–90, optionally followed by "hari"
 * or "hari kerja", is accepted.
 */
export function parseReturnWindow(v: unknown): ReturnWindowParse {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return { ok: true, days: null };
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") {
    const m = /^\s*(\d{1,3})\s*(?:hari(?:\s+kerja)?)?\s*$/i.exec(v);
    if (!m) return { ok: false, error: INVALID };
    n = Number(m[1]);
  } else return { ok: false, error: INVALID };
  if (!Number.isInteger(n) || n < RETURN_WINDOW_MIN_DAYS || n > RETURN_WINDOW_MAX_DAYS) return { ok: false, error: INVALID };
  return { ok: true, days: n };
}

/** What a buyer reads. The window starts at receipt; we hold no arrival date, so no date is computed. */
export function returnWindowLine(days: number | null | undefined): string | null {
  return days && days > 0 ? `Toko ini menerima pengajuan retur selama ${days} hari kerja setelah barang diterima.` : null;
}
