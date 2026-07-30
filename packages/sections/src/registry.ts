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
  /**
   * Optional PORTRAIT image for phones (≤640px). A landscape hero cropped into a tall phone viewport
   * loses most of the frame no matter the `focal`, so a merchant can supply a mobile-shaped shot. Empty
   * = the desktop `imageUrl` is used everywhere (with `focal`), i.e. today's behaviour. Served via
   * `<picture>` art direction, so mobile never downloads the heavy desktop file.
   */
  mobileImageUrl?: string;
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

/**
 * One trust badge in the strip along the bottom of the hero (Fast Shipping / Secure Payment / …).
 * OPTIONAL as a group: a hero with no `features` renders no strip. `icon` is a KEY into a fixed
 * allow-list the renderer owns (see `HERO_FEATURE_ICONS` in Hero.astro), never a component or a URL —
 * a merchant picks from known icons, they do not inject markup. An unknown key falls back to a dot.
 */
export interface HeroFeature {
  icon: string;
  title: string;
  text: string;
}

export interface HeroConfig {
  /**
   * The carousel's slides. OPTIONAL on purpose: hero sections saved before the carousel existed
   * only have the flat `heading`/`subheading`/`imageUrl`/`ctaLabel`/`ctaHref` fields below, so
   * both renderers go through `heroSlides()` which falls back to those. Never read `slides`
   * directly — call `heroSlides(config)`.
   */
  slides?: HeroSlide[];
  /**
   * Trust badges shown as a strip across the bottom of the hero. OPTIONAL and empty by default: a
   * store that has not set any gets no strip — never an over-promise like "Gratis Ongkir" a store
   * does not actually offer (the same honesty rule the footer and WhatsApp button follow).
   */
  features?: HeroFeature[];
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
  // `Array.isArray`, not `?? []`: this reads stored JSON, and a non-array `slides` (a hand-edited
  // row, a bad import, an older shape) would make `.filter` throw and take the whole page with it.
  const slides = (Array.isArray(config.slides) ? config.slides : []).filter((s) => s && (s.heading || s.imageUrl));
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
  /**
   * Product image aspect ratio. Optional — templates saved before this existed (and the fallback
   * card everywhere else) default to `3:4`, the right shape for clothing. `1:1` suits accessories/
   * homeware; `4:5` is a slightly taller portrait.
   */
  imageRatio?: "1:1" | "3:4" | "4:5";
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
  /** Optional CTA button under the copy, e.g. "Belanja Koleksi". Empty label = no button. */
  ctaLabel?: string;
  /** Where the CTA points (a path or URL). Only used when `ctaLabel` is set. */
  ctaHref?: string;
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
  /** Optional small kicker above the statement, e.g. "Cerita Kami". Empty = hidden. */
  eyebrow?: string;
}

export interface CategoryNavItem {
  label: string;
  imageUrl: string;
  href: string;
}

export interface CategoryNavConfig {
  items: CategoryNavItem[];
}

/**
 * Collection bento — a mosaic of the store's collections. Unlike CategoryNav's free-text `items`
 * (which 404 on any store but the demo), this reads the store's LIVE `collections` at render time,
 * so it is dynamic and never points at a category a store does not have. The only config is the
 * heading; there is nothing here for a merchant to mis-type into a broken link.
 */
export interface CollectionBentoConfig {
  heading: string;
}

/** Lookbook — a centred heading + optional description over one wide, full-bleed banner image. */
export interface LookbookConfig {
  heading: string;
  /** Optional line under the heading. Empty = hidden. */
  description: string;
  /** Public path or absolute URL of the banner image. Empty = brand-tinted panel, never a broken frame. */
  imageUrl: string;
}

/**
 * Jurnal — the merchant's newest PUBLISHED articles, read live from the DB.
 *
 * Config is deliberately three fields. Two things it does NOT have, on purpose:
 *
 * · **No `ctaHref`.** Every other section that links takes free text, and that is exactly how the
 *   defaults ended up pointing at `/kategori/dress` — a handle only the demo store owns, 404 on
 *   everyone else. This section has ONE destination, `/blog`, which exists for every store. A field
 *   whose only correct value is a constant is a field that can only be filled in wrong.
 * · **No article picker.** The section shows the newest N. Letting a merchant pin specific posts
 *   means a template that silently rots as they publish — the pinned handles keep pointing at last
 *   year's article, or at one they later unpublish.
 */
export interface BlogConfig {
  heading: string;
  /** How many of the newest published articles to show. */
  limit: 2 | 3 | 4;
  /** Text of the link to /blog. Empty = no link. */
  ctaLabel: string;
}

/**
 * Daftar Produk — the REAL listing: server-side sort, 12-per-page pagination, empty state.
 *
 * This exists because a `category` template used to REPLACE the whole category page, and the only
 * product section available was Grid Produk — a flat, unsortable, unpaginated slice capped at
 * `limit`. So the builder's own hint ("add a Grid Produk") steered merchants into silently
 * truncating their catalogue and losing sort + paging. Grid Produk is a *merchandising* row ("Paling
 * Dicari", 4 cards); this is the catalogue itself.
 *
 * Config is deliberately tiny. The products are NOT configurable: on a category template they are
 * that category's, resolved from the render context — a handle field here could only ever disagree
 * with the page the shopper is actually on.
 */
export interface ProductListingConfig {
  /** Optional heading above the listing. Empty = no heading (the CategoryHero above already names it). */
  heading: string;
}

/**
 * The ONE allow-list of icon keys a merchant may pick, shared by every section that shows icons.
 *
 * A KEY, never a component and never a URL: the merchant chooses from a known set, they do not
 * inject markup. Each renderer owns its own key→component map (Lucide in Astro, Lucide in React) —
 * this file must not import a UI library, since the storefront reads it without the editor.
 * An unknown key falls back to a dot; it never throws and never renders a broken glyph.
 */
export const SECTION_ICON_KEYS = [
  "truck",
  "shield",
  "returns",
  "support",
  "payment",
  "package",
  "chat",
] as const;
export type SectionIconKey = (typeof SECTION_ICON_KEYS)[number];

/** Indonesian labels for the icon picker — the builder is a Bahasa Indonesia surface. */
export const SECTION_ICON_LABELS: Record<SectionIconKey, string> = {
  truck: "Pengiriman",
  shield: "Keamanan / Garansi",
  returns: "Pengembalian",
  support: "Bantuan / CS",
  payment: "Pembayaran",
  package: "Paket / Kemasan",
  chat: "Chat / WhatsApp",
};

/** One column of the Multicolumn section: an icon, a short title, a line of copy. */
export interface MulticolumnItem {
  /** A key from `SECTION_ICON_KEYS`. Unknown = a neutral dot. */
  icon: string;
  title: string;
  text: string;
}

/**
 * Kolom Ikon — Shopify Dawn's "Multicolumn", the benefit/trust row every commerce storefront wants
 * ("Gratis ongkir", "Garansi tukar", "CS 24 jam").
 *
 * Deliberately NOT the hero's `features` strip: that one lives ON the hero photo and only exists on
 * a page that has a hero. This is a standalone block a merchant can put on a category page or a PDP
 * tail — the two places a shopper actually asks "can I trust this shop?".
 *
 * ⚠️ Empty by default. A trust badge is a PROMISE; seeding "Gratis Ongkir" would make every new
 * store advertise a service it may not offer — the same honesty rule the footer and the hero strip
 * already follow.
 */
export interface MulticolumnConfig {
  heading: string;
  /** Optional kicker above the heading. Empty = hidden. */
  eyebrow: string;
  columns: 2 | 3 | 4;
  items: MulticolumnItem[];
}

/** One question/answer pair. */
export interface FaqItem {
  question: string;
  answer: string;
}

/**
 * FAQ — Shopify Dawn's "Collapsible content".
 *
 * The highest-value section we did not have: on an Indonesian storefront the questions that decide
 * a sale ("berapa lama kirim ke luar Jawa?", "bisa tukar ukuran?", "COD bisa?") are exactly what a
 * merchant answers over WhatsApp fifty times a day. Put on the PDP tail it answers them before the
 * shopper has to ask.
 *
 * Rendered with native `<details>/<summary>` — no JS, keyboard- and screen-reader-accessible for
 * free, and it works before hydration. (Rung 4 of the code ladder: the platform already does this.)
 */
export interface FaqConfig {
  heading: string;
  /** Optional kicker above the heading. Empty = hidden. */
  eyebrow: string;
  items: FaqItem[];
}

export type SectionConfigMap = {
  hero: HeroConfig;
  "product-listing": ProductListingConfig;
  multicolumn: MulticolumnConfig;
  faq: FaqConfig;
  "product-grid": ProductGridConfig;
  "banner-promo": BannerPromoConfig;
  testimoni: TestimoniConfig;
  "image-text": ImageTextConfig;
  marquee: MarqueeConfig;
  "rich-text": RichTextConfig;
  "category-nav": CategoryNavConfig;
  "collection-bento": CollectionBentoConfig;
  lookbook: LookbookConfig;
  blog: BlogConfig;
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
  "product-listing",
  "image-text",
  "multicolumn",
  "product-grid",
  "category-nav",
  "collection-bento",
  "lookbook",
  "banner-promo",
  "marquee",
  "testimoni",
  "blog",
  "rich-text",
  "faq",
];

export const SECTION_LABELS: Record<SectionType, string> = {
  hero: "Hero",
  "product-listing": "Daftar Produk",
  "product-grid": "Grid Produk",
  multicolumn: "Kolom Ikon",
  faq: "FAQ",
  "banner-promo": "Banner Promo",
  testimoni: "Testimoni",
  "image-text": "Gambar + Teks",
  "collection-bento": "Bento Koleksi",
  lookbook: "Lookbook",
  marquee: "Teks Berjalan",
  "rich-text": "Teks & Pernyataan",
  "category-nav": "Navigasi Kategori",
  // "Jurnal", not "Blog": it is what the storefront already calls this everywhere the shopper can
  // see it (/blog's own H1 is "Jurnal"). The TYPE stays `blog` — that is the DB's word.
  blog: "Jurnal",
};

/** Seed config used when a merchant drags a fresh instance of this section onto the canvas. */
export const SECTION_DEFAULTS: SectionConfigMap = {
  // No heading by default: on a category page the CategoryHero directly above already carries the
  // collection's name as the <h1>, and a second title under it just repeats it.
  "product-listing": { heading: "" },
  // Both EMPTY by default. A trust badge and an FAQ answer are both PROMISES about this specific
  // shop — seeding "Gratis ongkir ke seluruh Indonesia" would make every new store advertise a
  // service it may not offer, which is precisely the class of default that put /kategori/dress on
  // every storefront. The merchant adds rows; the section renders nothing until they do.
  multicolumn: { heading: "Kenapa Belanja di Sini", eyebrow: "", columns: 3, items: [] },
  faq: { heading: "Pertanyaan yang Sering Ditanya", eyebrow: "", items: [] },
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
    imageRatio: "3:4",
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
  "collection-bento": {
    heading: "Belanja per Koleksi",
  },
  lookbook: {
    heading: "Lookbook",
    description: "",
    imageUrl: "",
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
  blog: {
    // Safe to ship as FINISHED copy, unlike every prompt above — and the reason is worth stating,
    // because the rule here is "defaults are prompts, never claims". These three strings assert
    // nothing about the merchant's goods, their prices, or their promises: they are a label for a
    // list the DB fills in, pointing at /blog, which every store has. There is nothing here for a
    // merchant to accidentally publish about themselves.
    heading: "Dari Jurnal",
    limit: 3,
    ctaLabel: "Lihat semua tulisan",
  },
};

// ── WHICH SECTIONS BELONG ON WHICH PAGE ────────────────────────────────────────────────────────
//
// `page_templates.type` has had three values since ADR 0009 — `homepage`, `category`, `product` —
// and the builder offered the SAME eleven sections to all three, because the palette was a single
// static config that never saw the type. That is how a merchant could drop a Hero (with its own
// `<h1>`) onto a product page that already has the product's name as the `<h1>`, or a Navigasi
// Kategori onto a PDP tail.
//
// The three pages are genuinely different jobs:
//
// · **homepage** — the whole page IS the template. Everything is on offer.
// · **category** — the template is the BODY under the category's own header. `CategoryHero` (the
//   `<h1>`, the breadcrumb, the cover) is rendered by the page and is NOT a section, so `hero` is
//   excluded: a second `<h1>` is exactly what the a11y audit flagged on the homepage carousel.
//   `product-listing` is the point of the page and belongs first.
// · **product** — the template is the PDP TAIL only (produk/[handle].astro renders it where the
//   hand-built "Rekomendasi" strip sat; gallery, buy box, reviews and description are untouched).
//   So: no `hero`, no `product-listing` (the shopper is looking at ONE product, not browsing), and
//   no `category-nav`/`collection-bento` — navigation furniture belongs above the fold, not under
//   a buy box.
//
// Ordered: the list drives the builder sidebar top-to-bottom, most-reached-for first.
export const SECTIONS_BY_TEMPLATE_TYPE: Record<"homepage" | "category" | "product", SectionType[]> = {
  homepage: SECTION_TYPES.filter((t) => t !== "product-listing"),
  category: ["product-listing", "product-grid", "banner-promo", "marquee", "rich-text", "image-text", "multicolumn", "faq", "testimoni", "blog"],
  // FAQ sits high on a PDP tail on purpose: "berapa lama kirim?" / "bisa tukar ukuran?" are the
  // questions that decide the sale, and they are asked right after the buy box.
  product: ["product-grid", "faq", "multicolumn", "image-text", "rich-text", "banner-promo", "testimoni", "marquee", "blog"],
};
