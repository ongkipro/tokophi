"use client";
import * as React from "react";
import { toast } from "sonner";
import { Landmark, Loader2, Info, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { useCan } from "@/components/admin/permissions";
import { getBankAccount } from "@/lib/actions/rekening";
import { saveBankAccount } from "@/lib/actions/ledger";

// The payout destination. It lives HERE (Pengaturan → Rekening) because that is where a merchant
// looks for their own details — and it is rendered from the SAME action the Saldo page uses, so the
// two can never drift into disagreeing about where the money goes.
//
// Payouts snapshot these fields at request time (payouts.bank_*), so editing them does not rewrite
// where past money was sent. That matters: an audit trail that mutates is not an audit trail.
export function RekeningCard() {
  const canWrite = useCan("settings:write");
  const [loading, setLoading] = React.useState(true);
  const [saving, start] = React.useTransition();

  const [bankName, setBankName] = React.useState("");
  const [bankAccount, setBankAccount] = React.useState("");
  const [bankHolder, setBankHolder] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    (async () => {
      const b = await getBankAccount();
      if (!alive) return;
      setBankName(b.bankName ?? "");
      setBankAccount(b.bankAccount ?? "");
      setBankHolder(b.bankHolder ?? "");
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const save = () =>
    start(async () => {
      const r = await saveBankAccount({ bankName, bankAccount, bankHolder });
      if (r.ok) toast.success("Rekening penarikan disimpan.");
      else toast.error(r.error ?? "Gagal menyimpan rekening.");
    });

  const filled = !!(bankName && bankAccount && bankHolder);

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Landmark className="size-4 text-muted-foreground" /> Rekening Penarikan
        </CardTitle>
        <CardDescription>Tujuan pencairan saldo hasil penjualan Anda.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Memuat…
          </div>
        ) : (
          <>
            {!filled && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>Saldo belum bisa ditarik sampai rekening ini dilengkapi.</span>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rk-bank">Nama bank</Label>
                <Input id="rk-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="BCA" disabled={!canWrite} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rk-no">Nomor rekening</Label>
                <Input
                  id="rk-no"
                  inputMode="numeric"
                  value={bankAccount}
                  onChange={(e) => setBankAccount(e.target.value.replace(/\D/g, ""))}
                  className="tabular-nums"
                  placeholder="1234567890"
                  disabled={!canWrite}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rk-an">Nama pemilik rekening</Label>
              <Input id="rk-an" value={bankHolder} onChange={(e) => setBankHolder(e.target.value)} disabled={!canWrite} />
              <p className="text-xs text-muted-foreground">
                Harus atas nama pemilik toko. Rekening pihak lain akan ditolak saat pencairan.
              </p>
            </div>

            <div className="flex items-start gap-2 rounded-lg border p-3 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>
                Setiap pencairan menyimpan salinan rekening saat itu, sehingga mengubah rekening di sini{" "}
                <span className="font-medium text-foreground">tidak mengubah</span> riwayat pencairan sebelumnya.
              </span>
            </div>

            {canWrite && (
              <div className="flex justify-end">
                <Button onClick={save} disabled={saving}>
                  {saving && <Loader2 className="size-4 animate-spin" />} Simpan rekening
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
