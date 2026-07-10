import type { TestimoniConfig, ColorPalette } from "@tokophi/sections";
import { resolvePalette } from "@tokophi/sections";
import { paletteStyle } from "@/lib/theme/palette-style";

export function Testimoni({
  heading,
  items,
  paletteId,
  palettes,
}: TestimoniConfig & { palettes: ColorPalette[] }) {
  const p = resolvePalette(paletteId, palettes);
  return (
    <section style={paletteStyle(p)} className="rounded-2xl bg-[var(--scheme-background)] p-8">
      <h2 className="mb-6 text-center text-xl font-semibold text-[var(--scheme-text)]">{heading}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, i) => (
          <figure key={i} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-stone-100">
            <div className="mb-2 flex items-center gap-1.5 text-amber-400" aria-hidden="true">
              <span>
                {"★".repeat(item.rating)}
                <span className="text-stone-200">{"★".repeat(5 - item.rating)}</span>
              </span>
              <span className="text-xs font-medium text-stone-400">{item.rating}/5</span>
            </div>
            <blockquote className="text-sm text-stone-700">&ldquo;{item.quote}&rdquo;</blockquote>
            <figcaption className="mt-3 text-sm font-medium text-stone-900">— {item.name}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
