"use client";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@tokophi/ui/chart";
import type { CategorySale } from "@/lib/data/analytics";
import { IDR } from "@tokophi/lib/format";

const config = {
  revenue: { label: "Penjualan", color: "var(--chart-1)" },
} satisfies ChartConfig;

// `data` = real revenue per product category, aggregated server-side from
// order_line_items → product_variants → products (lib/data/analytics.ts).
export function CategoryChart({ data }: { data: CategorySale[] }) {
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
