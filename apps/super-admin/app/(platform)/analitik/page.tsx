import { platformRouteGate } from "@/lib/platform-auth";
import { RouteDenied } from "@/components/route-denied";
import { Wallet, TrendingUp, Receipt, ShoppingBag, Truck, CreditCard, Database, Server, Cpu, MemoryStick, CircleCheck, CircleAlert, CircleHelp, MapPin, Timer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@tokophi/ui/card";
import { Badge } from "@tokophi/ui/badge";
import { IDR, num } from "@tokophi/lib/format";
import { BILLING } from "@tokophi/lib/billing";
import { getStores, getFinanceStats, getSubscriptionStats, getSystemStatus, getServerMetrics, getGmvByCity, getPlatformFloat, getConversion, getCourierCostAbsorbed } from "@/lib/data";
import { cronRows } from "./cron-liveness";

export const dynamic = "force-dynamic";

const gb = (b: number) => `${(b / 1_073_741_824).toFixed(1)} GB`;
const uptime = (s: number) => {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}h ${h}j` : h > 0 ? `${h}j ${m}m` : `${m}m`;
};

export default async function AnalitikPage() {
  // SEC-9: the rank floor for this route group, BEFORE a single privileged read.
  // `platformGate(min)` inside each action stays the mutation boundary; this is additive.
  const gate = await platformRouteGate("/analitik");
  if (!gate.ok) return <RouteDenied need={gate.need} role={gate.role} reason={gate.reason} landing={gate.landing} />;

  const [stores, fin, sub, sys, srv, geo, float, conv, courier] = await Promise.all([
    getStores(), getFinanceStats(), getSubscriptionStats(), getSystemStatus(), getServerMetrics(),
    getGmvByCity(), getPlatformFloat(), getConversion(), getCourierCostAbsorbed(),
  ]);

  const maxGeoGmv = Math.max(...geo.map((c) => c.gmv), 1);
  const topStores = [...stores].sort((a, b) => b.gmv - a.gmv).slice(0, 5);

  // MRR / ARR / revenue are OURS. GMV and saldo merchant are the MERCHANTS'. The cards say so.
  const kpis = [
    { label: "MRR (pendapatan kami)", value: IDR(fin.mrr, { compact: true }), icon: Wallet, hint: `${num(sub.active)} pelanggan berbayar` },
    { label: "ARR (proyeksi)", value: IDR(fin.arr, { compact: true }), icon: TrendingUp, hint: "MRR × 12" },
    { label: "Diterima (tagihan lunas)", value: IDR(fin.revenuePaid, { compact: true }), icon: Receipt, hint: `${num(fin.invoicesPaid)} tagihan · termasuk PPN` },
    { label: "GMV merchant", value: IDR(fin.gmvTotal, { compact: true }), icon: ShoppingBag, hint: "nilai transaksi toko — bukan pendapatan kami" },
  ];

  // NOT a funnel — nothing here measures a stage-to-stage conversion. It is the live distribution of
  // subscription states, and that is what it is now called. (The one real conversion the data
  // supports — trial → bayar — is stated separately, from paid invoices.)
  const lifecycle = [
    { label: "Uji coba", count: sub.trial, cls: "bg-amber-500" },
    { label: "Berbayar", count: sub.active, cls: "bg-emerald-500" },
    { label: "VIP (gratis)", count: sub.vip, cls: "bg-violet-500" },
    { label: "Menunggak", count: sub.pastDue, cls: "bg-orange-500" },
    { label: "Ditangguhkan", count: sub.suspended, cls: "bg-destructive" },
  ];
  const maxLifecycle = Math.max(...lifecycle.map((f) => f.count), 1);

  // CRON LIVENESS — see `cron-liveness.ts`. The clock lives in there, read once for all three rows;
  // a `Date.now()` in this component would be an impure render (and `react-hooks/purity` says so).
  const crons = cronRows(sys.crons);

  const integrations = [
    { label: "KiriminAja (kurir)", ok: sys.kiriminaja, icon: Truck, note: sys.kiriminaja ? `Terhubung · ${sys.kaEnv}` : "Belum dikonfigurasi" },
    { label: "AutoLaris (pembayaran)", ok: sys.autolaris, icon: CreditCard, note: sys.autolaris ? "Terhubung" : "Belum dikonfigurasi" },
    { label: "Database (PostgreSQL)", ok: sys.dbOk, icon: Database, note: sys.dbOk ? `${num(sys.stores)} toko` : "Tidak terjangkau" },
    { label: "Server", ok: true, icon: Server, note: sys.region },
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
            <Row label="MRR (langganan berbayar)" value={IDR(fin.mrr)} />
            <Row label="ARR (proyeksi tahunan)" value={IDR(fin.arr)} />
            <Row label="Diterima (tagihan lunas)" value={`${IDR(fin.revenuePaid)} · ${num(fin.invoicesPaid)}`} accent />
            <Row label="Menunggu pembayaran" value={`${IDR(fin.revenuePending)} · ${num(fin.invoicesPending)}`} warn />
            <Row label="Gagal dibayar" value={`${IDR(fin.revenueFailed)} · ${num(fin.invoicesFailed)}`} warn />
            <Row label="Konversi trial → bayar" value={conv.trialsEnded ? `${num(conv.converted)} dari ${num(conv.trialsEnded)}` : "—"} />
            <div className="mt-1 rounded-lg border bg-sky-500/5 p-3">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Saldo merchant yang kami pegang</span>
                <span className="font-semibold tabular-nums text-sky-700 dark:text-sky-400">{IDR(float.available + float.pending)}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {IDR(float.available)} siap ditarik · {IDR(float.pending)} belum settle · {IDR(float.payoutObligation)} wajib ditransfer. <b>Kewajiban, bukan pendapatan.</b>
              </p>
            </div>
            {/* What carrying parcels costs US. It sits under the float because that is what it
                drains: on a COD order the courier remits NET of its shipping cost while the merchant
                is credited the GROSS, and we cover the gap (ADR 0014). Before this it left no trace
                anywhere — no ledger kind, no column, no screen. */}
            <div className="border-t pt-3">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">Ongkir COD yang kami tanggung</span>
                <span className="font-semibold tabular-nums text-rose-700 dark:text-rose-400">{IDR(courier.codIdr)}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {num(courier.codOrders)} pesanan COD selesai · ADR 0014: merchant tetap dikredit penuh
                termasuk ongkir. <b>Biaya kami, bukan potongan merchant.</b>
                {courier.prepaidIdr > 0 && (
                  <> Ongkir prabayar {IDR(courier.prepaidIdr)} ({num(courier.prepaidOrders)} pesanan) — <b>mekanisme sama, belum diputuskan.</b></>
                )}
                {courier.unrecordedOrders > 0 && (
                  <> {num(courier.unrecordedOrders)} pesanan dibooking sebelum biayanya dicatat — <b>tidak diketahui, bukan nol</b>.</>
                )}
                {" "}Baru ongkir; biaya layanan COD belum bisa dibaca, jadi angka sebenarnya segini <b>atau lebih</b>.
              </p>
            </div>
            <div className="border-t pt-3 text-xs text-muted-foreground">
              Paket {BILLING.PLAN_NAME}: {IDR(BILLING.MONTHLY_IDR)}/bln · tahunan {IDR(BILLING.ANNUAL_MONTHLY_IDR)}/bln ({IDR(BILLING.ANNUAL_IDR)}/thn). Semua jumlah tagihan sudah termasuk PPN 11%.
            </div>
          </CardContent>
        </Card>

        {/* subscription lifecycle distribution */}
        <Card>
          <CardHeader><CardTitle>Sebaran Langganan</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {lifecycle.map((f) => (
              <div key={f.label}>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2"><span className={`size-2.5 rounded-full ${f.cls}`} />{f.label}</span>
                  <span className="font-semibold tabular-nums">{num(f.count)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${f.cls}`} style={{ width: `${(f.count / maxLifecycle) * 100}%` }} /></div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* GMV per delivery province — from orders.province (where the parcels actually go) */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><MapPin className="size-4 text-muted-foreground" /> GMV per Kota Tujuan</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Dari alamat kirim pesanan, bukan domisili toko — ini yang menentukan cakupan kurir &amp; COD.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {geo.map((c) => (
              <div key={c.city} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{c.city}</span>
                  <span className="tabular-nums text-muted-foreground">{num(c.orders)} pesanan · {IDR(c.gmv, { compact: true })}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary/70" style={{ width: `${(c.gmv / maxGeoGmv) * 100}%` }} /></div>
              </div>
            ))}
            {geo.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Belum ada data.</p>}
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

            {/*
              Cron sidecars. They belong on THIS card and not in a corner of their own: the resi poller
              is as load-bearing as the courier API above it — `awbFilled` sat at 0 for a week because
              the only evidence lived in `docker logs`, which nobody opens without already suspecting
              something. The verdict carries a glyph AND a word, never colour alone (WCAG 1.4.1), and
              has a third NEUTRAL state for "nothing has reported yet" so a fresh deploy does not paint
              a false alarm the day it lands.
            */}
            <p className="pt-1 text-xs font-medium text-muted-foreground">Tugas terjadwal (cron)</p>
            {crons.map((c) => {
              const bad = c.state === "late" || c.state === "error";
              const Icon = c.state === "ok" ? CircleCheck : c.state === "unknown" ? CircleHelp : CircleAlert;
              return (
                <div key={c.job} className={`flex items-center gap-3 rounded-lg border p-2.5 ${bad ? "border-destructive/40 bg-destructive/5" : ""}`}>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Timer className="size-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {c.label} <span className="font-normal text-muted-foreground">· {c.what}</span>
                    </p>
                    {/* NOT truncated, unlike the label above it. This line carries the run's own
                        counters, and on this narrow card `truncate` cut them off at "gagal …" —
                        hiding "resi terisi 0", the one number the whole panel was built to show. */}
                    <p className={`text-xs ${bad ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                      {c.when} · {c.note}
                    </p>
                  </div>
                  <Icon className={`size-4 shrink-0 ${bad ? "text-destructive" : c.state === "ok" ? "text-emerald-600" : "text-muted-foreground"}`} />
                  <span className="sr-only">{bad ? (c.state === "late" ? "terlambat" : "gagal") : c.state === "ok" ? "normal" : "belum diketahui"}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* server metrics (real-time) */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Server className="size-4 text-muted-foreground" /> Server (VPS) · realtime</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Metric icon={<Cpu className="size-4" />} label="CPU" value={`${srv.cpuPct}%`} sub={`load ${srv.cpuLoad1} · ${srv.cpuCores} core`} pct={srv.cpuPct} />
          <Metric icon={<MemoryStick className="size-4" />} label="RAM" value={`${srv.memPct}%`} sub={`${gb(srv.memUsed)} / ${gb(srv.memTotal)}`} pct={srv.memPct} />
          <Metric icon={<Server className="size-4" />} label="Uptime" value={uptime(srv.uptimeSec)} sub={sys.region} />
        </CardContent>
      </Card>

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

function Metric({ icon, label, value, sub, pct }: { icon: import("react").ReactNode; label: string; value: string; sub: string; pct?: number }) {
  const tone = pct === undefined ? "bg-primary/70" : pct >= 85 ? "bg-destructive" : pct >= 60 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">{icon}{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
      {pct !== undefined && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
      )}
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
