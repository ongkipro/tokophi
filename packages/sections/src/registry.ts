// ADR 0009 — Store Builder: the canonical section registry.
// Both the Puck admin editor (apps/admin) and the Astro storefront renderer (apps/storefront)
// key off `SectionType` and read the same `config` shape for a given section — this file is
// the single source of truth for that shape so the two sides can never drift.
//
// Adding a section = add its type + config here, then implement the matching pair:
// apps/admin/components/theme/sections/<Type>.tsx (Puck-editor render) +
// apps/storefront/src/components/sections/<Type>.astro (storefront render).

/**
 * One slide of the Hero carousel. A hero with a single slide renders as a static hero
 * (no dots, no autoplay) — the carousel chrome only appears from 2 slides up.
 */
export interface HeroSlide {
  /** Public path or absolute URL. Empty = brand-tinted gradient panel (never a broken image). */
  imageUrl: string;
  heading: string;
  subheading: string;
  ctaLabel: string;
  ctaHref: string;
  /**
   * Which part of the image to keep when it is cropped into the (portrait) hero panel —
   * i.e. `object-position`. Landscape shots usually have the subject off-centre; without this
   * a merchant's photo gets its subject cropped out. Optional, defaults to `center`.
   */
  focal?: "left" | "center" | "right";
}

export interface HeroConfig {
  /**
   * The carousel's slides. OPTIONAL on purpose: hero sections saved before the carousel existed
   * only have the flat `heading`/`subheading`/`imageUrl`/`ctaLabel`/`ctaHref` fields below, so
   * both renderers go through `heroSlides()` which falls back to those. Never read `slides`
   * directly — call `heroSlides(config)`.
   */
  slides?: HeroSlide[];
  /** Autoplay interval in ms. Optional; defaults to `HERO_INTERVAL_MS`. 0 = no autoplay. */
  intervalMs?: number;
  /**
   * @deprecated Legacy single-slide fields. Kept (and OPTIONAL) so hero sections saved before the
   * carousel still render — `heroSlides()` falls back to them. New heroes only write `slides`.
   */
  heading?: string;
  /** @deprecated see `heading` */
  subheading?: string;
  /** @deprecated see `heading` */
  imageUrl?: string;
  /** @deprecated see `heading` */
  ctaLabel?: string;
  /** @deprecated see `heading` */
  ctaHref?: string;
  align: "left" | "center";
  /** Optional small pill above the heading, e.g. "Baru Kembali Tersedia". Empty = hidden. */
  badge: string;
  /** Optional social-proof line under the CTA, e.g. "4.9 ★ · Dipercaya 50rb+ pelanggan". Empty = hidden. */
  ratingText: string;
}

/** Default autoplay cadence — long enough to read a heading + subheading. */
export const HERO_INTERVAL_MS = 6000;

/**
 * The slides a Hero should render: the `slides` array when the merchant has one, else a single
 * slide synthesised from the legacy flat fields. Shared by the Astro storefront renderer and the
 * Puck editor preview so the two can never disagree about what a saved hero means.
 */
export function heroSlides(config: HeroConfig): HeroSlide[] {
  const slides = (config.slides ?? []).filter((s) => s.heading || s.imageUrl);
  if (slides.length > 0) return slides;
  return [
    {
      imageUrl: config.imageUrl ?? "",
      heading: config.heading ?? "",
      subheading: config.subheading ?? "",
      ctaLabel: config.ctaLabel ?? "",
      ctaHref: config.ctaHref ?? "",
      focal: "center",
    },
  ];
}

export interface ProductGridConfig {
  heading: string;
  /** Which products fill the grid. Max 2 Grid Produk sections per page (enforced in the builder). */
  mode: "terlaris" | "terbaru" | "acak";
  /** Optional collection handle to scope `mode` to one category; empty = whole catalog. */
  collectionHandle: string;
  limit: number;
  columns: 2 | 3 | 4;
}

export interface BannerPromoConfig {
  heading: string;
  subheading: string;
  imageUrl: string;
  href: string;
  badge: string;
}

export interface TestimoniItem {
  name: string;
  quote: string;
  rating: 1 | 2 | 3 | 4 | 5;
}

export interface TestimoniConfig {
  heading: string;
  items: TestimoniItem[];
}

export interface ImageTextConfig {
  heading: string;
  body: string;
  imageUrl: string;
  imageSide: "left" | "right";
  /** Optional short label above the heading, e.g. "Kenapa Kami". Empty = hidden. */
  eyebrow: string;
}

export interface MarqueeConfig {
  text: string;
  speed: "lambat" | "sedang" | "cepat";
}

export interface RichTextConfig {
  heading: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  theme: "terang" | "gelap";
}

export interface CategoryNavItem {
  label: string;
  imageUrl: string;
  href: string;
}

export interface CategoryNavConfig {
  items: CategoryNavItem[];
}

export type SectionConfigMap = {
  hero: HeroConfig;
  "product-grid": ProductGridConfig;
  "banner-promo": BannerPromoConfig;
  testimoni: TestimoniConfig;
  "image-text": ImageTextConfig;
  marquee: MarqueeConfig;
  "rich-text": RichTextConfig;
  "category-nav": CategoryNavConfig;
};

export type SectionType = keyof SectionConfigMap;

// Shape of `page_templates.sections` as saved by the admin's Puck editor — a minimal subset
// of Puck's native `Data` type (content items carry `props`, which includes an injected `id`
// alongside the section's own config fields). Declared here (not imported from `@measured/puck`)
// so the storefront can read templates without depending on the editor library at all.
export type StoredSectionItem = {
  [K in SectionType]: { type: K; props: SectionConfigMap[K] & { id: string } };
}[SectionType];

export type StoredTemplateData = { content: StoredSectionItem[] };

export type SectionInstance = {
  [K in SectionType]: { id: string; type: K; config: SectionConfigMap[K] };
}[SectionType];

/** Ordered list of section types offered in the builder sidebar. */
export const SECTION_TYPES: SectionType[] = [
  "hero",
  "image-text",
  "product-grid",
  "category-nav",
  "banner-promo",
  "marquee",
  "testimoni",
  "rich-text",
];

export const SECTION_LABELS: Record<SectionType, string> = {
  hero: "Hero",
  "product-grid": "Grid Produk",
  "banner-promo": "Banner Promo",
  testimoni: "Testimoni",
  "image-text": "Gambar + Teks",
  marquee: "Teks Berjalan",
  "rich-text": "Teks & Pernyataan",
  "category-nav": "Navigasi Kategori",
};

/** Seed config used when a merchant drags a fresh instance of this section onto the canvas. */
export const SECTION_DEFAULTS: SectionConfigMap = {
  hero: {
    // The LAST default still shipping the demo store's finished homepage — every sibling below was
    // already turned into a prompt for exactly this reason. It carried three batik slides, the
    // headline "Batik Modern untuk Hari-Harimu", a "Koleksi 2026" badge, and a "Lihat Koleksi Dress"
    // button pointing at /kategori/dress: 200 on batik-nusantara, **404 on every other store**
    // (verified live against kopi-senja). Same for /kategori/busana-muslim.
    //
    // It did double duty, which is what hid the problem: it was ALSO the fallback homepage's hero,
    // so every storefront on the platform rendered a batik womenswear shop under its own name. That
    // half is fixed in index.astro (the fallback now builds its hero from the store's own name +
    // tagline). This is now ONLY what a merchant sees after dragging a Hero onto the canvas — and a
    // default there is a PROMPT they replace, never finished copy about someone else's goods.
    //
    // One slide, not three: a merchant adds slides when they have photos. Three identical prompts
    // would just be three things to delete.
    slides: [
      {
        imageUrl: "", // empty → the brand-tinted panel (Hero.astro), never a broken image
        heading: "Judul utama toko kamu",
        subheading:
          "Satu kalimat tentang apa yang kamu jual dan untuk siapa. Ganti teks ini sebelum menerbitkan.",
        ctaLabel: "Mulai Belanja",
        // A VIRTUAL collection (kategori/[handle].astro) that every store always has — verified 200
        // on both the demo and a store with a completely different catalogue.
        ctaHref: "/kategori/semua",
        focal: "center",
      },
    ],
    intervalMs: HERO_INTERVAL_MS,
    // Legacy flat fields mirror slide 1 — they are what a pre-carousel renderer would show.
    heading: "Judul utama toko kamu",
    subheading:
      "Satu kalimat tentang apa yang kamu jual dan untuk siapa. Ganti teks ini sebelum menerbitkan.",
    imageUrl: "",
    ctaLabel: "Mulai Belanja",
    ctaHref: "/kategori/semua",
    align: "left",
    badge: "", // no invented "Koleksi 2026" — we do not know that they have one
    ratingText: "",
  },
  "product-grid": {
    // "Terlaris Minggu Ini" was a claim about a TIME WINDOW we do not compute. The heading says only
    // what the section does. Do not put a period ("minggu ini", "hari ini", "bulan ini") back in
    // unless the data layer starts windowing the query.
    //
    // ⚠️ This note used to add that `mode: "terlaris"` "sorts the whole catalog by all-time
    // units_sold". That was FALSE for as long as it was written: `catalog.bestsellers()` filtered a
    // `bestseller` BOOLEAN, and the demo's flags contradicted its own sales column (hijab-voal flagged
    // at 321 sold; celana-kulot unflagged at 869). Fixed 2026-07-16 — it now really does sort by
    // units_sold, so `limit` means "the top N" and the sentence is finally true. Keep it that way.
    heading: "Produk Terlaris",
    mode: "terlaris",
    collectionHandle: "",
    limit: 8,
    columns: 4,
  },
  "banner-promo": {
    // NOT a promo. The old default shipped "Promo Gajian · Diskon hingga 30% untuk semua kategori"
    // + a "Terbatas" scarcity badge + a link to a category only the demo store owns — three claims
    // (a discount rate, a scarcity, a destination) that are bound to NOTHING: no `discounts` row,
    // no deadline, no collection. A merchant who drags this section and publishes has advertised a
    // 30% sale they never created. Defaults are PROMPTS; the merchant supplies the real offer.
    heading: "Judul promo kamu",
    subheading: "Tulis penawaran yang benar-benar kamu jalankan, lalu tautkan ke kategori terkait.",
    imageUrl: "",
    href: "/",
    badge: "",
  },
  testimoni: {
    // EMPTY ON PURPOSE — a testimonial is an advertising claim, and one we cannot source.
    // This used to ship two invented customers ("Sari", "Dewi") with invented 5★ quotes about
    // fabric, stitching and delivery speed. Dragging the section published two fake reviews from
    // two people who do not exist, for a store whose products the platform has never seen. Same
    // class of problem as the fake product ratings removed from the storefront. Never seed people.
    // The merchant adds their own quotes via the Puck array field (Judul + Nama/Kutipan/Rating).
    heading: "Kata Pelanggan",
    items: [],
  },
  "image-text": {
    // Was a finished brand story for a batik womenswear label ("Dibuat dengan Bahan Pilihan …
    // setiap helai kami rancang untuk perempuan Indonesia"). Read as real copy, it is a product-
    // quality claim about goods the platform has never seen, in a niche most stores are not in —
    // exactly the kind of plausible text a merchant publishes without reading. Prompt copy instead.
    eyebrow: "Kenapa Kami",
    heading: "Judul cerita toko kamu",
    body: "Ceritakan apa yang membuat produk kamu berbeda — bahan, proses, atau orang di baliknya. Ganti teks ini sebelum menerbitkan.",
    imageUrl: "",
    imageSide: "left",
  },
  marquee: {
    // The old default — "Gratis Ongkir Se-Indonesia · Kualitas Premium · COD Tersedia" — was three
    // claims, two of which the platform CANNOT honour:
    //   • "Gratis Ongkir": there is NO free-shipping mechanism anywhere in the product. Checkout
    //     always charges a real courier rate; `keranjang.astro` deliberately refuses to render a
    //     free-shipping progress bar because no threshold exists in our data. The `gratis_ongkir`
    //     discount kind carries no minimum and is not wired to the rate quote.
    //   • "COD Tersedia": COD is OPT-IN and defaults to OFF (`store_settings.cod_enabled`,
    //     migration 0038) — false for every store until the merchant enables it in Pengiriman.
    // A marquee runs on every page: it is the single loudest place to publish a promise you then
    // break at checkout. The default is now a PROMPT. If you want a shipping/COD line back here,
    // it has to be DERIVED from the store's real settings, not typed into a constant.
    text: "Tulis pengumuman toko kamu di sini · Ganti teks ini di Store Builder",
    speed: "sedang",
  },
  "rich-text": {
    // ⚠️ CORRECTION (2026-07-16). This note used to claim `/kategori/semua` is "a collection NO store
    // has … so the default CTA 404'd on every storefront including the demo", and the href was moved
    // to "/" on that basis. It is NOT true: `semua` is a VIRTUAL collection handled by
    // kategori/[handle].astro and returns **200 on every store** — measured against both the demo and
    // a store with an unrelated catalogue. (What genuinely 404s is a REAL handle only the demo owns,
    // like `/kategori/dress`.) "/" is left as the default because home is a fine place for a brand
    // CTA to point, not because the other link is broken — do not "re-fix" this. Copy here is brand
    // voice, not a factual claim, so it stays as prompt-ish placeholder.
    heading: "Judul ajakan kamu",
    body: "Ceritakan singkat kenapa pelanggan harus belanja di toko kamu.",
    ctaLabel: "Mulai Belanja",
    ctaHref: "/",
    theme: "terang",
  },
  "category-nav": {
    // ⚠️ NOT a claim, but still wrong for anyone but the demo store: these three handles are the
    // demo catalog's (Dress/Atasan/Bawahan) and 404 on a store that does not have them. The real
    // fix is a builder-side field that picks from the store's OWN `collections` (an "external"/
    // select Puck field) instead of a free-text href — see the report/BACKLOG. Left as-is for now
    // because an empty array renders an empty husk (the array field is the only way to add items).
    items: [
      { label: "Dress", imageUrl: "", href: "/kategori/dress" },
      { label: "Atasan", imageUrl: "", href: "/kategori/atasan" },
      { label: "Bawahan", imageUrl: "", href: "/kategori/bawahan" },
    ],
  },
};
