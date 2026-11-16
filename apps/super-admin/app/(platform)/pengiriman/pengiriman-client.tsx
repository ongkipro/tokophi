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
import { cn } from "@tokophi/ui/lib/utils";
import { CircleCheck, CircleAlert } from "lucide-react";

import type { StoreAccountRow, StrandedOrderRow, UnknownBookingRow } from "@/lib/mengantar-ops";
import { reconcileMengantarBooking, retryStoreMengantar, rotateStoreMengantar } from "@/lib/actions";
import { accountView, summarize, type MgBucket, type MgReadinessStep, type MgTone } from "@/lib/mengantar-overview";

const RECONCILE_REASON_MIN = 10;
const when = (d: Date | null) => (d ? new Date(d).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }) : "—");

const STATE_LABEL: Record<string, string> = {
  none: "Belum ada akun",
  pending: "Antre",
  registering: "Mendaftar",
  connected: "Terhubung",
  email_taken: "Email sudah dipakai",
  failed: "Ditolak",
  blocked: "Diblokir",
  rotating: "Ganti kunci",
};

// Glyph + word + colour, never colour alone.
const TONE: Record<MgTone, string> = {
  ok: "border-transparent bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
  wait: "border-transparent bg-amber-500/12 text-amber-700 dark:text-amber-400",
  problem: "border-transparent bg-destructive/10 text-destructive",
  muted: "border-transparent bg-muted text-muted-foreground",
};

type Filter = "semua" | "tindakan" | "terhubung" | "riwayat";
const FILTERS: { id: Filter; label: string; match: (b: MgBucket) => boolean }[] = [
  { id: "semua", label: "Semua", match: () => true },
  { id: "tindakan", label: "Perlu tindakan", match: (b) => b === "waiting" || b === "problem" },
  { id: "terhubung", label: "Terhubung", match: (b) => b === "connected" },
  { id: "riwayat", label: "Riwayat", match: (b) => b === "history" },
];

function Readiness({ steps, env }: { steps: MgReadinessStep[]; env: string }) {
  // Steps 1–4 gate registration; the switch decides whether connected stores quote Mengantar.
  const canRegister = steps.filter((s) => s.key !== "switch").every((s) => s.ok);
  return (
    <Card data-mg-readiness={canRegister ? "ready" : "blocked"}>
      <CardHeader>
        <CardTitle>Kesiapan multi-seller ({env})</CardTitle>
        <p className={cn("text-sm", canRegister ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>
          {canRegister
            ? "Siap: TokoΦ bisa membuatkan akun Mengantar untuk toko yang dipindah ke Mengantar."
            : "Belum siap: akun Mengantar untuk toko baru belum bisa dibuat. Toko yang sudah terhubung tetap berjalan."}
        </p>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {steps.map((s, i) => (
            <li key={s.key} data-mg-step={s.key} data-ok={s.ok} className="flex gap-2.5 rounded-lg border p-3">
              {s.ok ? (
                <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              )}
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  <span className="sr-only">{s.ok ? "Selesai: " : "Belum: "}</span>
                  {i + 1}. {s.label}
                </div>
                <div className="text-xs text-muted-foreground">{s.detail}</div>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: MgTone }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className={cn("text-2xl leading-none font-bold tabular-nums", value > 0 && tone === "problem" && "text-destructive", value > 0 && tone === "wait" && "text-amber-700 dark:text-amber-400")}>{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export function PengirimanClient({ accounts, unknown, stranded, steps, env, isOwner }: { accounts: StoreAccountRow[]; unknown: UnknownBookingRow[]; stranded: StrandedOrderRow[]; steps: MgReadinessStep[]; env: string; isOwner: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rotating, setRotating] = useState<StoreAccountRow | null>(null);
  const [rec, setRec] = useState<UnknownBookingRow | null>(null);
  const [mode, setMode] = useState<"adopt" | "release">("adopt");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [filter, setFilter] = useState<Filter>("semua");
  const sum = summarize(accounts);
  const views = accounts.map((r) => ({ r, v: accountView(r) }));
  const match = FILTERS.find((f) => f.id === filter)!.match;
  const shown = views.filter(({ v }) => match(v.bucket));

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
      <Readiness steps={steps} env={env} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6" data-mg-summary>
        <Stat label="Toko di Mengantar" value={sum.onMengantar} />
        <Stat label="Terhubung" value={sum.connected} />
        <Stat label="Menunggu" value={sum.waiting} tone="wait" />
        <Stat label="Bermasalah" value={sum.problem} tone="problem" />
        <Stat label="Booking belum diketahui" value={unknown.length} tone="problem" />
        <Stat label="Pesanan tertahan" value={stranded.length} tone="problem" />
      </div>

      <Card>
        <CardHeader className="gap-3">
          <CardTitle>Akun Mengantar toko</CardTitle>
          {accounts.length > 0 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Saring akun">
              {FILTERS.map((f) => {
                const n = views.filter(({ v }) => f.match(v.bucket)).length;
                return (
                  <Button key={f.id} size="sm" variant={filter === f.id ? "default" : "outline"} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                    {f.label} <span className="tabular-nums opacity-70">{n}</span>
                  </Button>
                );
              })}
            </div>
          )}
        </CardHeader>
        {accounts.length === 0 ? (
          <CardContent className="py-8 text-center text-sm text-muted-foreground">Belum ada toko yang memakai Mengantar. Pindahkan toko di halaman tokonya, atau buat kode daftar Mengantar.</CardContent>
        ) : shown.length === 0 ? (
          <CardContent className="py-8 text-center text-sm text-muted-foreground">Tidak ada akun di saringan ini.</CardContent>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Toko</TableHead>
                  <TableHead>Penyedia toko</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Seller · partner</TableHead>
                  <TableHead>Yang perlu dilakukan</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map(({ r, v }) => (
                  <TableRow key={`${r.storeId}:${r.env}`} data-mg-account={r.state} data-mg-bucket={v.bucket}>
                    <TableCell>
                      <Link href={`/toko/${r.storeId}`} className="font-medium hover:underline">
                        {r.storeName}
                      </Link>
                      <div className="text-xs text-muted-foreground">{when(r.updatedAt)}</div>
                    </TableCell>
                    {/* ADR 0019: the store's provider. A KiriminAja store's row is history — it is not quoted. */}
                    <TableCell data-store-provider={r.provider}>
                      <Badge variant={r.provider === "mengantar" ? "default" : "outline"}>{r.provider === "mengantar" ? "Mengantar" : "KiriminAja"}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={cn("whitespace-nowrap", TONE[v.tone])}>{v.label}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.sellerId ?? "—"}
                      <div className="text-muted-foreground">
                        {r.partnerId ?? "—"} · kunci {r.keyHint ? `…${r.keyHint}` : "—"}
                      </div>
                    </TableCell>
                    <TableCell className="min-w-56 max-w-sm text-xs whitespace-normal text-muted-foreground">{v.hint ?? ""}</TableCell>
                    <TableCell className="text-right">
                      {v.action === "rotate" && isOwner && (
                        <Button size="sm" variant="outline" disabled={pending} onClick={() => setRotating(r)}>
                          Perbarui kunci
                        </Button>
                      )}
                      {v.action === "register" && (
                        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => retryStoreMengantar(r.storeId))}>
                          {r.state === "none" ? "Daftarkan" : "Daftarkan ulang"}
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

      <Card>
        <CardHeader>
          <CardTitle>Pesanan Mengantar tanpa akun aktif</CardTitle>
          <p className="text-sm text-muted-foreground">
            Pesanan ini sudah dihitung lewat Mengantar (ongkirnya milik seller), tetapi akun Mengantar tokonya tidak bisa dipakai — belum
            bisa dibooking, atau tidak bisa dilacak. Pulihkan akun tokonya di atas (daftar ulang / perbarui kunci); jangan pindahkan
            pesanannya ke provider lain.
          </p>
        </CardHeader>
        {stranded.length === 0 ? (
          <CardContent className="py-8 text-center text-sm text-muted-foreground">Tidak ada pesanan yang tertahan.</CardContent>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Toko · pesanan</TableHead>
                  <TableHead>Akun Mengantar</TableHead>
                  <TableHead>Pengiriman</TableHead>
                  <TableHead>Sejak</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stranded.map((r) => (
                  <TableRow key={r.orderNumber}>
                    <TableCell>
                      <Link href={`/toko/${r.storeId}`} className="font-medium hover:underline">
                        {r.storeName}
                      </Link>
                      <div className="font-mono text-xs text-muted-foreground">{r.orderNumber}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.sellerChanged ? "Dibooking dengan akun lama" : r.accountState ? (STATE_LABEL[r.accountState] ?? r.accountState) : "Belum ada akun"}
                    </TableCell>
                    <TableCell className="text-sm">{r.booked ? "Sudah dibooking — pelacakan berhenti" : "Belum dibooking"}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{when(r.placedAt)}</TableCell>
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
