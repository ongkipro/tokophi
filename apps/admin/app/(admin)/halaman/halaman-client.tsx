"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,ChevronDown,
  MoreHorizontal,
  Pencil,
  Trash2,
  FileText,
} from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { PageStatusBadge } from "@/components/admin/halaman/status-badge";
import { num } from "@tokophi/lib/format";
import { useCan } from "@/components/admin/permissions";
import { toast } from "sonner";
import { deletePage } from "@/lib/actions/pages";
import { type CmsPage } from "@/lib/mock/store";

import { Card, CardContent } from "@tokophi/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@tokophi/ui/table";
import { Button } from "@tokophi/ui/button";
import { Checkbox } from "@tokophi/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@tokophi/ui/dropdown-menu";
import { SearchInput } from "@/components/admin/search-input";

// ---- status filter ----
type StatusFilter = "semua" | "terbit" | "draft";

const STATUS_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: "semua", label: "Semua status" },
  { key: "terbit", label: "Terbit" },
  { key: "draft", label: "Draft" },
];

function daysAgoLabel(days: number): string {
  if (days <= 0) return "hari ini";
  if (days === 1) return "kemarin";
  return `${days} hari lalu`;
}

function RowActions({ id }: { id: string }) {
  const canWrite = useCan("content:write");
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const del = () =>
    start(async () => {
      try {
        await deletePage(id);
        toast.success("Halaman dihapus.");
        router.refresh();
      } catch {
        toast.error("Gagal menghapus — coba lagi.");
      }
    });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Aksi halaman">
            <MoreHorizontal />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem render={<Link href={`/halaman/${id}`} />}>
          <Pencil />
          Edit
        </DropdownMenuItem>
        {canWrite && <DropdownMenuSeparator />}
        {canWrite && (
          <DropdownMenuItem variant="destructive" disabled={pending} onClick={del}>
            <Trash2 />
            Hapus
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function HalamanClient({ pages }: { pages: CmsPage[] }) {
  const router = useRouter();
  const canWrite = useCan("content:write");
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<StatusFilter>("semua");

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return pages.filter((p: CmsPage) => {
      const matchesQuery =
        q === "" ||
        p.title.toLowerCase().includes(q) ||
        p.handle.toLowerCase().includes(q);
      const matchesStatus =
        status === "semua" ||
        (status === "terbit" ? p.published : !p.published);
      return matchesQuery && matchesStatus;
    });
  }, [query, status]);

  const statusLabel =
    STATUS_OPTIONS.find((o) => o.key === status)?.label ?? "Semua status";

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Halaman"
        desc="Kelola halaman statis toko seperti Tentang Kami, Kontak, dan Kebijakan."
      >
        {canWrite && (
          <Button nativeButton={false} render={<Link href="/halaman/baru" />}>
            <Plus />
            Tambah halaman
          </Button>
        )}
      </PageHeader>

      {/* Toolbar */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput
          label="Cari halaman"
          placeholder="Cari halaman…"
          className="flex-1"
          value={query}
          onValueChange={setQuery}
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                className="justify-between font-normal sm:w-44"
              >
                {statusLabel}
                <ChevronDown className="text-muted-foreground" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-44">
            {STATUS_OPTIONS.map((o) => (
              <DropdownMenuItem key={o.key} onClick={() => setStatus(o.key)}>
                {o.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Card className="py-0">
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 pl-4">
                  <Checkbox aria-label="Pilih semua" />
                </TableHead>
                <TableHead className="w-[34%]">Judul</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Template</TableHead>
                <TableHead className="text-right">Dilihat</TableHead>
                <TableHead>Terakhir diubah</TableHead>
                <TableHead className="w-10 pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow
                  key={p.id}
                  className="group cursor-pointer"
                  onClick={() => router.push(`/halaman/${p.id}`)}
                >
                  <TableCell
                    className="pl-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox aria-label={`Pilih ${p.title}`} />
                  </TableCell>
                  <TableCell className="max-w-sm">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <Link
                        href={`/halaman/${p.id}`}
                        className="line-clamp-2 whitespace-normal break-words font-semibold group-hover:underline"
                        title={p.title}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {p.title}
                      </Link>
                      <span className="truncate text-xs text-muted-foreground">
                        /pages/{p.handle}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <PageStatusBadge published={p.published} />
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs text-muted-foreground">
                      {p.template}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {num(p.views)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {daysAgoLabel(p.updatedDaysAgo)}
                  </TableCell>
                  <TableCell
                    className="pr-4 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <RowActions id={p.id} />
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <div className="flex flex-col items-center gap-2 py-12 text-center">
                      <FileText className="size-6 text-muted-foreground" />
                      {/* "cocok" implies a filter. A store with no pages at all never set one. */}
                      {pages.length === 0 ? (
                        <>
                          <p className="text-sm font-medium">Belum ada halaman</p>
                          <p className="text-sm text-muted-foreground">
                            Buat halaman seperti Tentang Kami atau Kebijakan Pengembalian agar pembeli percaya toko Anda.
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Tidak ada halaman yang cocok.
                        </p>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="mt-3 text-sm text-muted-foreground">
        {num(rows.length)} halaman
      </p>
    </div>
  );
}
