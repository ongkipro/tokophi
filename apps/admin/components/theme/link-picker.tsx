"use client";
// The Store Builder link field — a Shopify-style link picker for CTA/button targets (ctaHref, href).
// Rendered by a Puck `type:"custom"` field; the stored VALUE stays a plain path/URL string, so existing
// templates and the storefront are untouched. Sources are tenant-scoped server-side.
import * as React from "react";
import { X,Package, Tag, FileText, Link2, ChevronRight } from "lucide-react";
import { pickerProductLinks, pickerCategoryLinks, pickerPageLinks, type PickerLink } from "@/lib/actions/picker";
import { cn } from "@tokophi/ui/lib/utils";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@tokophi/ui/dialog";
import { SearchInput } from "@/components/admin/search-input";

type TabKey = "produk" | "kategori" | "halaman" | "url";
const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "produk", label: "Produk", icon: Package },
  { key: "kategori", label: "Kategori", icon: Tag },
  { key: "halaman", label: "Halaman", icon: FileText },
  { key: "url", label: "URL", icon: Link2 },
];

function LinkList({
  items,
  loading,
  current,
  onPick,
  emptyLabel,
}: {
  items: PickerLink[];
  loading: boolean;
  current: string;
  onPick: (href: string) => void;
  emptyLabel: string;
}) {
  if (loading) return <p className="py-10 text-center text-sm text-muted-foreground">Memuat…</p>;
  if (items.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  return (
    <div className="max-h-[46vh] space-y-1 overflow-y-auto p-0.5">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => onPick(it.href)}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
            current === it.href ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
          )}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{it.name}</p>
            <p className="truncate text-xs text-muted-foreground">{it.href}{it.sub ? ` · ${it.sub}` : ""}</p>
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </button>
      ))}
    </div>
  );
}

export function LinkPickerField({
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
  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState<TabKey>("produk");
  const [q, setQ] = React.useState("");
  const [urlDraft, setUrlDraft] = React.useState("");

  const [products, setProducts] = React.useState<PickerLink[] | null>(null);
  const [categories, setCategories] = React.useState<PickerLink[] | null>(null);
  const [pages, setPages] = React.useState<PickerLink[] | null>(null);

  React.useEffect(() => {
    if (!open) return;
    if (tab === "produk" && products === null) pickerProductLinks().then(setProducts).catch(() => setProducts([]));
    if (tab === "kategori" && categories === null) pickerCategoryLinks().then(setCategories).catch(() => setCategories([]));
    if (tab === "halaman" && pages === null) pickerPageLinks().then(setPages).catch(() => setPages([]));
  }, [open, tab, products, categories, pages]);

  const pick = (href: string) => {
    onChange(href);
    setOpen(false);
    setQ("");
  };
  const match = (s: string) => !q.trim() || s.toLowerCase().includes(q.trim().toLowerCase());
  const label = field.label ?? "Link";

  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground">{label}</Label>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={readOnly}
          onClick={() => setOpen(true)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-input px-3 py-2 text-left text-sm transition-colors hover:border-primary/60"
        >
          <Link2 className="size-4 shrink-0 text-muted-foreground" />
          <span className={cn("truncate", value ? "text-foreground" : "text-muted-foreground")}>{value || "Pilih link…"}</span>
        </button>
        {value && !readOnly && (
          <button type="button" onClick={() => onChange("")} title="Hapus link" className="shrink-0 rounded-md p-2 text-muted-foreground hover:text-destructive">
            <X className="size-4" />
          </button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Pilih Link</DialogTitle>
            <DialogDescription>Tautkan tombol ke produk, kategori, halaman, atau URL apa pun.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => { setTab(t.key); setQ(""); }}
                className={cn(
                  "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                  tab === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <t.icon className="size-4" /> {t.label}
              </button>
            ))}
          </div>

          {tab !== "url" && (
            <SearchInput label="Cari tautan" value={q} onValueChange={setQ} placeholder="Cari…" />
          )}

          {tab === "produk" && (
            <LinkList items={(products ?? []).filter((p) => match(p.name))} loading={products === null} current={value} onPick={pick} emptyLabel="Belum ada produk." />
          )}
          {tab === "kategori" && (
            <LinkList items={(categories ?? []).filter((c) => match(c.name))} loading={categories === null} current={value} onPick={pick} emptyLabel="Belum ada kategori terbit." />
          )}
          {tab === "halaman" && (
            <LinkList items={(pages ?? []).filter((p) => match(p.name))} loading={pages === null} current={value} onPick={pick} emptyLabel="Belum ada halaman terbit." />
          )}
          {tab === "url" && (
            <div className="space-y-2">
              <Label className="text-muted-foreground">Tempel URL atau path (mis. /promo, https://…)</Label>
              <div className="flex gap-2">
                <Input value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} placeholder="/promo atau https://…" />
                <Button type="button" disabled={!urlDraft.trim()} onClick={() => pick(urlDraft.trim())}>Gunakan</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
