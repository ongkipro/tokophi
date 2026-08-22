import { describe, expect, it } from "vitest";
import { UPDATE_LOG_PAGE_SIZE, filterChanged, pageSlice } from "./list-page";

/**
 * `/update-log` renders 14 release notes; page 3 holds 4 of them. Every assertion below was proved
 * RED against a mutation of `list-page.ts` before being trusted green — the matrix is in
 * `BUILD-LOG.md`. A guard nobody has seen fail is a guard nobody has tested.
 *
 * The two shapes that produce a blank screen over data that exists:
 *   · a page index past the end (the list shrank under a filter, the index did not), and
 *   · a filter change that leaves the index where it was.
 * Both are decided here, not in the component, so they are testable without a browser.
 */

const ITEMS = Array.from({ length: 14 }, (_, i) => `log-${i + 1}`);

describe("pageSlice", () => {
  it("an empty list is one page, zero rows, and start/end are 0 — never '1–0 dari 0'", () => {
    const view = pageSlice([], 1, UPDATE_LOG_PAGE_SIZE);
    expect(view.items).toEqual([]);
    // pageCount 0 would render "halaman 1 dari 0"; the floor of 1 is what keeps the empty state honest.
    expect(view.pageCount).toBe(1);
    expect(view.page).toBe(1);
    expect(view.start).toBe(0);
    expect(view.end).toBe(0);
  });

  it("an exact multiple of the page size does NOT grow a trailing empty page", () => {
    // 10 / 5 = 2. A `Math.floor(total / size) + 1` would answer 3 and hand the operator an empty page.
    const view = pageSlice(ITEMS.slice(0, 10), 2, 5);
    expect(view.pageCount).toBe(2);
    expect(view.items).toEqual(["log-6", "log-7", "log-8", "log-9", "log-10"]);
    expect(view.start).toBe(6);
    expect(view.end).toBe(10);
  });

  it("the last page is partial and reports its real length", () => {
    // 14 entries, 5 per page → 3 pages, the last holding 4. `end` must be 14, not 15.
    const view = pageSlice(ITEMS, 3, UPDATE_LOG_PAGE_SIZE);
    expect(view.pageCount).toBe(3);
    expect(view.items).toEqual(["log-11", "log-12", "log-13", "log-14"]);
    expect(view.start).toBe(11);
    expect(view.end).toBe(14);
  });

  it("a page index beyond the end CLAMPS to the last page — it never blanks", () => {
    // The live shape: the operator is on page 3, types into the search box, 14 rows become 6.
    const view = pageSlice(ITEMS.slice(0, 6), 3, UPDATE_LOG_PAGE_SIZE);
    expect(view.pageCount).toBe(2);
    expect(view.page).toBe(2);
    expect(view.items).toEqual(["log-6"]);
    expect(view.items.length).toBeGreaterThan(0);
  });

  it("a page index below 1, or not a number at all, falls back to page 1", () => {
    for (const bad of [0, -7, Number.NaN]) {
      const view = pageSlice(ITEMS, bad, UPDATE_LOG_PAGE_SIZE);
      expect(view.page, `page=${bad}`).toBe(1);
      expect(view.items[0], `page=${bad}`).toBe("log-1");
    }
  });

  it("every entry is reachable exactly once across the pages, with no gap and no repeat", () => {
    const { pageCount } = pageSlice(ITEMS, 1, UPDATE_LOG_PAGE_SIZE);
    const seen: string[] = [];
    for (let p = 1; p <= pageCount; p += 1) seen.push(...pageSlice(ITEMS, p, UPDATE_LOG_PAGE_SIZE).items);
    expect(seen).toEqual(ITEMS);
  });
});

describe("filterChanged — the page must reset to 1 when the filter moves", () => {
  it("is false for an equal tuple rebuilt on every render", () => {
    // The component builds `[search, category, surface] as const` fresh each render, so identity
    // comparison would answer true forever and pin the screen to page 1.
    expect(filterChanged(["", "all", "all"], ["", "all", "all"])).toBe(false);
  });

  it("is true when ANY member of the tuple changes", () => {
    expect(filterChanged(["", "all", "all"], ["rls", "all", "all"])).toBe(true);
    expect(filterChanged(["", "all", "all"], ["", "security", "all"])).toBe(true);
    expect(filterChanged(["", "all", "all"], ["", "all", "Payments"])).toBe(true);
  });

  it("uses Object.is, so NaN-to-NaN is unchanged and 0/-0 is a change", () => {
    // `===` would report NaN as a change on every render; this is the same comparison a React
    // dependency array runs, which is what makes the render-time reset equivalent to the effect.
    expect(filterChanged([Number.NaN], [Number.NaN])).toBe(false);
    expect(filterChanged([0], [-0])).toBe(true);
  });

  it("a tuple that gained or lost a member counts as changed", () => {
    // A new filter control is added by extending the tuple; resetting once at that moment is right.
    expect(filterChanged(["", "all"], ["", "all", "all"])).toBe(true);
  });
});
