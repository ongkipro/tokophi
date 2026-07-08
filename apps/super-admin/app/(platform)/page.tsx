import Link from "next/link";
import {
  Wallet,
  ShoppingBag,
  Store,
  UserPlus,
  TrendingDown,
  Coins,
  ArrowUpRight,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@tokophi/ui/card";
import { Avatar, AvatarFallback } from "@tokophi/ui/avatar";
import { IDR, num, pct, timeAgo } from "@tokophi/lib/format";
import { type StoreStatus } from "@/lib/mock";
import { initials, PlanBadge, ActivityIcon, InvoiceBadge, Delta } from "@/components/bits";
import { MrrChart } from "./mrr-chart";
import {
  getPlatform,
  getDeltas,
  getStores,
  getPlanDistribution,
  getStatusDistribution,
  getInvoices,
  getActivity,
  getMrrSeries,
} from "@/lib/data";

export const dynamic = "force-dynamic";

type Kpi = {
  label: string;
  value: string;
  helper: string;
  icon: LucideIcon;
  delta: number;
  invert?: boolean;
  unit?: string;
};

const STATUS_BAR: Record<StoreStatus, string> = {
  aktif: "bg-emerald-500",
  trial: "bg-amber-500",
  ditangguhkan: "bg-destructive",
};

export default async function PlatformDashboard() {
  const [platform, deltas, stores, planDistribution, statusDistribution, invoices, activity, mrrSeries] =
    await Promise.all([
      getPlatform(),
      getDeltas(),
      getStores(),
      getPlanDistribution(),
      getStatusDistribution(),
      getInvoices(),
      getActivity(),
      getMrrSeries(),
    ]);

  const KPIS: Kpi[] = [
    { label: "MRR", value: IDR(platform.mrr, { compact: true }), helper: "Pendapatan berulang bulanan", icon: Wallet, delta: deltas.mrr },
    { label: "GMV total", value: IDR(platform.gmv, { compact: true }), helper: "Nilai transaksi seluruh toko", icon: ShoppingBag, delta: deltas.gmv },
    { label: "Toko Aktif", value: `${num(platform.activeStores)} / ${num(platform.totalStores)}`, helper: "toko aktif dari total", icon: Store, delta: deltas.activeStores, unit: "" },
    { label: "Pendaftar baru (30h)", value: num(platform.newSignups30d), helper: "30 hari terakhir", icon: UserPlus, delta: deltas.newSignups30d },
    { label: "Churn", value: pct(platform.churnRate), helper: "Tingkat pembatalan bulanan", icon: TrendingDown, delta: deltas.churn, invert: true, unit: "pp" },
    { label: "ARPU", value: IDR(platform.arpu), helper: "Rata-rata pendapatan / toko", icon: Coins, delta: deltas.arpu },
  ];

  const maxCount = Math.max(...planDistribution.map((p) => p.count), 1);
  const topStores = [...stores].sort((a, b) => b.gmv - a.gmv).slice(0, 5);
  const totalStatus = statusDistribution.reduce((a, s) => a + s.count, 0) || 1;
  const recentInvoices = [...invoices].sort((a, b) => a.daysAgo - b.daysAgo).slice(0, 6);
  const outstanding = invoices.filter((i) => i.status !== "dibayar").reduce((a, i) => a + i.amount, 0);

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Ringkasan performa seluruh platform</p>
        </div>
        <span className="text-xs text-muted-foreground">Perbandingan vs bulan lalu</span>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {KPIS.map((k) => {
          const Icon = k.icon;
          return (
            <Card key={k.label} size="sm">
              <CardContent className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">{k.label}</span>
                  <Icon className="size-4 text-muted-foreground" />
                </div>
                <div className="text-xl font-bold tabular-nums">{k.value}</div>
                <div className="flex items-center gap-1.5">
                  <Delta value={k.delta} invert={k.invert} unit={k.unit} />
                </div>
                <div className="text-xs text-muted-foreground">{k.helper}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* MRR trend + Plan distribution */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Pertumbuhan MRR</CardTitle>
            <span className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
              {deltas.mrr >= 0 ? "+" : "−"}
              {Math.abs(deltas.mrr)}% MoM
            </span>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <MrrChart data={mrrSeries} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Distribusi Paket</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {planDistribution.map((p) => (
              <div key={p.plan} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{p.name}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {num(p.count)} toko · {IDR(p.mrr, { compact: true })}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${(p.count / maxCount) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Recent invoices + Store status */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Tagihan Terbaru</CardTitle>
            <Link href="/paket" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
              Lihat semua <ArrowUpRight className="size-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-6 pb-2 font-medium">Invoice</th>
                    <th className="px-2 pb-2 font-medium">Toko</th>
                    <th className="px-2 pb-2 font-medium">Paket</th>
                    <th className="px-2 pb-2 text-right font-medium">Jumlah</th>
                    <th className="px-2 pb-2 font-medium">Status</th>
                    <th className="px-6 pb-2 text-right font-medium">Waktu</th>
                  </tr>
                </thead>
                <tbody>
                  {recentInvoices.map((inv) => (
                    <tr key={inv.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-6 py-2.5 font-mono text-xs">{inv.id}</td>
                      <td className="max-w-[10rem] truncate px-2 py-2.5 font-medium">{inv.store}</td>
                      <td className="px-2 py-2.5">
                        <PlanBadge plan={inv.plan} />
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{IDR(inv.amount)}</td>
                      <td className="px-2 py-2.5">
                        <InvoiceBadge status={inv.status} />
                      </td>
                      <td className="px-6 py-2.5 text-right text-xs text-muted-foreground">
                        {timeAgo(inv.daysAgo * 1440)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t px-6 py-3 text-sm">
              <span className="text-muted-foreground">Tagihan tertunggak</span>
              <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">{IDR(outstanding)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Status Toko</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex h-3 overflow-hidden rounded-full">
              {statusDistribution.map((s) => (
                <div
                  key={s.status}
                  className={STATUS_BAR[s.status]}
                  style={{ width: `${(s.count / totalStatus) * 100}%` }}
                  title={`${s.label}: ${s.count}`}
                />
              ))}
            </div>
            <div className="space-y-2.5">
              {statusDistribution.map((s) => (
                <div key={s.status} className="flex items-center gap-2.5 text-sm">
                  <span className={`size-2.5 shrink-0 rounded-full ${STATUS_BAR[s.status]}`} />
                  <span className="flex-1">{s.label}</span>
                  <span className="font-semibold tabular-nums">{s.count}</span>
                  <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
                    {pct((s.count / totalStatus) * 100)}
                  </span>
                </div>
              ))}
            </div>
            {platform.trialStores > 0 && (
              <div className="rounded-lg bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400">
                {platform.trialStores} toko dalam masa trial — peluang konversi ke berbayar.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top stores + Activity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Toko Teratas (GMV)</CardTitle>
            <Link href="/toko" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
              Semua toko <ArrowUpRight className="size-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-1">
            {topStores.map((s) => (
              <Link
                key={s.id}
                href={`/toko/${s.id}`}
                className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60"
              >
                <Avatar className="size-9">
                  <AvatarFallback className="bg-primary/12 text-xs font-semibold text-primary">
                    {initials(s.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {s.city} · {num(s.orders)} pesanan
                  </div>
                </div>
                <PlanBadge plan={s.plan} />
                <div className="w-24 text-right text-sm font-semibold tabular-nums">
                  {IDR(s.gmv, { compact: true })}
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Aktivitas Platform</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {activity.map((a) => (
              <div key={a.id} className="flex items-start gap-3">
                <ActivityIcon kind={a.kind} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug">{a.text}</p>
                  <p className="text-xs text-muted-foreground">{timeAgo(a.minutesAgo)}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
