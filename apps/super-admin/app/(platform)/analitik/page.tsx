import { Wallet, TrendingUp, Receipt, ShoppingBag, Truck, CreditCard, Database, Server, CircleCheck, CircleAlert, MapPin } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@tokophi/ui/card";
import { Badge } from "@tokophi/ui/badge";
import { IDR, num } from "@tokophi/lib/format";
import { BILLING } from "@tokophi/lib/billing";
import { getStores, getFinanceStats, getSubscriptionStats, getSystemStatus } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function AnalitikPage() {
  const [stores, fin, sub, sys] = await Promise.all([getStores(), getFinanceStats(), getSubscriptionStats(), getSystemStatus()]);

  // GMV per city (top 8)
  const gmvPerCity = Object.values(
    stores.reduce<Record<string, { city: string; gmv: number; count: number }>>((acc, s) => {
      const city = s.city || "—";
      acc[city] ??= { city, gmv: 0, count: 0 };
      acc[city].gmv += s.gmv;
      acc[city].count += 1;
      return acc;
    }, {}),
  ).sort((a, b) => b.gmv - a.gmv).slice(0, 8);
  const maxCityGmv = Math.max(...gmvPerCity.map((c) => c.gmv), 1);
  const topStores = [...stores].sort((a, b) => b.gmv - a.gmv).slice(0, 5);

  const kpis = [
    { label: "MRR", value: IDR(fin.mrr, { compact: true }), icon: Wallet, hint: `${num(sub.active)} pelanggan aktif` },
    { label: "ARR (proyeksi)", value: IDR(fin.arr, { compact: true }), icon: TrendingUp, hint: "MRR × 12" },
    { label: "Pendapatan diterima", value: IDR(fin.revenuePaid, { compact: true }), icon: Receipt, hint: `${num(fin.invoicesPaid)} tagihan lunas` },
    { label: "GMV platform", value: IDR(fin.gmvTotal, { compact: true }), icon: ShoppingBag, hint: `${num(stores.length)} toko` },
  ];

  const funnel = [
    { label: "Uji coba", count: sub.trial, cls: "bg-amber-500" },
    { label: "Aktif", count: sub.active, cls: "bg-emerald-500" },
    { label: "Menunggak", count: sub.pastDue, cls: "bg-orange-500" },
    { label: "Ditangguhkan", count: sub.suspended, cls: "bg-destructive" },
  ];
  const maxFunnel = Math.max(...funnel.map((f) => f.count), 1);

  const integrations = [
    { label: "KiriminAja (kurir)", ok: sys.kiriminaja, icon: Truck, note: sys.kiriminaja ? `Terhubung · ${sys.kaEnv}` : "Belum dikonfigurasi" },
    { label: "AutoLaris (pembayaran)", ok: sys.autolaris, icon: CreditCard, note: sys.autolaris ? "Terhubung" : "Belum dikonfigurasi" },
    { label: "Database (PostgreSQL)", ok: sys.dbOk, icon: Database, note: sys.dbOk ? `${num(sys.stores)} toko` : "Tidak terjangkau" },
    { label: "Server", ok: true, icon: Server, note: `${sys.region} · Coolify` },
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Keuangan &amp; Analitik</h1>
        <p className="text-sm text-muted-foreground">Pendapatan langganan, GMV, dan status sistem platform.</p>
      </div>

      {/* finance KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className="gap-0 p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">{k.label}</span>
              <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground"><k.icon className="size-4" /></span>
            </div>
            <div className="mt-3 text-2xl font-bold tracking-tight tabular-nums">{k.value}</div>
            <p className="mt-1 text-xs text-muted-foreground">{k.hint}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* revenue detail */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Ringkasan Pendapatan</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="MRR (langganan aktif)" value={IDR(fin.mrr)} />
            <Row label="ARR (proyeksi tahunan)" value={IDR(fin.arr)} />
            <Row label="Diterima (tagihan lunas)" value={`${IDR(fin.revenuePaid)} · ${num(fin.invoicesPaid)}`} accent />
            <Row label="Menunggu pembayaran" value={`${IDR(fin.revenuePending)} · ${num(fin.invoicesPending)}`} warn />
            <Row label="Langganan tahunan" value={`${num(fin.annualPaid)} tagihan`} />
            <div className="border-t pt-3 text-xs text-muted-foreground">
              Paket {BILLING.PLAN_NAME}: {IDR(BILLING.MONTHLY_IDR)}/bln · tahunan {IDR(BILLING.ANNUAL_MONTHLY_IDR)}/bln ({IDR(BILLING.ANNUAL_IDR)}/thn).
            </div>
          </CardContent>
        </Card>

        {/* subscription funnel */}
        <Card>
          <CardHeader><CardTitle>Corong Langganan</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {funnel.map((f) => (
              <div key={f.label}>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2"><span className={`size-2.5 rounded-full ${f.cls}`} />{f.label}</span>
                  <span className="font-semibold tabular-nums">{num(f.count)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${f.cls}`} style={{ width: `${(f.count / maxFunnel) * 100}%` }} /></div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* GMV per city */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="flex items-center gap-2"><MapPin className="size-4 text-muted-foreground" /> GMV per Kota</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {gmvPerCity.map((c) => (
              <div key={c.city} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{c.city}</span>
                  <span className="tabular-nums text-muted-foreground">{num(c.count)} toko · {IDR(c.gmv, { compact: true })}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary/70" style={{ width: `${(c.gmv / maxCityGmv) * 100}%` }} /></div>
              </div>
            ))}
            {gmvPerCity.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Belum ada data.</p>}
          </CardContent>
        </Card>

        {/* system & integrations */}
        <Card>
          <CardHeader><CardTitle>Sistem &amp; Integrasi</CardTitle></CardHeader>
          <CardContent className="space-y-2.5">
            {integrations.map((i) => (
              <div key={i.label} className="flex items-center gap-3 rounded-lg border p-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><i.icon className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{i.label}</p>
                  <p className="text-xs text-muted-foreground">{i.note}</p>
                </div>
                {i.ok ? <CircleCheck className="size-4 shrink-0 text-emerald-600" /> : <CircleAlert className="size-4 shrink-0 text-destructive" />}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* top stores */}
      <Card>
        <CardHeader><CardTitle>Toko Teratas (GMV)</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {topStores.map((s, i) => (
            <div key={s.id} className="flex items-center gap-3 border-b pb-2 text-sm last:border-0 last:pb-0">
              <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">{i + 1}</span>
              <span className="flex-1 truncate font-medium">{s.name}</span>
              <Badge variant="secondary" className="border-transparent text-xs">{s.city}</Badge>
              <span className="tabular-nums font-semibold">{IDR(s.gmv, { compact: true })}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, accent, warn }: { label: string; value: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium tabular-nums ${accent ? "text-emerald-600 dark:text-emerald-400" : warn ? "text-orange-600 dark:text-orange-400" : ""}`}>{value}</span>
    </div>
  );
}
