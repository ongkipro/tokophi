// Per-tenant design tokens (storefront theming). One resolver turns the store's choices
// (`stores.brand_color` + `stores.theme` jsonb) into the full token set Layout.astro injects
// as CSS custom-property overrides — the same mechanism the brand shades already use, extended
// to the neutral palette and the display font. This is the font picker the `--font-display`
// seam in apps/storefront/src/styles/global.css was kept for.
//
// Neutral derivation rule (this is what makes it precise instead of hand-tuned per store):
//   - TEMPERATURE belongs to the room  → `cream`/`line` (surface + border) take their hue from
//     the chosen TONE (hangat 30°, netral desaturated, sejuk 220°).
//   - HARMONY belongs to the content   → `ink`/`muted` (text) are always tinted with the
//     tenant's BRAND hue, at low saturation.
//   - CONTRAST is not negotiable      → `muted` keeps the lightness of the WCAG-AA fix
//     (#736669, ≥4.5:1 on cream) in every tone; theme.test.ts asserts it across brand hues.
//
// Defaults (`bawaan` + `hangat`) reproduce the current global.css values byte-for-byte-ish
// (±1/255 from HSL rounding), so every existing live store renders unchanged until its owner
// actually picks something.
import { hexToHSL, hslToHex, DEFAULT_BRAND_COLOR, generateBrandShades } from "./colors";

export function generateTenantThemeVariables(brandHex: string | null | undefined, storeTheme: unknown): string {
  const color = brandHex || DEFAULT_BRAND_COLOR;
  const shades = generateBrandShades(color);
  const resolved = resolveTheme({ brandColor: color, theme: storeTheme });
  
  const vars: string[] = [];
  for (const [shade, hex] of Object.entries(shades)) {
    vars.push(`--color-brand-${shade}: ${hex};`);
  }
  
  if (resolved.toneChosen) {
    vars.push(`--color-cream: ${resolved.neutrals.cream};`);
    vars.push(`--color-ink: ${resolved.neutrals.ink};`);
    vars.push(`--color-muted: ${resolved.neutrals.muted};`);
    vars.push(`--color-line: ${resolved.neutrals.line};`);
  }
  
  if (resolved.fontChosen) {
    vars.push(`--font-display: ${resolved.font.display};`);
  }
  
  return vars.join(" ");
}

// ---------- neutrals ----------

export type NeutralTone = "hangat" | "netral" | "sejuk";

export type Neutrals = {
  /** page background (utility `bg-cream`) */
  cream: string;
  /** primary text (`text-ink`) */
  ink: string;
  /** secondary text (`text-muted`) — AA on cream in every tone */
  muted: string;
  /** hairlines/borders (`border-line`) */
  line: string;
};

// h omitted = use the brand hue. "hangat" is the HSL of the palette shipping in global.css today
// (#faf6f2 / #2b2326 / #736669 / #ece3dd) so the default round-trips visually identical.
// ⚠️ muted lightness ~42.5 is the AA floor from the #8a7f82 → #736669 contrast fix — a lighter
// muted re-breaks all 182 violations that fix closed. Don't raise it without re-measuring.
type Step = { h?: number; s: number; l: number };
const TONES: Record<NeutralTone, { cream: Step; line: Step; ink: Step; muted: Step }> = {
  hangat: {
    cream: { h: 30, s: 44, l: 96.5 },
    line: { h: 24, s: 28, l: 89.6 },
    ink: { s: 10, l: 15.3 },
    muted: { s: 6, l: 42.5 },
  },
  netral: {
    cream: { h: 0, s: 0, l: 98 },
    line: { h: 0, s: 0, l: 90 },
    ink: { s: 6, l: 14 },
    muted: { s: 4, l: 42 },
  },
  sejuk: {
    cream: { h: 220, s: 30, l: 97 },
    line: { h: 220, s: 18, l: 90 },
    ink: { s: 12, l: 14 },
    muted: { s: 8, l: 42 },
  },
};

/** Picker metadata for the Tema panel — ids double as the persisted values. */
export const NEUTRAL_TONES: { id: NeutralTone; label: string; hint: string }[] = [
  { id: "hangat", label: "Hangat", hint: "Krem lembut — butik, kerajinan, kuliner" },
  { id: "netral", label: "Netral", hint: "Putih bersih — elektronik, serba ada" },
  { id: "sejuk", label: "Sejuk", hint: "Biru dingin — teknologi, kesehatan" },
];

export function generateNeutrals(brandHex: string, tone: NeutralTone): Neutrals {
  const { h: brandH } = hexToHSL(brandHex);
  const t = TONES[tone];
  const px = (step: Step) => hslToHex(step.h ?? brandH, step.s, step.l);
  return { cream: px(t.cream), ink: px(t.ink), muted: px(t.muted), line: px(t.line) };
}

// ---------- display font ----------

// The pairing is DISPLAY-ONLY on purpose: body text stays Inter (self-hosted, already preloaded —
// see global.css for why the Google Fonts <link> was removed). One pairing therefore costs the
// shopper at most ONE extra woff2, and `bawaan` costs zero.
export type FontPairingId = "bawaan" | "elegan" | "modern" | "klasik" | "tegas";

export type FontPairing = {
  id: FontPairingId;
  label: string;
  hint: string;
  /** CSS font-family value for `--font-display`. */
  display: string;
  /**
   * Storefront-relative woff2 to preload for the display family (latin subset, variable weight,
   * self-hosted in apps/storefront/public/fonts). null = Inter, which is already loaded.
   */
  displayFile: string | null;
};

export const FONT_PAIRINGS: Record<FontPairingId, FontPairing> = {
  bawaan: {
    id: "bawaan",
    label: "Bawaan",
    hint: "Netral untuk semua jenis toko",
    display: `"Inter", ui-sans-serif, system-ui, sans-serif`,
    displayFile: null,
  },
  elegan: {
    id: "elegan",
    label: "Elegan",
    hint: "Butik, fashion, kerajinan",
    display: `"Playfair Display", Georgia, "Times New Roman", serif`,
    displayFile: "/fonts/playfair-display-latin.woff2",
  },
  modern: {
    id: "modern",
    label: "Modern",
    hint: "Brand muda, lifestyle, D2C",
    display: `"Manrope", ui-sans-serif, system-ui, sans-serif`,
    displayFile: "/fonts/manrope-latin.woff2",
  },
  klasik: {
    id: "klasik",
    label: "Klasik",
    hint: "Kuliner, buku, warisan",
    display: `"Lora", Georgia, "Times New Roman", serif`,
    displayFile: "/fonts/lora-latin.woff2",
  },
  tegas: {
    id: "tegas",
    label: "Tegas",
    hint: "Elektronik, hobi, olahraga",
    display: `"Space Grotesk", ui-sans-serif, system-ui, sans-serif`,
    displayFile: "/fonts/space-grotesk-latin.woff2",
  },
};

// ---------- resolver ----------

/** Shape of the `stores.theme` jsonb column. All fields optional — absent = current look. */
export type StoreTheme = {
  font?: FontPairingId;
  tone?: NeutralTone;
};

export type ResolvedTheme = {
  font: FontPairing;
  tone: NeutralTone;
  neutrals: Neutrals;
  /**
   * Whether the merchant actually PICKED this dial. Injection is gated on these: a store with no
   * choice gets ZERO overrides and renders byte-identical to before this feature — `ink`/`muted`
   * take the brand hue, so injecting derived neutrals for a non-chooser would silently retint
   * every live store's text. No choice = no change, per dial.
   */
  fontChosen: boolean;
  toneChosen: boolean;
};

export const DEFAULT_THEME: Required<StoreTheme> = { font: "bawaan", tone: "hangat" };

const isTone = (v: unknown): v is NeutralTone => typeof v === "string" && v in TONES;
const isFont = (v: unknown): v is FontPairingId => typeof v === "string" && v in FONT_PAIRINGS;

/**
 * `theme` comes from a jsonb column — treat it as untrusted (an unknown font id from a
 * half-rolled-back deploy must degrade to the default, never crash every page of the store).
 */
export function resolveTheme(store: { brandColor?: string | null; theme?: unknown }): ResolvedTheme {
  const raw = (store.theme ?? {}) as Record<string, unknown>;
  const fontChosen = isFont(raw.font);
  const toneChosen = isTone(raw.tone);
  const font = fontChosen ? (raw.font as FontPairingId) : DEFAULT_THEME.font;
  const tone = toneChosen ? (raw.tone as NeutralTone) : DEFAULT_THEME.tone;
  return {
    font: FONT_PAIRINGS[font],
    tone,
    neutrals: generateNeutrals(store.brandColor ?? DEFAULT_BRAND_COLOR, tone),
    fontChosen,
    toneChosen,
  };
}

// ── Product-gallery MAIN-image aspect (owner request 2026-08-24) ─────────────────────────────────
//
// Lives in the same `stores.theme` jsonb as font/tone — a jsonb key needs no migration, and the
// storefront already ships `store.theme` raw to the PDP. ⚠️ CONSEQUENCE FOR WRITERS: every writer of
// `stores.theme` must MERGE-PATCH, never overwrite — `saveStoreTheme` used to write `{font, tone}`
// wholesale, which would have silently wiped this key on every "Tampilan" save (fixed in the same
// change that added this).
//
// Validated exactly like font/tone: jsonb is untrusted, an unknown value degrades to the default and
// never crashes a shopper-facing page. "1:1" is the default because it is what the PDP has always
// rendered — an unset key changes nothing for existing stores.
export const GALLERY_ASPECTS = ["1:1", "4:5", "2:3"] as const;
export type GalleryAspect = (typeof GALLERY_ASPECTS)[number];

export function resolveGalleryAspect(theme: unknown): GalleryAspect {
  const raw = (theme ?? {}) as Record<string, unknown>;
  return (GALLERY_ASPECTS as readonly unknown[]).includes(raw.galleryAspect)
    ? (raw.galleryAspect as GalleryAspect)
    : "1:1";
}

// Product CARD image aspect (owner request 2026-08-24 — "/tema → card produk belum ada setup rasio").
// Same value set and the same jsonb/merge-patch/validation contract as galleryAspect above; its own
// key because the PDP gallery and the catalog cards are different surfaces a merchant tunes
// separately. "1:1" default = what every card has always rendered (T-10), so an unset key changes
// nothing for existing stores.
export function resolveCardAspect(theme: unknown): GalleryAspect {
  const raw = (theme ?? {}) as Record<string, unknown>;
  return (GALLERY_ASPECTS as readonly unknown[]).includes(raw.cardAspect)
    ? (raw.cardAspect as GalleryAspect)
    : "1:1";
}

