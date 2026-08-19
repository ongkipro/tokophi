"use client";

import * as React from "react";
import { generateBrandShades, DEFAULT_BRAND_COLOR } from "@tokophi/lib/colors";
import { toast } from "sonner";
import { saveBrandColor } from "@/lib/actions/theme";
import { useCan } from "@/components/admin/permissions";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
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

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function BrandColorDialog({
  initialColor,
  onPreviewChange,
}: {
  initialColor: string;
  onPreviewChange?: (hex: string) => void;
}) {
  const canWrite = useCan("theme:write");
  const [hex, setHex] = React.useState(initialColor || DEFAULT_BRAND_COLOR);
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const openedWith = React.useRef(initialColor || DEFAULT_BRAND_COLOR);
  const savedRef = React.useRef(false);

  // Adjust during render, bukan effect (Task 5.11). `hex` mengikuti `initialColor` sampai merchant
  // mengetik; menyalinnya lewat effect membuat dialog sempat menampilkan warna lama satu render.
  const incomingColor = initialColor || DEFAULT_BRAND_COLOR;
  const [prevColor, setPrevColor] = React.useState(incomingColor);
  if (prevColor !== incomingColor) {
    setPrevColor(incomingColor);
    setHex(incomingColor);
  }

  const valid = HEX_RE.test(hex);
  const shades = valid ? generateBrandShades(hex) : null;

  const preview = React.useCallback((next: string) => {
    setHex(next);
    if (HEX_RE.test(next)) onPreviewChange?.(next);
  }, [onPreviewChange]);

  const handleSave = () => {
    if (!canWrite) {
      toast.error("Akses ditolak — peran Anda tidak bisa mengubah tema toko");
      return;
    }
    if (!valid) {
      toast.error("Format warna tidak valid");
      return;
    }
    startTransition(async () => {
      try {
        const res = await saveBrandColor(hex);
        if (res.ok) {
          savedRef.current = true;
          toast.success("Warna brand tersimpan");
          setOpen(false);
        } else {
          toast.error(res.error);
        }
      } catch {
        toast.error("Gagal menyimpan warna brand");
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          openedWith.current = hex;
          savedRef.current = false;
          setOpen(true);
          return;
        }
        setOpen(false);
        if (!savedRef.current) {
          setHex(openedWith.current);
          onPreviewChange?.(openedWith.current);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm">
            <span
              className="mr-1.5 size-4 rounded-full ring-1 ring-black/10"
              style={{ backgroundColor: valid ? hex : DEFAULT_BRAND_COLOR }}
              aria-hidden="true"
            />
            Warna Brand
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Warna Brand Toko</DialogTitle>
          <DialogDescription>
            Satu warna dasar — otomatis diturunkan jadi seluruh gradasi warna di storefront (tombol, badge, latar).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-end gap-3">
            {/* Both <Label>s were drawn without `htmlFor` and both controls without an `id`: on
                screen a labelled pair, to the accessibility tree nothing. Measured 2026-08-05 —
                the colour well had NO name, and the hex box was announced as "#a85572", its own
                placeholder, i.e. an example value where the field's purpose belongs. */}
            <div className="space-y-1.5">
              <Label htmlFor="brand-color">Pilih Warna</Label>
              <input
                id="brand-color"
                type="color"
                value={valid ? hex : DEFAULT_BRAND_COLOR}
                onChange={(e) => preview(e.target.value)}
                className="h-9 w-14 cursor-pointer rounded-lg border border-input bg-transparent p-1"
              />
            </div>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="brand-hex">Kode Hex</Label>
              <Input id="brand-hex" value={hex} onChange={(e) => preview(e.target.value)} placeholder="#a85572" />
            </div>
          </div>

          {!valid && <p className="text-sm text-destructive">Format hex tidak valid, contoh: #a85572</p>}

          {shades && (
            <div className="space-y-1.5">
              <Label>Pratinjau Gradasi</Label>
              <div className="flex overflow-hidden rounded-lg ring-1 ring-border">
                {Object.entries(shades).map(([shade, value]) => (
                  <div key={shade} className="h-10 flex-1" style={{ backgroundColor: value }} title={`brand-${shade}`} />
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline">Batal</Button>} />
          <Button onClick={handleSave} disabled={!valid || pending}>
            {pending ? "Menyimpan…" : "Simpan Warna"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
