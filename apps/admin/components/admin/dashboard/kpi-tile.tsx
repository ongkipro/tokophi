import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@tokophi/ui/card";
import { cn } from "@tokophi/ui/lib/utils";
import { pct } from "@tokophi/lib/format";

/**
 * THE KPI tile. There were two, and they had already drifted.
 *
 * `kpi-card.tsx` (/analitik, 4 tiles) and `dashboard/money-strip.tsx` (the dashboard, 4 sales tiles
 * + the return-rate tile) held the same header row, the same figure row and the same delta pill,
 * copied. Measured on 2026-08-06 they disagreed on the pill's inner gap (2px vs 4px) while agreeing
 * on everything else — which is the shape a copy always fails in: identical enough that nobody
 * re-reads it, different enough that the two screens do not line up. `sparkline.tsx` was extracted
 * out of these same two files for the same reason, and its test still pins that neither file grows
 * its own geometry back; this is the other half of that job.
 *
 * ── THE RHYTHM, stated once so it cannot drift again ─────────────────────────────────────────────
 *   20px  card padding (p-5)
 *   12px  between GROUPS      — the header and the figure; the figure and a footnote
 *    8px  a graphic that RESTATES the figure (the return tile's bar) — close enough to belong to it
 *    4px  inside a group      — the figure and its caption
 * Everything is a multiple of 4. Before this, the same three roles sat 12/4 here and 12/2 in
 * `action-queue.tsx`, and the return tile hung its bar 12px away — as far from its own number as the
 * number is from the card's header, so the bar read as a separate block instead of the same fact
 * drawn twice.
 *
 * ── AND THE HIERARCHY, three roles and three steps ───────────────────────────────────────────────
 *   value    24px / 700 / tabular-nums   ← the one thing the tile exists to say
 *   label    12px / 500 / muted          ← what the figure IS
 *   caption  12px / 400 / muted at 75%   ← what it is measured against
 * The label used to be 14px, i.e. only 1,7× smaller than the figure and the SAME colour as the
 * caption, so a tile read as three near-equal lines. 12/500 against 12/400-at-75% separates label
 * from caption by weight and value rather than by inventing a fourth type size, and doubles the
 * figure's lead over both.
 *
 * ⚠️ `deltaUp` EXISTS BECAUSE `null >= 0` IS `true` IN JAVASCRIPT. Both files wrote
 * `delta === null ? null : delta >= 0` by hand, which is one hand-written comparison away, in either
 * file, from painting an emerald ↗ over an em dash on a store that has never sold anything. It is a
 * one-line function so that there is one line to get wrong, not two — the same "patch the class, not
 * the instance" rule the tenant and password code in this repo already follow.
 */
export function deltaUp(delta: number | null): boolean | null {
  return delta === null ? null : delta >= 0;
}

/**
 * NO GOOD/BAD VERDICT MAY BE CARRIED BY COLOUR ALONE (WCAG 1.4.1), so the pill has three tones and
 * every caller pairs one with a glyph AND a word. `neutral` is not "a bit good": it is "there is
 * nothing here to judge", and it is the tone an empty store gets.
 */
const TONE = {
  neutral: "bg-muted text-muted-foreground",
  good: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  bad: "bg-red-500/12 text-red-600 dark:text-red-400",
} as const;

export type PillTone = keyof typeof TONE;

// gap-1 (4px), not the gap-0.5 the delta pills used: 2px between an arrow and a figure sets the
// glyph on the digits. One value, so the worded pill and the numeric one cannot drift apart again.
export const pillClass = (tone: PillTone) =>
  cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", TONE[tone]);

/**
 * The signed delta against the previous period.
 *
 * The sign is PRINTED (`pct(delta)` → "−6,4%"), never `pct(Math.abs(delta))`: colour is not a number,
 * and a merchant skimming the dashboard read a 6,4% drop as "+6,4%".
 *
 * ⚠️ `delta === null` MEANS "NOTHING TO COMPARE TO" AND IT IS NOT A VERDICT. There is no previous
 * period, so there is no rise and no fall — the pill goes neutral ("—", muted, no arrow) instead of
 * borrowing green-and-up. The arrow is DROPPED rather than swapped for a third glyph: the arrows
 * exist to say WHICH WAY, and a neutral pill claims no direction to disambiguate.
 * ⚠️ A REAL −100% is still a number — the boundary is the denominator, and that decision is made
 * upstream in `lib/data/dashboard.ts` (pinned by `lib/data/kpi-delta.test.ts`). Nothing here may
 * turn a measured collapse into a dash.
 */
export function DeltaBadge({ delta }: { delta: number | null }) {
  const up = deltaUp(delta);
  return (
    <span className={cn(pillClass(up === null ? "neutral" : up ? "good" : "bad"), "tabular-nums")}>
      {up === null ? null : up ? <ArrowUpRight aria-hidden className="size-3" /> : <ArrowDownRight aria-hidden className="size-3" />}
      {pct(delta)}
      {/* "—" is announced as nothing (or "em dash") by a screen reader, and a colour is announced to
          nobody at all. The word is what carries the verdict for everyone the glyph does not reach. */}
      <span className="sr-only">{up === null ? " tidak ada pembanding" : up ? " naik" : " turun"}</span>
    </span>
  );
}

export function KpiTile({
  icon: Icon, label, badge, value, caption, aside, children,
}: {
  icon: LucideIcon;
  label: string;
  /** The pill on the right of the header — `<DeltaBadge>` or a worded verdict built on `pillClass`. */
  badge: ReactNode;
  value: string;
  /** What the figure is measured against. Omit it and the figure keeps the whole group to itself. */
  caption?: ReactNode;
  /** Sits to the right of the figure, baseline-aligned with it (the sparkline). */
  aside?: ReactNode;
  /** Anything below the figure group — the return tile's bar and its COD footnote. */
  children?: ReactNode;
}) {
  return (
    <Card className="gap-0 p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{label}</span>
        </span>
        {badge}
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          {/* leading-none, so the 4px caption gap is 4px of ink rather than 4px plus half a line box
              of the 24px figure's leading — the group was reading looser than it measured. */}
          <div className="text-2xl leading-none font-bold tracking-tight tabular-nums">{value}</div>
          {caption ? <div className="mt-1 text-xs text-muted-foreground/75">{caption}</div> : null}
        </div>
        {aside}
      </div>
      {children}
    </Card>
  );
}
