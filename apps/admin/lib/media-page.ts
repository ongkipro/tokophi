// Files (Pustaka media) shows one bounded page at a time; the page number lives in the URL.
export const MEDIA_PAGE_SIZE = 24;

/** `?page=` → a 1-based page that exists. Junk → 1; past the end (e.g. after deleting the last file of the last page) → the last page. */
export function clampMediaPage(raw: string | undefined, total: number, size = MEDIA_PAGE_SIZE): number {
  const last = Math.max(1, Math.ceil(total / size));
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, last) : 1;
}
