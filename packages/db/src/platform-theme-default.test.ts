import { describe, expect, it } from "vitest";
import {
  PLATFORM_DEFAULT_TEMPLATES,
  PLATFORM_DEFAULT_HOMEPAGE,
} from "./platform-theme-default";

// The platform default is rendered by EVERY store whose matching slot is empty — measured on
// production 2026-08-23, eleven of fifteen. So a single niche word or a single `/kategori/<handle>`
// in this file is not a typo, it is eleven shops advertising something they do not sell. These are
// the rules the module's header states, made executable.
//
// ⚠️ This is a claim about DATA, not about source text, so it walks the exported object — there is
// nothing here for `test/source-code.ts` to do: the strings under test ARE the payload.

/** Every string anywhere in the templates, with the path that reached it. */
function strings(v: unknown, path = "$"): [string, string][] {
  if (typeof v === "string") return [[path, v]];
  if (Array.isArray(v)) return v.flatMap((x, i) => strings(x, `${path}[${i}]`));
  if (v && typeof v === "object")
    return Object.entries(v).flatMap(([k, x]) => strings(x, `${path}.${k}`));
  return [];
}

const ALL = Object.entries(PLATFORM_DEFAULT_TEMPLATES).flatMap(([type, t]) =>
  strings(t.sections, `${type}`),
);

describe("the platform default theme names no shop's niche", () => {
  // The demo's own vocabulary, plus the two words that made the defect visible. Not a general
  // profanity-style list — these are the exact strings the copied theme shipped to eleven stores.
  const NICHE = [
    "batik", "dress", "busana muslim", "hijab", "atasan", "bawahan", "loungewear",
    "outerwear", "kemeja", "rok", "piyama", "denim", "tenun", "katun", "linen",
    "perempuan indonesia", "koleksi 2026",
  ];

  it.each(NICHE)("never says %s", (word) => {
    const hits = ALL.filter(([, s]) => s.toLowerCase().includes(word));
    expect(hits, `"${word}" found at: ${hits.map(([p]) => p).join(", ")}`).toEqual([]);
  });
});

describe("every link is a route every store actually has", () => {
  // `/kategori/dress` is a 404 on a store without that handle — and that is precisely what the copied
  // default shipped, on the hero's only button.
  it("links to no category, collection or product handle", () => {
    const bad = ALL.filter(
      ([p, s]) => /Href$|href$/i.test(p) && s !== "" && !s.startsWith("/produk"),
    );
    expect(bad, `non-universal links: ${JSON.stringify(bad)}`).toEqual([]);
  });

  it("references no image file", () => {
    // Every image in `apps/storefront/public/` is the batik demo's. Hero, ImageText and Lookbook all
    // render a brand-tinted panel for an empty `imageUrl` — an empty panel that asks to be filled
    // beats a stranger's photograph presented as the merchant's.
    const imgs = ALL.filter(([p, s]) => /imageUrl$/i.test(p) && s !== "");
    expect(imgs, `image references: ${JSON.stringify(imgs)}`).toEqual([]);
  });
});

describe("the default promises nothing on a merchant's behalf", () => {
  // `@tokophi/sections`: "OPTIONAL and empty by default: a store that has not set any gets no strip
  // — never an over-promise like 'Gratis Ongkir' a store does not actually offer." The copied theme
  // carried four badges; only "checkout tanpa perlu daftar akun" is true for every store.
  it("ships no hero feature badges", () => {
    const hero = PLATFORM_DEFAULT_HOMEPAGE.content.find((s) => s.type === "hero");
    expect(hero).toBeDefined();
    expect(hero!.props.features).toEqual([]);
  });
});

describe("the sections that adapt are the ones left to adapt", () => {
  it("category-nav derives from the store's own collections", () => {
    // CategoryNav.astro: `configured.length ? configured : catalog.collections.slice(0, 6)`.
    // A non-empty `items` here would pin every store to one shop's categories, which is the bug.
    const nav = PLATFORM_DEFAULT_HOMEPAGE.content.find((s) => s.type === "category-nav");
    expect(nav).toBeDefined();
    expect(nav!.props.items).toEqual([]);
  });

  it("keeps the nine-section skeleton, because the shape IS the feature", () => {
    // Merchants asked for a page that already looks like a page. Trimming this to a hero and a grid
    // would hand back the blank canvas the prefill exists to replace.
    expect(PLATFORM_DEFAULT_HOMEPAGE.content).toHaveLength(9);
    expect(PLATFORM_DEFAULT_HOMEPAGE.content.map((s) => s.type)).toEqual([
      "hero",
      "category-nav",
      "collection-bento",
      "image-text",
      "rich-text",
      "product-grid",
      "product-grid",
      "lookbook",
      "blog",
    ]);
  });

  it("every section carries an id, or the builder cannot address it", () => {
    for (const [type, t] of Object.entries(PLATFORM_DEFAULT_TEMPLATES))
      for (const s of t.sections.content)
        expect(typeof s.props.id, `${type}/${s.type}`).toBe("string");
  });
});
