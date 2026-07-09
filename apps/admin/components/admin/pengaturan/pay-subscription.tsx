"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { paySubscription } from "@/lib/actions/billing";
import { IDR } from "@tokophi/lib/format";
import { toast } from "sonner";

// Merchant subscription payment: creates an AutoLaris VA for the current period's amount and
// shows it. The subscription auto-activates once the payment callback lands.
export function PaySubscription({ amount, cta }: { amount: number; cta: string }) {
  const [pending, start] = React.useTransition();
  const [va, setVa] = React.useState<{ virtualAccount?: string; channel?: string } | null>(null);

  const pay = () =>
    start(async () => {
      const r = await paySubscription("VABCA");
      if (r.ok) {
        setVa({ virtualAccount: r.virtualAccount, channel: r.channel });
        toast.success("Tagihan dibuat — silakan selesaikan pembayaran.");
      } else {
        toast.error(r.error ?? "Gagal membuat tagihan.");
      }
    });

  return (
    <div className="space-y-2">
      <Button disabled={pending} onClick={pay}>
        {pending ? "Memproses…" : `${cta} — ${IDR(amount)}`}
      </Button>
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
