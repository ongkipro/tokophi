// Runs client-side via its only importer, the "use client" product editor — so it needs no "use
// client" of its own, and omitting it keeps the RSC serialization lint off a plain client callback.
// Google Product Category picker + auto-suggest (ADR 0011). Base UI has no Select/Combobox, so this
// is a Dialog with a debounced search over `searchTaxonomy`. When empty, it offers the deterministic
// suggestion from the product title — one click to apply — so the seller rarely types.
import * as React from "react";
import { Sparkles, Search, Check, X, Tag } from "lucide-react";
import { searchTaxonomy, type TaxonomyOption } from "@/lib/actions/taxonomy";
import { suggestGoogleCategory } from "@tokophi/lib/taxonomy-suggest";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@tokophi/ui/dialog";

export function GoogleCategoryField({
  value,
  path,
  title,
  category,
  onChange,
}: {
  value: number | null;
  path: string;
  title: string;
  category: string;
  onChange: (id: number | null, path: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<TaxonomyOption[]>([]);
  const [loading, setLoading] = React.useState(false);
  // Only suggest when nothing is set yet, from the title (+ merchant category as a hint).
  const suggestion = React.useMemo(() => (value ? null : suggestGoogleCategory(title, category)), [value, title, category]);

  React.useEffect(() => {
    if (!open) return;
    const term = q.trim();
    // All setState runs inside the (async) timeout callback, never synchronously in the effect body.
    const t = setTimeout(async () => {
      if (term.length < 2) {
        setResults([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        setResults(await searchTaxonomy(term));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, term.length < 2 ? 0 : 250);
    return () => clearTimeout(t);
  }, [q, open]);

  const pick = (o: { id: number; path: string }) => {
    onChange(o.id, o.path);
    setOpen(false);
    setQ("");
  };

  return (
    <div className="grid gap-2">
      <Label>
        Kategori Google <span className="font-normal text-muted-foreground">(untuk katalog &amp; iklan)</span>
      </Label>

      {value ? (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
          <Tag className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm" title={path}>
            {path}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
            Ubah
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Hapus kategori Google" onClick={() => onChange(null, "")}>
            <X className="size-4" />
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {suggestion && (
            <button
              type="button"
              onClick={() => pick(suggestion)}
              className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-left transition-colors hover:bg-primary/10"
            >
              <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-muted-foreground">Disarankan otomatis</span>
                <span className="block truncate text-sm font-medium" title={suggestion.path}>
                  {suggestion.path}
                </span>
              </span>
              <span className="mt-0.5 shrink-0 text-xs font-medium text-primary">Terapkan</span>
            </button>
          )}
          <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setOpen(true)}>
            <Search className="size-4" /> {suggestion ? "Pilih manual" : "Pilih kategori"}
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Kategori baku Google Product Taxonomy — dipakai untuk feed Google/Meta/TikTok. Beda dari kategori toko Anda di atas.
      </p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Pilih kategori Google</DialogTitle>
            <DialogDescription>Cari kategori baku — mis. &quot;dress&quot;, &quot;hijab&quot;, &quot;pants&quot;.</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ketik kategori…" className="pl-8" />
          </div>
          <div className="max-h-72 overflow-y-auto rounded-lg border">
            {loading ? (
              <p className="p-3 text-sm text-muted-foreground">Mencari…</p>
            ) : results.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">{q.trim().length < 2 ? "Ketik minimal 2 huruf." : "Tak ada hasil."}</p>
            ) : (
              results.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => pick(o)}
                  className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm transition-colors last:border-0 hover:bg-muted/50"
                >
                  <span className="min-w-0 flex-1 truncate" title={o.path}>
                    {o.path}
                  </span>
                  {value === o.id && <Check className="size-4 shrink-0 text-primary" />}
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
