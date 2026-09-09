import { describe, expect, it } from "vitest";
import { NO_FIGURE, pct } from "@tokophi/lib/format";
import { getMoneyTiles, getSummary, getVisitsKpi, getConversionKpi } from "./dashboard";
import type { DayPoint } from "@/lib/types/domain";
import type { FunnelDay } from "@/lib/data/funnel";

// "A FIGURE WITH NO SOURCE IS '—', NEVER A NUMBER" — the standing rule, applied to the DELTA rather
// than the value. `delta()` returned `0` for an empty denominator, so the empty seeded store
// (`snack-rumahan-bu-tati`: 0 products, 0 orders, 0 customers) was told
// "Penjualan hari ini **+0,0%** vs kemarin" — measured in a browser on 2026-08-05, on all three
// money tiles. "+0,0%" is a claim that nothing CHANGED. The truth was that there was nothing to
// compare against at all.
//
// ⚠️ AND THE OTHER SIDE OF THE BOUNDARY IS WHAT MAKES THIS HARD. A store that genuinely sold Rp0
// today after selling yesterday has a REAL −100%: that is a measurement of a collapse, and hiding it
// behind an em dash would be the same lie pointing the other way. The boundary is the DENOMINATOR.

const day = (date: string, sales: number, orders = 0, visitors = 0): DayPoint => ({
  date, ts: Date.parse(`${date}T00:00:00Z`), sales, orders, visitors,
});

/** 60 DENSE days ending 2026-03-01, every one of them empty — a brand-new store, like the seed's. */
const emptySeries = (): DayPoint[] =>
  Array.from({ length: 60 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, 1) + i * 86_400_000);
    return day(d.toISOString().slice(0, 10), 0);
  });

describe("a delta with no previous period is null, and null renders as no figure", () => {
  it("every KPI of a store with no history has a null delta — not 0", () => {
    const s = getSummary(emptySeries(), "today");
    expect(s.sales.delta).toBeNull();
    expect(s.orders.delta).toBeNull();
    expect(s.visitors.delta).toBeNull();
    expect(s.conversion.delta).toBeNull();
    expect(s.aov.delta).toBeNull();
    // What the merchant would have read before: a measurement of "no change".
    expect(pct(s.sales.delta)).toBe(NO_FIGURE);
    expect(pct(s.sales.delta)).not.toBe("0,0%");
  });

  it("all three money tiles carry it — the strip is where '+0,0%' was measured", () => {
    for (const t of getMoneyTiles(emptySeries())) {
      expect(t.delta, t.label).toBeNull();
      expect(pct(t.delta), t.label).toBe(NO_FIGURE);
    }
  });

  it("the event-counted KPIs use the same rule", () => {
    const all = emptySeries();
    // Only the CURRENT day has events, so the comparison period counted zero visits.
    const withEvents: FunnelDay[] = [
      { date: all[all.length - 1].date, type: "visit", count: 3 },
      { date: all[all.length - 1].date, type: "purchase", count: 1 },
    ];
    expect(getVisitsKpi(withEvents, all, "today")?.delta).toBeNull();
    expect(getConversionKpi(withEvents, all, "today")?.delta).toBeNull();
    // No events AT ALL is still `null` for the whole KPI — an older, separate contract that the
    // screen renders as an honest empty state rather than a zero.
    expect(getVisitsKpi([], all, "today")).toBeNull();
  });
});

describe("⚠️ a REAL zero is a measurement and must stay a number", () => {
  // Two days: yesterday sold Rp500.000, today sold nothing. That is a −100% day and the merchant
  // needs to see it. Only the empty DENOMINATOR is the em dash.
  const collapsed = [day("2026-02-27", 500_000, 5, 100), day("2026-02-28", 0, 0, 0)];

  it("sales fell to zero after a real day → −100,0%, never '—'", () => {
    const s = getSummary(collapsed, "today");
    expect(s.sales.value).toBe(0);
    expect(s.sales.delta).toBe(-100);
    expect(pct(s.sales.delta)).toBe("−100,0%"); // U+2212, the delta formatter's own sign
    expect(pct(s.sales.delta)).not.toBe(NO_FIGURE);
  });

  it("the money tile for that same day says it too", () => {
    const today = getMoneyTiles(collapsed).find((t) => t.key === "today")!;
    expect(today.delta).toBe(-100);
    expect(pct(today.delta)).toBe("−100,0%");
  });

  it("an unchanged non-zero period is 0, which is also a measurement", () => {
    const flat = [day("2026-02-27", 500_000), day("2026-02-28", 500_000)];
    expect(getSummary(flat, "today").sales.delta).toBe(0);
    expect(pct(getSummary(flat, "today").sales.delta)).toBe("0,0%");
  });
});
