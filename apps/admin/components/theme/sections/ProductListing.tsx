import type { ProductListingConfig } from "@tokophi/sections";

// Editor preview only. The real listing (apps/storefront/src/components/sections/ProductListingSection.astro
// → ProductListing.astro) reads the category's products at render time, sorts server-side from `?sort=`
// and pages 12 at a time — none of which exists in the builder, so this preview STATES that rather than
// pretending. It deliberately mirrors the storefront's geometry (sort row on the right, 4-up grid at
// 3:4, a pagination strip) so the merchant recognises the block they are placing; the tile count is
// fixed at 8 because the real one is paginated, not capped.
export function ProductListing({ heading }: ProductListingConfig) {
  return (
    <section className="p-6">
      {heading && <h2 className="mb-4 font-display text-[1.375rem] font-semibold leading-tight tracking-[-0.01em] text-balance text-ink sm:text-[1.75rem]">{heading}</h2>}

      {/* Mirrors ProductListing.astro after redesign C (owner 2026-11-05): a borderless toolbar —
          Shopify's two filters on the left, count + sort (default Terlaris) on the right — then the
          4:5 card grid and a plain pagination row with the current page outlined. */}
      <div className="mb-5 flex items-center gap-1 text-sm text-ink">
        <span className="mr-1 text-muted-foreground">Filter:</span>
        {["Ketersediaan", "Harga"].map((f) => (
          <span key={f} className="inline-flex items-center gap-1 rounded-lg px-3 py-2">
            {f}
            <svg viewBox="0 0 24 24" className="size-4 fill-none stroke-current text-muted-foreground" strokeWidth={2} aria-hidden="true">
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        ))}
        <span className="ml-auto text-muted-foreground">
          <span className="text-ink">12</span> produk
        </span>
        <span className="inline-flex items-center gap-1 rounded-lg px-3 py-2">
          <span className="text-muted-foreground">Urutkan:</span> Terlaris
          <svg viewBox="0 0 24 24" className="size-4 fill-none stroke-current text-muted-foreground" strokeWidth={2} aria-hidden="true">
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>

      <div className="grid grid-cols-4 gap-x-4 gap-y-8">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i}>
            <div className="aspect-[4/5] rounded-sm bg-zinc-100" />
            <div className="mt-3 space-y-1.5">
              <div className="h-3 w-3/4 rounded bg-zinc-200" />
              <div className="h-3 w-1/2 rounded bg-zinc-200" />
              <div className="h-3.5 w-2/5 rounded bg-ink/20" />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 flex items-center justify-center gap-2">
        {["1", "2", "3"].map((n) => (
          <span
            key={n}
            className={`grid size-10 place-items-center rounded-lg text-sm ${n === "1" ? "border border-ink font-semibold text-ink" : "text-ink"}`}
          >
            {n}
          </span>
        ))}
      </div>

      <p className="mt-4 text-center text-xs text-ink/40">
        Pratinjau. Produk, urutan, dan halaman mengikuti kategori saat storefront dibuka.
      </p>
    </section>
  );
}
