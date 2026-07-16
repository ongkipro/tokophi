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
// Standalone (not part of the big `seed.ts`) and idempotent, same as seed-reviews.ts: it inserts only
// when the store has no homepage template, so it is safe against a live DB and never clobbers what a
// merchant has since edited in the builder.
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
      type: "rich-text",
      props: {
        id: "cerita-batik",
        // THE POINT OF THIS FILE. This paragraph was hard-coded into the platform's fallback homepage
        // and rendered, in quote marks, under every store's own name — a first-person claim about
        // batik and Indonesian women, signed "Gadget Murah ID — Jakarta". Here it is what it always
        // should have been: one merchant's words, on one merchant's template, about their own goods.
        heading: "Cerita Kami",
        body: "Setiap helai kami rancang untuk perempuan Indonesia — memadukan warisan batik dengan siluet masa kini, agar kamu tampil anggun tanpa kehilangan kenyamanan.",
        ctaLabel: "", // empty → RichText renders no button
        ctaHref: "",
        theme: "gelap",
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
      type: "rich-text",
      props: {
        id: "cta-batik",
        heading: "Siap tampil anggun setiap hari?",
        body: "Jelajahi koleksi Batik Nusantara dan temukan busana yang membuatmu percaya diri.",
        ctaLabel: "Mulai Belanja",
        // `semua` is a VIRTUAL collection kategori/[handle].astro always resolves — 200 on every
        // store, measured. Not `/kategori/dress`, which only this one has.
        ctaHref: "/kategori/semua",
        theme: "terang",
      },
    },
  ],
};

async function main() {
  const [store] = await db.select({ id: schema.stores.id, name: schema.stores.name }).from(schema.stores).where(eq(schema.stores.slug, DEMO_SLUG)).limit(1);
  if (!store) {
    console.log(`seed-templates: no store "${DEMO_SLUG}" — nothing to do.`);
    await client.end();
    return;
  }

  const existing = await db
    .select({ id: schema.pageTemplates.id })
    .from(schema.pageTemplates)
    .where(and(eq(schema.pageTemplates.storeId, store.id), eq(schema.pageTemplates.type, "homepage")))
    .limit(1);
  if (existing.length) {
    console.log(`seed-templates: ${store.name} already has a homepage template — left untouched.`);
    await client.end();
    return;
  }

  // `sections` is written EXPLICITLY. The column defaults to '[]'::jsonb — an ARRAY, not
  // `{content:[]}` — and the storefront's `withContent()` reads a value with no `.content` as "no
  // template" and silently falls back to the hand-built page. Omitting this would look like success.
  await db.insert(schema.pageTemplates).values({
    storeId: store.id,
    type: "homepage",
    name: "Beranda",
    isDefault: true,
    sections: HOMEPAGE,
  });

  console.log(`seed-templates: ${store.name} → homepage template with ${HOMEPAGE.content.length} sections (${HOMEPAGE.content.map((c) => c.type).join(", ")}).`);
  await client.end();
}

main().catch(async (e) => {
  console.error(e);
  await client.end();
  process.exit(1);
});
