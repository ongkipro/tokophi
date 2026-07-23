"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createCollection, updateCollection, deleteCollection, type CollectionInput } from "@/lib/actions/collections";
import { uploadMedia, getMedia } from "@/lib/actions/media";
import { useCan } from "@/components/admin/permissions";
import {
  ChevronLeft,
  ChevronDown,
  Bold,
  Italic,
  List,
  Link2,
  ImagePlus,
  ImageUp,
  Plus,
  Trash2,
  X,
  Search,
  Hand,
  Zap,
} from "lucide-react";

import { type CollectionDetail, type Product } from "@/lib/mock/store";
import { ProductThumb } from "@/components/admin/product-thumb";
import { IDR, num } from "@tokophi/lib/format";
import { cn } from "@tokophi/ui/lib/utils";
import { toast } from "sonner";

import { Card, CardHeader, CardTitle, CardContent } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Badge } from "@tokophi/ui/badge";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Textarea } from "@tokophi/ui/textarea";
import { Switch } from "@tokophi/ui/switch";
import { Separator } from "@tokophi/ui/separator";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@tokophi/ui/dropdown-menu";

// Slugify a title into a URL handle.
const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

// UI label ↔ DB enum (condition_field / condition_operator). The editor speaks Indonesian; the DB
// speaks enums — map at the boundary (on load and on save) so a saved rule round-trips exactly.
const FIELD_ENUM: Record<string, string> = {
  "Tag produk": "tag", "Judul produk": "title", "Tipe produk": "type",
  "Harga": "price", "Stok": "stock", "Kategori": "category",
};
const OP_ENUM: Record<string, string> = {
  "sama dengan": "eq", "tidak sama dengan": "neq", "lebih dari": "gt",
  "kurang dari": "lt", "mengandung": "contains",
};
const FIELD_LABEL = Object.fromEntries(Object.entries(FIELD_ENUM).map(([k, v]) => [v, k]));
const OP_LABEL = Object.fromEntries(Object.entries(OP_ENUM).map(([k, v]) => [v, k]));

const CONDITION_FIELDS = Object.keys(FIELD_ENUM) as readonly string[];
const CONDITION_OPS = Object.keys(OP_ENUM) as readonly string[];

const TEMPLATES = ["collection", "collection.full-width"] as const;

type Condition = { id: number; field: string; op: string; value: string };

const TITLE_LIMIT = 100;
const SEO_TITLE_LIMIT = 70;
const META_LIMIT = 160;

// Char-counter colour: muted normally, amber near the cap, red at the cap.
const counterClass = (len: number, max: number) =>
  len >= max ? "text-red-500" : len >= max * 0.9 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground";

export function CollectionEditor({ collection, products }: { collection?: CollectionDetail; products: Product[] }) {
  const isEdit = Boolean(collection);
  const canWrite = useCan("content:write");
  const byId = React.useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // ---- form state (seeded from the loaded collection, or blank for a new one) ----
  const [name, setName] = React.useState(collection?.name ?? "");
  const [description, setDescription] = React.useState(collection?.description ?? "");
  const [type, setType] = React.useState<CollectionDetail["type"]>(collection?.type ?? "manual");

  // Conditions builder (Otomatis) — loaded rows mapped enum→label, else one empty row to start from.
  const [match, setMatch] = React.useState<"semua" | "salah satu">(collection?.match === "any" ? "salah satu" : "semua");
  // Row keys only. Initial rows get 1..n; new rows count up from 1000 (an event-time counter, never
  // read during render) so the two never collide.
  const nextCondId = React.useRef(1000);
  const [conditions, setConditions] = React.useState<Condition[]>(() => {
    const loaded = collection?.conditions ?? [];
    if (!loaded.length) return [{ id: 1, field: "Tag produk", op: "sama dengan", value: "" }];
    return loaded.map((c, i) => ({
      id: i + 1,
      field: FIELD_LABEL[c.field] ?? "Tag produk",
      op: OP_LABEL[c.operator] ?? "sama dengan",
      value: c.value,
    }));
  });
  const addCondition = () =>
    setConditions((cs) => [
      ...cs,
      { id: nextCondId.current++, field: "Tag produk", op: "sama dengan", value: "" },
    ]);
  const removeCondition = (id: number) =>
    setConditions((cs) => (cs.length > 1 ? cs.filter((c) => c.id !== id) : cs));
  const patchCondition = (id: number, patch: Partial<Condition>) =>
    setConditions((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  // Manual membership — real products, loaded from the collection's memberIds (order preserved).
  const [members, setMembers] = React.useState<Product[]>(
    () => (collection?.memberIds ?? []).map((id) => byId.get(id)).filter((p): p is Product => Boolean(p)),
  );
  const removeMember = (id: string) => setMembers((m) => m.filter((p) => p.id !== id));
  const addMember = (p: Product) => setMembers((m) => (m.some((x) => x.id === p.id) ? m : [...m, p]));
  const [productQuery, setProductQuery] = React.useState("");
  const searchResults = React.useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q) return [];
    const chosen = new Set(members.map((p) => p.id));
    return products.filter((p) => !chosen.has(p.id) && p.name.toLowerCase().includes(q)).slice(0, 8);
  }, [productQuery, products, members]);

  // Publikasikan
  const [published, setPublished] = React.useState(collection?.published ?? false);
  const [chOnline, setChOnline] = React.useState(true);

  // Template tema
  const [template, setTemplate] = React.useState<string>(TEMPLATES[0]);

  // ---- Gambar koleksi ----
  // This card used to be a bare <button> with no onClick, no <input type="file"> and no drop handler,
  // under copy promising "Seret gambar atau klik untuk unggah" — it delivered NEITHER. Same bug class
  // as the blog editor's "Gambar unggulan", fixed the same way and through the SAME `uploadMedia`
  // action the Files library uses, so one upload path keeps one set of rules (WebP conversion, the
  // 2 MB gate, the media row). The url is held in state and persisted by the normal Simpan — nothing
  // is written to the collection until the merchant saves, which is what every other field here does.
  const imgInputRef = React.useRef<HTMLInputElement>(null);
  const [imgBusy, setImgBusy] = React.useState(false);
  const [drag, setDrag] = React.useState(false);
  const [imageUrl, setImageUrl] = React.useState(collection?.imageUrl ?? "");
  const pickImage = async (f?: File) => {
    if (!f) return;
    if (!canWrite) { toast.error("Akses ditolak — peran Anda tidak bisa mengubah koleksi"); return; }
    // Client-side checks are UX only; image-store.ts's checkFile is the boundary and re-checks both.
    if (!f.type.startsWith("image/")) { toast.error(`${f.name}: bukan gambar.`); return; }
    if (f.size > 2 * 1024 * 1024) { toast.error(`${f.name}: melebihi 2MB (${(f.size / 1048576).toFixed(1)}MB).`); return; }
    setImgBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await uploadMedia(fd);
      // `uploadMedia` returns ok/error rather than the saved row, so read the url back from the
      // library (the blog editor does the same — changing the action's return type is a wider change
      // than this fix warrants).
      if (!r.ok) { toast.error(r.error ?? "Gagal mengunggah."); return; }
      const media = await getMedia();
      const newest = media[0];
      if (!newest) { toast.error("Gambar terunggah tapi tidak ditemukan di Files."); return; }
      setImageUrl(newest.url);
      toast.success("Gambar diunggah (WebP) — tekan Simpan untuk menyimpannya ke koleksi.");
    } catch {
      toast.error("Gagal mengunggah gambar.");
    } finally {
      setImgBusy(false);
    }
  };

  // ---- persist ----
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const buildInput = (): CollectionInput => ({
    name: name.trim(),
    description,
    handle: handle.trim() || undefined,
    type,
    match: match === "semua" ? "all" : "any",
    published,
    seoTitle,
    seoDesc: metaDesc,
    imageUrl,
    memberIds: members.map((p) => p.id),
    conditions: conditions
      .filter((c) => c.value.trim())
      .map((c) => ({ field: FIELD_ENUM[c.field], operator: OP_ENUM[c.op], value: c.value })),
  });
  const handleSave = () => {
    if (!canWrite) {
      toast.error("Akses ditolak — peran Anda tidak bisa mengubah koleksi");
      return;
    }
    if (!name.trim()) {
      toast.error("Nama koleksi wajib diisi");
      return;
    }
    startTransition(async () => {
      try {
        if (isEdit && collection) {
          await updateCollection(collection.id, buildInput());
          toast.success("Perubahan koleksi disimpan");
        } else {
          await createCollection(buildInput());
          toast.success("Koleksi baru disimpan");
        }
        router.push("/produk/kategori");
        router.refresh();
      } catch {
        toast.error("Gagal menyimpan koleksi");
      }
    });
  };
  const handleDelete = () => {
    if (!collection) return;
    startTransition(async () => {
      try {
        await deleteCollection(collection.id);
        toast.success("Koleksi dihapus");
        router.push("/produk/kategori");
        router.refresh();
      } catch {
        toast.error("Gagal menghapus koleksi");
      }
    });
  };

  // SEO — loaded from the collection; handle keeps its real saved value.
  const [seoTitle, setSeoTitle] = React.useState(collection?.seoTitle ?? "");
  const [metaDesc, setMetaDesc] = React.useState(collection?.seoDesc ?? "");
  // On EDIT the handle is real and typed-only; a NEW collection derives it from the title until the
  // merchant edits it (no effect — the value is derived, which is what the linter wants).
  const [handleEdited, setHandleEdited] = React.useState(isEdit);
  const [handleRaw, setHandleRaw] = React.useState(collection?.handle ?? "");
  const handle = handleEdited ? handleRaw : slugify(name);

  // ---- derived ----
  const title = isEdit ? name || "Tanpa judul" : "Buat koleksi";

  const seoTitleText = seoTitle || name || "Judul koleksi";
  const seoDescText =
    metaDesc ||
    "Deskripsi meta koleksi akan tampil di sini pada hasil pencarian.";
  const seoUrl = `tokoanda.com › kategori › ${handle || "koleksi"}`;

  return (
    <div>
      {/* Top bar */}
      <div className="mb-5 flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            render={<Link href="/produk/kategori" />}
            aria-label="Kembali ke Kategori"
          >
            <ChevronLeft />
          </Button>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              <Link href="/produk/kategori" className="hover:underline">
                Kategori
              </Link>
            </p>
            <h1 className="truncate text-xl font-bold tracking-tight">{title}</h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {published ? (
            <Badge className="border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/50 dark:text-emerald-400">
              Terbit
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Draft
            </Badge>
          )}
          {isEdit && canWrite && (
            <Button
              variant="ghost"
              className="text-destructive hover:bg-destructive/10"
              onClick={handleDelete}
              disabled={pending}
            >
              <Trash2 />
              Hapus koleksi
            </Button>
          )}
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link href="/produk/kategori" />}
          >
            Batal
          </Button>
          {canWrite && (
            <Button onClick={handleSave} disabled={pending}>
              {pending ? "Menyimpan…" : "Simpan"}
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="grid gap-5 lg:grid-cols-3">
        {/* MAIN */}
        <div className="flex flex-col gap-5 lg:col-span-2">
          {/* Judul + Deskripsi */}
          <Card>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="c-judul">Judul</Label>
                  <span className={`text-xs tabular-nums ${counterClass(name.length, TITLE_LIMIT)}`}>
                    {num(name.length)}/{TITLE_LIMIT}
                  </span>
                </div>
                <Input
                  id="c-judul"
                  value={name}
                  maxLength={TITLE_LIMIT}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Contoh: Promo Gajian"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="c-desc">Deskripsi</Label>
                <div className="overflow-hidden rounded-lg border">
                  <div className="flex items-center gap-0.5 border-b bg-muted/40 px-1.5 py-1">
                    <Button variant="ghost" size="icon-sm" type="button" aria-label="Tebal">
                      <Bold />
                    </Button>
                    <Button variant="ghost" size="icon-sm" type="button" aria-label="Miring">
                      <Italic />
                    </Button>
                    <Button variant="ghost" size="icon-sm" type="button" aria-label="Daftar">
                      <List />
                    </Button>
                    <Separator orientation="vertical" className="mx-1 h-5" />
                    <Button variant="ghost" size="icon-sm" type="button" aria-label="Tautan">
                      <Link2 />
                    </Button>
                    <Button variant="ghost" size="icon-sm" type="button" aria-label="Gambar">
                      <ImagePlus />
                    </Button>
                  </div>
                  <Textarea
                    id="c-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Jelaskan koleksi ini untuk pelanggan…"
                    className="min-h-32 rounded-none border-0 focus-visible:ring-0"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Jenis koleksi */}
          <Card>
            <CardHeader>
              <CardTitle>Jenis koleksi</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setType("manual")}
                aria-pressed={type === "manual"}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                  type === "manual"
                    ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                    : "hover:bg-muted/50"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                    type === "manual" ? "border-primary" : "border-muted-foreground/40"
                  )}
                >
                  {type === "manual" && (
                    <span className="size-2 rounded-full bg-primary" />
                  )}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <Hand className="size-3.5" /> Manual
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Tambahkan produk satu per satu secara manual
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => setType("otomatis")}
                aria-pressed={type === "otomatis"}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                  type === "otomatis"
                    ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                    : "hover:bg-muted/50"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                    type === "otomatis" ? "border-primary" : "border-muted-foreground/40"
                  )}
                >
                  {type === "otomatis" && (
                    <span className="size-2 rounded-full bg-primary" />
                  )}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <Zap className="size-3.5 text-primary" /> Otomatis
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Produk yang cocok dengan kondisi ditambahkan otomatis
                  </span>
                </span>
              </button>

              {type === "otomatis" && (
                <div className="mt-1 flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm">
                    <span className="text-muted-foreground">Produk harus cocok dengan</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<Button variant="outline" size="sm" className="font-normal" />}
                      >
                        {match}
                        <ChevronDown className="text-muted-foreground" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onClick={() => setMatch("semua")}>
                          semua
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setMatch("salah satu")}>
                          salah satu
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <span className="text-muted-foreground">kondisi berikut</span>
                  </p>

                  <div className="flex flex-col gap-2">
                    {conditions.map((c) => (
                      <div key={c.id} className="flex flex-wrap items-center gap-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-36 justify-between font-normal"
                              />
                            }
                          >
                            <span className="truncate">{c.field}</span>
                            <ChevronDown className="text-muted-foreground" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            {CONDITION_FIELDS.map((f) => (
                              <DropdownMenuItem
                                key={f}
                                onClick={() => patchCondition(c.id, { field: f })}
                              >
                                {f}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>

                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-36 justify-between font-normal"
                              />
                            }
                          >
                            <span className="truncate">{c.op}</span>
                            <ChevronDown className="text-muted-foreground" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            {CONDITION_OPS.map((o) => (
                              <DropdownMenuItem
                                key={o}
                                onClick={() => patchCondition(c.id, { op: o })}
                              >
                                {o}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>

                        <Input
                          value={c.value}
                          onChange={(e) => patchCondition(c.id, { value: e.target.value })}
                          placeholder="Nilai"
                          className="h-8 min-w-32 flex-1"
                        />

                        <Button
                          variant="ghost"
                          size="icon-sm"
                          type="button"
                          aria-label="Hapus kondisi"
                          onClick={() => removeCondition(c.id)}
                        >
                          <X />
                        </Button>
                      </div>
                    ))}
                  </div>

                  <div>
                    <Button variant="outline" size="sm" type="button" onClick={addCondition}>
                      <Plus /> Tambah kondisi lain
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Produk */}
          <Card>
            <CardHeader>
              <CardTitle>Produk</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {type === "manual" ? (
                <>
                  <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={productQuery}
                      onChange={(e) => setProductQuery(e.target.value)}
                      placeholder="Cari produk untuk ditambahkan"
                      className="pl-8"
                    />
                    {searchResults.length > 0 && (
                      <div className="absolute z-10 mt-1 flex w-full flex-col overflow-hidden rounded-lg border bg-popover shadow-md">
                        {searchResults.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => { addMember(p); setProductQuery(""); }}
                            className="flex items-center gap-3 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/60"
                          >
                            <ProductThumb src={p.image} emoji={p.emoji} alt={p.name} className="size-8" />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                            <Plus className="size-4 shrink-0 text-muted-foreground" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col overflow-hidden rounded-lg border">
                    {members.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0"
                      >
                        <ProductThumb src={p.image} emoji={p.emoji} alt={p.name} className="size-9" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{p.name}</p>
                          <p className="text-xs text-muted-foreground">{p.category}</p>
                        </div>
                        <span className="shrink-0 text-sm tabular-nums">
                          {IDR(p.price)}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          type="button"
                          aria-label={`Hapus ${p.name}`}
                          onClick={() => removeMember(p.id)}
                        >
                          <X />
                        </Button>
                      </div>
                    ))}
                    {members.length === 0 && (
                      <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                        Belum ada produk. Cari di atas untuk menambahkan.
                      </p>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground tabular-nums">{num(members.length)}</span> produk dalam koleksi ini
                  </p>
                </>
              ) : (
                <p className="rounded-lg border bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
                  Produk yang cocok dengan kondisi di atas ditambahkan otomatis di toko.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Gambar koleksi */}
          <Card>
            <CardHeader>
              <CardTitle>Gambar koleksi</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {imageUrl ? (
                <div className="flex flex-col gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- /api/uploads is served by
                      a route handler, not the image optimizer's allowed loaders. */}
                  <img
                    src={imageUrl}
                    alt=""
                    className="aspect-[3/2] w-full rounded-lg object-cover ring-1 ring-border"
                  />
                  {canWrite && (
                    <div className="flex gap-2">
                      <Button type="button" variant="secondary" size="sm" disabled={imgBusy} onClick={() => imgInputRef.current?.click()}>
                        {imgBusy ? "Mengunggah…" : "Ganti"}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={imgBusy} onClick={() => setImageUrl("")}>
                        Hapus
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {isEdit && collection?.emoji && (
                    <div className="flex size-24 items-center justify-center rounded-xl bg-muted text-5xl ring-1 ring-foreground/10">
                      {collection.emoji}
                    </div>
                  )}
                  {/* Both halves of the promise are real now: the button opens the hidden file input,
                      and the wrapper's onDragOver/onDrop take a dropped file (the Files library's
                      pattern — preventDefault, then read e.dataTransfer.files). */}
                  <div
                    onDragOver={(e) => { e.preventDefault(); if (canWrite && !imgBusy) setDrag(true); }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDrag(false);
                      if (!canWrite || imgBusy) return;
                      void pickImage(e.dataTransfer.files?.[0]);
                    }}
                    className={cn("rounded-xl transition-colors", drag && "bg-primary/5 ring-2 ring-primary")}
                  >
                    <button
                      type="button"
                      disabled={!canWrite || imgBusy}
                      onClick={() => imgInputRef.current?.click()}
                      className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center text-muted-foreground transition-colors hover:border-primary hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <ImageUp className="size-6" />
                      <span className="text-sm">
                        {imgBusy ? "Mengunggah…" : "Seret gambar atau klik untuk unggah"}
                      </span>
                      {/* The SERVER's number (MAX_BYTES = 2 MB, lib/image-store.ts) — not a nicer-sounding
                          one. It said 5 MB, which rejects a 4 MB photo after promising it would fit. */}
                      <span className="text-xs text-muted-foreground">
                        PNG, JPG, WEBP, atau SVG — maks. 2 MB. Otomatis jadi WebP.
                      </span>
                    </button>
                  </div>
                </>
              )}
              <input
                ref={imgInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { void pickImage(e.target.files?.[0]); e.target.value = ""; }}
              />
              <p className="text-xs text-muted-foreground">
                Gambar juga masuk ke Files. Tekan Simpan untuk menerapkannya ke koleksi.
              </p>
            </CardContent>
          </Card>

          {/* SEO */}
          <Card>
            <CardHeader>
              <CardTitle>Pratinjau mesin pencari</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="max-w-2xl rounded-lg border bg-muted/30 p-3">
                <p className="truncate text-xs text-emerald-700 dark:text-emerald-400">
                  {seoUrl}
                </p>
                <p className="mt-0.5 truncate text-sm text-primary">{seoTitleText}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {seoDescText}
                </p>
              </div>

              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="seo-title">Judul SEO</Label>
                  <span className={`text-xs tabular-nums ${counterClass(seoTitle.length, SEO_TITLE_LIMIT)}`}>
                    {num(seoTitle.length)}/{SEO_TITLE_LIMIT}
                  </span>
                </div>
                <Input
                  id="seo-title"
                  value={seoTitle}
                  maxLength={SEO_TITLE_LIMIT}
                  onChange={(e) => setSeoTitle(e.target.value)}
                  placeholder={name || "Judul koleksi"}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="seo-desc">Deskripsi meta</Label>
                  <span className={`text-xs tabular-nums ${counterClass(metaDesc.length, META_LIMIT)}`}>
                    {num(metaDesc.length)}/{META_LIMIT}
                  </span>
                </div>
                <Textarea
                  id="seo-desc"
                  value={metaDesc}
                  maxLength={META_LIMIT}
                  onChange={(e) => setMetaDesc(e.target.value)}
                  placeholder="Ringkasan singkat untuk hasil pencarian…"
                  className="min-h-20"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="seo-handle">Handle URL</Label>
                <div className="flex items-center overflow-hidden rounded-lg border focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
                  <span className="border-r bg-muted/40 px-2.5 py-1 text-sm text-muted-foreground">
                    /kategori/
                  </span>
                  <Input
                    id="seo-handle"
                    value={handle}
                    onChange={(e) => {
                      setHandleEdited(true);
                      setHandleRaw(e.target.value);
                    }}
                    placeholder="handle-koleksi"
                    className="rounded-none border-0 focus-visible:ring-0"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* SIDEBAR */}
        <div className="flex flex-col gap-5 lg:col-span-1">
          {/* Publikasikan */}
          <Card>
            <CardHeader>
              <CardTitle>Publikasikan</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="c-terbit">Terbitkan koleksi</Label>
                <Switch
                  id="c-terbit"
                  checked={published}
                  onCheckedChange={setPublished}
                />
              </div>
              <Separator />
              <div className="flex flex-col gap-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Saluran penjualan
                </p>
                <div className="flex items-center justify-between">
                  <Label htmlFor="c-ch-online">Toko Online</Label>
                  <Switch
                    id="c-ch-online"
                    checked={chOnline}
                    onCheckedChange={setChOnline}
                  />
                </div>
              </div>
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
                      className="w-full justify-between font-normal"
                    />
                  }
                >
                  {template}
                  <ChevronDown className="text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-(--anchor-width)">
                  {TEMPLATES.map((t) => (
                    <DropdownMenuItem key={t} onClick={() => setTemplate(t)}>
                      {t}
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
