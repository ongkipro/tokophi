/**
 * THE sparkline. There were two, and the copy is what shipped the bug.
 *
 * `kpi-card.tsx` and `dashboard/money-strip.tsx` held the same five lines of geometry and two
 * DIFFERENT guards: money-strip required `data.length < 2 → null`, the KPI card only `!data.length`.
 * So a one-point series divided by zero in `(i / (data.length - 1))` and the KPI card emitted
 * `d="MNaN,30.0"` — an SVG path made of NaN, plus `area="MNaN,30.0 L88,32 L0,32 Z"`.
 *
 * It is reachable, not theoretical: `/analitik` builds its spark from `getSeries(...).points`, and on
 * the **1st of any month** the "Bulan Ini" range resolves to exactly one day (`inMonth(thisMonth)`),
 * as does any store whose `daily_stats` has a single row. All four KPI cards then render a NaN path.
 *
 * One number is a dot, not a trend — fewer than two points has no shape to draw, so it draws nothing.
 */
export function sparklinePath(data: number[], w = 88, h = 32): { d: string; area: string } | null {
  if (data.length < 2) return null;
  const max = Math.max(...data), min = Math.min(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - ((v - min) / span) * (h - 4) - 2]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return { d, area: `${d} L${w},${h} L0,${h} Z` };
}

/**
 * @param area  fill the area under the line with a fading gradient (the KPI tiles). The money strip
 *              draws the stroke alone, which is the only difference the two copies ever had.
 * @param up    `null` = the tile has NO comparison period, so there is no rise or fall to colour.
 *              Green would claim growth and red would claim a collapse; both are verdicts over a
 *              figure that does not exist. It draws muted — the same decision the badge above it
 *              makes, from the same `delta === null`.
 */
export function Sparkline({ data, up, area = false }: { data: number[]; up: boolean | null; area?: boolean }) {
  const w = 88, h = 32;
  const path = sparklinePath(data, w, h);
  if (!path) return null;
  const stroke = up === null ? "var(--muted-foreground)" : up ? "var(--chart-3)" : "var(--destructive)";
  // Deterministic (no `useId` — these render in server components) and per-tile. `up` is part of it
  // because two tiles with the same series length and first value would otherwise share one gradient,
  // and a falling tile would be filled with the rising tile's green.
  const id = `spk-${up === null ? "n" : up ? "u" : "d"}-${data.length}-${Math.round(data[0])}`;
  return (
    <svg width={w} height={h} className="overflow-visible" aria-hidden>
      {area && (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={path.area} fill={`url(#${id})`} />
        </>
      )}
      <path d={path.d} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
