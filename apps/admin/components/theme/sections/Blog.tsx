import type { BlogConfig } from "@tokophi/sections";

// Editor preview only — placeholder tiles, because the real articles are read from the DB at
// storefront render time (apps/storefront/src/components/sections/Blog.astro). Same contract as
// ProductGrid's preview.
//
// ⚠️ The one thing this preview must SAY OUT LOUD: on the live storefront this section renders
// NOTHING until the merchant has a published article. A silent placeholder here would mean dragging
// "Jurnal" in, publishing, and finding an invisible section with no explanation — so the note below
// is the section's most important field, not decoration.
export function Blog({ heading, limit, ctaLabel }: BlogConfig) {
  const tiles = Array.from({ length: limit });
  const cols = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" }[limit] ?? "grid-cols-3";

  return (
    <section className="p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-xl font-semibold text-ink">{heading}</h2>
        {ctaLabel && <span className="text-sm font-medium text-brand-600">{ctaLabel} →</span>}
      </div>
      <div className={`grid gap-4 ${cols}`}>
        {tiles.map((_, i) => (
          // FRAMELESS / FLAT — mirrors ArticleCard.astro: no box, no ring. The image is the surface
          // (thin `rounded-md`, 3:2); text flush beneath. No "Baca selengkapnya" — the whole tile links.
          <div key={i} className="flex flex-col">
            <div className="aspect-[3/2] overflow-hidden rounded-md bg-brand-50" />
            <div className="mt-3">
              {/* date kicker */}
              <div className="h-2 w-1/4 rounded bg-line" />
              {/* title — two lines, larger (text-lg font-semibold on the real card) */}
              <div className="mt-1.5 h-4 w-3/4 rounded bg-brand-200" />
              <div className="mt-1.5 h-4 w-1/2 rounded bg-brand-200" />
              {/* excerpt — two lines */}
              <div className="mt-2 h-2.5 w-full rounded bg-line" />
              <div className="mt-1.5 h-2.5 w-2/3 rounded bg-line" />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 rounded-lg bg-brand-50 px-3 py-2 text-xs leading-relaxed text-ink/60">
        Menampilkan {limit} tulisan terbaru dari Blog secara otomatis — kamu tidak perlu memilihnya
        satu per satu. <strong className="font-semibold text-ink">Kalau belum ada tulisan yang
        terbit, bagian ini tidak muncul di toko</strong> (pengunjung tidak melihat kotak kosong).
      </p>
    </section>
  );
}
