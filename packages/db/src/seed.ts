// Seed the local Postgres — SINGLE-TENANT MVP: one real store, "Batik Nusantara"
// (the same store the admin manages and the storefront sells). Run:
//   npm run seed -w @indostore/db   (idempotent — truncates public tables first)
import { db, client, schema } from "./client";

const TODAY = new Date("2026-07-02T00:00:00Z");
const daysAgo = (n: number) => new Date(TODAY.getTime() - n * 86_400_000);
const minutesAgo = (n: number) => new Date(TODAY.getTime() - n * 60_000);
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---- the one store ----
const STORE = {
  name: "Batik Nusantara",
  owner: "Ongki Pratama",
  email: "ongki@batiknusantara.id",
  city: "Yogyakarta",
  plan: "bisnis" as const,
  status: "active" as const,
  gmv: 104_300_000,
  orders: 502,
  products: 14, // matches the storefront catalog
  createdDaysAgo: 186,
};

const PLANS: Array<{ key: "pemula" | "bisnis" | "skala"; name: string; price: number; blurb: string; features: string[] }> = [
  { key: "pemula", name: "Pemula", price: 99_000, blurb: "Untuk toko baru", features: ["1 toko", "Produk tak terbatas", "Fitur inti", "Support email"] },
  { key: "bisnis", name: "Bisnis", price: 299_000, blurb: "Untuk toko berkembang", features: ["Multi-toko", "Analitik lanjutan", "Pemasaran & iklan", "CRM WhatsApp", "Support prioritas"] },
  { key: "skala", name: "Skala", price: 799_000, blurb: "Untuk volume tinggi", features: ["Semua fitur Bisnis", "API akses", "Multi-lokasi", "Peran lanjutan", "Account manager"] },
];
const planPrice = (k: "pemula" | "bisnis" | "skala") => PLANS.find((p) => p.key === k)!.price;

// Recent monthly billing history for the store.
const INVOICES: Array<{ number: string; status: "dibayar" | "menunggu" | "gagal"; daysAgo: number }> = [
  { number: "INV-9006", status: "menunggu", daysAgo: 2 },
  { number: "INV-9005", status: "dibayar", daysAgo: 32 },
  { number: "INV-9004", status: "dibayar", daysAgo: 62 },
  { number: "INV-9003", status: "dibayar", daysAgo: 92 },
  { number: "INV-9002", status: "dibayar", daysAgo: 122 },
  { number: "INV-9001", status: "dibayar", daysAgo: 152 },
];

const ACTIVITY: Array<{ kind: "signup" | "upgrade" | "payment" | "churn" | "support"; text: string; minutesAgo: number }> = [
  { kind: "payment", text: "Pembayaran Rp299.000 dari “Batik Nusantara” (Bisnis)", minutesAgo: 52 },
  { kind: "support", text: "Tiket support baru dari “Batik Nusantara”", minutesAgo: 4 * 60 },
  { kind: "upgrade", text: "“Batik Nusantara” upgrade Pemula → Bisnis", minutesAgo: 40 * 24 * 60 },
  { kind: "signup", text: "Toko “Batik Nusantara” mendaftar", minutesAgo: STORE.createdDaysAgo * 24 * 60 },
];

// ---- catalog (mirrors apps/admin/lib/mock/store.ts, deterministic) ----
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ADMIN_TODAY = new Date("2026-06-30T00:00:00Z");
const PRODUCT_SEED: Array<[string, string, number, string, string]> = [
  ["Dress Midi Motif Bunga", "👗", 189_000, "Dress", "dress-midi-bunga"],
  ["Blouse Katun Lengan Balon", "👚", 95_000, "Atasan", "blouse-katun"],
  ["Kemeja Oversized Wanita", "👔", 120_000, "Atasan", "kemeja-oversized"],
  ["Rok Plisket Panjang", "🩱", 89_000, "Bawahan", "rok-plisket"],
  ["Celana Kulot Wide Leg", "👖", 110_000, "Bawahan", "celana-kulot"],
  ["Hijab Voal Segi Empat", "🧕", 45_000, "Busana Muslim", "hijab-voal"],
  ["Khimar Instan Jumbo", "🧕", 75_000, "Busana Muslim", "khimar-instan"],
  ["Gamis Syari Polos", "🧕", 245_000, "Busana Muslim", "gamis-syari"],
  ["Tunik Katun Rayon", "👚", 98_000, "Atasan", "tunik-rayon"],
  ["Cardigan Rajut Wanita", "🧥", 135_000, "Outerwear", "cardigan-rajut"],
  ["Set Piyama Satin Wanita", "🩱", 125_000, "Loungewear", "piyama-satin"],
  ["Blazer Formal Wanita", "🧥", 199_000, "Outerwear", "blazer-wanita"],
  ["Dress Batik Modern", "👗", 215_000, "Dress", "dress-batik"],
  ["Jumpsuit Kulot Casual", "👗", 175_000, "Dress", "jumpsuit-kulot"],
];
const CATALOG = PRODUCT_SEED.map(([name, emoji, price, category, slug], i) => {
  const rnd = mulberry32(1000 + i * 7);
  const stock = Math.round(5 + rnd() * 240);
  const status: "active" | "draft" = rnd() > 0.12 ? "active" : "draft";
  const unitsSold = Math.round(30 + rnd() * 900);
  const addedTs =
    ADMIN_TODAY.getTime() -
    (1 + Math.floor(rnd() * 80)) * 86_400_000 +
    (8 + Math.floor(rnd() * 11)) * 3_600_000 +
    Math.floor(rnd() * 60) * 60_000;
  return { name, emoji, price, category, slug, stock, status, unitsSold, addedTs };
});
// curated variety (a couple of drafts + low-stock) — matches the mock
CATALOG[7].status = "draft";
CATALOG[12].status = "draft";
CATALOG[9].stock = 8;
CATALOG[3].stock = 14;

// ---- customers (mirror admin mock: mulberry32(4242)) ----
const CUST_POOL = [
  "Budi Santoso", "Siti Nurhaliza", "Dewi Lestari", "Agus Salim", "Rina Wijaya",
  "Andi Pratama", "Putri Ayu", "Rizky Ramadhan", "Maya Sari", "Fajar Nugroho",
  "Indah Permata", "Doni Kusuma", "Lina Marlina", "Hendra Gunawan", "Wulan Dari",
  "Bayu Aji", "Citra Kirana", "Eko Prasetyo", "Fitri Handayani", "Gilang Ramadhan",
  "Hana Salsabila", "Irfan Maulana", "Kartika Sari", "Lukman Hakim", "Nadia Zahra",
];
const CITIES = ["Jakarta", "Bandung", "Surabaya", "Medan", "Makassar", "Semarang", "Yogyakarta", "Denpasar", "Bekasi", "Depok"];
type CustSegment = "baru" | "reguler" | "loyal" | "vip";
const CUSTOMERS = (() => {
  const rnd = mulberry32(4242);
  const out: Array<{ name: string; email: string; phone: string; city: string; orders: number; spent: number; segment: CustSegment; joinedDaysAgo: number }> = [];
  for (let i = 0; i < 24; i++) {
    const name = CUST_POOL[i % CUST_POOL.length];
    const orders = Math.round(1 + rnd() * 38);
    const spent = orders * (90_000 + Math.round(rnd() * 260_000));
    const segment: CustSegment = spent > 6_000_000 ? "vip" : orders > 12 ? "loyal" : orders > 3 ? "reguler" : "baru";
    out.push({
      name,
      email: name.toLowerCase().replace(/[^a-z]+/g, ".") + "@mail.com",
      phone: "0812" + String(1000000 + Math.floor(rnd() * 8999999)),
      city: CITIES[Math.floor(rnd() * CITIES.length)],
      orders,
      spent,
      segment,
      joinedDaysAgo: Math.round(rnd() * 400),
    });
  }
  return out.sort((a, b) => b.spent - a.spent);
})();

// ---- discounts (dates derived so the admin status is real: terjadwal/aktif/kadaluarsa) ----
const DISCOUNTS: Array<{ code: string; kind: "persen" | "nominal" | "gratis_ongkir"; value: number; used: number; limit: number; endsInDays: number; startDaysAgo: number; status: "aktif" | "terjadwal" | "nonaktif" }> = [
  { code: "GAJIAN25", kind: "persen", value: 25, used: 342, limit: 1000, endsInDays: 4, startDaysAgo: 30, status: "aktif" },
  { code: "ONGKIRGRATIS", kind: "gratis_ongkir", value: 0, used: 1289, limit: 5000, endsInDays: 12, startDaysAgo: 30, status: "aktif" },
  { code: "NEWUSER50K", kind: "nominal", value: 50_000, used: 210, limit: 500, endsInDays: 30, startDaysAgo: 30, status: "aktif" },
  { code: "FLASH1212", kind: "persen", value: 40, used: 0, limit: 2000, endsInDays: 45, startDaysAgo: -5, status: "terjadwal" },
  { code: "RAMADHAN15", kind: "persen", value: 15, used: 890, limit: 900, endsInDays: -10, startDaysAgo: 60, status: "nonaktif" },
  { code: "MEMBERVIP", kind: "nominal", value: 100_000, used: 76, limit: 300, endsInDays: 60, startDaysAgo: 30, status: "aktif" },
];

// ---- collections (Kategori) — membership seeded so product counts are real ----
const COLLECTIONS: Array<{ name: string; emoji: string; type: "manual" | "otomatis"; published: boolean }> = [
  { name: "Dress", emoji: "👗", type: "otomatis", published: true },
  { name: "Atasan", emoji: "👚", type: "otomatis", published: true },
  { name: "Bawahan", emoji: "👖", type: "otomatis", published: true },
  { name: "Busana Muslim", emoji: "🧕", type: "otomatis", published: true },
  { name: "Promo Gajian", emoji: "🏷️", type: "manual", published: true },
  { name: "Produk Terlaris", emoji: "🔥", type: "otomatis", published: true },
  { name: "Loungewear", emoji: "🩱", type: "otomatis", published: true },
  { name: "Outerwear", emoji: "🧥", type: "otomatis", published: false },
];

// ---- orders (mirror admin mock buildOrders: mulberry32(555)) ----
const NAMES15 = CUST_POOL.slice(0, 15);
const CHANNELS = ["Meta Ads", "TikTok Ads", "Google Ads", "Organic", "Other"];
const CHANNEL_MAP: Record<string, "meta_ads" | "tiktok_ads" | "google_ads" | "organic" | "other"> = {
  "Meta Ads": "meta_ads", "TikTok Ads": "tiktok_ads", "Google Ads": "google_ads", Organic: "organic", Other: "other",
};
type OrderStatus = "baru" | "diproses" | "dikirim" | "selesai" | "batal";
const ORDERS_SEED = (() => {
  const rnd = mulberry32(555);
  const out: Array<{ number: string; customer: string; city: string; total: number; picks: number[]; status: OrderStatus; channel: string; minutesAgo: number }> = [];
  for (let i = 0; i < 60; i++) {
    const items = 1 + Math.floor(rnd() * 4);
    let total = 0;
    const picks: number[] = [];
    for (let k = 0; k < items; k++) {
      const idx = Math.floor(rnd() * CATALOG.length);
      total += CATALOG[idx].price;
      picks.push(idx);
    }
    const sr = rnd();
    const status: OrderStatus = sr < 0.12 ? "baru" : sr < 0.32 ? "diproses" : sr < 0.6 ? "dikirim" : sr < 0.93 ? "selesai" : "batal";
    out.push({
      number: `INV-${4821 - i}`,
      customer: NAMES15[Math.floor(rnd() * NAMES15.length)],
      city: CITIES[Math.floor(rnd() * CITIES.length)],
      total,
      picks,
      status,
      channel: CHANNELS[Math.floor(rnd() * CHANNELS.length)],
      minutesAgo: Math.round(i * (12 + rnd() * 60) + rnd() * 8),
    });
  }
  return out.sort((a, b) => a.minutesAgo - b.minutesAgo);
})();

async function truncateAll() {
  const rows = await client<{ table_name: string }[]>`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name <> '__drizzle_migrations'`;
  const list = rows.map((r) => `"${r.table_name}"`).join(", ");
  if (list) await client.unsafe(`truncate ${list} restart identity cascade`);
}

async function main() {
  console.log("Seeding local Postgres (single-tenant: Batik Nusantara)…");
  await truncateAll();

  // plans (config)
  await db.insert(schema.plans).values(PLANS.map((p) => ({ key: p.key, name: p.name, priceIdr: p.price, blurb: p.blurb, features: p.features })));

  // the one account + owner + store + membership + settings + stats
  const [account] = await db.insert(schema.accounts).values({ name: STORE.name, plan: STORE.plan, createdAt: daysAgo(STORE.createdDaysAgo) }).returning();
  const [user] = await db.insert(schema.users).values({ email: STORE.email, name: STORE.owner }).returning();
  const [store] = await db.insert(schema.stores).values({
    accountId: account.id,
    name: STORE.name,
    slug: slugify(STORE.name),
    city: STORE.city,
    plan: STORE.plan,
    status: STORE.status,
    createdAt: daysAgo(STORE.createdDaysAgo),
  }).returning();
  await db.insert(schema.storeUsers).values({ storeId: store.id, userId: user.id, role: "owner", acceptedAt: daysAgo(STORE.createdDaysAgo) });
  const [loc] = await db.insert(schema.locations).values({ storeId: store.id, name: "Gudang Utama", isDefault: true }).returning();
  await db.insert(schema.storeSettings).values({ storeId: store.id });
  await db.insert(schema.storeStats).values({ storeId: store.id, gmvIdr: STORE.gmv, ordersCount: STORE.orders, productsCount: CATALOG.length, updatedAt: TODAY });

  // catalog: product → 1 default variant (price) + inventory (stock) + base media (image)
  const seededProducts: Array<{ id: string; variantId: string; category: string; unitsSold: number }> = [];
  for (const c of CATALOG) {
    const [p] = await db.insert(schema.products).values({
      storeId: store.id,
      title: c.name,
      handle: c.slug,
      category: c.category,
      status: c.status,
      emoji: c.emoji,
      unitsSold: c.unitsSold,
      hasVariants: false,
      createdAt: new Date(c.addedTs),
    }).returning();
    const [v] = await db.insert(schema.productVariants).values({ productId: p.id, storeId: store.id, title: "Default", priceIdr: c.price, position: 0 }).returning();
    await db.insert(schema.inventoryLevels).values({ variantId: v.id, locationId: loc.id, available: c.stock });
    await db.insert(schema.productMedia).values({ productId: p.id, url: `/products/${c.slug}.webp`, position: 0 });
    seededProducts.push({ id: p.id, variantId: v.id, category: c.category, unitsSold: c.unitsSold });
  }

  // customers (capture name → id for order linking)
  const custRows = await db.insert(schema.customers).values(
    CUSTOMERS.map((c) => ({
      storeId: store.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      city: c.city,
      ordersCount: c.orders,
      totalSpentIdr: c.spent,
      segment: c.segment,
      createdAt: new Date(ADMIN_TODAY.getTime() - c.joinedDaysAgo * 86_400_000),
    })),
  ).returning({ id: schema.customers.id, name: schema.customers.name });
  const custByName = new Map(custRows.map((c) => [c.name, c.id]));

  // discounts (startsAt/endsAt anchored to the admin TODAY → real terjadwal/aktif/kadaluarsa)
  await db.insert(schema.discounts).values(
    DISCOUNTS.map((d) => ({
      storeId: store.id,
      code: d.code,
      kind: d.kind,
      value: d.value,
      usageLimit: d.limit,
      usedCount: d.used,
      startsAt: new Date(ADMIN_TODAY.getTime() - d.startDaysAgo * 86_400_000),
      endsAt: new Date(ADMIN_TODAY.getTime() + d.endsInDays * 86_400_000),
      status: d.status,
    })),
  );

  // collections + membership (counts become real)
  for (const col of COLLECTIONS) {
    const [c] = await db.insert(schema.collections).values({ storeId: store.id, title: col.name, handle: slugify(col.name), emoji: col.emoji, type: col.type, published: col.published }).returning();
    let members: string[];
    if (col.name === "Produk Terlaris") {
      members = [...seededProducts].sort((a, b) => b.unitsSold - a.unitsSold).slice(0, 10).map((p) => p.id);
    } else if (col.name === "Promo Gajian") {
      members = seededProducts.slice(0, 8).map((p) => p.id);
    } else {
      members = seededProducts.filter((p) => p.category === col.name).map((p) => p.id);
    }
    if (members.length) {
      await db.insert(schema.collectionProducts).values(members.map((productId, i) => ({ collectionId: c.id, productId, position: i })));
    }
  }

  // orders (+ line items + payment) — customers link by name
  for (const o of ORDERS_SEED) {
    const [ord] = await db.insert(schema.orders).values({
      storeId: store.id,
      number: o.number,
      customerId: custByName.get(o.customer) ?? null,
      status: o.status,
      financialStatus: o.status === "batal" ? "pending" : "dibayar",
      channel: CHANNEL_MAP[o.channel],
      subtotalIdr: o.total,
      totalIdr: o.total,
      city: o.city,
      placedAt: minutesAgo(o.minutesAgo),
    }).returning();
    await db.insert(schema.orderLineItems).values(
      o.picks.map((idx) => ({ orderId: ord.id, variantId: seededProducts[idx].variantId, title: CATALOG[idx].name, qty: 1, priceIdr: CATALOG[idx].price, totalIdr: CATALOG[idx].price })),
    );
    await db.insert(schema.payments).values({ orderId: ord.id, method: "transfer", amountIdr: o.total, status: o.status === "batal" ? "gagal" : "berhasil", paidAt: o.status === "batal" ? null : minutesAgo(o.minutesAgo) });
  }

  // invoices for this account
  await db.insert(schema.invoices).values(
    INVOICES.map((inv) => ({ number: inv.number, accountId: account.id, storeId: store.id, planKey: STORE.plan, amountIdr: planPrice(STORE.plan), status: inv.status, issuedAt: daysAgo(inv.daysAgo) })),
  );

  // platform activity
  await db.insert(schema.platformActivity).values(ACTIVITY.map((a) => ({ kind: a.kind, text: a.text, ts: minutesAgo(a.minutesAgo) })));

  // platform-managed payments / shipping / COD (ADR 0004) — platform-level, not per-store
  await db.insert(schema.platformPaymentGateways).values([
    { provider: "midtrans", enabled: true, isCod: false },
    { provider: "xendit", enabled: true, isCod: false },
    { provider: "duitku", enabled: false, isCod: false },
  ]);
  await db.insert(schema.shippingAggregator).values({ provider: "biteship", enabled: true });
  await db.insert(schema.platformCouriers).values(
    [
      ["JNE", ["Reguler", "YES", "OKE"], true],
      ["J&T Express", ["EZ", "Ekonomi"], true],
      ["SiCepat", ["REG", "BEST", "GOKIL"], true],
      ["AnterAja", ["Reguler", "Same Day"], true],
      ["Pos Indonesia", ["Kilat Khusus", "Reguler"], false],
      ["GoSend", ["Instant", "Same Day"], true],
      ["GrabExpress", ["Instant", "Same Day"], true],
    ].map(([courier, services, enabled]) => ({ courier: courier as string, services, enabled: enabled as boolean })),
  );
  await db.insert(schema.platformCod).values({ enabled: true, maxAmountIdr: 2_000_000, allowedProvinces: ["DI Yogyakarta", "Jawa Tengah", "Jawa Barat", "DKI Jakarta", "Banten", "Jawa Timur"], feePct: 0 });

  console.log(`Seeded: ${PLANS.length} plans, 1 store (${STORE.name}), ${CATALOG.length} products, ${COLLECTIONS.length} collections, ${CUSTOMERS.length} customers, ${ORDERS_SEED.length} orders, ${DISCOUNTS.length} discounts, ${INVOICES.length} invoices, ${ACTIVITY.length} activity, platform payments/shipping/COD.`);
  await client.end();
}

main().catch(async (e) => {
  console.error(e);
  await client.end();
  process.exit(1);
});
