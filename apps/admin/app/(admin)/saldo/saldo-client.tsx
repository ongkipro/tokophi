"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Wallet, Clock, ArrowDownToLine, Undo2, Landmark, Loader2, Info } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { IDR } from "@/lib/format";
import { OrderStatusBadge } from "@/components/admin/order-status";
import { useCan } from "@/components/admin/permissions";
import { requestPayout, saveBankAccount } from "@/lib/actions/ledger";
import type { Balance, PendingFund, Movement, PayoutRow, PayoutContext } from "@/lib/data/ledger";
import type { OrderStatus } from "@/lib/mock/store";

const dt = (d: Date) =>
  new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(d);

const KIND_LABEL: Record<string, string> = {
  sale: "Penjualan",
  retur: "Retur",
  payout: "Penarikan",
  adjustment: "Penyesuaian",
};

const PAYOUT_LABEL: Record<string, { label: string; cls: string }> = {
  menunggu: { label: "Menunggu", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  diproses: { label: "Diproses", cls: "bg-blue-500/12 text-blue-600 dark:text-blue-400" },
  selesai: { label: "Selesai", cls: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
  gagal: { label: "Gagal", cls: "bg-red-500/12 text-red-600 dark:text-red-400" },
};

export function SaldoClient({
  balance, pending, movements, payouts, ctx,
}: {
  balance: Balance; pending: PendingFund[]; movements: Movement[]; payouts: PayoutRow[]; ctx: PayoutContext;
}) {
  const router = useRouter();
  const canWrite = useCan("settings:write");
  const [busy, start] = React.useTransition();

  const [amount, setAmount] = React.useState("");
  const [bankName, setBankName] = React.useState(ctx.bankName ?? "");
  const [bankAccount, setBankAccount] = React.useState(ctx.bankAccount ?? "");
  const [bankHolder, setBankHolder] = React.useState(ctx.bankHolder ?? "");
  const hasBank = !!(ctx.bankName && ctx.bankAccount);

  const withdraw = () =>
    start(async () => {
      const r = await requestPayout(Number(amount.replace(/\D/g, "")));
      if (r.ok) {
        toast.success("Penarikan diajukan. Dana diproses dalam 1–2 hari kerja.");
        setAmount("");
        router.refresh();
      } else toast.error(r.error ?? "Gagal mengajukan penarikan.");
    });

  const saveBank = () =>
    start(async () => {
      const r = await saveBankAccount({ bankName, bankAccount, bankHolder });
      if (r.ok) {
        toast.success("Rekening disimpan.");
        router.refresh();
      } else toast.error(r.error ?? "Gagal menyimpan rekening.");
    });

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader title="Saldo" desc="Uang hasil penjualan Anda — yang sudah bisa ditarik, dan yang masih tertahan." />

      {/* ── Dua angka yang WAJIB dibedakan ────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-primary/30">
          <CardContent className="space-y-1 pt-5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Wallet className="size-4 text-primary" /> Saldo tersedia
            </div>
            <div className="text-2xl font-semibold tabular-nums">{IDR(balance.available)}</div>
            <p className="text-xs text-muted-foreground">Sudah bisa ditarik ke rekening.</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-1 pt-5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="size-4" /> Dana dalam proses
            </div>
            <div className="text-2xl font-semibold tabular-nums text-muted-foreground">{IDR(balance.pending)}</div>
            <p className="text-xs text-muted-foreground">Menunggu pesanan selesai.</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-1 pt-5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ArrowDownToLine className="size-4" /> Sudah ditarik
            </div>
            <div className="text-2xl font-semibold tabular-nums">{IDR(balance.withdrawn)}</div>
            <p className="text-xs text-muted-foreground">Total pencairan.</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-1 pt-5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Undo2 className="size-4" /> Ditarik kembali (retur)
            </div>
            <div className="text-2xl font-semibold tabular-nums">{IDR(balance.returned)}</div>
            <p className="text-xs text-muted-foreground">Paket yang kembali.</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Tarik saldo ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Landmark className="size-4 text-muted-foreground" /> Tarik saldo
          </CardTitle>
          <CardDescription>
            Minimum {IDR(ctx.minPayout)}. Dana dikirim ke rekening yang terdaftar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasBank ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>Lengkapi rekening bank di bawah sebelum menarik saldo.</span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Rekening: <span className="font-medium text-foreground">{ctx.bankName} · {ctx.bankAccount}</span>{" "}
              a.n. {ctx.bankHolder}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="jumlah">Jumlah penarikan</Label>
              <Input
                id="jumlah"
                inputMode="numeric"
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
                className="tabular-nums"
                disabled={!canWrite || !hasBank}
              />
              <p className="text-xs text-muted-foreground">Tersedia {IDR(balance.available)}.</p>
            </div>
            <div className="flex items-end">
              <Dialog>
                <DialogTrigger
                  render={
                    <Button
                      className="w-full gap-1.5"
                      disabled={!canWrite || !hasBank || busy || !amount || Number(amount) <= 0}
                    >
                      <ArrowDownToLine className="size-4" /> Tarik
                    </Button>
                  }
                />
                <DialogContent className="sm:max-w-md">
                  <DialogHeader><DialogTitle>Tarik saldo?</DialogTitle></DialogHeader>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground">{IDR(Number(amount || 0))}</span> akan dikirim ke{" "}
                    {ctx.bankName} · {ctx.bankAccount} a.n. {ctx.bankHolder}. Penarikan tidak bisa dibatalkan.
                  </p>
                  <DialogFooter>
                    <DialogClose render={<Button variant="outline">Batal</Button>} />
                    <Button onClick={withdraw} disabled={busy}>
                      {busy && <Loader2 className="size-4 animate-spin" />} Ya, tarik
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Rincian ───────────────────────────────────────────────────────── */}
      <Tabs defaultValue="proses">
        <TabsList>
          <TabsTrigger value="proses">Dana dalam proses ({pending.length})</TabsTrigger>
          <TabsTrigger value="mutasi">Mutasi</TabsTrigger>
          <TabsTrigger value="penarikan">Penarikan ({payouts.length})</TabsTrigger>
          <TabsTrigger value="rekening">Rekening</TabsTrigger>
        </TabsList>

        {/* Dana tertahan, PER INVOICE — a lump sum reads as the platform sitting on the seller's
            cash. Showing which order holds which rupiah, and what has to happen to release it, is
            the difference between a ledger and an excuse. */}
        <TabsContent value="proses">
          <Card>
            <CardContent className="p-0">
              {pending.length === 0 ? (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  Tidak ada dana tertahan. Semua pesanan yang dibayar sudah selesai.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Status pesanan</TableHead>
                      <TableHead className="text-right">Jumlah</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pending.map((p) => (
                      <TableRow key={p.orderId}>
                        <TableCell>
                          <Link href={`/pesanan/${p.number}`} className="font-medium hover:underline">
                            {p.number}
                          </Link>
                          {p.isCod && <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-[10px]">COD</Badge>}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{dt(p.placedAt)}</TableCell>
                        <TableCell><OrderStatusBadge status={p.status as OrderStatus} /></TableCell>
                        <TableCell className="text-right tabular-nums">{IDR(p.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mutasi">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Keterangan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Jumlah</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="text-muted-foreground">{dt(m.createdAt)}</TableCell>
                      <TableCell>
                        <span className="font-medium">{KIND_LABEL[m.kind] ?? m.kind}</span>
                        {m.orderNumber && (
                          <Link href={`/pesanan/${m.orderNumber}`} className="ml-2 text-xs text-muted-foreground hover:underline">
                            {m.orderNumber}
                          </Link>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                          {m.status === "available" ? "Tersedia" : "Dalam proses"}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${m.amount < 0 ? "text-red-600 dark:text-red-400" : ""}`}
                      >
                        {m.amount < 0 ? "−" : "+"}
                        {IDR(Math.abs(m.amount))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="penarikan">
          <Card>
            <CardContent className="p-0">
              {payouts.length === 0 ? (
                <p className="p-8 text-center text-sm text-muted-foreground">Belum ada penarikan.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Diajukan</TableHead>
                      <TableHead>Rekening</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Jumlah</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payouts.map((p) => {
                      const s = PAYOUT_LABEL[p.status] ?? { label: p.status, cls: "" };
                      return (
                        <TableRow key={p.id}>
                          <TableCell className="text-muted-foreground">{dt(p.requestedAt)}</TableCell>
                          <TableCell>{p.bankName} · {p.bankAccount}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={`h-5 border-transparent px-1.5 text-[10px] ${s.cls}`}>
                              {s.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{IDR(p.amount)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rekening">
          <Card>
            <CardHeader>
              <CardTitle>Rekening pencairan</CardTitle>
              <CardDescription>Saldo hanya bisa ditarik ke rekening atas nama pemilik toko.</CardDescription>
            </CardHeader>
            <CardContent className="grid max-w-xl gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="bank">Nama bank</Label>
                <Input id="bank" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="BCA" disabled={!canWrite} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rek">Nomor rekening</Label>
                <Input id="rek" inputMode="numeric" value={bankAccount} onChange={(e) => setBankAccount(e.target.value.replace(/\D/g, ""))} className="tabular-nums" disabled={!canWrite} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="an">Nama pemilik rekening</Label>
                <Input id="an" value={bankHolder} onChange={(e) => setBankHolder(e.target.value)} disabled={!canWrite} />
              </div>
              {canWrite && (
                <div className="flex justify-end">
                  <Button onClick={saveBank} disabled={busy}>
                    {busy && <Loader2 className="size-4 animate-spin" />} Simpan rekening
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
