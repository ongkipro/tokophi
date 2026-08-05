"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,MoreHorizontal,
  Pencil,
  Trash2,
  MessageSquare,
  Newspaper,
} from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { num } from "@tokophi/lib/format";
import { useCan } from "@/components/admin/permissions";
import { toast } from "sonner";
import { deleteArticle } from "@/lib/actions/articles";
import type { BlogPost } from "@/lib/mock/store";

import { Card, CardContent } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Badge } from "@tokophi/ui/badge";
import { Checkbox } from "@tokophi/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@tokophi/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@tokophi/ui/table";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@tokophi/ui/dropdown-menu";

import { BlogStatusBadge } from "@/components/admin/blog/status-badge";
import { AuthorCell } from "@/components/admin/blog/author-cell";
import { SearchInput } from "@/components/admin/search-input";
import { ADMIN_LIST_PAGE_SIZE, ListPagination } from "@/components/admin/list-pagination";

function daysAgoLabel(days: number) {
  if (days <= 0) return "hari ini";
  if (days === 1) return "kemarin";
  return `${num(days)} hari lalu`;
}

function RowActions({ id }: { id: string }) {
  const canWrite = useCan("content:write");
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const del = () =>
    start(async () => {
      try {
        await deleteArticle(id);
        toast.success("Artikel dihapus.");
        router.refresh();
      } catch {
        toast.error("Gagal menghapus — coba lagi.");
      }
    });
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

// `blogs` = this store's own `blogs.title` rows (lib/data/articles.ts `getBlogs`). It was the mock
// constant BLOG_CATEGORIES, which is the seed's demo pair — correct on one store, wrong on all others.
export function BlogClient({ posts, blogs }: { posts: BlogPost[]; blogs: string[] }) {
  const router = useRouter();
  const canWrite = useCan("content:write");
  const [search, setSearch] = React.useState("");
  const [blog, setBlog] = React.useState<string>("all");
  const [page, setPage] = React.useState(1);

  const counts = React.useMemo(() => {
    const map: Record<string, number> = { all: posts.length };
    for (const c of blogs) {
      map[c] = posts.filter((p) => p.blog === c).length;
    }
    return map;
  }, [posts, blogs]);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return posts.filter((p) => {
      if (blog !== "all" && p.blog !== blog) return false;
      if (q && !p.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [search, blog]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / ADMIN_LIST_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagePosts = filtered.slice((currentPage - 1) * ADMIN_LIST_PAGE_SIZE, currentPage * ADMIN_LIST_PAGE_SIZE);

  React.useEffect(() => {
    setPage(1);
  }, [search, blog]);

  return (
    <div>
      {/* The "Kelola blog" dropdown was removed: it had no backend (this app has ONE blog, not many),
          its category items duplicated the filter Tabs below, and "Buat blog baru" duplicated "Tambah
          artikel". Every item in it was a dead no-op. */}
      <PageHeader title="Blog" desc="Tulis artikel dan kelola blog toko Anda.">
        {canWrite && (
          <Button nativeButton={false} render={<Link href="/blog/baru" />}>
            <Plus />
            Tambah artikel
          </Button>
        )}
      </PageHeader>

      {/* Blog filter tabs */}
      <Tabs value={blog} onValueChange={(v) => setBlog(v as string)} className="mb-4">
        {/* Category count grows with the data, so this strip has no fixed width — it measured 388px
            and overflowed 360/390 phones (audit:responsive). It scrolls rather than squeezes: a
            category label crushed to "Ra…" is not a filter anyone can use. Same rule as the
            storefront gallery, and why the audit excuses horizontal scrollers. */}
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            <TabsTrigger value="all">
              Semua
              <Badge variant="secondary" className="ml-1 tabular-nums">
                {num(counts.all)}
              </Badge>
            </TabsTrigger>
            {blogs.map((c) => (
              <TabsTrigger key={c} value={c}>
                {c}
                <Badge variant="secondary" className="ml-1 tabular-nums">
                  {num(counts[c] ?? 0)}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>

      {/* Toolbar */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          label="Cari artikel"
          value={search}
          onValueChange={setSearch}
          placeholder="Cari artikel…"
          className="w-full sm:max-w-xs"
        />
      </div>

      {filtered.length === 0 ? (
        <Card className="py-0">
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Newspaper className="size-8 text-muted-foreground" />
            {/* An untouched blog is not a search that missed — do not send a new seller filter-hunting. */}
            {posts.length === 0 ? (
              <>
                <p className="text-sm font-medium">Belum ada artikel</p>
                <p className="text-sm text-muted-foreground">
                  Tulis artikel pertama — blog membantu toko Anda ditemukan lewat pencarian.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">Tidak ada artikel ditemukan</p>
                <p className="text-sm text-muted-foreground">
                  Coba ubah kata kunci atau filter blog Anda.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 px-4">
                  <Checkbox aria-label="Pilih semua" />
                </TableHead>
                <TableHead className="w-[34%] px-4">Artikel</TableHead>
                <TableHead className="px-4">Blog</TableHead>
                <TableHead className="px-4">Penulis</TableHead>
                <TableHead className="px-4">Status</TableHead>
                <TableHead className="px-4">Tanggal</TableHead>
                <TableHead className="px-4 text-right">Komentar</TableHead>
                <TableHead className="w-12 px-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagePosts.map((p) => (
                <TableRow
                  key={p.id}
                  onClick={() => router.push(`/blog/${p.id}`)}
                  className="cursor-pointer"
                >
                  <TableCell className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                    <Checkbox aria-label={`Pilih ${p.title}`} />
                  </TableCell>
                  <TableCell className="w-[34%] max-w-sm px-4 py-3.5">
                    <Link
                      href={`/blog/${p.id}`}
                      className="line-clamp-2 rounded-sm whitespace-normal break-words font-medium leading-5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title={p.title}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {p.title}
                    </Link>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {p.excerpt}
                    </p>
                  </TableCell>
                  <TableCell className="px-4 py-3.5">
                    <Badge variant="outline">{p.blog}</Badge>
                  </TableCell>
                  <TableCell className="px-4 py-3.5">
                    <AuthorCell name={p.author} />
                  </TableCell>
                  <TableCell className="px-4 py-3.5">
                    <BlogStatusBadge published={p.published} />
                  </TableCell>
                  <TableCell className="px-4 py-3.5 text-sm text-muted-foreground tabular-nums whitespace-nowrap">
                    {daysAgoLabel(p.publishedDaysAgo)}
                  </TableCell>
                  <TableCell className="px-4 py-3.5 text-right">
                    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground tabular-nums">
                      <MessageSquare className="size-3.5" />
                      {num(p.comments)}
                    </span>
                  </TableCell>
                  <TableCell
                    className="px-4 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <RowActions id={p.id} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ListPagination page={currentPage} total={filtered.length} unit="artikel" onPageChange={setPage} />
        </Card>
      )}
    </div>
  );
}
