"use client";

import * as React from "react";
import Link from "next/link";
import {
  Plus,
  Search,
  ChevronDown,
  MoreHorizontal,
  Pencil,
  ExternalLink,
  Copy,
  Trash2,
  FileText,
} from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { PageStatusBadge } from "@/components/admin/halaman/status-badge";
import { num } from "@/lib/format";
import { PAGES, type CmsPage } from "@/lib/mock/store";

import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

function RowActions({ handle }: { handle: string }) {
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
        <DropdownMenuItem render={<Link href="/halaman/baru" />}>
          <Pencil />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem
          render={
            <a
              href={`/pages/${handle}`}
              target="_blank"
              rel="noreferrer"
            />
          }
        >
          <ExternalLink />
          Lihat di toko
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Copy />
          Duplikat
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <Trash2 />
          Hapus
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function Page() {
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<StatusFilter>("semua");

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return PAGES.filter((p: CmsPage) => {
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
        <Button nativeButton={false} render={<Link href="/halaman/baru" />}>
          <Plus />
          Tambah halaman
        </Button>
      </PageHeader>

      {/* Toolbar */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Cari halaman…"
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
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
                <TableHead>Judul</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Template</TableHead>
                <TableHead className="text-right">Dilihat</TableHead>
                <TableHead>Terakhir diubah</TableHead>
                <TableHead className="w-10 pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id} className="group">
                  <TableCell className="pl-4">
                    <Checkbox aria-label={`Pilih ${p.title}`} />
                  </TableCell>
                  <TableCell>
                    <Link
                      href="/halaman/baru"
                      className="flex flex-col gap-0.5"
                    >
                      <span className="font-semibold group-hover:underline">
                        {p.title}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        /pages/{p.handle}
                      </span>
                    </Link>
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
                  <TableCell className="pr-4 text-right">
                    <RowActions handle={p.handle} />
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <div className="flex flex-col items-center gap-2 py-12 text-center">
                      <FileText className="size-6 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        Tidak ada halaman yang cocok.
                      </p>
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
