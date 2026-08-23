/**
 * THE PLATFORM DEFAULT THEME — authored here, never copied from a live shop.
 *
 * 🔴 WHAT THIS REPLACES, AND WHY IT WAS A REAL DEFECT. `seed-platform-theme.ts` used to COPY the
 * demo store's `is_default` rows into the holder. The mechanism around it is correct — a per-slot
 * fallback (`apps/storefront/src/data/theme-source.ts`) plus a read-only prefill of the `/tema`
 * canvas (`apps/admin/lib/data/theme.ts`) — but the CONTENT it carried was one shop's marketing.
 * Measured on production 2026-08-23, with the fallback switched on: **eleven live stores were
 * publishing the batik store's homepage as their own.** `she-store`, which has ZERO products,
 * rendered a batik photo, the headline *"Batik Modern untuk Hari-Harimu"*, the subheading *"Siluet
 * bersih, motif tulis…"* and a button reading *"Lihat Koleksi Dress"* pointing at
 * `/kategori/dress` — a collection it does not have.
 *
 * So the default is WRITTEN, and the rules it has to keep are:
 *
 * ① **NOTHING NAMES A PRODUCT, A CATEGORY OR A NICHE.** Every word here is read by a shop selling
 *    something nobody has thought of yet. Placeholders say *what to write*, in the same voice the
 *    Store Builder already uses ("Judul utama toko kamu").
 * ② **EVERY LINK IS A ROUTE EVERY STORE HAS** — `/produk` only. `/kategori/<handle>` is a 404 on
 *    any shop without that exact handle, and it is what the batik copy shipped to eleven of them.
 * ③ **NO IMAGES.** Every image in this repo's `public/` is the batik demo's. Hero, ImageText and
 *    Lookbook each render a brand-tinted panel when `imageUrl` is empty — their own comments say so
 *    ("text on a near-white panel", "never a broken frame"). An empty panel that asks to be filled
 *    beats a stranger's photograph presented as the merchant's.
 * ④ **THE SECTIONS THAT READ THE STORE'S OWN DATA DO THE ADAPTING.** `category-nav` with an empty
 *    `items` derives from `catalog.collections`; `collection-bento`, both `product-grid`s and `blog`
 *    are already store-scoped. That is what makes one holder row fit every shop — not a template
 *    language, which this file deliberately does not invent.
 * ⑤ 🔴 **`features` STAYS EMPTY.** `@tokophi/sections` says why, in as many words: *"OPTIONAL and
 *    empty by default: a store that has not set any gets no strip — never an over-promise like
 *    'Gratis Ongkir' a store does not actually offer."* The batik theme shipped four badges and only
 *    ONE of them is true for every store ("checkout tanpa perlu daftar akun" — guest checkout is the
 *    product's design). "Kirim ke Seluruh Indonesia" depends on the merchant's courier selection,
 *    "Transfer, Virtual Account, & QRIS" on the platform channels enabled, and "Bantuan via WhatsApp"
 *    on a number the store may never have set. A default must not promise on a merchant's behalf.
 *
 * The SHAPE is kept deliberately generous — nine sections, the same skeleton the demo uses — because
 * that is the thing merchants were asking for: a page that already looks like a page, so the job is
 * "change the words and drop a photo in", not "assemble a homepage from an empty canvas". Sections a
 * shop does not want are one click to delete in `/tema`.
 */

/** Puck's stored shape. Only `content` is persisted here — mirror what the column already holds. */
type Sections = { content: { type: string; props: Record<string, unknown> }[] };

/** Every CTA in this file. A store that exists has this route; a category handle is a guess. */
const ALL_PRODUCTS = "/produk";

export const PLATFORM_DEFAULT_HOMEPAGE: Sections = {
  content: [
    {
      type: "hero",
      props: {
        id: "hero",
        align: "left",
        badge: "",
        ratingText: "",
        // New heroes write ONLY `slides` — the top-level heading/imageUrl/cta pair are deprecated
        // legacy fields kept so pre-carousel templates still render (`@tokophi/sections` registry).
        slides: [
          {
            focal: "right",
            imageUrl: "",
            heading: "Judul utama toko kamu",
            subheading:
              "Tulis satu kalimat tentang apa yang kamu jual dan kenapa orang sebaiknya belanja di sini.",
            // ⚠️ NOT "Lihat Semua" — `Hero.astro` already renders a SECOND, hard-coded button with
            // exactly that label ("the universal browse-everything page every store has"), and the
            // first draft put the two side by side reading "LIHAT SEMUA PRODUK" and "LIHAT SEMUA".
            // Both buttons live inside `{slide.ctaLabel && …}`, so emptying this removes the pair —
            // the fix is a distinct label, not a missing one.
            ctaLabel: "Belanja Sekarang",
            ctaHref: ALL_PRODUCTS,
          },
        ],
        // ⑤ Empty on purpose. See the header — a badge strip is a promise, and the platform cannot
        // make one on a merchant's behalf.
        features: [],
      },
    },
    // ④ Empty `items` = derived from THIS store's own collections (CategoryNav.astro falls back to
    // `catalog.collections.slice(0, 6)`). The batik default hard-coded five of its own categories,
    // each with one of its own product photos.
    { type: "category-nav", props: { id: "kategori", items: [] } },
    { type: "collection-bento", props: { id: "koleksi", heading: "Belanja per Koleksi" } },
    {
      type: "image-text",
      props: {
        id: "tentang",
        eyebrow: "Tentang Toko",
        heading: "Ceritakan tokomu di sini",
        body:
          "Dua atau tiga kalimat tentang siapa kamu, apa yang kamu jual, dan kenapa pembeli bisa " +
          "percaya. Ganti teks dan gambar ini lewat menu Tema.",
        imageUrl: "",
        imageSide: "left",
        ctaLabel: "Lihat Semua Produk",
        ctaHref: ALL_PRODUCTS,
      },
    },
    {
      type: "rich-text",
      props: {
        id: "sambutan",
        theme: "terang",
        eyebrow: "Sekilas",
        heading: "Satu kalimat yang menggambarkan tokomu.",
        body: "",
        ctaLabel: "",
        ctaHref: "",
      },
    },
    {
      type: "product-grid",
      props: { id: "terlaris", heading: "Paling Dicari", mode: "terlaris", limit: 4, columns: 4, collectionHandle: "" },
    },
    {
      type: "product-grid",
      props: { id: "terbaru", heading: "Produk Terbaru", mode: "terbaru", limit: 8, columns: 4, collectionHandle: "" },
    },
    {
      type: "lookbook",
      props: {
        id: "galeri",
        heading: "Galeri",
        description: "Tambahkan satu foto yang mewakili tokomu.",
        imageUrl: "",
      },
    },
    { type: "blog", props: { id: "jurnal", heading: "Dari Jurnal", limit: 3, ctaLabel: "Lihat semua tulisan" } },
  ],
};

/**
 * The category and product defaults were ALREADY neutral in the holder — measured 2026-08-23, they
 * carry no store-specific content at all — so they are reproduced here unchanged rather than
 * redesigned. Both render entirely from the store's own catalogue.
 */
export const PLATFORM_DEFAULT_CATEGORY: Sections = {
  content: [{ type: "product-listing", props: { id: "daftar-produk", heading: "" } }],
};

export const PLATFORM_DEFAULT_PRODUCT: Sections = {
  content: [
    {
      type: "product-grid",
      props: {
        id: "produk-serupa",
        heading: "Kamu Mungkin Suka",
        mode: "terlaris",
        limit: 4,
        columns: 4,
        collectionHandle: "",
      },
    },
  ],
};

/** Keyed by `page_templates.type`, with the name the row is stored under. */
export const PLATFORM_DEFAULT_TEMPLATES = {
  homepage: { name: "Beranda", sections: PLATFORM_DEFAULT_HOMEPAGE },
  category: { name: "Halaman Kategori", sections: PLATFORM_DEFAULT_CATEGORY },
  product: { name: "Halaman Produk", sections: PLATFORM_DEFAULT_PRODUCT },
} as const;
