import { Wallet, ShoppingBag, Store, UserPlus, TrendingDown, Coins, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@indostore/ui/card";
import { Avatar, AvatarFallback } from "@indostore/ui/avatar";
import { IDR, num, pct, timeAgo } from "@indostore/lib/format";
import { PLATFORM, STORES, MRR_SERIES, planDistribution, P_ACTIVITY } from "@/lib/mock";
import { initials, PlanBadge, ActivityIcon } from "@/components/bits";
import { MrrChart } from "./mrr-chart";

type Kpi = { label: string; value: string; helper: string; icon: LucideIcon };

const KPIS: Kpi[] = [
  { label: "MRR", value: IDR(PLATFORM.mrr, { compact: true }), helper: "Pendapatan berulang bulanan", icon: Wallet },
  { label: "GMV total", value: IDR(PLATFORM.gmv, { compact: true }), helper: "Nilai transaksi seluruh toko", icon: ShoppingBag },
  { label: "Toko Aktif", value: `${num(PLATFORM.activeStores)} / ${num(PLATFORM.totalStores)}`, helper: "toko aktif dari total", icon: Store },
  { label: "Pendaftar baru (30h)", value: num(PLATFORM.newSignups30d), helper: "30 hari terakhir", icon: UserPlus },
  { label: "Churn", value: pct(PLATFORM.churnRate), helper: "Tingkat pembatalan bulanan", icon: TrendingDown },
  { label: "ARPU", value: IDR(PLATFORM.arpu), helper: "Rata-rata pendapatan / toko", icon: Coins },
];

export default function PlatformDashboard() {
  const maxCount = Math.max(...planDistribution.map((p) => p.count), 1);
  const topStores = [...STORES].sort((a, b) => b.gmv - a.gmv).slice(0, 5);

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Ringkasan performa seluruh platform</p>
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
                <div className="text-xs text-muted-foreground">{k.helper}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* MRR trend + Plan distribution */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Pertumbuhan MRR</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <MrrChart />
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

      {/* Top stores + Activity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Toko Teratas (GMV)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {topStores.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/60">
                <Avatar className="size-9">
                  <AvatarFallback className="bg-primary/12 text-xs font-semibold text-primary">
                    {initials(s.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{s.city}</div>
                </div>
                <PlanBadge plan={s.plan} />
                <div className="w-24 text-right text-sm font-semibold tabular-nums">
                  {IDR(s.gmv, { compact: true })}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Aktivitas Platform</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {P_ACTIVITY.map((a) => (
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
