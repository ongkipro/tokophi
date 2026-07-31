"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Zap, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { useCan } from "@/components/admin/permissions";
import { toast } from "sonner";
import { deleteFlashSale } from "@/lib/actions/flash";
import type { FlashSaleRow } from "@/lib/data/flash";

import { Card, CardContent } from "@tokophi/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@tokophi/ui/table";
import { Badge } from "@tokophi/ui/badge";
import { Button } from "@tokophi/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@tokophi/ui/dropdown-menu";

const fmt = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const when = (iso: string) => fmt.format(new Date(iso));

function StatusBadge({ row }: { row: FlashSaleRow }) {
  if (row.isLive) return <Badge className="gap-1 bg-emerald-500/10 text-emerald-600"><span className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-500" />Berlangsung</Badge>;
  if (row.status === "nonaktif") return <Badge className="bg-muted text-muted-foreground">Nonaktif</Badge>;
  // Server-derived (`lib/data/flash.ts`), NOT `Date.now()` — the price is decided by this server's
  // clock, so the badge has to be too.
  if (row.isUpcoming) return <Badge className="bg-blue-500/10 text-blue-600">Terjadwal</Badge>;
  return <Badge className="bg-muted text-muted-foreground">Berakhir</Badge>;
}

function RowActions({ id }: { id: string }) {
  const canWrite = useCan("discounts:write");
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const del = () =>
    start(async () => {
      try { await deleteFlashSale(id); toast.success("Flash sale dihapus."); router.refresh(); }
      catch { toast.error("Gagal menghapus — coba lagi."); }
    });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Aksi flash sale"><MoreHorizontal /></Button>} />
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem render={<Link href={`/flash-sale/${id}`} />}><Pencil /> Edit</DropdownMenuItem>
        {canWrite && <DropdownMenuSeparator />}
        {canWrite && <DropdownMenuItem variant="destructive" disabled={pending} onClick={del}><Trash2 /> Hapus</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FlashSaleClient({ sales }: { sales: FlashSaleRow[] }) {
  const router = useRouter();
  const canWrite = useCan("discounts:write");
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Flash Sale" desc="Turunkan harga produk pilihan untuk waktu terbatas — harga otomatis kembali normal setelah periode berakhir.">
        {canWrite && (
          <Button nativeButton={false} render={<Link href="/flash-sale/baru" />}>
            <Plus /> Buat Flash Sale
          </Button>
        )}
      </PageHeader>

      <Card className="py-0">
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Nama</TableHead>
                <TableHead>Produk</TableHead>
                <TableHead>Mulai</TableHead>
                <TableHead>Berakhir</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10 pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.map((s) => (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => router.push(`/flash-sale/${s.id}`)}>
                  <TableCell className="pl-4 font-medium">{s.name}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{s.itemCount} produk</TableCell>
                  <TableCell className="text-sm tabular-nums">{when(s.startsAt)}</TableCell>
                  <TableCell className="text-sm tabular-nums">{when(s.endsAt)}</TableCell>
                  <TableCell><StatusBadge row={s} /></TableCell>
                  <TableCell className="pr-4 text-right" onClick={(e) => e.stopPropagation()}>
                    <RowActions id={s.id} />
                  </TableCell>
                </TableRow>
              ))}
              {sales.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <div className="flex flex-col items-center gap-2 py-12 text-center">
                      <Zap className="size-6 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Belum ada flash sale.</p>
                      {canWrite && (
                        <Button size="sm" nativeButton={false} render={<Link href="/flash-sale/baru" />}><Plus /> Buat yang pertama</Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
