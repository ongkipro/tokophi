// Give the extra demo products (seed-products.ts) honest ratings — real, published `reviews` rows the
// storefront aggregates, NOT a fabricated `products.rating_value`. Same shape the main seed uses for the
// original catalogue: a review carries a linked customer + the product FK + a star, and the rating is
// the AVERAGE of those rows (the storefront ignores the rating_value cache — we only refresh it here so
// nothing reads a stale number).
//
// ⚠️ Scoped to the 10 seed-products handles ONLY — never a blanket "give every product reviews", because
// a product with no reviews is a REAL state the storefront must render (no stars, not a default), and the
// demo deliberately keeps some. INSERT-IF-ABSENT: skips any product that already has a review, so a
// re-run adds nothing. Deterministic (mulberry32, never Math.random).
//   npm run seed:demo-ratings -w @tokophi/db
import { and, eq, inArray } from "drizzle-orm";
import { db, client, schema } from "./client";

const DEMO_SLUG = "batiknusantara";
const TODAY = new Date("2026-07-22T00:00:00Z");

const HANDLES = [
  "blazer-formal-wanita-premium-slim-fit",
  "blouse-katun-premium-lengan-panjang",
  "dress-batik-tulis-parang-sogan",
  "gamis-syari-toyobo-bunga-modern",
  "tunik-rayon-abstrak-kontemporer",
  "rok-plisket-batik-mega-mendung",
  "celana-kulot-wide-leg-adem",
  "kemeja-oversized-katun-twill",
  "khimar-instan-bergo-jersey-dua-layer",
  "jumpsuit-kulot-batik-sidomukti",
];

// Review bodies by star tier — apparel/fashion voice. The star carries the score; the text is honest and
// non-repeating (picked without replacement per product, like seed-reviews).
const BODIES: Record<number, string[]> = {
  5: [
    "Bahannya adem banget dan jatuhnya cantik di badan. Suka!",
    "Kualitas oke, jahitan rapi, persis seperti foto. Recommended.",
    "Cepat sampai, packing rapi, barangnya bagus. Puas sekali.",
    "Motif dan warnanya cantik, tidak beda dari foto. Mantap.",
    "Nyaman dipakai seharian, bahan ringan. Pasti repeat order.",
    "Adem, tidak menerawang, ukurannya pas. Terima kasih penjual.",
    "Elegan dan berkelas, cocok untuk acara. Worth every rupiah.",
    "Suka potongannya, bikin badan kelihatan rapi. Bagus banget.",
  ],
  4: [
    "Bagus dan nyaman, cuma warnanya sedikit lebih gelap dari foto.",
    "Kualitas oke untuk harganya. Pengiriman agak lama tapi worth it.",
    "Bahan adem dan jahitan rapi, hanya ukurannya agak besar sedikit.",
    "Suka modelnya, cuma bahannya agak tipis. Overall tetap puas.",
    "Sesuai deskripsi dan cakep, sayang packing kurang rapi.",
  ],
  3: [
    "Lumayan untuk harganya, tapi bahan tidak setebal ekspektasi.",
    "Barang ok, tapi pengiriman lama dan warnanya sedikit beda.",
  ],
};

// Star distribution — mostly happy, a few 4s, rare 3. Indexed by a deterministic draw.
const STAR_SEQUENCE = [5, 5, 4, 5, 5, 4, 3, 5];

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const [store] = await db.select({ id: schema.stores.id, name: schema.stores.name }).from(schema.stores).where(eq(schema.stores.slug, DEMO_SLUG)).limit(1);
  if (!store) {
    console.log(`seed-demo-ratings: no store "${DEMO_SLUG}" — nothing to do.`);
    await client.end();
    return;
  }

  const customers = await db.select({ id: schema.customers.id }).from(schema.customers).where(eq(schema.customers.storeId, store.id));
  if (customers.length < 3) {
    console.error("seed-demo-ratings: too few customers to attribute reviews to. Run seed.ts first.");
    await client.end();
    process.exitCode = 1;
    return;
  }

  const products = await db
    .select({ id: schema.products.id, handle: schema.products.handle, title: schema.products.title, emoji: schema.products.emoji })
    .from(schema.products)
    .where(and(eq(schema.products.storeId, store.id), inArray(schema.products.handle, HANDLES)));

  let created = 0;
  let skipped = 0;
  for (let pi = 0; pi < products.length; pi++) {
    const p = products[pi];
    // Idempotent: skip a product that already has any review.
    const [has] = await db.select({ id: schema.reviews.id }).from(schema.reviews).where(eq(schema.reviews.productId, p.id)).limit(1);
    if (has) {
      skipped++;
      continue;
    }
    const rnd = mulberry32(7000 + pi * 97);
    const count = 3 + Math.floor(rnd() * 4); // 3..6 reviews
    // per-product pools we consume without replacement so no sentence repeats on one page
    const pool: Record<number, string[]> = { 5: [...BODIES[5]], 4: [...BODIES[4]], 3: [...BODIES[3]] };
    const rows: (typeof schema.reviews.$inferInsert)[] = [];
    for (let i = 0; i < count; i++) {
      const rating = STAR_SEQUENCE[i % STAR_SEQUENCE.length];
      const tier = pool[rating].length ? rating : 5; // fall back to 5-star pool if a tier is exhausted
      const idx = Math.floor(rnd() * pool[tier].length);
      const body = pool[tier].splice(idx, 1)[0] ?? `Produk bagus, sesuai deskripsi.`;
      const customerId = customers[(pi * 3 + i) % customers.length].id;
      rows.push({
        storeId: store.id,
        customerId,
        productId: p.id,
        productName: p.title,
        emoji: p.emoji,
        rating,
        body,
        status: "terbit",
        createdAt: new Date(TODAY.getTime() - (2 + i * 3 + pi) * 86_400_000),
      });
    }
    await db.insert(schema.reviews).values(rows);
    // Refresh the (otherwise-ignored) rating cache from the rows we just wrote, so no stale number lingers.
    const avg = rows.reduce((a, r) => a + (r.rating ?? 0), 0) / rows.length;
    await db.update(schema.products).set({ ratingValue: avg, ratingCount: rows.length }).where(eq(schema.products.id, p.id));
    created += rows.length;
  }

  console.log(`seed-demo-ratings: ${store.name} → ${created} ulasan dibuat untuk ${products.length - skipped} produk (${skipped} sudah ada, dilewati).`);
  await client.end();
}

main();
