"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Download,
  Plus,
  MoreHorizontal,
  ChevronDown,
  Check,
  PackageCheck,
  Eye,
  XCircle,
  Store,
} from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { OrderStatusBadge } from "@/components/admin/order-status";
import { ReturnSummary, type CourierReturnRow } from "@/components/admin/pesanan/return-summary";
import { IDR, timeAgo } from "@/lib/format";
import { exportCsv } from "@/lib/csv";
import { type Order, type OrderStatus } from "@/lib/mock/store";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
  // A returned parcel is its own bucket — it shipped and came back (unlike `batal`, which never
  // left). Merchants need to pull the whole list up in one click.
  { value: "retur", label: "Retur" },
];


const PAGE_SIZE = 10;

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

// ------- page -------

export function PesananClient({ orders, returns }: { orders: Order[]; returns: CourierReturnRow[] }) {
  const CHANNELS = ["Semua", ...Array.from(new Set(orders.map((o) => o.channel)))];
  const router = useRouter();
  const [status, setStatus] = useState<OrderStatus | "semua">("semua");
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState("Semua");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const counts = useMemo(() => {
    const c: Record<string, number> = { semua: orders.length };
    for (const o of orders) c[o.status] = (c[o.status] ?? 0) + 1;
    return c;
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
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
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => exportCsv("pesanan", filtered.map((o) => ({ No: o.id, Pelanggan: o.customer, Kota: o.city, Item: o.items, Status: o.status, Channel: o.channel, Total: o.total })))}
        >
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
                onClick={() => router.push(`/pesanan/${o.id.replace("#", "")}`)}
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
                      <DropdownMenuItem onClick={() => router.push(`/pesanan/${o.id.replace("#", "")}`)}>
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

      {/* Retur — real numbers from the orders that actually shipped (lib/data/returns.ts). */}
      <ReturnSummary rows={returns} />
    </div>
  );
}
