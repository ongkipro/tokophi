"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Ban, CircleCheck, RotateCcw, Send, Undo2 } from "lucide-react";
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
import { IDR, num } from "@tokophi/lib/format";

import type { RefundRow, RefundStatus, RefundSummary } from "@/lib/data";
import { processRefund, markRefundPaid, rejectRefund } from "@/lib/actions";

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// REFUND QUEUE (Task 8.31) — a paid prepaid order that was cancelled or returned owes the BUYER
// their money. The rows are written by the seller's own status change (`applyOrderStatusChange`),
// never here; this screen only settles them. Same three-step shape as the payout queue above it
// (Proses → Tandai selesai / Tolak) so an operator learns one workflow, but it is a SEPARATE table:
// a payout is a merchant's ledger balance leaving; a refund is money that never entered any ledger.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const STATUS_UI: Record<RefundStatus, { label: string; cls: string }> = {
  menunggu: { label: "Menunggu", cls: "bg-amber-500/12 text-amber-600 dark:text-amber-400" },
  diproses: { label: "Diproses", cls: "bg-sky-500/12 text-sky-600 dark:text-sky-400" },
  selesai: { label: "Selesai", cls: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
  gagal: { label: "Ditolak", cls: "bg-destructive/12 text-destructive" },
};

const METHOD_LABEL: Record<string, string> = {
  transfer: "Transfer Bank",
  va: "Virtual Account",
  qris: "QRIS",
  ovo: "OVO",
  gopay: "GoPay",
  dana: "DANA",
  cod: "COD",
};

const TABS: { key: "antrian" | RefundStatus | "semua"; label: string }[] = [
  { key: "antrian", label: "Antrian" },
  { key: "selesai", label: "Selesai" },
  { key: "gagal", label: "Ditolak" },
  { key: "semua", label: "Semua" },
];

const ago = (m: number) =>
  m < 1 ? "baru saja" : m < 60 ? `${m} mnt lalu` : m < 1440 ? `${Math.round(m / 60)} jam lalu` : `${Math.round(m / 1440)} hari lalu`;

const open = (r: RefundRow) => r.status === "menunggu" || r.status === "diproses";

export function RefundQueue({ refunds, summary }: { refunds: RefundRow[]; summary: RefundSummary }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<"antrian" | RefundStatus | "semua">("antrian");

  const [paying, setPaying] = useState<RefundRow | null>(null);
  const [payRef, setPayRef] = useState("");
  const [rejecting, setRejecting] = useState<RefundRow | null>(null);
  const [reason, setReason] = useState("");

  const rows = useMemo(() => {
    if (tab === "semua") return refunds;
    if (tab === "antrian") return refunds.filter(open);
    return refunds.filter((r) => r.status === tab);
  }, [tab, refunds]);
  const count = (k: (typeof TABS)[number]["key"]) =>
    k === "semua" ? refunds.length : k === "antrian" ? refunds.filter(open).length : refunds.filter((r) => r.status === k).length;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string, done?: () => void) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(okMsg);
        done?.();
        router.refresh();
      } else {
        toast.error(r.error ?? "Gagal.");
      }
    });
  }

  const owed = summary.pendingAmount + summary.processingAmount;
  const owedCount = summary.pendingCount + summary.processingCount;

  return (
    <div className="space-y-5">
      <div className="pt-2">
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <Undo2 className="size-5 text-muted-foreground" /> Refund ke Pembeli
        </h2>
        <p className="text-sm text-muted-foreground">
          Pesanan <b>prabayar</b> yang dibatalkan atau diretur <b>setelah</b> pembeli membayar. Uangnya masih kami pegang —
          antrean ini adalah catatan bahwa kami berutang, sampai ditransfer balik. COD tidak pernah masuk sini.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className={cn(owedCount && "border-rose-300 dark:border-rose-900/50")}>
          <CardContent className="pt-5">
            <div className="text-xs text-muted-foreground">Wajib dikembalikan</div>
            <div className={cn("mt-1 text-2xl font-bold tabular-nums", owedCount && "text-rose-700 dark:text-rose-400")}>{IDR(owed)}</div>
            <p className="mt-1 text-[11px] text-muted-foreground">{num(owedCount)} refund terbuka (menunggu + diproses).</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-xs text-muted-foreground">Menunggu diproses</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{IDR(summary.pendingAmount)}</div>
            <p className="mt-1 text-[11px] text-muted-foreground">{num(summary.pendingCount)} belum disentuh operator.</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-xs text-muted-foreground">Sudah dikembalikan</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{IDR(summary.paidAmount)}</div>
            <p className="mt-1 text-[11px] text-muted-foreground">{num(summary.paidCount)} refund selesai.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>Antrean refund</CardTitle>
          <div className="flex flex-wrap gap-1">
            {TABS.map((t) => (
              <Button key={t.key} size="sm" variant={tab === t.key ? "default" : "ghost"} onClick={() => setTab(t.key)}>
                {t.label} <span className="ml-1 tabular-nums opacity-70">{count(t.key)}</span>
              </Button>
            ))}
          </div>
        </CardHeader>
        {rows.length === 0 ? (
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <RotateCcw className="mx-auto mb-2 size-5 opacity-50" />
            Tidak ada refund di tab ini.
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Toko · pesanan</TableHead>
                  <TableHead>Pembeli</TableHead>
                  <TableHead className="text-right">Jumlah</TableHead>
                  <TableHead>Dibayar via</TableHead>
                  <TableHead>Alasan</TableHead>
                  <TableHead>Sejak</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link href={`/toko/${r.storeId}`} className="font-medium hover:underline">
                        {r.storeName}
                      </Link>
                      <div className="font-mono text-xs text-muted-foreground">{r.orderNumber}</div>
                      {r.status === "gagal" && r.note && (
                        <div className="mt-0.5 max-w-[26ch] truncate text-xs text-destructive" title={r.note}>
                          Ditolak: {r.note}
                        </div>
                      )}
                      {r.status === "selesai" && r.note && (
                        <div className="mt-0.5 max-w-[26ch] truncate text-xs text-muted-foreground" title={r.note}>
                          Ref: {r.note}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="truncate text-sm">{r.buyerName ?? "—"}</div>
                      <div className="truncate text-xs tabular-nums text-muted-foreground">{r.buyerPhone ?? "—"}</div>
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{IDR(r.amount)}</TableCell>
                    <TableCell className="text-sm">{METHOD_LABEL[r.method] ?? r.method}</TableCell>
                    <TableCell className="max-w-[28ch] truncate text-sm text-muted-foreground" title={r.reason ?? undefined}>
                      {r.reason ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {ago(r.minutesAgo)}
                      {r.paidAt && (
                        <div className="text-xs text-emerald-600 dark:text-emerald-400">Selesai {r.paidAt.toLocaleDateString("id-ID")}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={cn("border-transparent", STATUS_UI[r.status].cls)}>
                        {STATUS_UI[r.status].label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {open(r) ? (
                        <div className="flex justify-end gap-1.5">
                          {r.status === "menunggu" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              disabled={pending}
                              onClick={() => run(() => processRefund(r.id), `Refund ${r.orderNumber} diproses.`)}
                            >
                              <Send className="size-3.5" /> Proses
                            </Button>
                          )}
                          {r.status === "diproses" && (
                            <Button
                              size="sm"
                              className="gap-1.5"
                              disabled={pending}
                              onClick={() => {
                                setPaying(r);
                                setPayRef("");
                              }}
                            >
                              <CircleCheck className="size-3.5" /> Tandai selesai
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            disabled={pending}
                            onClick={() => {
                              setRejecting(r);
                              setReason("");
                            }}
                          >
                            <Ban className="size-3.5" /> Tolak
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* MARK-DONE DIALOG — the reference is optional (a rushed operator is never blocked) but this
          is the moment it is at hand. It lands in refunds.note; the seller's order detail shows it. */}
      <Dialog open={paying !== null} onOpenChange={(o) => !o && setPaying(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tandai refund selesai</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">
                  {paying?.storeName} · <span className="font-mono text-xs">{paying?.orderNumber}</span>
                </span>
                <span className="font-semibold tabular-nums">{IDR(paying?.amount ?? 0)}</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Pembeli: {paying?.buyerName ?? "—"} · <span className="tabular-nums">{paying?.buyerPhone ?? "—"}</span>
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Konfirmasi bahwa dana <b>sudah dikembalikan</b> ke pembeli. Seller akan melihat status <b>Selesai</b> di detail pesanan.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="refund-ref">No. referensi transfer (opsional)</Label>
              <Input id="refund-ref" value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Mis. nomor referensi BI-FAST / ID refund gateway" />
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Batal</Button>} />
            <Button
              disabled={pending}
              className="gap-1.5"
              onClick={() => {
                const r = paying;
                if (!r) return;
                run(() => markRefundPaid(r.id, payRef), `Refund ${r.orderNumber} selesai.`, () => {
                  setPaying(null);
                  setPayRef("");
                });
              }}
            >
              <CircleCheck className="size-4" /> {pending ? "Memproses…" : "Tandai selesai"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* REJECT DIALOG — nothing is restored anywhere (no ledger row exists), so the reason is the
          whole record of why a buyer who paid was not paid back. Required. */}
      <Dialog open={rejecting !== null} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tolak refund</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">
                  {rejecting?.storeName} · <span className="font-mono text-xs">{rejecting?.orderNumber}</span>
                </span>
                <span className="font-semibold tabular-nums">{IDR(rejecting?.amount ?? 0)}</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Menolak berarti pembeli <b>tidak</b> menerima uangnya kembali. Tidak ada saldo yang bergerak — alasan ini
                adalah satu-satunya catatan mengapa.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="refund-reject-reason">Alasan penolakan</Label>
              <Textarea
                id="refund-reject-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Mis. sudah dikembalikan lewat jalur lain / pembeli tidak dapat dihubungi."
              />
              <p className="text-xs text-muted-foreground">Terlihat oleh seller di detail pesanan dan tercatat di audit log.</p>
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Batal</Button>} />
            <Button
              variant="destructive"
              disabled={pending || !reason.trim()}
              onClick={() => {
                const r = rejecting;
                if (!r) return;
                run(() => rejectRefund(r.id, reason), `Refund ${r.orderNumber} ditolak.`, () => {
                  setRejecting(null);
                  setReason("");
                });
              }}
            >
              {pending ? "Memproses…" : "Tolak refund"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
