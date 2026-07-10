import type { ColorPalette } from "@tokophi/sections";

// ADR 0009 amendment 2 ("Palet Warna") — turns a resolved palette into inline CSS custom
// properties. Section components reference them via Tailwind arbitrary values
// (bg-[var(--scheme-background)]) instead of hardcoded colours, so swapping paletteId
// re-themes the section without any markup change. Shared by every admin preview component
// and mirrored by apps/storefront's version for the real render.
export function paletteStyle(p: ColorPalette): React.CSSProperties {
  return {
    "--scheme-background": p.background,
    "--scheme-text": p.text,
    "--scheme-button": p.button,
    "--scheme-button-text": p.buttonText,
    "--scheme-accent": p.accent,
  } as React.CSSProperties;
}
