"use client";
import * as React from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { ToggleRow } from "@/components/admin/pengaturan/toggle-row";
import { useCan } from "@/components/admin/permissions";
import { getTaxSettings, saveTaxSettings } from "@/lib/actions/tax";

export function PajakCard() {
  const canWrite = useCan("settings:write");
  const [loaded, setLoaded] = React.useState(false);
  const [enabled, setEnabled] = React.useState(false);
  const [rate, setRate] = React.useState("11");
  const [inclusive, setInclusive] = React.useState(false);
  const [pending, start] = React.useTransition();

  React.useEffect(() => {
    getTaxSettings().then((s) => {
      setEnabled(s.enabled);
      setRate(String(s.ratePct));
      setInclusive(s.inclusive);
      setLoaded(true);
    });
  }, []);

  const save = () =>
    start(async () => {
      const r = await saveTaxSettings({ enabled, ratePct: Number(rate.replace(/\D/g, "")) || 0, inclusive });
      if (r.ok) toast.success("Pengaturan pajak disimpan.");
      else toast.error(r.error ?? "Gagal menyimpan.");
    });

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Pajak</CardTitle>
        <CardDescription>Atur penerapan Pajak Pertambahan Nilai (PPN) pada pesanan.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {/* Was a hand-rolled copy of ToggleRow's own markup — same classes, same two <p>s — minus
            the one thing ToggleRow exists for. Measured nameless in Chromium 2026-08-05. */}
        <ToggleRow
          title="Aktifkan PPN"
          description="Tambahkan PPN pada setiap transaksi pelanggan."
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={!canWrite || !loaded}
        />

        <div className="grid gap-2">
          <Label htmlFor="tarif-ppn">Tarif PPN (%)</Label>
          <Input
            id="tarif-ppn"
            className="max-w-40 tabular-nums"
            inputMode="numeric"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            disabled={!canWrite || !enabled}
          />
          <p className="text-xs text-muted-foreground">Tarif PPN umum di Indonesia saat ini 11%.</p>
        </div>

        <ToggleRow
          title="Harga sudah termasuk pajak"
          description="Harga produk yang ditampilkan sudah termasuk PPN."
          checked={inclusive}
          onCheckedChange={setInclusive}
          disabled={!canWrite || !enabled}
        />

        <div className="rounded-lg border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
          <p><span className="font-medium text-foreground">Inclusive</span> — PPN sudah termasuk di dalam harga yang ditampilkan (harga tidak bertambah saat checkout).</p>
          <p className="mt-1.5"><span className="font-medium text-foreground">Exclusive</span> — PPN dihitung terpisah dan ditambahkan pada subtotal saat checkout.</p>
        </div>
      </CardContent>
      {canWrite && (
        <CardFooter className="justify-end">
          <Button onClick={save} disabled={pending || !loaded}>{pending ? "Menyimpan…" : "Simpan Perubahan"}</Button>
        </CardFooter>
      )}
    </Card>
  );
}
