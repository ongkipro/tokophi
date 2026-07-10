import type { CategoryNavConfig, ColorPalette } from "@tokophi/sections";
import { resolvePalette } from "@tokophi/sections";
import { paletteStyle } from "@/lib/theme/palette-style";

export function CategoryNav({
  items,
  paletteId,
  palettes,
}: CategoryNavConfig & { palettes: ColorPalette[] }) {
  const p = resolvePalette(paletteId, palettes);
  return (
    <section style={paletteStyle(p)} className="flex flex-wrap justify-center gap-6 bg-[var(--scheme-background)] p-6">
      {items.map((item, i) => (
        <div key={i} className="flex flex-col items-center gap-2">
          <div className="h-20 w-20 overflow-hidden rounded-full bg-gradient-to-br from-stone-300 to-stone-100">
            {item.imageUrl && <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />}
          </div>
          <span className="text-sm font-medium text-[var(--scheme-text)]">{item.label}</span>
        </div>
      ))}
    </section>
  );
}
