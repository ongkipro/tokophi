"use client";
import * as React from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Info, Landmark, Wallet, QrCode, Store } from "lucide-react";
import { IDR } from "@tokophi/lib/format";
import { PAYMENT_FEES, FEE_BEARERS, type FeeBearer, type FeeKind } from "@tokophi/lib/payment-fees";
import { getFeeBearer, setFeeBearer } from "@/lib/actions/payment-settings";
import { useCan } from "@/components/admin/permissions";

const ICON: Record<FeeKind, React.ReactNode> = {
  va: <Landmark className="size-4" />,
  ewallet: <Wallet className="size-4" />,
  qris: <QrCode className="size-4" />,
  retail: <Store className="size-4" />,
};

export function PaymentFeesCard() {
  const canSave = useCan("settings:write");
  const [pending, start] = React.useTransition();
  const [bearer, setBearer] = React.useState<FeeBearer>("seller");
  const [saved, setSaved] = React.useState<FeeBearer>("seller");

  React.useEffect(() => {
    getFeeBearer().then((b) => { setBearer(b); setSaved(b); });
  }, []);

  const dirty = bearer !== saved;
  const save = () =>
    start(async () => {
      const r = await setFeeBearer(bearer);
      if (r.ok) { setSaved(bearer); toast.success("Penanggung biaya disimpan."); }
      else toast.error(r.error ?? "Gagal menyimpan.");
    });

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Biaya Pembayaran</CardTitle>
        <CardDescription>Biaya penyedia pembayaran per transaksi berhasil di toko Anda.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>Biaya ini dipotong oleh penyedia pembayaran, bukan TokoΦ. Pilih siapa yang menanggungnya — biaya untuk pembeli otomatis ditambahkan saat checkout.</span>
        </div>

        {/* fee schedule */}
        <div className="overflow-hidden rounded-lg border">
          {(Object.keys(PAYMENT_FEES) as FeeKind[]).map((k, i) => {
            const f = PAYMENT_FEES[k];
            return (
              <div key={k} className={`flex items-center justify-between gap-3 px-3 py-2.5 ${i > 0 ? "border-t" : ""}`}>
                <span className="flex items-center gap-2 text-sm">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">{ICON[k]}</span>
                  {f.label}
                </span>
                <span className="shrink-0 font-medium tabular-nums">{f.note}</span>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">Contoh: transaksi {IDR(100_000)} via VA → biaya {IDR(4_000)}; via e-wallet → {IDR(2_400)}; via QRIS → {IDR(1_000)}.</p>

        {/* bearer select */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Penanggung biaya</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {FEE_BEARERS.map((b) => {
              const active = bearer === b.key;
              return (
                <button
                  key={b.key}
                  type="button"
                  disabled={!canSave}
                  onClick={() => setBearer(b.key)}
                  className={`rounded-lg border p-3 text-left transition-colors disabled:opacity-60 ${active ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50"}`}
                >
                  <div className="text-sm font-medium">{b.label}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{b.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {canSave ? (
          <div className="flex justify-end">
            <Button disabled={pending || !dirty} onClick={save}>{pending ? "Menyimpan…" : "Simpan"}</Button>
          </div>
        ) : (
          <p className="text-right text-xs text-muted-foreground">Hanya Pemilik yang dapat mengubah pengaturan ini.</p>
        )}
      </CardContent>
    </Card>
  );
}
