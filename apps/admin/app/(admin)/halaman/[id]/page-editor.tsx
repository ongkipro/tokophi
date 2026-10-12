"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createPage, updatePage, deletePage, type PageInput } from "@/lib/actions/pages";
import { useCan } from "@/components/admin/permissions";
import { ArrowLeft, ChevronDown, Check, Globe, Trash2 } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Textarea } from "@tokophi/ui/textarea";
import { RichTextEditor } from "@tokophi/ui/rich-text-editor";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@tokophi/ui/dropdown-menu";
import { type CmsPage } from "@/lib/types/domain";

// ---- helpers ----
function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

const TEMPLATE_OPTIONS: { value: string; label: string }[] = [
  { value: "page", label: "page" },
  { value: "page.contact", label: "page.contact" },
  { value: "page.full-width", label: "page.full-width" },
];

// REMOVED (Task 5.16): `seedBody(title)`, which manufactured "Selamat datang di halaman <judul>…"
// from the page title. It was already unreachable — the editor initialises from `page.body ?? ""`
// — but a function whose whole purpose is to fabricate body text sitting one call away from the
// edit path is a loaded gun: wiring it back would make opening an EMPTY page show invented prose,
// and pressing Simpan would persist it over the merchant's deliberate emptiness. An empty page is a
// choice (the storefront already renders `page.body.trim() ? <Prose/> : …`), not a gap to fill.

const TITLE_LIMIT = 100;
const SEO_TITLE_LIMIT = 70;
const META_LIMIT = 160; // hard cap; 120–155 is the ideal window (see metaTone below)

// Char-counter colour for the plain title fields: muted, amber near the cap, red at it.
const counterClass = (len: number, max: number) =>
  len >= max ? "text-red-500" : len >= max * 0.9 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground";

export function PageEditor({ page }: { page?: CmsPage }) {
  const isEdit = Boolean(page);
  const canWrite = useCan("content:write");

  const [title, setTitle] = React.useState(page?.title ?? "");
  const [handle, setHandle] = React.useState(page?.handle ?? "");
  const [handleEdited, setHandleEdited] = React.useState(Boolean(page));
  const [body, setBody] = React.useState(page ? page.body ?? "" : "");
  const [published, setPublished] = React.useState(page?.published ?? true);
  const [template, setTemplate] = React.useState(page?.template ?? "page");
  const [seoTitle, setSeoTitle] = React.useState("");
  const [metaDesc, setMetaDesc] = React.useState("");

  // Keep handle synced with the title until the user edits it manually.
  const effectiveHandle = handleEdited ? handle : slugify(title);
  const previewTitle = seoTitle || title || "Judul halaman";
  const previewHandle = effectiveHandle || "handle";
  const previewDesc =
    metaDesc ||
    "Tambahkan deskripsi meta agar cuplikan ini menarik di hasil pencarian.";

  // ---- persist ----
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const buildInput = (): PageInput => ({
    title: title.trim(),
    handle: effectiveHandle,
    body,
    published,
    template,
  });
  const handleSave = () => {
    if (!canWrite) {
      toast.error("Akses ditolak — peran Anda tidak bisa mengubah halaman");
      return;
    }
    if (!title.trim()) {
      toast.error("Judul halaman wajib diisi");
      return;
    }
    startTransition(async () => {
      try {
        if (isEdit && page) {
          // Read the outcome. A page deleted in another tab (or one that was never this store's —
          // RLS filters it out with no error) matches zero rows, and announcing "disimpan" over
          // that is how a merchant loses an afternoon's writing believing it is safe.
          const res = await updatePage(page.id, buildInput());
          if (!res.ok) {
            toast.error(res.error ?? "Gagal menyimpan halaman");
            router.refresh();
            return;
          }
          toast.success("Halaman disimpan");
        } else {
          await createPage(buildInput());
          toast.success("Halaman dibuat");
        }
        router.push("/halaman");
        router.refresh();
      } catch {
        toast.error("Gagal menyimpan halaman");
      }
    });
  };
  const handleDelete = () => {
    if (!page) return;
    startTransition(async () => {
      try {
        const res = await deletePage(page.id);
        if (!res.ok) {
          toast.error(res.error ?? "Gagal menghapus halaman");
          router.refresh();
          return;
        }
        toast.success("Halaman dihapus");
        router.push("/halaman");
        router.refresh();
      } catch {
        toast.error("Gagal menghapus halaman");
      }
    });
  };

  const metaLen = metaDesc.length;
  const metaTone =
    metaLen === 0
      ? "text-muted-foreground"
      : metaLen < 120
        ? "text-amber-600 dark:text-amber-400"
        : metaLen <= 155
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-destructive";

  const topBarTitle = isEdit ? title || "Tanpa judul" : "Tambah halaman";

  return (
    <div className="mx-auto max-w-5xl">
      {/* Top bar */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Link
            href="/halaman"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Halaman
          </Link>
          {/* ⚠️ UNCONDITIONAL. This was `{isEdit && …}`, so `/halaman/baru` — the CREATE screen —
              shipped with no `<h1>` at all: no top-level heading for a screen reader to land on, and
              the only page in the admin without one (measured: all 40 admin routes crawled). The
              value was already there; `topBarTitle` computes "Tambah halaman" for exactly this case,
              so the guard was hiding a string it had already built. `article-editor.tsx` next door
              renders its own unconditionally — the two had simply diverged. */}
          <h1 className="line-clamp-2 break-words text-lg font-semibold tracking-tight" title={topBarTitle}>{topBarTitle}</h1>
        </div>
        <div className="flex items-center gap-2">
          {isEdit && canWrite && (
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={handleDelete} disabled={pending}>
              <Trash2 />
              Hapus halaman
            </Button>
          )}
          <Button nativeButton={false} variant="ghost" render={<Link href="/halaman" />}>
            Batal
          </Button>
          {canWrite && <Button onClick={handleSave} disabled={pending}>{pending ? "Menyimpan…" : "Simpan"}</Button>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* MAIN column */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="judul">Judul</Label>
                  <span className={`text-xs tabular-nums ${counterClass(title.length, TITLE_LIMIT)}`}>
                    {title.length}/{TITLE_LIMIT}
                  </span>
                </div>
                <Input
                  id="judul"
                  placeholder="mis. Tentang Kami"
                  value={title}
                  maxLength={TITLE_LIMIT}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="konten">Konten</Label>
                <RichTextEditor
                  value={body}
                  onChange={setBody}
                  placeholder="Tulis isi halaman di sini…"
                  disabled={!canWrite}
                />
              </div>
            </CardContent>
          </Card>

          {/* SEO */}
          <Card>
            <CardHeader>
              <CardTitle>Pratinjau mesin pencari</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {/* Google-style preview */}
              <div className="max-w-2xl rounded-md border border-border bg-background p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Globe className="size-3" />
                  <span className="truncate text-emerald-700 dark:text-emerald-500">
                    tokophi.id › pages › {previewHandle}
                  </span>
                </div>
                <p className="mt-1 truncate text-base font-medium text-blue-700 dark:text-blue-400">
                  {previewTitle}
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {previewDesc}
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="seo-title">Judul halaman (SEO)</Label>
                  <span className={`text-xs tabular-nums ${counterClass(seoTitle.length, SEO_TITLE_LIMIT)}`}>
                    {seoTitle.length}/{SEO_TITLE_LIMIT}
                  </span>
                </div>
                <Input
                  id="seo-title"
                  placeholder={title || "mis. Tentang Kami"}
                  value={seoTitle}
                  maxLength={SEO_TITLE_LIMIT}
                  onChange={(e) => setSeoTitle(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="seo-desc">Deskripsi meta</Label>
                  <span className={`text-xs tabular-nums ${metaTone}`}>
                    {metaLen} / {META_LIMIT}
                  </span>
                </div>
                <Textarea
                  id="seo-desc"
                  placeholder="Ringkasan singkat yang muncul di hasil pencarian."
                  className="min-h-20"
                  value={metaDesc}
                  maxLength={META_LIMIT}
                  onChange={(e) => setMetaDesc(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Idealnya 120–155 karakter.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="handle">URL &amp; handle</Label>
                <div className="flex items-center rounded-md border border-input focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
                  <span className="pl-2.5 text-sm text-muted-foreground">
                    /pages/
                  </span>
                  <Input
                    id="handle"
                    value={effectiveHandle}
                    onChange={(e) => {
                      setHandleEdited(true);
                      setHandle(slugify(e.target.value));
                    }}
                    placeholder="handle"
                    className="border-0 pl-1 focus-visible:ring-0"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* SIDEBAR column */}
        <div className="flex flex-col gap-4">
          {/* Visibilitas */}
          <Card>
            <CardHeader>
              <CardTitle>Visibilitas</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="inline-flex rounded-md border border-input p-0.5">
                <button
                  type="button"
                  onClick={() => setPublished(true)}
                  className={`flex-1 rounded-[6px] px-3 py-1.5 text-sm font-medium transition-colors ${
                    published
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Terbit
                </button>
                <button
                  type="button"
                  onClick={() => setPublished(false)}
                  className={`flex-1 rounded-[6px] px-3 py-1.5 text-sm font-medium transition-colors ${
                    !published
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Draft
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {published
                  ? "Akan terbit segera setelah disimpan."
                  : "Disimpan sebagai draft — tidak tampil di toko."}
              </p>
            </CardContent>
          </Card>

          {/* Template tema */}
          <Card>
            <CardHeader>
              <CardTitle>Template tema</CardTitle>
            </CardHeader>
            <CardContent>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline"
                      className="w-full justify-between font-mono text-xs font-normal"
                    >
                      {template}
                      <ChevronDown className="text-muted-foreground" />
                    </Button>
                  }
                />
                <DropdownMenuContent className="w-(--anchor-width)">
                  {TEMPLATE_OPTIONS.map((o) => (
                    <DropdownMenuItem
                      key={o.value}
                      onClick={() => setTemplate(o.value)}
                      className="font-mono text-xs"
                    >
                      {o.value === template ? (
                        <Check className="text-emerald-500" />
                      ) : (
                        <span className="size-4" />
                      )}
                      {o.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}
