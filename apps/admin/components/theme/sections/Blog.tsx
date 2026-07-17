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
        <h2 className="text-xl font-semibold text-stone-900">{heading}</h2>
        {ctaLabel && <span className="text-sm font-medium text-stone-500">{ctaLabel} →</span>}
      </div>
      <div className={`grid gap-4 ${cols}`}>
        {tiles.map((_, i) => (
          <div key={i} className="overflow-hidden rounded-xl bg-white ring-1 ring-stone-200">
            <div className="aspect-[3/2] bg-stone-100" />
            <div className="space-y-1.5 p-3">
              <div className="h-2 w-1/3 rounded bg-stone-200" />
              <div className="h-3 w-3/4 rounded bg-stone-200" />
              <div className="h-3 w-1/2 rounded bg-stone-200" />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 rounded-lg bg-stone-50 px-3 py-2 text-xs leading-relaxed text-stone-500">
        Menampilkan {limit} tulisan terbaru dari Blog secara otomatis — kamu tidak perlu memilihnya
        satu per satu. <strong className="font-semibold text-stone-700">Kalau belum ada tulisan yang
        terbit, bagian ini tidak muncul di toko</strong> (pengunjung tidak melihat kotak kosong).
      </p>
    </section>
  );
}
