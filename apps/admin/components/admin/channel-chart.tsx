"use client";
import { Cell, Pie, PieChart } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@tokophi/ui/chart";
import type { ChannelSlice } from "@/lib/data/dashboard";
import { IDR } from "@tokophi/lib/format";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const config = { value: { label: "Penjualan" } } satisfies ChartConfig;

export function ChannelChart({ data }: { data: ChannelSlice[] }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <ChartContainer config={config} className="aspect-square h-[168px]">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent hideLabel formatter={(v) => IDR(Number(v))} />} />
          <Pie data={data} dataKey="value" nameKey="channel" innerRadius={48} outerRadius={78} paddingAngle={2} strokeWidth={2}>
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
        </PieChart>
      </ChartContainer>
      <ul className="flex-1 space-y-2">
        {data.map((d, i) => (
          <li key={d.channel} className="flex items-center gap-2 text-sm">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="flex-1 text-muted-foreground">{d.channel}</span>
            <span className="font-medium tabular-nums">{total > 0 ? Math.round((d.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
