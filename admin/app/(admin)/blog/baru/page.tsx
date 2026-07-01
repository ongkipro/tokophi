"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bold,
  Italic,
  List,
  Link2,
  ImageIcon,
  ImageUp,
  ChevronDown,
  Newspaper,
} from "lucide-react";

import { BLOG_CATEGORIES } from "@/lib/mock/store";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

const META_LIMIT = 160;

function EditorToolbar() {
  const tools = [
    { icon: Bold, label: "Tebal" },
    { icon: Italic, label: "Miring" },
    { icon: List, label: "Daftar" },
    { icon: Link2, label: "Tautan" },
    { icon: ImageIcon, label: "Gambar" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-0.5 rounded-t-lg border border-b-0 bg-muted/40 p-1">
      {tools.map((t, i) => (
        <React.Fragment key={t.label}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t.label}
            className="text-muted-foreground"
          >
            <t.icon />
          </Button>
          {(i === 1 || i === 3) && (
            <Separator orientation="vertical" className="mx-0.5 h-5" />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

export default function Page() {
  const [published, setPublished] = React.useState(false);
  const [blog, setBlog] = React.useState<string>(BLOG_CATEGORIES[0]);
  const [handle, setHandle] = React.useState("");
  const [metaDesc, setMetaDesc] = React.useState("");

  const exampleTags = ["promo", "tips", "fashion"];

  return (
    <div>
      {/* Top bar */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href="/blog"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Blog
        </Link>
        <div className="flex items-center gap-2">
          <Button nativeButton={false} variant="ghost" render={<Link href="/blog" />}>
            Batal
          </Button>
          <Button>Simpan</Button>
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
                  placeholder="Contoh: 5 Tips Belanja Online yang Aman"
                  className="md:text-base"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="konten">Konten</Label>
                <div>
                  <EditorToolbar />
                  <Textarea
                    id="konten"
                    placeholder="Tulis isi artikel Anda di sini…"
                    className="min-h-64 rounded-t-none"
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="excerpt">Kutipan</Label>
                <Textarea
                  id="excerpt"
                  rows={3}
                  placeholder="Ringkasan singkat artikel…"
                />
                <p className="text-xs text-muted-foreground">
                  Ringkasan singkat yang tampil di daftar artikel.
                </p>
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
                  ? "Akan terbit segera setelah disimpan."
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
                <Input id="penulis" defaultValue="Ongki Pratama" />
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

          {/* Gambar unggulan */}
          <Card>
            <CardHeader>
              <CardTitle>Gambar unggulan</CardTitle>
            </CardHeader>
            <CardContent>
              <button
                type="button"
                className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center transition-colors hover:border-ring hover:bg-muted/50"
              >
                <ImageUp className="size-6 text-muted-foreground" />
                <span className="text-sm font-medium">
                  Seret gambar atau klik untuk unggah
                </span>
                <span className="text-xs text-muted-foreground">
                  PNG, JPG, atau WEBP hingga 5 MB
                </span>
              </button>
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
          {/* Google preview */}
          <div className="max-w-2xl rounded-lg border bg-background p-3">
            <p className="truncate text-xs text-muted-foreground">
              tokoanda.com › blogs › {blog.toLowerCase().replace(/\s+/g, "-")}{" "}
              › {handle || "judul-artikel"}
            </p>
            <p className="mt-0.5 truncate text-sm font-medium text-[#1a0dab] dark:text-blue-400">
              Judul artikel Anda - Toko Anda
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
  );
}
