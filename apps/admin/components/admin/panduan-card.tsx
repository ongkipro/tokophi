import { BookOpen, ArrowUpRight } from "lucide-react";

/** Seller help center (apps/docs) — its own site since 2026-10-12, same URL the landing links. */
export const PANDUAN_URL = process.env.NEXT_PUBLIC_PANDUAN_URL || "https://panduan.tokophi.com";

/** Floating guide card pinned to the bottom of the sidebar (desktop) and the mobile drawer.
 *  It sits OUTSIDE the nav's scroll area, so it stays put while the menu scrolls. */
export function PanduanCard({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="shrink-0 border-t bg-card/95 p-3 backdrop-blur">
      <a
        href={PANDUAN_URL}
        target="_blank"
        rel="noopener"
        onClick={onNavigate}
        className="group flex items-center gap-3 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 to-primary/5 px-3 py-2.5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <BookOpen className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium leading-tight">Panduan Seller</span>
          <span className="block truncate text-xs text-muted-foreground">Cara pakai TokoΦ, langkah demi langkah</span>
        </span>
        <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden />
        <span className="sr-only">(buka di tab baru)</span>
      </a>
    </div>
  );
}
