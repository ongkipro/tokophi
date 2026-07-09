import Link from "next/link";
import { getBilling, getMyInvoices } from "@/lib/data/billing";
import { IDR } from "@tokophi/lib/format";
import { BILLING, withPpn } from "@tokophi/lib/billing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  const [bill, invoices] = await Promise.all([getBilling(), getMyInvoices()]);
  const paidTotal = invoices.filter((i) => i.status === "dibayar").reduce((a, i) => a + i.amount, 0);
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
                  <p className="mt-0.5 font-medium">{bill.status === "suspended" ? "—" : `${bill.daysLeft} hari`}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Tagihan berikutnya</p>
                  <p className="mt-0.5 font-medium tabular-nums">{IDR(withPpn(bill.nextAmount).total)}{bill.isPromo && <span className="ml-1 text-xs font-normal text-emerald-600">promo</span>}</p>
                  <p className="text-[11px] text-muted-foreground">{IDR(bill.nextAmount)} + PPN 11% ({IDR(withPpn(bill.nextAmount).ppn)})</p>
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {bill?.status === "trial" && `Uji coba gratis berakhir ${fmtDue}. Lanjutkan hanya ${IDR(BILLING.FIRST_MONTH_IDR)} untuk bulan pertama.`}
              {bill?.status === "active" && `Periode berjalan berakhir ${fmtDue}. Tagihan berikutnya ${IDR(BILLING.MONTHLY_IDR)}.`}
              {bill?.status === "past_due" && `Jatuh tempo ${fmtDue}. Bayar sebelum masa tenggang ${BILLING.GRACE_DAYS} hari habis agar toko tidak ditangguhkan.`}
              {bill?.status === "suspended" && `Toko ditangguhkan (mode baca-saja). Bayar ${IDR(bill.nextAmount)} untuk mengaktifkan kembali. Storefront tetap online.`}
            </p>
            {bill && <PaySubscription firstInvoicePaid={bill.firstInvoicePaid} />}
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
              <Row label="PPN" value="11%" />
              <Row label="Total bulanan (termasuk PPN)" value={IDR(withPpn(BILLING.MONTHLY_IDR).total)} />
            </div>
            <p className="text-[11px] text-muted-foreground">Harga di atas belum termasuk PPN 11% — ditambahkan saat pembayaran. Bayar tahunan {IDR(withPpn(BILLING.ANNUAL_IDR).total)} (termasuk PPN) · langsung dari trial dapat 13 bulan (1 gratis).</p>
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
          <span className="text-sm text-muted-foreground">Total dibayar: <span className="font-semibold tabular-nums text-foreground">{IDR(paidTotal)}</span> <span className="text-xs">(termasuk PPN 11%)</span></span>
        </CardHeader>
        <CardContent className="p-0">
          {invoices.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">Belum ada tagihan.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-6 py-2.5 font-medium">No. Faktur</th>
                    <th className="px-2 py-2.5 font-medium">Jenis</th>
                    <th className="px-2 py-2.5 text-right font-medium">Jumlah</th>
                    <th className="px-2 py-2.5 font-medium">Status</th>
                    <th className="px-2 py-2.5 font-medium">Tanggal</th>
                    <th className="px-6 py-2.5 text-right font-medium">Faktur</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.number} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-6 py-2.5 font-mono text-xs">{inv.number}</td>
                      <td className="px-2 py-2.5 text-muted-foreground">{jenis(inv.amount)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{IDR(inv.amount)}</td>
                      <td className="px-2 py-2.5"><Badge variant="secondary" className={`border-transparent ${INV_STATUS[inv.status].cls}`}>{INV_STATUS[inv.status].label}</Badge></td>
                      <td className="px-2 py-2.5 whitespace-nowrap text-muted-foreground">{new Date(inv.issuedAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}</td>
                      <td className="px-6 py-2.5 text-right">
                        {inv.status === "dibayar" ? (
                          <Button variant="ghost" size="sm" className="gap-1.5" nativeButton={false} render={<Link href={`/faktur/${inv.number}`} target="_blank" />}>
                            <Printer className="size-3.5" /> Cetak
                          </Button>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
