import Link from "next/link";
import { ArrowRight, Clock, CheckCircle2 } from "lucide-react";
import { Card } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { PageHeader } from "@/components/admin/page-header";
import { getFinanceSummary, getEarnings, getChannelMix, type Period } from "@/lib/data/finance";
import { IDR, num } from "@tokophi/lib/format";
import { PeriodTabs } from "./period-tabs";
import { EarningsChart } from "@/components/admin/keuangan/earnings-chart";
import { ChannelChart } from "@/components/admin/channel-chart";

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

  const [f, rows, channels] = await Promise.all([
    getFinanceSummary(days),
    getEarnings(days),
    getChannelMix(days),
  ]);
  const gross = rows.reduce((a, r) => a + r.gross, 0);
  const shipping = rows.reduce((a, r) => a + r.shipping, 0);
  const orders = rows.reduce((a, r) => a + r.orders, 0);
  // `rows` now spans EVERY day in the window (zero-filled for the chart), so "how many days did I
  // actually sell?" is a real question its length can no longer answer.
  const activeDays = rows.filter((r) => r.orders > 0).length;

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
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            Ditahan sampai <span className="font-medium text-foreground">{num(f.heldOrders)} pesanan</span> berstatus selesai.
            Ini bukan biaya — hanya belum bisa ditarik.
          </p>
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground tabular-nums">Omzet {days} hari</p>
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
        <p className="text-sm font-medium">Penghasilan harian</p>
        <p className="mb-3 text-xs text-muted-foreground">
          Omzet dan ongkir per hari. Hari tanpa penjualan tetap ditampilkan sebagai kosong — itu juga
          informasi.
        </p>
        {activeDays === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Belum ada penjualan pada periode ini.
          </p>
        ) : (
          <EarningsChart rows={rows} />
        )}
        <div className="mt-3 space-y-1 border-t pt-3 text-xs text-muted-foreground">
          <p>
            Pesanan <span className="font-medium text-foreground">batal</span> dan{" "}
            <span className="font-medium text-foreground">retur</span> tidak dihitung — itu bukan penjualan.
          </p>
          {/* Say it on the page, not just in a commit: a merchant reading a 30-day chart where 15 days
              are empty deserves to know whether that is their business or our data. */}
          {activeDays > 0 && activeDays < rows.length && (
            <p>
              <span className="font-medium text-foreground">{num(activeDays)} dari {num(rows.length)} hari</span>{" "}
              ada penjualan. Sisanya benar-benar kosong — bukan data yang hilang.
            </p>
          )}
        </div>
      </Card>

      {channels.length > 0 && (
        <Card className="p-5">
          <p className="text-sm font-medium">Sumber penjualan</p>
          <p className="mb-4 text-xs text-muted-foreground">
            Dari mana pesanan datang, dihitung per pesanan — bukan perkiraan.
          </p>
          <ChannelChart data={channels} />
        </Card>
      )}
    </div>
  );
}
