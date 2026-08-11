// Generates a full brand shade scale from a single hex — used by the Store Builder's colour
// panel (ADR 0009) so a merchant can set one brand colour and have it cascade through the
// whole storefront. Algorithm: convert to HSL, vary lightness (and de-saturate lighter steps
// slightly so they don't turn into neon pastels), convert back to hex.
export type BrandShades = Record<50 | 100 | 200 | 400 | 500 | 600 | 700, string>;

export function hexToHSL(hex: string): { h: number; s: number; l: number } {
  const clean = hex.replace(/^#/, "");
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const diff = max - min;

  let l = (max + min) / 2;
  let s = 0;
  if (diff !== 0) s = l > 0.5 ? diff / (2 - max - min) : diff / (max + min);

  let h = 0;
  if (diff !== 0) {
    if (max === r) h = ((g - b) / diff + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / diff + 2) / 6;
    else h = ((r - g) / diff + 4) / 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToHex(h: number, s: number, l: number): string {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lN - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Lightness + saturation-multiplier steps (see color-palette skill) — only the 7 steps
// apps/storefront actually uses (brand-50/100/200/400/500/600/700).
const STEPS: Record<keyof BrandShades, { l: number; sMul: number }> = {
  50: { l: 97, sMul: 0.7 },
  100: { l: 92, sMul: 0.75 },
  200: { l: 83, sMul: 0.8 },
  400: { l: 62, sMul: 0.95 },
  500: { l: 48, sMul: 1 },
  600: { l: 40, sMul: 1 },
  700: { l: 33, sMul: 1 },
};

export function generateBrandShades(brandHex: string): BrandShades {
  const { h, s } = hexToHSL(brandHex);
  const out = {} as BrandShades;
  for (const [shade, { l, sMul }] of Object.entries(STEPS)) {
    out[Number(shade) as keyof BrandShades] = hslToHex(h, Math.round(s * sMul), l);
  }
  return out;
}

// Fallback used when a store hasn't picked a brand colour yet — matches the original
// hand-picked rose palette in apps/storefront/src/styles/global.css so existing stores
// (e.g. the Batik Nusantara demo) look identical until they change it.
export const DEFAULT_BRAND_COLOR = "#a85572";
