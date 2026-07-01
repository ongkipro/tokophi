"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bold,
  Italic,
  Underline,
  List,
  Link2,
  Image as ImageIcon,
  ChevronDown,
  Check,
  Globe,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

const TOOLBAR = [
  { icon: Bold, label: "Tebal" },
  { icon: Italic, label: "Miring" },
  { icon: Underline, label: "Garis bawah" },
  { icon: List, label: "Daftar" },
  { icon: Link2, label: "Tautan" },
  { icon: ImageIcon, label: "Gambar" },
];

export default function Page() {
  const [title, setTitle] = React.useState("");
  const [handle, setHandle] = React.useState("");
  const [handleEdited, setHandleEdited] = React.useState(false);
  const [published, setPublished] = React.useState(true);
  const [template, setTemplate] = React.useState("page");
  const [seoTitle, setSeoTitle] = React.useState("");
  const [metaDesc, setMetaDesc] = React.useState("");

  // Keep handle synced with the title until the user edits it manually.
  const effectiveHandle = handleEdited ? handle : slugify(title);
  const previewTitle = seoTitle || title || "Judul halaman";
  const previewHandle = effectiveHandle || "handle";
  const previewDesc =
    metaDesc ||
    "Tambahkan deskripsi meta agar cuplikan ini menarik di hasil pencarian.";

  const metaLen = metaDesc.length;
  const metaTone =
    metaLen === 0
      ? "text-muted-foreground"
      : metaLen < 120
        ? "text-amber-600 dark:text-amber-400"
        : metaLen <= 155
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-destructive";

  return (
    <div className="mx-auto max-w-5xl">
      {/* Top bar */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href="/halaman"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Halaman
        </Link>
        <div className="flex items-center gap-2">
          <Button nativeButton={false} variant="ghost" render={<Link href="/halaman" />}>
            Batal
          </Button>
          <Button>Simpan</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* MAIN column */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="judul">Judul</Label>
                <Input
                  id="judul"
                  placeholder="mis. Tentang Kami"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="konten">Konten</Label>
                <div className="overflow-hidden rounded-md border border-input">
                  <div className="flex items-center gap-0.5 border-b border-input bg-muted/40 px-1.5 py-1">
                    {TOOLBAR.map(({ icon: Icon, label }, i) => (
                      <React.Fragment key={label}>
                        {(i === 3 || i === 4) && (
                          <Separator
                            orientation="vertical"
                            className="mx-1 h-4"
                          />
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={label}
                          className="text-muted-foreground"
                        >
                          <Icon />
                        </Button>
                      </React.Fragment>
                    ))}
                  </div>
                  <Textarea
                    id="konten"
                    placeholder="Tulis isi halaman di sini…"
                    className="min-h-64 rounded-none border-0 focus-visible:ring-0"
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

      {/* SEO */}
      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Pratinjau mesin pencari</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Google-style preview */}
          <div className="max-w-2xl rounded-md border border-border bg-background p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Globe className="size-3" />
              <span className="truncate text-emerald-700 dark:text-emerald-500">
                indostore.id › pages › {previewHandle}
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
            <Label htmlFor="seo-title">Judul halaman (SEO)</Label>
            <Input
              id="seo-title"
              placeholder={title || "mis. Tentang Kami"}
              value={seoTitle}
              onChange={(e) => setSeoTitle(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="seo-desc">Deskripsi meta</Label>
              <span className={`text-xs tabular-nums ${metaTone}`}>
                {metaLen} / 155
              </span>
            </div>
            <Textarea
              id="seo-desc"
              placeholder="Ringkasan singkat yang muncul di hasil pencarian."
              className="min-h-20"
              value={metaDesc}
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
  );
}
