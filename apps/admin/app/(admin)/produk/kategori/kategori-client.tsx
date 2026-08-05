"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,MoreHorizontal, Pencil, ExternalLink, Trash2,
  Zap, Hand, FolderTree,
} from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { num } from "@tokophi/lib/format";
import { useCan } from "@/components/admin/permissions";
import { toast } from "sonner";
import { deleteCollection } from "@/lib/actions/collections";
import { type Collection } from "@/lib/mock/store";

import { Card } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Badge } from "@tokophi/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@tokophi/ui/table";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator,
} from "@tokophi/ui/dropdown-menu";
import { SearchInput } from "@/components/admin/search-input";
import { ADMIN_LIST_PAGE_SIZE, ListPagination } from "@/components/admin/list-pagination";

function TypeBadge({ type }: { type: Collection["type"] }) {
  return type === "otomatis" ? (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <Zap className="size-3 text-primary" /> Otomatis
    </Badge>
  ) : (
    <Badge variant="secondary" className="gap-1">
      <Hand className="size-3" /> Manual
    </Badge>
  );
}

function StatusBadge({ published }: { published: boolean }) {
  return published ? (
    <Badge className="border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/50 dark:text-emerald-400">
      Terbit
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">Draft</Badge>
  );
}

function RowActions({ c, storefrontBase }: { c: Collection; storefrontBase: string }) {
  const canWrite = useCan("content:write");
  const router = useRouter();
  const [pending, start] = React.useTransition();
  // The live storefront page only resolves for a published category with a handle; a draft would 404.
  const storeUrl = c.published && c.handle && storefrontBase ? `${storefrontBase}/kategori/${c.handle}` : null;
  const del = () =>
    start(async () => {
      try {
        await deleteCollection(c.id);
        toast.success("Kategori dihapus.");
        router.refresh();
      } catch {
        toast.error("Gagal menghapus — coba lagi.");
      }
    });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Aksi kategori" />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem render={<Link href={`/produk/kategori/${c.id}`} />}><Pencil /> Edit</DropdownMenuItem>
        {storeUrl ? (
          <DropdownMenuItem render={<a href={storeUrl} target="_blank" rel="noopener noreferrer" />}>
            <ExternalLink /> Lihat di toko
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled className="opacity-60">
            <ExternalLink /> Lihat di toko
            <span className="ml-auto text-[10px] text-muted-foreground">{c.published ? "—" : "draft"}</span>
          </DropdownMenuItem>
        )}
        {canWrite && <DropdownMenuSeparator />}
        {canWrite && <DropdownMenuItem variant="destructive" disabled={pending} onClick={del}><Trash2 /> Hapus</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function KategoriClient({ collections, storefrontBase }: { collections: Collection[]; storefrontBase: string }) {
  const router = useRouter();
  const canWrite = useCan("content:write");
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return collections;
    return collections.filter((c) => c.name.toLowerCase().includes(q));
  }, [search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / ADMIN_LIST_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageCollections = filtered.slice((currentPage - 1) * ADMIN_LIST_PAGE_SIZE, currentPage * ADMIN_LIST_PAGE_SIZE);

  React.useEffect(() => {
    setPage(1);
  }, [search]);

  return (
    <div>
      <PageHeader title="Kategori" desc="Kelompokkan produk ke dalam koleksi yang tampil di toko.">
        {canWrite && (
          <Button nativeButton={false} render={<Link href="/produk/kategori/baru" />}>
            <Plus /> Buat kategori
          </Button>
        )}
      </PageHeader>

      {/* Helper: Otomatis vs Manual */}
      <div className="mb-4 flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 text-sm sm:flex-row sm:items-center sm:gap-6">
        <p className="flex items-center gap-2">
          <Zap className="size-4 shrink-0 text-primary" />
          <span className="text-muted-foreground"><span className="font-medium text-foreground">Otomatis</span> — produk masuk sendiri sesuai aturan (tag, harga, stok).</span>
        </p>
        <p className="flex items-center gap-2">
          <Hand className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground"><span className="font-medium text-foreground">Manual</span> — Anda pilih produk satu per satu.</span>
        </p>
      </div>

      {/* Search */}
      <SearchInput
        label="Cari kategori"
        value={search}
        onValueChange={setSearch}
        placeholder="Cari kategori…"
        className="mb-3 w-full sm:max-w-xs"
      />

      {/* Table */}
      {filtered.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <FolderTree className="size-8 text-muted-foreground" />
          {/* "Coba kata kunci lain" over a store that has never made a category is advice for a
              search nobody ran. Key on the unfiltered total. */}
          {collections.length === 0 ? (
            <>
              <p className="text-sm font-medium">Belum ada kategori</p>
              <p className="text-sm text-muted-foreground">Buat kategori pertama agar pembeli bisa menelusuri produk Anda per kelompok.</p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">Kategori tidak ditemukan</p>
              <p className="text-sm text-muted-foreground">Coba kata kunci lain.</p>
            </>
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[40%] px-4">Kategori</TableHead>
                <TableHead className="px-4 text-right">Jumlah produk</TableHead>
                <TableHead className="hidden px-4 sm:table-cell">Tipe</TableHead>
                <TableHead className="px-4">Status</TableHead>
                <TableHead className="w-12 px-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageCollections.map((c) => (
                <TableRow
                  key={c.id}
                  className="group cursor-pointer"
                  onClick={() => router.push(`/produk/kategori/${c.id}`)}
                >
                  <TableCell className="max-w-sm px-4 py-3.5">
                    <div className="flex items-center gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-xl">{c.emoji}</div>
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/produk/kategori/${c.id}`}
                          className="line-clamp-2 rounded-sm whitespace-normal break-words font-medium leading-5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          title={c.name}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {c.name}
                        </Link>
                        <p className="text-xs text-muted-foreground sm:hidden">
                          {c.type === "otomatis" ? "Otomatis" : "Manual"}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3.5 text-right tabular-nums">
                    <span className="font-medium">{num(c.products)}</span>
                    <span className="ml-1 text-xs text-muted-foreground">produk</span>
                  </TableCell>
                  <TableCell className="hidden px-4 py-3.5 sm:table-cell"><TypeBadge type={c.type} /></TableCell>
                  <TableCell className="px-4 py-3.5"><StatusBadge published={c.published} /></TableCell>
                  <TableCell
                    className="px-4 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <RowActions c={c} storefrontBase={storefrontBase} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ListPagination page={currentPage} total={filtered.length} unit="kategori" onPageChange={setPage} />
        </Card>
      )}
    </div>
  );
}
