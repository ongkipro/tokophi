"use client";
import * as React from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { useCan } from "@/components/admin/permissions";
import { getReturnWindow, saveReturnWindow } from "@/lib/actions/retur";

export function ReturCard() {
  const canWrite = useCan("settings:write");
  const [loaded, setLoaded] = React.useState(false);
  const [days, setDays] = React.useState("");
  const [pending, start] = React.useTransition();

  React.useEffect(() => {
    getReturnWindow().then((d) => {
      setDays(d === null ? "" : String(d));
      setLoaded(true);
    });
  }, []);

  const save = () =>
    start(async () => {
      const r = await saveReturnWindow({ days });
      if (!r.ok) {
        toast.error(r.error ?? "Gagal menyimpan.");
        return;
      }
      setDays(r.days === null ? "" : String(r.days));
      toast.success(r.days === null ? "Kebijakan retur dikosongkan. Pembeli tidak melihat apa pun soal retur." : "Kebijakan retur disimpan.");
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Kebijakan retur</CardTitle>
        <CardDescription>
          Berapa hari setelah barang diterima toko Anda menerima pengajuan retur. Angka ini ditampilkan ke pembeli di akun TokoΦ mereka pada pesanan yang sudah dikirim.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        <Label htmlFor="retur-hari">Jendela retur (hari)</Label>
        <Input
          id="retur-hari"
          className="max-w-40 tabular-nums"
          inputMode="numeric"
          placeholder="mis. 7"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          disabled={!canWrite || !loaded}
        />
        <p className="text-xs text-muted-foreground">
          1–90 hari. Kosongkan bila toko tidak menjanjikan jendela retur: pembeli tidak akan melihat keterangan retur. Pastikan angka ini sesuai kebijakan toko Anda, karena pembeli akan membacanya sebagai janji.
        </p>
      </CardContent>
      {canWrite && (
        <CardFooter className="justify-end">
          <Button onClick={save} disabled={pending || !loaded}>{pending ? "Menyimpan…" : "Simpan Perubahan"}</Button>
        </CardFooter>
      )}
    </Card>
  );
}
