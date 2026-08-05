"use client";
import { useState } from "react";
import { Wallet, ShoppingBag, Users, Receipt, Download, MapPin, Smartphone, Filter } from "lucide-react";
import type { DayPoint, Product } from "@/lib/mock/store";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Separator } from "@tokophi/ui/separator";
import { PageHeader } from "@/components/admin/page-header";
import { DateRangeSwitcher } from "@/components/admin/date-range-switcher";
import { KpiCard } from "@/components/admin/kpi-card";
import { SalesChart } from "@/components/admin/sales-chart";
import { ChannelChart } from "@/components/admin/channel-chart";
import { TopProducts } from "@/components/admin/top-products";
import { CategoryChart } from "@/components/admin/analitik/category-chart";
import {
  type RangeKey, getSummary, getSeries, getTopProducts, getChannels, rangeLabel,
  getVisitsKpi, getFunnel, getDeviceSplit,
} from "@/lib/data/dashboard";
import type { FunnelDay, DeviceDay } from "@/lib/data/funnel"; // type-only: funnel.ts is server-only
import type { RegionSale, CustomerMix, CategorySale, ChannelDay, HourPoint, ProductSaleDay, OrderStats } from "@/lib/data/analytics";
import { IDR, NO_FIGURE, num, pct } from "@tokophi/lib/format";
import { exportCsv } from "@/lib/csv";

// Every number on this page is COUNTED from rows: orders / order_line_items (penjualan, wilayah,
// kategori, sumber penjualan, produk terlaris) and analytics_events (funnel, perangkat, pengunjung).
// The ONE card deliberately missing is "Performa Iklan / ROAS": there is no Meta/Google/TikTok
// integration, so spend and ROAS cannot be counted from anything — it was removed, not stubbed.

const EmptyState = ({ text }: { text: string }) => (
  <p className="py-8 text-center text-sm text-muted-foreground">{text}</p>
);

export function AnalitikClient({
  days,
  hours,
  products,
  regions,
  mix,
  categories,
  channels,
  productSales,
  stats,
  funnel,
  funnelSteps,
  devices,
}: {
  days: DayPoint[];
  hours: HourPoint[];
  products: Product[];
  regions: RegionSale[];
  mix: CustomerMix;
  categories: CategorySale[];
  channels: ChannelDay[];
  productSales: ProductSaleDay[];
  stats: OrderStats;
  funnel: FunnelDay[];
  funnelSteps: { type: string; label: string }[];
  devices: DeviceDay[];
}) {
  const [range, setRange] = useState<RangeKey>("30d");
  const s = getSummary(days, range);
  const { points } = getSeries(days, range, hours);
  const salesSpark = points.map((p) => p.sales);
  const orderSpark = points.map((p) => p.orders);

  // Counted from analytics_events — null when the store has no tracking data at all.
  const visits = getVisitsKpi(funnel, days, range);
  const steps = getFunnel(funnel, days, range, funnelSteps);
  const deviceSplit = getDeviceSplit(devices, days, range);
  // Counted from order_line_items / orders.channel for the selected range.
  const topProducts = getTopProducts(productSales, range, days);
  const channelSlices = getChannels(channels, range, days);

  const kpis = [
    { label: "Penjualan", value: IDR(s.sales.value, { compact: true }), delta: s.sales.delta, icon: Wallet, spark: salesSpark },
    { label: "Pesanan", value: num(s.orders.value), delta: s.orders.delta, icon: ShoppingBag, spark: orderSpark },
    // ⚠️ `?? null`, never `?? 0`. No events at all is not "unchanged" — `0` printed a measurement
    // ("0,0%") beside a value that was already honestly "—", so one tile made two different claims
    // about the same missing data.
    { label: "Pengunjung", value: visits ? num(visits.value) : NO_FIGURE, delta: visits?.delta ?? null, icon: Users, spark: salesSpark },
    { label: "Nilai Order Rata-rata", value: IDR(s.aov.value, { compact: true }), delta: s.aov.delta, icon: Receipt, spark: salesSpark },
  ];

  // Ringkasan: dihitung dari tabel `orders`/`order_line_items` toko ini (di luar pesanan batal).
  const summaryRows = [
    { label: "Total pesanan", value: num(stats.orders) },
    { label: "Total penjualan", value: IDR(stats.revenue) },
    { label: "Nilai order rata-rata", value: stats.orders ? IDR(stats.aov) : NO_FIGURE },
    { label: "Rata-rata item / pesanan", value: stats.orders ? stats.itemsPerOrder.toFixed(1).replace(".", ",") : NO_FIGURE },
  ];

  const totalMix = mix.baru + mix.kembali;
  const mixRows = [
    { type: "Pelanggan baru (1 pesanan)", value: mix.baru },
    { type: "Pelanggan kembali (>1 pesanan)", value: mix.kembali },
  ];
  // max over the DISPLAYED rows — the "Lainnya" bucket can outrank the top single city.
  const topRegion = regions.reduce((m, r) => Math.max(m, r.sales), 0);

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader title="Analitik" desc="Laporan mendalam performa toko.">
        <DateRangeSwitcher value={range} onChange={setRange} />
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => exportCsv("analitik-produk", [...products].sort((a, b) => b.unitsSold - a.unitsSold).map((p) => ({ Produk: p.name, Kategori: p.category, Terjual: p.unitsSold, Harga: p.price, Stok: p.stock })))}
        >
          <Download className="size-4" /> Ekspor
        </Button>
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
            <CardDescription>Dari item pesanan yang benar-benar terjual · semua pesanan</CardDescription>
          </CardHeader>
          <CardContent>
            {categories.length ? (
              <CategoryChart data={categories} />
            ) : (
              <EmptyState text="Belum ada penjualan — kategori akan muncul setelah pesanan pertama masuk." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sumber Penjualan</CardTitle>
            <CardDescription>Channel yang tercatat di tiap pesanan · {rangeLabel(range)}</CardDescription>
          </CardHeader>
          <CardContent>
            {channelSlices.length ? (
              <ChannelChart data={channelSlices} />
            ) : (
              <EmptyState text="Belum ada pesanan pada periode ini." />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top products + summary */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Produk Terlaris</CardTitle>
            <CardDescription>Omzet dari item pesanan · {rangeLabel(range)}</CardDescription>
          </CardHeader>
          <CardContent>
            {topProducts.length ? (
              <TopProducts items={topProducts} />
            ) : (
              <EmptyState text="Belum ada penjualan pada periode ini." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ringkasan</CardTitle>
            <CardDescription>Dihitung dari pesanan toko ini (di luar pesanan batal)</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.orders === 0 ? (
              <EmptyState text="Belum ada pesanan." />
            ) : (
              <>
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
                  Nilai order rata-rata {IDR(stats.aov)} dari {num(stats.orders)} pesanan.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Funnel konversi — counted from analytics_events */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Filter className="size-4 text-muted-foreground" /> Funnel Konversi</CardTitle>
          <CardDescription>Dihitung dari event kunjungan storefront · {rangeLabel(range)}</CardDescription>
        </CardHeader>
        <CardContent>
          {!steps ? (
            <EmptyState text="Belum ada data kunjungan — funnel muncul setelah storefront Anda menerima pengunjung." />
          ) : (
            <>
              <div className="space-y-3">
                {steps.map((f, i) => {
                  const top = steps[0].count;
                  const width = top ? (f.count / top) * 100 : 0;
                  const prev = i === 0 ? 0 : steps[i - 1].count;
                  const stepRate = i === 0 ? 100 : prev ? (f.count / prev) * 100 : 0;
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
                Tingkat konversi keseluruhan{" "}
                <span className="font-semibold text-foreground">
                  {((steps[steps.length - 1].count / steps[0].count) * 100).toFixed(1)}%
                </span>{" "}
                — {num(steps[steps.length - 1].count)} pembelian dari {num(steps[0].count)} kunjungan.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Wilayah + perangkat/pelanggan */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><MapPin className="size-4 text-muted-foreground" /> Penjualan per Wilayah</CardTitle>
            <CardDescription>Kota pengiriman dengan penjualan tertinggi · semua pesanan</CardDescription>
          </CardHeader>
          <CardContent>
            {regions.length ? (
              <ul className="space-y-3">
                {regions.map((r) => (
                  <li key={r.city} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 truncate text-sm">{r.city}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${topRegion ? (r.sales / topRegion) * 100 : 0}%` }} />
                    </div>
                    <span className="w-20 shrink-0 text-right text-sm font-medium tabular-nums">{IDR(r.sales, { compact: true })}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState text="Belum ada pesanan — data wilayah muncul dari kota tujuan pengiriman." />
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Smartphone className="size-4 text-muted-foreground" /> Perangkat & Pelanggan</CardTitle>
            <CardDescription>Sesi kunjungan · {rangeLabel(range)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!deviceSplit ? (
              <EmptyState text="Belum ada data kunjungan." />
            ) : (
              deviceSplit.map((d, i) => (
                <div key={d.device}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>{d.device}</span>
                    <span className="font-medium tabular-nums">{d.pct.toFixed(0)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full" style={{ width: `${d.pct}%`, background: `var(--chart-${i + 1})` }} />
                  </div>
                </div>
              ))
            )}
            <Separator className="my-1" />
            {totalMix === 0 ? (
              <p className="text-xs text-muted-foreground">Belum ada pelanggan dengan pesanan.</p>
            ) : (
              mixRows.map((m, i) => {
                const share = (m.value / totalMix) * 100;
                return (
                  <div key={m.type} className="flex items-center gap-2 text-sm">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: `var(--chart-${i + 2})` }} />
                    <span className="flex-1 text-muted-foreground">{m.type}</span>
                    <span className="font-medium tabular-nums">{num(m.value)} · {share.toFixed(0)}%</span>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
