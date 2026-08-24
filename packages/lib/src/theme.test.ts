import { describe, it, expect } from "vitest";
import { hexToHSL } from "./colors";
import { generateNeutrals, resolveGalleryAspect, resolveTheme, DEFAULT_THEME, FONT_PAIRINGS } from "./theme";

// WCAG relative-luminance contrast — the muted/cream pair must stay AA in EVERY tone × brand hue,
// because the #8a7f82 → #736669 fix closed 182 violations and a derived palette that reopens them
// would do it silently, on somebody else's store.
const lum = (hex: string) => {
  const c = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

// The default theme must reproduce the palette shipping in global.css today — every live store
// renders through resolveTheme() after this change, so "no choice" has to mean "no change".
describe("generateNeutrals", () => {
  const CURRENT = { cream: "#faf6f2", ink: "#2b2326", muted: "#736669", line: "#ece3dd" };

  it("hangat + default brand ≈ the current global.css palette (≤1/255 per channel)", () => {
    const n = generateNeutrals("#a85572", "hangat");
    for (const key of ["cream", "ink", "muted", "line"] as const) {
      const got = n[key].replace("#", "");
      const want = CURRENT[key].replace("#", "");
      for (let i = 0; i < 6; i += 2) {
        const d = Math.abs(parseInt(got.slice(i, i + 2), 16) - parseInt(want.slice(i, i + 2), 16));
        expect(d, `${key} channel ${i / 2}: ${n[key]} vs ${CURRENT[key]}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("muted-on-cream stays WCAG AA (≥4.5:1) across tones and brand hues", () => {
    const hues = ["#a85572", "#2563eb", "#16a34a", "#ea580c", "#7c3aed", "#0d9488"];
    for (const tone of ["hangat", "netral", "sejuk"] as const) {
      for (const brand of hues) {
        const n = generateNeutrals(brand, tone);
        expect(contrast(n.muted, n.cream), `${tone} × ${brand}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(n.ink, n.cream), `ink ${tone} × ${brand}`).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it("ink/muted take the brand hue (harmony), cream/line take the tone hue (temperature)", () => {
    const blueBrand = "#2563eb"; // hue ≈ 221
    const n = generateNeutrals(blueBrand, "hangat");
    expect(hexToHSL(n.ink).h).toBeGreaterThan(200); // text tinted by the brand…
    expect(hexToHSL(n.cream).h).toBeLessThan(40); // …surface stays warm
  });

  it("netral is truly desaturated on the surface", () => {
    const n = generateNeutrals("#a85572", "netral");
    expect(hexToHSL(n.cream).s).toBe(0);
    expect(hexToHSL(n.line).s).toBe(0);
  });
});

describe("resolveTheme", () => {
  it("no theme at all → the current look, zero extra font bytes, nothing marked chosen", () => {
    const t = resolveTheme({ brandColor: null, theme: null });
    expect(t.font.id).toBe(DEFAULT_THEME.font);
    expect(t.font.displayFile).toBeNull(); // bawaan = Inter, already self-hosted
    expect(t.tone).toBe(DEFAULT_THEME.tone);
    // Injection is gated on these — false means the storefront emits ZERO overrides and the
    // page is byte-identical to before the feature existed.
    expect(t.fontChosen).toBe(false);
    expect(t.toneChosen).toBe(false);
  });

  it("garbage jsonb degrades to defaults, never throws — and never counts as chosen", () => {
    const t = resolveTheme({ brandColor: "#a85572", theme: { font: "comic-sans", tone: 42 } });
    expect(t.font.id).toBe("bawaan");
    expect(t.tone).toBe("hangat");
    expect(t.fontChosen).toBe(false);
    expect(t.toneChosen).toBe(false);
  });

  it("a partial choice marks only its own dial", () => {
    const t = resolveTheme({ brandColor: "#a85572", theme: { font: "elegan" } });
    expect(t.fontChosen).toBe(true);
    expect(t.toneChosen).toBe(false);
  });

  it("a real choice is honoured", () => {
    const t = resolveTheme({ brandColor: "#2563eb", theme: { font: "tegas", tone: "sejuk" } });
    expect(t.font).toBe(FONT_PAIRINGS.tegas);
    expect(t.tone).toBe("sejuk");
    expect(hexToHSL(t.neutrals.cream).h).toBeGreaterThan(200); // cool hue (HSL round-trip shifts it a few °)
  });

  it("every non-bawaan pairing points at a self-hosted latin woff2", () => {
    for (const p of Object.values(FONT_PAIRINGS)) {
      if (p.id === "bawaan") continue;
      expect(p.displayFile).toMatch(/^\/fonts\/[a-z0-9-]+-latin\.woff2$/);
    }
  });
});

describe("resolveGalleryAspect — jsonb is untrusted, unknown degrades to 1:1", () => {
  it("returns a valid stored aspect", () => {
    expect(resolveGalleryAspect({ galleryAspect: "4:5" })).toBe("4:5");
    expect(resolveGalleryAspect({ font: "bawaan", galleryAspect: "2:3" })).toBe("2:3");
  });
  it("defaults on null/missing/garbage — a bad row must never crash a PDP", () => {
    expect(resolveGalleryAspect(null)).toBe("1:1");
    expect(resolveGalleryAspect(undefined)).toBe("1:1");
    expect(resolveGalleryAspect({})).toBe("1:1");
    expect(resolveGalleryAspect({ galleryAspect: "16:9" })).toBe("1:1");
    expect(resolveGalleryAspect({ galleryAspect: 45 })).toBe("1:1");
    expect(resolveGalleryAspect("4:5")).toBe("1:1");
  });
});
