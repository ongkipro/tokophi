"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  FONT_PAIRINGS,
  NEUTRAL_TONES,
  generateNeutrals,
  resolveTheme,
  type FontPairingId,
  type NeutralTone,
} from "@tokophi/lib/theme";
import { DEFAULT_BRAND_COLOR } from "@tokophi/lib/colors";
import { saveStoreTheme } from "@/lib/actions/theme";
import { useCan } from "@/components/admin/permissions";
import { cn } from "@tokophi/ui/lib/utils";
import { Button } from "@tokophi/ui/button";
import { Type } from "lucide-react";
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

// Tema panel "Tampilan" — the two design-token dials beyond the brand colour (stores.theme 0092):
// display font pairing + neutral tone. The storefront resolves the SAME registries this picker
// renders (@tokophi/lib/theme), so what is offered here is exactly what can render there.
//
// The font preview styles each row with the pairing's real CSS stack. The admin does not load the
// storefront's woff2 files, so a non-system family falls back to the stack's generic (Playfair →
// Georgia serif) — an honest approximation of the SHAPE, not a screenshot of the storefront.
export function ThemeTokensDialog({
  initialTheme,
  brandColor,
  onPreviewChange,
}: {
  initialTheme: unknown;
  brandColor: string;
  onPreviewChange?: (theme: { font: FontPairingId; tone: NeutralTone }) => void;
}) {
  const canWrite = useCan("theme:write");
  // resolveTheme is the one validator — garbage in the column degrades here exactly as it would
  // on the storefront, so the picker never shows a selection the shopper isn't seeing.
  const resolved = resolveTheme({ brandColor, theme: initialTheme });
  const [font, setFont] = React.useState<FontPairingId>(resolved.font.id);
  const [tone, setTone] = React.useState<NeutralTone>(resolved.tone);
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const openedWith = React.useRef<{ font: FontPairingId; tone: NeutralTone }>({ font: resolved.font.id, tone: resolved.tone });
  const savedRef = React.useRef(false);

  React.useEffect(() => {
    setFont(resolved.font.id);
    setTone(resolved.tone);
  }, [resolved.font.id, resolved.tone]);

  React.useEffect(() => {
    onPreviewChange?.({ font, tone });
  }, [font, onPreviewChange, tone]);

  const handleSave = () => {
    if (!canWrite) {
      toast.error("Akses ditolak — peran Anda tidak bisa mengubah tema toko");
      return;
    }
    startTransition(async () => {
      try {
        const res = await saveStoreTheme({ font, tone });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        savedRef.current = true;
        toast.success("Tampilan toko tersimpan");
        setOpen(false);
      } catch {
        toast.error("Gagal menyimpan tampilan");
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          openedWith.current = { font, tone };
          savedRef.current = false;
          setOpen(true);
          return;
        }
        setOpen(false);
        if (!savedRef.current) {
          setFont(openedWith.current.font);
          setTone(openedWith.current.tone);
          onPreviewChange?.(openedWith.current);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm">
            <Type className="mr-1.5 size-4" aria-hidden="true" />
            Tampilan
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tampilan Toko</DialogTitle>
          <DialogDescription>
            Font judul dan nuansa warna dasar storefront. Warna aksen diatur lewat tombol Warna
            Brand di sebelah.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Font judul</legend>
            <div className="grid gap-2">
              {Object.values(FONT_PAIRINGS).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setFont(p.id)}
                  aria-pressed={font === p.id}
                  className={cn(
                    "flex items-baseline justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                    font === p.id ? "border-primary ring-1 ring-primary" : "border-border hover:bg-muted/50",
                  )}
                >
                  <span className="text-base" style={{ fontFamily: p.display }}>
                    {p.label}
                  </span>
                  <span className="text-xs text-muted-foreground">{p.hint}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Nuansa warna dasar</legend>
            <div className="grid gap-2">
              {NEUTRAL_TONES.map((t) => {
                // Live derivation with the store's real brand colour — the same generateNeutrals
                // the storefront runs, so these dots ARE the palette, not an illustration of it.
                const n = generateNeutrals(brandColor || DEFAULT_BRAND_COLOR, t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTone(t.id)}
                    aria-pressed={tone === t.id}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                      tone === t.id ? "border-primary ring-1 ring-primary" : "border-border hover:bg-muted/50",
                    )}
                  >
                    <span className="flex flex-col">
                      <span className="text-sm font-medium">{t.label}</span>
                      <span className="text-xs text-muted-foreground">{t.hint}</span>
                    </span>
                    <span className="flex gap-1" aria-hidden="true">
                      {[n.cream, n.line, n.muted, n.ink].map((hex) => (
                        <span
                          key={hex}
                          className="size-4 rounded-full ring-1 ring-black/10"
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="ghost">Batal</Button>} />
          <Button onClick={handleSave} disabled={pending || !canWrite}>
            {pending ? "Menyimpan…" : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
