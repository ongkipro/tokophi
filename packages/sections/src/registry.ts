// ADR 0009 — Store Builder: the canonical section registry.
// Both the Puck admin editor (apps/admin) and the Astro storefront renderer (apps/storefront)
// key off `SectionType` and read the same `config` shape for a given section — this file is
// the single source of truth for that shape so the two sides can never drift.
//
// Adding a section = add its type + config here, then implement the matching pair:
// apps/admin/components/theme/sections/<Type>.tsx (Puck-editor render) +
// apps/storefront/src/components/sections/<Type>.astro (storefront render).

export interface HeroConfig {
  heading: string;
  subheading: string;
  imageUrl: string;
  ctaLabel: string;
  ctaHref: string;
  align: "left" | "center";
  /** Optional small pill above the heading, e.g. "Baru Kembali Tersedia". Empty = hidden. */
  badge: string;
  /** Optional social-proof line under the CTA, e.g. "4.9 ★ · Dipercaya 50rb+ pelanggan". Empty = hidden. */
  ratingText: string;
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
    heading: "Koleksi Terbaru 2026",
    subheading: "Tampil percaya diri dengan gaya yang bicara untukmu.",
    imageUrl: "", // empty = neutral gradient placeholder until a merchant picks an image
    ctaLabel: "Belanja Sekarang",
    ctaHref: "/kategori/semua",
    align: "left",
    badge: "",
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
