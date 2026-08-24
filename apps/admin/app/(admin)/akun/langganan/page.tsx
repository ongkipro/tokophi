import Link from "next/link";
import { getBilling, getMyInvoices } from "@/lib/data/billing";
import { getPendingSubscription } from "@/lib/actions/billing";
import { getPlatformChannels } from "@/lib/actions/payment-settings";
import { IDR, NO_FIGURE } from "@tokophi/lib/format";
import { BILLING, subscriptionCharge } from "@tokophi/lib/billing";
import { getSubscriptionPpnEnabled } from "@/lib/data/platform-finance";
import { Card, CardContent, CardHeader, CardTitle } from "@tokophi/ui/card";
import { Badge } from "@tokophi/ui/badge";
import { CheckCircle2, Sparkles, Receipt, Printer } from "lucide-react";
import { PaySubscription } from "@/components/admin/pengaturan/pay-subscription";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  trial: { label: "Masa uji coba", cls: "bg-amber-500/12 text-amber-600 dark:text-amber-400" },
  active: { label: "Aktif", cls: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
  past_due: { label: "Menunggu pembayaran", cls: "bg-orange-500/12 text-orange-600 dark:text-orange-400" },
  suspended: { label: "Ditangguhkan", cls: "bg-destructive/12 text-destructive" },
};

export default async function LanggananPage() {
  const [bill, invoices, pending, channels] = await Promise.all([getBilling(), getMyInvoices(), getPendingSubscription(), getPlatformChannels()]);
  const ppnOn = await getSubscriptionPpnEnabled();
  const paid = invoices.filter((i) => i.status === "dibayar");
  const paidTotal = paid.reduce((a, i) => a + i.amount, 0);
  // The caption reads the STORED tax, not the toggle: history may mix PPN-era and flat invoices,
  // and "(termasuk PPN)" over a purely flat history would be the derived-faktur lie all over again.
  const paidTax = paid.reduce((a, i) => a + i.taxIdr, 0);
  const st = bill ? STATUS[bill.status] : STATUS.active;
  const INV_STATUS: Record<string, { label: string; cls: string }> = {
    dibayar: { label: "Lunas", cls: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
    menunggu: { label: "Menunggu", cls: "bg-amber-500/12 text-amber-600 dark:text-amber-400" },
    gagal: { label: "Gagal", cls: "bg-destructive/12 text-destructive" },
  };
  const jenis = (a: number) => (a >= 2_000_000 ? "Tahunan" : a <= 100_000 ? "Bln pertama" : "Bulanan");
  const fmtDue = bill?.dueDate ? new Date(bill.dueDate).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "—";

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /> Paket {BILLING.PLAN_NAME}</CardTitle>
            <Badge variant="secondary" className={`border-transparent ${st.cls}`}>{bill ? st.label : "—"}</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Satu paket, <span className="font-medium text-foreground">semua fitur terbuka</span> — tanpa batasan tingkat.</p>
            {bill && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="mt-0.5 font-medium">{st.label}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{bill.status === "trial" ? "Sisa uji coba" : bill.status === "active" ? "Perpanjang dalam" : "Tenggat"}</p>
                  <p className="mt-0.5 font-medium tabular-nums">{bill.status === "suspended" ? NO_FIGURE : `${bill.daysLeft} hari`}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Tagihan berikutnya</p>
                  <p className="mt-0.5 font-medium tabular-nums">{IDR(subscriptionCharge(bill.nextAmount, ppnOn).total)}{bill.isPromo && <span className="ml-1 text-xs font-normal text-emerald-600">promo</span>}</p>
                  {/* The line that shows the arithmetic behind the total above it: two amounts,
                      59,66px of ink movement at 1440px, under a total that was already tabular. */}
                  {/* OFF shows NOTHING here (owner 2026-08-24): with the toggle off the total IS the
                      price — any PPN sentence, even a reassuring one, is a caption about a tax that
                      does not apply. The arithmetic line exists only when there is arithmetic. */}
                  {ppnOn && (
                    <p className="text-[11px] text-muted-foreground tabular-nums">{IDR(bill.nextAmount)} + PPN 11% ({IDR(subscriptionCharge(bill.nextAmount, true).taxIdr)})</p>
                  )}
                </div>
              </div>
            )}
            {/* Each of these four sentences carries a date and an amount, and the one on screen is
                chosen by the billing status — so the paragraph is rewritten from underneath. 17,28px
                at 1440px, 35,38px at 390px where it wraps to three lines. */}
            <p className="text-xs text-muted-foreground tabular-nums">
              {bill?.status === "trial" && `Uji coba gratis berakhir ${fmtDue}. Lanjutkan hanya ${IDR(BILLING.FIRST_MONTH_IDR)} untuk bulan pertama.`}
              {bill?.status === "active" && `Periode berjalan berakhir ${fmtDue}. Tagihan berikutnya ${IDR(BILLING.MONTHLY_IDR)}.`}
              {bill?.status === "past_due" && `Jatuh tempo ${fmtDue}. Bayar sebelum masa tenggang ${BILLING.GRACE_DAYS} hari habis agar toko tidak ditangguhkan.`}
              {bill?.status === "suspended" && `Toko ditangguhkan (mode baca-saja). Bayar ${IDR(bill.nextAmount)} untuk mengaktifkan kembali. Storefront tetap online.`}
            </p>
            {bill && !bill.comped && <PaySubscription firstInvoicePaid={bill.firstInvoicePaid} pending={pending} channels={channels} ppnEnabled={ppnOn} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Rincian harga</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Uji coba gratis" value={`${BILLING.TRIAL_DAYS} hari`} />
            <Row label="Bulan pertama (promo)" value={IDR(BILLING.FIRST_MONTH_IDR)} accent />
            <Row label="Bulanan" value={`${IDR(BILLING.MONTHLY_IDR)}/bln`} />
            <Row label="Tahunan (hemat)" value={`${IDR(BILLING.ANNUAL_MONTHLY_IDR)}/bln`} accent />
            <div className="border-t pt-3">
              {ppnOn && <Row label="PPN" value="11%" />}
              <Row label={ppnOn ? "Total bulanan (termasuk PPN)" : "Total bulanan"} value={IDR(subscriptionCharge(BILLING.MONTHLY_IDR, ppnOn).total)} />
            </div>
            {ppnOn ? (
              <p className="text-[11px] text-muted-foreground tabular-nums">Harga di atas belum termasuk PPN 11% — ditambahkan saat pembayaran. Bayar tahunan {IDR(subscriptionCharge(BILLING.ANNUAL_IDR, true).total)} (termasuk PPN) · langsung dari trial dapat 13 bulan (1 gratis).</p>
            ) : (
              <p className="text-[11px] text-muted-foreground tabular-nums">Bayar tahunan {IDR(BILLING.ANNUAL_IDR)} · langsung dari trial dapat 13 bulan (1 gratis).</p>
            )}
            <div className="border-t pt-3 space-y-1.5 text-xs text-muted-foreground">
              {["Semua fitur (produk, order, diskon, CRM, analitik, dll)", "Kurir & pembayaran terintegrasi", "Storefront + custom domain"].map((f) => (
                <p key={f} className="flex items-start gap-1.5"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />{f}</p>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* payment history + invoices */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><Receipt className="size-4 text-muted-foreground" /> Riwayat pembayaran</CardTitle>
          <span className="text-sm text-muted-foreground">Total dibayar: <span className="font-semibold tabular-nums text-foreground">{IDR(paidTotal)}</span>{paidTax > 0 && <span className="text-xs"> (termasuk PPN {IDR(paidTax)})</span>}</span>
        </CardHeader>
        <CardContent className="p-0">
          {invoices.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">Belum ada tagihan.</p>
          ) : (
            <div>
              {/* each invoice row is a link → its full invoice page (pay if unpaid, print if paid) */}
              <div className="hidden border-b px-6 py-2 text-xs text-muted-foreground sm:grid sm:grid-cols-[1.3fr_1fr_1fr_0.9fr_1fr_auto] sm:gap-2">
                <span>No. Faktur</span><span>Jenis</span><span className="text-right">Jumlah</span><span>Status</span><span>Tanggal</span><span className="w-16 text-right">Aksi</span>
              </div>
              {invoices.map((inv) => (
                <Link key={inv.number} href={`/faktur/${inv.number}`} className="grid grid-cols-2 gap-x-2 gap-y-1 border-b px-6 py-3 text-sm transition-colors last:border-0 hover:bg-muted/40 sm:grid-cols-[1.3fr_1fr_1fr_0.9fr_1fr_auto] sm:items-center">
                  <span className="font-mono text-xs">{inv.number}</span>
                  <span className="text-right text-muted-foreground sm:text-left">{jenis(inv.amount)}</span>
                  <span className="text-right tabular-nums">{IDR(inv.amount)}</span>
                  <span><Badge variant="secondary" className={`border-transparent ${INV_STATUS[inv.status].cls}`}>{INV_STATUS[inv.status].label}</Badge></span>
                  {/* A COLUMN of dates: 14,64–17,77px apart row to row, so the issue dates never
                      lined up under each other. */}
                  <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">{new Date(inv.issuedAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}</span>
                  <span className={`flex items-center justify-end gap-1 text-xs font-medium ${inv.status === "menunggu" ? "text-primary" : "text-muted-foreground"}`}>
                    {inv.status === "menunggu" ? "Bayar" : inv.status === "dibayar" ? <><Printer className="size-3.5" /> Cetak</> : "Lihat"}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium tabular-nums ${accent ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{value}</span>
    </div>
  );
}
