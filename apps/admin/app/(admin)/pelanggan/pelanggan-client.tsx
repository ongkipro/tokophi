"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Users,
  Crown,
  Wallet,
  UserCheck,
  UserPlus,
  Download,ArrowUpDown,
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
import { Label } from "@tokophi/ui/label";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@tokophi/ui/dialog";
import { type Segment } from "@/lib/types/domain";
import type { CustomerRow } from "@/lib/data/customers";
import { IDR, NO_FIGURE, num, share } from "@tokophi/lib/format";
import { exportCsv } from "@/lib/csv";
import { useCan } from "@/components/admin/permissions";
import { createCustomer, deleteCustomer } from "@/lib/actions/customers";
import { cn } from "@tokophi/ui/lib/utils";
import { SegmentBadge } from "@/components/admin/pelanggan/segment-badge";
import { AccountBadge } from "@/components/admin/pelanggan/account-badge";
import { SearchInput } from "@/components/admin/search-input";
import { ConfirmDelete } from "@/components/admin/confirm-delete";

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

// Punya akun / tidak. "Tamu" is the normal case here — checkout never asks for a registration.
type AccountTab = "semua" | "terdaftar" | "tamu";

function RowMenu({ c }: { c: CustomerRow }) {
  const canWrite = useCan("customers:write");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const del = () =>
    start(async () => {
      try {
        await deleteCustomer(c.id);
        toast.success("Pelanggan dihapus.");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Gagal menghapus — coba lagi.");
      } finally {
        setConfirmOpen(false);
      }
    });
  return (
    <>
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
          <DropdownMenuItem
            disabled={!c.phone}
            onClick={() => c.phone && window.open(`https://wa.me/${c.phone.replace(/\D/g, "")}`, "_blank", "noopener")}
          >
            <MessageCircle className="size-4" /> Kirim WhatsApp
          </DropdownMenuItem>
          {canWrite && <DropdownMenuSeparator />}
          {canWrite && (
            <DropdownMenuItem variant="destructive" disabled={pending} onClick={() => setConfirmOpen(true)}>
              <Trash2 className="size-4" /> Hapus
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* `deleteCustomer` is a hard DELETE; the FK refuses (23503 → its own message) when the customer
          has orders or reviews, so the copy names both halves. */}
      <ConfirmDelete
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Hapus pelanggan?"
        description={`${c.name} dihapus permanen beserta tag dan catatannya. Pelanggan yang sudah punya pesanan atau ulasan tidak bisa dihapus.`}
        onConfirm={del}
        pending={pending}
      />
    </>
  );
}

function AddCustomerDialog() {
  const canWrite = useCan("customers:write");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");

  const save = () =>
    start(async () => {
      try {
        await createCustomer({ name, email, phone, city, province });
        toast.success("Pelanggan ditambahkan.");
        setName(""); setEmail(""); setPhone(""); setCity(""); setProvince("");
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Gagal menambah pelanggan.");
      }
    });

  if (!canWrite) return null;

  return (
    <>
      <Button className="gap-2" onClick={() => setOpen(true)}>
        <UserPlus className="size-4" /> Tambah Pelanggan
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tambah pelanggan</DialogTitle>
            <DialogDescription>
              Catat pelanggan dari pesanan WhatsApp atau pembeli langsung. Tanpa akun — seperti tamu biasa.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="cust-nama">Nama</Label>
              <Input id="cust-nama" placeholder="mis. Rina Wijaya" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cust-wa">Nomor WhatsApp</Label>
              <Input id="cust-wa" inputMode="numeric" placeholder="mis. 081234567890" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cust-email">Email <span className="text-muted-foreground">(opsional)</span></Label>
              <Input id="cust-email" type="email" placeholder="mis. rina@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="cust-kota">Kota</Label>
                <Input id="cust-kota" placeholder="mis. Bandung" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cust-prov">Provinsi</Label>
                <Input id="cust-prov" placeholder="mis. Jawa Barat" value={province} onChange={(e) => setProvince(e.target.value)} />
              </div>
            </div>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline">Tutup</Button>} />
            <Button disabled={pending || !name.trim()} onClick={save}>
              {pending ? "Menyimpan…" : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PelangganClient({ customers }: { customers: CustomerRow[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<"semua" | Segment>("semua");
  const [account, setAccount] = useState<AccountTab>("semua");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("spent");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ---- stats ----
  // Every one of these is counted from the rows on this page. The old "Total Pelanggan: 3.128
  // (+8,2% bulan ini)" was neither: the store has 24 customers and nothing anywhere computed a
  // month-over-month change.
  const registeredCount = customers.filter((c) => c.registered).length;
  const guestCount = customers.length - registeredCount;
  const vipCount = customers.filter((c) => c.segment === "vip").length;
  const avgSpent = customers.length
    ? Math.round(customers.reduce((a, c) => a + c.spent, 0) / customers.length)
    : 0;
  const activeCount = customers.filter((c) => c.orders > 0).length;

  const counts = useMemo(() => {
    const c: Record<string, number> = { semua: customers.length };
    for (const seg of ["baru", "reguler", "loyal", "vip"] as Segment[]) {
      c[seg] = customers.filter((x) => x.segment === seg).length;
    }
    return c;
  }, [customers]);

  const accountCounts: Record<AccountTab, number> = {
    semua: customers.length,
    terdaftar: registeredCount,
    tamu: guestCount,
  };

  const rows = useMemo(() => {
    let list = customers.slice();
    if (tab !== "semua") list = list.filter((c) => c.segment === tab);
    if (account !== "semua") list = list.filter((c) => (account === "terdaftar" ? c.registered : !c.registered));
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
  }, [customers, tab, account, query, sort]);

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
      value: num(customers.length),
      icon: Users,
      delta: `${num(registeredCount)} terdaftar · ${num(guestCount)} tamu`,
    },
    {
      label: "Pelanggan VIP",
      value: num(vipCount),
      icon: Crown,
      // `share()`, not a hand-rolled `Math.round(...) + "%"`. Same figure, one formatter — and the
      // `customers.length` guard is the denominator rule: 0/0 is NaN, never "0%".
      delta: customers.length
        ? `${share((vipCount / customers.length) * 100, 0)} dari total`
        : NO_FIGURE,
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
          onClick={() => exportCsv("pelanggan", rows.map((c) => ({ Nama: c.name, Email: c.email, Telepon: c.phone, Kota: c.city, Pesanan: c.orders, "Total Belanja": c.spent, Segmen: c.segment, Akun: c.registered ? "Terdaftar" : "Tamu" })))}
        >
          <Download className="size-4" /> Ekspor
        </Button>
        <AddCustomerDialog />
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
            {/* 8,41px ("7 terdaftar · 18 tamu") and 5,77px ("40% dari total") of ink movement at
                1440px, under a value that was already tabular. */}
            <div className="mt-1 text-xs text-muted-foreground tabular-nums">{s.delta}</div>
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

          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={account} onValueChange={(v) => setAccount(v as AccountTab)}>
              <TabsList>
                {(
                  [
                    ["semua", "Semua"],
                    ["terdaftar", "Terdaftar"],
                    ["tamu", "Tamu"],
                  ] as Array<[AccountTab, string]>
                ).map(([k, label]) => (
                  <TabsTrigger key={k} value={k} className="gap-1.5">
                    {label}
                    <span className="rounded-full bg-muted-foreground/15 px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                      {accountCounts[k]}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <SearchInput
              label="Cari pelanggan"
              value={query}
              onValueChange={setQuery}
              placeholder="Cari nama atau email…"
              inputClassName="h-8 w-full sm:w-64"
            />
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
              <TableHead>Akun</TableHead>
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
                <TableCell>
                  <AccountBadge registered={c.registered} />
                </TableCell>
                <TableCell className="hidden text-right text-sm text-muted-foreground tabular-nums lg:table-cell">
                  {joinedLabel(c.joinedDaysAgo)}
                </TableCell>
                <TableCell
                  className="pr-4 text-right"
                  onClick={(e) => e.stopPropagation()}
                >
                  <RowMenu c={c} />
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={9}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  {/* "yang cocok" describes a filter miss. A store with no customers at all has
                      nothing to filter — and the reason is upstream (no orders), so say that
                      rather than sending them back to the search box. */}
                  {customers.length === 0
                    ? "Belum ada pelanggan. Data pembeli tercatat sendiri begitu pesanan pertama masuk — Anda tidak perlu memasukkannya manual."
                    : "Tidak ada pelanggan yang cocok."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <Separator />
        <div className="flex items-center justify-between p-4 text-xs text-muted-foreground tabular-nums">
          <span>
            Menampilkan {num(rows.length)} pelanggan
            {selected.size > 0 && ` · ${num(selected.size)} dipilih`}
          </span>
        </div>
      </Card>
    </div>
  );
}
