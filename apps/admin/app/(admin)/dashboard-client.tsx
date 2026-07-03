"use client";
import { useState } from "react";
import Link from "next/link";
import { Wallet, ShoppingBag, Users, Target, Download } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DateRangeSwitcher } from "@/components/admin/date-range-switcher";
import { KpiCard } from "@/components/admin/kpi-card";
import { SalesChart } from "@/components/admin/sales-chart";
import { ChannelChart } from "@/components/admin/channel-chart";
import { TopProducts } from "@/components/admin/top-products";
import { RecentOrders } from "@/components/admin/recent-orders";
import { LiveActivity } from "@/components/admin/live-activity";
import { OrderStatusBadge } from "@/components/admin/order-status";
import {
  type RangeKey, getSummary, getSeries, getTopProducts, getChannels,
  getRecentOrders, getActivities, getStatusCounts, rangeLabel,
} from "@/lib/data/dashboard";
import type { DayPoint, Product, Order, Activity } from "@/lib/mock/store";
import { IDR, num, pct } from "@/lib/format";

export function DashboardClient({
  days,
  products,
  orders,
  activities,
  onlineNow,
}: {
  days: DayPoint[];
  products: Product[];
  orders: Order[];
  activities: Activity[];
  onlineNow: number;
}) {
  const [range, setRange] = useState<RangeKey>("30d");
  const s = getSummary(days, range);
  const { points } = getSeries(days, range);
  const salesSpark = points.map((p) => p.sales);
  const orderSpark = points.map((p) => p.orders);

  const kpis = [
    { label: "Penjualan", value: IDR(s.sales.value, { compact: true }), delta: s.sales.delta, icon: Wallet, spark: salesSpark },
    { label: "Pesanan", value: num(s.orders.value), delta: s.orders.delta, icon: ShoppingBag, spark: orderSpark },
    { label: "Pengunjung", value: num(s.visitors.value), delta: s.visitors.delta, icon: Users, spark: salesSpark },
    { label: "Konversi", value: `${s.conversion.value.toFixed(1)}%`, delta: s.conversion.delta, icon: Target, spark: orderSpark },
  ];

  const target = 120_000_000;
  const monthSales = getSummary(days, "month").sales.value;
  const targetPct = Math.min(100, Math.round((monthSales / target) * 100));

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      {/* header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Halo Ongki 👋 — ringkasan performa <span className="font-medium text-foreground">Batik Nusantara</span>, {rangeLabel(range).toLowerCase()}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangeSwitcher value={range} onChange={setRange} />
          <Button variant="outline" className="gap-2"><Download className="size-4" /> Ekspor</Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => <KpiCard key={k.label} {...k} compareLabel={s.compareLabel} />)}
      </div>

      {/* chart + live */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Grafik Penjualan</CardTitle>
              <CardDescription>Total {IDR(s.sales.value)} · {pct(s.sales.delta)} vs {s.compareLabel}</CardDescription>
            </div>
            <div className="hidden items-center gap-4 text-xs text-muted-foreground sm:flex">
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-[var(--chart-1)]" /> Periode ini</span>
              <span className="flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-muted-foreground" /> Periode lalu</span>
            </div>
          </CardHeader>
          <CardContent><SalesChart points={points} /></CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader><CardTitle>Aktivitas Langsung</CardTitle></CardHeader>
          <CardContent><LiveActivity items={getActivities(activities)} online={onlineNow} /></CardContent>
        </Card>
      </div>

      {/* orders + top products */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div><CardTitle>Pesanan Terbaru</CardTitle><CardDescription>Pesanan yang masuk baru-baru ini</CardDescription></div>
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/pesanan" />}>Lihat semua</Button>
          </CardHeader>
          <CardContent className="px-2"><RecentOrders orders={getRecentOrders(orders, 6)} /></CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader><CardTitle>Produk Terlaris</CardTitle><CardDescription>{rangeLabel(range)}</CardDescription></CardHeader>
          <CardContent><TopProducts items={getTopProducts(days, products, range)} /></CardContent>
        </Card>
      </div>

      {/* channels + status + target */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Sumber Penjualan</CardTitle><CardDescription>Channel akuisisi</CardDescription></CardHeader>
          <CardContent><ChannelChart data={getChannels(days, range)} /></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Status Pesanan</CardTitle><CardDescription>Seluruh pesanan</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {getStatusCounts(orders).map((r) => (
              <div key={r.status} className="flex items-center gap-3">
                <OrderStatusBadge status={r.status} />
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary/70" style={{ width: `${(r.count / Math.max(1, orders.length)) * 100}%` }} />
                </div>
                <span className="w-6 text-right text-sm font-medium tabular-nums">{r.count}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Target Bulan Ini</CardTitle><CardDescription>Progres menuju target</CardDescription></CardHeader>
          <CardContent>
            <div className="flex items-end justify-between">
              <div className="text-2xl font-bold tabular-nums">{IDR(monthSales, { compact: true })}</div>
              <Badge variant="secondary" className="bg-primary/12 text-primary">{targetPct}%</Badge>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">dari target {IDR(target, { compact: true })}</div>
            <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-gradient-to-r from-primary to-primary/70" style={{ width: `${targetPct}%` }} />
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              {targetPct >= 100 ? "🎉 Target tercapai!" : `Perlu ${IDR(target - monthSales, { compact: true })} lagi untuk capai target.`}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
