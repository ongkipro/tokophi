"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Wallet, Users, MoreHorizontal, CircleCheck, CircleX, Clock, Sparkles, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@tokophi/ui/table";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@tokophi/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@tokophi/ui/tabs";

import { type Invoice } from "@/lib/types";
import { InvoiceBadge } from "@/components/bits";
import { setInvoiceStatus } from "@/lib/actions";
import { refused } from "@/lib/refused";
import { IDR, num } from "@tokophi/lib/format";
import { BILLING } from "@tokophi/lib/billing";
import type { SubStats, Conversion, FinanceStats } from "@/lib/data";

const INV_TABS: { key: "semua" | Invoice["status"]; label: string }[] = [
  { key: "semua", label: "Semua" },
  { key: "dibayar", label: "Dibayar" },
  { key: "menunggu", label: "Menunggu" },
  { key: "gagal", label: "Gagal" },
];

export function PaketClient({ sub, allInvoices, conv, fin }: { sub: SubStats; allInvoices: Invoice[]; conv: Conversion; fin: FinanceStats }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<"semua" | Invoice["status"]>("semua");

  function mark(inv: Invoice, status: Invoice["status"]) {
    if (status === inv.status) return;
    startTransition(async () => {
      const no = refused(await setInvoiceStatus(inv.id, status));
      if (no) return void toast.error(no);
      toast.success(`Invoice ${inv.id} → ${status}.`);
      router.refresh();
    });
  }

  const summary = [
    { label: "MRR", value: IDR(sub.mrr, { compact: true }), icon: Wallet, hint: `${num(sub.active)} pelanggan berbayar · ${num(sub.vip)} VIP gratis` },
    // Konversi trial → bayar, dihitung dari tagihan yang BENAR-BENAR lunas (bukan dari flag
    // stores.first_invoice_paid, yang sudah tidak konsisten dengan tagihannya).
    { label: "Konversi trial", value: `${num(conv.converted)}/${num(conv.trialsEnded)}`, icon: Users, hint: conv.trialsEnded ? `${Math.round(conv.rate * 100)}% trial berakhir → bayar` : "belum ada trial berakhir" },
    { label: "Uji coba berjalan", value: num(sub.trial), icon: Sparkles, hint: `${num(sub.trialEndingSoon)} berakhir ≤1 hari` },
    { label: "Gagal bayar", value: IDR(fin.revenueFailed, { compact: true }), icon: TriangleAlert, hint: `${num(fin.invoicesFailed)} tagihan gagal · ${num(fin.invoicesPending)} menunggu` },
  ];

  const statusBreakdown = [
    { key: "active", label: "Aktif", count: sub.active, cls: "bg-emerald-500" },
    { key: "trial", label: "Uji coba", count: sub.trial, cls: "bg-amber-500" },
    { key: "past_due", label: "Menunggak", count: sub.pastDue, cls: "bg-orange-500" },
    { key: "suspended", label: "Ditangguhkan", count: sub.suspended, cls: "bg-destructive" },
  ];
  const maxCount = Math.max(...statusBreakdown.map((s) => s.count), 1);

  const invoices = useMemo(() => (tab === "semua" ? allInvoices : allInvoices.filter((i) => i.status === tab)), [tab, allInvoices]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Paket &amp; Billing</h1>
        <p className="text-sm text-muted-foreground">Satu paket, semua fitur. Kelola langganan &amp; tagihan platform.</p>
      </div>

      {/* summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {summary.map((s) => (
          <Card key={s.label} className="gap-0 p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">{s.label}</span>
              <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground"><s.icon className="size-4" /></span>
            </div>
            <div className="mt-3 text-2xl font-bold tracking-tight tabular-nums">{s.value}</div>
            <p className="mt-1 text-xs text-muted-foreground">{s.hint}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* single plan */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /> Paket {BILLING.PLAN_NAME}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold tracking-tight tabular-nums">{IDR(BILLING.MONTHLY_IDR)}</span>
              <span className="text-sm text-muted-foreground">/bln</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {BILLING.TRIAL_DAYS} hari uji coba gratis → <span className="font-medium text-emerald-600 dark:text-emerald-400">{IDR(BILLING.FIRST_MONTH_IDR)}</span> bulan pertama → {IDR(BILLING.MONTHLY_IDR)}/bulan.
              <br />Tahunan: <span className="font-medium text-emerald-600 dark:text-emerald-400">{IDR(BILLING.ANNUAL_MONTHLY_IDR)}/bln</span> ({IDR(BILLING.ANNUAL_IDR)}/thn) · langsung dari trial dapat 13 bulan.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {["Semua fitur terbuka (tanpa tingkat)", "Produk, order, diskon, CRM, analitik", "Kurir & pembayaran terintegrasi", "Storefront + custom domain", "Tagihan VA bulanan otomatis", "Tenggat 3 hari sebelum ditangguhkan"].map((f) => (
                <p key={f} className="flex items-start gap-2 text-sm"><Check className="mt-0.5 size-4 shrink-0 text-primary" />{f}</p>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* status breakdown */}
        <Card>
          <CardHeader><CardTitle>Status Langganan</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {statusBreakdown.map((s) => (
              <div key={s.key}>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2"><span className={`size-2.5 rounded-full ${s.cls}`} />{s.label}</span>
                  <span className="font-semibold tabular-nums">{num(s.count)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className={`h-full rounded-full ${s.cls}`} style={{ width: `${(s.count / maxCount) * 100}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* invoices */}
      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Tagihan</CardTitle>
          <Tabs value={tab} onValueChange={(v) => setTab(v as "semua" | Invoice["status"])}>
            <TabsList>{INV_TABS.map((t) => <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>)}</TabsList>
          </Tabs>
        </div>
        <div className="overflow-x-auto border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No.</TableHead>
                <TableHead>Toko</TableHead>
                <TableHead className="text-right">Jumlah</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono text-xs">{inv.id}</TableCell>
                  <TableCell className="font-medium">{inv.store}</TableCell>
                  <TableCell className="text-right tabular-nums">{IDR(inv.amount)}</TableCell>
                  <TableCell><InvoiceBadge status={inv.status} /></TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{inv.daysAgo} hari lalu</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Aksi ${inv.id}`} disabled={pending} />}>
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Ubah status</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={inv.status === "dibayar"} onClick={() => mark(inv, "dibayar")}><CircleCheck className="size-4 text-emerald-600" /> Tandai dibayar</DropdownMenuItem>
                        <DropdownMenuItem disabled={inv.status === "menunggu"} onClick={() => mark(inv, "menunggu")}><Clock className="size-4 text-amber-600" /> Tandai menunggu</DropdownMenuItem>
                        <DropdownMenuItem disabled={inv.status === "gagal"} onClick={() => mark(inv, "gagal")}><CircleX className="size-4 text-destructive" /> Tandai gagal</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
              {invoices.length === 0 && (
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Tidak ada tagihan.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
