"use client";
import * as React from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Switch } from "@tokophi/ui/switch";
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
        <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/40 p-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Aktifkan PPN</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Tambahkan PPN pada setiap transaksi pelanggan.</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canWrite || !loaded} />
        </div>

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

        <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/40 p-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Harga sudah termasuk pajak</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Harga produk yang ditampilkan sudah termasuk PPN.</p>
          </div>
          <Switch checked={inclusive} onCheckedChange={setInclusive} disabled={!canWrite || !enabled} />
        </div>

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
