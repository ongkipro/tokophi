"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Download, MoreHorizontal, PackageCheck, Eye, XCircle, CheckCircle2, Info, AlertTriangle } from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { OrderStatusBadge } from "@/components/admin/order-status";
import { useCan } from "@/components/admin/permissions";
import { ReturnSummary, type CourierReturnRow } from "@/components/admin/pesanan/return-summary";
import { OrderFilters, type OrderFiltersValue } from "@/components/admin/pesanan/order-filters";
import { OrderProductCell } from "@/components/admin/pesanan/order-product-cell";
import { setOrderStatus } from "@/lib/actions/orders";
import { IDR, num, timeAgo } from "@tokophi/lib/format";
import { exportCsv } from "@/lib/csv";
import {
  ORDER_TABS,
  PAYMENT_METHOD_LABEL,
  type OrderListResult,
  type OrderListRow,
  type OrderTab,
} from "@/components/admin/pesanan/order-list-types";

import { Card } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Badge } from "@tokophi/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@tokophi/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@tokophi/ui/tabs";
import { TabStrip } from "@/components/admin/tab-strip";
import { ResponsiveTable, DataCard, DataRow } from "@/components/admin/responsive-table";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@tokophi/ui/dropdown-menu";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@tokophi/ui/pagination";

export function PesananClient({
  list,
  tab,
  filters,
  returns,
}: {
  list: OrderListResult;
  tab: OrderTab;
  filters: OrderFiltersValue;
  returns: CourierReturnRow[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const canWrite = useCan("orders:write");

  const { rows, counts, total, page, pageCount, pageSize, couriers, methods } = list;

  // Every control writes the URL; the server re-runs the query. Nothing is filtered in the browser.
  function go(next: Record<string, string | number | undefined>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === "" || v === 0) sp.delete(k);
      else sp.set(k, String(v));
    }
    if (!("page" in next)) sp.delete("page"); // any filter change resets to page 1
    const qs = sp.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  function advance(o: OrderListRow, to: "diproses" | "dikirim" | "selesai" | "batal", label: string) {
    startTransition(async () => {
      await setOrderStatus(o.id, to);
      toast.success(`${o.id} — ${label}`);
      router.refresh();
    });
  }

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader title="Pesanan Saya" desc="Kelola pesanan yang masuk dan status pengirimannya.">
        <Button
          variant="outline"
          className="gap-2"
          onClick={() =>
            exportCsv(
              "pesanan",
              rows.map((o) => ({
                No: o.id,
                Pembeli: o.buyer,
                Produk: o.lines.map((l) => `${l.title}${l.variant ? ` (${l.variant})` : ""} x${l.qty}`).join(" | "),
                Total: o.total,
                Metode: o.paymentMethod ? (PAYMENT_METHOD_LABEL[o.paymentMethod] ?? o.paymentMethod) : "",
                Status: o.status,
                "Jasa Kirim": o.courier ?? "",
                Resi: o.awb ?? "",
              })),
            )
          }
        >
          {/* exports what is on screen — the rest of the list lives on the server, and pretending
              otherwise would hand the merchant a file that does not match what they were looking at */}
          <Download className="size-4" /> Ekspor halaman
        </Button>
      </PageHeader>

      {/* Status tabs. Counts are count(*) group by, computed on the server against the SAME filters
          as the table below — so a badge can never promise rows the table does not have. */}
      <Tabs value={tab} onValueChange={(v) => go({ tab: v === "semua" ? undefined : (v as string) })}>
        {/* Was `h-9 flex-wrap`: the height was pinned to ONE row while six counted labels took three
            on a phone, so rows 2-3 rendered on top of the toolbar below. Scrolls now — see TabStrip. */}
        <TabStrip>
          <TabsList className="w-max">
            {ORDER_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="gap-1.5 px-2.5">
                {t.label}
                <span className="rounded-full bg-muted-foreground/15 px-1.5 py-px text-[11px] font-medium tabular-nums text-muted-foreground group-data-[variant=default]/tabs-list:data-active:bg-primary/15 group-data-[variant=default]/tabs-list:data-active:text-primary">
                  {num(counts[t.value])}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </TabStrip>
      </Tabs>

      <Card className="overflow-hidden p-0">
        <OrderFilters
          value={filters}
          couriers={couriers}
          methods={methods}
          pending={pending}
          onApply={(next) => {
            const m = { ...filters, ...next }; // merge — a courier click must not clear the search
            go({ field: m.field === "no" ? undefined : m.field, q: m.q, kurir: m.courier, bayar: m.method });
          }}
          onReset={() => go({ field: undefined, q: undefined, kurir: undefined, bayar: undefined })}
        />

        <div data-pending={pending ? "" : undefined} className="transition-opacity data-pending:opacity-60">
          <ResponsiveTable
            table={
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[34%] pl-4">Produk</TableHead>
                  <TableHead>Pembeli</TableHead>
                  <TableHead className="text-right">Dibayar Pembeli</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Jasa Kirim</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={6} className="h-40 whitespace-normal text-center text-muted-foreground">
                      <EmptyState tab={tab} filtered={Boolean(filters.q || filters.courier || filters.method)} />
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((o) => (
                  <TableRow key={o.id} className="align-top">
                    <TableCell className="py-3 pl-4">
                      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <Link href={`/pesanan/${o.number}`} className="font-mono font-medium text-foreground hover:underline">
                          {o.id}
                        </Link>
                        <span aria-hidden>·</span>
                        <span>{timeAgo(o.minutesAgo)}</span>
                      </div>
                      <OrderProductCell lines={o.lines} lineCount={o.lineCount} />
                    </TableCell>

                    <TableCell className="py-3">
                      <div className="leading-tight">
                        <div className="text-sm font-medium">{o.buyer}</div>
                        <div className="text-xs text-muted-foreground">{o.city || "—"}</div>
                      </div>
                    </TableCell>

                    <TableCell className="py-3 text-right">
                      <div className="text-sm font-medium tabular-nums">{IDR(o.total)}</div>
                      <div className="text-xs text-muted-foreground">
                        {o.paymentMethod ? (PAYMENT_METHOD_LABEL[o.paymentMethod] ?? o.paymentMethod) : "Tanpa pembayaran"}
                      </div>
                      {!o.paid && (
                        <Badge variant="secondary" className="mt-1 border-0 bg-amber-500/15 font-medium text-amber-700 dark:text-amber-400">
                          Belum dibayar
                        </Badge>
                      )}
                    </TableCell>

                    <TableCell className="py-3">
                      <OrderStatusBadge status={o.status} />
                    </TableCell>

                    <TableCell className="py-3">
                      {o.courier ? (
                        <div className="leading-tight">
                          <div className="text-sm">{o.courier}</div>
                          {o.awb && <div className="font-mono text-xs text-muted-foreground">{o.awb}</div>}
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">Belum diatur</span>
                      )}
                      <ProblemBadge o={o} />
                    </TableCell>

                    <TableCell className="py-3">
                      <div className="flex items-center justify-end gap-1">
                        <RowAction o={o} canWrite={canWrite} pending={pending} onAdvance={advance} />
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button variant="ghost" size="icon-sm" aria-label={`Aksi ${o.id}`}>
                                <MoreHorizontal className="size-4" />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem render={<Link href={`/pesanan/${o.number}`} />}>
                              <Eye className="size-4" /> Lihat detail
                            </DropdownMenuItem>
                            {canWrite && o.status !== "batal" && o.status !== "selesai" && o.status !== "retur" && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  disabled={pending}
                                  onClick={() => advance(o, "batal", "dibatalkan")}
                                >
                                  <XCircle className="size-4" /> Batalkan
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            }
            cards={
              rows.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                  <EmptyState tab={tab} filtered={Boolean(filters.q || filters.courier || filters.method)} />
                </div>
              ) : (
                rows.map((o) => (
                  <DataCard
                    key={o.id}
                    href={`/pesanan/${o.number}`}
                    title={<span className="truncate font-mono text-sm font-medium">{o.id}</span>}
                    meta={timeAgo(o.minutesAgo)}
                    badge={<OrderStatusBadge status={o.status} />}
                    actions={<RowAction o={o} canWrite={canWrite} pending={pending} onAdvance={advance} />}
                    media={<OrderProductCell lines={o.lines} lineCount={o.lineCount} />}
                  >
                    <DataRow label="Pembeli">
                      {o.buyer}
                      {o.city ? <span className="text-muted-foreground"> · {o.city}</span> : null}
                    </DataRow>
                    <DataRow label="Dibayar" strong>
                      {IDR(o.total)}
                      <div className="text-xs font-normal text-muted-foreground">
                        {o.paymentMethod ? (PAYMENT_METHOD_LABEL[o.paymentMethod] ?? o.paymentMethod) : "Tanpa pembayaran"}
                      </div>
                      {!o.paid && (
                        <Badge variant="secondary" className="mt-1 border-0 bg-amber-500/15 font-medium text-amber-700 dark:text-amber-400">
                          Belum dibayar
                        </Badge>
                      )}
                    </DataRow>
                    <DataRow label="Jasa Kirim">
                      {o.courier ? (
                        <>
                          {o.courier}
                          {o.awb && <div className="font-mono text-xs text-muted-foreground">{o.awb}</div>}
                        </>
                      ) : (
                        <span className="text-muted-foreground">Belum diatur</span>
                      )}
                      <ProblemBadge o={o} />
                    </DataRow>
                  </DataCard>
                ))
              )
            }
          />
        </div>

        {/* footer */}
        <div className="flex flex-col gap-3 border-t p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Menampilkan{" "}
            <span className="font-medium tabular-nums text-foreground">
              {num(rangeStart)}–{num(rangeEnd)}
            </span>{" "}
            dari <span className="font-medium tabular-nums text-foreground">{num(total)}</span> pesanan
          </p>
          <Pagination className="mx-0 w-auto justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  text="Sebelumnya"
                  aria-disabled={page === 1}
                  className={page === 1 ? "pointer-events-none opacity-50" : undefined}
                  onClick={() => go({ page: page - 1 })}
                />
              </PaginationItem>
              {Array.from({ length: pageCount }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === pageCount || Math.abs(p - page) <= 1)
                .map((p, idx, arr) => (
                  <PaginationItem key={p}>
                    {idx > 0 && arr[idx - 1] !== p - 1 && <span className="px-1 text-muted-foreground">…</span>}
                    <PaginationLink isActive={p === page} onClick={() => go({ page: p })}>
                      {p}
                    </PaginationLink>
                  </PaginationItem>
                ))}
              <PaginationItem>
                <PaginationNext
                  text="Berikutnya"
                  aria-disabled={page === pageCount}
                  className={page === pageCount ? "pointer-events-none opacity-50" : undefined}
                  onClick={() => go({ page: page + 1 })}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      </Card>

      {/* The one thing Shopee shows that we deliberately do NOT. */}
      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0" />
        <span>
          <span className="font-medium text-foreground">Batas Waktu Pengiriman belum ada.</span> TokoΦ belum
          menyimpan tenggat kirim untuk sebuah pesanan, jadi kolom hitung-mundur itu sengaja tidak
          ditampilkan — daripada memajang angka yang kami karang sendiri.
        </span>
      </p>

      {/* Retur — real numbers from the orders that actually shipped (lib/data/returns.ts).
          Shown on the tab where it is the question being asked. */}
      {tab === "pengembalian" && <ReturnSummary rows={returns} />}
    </div>
  );
}

// "Kurir melaporkan kendala" — the tracking poller's `problem` outcome, made visible.
//
// It sits in the Jasa Kirim column rather than the Status column because it is NOT a status: the
// order is still `dikirim` and that badge stays correct. This is a fact about the PARCEL.
//
// The poller clears the flag as soon as the courier reports movement again, so a badge on screen
// means the parcel is stuck NOW — which is the only reason it earns a red. The full reason and the
// "sejak" date are on the order detail; here it is one glanceable word so a seller scanning the list
// can find the rows that need a phone call. `title` carries the note for a hover without spending a
// second line on every row.
function ProblemBadge({ o }: { o: OrderListRow }) {
  if (!o.problem) return null;
  return (
    <Badge
      variant="secondary"
      className="mt-1 border-0 bg-red-500/15 font-medium text-red-700 dark:text-red-400"
      title={o.problemNote ?? "Kurir melaporkan kendala pengiriman."}
    >
      <AlertTriangle className="size-3" /> Kendala
    </Badge>
  );
}

// The primary action follows the order's next real step. `dikirim` has no button here on purpose:
// booking a shipment (courier + resi) happens on the order detail page, where the address is.
function RowAction({
  o,
  canWrite,
  pending,
  onAdvance,
}: {
  o: OrderListRow;
  canWrite: boolean;
  pending: boolean;
  onAdvance: (o: OrderListRow, to: "diproses" | "dikirim" | "selesai" | "batal", label: string) => void;
}) {
  if (!canWrite || o.status === "selesai" || o.status === "batal" || o.status === "retur") {
    return (
      <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/pesanan/${o.number}`} />}>
        Lihat
      </Button>
    );
  }
  if (o.status === "baru") {
    return (
      <Button size="sm" className="gap-1.5" disabled={pending} onClick={() => onAdvance(o, "diproses", "diproses")}>
        <PackageCheck className="size-4" /> Proses
      </Button>
    );
  }
  if (o.status === "diproses") {
    return (
      <Button size="sm" nativeButton={false} render={<Link href={`/pesanan/${o.number}`} />}>
        Atur Pengiriman
      </Button>
    );
  }
  // dikirim → the parcel is out; the only thing left the merchant can assert is that it landed.
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      disabled={pending}
      onClick={() => onAdvance(o, "selesai", "diselesaikan")}
    >
      <CheckCircle2 className="size-4" /> Selesaikan
    </Button>
  );
}

function EmptyState({ tab, filtered }: { tab: OrderTab; filtered: boolean }) {
  if (filtered) return <>Tidak ada pesanan yang cocok dengan pencarian/filter ini.</>;
  if (tab === "belum_bayar") {
    return (
      <span className="mx-auto block max-w-md text-sm leading-relaxed">
        Tidak ada pesanan yang menunggu pembayaran. Semua pesanan yang masih berjalan sudah lunas —
        yang gagal bayar berakhir di tab Pengembalian/Pembatalan.
      </span>
    );
  }
  return <>Belum ada pesanan di tab ini.</>;
}
