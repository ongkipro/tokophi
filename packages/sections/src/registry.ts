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
    slides: [
      {
        imageUrl: "/hero/hero-1.webp", // empty = brand-tinted gradient panel, never a broken image
        heading: "Batik Modern untuk Hari-Harimu",
        subheading:
          "Siluet bersih, motif tulis, dan bahan yang tetap adem dipakai dari pagi sampai petang.",
        ctaLabel: "Lihat Koleksi Dress",
        ctaHref: "/kategori/dress",
        focal: "right",
      },
      {
        imageUrl: "/hero/hero-2.webp",
        heading: "Bahan Pilihan, Jahitan Rapi",
        subheading:
          "Katun, linen, dan tenun yang kami pilih sendiri — nyaman dipakai, awet dicuci berkali-kali.",
        ctaLabel: "Lihat Produk Terlaris",
        ctaHref: "/kategori/produk-terlaris",
        focal: "left",
      },
      {
        imageUrl: "/hero/hero-3.webp",
        heading: "Anggun di Setiap Momen",
        subheading:
          "Padu padan outerwear dan busana muslim untuk kerja, acara keluarga, sampai undangan.",
        ctaLabel: "Lihat Busana Muslim",
        ctaHref: "/kategori/busana-muslim",
        focal: "right",
      },
    ],
    intervalMs: HERO_INTERVAL_MS,
    // Legacy flat fields mirror slide 1 — they are what a pre-carousel renderer would show.
    heading: "Batik Modern untuk Hari-Harimu",
    subheading:
      "Siluet bersih, motif tulis, dan bahan yang tetap adem dipakai dari pagi sampai petang.",
    imageUrl: "/hero/hero-1.webp",
    ctaLabel: "Lihat Koleksi Dress",
    ctaHref: "/kategori/dress",
    align: "left",
    badge: "Koleksi 2026",
    ratingText: "",
  },
  "product-grid": {
    heading: "Terlaris Minggu Ini",
    mode: "terlaris",
    collectionHandle: "",
    limit: 8,
    columns: 4,
  },
  "banner-promo": {
    heading: "Promo Gajian",
    subheading: "Diskon hingga 30% untuk semua kategori.",
    imageUrl: "",
    href: "/kategori/promo-gajian",
    badge: "Terbatas",
  },
  testimoni: {
    heading: "Kata Mereka",
    items: [
      { name: "Sari", quote: "Bahannya adem, jahitan rapi. Repeat order terus!", rating: 5 },
      { name: "Dewi", quote: "Pengiriman cepat, sesuai foto.", rating: 5 },
    ],
  },
  "image-text": {
    eyebrow: "Kenapa Kami",
    heading: "Dibuat dengan Bahan Pilihan",
    body: "Setiap helai kami rancang untuk perempuan Indonesia — memadukan warisan budaya dengan siluet masa kini, agar kamu tampil anggun tanpa kehilangan kenyamanan.",
    imageUrl: "",
    imageSide: "left",
  },
  marquee: {
    text: "Gratis Ongkir Se-Indonesia · Kualitas Premium · COD Tersedia",
    speed: "sedang",
  },
  "rich-text": {
    heading: "Siap tampil anggun setiap hari?",
    body: "Jelajahi koleksi kami dan temukan busana yang membuatmu percaya diri.",
    ctaLabel: "Mulai Belanja",
    ctaHref: "/kategori/semua",
    theme: "terang",
  },
  "category-nav": {
    items: [
      { label: "Dress", imageUrl: "", href: "/kategori/dress" },
      { label: "Atasan", imageUrl: "", href: "/kategori/atasan" },
      { label: "Bawahan", imageUrl: "", href: "/kategori/bawahan" },
    ],
  },
};
