"use client";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@tokophi/ui/chart";
import type { EarningRow } from "@/lib/data/finance";
import { IDR } from "@tokophi/lib/format";

// Daily earnings. BARS, not an area line, and the choice is not cosmetic: a day's takings is a
// discrete quantity, and an area chart interpolates BETWEEN days — drawing revenue at 3am on a
// Tuesday that never existed. Bars can only claim what the day actually earned.
//
// `getEarnings` zero-fills the window (generate_series), so the empty days are real gaps here rather
// than a line closing over them. A shop that sold nothing for a week must LOOK like it.

const config = {
  gross: { label: "Omzet", color: "var(--chart-1)" },
  shipping: { label: "Ongkir", color: "var(--chart-2)" },
} satisfies ChartConfig;

/** "2026-07-02" → "2 Jul". Charts get the short form; the number itself lives in the tooltip. */
const short = (iso: string) => {
  const [, m, d] = iso.split("-");
  const bulan = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  return `${Number(d)} ${bulan[Number(m) - 1]}`;
};

export function EarningsChart({ rows }: { rows: EarningRow[] }) {
  const data = rows.map((r) => ({ ...r, label: short(r.day) }));
  return (
    <ChartContainer config={config} className="h-[260px] w-full">
      <BarChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.5} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} fontSize={11} />
        <YAxis hide domain={[0, "dataMax"]} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(v, name) => (
                <span className="flex w-full justify-between gap-3">
                  <span className="text-muted-foreground">{config[name as keyof typeof config]?.label ?? name}</span>
                  <span className="font-mono font-medium tabular-nums">{IDR(Number(v))}</span>
                </span>
              )}
            />
          }
        />
        {/* Stacked: ongkir sits ON TOP of omzet because the shopper paid both in one transfer — they
            are parts of the same bar, not two competing series. */}
        <Bar dataKey="gross" stackId="a" fill="var(--color-gross)" radius={[0, 0, 3, 3]} />
        <Bar dataKey="shipping" stackId="a" fill="var(--color-shipping)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
