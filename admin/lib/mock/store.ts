// Deterministic mock dataset for Indostore admin.
// Everything is anchored to a fixed TODAY so server & client render identically
// (no hydration mismatch) and the demo is stable. Swap this file for a real API later.

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
  emoji: string;
  price: number;
  stock: number;
  status: "active" | "draft";
  category: string;
  unitsSold: number;
};
const PRODUCT_SEED: Array<[string, string, number, string]> = [
  ["Kaos Polos Premium Cotton", "👕", 89_000, "Fashion"],
  ["Hijab Voal Segi Empat", "🧕", 55_000, "Fashion"],
  ["Sepatu Sneakers Lokal", "👟", 275_000, "Fashion"],
  ["Tas Ransel Anti Air", "🎒", 189_000, "Aksesoris"],
  ["Kopi Arabika Gayo 250g", "☕", 78_000, "F&B"],
  ["Madu Hutan Asli 500ml", "🍯", 120_000, "F&B"],
  ["Skincare Serum Vitamin C", "🧴", 145_000, "Kecantikan"],
  ["Lip Cream Matte", "💄", 65_000, "Kecantikan"],
  ["Power Bank 10.000mAh", "🔋", 165_000, "Elektronik"],
  ["Earphone Bluetooth TWS", "🎧", 210_000, "Elektronik"],
  ["Botol Minum Termos 1L", "🍶", 95_000, "Rumah Tangga"],
  ["Set Peralatan Masak", "🍳", 320_000, "Rumah Tangga"],
  ["Mainan Edukasi Kayu", "🧩", 135_000, "Anak"],
  ["Vitamin Anak Gummy", "🐻", 88_000, "Kesehatan"],
];
export const PRODUCTS: Product[] = PRODUCT_SEED.map(([name, emoji, price, category], i) => {
  const rnd = mulberry32(1000 + i * 7);
  return {
    id: `PRD-${1001 + i}`,
    name,
    emoji,
    price,
    stock: Math.round(5 + rnd() * 240),
    status: rnd() > 0.12 ? "active" : "draft",
    category,
    unitsSold: Math.round(30 + rnd() * 900),
  };
});
// Curated variety for a realistic demo (a couple of drafts + low-stock items).
PRODUCTS[7].status = "draft";   // Lip Cream Matte
PRODUCTS[12].status = "draft";  // Mainan Edukasi Kayu
PRODUCTS[9].stock = 8;          // Earphone Bluetooth TWS — menipis
PRODUCTS[3].stock = 14;         // Tas Ransel Anti Air — menipis

// ---- orders ----
export type OrderStatus = "baru" | "diproses" | "dikirim" | "selesai" | "batal";
export type Order = {
  id: string;
  customer: string;
  city: string;
  total: number;
  items: number;
  status: OrderStatus;
  channel: string;
  minutesAgo: number;
};
const NAMES = [
  "Budi Santoso", "Siti Nurhaliza", "Dewi Lestari", "Agus Salim", "Rina Wijaya",
  "Andi Pratama", "Putri Ayu", "Rizky Ramadhan", "Maya Sari", "Fajar Nugroho",
  "Indah Permata", "Doni Kusuma", "Lina Marlina", "Hendra Gunawan", "Wulan Dari",
];
const CITIES = ["Jakarta", "Bandung", "Surabaya", "Medan", "Makassar", "Semarang", "Yogyakarta", "Denpasar", "Bekasi", "Depok"];
const CHANNELS = ["Toko Online", "Instagram", "WhatsApp", "TikTok Shop", "Google"];

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

export const ONLINE_NOW = 47; // stable mock; realtime ticker jitters this client-side
export const CUSTOMER_COUNT = 3128;

// ---- customers ----
export type Segment = "baru" | "reguler" | "loyal" | "vip";
export type Customer = {
  id: string; name: string; email: string; phone: string; city: string;
  orders: number; spent: number; segment: Segment; joinedDaysAgo: number;
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
export type BlogPost = { id: string; title: string; handle: string; blog: string; author: string; published: boolean; publishedDaysAgo: number; excerpt: string; comments: number };
export const BLOG_POSTS: BlogPost[] = [
  { id: "BP-1", title: "Promo Gajian: Diskon s/d 40% Sepanjang Bulan Ini", handle: "promo-gajian-diskon", blog: "Berita Toko", author: "Ongki Pratama", published: true, publishedDaysAgo: 2, excerpt: "Nikmati potongan harga untuk ratusan produk pilihan selama periode gajian.", comments: 8 },
  { id: "BP-2", title: "5 Tips Memilih Ukuran Baju yang Pas saat Belanja Online", handle: "tips-memilih-ukuran-baju", blog: "Tips & Panduan", author: "Sari Melati", published: true, publishedDaysAgo: 5, excerpt: "Panduan singkat agar tidak salah ukuran ketika belanja fashion secara online.", comments: 3 },
  { id: "BP-3", title: "Cara Merawat Sepatu Sneakers Agar Awet", handle: "cara-merawat-sneakers", blog: "Tips & Panduan", author: "Sari Melati", published: true, publishedDaysAgo: 9, excerpt: "Langkah mudah membersihkan dan menyimpan sneakers kesayangan.", comments: 12 },
  { id: "BP-4", title: "Kami Kini Melayani Pengiriman Instan Se-Jabodetabek", handle: "pengiriman-instan-jabodetabek", blog: "Berita Toko", author: "Ongki Pratama", published: true, publishedDaysAgo: 14, excerpt: "Pesanan sampai di hari yang sama dengan GoSend & GrabExpress.", comments: 5 },
  { id: "BP-5", title: "Rekomendasi Hadiah untuk Anak Sesuai Usia", handle: "rekomendasi-hadiah-anak", blog: "Tips & Panduan", author: "Dewi Anggraini", published: false, publishedDaysAgo: 1, excerpt: "Bingung memilih mainan edukatif? Simak rekomendasi berdasarkan usia anak.", comments: 0 },
  { id: "BP-6", title: "Panduan Klaim Garansi Produk Elektronik", handle: "panduan-klaim-garansi", blog: "Tips & Panduan", author: "Sari Melati", published: true, publishedDaysAgo: 25, excerpt: "Ketahui prosedur dan syarat klaim garansi agar prosesnya cepat.", comments: 2 },
];

// ---- Navigation menus (modeled on Shopify Menu + MenuItem, itemType ~ MenuItemType) ----
export type NavItemType = "beranda" | "koleksi" | "produk" | "halaman" | "blog" | "url";
export type NavItem = { id: string; title: string; type: NavItemType; target: string; children?: NavItem[] };
export type NavMenu = { handle: string; title: string; isDefault: boolean; items: NavItem[] };
export const MENUS: NavMenu[] = [
  {
    handle: "main-menu", title: "Menu Utama", isDefault: true,
    items: [
      { id: "m1", title: "Beranda", type: "beranda", target: "/" },
      { id: "m2", title: "Semua Produk", type: "koleksi", target: "/collections/all" },
      { id: "m3", title: "Kategori", type: "url", target: "#", children: [
        { id: "m3a", title: "Fashion", type: "koleksi", target: "/collections/fashion" },
        { id: "m3b", title: "Elektronik", type: "koleksi", target: "/collections/elektronik" },
        { id: "m3c", title: "Kecantikan", type: "koleksi", target: "/collections/kecantikan" },
      ]},
      { id: "m4", title: "Promo", type: "koleksi", target: "/collections/promo" },
      { id: "m5", title: "Blog", type: "blog", target: "/blogs/berita-toko" },
      { id: "m6", title: "Kontak", type: "halaman", target: "/pages/kontak" },
    ],
  },
  {
    handle: "footer", title: "Menu Footer", isDefault: false,
    items: [
      { id: "f1", title: "Tentang Kami", type: "halaman", target: "/pages/tentang-kami" },
      { id: "f2", title: "Cara Pemesanan", type: "halaman", target: "/pages/cara-pemesanan" },
      { id: "f3", title: "Kebijakan Pengembalian", type: "halaman", target: "/pages/kebijakan-pengembalian" },
      { id: "f4", title: "Kebijakan Privasi", type: "halaman", target: "/pages/kebijakan-privasi" },
      { id: "f5", title: "FAQ", type: "halaman", target: "/pages/faq" },
    ],
  },
];

// ---- marketing: ad channels + tracking pixels (Meta / Google / TikTok) ----
export type AdChannelKey = "meta" | "google" | "tiktok";
export type AdCampaign = { name: string; spend: number; conversions: number; revenue: number };
export type AdChannel = {
  key: AdChannelKey; name: string; brand: string; connected: boolean;
  pixelLabel: string; pixelId: string; pixelActive: boolean; capiActive: boolean;
  spend: number; impressions: number; clicks: number; conversions: number; revenue: number;
  campaigns: AdCampaign[];
};
export const AD_CHANNELS: AdChannel[] = [
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

// ---- analytics extras (funnel, region, device, new-vs-returning) ----
export const FUNNEL = [
  { step: "Kunjungan", count: 18_816 },
  { step: "Lihat Produk", count: 11_740 },
  { step: "Tambah ke Keranjang", count: 4_180 },
  { step: "Mulai Checkout", count: 1_512 },
  { step: "Pembelian", count: 646 },
];
export const REGION_SALES = [
  { city: "Jakarta", sales: 31_400_000 },
  { city: "Bandung", sales: 18_900_000 },
  { city: "Surabaya", sales: 16_200_000 },
  { city: "Medan", sales: 11_800_000 },
  { city: "Semarang", sales: 9_600_000 },
  { city: "Makassar", sales: 7_300_000 },
  { city: "Lainnya", sales: 22_732_299 },
];
export const DEVICE_SPLIT = [
  { device: "Ponsel", value: 78 },
  { device: "Desktop", value: 18 },
  { device: "Tablet", value: 4 },
];
export const NEW_VS_RETURNING = [
  { type: "Pelanggan Baru", value: 62 },
  { type: "Pelanggan Kembali", value: 38 },
];
