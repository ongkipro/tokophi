"use client";
import { useState } from "react";
import Link from "next/link";
import { Wallet, ShoppingBag, Users, Receipt, Download, MapPin, Smartphone, Megaphone, ArrowRight, Filter } from "lucide-react";
import { FUNNEL, REGION_SALES, DEVICE_SPLIT, NEW_VS_RETURNING, AD_CHANNELS, type DayPoint, type Product } from "@/lib/mock/store";
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

export function AnalitikClient({ days, products }: { days: DayPoint[]; products: Product[] }) {
  const [range, setRange] = useState<RangeKey>("30d");
  const s = getSummary(days, range);
  const { points } = getSeries(days, range);
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
          <CardContent><ChannelChart data={getChannels(days, range)} /></CardContent>
        </Card>
      </div>

      {/* Top products + summary */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Produk Terlaris</CardTitle>
            <CardDescription>{rangeLabel(range)}</CardDescription>
          </CardHeader>
          <CardContent><TopProducts items={getTopProducts(days, products, range)} /></CardContent>
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

      {/* Funnel konversi */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Filter className="size-4 text-muted-foreground" /> Funnel Konversi</CardTitle>
          <CardDescription>Perjalanan pengunjung hingga pembelian · {rangeLabel(range)}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {FUNNEL.map((f, i) => {
              const top = FUNNEL[0].count;
              const width = (f.count / top) * 100;
              const stepRate = i === 0 ? 100 : (f.count / FUNNEL[i - 1].count) * 100;
              return (
                <div key={f.step}>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="font-medium">{f.step}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {num(f.count)}{i > 0 && <span className="ml-2 text-xs">({stepRate.toFixed(1)}% lanjut)</span>}
                    </span>
                  </div>
                  <div className="h-7 overflow-hidden rounded-lg bg-muted">
                    <div className="flex h-full items-center rounded-lg bg-primary/85 px-2 text-[11px] font-medium text-primary-foreground" style={{ width: `${width}%` }}>
                      {width > 14 && `${width.toFixed(0)}%`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <Separator className="my-4" />
          <p className="text-xs text-muted-foreground">
            Tingkat konversi keseluruhan <span className="font-semibold text-foreground">{((FUNNEL[FUNNEL.length - 1].count / FUNNEL[0].count) * 100).toFixed(1)}%</span> — {num(FUNNEL[FUNNEL.length - 1].count)} pembelian dari {num(FUNNEL[0].count)} kunjungan.
          </p>
        </CardContent>
      </Card>

      {/* Wilayah + perangkat/pelanggan */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><MapPin className="size-4 text-muted-foreground" /> Penjualan per Wilayah</CardTitle>
            <CardDescription>Kota dengan penjualan tertinggi</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {REGION_SALES.map((r) => (
                <li key={r.city} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 truncate text-sm">{r.city}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(r.sales / REGION_SALES[0].sales) * 100}%` }} />
                  </div>
                  <span className="w-20 shrink-0 text-right text-sm font-medium tabular-nums">{IDR(r.sales, { compact: true })}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Smartphone className="size-4 text-muted-foreground" /> Perangkat & Pelanggan</CardTitle>
            <CardDescription>Distribusi sesi</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {DEVICE_SPLIT.map((d, i) => (
              <div key={d.device}>
                <div className="mb-1 flex justify-between text-sm"><span>{d.device}</span><span className="font-medium tabular-nums">{d.value}%</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${d.value}%`, background: `var(--chart-${i + 1})` }} /></div>
              </div>
            ))}
            <Separator className="my-1" />
            {NEW_VS_RETURNING.map((n, i) => (
              <div key={n.type} className="flex items-center gap-2 text-sm">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: `var(--chart-${i + 2})` }} />
                <span className="flex-1 text-muted-foreground">{n.type}</span>
                <span className="font-medium tabular-nums">{n.value}%</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Performa iklan (ROAS) → Pemasaran */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2"><Megaphone className="size-4 text-muted-foreground" /> Performa Iklan</CardTitle>
            <CardDescription>Ringkasan ROAS per saluran iklan</CardDescription>
          </div>
          <Button variant="ghost" size="sm" className="gap-1" nativeButton={false} render={<Link href="/pemasaran" />}>
            Lihat detail <ArrowRight className="size-4" />
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {AD_CHANNELS.map((c) => {
              const roas = c.revenue / c.spend;
              return (
                <div key={c.key} className="rounded-xl border p-4">
                  <div className="flex items-center gap-2">
                    <span className="flex size-6 items-center justify-center rounded text-[11px] font-bold text-white" style={{ background: c.brand }}>{c.name[0]}</span>
                    <span className="text-sm font-medium">{c.name}</span>
                  </div>
                  <div className="mt-3 text-2xl font-bold tabular-nums">{roas.toFixed(1).replace(".", ",")}×</div>
                  <div className="text-xs text-muted-foreground">ROAS · belanja {IDR(c.spend, { compact: true })}</div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
