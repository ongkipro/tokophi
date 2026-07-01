"use client";

import * as React from "react";
import Link from "next/link";
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
  GripVertical,
} from "lucide-react";

import { type Collection, PRODUCTS } from "@/lib/mock/store";
import { IDR, num } from "@/lib/format";
import { cn } from "@/lib/utils";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

// Slugify a title into a URL handle.
const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

const CONDITION_FIELDS = [
  "Tag produk",
  "Judul produk",
  "Tipe produk",
  "Harga",
  "Stok",
  "Kategori",
] as const;

const CONDITION_OPS = [
  "sama dengan",
  "tidak sama dengan",
  "lebih dari",
  "kurang dari",
  "mengandung",
] as const;

const TEMPLATES = ["collection", "collection.full-width"] as const;

type Condition = { id: number; field: string; op: string; value: string };

export function CollectionEditor({ collection }: { collection?: Collection }) {
  const isEdit = Boolean(collection);

  // ---- form state ----
  const [name, setName] = React.useState(collection?.name ?? "");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<Collection["type"]>(
    collection?.type ?? "manual"
  );

  // Conditions builder (Otomatis)
  const [match, setMatch] = React.useState<"semua" | "salah satu">("semua");
  const [conditions, setConditions] = React.useState<Condition[]>([
    { id: 1, field: "Tag produk", op: "sama dengan", value: "" },
  ]);
  const nextCondId = React.useRef(2);
  const addCondition = () =>
    setConditions((cs) => [
      ...cs,
      { id: nextCondId.current++, field: "Tag produk", op: "sama dengan", value: "" },
    ]);
  const removeCondition = (id: number) =>
    setConditions((cs) => (cs.length > 1 ? cs.filter((c) => c.id !== id) : cs));
  const patchCondition = (id: number, patch: Partial<Condition>) =>
    setConditions((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  // Manual products in collection (seed with first few).
  const [members, setMembers] = React.useState(() => PRODUCTS.slice(0, 5));
  const removeMember = (id: string) =>
    setMembers((m) => m.filter((p) => p.id !== id));

  // Publikasikan
  const [published, setPublished] = React.useState(collection?.published ?? false);
  const [chOnline, setChOnline] = React.useState(true);

  // Template tema
  const [template, setTemplate] = React.useState<string>(TEMPLATES[0]);

  // SEO
  const [seoTitle, setSeoTitle] = React.useState("");
  const [metaDesc, setMetaDesc] = React.useState("");
  const [handle, setHandle] = React.useState(
    collection ? slugify(collection.name) : ""
  );
  const [handleEdited, setHandleEdited] = React.useState(false);

  // Keep handle synced to the title until edited.
  React.useEffect(() => {
    if (!handleEdited) setHandle(slugify(name));
  }, [name, handleEdited]);

  // ---- derived ----
  const title = isEdit ? name || "Tanpa judul" : "Buat koleksi";
  const autoCount = collection?.products ?? 6;
  const preview = PRODUCTS.slice(0, 4);

  const seoTitleText = seoTitle || name || "Judul koleksi";
  const seoDescText =
    metaDesc ||
    "Deskripsi meta koleksi akan tampil di sini pada hasil pencarian.";
  const seoUrl = `tokoanda.com › collections › ${handle || "koleksi"}`;

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
          {isEdit && (
            <Button
              variant="ghost"
              className="text-destructive hover:bg-destructive/10"
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
          <Button>Simpan</Button>
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
                <Label htmlFor="c-judul">Judul</Label>
                <Input
                  id="c-judul"
                  value={name}
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
                      placeholder="Cari produk untuk ditambahkan"
                      className="pl-8"
                    />
                  </div>
                  <div className="flex flex-col overflow-hidden rounded-lg border">
                    {members.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0"
                      >
                        <GripVertical className="size-4 shrink-0 text-muted-foreground/50" />
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-xl">
                          {p.emoji}
                        </div>
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
                        Belum ada produk dalam koleksi ini.
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    <Plus className="size-4" /> Tambah produk
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    ≈{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {num(autoCount)}
                    </span>{" "}
                    produk cocok dengan kondisi ini
                  </p>
                  <div className="flex flex-col overflow-hidden rounded-lg border">
                    {preview.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0"
                      >
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-xl">
                          {p.emoji}
                        </div>
                        <p className="min-w-0 flex-1 truncate text-sm font-medium">
                          {p.name}
                        </p>
                        <span className="shrink-0 text-sm tabular-nums">
                          {IDR(p.price)}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Gambar koleksi */}
          <Card>
            <CardHeader>
              <CardTitle>Gambar koleksi</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {isEdit && (
                <div className="flex size-24 items-center justify-center rounded-xl bg-muted text-5xl ring-1 ring-foreground/10">
                  {collection?.emoji}
                </div>
              )}
              <button
                type="button"
                className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center text-muted-foreground transition-colors hover:border-primary hover:bg-muted/40 hover:text-foreground"
              >
                <ImageUp className="size-6" />
                <span className="text-sm">Seret gambar atau klik untuk unggah</span>
                <span className="text-xs text-muted-foreground">PNG/JPG hingga 5 MB</span>
              </button>
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
                <Label htmlFor="seo-title">Judul SEO</Label>
                <Input
                  id="seo-title"
                  value={seoTitle}
                  onChange={(e) => setSeoTitle(e.target.value)}
                  placeholder={name || "Judul koleksi"}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="seo-desc">Deskripsi meta</Label>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {num(metaDesc.length)}/160
                  </span>
                </div>
                <Textarea
                  id="seo-desc"
                  value={metaDesc}
                  maxLength={160}
                  onChange={(e) => setMetaDesc(e.target.value)}
                  placeholder="Ringkasan singkat untuk hasil pencarian…"
                  className="min-h-20"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="seo-handle">Handle URL</Label>
                <div className="flex items-center overflow-hidden rounded-lg border focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
                  <span className="border-r bg-muted/40 px-2.5 py-1 text-sm text-muted-foreground">
                    /collections/
                  </span>
                  <Input
                    id="seo-handle"
                    value={handle}
                    onChange={(e) => {
                      setHandleEdited(true);
                      setHandle(e.target.value);
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
