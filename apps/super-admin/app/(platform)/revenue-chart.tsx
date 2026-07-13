"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { IDR } from "@tokophi/lib/format";
import type { RevenuePoint } from "@/lib/data";

// Subscription revenue actually COLLECTED per month (paid invoices, PPN-inclusive).
//
// Bars, not an area: this is a set of discrete monthly totals, several of which are legitimately
// zero. An area chart interpolates a smooth line through a month in which nobody paid us — which is
// precisely the flattering fiction the old synthetic MRR curve was drawing.
export function RevenueChart({ data }: { data: RevenuePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" opacity={0.6} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={8} fontSize={12} stroke="var(--muted-foreground)" />
        <YAxis hide domain={[0, "dataMax"]} />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          contentStyle={{
            borderRadius: "0.625rem",
            border: "1px solid var(--border)",
            background: "var(--popover)",
            color: "var(--popover-foreground)",
            fontSize: 12,
            boxShadow: "0 4px 16px rgb(0 0 0 / 0.08)",
          }}
          labelStyle={{ color: "var(--muted-foreground)", marginBottom: 2 }}
          formatter={(value, _name, item) => [
            `${IDR(Number(value))} · ${(item?.payload as RevenuePoint)?.invoices ?? 0} tagihan`,
            "Diterima",
          ]}
        />
        <Bar dataKey="collected" fill="var(--chart-1)" radius={[6, 6, 0, 0]} maxBarSize={44} />
      </BarChart>
    </ResponsiveContainer>
  );
}
