"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDownToLine, ChevronDown, Clock, Info, Landmark, Loader2, Undo2, Wallet } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Separator } from "@tokophi/ui/separator";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Badge } from "@tokophi/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@tokophi/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@tokophi/ui/table";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@tokophi/ui/dialog";
import { IDR } from "@tokophi/lib/format";
import { DateTimeCell } from "@/components/admin/date-time-cell";
import { OrderStatusBadge } from "@/components/admin/order-status";
import { useCan } from "@/components/admin/permissions";
import { InvoiceDialog } from "@/components/admin/saldo/invoice-dialog";
import { SaldoFilters } from "@/components/admin/saldo/saldo-filters";
import { SaldoPager } from "@/components/admin/saldo/saldo-pager";
import { useSaldoUrl } from "@/components/admin/saldo/use-saldo-url";
import { fetchInvoiceDetail, requestPayout, saveBankAccount } from "@/lib/actions/ledger";
import type {
  Balance,
  InvoiceDetail,
  LedgerCounts,
  LedgerFilters,
  Movement,
  Paged,
  PayoutContext,
  PayoutRow,
  PendingFund,
  SaldoTab,
} from "@/lib/data/ledger";
import type { OrderStatus } from "@/lib/mock/store";

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

/** A ledger row's status in the merchant's words — `payout` rows are stored as `available`. */
function movementStatus(m: Movement): { label: string; cls: string } {
  if (m.kind === "payout") return { label: "Sudah ditarik", cls: "bg-blue-500/12 text-blue-600 dark:text-blue-400" };
  if (m.status === "pending") return { label: "Dalam proses", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" };
  return { label: "Belum ditarik", cls: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" };
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="p-10 text-center text-sm text-muted-foreground">{children}</p>;
}

function MoneyRow({ label, value, muted, strong }: { label: string; value: string; muted?: boolean; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "text-sm font-semibold" : "text-sm"} ${muted ? "text-muted-foreground" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/** The order behind a Mutasi row, unfolded INLINE under it: what the buyer bought and the money
 *  breakdown (produk → ongkir → diskon → total). Fetched on expand, so it can be loading or absent. */
function MovementDetail({ number, detail, loading }: { number: string | null; detail: InvoiceDetail | null | undefined; loading: boolean }) {
  if (loading || detail === undefined) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Memuat rincian…
      </div>
    );
  }
  if (!detail) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Rincian pesanan tidak ditemukan.</p>;
  }
  return (
    <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
      {/* Isi pesanan */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Isi pesanan</p>
        <ul className="space-y-1.5">
          {detail.lines.map((l) => (
            <li key={l.id} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{l.product}</span>
                {l.variant && <span className="text-muted-foreground"> · {l.variant}</span>}
                <span className="text-muted-foreground"> × {l.qty}</span>
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{IDR(l.total)}</span>
            </li>
          ))}
          {detail.lines.length === 0 && <li className="text-sm text-muted-foreground">Tidak ada item tercatat.</li>}
        </ul>
        {detail.customer && (
          <p className="pt-1 text-xs text-muted-foreground">
            Pembeli: {detail.customer}
            {detail.courier && <> · {detail.courier}</>}
          </p>
        )}
      </div>
      {/* Rincian dana */}
      <div className="space-y-1.5 sm:border-l sm:pl-4">
        <MoneyRow label="Subtotal produk" value={IDR(detail.subtotal)} muted />
        {detail.discount > 0 && <MoneyRow label="Diskon" value={`− ${IDR(detail.discount)}`} muted />}
        <MoneyRow label="Ongkos kirim" value={detail.shipping === 0 ? "Gratis" : IDR(detail.shipping)} muted />
        <Separator className="my-1.5" />
        <MoneyRow label="Total pesanan" value={IDR(detail.total)} strong />
        <div className="pt-1.5">
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/pesanan/${number ?? detail.number}`} />}>
            Buka pesanan
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SaldoClient({
  balance,
  counts,
  ctx,
  tab,
  filters,
  movements,
  pending,
  payouts,
}: {
  balance: Balance;
  counts: LedgerCounts;
  ctx: PayoutContext;
  tab: SaldoTab | "rekening";
  filters: LedgerFilters;
  movements: Paged<Movement> | null;
  pending: Paged<PendingFund> | null;
  payouts: Paged<PayoutRow> | null;
}) {
  const router = useRouter();
  const { filter } = useSaldoUrl();
  const canWrite = useCan("settings:write");
  const [busy, start] = React.useTransition();

  const [amount, setAmount] = React.useState("");
  const [bankName, setBankName] = React.useState(ctx.bankName ?? "");
  const [bankAccount, setBankAccount] = React.useState(ctx.bankAccount ?? "");
  const [bankHolder, setBankHolder] = React.useState(ctx.bankHolder ?? "");
  const hasBank = !!(ctx.bankName && ctx.bankAccount);

  // Which held invoice the merchant opened. The dialog opens immediately (spinner) and the row's
  // detail is fetched in the same click — an effect would just re-render the tree to say "now go".
  const [invoice, setInvoice] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<InvoiceDetail | null>(null);
  const [loadingInvoice, setLoadingInvoice] = React.useState(false);

  const openInvoice = async (orderId: string, number: string) => {
    setInvoice(number);
    setDetail(null);
    setLoadingInvoice(true);
    try {
      setDetail(await fetchInvoiceDetail(orderId));
    } catch {
      toast.error("Gagal memuat rincian invoice.");
    } finally {
      setLoadingInvoice(false);
    }
  };

  // Mutasi rows expand INLINE (accordion) rather than opening the dialog: click a sale row → its
  // order detail unfolds in a row right below it; click again to hide. One open at a time. The
  // detail is fetched on first expand and cached per order so re-opening is instant.
  const [expandedOrder, setExpandedOrder] = React.useState<string | null>(null);
  const [rowDetail, setRowDetail] = React.useState<Record<string, InvoiceDetail | null>>({});
  const [rowLoading, setRowLoading] = React.useState<string | null>(null);
  const toggleRow = async (orderId: string) => {
    if (expandedOrder === orderId) {
      setExpandedOrder(null);
      return;
    }
    setExpandedOrder(orderId);
    if (rowDetail[orderId] === undefined) {
      setRowLoading(orderId);
      try {
        const d = await fetchInvoiceDetail(orderId);
        setRowDetail((prev) => ({ ...prev, [orderId]: d }));
      } catch {
        toast.error("Gagal memuat rincian pesanan.");
        setRowDetail((prev) => ({ ...prev, [orderId]: null }));
      } finally {
        setRowLoading(null);
      }
    }
  };

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
            <p className="text-xs text-muted-foreground">
              Menunggu {counts.pending} pesanan selesai.{" "}
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() => filter({ tab: "proses" })}
              >
                Lihat rincian
              </button>
            </p>
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
          <CardDescription>Minimum {IDR(ctx.minPayout)}. Dana dikirim ke rekening yang terdaftar.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasBank ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                Lengkapi rekening bank di tab{" "}
                <button type="button" className="font-medium text-primary hover:underline" onClick={() => filter({ tab: "rekening" })}>
                  Rekening
                </button>{" "}
                sebelum menarik saldo.
              </span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Rekening:{" "}
              <span className="font-medium text-foreground">
                {ctx.bankName} · {ctx.bankAccount}
              </span>{" "}
              a.n. {ctx.bankHolder}
            </p>
          )}

          {/* Was a 3-column grid with the input at col-span-2: on this full-width card that gave a
              rupiah field ~1000px of runway, and the button — aligned `items-end` against a cell that
              also held the "Tersedia" helper — sat BELOW the input instead of beside it. A money input
              does not get wider because the page is; it gets as wide as the biggest number it takes.
              Label on top, input+button on one line (input capped), helper under BOTH — so nothing
              needs an alignment hack to line up. */}
          <div>
            <Label htmlFor="jumlah">Jumlah penarikan</Label>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                id="jumlah"
                inputMode="numeric"
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
                className="tabular-nums sm:max-w-[15rem]"
                disabled={!canWrite || !hasBank}
              />
            <div className="shrink-0">
              <Dialog>
                <DialogTrigger
                  render={
                    <Button
                      className="w-full gap-1.5 sm:w-auto"
                      disabled={!canWrite || !hasBank || busy || !amount || Number(amount) <= 0}
                    >
                      <ArrowDownToLine className="size-4" /> Tarik
                    </Button>
                  }
                />
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Tarik saldo?</DialogTitle>
                  </DialogHeader>
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
            {/* Under BOTH controls now, not inside the input's old grid cell — that placement is what
                dragged the button's `items-end` baseline down past the input. */}
            <p className="mt-1.5 text-xs text-muted-foreground">Tersedia {IDR(balance.available)}.</p>
          </div>
        </CardContent>
      </Card>

      {/* ── Rincian ───────────────────────────────────────────────────────────
          Tab / periode / status / halaman all live in the URL, so every list below is paged and
          filtered IN SQL. The tab counts are deliberately unfiltered totals — they are landmarks,
          and a landmark that moves when you filter is not a landmark. */}
      <Tabs value={tab} onValueChange={(v) => filter({ tab: String(v) })}>
        {/* These four labels carry counts, so they are ~452px wide and overflowed every real phone
            (audit:responsive: 360/390/414 by 108/78/54px). Squeezing them would shred the labels; a
            landmark you cannot read is not a landmark. So the strip SCROLLS instead — the same rule
            the storefront's gallery uses, and the reason the audit excuses horizontal scrollers.
            `-mx-4 px-4` lets it bleed to the screen edge on mobile so the scroll reads as intentional. */}
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            <TabsTrigger value="mutasi">Mutasi ({counts.movements})</TabsTrigger>
            <TabsTrigger value="proses">Dana dalam proses ({counts.pending})</TabsTrigger>
            <TabsTrigger value="penarikan">Penarikan ({counts.payouts})</TabsTrigger>
            <TabsTrigger value="rekening">Rekening</TabsTrigger>
          </TabsList>
        </div>

        {/* Mutasi — the full book. */}
        <TabsContent value="mutasi">
          {movements && (
            <Card>
              <CardContent className="space-y-3 p-0">
                <div className="px-4 pt-4">
                  <SaldoFilters tab="mutasi" filters={filters} total={movements.total} />
                </div>
                {movements.total === 0 ? (
                  <Empty>Tidak ada mutasi pada filter ini.</Empty>
                ) : (
                  <>
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
                        {movements.rows.map((m) => {
                          const s = movementStatus(m);
                          const canExpand = !!m.orderId;
                          const isOpen = expandedOrder === m.orderId;
                          return (
                            <React.Fragment key={m.id}>
                              <TableRow
                                className={canExpand ? "cursor-pointer" : undefined}
                                data-state={isOpen ? "selected" : undefined}
                                onClick={canExpand ? () => toggleRow(m.orderId!) : undefined}
                              >
                                <TableCell className="py-3.5 text-muted-foreground"><DateTimeCell value={m.createdAt} /></TableCell>
                                <TableCell>
                                  <span className="font-medium">{KIND_LABEL[m.kind] ?? m.kind}</span>
                                  {m.orderNumber && (
                                    <span className="ml-2 font-mono text-xs text-muted-foreground">{m.orderNumber}</span>
                                  )}
                                  {canExpand && (
                                    <ChevronDown className={`ml-1.5 inline size-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                                  )}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="secondary" className={`h-5 border-transparent px-1.5 text-[10px] ${s.cls}`}>
                                    {s.label}
                                  </Badge>
                                </TableCell>
                                <TableCell
                                  className={`text-right tabular-nums ${m.amount < 0 ? "text-red-600 dark:text-red-400" : ""}`}
                                >
                                  {m.amount < 0 ? "−" : "+"}
                                  {IDR(Math.abs(m.amount))}
                                </TableCell>
                              </TableRow>
                              {isOpen && (
                                <TableRow className="hover:bg-transparent">
                                  <TableCell colSpan={4} className="bg-muted/30 p-0">
                                    <MovementDetail
                                      number={m.orderNumber}
                                      detail={m.orderId ? rowDetail[m.orderId] : null}
                                      loading={rowLoading === m.orderId}
                                    />
                                  </TableCell>
                                </TableRow>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
                    <SaldoPager
                      page={movements.page}
                      pageCount={movements.pageCount}
                      total={movements.total}
                      unit="mutasi"
                    />
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Dana tertahan, PER INVOICE — a lump sum reads as the platform sitting on the seller's
            cash. Showing which order holds which rupiah, who is waiting for it, and what has to
            happen to release it, is the difference between a ledger and an excuse. */}
        <TabsContent value="proses">
          {pending && (
            <Card>
              <CardContent className="space-y-3 p-0">
                <div className="px-4 pt-4">
                  <SaldoFilters tab="proses" filters={filters} total={pending.total} />
                </div>
                {pending.total === 0 ? (
                  <Empty>Tidak ada dana tertahan pada filter ini.</Empty>
                ) : (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice</TableHead>
                          <TableHead>Pembeli</TableHead>
                          <TableHead>Tanggal</TableHead>
                          <TableHead>Status pesanan</TableHead>
                          <TableHead className="text-right">Jumlah</TableHead>
                          <TableHead className="w-0" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pending.rows.map((p) => (
                          <TableRow key={p.orderId}>
                            <TableCell>
                              <button
                                type="button"
                                className="font-mono font-medium hover:underline"
                                onClick={() => openInvoice(p.orderId, p.number)}
                              >
                                {p.number}
                              </button>
                              {p.isCod && (
                                <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-[10px]">
                                  COD
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="font-medium">{p.customer ?? "—"}</div>
                              <div className="text-xs text-muted-foreground">{p.city ?? "—"}</div>
                            </TableCell>
                            <TableCell className="py-3.5 text-muted-foreground"><DateTimeCell value={p.placedAt} /></TableCell>
                            <TableCell>
                              <OrderStatusBadge status={p.status as OrderStatus} />
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{IDR(p.amount)}</TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="sm" onClick={() => openInvoice(p.orderId, p.number)}>
                                Rincian
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <SaldoPager page={pending.page} pageCount={pending.pageCount} total={pending.total} unit="invoice" />
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="penarikan">
          {payouts && (
            <Card>
              <CardContent className="space-y-3 p-0">
                <div className="px-4 pt-4">
                  <SaldoFilters tab="penarikan" filters={filters} total={payouts.total} />
                </div>
                {payouts.total === 0 ? (
                  <Empty>Belum ada penarikan pada filter ini.</Empty>
                ) : (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Diajukan</TableHead>
                          <TableHead>Cair</TableHead>
                          <TableHead>Rekening</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Jumlah</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {payouts.rows.map((p) => {
                          const s = PAYOUT_LABEL[p.status] ?? { label: p.status, cls: "" };
                          return (
                            <TableRow key={p.id}>
                              <TableCell className="py-3.5 text-muted-foreground">
                                <DateTimeCell value={p.requestedAt} />
                              </TableCell>
                              <TableCell className="py-3.5 text-muted-foreground">
                                {p.paidAt ? <DateTimeCell value={p.paidAt} /> : "—"}
                              </TableCell>
                              <TableCell>
                                <div className="font-medium">
                                  {p.bankName} · <span className="tabular-nums">{p.bankAccount}</span>
                                </div>
                                {p.bankHolder && <div className="text-xs text-muted-foreground">a.n. {p.bankHolder}</div>}
                              </TableCell>
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
                    <SaldoPager
                      page={payouts.page}
                      pageCount={payouts.pageCount}
                      total={payouts.total}
                      unit="penarikan"
                    />
                  </>
                )}
              </CardContent>
            </Card>
          )}
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
                <Input
                  id="bank"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="BCA"
                  disabled={!canWrite}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rek">Nomor rekening</Label>
                <Input
                  id="rek"
                  inputMode="numeric"
                  value={bankAccount}
                  onChange={(e) => setBankAccount(e.target.value.replace(/\D/g, ""))}
                  className="tabular-nums"
                  disabled={!canWrite}
                />
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

      <InvoiceDialog
        number={invoice}
        data={detail}
        loading={loadingInvoice}
        open={!!invoice}
        onOpenChange={(v) => !v && setInvoice(null)}
      />
    </div>
  );
}
