"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateStock } from "@/lib/actions/inventory";
import { useCan } from "@/components/admin/permissions";
import {
  Boxes, Minus, Plus,AlertTriangle, PackageX, Warehouse, Download,
} from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { ProductThumb } from "@/components/admin/product-thumb";
import { IDR, num } from "@tokophi/lib/format";
import { type Product } from "@/lib/mock/store";
import { exportCsv } from "@/lib/csv";
import { cn } from "@tokophi/ui/lib/utils";

import { Card, CardContent } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Badge } from "@tokophi/ui/badge";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@tokophi/ui/table";
import { SearchInput } from "@/components/admin/search-input";
import { ADMIN_LIST_PAGE_SIZE, ListPagination } from "@/components/admin/list-pagination";

const LOW_STOCK = 20;

type TabKey = "all" | "low" | "out";

// Deterministic fabricated "incoming" units (stok masuk) — stable across SSR/client.
// Low-stock items tend to have restock on the way; some items have nothing incoming.
function incomingFor(p: Product, i: number): number {
  const base = ((i * 13 + 5) % 8) * 6; // 0..42, varied, some zeros
  return p.stock < LOW_STOCK ? base + 24 : base;
}

function StockStatusBadge({ qty }: { qty: number }) {
  if (qty <= 0) return <Badge variant="destructive">Habis</Badge>;
  if (qty < LOW_STOCK)
    return (
      <Badge className="border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-400">
        Menipis
      </Badge>
    );
  return (
    <Badge className="border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/50 dark:text-emerald-400">
      Tersedia
    </Badge>
  );
}

function StatCard({ icon, label, value, accent }: {
  icon: React.ReactNode; label: string; value: string; accent?: string;
}) {
  return (
    <Card className="py-0">
      <CardContent className="flex items-center gap-3 p-4">
        <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", accent ?? "bg-muted text-muted-foreground")}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold tabular-nums tracking-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function InventoriClient({ products }: { products: Product[] }) {
  const [search, setSearch] = React.useState("");
  const [tab, setTab] = React.useState<TabKey>("all");
  const [page, setPage] = React.useState(1);
  // Editable quantities kept in local state, seeded from the mock stock. Clamped at 0.
  const [qty, setQty] = React.useState<Record<string, number>>(() =>
    Object.fromEntries(products.map((p) => [p.id, p.stock])),
  );

  const setStock = (id: string, next: number) =>
    setQty((s) => ({ ...s, [id]: Math.max(0, Math.round(Number.isFinite(next) ? next : 0)) }));
  const bump = (id: string, delta: number) => setStock(id, (qty[id] ?? 0) + delta);

  // Persist only the rows whose stock the user changed.
  const router = useRouter();
  const canWrite = useCan("inventory:write");
  const [pending, startTransition] = React.useTransition();
  const changed = products.filter((p) => (qty[p.id] ?? 0) !== p.stock);
  const save = () => {
    if (!canWrite) { toast.error("Akses ditolak — peran Anda tidak bisa mengubah stok"); return; }
    if (!changed.length) return;
    startTransition(async () => {
      try {
        // Send the loaded value as `expected` so the server can skip rows a sale/PO changed since the
        // page opened, instead of overwriting them back up.
        const res = await updateStock(changed.map((p) => ({ productId: p.id, available: qty[p.id] ?? 0, expected: p.stock })));
        if (res.skipped > 0) {
          toast.warning(`${res.updated} stok diperbarui; ${res.skipped} dilewati karena berubah sejak halaman dibuka. Memuat ulang…`);
        } else {
          toast.success(`Stok ${res.updated} produk diperbarui`);
        }
        router.refresh();
      } catch {
        toast.error("Gagal memperbarui stok");
      }
    });
  };

  // Stats recompute live from the edited quantities (Total SKU is constant).
  const stats = React.useMemo(() => {
    let low = 0, out = 0, value = 0;
    for (const p of products) {
      const q = qty[p.id] ?? 0;
      if (q <= 0) out++;
      if (q < LOW_STOCK) low++;
      value += q * p.price;
    }
    return { total: products.length, low, out, value };
  }, [qty]);

  const counts = React.useMemo(() => ({
    all: products.length,
    low: products.filter((p) => (qty[p.id] ?? 0) < LOW_STOCK).length,
    out: products.filter((p) => (qty[p.id] ?? 0) <= 0).length,
  }), [qty]);

  const filtered = React.useMemo(() => {
    const s = search.trim().toLowerCase();
    return products.filter((p) => {
      const q = qty[p.id] ?? 0;
      if (tab === "low" && q >= LOW_STOCK) return false;
      if (tab === "out" && q > 0) return false;
      if (s && !p.name.toLowerCase().includes(s) && !p.id.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [search, tab, qty]);

  const TABS: { key: TabKey; label: string; count: number }[] = [
    { key: "all", label: "Semua", count: counts.all },
    { key: "low", label: "Menipis", count: counts.low },
    { key: "out", label: "Habis", count: counts.out },
  ];

  const pageCount = Math.max(1, Math.ceil(filtered.length / ADMIN_LIST_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageProducts = filtered.slice((currentPage - 1) * ADMIN_LIST_PAGE_SIZE, currentPage * ADMIN_LIST_PAGE_SIZE);

  // Reset ke halaman 1 saat filter berubah — DI RENDER, bukan di effect. Versi effect men-setState
  // sinkron setelah paint (react-hooks/set-state-in-effect): satu frame menampilkan halaman lama dari
  // filter baru, lalu render ulang. Pola resmi React "adjust state during render" (prev-tuple,
  // perbandingan Object.is yang sama dengan deps effect) memotong frame itu dan menghapus cascade.
  const [prevFilter, setPrevFilter] = React.useState([search, tab] as const);
  if (prevFilter.some((v, i) => !Object.is(v, ([search, tab] as const)[i]))) {
    setPrevFilter([search, tab] as const);
    setPage(1);
  }

  return (
    <div>
      <PageHeader title="Inventori" desc="Pantau dan sesuaikan stok produk Anda.">
        <Button
          variant="outline"
          onClick={() => exportCsv("inventori", products.map((p) => ({ Produk: p.name, Kategori: p.category, Stok: qty[p.id] ?? p.stock })))}
        >
          <Download /> Ekspor
        </Button>
        {canWrite && (
          <Button onClick={save} disabled={pending || changed.length === 0}>
            {pending ? "Menyimpan…" : changed.length ? `Simpan ${changed.length} perubahan` : "Simpan"}
          </Button>
        )}
      </PageHeader>

      {/* Stat cards */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<Boxes className="size-4" />} label="Total SKU" value={num(stats.total)} />
        <StatCard
          icon={<AlertTriangle className="size-4" />}
          label="Stok menipis"
          value={num(stats.low)}
          accent="bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
        />
        <StatCard
          icon={<PackageX className="size-4" />}
          label="Stok habis"
          value={num(stats.out)}
          accent="bg-destructive/10 text-destructive"
        />
        <StatCard
          icon={<Warehouse className="size-4" />}
          label="Nilai inventori"
          value={IDR(stats.value, { compact: true })}
        />
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
            <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", tab === t.key ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          label="Cari produk atau SKU"
          value={search}
          onValueChange={setSearch}
          placeholder="Cari nama produk atau SKU…"
          className="w-full sm:max-w-xs"
        />
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <Card className="py-0">
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Boxes className="size-8 text-muted-foreground" />
            {/* Same split as /produk: an empty catalog is not a search that missed. */}
            {products.length === 0 ? (
              <>
                <p className="text-sm font-medium">Belum ada produk untuk dipantau</p>
                <p className="text-sm text-muted-foreground">Stok muncul di sini setelah Anda menambahkan produk di menu Produk.</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">Tidak ada produk ditemukan</p>
                <p className="text-sm text-muted-foreground">Coba ubah kata kunci atau filter Anda.</p>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[40%] lg:w-[44%]">Produk</TableHead>
                <TableHead className="hidden sm:table-cell">SKU</TableHead>
                <TableHead className="text-center">Tersedia</TableHead>
                <TableHead className="hidden text-right md:table-cell">Masuk</TableHead>
                <TableHead>Status stok</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageProducts.map((p) => {
                const i = products.indexOf(p);
                const q = qty[p.id] ?? 0;
                const incoming = incomingFor(p, i);
                return (
                  <TableRow key={p.id}>
                    <TableCell className="max-w-[32rem] py-3.5">
                      <div className="flex items-start gap-3.5">
                        <ProductThumb src={p.image} emoji={p.emoji} alt={p.name} className="mt-0.5 size-10 shrink-0 rounded-md" />
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/produk/${p.number ?? p.id}`}
                            className="line-clamp-2 rounded-sm whitespace-normal break-words text-sm font-medium leading-5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            title={p.name}
                          >
                            {p.name}
                          </Link>
                          <p className="mt-1 line-clamp-2 whitespace-normal break-words text-xs leading-4 text-muted-foreground">{p.category}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden py-3.5 sm:table-cell">
                      <span className="font-mono text-xs text-muted-foreground">{p.id}</span>
                    </TableCell>
                    <TableCell className="py-3.5">
                      <div className="mx-auto flex w-fit items-center gap-1">
                        <Label htmlFor={`qty-${p.id}`} className="sr-only">Stok {p.name}</Label>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label={`Kurangi stok ${p.name}`}
                          disabled={q <= 0}
                          onClick={() => bump(p.id, -1)}
                        >
                          <Minus />
                        </Button>
                        <Input
                          id={`qty-${p.id}`}
                          inputMode="numeric"
                          value={q}
                          onChange={(e) => setStock(p.id, parseInt(e.target.value.replace(/\D/g, ""), 10) || 0)}
                          className="h-7 w-14 px-1 text-center text-sm tabular-nums"
                          aria-label={`Stok tersedia ${p.name}`}
                        />
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label={`Tambah stok ${p.name}`}
                          onClick={() => bump(p.id, 1)}
                        >
                          <Plus />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="hidden py-3.5 text-right tabular-nums text-muted-foreground md:table-cell">
                      {incoming > 0 ? `+${num(incoming)}` : "—"}
                    </TableCell>
                    <TableCell className="py-3.5"><StockStatusBadge qty={q} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <ListPagination page={currentPage} total={filtered.length} unit="produk" onPageChange={setPage} />
        </Card>
      )}
    </div>
  );
}
