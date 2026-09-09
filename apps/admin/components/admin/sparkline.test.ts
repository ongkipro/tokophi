import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sparklinePath } from "./sparkline";
import { getSeries } from "@/lib/data/dashboard";
import type { DayPoint } from "@/lib/types/domain";
import { codeOnly } from "../../../../test/source-code";

// AN SVG PATH MADE OF NaN.
//
// `kpi-card.tsx` guarded its sparkline with `!data.length`; the byte-identical geometry in
// `dashboard/money-strip.tsx` guarded the same five lines with `data.length < 2`. A one-element series
// divides by zero in `(i / (data.length - 1))`, so the KPI card emitted `d="MNaN,30.0"` and
// `area="MNaN,30.0 L88,32 L0,32 Z"`. Two copies with two guards IS the bug, so there is one now.

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe("sparklinePath", () => {
  it("draws nothing for a series that has no shape", () => {
    expect(sparklinePath([])).toBeNull();
    expect(sparklinePath([1_200_000])).toBeNull(); // ← was "MNaN,30.0"
  });

  it("never emits NaN, for any series length", () => {
    for (let n = 0; n <= 40; n++) {
      const p = sparklinePath(Array.from({ length: n }, (_, i) => i * 1000));
      if (p) expect(`${p.d} ${p.area}`).not.toMatch(/NaN/);
    }
  });

  it("spans the full width, and a flat series is a flat line (span 0 must not divide)", () => {
    expect(sparklinePath([5, 9, 3])?.d).toBe("M0.0,20.7 L44.0,2.0 L88.0,30.0");
    expect(sparklinePath([7, 7, 7])?.d).toBe("M0.0,30.0 L44.0,30.0 L88.0,30.0");
  });

  it("is reachable: on the 1st of a month, /analitik's 'Bulan Ini' resolves to ONE day", () => {
    // `analitik-client.tsx` builds its spark from `getSeries(days, range, hours).points`.
    const day = (date: string, sales: number): DayPoint =>
      ({ date, ts: Date.parse(date), sales, orders: 1, visitors: 10 });
    const days = [day("2026-07-30", 100), day("2026-07-31", 100), day("2026-08-01", 250)];
    const spark = getSeries(days, "month").points.map((p) => p.sales);
    expect(spark).toHaveLength(1);
    expect(sparklinePath(spark)).toBeNull();
  });
});

describe("one sparkline, not two", () => {
  // Reads CODE, not text (`test/source-code.ts`): the comments in both files discuss the geometry.
  for (const rel of ["kpi-card.tsx", "dashboard/money-strip.tsx"]) {
    it(`${rel} renders the shared component instead of its own copy`, () => {
      const code = codeOnly(readFileSync(path.join(HERE, rel), "utf8"));
      expect(code).toMatch(/from\s+"[.\/]*sparkline"/);
      // The division that produced the NaN. If it is back in a screen file, so is the second guard.
      expect(code).not.toMatch(/data\s*\.\s*length\s*-\s*1/);
    });
  }
});
