import type { ProductGridConfig } from "@tokophi/sections";

// Editor preview only — uses placeholder tiles since real product data comes from the
// store's catalog at storefront render time (apps/storefront/src/components/sections/ProductGrid.astro).
const MODE_LABEL = { terlaris: "Terlaris", terbaru: "Terbaru", acak: "Acak" };

export function ProductGrid({ heading, mode, limit, columns }: ProductGridConfig) {
  const cols = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" }[columns] ?? "grid-cols-4";
  const tiles = Array.from({ length: Math.min(limit, columns * 2) });

  return (
    <section className="p-6">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-xl font-semibold text-ink">{heading}</h2>
        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-ink/60">
          {MODE_LABEL[mode]}
        </span>
      </div>
      <div className={`grid gap-4 ${cols}`}>
        {tiles.map((_, i) => (
          // FRAMELESS / FLAT — mirrors ProductCard.astro (owner 2026-07-23): no card box, no ring, no
          // shadow. The image is the one surface (thin `rounded-md`); type sits flush beneath (`mt-3`).
          <div key={i}>
            <div className="aspect-[3/4] overflow-hidden rounded-md bg-brand-50" />
            <div className="mt-3 space-y-1.5">
              {/* uppercase category kicker */}
              <div className="h-2 w-1/3 rounded bg-line" />
              {/* title — two lines (line-clamp-2 min-h on the real card) */}
              <div className="h-3 w-3/4 rounded bg-line" />
              <div className="h-3 w-1/2 rounded bg-line" />
              {/* compact rating — ONE filled amber star + value + count, not five stars */}
              <div className="flex items-center gap-1 pt-0.5">
                <svg viewBox="0 0 20 20" className="size-3.5 shrink-0 fill-amber-400" aria-hidden="true">
                  <path d="M10 1.5l2.6 5.27 5.82.85-4.21 4.1.99 5.79L10 14.77l-5.2 2.73.99-5.79L1.58 7.62l5.82-.85L10 1.5Z" />
                </svg>
                <div className="h-2 w-10 rounded bg-line" />
              </div>
              {/* price — bolder ink figure */}
              <div className="h-3.5 w-2/5 rounded bg-brand-200" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
