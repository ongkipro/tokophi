import Link from "next/link";
import { ArrowRight, Wallet, Clock, TrendingUp, Truck, ReceiptText } from "lucide-react";
import { Card } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Badge } from "@tokophi/ui/badge";
import { PageHeader } from "@/components/admin/page-header";
import { getFinanceSummary } from "@/lib/data/finance";
import { IDR, num, pct } from "@tokophi/lib/format";

// Keuangan — the summary. It answers ONE question the other finance screens do not: "is my money
// healthy?" It is deliberately NOT a copy of /saldo:
//   Keuangan     → is my money healthy?          (here)
//   Penghasilan  → what did I earn, and why is it not cash yet?
//   Saldo Saya   → what can I withdraw right now?  (its own tabs live inside it)
//   Tagihan      → what do I pay TokoΦ?
// The first version of this menu pointed every row at a /saldo tab — four doors onto one room, the
// same mistake "Perlu Dikirim" was removed for. Pages must complete each other, not repeat.
//
// Every figure is a real query (lib/data/finance.ts). Nothing is a placeholder: a finance screen that
// invents a number is worse than one that does not exist, because the merchant will believe it.
export const dynamic = "force-dynamic";

export default async function KeuanganPage() {
  const f = await getFinanceSummary(30);
  // Growth is only meaningful with something to compare against. With no prior period we show
  // nothing rather than "+100%" or "0%" — both of which would be inventions.
  // ⚠️ NOT rounded here, and NOT formatted here. `pct()` is the delta formatter (@tokophi/lib/format)
  // and it owns all three of the things this line used to do by hand: the sign, the id-ID decimal
  // comma, and the typographic minus. The hand-rolled `${delta >= 0 ? "+" : ""}${delta}%` printed
  // "-13%" — an ASCII HYPHEN and an integer — on a panel where the dashboard's own money tiles say
  // "−12,9%". A `Math.round` was needed only to hide the raw float that string would otherwise have
  // shown; `pct` rounds to one decimal like every other delta in the product, so it goes.
  const delta = f.prevRevenue > 0 ? ((f.revenue - f.prevRevenue) / f.prevRevenue) * 100 : null;

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader title="Keuangan" desc="Ringkasan uang toko — 30 hari terakhir." />

      {/* The two numbers a seller actually opens this page for: what is mine now, and what is still held. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="p-5">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Wallet className="size-4" /> Saldo tersedia
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{IDR(f.balance.available)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Sudah bisa ditarik ke rekening.</p>
          <Button size="sm" variant="outline" className="mt-3" nativeButton={false} render={<Link href="/saldo" />}>
            Tarik saldo <ArrowRight className="ml-1 size-3.5" />
          </Button>
        </Card>
        <Card className="p-5">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="size-4" /> Dana dalam proses
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-muted-foreground">{IDR(f.balance.pending)}</p>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            Tertahan di <span className="font-medium text-foreground">{num(f.heldOrders)} pesanan</span> yang belum selesai.
          </p>
          <Button size="sm" variant="outline" className="mt-3" nativeButton={false} render={<Link href="/keuangan/penghasilan" />}>
            Lihat penghasilan <ArrowRight className="ml-1 size-3.5" />
          </Button>
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={<TrendingUp className="size-4" />} label="Omzet 30 hari" value={IDR(f.revenue)}
          hint={delta === null ? "Belum ada periode pembanding." : `${pct(delta)} vs 30 hari sebelumnya`} />
        <Stat icon={<Truck className="size-4" />} label="Ongkir dibayar pembeli" value={IDR(f.shippingIn)}
          hint={`Dari ${num(f.orders)} pesanan.`} />
        <Stat icon={<Wallet className="size-4" />} label="Sudah ditarik" value={IDR(f.balance.withdrawn)} hint="Total pencairan." />
        <Stat icon={<ReceiptText className="size-4" />} label="Ditarik kembali (retur)" value={IDR(f.balance.returned)} hint="Paket yang kembali." />
      </div>

      {/* Money that flows the OTHER way — what the seller owes us. A different kind of money, so it
          gets its own row rather than being mixed into the earnings above.
          The row lives INSIDE the card, not on it: <Card> is already `flex flex-col`, so putting
          `flex items-center` on it centres everything horizontally (items-center is the CROSS axis of
          a column). Shipped that way once — the fix is an inner row, not more classes. */}
      {f.billing && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <ReceiptText className="size-4" /> Langganan TokoΦ
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-xl font-bold tabular-nums">{IDR(f.billing.nextAmount)}</span>
              <Badge variant="secondary">{f.billing.label}</Badge>
              {f.billing.isPromo && <Badge className="bg-emerald-100 text-emerald-800">Promo bulan pertama</Badge>}
            </p>
            {/* "Jatuh tempo dalam 1 hari." — a countdown, so it is re-rendered daily. */}
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
              {f.billing.comped
                ? "Ditanggung platform — tidak ada tagihan."
                : f.billing.dueDate
                  ? `Jatuh tempo dalam ${f.billing.daysLeft} hari.`
                  : "Belum ada tagihan berjalan."}
            </p>
          </div>
          <Button variant="outline" nativeButton={false} render={<Link href="/akun/langganan" />}>
            Lihat tagihan <ArrowRight className="ml-1 size-3.5" />
          </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return (
    <Card className="p-4">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">{icon} {label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
      {/* The hint carries figures too — the delta, the order count — and they change on every load.
          Measured 1440px: "-13% vs 30 hari sebelumnya" moved 11,77px of ink between an all-1 and an
          all-8 rendering, and "Dari 161 pesanan." 8,89px, so the sentence after each number slid
          while the bold value above it (already tabular) stayed put. */}
      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{hint}</p>
    </Card>
  );
}
