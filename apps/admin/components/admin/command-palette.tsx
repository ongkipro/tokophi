"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft, ArrowUp, ArrowDown, FileText, Package, ShoppingBag, User } from "lucide-react";
import type { SearchItem } from "@/lib/data/search";
import { NAV_GROUPS } from "@/lib/nav";
import { useStoreHref } from "@/components/admin/store-context";

// Same rule as `HIT` in topbar.tsx (not imported — topbar imports this file, and a constant is not
// worth a cycle): a 40px tap zone over a 32px control, paid for with a ::after overlay, never width.
const HIT = "relative after:absolute after:-inset-1";
import { Dialog, DialogContent, DialogTitle } from "@tokophi/ui/dialog";
import { Button } from "@tokophi/ui/button";
import { cn } from "@tokophi/ui/lib/utils";

// A Vercel-style ⌘K command palette: jump to any admin PAGE (the sidebar, flattened) or open a
// specific pesanan / produk / pelanggan (the RLS-scoped search index the layout hands in). Keyboard
// first (⌘K open, ↑/↓ move, ↵ open, esc close) and it works on mobile too (its own trigger), which the
// old inline `hidden md:block` dropdown did not.
type Row = { id: string; label: string; sub?: string; href: string; group: Group };
type Group = "Halaman" | "Produk" | "Pesanan" | "Pelanggan";

const GROUP_ICON: Record<Group, React.ElementType> = { Halaman: FileText, Produk: Package, Pesanan: ShoppingBag, Pelanggan: User };
const GROUP_ORDER: Group[] = ["Halaman", "Produk", "Pesanan", "Pelanggan"];
const TYPE_GROUP: Record<SearchItem["type"], Group> = { produk: "Produk", pesanan: "Pesanan", pelanggan: "Pelanggan" };

// The sidebar, flattened to jump-to-page rows once (parents + their children, "Parent › Child").
const NAV_ROWS: Row[] = (() => {
  const rows: Row[] = [];
  for (const g of NAV_GROUPS) {
    for (const item of g.items) {
      rows.push({ id: "nav:" + item.href, label: item.label, href: item.href, group: "Halaman" });
      for (const c of item.children ?? []) {
        rows.push({ id: "navc:" + c.href + c.label, label: `${item.label} › ${c.label}`, href: c.href, group: "Halaman" });
      }
    }
  }
  const seen = new Set<string>();
  return rows.filter((r) => { const k = r.href + "|" + r.label; if (seen.has(k)) return false; seen.add(k); return true; });
})();

export function CommandPalette({ index }: { index: SearchItem[] }) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [active, setActive] = React.useState(0);
  const router = useRouter();
  const storeHref = useStoreHref();
  const listRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const rows = React.useMemo<Row[]>(() => {
    const s = q.trim().toLowerCase();
    if (!s) return NAV_ROWS; // empty → offer every page as a quick jump (Vercel shows suggestions)
    const match = (label: string, sub?: string) => label.toLowerCase().includes(s) || (sub?.toLowerCase().includes(s) ?? false);
    const nav = NAV_ROWS.filter((r) => match(r.label));
    const ent = index
      .filter((i) => match(i.label, i.sub))
      .slice(0, 24)
      .map<Row>((i) => ({ id: i.type + ":" + i.id, label: i.label, sub: i.sub, href: i.href, group: TYPE_GROUP[i.type] }));
    return [...nav, ...ent];
  }, [q, index]);

  const groups = React.useMemo(() => {
    const byG = new Map<Group, Row[]>();
    rows.forEach((r) => { const l = byG.get(r.group) ?? []; l.push(r); byG.set(r.group, l); });
    // A stable flat order that matches the rendered order, so `active` maps 1:1 to a row.
    const flat: Row[] = [];
    const rendered = GROUP_ORDER.filter((g) => byG.has(g)).map((g) => {
      const items = byG.get(g)!;
      const withIdx = items.map((r) => ({ r, idx: flat.push(r) - 1 }));
      return { group: g, items: withIdx };
    });
    return { rendered, flat };
  }, [rows]);

  // Sorotan kembali ke baris pertama saat query berubah ATAU saat palet dibuka — di render (pola
  // adjust-state-during-render), bukan effect: setState sinkron pasca-paint memicu render kaskade dan
  // satu frame dengan sorotan lama di hasil baru.
  const [prevQ, setPrevQ] = React.useState(q);
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (!Object.is(prevQ, q) || !Object.is(prevOpen, open)) {
    setPrevQ(q);
    setPrevOpen(open);
    if (!Object.is(prevQ, q) || open) setActive(0);
  }

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Base UI manages focus, but be explicit so the caret lands in the input the instant it opens.
  // (setActive(0) on open moved to the render-time adjust above; only the DOM work stays here.)
  React.useEffect(() => { if (open) requestAnimationFrame(() => inputRef.current?.focus()); }, [open]);

  // Keep the highlighted row in view as the arrows move past the fold.
  React.useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = (href: string) => { setOpen(false); setQ(""); router.push(storeHref(href)); };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, groups.flat.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const r = groups.flat[active]; if (r) go(r.href); }
  };

  return (
    <>
      {/* desktop: a faux search input that opens the palette */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-1 hidden h-9 max-w-sm flex-1 items-center gap-2 rounded-lg border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted md:flex"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 text-left">Cari…</span>
        <kbd className="rounded border bg-background px-1.5 py-0.5 text-[10px] font-medium tabular-nums">⌘K</kbd>
      </button>
      {/* mobile: an icon (the inline dropdown used to vanish below md — no search on a phone).
          HIT extends the 32px box to a 40px tap zone without spending topbar width (F-F11). */}
      <Button variant="ghost" size="icon" className={`${HIT} md:hidden`} aria-label="Cari" onClick={() => setOpen(true)}>
        <Search className="size-[18px]" />
      </Button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setQ(""); setActive(0); } }}>
        <DialogContent showCloseButton={false} className="top-[12%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
          <DialogTitle className="sr-only">Pencarian admin</DialogTitle>
          <div className="flex items-center gap-2.5 border-b px-3.5">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Cari halaman, pesanan, produk, pelanggan…"
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div ref={listRef} className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
            {groups.flat.length === 0 ? (
              <p className="px-3 py-10 text-center text-sm text-muted-foreground">Tidak ada hasil untuk “{q}”.</p>
            ) : (
              groups.rendered.map((grp) => {
                const Icon = GROUP_ICON[grp.group];
                return (
                  <div key={grp.group} className="mb-1 last:mb-0">
                    <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{grp.group}</div>
                    {grp.items.map(({ r, idx }) => {
                      const isActive = idx === active;
                      return (
                        <button
                          key={r.id}
                          data-idx={idx}
                          type="button"
                          onMouseMove={() => setActive(idx)}
                          onClick={() => go(r.href)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors",
                            isActive ? "bg-primary/10 text-foreground" : "text-foreground/90 hover:bg-muted",
                          )}
                        >
                          <Icon className="size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{r.label}</span>
                            {r.sub && <span className="block truncate text-xs text-muted-foreground">{r.sub}</span>}
                          </span>
                          {isActive && <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />}
                        </button>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
          <div className="flex items-center gap-3 border-t bg-muted/30 px-3.5 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><ArrowUp className="size-3" /><ArrowDown className="size-3" /> pilih</span>
            <span className="flex items-center gap-1"><CornerDownLeft className="size-3" /> buka</span>
            <span className="ml-auto">esc untuk tutup</span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
