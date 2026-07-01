"use client";

import { useMemo, useState } from "react";
import {
  Users,
  Crown,
  Wallet,
  UserCheck,
  UserPlus,
  Download,
  Search,
  ArrowUpDown,
  MoreHorizontal,
  Eye,
  MessageCircle,
  Trash2,
  Mail,
  Phone,
  MapPin,
} from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { CUSTOMERS, type Customer, type Segment } from "@/lib/mock/store";
import { IDR, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SegmentBadge, SEGMENTS } from "@/components/admin/pelanggan/segment-badge";

// ---- helpers ----
function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function joinedLabel(days: number) {
  if (days < 30) return `${days} hr lalu`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} bln lalu`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem ? `${years} thn ${rem} bln lalu` : `${years} thn lalu`;
}

// deterministic mock order history per customer
const HIST_STATUS = ["Selesai", "Dikirim", "Diproses", "Selesai"] as const;
function orderHistory(c: Customer) {
  const n = Math.min(4, Math.max(3, (c.id.charCodeAt(6) % 2) + 3));
  const rows = [];
  for (let i = 0; i < n; i++) {
    const seed = (c.id.charCodeAt(5) * 7 + i * 13 + c.spent) % 900;
    const amount = 90_000 + seed * 3_500;
    rows.push({
      inv: `#INV-${4000 + ((c.id.charCodeAt(7) * 31 + i * 17) % 900)}`,
      amount,
      status: HIST_STATUS[i % HIST_STATUS.length],
    });
  }
  return rows;
}

const SEGMENT_TABS: Array<{ key: "semua" | Segment; label: string }> = [
  { key: "semua", label: "Semua" },
  { key: "baru", label: "Baru" },
  { key: "reguler", label: "Reguler" },
  { key: "loyal", label: "Loyal" },
  { key: "vip", label: "VIP" },
];

type SortKey = "spent" | "orders" | "recent";
const SORTS: Record<SortKey, string> = {
  spent: "Belanja tertinggi",
  orders: "Pesanan terbanyak",
  recent: "Terbaru",
};

export default function PelangganPage() {
  const [tab, setTab] = useState<"semua" | Segment>("semua");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("spent");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<Customer | null>(null);

  // ---- stats ----
  const totalDisplay = num(3128);
  const vipCount = CUSTOMERS.filter((c) => c.segment === "vip").length;
  const avgSpent = Math.round(
    CUSTOMERS.reduce((a, c) => a + c.spent, 0) / CUSTOMERS.length,
  );
  const activeCount = CUSTOMERS.filter((c) => c.orders > 0).length;

  const counts = useMemo(() => {
    const c: Record<string, number> = { semua: CUSTOMERS.length };
    for (const seg of ["baru", "reguler", "loyal", "vip"] as Segment[]) {
      c[seg] = CUSTOMERS.filter((x) => x.segment === seg).length;
    }
    return c;
  }, []);

  const rows = useMemo(() => {
    let list = CUSTOMERS.slice();
    if (tab !== "semua") list = list.filter((c) => c.segment === tab);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q),
      );
    }
    list.sort((a, b) => {
      if (sort === "spent") return b.spent - a.spent;
      if (sort === "orders") return b.orders - a.orders;
      return a.joinedDaysAgo - b.joinedDaysAgo;
    });
    return list;
  }, [tab, query, sort]);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) rows.forEach((r) => next.delete(r.id));
      else rows.forEach((r) => next.add(r.id));
      return next;
    });
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const stats = [
    {
      label: "Total Pelanggan",
      value: totalDisplay,
      icon: Users,
      delta: "+8,2% bulan ini",
    },
    {
      label: "Pelanggan VIP",
      value: num(vipCount),
      icon: Crown,
      delta: `${Math.round((vipCount / CUSTOMERS.length) * 100)}% dari total`,
    },
    {
      label: "Rata-rata Belanja",
      value: IDR(avgSpent, { compact: true }),
      icon: Wallet,
      delta: "per pelanggan",
    },
    {
      label: "Pelanggan Aktif",
      value: num(activeCount),
      icon: UserCheck,
      delta: "pernah bertransaksi",
    },
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader
        title="Pelanggan"
        desc="Kelola data pelanggan dan segmen mereka."
      >
        <Button variant="outline" className="gap-2">
          <Download className="size-4" /> Ekspor
        </Button>
        <Button className="gap-2">
          <UserPlus className="size-4" /> Tambah Pelanggan
        </Button>
      </PageHeader>

      {/* stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="gap-0 p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                {s.label}
              </span>
              <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <s.icon className="size-4" />
              </span>
            </div>
            <div className="mt-3 text-2xl font-bold tracking-tight tabular-nums">
              {s.value}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{s.delta}</div>
          </Card>
        ))}
      </div>

      <Card className="gap-0 py-0">
        {/* segment tabs + toolbar */}
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as "semua" | Segment)}
          >
            <TabsList>
              {SEGMENT_TABS.map((t) => (
                <TabsTrigger key={t.key} value={t.key} className="gap-1.5">
                  {t.label}
                  <span className="rounded-full bg-muted-foreground/15 px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                    {counts[t.key]}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari nama atau email…"
                className="h-8 w-full pl-8 sm:w-64"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" className="gap-2 whitespace-nowrap">
                    <ArrowUpDown className="size-4" />
                    <span className="hidden sm:inline">{SORTS[sort]}</span>
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Urutkan</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {(Object.keys(SORTS) as SortKey[]).map((k) => (
                  <DropdownMenuItem
                    key={k}
                    onClick={() => setSort(k)}
                    className={cn(sort === k && "font-medium text-foreground")}
                  >
                    {SORTS[k]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <Separator />

        {/* table */}
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10 pl-4">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  aria-label="Pilih semua"
                />
              </TableHead>
              <TableHead>Pelanggan</TableHead>
              <TableHead className="hidden md:table-cell">Kota</TableHead>
              <TableHead className="text-right">Pesanan</TableHead>
              <TableHead className="text-right">Total Belanja</TableHead>
              <TableHead>Segmen</TableHead>
              <TableHead className="hidden text-right lg:table-cell">
                Bergabung
              </TableHead>
              <TableHead className="w-10 pr-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow
                key={c.id}
                className="cursor-pointer"
                data-state={selected.has(c.id) ? "selected" : undefined}
                onClick={() => setActive(c)}
              >
                <TableCell
                  className="pl-4"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Checkbox
                    checked={selected.has(c.id)}
                    onCheckedChange={() => toggleOne(c.id)}
                    aria-label={`Pilih ${c.name}`}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <Avatar className="size-8">
                      <AvatarFallback className="bg-muted text-[11px] font-medium">
                        {initials(c.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {c.name}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {c.email}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                  {c.city}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {num(c.orders)}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {IDR(c.spent)}
                </TableCell>
                <TableCell>
                  <SegmentBadge segment={c.segment} />
                </TableCell>
                <TableCell className="hidden text-right text-sm text-muted-foreground tabular-nums lg:table-cell">
                  {joinedLabel(c.joinedDaysAgo)}
                </TableCell>
                <TableCell
                  className="pr-4 text-right"
                  onClick={(e) => e.stopPropagation()}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Aksi"
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setActive(c)}>
                        <Eye className="size-4" /> Lihat profil
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <MessageCircle className="size-4" /> Kirim WhatsApp
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive">
                        <Trash2 className="size-4" /> Hapus
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={8}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  Tidak ada pelanggan yang cocok.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <Separator />
        <div className="flex items-center justify-between p-4 text-xs text-muted-foreground">
          <span>
            Menampilkan {num(rows.length)} pelanggan
            {selected.size > 0 && ` · ${num(selected.size)} dipilih`}
          </span>
        </div>
      </Card>

      {/* detail sheet */}
      <CustomerSheet
        customer={active}
        onOpenChange={(o) => !o && setActive(null)}
      />
    </div>
  );
}

function CustomerSheet({
  customer,
  onOpenChange,
}: {
  customer: Customer | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={!!customer} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        {customer && (
          <>
            <SheetHeader className="p-5 pb-4">
              <div className="flex items-center gap-3">
                <Avatar className="size-14">
                  <AvatarFallback
                    className={cn(
                      "text-lg font-semibold",
                      SEGMENTS[customer.segment].cls,
                    )}
                  >
                    {initials(customer.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <SheetTitle className="truncate text-lg">
                    {customer.name}
                  </SheetTitle>
                  <div className="mt-1 flex items-center gap-2">
                    <SegmentBadge segment={customer.segment} />
                    <span className="font-mono text-xs text-muted-foreground">
                      {customer.id}
                    </span>
                  </div>
                </div>
              </div>
              <SheetDescription className="sr-only">
                Detail profil pelanggan
              </SheetDescription>
            </SheetHeader>

            <Separator />

            {/* contact */}
            <div className="space-y-2.5 p-5">
              <InfoRow icon={Mail} value={customer.email} />
              <InfoRow icon={Phone} value={customer.phone} />
              <InfoRow icon={MapPin} value={customer.city} />
            </div>

            <Separator />

            {/* stat tiles */}
            <div className="grid grid-cols-3 gap-px bg-border">
              <StatTile label="Total pesanan" value={num(customer.orders)} />
              <StatTile
                label="Total belanja"
                value={IDR(customer.spent, { compact: true })}
              />
              <StatTile
                label="Rata-rata/pesanan"
                value={IDR(
                  Math.round(customer.spent / Math.max(1, customer.orders)),
                  { compact: true },
                )}
              />
            </div>

            <Separator />

            {/* order history */}
            <div className="p-5">
              <h3 className="mb-3 text-sm font-medium">Riwayat Pesanan</h3>
              <div className="space-y-1">
                {orderHistory(customer).map((o, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg px-2.5 py-2 hover:bg-muted/60"
                  >
                    <div>
                      <div className="font-mono text-sm font-medium">
                        {o.inv}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {o.status}
                      </div>
                    </div>
                    <div className="text-sm font-semibold tabular-nums">
                      {IDR(o.amount)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <SheetFooter className="p-5 pt-0">
              <Button className="w-full gap-2 bg-emerald-600 text-white hover:bg-emerald-600/90">
                <MessageCircle className="size-4" /> Kirim WhatsApp
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function InfoRow({
  icon: Icon,
  value,
}: {
  icon: typeof Mail;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2.5 text-sm">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{value}</span>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-popover px-3 py-4 text-center">
      <div className="text-base font-bold tracking-tight tabular-nums">
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
