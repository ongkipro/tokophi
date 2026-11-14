"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, KeyRound, Power, PowerOff } from "lucide-react";
import { Badge } from "@tokophi/ui/badge";
import { Button } from "@tokophi/ui/button";
import { Card, CardContent } from "@tokophi/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@tokophi/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@tokophi/ui/table";
import { resetAffiliateAccountPassword, setAffiliateAccountDisabled } from "@/lib/actions/affiliate-accounts";
import type { AffiliateAccountRow } from "@/lib/affiliate-accounts";
import { refused } from "@/lib/refused";

// The actions are the boundary (rank gate + one transaction + audit line); this screen asks first, then
// shows what the server WROTE — including the one and only view of a reset password.

type Row = Omit<AffiliateAccountRow, "createdAt" | "disabledAt"> & { createdAt: string; disabledAt: string | null };
type Pending = { kind: "reset" | "disable" | "enable"; row: Row } | null;

const STATUS: Record<Row["stores"][number]["status"], string> = {
  menunggu: "menunggu",
  aktif: "aktif",
  ditolak: "ditolak",
  nonaktif: "nonaktif",
};
const fmt = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
const date = (iso: string) => fmt.format(new Date(iso));

export function AffiliateAccountsClient({ rows, filtered }: { rows: Row[]; filtered: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [confirm, setConfirm] = useState<Pending>(null);
  const [revealed, setRevealed] = useState<{ email: string; password: string; revoked: number } | null>(null);

  const run = (p: NonNullable<Pending>) =>
    start(async () => {
      if (p.kind === "reset") {
        const r = await resetAffiliateAccountPassword(p.row.id);
        const no = refused(r);
        if (no || !r.ok) return void toast.error(no ?? "Gagal.");
        setRevealed({ email: r.email, password: r.password, revoked: r.revokedSessions });
      } else {
        const r = await setAffiliateAccountDisabled(p.row.id, p.kind === "disable");
        const no = refused(r);
        if (no || !r.ok) return void toast.error(no ?? "Gagal.");
        toast.success(
          r.disabled ? `Akun ${r.email} dinonaktifkan — ${r.revokedSessions} sesi dicabut.` : `Akun ${r.email} aktif lagi. Pemiliknya bisa masuk kembali.`,
        );
      }
      router.refresh();
    });

  if (!rows.length)
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          {filtered ? "Tidak ada akun affiliate yang cocok dengan pencarian ini." : "Belum ada akun affiliate."}
        </CardContent>
      </Card>
    );

  const actions = (r: Row, wide?: boolean) => (
    <div className={wide ? "grid grid-cols-2 gap-2" : "flex justify-end gap-1"}>
      <Button size="sm" variant="outline" className={wide ? "h-10" : undefined} disabled={busy} onClick={() => setConfirm({ kind: "reset", row: r })}>
        <KeyRound /> Reset sandi
      </Button>
      {r.disabledAt ? (
        <Button size="sm" variant="outline" className={wide ? "h-10" : undefined} disabled={busy} onClick={() => setConfirm({ kind: "enable", row: r })}>
          <Power /> Aktifkan
        </Button>
      ) : (
        <Button size="sm" variant="outline" className={wide ? "h-10 text-destructive" : "text-destructive"} disabled={busy} onClick={() => setConfirm({ kind: "disable", row: r })}>
          <PowerOff /> Nonaktifkan
        </Button>
      )}
    </div>
  );
  const stores = (r: Row) =>
    r.stores.length ? (
      <ul className="flex flex-wrap gap-1">
        {r.stores.map((s) => (
          <li key={s.slug}>
            <Badge variant="outline" className="font-normal">
              {s.name} · {STATUS[s.status]}
            </Badge>
          </li>
        ))}
      </ul>
    ) : (
      <span className="text-xs text-muted-foreground">Belum bergabung ke toko mana pun</span>
    );
  const state = (r: Row) =>
    r.disabledAt ? (
      <Badge variant="secondary">Nonaktif sejak {date(r.disabledAt)}</Badge>
    ) : (
      <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">Aktif</Badge>
    );

  return (
    <>
      <ul className="grid gap-3 md:hidden" aria-label="Akun affiliate">
        {rows.map((r) => (
          <li key={r.id}>
            <Card className="gap-3 py-4">
              <CardContent className="grid gap-3 px-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{r.name}</p>
                    <p className="wrap-anywhere text-xs text-muted-foreground">{r.email}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">{r.phone}</p>
                  </div>
                  {state(r)}
                </div>
                {stores(r)}
                <p className="text-xs text-muted-foreground">
                  Dibuat {date(r.createdAt)} · {r.liveSessions} sesi aktif
                </p>
                {actions(r, true)}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
      <Card className="hidden py-0 md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Akun</TableHead>
              <TableHead>Toko</TableHead>
              <TableHead>Dibuat</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="pr-4">
                <span className="sr-only">Aksi</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="pl-4 align-top">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground">{r.email}</div>
                  <div className="text-xs text-muted-foreground tabular-nums">{r.phone}</div>
                </TableCell>
                <TableCell className="max-w-72 whitespace-normal align-top">{stores(r)}</TableCell>
                <TableCell className="align-top text-sm">
                  {date(r.createdAt)}
                  <div className="text-xs text-muted-foreground">{r.liveSessions} sesi aktif</div>
                </TableCell>
                <TableCell className="align-top">{state(r)}</TableCell>
                <TableCell className="pr-4 align-top">{actions(r)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          {confirm && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {confirm.kind === "reset" ? "Reset kata sandi?" : confirm.kind === "disable" ? "Nonaktifkan akun?" : "Aktifkan akun lagi?"}
                </DialogTitle>
                <DialogDescription>
                  {confirm.kind === "reset" ? (
                    <>
                      Kata sandi <b>{confirm.row.email}</b> diganti dengan kata sandi acak yang tampil sekali. Semua sesi masuknya dicabut.
                      Lakukan hanya bila pemilik akun menghubungi kami dari alamat email ini.
                    </>
                  ) : confirm.kind === "disable" ? (
                    <>
                      <b>{confirm.row.email}</b> tidak bisa masuk lagi dan semua sesinya dicabut. Komisinya di tiap toko tetap tercatat.
                    </>
                  ) : (
                    <>
                      <b>{confirm.row.email}</b> bisa masuk lagi dengan kata sandinya.
                    </>
                  )}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline">Batal</Button>} />
                <Button
                  variant={confirm.kind === "disable" ? "destructive" : "default"}
                  disabled={busy}
                  onClick={() => {
                    const p = confirm;
                    setConfirm(null);
                    run(p);
                  }}
                >
                  {confirm.kind === "reset" ? "Reset kata sandi" : confirm.kind === "disable" ? "Nonaktifkan" : "Aktifkan"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!revealed} onOpenChange={(o) => !o && setRevealed(null)}>
        <DialogContent className="sm:max-w-md">
          {revealed && (
            <>
              <DialogHeader>
                <DialogTitle>Kata sandi baru</DialogTitle>
                <DialogDescription>
                  Untuk <b>{revealed.email}</b>. Salin sekarang — kata sandi ini tidak bisa dilihat lagi. {revealed.revoked} sesi dicabut.
                  Kirim hanya ke alamat email akun ini dan minta pemiliknya menggantinya setelah masuk.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2">
                <code className="flex-1 select-all rounded-md bg-muted px-3 py-2 font-mono text-sm">{revealed.password}</code>
                <Button
                  size="icon"
                  variant="outline"
                  aria-label="Salin kata sandi"
                  onClick={() =>
                    navigator.clipboard.writeText(revealed.password).then(
                      () => toast.success("Kata sandi disalin."),
                      () => toast.error("Tidak bisa menyalin — pilih teksnya lalu salin manual."),
                    )
                  }
                >
                  <Copy />
                </Button>
              </div>
              <DialogFooter>
                <DialogClose render={<Button>Selesai</Button>} />
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
