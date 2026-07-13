// Seed the local Postgres — SINGLE-TENANT MVP: one real store, "Batik Nusantara"
// (the same store the admin manages and the storefront sells). Run:
//   npm run seed -w @tokophi/db   (idempotent — truncates public tables first)
import { db, client, schema } from "./client";
import { scryptSync, randomBytes } from "node:crypto";
import { COURIERS } from "@tokophi/lib/couriers";

// Local auth: scrypt "salt:hash". Dev owner password below (change for real deploys).
const DEV_OWNER_PASSWORD = "tokophi123";
function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
}

const TODAY = new Date("2026-07-02T00:00:00Z");
const daysAgo = (n: number) => new Date(TODAY.getTime() - n * 86_400_000);
const minutesAgo = (n: number) => new Date(TODAY.getTime() - n * 60_000);
// Billing lifecycle dates must be relative to the REAL clock (not the TODAY anchor), else trials/
// periods lapse whenever the deploy date drifts past the anchor — computeBilling uses `new Date()`.
const fromNow = (days: number) => new Date(Date.now() + days * 86_400_000);
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

// Single-plan TokoΦ subscription amounts, PPN 11% inclusive (base 275k/50k + PPN → what's charged).
// Faktur/history recover the DPP + PPN via baseFromTotal(). Mirrors @tokophi/lib/billing.
const SUB_MONTHLY = 305_250; // Rp275.000 + PPN 11%
const SUB_FIRST_MONTH = 55_500; // Rp50.000 + PPN 11%

// Recent monthly billing history for the store.
const INVOICES: Array<{ number: string; status: "dibayar" | "menunggu" | "gagal"; daysAgo: number }> = [
  { number: "INV-9006", status: "menunggu", daysAgo: 2 },
  { number: "INV-9005", status: "dibayar", daysAgo: 32 },
  { number: "INV-9004", status: "dibayar", daysAgo: 62 },
  { number: "INV-9003", status: "dibayar", daysAgo: 92 },
  { number: "INV-9002", status: "dibayar", daysAgo: 122 },
  { number: "INV-9001", status: "dibayar", daysAgo: 152 },
];

const ACTIVITY: Array<{ kind: "signup" | "upgrade" | "payment" | "churn" | "support" | "admin"; text: string; minutesAgo: number }> = [
  { kind: "payment", text: "Pembayaran Rp275.000 dari “Batik Nusantara”", minutesAgo: 52 },
  { kind: "support", text: "Tiket support baru dari “Batik Nusantara”", minutesAgo: 4 * 60 },
  { kind: "payment", text: "“Batik Nusantara” mulai langganan TokoΦ (setelah trial)", minutesAgo: 40 * 24 * 60 },
  { kind: "signup", text: "Toko “Batik Nusantara” mendaftar", minutesAgo: STORE.createdDaysAgo * 24 * 60 },
];

// ---- additional demo stores (platform view + healthcheck variety) ----
// Each gets account + owner user + store + membership + stats + invoices + a few orders,
// engineered so the super-admin healthcheck shows a realistic Sehat/Perhatian/Bermasalah spread.
// (No full catalog — demo stores are platform rows; impersonating them opens an empty admin,
// which is realistic for new/trial merchants. Batik Nusantara stays the rich, fully-seeded one.)
type DemoStore = {
  name: string; owner: string; email: string; city: string;
  plan: "pemula" | "bisnis" | "skala"; status: "active" | "trial" | "suspended";
  gmv: number; orders: number; products: number; createdDaysAgo: number;
  lastOrderDaysAgo: number | null; // null = no orders yet
  invoices: Array<{ status: "dibayar" | "menunggu" | "gagal"; daysAgo: number }>;
  comped?: boolean; // VIP (billing bypassed by platform)
  firstPaid?: boolean; // false → still on the Rp50rb first-month (segment "bulan pertama")
  ship7d?: number; // avg shipments/day over the last 7 days (demo signal for VIP thresholds)
};
const DEMO_STORES: DemoStore[] = [
  // healthy: recent orders, invoices paid
  { name: "Kopi Senja", owner: "Rangga Saputra", email: "rangga@kopisenja.id", city: "Bandung", plan: "bisnis", status: "active", gmv: 42_600_000, orders: 210, products: 22, createdDaysAgo: 95, lastOrderDaysAgo: 1, invoices: [{ status: "dibayar", daysAgo: 2 }, { status: "dibayar", daysAgo: 32 }], ship7d: 8 },
  // BILLING problem: an overdue "menunggu" (>14d) + a failed charge → Bermasalah. On the Rp50rb first month.
  { name: "Hijab Amara", owner: "Amara Zahwa", email: "amara@hijabamara.id", city: "Bekasi", plan: "pemula", status: "active", gmv: 8_500_000, orders: 64, products: 18, createdDaysAgo: 70, lastOrderDaysAgo: 5, invoices: [{ status: "menunggu", daysAgo: 22 }, { status: "gagal", daysAgo: 22 }, { status: "dibayar", daysAgo: 52 }], firstPaid: false, ship7d: 3 },
  // ACTIVITY problem: last order 46d ago on an active paid store → Bermasalah
  { name: "Sepatu Lokal Project", owner: "Dimas Prakoso", email: "dimas@sepatulokal.id", city: "Surabaya", plan: "bisnis", status: "active", gmv: 31_200_000, orders: 140, products: 30, createdDaysAgo: 140, lastOrderDaysAgo: 46, invoices: [{ status: "dibayar", daysAgo: 3 }, { status: "dibayar", daysAgo: 33 }], ship7d: 1 },
  // TRIAL, no orders yet → Perhatian
  { name: "Snack Rumahan Bu Tati", owner: "Tati Suryani", email: "tati@snackrumahan.id", city: "Malang", plan: "pemula", status: "trial", gmv: 0, orders: 0, products: 7, createdDaysAgo: 6, lastOrderDaysAgo: null, invoices: [], ship7d: 0 },
  // SUSPENDED → Bermasalah
  { name: "Gadget Murah ID", owner: "Bayu Anggara", email: "bayu@gadgetmurah.id", city: "Jakarta", plan: "bisnis", status: "suspended", gmv: 19_400_000, orders: 88, products: 40, createdDaysAgo: 210, lastOrderDaysAgo: 30, invoices: [{ status: "gagal", daysAgo: 15 }, { status: "menunggu", daysAgo: 15 }], ship7d: 0 },
  // VIP: high-volume merchant hosted free by the platform (billing bypassed).
  { name: "Tas Rajut Handmade", owner: "Sinta Melati", email: "sinta@tasrajut.id", city: "Yogyakarta", plan: "skala", status: "active", gmv: 55_100_000, orders: 260, products: 12, createdDaysAgo: 160, lastOrderDaysAgo: 18, invoices: [{ status: "dibayar", daysAgo: 33 }], comped: true, ship7d: 42 },
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

// storefront-facing metadata (description, sizes, badge, bestseller, rating, compareAt) — keyed by slug
const STOREFRONT_META: Record<string, { description: string; sizes: string[]; badge?: string; bestseller?: boolean; rating: [number, number]; compareAt?: number }> = {
  "dress-midi-bunga": { description: "Dress midi bahan adem dengan motif bunga pastel. Potongan flowy yang anggun untuk hangout maupun acara semi-formal.", sizes: ["S", "M", "L", "XL"], badge: "Promo", bestseller: true, rating: [4.8, 214], compareAt: 249_000 },
  "blouse-katun": { description: "Blouse katun premium dengan lengan balon yang manis. Ringan, adem, dan mudah dipadupadankan.", sizes: ["S", "M", "L"], bestseller: true, rating: [4.7, 156] },
  "kemeja-oversized": { description: "Kemeja oversized warna soft, tampil effortless dan kekinian. Cocok untuk gaya kasual maupun kerja.", sizes: ["M", "L", "XL"], rating: [4.5, 62] },
  "rok-plisket": { description: "Rok plisket panjang yang jatuh cantik saat bergerak. Pinggang karet, nyaman dipakai seharian.", sizes: ["All Size"], rating: [4.6, 88] },
  "celana-kulot": { description: "Kulot wide leg warna netral, memberi kesan tinggi dan rapi. Bahan tidak menerawang.", sizes: ["S", "M", "L", "XL"], rating: [4.4, 74] },
  "hijab-voal": { description: "Hijab voal ultrafine, jatuh sempurna dan tidak licin. Tersedia warna-warna pastel favorit.", sizes: ["115x115 cm"], bestseller: true, rating: [4.9, 342] },
  "khimar-instan": { description: "Khimar instan jumbo, praktis langsung pakai dengan pet antem. Menutup sempurna dan adem.", sizes: ["All Size"], rating: [4.6, 97] },
  "gamis-syari": { description: "Gamis syari polos bahan wollycrepe yang jatuh dan tidak kaku. Elegan untuk sehari-hari maupun acara.", sizes: ["S", "M", "L", "XL"], rating: [4.7, 128] },
  "tunik-rayon": { description: "Tunik rayon adem dengan panjang menutup pinggul. Warna mustard yang hangat dan mudah dipadukan.", sizes: ["M", "L", "XL"], rating: [4.5, 71] },
  "cardigan-rajut": { description: "Cardigan rajut lembut warna oatmeal. Cocok jadi outer manis untuk berbagai outfit.", sizes: ["All Size"], rating: [4.6, 83] },
  "piyama-satin": { description: "Set piyama satin halus warna sage. Mewah dan nyaman untuk tidur maupun santai di rumah.", sizes: ["M", "L", "XL"], rating: [4.8, 110] },
  "blazer-wanita": { description: "Blazer tailored hitam yang menegaskan siluet. Wajib punya untuk tampilan profesional.", sizes: ["S", "M", "L"], rating: [4.5, 59] },
  "dress-batik": { description: "Dress batik motif modern hasil kolaborasi pengrajin lokal. Anggun, berkelas, dan bernilai budaya.", sizes: ["S", "M", "L", "XL"], badge: "Signature", rating: [4.9, 187], compareAt: 275_000 },
  "jumpsuit-kulot": { description: "Jumpsuit kulot warna terracotta, satu set praktis yang tetap stylish. Nyaman untuk jalan seharian.", sizes: ["M", "L"], rating: [4.6, 66] },
};

// Warna per produk (fashion) — combined with STOREFRONT_META.sizes to make real Warna × Ukuran variants.
const WARNA_BY_SLUG: Record<string, string[]> = {
  "dress-midi-bunga": ["Rose", "Sage", "Dusty Blue"],
  "blouse-katun": ["Putih", "Hitam", "Krem"],
  "kemeja-oversized": ["Putih", "Biru Muda", "Mocca"],
  "rok-plisket": ["Hitam", "Mocca"],
  "celana-kulot": ["Hitam", "Navy", "Khaki"],
  "hijab-voal": ["Dusty Pink", "Sage", "Mauve", "Navy"],
  "khimar-instan": ["Hitam", "Abu", "Navy"],
  "gamis-syari": ["Hitam", "Maroon", "Sage"],
  "tunik-rayon": ["Mustard", "Olive"],
  "cardigan-rajut": ["Oatmeal", "Abu", "Sage"],
  "piyama-satin": ["Sage", "Dusty Pink"],
  "blazer-wanita": ["Hitam", "Beige"],
  "dress-batik": ["Coklat", "Biru"],
  "jumpsuit-kulot": ["Terracotta", "Olive"],
};

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
const COLLECTIONS: Array<{ name: string; emoji: string; type: "manual" | "otomatis"; published: boolean; blurb?: string }> = [
  { name: "Dress", emoji: "👗", type: "otomatis", published: true, blurb: "Dress harian sampai acara spesial" },
  { name: "Atasan", emoji: "👚", type: "otomatis", published: true, blurb: "Blouse, kemeja, & tunik" },
  { name: "Bawahan", emoji: "👖", type: "otomatis", published: true, blurb: "Rok & celana kulot" },
  { name: "Busana Muslim", emoji: "🧕", type: "otomatis", published: true, blurb: "Hijab, khimar, & gamis" },
  { name: "Promo Gajian", emoji: "🏷️", type: "manual", published: true },
  { name: "Produk Terlaris", emoji: "🔥", type: "otomatis", published: true },
  { name: "Loungewear", emoji: "🩱", type: "otomatis", published: true, blurb: "Nyaman untuk di rumah" },
  { name: "Outerwear", emoji: "🧥", type: "otomatis", published: false, blurb: "Cardigan & blazer" },
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

// ---- CMS: pages, blogs, articles ----
const PAGES: Array<{ title: string; handle: string; published: boolean; updatedDaysAgo: number; template: string; views: number }> = [
  { title: "Tentang Kami", handle: "tentang-kami", published: true, updatedDaysAgo: 3, template: "page", views: 1240 },
  { title: "Kontak", handle: "kontak", published: true, updatedDaysAgo: 12, template: "page.contact", views: 980 },
  { title: "Cara Pemesanan", handle: "cara-pemesanan", published: true, updatedDaysAgo: 8, template: "page", views: 2110 },
  { title: "Kebijakan Pengembalian & Refund", handle: "kebijakan-pengembalian", published: true, updatedDaysAgo: 21, template: "page", views: 640 },
  { title: "Syarat & Ketentuan", handle: "syarat-ketentuan", published: true, updatedDaysAgo: 30, template: "page", views: 410 },
  { title: "Kebijakan Privasi", handle: "kebijakan-privasi", published: true, updatedDaysAgo: 30, template: "page", views: 305 },
  { title: "FAQ — Pertanyaan Umum", handle: "faq", published: false, updatedDaysAgo: 1, template: "page", views: 0 },
];
const BLOGS = ["Berita Toko", "Tips & Panduan"];
const ARTICLES: Array<{ title: string; handle: string; blog: string; author: string; published: boolean; publishedDaysAgo: number; excerpt: string; comments: number }> = [
  { title: "Promo Gajian: Diskon s/d 40% Sepanjang Bulan Ini", handle: "promo-gajian-diskon", blog: "Berita Toko", author: "Ongki Pratama", published: true, publishedDaysAgo: 2, excerpt: "Nikmati potongan harga untuk ratusan produk pilihan selama periode gajian.", comments: 8 },
  { title: "5 Tips Memilih Ukuran Baju yang Pas saat Belanja Online", handle: "tips-memilih-ukuran-baju", blog: "Tips & Panduan", author: "Sari Melati", published: true, publishedDaysAgo: 5, excerpt: "Panduan singkat agar tidak salah ukuran ketika belanja fashion secara online.", comments: 3 },
  { title: "Cara Merawat Baju Rajut Agar Awet", handle: "cara-merawat-rajut", blog: "Tips & Panduan", author: "Sari Melati", published: true, publishedDaysAgo: 9, excerpt: "Langkah mudah mencuci dan menyimpan baju rajut agar tidak melar.", comments: 12 },
  { title: "Kami Kini Melayani Pengiriman Instan Se-Jabodetabek", handle: "pengiriman-instan-jabodetabek", blog: "Berita Toko", author: "Ongki Pratama", published: true, publishedDaysAgo: 14, excerpt: "Pesanan sampai di hari yang sama dengan GoSend & GrabExpress.", comments: 5 },
  { title: "Rekomendasi Hadiah untuk Anak Sesuai Usia", handle: "rekomendasi-hadiah-anak", blog: "Tips & Panduan", author: "Dewi Anggraini", published: false, publishedDaysAgo: 1, excerpt: "Bingung memilih mainan edukatif? Simak rekomendasi berdasarkan usia anak.", comments: 0 },
  { title: "Panduan Menentukan Ukuran Baju yang Pas", handle: "panduan-ukuran-baju", blog: "Tips & Panduan", author: "Sari Melati", published: true, publishedDaysAgo: 25, excerpt: "Cara mengukur badan dan memilih size chart agar tidak salah beli.", comments: 2 },
];

// ---- CRM: leads, followups, wa templates ----
const LEAD_SOURCE: Record<string, "whatsapp" | "instagram" | "tiktok" | "referral" | "marketplace"> = {
  WhatsApp: "whatsapp", Instagram: "instagram", TikTok: "tiktok", Referral: "referral", Marketplace: "marketplace",
};
const LEADS: Array<{ name: string; phone: string; source: string; stage: "baru" | "dihubungi" | "nego" | "closing" | "menang" | "kalah"; value: number; lastContactDaysAgo: number; note: string }> = [
  { name: "Rina Wijaya", phone: "6281234500001", source: "WhatsApp", stage: "baru", value: 450_000, lastContactDaysAgo: 0, note: "Tanya stok kaos ukuran XL" },
  { name: "Budi Santoso", phone: "6281234500002", source: "Instagram", stage: "baru", value: 275_000, lastContactDaysAgo: 0, note: "DM soal sepatu sneakers" },
  { name: "Maya Sari", phone: "6281234500003", source: "TikTok", stage: "dihubungi", value: 780_000, lastContactDaysAgo: 1, note: "Minta katalog lengkap" },
  { name: "Andi Pratama", phone: "6281234500004", source: "WhatsApp", stage: "dihubungi", value: 210_000, lastContactDaysAgo: 2, note: "Nanya ongkir ke Medan" },
  { name: "Dewi Lestari", phone: "6281234500005", source: "Referral", stage: "nego", value: 1_250_000, lastContactDaysAgo: 1, note: "Minta diskon beli 5 pcs" },
  { name: "Rizky Ramadhan", phone: "6281234500006", source: "WhatsApp", stage: "nego", value: 640_000, lastContactDaysAgo: 3, note: "Nego harga grosir" },
  { name: "Putri Ayu", phone: "6281234500007", source: "Instagram", stage: "closing", value: 920_000, lastContactDaysAgo: 0, note: "Siap transfer, tunggu invoice" },
  { name: "Hendra Gunawan", phone: "6281234500008", source: "Marketplace", stage: "closing", value: 355_000, lastContactDaysAgo: 1, note: "Konfirmasi alamat kirim" },
  { name: "Wulan Dari", phone: "6281234500009", source: "WhatsApp", stage: "menang", value: 1_480_000, lastContactDaysAgo: 2, note: "Sudah bayar, repeat order" },
  { name: "Fajar Nugroho", phone: "6281234500010", source: "TikTok", stage: "menang", value: 530_000, lastContactDaysAgo: 4, note: "Closing dari live TikTok" },
  { name: "Indah Permata", phone: "6281234500011", source: "Instagram", stage: "kalah", value: 180_000, lastContactDaysAgo: 6, note: "Pindah ke kompetitor" },
  { name: "Doni Kusuma", phone: "6281234500012", source: "WhatsApp", stage: "baru", value: 390_000, lastContactDaysAgo: 0, note: "Tanya ready stock power bank" },
];
type FType = "keranjang" | "pembayaran" | "konfirmasi" | "pascabeli" | "repeat" | "ulasan";
type FStatus = "menunggu" | "terkirim" | "dibalas" | "selesai";
const FOLLOWUPS: Array<{ customer: string; phone: string; type: FType; context: string; dueDays: number; status: FStatus; lastMessage: string }> = [
  { customer: "Siti Nurhaliza", phone: "6281234511001", type: "keranjang", context: "Dress Midi Motif Bunga", dueDays: 0, status: "menunggu", lastMessage: "" },
  { customer: "Agus Salim", phone: "6281234511002", type: "pembayaran", context: "#INV-4821 · Rp275.000", dueDays: 0, status: "menunggu", lastMessage: "" },
  { customer: "Rina Wijaya", phone: "6281234511003", type: "keranjang", context: "Gamis Syari Polos", dueDays: -1, status: "menunggu", lastMessage: "" },
  { customer: "Budi Santoso", phone: "6281234511004", type: "pembayaran", context: "#INV-4818 · Rp189.000", dueDays: -2, status: "menunggu", lastMessage: "" },
  { customer: "Maya Sari", phone: "6281234511005", type: "pascabeli", context: "#INV-4815 · Rok Plisket Panjang", dueDays: 0, status: "terkirim", lastMessage: "Terima kasih sudah belanja! 🙏" },
  { customer: "Andi Pratama", phone: "6281234511006", type: "ulasan", context: "Cardigan Rajut Wanita", dueDays: 1, status: "menunggu", lastMessage: "" },
  { customer: "Dewi Lestari", phone: "6281234511007", type: "repeat", context: "Terakhir beli 32 hari lalu", dueDays: 0, status: "menunggu", lastMessage: "" },
  { customer: "Putri Ayu", phone: "6281234511008", type: "konfirmasi", context: "#INV-4820 · siap dikirim", dueDays: 0, status: "dibalas", lastMessage: "Oke kak, ditunggu ya" },
  { customer: "Hendra Gunawan", phone: "6281234511009", type: "pascabeli", context: "#INV-4809 · Madu Hutan Asli", dueDays: -1, status: "selesai", lastMessage: "Barang sudah diterima 👍" },
  { customer: "Wulan Dari", phone: "6281234511010", type: "repeat", context: "Pelanggan VIP · 45 hari", dueDays: 2, status: "menunggu", lastMessage: "" },
];
const WA_TEMPLATES: Array<{ name: string; type: string; body: string }> = [
  { name: "Keranjang ditinggalkan", type: "keranjang", body: "Halo kak {{nama}} 👋, produk *{{produk}}* masih ada di keranjang. Mau saya bantu proses sekarang? Stok terbatas ya kak 😊 — {{toko}}" },
  { name: "Pengingat pembayaran", type: "pembayaran", body: "Hai kak {{nama}}, pesanan {{no_pesanan}} sebesar *{{total}}* menunggu pembayaran. Konfirmasi ya kak biar segera kami kirim 🙏 — {{toko}}" },
  { name: "Konfirmasi pesanan", type: "konfirmasi", body: "Halo kak {{nama}}, pesanan {{no_pesanan}} sudah kami terima dan sedang diproses. Terima kasih sudah belanja di {{toko}}! 📦" },
  { name: "Terima kasih (pasca-beli)", type: "pascabeli", body: "Terima kasih kak {{nama}} sudah belanja di {{toko}} 🙏 Semoga suka dengan {{produk}}-nya! Kalau butuh apa-apa, chat kami ya 😊" },
  { name: "Minta ulasan", type: "ulasan", body: "Hai kak {{nama}}, gimana {{produk}}-nya? 😊 Boleh minta tolong kasih ulasan/bintang ya kak, sangat membantu toko kami 🙏 — {{toko}}" },
  { name: "Ajakan repeat order", type: "repeat", body: "Halo kak {{nama}} 👋 Sudah lama nih! Ada produk baru & promo spesial buat pelanggan setia {{toko}}. Mau saya kirim katalognya? 🛍️" },
];

// ---- purchasing, segments, reviews ----
const SUPPLIERS = ["CV Sumber Rejeki", "PT Grosir Nusantara", "Konveksi Busana Rapi", "Grosir Kain Katun"];
const PURCHASE_ORDERS: Array<{ code: string; supplier: string; status: "draft" | "dipesan" | "sebagian" | "diterima"; items: number; total: number; etaDays: number; createdDaysAgo: number }> = [
  { code: "PO-1042", supplier: "CV Sumber Rejeki", status: "dipesan", items: 4, total: 12_400_000, etaDays: 5, createdDaysAgo: 2 },
  { code: "PO-1041", supplier: "PT Grosir Nusantara", status: "sebagian", items: 6, total: 8_950_000, etaDays: 2, createdDaysAgo: 6 },
  { code: "PO-1040", supplier: "Konveksi Busana Rapi", status: "diterima", items: 3, total: 15_600_000, etaDays: -1, createdDaysAgo: 12 },
  { code: "PO-1039", supplier: "CV Sumber Rejeki", status: "diterima", items: 2, total: 4_200_000, etaDays: -4, createdDaysAgo: 18 },
  { code: "PO-1038", supplier: "Grosir Kain Katun", status: "draft", items: 1, total: 2_340_000, etaDays: 10, createdDaysAgo: 1 },
  { code: "PO-1037", supplier: "PT Grosir Nusantara", status: "dipesan", items: 5, total: 9_800_000, etaDays: 7, createdDaysAgo: 3 },
];
const SEGMENTS: Array<{ name: string; count: number; growth: number; description: string }> = [
  { name: "Pelanggan VIP", count: 128, growth: 12.4, description: "Total belanja lebih dari Rp6 juta" },
  { name: "Pelanggan Loyal", count: 356, growth: 8.1, description: "Lebih dari 12 pesanan" },
  { name: "Pelanggan Baru (30 hari)", count: 271, growth: 24.8, description: "Bergabung dalam 30 hari terakhir" },
  { name: "Belum Pernah Belanja", count: 642, growth: -3.2, description: "Terdaftar tapi belum ada pesanan" },
  { name: "Berisiko Churn", count: 89, growth: 5.6, description: "Tidak belanja lebih dari 90 hari" },
  { name: "Pelanggan Kota Besar", count: 1204, growth: 6.9, description: "Jakarta, Bandung, Surabaya" },
];
const REVIEWS: Array<{ customer: string; product: string; emoji: string; rating: number; text: string; status: "terbit" | "menunggu"; daysAgo: number }> = [
  { customer: "Siti Nurhaliza", product: "Dress Midi Motif Bunga", emoji: "👗", rating: 5, text: "Bahannya adem dan motifnya cantik, jatuhnya bagus di badan. Recommended!", status: "terbit", daysAgo: 1 },
  { customer: "Budi Santoso", product: "Kemeja Oversized Wanita", emoji: "👔", rating: 4, text: "Potongan effortless, nyaman dipakai. Cuma warnanya sedikit beda dari foto.", status: "terbit", daysAgo: 2 },
  { customer: "Rina Wijaya", product: "Gamis Syari Polos", emoji: "🧕", rating: 5, text: "Bahan wollycrepe jatuh dan tidak kaku, elegan. Suka banget.", status: "menunggu", daysAgo: 1 },
  { customer: "Andi Pratama", product: "Cardigan Rajut Wanita", emoji: "🧥", rating: 3, text: "Rajutannya rapi, tapi agak tipis. Lumayan untuk harganya.", status: "terbit", daysAgo: 4 },
  { customer: "Maya Sari", product: "Rok Plisket Panjang", emoji: "🩱", rating: 5, text: "Plisketnya jatuh cantik saat bergerak, pinggang karet nyaman.", status: "menunggu", daysAgo: 2 },
  { customer: "Doni Kusuma", product: "Celana Kulot Wide Leg", emoji: "👖", rating: 4, text: "Adem dan longgar, cocok buat sehari-hari. Puas.", status: "terbit", daysAgo: 6 },
  { customer: "Putri Ayu", product: "Set Piyama Satin Wanita", emoji: "🩱", rating: 2, text: "Satinnya halus tapi jahitan bagian lengan kurang rapi.", status: "menunggu", daysAgo: 3 },
  { customer: "Hendra Gunawan", product: "Blazer Formal Wanita", emoji: "🧥", rating: 5, text: "Blazernya rapi dan berkelas, pas buat kerja. Langganan terus.", status: "terbit", daysAgo: 8 },
];

// ---- navigation menus (canonical MAIN_MENU / FOOTER_MENU, inlined for seed parity) ----
type NavType = "beranda" | "koleksi" | "produk" | "halaman" | "blog" | "url";
const NAV_TO_DB: Record<NavType, "home" | "collection" | "product" | "page" | "blog" | "url"> = {
  beranda: "home", koleksi: "collection", produk: "product", halaman: "page", blog: "blog", url: "url",
};
type MItem = { label: string; type: NavType; href: string; children?: MItem[] };
const MAIN_MENU: MItem[] = [
  { label: "Beranda", type: "beranda", href: "/" },
  { label: "Semua Produk", type: "koleksi", href: "/kategori/semua" },
  {
    label: "Kategori", type: "url", href: "#",
    children: [
      { label: "Dress", type: "koleksi", href: "/kategori/dress" },
      { label: "Atasan", type: "koleksi", href: "/kategori/atasan" },
      { label: "Bawahan", type: "koleksi", href: "/kategori/bawahan" },
      { label: "Busana Muslim", type: "koleksi", href: "/kategori/busana-muslim" },
      { label: "Outerwear", type: "koleksi", href: "/kategori/outerwear" },
      { label: "Loungewear", type: "koleksi", href: "/kategori/loungewear" },
    ],
  },
  { label: "Promo Gajian", type: "koleksi", href: "/kategori/promo-gajian" },
  { label: "Blog", type: "blog", href: "/blog" },
  { label: "Kontak", type: "halaman", href: "/kontak" },
];
const FOOTER_MENU: MItem[] = [
  { label: "Tentang Kami", type: "halaman", href: "/halaman/tentang-kami" },
  { label: "Cara Pemesanan", type: "halaman", href: "/halaman/cara-pemesanan" },
  { label: "Kebijakan Pengembalian", type: "halaman", href: "/halaman/kebijakan-pengembalian" },
  { label: "Kebijakan Privasi", type: "halaman", href: "/halaman/kebijakan-privasi" },
  { label: "FAQ", type: "halaman", href: "/halaman/faq" },
];
const MENU_DEFS = [
  { name: "Menu Utama", handle: "main-menu", items: MAIN_MENU },
  { name: "Menu Footer", handle: "footer", items: FOOTER_MENU },
];

// ---- daily sales rollup (mirror admin mock buildDays: mulberry32(20260701), 120 days) ----
const DAILY = (() => {
  const rnd = mulberry32(20260701);
  const out: Array<{ date: string; sales: number; orders: number; visitors: number }> = [];
  const N = 120;
  for (let i = N - 1; i >= 0; i--) {
    const d = new Date(ADMIN_TODAY);
    d.setUTCDate(d.getUTCDate() - i);
    const dow = d.getUTCDay();
    const weekend = dow === 0 || dow === 6 ? 0.82 : 1;
    const payday = d.getUTCDate() === 25 || d.getUTCDate() === 1 ? 1.35 : 1;
    const trend = 1 + ((N - i) / N) * 0.55;
    const noise = 0.8 + rnd() * 0.45;
    const sales = Math.round(2_600_000 * weekend * payday * trend * noise);
    const aov = 145_000 + Math.round(rnd() * 90_000);
    const orders = Math.max(1, Math.round(sales / aov));
    const visitors = Math.round(orders * (22 + rnd() * 16));
    out.push({ date: d.toISOString().slice(0, 10), sales, orders, visitors });
  }
  return out;
})();

// ---- marketing: ad channels + per-province rollup ----
const AD_CHANNELS: Array<{
  key: "meta" | "google" | "tiktok"; name: string; brand: string; connected: boolean;
  pixelLabel: string; pixelId: string; pixelActive: boolean; capiActive: boolean;
  spend: number; impressions: number; clicks: number; conversions: number; revenue: number;
  campaigns: Array<{ name: string; spend: number; conversions: number; revenue: number }>;
}> = [
  {
    key: "meta", name: "Meta Ads", brand: "#0866FF", connected: true,
    pixelLabel: "Meta Pixel + Conversions API", pixelId: "1029384756574839", pixelActive: true, capiActive: true,
    spend: 18_500_000, impressions: 1_240_000, clicks: 38_400, conversions: 421, revenue: 78_200_000,
    campaigns: [
      { name: "Prospecting — Fashion", spend: 7_800_000, conversions: 168, revenue: 31_500_000 },
      { name: "Retargeting — Keranjang", spend: 5_200_000, conversions: 143, revenue: 28_900_000 },
      { name: "Lookalike — Pembeli 90 hari", spend: 5_500_000, conversions: 110, revenue: 17_800_000 },
    ],
  },
  {
    key: "google", name: "Google Ads", brand: "#1A73E8", connected: true,
    pixelLabel: "Google Tag (GA4) + Konversi Google Ads", pixelId: "G-8K2ZQ7WYX1", pixelActive: true, capiActive: false,
    spend: 12_100_000, impressions: 684_000, clicks: 21_900, conversions: 258, revenue: 52_400_000,
    campaigns: [
      { name: "Search — Brand", spend: 3_100_000, conversions: 96, revenue: 21_200_000 },
      { name: "Shopping — Katalog", spend: 5_400_000, conversions: 102, revenue: 20_600_000 },
      { name: "Performance Max", spend: 3_600_000, conversions: 60, revenue: 10_600_000 },
    ],
  },
  {
    key: "tiktok", name: "TikTok Ads", brand: "#FE2C55", connected: false,
    pixelLabel: "TikTok Pixel + Events API", pixelId: "", pixelActive: false, capiActive: false,
    spend: 9_050_000, impressions: 2_130_000, clicks: 40_800, conversions: 176, revenue: 30_900_000,
    campaigns: [
      { name: "Spark Ads — Video Produk", spend: 5_050_000, conversions: 112, revenue: 19_400_000 },
      { name: "VSA — Katalog", spend: 4_000_000, conversions: 64, revenue: 11_500_000 },
    ],
  },
];
const AD_PROVINCES: Array<{ province: string; spend: number; impressions: number; clicks: number; conversions: number; revenue: number; reach: number }> = [
  { province: "DKI Jakarta", spend: 11_200_000, impressions: 1_180_000, clicks: 34_800, conversions: 268, revenue: 52_400_000, reach: 640_000 },
  { province: "Jawa Barat", spend: 7_400_000, impressions: 820_000, clicks: 24_100, conversions: 172, revenue: 31_800_000, reach: 470_000 },
  { province: "Jawa Timur", spend: 6_100_000, impressions: 690_000, clicks: 19_600, conversions: 141, revenue: 26_500_000, reach: 390_000 },
  { province: "Jawa Tengah", spend: 4_300_000, impressions: 512_000, clicks: 13_800, conversions: 98, revenue: 17_900_000, reach: 288_000 },
  { province: "Banten", spend: 3_050_000, impressions: 356_000, clicks: 10_200, conversions: 74, revenue: 13_100_000, reach: 205_000 },
  { province: "Sumatera Utara", spend: 2_400_000, impressions: 298_000, clicks: 8_100, conversions: 52, revenue: 8_900_000, reach: 168_000 },
  { province: "Bali", spend: 2_050_000, impressions: 244_000, clicks: 7_400, conversions: 61, revenue: 12_600_000, reach: 142_000 },
  { province: "DI Yogyakarta", spend: 1_500_000, impressions: 190_000, clicks: 6_100, conversions: 44, revenue: 7_200_000, reach: 112_000 },
  { province: "Sulawesi Selatan", spend: 1_350_000, impressions: 176_000, clicks: 5_200, conversions: 33, revenue: 5_400_000, reach: 98_000 },
  { province: "Kalimantan Timur", spend: 1_100_000, impressions: 138_000, clicks: 3_900, conversions: 26, revenue: 4_300_000, reach: 74_000 },
  { province: "Lainnya", spend: 1_150_000, impressions: 164_000, clicks: 4_500, conversions: 30, revenue: 5_100_000, reach: 86_000 },
];

async function truncateAll() {
  // kiriminaja_areas is static reference data (7k districts) — never wiped by demo reseeds.
  const rows = await client<{ table_name: string }[]>`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name not in ('__drizzle_migrations', 'kiriminaja_areas')`;
  const list = rows.map((r) => `"${r.table_name}"`).join(", ");
  if (list) await client.unsafe(`truncate ${list} restart identity cascade`);
}

async function main() {
  console.log("Seeding local Postgres (single-tenant: Batik Nusantara)…");
  // Idempotent for a persistent server: only seed an EMPTY database. On redeploys this preserves
  // real data (orders, tickets, invoices, uploaded media, password changes). Force with SEED_FORCE=1.
  if (!process.env.SEED_FORCE) {
    const rows = await client`select count(*)::int as c from stores`.catch(() => [{ c: 0 }] as { c: number }[]);
    if (Number(rows[0]?.c ?? 0) > 0) {
      console.log("DB already has data — skipping seed (set SEED_FORCE=1 to re-seed).");
      await client.end();
      return;
    }
  }
  await truncateAll();

  // plans (config)
  await db.insert(schema.plans).values(PLANS.map((p) => ({ key: p.key, name: p.name, priceIdr: p.price, blurb: p.blurb, features: p.features })));

  // the one account + owner + store + membership + settings + stats
  const [account] = await db.insert(schema.accounts).values({ name: STORE.name, plan: STORE.plan, createdAt: daysAgo(STORE.createdDaysAgo) }).returning();
  const [user] = await db.insert(schema.users).values({ email: STORE.email, name: STORE.owner, passwordHash: hashPassword(DEV_OWNER_PASSWORD) }).returning();
  const [store] = await db.insert(schema.stores).values({
    accountId: account.id,
    name: STORE.name,
    slug: slugify(STORE.name),
    city: STORE.city,
    plan: STORE.plan,
    status: STORE.status,
    // billing: active, first month paid → recurring Rp275rb; ~20 days left in the current period
    trialEndsAt: fromNow(-(STORE.createdDaysAgo - 3)),
    currentPeriodEnd: fromNow(20),
    firstInvoicePaid: true,
    createdAt: daysAgo(STORE.createdDaysAgo),
  }).returning();
  await db.insert(schema.storeUsers).values({ storeId: store.id, userId: user.id, role: "owner", acceptedAt: daysAgo(STORE.createdDaysAgo) });
  const [loc] = await db.insert(schema.locations).values({ storeId: store.id, name: "Gudang Utama", isDefault: true }).returning();
  await db.insert(schema.storeSettings).values({ storeId: store.id });
  await db.insert(schema.storeStats).values({ storeId: store.id, gmvIdr: STORE.gmv, ordersCount: STORE.orders, productsCount: CATALOG.length, ship7dAvg: 15, updatedAt: TODAY });

  // catalog: product → 1 default variant (price) + inventory (stock) + base media (image)
  const seededProducts: Array<{ id: string; variantId: string; category: string; unitsSold: number }> = [];
  for (const c of CATALOG) {
    const meta = STOREFRONT_META[c.slug];
    const [p] = await db.insert(schema.products).values({
      storeId: store.id,
      title: c.name,
      handle: c.slug,
      description: meta?.description ?? null,
      category: c.category,
      status: c.status,
      emoji: c.emoji,
      unitsSold: c.unitsSold,
      sizes: meta?.sizes ?? null,
      badge: meta?.badge ?? null,
      bestseller: meta?.bestseller ?? false,
      // shipping dims (cm) — folded apparel; hijab/accessory flatter
      lengthCm: 30,
      widthCm: 25,
      heightCm: c.category === "Busana Muslim" ? 3 : 5,
      ratingValue: meta?.rating[0] ?? null,
      ratingCount: meta?.rating[1] ?? 0,
      hasVariants: true,
      createdAt: new Date(c.addedTs),
    }).returning();
    // real variants: Warna × Ukuran (Ukuran from STOREFRONT_META.sizes). Position 0 = default (list/catalog/orders use it).
    const warna = WARNA_BY_SLUG[c.slug] ?? ["Default"];
    const ukuran = meta?.sizes?.length ? meta.sizes : ["All Size"];
    await db.insert(schema.productOptions).values([
      { productId: p.id, name: "Warna", position: 0 },
      { productId: p.id, name: "Ukuran", position: 1 },
    ]);
    const rndV = mulberry32(5000 + CATALOG.indexOf(c) * 13);
    let vPos = 0;
    let v: { id: string } | undefined;
    for (const w of warna) {
      for (const u of ukuran) {
        const [nv] = await db.insert(schema.productVariants).values({
          productId: p.id, storeId: store.id, title: `${w} / ${u}`, position: vPos,
          option1: w, option2: u, priceIdr: c.price, compareAtIdr: meta?.compareAt ?? null,
        }).returning();
        if (vPos === 0) v = nv;
        await db.insert(schema.inventoryLevels).values({ variantId: nv.id, locationId: loc.id, available: Math.round(3 + rndV() * 40) });
        vPos++;
      }
    }
    if (!v) throw new Error(`no variant seeded for ${c.slug}`);
    // 5-image gallery: base + -2..-5 (files exist in public/products/)
    await db.insert(schema.productMedia).values(
      [0, 1, 2, 3, 4].map((n) => ({
        productId: p.id,
        url: n === 0 ? `/products/${c.slug}.webp` : `/products/${c.slug}-${n + 1}.webp`,
        position: n,
      })),
    );
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
      tags: ["pelanggan", c.segment],
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
    const [c] = await db.insert(schema.collections).values({ storeId: store.id, title: col.name, handle: slugify(col.name), emoji: col.emoji, description: col.blurb ?? null, type: col.type, published: col.published }).returning();
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
    // storeId is the RLS key (0036) — the app write paths always set it; the seed used to omit it,
    // which left every seeded payment orphaned (store_id NULL = belongs to no tenant).
    await db.insert(schema.payments).values({ orderId: ord.id, storeId: store.id, method: "transfer", amountIdr: o.total, status: o.status === "batal" ? "gagal" : "berhasil", paidAt: o.status === "batal" ? null : minutesAgo(o.minutesAgo) });
  }

  // CMS: pages
  await db.insert(schema.pages).values(
    PAGES.map((p) => ({
      storeId: store.id,
      title: p.title,
      handle: p.handle,
      status: (p.published ? "terbit" : "draft") as "terbit" | "draft",
      template: p.template,
      views: p.views,
      updatedAt: new Date(ADMIN_TODAY.getTime() - p.updatedDaysAgo * 86_400_000),
    })),
  );

  // CMS: blogs + articles
  const blogRows = await db.insert(schema.blogs).values(BLOGS.map((b) => ({ storeId: store.id, title: b, handle: slugify(b) }))).returning({ id: schema.blogs.id, title: schema.blogs.title });
  const blogByName = new Map(blogRows.map((b) => [b.title, b.id]));
  await db.insert(schema.articles).values(
    ARTICLES.map((a) => ({
      blogId: blogByName.get(a.blog)!,
      storeId: store.id,
      title: a.title,
      handle: a.handle,
      excerpt: a.excerpt,
      author: a.author,
      status: (a.published ? "terbit" : "draft") as "terbit" | "draft",
      comments: a.comments,
      publishedAt: new Date(ADMIN_TODAY.getTime() - a.publishedDaysAgo * 86_400_000),
    })),
  );

  // CRM: leads, followups (customer by name), wa templates
  await db.insert(schema.leads).values(
    LEADS.map((l) => ({
      storeId: store.id,
      name: l.name,
      phone: l.phone,
      source: LEAD_SOURCE[l.source],
      stage: l.stage,
      valueIdr: l.value,
      note: l.note,
      lastContactAt: new Date(ADMIN_TODAY.getTime() - l.lastContactDaysAgo * 86_400_000),
    })),
  );
  await db.insert(schema.followups).values(
    FOLLOWUPS.map((f) => ({
      storeId: store.id,
      customerId: custByName.get(f.customer) ?? null,
      phone: f.phone,
      type: f.type,
      context: f.context,
      dueAt: new Date(ADMIN_TODAY.getTime() + f.dueDays * 86_400_000),
      status: f.status,
      lastMessage: f.lastMessage || null,
    })),
  );
  await db.insert(schema.waTemplates).values(WA_TEMPLATES.map((t) => ({ storeId: store.id, name: t.name, type: t.type, body: t.body })));

  // purchasing: suppliers + purchase orders (+ items for the count)
  const supRows = await db.insert(schema.suppliers).values(SUPPLIERS.map((n) => ({ storeId: store.id, name: n }))).returning({ id: schema.suppliers.id, name: schema.suppliers.name });
  const supByName = new Map(supRows.map((s) => [s.name, s.id]));
  const anyVariant = seededProducts[0].variantId;
  for (const po of PURCHASE_ORDERS) {
    const [row] = await db.insert(schema.purchaseOrders).values({
      storeId: store.id,
      supplierId: supByName.get(po.supplier) ?? null,
      code: po.code,
      status: po.status,
      totalIdr: po.total,
      etaDate: new Date(ADMIN_TODAY.getTime() + po.etaDays * 86_400_000).toISOString().slice(0, 10),
      createdAt: new Date(ADMIN_TODAY.getTime() - po.createdDaysAgo * 86_400_000),
    }).returning();
    await db.insert(schema.purchaseOrderItems).values(
      Array.from({ length: po.items }, () => ({ purchaseOrderId: row.id, variantId: anyVariant, qty: 1, costIdr: Math.round(po.total / po.items) })),
    );
  }

  // customer segments (saved segments — demo aggregates)
  await db.insert(schema.customerSegments).values(SEGMENTS.map((s) => ({ storeId: store.id, name: s.name, description: s.description, memberCount: s.count, growth: s.growth })));

  // reviews (customer linked; product denormalized — legacy demo products)
  await db.insert(schema.reviews).values(
    REVIEWS.map((r) => ({
      storeId: store.id,
      customerId: custByName.get(r.customer) ?? null,
      productName: r.product,
      emoji: r.emoji,
      rating: r.rating,
      body: r.text,
      status: r.status,
      createdAt: new Date(ADMIN_TODAY.getTime() - r.daysAgo * 86_400_000),
    })),
  );

  // navigation menus + items (recursive, parent_id + position)
  const insertMenuItems = async (menuId: string, items: MItem[], parentId: string | null): Promise<void> => {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const [row] = await db.insert(schema.menuItems).values({ menuId, parentId, label: it.label, type: NAV_TO_DB[it.type], target: it.href, position: i }).returning();
      if (it.children) await insertMenuItems(menuId, it.children, row.id);
    }
  };
  for (const md of MENU_DEFS) {
    const [menu] = await db.insert(schema.menus).values({ storeId: store.id, name: md.name, handle: md.handle }).returning();
    await insertMenuItems(menu.id, md.items, null);
  }

  // daily sales rollup (Dashboard/Analitik series)
  await db.insert(schema.analyticsDaily).values(
    DAILY.map((d) => ({ storeId: store.id, date: d.date, salesIdr: d.sales, orders: d.orders, visitors: d.visitors })),
  );

  // ---- storefront funnel events (analytics_events) ----
  // /analitik used to render the funnel + device split from HARDCODED constants. These rows exist
  // so the dashboard COUNTS instead. The data is synthetic, but the maths on screen is real — and
  // the two endpoints are pinned to numbers the same page already shows:
  //     visit    == DAILY.visitors  (the "Pengunjung" KPI)
  //     purchase == DAILY.orders    (the "Pesanan" KPI)
  // so the funnel reconciles with the KPIs instead of contradicting them. The middle steps are
  // interpolated monotonically and floored at `purchases` (a funnel can never widen).
  //
  // sessionId is `s-<date>-<k>`: session k takes part in every step whose count is > k. Because the
  // steps decrease, sessions 0..purchases-1 walk the whole funnel — exactly how a real session
  // behaves. The device is fixed PER SESSION (not per event), so the Perangkat split counts
  // sessions, not clicks.
  const DEVICE_MIX: Array<[string, number]> = [["ponsel", 0.78], ["desktop", 0.18], ["tablet", 0.04]];
  const pickDevice = (r: number) => {
    let acc = 0;
    for (const [d, w] of DEVICE_MIX) {
      acc += w;
      if (r < acc) return d;
    }
    return "ponsel";
  };

  const evRnd = mulberry32(777);
  const events: Array<{ storeId: string; ts: Date; type: string; sessionId: string; device: string }> = [];

  for (const day of DAILY) {
    const midnight = new Date(`${day.date}T00:00:00.000Z`).getTime();
    const visits = day.visitors;
    const purchases = day.orders;
    const productViews = Math.max(purchases, Math.round(visits * (0.58 + evRnd() * 0.1)));
    const addToCart = Math.max(purchases, Math.round(productViews * (0.32 + evRnd() * 0.08)));
    const checkout = Math.max(purchases, Math.round(addToCart * (0.34 + evRnd() * 0.08)));

    // one device per session, reused across that session's events
    const devices = Array.from({ length: visits }, () => pickDevice(evRnd()));

    const steps: Array<[string, number]> = [
      ["visit", visits],
      ["product_view", productViews],
      ["add_to_cart", addToCart],
      ["checkout_start", checkout],
      ["purchase", purchases],
    ];
    for (const [type, n] of steps) {
      for (let k = 0; k < n; k++) {
        events.push({
          storeId: store.id,
          ts: new Date(midnight + Math.floor(evRnd() * 86_400_000)),
          type,
          sessionId: `s-${day.date}-${k}`,
          device: devices[k] ?? "ponsel",
        });
      }
    }
  }
  // batched: postgres caps bind parameters per statement
  for (let i = 0; i < events.length; i += 2000) {
    await db.insert(schema.analyticsEvents).values(events.slice(i, i + 2000));
  }

  // marketing: ad channels (denormalized config + aggregate + campaigns) + per-province rollup
  await db.insert(schema.adChannels).values(
    AD_CHANNELS.map((c) => ({
      storeId: store.id, key: c.key, name: c.name, brand: c.brand, connected: c.connected,
      pixelLabel: c.pixelLabel, pixelId: c.pixelId || null, pixelActive: c.pixelActive, capiEnabled: c.capiActive,
      spendIdr: c.spend, impressions: c.impressions, clicks: c.clicks, conversions: c.conversions, revenueIdr: c.revenue,
      campaigns: c.campaigns,
    })),
  );
  await db.insert(schema.adMetrics).values(
    AD_PROVINCES.map((p) => ({
      storeId: store.id, channelKey: null, date: ADMIN_TODAY.toISOString().slice(0, 10), province: p.province,
      spendIdr: p.spend, impressions: p.impressions, clicks: p.clicks, conversions: p.conversions, revenueIdr: p.revenue, reach: p.reach,
    })),
  );

  // invoices for this account — single plan TokoΦ (Rp275rb/bln recurring)
  await db.insert(schema.invoices).values(
    INVOICES.map((inv) => ({ number: inv.number, accountId: account.id, storeId: store.id, planKey: STORE.plan, amountIdr: SUB_MONTHLY, status: inv.status, issuedAt: daysAgo(inv.daysAgo) })),
  );

  // platform activity
  await db.insert(schema.platformActivity).values(ACTIVITY.map((a) => ({ kind: a.kind, text: a.text, ts: minutesAgo(a.minutesAgo) })));

  // platform operator (super-admin login) — admin@tokophi.id / tokophi123
  await db.insert(schema.platformAdmins).values({ email: "admin@tokophi.id", name: "Admin Platform", passwordHash: hashPassword(DEV_OWNER_PASSWORD), role: "owner" });

  // support tickets (2-sided demo) — for Batik Nusantara
  const [tkt1] = await db.insert(schema.supportTickets).values({ storeId: store.id, subject: "Cara menghubungkan domain kustom?", status: "answered", createdAt: minutesAgo(4 * 60), lastMessageAt: minutesAgo(90) }).returning();
  await db.insert(schema.supportMessages).values([
    { ticketId: tkt1.id, storeId: store.id, sender: "merchant", body: "Halo, saya mau pakai domain sendiri (batiknusantara.id). Bagaimana caranya?", createdAt: minutesAgo(4 * 60) },
    { ticketId: tkt1.id, storeId: store.id, sender: "platform", body: "Halo! Tambahkan domain di Pengaturan lalu arahkan CNAME ke cname.tokophi.com — kami bantu verifikasi setelahnya.", createdAt: minutesAgo(90) },
  ]);
  const [tkt2] = await db.insert(schema.supportTickets).values({ storeId: store.id, subject: "Tagihan bulan ini belum masuk", status: "open", createdAt: minutesAgo(30), lastMessageAt: minutesAgo(30) }).returning();
  await db.insert(schema.supportMessages).values({ ticketId: tkt2.id, storeId: store.id, sender: "merchant", body: "Saya sudah bayar VA tapi status masih menunggu. Mohon dicek ya.", createdAt: minutesAgo(30) });

  // additional demo stores (platform view + healthcheck variety)
  let invSeq = 9100;
  let ordSeq = 8000;
  for (const d of DEMO_STORES) {
    const [acc] = await db.insert(schema.accounts).values({ name: d.name, plan: d.plan, createdAt: daysAgo(d.createdDaysAgo) }).returning();
    const [u] = await db.insert(schema.users).values({ email: d.email, name: d.owner, passwordHash: hashPassword(DEV_OWNER_PASSWORD) }).returning();
    // demo billing lifecycle from the store's status. firstPaid=false → still on the Rp50rb first month.
    const firstPaid = d.firstPaid ?? true;
    const bill =
      d.status === "trial"
        ? { trialEndsAt: fromNow(1), currentPeriodEnd: null, firstInvoicePaid: false } // ~1 day left of trial
        : d.status === "suspended"
          ? { trialEndsAt: fromNow(-(d.createdDaysAgo - 3)), currentPeriodEnd: fromNow(-20), firstInvoicePaid: firstPaid } // overdue past grace
          : { trialEndsAt: fromNow(-(d.createdDaysAgo - 3)), currentPeriodEnd: fromNow(12), firstInvoicePaid: firstPaid }; // active
    const comp = d.comped ? { comped: true, compedReason: "Volume pengiriman tinggi — dibebaskan platform", compedAt: daysAgo(20) } : {};
    const [st] = await db.insert(schema.stores).values({ accountId: acc.id, name: d.name, slug: slugify(d.name), city: d.city, plan: d.plan, status: d.status, ...bill, ...comp, createdAt: daysAgo(d.createdDaysAgo) }).returning();
    await db.insert(schema.storeUsers).values({ storeId: st.id, userId: u.id, role: "owner", acceptedAt: daysAgo(d.createdDaysAgo) });
    await db.insert(schema.locations).values({ storeId: st.id, name: "Gudang Utama", isDefault: true });
    await db.insert(schema.storeSettings).values({ storeId: st.id });
    await db.insert(schema.storeStats).values({ storeId: st.id, gmvIdr: d.gmv, ordersCount: d.orders, productsCount: d.products, ship7dAvg: d.ship7d ?? 0, updatedAt: TODAY });
    if (d.invoices.length) {
      // single plan: Rp50rb first-month promo (firstPaid=false) else Rp275rb recurring
      const amount = firstPaid ? SUB_MONTHLY : SUB_FIRST_MONTH;
      await db.insert(schema.invoices).values(d.invoices.map((inv) => ({ number: `INV-${invSeq++}`, accountId: acc.id, storeId: st.id, planKey: d.plan, amountIdr: amount, status: inv.status, issuedAt: daysAgo(inv.daysAgo) })));
    }
    if (d.lastOrderDaysAgo !== null) {
      // a few orders; the most-recent placedAt drives the "activity" health signal
      const offsets = [d.lastOrderDaysAgo, d.lastOrderDaysAgo + 4, d.lastOrderDaysAgo + 11];
      await db.insert(schema.orders).values(offsets.map((off) => ({
        storeId: st.id, number: `ORD-${ordSeq++}`, status: "selesai" as const, financialStatus: "dibayar" as const,
        channel: "organic" as const, subtotalIdr: 150_000, totalIdr: 150_000, city: d.city, placedAt: daysAgo(off),
      })));
    }
  }

  // platform-managed payments / shipping / COD (ADR 0004) — platform-level, not per-store
  // Single platform-managed PSP = AutoLaris (VA/QRIS/DANA). Merchants never see the brand.
  await db.insert(schema.platformPaymentGateways).values([
    { provider: "autolaris", enabled: true, isCod: false },
  ]);
  await db.insert(schema.shippingAggregator).values({ provider: "kiriminaja", enabled: true });
  await db.insert(schema.platformCouriers).values(
    // KiriminAja codes from the shared roster; niche ones off by default (super-admin toggles).
    COURIERS.map((c) => ({
      courier: c.code,
      services: c.services,
      enabled: !["idx", "tiki", "jtcargo", "pos"].includes(c.code),
    })),
  );
  await db.insert(schema.platformCod).values({ enabled: true, maxAmountIdr: 2_000_000, allowedProvinces: ["DI Yogyakarta", "Jawa Tengah", "Jawa Barat", "DKI Jakarta", "Banten", "Jawa Timur"], feePct: 0 });
  // AutoLaris payment channels. enabled+active = the 6 confirmed active on sandbox (QRIS + 5 VA);
  // rest listed but off (super-admin can Sync/toggle). Mirrors platform_couriers.
  await db.insert(schema.platformPaymentChannels).values(
    (
      [
        ["QRIS", "QRIS", "qris", true],
        ["VABCA", "Virtual Account BCA", "va", true],
        ["VAMANDIRI", "Virtual Account Mandiri", "va", true],
        ["VABNI", "Virtual Account BNI", "va", true],
        ["VABRI", "Virtual Account BRI", "va", true],
        ["VAPERMATA", "Virtual Account Permata", "va", true],
        ["VABSI", "Virtual Account BSI", "va", false],
        ["VACIMB", "Virtual Account CIMB", "va", false],
        ["DANA", "DANA", "ewallet", false],
        ["OVO", "OVO", "ewallet", false],
        ["SHOPEEPAY", "ShopeePay", "ewallet", false],
        ["LINKAJA", "LinkAja", "ewallet", false],
        ["GOPAY", "GoPay", "ewallet", false],
        ["ALFAMART", "Alfamart", "retail", false],
        ["INDOMARET", "Indomaret", "retail", false],
      ] as const
    ).map(([channel, label, kind, on]) => ({ channel, label, kind, enabled: on, active: on })),
  );

  console.log(`Seeded: ${PLANS.length} plans, ${1 + DEMO_STORES.length} stores (${STORE.name} + ${DEMO_STORES.length} demo), ${CATALOG.length} products, ${COLLECTIONS.length} collections, ${CUSTOMERS.length} customers, ${ORDERS_SEED.length} orders, ${DISCOUNTS.length} discounts, ${PAGES.length} pages, ${BLOGS.length} blogs/${ARTICLES.length} articles, ${LEADS.length} leads/${FOLLOWUPS.length} followups/${WA_TEMPLATES.length} templates, ${SUPPLIERS.length} suppliers/${PURCHASE_ORDERS.length} POs, ${SEGMENTS.length} segments, ${REVIEWS.length} reviews, ${MENU_DEFS.length} menus, ${DAILY.length} daily-stats, ${AD_CHANNELS.length} ad-channels/${AD_PROVINCES.length} provinces, ${INVOICES.length} invoices, platform settings.`);
  await client.end();
}

main().catch(async (e) => {
  console.error(e);
  await client.end();
  process.exit(1);
});
