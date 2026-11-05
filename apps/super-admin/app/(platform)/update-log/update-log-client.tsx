"use client";

import { useState, useMemo, type KeyboardEvent } from "react";
import { Search, ChevronRight } from "lucide-react";
import { Input } from "@tokophi/ui/input";
import { Card } from "@tokophi/ui/card";
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

// Labels only — no per-category colours or icons. The category is a word the operator reads, and a
// tinted badge per kind added noise without adding meaning (2026-11-03 review: "hindari AI slop").
const CATEGORY_LABEL: Record<DevLogCategory, string> = {
  major: "Rilis besar",
  minor: "Pembaruan",
  feature: "Fitur",
  bugfix: "Perbaikan bug",
  security: "Keamanan",
  logistics_payment: "Logistik & pembayaran",
};

// On phones each chip row scrolls sideways instead of wrapping into six rows above the first entry.
// Filter chips list only surfaces that occur in the data, in first-seen order, so a new surface
// appears by being used and an unused one never offers an empty filter.
const SURFACES: DevLogSurface[] = [...new Set(DEV_LOGS.flatMap((log) => log.surfaces))];
const CATEGORIES = (Object.keys(CATEGORY_LABEL) as DevLogCategory[]).filter((c) => DEV_LOGS.some((log) => log.category === c));

// `DEV_LOGS` is newest-first (the file's own contract; every entry is added at the top), so `[0]` is
// the current release. Every figure in the header is derived from the array — none is typed by hand.
const LATEST = DEV_LOGS[0];

// Dates are stored as ISO `YYYY-MM-DD` (a calendar date, no time). Parsed at UTC noon so no
// timezone can move it to the neighbouring day, and formatted in id-ID ("2 Nov 2026").
const DATE_FMT = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const formatDate = (iso: string) => DATE_FMT.format(new Date(`${iso}T12:00:00Z`));

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
        active ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

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
        log.solution.toLowerCase().includes(search.toLowerCase()) ||
        log.verification.toLowerCase().includes(search.toLowerCase()) ||
        log.surfaces.some((surface) => surface.toLowerCase().includes(search.toLowerCase()));

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
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Update Log</h1>
          <p className="text-sm text-muted-foreground">Riwayat perubahan platform: masalahnya, perbaikannya, dan buktinya.</p>
        </div>
        <p className="text-sm text-muted-foreground tabular-nums">
          Terbaru <span className="font-mono font-medium text-foreground">{LATEST.version}</span> · {formatDate(LATEST.date)} ·{" "}
          {num(DEV_LOGS.length)} catatan
        </p>
      </header>

      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label="Cari catatan"
            placeholder="Cari versi atau kata kunci"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" role="group" aria-label="Filter kategori">
          <span className="w-16 shrink-0 text-xs text-muted-foreground">Kategori</span>
          <Chip active={selectedCategory === "all"} onClick={() => setSelectedCategory("all")}>Semua</Chip>
          {CATEGORIES.map((c) => (
            <Chip key={c} active={selectedCategory === c} onClick={() => setSelectedCategory(c)}>
              {CATEGORY_LABEL[c]}
            </Chip>
          ))}
        </div>
        <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" role="group" aria-label="Filter bagian">
          <span className="w-16 shrink-0 text-xs text-muted-foreground">Bagian</span>
          <Chip active={selectedSurface === "all"} onClick={() => setSelectedSurface("all")}>Semua</Chip>
          {SURFACES.map((surface) => (
            <Chip key={surface} active={selectedSurface === surface} onClick={() => setSelectedSurface(surface)}>
              {surface}
            </Chip>
          ))}
        </div>
      </div>

      {view.items.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-muted-foreground">Tidak ada catatan yang cocok dengan pencarian atau filter ini.</p>
        </Card>
      ) : (
        <Card className="p-0">
          <ol aria-label="Catatan perubahan">
            {view.items.map((log) => (
              <li key={log.id} className="grid gap-x-6 gap-y-2 border-b p-4 last:border-b-0 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:p-5">
                <div className="flex items-baseline gap-2 text-xs text-muted-foreground sm:flex-col sm:gap-0.5">
                  <time dateTime={log.date} className="tabular-nums">{formatDate(log.date)}</time>
                  <span className="font-mono">{log.version}</span>
                </div>

                <article className="min-w-0 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{CATEGORY_LABEL[log.category]}</span>
                    {" · "}
                    {log.surfaces.join(", ")}
                  </p>
                  <h2 className="text-[15px] font-semibold leading-snug text-pretty">{log.title}</h2>
                  <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{log.summary}</p>

                  {/* Native <details>: keyboard-operable, announced as a disclosure, works without JS,
                      no dependency. The default marker is hidden and replaced by a rotating chevron. */}
                  <details className="group">
                    <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md py-1 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                      <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
                      Detail teknis
                    </summary>
                    <dl className="mt-2 max-w-prose space-y-3 border-l pl-4 text-sm leading-relaxed">
                      <div>
                        <dt className="text-xs font-medium text-foreground">Masalah</dt>
                        <dd className="text-muted-foreground">{log.problem}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-foreground">Perbaikan</dt>
                        <dd className="text-muted-foreground">{log.solution}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-foreground">Bukti</dt>
                        <dd className="text-muted-foreground">{log.verification}</dd>
                      </div>
                    </dl>
                  </details>
                </article>
              </li>
            ))}
          </ol>
        </Card>
      )}

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
