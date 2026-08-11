// Seed 10 extra demo products for the DEMO STORE — each with a LONG display title (>70 chars, within
// the editor's 100 cap), a CONCISE SEO title (≤70), a meta description (≤160), and a real featured
// image that lands in the merchant's Files library (the `media` table) as WebP.
//
// WHY THIS FILE EXISTS. The demo needed products that exercise the new fields: a product name longer
// than 70 chars (so the 100-char lock and long-title layout are visibly used) paired with a separate
// ≤70 `seo_title` and ≤160 `seo_desc` (migration 0071 — the storefront <title>/meta now prefer them).
// It also demonstrates the upload pipeline: each image goes THROUGH the same path a merchant upload
// takes — crop to the card's 1:1, encode WebP, write to public/uploads/, register a `media` row — so
// the photos appear in Files and every product is one a merchant could have created by hand.
//
// ⚠️ INSERT-IF-ABSENT, keyed on handle. Unlike seed-journal (which OWNS + replaces the demo's journal),
// these are NEW catalogue rows on a LIVE store: a re-run must NEVER delete or overwrite a merchant's
// product. It skips any handle that already exists, so re-running is a no-op. Idempotent and safe to
// wire into the deploy chain.
//   npm run seed:products -w @tokophi/db
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { db, client, schema } from "./client";
import { and, eq, sql } from "drizzle-orm";
import { suggestGoogleCategory, suggestGender } from "@tokophi/lib/taxonomy-suggest";
import { packedDims } from "./product-dims";

const DEMO_SLUG = "batiknusantara";
// Fixed anchor so re-runs are deterministic; small per-item offset so they sort newest-first sensibly.
const ANCHOR = new Date("2026-07-22T03:00:00Z");

const PRODUCTS_DIR = path.join(process.cwd(), "..", "..", "apps", "admin", "public", "products");
const UPLOAD_DIR = path.join(process.cwd(), "..", "..", "apps", "admin", "public", "uploads");
const IMG = 1000; // 1:1 — ProductThumb renders aspect-square

type Draft = {
  title: string; // display title, >70 chars (uses the 100 lock)
  handle: string;
  seoTitle: string; // ≤70
  seoDesc: string; // ≤160
  description: string;
  category: string;
  emoji: string;
  sizes: string[];
  price: number;
  compareAt: number;
  cost: number;
  weightGrams: number;
  stock: number;
  src: string; // source webp under public/products/
};

const DRAFTS: Draft[] = [
  {
    title: "Blazer Formal Wanita Bahan Premium Slim Fit Lengan Panjang untuk Kerja Kantor dan Acara Resmi Elegan",
    handle: "blazer-formal-wanita-premium-slim-fit",
    seoTitle: "Blazer Formal Wanita Slim Fit Premium untuk Kerja",
    seoDesc: "Blazer formal wanita slim fit bahan premium, lengan panjang, cocok untuk kerja kantor dan acara resmi. Tampil rapi dan profesional setiap hari.",
    description: "Blazer formal dengan potongan slim fit yang membentuk siluet rapi tanpa kaku. Bahan premium yang jatuh dengan baik, adem, dan tidak mudah kusut. Jahitan bahu presisi jadi kunci tampil profesional — pas di kerja kantor maupun acara resmi.",
    category: "Outerwear", emoji: "🧥", sizes: ["S", "M", "L", "XL"],
    price: 219000, compareAt: 289000, cost: 130000, weightGrams: 500, stock: 40, src: "blazer-wanita-2.webp",
  },
  {
    title: "Blouse Katun Premium Wanita Lengan Panjang Motif Polos Adem dan Nyaman Dipakai Seharian untuk Kerja",
    handle: "blouse-katun-premium-lengan-panjang",
    seoTitle: "Blouse Katun Premium Lengan Panjang Adem Serbaguna",
    seoDesc: "Blouse katun premium lengan panjang, adem dan nyaman dipakai seharian. Motif polos serbaguna, mudah dipadupadankan untuk kerja maupun santai.",
    description: "Blouse berbahan katun premium yang menyerap keringat dan adem di cuaca panas. Potongan lengan panjang yang sopan, motif polos yang gampang dipadupadankan. Pilihan aman untuk seragam kerja maupun jalan santai.",
    category: "Atasan", emoji: "👚", sizes: ["S", "M", "L"],
    price: 139000, compareAt: 179000, cost: 80000, weightGrams: 250, stock: 55, src: "blouse-katun-3.webp",
  },
  {
    title: "Dress Batik Tulis Wanita Lengan Panjang Motif Parang Klasik Warna Sogan Elegan untuk Acara Formal",
    handle: "dress-batik-tulis-parang-sogan",
    seoTitle: "Dress Batik Tulis Parang Sogan Lengan Panjang Elegan",
    seoDesc: "Dress batik tulis motif parang klasik warna sogan, lengan panjang. Elegan dan berkelas untuk acara formal, kondangan, maupun kantor.",
    description: "Dress batik tulis dengan motif parang klasik — dikerjakan dengan canting, tidak ada dua helai yang identik. Warna sogan yang hangat dan elegan, potongan lengan panjang yang sopan. Satu potong yang langsung terlihat berkelas untuk acara formal.",
    category: "Dress", emoji: "👗", sizes: ["S", "M", "L", "XL"],
    price: 349000, compareAt: 449000, cost: 200000, weightGrams: 400, stock: 25, src: "dress-batik-2.webp",
  },
  {
    title: "Gamis Syari Katun Toyobo Wanita Motif Bunga Modern Lengan Balon Adem untuk Hijaber Aktif Sehari-hari",
    handle: "gamis-syari-toyobo-bunga-modern",
    seoTitle: "Gamis Syari Katun Toyobo Motif Bunga untuk Hijaber",
    seoDesc: "Gamis syari katun toyobo adem, motif bunga modern, lengan balon. Nyaman dan menutup aurat untuk hijaber aktif sehari-hari.",
    description: "Gamis syari berbahan katun toyobo yang adem dan tidak menerawang. Motif bunga modern dengan lengan balon yang manis, potongan longgar yang syari dan nyaman untuk gerak. Cocok untuk hijaber aktif dari pagi sampai sore.",
    category: "Busana Muslim", emoji: "🧕", sizes: ["M", "L", "XL"],
    price: 289000, compareAt: 359000, cost: 165000, weightGrams: 500, stock: 30, src: "gamis-syari-2.webp",
  },
  {
    title: "Tunik Rayon Premium Wanita Motif Abstrak Kontemporer Potongan Longgar Nyaman untuk Kerja dan Santai",
    handle: "tunik-rayon-abstrak-kontemporer",
    seoTitle: "Tunik Rayon Motif Abstrak Potongan Longgar Nyaman",
    seoDesc: "Tunik rayon premium motif abstrak kontemporer, potongan longgar yang jatuh cantik dan adem. Serbaguna untuk kerja maupun santai.",
    description: "Tunik berbahan rayon premium yang adem dan jatuh mengikuti badan. Motif abstrak kontemporer yang tidak pasaran, potongan longgar yang menyamankan seharian. Mudah dipadukan dengan kulot atau legging.",
    category: "Atasan", emoji: "👚", sizes: ["All Size"],
    price: 159000, compareAt: 209000, cost: 90000, weightGrams: 280, stock: 45, src: "tunik-rayon-2.webp",
  },
  {
    title: "Rok Plisket Batik Wanita Panjang Pinggang Karet Motif Mega Mendung Cirebon Warna Biru Gradasi Cantik",
    handle: "rok-plisket-batik-mega-mendung",
    seoTitle: "Rok Plisket Batik Mega Mendung Cirebon Biru Gradasi",
    seoDesc: "Rok plisket batik panjang motif mega mendung Cirebon, pinggang karet nyaman, warna biru gradasi. Anggun untuk berbagai acara.",
    description: "Rok plisket panjang dengan motif mega mendung khas Cirebon dan gradasi biru yang cantik. Pinggang karet yang nyaman dan fleksibel, lipatan plisket yang rapi dan ringan dibawa bergerak. Anggun untuk kerja maupun acara.",
    category: "Bawahan", emoji: "👗", sizes: ["All Size"],
    price: 179000, compareAt: 229000, cost: 100000, weightGrams: 350, stock: 38, src: "rok-plisket-2.webp",
  },
  {
    title: "Celana Kulot Wide Leg Bahan Adem Pinggang Karet Potongan Longgar Nyaman untuk Kerja dan Santai",
    handle: "celana-kulot-wide-leg-adem",
    seoTitle: "Celana Kulot Wide Leg Adem Pinggang Karet Nyaman",
    seoDesc: "Celana kulot wide leg bahan adem, pinggang karet, potongan longgar yang nyaman untuk duduk seharian. Cocok kerja dan santai.",
    description: "Celana kulot wide leg dengan potongan lebar dari pinggul ke bawah — tidak menekan saat duduk lama. Bahan adem dan jatuh, pinggang karet yang nyaman untuk semua ukuran. Rapi dipadukan atasan yang dimasukkan.",
    category: "Bawahan", emoji: "👖", sizes: ["S", "M", "L", "XL"],
    price: 149000, compareAt: 189000, cost: 85000, weightGrams: 300, stock: 50, src: "celana-kulot-2.webp",
  },
  {
    title: "Kemeja Oversized Wanita Bahan Katun Twill Lengan Panjang Potongan Longgar Kekinian untuk Gaya Santai",
    handle: "kemeja-oversized-katun-twill",
    seoTitle: "Kemeja Oversized Katun Twill Longgar Gaya Santai",
    seoDesc: "Kemeja oversized katun twill lengan panjang, potongan longgar kekinian yang jatuh rapi. Mudah dipadupadankan untuk gaya santai.",
    description: "Kemeja oversized dengan bahu diturunkan yang rapi — longgar yang disengaja, bukan kebesaran. Katun twill yang cukup tebal untuk jatuh bagus dan tidak menerawang. Masukkan bagian depannya saja agar garis pinggang tetap terlihat.",
    category: "Atasan", emoji: "👔", sizes: ["All Size"],
    price: 169000, compareAt: 219000, cost: 95000, weightGrams: 320, stock: 42, src: "kemeja-oversized-2.webp",
  },
  {
    title: "Khimar Instan Bergo Jersey Dua Layer Adem Menutup Dada Cocok untuk Muslimah Syari Sehari-hari",
    handle: "khimar-instan-bergo-jersey-dua-layer",
    seoTitle: "Khimar Instan Bergo Jersey Dua Layer Adem Syari",
    seoDesc: "Khimar instan bergo jersey premium dua layer, adem dan menutup dada. Praktis dipakai untuk muslimah syari sehari-hari.",
    description: "Khimar instan bergo dari jersey premium dua layer yang adem dan tidak menerawang. Sudah dijahit jadi — tinggal pakai, menutup dada dengan rapi. Praktis untuk aktivitas sehari-hari tanpa repot jarum pentul.",
    category: "Busana Muslim", emoji: "🧕", sizes: ["All Size"],
    price: 89000, compareAt: 119000, cost: 50000, weightGrams: 200, stock: 60, src: "khimar-instan-2.webp",
  },
  {
    title: "Jumpsuit Kulot Batik Modern Lengan Pendek Motif Sidomukti Warna Hijau Botol Elegan untuk Pesta",
    handle: "jumpsuit-kulot-batik-sidomukti",
    seoTitle: "Jumpsuit Kulot Batik Sidomukti Hijau Botol Pesta",
    seoDesc: "Jumpsuit kulot batik modern motif sidomukti warna hijau botol, lengan pendek. Elegan dan praktis untuk pesta maupun acara.",
    description: "Jumpsuit kulot batik modern dengan motif sidomukti dan warna hijau botol yang elegan. Satu potong yang menyelesaikan padu padan — lengan pendek yang adem, potongan kulot yang jatuh. Pilih resleting belakang untuk kepraktisan di acara.",
    category: "Dress", emoji: "👗", sizes: ["S", "M", "L"],
    price: 299000, compareAt: 379000, cost: 170000, weightGrams: 450, stock: 22, src: "jumpsuit-kulot-2.webp",
  },
];

async function makeImage(d: Draft, storeId: string): Promise<string> {
  const input = await fs.readFile(path.join(PRODUCTS_DIR, d.src));
  const out = await sharp(input)
    .resize({ width: IMG, height: IMG, fit: "cover", position: "attention" })
    .webp({ quality: 82 })
    .toBuffer();
  const name = `produk-${d.handle}.webp`;
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, name), out);
  const meta = await sharp(out).metadata();
  const url = `/api/uploads/${name}`;
  // Register in the media library (Files). Delete-by-url first so a re-run that DID create the product
  // on a prior partial run doesn't duplicate the media row.
  await db.delete(schema.media).where(and(eq(schema.media.storeId, storeId), eq(schema.media.url, url)));
  await db.insert(schema.media).values({
    storeId, url, filename: name, mime: "image/webp", sizeBytes: out.length,
    width: meta.width ?? null, height: meta.height ?? null,
  });
  return url;
}

async function main() {
  const [store] = await db
    .select({ id: schema.stores.id, name: schema.stores.name })
    .from(schema.stores)
    .where(eq(schema.stores.slug, DEMO_SLUG))
    .limit(1);
  if (!store) {
    console.log(`seed-products: no store "${DEMO_SLUG}" — nothing to do.`);
    await client.end();
    return;
  }
  const [loc] = await db
    .select({ id: schema.locations.id })
    .from(schema.locations)
    .where(eq(schema.locations.storeId, store.id))
    .limit(1);
  if (!loc) {
    console.error(`seed-products: store "${DEMO_SLUG}" has no location. Run seed.ts first.`);
    await client.end();
    process.exitCode = 1;
    return;
  }

  let created = 0;
  let skipped = 0;
  for (let i = 0; i < DRAFTS.length; i++) {
    const d = DRAFTS[i];
    const [exists] = await db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(and(eq(schema.products.storeId, store.id), eq(schema.products.handle, d.handle)))
      .limit(1);
    if (exists) {
      skipped++;
      continue;
    }

    const imageUrl = await makeImage(d, store.id);
    const gcat = suggestGoogleCategory(d.title, d.category); // standard taxonomy (ADR 0011)
    // Catalog number from the store's counter (ADR 0013) — the SAME atomic allocation the merchant
    // admin uses, so a script and a human creating products at once cannot collide. This script APPENDS
    // to a live store, so it must not assume the store is empty.
    const [ctr] = await db
      .insert(schema.storeCounters)
      .values({ storeId: store.id, productNext: 1002 })
      .onConflictDoUpdate({
        target: schema.storeCounters.storeId,
        set: { productNext: sql`${schema.storeCounters.productNext} + 1` },
      })
      .returning({ next: schema.storeCounters.productNext });
    const [p] = await db
      .insert(schema.products)
      .values({
        number: Number(ctr.next) - 1,
        variantSeqNext: 2, // one variant is created below, taking seq 1
        storeId: store.id,
        title: d.title,
        handle: d.handle,
        description: d.description,
        category: d.category,
        status: "active",
        emoji: d.emoji,
        seoTitle: d.seoTitle,
        seoDesc: d.seoDesc,
        googleCategoryId: gcat?.id ?? null,
        googleCategoryPath: gcat?.path ?? null,
        gender: suggestGender(d.title) ?? "female",
        ageGroup: "adult",
        material: d.title.match(/katun|rayon|jersey|denim|linen|sutra|wol|twill|toyobo/i)?.[0] ?? null,
        sizes: d.sizes,
        unitsSold: 0,
        // The FOLDED PARCEL, per garment kind — one table shared with `seed.ts` (N33). This was
        // `1, 1, 1`, which is what `createShipment` then declared to the courier.
        ...packedDims(d.handle),
        hasVariants: false,
        createdAt: new Date(ANCHOR.getTime() - i * 3_600_000),
      })
      .returning();
    const [v] = await db
      .insert(schema.productVariants)
      .values({
        productId: p.id,
        storeId: store.id,
        // `seq` is NOT NULL with NO default (0081 dropped it deliberately), so omitting it is a
        // RUNTIME failure, not just a type error — and the deploy runs this seeder as
        // `(… || echo 'products seed skipped')`, so the throw was swallowed and the run "succeeded".
        // It is not a clean skip either: the loop is unbatched and untransacted, so each attempt had
        // already written a WebP + a `media` row, bumped `store_counters` and inserted the `products`
        // row — leaving an orphan active product with a burned catalog number, no variant, no stock
        // and no media. Invisible on the storefront (the catalog INNER JOINs variant position 0) and
        // very visible in the Seller's Produk list, with no price.
        // `1` is exactly what the product two lines up reserved with `variantSeqNext: 2`.
        seq: 1,
        title: "Default",
        position: 0,
        priceIdr: d.price,
        compareAtIdr: d.compareAt,
        costIdr: d.cost,
        weightGrams: d.weightGrams,
      })
      .returning();
    await db.insert(schema.inventoryLevels).values({ variantId: v.id, locationId: loc.id, available: d.stock });
    await db.insert(schema.productMedia).values({ productId: p.id, url: imageUrl, alt: d.title, position: 0 });
    created++;
  }

  console.log(`seed-products: ${store.name} → ${created} produk baru dibuat, ${skipped} dilewati (sudah ada). ${DRAFTS.length} total.`);
  await client.end();
}

main();
