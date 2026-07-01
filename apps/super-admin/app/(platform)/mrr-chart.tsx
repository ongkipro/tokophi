"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MRR_SERIES } from "@/lib/mock";
import { IDR } from "@indostore/lib/format";

export function MrrChart() {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={MRR_SERIES} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="fillMrr" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" opacity={0.6} />
        <XAxis
          dataKey="month"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={16}
          fontSize={12}
          stroke="var(--muted-foreground)"
        />
        <YAxis hide domain={[0, "dataMax"]} />
        <Tooltip
          cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
          contentStyle={{
            borderRadius: "0.625rem",
            border: "1px solid var(--border)",
            background: "var(--popover)",
            color: "var(--popover-foreground)",
            fontSize: 12,
            boxShadow: "0 4px 16px rgb(0 0 0 / 0.08)",
          }}
          labelStyle={{ color: "var(--muted-foreground)", marginBottom: 2 }}
          formatter={(value) => [IDR(Number(value), { compact: true }), "MRR"]}
        />
        <Area
          dataKey="mrr"
          type="monotone"
          stroke="var(--chart-1)"
          strokeWidth={2.4}
          fill="url(#fillMrr)"
          dot={false}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
