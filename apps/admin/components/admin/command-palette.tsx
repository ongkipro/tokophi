"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Search, CornerDownLeft, ArrowUp, ArrowDown, X, FileText, Package, Receipt, UserRound,
  PackagePlus, TicketPlus, Truck, ListChecks, PenLine, Zap, type LucideIcon,
} from "lucide-react";
import { IDR } from "@tokophi/lib/format";
import { NAV_GROUPS } from "@/lib/nav";
import {
  buildNavRows, indexRows, isInternalHref, loadRecents, popularPages, pushRecent, quickActionsFor, rank, recentKey,
  recentRows, resultAnnouncement, searchAllOrdersRow, splitHighlight, tokenize, GROUP_CAP,
  type GroupKey, type QuickAction, type Recent, type Row, type SearchItem,
} from "@/lib/search-model";
import { useStoreHref, useStoreSlug } from "@/components/admin/store-context";
import { useRole } from "@/components/admin/permissions";
import { OrderStatusBadge } from "@/components/admin/order-status";
import type { OrderStatus } from "@/lib/types/domain";
import { Dialog, DialogContent, DialogTitle } from "@tokophi/ui/dialog";
import { Button } from "@tokophi/ui/button";
import { cn } from "@tokophi/ui/lib/utils";

// Same rule as `HIT` in topbar.tsx (not imported — topbar imports this file, and a constant is not
// worth a cycle): a 40px tap zone over a 32px control, paid for with a ::after overlay, never width.
const HIT = "relative after:absolute after:-inset-1";

// A ⌘K / Ctrl+K command palette. Empty query: what a seller reaches for (recent items, quick actions the
// role may use, a few daily pages). Typing: ranked results grouped by kind, the match highlighted, an
// escape hatch to the full order list (the index holds only the 80 newest). All the rules live in
// `lib/search-model.ts` (unit-tested); this file renders them and owns focus + keyboard.
//
// ARIA: an editable combobox (`role=combobox`, `aria-activedescendant`) controlling a `role=listbox` of
// `role=option` rows in `role=group`s. Focus never leaves the input; the active row is announced by the
// browser from `aria-activedescendant`, and a polite live region says how many results there are.

const NAV_ROWS = buildNavRows(NAV_GROUPS);
const NAV_ICONS = (() => {
  const m = new Map<string, LucideIcon>();
  for (const r of NAV_ROWS) if (r.icon && !m.has(r.href)) m.set(r.href, r.icon);
  return m;
})();

const ACTION_ICON: Record<QuickAction["iconKey"], LucideIcon> = { produk: PackagePlus, voucher: TicketPlus, kirim: Truck, massal: ListChecks, blog: PenLine, flash: Zap };
const KIND_ICON: Record<"produk" | "pesanan" | "pelanggan" | "halaman", LucideIcon> = { halaman: FileText, produk: Package, pesanan: Receipt, pelanggan: UserRound };
const KNOWN_STATUS = new Set(["baru", "diproses", "dikirim", "selesai", "batal", "retur"]);

function rowIcon(r: Row): LucideIcon {
  if (r.icon) return r.icon;
  if (r.kind === "terakhir") return KIND_ICON[r.recentKind ?? "halaman"];
  if (r.kind === "semua") return Search;
  if (r.kind === "aksi") return FileText;
  return KIND_ICON[r.kind];
}

function Hl({ text, tokens }: { text: string; tokens: string[] }) {
  if (!tokens.length) return <>{text}</>;
  return (
    <>
      {splitHighlight(text, tokens).map((p, i) =>
        p.hit ? <mark key={i} className="rounded-sm bg-primary/15 px-0.5 font-semibold text-foreground">{p.text}</mark> : <React.Fragment key={i}>{p.text}</React.Fragment>,
      )}
    </>
  );
}

function Meta({ r }: { r: Row }) {
  const m = r.meta;
  if (!m) return null;
  if (m.kind === "pesanan")
    return (
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        {KNOWN_STATUS.has(m.status) && <OrderStatusBadge status={m.status as OrderStatus} />}
        <span className="text-xs tabular-nums text-muted-foreground">{IDR(m.totalIdr)}</span>
      </span>
    );
  if (m.kind === "produk")
    return (
      <span className="flex shrink-0 flex-col items-end gap-0.5 text-xs tabular-nums text-muted-foreground">
        {m.draft && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">Draf</span>}
        {m.priceIdr > 0 && <span>{IDR(m.priceIdr)}</span>}
      </span>
    );
  return <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{m.ordersCount} pesanan</span>;
}

type ViewGroup = { key: GroupKey; rows: Row[]; hidden: number; start: number };

export function CommandPalette({ index }: { index: SearchItem[] }) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [active, setActive] = React.useState(0);
  const [recents, setRecents] = React.useState<Recent[]>([]);
  // The platform never changes while the page lives; the server snapshot is `false` so hydration matches.
  const mac = React.useSyncExternalStore(
    () => () => {},
    () => /Mac|iPhone|iPad/i.test(navigator.userAgent),
    () => false,
  );
  const router = useRouter();
  const storeHref = useStoreHref();
  const slug = useStoreSlug();
  const role = useRole();
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const openerRef = React.useRef<HTMLElement | null>(null);
  const composing = React.useRef(false);
  // The global shortcut toggles; it must read the CURRENT state without re-subscribing on every change.
  const openRef = React.useRef(open);
  React.useEffect(() => { openRef.current = open; }, [open]);
  const listId = React.useId();

  const dataRows = React.useMemo(() => indexRows(index), [index]);
  const tokens = React.useMemo(() => tokenize(q), [q]);
  const hasQuery = tokens.length > 0;

  const view = React.useMemo<{ groups: ViewGroup[]; flat: Row[]; noHits: boolean }>(() => {
    // Each group knows where its first row sits in the flat order, so rendering never mutates a counter.
    const place = (gs: Omit<ViewGroup, "start">[]): ViewGroup[] => {
      let n = 0;
      return gs.map((g) => {
        const start = n;
        n += g.rows.length;
        return { ...g, start };
      });
    };
    if (!hasQuery) {
      const groups: Omit<ViewGroup, "start">[] = [];
      const rec = recentRows(recents, NAV_ICONS);
      if (rec.length) groups.push({ key: "Terakhir dibuka", rows: rec, hidden: 0 });
      const actions = quickActionsFor(role).map<Row>((a) => ({ id: a.id, kind: "aksi", label: a.label, sub: a.sub, href: a.href, icon: ACTION_ICON[a.iconKey] }));
      if (actions.length) groups.push({ key: "Aksi cepat", rows: actions, hidden: 0 });
      groups.push({ key: "Halaman populer", rows: popularPages(NAV_ROWS), hidden: 0 });
      return { groups: place(groups), flat: groups.flatMap((g) => g.rows), noHits: false };
    }
    const ranked = rank(q, NAV_ROWS, dataRows);
    const groups: Omit<ViewGroup, "start">[] = ranked.groups.map((g) => ({ key: g.key, rows: g.rows, hidden: g.hidden }));
    groups.push({ key: "Lainnya", rows: [searchAllOrdersRow(q)], hidden: 0 });
    return { groups: place(groups), flat: groups.flatMap((g) => g.rows), noHits: ranked.empty };
  }, [hasQuery, q, role, recents, dataRows]);

  const last = Math.max(0, view.flat.length - 1);
  const activeIdx = Math.min(active, last);
  const optId = (i: number) => `${listId}-opt-${i}`;
  const announcement = resultAnnouncement(q, { groups: [], flat: view.flat.filter((r) => r.kind !== "semua"), empty: view.noHits }, view.flat.length);

  // The highlight returns to the first row when the query changes or the palette opens — adjusted during
  // render (not in an effect) so there is no frame with the old highlight over new results.
  const [prevQ, setPrevQ] = React.useState(q);
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (!Object.is(prevQ, q) || !Object.is(prevOpen, open)) {
    setPrevQ(q);
    setPrevOpen(open);
    if (!Object.is(prevQ, q) || open) setActive(0);
  }

  const storage = React.useCallback((): Storage | null => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }, []);

  // What was opened recently is read at the moment the palette opens (another tab may have changed it).
  const openPalette = React.useCallback((opener?: HTMLElement | null) => {
    openerRef.current = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setRecents(loadRecents(storage(), recentKey(slug)));
    setOpen(true);
  }, [slug, storage]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (openRef.current) setOpen(false);
        else openPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPalette]);

  // Keep the active row in view; the first row also reveals its group header.
  React.useEffect(() => {
    if (!open) return;
    const el = document.getElementById(optId(activeIdx));
    if (activeIdx === 0) scrollRef.current?.scrollTo({ top: 0 });
    else el?.scrollIntoView({ block: "nearest" });
    // optId is stable per listId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx, open, view.flat]);

  const close = () => {
    setOpen(false);
    setQ("");
    setActive(0);
  };

  const go = (r: Row) => {
    const kind = r.kind === "terakhir" ? r.recentKind : r.kind;
    if ((kind === "halaman" || kind === "produk" || kind === "pesanan" || kind === "pelanggan") && isInternalHref(r.href)) {
      setRecents(pushRecent(storage(), recentKey(slug), { kind, id: r.id, label: r.label, sub: r.sub, href: r.href }));
    }
    close();
    if (isInternalHref(r.href)) router.push(storeHref(r.href));
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // An IME (Indonesian users on Gboard / Japanese-Korean keyboards) uses Enter/arrows to pick candidates.
    if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
    const n = view.flat.length;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(Math.min(activeIdx + 1, last)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(activeIdx - 1, 0)); }
    else if (e.key === "PageDown") { e.preventDefault(); setActive(Math.min(activeIdx + 5, last)); }
    else if (e.key === "PageUp") { e.preventDefault(); setActive(Math.max(activeIdx - 5, 0)); }
    // Home/End move the text caret while there is text; with an empty box (or Ctrl held) they move the list.
    else if ((e.key === "Home" || e.key === "End") && (q === "" || e.ctrlKey || e.metaKey)) { e.preventDefault(); setActive(e.key === "Home" ? 0 : last); }
    else if (e.key === "Enter") { e.preventDefault(); const r = view.flat[activeIdx]; if (r && n > 0) go(r); }
  };

  return (
    <>
      {/* desktop: a faux search input that opens the palette */}
      <button
        type="button"
        onClick={(e) => openPalette(e.currentTarget)}
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K"
        aria-label="Cari halaman, pesanan, produk, pelanggan"
        className="ml-1 hidden h-9 max-w-sm flex-1 items-center gap-2 rounded-lg border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted md:flex"
      >
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 text-left">Cari…</span>
        <kbd className="rounded border bg-background px-1.5 py-0.5 text-[10px] font-medium tabular-nums">{mac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      {/* mobile: an icon (the inline dropdown used to vanish below md — no search on a phone).
          HIT extends the 32px box to a 40px tap zone without spending topbar width (F-F11). */}
      <Button variant="ghost" size="icon" className={`${HIT} md:hidden`} aria-label="Cari" aria-haspopup="dialog" onClick={(e) => openPalette(e.currentTarget)}>
        <Search className="size-[18px]" aria-hidden="true" />
      </Button>

      <Dialog open={open} onOpenChange={(o) => { if (o) setOpen(true); else close(); }}>
        <DialogContent
          showCloseButton={false}
          initialFocus={inputRef}
          finalFocus={openerRef}
          className="top-[5%] max-h-[90dvh] max-w-[calc(100%-1rem)] translate-y-0 gap-0 overflow-hidden p-0 sm:top-[12%] sm:max-w-xl"
        >
          <DialogTitle className="sr-only">Pencarian admin</DialogTitle>
          <div className="flex items-center gap-2.5 border-b pl-3.5 pr-1 sm:pr-3.5">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={view.flat.length ? optId(activeIdx) : undefined}
              aria-label="Cari halaman, pesanan, produk, pelanggan"
              type="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="go"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onInputKey}
              onCompositionStart={() => { composing.current = true; }}
              onCompositionEnd={() => { composing.current = false; }}
              placeholder="Cari halaman, pesanan, produk…"
              className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"
            />
            {q && (
              <button type="button" aria-label="Hapus pencarian" onClick={() => { setQ(""); inputRef.current?.focus(); }} className="hidden size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted sm:inline-flex">
                <X className="size-3.5" aria-hidden="true" />
              </button>
            )}
            <button type="button" aria-label="Tutup pencarian" onClick={close} className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted sm:hidden">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div ref={scrollRef} className="max-h-[min(60dvh,420px)] overflow-y-auto overscroll-contain p-2">
            {view.noHits && (
              <div className="px-3 pb-3 pt-6 text-center">
                <p className="text-sm font-medium">Tidak ada hasil untuk “{q.trim()}”.</p>
                <p className="mt-1 text-xs text-muted-foreground">Coba kata lain, nomor pesanan, nama produk, atau nomor HP pelanggan. Pesanan lama ada di daftar lengkap di bawah.</p>
              </div>
            )}
            <div role="listbox" id={listId} aria-label={hasQuery ? "Hasil pencarian" : "Pilihan cepat"}>
              {view.groups.map((g) => {
                const hid = `${listId}-g-${g.key.replace(/\s+/g, "-")}`;
                return (
                  <div key={g.key} role="group" aria-labelledby={hid} className="mb-1 last:mb-0">
                    <div id={hid} className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {g.key}
                      {g.hidden > 0 && <span className="normal-case tracking-normal"> · {g.rows.length + g.hidden} hasil</span>}
                    </div>
                    {g.rows.map((r, n) => {
                      const idx = g.start + n;
                      const isActive = idx === activeIdx;
                      const Icon = rowIcon(r);
                      return (
                        <div
                          key={r.id}
                          id={optId(idx)}
                          role="option"
                          aria-selected={isActive}
                          data-idx={idx}
                          onMouseMove={() => { if (activeIdx !== idx) setActive(idx); }}
                          onClick={() => go(r)}
                          className={cn(
                            "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors sm:min-h-10",
                            isActive ? "bg-primary/10 text-foreground" : "text-foreground/90 hover:bg-muted",
                          )}
                        >
                          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", isActive ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                            <Icon className="size-4" aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium"><Hl text={r.label} tokens={r.kind === "semua" ? [] : tokens} /></span>
                            {r.sub && <span className="block truncate text-xs text-muted-foreground"><Hl text={r.sub} tokens={r.kind === "semua" ? [] : tokens} /></span>}
                          </span>
                          <Meta r={r} />
                          {isActive && <CornerDownLeft className="hidden size-3.5 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />}
                        </div>
                      );
                    })}
                    {g.hidden > 0 && (
                      <p aria-hidden="true" className="px-2 py-1 text-xs text-muted-foreground">
                        +{g.hidden} lagi — ketik lebih spesifik untuk mempersempit (tampil {GROUP_CAP} teratas)
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
          <div className="hidden items-center gap-3 border-t bg-muted/30 px-3.5 py-2 text-[11px] text-muted-foreground sm:flex">
            <span className="flex items-center gap-1"><ArrowUp className="size-3" aria-hidden="true" /><ArrowDown className="size-3" aria-hidden="true" /> pilih</span>
            <span className="flex items-center gap-1"><CornerDownLeft className="size-3" aria-hidden="true" /> buka</span>
            <span className="ml-auto">esc tutup</span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
