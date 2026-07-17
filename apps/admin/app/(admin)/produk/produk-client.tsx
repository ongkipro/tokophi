"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus, Upload, Search, LayoutGrid, List, ChevronDown, MoreHorizontal,
  Pencil, Copy, Archive, Package, CheckCircle2, AlertTriangle, Tags, Check,
  ArrowUpDown, X, Trash2, CircleCheck, FileText, Calendar,
} from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { ProductThumb } from "@/components/admin/product-thumb";
import { IDR, num, dateTimeShort } from "@tokophi/lib/format";
import { TODAY, type Product } from "@/lib/mock/store";
import { cn } from "@tokophi/ui/lib/utils";
import { toast } from "sonner";
import { bulkSetProductStatus, bulkDeleteProducts } from "@/lib/actions/products";
import { useCan } from "@/components/admin/permissions";

import { Card, CardContent } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Badge } from "@tokophi/ui/badge";
import { Input } from "@tokophi/ui/input";
import { Checkbox } from "@tokophi/ui/checkbox";
import { Separator } from "@tokophi/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@tokophi/ui/table";
import { ResponsiveTable, DataCard, DataRow } from "@/components/admin/responsive-table";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@tokophi/ui/dropdown-menu";

const LOW_STOCK = 20;

type TabKey = "all" | "active" | "draft" | "low";
type SortKey = "unggulan" | "nama" | "harga-desc" | "harga-asc" | "stok-asc" | "terlaris";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "unggulan", label: "Unggulan" },
  { key: "nama", label: "Nama A–Z" },
  { key: "harga-desc", label: "Harga tertinggi" },
  { key: "harga-asc", label: "Harga terendah" },
  { key: "stok-asc", label: "Stok paling sedikit" },
  { key: "terlaris", label: "Terlaris" },
];

const DATE_RANGES = [
  { days: 0, label: "Semua tanggal" },
  { days: 7, label: "7 hari terakhir" },
  { days: 30, label: "30 hari terakhir" },
  { days: 90, label: "90 hari terakhir" },
];

function StockBadge({ stock }: { stock: number }) {
  if (stock <= 0) return <Badge variant="destructive">Habis</Badge>;
  if (stock < LOW_STOCK)
    return <Badge className="border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-400">Menipis · {num(stock)}</Badge>;
  return <Badge className="border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/50 dark:text-emerald-400">Stok {num(stock)}</Badge>;
}

function StatusBadge({ status }: { status: Product["status"] }) {
  return status === "active"
    ? <Badge variant="secondary">Aktif</Badge>
    : <Badge variant="outline" className="text-muted-foreground">Draft</Badge>;
}

// A variant with no weight → the checkout prices its parcel with the 500 g fallback, which can be wrong
// (an apparel item is ~200 g; a 3× quote quietly kills the sale). Surface it so the fallback is visible,
// not silent — "the same lie in a smaller font" is exactly what this avoids.
function WeightWarning() {
  return (
    <span
      className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-500"
      title="Berat produk belum diisi — ongkir dihitung dengan asumsi 500 g dan bisa salah. Isi berat di editor produk."
    >
      <AlertTriangle className="h-3 w-3 shrink-0" /> Berat belum diisi
    </span>
  );
}

function RowActions({ id }: { id: string }) {
  const canDelete = useCan("products:delete");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Aksi produk" />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem render={<Link href={`/produk/${id}`} />}><Pencil /> Edit</DropdownMenuItem>
        <DropdownMenuItem><Copy /> Duplikat</DropdownMenuItem>
        {canDelete && <DropdownMenuSeparator />}
        {canDelete && <DropdownMenuItem variant="destructive"><Archive /> Arsipkan</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StatCard({ icon, label, value, accent, active, onClick }: {
  icon: React.ReactNode; label: string; value: string; accent?: string; active?: boolean; onClick?: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="text-left">
      <Card className={cn("py-0 transition-colors hover:border-primary/40", active && "border-primary ring-1 ring-primary/30")}>
        <CardContent className="flex items-center gap-3 p-4">
          <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", accent ?? "bg-muted text-muted-foreground")}>{icon}</div>
          <div className="min-w-0">
            <p className="truncate text-xs text-muted-foreground">{label}</p>
            <p className="text-lg font-semibold tabular-nums tracking-tight">{value}</p>
          </div>
        </CardContent>
      </Card>
    </button>
  );
}

export function ProdukClient({ products }: { products: Product[] }) {
  const CATEGORIES = Array.from(new Set(products.map((p) => p.category)));
  const router = useRouter();
  const canWrite = useCan("products:write");
  const canDelete = useCan("products:delete");
  const [search, setSearch] = React.useState("");
  const [category, setCategory] = React.useState("all");
  const [tab, setTab] = React.useState<TabKey>("all");
  const [sort, setSort] = React.useState<SortKey>("unggulan");
  const [dateRange, setDateRange] = React.useState<number>(0);
  const [view, setView] = React.useState<"grid" | "list">("list");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const counts = React.useMemo(() => ({
    all: products.length,
    active: products.filter((p) => p.status === "active").length,
    draft: products.filter((p) => p.status === "draft").length,
    low: products.filter((p) => p.stock < LOW_STOCK).length,
  }), []);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const arr = products.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (category !== "all" && p.category !== category) return false;
      if (tab === "active" && p.status !== "active") return false;
      if (tab === "draft" && p.status !== "draft") return false;
      if (tab === "low" && p.stock >= LOW_STOCK) return false;
      if (dateRange > 0 && p.addedTs < TODAY.getTime() - dateRange * 86_400_000) return false;
      return true;
    });
    const sorted = [...arr];
    if (sort === "nama") sorted.sort((a, b) => a.name.localeCompare(b.name, "id"));
    else if (sort === "harga-desc") sorted.sort((a, b) => b.price - a.price);
    else if (sort === "harga-asc") sorted.sort((a, b) => a.price - b.price);
    else if (sort === "stok-asc") sorted.sort((a, b) => a.stock - b.stock);
    else if (sort === "terlaris") sorted.sort((a, b) => b.unitsSold - a.unitsSold);
    return sorted;
  }, [search, category, tab, sort, dateRange]);

  const TABS: { key: TabKey; label: string; count: number }[] = [
    { key: "all", label: "Semua", count: counts.all },
    { key: "active", label: "Aktif", count: counts.active },
    { key: "draft", label: "Draft", count: counts.draft },
    { key: "low", label: "Stok Menipis", count: counts.low },
  ];

  const toggle = (id: string) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearSel = () => setSelected(new Set());
  const [bulkPending, startBulk] = React.useTransition();
  const runBulk = (fn: (ids: string[]) => Promise<{ ok: boolean; count: number }>, verb: string) =>
    startBulk(async () => {
      const ids = [...selected];
      try {
        const r = await fn(ids);
        if (!r.ok) throw new Error();
        toast.success(`${num(r.count)} produk ${verb}.`);
        clearSel();
        router.refresh();
      } catch {
        toast.error(`Gagal — coba lagi.`);
      }
    });
  const visibleIds = filtered.map((p) => p.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(visibleIds));

  const hasFilters = search !== "" || category !== "all" || tab !== "all" || dateRange !== 0;
  const resetFilters = () => { setSearch(""); setCategory("all"); setTab("all"); setDateRange(0); };

  return (
    <div>
      <PageHeader title="Produk" desc="Kelola katalog, stok, dan status produk.">
        <Button variant="outline"><Upload /> Impor</Button>
        {canWrite && <Button nativeButton={false} render={<Link href="/produk/baru" />}><Plus /> Tambah Produk</Button>}
      </PageHeader>

      {/* Stat row (clickable quick-filters) */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<Package className="size-4" />} label="Total Produk" value={num(counts.all)} active={tab === "all"} onClick={() => setTab("all")} />
        <StatCard icon={<CheckCircle2 className="size-4" />} label="Produk Aktif" value={num(counts.active)} accent="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400" active={tab === "active"} onClick={() => setTab("active")} />
        <StatCard icon={<AlertTriangle className="size-4" />} label="Stok Menipis" value={num(counts.low)} accent="bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400" active={tab === "low"} onClick={() => setTab("low")} />
        <StatCard icon={<Tags className="size-4" />} label="Kategori" value={num(new Set(products.map((p) => p.category)).size)} />
      </div>

      {/* Status tabs */}
      <div className="mb-3 flex items-center gap-1 overflow-x-auto border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-2 whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-sm font-medium transition-colors",
              tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", tab === t.key ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari produk…" className="pl-8" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
              <Tags /> {category === "all" ? "Kategori" : category} <ChevronDown className="text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel>Kategori</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setCategory("all")}>Semua {category === "all" && <Check className="ml-auto" />}</DropdownMenuItem>
              <DropdownMenuSeparator />
              {CATEGORIES.map((c) => (
                <DropdownMenuItem key={c} onClick={() => setCategory(c)}>{c} {category === c && <Check className="ml-auto" />}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
              <ArrowUpDown /> {SORTS.find((s) => s.key === sort)!.label} <ChevronDown className="text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Urutkan</DropdownMenuLabel>
              {SORTS.map((s) => (
                <DropdownMenuItem key={s.key} onClick={() => setSort(s.key)}>{s.label} {sort === s.key && <Check className="ml-auto" />}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
              <Calendar /> {DATE_RANGES.find((d) => d.days === dateRange)!.label} <ChevronDown className="text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Tanggal ditambahkan</DropdownMenuLabel>
              {DATE_RANGES.map((d) => (
                <DropdownMenuItem key={d.days} onClick={() => setDateRange(d.days)}>{d.label} {dateRange === d.days && <Check className="ml-auto" />}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Separator orientation="vertical" className="hidden h-6 sm:block" />
          <div className="flex items-center gap-1 rounded-lg border bg-background p-0.5">
            <Button variant={view === "grid" ? "secondary" : "ghost"} size="icon-sm" aria-label="Tampilan grid" aria-pressed={view === "grid"} onClick={() => setView("grid")}><LayoutGrid /></Button>
            <Button variant={view === "list" ? "secondary" : "ghost"} size="icon-sm" aria-label="Tampilan daftar" aria-pressed={view === "list"} onClick={() => setView("list")}><List /></Button>
          </div>
        </div>
      </div>

      {/* Active filter chips */}
      {hasFilters && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {tab !== "all" && (
            <Badge variant="secondary" className="gap-1 pr-1">{TABS.find((t) => t.key === tab)!.label}
              <button onClick={() => setTab("all")} className="rounded-full p-0.5 hover:bg-foreground/10" aria-label="Hapus filter status"><X className="size-3" /></button>
            </Badge>
          )}
          {category !== "all" && (
            <Badge variant="secondary" className="gap-1 pr-1">{category}
              <button onClick={() => setCategory("all")} className="rounded-full p-0.5 hover:bg-foreground/10" aria-label="Hapus filter kategori"><X className="size-3" /></button>
            </Badge>
          )}
          {dateRange !== 0 && (
            <Badge variant="secondary" className="gap-1 pr-1">{DATE_RANGES.find((d) => d.days === dateRange)!.label}
              <button onClick={() => setDateRange(0)} className="rounded-full p-0.5 hover:bg-foreground/10" aria-label="Hapus filter tanggal"><X className="size-3" /></button>
            </Badge>
          )}
          {search && (
            <Badge variant="secondary" className="gap-1 pr-1">&quot;{search}&quot;
              <button onClick={() => setSearch("")} className="rounded-full p-0.5 hover:bg-foreground/10" aria-label="Hapus pencarian"><X className="size-3" /></button>
            </Badge>
          )}
          <Button variant="ghost" size="sm" className="h-6 text-muted-foreground" onClick={resetFilters}>Bersihkan semua</Button>
        </div>
      )}

      {/* Selection bar OR result count */}
      {selected.size > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-primary/5 px-3 py-2">
          <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Pilih semua" />
          <span className="text-sm font-medium">{num(selected.size)} dipilih</span>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {canWrite && <Button variant="outline" size="sm" disabled={bulkPending} onClick={() => runBulk((ids) => bulkSetProductStatus(ids, "active"), "diaktifkan")}><CircleCheck /> Jadikan Aktif</Button>}
            {canWrite && <Button variant="outline" size="sm" disabled={bulkPending} onClick={() => runBulk((ids) => bulkSetProductStatus(ids, "draft"), "dijadikan draft")}><FileText /> Jadikan Draft</Button>}
            {canDelete && <Button variant="outline" size="sm" className="text-destructive" disabled={bulkPending} onClick={() => runBulk(bulkDeleteProducts, "dihapus")}><Trash2 /> Hapus</Button>}
            <Button variant="ghost" size="sm" disabled={bulkPending} onClick={clearSel}>Batal</Button>
          </div>
        </div>
      ) : (
        <p className="mb-3 text-xs text-muted-foreground">Menampilkan {num(filtered.length)} dari {num(products.length)} produk</p>
      )}

      {/* Content */}
      {filtered.length === 0 ? (
        <Card className="py-0">
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Package className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium">Tidak ada produk ditemukan</p>
            <p className="text-sm text-muted-foreground">Coba ubah kata kunci atau filter Anda.</p>
            {hasFilters && <Button variant="outline" size="sm" className="mt-2" onClick={resetFilters}>Bersihkan filter</Button>}
          </CardContent>
        </Card>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {filtered.map((p) => {
            const isSel = selected.has(p.id);
            return (
              <Card key={p.id} className={cn("group relative overflow-hidden py-0 transition-all hover:-translate-y-0.5 hover:shadow-md", isSel && "ring-2 ring-primary")}>
                <Link href={`/produk/${p.id}`} aria-label={p.name} className="absolute inset-0 z-[1] rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none" />
                {/* image */}
                <div className={cn("relative aspect-square", p.status === "draft" && "opacity-70")}>
                  <ProductThumb src={p.image} emoji={p.emoji} alt={p.name} className="absolute inset-0 size-full rounded-none" emojiClassName="text-5xl" />
                  <div className={cn("absolute left-1.5 top-1.5 z-[2] transition-opacity", isSel ? "opacity-100" : "opacity-0 group-hover:opacity-100")} onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={isSel} onCheckedChange={() => toggle(p.id)} aria-label={`Pilih ${p.name}`} className="border-2 bg-background/90 shadow-sm" />
                  </div>
                  <div className="absolute right-1.5 top-1.5 z-[2]"><RowActions id={p.id} /></div>
                  {p.status === "draft" && <Badge variant="outline" className="absolute bottom-1.5 left-1.5 z-[2] bg-background/85 text-[10px]">Draft</Badge>}
                </div>
                {/* body */}
                <div className="space-y-1 p-2.5">
                  <h3 className="truncate text-sm font-medium" title={p.name}>{p.name}</h3>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold tabular-nums">{IDR(p.price)}</span>
                    <StockBadge stock={p.stock} />
                  </div>
                  {p.weightMissing && <WeightWarning />}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="overflow-hidden py-0">
        <ResponsiveTable
          table={
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10"><Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Pilih semua" /></TableHead>
                  <TableHead>Produk</TableHead>
                  <TableHead className="hidden md:table-cell">Kategori</TableHead>
                  <TableHead className="text-right">Harga</TableHead>
                  <TableHead>Stok</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Terjual</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Ditambahkan</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p) => {
                  const isSel = selected.has(p.id);
                  return (
                    <TableRow key={p.id} data-state={isSel ? "selected" : undefined} className="cursor-pointer" onClick={() => router.push(`/produk/${p.id}`)}>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={isSel} onCheckedChange={() => toggle(p.id)} aria-label={`Pilih ${p.name}`} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <ProductThumb src={p.image} emoji={p.emoji} alt={p.name} className="size-9" />
                          <div className="min-w-0">
                            <p className="truncate font-medium">{p.name}</p>
                            <p className="text-xs text-muted-foreground md:hidden">{p.category}</p>
                            {p.weightMissing && <WeightWarning />}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{p.category}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{IDR(p.price)}</TableCell>
                      <TableCell><StockBadge stock={p.stock} /></TableCell>
                      <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{num(p.unitsSold)}</TableCell>
                      <TableCell><StatusBadge status={p.status} /></TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground tabular-nums whitespace-nowrap">{dateTimeShort(p.addedTs)}</TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}><RowActions id={p.id} /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          }
          cards={
              filtered.map((p) => (
                <DataCard
                  key={p.id}
                  href={`/produk/${p.id}`}
                  lead={
                    <Checkbox
                      checked={selected.has(p.id)}
                      onCheckedChange={() => toggle(p.id)}
                      aria-label={`Pilih ${p.name}`}
                    />
                  }
                  title={
                    <div className="flex min-w-0 items-center gap-2.5">
                      <ProductThumb src={p.image} emoji={p.emoji} alt={p.name} className="size-9 shrink-0" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{p.category}</p>
                      </div>
                    </div>
                  }
                  badge={<StatusBadge status={p.status} />}
                  actions={<RowActions id={p.id} />}
                >
                  <DataRow label="Harga" strong>{IDR(p.price)}</DataRow>
                  <DataRow label="Stok"><StockBadge stock={p.stock} /></DataRow>
                  <DataRow label="Terjual">{num(p.unitsSold)}</DataRow>
                  {p.weightMissing ? (
                    <DataRow label="Berat"><WeightWarning /></DataRow>
                  ) : null}
                </DataCard>
              ))
          }
        />
        </Card>
      )}
    </div>
  );
}
