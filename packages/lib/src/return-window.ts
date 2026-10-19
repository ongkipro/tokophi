// The store's own return window (store_settings.return_window_days, migrations 0119 + 0120). NULL = the
// store has not declared one, and nothing about returns is shown to a buyer — we never invent a promise.
//
// Unit and floor come from the primary text of PP 80/2019 Pasal 69 ayat (1), read 2026-10-19: a merchant and
// an e-commerce operator must give "jangka waktu paling sedikit 2 (dua) hari kerja" for exchanging goods or
// cancelling a purchase, counted from receipt. So a declared window is in HARI KERJA and is at least 2; a
// declared 1 would promise less than the regulation's floor. (Whether the floor applies to a given store is a
// legal question — see spec §20.5 — but the product must never let a store publish a number below it.)
import { parseWorkingDays, type WorkingDaysParse } from "./working-days";

export const RETURN_WINDOW_MIN_DAYS = 2;
export const RETURN_WINDOW_MAX_DAYS = 90;

export type ReturnWindowParse = WorkingDaysParse;

const INVALID = `Isi angka bulat ${RETURN_WINDOW_MIN_DAYS}–${RETURN_WINDOW_MAX_DAYS} (hari kerja), atau kosongkan bila toko tidak menjanjikan jendela retur.`;

/** Form input → a stored value: working days 2–90 (the floor is PP 80/2019 Pasal 69(1)), or null = not declared. */
export const parseReturnWindow = (v: unknown): ReturnWindowParse => parseWorkingDays(v, RETURN_WINDOW_MIN_DAYS, RETURN_WINDOW_MAX_DAYS, INVALID);

/** What a buyer reads. The window starts at receipt; we hold no arrival date, so no date is computed. */
export function returnWindowLine(days: number | null | undefined): string | null {
  return days && days > 0 ? `Toko ini menerima pengajuan retur selama ${days} hari kerja setelah barang diterima.` : null;
}
