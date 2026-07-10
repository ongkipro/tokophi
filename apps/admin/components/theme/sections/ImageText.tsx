import type { ImageTextConfig, ColorPalette } from "@tokophi/sections";
import { resolvePalette } from "@tokophi/sections";
import { paletteStyle } from "@/lib/theme/palette-style";

export function ImageText({
  heading,
  body,
  imageUrl,
  imageSide,
  eyebrow,
  paletteId,
  palettes,
}: ImageTextConfig & { palettes: ColorPalette[] }) {
  const p = resolvePalette(paletteId, palettes);
  const image = (
    <div className="aspect-[4/3] overflow-hidden rounded-2xl bg-gradient-to-br from-stone-300 to-stone-100">
      {imageUrl && <img src={imageUrl} alt="" className="h-full w-full object-cover" />}
    </div>
  );
  const text = (
    <div className="flex flex-col justify-center gap-3">
      {eyebrow && (
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--scheme-accent)]">{eyebrow}</p>
      )}
      <h2 className="text-2xl font-semibold text-[var(--scheme-text)]">{heading}</h2>
      <p className="text-[var(--scheme-text)] opacity-75">{body}</p>
    </div>
  );
  return (
    <section
      style={paletteStyle(p)}
      className="grid grid-cols-2 gap-8 bg-[var(--scheme-background)] p-6"
    >
      {imageSide === "right" ? (
        <>
          {text}
          {image}
        </>
      ) : (
        <>
          {image}
          {text}
        </>
      )}
    </section>
  );
}
