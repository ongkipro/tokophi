"use client";
import { useState } from "react";
import { Wallet, ShoppingBag, Users, Receipt, Download } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/admin/page-header";
import { DateRangeSwitcher } from "@/components/admin/date-range-switcher";
import { KpiCard } from "@/components/admin/kpi-card";
import { SalesChart } from "@/components/admin/sales-chart";
import { ChannelChart } from "@/components/admin/channel-chart";
import { TopProducts } from "@/components/admin/top-products";
import { CategoryChart } from "@/components/admin/analitik/category-chart";
import {
  type RangeKey, getSummary, getSeries, getTopProducts, getChannels, rangeLabel,
} from "@/lib/data/dashboard";
import { IDR, num, pct } from "@/lib/format";

export default function AnalitikPage() {
  const [range, setRange] = useState<RangeKey>("30d");
  const s = getSummary(range);
  const { points } = getSeries(range);
  const salesSpark = points.map((p) => p.sales);
  const orderSpark = points.map((p) => p.orders);

  const kpis = [
    { label: "Penjualan", value: IDR(s.sales.value, { compact: true }), delta: s.sales.delta, icon: Wallet, spark: salesSpark },
    { label: "Pesanan", value: num(s.orders.value), delta: s.orders.delta, icon: ShoppingBag, spark: orderSpark },
    { label: "Pengunjung", value: num(s.visitors.value), delta: s.visitors.delta, icon: Users, spark: salesSpark },
    { label: "Nilai Order Rata-rata", value: IDR(s.aov.value, { compact: true }), delta: s.aov.delta, icon: Receipt, spark: salesSpark },
  ];

  // Fabricated-but-reasonable summary figures derived from the range totals.
  const newCustomers = Math.round(s.orders.value * 0.42);
  const itemsPerOrder = (1.4 + (s.aov.value % 90_000) / 90_000).toFixed(1);
  const summaryRows = [
    { label: "Total transaksi", value: num(s.orders.value) },
    { label: "Tingkat konversi", value: `${s.conversion.value.toFixed(1)}%` },
    { label: "Pelanggan baru", value: num(newCustomers) },
    { label: "Rata-rata item / pesanan", value: itemsPerOrder },
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader title="Analitik" desc="Laporan mendalam performa toko.">
        <DateRangeSwitcher value={range} onChange={setRange} />
        <Button variant="outline" className="gap-2"><Download className="size-4" /> Ekspor</Button>
      </PageHeader>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => <KpiCard key={k.label} {...k} compareLabel={s.compareLabel} />)}
      </div>

      {/* Sales trend — full width */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Tren Penjualan</CardTitle>
            <CardDescription>Total {IDR(s.sales.value)} · {pct(s.sales.delta)} vs {s.compareLabel}</CardDescription>
          </div>
          <div className="hidden items-center gap-4 text-xs text-muted-foreground sm:flex">
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-[var(--chart-1)]" /> Periode ini</span>
            <span className="flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-muted-foreground" /> Periode lalu</span>
          </div>
        </CardHeader>
        <CardContent><SalesChart points={points} /></CardContent>
      </Card>

      {/* Category + channel */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Penjualan per Kategori</CardTitle>
            <CardDescription>Estimasi pendapatan berdasarkan kategori produk</CardDescription>
          </CardHeader>
          <CardContent><CategoryChart /></CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sumber Penjualan</CardTitle>
            <CardDescription>Channel akuisisi · {rangeLabel(range)}</CardDescription>
          </CardHeader>
          <CardContent><ChannelChart data={getChannels(range)} /></CardContent>
        </Card>
      </div>

      {/* Top products + summary */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Produk Terlaris</CardTitle>
            <CardDescription>{rangeLabel(range)}</CardDescription>
          </CardHeader>
          <CardContent><TopProducts items={getTopProducts(range)} /></CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ringkasan</CardTitle>
            <CardDescription>Metrik utama periode {rangeLabel(range).toLowerCase()}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-border">
              {summaryRows.map((r) => (
                <div key={r.label} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                  <dt className="text-sm text-muted-foreground">{r.label}</dt>
                  <dd className="text-sm font-semibold tabular-nums">{r.value}</dd>
                </div>
              ))}
            </dl>
            <Separator className="my-4" />
            <p className="text-xs text-muted-foreground">
              Nilai order rata-rata {IDR(s.aov.value)} dari {num(s.orders.value)} pesanan.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
