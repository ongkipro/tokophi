"use client";
import * as React from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { useCan } from "@/components/admin/permissions";
import { getComplaintService, saveComplaintService } from "@/lib/actions/pengaduan";

export function PengaduanCard() {
  const canWrite = useCan("settings:write");
  const [loaded, setLoaded] = React.useState(false);
  const [days, setDays] = React.useState("");
  const [hasWhatsapp, setHasWhatsapp] = React.useState(true);
  const [pending, start] = React.useTransition();

  React.useEffect(() => {
    getComplaintService().then((s) => {
      setDays(s.days === null ? "" : String(s.days));
      setHasWhatsapp(s.hasWhatsapp);
      setLoaded(true);
    });
  }, []);

  const save = () =>
    start(async () => {
      const r = await saveComplaintService({ days });
      if (!r.ok) {
        toast.error(r.error ?? "Gagal menyimpan.");
        return;
      }
      setDays(r.days === null ? "" : String(r.days));
      toast.success(r.days === null ? "Jangka waktu penyelesaian dikosongkan. Pembeli tidak melihat angka apa pun." : "Layanan pengaduan disimpan.");
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Layanan pengaduan</CardTitle>
        <CardDescription>
          Pembeli mengajukan retur atau komplain lewat WhatsApp toko Anda dari akun TokoΦ mereka. Di sini Anda menetapkan dalam berapa hari kerja komplain diselesaikan.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {loaded && !hasWhatsapp && (
          <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium">Nomor WhatsApp toko belum diisi.</p>
            <p className="mt-1 text-muted-foreground">
              Tanpa nomor ini, pembeli tidak melihat tombol pengajuan retur/komplain dan tidak punya jalur menghubungi toko dari akun mereka. Isi di Pengaturan → Profil Toko.
            </p>
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor="pengaduan-hari">Jangka waktu penyelesaian komplain (hari kerja)</Label>
          <Input
            id="pengaduan-hari"
            className="max-w-40 tabular-nums"
            inputMode="numeric"
            placeholder="mis. 3"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            disabled={!canWrite || !loaded}
          />
          <p className="text-xs text-muted-foreground">
            1–60 hari kerja. Kosongkan bila toko belum menetapkannya: pembeli tidak akan melihat angka apa pun. Pembeli membaca angka ini sebagai janji toko, jadi isi hanya yang sanggup Anda penuhi.
          </p>
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
