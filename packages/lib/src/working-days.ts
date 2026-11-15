// One parser for "a whole number of working days, within a range" — used by every store-declared period a
// buyer reads as a promise (return window, complaint resolution). Strict on purpose: anything ambiguous is
// refused instead of guessed. "7,5" and "1.000" (Indonesian decimal / thousands separators) used to collapse
// to 75 and 1 when non-digits were stripped; they are errors now. Empty means "not declared" (null).
export type WorkingDaysParse = { ok: true; days: number | null } | { ok: false; error: string };

/** A whole number min–max, optionally followed by "hari" or "hari kerja". */
export function parseWorkingDays(v: unknown, min: number, max: number, error: string): WorkingDaysParse {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return { ok: true, days: null };
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") {
    const m = /^\s*(\d{1,3})\s*(?:hari(?:\s+kerja)?)?\s*$/i.exec(v);
    if (!m) return { ok: false, error };
    n = Number(m[1]);
  } else return { ok: false, error };
  if (!Number.isInteger(n) || n < min || n > max) return { ok: false, error };
  return { ok: true, days: n };
}
