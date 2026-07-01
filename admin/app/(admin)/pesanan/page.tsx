"use client";

import { useMemo, useState } from "react";
import {
  Search,
  Download,
  Plus,
  MoreHorizontal,
  ChevronDown,
  Check,
  Printer,
  PackageCheck,
  Eye,
  XCircle,
  Truck,
  CreditCard,
  ClipboardList,
  Store,
} from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { OrderStatusBadge } from "@/components/admin/order-status";
import { IDR, num, timeAgo } from "@/lib/format";
import { ORDERS, PRODUCTS, type Order, type OrderStatus } from "@/lib/mock/store";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

// ------- helpers -------

const STATUS_TABS: { value: OrderStatus | "semua"; label: string }[] = [
  { value: "semua", label: "Semua" },
  { value: "baru", label: "Baru" },
  { value: "diproses", label: "Diproses" },
  { value: "dikirim", label: "Dikirim" },
  { value: "selesai", label: "Selesai" },
  { value: "batal", label: "Batal" },
];

const CHANNELS = ["Semua", ...Array.from(new Set(ORDERS.map((o) => o.channel)))];

const PAGE_SIZE = 10;

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

// Deterministic hash from an order id → seed.
function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

type Line = { name: string; emoji: string; qty: number; price: number };

// Fabricate a plausible line-item breakdown for an order whose subtotal
// lands near order.total, plus a deterministic shipping fee.
function lineItemsFor(order: Order): { lines: Line[]; subtotal: number; ongkir: number; total: number } {
  const seed = hash(order.id);
  const lines: Line[] = [];
  for (let i = 0; i < order.items; i++) {
    const p = PRODUCTS[(seed + i * 7) % PRODUCTS.length];
    const qty = ((seed >> (i + 2)) & 3) === 0 ? 2 : 1;
    lines.push({ name: p.name, emoji: p.emoji, qty, price: p.price });
  }
  const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const ongkir = [0, 15_000, 20_000, 25_000][seed % 4];
  return { lines, subtotal, ongkir, total: subtotal + ongkir };
}

// Timeline steps and the active index per status.
const TIMELINE = [
  { key: "dibuat", label: "Pesanan dibuat", icon: ClipboardList },
  { key: "bayar", label: "Pembayaran", icon: CreditCard },
  { key: "proses", label: "Diproses", icon: PackageCheck },
  { key: "kirim", label: "Dikirim", icon: Truck },
] as const;

function activeStep(status: OrderStatus): number {
  switch (status) {
    case "baru":
      return 1;
    case "diproses":
      return 2;
    case "dikirim":
      return 3;
    case "selesai":
      return 4;
    case "batal":
      return -1;
  }
}

// ------- page -------

export default function PesananPage() {
  const [status, setStatus] = useState<OrderStatus | "semua">("semua");
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState("Semua");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<Order | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = { semua: ORDERS.length };
    for (const o of ORDERS) c[o.status] = (c[o.status] ?? 0) + 1;
    return c;
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ORDERS.filter((o) => {
      if (status !== "semua" && o.status !== status) return false;
      if (channel !== "Semua" && o.channel !== channel) return false;
      if (q && !(o.customer.toLowerCase().includes(q) || o.id.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [status, query, channel]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const rangeStart = filtered.length === 0 ? 0 : (current - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(current * PAGE_SIZE, filtered.length);

  function resetPage(fn: () => void) {
    fn();
    setPage(1);
  }

  const pageIds = rows.map((r) => r.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  function toggleAllOnPage(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of pageIds) checked ? next.add(id) : next.delete(id);
      return next;
    });
  }

  function toggleRow(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader title="Pesanan" desc="Kelola pesanan yang masuk dan status pengirimannya.">
        <Button variant="outline" className="gap-2">
          <Download className="size-4" /> Ekspor
        </Button>
        <Button className="gap-2">
          <Plus className="size-4" /> Buat Pesanan
        </Button>
      </PageHeader>

      {/* status tabs */}
      <Tabs
        value={status}
        onValueChange={(v) => resetPage(() => setStatus(v as OrderStatus | "semua"))}
      >
        <TabsList className="h-9 flex-wrap">
          {STATUS_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="gap-1.5 px-2.5">
              {t.label}
              <span className="rounded-full bg-muted-foreground/15 px-1.5 py-px text-[11px] font-medium tabular-nums text-muted-foreground group-data-[variant=default]/tabs-list:data-active:bg-primary/15 group-data-[variant=default]/tabs-list:data-active:text-primary">
                {counts[t.value] ?? 0}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card className="overflow-hidden p-0">
        {/* toolbar */}
        <div className="flex flex-col gap-3 border-b p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => resetPage(() => setQuery(e.target.value))}
              placeholder="Cari invoice atau pelanggan…"
              className="pl-8"
            />
          </div>

          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <span className="text-sm text-muted-foreground">
                {selected.size} dipilih
              </span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" className="gap-2">
                    <Store className="size-4" />
                    {channel === "Semua" ? "Sumber" : channel}
                    <ChevronDown className="size-4 text-muted-foreground" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>Sumber</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {CHANNELS.map((c) => (
                  <DropdownMenuItem key={c} onClick={() => resetPage(() => setChannel(c))}>
                    <span className="flex-1">{c}</span>
                    {channel === c && <Check className="size-4 text-primary" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* table */}
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10 pl-4">
                <Checkbox
                  checked={allOnPageSelected}
                  onCheckedChange={(c) => toggleAllOnPage(Boolean(c))}
                  aria-label="Pilih semua"
                />
              </TableHead>
              <TableHead>Invoice</TableHead>
              <TableHead>Pelanggan</TableHead>
              <TableHead>Waktu</TableHead>
              <TableHead>Sumber</TableHead>
              <TableHead>Items</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">
                  Tidak ada pesanan yang cocok dengan filter.
                </TableCell>
              </TableRow>
            )}
            {rows.map((o) => (
              <TableRow
                key={o.id}
                className="cursor-pointer"
                data-state={selected.has(o.id) ? "selected" : undefined}
                onClick={() => setActive(o)}
              >
                <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selected.has(o.id)}
                    onCheckedChange={(c) => toggleRow(o.id, Boolean(c))}
                    aria-label={`Pilih ${o.id}`}
                  />
                </TableCell>
                <TableCell className="font-mono text-xs font-medium">{o.id}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <Avatar size="sm">
                      <AvatarFallback className="text-[10px]">{initials(o.customer)}</AvatarFallback>
                    </Avatar>
                    <div className="leading-tight">
                      <div className="font-medium">{o.customer}</div>
                      <div className="text-xs text-muted-foreground">{o.city}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{timeAgo(o.minutesAgo)}</TableCell>
                <TableCell className="text-muted-foreground">{o.channel}</TableCell>
                <TableCell className="tabular-nums text-muted-foreground">{o.items} produk</TableCell>
                <TableCell>
                  <OrderStatusBadge status={o.status} />
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">{IDR(o.total)}</TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button variant="ghost" size="icon-sm" aria-label="Aksi pesanan">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onClick={() => setActive(o)}>
                        <Eye className="size-4" /> Lihat detail
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <PackageCheck className="size-4" /> Proses pesanan
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive">
                        <XCircle className="size-4" /> Batalkan
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* footer */}
        <div className="flex flex-col gap-3 border-t p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Menampilkan <span className="font-medium tabular-nums text-foreground">{rangeStart}–{rangeEnd}</span> dari{" "}
            <span className="font-medium tabular-nums text-foreground">{filtered.length}</span> pesanan
          </p>
          <Pagination className="mx-0 w-auto justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  text="Sebelumnya"
                  aria-disabled={current === 1}
                  className={current === 1 ? "pointer-events-none opacity-50" : undefined}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                />
              </PaginationItem>
              {Array.from({ length: pageCount }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === pageCount || Math.abs(p - current) <= 1)
                .map((p, idx, arr) => (
                  <PaginationItem key={p}>
                    {idx > 0 && arr[idx - 1] !== p - 1 && (
                      <span className="px-1 text-muted-foreground">…</span>
                    )}
                    <PaginationLink isActive={p === current} onClick={() => setPage(p)}>
                      {p}
                    </PaginationLink>
                  </PaginationItem>
                ))}
              <PaginationItem>
                <PaginationNext
                  text="Berikutnya"
                  aria-disabled={current === pageCount}
                  className={current === pageCount ? "pointer-events-none opacity-50" : undefined}
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      </Card>

      {/* detail sheet */}
      <OrderDetailSheet order={active} onClose={() => setActive(null)} />
    </div>
  );
}

// ------- detail sheet -------

function OrderDetailSheet({ order, onClose }: { order: Order | null; onClose: () => void }) {
  return (
    <Sheet open={order !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-md">
        {order && <OrderDetail order={order} />}
      </SheetContent>
    </Sheet>
  );
}

function OrderDetail({ order }: { order: Order }) {
  const { lines, subtotal, ongkir, total } = lineItemsFor(order);
  const step = activeStep(order.status);
  const cancelled = order.status === "batal";

  return (
    <>
      <SheetHeader className="border-b">
        <div className="flex items-center justify-between gap-2 pr-8">
          <SheetTitle className="font-mono text-base">{order.id}</SheetTitle>
          <OrderStatusBadge status={order.status} />
        </div>
        <SheetDescription>Dibuat {timeAgo(order.minutesAgo)} · {order.channel}</SheetDescription>
      </SheetHeader>

      <div className="space-y-5 p-4">
        {/* customer */}
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback>{initials(order.customer)}</AvatarFallback>
          </Avatar>
          <div className="leading-tight">
            <div className="font-medium">{order.customer}</div>
            <div className="text-sm text-muted-foreground">{order.city}</div>
          </div>
        </div>

        <Separator />

        {/* items */}
        <div>
          <h3 className="mb-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Item Pesanan
          </h3>
          <div className="space-y-3">
            {lines.map((l, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-lg">
                  {l.emoji}
                </div>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-sm font-medium">{l.name}</div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {l.qty} × {IDR(l.price)}
                  </div>
                </div>
                <div className="text-sm font-medium tabular-nums">{IDR(l.qty * l.price)}</div>
              </div>
            ))}
          </div>
        </div>

        <Separator />

        {/* totals */}
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <span className="tabular-nums">{IDR(subtotal)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Ongkos kirim</span>
            <span className="tabular-nums">{ongkir === 0 ? "Gratis" : IDR(ongkir)}</span>
          </div>
          <div className="flex justify-between pt-1 text-base font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{IDR(total)}</span>
          </div>
        </div>

        <Separator />

        {/* timeline */}
        <div>
          <h3 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Riwayat Status
          </h3>
          {cancelled ? (
            <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
              <XCircle className="size-5 text-red-500" />
              <div className="text-sm">
                <div className="font-medium text-red-600 dark:text-red-400">Pesanan dibatalkan</div>
                <div className="text-muted-foreground">Transaksi tidak dilanjutkan.</div>
              </div>
            </div>
          ) : (
            <ol className="relative space-y-4">
              {TIMELINE.map((t, i) => {
                const done = i < step;
                const isCurrent = i === step;
                const Icon = t.icon;
                return (
                  <li key={t.key} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div
                        className={
                          "flex size-7 shrink-0 items-center justify-center rounded-full border " +
                          (done
                            ? "border-primary bg-primary text-primary-foreground"
                            : isCurrent
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-background text-muted-foreground")
                        }
                      >
                        {done ? <Check className="size-4" /> : <Icon className="size-3.5" />}
                      </div>
                      {i < TIMELINE.length - 1 && (
                        <div className={"mt-1 w-px flex-1 " + (done ? "bg-primary" : "bg-border")} />
                      )}
                    </div>
                    <div className="pb-1 pt-0.5">
                      <div
                        className={
                          "text-sm font-medium " +
                          (done || isCurrent ? "text-foreground" : "text-muted-foreground")
                        }
                      >
                        {t.label}
                      </div>
                      {isCurrent && (
                        <div className="text-xs text-primary">Sedang berlangsung</div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>

      {/* actions */}
      <div className="sticky bottom-0 mt-auto flex gap-2 border-t bg-popover p-4">
        <Button className="flex-1 gap-2" disabled={cancelled}>
          <PackageCheck className="size-4" /> Proses
        </Button>
        <Button variant="outline" className="flex-1 gap-2">
          <Printer className="size-4" /> Cetak Label
        </Button>
      </div>
    </>
  );
}
