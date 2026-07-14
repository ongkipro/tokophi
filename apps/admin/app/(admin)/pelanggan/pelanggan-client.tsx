"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
} from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Checkbox } from "@tokophi/ui/checkbox";
import { Separator } from "@tokophi/ui/separator";
import { Avatar, AvatarFallback } from "@tokophi/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@tokophi/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@tokophi/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@tokophi/ui/dropdown-menu";
import { type Customer, type Segment } from "@/lib/mock/store";
import { IDR, num } from "@tokophi/lib/format";
import { exportCsv } from "@/lib/csv";
import { cn } from "@tokophi/ui/lib/utils";
import { SegmentBadge } from "@/components/admin/pelanggan/segment-badge";

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

export function PelangganClient({ customers }: { customers: Customer[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<"semua" | Segment>("semua");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("spent");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ---- stats ----
  const totalDisplay = num(3128);
  const vipCount = customers.filter((c) => c.segment === "vip").length;
  const avgSpent = Math.round(
    customers.reduce((a, c) => a + c.spent, 0) / customers.length,
  );
  const activeCount = customers.filter((c) => c.orders > 0).length;

  const counts = useMemo(() => {
    const c: Record<string, number> = { semua: customers.length };
    for (const seg of ["baru", "reguler", "loyal", "vip"] as Segment[]) {
      c[seg] = customers.filter((x) => x.segment === seg).length;
    }
    return c;
  }, []);

  const rows = useMemo(() => {
    let list = customers.slice();
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
      delta: `${Math.round((vipCount / customers.length) * 100)}% dari total`,
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
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => exportCsv("pelanggan", rows.map((c) => ({ Nama: c.name, Email: c.email, Telepon: c.phone, Kota: c.city, Pesanan: c.orders, "Total Belanja": c.spent, Segmen: c.segment })))}
        >
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
                onClick={() => router.push(`/pelanggan/${c.id}`)}
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
                      <DropdownMenuItem
                        onClick={() => router.push(`/pelanggan/${c.id}`)}
                      >
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
    </div>
  );
}
