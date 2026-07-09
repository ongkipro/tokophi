import { getBilling } from "@/lib/data/billing";
import { IDR } from "@tokophi/lib/format";
import { BILLING } from "@tokophi/lib/billing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/admin/page-header";
import { CheckCircle2, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  trial: { label: "Masa uji coba", cls: "bg-amber-500/12 text-amber-600 dark:text-amber-400" },
  active: { label: "Aktif", cls: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
  past_due: { label: "Menunggu pembayaran", cls: "bg-orange-500/12 text-orange-600 dark:text-orange-400" },
  suspended: { label: "Ditangguhkan", cls: "bg-destructive/12 text-destructive" },
};

export default async function LanggananPage() {
  const bill = await getBilling();
  const st = bill ? STATUS[bill.status] : STATUS.active;
  const fmtDue = bill?.dueDate ? new Date(bill.dueDate).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "—";

  return (
    <div className="space-y-6">
      <PageHeader title="Langganan" desc="Paket, tagihan, dan status langganan toko Anda." />

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
                  <p className="mt-0.5 font-medium tabular-nums">{IDR(bill.nextAmount)}{bill.isPromo && <span className="ml-1 text-xs font-normal text-emerald-600">promo</span>}</p>
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {bill?.status === "trial" && `Uji coba gratis berakhir ${fmtDue}. Lanjutkan hanya ${IDR(BILLING.FIRST_MONTH_IDR)} untuk bulan pertama.`}
              {bill?.status === "active" && `Periode berjalan berakhir ${fmtDue}. Tagihan berikutnya ${IDR(BILLING.MONTHLY_IDR)}.`}
              {bill?.status === "past_due" && `Jatuh tempo ${fmtDue}. Bayar sebelum masa tenggang ${BILLING.GRACE_DAYS} hari habis agar toko tidak ditangguhkan.`}
              {bill?.status === "suspended" && `Toko ditangguhkan (mode baca-saja). Bayar ${IDR(bill.nextAmount)} untuk mengaktifkan kembali. Storefront tetap online.`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Rincian harga</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Uji coba gratis" value={`${BILLING.TRIAL_DAYS} hari`} />
            <Row label="Bulan pertama (promo)" value={IDR(BILLING.FIRST_MONTH_IDR)} accent />
            <Row label="Bulan berikutnya" value={`${IDR(BILLING.MONTHLY_IDR)}/bln`} />
            <div className="border-t pt-3 space-y-1.5 text-xs text-muted-foreground">
              {["Semua fitur (produk, order, diskon, CRM, analitik, dll)", "Kurir & pembayaran terintegrasi", "Storefront + custom domain"].map((f) => (
                <p key={f} className="flex items-start gap-1.5"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />{f}</p>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
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
