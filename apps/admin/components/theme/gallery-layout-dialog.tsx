"use client";

import * as React from "react";
import { toast } from "sonner";
import { saveProductGalleryLayout } from "@/lib/actions/theme";
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

export function GalleryLayoutDialog({ initialLayout }: { initialLayout: string }) {
  const canWrite = useCan("theme:write");
  const start = (GALLERY_LAYOUTS as readonly string[]).includes(initialLayout)
    ? (initialLayout as GalleryLayout)
    : "thumbnail-left";
  const [layout, setLayout] = React.useState<GalleryLayout>(start);
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const handleSave = () => {
    if (!canWrite) {
      toast.error("Akses ditolak — peran Anda tidak bisa mengubah tema toko");
      return;
    }
    startTransition(async () => {
      try {
        await saveProductGalleryLayout(layout);
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Layout Galeri Produk</DialogTitle>
          <DialogDescription>
            Susunan gambar di halaman produk. Berlaku untuk semua produk di storefront.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
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
