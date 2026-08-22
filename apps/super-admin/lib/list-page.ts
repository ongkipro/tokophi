/**
 * The paging DECISION for Super Admin list screens — PURE. No React, no `@tokophi/db`.
 *
 * Same split as `platform-rank.ts` and `route-roles.ts`, and for the same reason: the rule lives in
 * a module a test can import, so "which rows does page 3 of a filtered list show?" is answered by
 * something runnable instead of by three expressions inlined in a `.tsx` that only a browser can
 * execute.
 *
 * Two decisions live here, and the second one is the bug this class keeps producing:
 *
 * ① `pageSlice` CLAMPS. A page index past the end returns the LAST page, never an empty list. The
 *    caller keeps its own `page` state, so the index and the data can disagree the instant the list
 *    shrinks; clamping here means the screen can never render "halaman 3" over nothing.
 * ② `filterChanged` is the "should the page reset to 1?" predicate. Filtering down to 2 results
 *    while sitting on page 3 renders an empty feed under a filter that matched — the classic. The
 *    comparison is elementwise `Object.is` over a tuple, which is exactly what a React effect's
 *    dependency array does, so the caller can reset DURING RENDER instead of in an effect.
 *
 * ⚠️ `ADMIN_LIST_PAGE_SIZE = 10` lives in `apps/admin/components/admin/list-pagination.tsx` and is
 * NOT importable from here — the two apps do not share `lib/`. Super Admin names its own size below.
 */

/**
 * Five entries per page on `/update-log`. Deliberately smaller than the Seller panel's 10: each row
 * there is a table line, each row here is a release note whose summary is a full paragraph.
 */
export const UPDATE_LOG_PAGE_SIZE = 5;

export type PageSlice<T> = {
  /** The page actually rendered — clamped into `1..pageCount`. */
  page: number;
  /** Always at least 1, so an empty list is "halaman 1 dari 1" rather than "dari 0". */
  pageCount: number;
  items: T[];
  /** 1-based index of the first item shown; **0** when there is nothing to show. */
  start: number;
  /** 1-based index of the last item shown; 0 when there is nothing to show. */
  end: number;
};

/**
 * Slice `items` for `page`. `page` is whatever the component happens to hold — a stale index, a
 * value below 1, a `NaN` out of a URL — and is clamped rather than trusted.
 */
export function pageSlice<T>(items: readonly T[], page: number, size: number): PageSlice<T> {
  // A size of 0 would make `pageCount` Infinity and `slice(0, 0)` blank every page.
  const perPage = Math.max(1, Math.floor(Number.isFinite(size) ? size : 1));
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));

  const wanted = Number.isFinite(page) ? Math.floor(page) : 1;
  const current = Math.min(Math.max(1, wanted), pageCount);

  const from = (current - 1) * perPage;
  const slice = items.slice(from, from + perPage);

  return {
    page: current,
    pageCount,
    items: slice,
    start: slice.length === 0 ? 0 : from + 1,
    end: slice.length === 0 ? 0 : from + slice.length,
  };
}

/**
 * Did the filter tuple change? `true` ⇒ the caller must reset its page index to 1.
 *
 * Elementwise `Object.is`, i.e. the same comparison React runs over a dependency array — the tuple
 * itself is rebuilt every render, so comparing identities would answer `true` forever.
 */
export function filterChanged(prev: readonly unknown[], next: readonly unknown[]): boolean {
  if (prev.length !== next.length) return true;
  return prev.some((value, index) => !Object.is(value, next[index]));
}
