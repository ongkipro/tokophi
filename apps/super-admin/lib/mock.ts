// Deterministic mock dataset for the Indostore SUPER ADMIN (platform control plane).
// Anchored to a fixed TODAY so SSR === client (no hydration mismatch).

export const TODAY = new Date("2026-07-02T00:00:00");

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Plan = "pemula" | "bisnis" | "skala";
export type StoreStatus = "aktif" | "trial" | "ditangguhkan";

export type Store = {
  id: string;
  name: string;
  owner: string;
  email: string;
  city: string;
  plan: Plan;
  status: StoreStatus;
  gmv: number; // total transaction value (IDR)
  orders: number;
  products: number;
  createdDaysAgo: number;
};

const STORE_SEED: Array<[string, string, string, Plan, StoreStatus]> = [
  ["Batik Nusantara", "Ongki Pratama", "Yogyakarta", "bisnis", "aktif"],
  ["Kopi Senja", "Rani Kusuma", "Bandung", "pemula", "aktif"],
  ["GadgetKu Store", "Andi Wijaya", "Jakarta", "bisnis", "aktif"],
  ["Hijab Cantik", "Siti Aminah", "Surabaya", "bisnis", "aktif"],
  ["Sneakers ID", "Budi Hartono", "Jakarta", "skala", "aktif"],
  ["Skincare Glow", "Maya Putri", "Medan", "bisnis", "aktif"],
  ["Snack Kekinian", "Dewi Sartika", "Semarang", "pemula", "trial"],
  ["Tas Kulit Asli", "Rizal Fahmi", "Bandung", "pemula", "aktif"],
  ["Baju Anak Lucu", "Nina Marlina", "Bekasi", "pemula", "trial"],
  ["Herbal Sehat", "Hendra Saputra", "Solo", "bisnis", "aktif"],
  ["Kopi Gayo Aceh", "Teuku Rizki", "Banda Aceh", "pemula", "aktif"],
  ["Furniture Minimalis", "Agus Setiawan", "Jepara", "skala", "aktif"],
  ["Aksesoris HP", "Lia Puspita", "Depok", "pemula", "trial"],
  ["Parfum Original", "Fajar Nugraha", "Tangerang", "bisnis", "aktif"],
  ["Fashion Muslimah", "Aisyah Rahma", "Makassar", "bisnis", "aktif"],
  ["Sepatu Lokal Pride", "Doni Kurniawan", "Bandung", "pemula", "ditangguhkan"],
  ["Madu Hutan Murni", "Wawan Setiadi", "Palembang", "pemula", "aktif"],
  ["Elektronik Jaya", "Susanti Dewi", "Surabaya", "skala", "aktif"],
];

export const STORES: Store[] = STORE_SEED.map(([name, owner, city, plan, status], i) => {
  const rnd = mulberry32(7000 + i * 13);
  const base = plan === "skala" ? 180_000_000 : plan === "bisnis" ? 70_000_000 : 18_000_000;
  const gmv = status === "trial" ? Math.round(1_000_000 + rnd() * 6_000_000) : Math.round(base * (0.5 + rnd()));
  const aov = 120_000 + Math.round(rnd() * 130_000);
  return {
    id: `STR-${2001 + i}`,
    name,
    owner,
    email: `${owner.split(" ")[0].toLowerCase()}@${name.toLowerCase().replace(/[^a-z0-9]+/g, "")}.id`,
    city,
    plan,
    status,
    gmv,
    orders: Math.max(1, Math.round(gmv / aov)),
    products: Math.round(20 + rnd() * 240),
    createdDaysAgo: Math.round(5 + rnd() * 500),
  };
});

// ---- plans ----
export type PlanInfo = { key: Plan; name: string; price: number; blurb: string; features: string[] };
export const PLANS: PlanInfo[] = [
  { key: "pemula", name: "Pemula", price: 99_000, blurb: "Untuk toko baru", features: ["1 toko", "Produk tak terbatas", "Fitur inti", "Support email"] },
  { key: "bisnis", name: "Bisnis", price: 299_000, blurb: "Untuk toko berkembang", features: ["Multi-toko", "Analitik lanjutan", "Pemasaran & iklan", "CRM WhatsApp", "Support prioritas"] },
  { key: "skala", name: "Skala", price: 799_000, blurb: "Untuk volume tinggi", features: ["Semua fitur Bisnis", "API akses", "Multi-lokasi", "Peran lanjutan", "Account manager"] },
];

export const planName = (k: Plan) => PLANS.find((p) => p.key === k)?.name ?? k;
export const planPrice = (k: Plan) => PLANS.find((p) => p.key === k)?.price ?? 0;

// ---- platform metrics (derived) ----
const activeStores = STORES.filter((s) => s.status === "aktif");
export const PLATFORM = {
  mrr: activeStores.reduce((a, s) => a + planPrice(s.plan), 0),
  gmv: STORES.reduce((a, s) => a + s.gmv, 0),
  totalStores: STORES.length,
  activeStores: activeStores.length,
  trialStores: STORES.filter((s) => s.status === "trial").length,
  suspendedStores: STORES.filter((s) => s.status === "ditangguhkan").length,
  newSignups30d: 7,
  churnRate: 2.4,
  arpu: activeStores.length ? Math.round(activeStores.reduce((a, s) => a + planPrice(s.plan), 0) / activeStores.length) : 0,
};

export const planDistribution = PLANS.map((p) => ({
  plan: p.key,
  name: p.name,
  count: STORES.filter((s) => s.plan === p.key).length,
  mrr: STORES.filter((s) => s.plan === p.key && s.status === "aktif").length * p.price,
}));

// ---- MRR trend (12 months, deterministic uptrend) ----
const MONTHS = ["Ags", "Sep", "Okt", "Nov", "Des", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul"];
export const MRR_SERIES = (() => {
  const rnd = mulberry32(4242);
  let v = PLATFORM.mrr * 0.42;
  return MONTHS.map((m) => {
    v = v * (1.06 + rnd() * 0.05);
    return { month: m, mrr: Math.round(v) };
  });
})();
// pin the last point to the real MRR
if (MRR_SERIES.length) MRR_SERIES[MRR_SERIES.length - 1].mrr = PLATFORM.mrr;

// ---- invoices ----
export type InvoiceStatus = "dibayar" | "menunggu" | "gagal";
export type Invoice = { id: string; store: string; plan: Plan; amount: number; status: InvoiceStatus; daysAgo: number };
export const INVOICES: Invoice[] = STORES.filter((s) => s.status !== "trial")
  .slice(0, 12)
  .map((s, i) => {
    const rnd = mulberry32(9000 + i * 5);
    const sr = rnd();
    const status: InvoiceStatus = s.status === "ditangguhkan" ? "gagal" : sr < 0.82 ? "dibayar" : sr < 0.94 ? "menunggu" : "gagal";
    return { id: `INV-${9001 + i}`, store: s.name, plan: s.plan, amount: planPrice(s.plan), status, daysAgo: Math.round(i * 2 + rnd() * 4) };
  });

// ---- platform activity feed ----
export type PActivity = { id: string; kind: "signup" | "upgrade" | "payment" | "churn" | "support"; text: string; minutesAgo: number };
export const P_ACTIVITY: PActivity[] = [
  { id: "pa1", kind: "signup", text: "Toko baru “Snack Kekinian” mendaftar (trial)", minutesAgo: 14 },
  { id: "pa2", kind: "payment", text: "Pembayaran Rp299.000 dari “Hijab Cantik” (Bisnis)", minutesAgo: 52 },
  { id: "pa3", kind: "upgrade", text: "“Sneakers ID” upgrade Bisnis → Skala", minutesAgo: 130 },
  { id: "pa4", kind: "signup", text: "Toko baru “Aksesoris HP” mendaftar (trial)", minutesAgo: 210 },
  { id: "pa5", kind: "support", text: "Tiket support baru dari “GadgetKu Store”", minutesAgo: 275 },
  { id: "pa6", kind: "churn", text: "“Sepatu Lokal Pride” ditangguhkan (gagal bayar)", minutesAgo: 340 },
  { id: "pa7", kind: "payment", text: "Pembayaran Rp799.000 dari “Elektronik Jaya” (Skala)", minutesAgo: 410 },
];
