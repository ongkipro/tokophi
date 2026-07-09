"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { paySubscription } from "@/lib/actions/billing";
import { IDR } from "@tokophi/lib/format";
import { quote, withPpn, BILLING, type Cycle } from "@tokophi/lib/billing";
import { toast } from "sonner";

// Two cycles: monthly (Rp50rb promo / Rp275rb) and annual (Rp2.7jt = Rp225rb/bln; first-time
// annual straight from the trial gets a bonus month → 13 months). Each creates an AutoLaris VA;
// the subscription auto-activates when the payment callback lands.
export function PaySubscription({ firstInvoicePaid }: { firstInvoicePaid: boolean }) {
  const [pending, start] = React.useTransition();
  const [va, setVa] = React.useState<{ virtualAccount?: string; channel?: string } | null>(null);
  const m = quote("monthly", firstInvoicePaid);
  const a = quote("annual", firstInvoicePaid);

  const pay = (cycle: Cycle) =>
    start(async () => {
      const r = await paySubscription(cycle);
      if (r.ok) {
        setVa({ virtualAccount: r.virtualAccount, channel: r.channel });
        toast.success("Tagihan dibuat — silakan selesaikan pembayaran.");
      } else {
        toast.error(r.error ?? "Gagal membuat tagihan.");
      }
    });

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Button disabled={pending} onClick={() => pay("monthly")} className="h-auto flex-col items-start gap-0.5 py-2.5 text-left">
          <span className="font-semibold">Bulanan — {IDR(withPpn(m.amount).total)}</span>
          <span className="text-xs font-normal opacity-80">{m.amount === BILLING.FIRST_MONTH_IDR ? "promo bulan pertama" : "per bulan"} · termasuk PPN 11%</span>
        </Button>
        <Button variant="outline" disabled={pending} onClick={() => pay("annual")} className="h-auto flex-col items-start gap-0.5 py-2.5 text-left">
          <span className="font-semibold">Tahunan — {IDR(withPpn(a.amount).total)}</span>
          <span className="text-xs font-normal text-emerald-600 dark:text-emerald-400">
            {IDR(BILLING.ANNUAL_MONTHLY_IDR)}/bln{a.bonusMonth ? ` · ${a.months} bln (1 gratis)` : " · hemat 50rb/bln"} · +PPN
          </span>
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">Harga sudah termasuk PPN 11%. Faktur pajak tersedia di riwayat pembayaran.</p>
      {va?.virtualAccount && (
        <div className="rounded-lg border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">{va.channel} — Nomor Virtual Account</p>
          <p className="font-mono text-lg font-bold tracking-wide">{va.virtualAccount}</p>
          <p className="mt-1 text-xs text-muted-foreground">Bayar sebelum kedaluwarsa. Langganan aktif otomatis setelah pembayaran diterima.</p>
        </div>
      )}
    </div>
  );
}
