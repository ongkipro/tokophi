"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Banknote,
  Clock,
  CircleCheck,
  Send,
  TriangleAlert,
  Landmark,
  Save,
  Wallet,
  Ban,
} from "lucide-react";
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

import type { PayoutRow, PayoutStatus, PayoutSummary, PayoutPolicy } from "@/lib/data";
import { processPayout, markPayoutPaid, rejectPayout, savePayoutPolicy } from "@/lib/actions";

const STATUS_UI: Record<PayoutStatus, { label: string; cls: string }> = {
  menunggu: { label: "Menunggu", cls: "bg-amber-500/12 text-amber-600 dark:text-amber-400" },
  diproses: { label: "Diproses", cls: "bg-sky-500/12 text-sky-600 dark:text-sky-400" },
  selesai: { label: "Selesai", cls: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
  gagal: { label: "Ditolak", cls: "bg-destructive/12 text-destructive" },
};

const TABS: { key: "antrian" | PayoutStatus | "semua"; label: string }[] = [
  { key: "antrian", label: "Antrian" },
  { key: "menunggu", label: "Menunggu" },
  { key: "diproses", label: "Diproses" },
  { key: "selesai", label: "Selesai" },
  { key: "gagal", label: "Ditolak" },
  { key: "semua", label: "Semua" },
];

const ago = (m: number) =>
  m < 1 ? "baru saja" : m < 60 ? `${m} mnt lalu` : m < 1440 ? `${Math.round(m / 60)} jam lalu` : `${Math.round(m / 1440)} hari lalu`;

export function PencairanClient({
  payouts,
  summary,
  policy,
}: {
  payouts: PayoutRow[];
  summary: PayoutSummary;
  policy: PayoutPolicy;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<"antrian" | PayoutStatus | "semua">("antrian");

  // reject dialog
  const [rejecting, setRejecting] = useState<PayoutRow | null>(null);
  const [reason, setReason] = useState("");

  // mark-paid dialog — collects the (optional) bank-transfer reference before confirming
  const [paying, setPaying] = useState<PayoutRow | null>(null);
  const [payRef, setPayRef] = useState("");

  // policy form
  const [releaseOn, setReleaseOn] = useState<PayoutPolicy["releaseOn"]>(policy.releaseOn);
  const [minPayout, setMinPayout] = useState(String(policy.minPayoutIdr));

  const open = (p: PayoutRow) => p.status === "menunggu" || p.status === "diproses";
  const rows = useMemo(() => {
    if (tab === "semua") return payouts;
    if (tab === "antrian") return payouts.filter(open);
    return payouts.filter((p) => p.status === tab);
  }, [tab, payouts]);
  const count = (k: (typeof TABS)[number]["key"]) =>
    k === "semua" ? payouts.length : k === "antrian" ? payouts.filter(open).length : payouts.filter((p) => p.status === k).length;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(okMsg);
        router.refresh();
      } else {
        toast.error(r.error ?? "Gagal.");
      }
    });
  }

  function submitPaid() {
    const p = paying;
    if (!p) return;
    startTransition(async () => {
      const r = await markPayoutPaid(p.id, payRef);
      if (r.ok) {
        toast.success(`Pencairan ${p.storeName} ditandai lunas.`);
        setPaying(null);
        setPayRef("");
        router.refresh();
      } else {
        toast.error(r.error ?? "Gagal menandai lunas.");
      }
    });
  }

  function submitReject() {
    const p = rejecting;
    if (!p) return;
    startTransition(async () => {
      const r = await rejectPayout(p.id, reason);
      if (r.ok) {
        toast.success(`Pencairan ditolak. ${IDR(r.restored ?? 0)} dikembalikan ke saldo ${p.storeName}.`);
        setRejecting(null);
        setReason("");
        router.refresh();
      } else {
        toast.error(r.error ?? "Gagal menolak pencairan.");
      }
    });
  }

  function submitPolicy() {
    startTransition(async () => {
      const r = await savePayoutPolicy({ releaseOn, minPayoutIdr: Number(minPayout) });
      if (r.ok) {
        toast.success("Kebijakan pencairan disimpan.");
        router.refresh();
      } else {
        toast.error(r.error ?? "Gagal menyimpan kebijakan.");
      }
    });
  }

  const stats = [
    {
      label: "Menunggu diproses",
      value: IDR(summary.pendingAmount),
      hint: `${num(summary.pendingCount)} permintaan`,
      icon: Clock,
      tint: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
    },
    {
      label: "Sedang diproses",
      value: IDR(summary.processingAmount),
      hint: `${num(summary.processingCount)} transfer berjalan`,
      icon: Send,
      tint: "bg-sky-500/12 text-sky-600 dark:text-sky-400",
    },
    {
      label: "Total dicairkan",
      value: IDR(summary.paidAmount),
      hint: `${num(summary.paidCount)} pencairan lunas`,
      icon: CircleCheck,
      tint: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
    },
    {
      label: "Kebijakan platform",
      value: policy.releaseOn === "selesai" ? "Rilis: Selesai" : "Rilis: Dikirim",
      hint: `Min. tarik ${IDR(policy.minPayoutIdr)}`,
      icon: Wallet,
      tint: policy.releaseOn === "selesai" ? "bg-primary/10 text-primary" : "bg-destructive/12 text-destructive",
    },
  ];

  return (
    <div className="space-y-5">
      {/* SUMMARY STRIP */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="flex items-center gap-3">
              <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", s.tint)}>
                <s.icon className="size-5" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-xs text-muted-foreground">{s.label}</div>
                <div className="truncate text-lg font-bold tabular-nums">{s.value}</div>
                <div className="truncate text-xs text-muted-foreground">{s.hint}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* QUEUE */}
      <Card className="gap-0 py-0">
        <div className="flex flex-wrap gap-1 border-b p-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                tab === t.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t.label}
              <span className={cn("rounded-full px-1.5 text-xs tabular-nums", tab === t.key ? "bg-primary/15" : "bg-muted")}>
                {count(t.key)}
              </span>
            </button>
          ))}
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center text-muted-foreground">
            <Banknote className="size-8" />
            <p className="text-sm">Tidak ada permintaan pencairan.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Toko</TableHead>
                  <TableHead className="text-right">Jumlah</TableHead>
                  <TableHead>Rekening tujuan</TableHead>
                  <TableHead>Diminta</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  <TableRow key={p.id} className={cn(p.status === "menunggu" && "bg-amber-500/[0.04]")}>
                    <TableCell>
                      <Link href={`/toko/${p.storeId}`} className="font-medium hover:text-primary hover:underline">
                        {p.storeName}
                      </Link>
                      {p.status === "gagal" && p.note && (
                        <div className="mt-0.5 max-w-[26ch] truncate text-xs text-destructive" title={p.note}>
                          Alasan: {p.note}
                        </div>
                      )}
                      {p.status === "selesai" && p.note && (
                        <div className="mt-0.5 max-w-[26ch] truncate text-xs text-muted-foreground" title={p.note}>
                          Ref: {p.note}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{IDR(p.amount)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Landmark className="size-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="truncate text-sm">
                            {p.bankName ?? "—"} · <span className="tabular-nums">{p.bankAccount ?? "—"}</span>
                          </div>
                          <div className="truncate text-xs text-muted-foreground">{p.bankHolder ?? "—"}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {ago(p.minutesAgo)}
                      {p.paidAt && (
                        <div className="text-xs text-emerald-600 dark:text-emerald-400">
                          Lunas {p.paidAt.toLocaleDateString("id-ID")}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={cn("border-transparent", STATUS_UI[p.status].cls)}>
                        {STATUS_UI[p.status].label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {open(p) ? (
                        <div className="flex justify-end gap-1.5">
                          {p.status === "menunggu" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              disabled={pending}
                              onClick={() => run(() => processPayout(p.id), `Pencairan ${p.storeName} diproses.`)}
                            >
                              <Send className="size-3.5" /> Proses
                            </Button>
                          )}
                          {p.status === "diproses" && (
                            <Button
                              size="sm"
                              className="gap-1.5"
                              disabled={pending}
                              onClick={() => {
                                setPaying(p);
                                setPayRef("");
                              }}
                            >
                              <CircleCheck className="size-3.5" /> Tandai lunas
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            disabled={pending}
                            onClick={() => {
                              setRejecting(p);
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

      {/* POLICY */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="size-4 text-muted-foreground" /> Kebijakan pencairan
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Dana dilepas saat pesanan…</Label>
            <div className="flex flex-wrap gap-2">
              <PolicyChoice
                active={releaseOn === "selesai"}
                onClick={() => setReleaseOn("selesai")}
                title="Selesai"
                desc="Pesanan tuntas — aman (disarankan)"
                tone="safe"
              />
              <PolicyChoice
                active={releaseOn === "dikirim"}
                onClick={() => setReleaseOn("dikirim")}
                title="Dikirim"
                desc="Begitu paket berangkat — berisiko"
                tone="danger"
              />
            </div>

            {/* The warning stands next to the choice, not buried in a doc nobody opens. */}
            <div
              className={cn(
                "flex items-start gap-2 rounded-lg border p-3 text-xs",
                releaseOn === "dikirim"
                  ? "border-destructive/40 bg-destructive/5 text-foreground"
                  : "border-amber-500/30 bg-amber-500/5 text-muted-foreground",
              )}
            >
              <TriangleAlert
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  releaseOn === "dikirim" ? "text-destructive" : "text-amber-600 dark:text-amber-400",
                )}
              />
              <span>
                <b>&quot;Dikirim&quot; itu berbahaya.</b> Paket baru bisa <b>diretur setelah dikirim</b> — melepas dana saat
                paket berangkat berarti merchant bisa menarik uang atas barang yang ternyata kembali. Untuk <b>COD</b> lebih
                parah: saat paket berangkat <b>uangnya belum ada</b> — kurir menagih di depan pintu dan menyetorkannya
                beberapa hari kemudian. Yang menomboki selisihnya adalah platform.
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="min-payout">Minimum penarikan (Rp)</Label>
            <Input
              id="min-payout"
              inputMode="numeric"
              className="max-w-[240px] tabular-nums"
              value={minPayout}
              onChange={(e) => setMinPayout(e.target.value.replace(/[^\d]/g, ""))}
            />
            <p className="text-xs text-muted-foreground">
              Merchant tidak bisa menarik di bawah angka ini. Sekarang: <b>{IDR(policy.minPayoutIdr)}</b>.
            </p>
          </div>

          <div className="flex justify-end">
            <Button className="gap-1.5" disabled={pending} onClick={submitPolicy}>
              <Save className="size-4" /> Simpan kebijakan
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* MARK-PAID DIALOG — the reference is optional so a rushed operator is never blocked, but
          asking at the moment of confirmation is the only time the number is at hand (it comes off
          the banking screen they just left). It lands in payouts.note and shows on the merchant's
          /saldo row, so both sides can match it against the bank statement later. */}
      <Dialog open={paying !== null} onOpenChange={(o) => !o && setPaying(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tandai lunas</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{paying?.storeName}</span>
                <span className="font-semibold tabular-nums">{IDR(paying?.amount ?? 0)}</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {paying?.bankName ?? "—"} · <span className="tabular-nums">{paying?.bankAccount ?? "—"}</span>
                {paying?.bankHolder ? <> · a.n. {paying.bankHolder}</> : null}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Konfirmasi bahwa dana <b>sudah ditransfer</b> ke rekening di atas. Merchant akan melihat status{" "}
                <b>Selesai</b> beserta tanggalnya di halaman Saldo.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="pay-ref">No. referensi transfer (opsional)</Label>
              <Input
                id="pay-ref"
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                placeholder="Mis. nomor referensi BI-FAST / berita transfer"
              />
              <p className="text-xs text-muted-foreground">
                Terlihat oleh merchant dan tercatat di audit log — memudahkan pencocokan dengan mutasi rekening bank.
              </p>
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Batal</Button>} />
            <Button disabled={pending} onClick={submitPaid} className="gap-1.5">
              <CircleCheck className="size-4" /> {pending ? "Memproses…" : "Tandai lunas"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* REJECT DIALOG */}
      <Dialog open={rejecting !== null} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tolak pencairan</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{rejecting?.storeName}</span>
                <span className="font-semibold tabular-nums">{IDR(rejecting?.amount ?? 0)}</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Saldo <b>{IDR(rejecting?.amount ?? 0)}</b> akan <b>dikembalikan</b> ke saldo tersedia merchant lewat entri
                penyesuaian baru — entri penarikan yang lama tetap tercatat (buku bersifat append-only).
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="reject-reason">Alasan penolakan</Label>
              <Textarea
                id="reject-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Mis. rekening atas nama berbeda, perlu verifikasi ulang."
              />
              <p className="text-xs text-muted-foreground">Alasan ini terlihat oleh merchant dan tercatat di audit log.</p>
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Batal</Button>} />
            <Button variant="destructive" disabled={pending || !reason.trim()} onClick={submitReject}>
              {pending ? "Memproses…" : "Tolak & kembalikan saldo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PolicyChoice({
  active,
  onClick,
  title,
  desc,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
  tone: "safe" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex min-w-[220px] flex-1 items-start gap-3 rounded-xl border p-3 text-left transition-colors",
        active
          ? tone === "safe"
            ? "border-primary bg-primary/5"
            : "border-destructive bg-destructive/5"
          : "hover:bg-muted/50",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
          active ? (tone === "safe" ? "border-primary" : "border-destructive") : "border-muted-foreground/40",
        )}
      >
        {active && <span className={cn("size-2 rounded-full", tone === "safe" ? "bg-primary" : "bg-destructive")} />}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {title}
          {tone === "danger" && <TriangleAlert className="size-3.5 text-destructive" />}
        </span>
        <span className="block text-xs text-muted-foreground">{desc}</span>
      </span>
    </button>
  );
}
