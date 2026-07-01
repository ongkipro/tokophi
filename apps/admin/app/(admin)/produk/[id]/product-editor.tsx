"use client";

import * as React from "react";
import Link from "next/link";
import {
  ChevronLeft,
  Bold,
  Italic,
  List,
  Link2,
  ImagePlus,
  Plus,
  Film,
  Play,
  Trash2,
  ChevronDown,
  X,
  MoreHorizontal,
  Tags,
  Boxes,
  ShoppingCart,
  Copy,
  Archive,
} from "lucide-react";

import { type Product } from "@/lib/mock/store";
import { toast } from "sonner";
import { IDR, num } from "@/lib/format";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
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
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

const CATEGORIES = [
  "Dress",
  "Atasan",
  "Bawahan",
  "Hijab",
  "Busana Muslim",
  "Outerwear",
  "Loungewear",
  "Aksesoris",
];

const LOW_STOCK = 20;

// Parse a numeric string to a number (strip non-digits).
const toNum = (s: string) => Number(String(s).replace(/[^\d]/g, "")) || 0;

// Slugify a title into a URL handle.
const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

const DESC_TEMPLATE = (name: string) =>
  `${name} adalah produk pilihan dengan kualitas terbaik. Dibuat dari bahan premium, cocok untuk pemakaian sehari-hari maupun sebagai hadiah. Tersedia stok terbatas — pesan sekarang selagi ada.`;

export function ProductEditor({ product }: { product?: Product }) {
  const isEdit = Boolean(product);

  // Fabricated demo fields (do NOT change the mock Product type).
  const seedCost = product ? Math.round(product.price * 0.6) : 0;

  // ---- form state ----
  const [name, setName] = React.useState(product?.name ?? "");
  const [description, setDescription] = React.useState(
    product ? DESC_TEMPLATE(product.name) : ""
  );

  const [price, setPrice] = React.useState(String(product?.price ?? ""));
  const [compareAt, setCompareAt] = React.useState("");
  const [cost, setCost] = React.useState(seedCost ? String(seedCost) : "");

  const [trackQty, setTrackQty] = React.useState(true);
  const [sku, setSku] = React.useState(product?.id ?? "");
  const [barcode, setBarcode] = React.useState("");
  const [qty, setQty] = React.useState(String(product?.stock ?? ""));

  const [hasVariants, setHasVariants] = React.useState(false);
  const [optionName, setOptionName] = React.useState("Ukuran");
  const [optionValues, setOptionValues] = React.useState("S, M, L");

  const [physical, setPhysical] = React.useState(true);
  const [weight, setWeight] = React.useState("500");

  const [status, setStatus] = React.useState<Product["status"]>(
    product?.status ?? "draft"
  );

  const [chOnline, setChOnline] = React.useState(true);

  const [category, setCategory] = React.useState(product?.category ?? "Fashion");
  const [productType, setProductType] = React.useState("");
  const [vendor, setVendor] = React.useState("Batik Nusantara");
  const [tags, setTags] = React.useState("");

  const [seoTitle, setSeoTitle] = React.useState("");
  const [metaDesc, setMetaDesc] = React.useState("");
  const [handle, setHandle] = React.useState(
    product ? slugify(product.name) : ""
  );
  const [handleEdited, setHandleEdited] = React.useState(false);

  // Quick-action dialogs (Tindakan lainnya)
  const [catOpen, setCatOpen] = React.useState(false);
  const [stockOpen, setStockOpen] = React.useState(false);
  const [stockMode, setStockMode] = React.useState<"set" | "add" | "sub">("add");
  const [stockAmount, setStockAmount] = React.useState("");
  const [stockReason, setStockReason] = React.useState("");
  const [poOpen, setPoOpen] = React.useState(false);
  const [poSupplier, setPoSupplier] = React.useState("");
  const [poQty, setPoQty] = React.useState("");
  const [poCost, setPoCost] = React.useState("");
  const [poEta, setPoEta] = React.useState("");

  const curStock = Number(qty) || 0;
  const stockAmt = Number(stockAmount) || 0;
  const newStock =
    stockMode === "set" ? stockAmt : stockMode === "add" ? curStock + stockAmt : Math.max(0, curStock - stockAmt);
  const applyStock = () => {
    setQty(String(newStock));
    setStockOpen(false);
    setStockAmount("");
    setStockReason("");
  };
  const poTotal = (Number(poQty) || 0) * (Number(poCost) || seedCost || 0);

  // Keep the handle synced to the title until the user edits it manually.
  React.useEffect(() => {
    if (!handleEdited) setHandle(slugify(name));
  }, [name, handleEdited]);

  // ---- derived ----
  const priceN = toNum(price);
  const costN = toNum(cost);
  const qtyN = toNum(qty);
  const profit = priceN - costN;
  const margin = priceN > 0 ? (profit / priceN) * 100 : 0;

  const variantValues = optionValues
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  const seoTitleText = seoTitle || name || "Judul produk";
  const seoDescText =
    metaDesc || "Deskripsi meta produk akan tampil di sini pada hasil pencarian.";
  const seoUrl = `tokoanda.com › produk › ${handle || "produk"}`;

  return (
    <div>
      {/* Top bar */}
      <div className="mb-5 flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            render={<Link href="/produk" />}
            aria-label="Kembali ke Produk"
          >
            <ChevronLeft />
          </Button>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              <Link href="/produk" className="hover:underline">
                Produk
              </Link>
            </p>
            <h1 className="truncate text-xl font-bold tracking-tight">
              {isEdit ? name || "Tanpa judul" : "Tambah produk baru"}
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {status === "active" ? (
            <Badge className="border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/50 dark:text-emerald-400">
              Aktif
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Draft
            </Badge>
          )}
          {isEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" />}>
                <MoreHorizontal /> Tindakan lainnya <ChevronDown className="text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem onClick={() => setCatOpen(true)}>
                  <Tags /> Ubah kategori
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setStockOpen(true)}>
                  <Boxes /> Perbarui stok / inventori
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setPoOpen(true)}>
                  <ShoppingCart /> Buat pesanan pembelian
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <Copy /> Duplikat
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive">
                  <Archive /> Arsipkan
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {isEdit && (
            <Button
              variant="ghost"
              className="text-destructive hover:bg-destructive/10"
              onClick={() => toast.success("Produk dihapus")}
            >
              <Trash2 />
              Hapus produk
            </Button>
          )}
          <Button variant="ghost" nativeButton={false} render={<Link href="/produk" />}>
            Batal
          </Button>
          <Button onClick={() => toast.success(isEdit ? "Perubahan produk disimpan" : "Produk baru disimpan")}>
            Simpan
          </Button>
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
                <Label htmlFor="p-judul">Judul</Label>
                <Input
                  id="p-judul"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Contoh: Kaos Polos Premium Cotton"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="p-desc">Deskripsi</Label>
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
                    id="p-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Ceritakan keunggulan produk ini…"
                    className="min-h-40 rounded-none border-0 focus-visible:ring-0"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Media */}
          <Card>
            <CardHeader>
              <CardTitle>Media</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {/* Image grid */}
              <div className="grid grid-cols-4 gap-3 sm:grid-cols-5">
                {isEdit ? (
                  <div className="relative aspect-square overflow-hidden rounded-lg bg-muted">
                    {product?.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={product.image} alt={product.name} className="size-full object-cover" />
                    ) : (
                      <div className="flex size-full items-center justify-center text-4xl">{product?.emoji}</div>
                    )}
                    <span className="absolute left-1 top-1 rounded bg-foreground/80 px-1.5 py-0.5 text-[10px] font-medium text-background">
                      Utama
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-muted-foreground/40 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                  >
                    <ImagePlus className="size-5" />
                    <span className="text-xs">Foto</span>
                  </button>
                )}
                {[0, 1, 2].map((i) => (
                  <button
                    key={i}
                    type="button"
                    className="flex aspect-square cursor-pointer items-center justify-center rounded-lg border border-dashed border-muted-foreground/40 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                  >
                    <Plus className="size-5" />
                  </button>
                ))}
              </div>

              <p className="text-xs text-muted-foreground">
                Foto pertama jadi gambar utama. Format JPG/PNG, maks 5 MB.
              </p>

              {/* Video slot */}
              <div className="flex flex-col gap-2 border-t pt-4">
                <p className="text-sm font-medium">
                  Video produk{" "}
                  <span className="font-normal text-muted-foreground">
                    (opsional)
                  </span>
                </p>
                {isEdit ? (
                  <button
                    type="button"
                    className="group relative flex aspect-video max-w-[220px] cursor-pointer items-center justify-center overflow-hidden rounded-lg bg-muted"
                  >
                    <span className="flex size-10 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm transition-transform group-hover:scale-105">
                      <Play className="size-5 translate-x-px" />
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="flex aspect-video max-w-[220px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-muted-foreground/40 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                  >
                    <Film className="size-5" />
                    <span className="text-sm">Tambah video</span>
                  </button>
                )}
                <p className="text-xs text-muted-foreground">
                  1 video · MP4/MOV maks 50 MB
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Harga */}
          <Card>
            <CardHeader>
              <CardTitle>Harga</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="grid gap-2">
                  <Label htmlFor="p-harga">Harga</Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">
                      Rp
                    </span>
                    <Input
                      id="p-harga"
                      inputMode="numeric"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="0"
                      className="pl-8 tabular-nums"
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="p-coret">Harga coret</Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">
                      Rp
                    </span>
                    <Input
                      id="p-coret"
                      inputMode="numeric"
                      value={compareAt}
                      onChange={(e) => setCompareAt(e.target.value)}
                      placeholder="Opsional"
                      className="pl-8 tabular-nums"
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="p-biaya">Biaya per item</Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">
                      Rp
                    </span>
                    <Input
                      id="p-biaya"
                      inputMode="numeric"
                      value={cost}
                      onChange={(e) => setCost(e.target.value)}
                      placeholder="0"
                      className="pl-8 tabular-nums"
                    />
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Margin{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {priceN > 0 ? `${margin.toFixed(1)}%` : "—"}
                </span>{" "}
                · Keuntungan{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {priceN > 0 ? IDR(profit) : "—"}
                </span>
              </p>
            </CardContent>
          </Card>

          {/* Inventaris */}
          <Card>
            <CardHeader>
              <CardTitle>Inventaris</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="p-track">Lacak kuantitas</Label>
                <Switch
                  id="p-track"
                  checked={trackQty}
                  onCheckedChange={setTrackQty}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="p-sku">SKU</Label>
                  <Input
                    id="p-sku"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    placeholder="SKU-000"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="p-barcode">Barcode</Label>
                  <Input
                    id="p-barcode"
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    placeholder="ISBN, UPC, GTIN…"
                  />
                </div>
              </div>
              {trackQty && (
                <div className="grid gap-2 sm:max-w-[50%] sm:pr-2">
                  <Label htmlFor="p-qty">Kuantitas</Label>
                  <Input
                    id="p-qty"
                    inputMode="numeric"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    placeholder="0"
                    className="tabular-nums"
                  />
                  {qtyN > 0 && qtyN < LOW_STOCK && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Stok menipis
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Varian */}
          <Card>
            <CardHeader>
              <CardTitle>Varian</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="p-hasvar">Produk ini memiliki varian</Label>
                <Switch
                  id="p-hasvar"
                  checked={hasVariants}
                  onCheckedChange={setHasVariants}
                />
              </div>

              {hasVariants && (
                <div className="flex flex-col gap-4">
                  <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="p-optname">Nama opsi</Label>
                      <Input
                        id="p-optname"
                        value={optionName}
                        onChange={(e) => setOptionName(e.target.value)}
                        placeholder="Ukuran"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="p-optval">Nilai opsi</Label>
                      <Input
                        id="p-optval"
                        value={optionValues}
                        onChange={(e) => setOptionValues(e.target.value)}
                        placeholder="S, M, L"
                      />
                      <div className="flex flex-wrap gap-1.5">
                        {variantValues.map((v) => (
                          <Badge key={v} variant="secondary" className="gap-1">
                            {v}
                            <X className="size-3 opacity-60" />
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>

                  {variantValues.length > 0 && (
                    <div className="overflow-hidden rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Varian</TableHead>
                            <TableHead>Harga</TableHead>
                            <TableHead>Stok</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {variantValues.map((v) => (
                            <TableRow key={v}>
                              <TableCell className="font-medium">
                                {optionName} {v}
                              </TableCell>
                              <TableCell>
                                <div className="relative max-w-36">
                                  <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">
                                    Rp
                                  </span>
                                  <Input
                                    inputMode="numeric"
                                    defaultValue={price}
                                    className="pl-8 tabular-nums"
                                  />
                                </div>
                              </TableCell>
                              <TableCell>
                                <Input
                                  inputMode="numeric"
                                  defaultValue="0"
                                  className="max-w-24 tabular-nums"
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pengiriman */}
          <Card>
            <CardHeader>
              <CardTitle>Pengiriman</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="p-fisik">Produk fisik</Label>
                <Switch
                  id="p-fisik"
                  checked={physical}
                  onCheckedChange={setPhysical}
                />
              </div>
              {physical && (
                <div className="grid gap-2 sm:max-w-[50%]">
                  <Label htmlFor="p-berat">Berat (gram)</Label>
                  <Input
                    id="p-berat"
                    inputMode="numeric"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    placeholder="0"
                    className="tabular-nums"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* SEO */}
          <Card>
            <CardHeader>
              <CardTitle>Pratinjau mesin pencari</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-2">
                <Label htmlFor="seo-title">Judul SEO</Label>
                <Input
                  id="seo-title"
                  value={seoTitle}
                  onChange={(e) => setSeoTitle(e.target.value)}
                  placeholder={name || "Judul produk"}
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
                    /produk/
                  </span>
                  <Input
                    id="seo-handle"
                    value={handle}
                    onChange={(e) => {
                      setHandleEdited(true);
                      setHandle(e.target.value);
                    }}
                    placeholder="handle-produk"
                    className="rounded-none border-0 focus-visible:ring-0"
                  />
                </div>
              </div>

              <div className="max-w-2xl rounded-lg border bg-muted/30 p-3">
                <p className="truncate text-xs text-emerald-700 dark:text-emerald-400">
                  {seoUrl}
                </p>
                <p className="mt-0.5 truncate text-sm text-primary">
                  {seoTitleText}
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {seoDescText}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* SIDEBAR */}
        <div className="flex flex-col gap-5 lg:col-span-1">
          {/* Status */}
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center gap-1 rounded-lg border bg-background p-0.5">
                <Button
                  variant={status === "active" ? "secondary" : "ghost"}
                  size="sm"
                  className="flex-1"
                  aria-pressed={status === "active"}
                  onClick={() => setStatus("active")}
                >
                  Aktif
                </Button>
                <Button
                  variant={status === "draft" ? "secondary" : "ghost"}
                  size="sm"
                  className="flex-1"
                  aria-pressed={status === "draft"}
                  onClick={() => setStatus("draft")}
                >
                  Draft
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {status === "active"
                  ? "Produk aktif tampil di toko"
                  : "Draft — tidak tampil"}
              </p>
            </CardContent>
          </Card>

          {/* Saluran penjualan */}
          <Card>
            <CardHeader>
              <CardTitle>Saluran penjualan</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="ch-online">Toko Online</Label>
                <Switch
                  id="ch-online"
                  checked={chOnline}
                  onCheckedChange={setChOnline}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Produk dijual lewat toko online Anda. Sumber trafik &amp; konversi (Meta Ads,
                TikTok Ads, Google Ads, Organic) dilacak terpisah di Analitik &amp; Pemasaran.
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
                <Label>Kategori</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="outline"
                        className="w-full justify-between font-normal"
                      />
                    }
                  >
                    {category}
                    <ChevronDown className="text-muted-foreground" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[--anchor-width]">
                    {CATEGORIES.map((c) => (
                      <DropdownMenuItem key={c} onClick={() => setCategory(c)}>
                        {c}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="p-tipe">Tipe produk</Label>
                <Input
                  id="p-tipe"
                  value={productType}
                  onChange={(e) => setProductType(e.target.value)}
                  placeholder="Contoh: Kaos"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="p-vendor">Vendor</Label>
                <Input
                  id="p-vendor"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  placeholder="Nama vendor"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="p-tag">Tag</Label>
                <Input
                  id="p-tag"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="Pisahkan dengan koma"
                />
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary">terlaris</Badge>
                  <Badge variant="secondary">baru</Badge>
                  <Badge variant="secondary">promo</Badge>
                </div>
              </div>
            </CardContent>
          </Card>

        </div>
      </div>

      {/* Ubah kategori */}
      <Dialog open={catOpen} onOpenChange={setCatOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Ubah kategori</DialogTitle>
            <DialogDescription>Pilih kategori untuk produk ini.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label>Kategori</Label>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" className="w-full justify-between font-normal" />}>
                {category}
                <ChevronDown className="text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-(--anchor-width)">
                {CATEGORIES.map((c) => (
                  <DropdownMenuItem key={c} onClick={() => setCategory(c)}>{c}</DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Batal</Button>} />
            <DialogClose render={<Button>Simpan</Button>} />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Perbarui stok / inventori */}
      <Dialog open={stockOpen} onOpenChange={setStockOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Perbarui stok</DialogTitle>
            <DialogDescription>Sesuaikan jumlah inventori produk ini.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Stok saat ini</span>
              <span className="font-semibold tabular-nums">{num(curStock)}</span>
            </div>
            <div className="grid gap-2">
              <Label>Tindakan</Label>
              <div className="grid grid-cols-3 gap-1 rounded-lg border bg-background p-0.5">
                {([["set", "Tetapkan"], ["add", "Tambah"], ["sub", "Kurangi"]] as const).map(([m, lbl]) => (
                  <Button key={m} type="button" size="sm" variant={stockMode === m ? "secondary" : "ghost"} onClick={() => setStockMode(m)}>
                    {lbl}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="stok-jumlah">Jumlah</Label>
              <Input id="stok-jumlah" inputMode="numeric" value={stockAmount} onChange={(e) => setStockAmount(e.target.value)} placeholder="0" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="stok-alasan">Alasan (opsional)</Label>
              <Input id="stok-alasan" value={stockReason} onChange={(e) => setStockReason(e.target.value)} placeholder="mis. Stok masuk, koreksi, retur…" />
            </div>
            {stockAmount !== "" && (
              <p className="text-sm text-muted-foreground">Stok menjadi <span className="font-semibold text-foreground tabular-nums">{num(newStock)}</span></p>
            )}
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Batal</Button>} />
            <Button onClick={applyStock}>Perbarui stok</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Buat pesanan pembelian (Purchase Order) */}
      <Dialog open={poOpen} onOpenChange={setPoOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Buat pesanan pembelian</DialogTitle>
            <DialogDescription>Pesan stok dari pemasok untuk produk ini.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="po-pemasok">Pemasok</Label>
              <Input id="po-pemasok" value={poSupplier} onChange={(e) => setPoSupplier(e.target.value)} placeholder="mis. CV Sumber Rejeki" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="po-jumlah">Jumlah</Label>
                <Input id="po-jumlah" inputMode="numeric" value={poQty} onChange={(e) => setPoQty(e.target.value)} placeholder="0" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="po-biaya">Biaya / unit</Label>
                <Input id="po-biaya" inputMode="numeric" value={poCost} onChange={(e) => setPoCost(e.target.value)} placeholder={seedCost ? `Rp ${num(seedCost)}` : "Rp 0"} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="po-eta">Estimasi tiba</Label>
              <Input id="po-eta" type="date" value={poEta} onChange={(e) => setPoEta(e.target.value)} />
            </div>
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Total pembelian</span>
              <span className="font-semibold tabular-nums">{IDR(poTotal)}</span>
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Batal</Button>} />
            <DialogClose render={<Button>Buat PO</Button>} />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
