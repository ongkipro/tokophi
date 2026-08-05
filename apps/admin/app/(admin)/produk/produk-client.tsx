"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus, Upload,LayoutGrid, List, ChevronDown, MoreHorizontal,
  Pencil, Copy, Archive, Package, CheckCircle2, AlertTriangle, Tags, Check,
  ArrowUpDown, X, Trash2, CircleCheck, FileText, Calendar, Sparkles,
} from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { ProductThumb } from "@/components/admin/product-thumb";
import { IDR, num } from "@tokophi/lib/format";
import type { Product } from "@/lib/mock/store";
import { cn } from "@tokophi/ui/lib/utils";
import { toast } from "sonner";
import { bulkSetProductStatus, bulkDeleteProducts, duplicateProduct, deleteProduct } from "@/lib/actions/products";
import { useCan } from "@/components/admin/permissions";

import { Card, CardContent } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Badge } from "@tokophi/ui/badge";
import { Checkbox } from "@tokophi/ui/checkbox";
import { Separator } from "@tokophi/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@tokophi/ui/table";
import { ResponsiveTable, DataCard, DataRow } from "@/components/admin/responsive-table";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@tokophi/ui/dropdown-menu";
import { SearchInput } from "@/components/admin/search-input";
import { ADMIN_LIST_PAGE_SIZE, ListPagination } from "@/components/admin/list-pagination";
import { DateTimeCell } from "@/components/admin/date-time-cell";

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
    return <Badge className="px-2.5 py-1 border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-400">Menipis · {num(stock)}</Badge>;
  return <Badge className="px-2.5 py-1 border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/50 dark:text-emerald-400">Stok {num(stock)}</Badge>;
}

function StatusBadge({ status }: { status: Product["status"] }) {
  return status === "active"
    ? <Badge variant="secondary">Aktif</Badge>
    : <Badge variant="outline" className="text-muted-foreground">Draft</Badge>;
}

function ProductPrice({ product }: { product: Product }) {
  const prices = [...new Set(product.variants?.map((variant) => variant.price) ?? [product.price])].sort((a, b) => a - b);
  const first = prices[0] ?? product.price;
  const last = prices.at(-1) ?? first;
  return <span className="font-medium tabular-nums whitespace-nowrap">{first === last ? IDR(first) : `${IDR(first)} – ${IDR(last)}`}</span>;
}

function VariantLabel({ variant }: { variant: NonNullable<Product["variants"]>[number] }) {
  return [variant.option1, variant.option2, variant.option3].filter(Boolean).join(" · ") || variant.sku || "Varian standar";
}

// Google Product Category on the listing (ADR 0011): the leaf when set, an actionable amber nudge when
// not — an unclassified product is invisible to Google/Meta/TikTok feeds, so the seller should see it.
const leafOf = (path?: string) => (path ? path.split(" > ").pop()! : "");
function GoogleCatBadge({ path }: { path?: string }) {
  if (path)
    return (
      <Badge variant="outline" className="gap-1 font-normal text-muted-foreground" title={path}>
        <Sparkles className="size-3" /> {leafOf(path)}
      </Badge>
    );
  return (
    <Badge className="gap-1 border-amber-200 bg-amber-50 font-normal text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-400">
      <AlertTriangle className="size-3" /> Perlu kategori Google
    </Badge>
  );
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

function RowActions({ id, number }: { id: string; number?: number }) {
  const canDelete = useCan("products:delete");
  const canWrite = useCan("products:write");
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const dup = () =>
    start(async () => {
      const r = await duplicateProduct(id);
      if (r.ok) { toast.success("Produk diduplikat sebagai draft."); router.refresh(); }
      else toast.error(r.error ?? "Gagal menduplikat — coba lagi.");
    });
  const archive = () =>
    start(async () => {
      try {
        await deleteProduct(id);
        toast.success("Produk diarsipkan.");
        router.refresh();
      } catch {
        toast.error("Gagal mengarsipkan — coba lagi.");
      }
    });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Aksi produk" />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem render={<Link href={`/produk/${number ?? id}`} />}><Pencil /> Edit</DropdownMenuItem>
        {canWrite && <DropdownMenuItem disabled={pending} onClick={dup}><Copy /> Duplikat</DropdownMenuItem>}
        {canDelete && <DropdownMenuSeparator />}
        {canDelete && <DropdownMenuItem variant="destructive" disabled={pending} onClick={archive}><Archive /> Arsipkan</DropdownMenuItem>}
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

export function ProdukClient({ products, nowTs }: { products: Product[]; nowTs: number }) {
  const CATEGORIES = Array.from(new Set(products.map((p) => p.category)));
  const router = useRouter();
  const canWrite = useCan("products:write");
  const canDelete = useCan("products:delete");
  const [search, setSearch] = React.useState("");
  const [category, setCategory] = React.useState("all");
  const [tab, setTab] = React.useState<TabKey>("all");
  const [sort, setSort] = React.useState<SortKey>("unggulan");
  const [dateRange, setDateRange] = React.useState<number>(0);
  const [gcat, setGcat] = React.useState<"all" | "set" | "unset">("all"); // Google-taxonomy filter (feed health)
  const [view, setView] = React.useState<"grid" | "list">("list");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [page, setPage] = React.useState(1);
  const [expandedVariants, setExpandedVariants] = React.useState<Set<string>>(new Set());

  const counts = React.useMemo(() => ({
    all: products.length,
    active: products.filter((p) => p.status === "active").length,
    draft: products.filter((p) => p.status === "draft").length,
    low: products.filter((p) => p.stock < LOW_STOCK).length,
    noGcat: products.filter((p) => !p.googleCategoryPath).length,
  }), []);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const arr = products.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (category !== "all" && p.category !== category) return false;
      if (tab === "active" && p.status !== "active") return false;
      if (tab === "draft" && p.status !== "draft") return false;
      if (tab === "low" && p.stock >= LOW_STOCK) return false;
      // Real clock, from the server (see the note in page.tsx) — never the seed's frozen TODAY.
      if (dateRange > 0 && p.addedTs < nowTs - dateRange * 86_400_000) return false;
      if (gcat === "set" && !p.googleCategoryPath) return false;
      if (gcat === "unset" && p.googleCategoryPath) return false;
      return true;
    });
    const sorted = [...arr];
    if (sort === "nama") sorted.sort((a, b) => a.name.localeCompare(b.name, "id"));
    else if (sort === "harga-desc") sorted.sort((a, b) => b.price - a.price);
    else if (sort === "harga-asc") sorted.sort((a, b) => a.price - b.price);
    else if (sort === "stok-asc") sorted.sort((a, b) => a.stock - b.stock);
    else if (sort === "terlaris") sorted.sort((a, b) => b.unitsSold - a.unitsSold);
    return sorted;
  }, [search, category, tab, sort, dateRange, gcat, nowTs]);

  const TABS: { key: TabKey; label: string; count: number }[] = [
    { key: "all", label: "Semua", count: counts.all },
    { key: "active", label: "Aktif", count: counts.active },
    { key: "draft", label: "Draft", count: counts.draft },
    { key: "low", label: "Stok Menipis", count: counts.low },
  ];

  const pageCount = Math.max(1, Math.ceil(filtered.length / ADMIN_LIST_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageProducts = filtered.slice((currentPage - 1) * ADMIN_LIST_PAGE_SIZE, currentPage * ADMIN_LIST_PAGE_SIZE);

  React.useEffect(() => {
    setPage(1);
  }, [search, category, tab, sort, dateRange, gcat]);

  const toggle = (id: string) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleVariants = (id: string) =>
    setExpandedVariants((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
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
  const visibleIds = pageProducts.map((p) => p.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(visibleIds));

  const hasFilters = search !== "" || category !== "all" || tab !== "all" || dateRange !== 0 || gcat !== "all";
  const resetFilters = () => { setSearch(""); setCategory("all"); setTab("all"); setDateRange(0); setGcat("all"); };

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
        <SearchInput
          label="Cari produk"
          value={search}
          onValueChange={setSearch}
          placeholder="Cari produk…"
          className="w-full sm:max-w-xs"
        />
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

          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
              <Sparkles /> {gcat === "all" ? "Kategori Google" : gcat === "set" ? "Google: diatur" : "Google: belum"} <ChevronDown className="text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Kategori Google (feed)</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setGcat("all")}>Semua {gcat === "all" && <Check className="ml-auto" />}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setGcat("set")}>Sudah diatur {gcat === "set" && <Check className="ml-auto" />}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setGcat("unset")}>Belum diatur ({num(counts.noGcat)}) {gcat === "unset" && <Check className="ml-auto" />}</DropdownMenuItem>
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
          {gcat !== "all" && (
            <Badge variant="secondary" className="gap-1 pr-1">Kategori Google: {gcat === "set" ? "diatur" : "belum"}
              <button onClick={() => setGcat("all")} className="rounded-full p-0.5 hover:bg-foreground/10" aria-label="Hapus filter kategori Google"><X className="size-3" /></button>
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
      ) : null}

      {/* ⚠️ HEADING ORDER: the page `<h1>` is PageHeader's, and the grid cards below title
          themselves with `<h3>` — h1 → h3, a skipped level, and the only `h3` in the whole admin.
          Demoting the cards to `<h2>` would put repeated same-level headings under the page title with
          nothing naming the region they belong to; naming the region is the fix that carries
          information. `sr-only` because the visible result count above already says it in numbers.
          It sits OUTSIDE the grid/table branch on purpose — both views list the same products. */}
      <h2 className="sr-only">Daftar produk</h2>

      {/* Content */}
      {filtered.length === 0 ? (
        <Card className="py-0">
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Package className="size-8 text-muted-foreground" />
            {/* ⚠️ "no rows" and "no rows MATCHING" are two different facts. A store on its first day
                has zero products and no filter set, and was told to "ubah kata kunci atau filter" it
                had never touched — advice that cannot work, on the one screen where the next step is
                obvious. Key on the unfiltered total, not on `filtered`. */}
            {products.length === 0 ? (
              <>
                <p className="text-sm font-medium">Belum ada produk</p>
                <p className="text-sm text-muted-foreground">Tambahkan produk pertama agar toko Anda punya sesuatu untuk dijual.</p>
                {canWrite && (
                  <Button size="sm" className="mt-2" nativeButton={false} render={<Link href="/produk/baru" />}>
                    <Plus /> Tambah Produk
                  </Button>
                )}
              </>
            ) : (
              <>
                <p className="text-sm font-medium">Tidak ada produk ditemukan</p>
                <p className="text-sm text-muted-foreground">Coba ubah kata kunci atau filter Anda.</p>
                {hasFilters && <Button variant="outline" size="sm" className="mt-2" onClick={resetFilters}>Bersihkan filter</Button>}
              </>
            )}
          </CardContent>
        </Card>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {pageProducts.map((p) => {
            const isSel = selected.has(p.id);
            return (
              <Card key={p.id} className={cn("group relative overflow-hidden py-0 transition-all hover:-translate-y-0.5 hover:shadow-md", isSel && "ring-2 ring-primary")}>
                <Link href={`/produk/${p.number ?? p.id}`} aria-label={p.name} className="absolute inset-0 z-[1] rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none" />
                {/* image */}
                <div className={cn("relative aspect-square", p.status === "draft" && "opacity-70")}>
                  <ProductThumb src={p.image} emoji={p.emoji} alt={p.name} className="absolute inset-0 size-full rounded-none" emojiClassName="text-5xl" />
                  <div className={cn("absolute left-1.5 top-1.5 z-[2] transition-opacity", isSel ? "opacity-100" : "opacity-0 group-hover:opacity-100")} onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={isSel} onCheckedChange={() => toggle(p.id)} aria-label={`Pilih ${p.name}`} className="border-2 bg-background/90 shadow-sm" />
                  </div>
                  <div className="absolute right-1.5 top-1.5 z-[2]"><RowActions id={p.id} number={p.number} /></div>
                  {p.status === "draft" && <Badge variant="outline" className="absolute bottom-1.5 left-1.5 z-[2] bg-background/85 text-[10px]">Draft</Badge>}
                </div>
                {/* body */}
                <div className="space-y-1 p-2.5">
                  <h3 className="line-clamp-2 min-h-10 break-words text-sm font-medium" title={p.name}>{p.name}</h3>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold tabular-nums">{IDR(p.price)}</span>
                    <StockBadge stock={p.stock} />
                  </div>
                  <div className="flex"><GoogleCatBadge path={p.googleCategoryPath} /></div>
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
                  <TableHead className="w-12 px-4"><Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Pilih semua" /></TableHead>
                  <TableHead className="w-[42%] px-4 lg:w-[44%]">Produk</TableHead>
                  <TableHead className="hidden w-[14%] px-4 lg:table-cell">Kategori</TableHead>
                  <TableHead className="w-[10rem] px-4">Harga</TableHead>
                  <TableHead className="px-4">Stok</TableHead>
                  <TableHead className="hidden px-4 lg:table-cell">Terjual</TableHead>
                  <TableHead className="px-4">Status</TableHead>
                  <TableHead className="hidden px-4 xl:table-cell">Ditambahkan</TableHead>
                  <TableHead className="w-12 px-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageProducts.map((p) => {
                  const isSel = selected.has(p.id);
                  const hasMultipleVariants = (p.variants?.length ?? 0) > 1;
                  const variantsOpen = expandedVariants.has(p.id);
                  return (
                    <React.Fragment key={p.id}>
                      <TableRow data-state={isSel ? "selected" : undefined} className="cursor-pointer" onClick={() => router.push(`/produk/${p.number ?? p.id}`)}>
                        <TableCell className="px-4" onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={isSel} onCheckedChange={() => toggle(p.id)} aria-label={`Pilih ${p.name}`} />
                        </TableCell>
                        <TableCell className="max-w-[30rem] px-4 py-3.5">
                          <div className="flex items-start gap-3.5">
                            <ProductThumb src={p.image} emoji={p.emoji} alt={p.name} className="mt-0.5 size-10 shrink-0 rounded-md" />
                            <div className="min-w-0 flex-1">
                              <Link
                                href={`/produk/${p.number ?? p.id}`}
                                className="line-clamp-2 rounded-sm whitespace-normal break-words text-sm font-medium leading-5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                title={p.name}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {p.name}
                              </Link>
                              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                {!!p.number && <span className="tabular-nums">#{p.number}</span>}
                                <span className="lg:hidden">{p.category}</span>
                                {hasMultipleVariants && (
                                  <button
                                    type="button"
                                    className="inline-flex items-center gap-0.5 rounded-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    aria-expanded={variantsOpen}
                                    onClick={(event) => { event.stopPropagation(); toggleVariants(p.id); }}
                                  >
                                    {num(p.variants!.length)} varian <ChevronDown className={cn("size-3 transition-transform", variantsOpen && "rotate-180")} />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden px-4 py-3.5 lg:table-cell">
                          <p className="max-w-[10rem] whitespace-normal break-words text-sm leading-5 text-muted-foreground">{p.category}</p>
                        </TableCell>
                        <TableCell className="px-4 py-3.5"><ProductPrice product={p} /></TableCell>
                        <TableCell className="px-4 py-3.5"><StockBadge stock={p.stock} /></TableCell>
                        <TableCell className="hidden px-4 py-3.5 tabular-nums text-muted-foreground lg:table-cell">{num(p.unitsSold)}</TableCell>
                        <TableCell className="px-4 py-3.5"><StatusBadge status={p.status} /></TableCell>
                        <TableCell className="hidden px-4 py-3.5 text-sm text-muted-foreground xl:table-cell"><DateTimeCell value={p.addedTs} /></TableCell>
                        <TableCell className="px-4 text-right" onClick={(e) => e.stopPropagation()}><RowActions id={p.id} number={p.number} /></TableCell>
                      </TableRow>
                      {hasMultipleVariants && variantsOpen && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={9} className="px-4 py-3">
                            <div className="ml-14 grid max-w-3xl grid-cols-[minmax(10rem,1fr)_auto_auto] gap-x-6 gap-y-2 text-sm">
                              {p.variants!.map((variant, index) => (
                                <React.Fragment key={`${variant.sku ?? "varian"}-${index}`}>
                                  <span className="truncate text-muted-foreground">{VariantLabel({ variant })}</span>
                                  <span className="text-right font-medium tabular-nums whitespace-nowrap">{IDR(variant.price)}</span>
                                  <span className="text-right tabular-nums text-muted-foreground whitespace-nowrap">Stok {num(variant.stock)}</span>
                                </React.Fragment>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          }
          cards={
              pageProducts.map((p) => (
                <DataCard
                  key={p.id}
                  href={`/produk/${p.number ?? p.id}`}
                  lead={
                    <Checkbox
                      checked={selected.has(p.id)}
                      onCheckedChange={() => toggle(p.id)}
                      aria-label={`Pilih ${p.name}`}
                    />
                  }
                  title={
                    <div className="flex min-w-0 items-start gap-2.5">
                      <ProductThumb src={p.image} emoji={p.emoji} alt={p.name} className="mt-0.5 size-9 shrink-0 rounded-md" />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 whitespace-normal break-words text-sm font-medium leading-5" title={p.name}>{p.name}</p>
                        <p className="mt-1 line-clamp-2 whitespace-normal break-words text-xs leading-4 text-muted-foreground">{p.category}</p>
                      </div>
                    </div>
                  }
                  badge={<StatusBadge status={p.status} />}
                  actions={<RowActions id={p.id} number={p.number} />}
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
      {filtered.length > 0 && <ListPagination page={currentPage} total={filtered.length} unit="produk" onPageChange={setPage} />}
    </div>
  );
}
