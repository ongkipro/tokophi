import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { Card } from "@tokophi/ui/card";
import { cn } from "@tokophi/ui/lib/utils";
import { pct } from "@tokophi/lib/format";
import { Sparkline } from "./sparkline";

/**
 * KPI tile: value + signed delta vs the previous period.
 *
 * The delta is printed SIGNED (`pct(delta)` → "−6,4%"), never `pct(Math.abs(delta))`: colour alone
 * is not a number, and a merchant skimming the dashboard read a 6,4% DROP as "+6,4%". The arrow +
 * colour still encode direction; the sign now agrees with them.
 */
export function KpiCard({
  label, value, delta, icon: Icon, spark, compareLabel,
}: {
  label: string; value: string; delta: number; icon: LucideIcon; spark: number[]; compareLabel: string;
}) {
  const up = delta >= 0;
  return (
    <Card className="gap-0 p-5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Icon className="size-4" /> {label}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums",
            up ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" : "bg-red-500/12 text-red-600 dark:text-red-400",
          )}
        >
          {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
          {pct(delta)}
        </span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <div className="text-2xl font-bold tracking-tight tabular-nums">{value}</div>
          <div className="mt-1 text-xs text-muted-foreground">vs {compareLabel}</div>
        </div>
        <Sparkline data={spark} up={up} area />
      </div>
    </Card>
  );
}
