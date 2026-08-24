"use client";

import * as React from "react";
import { toast } from "sonner";
import { saveProductCardAspect, saveProductGalleryAspect, saveProductGalleryLayout } from "@/lib/actions/theme";
import { GALLERY_ASPECTS, type GalleryAspect } from "@tokophi/lib/theme";
import { GALLERY_LAYOUTS, type GalleryLayout } from "@/lib/gallery-layout";
import { useCan } from "@/components/admin/permissions";
import { cn } from "@tokophi/ui/lib/utils";
import { Button } from "@tokophi/ui/button";
import { Images } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@tokophi/ui/dialog";

const OPTIONS: { value: GalleryLayout; label: string; desc: string }[] = [
  { value: "thumbnail-left", label: "Thumbnail di samping", desc: "Deretan thumbnail di samping gambar utama." },
  { value: "thumbnail-bottom", label: "Thumbnail di bawah", desc: "Deretan thumbnail di bawah gambar utama." },
  { value: "grid", label: "Grid 2 kolom", desc: "Semua gambar tampil dalam grid 2 kolom." },
];

// Tiny flat previews — the picker's whole value is showing the shape at a glance, so it draws the real
// arrangement (rail beside / rail below / 2-col grid) rather than an icon.
// Tiny flat previews of the real arrangement. Thumbnails are drawn SQUARE (1:1) to match the storefront,
// and the FIRST one carries the active brand ring — the same selected look the gallery uses.
function Preview({ value }: { value: GalleryLayout }) {
  const main = "rounded-sm bg-muted-foreground/25";
  const thumb = "aspect-square shrink-0 rounded-[3px] bg-muted-foreground/25";
  const thumbActive = "aspect-square shrink-0 rounded-[3px] bg-muted-foreground/40 ring-1 ring-primary ring-offset-1 ring-offset-background";
  if (value === "thumbnail-left") {
    return (
      <div className="flex h-16 w-full gap-1.5">
        <div className="flex w-3.5 flex-col gap-1">
          <div className={cn(thumbActive, "w-full")} />
          <div className={cn(thumb, "w-full")} />
          <div className={cn(thumb, "w-full")} />
        </div>
        <div className={cn(main, "flex-1")} />
      </div>
    );
  }
  if (value === "thumbnail-bottom") {
    return (
      <div className="flex h-16 w-full flex-col gap-1.5">
        <div className={cn(main, "flex-1")} />
        <div className="flex h-3.5 gap-1">
          <div className={cn(thumbActive, "h-full")} />
          <div className={cn(thumb, "h-full")} />
          <div className={cn(thumb, "h-full")} />
          <div className={cn(thumb, "h-full")} />
        </div>
      </div>
    );
  }
  return (
    <div className="grid h-16 w-full grid-cols-2 grid-rows-2 gap-1">
      <div className={main} />
      <div className={main} />
      <div className={main} />
      <div className={main} />
    </div>
  );
}

const LABEL: Record<string, string> = {
  "thumbnail-left": "Thumbnail di samping",
  "thumbnail-bottom": "Thumbnail di bawah",
  grid: "Grid 2 kolom",
};

// Aspect previews: a fixed-height box with a centred rectangle whose width/height ratio IS the
// option — the shape is the label, the text under it is only the number.
const ASPECT_OPTIONS: { value: GalleryAspect; label: string; desc: string }[] = [
  { value: "1:1", label: "1:1", desc: "Persegi — bawaan" },
  { value: "4:5", label: "4:5", desc: "Potret" },
  { value: "2:3", label: "2:3", desc: "Potret tinggi" },
];
const ASPECT_PREVIEW: Record<GalleryAspect, string> = {
  "1:1": "aspect-square h-12",
  "4:5": "aspect-[4/5] h-14",
  "2:3": "aspect-[2/3] h-16",
};

export function GalleryLayoutDialog({ initialLayout, initialAspect, initialCardAspect }: { initialLayout: string; initialAspect: GalleryAspect; initialCardAspect: GalleryAspect }) {
  const canWrite = useCan("theme:write");
  const start = (GALLERY_LAYOUTS as readonly string[]).includes(initialLayout)
    ? (initialLayout as GalleryLayout)
    : "thumbnail-left";
  const [layout, setLayout] = React.useState<GalleryLayout>(start);
  const [aspect, setAspect] = React.useState<GalleryAspect>(initialAspect);
  const [cardAspect, setCardAspect] = React.useState<GalleryAspect>(initialCardAspect);
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const handleSave = () => {
    if (!canWrite) {
      toast.error("Akses ditolak — peran Anda tidak bisa mengubah tema toko");
      return;
    }
    startTransition(async () => {
      try {
        // Two settings, two actions, ONE outcome report: the second failing after the first saved
        // must say so, or the merchant re-saves believing nothing stuck.
        const res = await saveProductGalleryLayout(layout);
        if (!res.ok) { toast.error(res.error); return; }
        const res2 = await saveProductGalleryAspect(aspect);
        if (!res2.ok) { toast.error(`Layout tersimpan, tapi rasio galeri gagal: ${res2.error}`); return; }
        const res3 = await saveProductCardAspect(cardAspect);
        if (!res3.ok) { toast.error(`Galeri tersimpan, tapi rasio kartu gagal: ${res3.error}`); return; }
        toast.success("Layout galeri tersimpan");
        setOpen(false);
      } catch {
        toast.error("Gagal menyimpan layout galeri");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm">
            <Images className="mr-1.5 size-4" aria-hidden="true" />
            Galeri Produk
          </Button>
        }
      />
      {/* LANDSCAPE, not portrait (owner 2026-08-24): with two aspect rows the stacked layout grew
          taller than a laptop viewport and Simpan fell off-screen. Wide dialog, layout picker on
          the left, both aspect rows on the right; max-h + scroll as the floor for short screens. */}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl lg:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Layout Galeri Produk</DialogTitle>
          <DialogDescription>
            Susunan gambar di halaman produk. Berlaku untuk semua produk di storefront.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-2">
        <div className="grid content-start gap-3">
          <p className="text-sm font-medium">Susunan galeri</p>
          {OPTIONS.map((opt) => {
            const selected = layout === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setLayout(opt.value)}
                aria-pressed={selected}
                className={cn(
                  "flex items-center gap-4 rounded-xl border p-3 text-left transition-colors",
                  selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-input hover:bg-muted/50",
                )}
              >
                <div className="w-24 shrink-0 rounded-lg bg-background p-2 ring-1 ring-border">
                  <Preview value={opt.value} />
                </div>
                <div className="min-w-0">
                  <p className="font-medium">{opt.label}</p>
                  <p className="text-sm text-muted-foreground">{opt.desc}</p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="grid content-start gap-5">
        {/* ── Rasio gambar utama (owner request 2026-08-24) ── */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Rasio thumbnail utama</p>
          <div className="flex gap-3">
            {ASPECT_OPTIONS.map((opt) => {
              const selected = aspect === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setAspect(opt.value)}
                  aria-pressed={selected}
                  className={cn(
                    "flex flex-1 flex-col items-center gap-1.5 rounded-xl border p-3 transition-colors",
                    selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-input hover:bg-muted/50",
                  )}
                >
                  <span className="flex h-16 items-center justify-center">
                    <span className={cn("rounded-[4px] bg-muted-foreground/25", ASPECT_PREVIEW[opt.value])} />
                  </span>
                  <span className="text-sm font-medium">{opt.label}</span>
                  <span className="text-xs text-muted-foreground">{opt.desc}</span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Berlaku untuk gambar utama galeri produk. Thumbnail kecil tetap persegi.
          </p>
        </div>

        {/* ── Rasio gambar KARTU produk (owner request 2026-08-24 ronde 2) — kartu katalog di
            beranda/kategori/grid; surface yang berbeda dari galeri PDP, jadi kunci sendiri. ── */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Rasio gambar kartu produk</p>
          <div className="flex gap-3">
            {ASPECT_OPTIONS.map((opt) => {
              const selected = cardAspect === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCardAspect(opt.value)}
                  aria-pressed={selected}
                  className={cn(
                    "flex flex-1 flex-col items-center gap-1.5 rounded-xl border p-3 transition-colors",
                    selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-input hover:bg-muted/50",
                  )}
                >
                  <span className="flex h-16 items-center justify-center">
                    <span className={cn("rounded-[4px] bg-muted-foreground/25", ASPECT_PREVIEW[opt.value])} />
                  </span>
                  <span className="text-sm font-medium">{opt.label}</span>
                  <span className="text-xs text-muted-foreground">{opt.desc}</span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Berlaku untuk kartu produk di beranda, kategori, dan grid produk.
          </p>
        </div>
        </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline">Batal</Button>} />
          <Button onClick={handleSave} disabled={pending}>
            {pending ? "Menyimpan…" : `Simpan (${LABEL[layout]})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
