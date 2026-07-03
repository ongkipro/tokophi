"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  ChevronDown,
  MoreHorizontal,
  Pencil,
  Eye,
  Copy,
  Trash2,
  Settings2,
  MessageSquare,
  Newspaper,
} from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { num } from "@/lib/format";
import { BLOG_CATEGORIES, type BlogPost } from "@/lib/mock/store";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

import { BlogStatusBadge } from "@/components/admin/blog/status-badge";
import { AuthorCell } from "@/components/admin/blog/author-cell";

function daysAgoLabel(days: number) {
  if (days <= 0) return "hari ini";
  if (days === 1) return "kemarin";
  return `${num(days)} hari lalu`;
}

function RowActions({ id }: { id: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label="Aksi artikel" />}
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem render={<Link href={`/blog/${id}`} />}>
          <Pencil />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Eye />
          Lihat
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

export function BlogClient({ posts }: { posts: BlogPost[] }) {
  const router = useRouter();
  const [search, setSearch] = React.useState("");
  const [blog, setBlog] = React.useState<string>("all");

  const counts = React.useMemo(() => {
    const map: Record<string, number> = { all: posts.length };
    for (const c of BLOG_CATEGORIES) {
      map[c] = posts.filter((p) => p.blog === c).length;
    }
    return map;
  }, []);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return posts.filter((p) => {
      if (blog !== "all" && p.blog !== blog) return false;
      if (q && !p.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [search, blog]);

  return (
    <div>
      <PageHeader title="Blog" desc="Tulis artikel dan kelola blog toko Anda.">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" />}>
            <Settings2 />
            Kelola blog
            <ChevronDown className="text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>Blog</DropdownMenuLabel>
            {BLOG_CATEGORIES.map((c) => (
              <DropdownMenuItem key={c}>
                <Newspaper />
                {c}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <Plus />
              Buat blog baru
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button nativeButton={false} render={<Link href="/blog/baru" />}>
          <Plus />
          Tambah artikel
        </Button>
      </PageHeader>

      {/* Blog filter tabs */}
      <Tabs value={blog} onValueChange={(v) => setBlog(v as string)} className="mb-4">
        <TabsList>
          <TabsTrigger value="all">
            Semua
            <Badge variant="secondary" className="ml-1 tabular-nums">
              {num(counts.all)}
            </Badge>
          </TabsTrigger>
          {BLOG_CATEGORIES.map((c) => (
            <TabsTrigger key={c} value={c}>
              {c}
              <Badge variant="secondary" className="ml-1 tabular-nums">
                {num(counts[c] ?? 0)}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Toolbar */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari artikel…"
            className="pl-8"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card className="py-0">
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Newspaper className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium">Tidak ada artikel ditemukan</p>
            <p className="text-sm text-muted-foreground">
              Coba ubah kata kunci atau filter blog Anda.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox aria-label="Pilih semua" />
                </TableHead>
                <TableHead>Artikel</TableHead>
                <TableHead>Blog</TableHead>
                <TableHead>Penulis</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead className="text-right">Komentar</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow
                  key={p.id}
                  onClick={() => router.push(`/blog/${p.id}`)}
                  className="cursor-pointer"
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox aria-label={`Pilih ${p.title}`} />
                  </TableCell>
                  <TableCell className="max-w-sm">
                    <p className="truncate font-medium">{p.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {p.excerpt}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{p.blog}</Badge>
                  </TableCell>
                  <TableCell>
                    <AuthorCell name={p.author} />
                  </TableCell>
                  <TableCell>
                    <BlogStatusBadge published={p.published} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground tabular-nums whitespace-nowrap">
                    {daysAgoLabel(p.publishedDaysAgo)}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground tabular-nums">
                      <MessageSquare className="size-3.5" />
                      {num(p.comments)}
                    </span>
                  </TableCell>
                  <TableCell
                    className="text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <RowActions id={p.id} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        {num(filtered.length)} artikel
      </p>
    </div>
  );
}
