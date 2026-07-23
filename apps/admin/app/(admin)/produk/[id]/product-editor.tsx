"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createProduct, updateProduct, deleteProduct, duplicateProduct, type ProductInput } from "@/lib/actions/products";
import { uploadProductImage, deleteProductImage } from "@/lib/actions/media";
import {
  ChevronLeft,
  Bold,
  Italic,
  List,
  Link2,
  ImagePlus,
  Plus,
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
import { IDR, num } from "@tokophi/lib/format";
import { useCan } from "@/components/admin/permissions";
import { useStoreName } from "@/components/admin/store-context";
import { GoogleCategoryField } from "./taxonomy-field";

import { Card, CardHeader, CardTitle, CardContent } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Badge } from "@tokophi/ui/badge";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Textarea } from "@tokophi/ui/textarea";
import { Switch } from "@tokophi/ui/switch";
import { Separator } from "@tokophi/ui/separator";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@tokophi/ui/dialog";

const CATEGORIES = [
  "Dress",
  "Atasan",
  "Bawahan",
  "Busana Muslim",
  "Outerwear",
  "Loungewear",
  "Aksesoris",
];

const LOW_STOCK = 20;

// Char-counter colour: muted normally, amber near the cap, red at the cap — so the hard
// maxLength stop is signalled instead of the input silently refusing more keystrokes.
const counterClass = (len: number, max: number) =>
  len >= max
    ? "text-red-500"
    : len >= max * 0.9
      ? "text-amber-600 dark:text-amber-400"
      : "text-muted-foreground";

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

// ---- variants ----
type OptionDef = { name: string; values: string[] }; // chip values (e.g. ["Merah","Biru"])
const MAX_OPTIONS = 2; // locked to 2 variant types (e.g. Warna + Ukuran) — Shopify-style, curated
// Cartesian product of each option's parsed values → every variant combo.
function cartesian(valueLists: string[][]): string[][] {
  return valueLists.reduce<string[][]>((acc, vals) => acc.flatMap((combo) => vals.map((v) => [...combo, v])), [[]]);
}
const comboKeyOf = (combo: string[]) => combo.join(" / ");

export function ProductEditor({ product }: { product?: Product }) {
  const isEdit = Boolean(product);

  // RBAC (UI): mirror the server guard so we don't offer actions the role can't do.
  const canWrite = useCan("products:write");
  const canDelete = useCan("products:delete");
  const canMedia = useCan("media:write");
  const storeName = useStoreName();

  // Cost seeds the Purchase Order dialog fallback — real saved cost, no longer fabricated.
  const seedCost = product?.cost ?? 0;

  // ---- form state (edit: hydrate from the saved product; new: empty) ----
  const [name, setName] = React.useState(product?.name ?? "");
  const [description, setDescription] = React.useState(product?.description ?? "");

  const [price, setPrice] = React.useState(String(product?.price ?? ""));
  const [compareAt, setCompareAt] = React.useState(product?.compareAt ? String(product.compareAt) : "");
  const [cost, setCost] = React.useState(product?.cost ? String(product.cost) : "");

  const [trackQty, setTrackQty] = React.useState(true);
  const [sku, setSku] = React.useState(product?.sku ?? "");
  const [barcode, setBarcode] = React.useState("");
  const [qty, setQty] = React.useState(String(product?.stock ?? ""));

  const [hasVariants, setHasVariants] = React.useState<boolean>(!!(product?.variants?.length && product?.options?.length));
  const [options, setOptions] = React.useState<OptionDef[]>(
    product?.options?.length
      ? product.options.map((o) => ({ name: o.name, values: [...o.values] }))
      : [{ name: "Ukuran", values: ["S", "M", "L"] }],
  );
  const [valueDrafts, setValueDrafts] = React.useState<string[]>([]); // per-option "type new value" input
  const [bulkPrice, setBulkPrice] = React.useState("");
  const [bulkStock, setBulkStock] = React.useState("");
  // per-combo overrides keyed by "val1 / val2" → { price, stock, sku }
  const [variantMap, setVariantMap] = React.useState<Record<string, { price: string; stock: string; sku: string }>>(() => {
    const m: Record<string, { price: string; stock: string; sku: string }> = {};
    product?.variants?.forEach((v) => {
      const key = [v.option1, v.option2, v.option3].filter(Boolean).join(" / ");
      if (key) m[key] = { price: String(v.price ?? ""), stock: String(v.stock ?? ""), sku: v.sku ?? "" };
    });
    return m;
  });

  const [physical, setPhysical] = React.useState(true);
  const [weight, setWeight] = React.useState(product?.weightGrams ? String(product.weightGrams) : "500");
  const [lengthCm, setLengthCm] = React.useState(product?.lengthCm ? String(product.lengthCm) : "");
  const [widthCm, setWidthCm] = React.useState(product?.widthCm ? String(product.widthCm) : "");
  const [heightCm, setHeightCm] = React.useState(product?.heightCm ? String(product.heightCm) : "");

  const [status, setStatus] = React.useState<Product["status"]>(
    product?.status ?? "draft"
  );

  const [chOnline, setChOnline] = React.useState(true);

  const [category, setCategory] = React.useState(product?.category ?? "Fashion");
  // Standard Google taxonomy (ADR 0011) — separate from the merchant's own `category` above.
  const [gcatId, setGcatId] = React.useState<number | null>(product?.googleCategoryId ?? null);
  const [gcatPath, setGcatPath] = React.useState(product?.googleCategoryPath ?? "");
  const [productType, setProductType] = React.useState(product?.productType ?? "");
  const [vendor, setVendor] = React.useState(product?.vendor || storeName);
  const [tags, setTags] = React.useState("");

  const [seoTitle, setSeoTitle] = React.useState(product?.seoTitle ?? "");
  const [metaDesc, setMetaDesc] = React.useState(product?.seoDesc ?? "");
  const [handle, setHandle] = React.useState(
    product ? (product.handle ?? slugify(product.name)) : ""
  );
  // existing products keep their handle (don't auto-slug from name); new products auto-slug.
  const [handleEdited, setHandleEdited] = React.useState(!!product);

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

  // ---- persist to Postgres via server actions ----
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const buildInput = (): ProductInput => {
    const useVar = hasVariants && parsedOptions.length > 0 && combos.length > 0;
    return {
      name: name.trim(),
      description,
      status: status === "draft" ? "draft" : "active",
      category,
      productType,
      vendor,
      seoTitle: seoTitle.trim() || undefined,
      seoDesc: metaDesc.trim() || undefined,
      googleCategoryId: gcatId,
      googleCategoryPath: gcatPath || undefined,
      handle: handle || slugify(name),
      price: Number(price) || 0,
      compareAt: compareAt ? Number(compareAt) : null,
      cost: cost ? Number(cost) : null,
      sku: sku || undefined,
      weightGrams: physical && weight ? Number(weight) : null,
      lengthCm: physical && lengthCm ? Number(lengthCm) : null,
      widthCm: physical && widthCm ? Number(widthCm) : null,
      heightCm: physical && heightCm ? Number(heightCm) : null,
      stock: Number(qty) || 0,
      options: useVar ? parsedOptions.map((o) => ({ name: o.name, values: o.values })) : undefined,
      variants: useVar
        ? combos.map((c) => {
            const ov = variantMap[comboKeyOf(c)];
            return {
              option1: c[0] ?? null, option2: c[1] ?? null, option3: c[2] ?? null,
              price: Number(ov?.price ?? price) || 0,
              stock: Number(ov?.stock ?? 0) || 0,
              sku: ov?.sku || null,
            };
          })
        : undefined,
    };
  };
  const handleSave = () => {
    if (!canWrite) {
      toast.error("Akses ditolak — peran Anda tidak bisa menyimpan produk");
      return;
    }
    if (!name.trim()) {
      toast.error("Nama produk wajib diisi");
      return;
    }
    startTransition(async () => {
      try {
        if (isEdit && product) {
          await updateProduct(product.id, buildInput());
          toast.success("Perubahan produk disimpan");
          router.push("/produk");
        } else {
          // Land on the NEW product's own page, not the list. The Media card can only upload once a
          // product row exists (see the note there), so it tells the merchant to save first — and a
          // bounce to /produk would make them hunt for the product they just created to act on that
          // instruction. `createProduct` already returned this id; it was being thrown away.
          const id = await createProduct(buildInput());
          toast.success("Produk baru disimpan — foto bisa ditambahkan sekarang");
          router.push(`/produk/${id}`);
        }
        router.refresh();
      } catch {
        toast.error("Gagal menyimpan produk");
      }
    });
  };
  const handleDelete = () => {
    if (!product) return;
    startTransition(async () => {
      try {
        await deleteProduct(product.id);
        toast.success("Produk diarsipkan");
        router.push("/produk");
        router.refresh();
      } catch {
        toast.error("Gagal mengarsipkan produk");
      }
    });
  };
  const handleDuplicate = () => {
    if (!product) return;
    startTransition(async () => {
      const r = await duplicateProduct(product.id);
      if (r.ok && r.id) {
        toast.success("Produk diduplikat sebagai draft.");
        router.push(`/produk/${r.id}`);
      } else {
        toast.error(r.error ?? "Gagal menduplikat produk");
      }
    });
  };

  // ---- media upload/delete (local storage → product_media) ----
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [uploading, startUpload] = React.useTransition();
  const [dragOver, setDragOver] = React.useState(false);
  const MAX_UPLOAD = 2 * 1024 * 1024; // 2MB — converted to WebP on the server
  // ONE upload path for both the click-to-pick input and the drag-and-drop zone. They used to be
  // click-only; a merchant dragging a photo onto the grid dropped it on the page and navigated the
  // browser away from the unsaved editor. Both entry points must stay on this function — the checks
  // below (image?, 2MB?) mirror the server's `checkFile` and drifting copies is how a client says
  // "ok" to a file the boundary then rejects.
  // `uploadProductImage` takes ONE file per call, so several files upload SEQUENTIALLY — awaited one
  // after another, with a single router.refresh() at the end. Not concurrently: N parallel actions
  // race the same refresh, and `position` is computed server-side as max(position)+1, so concurrent
  // inserts would read the same max and collide on the photo order the merchant just chose.
  // And not "take the first and ignore the rest" — a seller dragging five product photos means five.
  const uploadFiles = (files: File[]) => {
    if (!product || files.length === 0) return;
    // Mirror the server's `checkFile` so we reject locally rather than round-trip. Rejected files are
    // NAMED: a silent skip in a multi-file drop is how a merchant ends up with four photos and no idea
    // which one is missing.
    const ok: File[] = [];
    for (const f of files) {
      if (!f.type.startsWith("image/")) toast.error(`${f.name}: harus berupa gambar.`);
      else if (f.size > MAX_UPLOAD) toast.error(`${f.name}: melebihi 2MB (${(f.size / 1048576).toFixed(1)}MB).`);
      else ok.push(f);
    }
    if (!ok.length) return;
    startUpload(async () => {
      let done = 0;
      for (const f of ok) {
        const fd = new FormData();
        fd.append("file", f);
        try {
          await uploadProductImage(product.id, fd);
          done++;
        } catch {
          toast.error(`${f.name}: gagal diunggah.`);
        }
      }
      // Report what actually landed, not what was attempted.
      if (done) toast.success(done === 1 ? "Gambar diunggah (dikonversi ke WebP)." : `${done} gambar diunggah (dikonversi ke WebP).`);
      router.refresh();
    });
  };
  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-picking the same file
    uploadFiles(files);
  };
  const onDropFiles = (files: FileList) => uploadFiles(Array.from(files));
  const removeImage = (mediaId: string) => {
    if (!product) return;
    startUpload(async () => {
      try {
        await deleteProductImage(mediaId, product.id);
        toast.success("Gambar dihapus");
        router.refresh();
      } catch {
        toast.error("Gagal menghapus gambar");
      }
    });
  };

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

  const parsedOptions = options
    .map((o) => ({ name: o.name.trim(), values: o.values.filter(Boolean) }))
    .filter((o) => o.name && o.values.length);
  const combos = hasVariants && parsedOptions.length ? cartesian(parsedOptions.map((o) => o.values)) : [];
  const variantAt = (key: string) => variantMap[key] ?? { price, stock: "0", sku: "" };
  const setVariantField = (key: string, field: "price" | "stock" | "sku", val: string) =>
    setVariantMap((prev) => ({ ...prev, [key]: { ...(prev[key] ?? { price, stock: "0", sku: "" }), [field]: val } }));

  const setOptionName = (idx: number, name: string) => setOptions((prev) => prev.map((o, i) => (i === idx ? { ...o, name } : o)));
  const addOption = () => setOptions((prev) => (prev.length < MAX_OPTIONS ? [...prev, { name: "", values: [] }] : prev));
  const removeOption = (idx: number) => setOptions((prev) => prev.filter((_, i) => i !== idx));
  // chip values: type + Enter/comma adds one (or several if pasted comma-list); dedupes.
  const addValue = (idx: number, raw: string) => {
    const vals = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (!vals.length) return;
    setOptions((prev) => prev.map((o, i) => (i === idx ? { ...o, values: [...o.values, ...vals.filter((v) => !o.values.includes(v))] } : o)));
  };
  const removeValue = (idx: number, val: string) =>
    setOptions((prev) => prev.map((o, i) => (i === idx ? { ...o, values: o.values.filter((v) => v !== val) } : o)));
  const setValueDraft = (idx: number, val: string) => setValueDrafts((prev) => { const n = [...prev]; n[idx] = val; return n; });

  // bulk-apply price/stock to every generated variant (TikTok Shop / Shopee-style "atur sekaligus")
  const applyBulk = () => {
    if (!combos.length) return;
    setVariantMap((prev) => {
      const next = { ...prev };
      for (const c of combos) {
        const key = comboKeyOf(c);
        const cur = prev[key] ?? { price, stock: "0", sku: "" };
        next[key] = { price: bulkPrice !== "" ? bulkPrice : cur.price, stock: bulkStock !== "" ? bulkStock : cur.stock, sku: cur.sku };
      }
      return next;
    });
    toast.success("Harga & stok diterapkan ke semua varian.");
  };

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
                <DropdownMenuItem disabled={pending} onClick={handleDuplicate}>
                  <Copy /> Duplikat
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" disabled={pending} onClick={handleDelete}>
                  <Archive /> Arsipkan
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {isEdit && canDelete && (
            <Button
              variant="ghost"
              className="text-destructive hover:bg-destructive/10"
              onClick={handleDelete}
              disabled={pending}
            >
              <Trash2 />
              Hapus produk
            </Button>
          )}
          <Button variant="ghost" nativeButton={false} render={<Link href="/produk" />}>
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
                  <Label htmlFor="p-judul">Judul</Label>
                  <span className={`text-xs tabular-nums ${counterClass(name.length, 100)}`}>
                    {num(name.length)}/100
                  </span>
                </div>
                <Input
                  id="p-judul"
                  value={name}
                  maxLength={100}
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
              <p className="text-xs text-muted-foreground">Maks <span className="font-medium text-foreground">2MB</span> per gambar · otomatis dikonversi ke WebP.</p>
              {/* Image grid */}
              {isEdit ? (
                <div
                  onDragOver={(e) => { e.preventDefault(); if (canMedia) setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); if (canMedia) onDropFiles(e.dataTransfer.files); }}
                  className={`grid grid-cols-4 gap-3 rounded-lg transition-colors sm:grid-cols-5 ${dragOver ? "bg-primary/5 ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}
                >
                  {(product!.media ?? []).map((m, i) => (
                    <div key={m.id} className="group relative aspect-square overflow-hidden rounded-lg border bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={m.url} alt={`${product!.name} ${i + 1}`} loading="lazy" className="size-full object-cover" />
                      {i === 0 && (
                        <span className="absolute left-1 top-1 rounded bg-foreground/80 px-1.5 py-0.5 text-[10px] font-medium text-background">
                          Utama
                        </span>
                      )}
                      {canMedia && (
                        <button
                          type="button"
                          aria-label={`Hapus gambar ${i + 1}`}
                          disabled={uploading}
                          onClick={() => removeImage(m.id)}
                          className="absolute right-1 top-1 rounded bg-background/85 p-1 text-destructive opacity-0 transition-opacity hover:bg-background group-hover:opacity-100 disabled:opacity-50"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  {canMedia && (
                    <button
                      type="button"
                      disabled={uploading}
                      onClick={() => fileRef.current?.click()}
                      className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-muted-foreground/40 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
                    >
                      {uploading ? <span className="text-[10px]">Mengunggah…</span> : (<><ImagePlus className="size-5" /><span className="text-[10px]">Unggah</span></>)}
                      <span className="sr-only">Klik untuk memilih gambar, atau seret gambar ke area ini</span>
                    </button>
                  )}
                  <input ref={fileRef} type="file" accept="image/*" onChange={onPickFile} className="hidden" />
                </div>
              ) : (
                /* NEW-PRODUCT MODE: honestly unavailable, not a live-looking dead control.
                   This used to render a "Foto" button and three "+" tiles pixel-identical to the
                   working edit-mode uploader, with ZERO onClick and no file input — a merchant
                   creating a product clicked them and nothing happened, with nothing to explain why.
                   The blocker is real: `uploadProductImage(productId, …)` writes a `product_media`
                   row FK'd to a product that does not exist until Simpan. Wiring it would mean
                   holding files in browser memory and replaying them after create — which invents a
                   half-saved state (product written, photos failed) that nothing in this editor can
                   report or retry. So: state the constraint, and make the path short — handleSave
                   now lands a new product on its OWN edit page, where the uploader above is live. */
                <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-muted-foreground/40 bg-muted/20 px-4 py-8 text-center">
                  <ImagePlus className="size-5 text-muted-foreground" />
                  <p className="text-sm font-medium text-muted-foreground">Foto belum bisa ditambahkan</p>
                  <p className="text-xs text-muted-foreground">
                    Simpan produk dulu, lalu tambahkan foto di halaman produk ini.
                  </p>
                </div>
              )}

              {/* The number is the SERVER's (MAX_BYTES = 2 MB in lib/image-store.ts), not a
                  nicer-sounding one. It said 5 MB — so a merchant uploading a 4 MB photo was told it
                  was fine and then rejected. The card above already said 2 MB: the same card
                  contradicted itself.
                  The FORMAT list is the server's too. It said "JPG/PNG" while the input accepts
                  `image/*` and `saveImage` handles WebP (re-encoded only when that measurably wins)
                  and SVG (stored untouched) — under-promising sends a merchant off to convert a file
                  that would have worked. GIF goes through the sharp branch to WebP, so it is a still
                  frame, not an animation: say that rather than list it as if it survives. */}
              <p className="text-xs text-muted-foreground">
                Foto pertama jadi gambar utama. Format JPG, PNG, WebP, atau SVG — maks 2 MB.
                Selain SVG, semua dikonversi ke WebP.
              </p>

              {/* The "Video produk" card was REMOVED (2026-07-20), not disabled. It advertised
                  "1 video · MP4/MOV maks 50 MB" on two <button>s with no onClick, no input and no
                  handler — and there is no video pipeline anywhere in this repo to wire them to:
                  `lib/image-store.ts` `checkFile` throws "not an image" on anything that is not
                  `image/*`, and its MAX_BYTES is 2 MB — 1/25th of the 50 MB the card promised. A
                  "segera hadir" placeholder was the other option and was rejected: nothing is
                  scheduled, so it would be the same promise in a quieter font. Bring the card back
                  in the same commit that brings a video pipeline. */}
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
                <Switch id="p-hasvar" checked={hasVariants} onCheckedChange={setHasVariants} />
              </div>

              {hasVariants && (
                <div className="flex flex-col gap-4">
                  {/* option types (locked to 2) — chip values, TikTok Shop / Shopee-style */}
                  <div className="flex flex-col gap-3">
                    {options.map((opt, i) => (
                      <div key={i} className="flex flex-col gap-3 rounded-lg border p-3">
                        <div className="flex items-end gap-3">
                          <div className="grid flex-1 gap-1.5">
                            <Label className="text-xs text-muted-foreground">Jenis varian {i + 1}</Label>
                            <Input value={opt.name} onChange={(e) => setOptionName(i, e.target.value)} placeholder={i === 0 ? "mis. Warna" : "mis. Ukuran"} />
                          </div>
                          <Button type="button" variant="ghost" size="icon" aria-label="Hapus jenis varian" disabled={options.length <= 1} onClick={() => removeOption(i)}>
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                        <div className="grid gap-1.5">
                          <Label className="text-xs text-muted-foreground">Nilai</Label>
                          <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 py-1.5">
                            {opt.values.map((v) => (
                              <Badge key={v} variant="secondary" className="gap-1 pr-1">
                                {v}
                                <button type="button" aria-label={`Hapus ${v}`} onClick={() => removeValue(i, v)} className="rounded-full p-0.5 opacity-60 hover:bg-foreground/10 hover:opacity-100">
                                  <X className="size-3" />
                                </button>
                              </Badge>
                            ))}
                            <input
                              className="min-w-28 flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground"
                              value={valueDrafts[i] ?? ""}
                              onChange={(e) => setValueDraft(i, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addValue(i, valueDrafts[i] ?? ""); setValueDraft(i, ""); }
                                else if (e.key === "Backspace" && !(valueDrafts[i] ?? "") && opt.values.length) { removeValue(i, opt.values[opt.values.length - 1]); }
                              }}
                              onBlur={() => { if ((valueDrafts[i] ?? "").trim()) { addValue(i, valueDrafts[i] ?? ""); setValueDraft(i, ""); } }}
                              placeholder={opt.values.length ? "Tambah nilai…" : "Ketik nilai lalu Enter (mis. Merah)"}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                    {options.length < MAX_OPTIONS && (
                      <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" onClick={addOption}>
                        <Plus className="size-4" /> Tambah jenis varian
                      </Button>
                    )}
                  </div>

                  {/* bulk apply price + stock to every variant (atur sekaligus) */}
                  {combos.length > 0 && (
                    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3">
                      <div className="grid gap-1.5">
                        <Label className="text-xs text-muted-foreground">Harga semua</Label>
                        <div className="relative max-w-32">
                          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">Rp</span>
                          <Input id="p-bulk-harga" inputMode="numeric" value={bulkPrice} onChange={(e) => setBulkPrice(e.target.value.replace(/[^\d]/g, ""))} placeholder="0" className="pl-8 tabular-nums" />
                        </div>
                      </div>
                      <div className="grid gap-1.5">
                        <Label className="text-xs text-muted-foreground">Stok semua</Label>
                        <Input id="p-bulk-stok" inputMode="numeric" value={bulkStock} onChange={(e) => setBulkStock(e.target.value.replace(/[^\d]/g, ""))} placeholder="0" className="max-w-24 tabular-nums" />
                      </div>
                      <Button type="button" variant="outline" onClick={applyBulk}>Terapkan ke semua</Button>
                    </div>
                  )}

                  {/* generated variant matrix — price/stock/sku per combo */}
                  {combos.length > 0 ? (
                    <div className="overflow-x-auto rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Varian</TableHead>
                            <TableHead>SKU</TableHead>
                            <TableHead>Harga</TableHead>
                            <TableHead>Stok</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {combos.map((c) => {
                            const key = comboKeyOf(c);
                            const row = variantAt(key);
                            return (
                              <TableRow key={key}>
                                <TableCell className="font-medium whitespace-nowrap">{key}</TableCell>
                                <TableCell>
                                  <Input value={row.sku} onChange={(e) => setVariantField(key, "sku", e.target.value)} placeholder="SKU" className="max-w-32" />
                                </TableCell>
                                <TableCell>
                                  <div className="relative max-w-36">
                                    <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">Rp</span>
                                    <Input inputMode="numeric" value={row.price} onChange={(e) => setVariantField(key, "price", e.target.value.replace(/[^\d]/g, ""))} className="pl-8 tabular-nums" />
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Input inputMode="numeric" value={row.stock} onChange={(e) => setVariantField(key, "stock", e.target.value.replace(/[^\d]/g, ""))} className="max-w-24 tabular-nums" />
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                      <div className="border-t px-3 py-2 text-xs text-muted-foreground">
                        {combos.length} varian dari {parsedOptions.length} opsi
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Isi nama &amp; nilai opsi untuk menghasilkan varian.</p>
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
                <div className="space-y-4">
                  {/* Berat — prioritas untuk ongkir */}
                  <div className="grid gap-2 sm:max-w-[50%]">
                    <Label htmlFor="p-berat">Berat (gram) <span className="text-red-500">*</span></Label>
                    <Input
                      id="p-berat"
                      inputMode="numeric"
                      value={weight}
                      onChange={(e) => setWeight(e.target.value)}
                      placeholder="mis. 250"
                      className="tabular-nums"
                    />
                    <p className="text-xs text-muted-foreground">
                      Berat aktual barang, dipakai menghitung ongkir. Contoh: kaos ±250 g · dress ±400 g · jaket ±700 g · sepatu ±800 g.
                    </p>
                  </div>

                  {/* Dimensi — untuk berat volumetrik */}
                  <div className="grid gap-2">
                    <Label>Dimensi paket (cm)</Label>
                    <div className="grid grid-cols-3 gap-2 sm:max-w-md">
                      <div className="relative">
                        <Input id="p-panjang" inputMode="numeric" value={lengthCm} onChange={(e) => setLengthCm(e.target.value)} placeholder="Panjang" className="tabular-nums" />
                      </div>
                      <div className="relative">
                        <Input id="p-lebar" inputMode="numeric" value={widthCm} onChange={(e) => setWidthCm(e.target.value)} placeholder="Lebar" className="tabular-nums" />
                      </div>
                      <div className="relative">
                        <Input id="p-tinggi" inputMode="numeric" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} placeholder="Tinggi" className="tabular-nums" />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Panjang × Lebar × Tinggi. Dipakai untuk <b>berat volumetrik</b> (P×L×T ÷ 6.000 = kg). Kurir memakai yang <b>lebih besar</b> antara berat aktual & volumetrik. Contoh: dress terlipat 30 × 25 × 5 cm · sepatu 33 × 22 × 12 cm.
                    </p>
                  </div>
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
                <div className="flex items-center justify-between">
                  <Label htmlFor="seo-title">Judul SEO</Label>
                  <span className={`text-xs tabular-nums ${counterClass(seoTitle.length, 70)}`}>
                    {num(seoTitle.length)}/70
                  </span>
                </div>
                <Input
                  id="seo-title"
                  value={seoTitle}
                  maxLength={70}
                  onChange={(e) => setSeoTitle(e.target.value)}
                  placeholder={name || "Judul produk"}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="seo-desc">Deskripsi meta</Label>
                  <span className={`text-xs tabular-nums ${counterClass(metaDesc.length, 160)}`}>
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
              <GoogleCategoryField
                value={gcatId}
                path={gcatPath}
                title={name}
                category={category}
                onChange={(id, p) => { setGcatId(id); setGcatPath(p); }}
              />
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
