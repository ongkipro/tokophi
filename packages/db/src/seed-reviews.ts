// Seed product reviews — demo testimonials that are HONEST about where a rating comes from: a review is
// only generated for a (customer, product) pair where that customer actually has a `selesai` (delivered)
// order containing that product. That is the real rule ("rating setelah pembeli membeli + menerima
// pesanan"); only the review TEXT is dummy. So a product shows testimonials exactly when real buyers
// received it — never invented stars on a product nobody bought.
//
// Standalone (not part of the big `seed.ts`) on purpose: it is idempotent and safe to run against a
// live DB — it inserts a review only for a pair that has no review yet, so re-running adds nothing and
// it never touches the curated reviews the main seed already wrote. Run it wherever the storefront is:
//   npm run seed:reviews -w @tokophi/db          (uses DATABASE_URL)
//
// Deterministic (mulberry32, never Math.random) so the same DB always gets the same reviews.
import { db, client, schema } from "./client";
import { sql } from "drizzle-orm";

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Review bodies by rating tier — apparel/fashion (the demo niche). Generic enough for any product; the
// star is what carries the score. Kept plausible + Indonesian, the way a real shopper writes.
const BODIES: Record<number, string[]> = {
  5: [
    "Bahannya adem dan jatuhnya bagus di badan, sesuai foto. Pengiriman cepat, packing rapi. Recommended!",
    "Suka banget! Ukuran pas, jahitan rapi, warnanya cantik. Bakal repeat order.",
    "Kualitas di atas harga. Sampai dengan aman dan cepat, adminnya ramah. Puas.",
    "Nyaman dipakai seharian, nggak gerah. Motifnya lebih bagus dari ekspektasi.",
    "Pas banget di aku, bahan premium. Dikirim rapi dan wangi. Makasih ya!",
    "Cakep dan berkelas, cocok buat kerja maupun hangout. Fast response juga.",
    "Sesuai deskripsi, adem, dan tidak menerawang. Langganan terus deh.",
  ],
  4: [
    "Bagus dan nyaman, cuma warnanya sedikit beda dari foto. Overall puas.",
    "Bahannya enak, ukurannya agak besar sedikit tapi masih oke. Pengiriman lancar.",
    "Kualitas oke untuk harganya. Packing aman, sampai tepat waktu.",
    "Suka modelnya, jahitan rapi. Cuma agak tipis, tetap worth it.",
    "Nyaman dipakai, pengiriman agak lama tapi barang sesuai. Recommended.",
    "Cakep, sesuai ekspektasi. Minus sedikit karena ada benang kecil, gampang dirapikan.",
  ],
  3: [
    "Lumayan untuk harganya. Bahan standar, jahitan bagian lengan kurang rapi.",
    "Biasa aja sih, sesuai harga. Warnanya agak pudar dari foto.",
    "Cukup oke, ukuran sesuai. Pengiriman agak lama.",
    "Bahannya tipis, tapi masih bisa dipakai. Sisanya oke.",
  ],
  2: [
    "Agak kecewa, ukurannya beda dari yang tertera. Bahan tipis.",
    "Jahitannya kurang rapi dan warna beda dari foto. Sisanya standar.",
  ],
};

// Rating distribution — realistic for apparel with genuine buyers: mostly happy, a few lukewarm.
function pickRating(r: number): number {
  if (r < 0.55) return 5;
  if (r < 0.85) return 4;
  if (r < 0.96) return 3;
  return 2;
}

async function main() {
  // Every (customer, product) that this customer actually RECEIVED (a `selesai` order line), with the
  // store it belongs to and when the order landed — the review is dated a few days after that.
  const pairs = (await db.execute(sql`
    select o.store_id            as "storeId",
           o.customer_id         as "customerId",
           p.id                  as "productId",
           p.emoji               as "emoji",
           max(o.placed_at)       as "orderedAt"
      from orders o
      join order_line_items oli on oli.order_id = o.id
      join product_variants pv  on pv.id = oli.variant_id
      join products p           on p.id = pv.product_id
     where o.status = 'selesai'
       and o.customer_id is not null
     group by o.store_id, o.customer_id, p.id, p.emoji
     order by o.store_id, p.id, o.customer_id
  `)) as unknown as { storeId: string; customerId: string; productId: string; emoji: string | null; orderedAt: Date }[];

  // Skip any pair that already has a review (idempotent + never duplicates the curated seed reviews).
  const existing = (await db.execute(sql`
    select customer_id as "customerId", product_id as "productId" from reviews
     where customer_id is not null and product_id is not null
  `)) as unknown as { customerId: string; productId: string }[];
  const seen = new Set(existing.map((e) => `${e.customerId}:${e.productId}`));

  const rows: (typeof schema.reviews.$inferInsert)[] = [];
  let i = 0;
  for (const pair of pairs) {
    i++;
    if (seen.has(`${pair.customerId}:${pair.productId}`)) continue;
    // Deterministic per pair (stable across runs): seed from the running index.
    const rnd = mulberry32(9973 + i * 131);
    // ~68% of delivered pairs leave a review — not everyone does, and a 100%-reviewed catalog looks fake.
    if (rnd() > 0.68) continue;
    const rating = pickRating(rnd());
    const pool = BODIES[rating];
    const body = pool[Math.floor(rnd() * pool.length)];
    // Most reviews are moderated + published; a few sit "menunggu" (pending) like a real queue.
    const status = rnd() < 0.85 ? "terbit" : "menunggu";
    // Written 2–9 days after the parcel arrived.
    const daysAfter = 2 + Math.floor(rnd() * 8);
    const createdAt = new Date(new Date(pair.orderedAt).getTime() + daysAfter * 86_400_000);
    rows.push({
      storeId: pair.storeId,
      customerId: pair.customerId,
      productId: pair.productId,
      emoji: pair.emoji,
      rating,
      body,
      status,
      createdAt,
    });
  }

  if (!rows.length) {
    console.log("seed-reviews: nothing to add — every delivered pair already has a review.");
    await client.end();
    return;
  }

  // Insert in chunks (keep the statement small).
  for (let c = 0; c < rows.length; c += 200) {
    await db.insert(schema.reviews).values(rows.slice(c, c + 200));
  }

  const published = rows.filter((r) => r.status === "terbit").length;
  console.log(`seed-reviews: inserted ${rows.length} reviews (${published} terbit / ${rows.length - published} menunggu) across ${new Set(rows.map((r) => r.productId)).size} products, from real delivered orders.`);
  await client.end();
}

main().catch(async (e) => {
  console.error(e);
  await client.end();
  process.exit(1);
});
