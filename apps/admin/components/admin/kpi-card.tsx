import { type LucideIcon } from "lucide-react";
import { Sparkline } from "./sparkline";
import { DeltaBadge, KpiTile, deltaUp } from "./dashboard/kpi-tile";

/**
 * /analitik's KPI tile: value + signed delta vs the previous period.
 *
 * The shell, the rhythm and the delta pill are `dashboard/kpi-tile.tsx` — this file used to hold its
 * own copy of all three, which is how it and `dashboard/money-strip.tsx` ended up with pills that
 * measured differently. Read the contract there; it is where the `null >= 0` trap is documented and
 * closed. (The shared tile lives under `dashboard/` because that is where its other four callers
 * are; this file is the outlier, not the shell.)
 *
 * ⚠️ THE CAPTION IS PART OF THE DELTA'S CLAIM. With no previous period the tile used to read
 * "Penjualan hari ini · — · Rp 0 · vs kemarin" — measured on `batik-nusantara`, 2026-08-06 — and a
 * merchant reads that bottom line as belonging to the figure above it: "Rp 0, vs kemarin". There was
 * no yesterday to compare against; naming one is the same false claim the em dash exists to prevent,
 * moved one line down. `delta === null` says so instead.
 */
export function KpiCard({
  label, value, delta, icon, spark, compareLabel,
}: {
  label: string; value: string; delta: number | null; icon: LucideIcon; spark: number[]; compareLabel: string;
}) {
  return (
    <KpiTile
      icon={icon}
      label={label}
      badge={<DeltaBadge delta={delta} />}
      value={value}
      caption={delta === null ? "belum ada pembanding" : `vs ${compareLabel}`}
      // The sparkline goes neutral on the same `delta === null` the badge does, from the same helper.
      aside={<Sparkline data={spark} up={deltaUp(delta)} area />}
    />
  );
}
