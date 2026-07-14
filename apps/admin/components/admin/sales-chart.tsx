"use client";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@tokophi/ui/chart";
import type { SeriesPoint } from "@/lib/data/dashboard";
import { IDR } from "@tokophi/lib/format";

const config = {
  sales: { label: "Penjualan", color: "var(--chart-1)" },
  prev: { label: "Periode lalu", color: "var(--muted-foreground)" },
} satisfies ChartConfig;

export function SalesChart({ points }: { points: SeriesPoint[] }) {
  return (
    <ChartContainer config={config} className="h-[300px] w-full">
      <AreaChart data={points} margin={{ left: 4, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="fillSales" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-sales)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-sales)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.5} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} fontSize={12} />
        <YAxis hide domain={[0, "dataMax"]} />
        <ChartTooltip
          content={<ChartTooltipContent formatter={(v, name) => (
            <span className="flex w-full justify-between gap-3">
              <span className="text-muted-foreground">{config[name as keyof typeof config]?.label ?? name}</span>
              <span className="font-mono font-medium tabular-nums">{IDR(Number(v))}</span>
            </span>
          )} />}
        />
        <Area dataKey="prev" type="monotone" stroke="var(--color-prev)" strokeWidth={1.5} strokeDasharray="4 4" fill="none" dot={false} />
        <Area dataKey="sales" type="monotone" stroke="var(--color-sales)" strokeWidth={2.4} fill="url(#fillSales)" dot={false} activeDot={{ r: 4 }} />
      </AreaChart>
    </ChartContainer>
  );
}
