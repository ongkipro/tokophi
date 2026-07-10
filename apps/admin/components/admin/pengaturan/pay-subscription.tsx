"use client";
import * as React from "react";
import Image from "next/image";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Landmark, Wallet, QrCode, Store, Copy, Check, ArrowRight, X } from "lucide-react";
import { createSubscriptionPayment, cancelSubscriptionInvoice, type PaymentDetail } from "@/lib/actions/billing";
import { IDR } from "@tokophi/lib/format";
import { quote, withPpn, type Cycle } from "@tokophi/lib/billing";
import type { PlatformChannel } from "@/lib/actions/payment-settings";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<string, React.ReactNode> = {
  qris: <QrCode className="size-4" />, va: <Landmark className="size-4" />, ewallet: <Wallet className="size-4" />, retail: <Store className="size-4" />,
};
const KIND_ORDER = ["qris", "va", "ewallet", "retail"];

// Subscription payment: pick cycle → Lanjutkan → choose channel (platform-enabled) → show VA/QRIS.
// An existing unpaid invoice is RESUMED (never duplicated).
export function PaySubscription({ firstInvoicePaid, pending, channels }: { firstInvoicePaid: boolean; pending: PaymentDetail | null; channels: PlatformChannel[] }) {
  const [saving, start] = React.useTransition();
  const [cycle, setCycle] = React.useState<Cycle>("monthly");
  const [pickOpen, setPickOpen] = React.useState(false);
  const [chosen, setChosen] = React.useState<string>("");
  const [detail, setDetail] = React.useState<PaymentDetail | null>(pending);

  const m = withPpn(quote("monthly", firstInvoicePaid).amount);
  const a = quote("annual", firstInvoicePaid);
  const aTotal = withPpn(a.amount);

  const proceed = () => {
    if (!chosen) return toast.error("Pilih metode pembayaran.");
    start(async () => {
      const r = await createSubscriptionPayment(cycle, chosen);
      if (r.ok && r.detail) { setDetail(r.detail); setPickOpen(false); if (r.reused) toast.info("Melanjutkan tagihan yang sudah ada."); }
      else toast.error(r.error ?? "Gagal membuat tagihan.");
    });
  };
  const cancel = () => {
    if (!detail) return;
    start(async () => {
      const r = await cancelSubscriptionInvoice(detail.number);
      if (r.ok) { setDetail(null); setChosen(""); toast.success("Tagihan dibatalkan."); }
      else toast.error(r.error ?? "Gagal membatalkan.");
    });
  };

  // ── active payment (pending / just created) ──
  if (detail) {
    return (
      <div className="space-y-3">
        <PaymentView detail={detail} />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Langganan aktif otomatis setelah pembayaran diterima.</p>
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" disabled={saving} onClick={cancel}><X className="size-3.5" /> Batalkan tagihan</Button>
        </div>
      </div>
    );
  }

  // ── choose cycle → Lanjutkan ──
  const grouped = KIND_ORDER.map((k) => ({ kind: k, rows: channels.filter((c) => c.kind === k) })).filter((g) => g.rows.length > 0);
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={() => setCycle("monthly")} className={cn("rounded-lg border p-3 text-left transition-colors", cycle === "monthly" ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50")}>
          <div className="flex items-center justify-between"><span className="font-semibold">Bulanan</span>{cycle === "monthly" && <Check className="size-4 text-primary" />}</div>
          <div className="mt-0.5 text-sm tabular-nums">{IDR(m.total)}</div>
          <div className="text-xs text-muted-foreground">{quote("monthly", firstInvoicePaid).amount === 50_000 ? "promo bulan pertama" : "per bulan"} · termasuk PPN 11%</div>
        </button>
        <button type="button" onClick={() => setCycle("annual")} className={cn("rounded-lg border p-3 text-left transition-colors", cycle === "annual" ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50")}>
          <div className="flex items-center justify-between"><span className="font-semibold">Tahunan</span>{cycle === "annual" && <Check className="size-4 text-primary" />}</div>
          <div className="mt-0.5 text-sm tabular-nums">{IDR(aTotal.total)}</div>
          <div className="text-xs text-emerald-600 dark:text-emerald-400">{a.bonusMonth ? `${a.months} bln (1 gratis)` : "hemat 50rb/bln"} · termasuk PPN 11%</div>
        </button>
      </div>

      <Button className="w-full gap-1.5" onClick={() => setPickOpen(true)}>Lanjutkan pembayaran <ArrowRight className="size-4" /></Button>

      {/* channel picker dialog — platform-enabled methods */}
      <Dialog open={pickOpen} onOpenChange={setPickOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Pilih metode pembayaran</DialogTitle></DialogHeader>
          <div className="max-h-[55vh] space-y-3 overflow-y-auto py-1">
            {grouped.length === 0 && <p className="py-4 text-sm text-muted-foreground">Belum ada metode pembayaran aktif. Hubungi TokoΦ.</p>}
            {grouped.map((g) => (
              <div key={g.kind} className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">{KIND_ICON[g.kind]} {g.kind === "va" ? "Virtual Account" : g.kind === "ewallet" ? "E-Wallet" : g.kind === "retail" ? "Minimarket" : "QRIS"}</p>
                <div className="grid gap-1.5">
                  {g.rows.map((c) => (
                    <button key={c.channel} type="button" onClick={() => setChosen(c.channel)} className={cn("flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors", chosen === c.channel ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50")}>
                      <span>{c.label}</span>
                      {chosen === c.channel && <Check className="size-4 text-primary" />}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Batal</Button>} />
            <Button disabled={saving || !chosen} onClick={proceed}>{saving ? "Memproses…" : "Bayar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Renders the payment instructions for an unpaid invoice (VA number / QRIS image / redirect link).
export function PaymentView({ detail }: { detail: PaymentDetail }) {
  const [copied, setCopied] = React.useState(false);
  const copy = () => { if (detail.virtualAccount) { navigator.clipboard?.writeText(detail.virtualAccount); setCopied(true); setTimeout(() => setCopied(false), 1500); } };
  return (
    <div className="rounded-lg border bg-muted/40 p-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{detail.channelLabel}</span>
        <span className="tabular-nums">{detail.cycle === "annual" ? "Tahunan" : "Bulanan"} · {IDR(detail.amount)}</span>
      </div>
      {detail.virtualAccount ? (
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="font-mono text-lg font-bold tracking-wide">{detail.virtualAccount}</span>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={copy}>{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Disalin" : "Salin"}</Button>
        </div>
      ) : detail.qrImage ? (
        <div className="mt-2 flex flex-col items-center gap-1">
          <Image src={detail.qrImage} alt="QRIS" width={200} height={200} className="rounded-md bg-white p-2" unoptimized />
          <p className="text-xs text-muted-foreground">Scan dengan aplikasi apa pun yang mendukung QRIS</p>
        </div>
      ) : detail.paymentUrl ? (
        <a href={detail.paymentUrl} target="_blank" rel="noopener" className="mt-2 inline-block text-sm font-medium text-primary underline">Buka halaman pembayaran →</a>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">Menyiapkan instruksi pembayaran…</p>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">Tagihan #{detail.number} · bayar sebelum kedaluwarsa.</p>
    </div>
  );
}
