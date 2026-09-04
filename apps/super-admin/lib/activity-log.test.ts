import { describe, expect, it } from "vitest";
import { platformActivityKind } from "@tokophi/db/schema";
import { ACTIVITY_KINDS, LOG_PAGE_SIZE, logHref, logPages, parseLogQuery } from "./activity-log";

// `/log-sistem` takes two filters straight off the URL and hands them to Postgres: `kind` lands on an
// enum column and `toko` on a uuid column. Either one unchecked is a 500 (`22P02` / invalid enum
// input) where "no filter" belongs — the `/pesanan?bayar=` defect, again. These pin the whitelist.

describe("parseLogQuery — the URL never reaches a cast unchecked", () => {
  it("keeps the kind list equal to the database enum", () => {
    expect([...ACTIVITY_KINDS].sort()).toEqual([...platformActivityKind.enumValues].sort());
  });

  it("drops a kind that is not on the enum instead of passing it through", () => {
    expect(parseLogQuery({ kind: "admin" }).kind).toBe("admin");
    for (const bad of ["ADMIN", "delete", "", "admin'--"]) {
      expect(parseLogQuery({ kind: bad }).kind, bad).toBeNull();
    }
    // A repeated parameter takes the first value, the way a form submits it.
    expect(parseLogQuery({ kind: ["payment", "x"] }).kind).toBe("payment");
  });

  it("drops a store id that is not a uuid", () => {
    const id = "9F0B7E7C-0000-4000-8000-000000000002";
    expect(parseLogQuery({ toko: id }).storeId).toBe(id.toLowerCase());
    for (const bad of ["1", "batik-nusantara", "9f0b7e7c-0000-4000-8000-00000000000", "x' or 1=1"]) {
      expect(parseLogQuery({ toko: bad }).storeId, bad).toBeNull();
    }
  });

  it("clamps the page to a positive integer and trims the search", () => {
    expect(parseLogQuery({}).page).toBe(1);
    for (const bad of ["0", "-3", "abc", "NaN", "1e400"]) expect(parseLogQuery({ page: bad }).page, bad).toBe(1);
    expect(parseLogQuery({ page: "7" }).page).toBe(7);
    expect(parseLogQuery({ q: "  toko  " }).q).toBe("toko");
    expect(parseLogQuery({ q: "x".repeat(500) }).q.length).toBe(120);
  });
});

describe("logHref — pagination links keep the filters", () => {
  it("round-trips through parseLogQuery", () => {
    const q = parseLogQuery({ kind: "payment", toko: "9f0b7e7c-0000-4000-8000-000000000002", q: "VA & QRIS", page: "3" });
    const href = logHref(q);
    const back = parseLogQuery(Object.fromEntries(new URL(href, "http://x").searchParams));
    expect(back).toEqual(q);
  });

  it("omits page=1 and empty filters", () => {
    expect(logHref(parseLogQuery({}))).toBe("/log-sistem");
    expect(logHref(parseLogQuery({ kind: "admin" }), 1)).toBe("/log-sistem?kind=admin");
    expect(logHref(parseLogQuery({ kind: "admin" }), 2)).toBe("/log-sistem?kind=admin&page=2");
  });
});

describe("logPages — page count comes from the database total", () => {
  it("derives the count from total rows, and clamps the current page into it", () => {
    expect(logPages(0, 1)).toEqual({ pageCount: 1, page: 1, numbers: [1] });
    expect(logPages(LOG_PAGE_SIZE, 1).pageCount).toBe(1);
    expect(logPages(LOG_PAGE_SIZE + 1, 1).pageCount).toBe(2);
    // A `?page=99` on a 3-page log renders page 3, never "halaman 99" over nothing.
    expect(logPages(LOG_PAGE_SIZE * 3, 99).page).toBe(3);
  });

  it("renders first, last and the neighbours only", () => {
    expect(logPages(LOG_PAGE_SIZE * 10, 5).numbers).toEqual([1, 4, 5, 6, 10]);
  });
});
