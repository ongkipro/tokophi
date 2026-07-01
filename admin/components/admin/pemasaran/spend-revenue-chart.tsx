"use client";

import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { IDR } from "@/lib/format";

export type SpendRevenuePoint = {
  name: string;
  brand: string;
  spend: number;
  revenue: number;
};

const config = {
  spend: { label: "Belanja", color: "var(--muted-foreground)" },
  revenue: { label: "Pendapatan", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function SpendRevenueChart({ data }: { data: SpendRevenuePoint[] }) {
  return (
    <ChartContainer config={config} className="h-[280px] w-full">
      <BarChart data={data} margin={{ left: 4, right: 8, top: 12 }} barGap={6}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.5} />
        <XAxis
          dataKey="name"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          fontSize={12}
        />
        <YAxis
          hide
          domain={[0, "dataMax"]}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              indicator="dot"
              formatter={(v, name) => (
                <span className="flex w-full justify-between gap-3">
                  <span className="text-muted-foreground">
                    {config[name as keyof typeof config]?.label ?? name}
                  </span>
                  <span className="font-mono font-medium tabular-nums">
                    {IDR(Number(v))}
                  </span>
                </span>
              )}
            />
          }
        />
        <Bar dataKey="spend" radius={[4, 4, 0, 0]} maxBarSize={38}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.brand} fillOpacity={0.22} />
          ))}
        </Bar>
        <Bar dataKey="revenue" radius={[4, 4, 0, 0]} maxBarSize={38}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.brand} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
