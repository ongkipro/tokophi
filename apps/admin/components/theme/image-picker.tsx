"use client";
// The Store Builder image field — a Shopify-style picker rendered by a Puck `type:"custom"` field.
// The stored VALUE stays a plain URL string (back-compat: old templates keep working, storefront reads
// it unchanged). Sources: the store's media library, a fresh upload, a pasted URL, or a product /
// category's own photo. Everything it reads is already tenant-scoped server-side.
import * as React from "react";
import { toast } from "sonner";
import { UploadCloud, ImageIcon, X, Check, Link2, LayoutGrid, Package, Tag, ArrowLeft } from "lucide-react";
import { getMediaPage, uploadMedia, type MediaItem } from "@/lib/actions/media";
import { pickerProducts, pickerCategoryImages, type PickerImage } from "@/lib/actions/picker";
import { useCan } from "@/components/admin/permissions";
import { cn } from "@tokophi/ui/lib/utils";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@tokophi/ui/dialog";
import { SearchInput } from "@/components/admin/search-input";

type TabKey = "galeri" | "upload" | "url" | "produk" | "kategori";
const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "galeri", label: "Galeri", icon: LayoutGrid },
  { key: "upload", label: "Upload", icon: UploadCloud },
  { key: "url", label: "URL", icon: Link2 },
  { key: "produk", label: "Produk", icon: Package },
  { key: "kategori", label: "Kategori", icon: Tag },
];
// 2MB, matching `lib/image-store.ts` MAX_BYTES — the server boundary. This said 5MB, so a 3MB
// photo passed the client gate, uploaded, and was refused with a raw "file too large".
const MAX = 2 * 1024 * 1024;

// A responsive, searchable grid of pickable images (used by Galeri / Produk / Kategori).
function ImageGrid({
  items,
  loading,
  current,
  onPick,
  emptyLabel,
  footer,
}: {
  items: { key: string; url: string; name: string; sub?: string }[];
  loading: boolean;
  current: string;
  /* Opens the PREVIEW pane (owner request 2026-08-24) — a grid tile is a peek, never a commit. The
     old behaviour picked+closed on first click, so one mis-tap on a 3-column phone grid published
     the wrong photo with no look at it. */
  onPick: (item: { url: string; name: string; sub?: string }) => void;
  emptyLabel: string;
  footer?: React.ReactNode;
}) {
  if (loading) return <p className="py-10 text-center text-sm text-muted-foreground">Memuat…</p>;
  if (items.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  return (
    <div className="grid max-h-[46vh] grid-cols-3 gap-3 overflow-y-auto p-0.5 sm:grid-cols-4">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          onClick={() => onPick(it)}
          title={it.name}
          className={cn(
            "group relative aspect-square overflow-hidden rounded-lg border bg-muted text-left transition-all",
            current === it.url ? "border-primary ring-2 ring-primary" : "border-border hover:border-primary/50",
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={it.url} alt={it.name} className="size-full object-cover" loading="lazy" />
          {current === it.url && (
            <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check className="size-3" />
            </span>
          )}
          <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 py-1 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">
            {it.name}
          </span>
        </button>
      ))}
      {footer}
    </div>
  );
}

export function ImagePickerField({
  value,
  onChange,
  field,
  readOnly,
}: {
  value: string;
  onChange: (v: string) => void;
  field: { label?: string };
  readOnly?: boolean;
}) {
  const canWrite = // `media:write` — the capability `uploadMedia` actually requires. `theme:write` happens to be a
  // subset today, so the two never diverge; they are different caps and one moved role flips that.
  useCan("media:write");
  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState<TabKey>("galeri");
  const [q, setQ] = React.useState("");
  const [urlDraft, setUrlDraft] = React.useState("");
  const [pending, start] = React.useTransition();
  const inputRef = React.useRef<HTMLInputElement>(null);

  // ── Galeri is PAGED (owner request 2026-08-24) ─────────────────────────────────────────────────
  // The picker used to pull the whole library at open. PAGE_SIZE rows per fetch, "Muat lebih banyak"
  // appends the next page, and search runs SERVER-side (getMediaPage) so it can match rows no page
  // has loaded yet. Produk/Kategori stay whole-list + client filter: both are bounded by the
  // catalogue, not by uploads.
  const PAGE_SIZE = 24;
  const [media, setMedia] = React.useState<MediaItem[] | null>(null);
  const [mediaTotal, setMediaTotal] = React.useState(0);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [products, setProducts] = React.useState<PickerImage[] | null>(null);
  const [categories, setCategories] = React.useState<PickerImage[] | null>(null);
  // A tapped tile shows a FULL preview first; picking is the explicit button in that pane.
  const [preview, setPreview] = React.useState<{ url: string; name: string; sub?: string } | null>(null);

  const loadGaleri = React.useCallback((offset: number, query: string) => {
    setLoadingMore(true);
    getMediaPage({ offset, limit: PAGE_SIZE, q: query })
      .then((r) => {
        setMedia((prev) => (offset === 0 ? r.items : [...(prev ?? []), ...r.items]));
        setMediaTotal(r.total);
      })
      .catch(() => { setMedia((prev) => prev ?? []); })
      .finally(() => setLoadingMore(false));
  }, []);

  // Lazy-load each source the first time its tab is opened; galeri re-queries on search (debounced —
  // a keystroke is not a request).
  React.useEffect(() => {
    if (!open) return;
    if (tab === "produk" && products === null) pickerProducts().then(setProducts).catch(() => setProducts([]));
    if (tab === "kategori" && categories === null) pickerCategoryImages().then(setCategories).catch(() => setCategories([]));
  }, [open, tab, products, categories]);
  React.useEffect(() => {
    if (!open || tab !== "galeri") return;
    const t = setTimeout(() => { setMedia(null); loadGaleri(0, q); }, media === null ? 0 : 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- q/tab/open drive refetch; media===null only picks the delay
  }, [open, tab, q, loadGaleri]);

  const pick = (url: string) => {
    onChange(url);
    setOpen(false);
    setQ("");
    setPreview(null);
  };

  const doUpload = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) return toast.error("File bukan gambar.");
    if (f.size > MAX) return toast.error(`Melebihi 5MB (${(f.size / 1048576).toFixed(1)}MB).`);
    const fd = new FormData();
    fd.append("file", f);
    start(async () => {
      const r = await uploadMedia(fd);
      if (r.ok && r.url) {
        setMedia(null); // force a refresh of the library next time
        toast.success("Gambar diunggah (WebP).");
        pick(r.url);
      } else toast.error(r.error ?? "Gagal mengunggah.");
    });
  };

  const match = (s: string) => !q.trim() || s.toLowerCase().includes(q.trim().toLowerCase());
  const label = field.label ?? "Gambar";

  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground">{label}</Label>

      {/* Current state: a thumbnail + change/clear, or an empty tappable frame. */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={readOnly}
          onClick={() => setOpen(true)}
          // Neither branch below produces text: with a value the only child is an `<img alt="">`
          // (correctly decorative — the picture is not the label), without one it is an icon. So
          // this control computed NO accessible name at all.
          aria-label={value ? `Ganti gambar — ${label}` : `Pilih gambar — ${label}`}
          className={cn(
            "relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted transition-colors",
            value ? "border-border" : "border-2 border-dashed border-border hover:border-primary/60",
          )}
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="size-full object-cover" />
          ) : (
            <ImageIcon className="size-5 text-muted-foreground" />
          )}
        </button>
        <div className="flex min-w-0 flex-col gap-1">
          <Button type="button" variant="outline" size="sm" disabled={readOnly} onClick={() => setOpen(true)}>
            {value ? "Ganti Gambar" : "Pilih Gambar"}
          </Button>
          {value ? (
            <button type="button" disabled={readOnly} onClick={() => onChange("")} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive">
              <X className="size-3" /> Hapus (pakai gradasi brand)
            </button>
          ) : (
            <span className="truncate text-xs text-muted-foreground">Kosong = gradasi warna brand</span>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setPreview(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Pilih Gambar</DialogTitle>
            <DialogDescription>Dari galeri, unggah baru, tempel URL, atau ambil dari produk / kategori.</DialogDescription>
          </DialogHeader>

          {/* Tab bar — plain buttons (segmented), no Base UI Tabs needed. */}
          <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => { setTab(t.key); setQ(""); setPreview(null); }}
                className={cn(
                  "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                  tab === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <t.icon className="size-4" /> {t.label}
              </button>
            ))}
          </div>

          {/* ── PREVIEW PANE — a tapped tile lands here, full-size, before anything commits.
              `object-contain` + eager: the whole point is seeing the real image (its crop, its
              text, its edges), so it must not be cover-cropped into the same lie the tile told. */}
          {preview ? (
            <div className="space-y-3">
              <div className="relative flex max-h-[52vh] min-h-[16rem] items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview.url} alt={preview.name} className="max-h-[52vh] w-auto max-w-full object-contain" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{preview.name}</p>
                  {preview.sub ? <p className="truncate text-xs text-muted-foreground">{preview.sub}</p> : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setPreview(null)}>
                    <ArrowLeft className="size-4" /> Kembali
                  </Button>
                  <Button type="button" size="sm" onClick={() => pick(preview.url)}>
                    <Check className="size-4" /> Pilih Gambar Ini
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <>
          {/* Search (galeri/produk/kategori) */}
          {(tab === "galeri" || tab === "produk" || tab === "kategori") && (
            <SearchInput label="Cari gambar" value={q} onValueChange={setQ} placeholder="Cari…" />
          )}

          {tab === "galeri" && (
            <ImageGrid
              items={(media ?? []).map((m) => ({ key: m.id, url: m.url, name: m.filename }))}
              loading={media === null}
              current={value}
              onPick={setPreview}
              emptyLabel={q.trim() ? "Tidak ada gambar yang cocok." : "Belum ada gambar di galeri. Unggah lewat tab Upload atau halaman Files."}
              footer={
                media !== null && media.length < mediaTotal ? (
                  <div className="col-span-full pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full"
                      disabled={loadingMore}
                      onClick={() => loadGaleri(media.length, q)}
                    >
                      {loadingMore ? "Memuat…" : `Muat lebih banyak (${mediaTotal - media.length} lagi)`}
                    </Button>
                  </div>
                ) : null
              }
            />
          )}

          {tab === "upload" && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); if (canWrite) doUpload(e.dataTransfer.files); }}
              className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border p-10 text-center"
            >
              <UploadCloud className={cn("size-8 text-muted-foreground", pending && "animate-pulse")} />
              <div className="text-sm">
                {pending ? (
                  <span className="font-medium text-muted-foreground">Mengunggah…</span>
                ) : canWrite ? (
                  <><button type="button" className="font-medium text-primary hover:underline" onClick={() => inputRef.current?.click()}>Pilih gambar</button>{" "}atau seret ke sini</>
                ) : (
                  <span className="text-muted-foreground">Peran Anda tidak bisa mengunggah.</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">JPG/PNG/WebP, maks 2MB — dikonversi ke WebP otomatis.</p>
              <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => doUpload(e.target.files)} />
            </div>
          )}

          {tab === "url" && (
            <div className="space-y-2">
              <Label className="text-muted-foreground">Tempel URL gambar atau path (mis. /hero/hero-1.webp)</Label>
              <div className="flex gap-2">
                <Input value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} placeholder="https://… atau /path/gambar.webp" />
                <Button type="button" disabled={!urlDraft.trim()} onClick={() => pick(urlDraft.trim())}>Gunakan</Button>
              </div>
            </div>
          )}

          {tab === "produk" && (
            <ImageGrid
              items={(products ?? []).filter((p) => match(p.name)).map((p) => ({ key: p.id, url: p.url, name: p.name, sub: p.sub }))}
              loading={products === null}
              current={value}
              onPick={setPreview}
              emptyLabel="Belum ada produk dengan foto terunggah."
            />
          )}

          {tab === "kategori" && (
            <ImageGrid
              items={(categories ?? []).filter((c) => match(c.name)).map((c) => ({ key: c.id, url: c.url, name: c.name }))}
              loading={categories === null}
              current={value}
              onPick={setPreview}
              emptyLabel="Belum ada kategori berisi produk berfoto."
            />
          )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
