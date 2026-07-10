import type { ProductGridConfig, ColorPalette } from "@tokophi/sections";
import { resolvePalette } from "@tokophi/sections";
import { paletteStyle } from "@/lib/theme/palette-style";

// Editor preview only — uses placeholder tiles since real product data comes from the
// store's catalog at storefront render time (apps/storefront/src/components/sections/ProductGrid.astro).
const MODE_LABEL = { terlaris: "Terlaris", terbaru: "Terbaru", acak: "Acak" };

export function ProductGrid({
  heading,
  mode,
  limit,
  columns,
  paletteId,
  palettes,
}: ProductGridConfig & { palettes: ColorPalette[] }) {
  const p = resolvePalette(paletteId, palettes);
  const cols = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" }[columns] ?? "grid-cols-4";
  const tiles = Array.from({ length: Math.min(limit, columns * 2) });

  return (
    <section style={paletteStyle(p)} className="bg-[var(--scheme-background)] p-6">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-xl font-semibold text-[var(--scheme-text)]">{heading}</h2>
        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-500">
          {MODE_LABEL[mode]}
        </span>
      </div>
      <div className={`grid gap-4 ${cols}`}>
        {tiles.map((_, i) => (
          <div key={i} className="overflow-hidden rounded-xl bg-white ring-1 ring-stone-200">
            <div className="aspect-[3/4] bg-stone-100" />
            <div className="space-y-1.5 p-3">
              <div className="h-3 w-3/4 rounded bg-stone-200" />
              <div className="h-3 w-1/2 rounded bg-stone-200" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
