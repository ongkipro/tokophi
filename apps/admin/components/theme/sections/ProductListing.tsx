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
      {heading && <h2 className="mb-4 text-xl font-semibold text-ink">{heading}</h2>}

      <div className="mb-4 flex items-center justify-between gap-4">
        <span className="text-xs text-ink/50">Menampilkan seluruh produk kategori ini</span>
        <span className="rounded-md border border-ink/15 px-3 py-1.5 text-xs text-ink/60">
          Urutkan: Terbaru
        </span>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="aspect-[3/4] rounded-md bg-ink/5" />
            <div className="h-3 w-3/4 rounded bg-ink/10" />
            <div className="h-3 w-1/2 rounded bg-ink/10" />
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-center gap-2">
        {["1", "2", "3"].map((n) => (
          <span
            key={n}
            className={`grid size-8 place-items-center rounded-md text-xs ${
              n === "1" ? "bg-ink text-white" : "border border-ink/15 text-ink/60"
            }`}
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
