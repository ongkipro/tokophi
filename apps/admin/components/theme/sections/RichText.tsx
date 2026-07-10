import type { RichTextConfig, ColorPalette } from "@tokophi/sections";
import { resolvePalette } from "@tokophi/sections";
import { paletteStyle } from "@/lib/theme/palette-style";

// When a real "Palet Warna" is picked, it wins over the light/dark `theme` toggle — `theme`
// only still applies while paletteId is left on "Default toko" (see puck-config.tsx's field
// hint text for this section).
export function RichText({
  heading,
  body,
  ctaLabel,
  ctaHref,
  theme,
  paletteId,
  palettes,
}: RichTextConfig & { palettes: ColorPalette[] }) {
  if (paletteId) {
    const p = resolvePalette(paletteId, palettes);
    return (
      <section
        style={paletteStyle(p)}
        className="rounded-2xl bg-[var(--scheme-background)] p-10 text-center text-[var(--scheme-text)]"
      >
        <h2 className="mx-auto max-w-xl text-2xl font-semibold">{heading}</h2>
        <p className="mx-auto mt-3 max-w-md opacity-75">{body}</p>
        {ctaLabel && (
          <a
            href={ctaHref}
            className="mt-6 inline-flex rounded-full bg-[var(--scheme-button)] px-6 py-2.5 text-sm font-semibold text-[var(--scheme-button-text)] shadow-sm transition hover:opacity-90"
          >
            {ctaLabel}
          </a>
        )}
      </section>
    );
  }

  const dark = theme === "gelap";
  return (
    <section
      className={`rounded-2xl p-10 text-center ${dark ? "bg-stone-900 text-white" : "bg-stone-50 text-stone-900"}`}
    >
      <h2 className="mx-auto max-w-xl text-2xl font-semibold">{heading}</h2>
      <p className={`mx-auto mt-3 max-w-md ${dark ? "text-white/75" : "text-stone-600"}`}>{body}</p>
      {ctaLabel && (
        <a
          href={ctaHref}
          className={`mt-6 inline-flex rounded-full px-6 py-2.5 text-sm font-semibold shadow-sm transition ${
            dark ? "bg-white text-stone-900 hover:bg-white/90" : "bg-stone-900 text-white hover:bg-stone-800"
          }`}
        >
          {ctaLabel}
        </a>
      )}
    </section>
  );
}
