"use client";

import { useState, useMemo, type ComponentType, type KeyboardEvent } from "react";
import { Search, GitCommit, CheckCircle2, ShieldCheck, Bug, Sparkles, Truck, Filter, CalendarDays, ChevronRight } from "lucide-react";
import { Input } from "@tokophi/ui/input";
import { Badge } from "@tokophi/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@tokophi/ui/card";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@tokophi/ui/pagination";
import { num } from "@tokophi/lib/format";
import { DEV_LOGS, type DevLogCategory, type DevLogSurface } from "@/lib/data/dev-logs";
import { UPDATE_LOG_PAGE_SIZE, filterChanged, pageSlice } from "@/lib/list-page";

const CATEGORY_MAP: Record<DevLogCategory, { label: string; badgeVariant: "default" | "secondary" | "outline" | "destructive"; icon: ComponentType<{ className?: string }> }> = {
  major: { label: "Major Release", badgeVariant: "default", icon: Sparkles },
  minor: { label: "Minor Update", badgeVariant: "secondary", icon: GitCommit },
  feature: { label: "Fitur Baru", badgeVariant: "outline", icon: Sparkles },
  bugfix: { label: "Bug Fix", badgeVariant: "destructive", icon: Bug },
  security: { label: "Keamanan & RLS", badgeVariant: "outline", icon: ShieldCheck },
  logistics_payment: { label: "Logistik & Payment", badgeVariant: "secondary", icon: Truck },
};

// ⚠️ EVERY FIGURE ON THIS HEADER IS DERIVED FROM `DEV_LOGS`. A derived figure cannot rot.
//
// The tiles used to be hand-typed — `Current Engine: v1.0.0 Stable`, `722 Tes Hijau`,
// `53 Tabel Gated`, `100% Passed` — while the newest entry on the SAME SCREEN read v1.1.0 with 1009
// tests. The page contradicted itself in two places a reader can see at once.
//
// `DEV_LOGS` is newest-first (the file's own contract; every entry has been added at the top), so
// `[0]` is the current release.
const LATEST = DEV_LOGS[0];
const SECURITY_COUNT = DEV_LOGS.filter((log) => log.category === "security").length;

// 🔴 THE TEST-COUNT TILE IS DROPPED, NOT RE-TYPED.
// A live `npx vitest run` figure is not derivable at runtime — this is a client component reading a
// static array, and nothing here can count a test. The two honest options were "drop it" or "parse
// it out of `LATEST.verification`"; parsing was rejected because that field is free prose written by
// hand ("123 files, 1009 tests passed" today, worded differently in the next entry), so a regex
// would go quietly wrong — or quietly blank — the first time somebody rephrases a sentence, and a
// number nobody can trace is exactly what this pass exists to remove. AGENTS.md: *a figure with no
// source is "—", never a number*. The count still LIVES on the screen: it is in the newest entry's
// own "Bukti Verifikasi" block, in the sentence that was actually measured, with its own date.

export function UpdateLogClient() {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedSurface, setSelectedSurface] = useState<string>("all");
  const [page, setPage] = useState(1);

  const filteredLogs = useMemo(() => {
    return DEV_LOGS.filter((log) => {
      const matchSearch =
        search === "" ||
        log.version.toLowerCase().includes(search.toLowerCase()) ||
        log.title.toLowerCase().includes(search.toLowerCase()) ||
        log.summary.toLowerCase().includes(search.toLowerCase()) ||
        log.problem.toLowerCase().includes(search.toLowerCase()) ||
        log.solution.toLowerCase().includes(search.toLowerCase());

      const matchCategory = selectedCategory === "all" || log.category === selectedCategory;
      const matchSurface = selectedSurface === "all" || log.surfaces.includes(selectedSurface as DevLogSurface);

      return matchSearch && matchCategory && matchSurface;
    });
  }, [search, selectedCategory, selectedSurface]);

  // Reset ke halaman 1 saat filter berubah — DI RENDER, bukan di effect. Pola ini disalin dari
  // `apps/admin/app/(admin)/blog/blog-client.tsx` (~117–129) dan alasannya sama persis: versi effect
  // men-setState setelah paint (`react-hooks/set-state-in-effect`), jadi ada satu frame yang
  // menampilkan halaman lama di bawah filter baru. Pola resmi React "adjust state during render"
  // (prev-tuple + perbandingan Object.is yang identik dengan deps effect) memotong frame itu.
  // Tanpa reset ini: menyaring 14 catatan menjadi 2 sementara operator ada di halaman 3 menghasilkan
  // feed KOSONG di bawah filter yang sebenarnya cocok.
  const filterKey = [search, selectedCategory, selectedSurface] as const;
  const [prevFilter, setPrevFilter] = useState<readonly unknown[]>(filterKey);
  if (filterChanged(prevFilter, filterKey)) {
    setPrevFilter(filterKey);
    setPage(1);
  }

  // `pageSlice` CLAMPS: an index past the end returns the last page, never a blank one. That is the
  // second half of the guard above — the reset handles the filter changing, the clamp handles every
  // other way `page` and the list can disagree.
  const view = pageSlice(filteredLogs, page, UPDATE_LOG_PAGE_SIZE);
  const pageNumbers = Array.from({ length: view.pageCount }, (_, index) => index + 1).filter(
    (item) => item === 1 || item === view.pageCount || Math.abs(item - view.page) <= 1,
  );

  // ⚠️ THE ANCHOR IS ACTIVATED BY POINTER **AND** BY KEYBOARD, AND THE SECOND HALF IS NOT FREE.
  // `PaginationLink` spreads its props onto the `<a>` inside Base UI's `render`, so `useButton`
  // never receives our `onClick` — its own Enter/Space bridge then calls nothing. Measured in a
  // browser before this helper existed: the link was focusable (`role="button"`, `tabIndex 0`) and
  // **Enter did nothing**. `apps/admin`'s copy only escapes that because it carries `href="#"`, i.e.
  // it is a real link the browser activates natively — and then has to cancel the jump with
  // `preventDefault()` on every path. Handling the two keys here instead means the anchor emits no
  // `href` at all: it cannot navigate, cannot put a `#` in the URL, and cannot move the scroll
  // position, and Space works as well as Enter (a `role="button"` should answer to both).
  const goTo = (target: number) => ({
    onClick: () => setPage(target),
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      setPage(target);
    },
  });

  return (
    <div className="space-y-6 p-6">
      {/* Header section */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Update Log Development</h1>
          <p className="text-sm text-muted-foreground">
            Ringkasan log teknis & histori rilis khusus operator (human). Pahami lokasi bug, perbaikan, dan pembaruan fitur platform.
          </p>
        </div>
        <Badge variant="outline" className="w-fit px-3 py-1 text-xs font-semibold text-primary border-primary/30 bg-primary/5">
          Current Engine: {LATEST.version}
        </Badge>
      </div>

      {/* KPI Cards — all four derived from DEV_LOGS (see the comment above the component) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2.5 text-primary">
              <GitCommit className="size-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Total Dev Logs</p>
              <h3 className="text-xl font-bold tabular-nums">{num(DEV_LOGS.length)} Catatan</h3>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-emerald-500/10 p-2.5 text-emerald-600">
              <Sparkles className="size-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Rilis Terbaru</p>
              <h3 className="text-xl font-bold">{LATEST.version}</h3>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-500/10 p-2.5 text-blue-600">
              <CalendarDays className="size-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Catatan Terbaru</p>
              <h3 className="text-xl font-bold tabular-nums">{LATEST.date}</h3>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-purple-500/10 p-2.5 text-purple-600">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Catatan Keamanan</p>
              <h3 className="text-xl font-bold tabular-nums">{num(SECURITY_COUNT)} Catatan</h3>
            </div>
          </div>
        </Card>
      </div>

      {/* Search & Filter Bar */}
      <Card className="p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="Cari log (misal: RLS, KiriminAja, bug, v1.0.0, COD)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mr-1">
              <Filter className="size-3.5" /> Kategori:
            </div>
            <button
              onClick={() => setSelectedCategory("all")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                selectedCategory === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              Semua
            </button>
            {Object.entries(CATEGORY_MAP).map(([catKey, catVal]) => (
              <button
                key={catKey}
                onClick={() => setSelectedCategory(catKey)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  selectedCategory === catKey ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {catVal.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Log Feed */}
      <div className="space-y-4">
        {view.items.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-sm text-muted-foreground">Tidak ada dev log yang cocok dengan pencarian / filter Anda.</p>
          </Card>
        ) : (
          view.items.map((log) => {
            const categoryMeta = CATEGORY_MAP[log.category] || CATEGORY_MAP.minor;
            const CategoryIcon = categoryMeta.icon;

            return (
              <Card key={log.id} className="overflow-hidden border-l-4 border-l-primary">
                <CardHeader className="bg-muted/30 pb-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-mono text-sm font-bold text-primary">{log.version}</span>
                      <span className="text-xs text-muted-foreground">• {log.date}</span>
                      <Badge variant={categoryMeta.badgeVariant} className="flex items-center gap-1 text-[11px]">
                        <CategoryIcon className="size-3" /> {categoryMeta.label}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {log.surfaces.map((s) => (
                        <Badge key={s} variant="outline" className="text-[10px] bg-background">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <CardTitle className="mt-2 text-base font-semibold">{log.title}</CardTitle>
                  <CardDescription className="text-xs text-foreground/90 font-medium bg-background p-2.5 rounded border border-border/60">
                    💡 <span className="font-semibold">Ringkasan:</span> {log.summary}
                  </CardDescription>
                </CardHeader>

                {/* ⚠️ NATIVE `<details>`, NOT A COMPONENT.
                    Five entries per page over four dense paragraphs each is still ~20 paragraphs, so
                    problem / solution / verification collapse and only the summary above stays open.
                    `<details>`/`<summary>` is keyboard-operable and announced as a disclosure by
                    screen readers with no work of ours, it survives with JavaScript off, and it adds
                    no dependency — the native platform feature beats a component here. The default
                    triangle marker is hidden (`list-none` + the WebKit pseudo-element) and replaced
                    by a chevron that rotates with `group-open:`, so the state is still visible. */}
                <CardContent className="p-4 text-xs">
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md py-1 font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                      <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
                      Detail teknis — isu, solusi & bukti verifikasi
                    </summary>

                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      {/* Problem */}
                      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                        <p className="font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5 mb-1">
                          <Bug className="size-3.5" /> Di mana Bug / Isu:
                        </p>
                        <p className="text-muted-foreground leading-relaxed">{log.problem}</p>
                      </div>

                      {/* Solution */}
                      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                        <p className="font-semibold text-blue-700 dark:text-blue-400 flex items-center gap-1.5 mb-1">
                          <CheckCircle2 className="size-3.5" /> Solusi & Perbaikan:
                        </p>
                        <p className="text-muted-foreground leading-relaxed">{log.solution}</p>
                      </div>

                      {/* Verification */}
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                        <p className="font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 mb-1">
                          <ShieldCheck className="size-3.5" /> Bukti Verifikasi:
                        </p>
                        <p className="text-muted-foreground leading-relaxed">{log.verification}</p>
                      </div>
                    </div>
                  </details>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Pagination — `@tokophi/ui/pagination`, first consumer in this app.
          ⚠️ NO `href` IS EMITTED — not even `"#"`; `goTo()` above says why and what was measured.
          The disabled Prev/Next spread NOTHING rather than a no-op handler, so "disabled" is a fact
          about the handlers and not only about `pointer-events-none` in a class string. */}
      {view.items.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Menampilkan <span className="font-medium tabular-nums text-foreground">{num(view.start)}–{num(view.end)}</span> dari{" "}
            <span className="font-medium tabular-nums text-foreground">{num(filteredLogs.length)}</span> catatan
          </p>
          {view.pageCount > 1 && (
            <Pagination className="mx-0 w-auto justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    text="Sebelumnya"
                    aria-disabled={view.page === 1}
                    className={view.page === 1 ? "pointer-events-none opacity-50" : undefined}
                    {...(view.page > 1 ? goTo(view.page - 1) : {})}
                  />
                </PaginationItem>
                {pageNumbers.map((item, index) => (
                  <PaginationItem key={item}>
                    {index > 0 && pageNumbers[index - 1] !== item - 1 && <PaginationEllipsis />}
                    <PaginationLink isActive={item === view.page} {...goTo(item)}>
                      {item}
                    </PaginationLink>
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext
                    text="Berikutnya"
                    aria-disabled={view.page === view.pageCount}
                    className={view.page === view.pageCount ? "pointer-events-none opacity-50" : undefined}
                    {...(view.page < view.pageCount ? goTo(view.page + 1) : {})}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      )}
    </div>
  );
}
