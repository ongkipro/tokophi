// Seed the DEMO STORE's homepage template (ADR 0009 — Store Builder).
//
// WHY THIS FILE EXISTS. The batik hero, the batik brand story and the fashion CTA used to live in
// `apps/storefront/src/pages/index.astro` and `SECTION_DEFAULTS.hero` — i.e. in the PLATFORM. So every
// storefront rendered them: `gadget-murah-id` (electronics, Jakarta) served a photo of a woman in
// batik and a brand story signed with its own name. That was fixed by making the platform's fallback
// neutral, which left the demo plain — because the content had nowhere to live.
//
// This is where it belongs. `page_templates` is SELLER data, per store: what Batik Nusantara built in
// Dashboard Seller → Tema. The platform owns the sections; the merchant owns the arrangement and every
// word in it. Seeding it here also means the demo finally EXERCISES the Store Builder path instead of
// bypassing it — there were zero rows in this table, so the storefront's template renderer had never
// run against real data.
//
// Standalone (not part of the big `seed.ts`).
//
// ⚠️ THIS HEADER USED TO SAY it "inserts only when the store has no homepage template, so it is safe
// against a live DB and never clobbers what a merchant has since edited". That stopped being true at
// `1c738d4` and the sentence stayed — a comment promising the exact safety the code had just given
// up. **It UPSERTS: an existing homepage is REPLACED** (the log says `REPLACED`, which is the only
// reason it was caught). Safe here ONLY because the file is hardcoded to `batik-nusantara`. Read the
// full reasoning — and the cost — at the upsert itself in main(). If you ever point this at a real
// store, restore the guard first.
//   npm run seed:templates -w @tokophi/db
import { db, client, schema } from "./client";
import { and, eq } from "drizzle-orm";
import type { StoredTemplateData } from "@tokophi/sections";

const DEMO_SLUG = "batik-nusantara";

// Typed against the real contract on purpose. `sections` is jsonb — the DB validates nothing — and the
// two ways a hand-written template fails are both silent-ish: a typo'd `type` renders NOTHING
// (SectionRenderer's switch has no default case), and a typo'd `mode` throws
// `undefined is not a function` and 500s the whole storefront (ProductGrid does `MODE_FN[mode](pool)`
// with no guard). `StoredTemplateData` turns both into compile errors.
//
// ⚠️ EVERY item needs a UNIQUE `props.id`. Puck's `walkAppState` keys its node index off
// `mappedItem.props.id` with no fallback and never generates one on load — items without ids all
// collapse into the same bucket. The storefront renders fine either way (it only spreads props), so
// this fails ONLY in the builder: selection and drag break, last item wins. It would look like the
// seed worked.
const HOMEPAGE: StoredTemplateData = {
  content: [
    {
      type: "hero",
      props: {
        id: "hero-batik",
        // The three slides that used to be SECTION_DEFAULTS.hero. Every href is a collection this
        // store really has (verified): dress, produk-terlaris (virtual), busana-muslim. That was the
        // whole problem with them living in the platform default — `/kategori/dress` is a 404 on
        // every store but this one.
        slides: [
          {
            imageUrl: "/hero/hero-1.webp",
            heading: "Batik Modern untuk Hari-Harimu",
            subheading: "Siluet bersih, motif tulis, dan bahan yang tetap adem dipakai dari pagi sampai petang.",
            ctaLabel: "Lihat Koleksi Dress",
            ctaHref: "/kategori/dress",
            focal: "right",
          },
          {
            imageUrl: "/hero/hero-2.webp",
            heading: "Bahan Pilihan, Jahitan Rapi",
            subheading: "Katun, linen, dan tenun yang kami pilih sendiri — nyaman dipakai, awet dicuci berkali-kali.",
            ctaLabel: "Lihat Produk Terlaris",
            ctaHref: "/kategori/produk-terlaris",
            focal: "left",
          },
          {
            imageUrl: "/hero/hero-3.webp",
            heading: "Anggun di Setiap Momen",
            subheading: "Padu padan outerwear dan busana muslim untuk kerja, acara keluarga, sampai undangan.",
            ctaLabel: "Lihat Busana Muslim",
            ctaHref: "/kategori/busana-muslim",
            focal: "right",
          },
        ],
        intervalMs: 6000,
        // Legacy flat fields mirror slide 1 — what a pre-carousel renderer would show.
        heading: "Batik Modern untuk Hari-Harimu",
        subheading: "Siluet bersih, motif tulis, dan bahan yang tetap adem dipakai dari pagi sampai petang.",
        imageUrl: "/hero/hero-1.webp",
        ctaLabel: "Lihat Koleksi Dress",
        ctaHref: "/kategori/dress",
        align: "left",
        badge: "Koleksi 2026",
        ratingText: "",
        // Trust strip along the bottom of the hero. True platform-level promises (nationwide shipping,
        // verified payment, guest checkout, WhatsApp help) — never an over-promise a store can't keep.
        // Lives in the seed so it survives the every-deploy homepage UPSERT (a DB-only edit is wiped).
        features: [
          { icon: "truck", title: "Kirim ke Seluruh Indonesia", text: "Lewat kurir pilihanmu, diproses cepat" },
          { icon: "shield", title: "Pembayaran Aman", text: "Transfer, Virtual Account, & QRIS" },
          { icon: "returns", title: "Belanja Tanpa Ribet", text: "Checkout cepat tanpa perlu daftar akun" },
          { icon: "chat", title: "Bantuan via WhatsApp", text: "Tim kami siap bantu pesananmu" },
        ],
      },
    },
    {
      type: "category-nav",
      props: {
        id: "kategori-batik",
        // Each thumbnail is the first ACTIVE product in that collection — a draft product's photo has
        // no business fronting a category a shopper can click into.
        //
        // ⚠️ FIVE, not six: `outerwear` is `published = false` in this store's own `collections` row,
        // so `/kategori/outerwear` is a 404. This template shipped it anyway on the first pass —
        // I filtered the PRODUCTS by status and forgot to filter the COLLECTIONS by `published`,
        // which is the same mistake `CATEGORY_ORDER` was making one layer down (it named the handle
        // and ignored the column, so the demo published a category its merchant had switched off).
        // If the merchant publishes Outerwear, they add the tile in the builder — the platform must
        // not decide that for them.
        items: [
          { label: "Dress", imageUrl: "/products/dress-midi-bunga.webp", href: "/kategori/dress" },
          { label: "Atasan", imageUrl: "/products/kemeja-oversized.webp", href: "/kategori/atasan" },
          { label: "Bawahan", imageUrl: "/products/rok-plisket.webp", href: "/kategori/bawahan" },
          { label: "Busana Muslim", imageUrl: "/products/hijab-voal.webp", href: "/kategori/busana-muslim" },
          { label: "Loungewear", imageUrl: "/products/piyama-satin.webp", href: "/kategori/loungewear" },
        ],
      },
    },
    {
      // "Belanja per Koleksi" — a mosaic of the store's live collections (two rows, random six when
      // there are more). Config is just the heading; the storefront fills the tiles from the catalogue.
      type: "collection-bento",
      props: {
        id: "bento-koleksi",
        heading: "Belanja per Koleksi",
      },
    },
    {
      // Image + text brand beat (owner reference #11) — a committed banner in public/sections, copy in
      // the store's voice, a CTA to /kategori/semua (a page every store has, never a guessed handle).
      type: "image-text",
      props: {
        id: "standar-kami",
        eyebrow: "Standar Kami",
        heading: "Gaya yang Menemani Setiap Langkah",
        body: "Kami tidak sekadar membuat pakaian — kami merancang lemari pakaian di sekitar bahan yang paling ikonik.\n\nDari potongan klasik hingga siluet modern, setiap helai dibuat untuk kenyamanan, ketahanan, dan gaya yang tak lekang waktu.",
        imageUrl: "/sections/denim-standard.webp",
        imageSide: "left",
        ctaLabel: "Belanja Koleksi",
        ctaHref: "/kategori/semua",
      },
    },
    {
      type: "rich-text",
      props: {
        id: "cerita-batik",
        // Clean centred STATEMENT (owner reference #13): the eyebrow labels it, the story IS the big
        // line. No button — it is a statement, not a call to action.
        eyebrow: "Cerita Kami",
        // THE POINT OF THIS FILE. This paragraph was hard-coded into the platform's fallback homepage
        // and rendered, in quote marks, under every store's own name — a first-person claim about
        // batik and Indonesian women, signed "Gadget Murah ID — Jakarta". Here it is what it always
        // should have been: one merchant's words, on one merchant's template, about their own goods.
        heading:
          "Setiap helai kami rancang untuk perempuan Indonesia — memadukan warisan batik dengan siluet masa kini, agar kamu tampil anggun tanpa kehilangan kenyamanan.",
        body: "",
        ctaLabel: "", // empty → RichText renders no link
        ctaHref: "",
        theme: "terang",
      },
    },
    {
      type: "product-grid",
      props: {
        id: "terlaris-batik",
        heading: "Paling Dicari",
        // 4 × 1 — the /tema formula. `terlaris` now SORTS the catalogue by units_sold (it used to
        // filter a `bestseller` flag that contradicted the data: the demo flags hijab-voal at 321
        // sold and not celana-kulot at 869), so `limit: 4` means the real top four and the row is
        // always full. It was `limit: 8, columns: 3` — three flagged products at 400px each, cards
        // so large a folded hijab filled a 400×530 frame.
        mode: "terlaris",
        collectionHandle: "",
        limit: 4,
        columns: 4,
      },
    },
    {
      type: "product-grid",
      props: {
        id: "terbaru-batik",
        // 4 × 2 — the second grid the /tema formula calls for, and what actually fills a 1280 shell.
        // "Terbaru" is honest by construction: `recentProducts` sorts by createdAt. The registry caps
        // a page at 2 Grid Produk sections; this is the second.
        heading: "Produk Terbaru",
        mode: "terbaru",
        collectionHandle: "",
        limit: 8,
        columns: 4,
      },
    },
    {
      // Lookbook (owner reference #12) — a centred heading over one wide committed banner image.
      // Image-forward and simple; the image lives in apps/storefront/public/sections.
      type: "lookbook",
      props: {
        id: "lookbook-batik",
        heading: "Lookbook",
        description: "Inspirasi padu padan dari koleksi terbaru kami.",
        imageUrl: "/sections/lookbook.webp",
      },
    },
    {
      // ── Jurnal, near the bottom but ABOVE the closing CTA ────────────────────────────────────
      // "Bagian bawah" was the ask, and this is it — but not the LAST thing. The rich-text below is
      // the page's closing call to action; ending the homepage on a row of articles would send the
      // shopper off to read instead of to buy, and leave the CTA stranded mid-page where nothing
      // concludes. Journal, then the ask. (Dawn puts its blog above the closing block for the same
      // reason.)
      //
      // Renders NOTHING until an article is published — see Blog.astro. The demo has published
      // articles, so it shows here; a fresh store's homepage simply has one less section until they
      // write something, which is the correct silence.
      type: "blog",
      props: {
        id: "jurnal-batik",
        heading: "Dari Jurnal",
        limit: 3,
        ctaLabel: "Lihat semua tulisan",
      },
    },
    // REMOVED (owner, 2026-07-24): the closing "Siap tampil anggun setiap hari?" rich-text CTA. The
    // pre-footer band (Footer.astro) already hands the shopper "Belanja koleksi lengkap …" at the very
    // bottom, so a second closing CTA right above it was redundant.
  ],
};

// The DEFAULT PRODUCT template — a starting point the merchant controls in Tema. A product template
// REPLACES only the PDP tail (produk/[handle].astro renders it where the hand-built "Rekomendasi" strip
// sat; the gallery, buy box, reviews and description are untouched), so this is safe + additive: it turns
// that tail into an editable section instead of hard-coded markup. Kept to ONE clean, honest section —
// related products (empty `collectionHandle` → the product's own category via ctx) — so it is a real
// starter, not filler; the merchant adds rich-text / banners / testimonials from here.
const PRODUCT_DEFAULT: StoredTemplateData = {
  content: [
    {
      type: "product-grid",
      props: {
        id: "produk-serupa",
        heading: "Kamu Mungkin Suka",
        // `terlaris` + empty handle → ProductGrid's ctx picks the product's category and drops the
        // product you are already viewing (see ProductGrid.astro). So this row is always relevant.
        mode: "terlaris",
        collectionHandle: "",
        limit: 4,
        columns: 4,
      },
    },
  ],
};

// The DEFAULT CATEGORY template. A category template is the page's BODY — `CategoryHero` (the `<h1>`,
// the breadcrumb, the cover) is rendered by kategori/[handle].astro and is NOT a section, so this
// starts exactly where the hand-built page starts: with the listing itself.
//
// `product-listing`, NOT `product-grid`. That distinction is the whole reason this template did not
// exist before: the only product section on offer was Grid Produk — a flat slice capped at `limit`,
// no sort control, no pagination — so building a category template silently truncated the catalogue
// and threw away sort + paging. Grid Produk is a merchandising ROW ("Kamu Mungkin Suka", 4 cards);
// Daftar Produk is the catalogue.
//
// Heading is empty on purpose: the CategoryHero directly above already carries the collection's name.
const CATEGORY_DEFAULT: StoredTemplateData = {
  content: [
    {
      type: "product-listing",
      props: { id: "daftar-produk", heading: "" },
    },
  ],
};

// Seed one template of a given type as the store's default (UPSERT, same rationale as the homepage).
async function upsertTemplate(storeId: string, type: "homepage" | "product" | "category", name: string, sections: StoredTemplateData) {
  const [existing] = await db
    .select({ id: schema.pageTemplates.id })
    .from(schema.pageTemplates)
    .where(and(eq(schema.pageTemplates.storeId, storeId), eq(schema.pageTemplates.type, type)))
    .limit(1);
  if (existing) {
    await db.update(schema.pageTemplates).set({ name, isDefault: true, sections, updatedAt: new Date() }).where(eq(schema.pageTemplates.id, existing.id));
  } else {
    await db.insert(schema.pageTemplates).values({ storeId, type, name, isDefault: true, sections });
  }
  return existing ? "REPLACED" : "created";
}

async function main() {
  const [store] = await db.select({ id: schema.stores.id, name: schema.stores.name }).from(schema.stores).where(eq(schema.stores.slug, DEMO_SLUG)).limit(1);
  if (!store) {
    console.log(`seed-templates: no store "${DEMO_SLUG}" — nothing to do.`);
    await client.end();
    return;
  }

  // ── UPSERT, not insert-if-absent ──────────────────────────────────────────────────────────────
  //
  // This started as "insert only when the store has no homepage template", copying seed-reviews'
  // idempotency so a redeploy could never clobber a merchant's work. That guard was protecting
  // against a threat THAT CANNOT HAPPEN HERE: this file is hardcoded to `batik-nusantara` and
  // touches nothing else. It cannot reach a merchant. What it actually did was silently pin
  // production to whatever shape shipped first — the demo sat on live rendering "Paling Dicari" as
  // 8 cards at 400px for a whole deploy cycle after the template was rewritten to 4×1 + 4×2, and
  // the deploy log said "already has a homepage template — left untouched", i.e. success.
  //
  // ⚠️ THE COST, STATED: the demo's homepage is now REPLACED on every deploy. If you edit it in the
  // Store Builder — to show someone the builder — the next deploy reverts it. That is the right
  // trade for a demo whose template lives in this file, and the wrong one for a real store. If this
  // script is ever pointed at a merchant, restore the guard first.
  // `sections` is written EXPLICITLY (inside upsertTemplate). The column defaults to '[]'::jsonb — an
  // ARRAY, not `{content:[]}` — and the storefront's `withContent()` reads a value with no `.content` as
  // "no template" and silently falls back to the hand-built page. Omitting it would look like success.
  const homepageResult = await upsertTemplate(store.id, "homepage", "Beranda", HOMEPAGE);
  const productResult = await upsertTemplate(store.id, "product", "Halaman Produk", PRODUCT_DEFAULT);
  // `category` was the one type of the three that was never seeded, so the demo could not show what a
  // category template even looks like — while the builder happily let a merchant create one.
  const categoryResult = await upsertTemplate(store.id, "category", "Halaman Kategori", CATEGORY_DEFAULT);

  console.log(
    `seed-templates: ${store.name} → homepage ${homepageResult} (${HOMEPAGE.content.length} sections), ` +
      `category ${categoryResult} (${CATEGORY_DEFAULT.content.length} sections), ` +
      `product ${productResult} (${PRODUCT_DEFAULT.content.length} sections).`,
  );
  await client.end();
}

main().catch(async (e) => {
  console.error(e);
  await client.end();
  process.exit(1);
});
