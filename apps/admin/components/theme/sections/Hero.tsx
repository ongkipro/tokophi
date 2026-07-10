import type { HeroConfig, ColorPalette } from "@tokophi/sections";
import { resolvePalette } from "@tokophi/sections";
import { paletteStyle } from "@/lib/theme/palette-style";

// Preview approximation of the storefront's rendered output (own Tailwind palette here,
// not @tokophi/data's storefront tokens — see apps/storefront/src/components/sections/Hero.astro
// for the real render). Kept visually close on purpose so the builder stays WYSIWYG-ish.
export function Hero({
  heading,
  subheading,
  imageUrl,
  ctaLabel,
  ctaHref,
  align,
  badge,
  ratingText,
  paletteId,
  palettes,
}: HeroConfig & { palettes: ColorPalette[] }) {
  const p = resolvePalette(paletteId, palettes);
  return (
    <section
      style={paletteStyle(p)}
      className="relative overflow-hidden rounded-2xl bg-[var(--scheme-background)]"
    >
      {imageUrl && (
        <img src={imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
      <div
        className={`relative flex min-h-[380px] flex-col justify-end gap-3 p-10 text-white ${
          align === "center" ? "items-center text-center" : "items-start text-left"
        }`}
      >
        {badge && (
          <span className="inline-flex rounded-full bg-[var(--scheme-accent)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
            {badge}
          </span>
        )}
        <h1 className="max-w-xl text-4xl font-semibold tracking-tight">{heading}</h1>
        <p className="max-w-md text-white/85">{subheading}</p>
        <a
          href={ctaHref}
          className="mt-2 inline-flex rounded-full bg-[var(--scheme-button)] px-5 py-2.5 text-sm font-semibold text-[var(--scheme-button-text)] shadow-sm transition hover:opacity-90"
        >
          {ctaLabel}
        </a>
        {ratingText && <p className="mt-1 text-sm text-white/80">{ratingText}</p>}
      </div>
    </section>
  );
}
