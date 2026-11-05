"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Badge } from "@tokophi/ui/badge";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Textarea } from "@tokophi/ui/textarea";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@tokophi/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@tokophi/ui/dialog";

import type { StoreAccountRow, UnknownBookingRow } from "@/lib/mengantar-ops";
import { reconcileMengantarBooking, retryStoreMengantar, rotateStoreMengantar } from "@/lib/actions";

const RECONCILE_REASON_MIN = 10;
const when = (d: Date | null) => (d ? new Date(d).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }) : "—");

const STATE_LABEL: Record<string, string> = {
  pending: "Antre",
  registering: "Mendaftar",
  connected: "Terhubung",
  email_taken: "Email sudah dipakai",
  failed: "Ditolak",
  blocked: "Diblokir",
  rotating: "Ganti kunci",
};

export function PengirimanClient({ accounts, unknown, isOwner }: { accounts: StoreAccountRow[]; unknown: UnknownBookingRow[]; isOwner: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rotating, setRotating] = useState<StoreAccountRow | null>(null);
  const [rec, setRec] = useState<UnknownBookingRow | null>(null);
  const [mode, setMode] = useState<"adopt" | "release">("adopt");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");

  function run(fn: () => Promise<{ ok: boolean; message: string }>, done?: () => void) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
      done?.();
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Akun Mengantar toko</CardTitle>
        </CardHeader>
        {accounts.length === 0 ? (
          <CardContent className="py-8 text-center text-sm text-muted-foreground">Belum ada toko yang didaftarkan ke Mengantar.</CardContent>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Toko</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Seller · partner</TableHead>
                  <TableHead>Catatan</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((r) => (
                  <TableRow key={`${r.storeId}:${r.env}`} data-mg-account={r.state}>
                    <TableCell>
                      <Link href={`/toko/${r.storeId}`} className="font-medium hover:underline">
                        {r.storeName}
                      </Link>
                      <div className="text-xs text-muted-foreground">{when(r.updatedAt)}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{STATE_LABEL[r.state] ?? r.state}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.sellerId ?? "—"}
                      <div className="text-muted-foreground">
                        {r.partnerId ?? "—"} · kunci {r.keyHint ? `…${r.keyHint}` : "—"}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-xs text-xs text-muted-foreground">{r.lastError ?? ""}</TableCell>
                    <TableCell className="text-right">
                      {r.state === "connected" ? (
                        isOwner && (
                          <Button size="sm" variant="outline" disabled={pending} onClick={() => setRotating(r)}>
                            Perbarui kunci
                          </Button>
                        )
                      ) : (
                        <Button size="sm" variant="outline" disabled={pending || r.state === "registering" || r.state === "rotating"} onClick={() => run(() => retryStoreMengantar(r.storeId))}>
                          Daftarkan ulang
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hasil booking belum diketahui</CardTitle>
        </CardHeader>
        {unknown.length === 0 ? (
          <CardContent className="py-8 text-center text-sm text-muted-foreground">Tidak ada booking yang perlu direkonsiliasi.</CardContent>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Toko · pesanan</TableHead>
                  <TableHead>Layanan</TableHead>
                  <TableHead>Sejak</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unknown.map((r) => (
                  <TableRow key={r.bookingId}>
                    <TableCell>
                      <Link href={`/toko/${r.storeId}`} className="font-medium hover:underline">
                        {r.storeName}
                      </Link>
                      <div className="font-mono text-xs text-muted-foreground">{r.orderNumber}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.courier} · {r.serviceType}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{when(r.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => {
                          setRec(r);
                          setMode("adopt");
                          setReference("");
                          setReason("");
                        }}
                      >
                        Rekonsiliasi
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <Dialog open={!!rotating} onOpenChange={(o) => !o && setRotating(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Perbarui kunci Mengantar {rotating?.storeName}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Mengantar membuat kunci baru untuk akun toko ini dan kunci lama langsung mati. Kunci baru disimpan terenkripsi dan tidak pernah
            ditampilkan. Selama pembaruan berlangsung, booking toko ini menunggu sebentar.
          </p>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost">Batal</Button>} />
            <Button disabled={pending || !rotating} onClick={() => rotating && run(() => rotateStoreMengantar(rotating.storeId), () => setRotating(null))}>
              Perbarui kunci
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rec} onOpenChange={(o) => !o && setRec(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rekonsiliasi booking {rec?.orderNumber}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Cari pesanan <span className="font-mono">{rec?.orderNumber}</span> di akun Mengantar toko (kolom tanda tujuan). Jika ada, tempel ORDER_ID atau resinya — data
            diambil ulang dari akun Mengantar toko. Jika tidak ada, lepas booking: pesanan bisa dibooking ulang.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant={mode === "adopt" ? "default" : "ghost"} onClick={() => setMode("adopt")}>
              Ada di Mengantar
            </Button>
            <Button size="sm" variant={mode === "release" ? "default" : "ghost"} onClick={() => setMode("release")}>
              Tidak ada di Mengantar
            </Button>
          </div>
          {mode === "adopt" && (
            <div className="space-y-1">
              <Label htmlFor="mg-ref">ORDER_ID atau resi</Label>
              <Input id="mg-ref" value={reference} onChange={(e) => setReference(e.target.value)} autoComplete="off" />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="mg-reason">Alasan (wajib, min. {RECONCILE_REASON_MIN} karakter)</Label>
            <Textarea id="mg-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost">Batal</Button>} />
            <Button
              disabled={pending || !rec || reason.trim().length < RECONCILE_REASON_MIN || (mode === "adopt" && !reference.trim())}
              onClick={() =>
                rec &&
                run(
                  () => reconcileMengantarBooking(rec.bookingId, mode === "adopt" ? { reference, reason } : { notAtProvider: true, reason }),
                  () => setRec(null),
                )
              }
            >
              {mode === "adopt" ? "Adopsi dari Mengantar" : "Lepas booking"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
