"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createArticle, updateArticle, deleteArticle, type ArticleInput } from "@/lib/actions/articles";
import { uploadMedia, getMedia } from "@/lib/actions/media";
import { useCan } from "@/components/admin/permissions";
import { ArrowLeft, ImageUp, ChevronDown, Newspaper, Trash2 } from "lucide-react";

import { BLOG_CATEGORIES, type BlogPost } from "@/lib/mock/store";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Badge } from "@tokophi/ui/badge";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Textarea } from "@tokophi/ui/textarea";
import { Switch } from "@tokophi/ui/switch";
import { RichTextEditor } from "@tokophi/ui/rich-text-editor";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@tokophi/ui/dropdown-menu";

const META_LIMIT = 160;


export function ArticleEditor({ post }: { post?: BlogPost }) {
  const isEdit = Boolean(post);
  const canWrite = useCan("content:write");

  const [title, setTitle] = React.useState(post?.title ?? "");
  // The REAL body. This used to be `${post.excerpt}\n\n${post.title}` — a fabrication, because the
  // read layer never selected `body`. Since every save writes this field, opening an article and
  // pressing Simpan replaced the merchant's text with two lines of summary (the demo's
  // `cara-merawat-rajut` would have gone from 908 characters to 60). Do not "default" this again.
  const [body, setBody] = React.useState(post?.body ?? "");
  const [imageUrl, setImageUrl] = React.useState(post?.imageUrl ?? "");
  const [excerpt, setExcerpt] = React.useState(post?.excerpt ?? "");
  const [author, setAuthor] = React.useState(post?.author ?? "Ongki Pratama");
  const [published, setPublished] = React.useState(post?.published ?? false);
  const [blog, setBlog] = React.useState<string>(post?.blog ?? BLOG_CATEGORIES[0]);
  const [handle, setHandle] = React.useState(post?.handle ?? "");
  const [metaDesc, setMetaDesc] = React.useState("");

  // ---- featured image ----
  // Goes through `uploadMedia`, the SAME action the Files library uses: one upload path means one set
  // of rules (WebP conversion, the 2 MB gate, the media row) and no second copy to drift from it. The
  // client checks below are UX — image-store.ts's checkFile is the boundary and re-checks both.
  const imgInputRef = React.useRef<HTMLInputElement>(null);
  const [imgBusy, setImgBusy] = React.useState(false);
  const pickImage = async (f?: File) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) { toast.error(`${f.name}: bukan gambar.`); return; }
    if (f.size > 2 * 1024 * 1024) { toast.error(`${f.name}: melebihi 2MB (${(f.size / 1048576).toFixed(1)}MB).`); return; }
    setImgBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await uploadMedia(fd);
      // `uploadMedia` returns ok/error rather than the saved row, so read the url back from the
      // library. Requesting the change to the action would be cleaner; this keeps the blast radius
      // of a blog fix inside blog.
      if (!r.ok) { toast.error(r.error ?? "Gagal mengunggah."); return; }
      const media = await getMedia();
      const newest = media[0];
      if (!newest) { toast.error("Gambar terunggah tapi tidak ditemukan di Files."); return; }
      setImageUrl(newest.url);
      toast.success("Gambar diunggah (WebP) — juga tersimpan di Files.");
    } finally {
      setImgBusy(false);
    }
  };

  const exampleTags = ["promo", "tips", "fashion"];

  const topBarTitle = isEdit
    ? title || "Tanpa judul"
    : title || "Artikel baru";

  // ---- persist ----
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const slugFallback = title.trim().toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const buildInput = (): ArticleInput => ({
    title: title.trim(),
    handle: handle.trim() || slugFallback,
    body,
    excerpt,
    author,
    imageUrl,
    published,
  });
  const handleSave = () => {
    if (!canWrite) {
      toast.error("Akses ditolak — peran Anda tidak bisa mengubah artikel");
      return;
    }
    if (!title.trim()) {
      toast.error("Judul artikel wajib diisi");
      return;
    }
    startTransition(async () => {
      try {
        if (isEdit && post) {
          await updateArticle(post.id, buildInput());
          toast.success("Artikel disimpan");
        } else {
          await createArticle(buildInput());
          toast.success("Artikel dibuat");
        }
        router.push("/blog");
        router.refresh();
      } catch {
        toast.error("Gagal menyimpan artikel");
      }
    });
  };
  const handleDelete = () => {
    if (!post) return;
    startTransition(async () => {
      try {
        await deleteArticle(post.id);
        toast.success("Artikel dihapus");
        router.push("/blog");
        router.refresh();
      } catch {
        toast.error("Gagal menghapus artikel");
      }
    });
  };

  return (
    <div>
      {/* Top bar */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <Link
            href="/blog"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Blog
          </Link>
          <h1 className="text-xl font-semibold tracking-tight">{topBarTitle}</h1>
        </div>
        <div className="flex items-center gap-2">
          {isEdit && canWrite && (
            <Button variant="outline" className="text-destructive hover:text-destructive" onClick={handleDelete} disabled={pending}>
              <Trash2 />
              Hapus artikel
            </Button>
          )}
          <Button nativeButton={false} variant="ghost" render={<Link href="/blog" />}>
            Batal
          </Button>
          {canWrite && <Button onClick={handleSave} disabled={pending}>{pending ? "Menyimpan…" : "Simpan"}</Button>}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* MAIN */}
        <div className="flex flex-col gap-5 lg:col-span-2">
          <Card>
            <CardContent className="flex flex-col gap-5">
              <div className="grid gap-2">
                <Label htmlFor="judul">Judul</Label>
                <Input
                  id="judul"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Contoh: 5 Tips Belanja Online yang Aman"
                  className="md:text-base"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="konten">Konten</Label>
                <RichTextEditor
                  value={body}
                  onChange={setBody}
                  placeholder="Tulis isi artikel Anda di sini…"
                  disabled={!canWrite}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="excerpt">Kutipan</Label>
                <Textarea
                  id="excerpt"
                  rows={3}
                  value={excerpt}
                  onChange={(e) => setExcerpt(e.target.value)}
                  placeholder="Ringkasan singkat artikel…"
                />
                <p className="text-xs text-muted-foreground">
                  Ringkasan singkat yang tampil di daftar artikel.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* SEO */}
          <Card>
            <CardHeader>
              <CardTitle>Pratinjau mesin pencari</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {/* Google preview */}
              <div className="max-w-2xl rounded-lg border bg-background p-3">
                <p className="truncate text-xs text-muted-foreground">
                  tokoanda.com › blogs › {blog.toLowerCase().replace(/\s+/g, "-")}{" "}
                  › {handle || "judul-artikel"}
                </p>
                <p className="mt-0.5 truncate text-sm font-medium text-[#1a0dab] dark:text-blue-400">
                  {title || "Judul artikel Anda"} - Toko Anda
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {metaDesc ||
                    "Deskripsi meta akan tampil di sini sebagai cuplikan hasil pencarian Google."}
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="seo-judul">Judul SEO</Label>
                <Input id="seo-judul" placeholder="Judul untuk mesin pencari" />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="seo-desc">Deskripsi meta</Label>
                <Textarea
                  id="seo-desc"
                  rows={3}
                  maxLength={META_LIMIT}
                  value={metaDesc}
                  onChange={(e) => setMetaDesc(e.target.value)}
                  placeholder="Ringkasan yang muncul di hasil pencarian…"
                />
                <p className="text-right text-xs text-muted-foreground tabular-nums">
                  {metaDesc.length}/{META_LIMIT}
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="handle">Handle URL</Label>
                <div className="flex items-center rounded-md border bg-muted/30 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
                  <span className="pl-3 text-sm text-muted-foreground whitespace-nowrap">
                    /blogs/…/
                  </span>
                  <Input
                    id="handle"
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    placeholder="judul-artikel"
                    className="border-0 bg-transparent pl-1 shadow-none focus-visible:border-0 focus-visible:ring-0"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* SIDEBAR */}
        <div className="flex flex-col gap-5">
          {/* Visibilitas */}
          <Card>
            <CardHeader>
              <CardTitle>Visibilitas</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="terbit">Terbitkan artikel</Label>
                <Switch
                  id="terbit"
                  checked={published}
                  onCheckedChange={setPublished}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {published
                  ? "Terbit dan tampil di toko."
                  : "Disimpan sebagai draft — belum tampil di toko."}
              </p>
            </CardContent>
          </Card>

          {/* Organisasi */}
          <Card>
            <CardHeader>
              <CardTitle>Organisasi</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-2">
                <Label>Blog</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="outline"
                        className="w-full justify-between font-normal"
                      />
                    }
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Newspaper className="size-4 text-muted-foreground" />
                      {blog}
                    </span>
                    <ChevronDown className="text-muted-foreground" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[--anchor-width]">
                    {BLOG_CATEGORIES.map((c) => (
                      <DropdownMenuItem key={c} onClick={() => setBlog(c)}>
                        {c}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="penulis">Penulis</Label>
                <Input
                  id="penulis"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="tag">Tag</Label>
                <Input id="tag" placeholder="Pisahkan dengan koma" />
                <div className="flex flex-wrap gap-1.5">
                  {exampleTags.map((t) => (
                    <Badge key={t} variant="secondary">
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Gambar unggulan — REAL now. This card used to be a <button> with no onClick, no input
              and no handler: a dead control that also promised "hingga 5 MB" while the server's
              actual cap is 2 MB (image-store.ts MAX_BYTES). It shipped for as long as it did because
              nothing about it looks broken until you press it. It now uploads through the SAME
              `uploadMedia` action as the Files library, so an article image lands in the merchant's
              media library like every other image, converted to WebP by the one pipeline. */}
          <Card>
            <CardHeader>
              <CardTitle>Gambar unggulan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {imageUrl ? (
                <div className="space-y-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- /api/uploads is served by
                      a route handler, not the image optimizer's allowed loaders. */}
                  <img
                    src={imageUrl}
                    alt=""
                    className="aspect-[3/2] w-full rounded-lg object-cover ring-1 ring-border"
                  />
                  <div className="flex gap-2">
                    <Button type="button" variant="secondary" size="sm" disabled={!canWrite || imgBusy} onClick={() => imgInputRef.current?.click()}>
                      Ganti
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={!canWrite || imgBusy} onClick={() => setImageUrl("")}>
                      Hapus
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={!canWrite || imgBusy}
                  onClick={() => imgInputRef.current?.click()}
                  className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center transition-colors hover:border-ring hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <ImageUp className="size-6 text-muted-foreground" />
                  <span className="text-sm font-medium">
                    {imgBusy ? "Mengunggah…" : "Klik untuk unggah gambar"}
                  </span>
                  {/* The number is the SERVER's, not a nicer-sounding one. It used to say 5 MB. */}
                  <span className="text-xs text-muted-foreground">
                    PNG, JPG, WEBP, atau SVG — maks. 2 MB. Otomatis jadi WebP.
                  </span>
                </button>
              )}
              <input
                ref={imgInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { pickImage(e.target.files?.[0]); e.target.value = ""; }}
              />
              <p className="text-xs text-muted-foreground">
                Tampil di kartu artikel (Jurnal) dan di halaman artikel. Gambar juga masuk ke Files.
              </p>
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}
