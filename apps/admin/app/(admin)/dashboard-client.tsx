"use client";
import { useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { DateRangeSwitcher } from "@/components/admin/date-range-switcher";
import { SalesChart } from "@/components/admin/sales-chart";
import { ChannelChart } from "@/components/admin/channel-chart";
import { TopProducts } from "@/components/admin/top-products";
import { RecentOrders } from "@/components/admin/recent-orders";
import { LiveActivity } from "@/components/admin/live-activity";
import { OrderStatusBadge } from "@/components/admin/order-status";
import { ActionQueue } from "@/components/admin/dashboard/action-queue";
import { MoneyStrip } from "@/components/admin/dashboard/money-strip";
import { ReturnByCourier } from "@/components/admin/dashboard/return-by-courier";
import {
  type RangeKey, getSummary, getSeries, getTopProducts, getChannels,
  getRecentOrders, getActivities, getStatusCounts, rangeLabel,
  getVisitsKpi, getConversionKpi,
  getActionQueue, getStuckMoney, getMoneyTiles, getReturnSummary,
} from "@/lib/data/dashboard";
import type { ChannelDay, HourPoint, ProductSaleDay } from "@/lib/data/analytics";
import type { FunnelDay } from "@/lib/data/funnel";
import type { CourierReturns } from "@/lib/data/returns";
import type { TicketRow } from "@/lib/data/support";
import type { DayPoint, Product, Order, Activity, Review } from "@/lib/mock/store";
import { IDR, num, pct, share } from "@tokophi/lib/format";
import { exportCsv } from "@/lib/csv";

export function DashboardClient({
  days,
  hours,
  products,
  orders,
  reviews,
  tickets,
  returns,
  activities,
  channels,
  productSales,
  funnel,
  storeName,
  ownerName,
}: {
  days: DayPoint[];
  hours: HourPoint[];
  products: Product[];
  orders: Order[];
  reviews: Review[];
  tickets: TicketRow[];
  returns: CourierReturns[];
  activities: Activity[];
  channels: ChannelDay[];
  productSales: ProductSaleDay[];
  funnel: FunnelDay[];
  storeName?: string;
  ownerName?: string;
}) {
  const [range, setRange] = useState<RangeKey>("30d");
  const s = getSummary(days, range);
  const { points } = getSeries(days, range, hours);

  // What has to be done RIGHT NOW + where the money is stuck. Counts only — every one of them is a
  // filter over rows the server already fetched, so each traces back to an existing query.
  const queue = getActionQueue(orders, products, reviews, tickets);
  const stuck = getStuckMoney(orders);
  const moneyTiles = getMoneyTiles(days);
  const returnSummary = getReturnSummary(returns);

  // Pengunjung + Konversi are COUNTED from analytics_events; "—" when the store has no events.
  const visits = getVisitsKpi(funnel, days, range);
  const conversion = getConversionKpi(funnel, days, range);
  const topProducts = getTopProducts(productSales, range, days);
  const channelSlices = getChannels(channels, range, days);

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      {/* header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Halo {ownerName?.split(" ")[0] ?? "Ongki"} 👋 — ini yang perlu Anda kerjakan di <span className="font-medium text-foreground">{storeName ?? "toko Anda"}</span> hari ini.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangeSwitcher value={range} onChange={setRange} />
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => exportCsv("produk-terlaris", [...products].sort((a, b) => b.unitsSold - a.unitsSold).slice(0, 20).map((p) => ({ Produk: p.name, Kategori: p.category, Terjual: p.unitsSold, Harga: p.price, Stok: p.stock })))}
          >
            <Download className="size-4" /> Ekspor
          </Button>
        </div>
      </div>

      {/* 1 — what do I have to do right now? */}
      <ActionQueue items={queue} stuck={stuck} />

      {/* 2 — money at a glance (fixed ranges) + return rate */}
      <MoneyStrip tiles={moneyTiles} returns={returnSummary} />

      {/* chart + live activity — these follow the range switcher */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Grafik Penjualan · {rangeLabel(range)}</CardTitle>
              {/* ⚠️ EVERY FIGURE ON THIS LINE IS REWRITTEN BY THE RANGE SWITCHER, and it was the
                  widest re-flow on the dashboard: measured 1440px 2026-08-06, 71,67px between an
                  all-1 and an all-8 rendering, so each of the four `·` separators landed somewhere
                  new on every click. tabular-nums pins them.
                  ⚠️ `share()`, not `toFixed(1)`. Konversi is a part of a whole, and the local copy
                  printed an ASCII decimal POINT — "konversi 0.0%" — in an id-ID panel where every
                  other number on the same line carries a comma. It is not `pct()` either: that one
                  stamps a sign, and this figure is not a change. */}
              <CardDescription className="tabular-nums">
                {IDR(s.sales.value)} · {pct(s.sales.delta)} vs {s.compareLabel} · {num(s.orders.value)} pesanan
                {visits ? ` · ${num(visits.value)} pengunjung` : ""}
                {conversion ? ` · konversi ${share(conversion.value)}` : ""}
              </CardDescription>
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
          <CardContent><LiveActivity items={getActivities(activities)} /></CardContent>
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
          <CardContent>
            {topProducts.length
              ? <TopProducts items={topProducts} />
              : <p className="py-8 text-center text-sm text-muted-foreground">Belum ada penjualan pada periode ini.</p>}
          </CardContent>
        </Card>
      </div>

      {/* channels + status + returns */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Sumber Penjualan</CardTitle><CardDescription>Channel yang tercatat di tiap pesanan</CardDescription></CardHeader>
          <CardContent>
            {channelSlices.length
              ? <ChannelChart data={channelSlices} />
              : <p className="py-8 text-center text-sm text-muted-foreground">Belum ada pesanan pada periode ini.</p>}
          </CardContent>
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
                {/* w-11, not w-6. `tabular-nums` only guarantees the digits are the same width — it
                    cannot make them FIT. Measured 1440px 2026-08-06 on this store: "678" inks
                    25,7px inside a 24px box, so a three-digit status count spilled left over the
                    bar it is meant to sit beside, and a four-digit one would spill further. 44px is
                    the same column width `dashboard/return-by-courier.tsx` uses and holds "1.234". */}
                <span className="w-11 shrink-0 text-right text-sm font-medium tabular-nums">{num(r.count)}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <ReturnByCourier returns={returnSummary} />
      </div>
    </div>
  );
}
