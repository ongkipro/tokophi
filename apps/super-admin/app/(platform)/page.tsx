import Link from "next/link";
import {
  Wallet,
  ShoppingBag,
  Store,
  UserPlus,
  Coins,
  ArrowUpRight,
  ArrowRight,
  Landmark,
  Receipt,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@tokophi/ui/card";
import { Avatar, AvatarFallback } from "@tokophi/ui/avatar";
import { Badge } from "@tokophi/ui/badge";
import { IDR, num, share, timeAgo } from "@tokophi/lib/format";
import { initials, SegmentBadge, ActivityIcon, InvoiceBadge, RiskReasonChip } from "@/components/bits";
import { RevenueChart } from "./revenue-chart";
import {
  getPlatform,
  getStores,
  getSubscriptionStats,
  getStatusDistribution,
  type StatusSlice,
  getInvoices,
  getActivity,
  getRevenueSeries,
  getPlatformFloat,
  getRiskQueue,
  getConversion,
  getFinanceStats,
} from "@/lib/data";

export const dynamic = "force-dynamic";

// Keyed on `StatusSlice`, not `StoreStatus`: this card's slices must sum to EVERY store, and VIP —
// which has no `StoreStatus` member — was simply missing. The card totalled 6 while the KPI beside
// it read "Toko aktif 2 / 7", and every share on it was a share of the wrong denominator.
const STATUS_BAR: Record<StatusSlice, string> = {
  aktif: "bg-emerald-500",
  vip: "bg-violet-500",
  trial: "bg-amber-500",
  menunggak: "bg-orange-500",
  ditangguhkan: "bg-destructive",
};

export default async function PlatformDashboard() {
  const [platform, stores, subStats, statusDistribution, invoices, activity, revenue, float, risk, conv, fin] =
    await Promise.all([
      getPlatform(),
      getStores(),
      getSubscriptionStats(),
      getStatusDistribution(),
      getInvoices(),
      getActivity(),
      getRevenueSeries(),
      getPlatformFloat(),
      getRiskQueue(),
      getConversion(),
      getFinanceStats(),
    ]);

  // KPIs. Every one of these is a number with a query behind it — there are no deltas, because
  // nothing in the schema records last month's value of any of them.
  const KPIS: { label: string; value: string; helper: string; icon: LucideIcon; tone?: string }[] = [
    { label: "MRR", value: IDR(platform.mrr, { compact: true }), helper: `${num(subStats.active)} toko berbayar · ARPU ${IDR(platform.arpu, { compact: true })}`, icon: Wallet },
    { label: "ARR (proyeksi)", value: IDR(platform.mrr * 12, { compact: true }), helper: "MRR × 12", icon: Coins },
    { label: "Diterima (total)", value: IDR(fin.revenuePaid, { compact: true }), helper: `${num(fin.invoicesPaid)} tagihan lunas`, icon: Receipt },
    {
      label: "Saldo merchant",
      value: IDR(float.available + float.pending, { compact: true }),
      helper: `uang milik ${num(float.storesWithBalance)} toko — bukan pendapatan kami`,
      icon: Landmark,
      tone: "text-sky-600 dark:text-sky-400",
    },
    { label: "Toko aktif", value: `${num(platform.activeStores)} / ${num(platform.totalStores)}`, helper: `${num(platform.trialStores)} trial · ${num(platform.suspendedStores)} ditangguhkan`, icon: Store },
    { label: "Pendaftar baru (30h)", value: num(platform.newSignups30d), helper: "30 hari terakhir", icon: UserPlus },
  ];

  const topStores = [...stores].sort((a, b) => b.gmv - a.gmv).slice(0, 5);
  const totalStatus = statusDistribution.reduce((a, s) => a + s.count, 0) || 1;
  const recentInvoices = invoices.slice(0, 6);
  const worklist = risk.slice(0, 6);

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Ringkasan performa seluruh platform</p>
        </div>
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
                <div className={`text-xl font-bold tabular-nums ${k.tone ?? ""}`}>{k.value}</div>
                <div className="text-xs leading-snug text-muted-foreground">{k.helper}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* PERLU TINDAKAN — the operator's morning. Stacked reasons, each one a fact. */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <TriangleAlert className="size-4 text-amber-600 dark:text-amber-400" />
            Perlu tindakan
            {risk.length > 0 && (
              <Badge variant="secondary" className="border-transparent bg-amber-500/12 text-amber-600 dark:text-amber-400">
                {num(risk.length)}
              </Badge>
            )}
          </CardTitle>
          <Link href="/toko" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            Kelola toko <ArrowUpRight className="size-3.5" />
          </Link>
        </CardHeader>
        <CardContent>
          {worklist.length ? (
            <ul className="divide-y">
              {worklist.map((r) => (
                <li key={r.id}>
                  <Link href={`/toko/${r.id}`} className="flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-muted/60">
                    <Avatar className="size-9">
                      <AvatarFallback className="bg-primary/12 text-xs font-semibold text-primary">{initials(r.name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{r.name}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {r.reasons.map((reason, i) => (
                          <RiskReasonChip key={i} reason={reason} />
                        ))}
                      </div>
                    </div>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex min-h-24 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
              Tidak ada toko yang butuh tindakan 🎉
            </div>
          )}
        </CardContent>
      </Card>

      {/* Collected revenue + subscription summary */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-start justify-between">
            <div>
              <CardTitle>Pendapatan Langganan Diterima</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Tagihan berstatus dibayar, per bulan terbit (termasuk PPN 11%).</p>
            </div>
            <span className="whitespace-nowrap text-sm font-semibold tabular-nums">{IDR(fin.revenuePaid, { compact: true })} total</span>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <RevenueChart data={revenue} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ringkasan Langganan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border bg-primary/5 p-3">
              <p className="text-xs text-muted-foreground">Paket TokoΦ · satu paket, semua fitur</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums">
                {IDR(275_000)}
                <span className="text-sm font-normal text-muted-foreground">/bln</span>
              </p>
              <p className="text-[11px] text-muted-foreground">3 hari trial → Rp50rb bln-1 → Rp275rb seterusnya</p>
            </div>
            {[
              { label: "Pelanggan berbayar", value: `${num(subStats.active)} · ${IDR(subStats.mrr, { compact: true })} MRR`, cls: "text-emerald-600 dark:text-emerald-400" },
              { label: "VIP (gratis)", value: num(subStats.vip), cls: "text-violet-600 dark:text-violet-400" },
              { label: "Uji coba", value: `${num(subStats.trial)}${subStats.trialEndingSoon ? ` · ${num(subStats.trialEndingSoon)} berakhir ≤1h` : ""}`, cls: "text-amber-600 dark:text-amber-400" },
              { label: "Menunggak", value: num(subStats.pastDue), cls: "text-orange-600 dark:text-orange-400" },
              { label: "Ditangguhkan", value: num(subStats.suspended), cls: "text-destructive" },
            ].map((r) => (
              <div key={r.label} className="flex items-center justify-between border-b pb-2 text-sm last:border-0 last:pb-0">
                <span className="text-muted-foreground">{r.label}</span>
                <span className={`font-medium tabular-nums ${r.cls}`}>{r.value}</span>
              </div>
            ))}
            <div className="rounded-lg border p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">Konversi trial → bayar</span>
                <span className="text-sm font-semibold tabular-nums">
                  {num(conv.converted)} dari {num(conv.trialsEnded)}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {conv.trialsEnded ? `${Math.round(conv.rate * 100)}% toko yang trialnya berakhir pernah membayar` : "Belum ada trial yang berakhir"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* SALDO MERCHANT (float) + store status */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Landmark className="size-4 text-muted-foreground" /> Uang Merchant yang Kami Pegang
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Kewajiban platform, bukan pendapatan. Sumber: <code className="font-mono text-[11px]">ledger_entries</code> + <code className="font-mono text-[11px]">payouts</code>.
              </p>
            </div>
            <Link href="/pencairan" className="inline-flex shrink-0 items-center gap-1 text-sm text-primary hover:underline">
              Antrean pencairan <ArrowUpRight className="size-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border p-4">
              <div className="text-xs text-muted-foreground">Tersedia (bisa ditarik)</div>
              <div className="mt-1 text-xl font-bold tabular-nums">{IDR(float.available)}</div>
              <p className="mt-1 text-[11px] text-muted-foreground">Merchant boleh menariknya kapan saja.</p>
            </div>
            <div className="rounded-xl border p-4">
              <div className="text-xs text-muted-foreground">Dalam proses (belum settle)</div>
              <div className="mt-1 text-xl font-bold tabular-nums">{IDR(float.pending)}</div>
              <p className="mt-1 text-[11px] text-muted-foreground">Cair saat pesanan selesai.</p>
            </div>
            <div className={`rounded-xl border p-4 ${float.payoutPendingCount ? "border-amber-300 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/20" : ""}`}>
              <div className="text-xs text-muted-foreground">Wajib ditransfer</div>
              <div className={`mt-1 text-xl font-bold tabular-nums ${float.payoutPendingCount ? "text-amber-700 dark:text-amber-400" : ""}`}>
                {IDR(float.payoutObligation)}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{num(float.payoutPendingCount)} permintaan pencairan menunggu kami.</p>
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
                <div key={s.status} className={STATUS_BAR[s.status]} style={{ width: `${(s.count / totalStatus) * 100}%` }} title={`${s.label}: ${s.count}`} />
              ))}
            </div>
            <div className="space-y-2.5">
              {statusDistribution.map((s) => (
                <div key={s.status} className="flex items-center gap-2.5 text-sm">
                  <span className={`size-2.5 shrink-0 rounded-full ${STATUS_BAR[s.status]}`} />
                  <span className="flex-1">{s.label}</span>
                  <span className="font-semibold tabular-nums">{s.count}</span>
                  <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{share((s.count / totalStatus) * 100)}</span>
                </div>
              ))}
            </div>
            {fin.invoicesFailed > 0 && (
              <div className="rounded-lg bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
                {fin.invoicesFailed} tagihan <b>gagal dibayar</b> ({IDR(fin.revenueFailed)}) — pembayaran ditolak, bukan sekadar telat.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent invoices + activity */}
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
                    <th className="px-2 pb-2 text-right font-medium">Jumlah</th>
                    <th className="px-2 pb-2 font-medium">Status</th>
                    <th className="px-6 pb-2 text-right font-medium">Terbit</th>
                  </tr>
                </thead>
                <tbody>
                  {recentInvoices.map((inv) => (
                    <tr key={inv.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-6 py-2.5 font-mono text-xs">{inv.id}</td>
                      <td className="max-w-[12rem] truncate px-2 py-2.5 font-medium">{inv.store}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{IDR(inv.amount)}</td>
                      <td className="px-2 py-2.5">
                        <InvoiceBadge status={inv.status} />
                      </td>
                      <td className="px-6 py-2.5 text-right text-xs text-muted-foreground">{timeAgo(inv.daysAgo * 1440)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t px-6 py-3 text-sm">
              <span className="text-muted-foreground">Belum dibayar ({num(fin.invoicesPending)}) · gagal ({num(fin.invoicesFailed)})</span>
              <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">{IDR(fin.revenuePending + fin.revenueFailed)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Aktivitas Platform</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {activity.length ? (
              activity.slice(0, 8).map((a) => (
                <div key={a.id} className="flex items-start gap-3">
                  <ActivityIcon kind={a.kind} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">{a.text}</p>
                    <p className="text-xs text-muted-foreground">{timeAgo(a.minutesAgo)}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="py-4 text-sm text-muted-foreground">Belum ada aktivitas.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top stores by GMV — merchants' money, labelled as such */}
      <Card>
        <CardHeader className="flex-row items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShoppingBag className="size-4 text-muted-foreground" /> Toko Teratas (GMV)
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              GMV = nilai transaksi merchant ({IDR(platform.gmv, { compact: true })} total, di luar pesanan batal) — <b>uang mereka, bukan pendapatan kami</b>.
            </p>
          </div>
          <Link href="/toko" className="inline-flex shrink-0 items-center gap-1 text-sm text-primary hover:underline">
            Semua toko <ArrowUpRight className="size-3.5" />
          </Link>
        </CardHeader>
        <CardContent className="space-y-1">
          {topStores.map((s) => (
            <Link key={s.id} href={`/toko/${s.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60">
              <Avatar className="size-9">
                <AvatarFallback className="bg-primary/12 text-xs font-semibold text-primary">{initials(s.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{s.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {s.city || "—"} · {num(s.orders)} pesanan · {num(s.orders30d)} dalam 30h
                </div>
              </div>
              <SegmentBadge segment={s.segment} />
              <div className="w-24 text-right text-sm font-semibold tabular-nums">{IDR(s.gmv, { compact: true })}</div>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
