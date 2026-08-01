import { describe, expect, it } from "vitest";
import { publishedAtFor } from "./publish-date";

// The one property that matters: a publish date NEVER moves backwards on a re-save. That is the bug
// this rule exists for — `publishedAt` was a frozen `2026-06-30`, and because the articles action is
// a full field replace, every Simpan re-stamped the seed's frame over the truth.
describe("publishedAtFor", () => {
  const published = new Date("2026-07-20T08:30:00Z");

  it("keeps the row's own date when an already-published article is re-saved", () => {
    expect(publishedAtFor(true, published)).toEqual(published);
  });

  it("does not walk the date backwards across repeated saves", () => {
    let at = published;
    for (let i = 0; i < 5; i++) {
      const next = publishedAtFor(true, at);
      expect(next!.getTime()).toBeGreaterThanOrEqual(at.getTime());
      at = next!;
    }
    expect(at).toEqual(published); // and in fact it never moved at all
  });

  it("stamps the real clock on FIRST publish — never the seed's anchor", () => {
    const now = new Date("2026-08-01T03:00:00Z");
    expect(publishedAtFor(true, null, now)).toEqual(now);
    // The bug: this used to be 2026-06-30, i.e. in the past on the day the article went live.
    expect(publishedAtFor(true, null, now)!.getTime()).toBeGreaterThan(Date.parse("2026-06-30T00:00:00Z"));
  });

  it("clears the date when the article goes back to draft, and re-stamps on re-publish", () => {
    expect(publishedAtFor(false, published)).toBeNull();
    const now = new Date("2026-08-01T03:00:00Z");
    expect(publishedAtFor(true, null, now)).toEqual(now);
  });
});
