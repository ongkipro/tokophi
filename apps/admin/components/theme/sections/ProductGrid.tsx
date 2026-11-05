import type { ProductGridConfig } from "@tokophi/sections";

// Editor preview only — uses placeholder tiles since real product data comes from the
// store's catalog at storefront render time (apps/storefront/src/components/sections/ProductGrid.astro).
const MODE_LABEL = { terlaris: "Terlaris", terbaru: "Terbaru", acak: "Acak" };
const RATIO_ASPECT = { "1:1": "aspect-square", "3:4": "aspect-[3/4]", "4:5": "aspect-[4/5]" } as const;

export function ProductGrid({ heading, mode, limit, columns, imageRatio = "3:4" }: ProductGridConfig) {
  const cols = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" }[columns] ?? "grid-cols-4";
  const aspect = RATIO_ASPECT[imageRatio] ?? RATIO_ASPECT["3:4"];
  const tiles = Array.from({ length: Math.min(limit, columns * 2) });

  return (
    <section className="p-6">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="font-display text-[1.375rem] font-semibold leading-tight tracking-[-0.01em] text-ink sm:text-[1.75rem]">{heading}</h2>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-ink/60">
          {MODE_LABEL[mode]}
        </span>
      </div>
      <div className={`grid gap-4 ${cols}`}>
        {tiles.map((_, i) => (
          // Mirrors ProductCard.astro after redesign C (DESIGN.md C5): image (4px radius) → name on two
          // lines → price. No category kicker and no stars — the card no longer carries either.
          <div key={i}>
            <div className={`${aspect} overflow-hidden rounded-sm bg-zinc-100`} />
            <div className="mt-3 space-y-1.5">
              <div className="h-3 w-3/4 rounded bg-line" />
              <div className="h-3 w-1/2 rounded bg-line" />
              <div className="h-3.5 w-2/5 rounded bg-ink/20" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
