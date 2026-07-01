import { Store, CheckCircle2, Clock, Ban } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@indostore/ui/card";
import { IDR, num, pct } from "@indostore/lib/format";
import { STORES, PLANS, PLATFORM, type StoreStatus } from "@/lib/mock";

// GMV aggregated per plan.
const gmvPerPlan = PLANS.map((p) => ({
  key: p.key,
  name: p.name,
  gmv: STORES.filter((s) => s.plan === p.key).reduce((a, s) => a + s.gmv, 0),
  count: STORES.filter((s) => s.plan === p.key).length,
}));

// GMV aggregated per city (top 8).
const gmvPerCity = Object.values(
  STORES.reduce<Record<string, { city: string; gmv: number; count: number }>>((acc, s) => {
    acc[s.city] ??= { city: s.city, gmv: 0, count: 0 };
    acc[s.city].gmv += s.gmv;
    acc[s.city].count += 1;
    return acc;
  }, {}),
)
  .sort((a, b) => b.gmv - a.gmv)
  .slice(0, 8);

const STATUS_CARDS: { status: StoreStatus; label: string; count: number; icon: typeof Store; tint: string }[] = [
  { status: "aktif", label: "Toko Aktif", count: PLATFORM.activeStores, icon: CheckCircle2, tint: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
  { status: "trial", label: "Toko Trial", count: PLATFORM.trialStores, icon: Clock, tint: "bg-amber-500/12 text-amber-600 dark:text-amber-400" },
  { status: "ditangguhkan", label: "Ditangguhkan", count: PLATFORM.suspendedStores, icon: Ban, tint: "bg-destructive/12 text-destructive" },
];

function BarRow({ label, sub, value, max }: { label: string; sub: string; value: number; max: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">{sub}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary/70" style={{ width: `${max ? (value / max) * 100 : 0}%` }} />
      </div>
    </div>
  );
}

export default function AnalitikPage() {
  const maxPlanGmv = Math.max(...gmvPerPlan.map((p) => p.gmv), 1);
  const maxCityGmv = Math.max(...gmvPerCity.map((c) => c.gmv), 1);
  const totalStatus = PLATFORM.totalStores || 1;

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analitik</h1>
        <p className="text-sm text-muted-foreground">Analisis GMV, sebaran kota, dan status toko di seluruh platform</p>
      </div>

      {/* Status summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {STATUS_CARDS.map((c) => {
          const Icon = c.icon;
          return (
            <Card key={c.status} size="sm">
              <CardContent className="flex items-center gap-3">
                <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${c.tint}`}>
                  <Icon className="size-5" />
                </span>
                <div>
                  <div className="text-2xl font-bold tabular-nums">{num(c.count)}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.label} · {pct((c.count / totalStatus) * 100)}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* GMV per plan + per city */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>GMV per Paket</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {gmvPerPlan.map((p) => (
              <BarRow
                key={p.key}
                label={p.name}
                sub={`${num(p.count)} toko · ${IDR(p.gmv, { compact: true })}`}
                value={p.gmv}
                max={maxPlanGmv}
              />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>GMV per Kota</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {gmvPerCity.map((c) => (
              <BarRow
                key={c.city}
                label={c.city}
                sub={`${num(c.count)} toko · ${IDR(c.gmv, { compact: true })}`}
                value={c.gmv}
                max={maxCityGmv}
              />
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
