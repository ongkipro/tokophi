"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus, Search, MoreHorizontal, Pencil, ExternalLink, Trash2,
  Zap, Hand, FolderTree, Sparkles,
} from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { num } from "@/lib/format";
import { COLLECTIONS, type Collection } from "@/lib/mock/store";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

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

function RowActions({ id }: { id: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Aksi kategori" />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem render={<Link href={`/produk/kategori/${id}`} />}><Pencil /> Edit</DropdownMenuItem>
        <DropdownMenuItem><ExternalLink /> Lihat di toko</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive"><Trash2 /> Hapus</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function Page() {
  const router = useRouter();
  const [search, setSearch] = React.useState("");

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return COLLECTIONS;
    return COLLECTIONS.filter((c) => c.name.toLowerCase().includes(q));
  }, [search]);

  return (
    <div>
      <PageHeader title="Kategori" desc="Kelompokkan produk ke dalam koleksi yang tampil di toko.">
        <Button nativeButton={false} render={<Link href="/produk/kategori/baru" />}>
          <Plus /> Buat kategori
        </Button>
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
      <div className="relative mb-3 w-full sm:max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari kategori…" className="pl-8" />
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <FolderTree className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium">Kategori tidak ditemukan</p>
          <p className="text-sm text-muted-foreground">Coba kata kunci lain.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Kategori</TableHead>
                <TableHead className="text-right">Jumlah produk</TableHead>
                <TableHead className="hidden sm:table-cell">Tipe</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow
                  key={c.id}
                  className="group cursor-pointer"
                  onClick={() => router.push(`/produk/kategori/${c.id}`)}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-xl">{c.emoji}</div>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{c.name}</p>
                        <p className="text-xs text-muted-foreground sm:hidden">
                          {c.type === "otomatis" ? "Otomatis" : "Manual"}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className="font-medium">{num(c.products)}</span>
                    <span className="ml-1 text-xs text-muted-foreground">produk</span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell"><TypeBadge type={c.type} /></TableCell>
                  <TableCell><StatusBadge published={c.published} /></TableCell>
                  <TableCell
                    className="text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <RowActions id={c.id} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Footer */}
      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Sparkles className="size-3.5" />
        {num(filtered.length)} kategori
        {search && ` cocok dari ${num(COLLECTIONS.length)}`}
      </p>
    </div>
  );
}
