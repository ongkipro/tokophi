// Deterministic mock dataset for TokoΦ admin.
// Everything is anchored to a fixed TODAY so server & client render identically
// (no hydration mismatch) and the demo is stable. Swap this file for a real API later.

import { MAIN_MENU, FOOTER_MENU, type MenuItem } from "@tokophi/data/menu";

export const TODAY = new Date("2026-06-30T00:00:00");

// ---- seeded PRNG (mulberry32) ----
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type DayPoint = {
  date: string; // yyyy-mm-dd
  ts: number;
  sales: number;
  orders: number;
  visitors: number;
};

// 120 days ending TODAY. Weekly seasonality (weekend dip for B2C-ish) + slow uptrend + noise.
function buildDays(): DayPoint[] {
  const rnd = mulberry32(20260701);
  const days: DayPoint[] = [];
  const N = 120;
  for (let i = N - 1; i >= 0; i--) {
    const d = new Date(TODAY);
    d.setDate(d.getDate() - i);
    const dow = d.getDay(); // 0 sun
    const weekend = dow === 0 || dow === 6 ? 0.82 : 1;
    const payday = d.getDate() === 25 || d.getDate() === 1 ? 1.35 : 1; // Indonesian payday bumps
    const trend = 1 + (N - i) / N * 0.55; // grows over time
    const noise = 0.8 + rnd() * 0.45;
    const base = 2_600_000; // ~Rp2.6jt/day baseline
    const sales = Math.round(base * weekend * payday * trend * noise);
    const aov = 145_000 + Math.round(rnd() * 90_000);
    const orders = Math.max(1, Math.round(sales / aov));
    const visitors = Math.round(orders * (22 + rnd() * 16)); // ~2-4% conversion
    days.push({
      date: d.toISOString().slice(0, 10),
      ts: d.getTime(),
      sales,
      orders,
      visitors,
    });
  }
  return days;
}

export const DAYS = buildDays();

// Distribute a day's totals across 24 hours with a daytime + evening curve.
const HOUR_WEIGHTS = [
  0.3, 0.2, 0.15, 0.1, 0.1, 0.2, 0.5, 1, 1.6, 2, 2.2, 2.4, 2.5, 2.2, 2, 2.1, 2.3,
  2.6, 3, 3.4, 3.2, 2.4, 1.4, 0.7,
];
export function hourlyFor(day: DayPoint) {
  const wsum = HOUR_WEIGHTS.reduce((a, b) => a + b, 0);
  const rnd = mulberry32(day.ts % 2147483647);
  return HOUR_WEIGHTS.map((w, h) => {
    const frac = (w / wsum) * (0.85 + rnd() * 0.3);
    return {
      hour: h,
      label: `${String(h).padStart(2, "0")}:00`,
      sales: Math.round(day.sales * frac),
      orders: Math.max(0, Math.round(day.orders * frac)),
      visitors: Math.round(day.visitors * frac),
    };
  });
}

// ---- products ----
export type Product = {
  id: string;
  name: string;
  handle?: string;
  emoji: string;
  image: string; // /products/<slug>.webp
  price: number;
  stock: number;
  status: "active" | "draft";
  category: string;
  unitsSold: number;
  addedTs: number; // when the product was added (ms since epoch, deterministic)
  media?: { id: string; url: string }[]; // real product_media rows (editor)
  // editor read-back fields (persisted, returned by getProduct — not in the list/mock fixtures)
  description?: string;
  productType?: string;
  vendor?: string;
  compareAt?: number | null;
  cost?: number | null;
  sku?: string;
  hasVariants?: boolean;
  options?: { name: string; values: string[] }[]; // option definitions in order (editor)
  variants?: { option1: string | null; option2: string | null; option3: string | null; sku: string | null; price: number; stock: number }[];
  weightGrams?: number | null; // shipping weight (default variant)
  weightMissing?: boolean; // ANY variant has NULL weight_grams → ongkir falls back to 500g (list warning)
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
};
// Fashion niche (women's clothing). image = /products/<slug>.webp (AI-generated catalog photos).
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
export const PRODUCTS: Product[] = PRODUCT_SEED.map(([name, emoji, price, category, image], i) => {
  const rnd = mulberry32(1000 + i * 7);
  return {
    id: `PRD-${1001 + i}`,
    name,
    emoji,
    image: `/products/${image}.webp`,
    price,
    stock: Math.round(5 + rnd() * 240),
    status: rnd() > 0.12 ? "active" : "draft",
    category,
    unitsSold: Math.round(30 + rnd() * 900),
    // added 1–80 days ago at a seeded time of day (08:00–18:59)
    addedTs:
      TODAY.getTime() -
      (1 + Math.floor(rnd() * 80)) * 86_400_000 +
      (8 + Math.floor(rnd() * 11)) * 3_600_000 +
      Math.floor(rnd() * 60) * 60_000,
  };
});
// Curated variety for a realistic demo (a couple of drafts + low-stock items).
PRODUCTS[7].status = "draft";   // Lip Cream Matte
PRODUCTS[12].status = "draft";  // Mainan Edukasi Kayu
PRODUCTS[9].stock = 8;          // Earphone Bluetooth TWS — menipis
PRODUCTS[3].stock = 14;         // Tas Ransel Anti Air — menipis

// 5-image gallery per product (base + -2..-5) — same files as the storefront (1:1).
export const productImages = (p: Product): string[] => [
  p.image,
  ...[2, 3, 4, 5].map((n) => p.image.replace(/\.webp$/, `-${n}.webp`)),
];

// ---- orders ----
export type OrderStatus = "baru" | "diproses" | "dikirim" | "selesai" | "batal" | "retur";
export type Order = {
  id: string;
  customer: string;
  city: string;
  total: number;
  items: number;
  status: OrderStatus;
  channel: string;
  minutesAgo: number;
  awb?: string | null;
  courierName?: string | null;
};
const NAMES = [
  "Budi Santoso", "Siti Nurhaliza", "Dewi Lestari", "Agus Salim", "Rina Wijaya",
  "Andi Pratama", "Putri Ayu", "Rizky Ramadhan", "Maya Sari", "Fajar Nugroho",
  "Indah Permata", "Doni Kusuma", "Lina Marlina", "Hendra Gunawan", "Wulan Dari",
];
const CITIES = ["Jakarta", "Bandung", "Surabaya", "Medan", "Makassar", "Semarang", "Yogyakarta", "Denpasar", "Bekasi", "Depok"];
// Attribution/traffic source (NOT a sales channel — the only sales channel is Toko Online).
const CHANNELS = ["Meta Ads", "TikTok Ads", "Google Ads", "Organic", "Other"];

function buildOrders(): Order[] {
  const rnd = mulberry32(555);
  const out: Order[] = [];
  for (let i = 0; i < 60; i++) {
    const items = 1 + Math.floor(rnd() * 4);
    let total = 0;
    for (let k = 0; k < items; k++) total += PRODUCTS[Math.floor(rnd() * PRODUCTS.length)].price;
    const sr = rnd();
    const status: OrderStatus =
      sr < 0.12 ? "baru" : sr < 0.32 ? "diproses" : sr < 0.6 ? "dikirim" : sr < 0.93 ? "selesai" : "batal";
    out.push({
      id: `#INV-${4821 - i}`,
      customer: NAMES[Math.floor(rnd() * NAMES.length)],
      city: CITIES[Math.floor(rnd() * CITIES.length)],
      total,
      items,
      status,
      channel: CHANNELS[Math.floor(rnd() * CHANNELS.length)],
      minutesAgo: Math.round(i * (12 + rnd() * 60) + rnd() * 8),
    });
  }
  return out.sort((a, b) => a.minutesAgo - b.minutesAgo);
}
export const ORDERS = buildOrders();

// ---- live activity feed ----
export type Activity = {
  id: string;
  kind: "order" | "visitor" | "review" | "stock" | "signup";
  text: string;
  minutesAgo: number;
};
export const ACTIVITIES: Activity[] = (() => {
  const rnd = mulberry32(909);
  const items: Activity[] = [];
  const templates: Array<[Activity["kind"], (r: number) => string]> = [
    ["order", () => `${NAMES[Math.floor(rnd() * NAMES.length)]} dari ${CITIES[Math.floor(rnd() * CITIES.length)]} membuat pesanan baru`],
    ["visitor", () => `${Math.round(3 + rnd() * 20)} pengunjung sedang melihat "${PRODUCTS[Math.floor(rnd() * PRODUCTS.length)].name}"`],
    ["review", () => `Ulasan bintang ${4 + Math.round(rnd())} untuk "${PRODUCTS[Math.floor(rnd() * PRODUCTS.length)].name}"`],
    ["stock", () => `Stok "${PRODUCTS[Math.floor(rnd() * PRODUCTS.length)].name}" tinggal ${Math.round(1 + rnd() * 6)}`],
    ["signup", () => `${NAMES[Math.floor(rnd() * NAMES.length)]} mendaftar sebagai pelanggan baru`],
  ];
  for (let i = 0; i < 16; i++) {
    const [kind, fn] = templates[Math.floor(rnd() * templates.length)];
    items.push({ id: `act-${i}`, kind, text: fn(rnd()), minutesAgo: Math.round(i * 4 + rnd() * 5) });
  }
  return items.sort((a, b) => a.minutesAgo - b.minutesAgo);
})();

export const CUSTOMER_COUNT = 3128;

// ---- customers ----
export type Segment = "baru" | "reguler" | "loyal" | "vip";
export type Customer = {
  id: string; name: string; email: string; phone: string; city: string;
  orders: number; spent: number; segment: Segment; joinedDaysAgo: number;
  tags?: string[]; notes?: string;
};
export const CUSTOMERS: Customer[] = (() => {
  const rnd = mulberry32(4242);
  const out: Customer[] = [];
  const pool = [...NAMES, "Bayu Aji", "Citra Kirana", "Eko Prasetyo", "Fitri Handayani", "Gilang Ramadhan", "Hana Salsabila", "Irfan Maulana", "Kartika Sari", "Lukman Hakim", "Nadia Zahra"];
  for (let i = 0; i < 24; i++) {
    const name = pool[i % pool.length];
    const orders = Math.round(1 + rnd() * 38);
    const spent = orders * (90_000 + Math.round(rnd() * 260_000));
    const segment: Segment = spent > 6_000_000 ? "vip" : orders > 12 ? "loyal" : orders > 3 ? "reguler" : "baru";
    out.push({
      id: `CUST-${2001 + i}`,
      name,
      email: name.toLowerCase().replace(/[^a-z]+/g, ".") + "@mail.com",
      phone: "0812" + String(1000000 + Math.floor(rnd() * 8999999)),
      city: CITIES[Math.floor(rnd() * CITIES.length)],
      orders, spent, segment,
      joinedDaysAgo: Math.round(rnd() * 400),
    });
  }
  return out.sort((a, b) => b.spent - a.spent);
})();

// ---- discounts ----
export type DiscountType = "persen" | "nominal" | "ongkir";
export type Discount = {
  id: string; code: string; type: DiscountType; value: number;
  status: "aktif" | "terjadwal" | "kadaluarsa"; used: number; limit: number; endsInDays: number;
};
export const DISCOUNTS: Discount[] = [
  { id: "D1", code: "GAJIAN25", type: "persen", value: 25, status: "aktif", used: 342, limit: 1000, endsInDays: 4 },
  { id: "D2", code: "ONGKIRGRATIS", type: "ongkir", value: 0, status: "aktif", used: 1289, limit: 5000, endsInDays: 12 },
  { id: "D3", code: "NEWUSER50K", type: "nominal", value: 50_000, status: "aktif", used: 210, limit: 500, endsInDays: 30 },
  { id: "D4", code: "FLASH1212", type: "persen", value: 40, status: "terjadwal", used: 0, limit: 2000, endsInDays: 45 },
  { id: "D5", code: "RAMADHAN15", type: "persen", value: 15, status: "kadaluarsa", used: 890, limit: 900, endsInDays: -10 },
  { id: "D6", code: "MEMBERVIP", type: "nominal", value: 100_000, status: "aktif", used: 76, limit: 300, endsInDays: 60 },
];

// ---- CMS: pages (modeled on Shopify Page: title/handle/body/isPublished/templateSuffix/seo) ----
export type CmsPage = { id: string; title: string; handle: string; published: boolean; updatedDaysAgo: number; template: string; views: number };
export const PAGES: CmsPage[] = [
  { id: "PG-1", title: "Tentang Kami", handle: "tentang-kami", published: true, updatedDaysAgo: 3, template: "page", views: 1240 },
  { id: "PG-2", title: "Kontak", handle: "kontak", published: true, updatedDaysAgo: 12, template: "page.contact", views: 980 },
  { id: "PG-3", title: "Cara Pemesanan", handle: "cara-pemesanan", published: true, updatedDaysAgo: 8, template: "page", views: 2110 },
  { id: "PG-4", title: "Kebijakan Pengembalian & Refund", handle: "kebijakan-pengembalian", published: true, updatedDaysAgo: 21, template: "page", views: 640 },
  { id: "PG-5", title: "Syarat & Ketentuan", handle: "syarat-ketentuan", published: true, updatedDaysAgo: 30, template: "page", views: 410 },
  { id: "PG-6", title: "Kebijakan Privasi", handle: "kebijakan-privasi", published: true, updatedDaysAgo: 30, template: "page", views: 305 },
  { id: "PG-7", title: "FAQ — Pertanyaan Umum", handle: "faq", published: false, updatedDaysAgo: 1, template: "page", views: 0 },
];

// ---- CMS: blog + articles (modeled on Shopify Blog + Article) ----
export const BLOG_CATEGORIES = ["Berita Toko", "Tips & Panduan"] as const;
// `body` + `imageUrl` are OPTIONAL here only because the mock fixtures below predate them. The DB
// read layer (lib/data/articles.ts) always supplies both — and must, or the editor writes back an
// empty body over the merchant's text. See the note on `sel` there.
export type BlogPost = { id: string; title: string; handle: string; blog: string; author: string; published: boolean; publishedDaysAgo: number; excerpt: string; body?: string; imageUrl?: string; comments: number };
export const BLOG_POSTS: BlogPost[] = [
  { id: "BP-1", title: "Promo Gajian: Diskon s/d 40% Sepanjang Bulan Ini", handle: "promo-gajian-diskon", blog: "Berita Toko", author: "Ongki Pratama", published: true, publishedDaysAgo: 2, excerpt: "Nikmati potongan harga untuk ratusan produk pilihan selama periode gajian.", comments: 8 },
  { id: "BP-2", title: "5 Tips Memilih Ukuran Baju yang Pas saat Belanja Online", handle: "tips-memilih-ukuran-baju", blog: "Tips & Panduan", author: "Sari Melati", published: true, publishedDaysAgo: 5, excerpt: "Panduan singkat agar tidak salah ukuran ketika belanja fashion secara online.", comments: 3 },
  { id: "BP-3", title: "Cara Merawat Sepatu Sneakers Agar Awet", handle: "cara-merawat-sneakers", blog: "Tips & Panduan", author: "Sari Melati", published: true, publishedDaysAgo: 9, excerpt: "Langkah mudah membersihkan dan menyimpan sneakers kesayangan.", comments: 12 },
  { id: "BP-4", title: "Pilihan Ekspedisi & Estimasi Sampai", handle: "pilihan-ekspedisi-estimasi-sampai", blog: "Berita Toko", author: "Ongki Pratama", published: true, publishedDaysAgo: 14, excerpt: "Ongkir semua ekspedisi tampil langsung di checkout — pilih yang termurah atau tercepat.", comments: 5 },
  { id: "BP-5", title: "Rekomendasi Hadiah untuk Anak Sesuai Usia", handle: "rekomendasi-hadiah-anak", blog: "Tips & Panduan", author: "Dewi Anggraini", published: false, publishedDaysAgo: 1, excerpt: "Bingung memilih mainan edukatif? Simak rekomendasi berdasarkan usia anak.", comments: 0 },
  { id: "BP-6", title: "Panduan Klaim Garansi Produk Elektronik", handle: "panduan-klaim-garansi", blog: "Tips & Panduan", author: "Sari Melati", published: true, publishedDaysAgo: 25, excerpt: "Ketahui prosedur dan syarat klaim garansi agar prosesnya cepat.", comments: 2 },
];

// ---- Navigation menus (modeled on Shopify Menu + MenuItem, itemType ~ MenuItemType) ----
export type NavItemType = "beranda" | "koleksi" | "produk" | "halaman" | "blog" | "url";
export type NavItem = { id: string; title: string; type: NavItemType; target: string; children?: NavItem[] };
export type NavMenu = { handle: string; title: string; isDefault: boolean; items: NavItem[] };
// Derived from the shared @tokophi/data source so the admin menu builder and
// the storefront nav never drift (single source of truth). label→title, href→target.
function toNavItems(items: MenuItem[]): NavItem[] {
  return items.map((it) => ({
    id: it.id,
    title: it.label,
    type: it.type,
    target: it.href,
    children: it.children ? toNavItems(it.children) : undefined,
  }));
}

export const MENUS: NavMenu[] = [
  { handle: "main-menu", title: "Menu Utama", isDefault: true, items: toNavItems(MAIN_MENU) },
  { handle: "footer", title: "Menu Footer", isDefault: false, items: toNavItems(FOOTER_MENU) },
];

// ---- marketing: ad channels + tracking pixels (Meta / Google / TikTok) ----
// REMOVED (2026-07-13): the AdChannel/AdCampaign types and the AD_CHANNELS fixture.
// There is NO Meta/Google/TikTok ad integration, so ad spend / impressions / clicks /
// ROAS / Pixel IDs have no source of truth and must never be rendered. /pemasaran now
// uses `AdChannelStatus` from lib/data/marketing.ts: channel labels + a not-connected
// status + orders/revenue ATTRIBUTED from real `orders.channel` rows. Do not reintroduce
// ad-performance fixtures here.

// ---- product sub-modules: collections (Kategori), purchase orders (Pembelian) ----
export type Collection = { id: string; name: string; handle?: string; emoji: string; products: number; type: "manual" | "otomatis"; published: boolean };
// DB-enum-valued condition (field ∈ tag/title/type/price/stock/category, operator ∈ eq/neq/gt/lt/contains).
export type CollectionCondition = { field: string; operator: string; value: string };
// Everything the collection editor loads + saves — the flat Collection lacks description/SEO/members/conditions.
export type CollectionDetail = {
  id: string; name: string; handle: string; description: string;
  type: "manual" | "otomatis"; match: "all" | "any"; published: boolean;
  seoTitle: string; seoDesc: string; emoji: string;
  /** Uploaded cover image (`collections.image_url`). "" = none → fall back to `emoji`. */
  imageUrl: string;
  memberIds: string[]; conditions: CollectionCondition[];
};
export const COLLECTIONS: Collection[] = [
  { id: "COL-1", name: "Dress", emoji: "👗", products: 4, type: "otomatis", published: true },
  { id: "COL-2", name: "Atasan", emoji: "👚", products: 3, type: "otomatis", published: true },
  { id: "COL-3", name: "Bawahan", emoji: "👖", products: 2, type: "otomatis", published: true },
  { id: "COL-4", name: "Busana Muslim", emoji: "🧕", products: 3, type: "otomatis", published: true },
  { id: "COL-5", name: "Promo Gajian", emoji: "🏷️", products: 8, type: "manual", published: true },
  { id: "COL-6", name: "Produk Terlaris", emoji: "🔥", products: 10, type: "otomatis", published: true },
  { id: "COL-7", name: "Loungewear", emoji: "🩱", products: 1, type: "otomatis", published: true },
  { id: "COL-8", name: "Outerwear", emoji: "🧥", products: 2, type: "otomatis", published: false },
];

export type POStatus = "draft" | "dipesan" | "sebagian" | "diterima";
export type PurchaseOrder = { id: string; supplier: string; status: POStatus; items: number; total: number; etaDays: number; createdDaysAgo: number };
export const PURCHASE_ORDERS: PurchaseOrder[] = [
  { id: "PO-1042", supplier: "CV Sumber Rejeki", status: "dipesan", items: 4, total: 12_400_000, etaDays: 5, createdDaysAgo: 2 },
  { id: "PO-1041", supplier: "PT Grosir Nusantara", status: "sebagian", items: 6, total: 8_950_000, etaDays: 2, createdDaysAgo: 6 },
  { id: "PO-1040", supplier: "Toko Elektronik Jaya", status: "diterima", items: 3, total: 15_600_000, etaDays: -1, createdDaysAgo: 12 },
  { id: "PO-1039", supplier: "CV Sumber Rejeki", status: "diterima", items: 2, total: 4_200_000, etaDays: -4, createdDaysAgo: 18 },
  { id: "PO-1038", supplier: "Kopi Gayo Supplier", status: "draft", items: 1, total: 2_340_000, etaDays: 10, createdDaysAgo: 1 },
  { id: "PO-1037", supplier: "PT Grosir Nusantara", status: "dipesan", items: 5, total: 9_800_000, etaDays: 7, createdDaysAgo: 3 },
];

// ---- customer sub-modules: segments (Segmen), reviews (Ulasan) ----
export type CustSegment = { id: string; name: string; count: number; growth: number; description: string };
export const SEGMENTS: CustSegment[] = [
  { id: "SEG-1", name: "Pelanggan VIP", count: 128, growth: 12.4, description: "Total belanja lebih dari Rp6 juta" },
  { id: "SEG-2", name: "Pelanggan Loyal", count: 356, growth: 8.1, description: "Lebih dari 12 pesanan" },
  { id: "SEG-3", name: "Pelanggan Baru (30 hari)", count: 271, growth: 24.8, description: "Bergabung dalam 30 hari terakhir" },
  { id: "SEG-4", name: "Belum Pernah Belanja", count: 642, growth: -3.2, description: "Terdaftar tapi belum ada pesanan" },
  { id: "SEG-5", name: "Berisiko Churn", count: 89, growth: 5.6, description: "Tidak belanja lebih dari 90 hari" },
  { id: "SEG-6", name: "Pelanggan Kota Besar", count: 1204, growth: 6.9, description: "Jakarta, Bandung, Surabaya" },
];

export type ReviewStatus = "terbit" | "menunggu";
export type Review = { id: string; customer: string; product: string; emoji: string; rating: number; text: string; reply?: string; status: ReviewStatus; daysAgo: number };
export const REVIEWS: Review[] = [
  { id: "RV-1", customer: "Siti Nurhaliza", product: "Kopi Arabika Gayo 250g", emoji: "☕", rating: 5, text: "Kopinya wangi dan segar, pengiriman cepat. Recommended!", status: "terbit", daysAgo: 1 },
  { id: "RV-2", customer: "Budi Santoso", product: "Sepatu Sneakers Lokal", emoji: "👟", rating: 4, text: "Bahan bagus, ukuran pas. Cuma warnanya sedikit beda dari foto.", status: "terbit", daysAgo: 2 },
  { id: "RV-3", customer: "Rina Wijaya", product: "Skincare Serum Vitamin C", emoji: "🧴", rating: 5, text: "Cocok di kulit saya, hasilnya cerah dalam 2 minggu.", status: "menunggu", daysAgo: 1 },
  { id: "RV-4", customer: "Andi Pratama", product: "Earphone Bluetooth TWS", emoji: "🎧", rating: 3, text: "Suara oke, tapi baterai agak boros. Lumayan untuk harganya.", status: "terbit", daysAgo: 4 },
  { id: "RV-5", customer: "Maya Sari", product: "Tas Ransel Anti Air", emoji: "🎒", rating: 5, text: "Kuat dan benar-benar anti air. Muat banyak juga.", status: "menunggu", daysAgo: 2 },
  { id: "RV-6", customer: "Doni Kusuma", product: "Power Bank 10.000mAh", emoji: "🔋", rating: 4, text: "Ngecas cepat, ringkas dibawa. Puas.", status: "terbit", daysAgo: 6 },
  { id: "RV-7", customer: "Putri Ayu", product: "Lip Cream Matte", emoji: "💄", rating: 2, text: "Warnanya bagus tapi bikin bibir kering.", status: "menunggu", daysAgo: 3 },
  { id: "RV-8", customer: "Hendra Gunawan", product: "Madu Hutan Asli 500ml", emoji: "🍯", rating: 5, text: "Madunya asli, rasa mantap. Langganan terus.", status: "terbit", daysAgo: 8 },
];

// ---- marketing: performance by Indonesian province ----
// REMOVED (2026-07-13): PROVINCES / ProvinceStat / AD_PROVINCES. The per-province ad
// "performance" (spend, impressions, clicks, conversions, revenue, reach) was fabricated:
// `orders.province` is NULL on 100% of rows and there is no ad integration, so nothing
// could ever compute it. Real per-region sales (by city, from orders) live in
// lib/data/analytics.ts → getRegionSales().

// ---- CRM: sales pipeline (leads), WhatsApp follow-ups, message templates ----
export type LeadSource = "WhatsApp" | "Instagram" | "TikTok" | "Referral" | "Marketplace";
export type LeadStage = "baru" | "dihubungi" | "nego" | "closing" | "menang" | "kalah";
export type Lead = { id: string; name: string; phone: string; source: LeadSource; stage: LeadStage; value_idr: number; lastContactDaysAgo: number; note: string };
export const LEADS: Lead[] = [
  { id: "LD-1", name: "Rina Wijaya", phone: "6281234500001", source: "WhatsApp", stage: "baru", value_idr: 450_000, lastContactDaysAgo: 0, note: "Tanya stok kaos ukuran XL" },
  { id: "LD-2", name: "Budi Santoso", phone: "6281234500002", source: "Instagram", stage: "baru", value_idr: 275_000, lastContactDaysAgo: 0, note: "DM soal sepatu sneakers" },
  { id: "LD-3", name: "Maya Sari", phone: "6281234500003", source: "TikTok", stage: "dihubungi", value_idr: 780_000, lastContactDaysAgo: 1, note: "Minta katalog lengkap" },
  { id: "LD-4", name: "Andi Pratama", phone: "6281234500004", source: "WhatsApp", stage: "dihubungi", value_idr: 210_000, lastContactDaysAgo: 2, note: "Nanya ongkir ke Medan" },
  { id: "LD-5", name: "Dewi Lestari", phone: "6281234500005", source: "Referral", stage: "nego", value_idr: 1_250_000, lastContactDaysAgo: 1, note: "Minta diskon beli 5 pcs" },
  { id: "LD-6", name: "Rizky Ramadhan", phone: "6281234500006", source: "WhatsApp", stage: "nego", value_idr: 640_000, lastContactDaysAgo: 3, note: "Nego harga grosir" },
  { id: "LD-7", name: "Putri Ayu", phone: "6281234500007", source: "Instagram", stage: "closing", value_idr: 920_000, lastContactDaysAgo: 0, note: "Siap transfer, tunggu invoice" },
  { id: "LD-8", name: "Hendra Gunawan", phone: "6281234500008", source: "Marketplace", stage: "closing", value_idr: 355_000, lastContactDaysAgo: 1, note: "Konfirmasi alamat kirim" },
  { id: "LD-9", name: "Wulan Dari", phone: "6281234500009", source: "WhatsApp", stage: "menang", value_idr: 1_480_000, lastContactDaysAgo: 2, note: "Sudah bayar, repeat order" },
  { id: "LD-10", name: "Fajar Nugroho", phone: "6281234500010", source: "TikTok", stage: "menang", value_idr: 530_000, lastContactDaysAgo: 4, note: "Closing dari live TikTok" },
  { id: "LD-11", name: "Indah Permata", phone: "6281234500011", source: "Instagram", stage: "kalah", value_idr: 180_000, lastContactDaysAgo: 6, note: "Pindah ke kompetitor" },
  { id: "LD-12", name: "Doni Kusuma", phone: "6281234500012", source: "WhatsApp", stage: "baru", value_idr: 390_000, lastContactDaysAgo: 0, note: "Tanya ready stock power bank" },
];

export type FollowupType = "keranjang" | "pembayaran" | "konfirmasi" | "pascabeli" | "repeat" | "ulasan";
export type FollowupStatus = "menunggu" | "terkirim" | "dibalas" | "selesai";
export type Followup = { id: string; customer: string; phone: string; type: FollowupType; context: string; dueDays: number; status: FollowupStatus; lastMessage: string };
// dueDays: 0 = hari ini, negatif = telat, positif = akan datang
export const FOLLOWUPS: Followup[] = [
  { id: "FU-1", customer: "Siti Nurhaliza", phone: "6281234511001", type: "keranjang", context: "Kopi Arabika Gayo 250g", dueDays: 0, status: "menunggu", lastMessage: "" },
  { id: "FU-2", customer: "Agus Salim", phone: "6281234511002", type: "pembayaran", context: "#INV-4821 · Rp275.000", dueDays: 0, status: "menunggu", lastMessage: "" },
  { id: "FU-3", customer: "Rina Wijaya", phone: "6281234511003", type: "keranjang", context: "Skincare Serum Vitamin C", dueDays: -1, status: "menunggu", lastMessage: "" },
  { id: "FU-4", customer: "Budi Santoso", phone: "6281234511004", type: "pembayaran", context: "#INV-4818 · Rp189.000", dueDays: -2, status: "menunggu", lastMessage: "" },
  { id: "FU-5", customer: "Maya Sari", phone: "6281234511005", type: "pascabeli", context: "#INV-4815 · Tas Ransel Anti Air", dueDays: 0, status: "terkirim", lastMessage: "Terima kasih sudah belanja! 🙏" },
  { id: "FU-6", customer: "Andi Pratama", phone: "6281234511006", type: "ulasan", context: "Earphone Bluetooth TWS", dueDays: 1, status: "menunggu", lastMessage: "" },
  { id: "FU-7", customer: "Dewi Lestari", phone: "6281234511007", type: "repeat", context: "Terakhir beli 32 hari lalu", dueDays: 0, status: "menunggu", lastMessage: "" },
  { id: "FU-8", customer: "Putri Ayu", phone: "6281234511008", type: "konfirmasi", context: "#INV-4820 · siap dikirim", dueDays: 0, status: "dibalas", lastMessage: "Oke kak, ditunggu ya" },
  { id: "FU-9", customer: "Hendra Gunawan", phone: "6281234511009", type: "pascabeli", context: "#INV-4809 · Madu Hutan Asli", dueDays: -1, status: "selesai", lastMessage: "Barang sudah diterima 👍" },
  { id: "FU-10", customer: "Wulan Dari", phone: "6281234511010", type: "repeat", context: "Pelanggan VIP · 45 hari", dueDays: 2, status: "menunggu", lastMessage: "" },
];

export type WaTemplate = { id: string; name: string; type: FollowupType | "broadcast"; body: string };
// placeholders: {{nama}} {{produk}} {{no_pesanan}} {{total}} {{toko}}
export const WA_TEMPLATES: WaTemplate[] = [
  { id: "WT-1", name: "Keranjang ditinggalkan", type: "keranjang", body: "Halo kak {{nama}} 👋, produk *{{produk}}* masih ada di keranjang. Mau saya bantu proses sekarang? Stok terbatas ya kak 😊 — {{toko}}" },
  { id: "WT-2", name: "Pengingat pembayaran", type: "pembayaran", body: "Hai kak {{nama}}, pesanan {{no_pesanan}} sebesar *{{total}}* menunggu pembayaran. Konfirmasi ya kak biar segera kami kirim 🙏 — {{toko}}" },
  { id: "WT-3", name: "Konfirmasi pesanan", type: "konfirmasi", body: "Halo kak {{nama}}, pesanan {{no_pesanan}} sudah kami terima dan sedang diproses. Terima kasih sudah belanja di {{toko}}! 📦" },
  { id: "WT-4", name: "Terima kasih (pasca-beli)", type: "pascabeli", body: "Terima kasih kak {{nama}} sudah belanja di {{toko}} 🙏 Semoga suka dengan {{produk}}-nya! Kalau butuh apa-apa, chat kami ya 😊" },
  { id: "WT-5", name: "Minta ulasan", type: "ulasan", body: "Hai kak {{nama}}, gimana {{produk}}-nya? 😊 Boleh minta tolong kasih ulasan/bintang ya kak, sangat membantu toko kami 🙏 — {{toko}}" },
  { id: "WT-6", name: "Ajakan repeat order", type: "repeat", body: "Halo kak {{nama}} 👋 Sudah lama nih! Ada produk baru & promo spesial buat pelanggan setia {{toko}}. Mau saya kirim katalognya? 🛍️" },
];
