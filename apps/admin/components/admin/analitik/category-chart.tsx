"use client";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { PRODUCTS } from "@/lib/mock/store";
import { IDR } from "@/lib/format";

// Aggregate revenue (unitsSold * price) per category, sorted high → low.
function byCategory() {
  const map = new Map<string, number>();
  for (const p of PRODUCTS) {
    map.set(p.category, (map.get(p.category) ?? 0) + p.unitsSold * p.price);
  }
  return [...map.entries()]
    .map(([category, revenue]) => ({ category, revenue }))
    .sort((a, b) => b.revenue - a.revenue);
}

const config = {
  revenue: { label: "Penjualan", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function CategoryChart() {
  const data = byCategory();
  return (
    <ChartContainer config={config} className="h-[300px] w-full">
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.5} />
        <XAxis type="number" hide domain={[0, "dataMax"]} />
        <YAxis
          type="category"
          dataKey="category"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={92}
          fontSize={12}
        />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          content={<ChartTooltipContent hideLabel formatter={(v) => (
            <span className="font-mono font-medium tabular-nums">{IDR(Number(v))}</span>
          )} />}
        />
        <Bar dataKey="revenue" fill="var(--chart-1)" radius={[0, 5, 5, 0]} maxBarSize={26} />
      </BarChart>
    </ChartContainer>
  );
}
