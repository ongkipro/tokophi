"use client";

import * as React from "react";
import {
  Plus,
  Upload,
  Search,
  LayoutGrid,
  List,
  ChevronDown,
  MoreHorizontal,
  Pencil,
  Copy,
  Archive,
  Package,
  CheckCircle2,
  AlertTriangle,
  Tags,
  Check,
} from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { IDR, num } from "@/lib/format";
import { PRODUCTS, type Product } from "@/lib/mock/store";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const LOW_STOCK = 20;

const CATEGORIES = Array.from(new Set(PRODUCTS.map((p) => p.category)));

type StatusFilter = "all" | "active" | "draft";

function StockBadge({ stock }: { stock: number }) {
  if (stock <= 0) {
    return <Badge variant="destructive">Habis</Badge>;
  }
  if (stock < LOW_STOCK) {
    return (
      <Badge className="border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-400">
        Menipis · {num(stock)}
      </Badge>
    );
  }
  return (
    <Badge className="border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/50 dark:text-emerald-400">
      Stok {num(stock)}
    </Badge>
  );
}

function StatusBadge({ status }: { status: Product["status"] }) {
  return status === "active" ? (
    <Badge variant="secondary">Aktif</Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      Draft
    </Badge>
  );
}

function RowActions() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Aksi produk" />
        }
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem>
          <Pencil />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Copy />
          Duplikat
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <Archive />
          Arsipkan
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <Card className="py-0">
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
            accent ?? "bg-muted text-muted-foreground"
          }`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold tabular-nums tracking-tight">
            {value}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Page() {
  const [search, setSearch] = React.useState("");
  const [category, setCategory] = React.useState<string>("all");
  const [status, setStatus] = React.useState<StatusFilter>("all");
  const [view, setView] = React.useState<"grid" | "list">("grid");

  const stats = React.useMemo(() => {
    const total = PRODUCTS.length;
    const active = PRODUCTS.filter((p) => p.status === "active").length;
    const low = PRODUCTS.filter((p) => p.stock < LOW_STOCK).length;
    const categories = new Set(PRODUCTS.map((p) => p.category)).size;
    return { total, active, low, categories };
  }, []);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return PRODUCTS.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (category !== "all" && p.category !== category) return false;
      if (status !== "all" && p.status !== status) return false;
      return true;
    });
  }, [search, category, status]);

  const statusLabel =
    status === "all" ? "Semua" : status === "active" ? "Aktif" : "Draft";

  return (
    <div>
      <PageHeader title="Produk" desc="Kelola katalog, stok, dan status produk.">
        <Button variant="outline">
          <Upload />
          Impor
        </Button>
        <Dialog>
          <DialogTrigger
            render={
              <Button>
                <Plus />
                Tambah Produk
              </Button>
            }
          />
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Tambah Produk</DialogTitle>
              <DialogDescription>
                Lengkapi detail produk. Produk akan muncul di katalog toko Anda.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="p-nama">Nama produk</Label>
                <Input id="p-nama" placeholder="Contoh: Kaos Polos Premium" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="p-harga">Harga</Label>
                  <Input id="p-harga" inputMode="numeric" placeholder="Rp 0" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="p-stok">Stok</Label>
                  <Input id="p-stok" inputMode="numeric" placeholder="0" />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Kategori</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="outline"
                        className="w-full justify-between font-normal"
                      />
                    }
                  >
                    Pilih kategori
                    <ChevronDown className="text-muted-foreground" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[--anchor-width]">
                    {CATEGORIES.map((c) => (
                      <DropdownMenuItem key={c}>{c}</DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="p-desc">Deskripsi</Label>
                <Textarea
                  id="p-desc"
                  rows={3}
                  placeholder="Ceritakan keunggulan produk ini…"
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label htmlFor="p-aktif">Aktifkan produk</Label>
                  <p className="text-xs text-muted-foreground">
                    Produk aktif langsung tampil di toko.
                  </p>
                </div>
                <Switch id="p-aktif" defaultChecked />
              </div>
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline">Batal</Button>} />
              <DialogClose render={<Button>Simpan</Button>} />
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageHeader>

      {/* Stat row */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={<Package className="size-4" />}
          label="Total Produk"
          value={num(stats.total)}
        />
        <StatCard
          icon={<CheckCircle2 className="size-4" />}
          label="Produk Aktif"
          value={num(stats.active)}
          accent="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
        />
        <StatCard
          icon={<AlertTriangle className="size-4" />}
          label="Stok Menipis"
          value={num(stats.low)}
          accent="bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
        />
        <StatCard
          icon={<Tags className="size-4" />}
          label="Kategori"
          value={num(stats.categories)}
        />
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari produk…"
            className="pl-8"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Category filter */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="sm" />}
            >
              <Tags />
              {category === "all" ? "Kategori" : category}
              <ChevronDown className="text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel>Kategori</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setCategory("all")}>
                Semua
                {category === "all" && <Check className="ml-auto" />}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {CATEGORIES.map((c) => (
                <DropdownMenuItem key={c} onClick={() => setCategory(c)}>
                  {c}
                  {category === c && <Check className="ml-auto" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Status filter */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="sm" />}
            >
              Status: {statusLabel}
              <ChevronDown className="text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              <DropdownMenuItem onClick={() => setStatus("all")}>
                Semua
                {status === "all" && <Check className="ml-auto" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatus("active")}>
                Aktif
                {status === "active" && <Check className="ml-auto" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatus("draft")}>
                Draft
                {status === "draft" && <Check className="ml-auto" />}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Separator orientation="vertical" className="hidden h-6 sm:block" />

          {/* View toggle */}
          <div className="flex items-center gap-1 rounded-lg border bg-background p-0.5">
            <Button
              variant={view === "grid" ? "secondary" : "ghost"}
              size="icon-sm"
              aria-label="Tampilan grid"
              aria-pressed={view === "grid"}
              onClick={() => setView("grid")}
            >
              <LayoutGrid />
            </Button>
            <Button
              variant={view === "list" ? "secondary" : "ghost"}
              size="icon-sm"
              aria-label="Tampilan daftar"
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
            >
              <List />
            </Button>
          </div>
        </div>
      </div>

      {/* Result count */}
      <p className="mb-3 text-xs text-muted-foreground">
        Menampilkan {num(filtered.length)} dari {num(PRODUCTS.length)} produk
      </p>

      {filtered.length === 0 ? (
        <Card className="py-0">
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Package className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium">Tidak ada produk ditemukan</p>
            <p className="text-sm text-muted-foreground">
              Coba ubah kata kunci atau filter Anda.
            </p>
          </CardContent>
        </Card>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((p) => (
            <Card
              key={p.id}
              className="group overflow-hidden py-0 transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <CardContent className="flex h-full flex-col gap-3 p-3">
                <div className="flex items-start justify-between">
                  <div className="flex size-14 items-center justify-center rounded-xl bg-muted text-3xl">
                    {p.emoji}
                  </div>
                  <RowActions />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-medium" title={p.name}>
                    {p.name}
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {p.category}
                  </p>
                  <p className="mt-2 text-base font-semibold tabular-nums">
                    {IDR(p.price)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <StockBadge stock={p.stock} />
                  <StatusBadge status={p.status} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produk</TableHead>
                <TableHead className="text-right">Harga</TableHead>
                <TableHead>Stok</TableHead>
                <TableHead className="text-right">Terjual</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-xl">
                        {p.emoji}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.category}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {IDR(p.price)}
                  </TableCell>
                  <TableCell>
                    <StockBadge stock={p.stock} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {num(p.unitsSold)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={p.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <RowActions />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
