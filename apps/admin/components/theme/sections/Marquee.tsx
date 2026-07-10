import type { MarqueeConfig, ColorPalette } from "@tokophi/sections";
import { resolvePalette } from "@tokophi/sections";
import { paletteStyle } from "@/lib/theme/palette-style";

// Static preview (no scroll animation in the editor canvas) — the storefront's Astro
// counterpart is the one that actually animates via CSS.
export function Marquee({
  text,
  paletteId,
  palettes,
}: MarqueeConfig & { palettes: ColorPalette[] }) {
  const p = resolvePalette(paletteId, palettes);
  return (
    <section
      style={paletteStyle(p)}
      className="overflow-hidden bg-[var(--scheme-button)] py-4"
    >
      <p className="whitespace-nowrap text-center text-lg font-semibold text-[var(--scheme-button-text)]">
        {Array(4).fill(text).join("  ·  ")}
      </p>
    </section>
  );
}
