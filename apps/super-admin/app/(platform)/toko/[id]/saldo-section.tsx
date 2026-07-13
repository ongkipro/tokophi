"use client";

/**
 * Saldo & Transaksi — the PLATFORM's window into one merchant's money.
 *
 * Read-only on purpose. Approving/rejecting a withdrawal happens in /pencairan (the operator's
 * queue); this section exists to MONITOR: is this store's money adding up, is it stuck, is it
 * bleeding out through returns. Every number here is derived from `ledger_entries` with the exact
 * formulas the merchant's own /saldo uses, so the two surfaces can never disagree.
 */

import Link from "next/link";
import {
  Wallet, Clock, Banknote, Undo2, ArrowRight, Landmark, TriangleAlert, CircleCheck,
  ChevronLeft, ChevronRight, ReceiptText,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Badge } from "@tokophi/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@tokophi/ui/table";
import { cn } from "@tokophi/ui/lib/utils";
import { IDR, num } from "@tokophi/lib/format";

import type { StoreBalance, StoreMovement, StorePayout, StoreMoneySignals } from "@/lib/data";

const KIND_UI: Record<string, { label: string; cls: string }> = {
  sale: { label: "Penjualan", cls: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
  retur: { label: "Retur", cls: "bg-destructive/12 text-destructive" },
  payout: { label: "Penarikan", cls: "bg-sky-500/12 text-sky-600 dark:text-sky-400" },
  adjustment: { label: "Penyesuaian", cls: "bg-amber-500/12 text-amber-600 dark:text-amber-400" },
};
const LEDGER_STATUS_UI: Record<string, { label: string; cls: string }> = {
  available: { label: "Tersedia", cls: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
  pending: { label: "Dalam proses", cls: "bg-amber-500/12 text-amber-600 dark:text-amber-400" },
};
const PAYOUT_STATUS_UI: Record<StorePayout["status"], { label: string; cls: string }> = {
  menunggu: { label: "Menunggu", cls: "bg-amber-500/12 text-amber-600 dark:text-amber-400" },
  diproses: { label: "Diproses", cls: "bg-sky-500/12 text-sky-600 dark:text-sky-400" },
  selesai: { label: "Selesai", cls: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
  gagal: { label: "Ditolak", cls: "bg-destructive/12 text-destructive" },
};

const rate = (r: number) => `${(r * 100).toFixed(1)}%`;
const dateShort = (d: Date) => d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "2-digit" });
const dateTime = (d: Date) =>
  `${d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "2-digit" })} ${d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`;

// Pagination arrow: a real <a> when it goes somewhere, a disabled native <button> at the edges
// (Base UI logs a console.error if an anchor is rendered as a native button).
function PageButton({ href, disabled, label, children }: { href: string; disabled: boolean; label: string; children: React.ReactNode }) {
  if (disabled) {
    return (
      <Button variant="outline" size="icon-sm" aria-label={label} disabled>
        {children}
      </Button>
    );
  }
  return (
    <Button variant="outline" size="icon-sm" aria-label={label} nativeButton={false} render={<Link href={href} scroll={false} />}>
      {children}
    </Button>
  );
}

type Signal = { tone: "danger" | "warn" | "ok"; title: string; detail: string };

/** Only signals we can actually PROVE from rows — no invented risk score. */
function buildSignals(s: StoreMoneySignals, b: StoreBalance): Signal[] {
  const out: Signal[] = [];

  // 1. Idle balance — withdrawable money that has never been taken.
  if (s.neverWithdrawn) {
    out.push({
      tone: "warn",
      title: `Saldo ${IDR(b.available)} belum pernah dicairkan`,
      detail: `Di atas minimum penarikan (${IDR(s.minPayout)}) dan tidak ada satu pun pencairan berstatus selesai${s.idleDays !== null ? ` — dana tertua sudah ${num(s.idleDays)} hari tersedia` : ""}. Merchant mungkin tersangkut (rekening belum diisi / tidak menemukan tombolnya), atau tokonya dorman.`,
    });
  } else if (s.lastPaidAt) {
    out.push({
      tone: "ok",
      title: `Pencairan terakhir ${dateShort(s.lastPaidAt)}`,
      detail: `Total sudah dicairkan ${IDR(b.withdrawn)}. Alur penarikan toko ini berjalan normal.`,
    });
  }

  // 2. Return rate vs the platform baseline (a rate alone means nothing).
  if (s.shippedOrders > 0) {
    const hot = s.returRate > 0 && s.returRate >= Math.max(0.05, s.platformReturRate * 1.5);
    out.push({
      tone: hot ? "danger" : "ok",
      title: `Rasio retur ${rate(s.returRate)} (90 hari)`,
      detail: `${num(s.returOrders)} retur dari ${num(s.shippedOrders)} pesanan terkirim. Rata-rata platform: ${rate(s.platformReturRate)}.${hot ? " Jauh di atas baseline — periksa kualitas produk / deskripsi." : ""}`,
    });
  }

  // 3. Refund spike — two amounts, not a verdict.
  if (s.returLast30 > 0 || s.returPrev30 > 0) {
    const up = s.returLast30 > s.returPrev30;
    out.push({
      tone: up && s.returLast30 >= s.returPrev30 * 2 ? "danger" : up ? "warn" : "ok",
      title: `Retur 30 hari terakhir ${IDR(s.returLast30)} (${num(s.returCountLast30)} entri)`,
      detail: `30 hari sebelumnya ${IDR(s.returPrev30)}. ${up ? "Naik" : "Turun/stabil"} — uang yang ditarik kembali dari saldo merchant.`,
    });
  }

  // 4. Rejected withdrawals — each one was refused by a human, for a reason.
  if (s.failedPayouts > 0) {
    out.push({
      tone: s.failedPayouts >= 2 ? "danger" : "warn",
      title: `${num(s.failedPayouts)} pencairan ditolak`,
      detail: "Penolakan berarti ada yang tidak beres saat verifikasi (mis. nama rekening tidak cocok). Lihat alasannya di Riwayat pencairan di bawah.",
    });
  }

  // Cancellations — the seed niche has no returns yet; a merchant cancelling their own orders is the
  // same class of problem and is computable from `orders.status = 'batal'`.
  if (s.totalOrders > 0 && s.cancelRate >= 0.05) {
    out.push({
      tone: s.cancelRate >= 0.1 ? "warn" : "ok",
      title: `Pembatalan ${rate(s.cancelRate)} (90 hari)`,
      detail: `${num(s.cancelledOrders)} dari ${num(s.totalOrders)} pesanan dibatalkan — pesanan batal tidak pernah menjadi saldo.`,
    });
  }

  if (s.openPayouts > 0) {
    out.push({
      tone: "warn",
      title: `${num(s.openPayouts)} permintaan pencairan menunggu kita`,
      detail: "Saldo merchant sudah dipotong sejak permintaan dibuat. Proses di halaman Pencairan.",
    });
  }

  return out;
}

const TONE: Record<Signal["tone"], { cls: string; icon: typeof TriangleAlert }> = {
  danger: { cls: "text-destructive", icon: TriangleAlert },
  warn: { cls: "text-amber-600 dark:text-amber-400", icon: TriangleAlert },
  ok: { cls: "text-emerald-600 dark:text-emerald-400", icon: CircleCheck },
};

export function SaldoSection({
  storeId,
  balance,
  movements,
  payouts,
  signals,
}: {
  storeId: string;
  balance: StoreBalance;
  movements: { rows: StoreMovement[]; total: number; page: number; pages: number };
  payouts: StorePayout[];
  signals: StoreMoneySignals;
}) {
  const cards = [
    { label: "Saldo tersedia", value: IDR(balance.available), hint: "Bisa ditarik merchant", icon: Wallet, tint: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
    { label: "Dana dalam proses", value: IDR(balance.pending), hint: "Tertahan sampai pesanan selesai", icon: Clock, tint: "bg-amber-500/12 text-amber-600 dark:text-amber-400" },
    { label: "Total sudah dicairkan", value: IDR(balance.withdrawn), hint: "Seluruh penarikan tercatat", icon: Banknote, tint: "bg-sky-500/12 text-sky-600 dark:text-sky-400" },
    { label: "Ditarik kembali (retur)", value: IDR(balance.returned), hint: "Dipotong dari saldo karena retur", icon: Undo2, tint: "bg-destructive/12 text-destructive" },
  ];
  const items = buildSignals(signals, balance);
  const { page, pages, total, rows } = movements;
  const href = (p: number) => `/toko/${storeId}?tx=${p}#transaksi`;

  return (
    <div id="transaksi" className="space-y-5 scroll-mt-20">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Saldo &amp; transaksi</h2>
          <p className="text-sm text-muted-foreground">
            Angka yang sama persis dengan yang dilihat merchant di halaman Saldo — diturunkan dari buku besar, bukan disimpan.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" nativeButton={false} render={<Link href="/pencairan" />}>
          Antrian pencairan <ArrowRight className="size-4" />
        </Button>
      </div>

      {/* BALANCE */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="flex items-center gap-3">
              <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", c.tint)}>
                <c.icon className="size-5" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-xs text-muted-foreground">{c.label}</div>
                <div className="truncate text-lg font-bold tabular-nums">{c.value}</div>
                <div className="truncate text-xs text-muted-foreground">{c.hint}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* MONITORING SIGNALS — each one traceable to a query, no invented score */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TriangleAlert className="size-4 text-muted-foreground" /> Sinyal pemantauan
          </CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada pergerakan uang di toko ini.</p>
          ) : (
            <ul className="divide-y">
              {items.map((s) => {
                const Icon = TONE[s.tone].icon;
                return (
                  <li key={s.title} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <Icon className={cn("mt-0.5 size-4 shrink-0", TONE[s.tone].cls)} />
                    <div className="min-w-0">
                      <div className={cn("text-sm font-medium", s.tone !== "ok" && TONE[s.tone].cls)}>{s.title}</div>
                      <div className="text-xs text-muted-foreground">{s.detail}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* LEDGER */}
        <Card className="gap-0 py-0 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
            <div className="flex items-center gap-2 font-semibold">
              <ReceiptText className="size-4 text-muted-foreground" /> Log transaksi
              <span className="text-xs font-normal text-muted-foreground">({num(total)} entri)</span>
            </div>
            {pages > 1 && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <PageButton href={href(page - 1)} disabled={page <= 1} label="Halaman sebelumnya">
                  <ChevronLeft className="size-4" />
                </PageButton>
                <span className="tabular-nums">
                  Hal. {num(page)}/{num(pages)}
                </span>
                <PageButton href={href(page + 1)} disabled={page >= pages} label="Halaman berikutnya">
                  <ChevronRight className="size-4" />
                </PageButton>
              </div>
            )}
          </div>
          {rows.length === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">Belum ada transaksi.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Jenis</TableHead>
                    <TableHead>Pesanan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Jumlah</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((m) => {
                    const k = KIND_UI[m.kind] ?? { label: m.kind, cls: "bg-muted text-muted-foreground" };
                    const st = LEDGER_STATUS_UI[m.status] ?? { label: m.status, cls: "bg-muted text-muted-foreground" };
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground tabular-nums">
                          {dateTime(m.createdAt)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={cn("border-transparent", k.cls)}>{k.label}</Badge>
                          {!m.orderNumber && m.note && (
                            <div className="mt-0.5 max-w-[30ch] truncate text-xs text-muted-foreground" title={m.note}>
                              {m.note}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{m.orderNumber ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={cn("border-transparent", st.cls)}>{st.label}</Badge>
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-semibold tabular-nums",
                            m.amount < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400",
                          )}
                        >
                          {m.amount < 0 ? "−" : "+"}
                          {IDR(Math.abs(m.amount))}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>

        {/* PAYOUT HISTORY */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Landmark className="size-4 text-muted-foreground" /> Riwayat pencairan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-0">
            {payouts.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">Toko ini belum pernah meminta pencairan.</p>
            ) : (
              payouts.map((p, i) => (
                <div key={p.id} className={cn("py-3", i > 0 && "border-t")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold tabular-nums">{IDR(p.amount)}</span>
                    <Badge variant="secondary" className={cn("border-transparent", PAYOUT_STATUS_UI[p.status].cls)}>
                      {PAYOUT_STATUS_UI[p.status].label}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {p.bankName ?? "—"} · <span className="tabular-nums">{p.bankAccount ?? "—"}</span>
                    {p.bankHolder ? ` · ${p.bankHolder}` : ""}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Diminta {dateShort(p.requestedAt)}
                    {p.paidAt ? ` · lunas ${dateShort(p.paidAt)}` : ""}
                  </div>
                  {p.status === "gagal" && p.note && (
                    <div className="mt-1 text-xs text-destructive">Alasan: {p.note}</div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
