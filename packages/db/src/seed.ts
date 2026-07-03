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
  { title: "Cara Merawat Sepatu Sneakers Agar Awet", handle: "cara-merawat-sneakers", blog: "Tips & Panduan", author: "Sari Melati", published: true, publishedDaysAgo: 9, excerpt: "Langkah mudah membersihkan dan menyimpan sneakers kesayangan.", comments: 12 },
  { title: "Kami Kini Melayani Pengiriman Instan Se-Jabodetabek", handle: "pengiriman-instan-jabodetabek", blog: "Berita Toko", author: "Ongki Pratama", published: true, publishedDaysAgo: 14, excerpt: "Pesanan sampai di hari yang sama dengan GoSend & GrabExpress.", comments: 5 },
  { title: "Rekomendasi Hadiah untuk Anak Sesuai Usia", handle: "rekomendasi-hadiah-anak", blog: "Tips & Panduan", author: "Dewi Anggraini", published: false, publishedDaysAgo: 1, excerpt: "Bingung memilih mainan edukatif? Simak rekomendasi berdasarkan usia anak.", comments: 0 },
  { title: "Panduan Klaim Garansi Produk Elektronik", handle: "panduan-klaim-garansi", blog: "Tips & Panduan", author: "Sari Melati", published: true, publishedDaysAgo: 25, excerpt: "Ketahui prosedur dan syarat klaim garansi agar prosesnya cepat.", comments: 2 },
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
  { customer: "Siti Nurhaliza", phone: "6281234511001", type: "keranjang", context: "Kopi Arabika Gayo 250g", dueDays: 0, status: "menunggu", lastMessage: "" },
  { customer: "Agus Salim", phone: "6281234511002", type: "pembayaran", context: "#INV-4821 · Rp275.000", dueDays: 0, status: "menunggu", lastMessage: "" },
  { customer: "Rina Wijaya", phone: "6281234511003", type: "keranjang", context: "Skincare Serum Vitamin C", dueDays: -1, status: "menunggu", lastMessage: "" },
  { customer: "Budi Santoso", phone: "6281234511004", type: "pembayaran", context: "#INV-4818 · Rp189.000", dueDays: -2, status: "menunggu", lastMessage: "" },
  { customer: "Maya Sari", phone: "6281234511005", type: "pascabeli", context: "#INV-4815 · Tas Ransel Anti Air", dueDays: 0, status: "terkirim", lastMessage: "Terima kasih sudah belanja! 🙏" },
  { customer: "Andi Pratama", phone: "6281234511006", type: "ulasan", context: "Earphone Bluetooth TWS", dueDays: 1, status: "menunggu", lastMessage: "" },
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
const SUPPLIERS = ["CV Sumber Rejeki", "PT Grosir Nusantara", "Toko Elektronik Jaya", "Kopi Gayo Supplier"];
const PURCHASE_ORDERS: Array<{ code: string; supplier: string; status: "draft" | "dipesan" | "sebagian" | "diterima"; items: number; total: number; etaDays: number; createdDaysAgo: number }> = [
  { code: "PO-1042", supplier: "CV Sumber Rejeki", status: "dipesan", items: 4, total: 12_400_000, etaDays: 5, createdDaysAgo: 2 },
  { code: "PO-1041", supplier: "PT Grosir Nusantara", status: "sebagian", items: 6, total: 8_950_000, etaDays: 2, createdDaysAgo: 6 },
  { code: "PO-1040", supplier: "Toko Elektronik Jaya", status: "diterima", items: 3, total: 15_600_000, etaDays: -1, createdDaysAgo: 12 },
  { code: "PO-1039", supplier: "CV Sumber Rejeki", status: "diterima", items: 2, total: 4_200_000, etaDays: -4, createdDaysAgo: 18 },
  { code: "PO-1038", supplier: "Kopi Gayo Supplier", status: "draft", items: 1, total: 2_340_000, etaDays: 10, createdDaysAgo: 1 },
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
  { customer: "Siti Nurhaliza", product: "Kopi Arabika Gayo 250g", emoji: "☕", rating: 5, text: "Kopinya wangi dan segar, pengiriman cepat. Recommended!", status: "terbit", daysAgo: 1 },
  { customer: "Budi Santoso", product: "Sepatu Sneakers Lokal", emoji: "👟", rating: 4, text: "Bahan bagus, ukuran pas. Cuma warnanya sedikit beda dari foto.", status: "terbit", daysAgo: 2 },
  { customer: "Rina Wijaya", product: "Skincare Serum Vitamin C", emoji: "🧴", rating: 5, text: "Cocok di kulit saya, hasilnya cerah dalam 2 minggu.", status: "menunggu", daysAgo: 1 },
  { customer: "Andi Pratama", product: "Earphone Bluetooth TWS", emoji: "🎧", rating: 3, text: "Suara oke, tapi baterai agak boros. Lumayan untuk harganya.", status: "terbit", daysAgo: 4 },
  { customer: "Maya Sari", product: "Tas Ransel Anti Air", emoji: "🎒", rating: 5, text: "Kuat dan benar-benar anti air. Muat banyak juga.", status: "menunggu", daysAgo: 2 },
  { customer: "Doni Kusuma", product: "Power Bank 10.000mAh", emoji: "🔋", rating: 4, text: "Ngecas cepat, ringkas dibawa. Puas.", status: "terbit", daysAgo: 6 },
  { customer: "Putri Ayu", product: "Lip Cream Matte", emoji: "💄", rating: 2, text: "Warnanya bagus tapi bikin bibir kering.", status: "menunggu", daysAgo: 3 },
  { customer: "Hendra Gunawan", product: "Madu Hutan Asli 500ml", emoji: "🍯", rating: 5, text: "Madunya asli, rasa mantap. Langganan terus.", status: "terbit", daysAgo: 8 },
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

  console.log(`Seeded: ${PLANS.length} plans, 1 store (${STORE.name}), ${CATALOG.length} products, ${COLLECTIONS.length} collections, ${CUSTOMERS.length} customers, ${ORDERS_SEED.length} orders, ${DISCOUNTS.length} discounts, ${PAGES.length} pages, ${BLOGS.length} blogs/${ARTICLES.length} articles, ${LEADS.length} leads/${FOLLOWUPS.length} followups/${WA_TEMPLATES.length} templates, ${SUPPLIERS.length} suppliers/${PURCHASE_ORDERS.length} POs, ${SEGMENTS.length} segments, ${REVIEWS.length} reviews, ${MENU_DEFS.length} menus, ${DAILY.length} daily-stats, ${INVOICES.length} invoices, platform settings.`);
  await client.end();
}

main().catch(async (e) => {
  console.error(e);
  await client.end();
  process.exit(1);
});
