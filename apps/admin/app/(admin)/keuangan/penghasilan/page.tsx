import Link from "next/link";
import { ArrowRight, Clock, CheckCircle2 } from "lucide-react";
import { Card } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { PageHeader } from "@/components/admin/page-header";
import { getFinanceSummary, getEarnings, type Period } from "@/lib/data/finance";
import { IDR, num } from "@tokophi/lib/format";
import { PeriodTabs } from "./period-tabs";

// Penghasilan — "what did I earn, and why is it not cash yet?"
//
// Shopee and Tokopedia both split this from Saldo, and the split is real rather than cosmetic:
// EARNINGS include money the platform is still holding; a BALANCE is only what you can take today.
// A seller asking "I sold 47 orders, where is my money?" is asking THIS page, not /saldo — and the
// answer ("held until the order reaches selesai") is the whole reason the page exists.
export const dynamic = "force-dynamic";

const PERIODS: Period[] = [7, 30, 90];

export default async function PenghasilanPage({
  searchParams,
}: {
  searchParams: Promise<{ hari?: string }>;
}) {
  const sp = await searchParams;
  const raw = Number(sp.hari);
  const days: Period = (PERIODS as number[]).includes(raw) ? (raw as Period) : 30;

  const [f, rows] = await Promise.all([getFinanceSummary(days), getEarnings(days)]);
  const gross = rows.reduce((a, r) => a + r.gross, 0);
  const shipping = rows.reduce((a, r) => a + r.shipping, 0);
  const orders = rows.reduce((a, r) => a + r.orders, 0);
  const peak = Math.max(1, ...rows.map((r) => r.gross));

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader title="Penghasilan" desc="Hasil penjualan — yang sudah cair dan yang masih ditahan." />

      <PeriodTabs days={days} />

      {/* The split that gives this page its reason to exist. Same two figures as Keuangan's header,
          deliberately: this page explains them, the summary only reports them. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="p-5">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-emerald-600" /> Sudah dilepas
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{IDR(f.balance.available)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Pesanan selesai — dananya sudah jadi saldo.</p>
          <Button size="sm" variant="outline" className="mt-3" nativeButton={false} render={<Link href="/saldo" />}>
            Ke Saldo Saya <ArrowRight className="ml-1 size-3.5" />
          </Button>
        </Card>
        <Card className="p-5">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="size-4 text-amber-600" /> Belum dilepas
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-muted-foreground">{IDR(f.balance.pending)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Ditahan sampai <span className="font-medium text-foreground">{num(f.heldOrders)} pesanan</span> berstatus selesai.
            Ini bukan biaya — hanya belum bisa ditarik.
          </p>
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Omzet {days} hari</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{IDR(gross)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Ongkir dibayar pembeli</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{IDR(shipping)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Pesanan</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{num(orders)}</p>
        </Card>
      </div>

      <Card className="p-5">
        <p className="mb-3 text-sm font-medium">Penghasilan harian</p>
        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Belum ada penjualan pada periode ini.
          </p>
        ) : (
          // Deliberately bars-in-a-list, not a chart library: this is a magnitude comparison over a
          // handful of days, and every row states its own number. A chart that needs a tooltip to be
          // read is worse than a list that does not.
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li key={r.day} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 text-xs tabular-nums text-muted-foreground">{r.day}</span>
                <span className="h-2 shrink-0 rounded-full bg-primary/70" style={{ width: `${Math.max(2, (r.gross / peak) * 100)}%` }} />
                <span className="ml-auto shrink-0 tabular-nums">{IDR(r.gross)}</span>
                <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{num(r.orders)} pesanan</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
          Pesanan <span className="font-medium text-foreground">batal</span> dan{" "}
          <span className="font-medium text-foreground">retur</span> tidak dihitung — itu bukan penjualan.
        </p>
      </Card>
    </div>
  );
}
