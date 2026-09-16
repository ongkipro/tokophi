// Seed the local Postgres — SINGLE-TENANT MVP: one real store, "Batik Nusantara"
// (the same store the admin manages and the storefront sells). Run:
//   npm run seed -w @tokophi/db   (idempotent — truncates public tables first)
import { db, client, schema } from "./client";
import { and, desc, eq, sql } from "drizzle-orm";
import { COURIERS } from "@tokophi/lib/couriers";
// The one writer of `users.password_hash` (scrypt `salt:hash`) and the one MINT — see
// @tokophi/lib/password. There is no second implementation of either, anywhere (enforced by
// `packages/lib/src/password.test.ts`, which scans every tracked source file).
import { hashPassword, tempPassword, PUBLISHED_PASSWORDS } from "@tokophi/lib/password";
import { assertTruncateIsDeliberate } from "./seed-guard";
import { packedDims } from "./product-dims";
import { slugify } from "@tokophi/lib/store-slug";
import { BILLING, subscriptionCharge } from "@tokophi/lib/billing";
import { calculateOrderFinance } from "@tokophi/lib/order-finance";

// ── SEEDED CREDENTIALS — RANDOM PER ACCOUNT, PER RUN, REVEALED ONCE (N29) ─────────────────────────
//
// 🔴 THIS USED TO BE `const DEV_OWNER_PASSWORD = "tokophi123"` — ONE constant, hashed into the store
// owner, the platform operator, every demo store's owner and every registered demo customer. The
// string was published in this repository, in `AGENTS.md`, in `README.md`, in `SYSTEM_GUIDE.md` and
// on both login screens. Audit wave 5 deleted it from the SCREENS; the ROWS were untouched, because
// the seed is not a migration. Measured read-only on production 2026-08-03
// (`specs/docs/tasks/2026-08-03-rotate-exposed-owners.md` §①): **7 of 8 store owners, plus the
// platform operator, authenticate with it.** Re-measured 2026-08-05: the demo store's owner still does.
//
// ⚠️ WHAT THIS IS **NOT**, and the first draft of this comment got it wrong in the expensive direction.
// The demo store's 219 orders are a **DUMMY set** — 32 distinct phone numbers across all 219, buyer
// names like "feri crut". There is no real buyer's name, number or address behind that login, and
// saying otherwise would have put a false severity into the one file everybody greps. **Overstating an
// exposure is as bad as understating one**: the next person prices their response off this sentence.
// Nor is that account a defect: `demo@tokophi.com` / `tokophi123` is a credential the OWNER chose,
// deliberately, for a demo store. **This change is about the accounts a NEW deployment mints** — it
// leaves every existing row exactly as it is, which is the whole meaning of "the seed is not a
// migration". Rotating an existing one is a procedure, not a code change: see §②/§③ of that doc.
// (The platform operator on production, `ongkiardiansyah@gmail.com`, is already off the constant.)
//
// So: no fixed default. Each account gets its own 60-bit mint and the run PRINTS them once at the
// end, which is the only copy that will ever exist (nothing writes a password to a table or a file).
// On Coolify that lands in the deploy log for the ONE deploy that seeds an empty database.
//
// ⚠️ PER ACCOUNT, not per run. A single random string shared by nine accounts is unguessable but
// still one-breach-opens-all — the same shape as the defect being repaired, with a fresher constant.
// `2026-08-03-rotate-exposed-owners.md` §③ says it in as many words ("One password per account").
//
// **`SEED_OWNER_PASSWORD` pins every seeded account to one string you choose.** Kept deliberately,
// because the alternative is worse: this database is shared by several agents and re-seeded by hand,
// so a login nobody can predict is a login someone re-adds a constant to get back — and a constant
// re-added quietly is how this defect existed in the first place. An env var makes the choice an ACT,
// leaves no fixed string in a tracked file (`packages/lib/src/password.test.ts` scans every one), and
// is absent by default, which is the case that matters on a deploy. Never set it on one that faces
// the internet.
const PINNED_PASSWORD = process.env.SEED_OWNER_PASSWORD?.trim() || null;
// …and it may not be used to put the published string back. `SEED_OWNER_PASSWORD=tokophi123` would
// reproduce the exact defect above, with all of the deliberateness and none of the safety. Refusing
// one comparison is cheaper than discovering it on a deploy log six weeks later.
if (PINNED_PASSWORD && (PUBLISHED_PASSWORDS as readonly string[]).includes(PINNED_PASSWORD.toLowerCase())) {
  throw new Error(
    `SEED_OWNER_PASSWORD is a published default ("${PINNED_PASSWORD}") — that is the exact credential N29 removed. Pick another, or unset it and let the seed mint one per account.`,
  );
}
/** Every credential this run minted, printed once at the end. `[what it opens, the password]`. */
const MINTED: Array<[string, string]> = [];
/** A password for ONE seeded account. Recorded so the run can reveal it; never returned twice. */
function seedPassword(who: string): string {
  const pw = PINNED_PASSWORD ?? tempPassword();
  MINTED.push([who, pw]);
  return pw;
}

const TODAY = new Date("2026-07-02T00:00:00Z");
const daysAgo = (n: number) => new Date(TODAY.getTime() - n * 86_400_000);
const minutesAgo = (n: number) => new Date(TODAY.getTime() - n * 60_000);
// Billing lifecycle dates must be relative to the REAL clock (not the TODAY anchor), else trials/
// periods lapse whenever the deploy date drifts past the anchor — computeBilling uses `new Date()`.
const fromNow = (days: number) => new Date(Date.now() + days * 86_400_000);
// ⚠️ `slugify` writes `stores.slug` for the 6 extra demo stores (line ~1739) — those are STORE
// slugs, and they must follow the same rule the two app-side creation paths use. It was a third
// private copy, without NFKD; names that are pure ASCII happened to agree, a demo store with an
// accent in its name would have been seeded onto a different address than the app would have minted
// for it. (The ONE main store is the deliberate exception since the 2026-08-12 rename: its slug is
// the literal `batiknusantara`, not `slugify("Batik Nusantara")` — see the insert.)

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

// Single-plan TokoΦ subscription amounts, via the SAME subscriptionCharge() the three real invoice
// creators use — PPN off matches the platform default at launch (platform_finance.subscription_ppn_enabled).
// Writing amountIdr with tax baked in while taxIdr stayed 0 (the old hardcoded 305_250/55_500) made every
// seeded invoice self-contradictory the moment the toggle defaulted off.
const SUB_MONTHLY_CHARGE = subscriptionCharge(BILLING.MONTHLY_IDR, false);
const SUB_FIRST_MONTH_CHARGE = subscriptionCharge(BILLING.FIRST_MONTH_IDR, false);
const SUB_MONTHLY = SUB_MONTHLY_CHARGE.total;
const SUB_FIRST_MONTH = SUB_FIRST_MONTH_CHARGE.total;

// THE COD POLICY, defined ONCE — the platform_cod row below is seeded from these, and so is the
// choice of which demo orders are COD. Two literals would let the seed mint a COD order in a
// province the live eligibility chain (apps/admin/lib/cod.ts) refuses, or above the cap: demo data
// that contradicts the rule it is supposed to demonstrate.
const COD_ALLOWED_PROVINCES = ["DI Yogyakarta", "Jawa Tengah", "Jawa Barat", "DKI Jakarta", "Banten", "Jawa Timur"];
const COD_MAX_IDR = 2_000_000;

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
      // CANONICAL `62…` (migration 0048 / @tokophi/lib/validate normalizePhone). The seed used to
      // write `0812…`, which is what a human types — but not what KiriminAja books against, what a
      // wa.me link needs, or what the customer lookup keys on. Storing the typed shape is how the
      // same buyer ended up as two customers.
      phone: "62812" + String(1000000 + Math.floor(rnd() * 8999999)),
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
// `imageUrl` = the category COVER. It drives CategoryHero: a cover → the full-bleed banner hero, none →
// the centred minimal header. Seeded here so the demo's banner hero is the DEFAULT (survives a full
// reseed); real merchants set their own in the Kategori editor. Uses each category's flagship product
// photo — a proper landscape banner reads even better, but the merchant chooses that.
const COLLECTIONS: Array<{ name: string; emoji: string; type: "manual" | "otomatis"; published: boolean; blurb?: string; imageUrl?: string }> = [
  { name: "Dress", emoji: "👗", type: "otomatis", published: true, blurb: "Dress harian sampai acara spesial", imageUrl: "/products/dress-midi-bunga.webp" },
  { name: "Atasan", emoji: "👚", type: "otomatis", published: true, blurb: "Blouse, kemeja, & tunik", imageUrl: "/products/blouse-katun.webp" },
  { name: "Bawahan", emoji: "👖", type: "otomatis", published: true, blurb: "Rok & celana kulot", imageUrl: "/products/celana-kulot.webp" },
  { name: "Busana Muslim", emoji: "🧕", type: "otomatis", published: true, blurb: "Hijab, khimar, & gamis", imageUrl: "/products/gamis-syari.webp" },
  { name: "Produk Terlaris", emoji: "🔥", type: "otomatis", published: true, imageUrl: "/products/dress-batik.webp" },
  { name: "Loungewear", emoji: "🩱", type: "otomatis", published: true, blurb: "Nyaman untuk di rumah", imageUrl: "/products/cardigan-rajut.webp" },
  { name: "Outerwear", emoji: "🧥", type: "otomatis", published: false, blurb: "Cardigan & blazer", imageUrl: "/products/blazer-wanita.webp" },
];

// ---- orders (mirror admin mock buildOrders: mulberry32(555)) ----
const NAMES15 = CUST_POOL.slice(0, 15);
const CHANNELS = ["Meta Ads", "TikTok Ads", "Google Ads", "Organic", "Other"];
const CHANNEL_MAP: Record<string, "meta_ads" | "tiktok_ads" | "google_ads" | "organic" | "other"> = {
  "Meta Ads": "meta_ads", "TikTok Ads": "tiktok_ads", "Google Ads": "google_ads", Organic: "organic", Other: "other",
};
type OrderStatus = "baru" | "diproses" | "dikirim" | "selesai" | "batal";
const N_DAYS = 120;
// Orders are the SINGLE SOURCE OF TRUTH for money. They used to be 60 rows crammed into the last
// ~3 days, while `analytics_daily` invented its own 120-day series with no relationship to them —
// two universes. June: the rollup claimed Rp117.932.299 / 646 orders while `orders` held
// Rp9.741.000 / 32. So the Dashboard showed Rp117jt, Saldo showed Rp18jt, and Pesanan listed 32
// rows: three screens, three answers, all "real". Now the orders are spread across the full 120
// days and analytics_daily is DERIVED from them (see DAILY below), so every screen reconciles.
const ORDERS_SEED = (() => {
  const rnd = mulberry32(555);
  const out: Array<{ number: string; customer: string; city: string; total: number; picks: number[]; status: OrderStatus; channel: string; minutesAgo: number }> = [];
  let n = 0;
  for (let d = N_DAYS - 1; d >= 0; d--) {
    const day = new Date(ADMIN_TODAY);
    day.setUTCDate(day.getUTCDate() - d);
    const dow = day.getUTCDay();
    // the seasonality the old hand-made chart had, now expressed as ORDERS rather than as a
    // revenue curve nobody could trace back to a transaction
    const weekend = dow === 0 || dow === 6 ? 0.82 : 1;
    const payday = day.getUTCDate() === 25 || day.getUTCDate() === 1 ? 1.35 : 1;
    const trend = 1 + ((N_DAYS - d) / N_DAYS) * 0.55; // the shop grows over the window
    const count = Math.max(1, Math.round(4.6 * weekend * payday * trend * (0.75 + rnd() * 0.5)));

    for (let k = 0; k < count; k++) {
      const items = 1 + Math.floor(rnd() * 4);
      let total = 0;
      const picks: number[] = [];
      for (let j = 0; j < items; j++) {
        const idx = Math.floor(rnd() * CATALOG.length);
        total += CATALOG[idx].price;
        picks.push(idx);
      }
      // Status follows AGE, which is what actually happens: a 3-month-old order is finished; a
      // yesterday one is still being packed. The old seed rolled status at random, so the shop had
      // orders "baru" from four months ago.
      const sr = rnd();
      const status: OrderStatus =
        d > 14
          ? sr < 0.93 ? "selesai" : "batal"
          : d > 5
            ? sr < 0.14 ? "batal" : sr < 0.75 ? "selesai" : "dikirim"
            : d > 2
              ? sr < 0.5 ? "dikirim" : sr < 0.85 ? "diproses" : "selesai"
              : sr < 0.45 ? "baru" : sr < 0.85 ? "diproses" : "dikirim";

      out.push({
        number: `PHI-${5200 - n}`,
        customer: NAMES15[Math.floor(rnd() * NAMES15.length)],
        city: CITIES[Math.floor(rnd() * CITIES.length)],
        total,
        picks,
        status,
        channel: CHANNELS[Math.floor(rnd() * CHANNELS.length)],
        minutesAgo: d * 1440 + Math.floor(rnd() * 1440),
      });
      n++;
    }
  }
  return out.sort((a, b) => a.minutesAgo - b.minutesAgo);
})();

// ---- CMS: pages, blogs, articles ----
// `body` is PLAIN TEXT, not HTML or markdown: the admin's page/article editor is still a textarea
// (Tiptap is on the backlog), so whatever a merchant types lands here verbatim. The storefront
// renders it by splitting on blank lines into <p> — never `set:html` — so merchant text can't inject
// markup. Blocks are separated by a blank line; a line ending in ":" reads as a lead-in, and lines
// starting with "- " render as a list (see apps/storefront/src/data/content.ts).
const PAGES: Array<{ title: string; handle: string; published: boolean; updatedDaysAgo: number; template: string; views: number; body: string }> = [
  { title: "Tentang Kami", handle: "tentang-kami", published: true, updatedDaysAgo: 3, template: "page", views: 1240, body: `Batik Nusantara lahir dari satu keyakinan sederhana: batik tidak harus disimpan untuk acara resmi saja. Kain yang indah pantas dipakai di hari biasa — ke kantor, ke undangan, atau sekadar menemani akhir pekan.

Kami mulai pada 2019 dari satu meja jahit di Solo, bekerja sama dengan pembatik yang sudah puluhan tahun menekuni motif tulis. Hari ini kami bekerja dengan 14 perajin, dan setiap potong yang kami kirim masih melewati tangan mereka.

Yang kami pegang:

- Motif tulis dan cap dari perajin, bukan cetakan pabrik.
- Bahan yang adem — katun primissima, rayon, dan linen pilihan.
- Jahitan yang rapi di bagian yang tidak terlihat sekalipun.
- Harga yang jujur: kami sebutkan biayanya, tanpa harga coret palsu.

Terima kasih sudah mampir. Kalau ada yang ingin ditanyakan, sapa kami lewat WhatsApp — kami balas sendiri, bukan robot.` },
  { title: "Kontak", handle: "kontak", published: true, updatedDaysAgo: 12, template: "page.contact", views: 980, body: `Ada pertanyaan soal ukuran, bahan, atau pesanan yang sedang berjalan? Kami senang dibantu.

WhatsApp adalah jalur tercepat — biasanya kami balas di bawah 1 jam pada jam kerja.

Jam operasional:

- Senin–Jumat: 09.00–17.00 WIB
- Sabtu: 09.00–14.00 WIB
- Minggu & hari libur nasional: tutup

Pesan yang masuk di luar jam kerja tetap kami baca dan balas di hari kerja berikutnya.` },
  { title: "Cara Pemesanan", handle: "cara-pemesanan", published: true, updatedDaysAgo: 8, template: "page", views: 2110, body: `Belanja di Batik Nusantara tidak perlu membuat akun. Empat langkah, selesai.

1. Pilih produk, lalu tentukan warna dan ukurannya. Stok setiap kombinasi tampil langsung — kalau bisa dipilih, artinya barangnya ada.

2. Masukkan ke keranjang. Anda bisa menambah produk lain sebelum lanjut.

3. Isi data pengiriman di halaman checkout. Ongkir dihitung otomatis begitu kota tujuan terisi, dari kurir yang benar-benar melayani alamat Anda.

4. Pilih cara bayar — transfer bank (virtual account), QRIS, e-wallet, atau COD bila tersedia di daerah Anda. Pesanan kami proses setelah pembayaran terkonfirmasi.

Nomor resi kami kirimkan lewat WhatsApp begitu paket diserahkan ke kurir, biasanya di hari kerja yang sama bila pesanan masuk sebelum pukul 14.00 WIB.` },
  { title: "Kebijakan Pengembalian & Refund", handle: "kebijakan-pengembalian", published: true, updatedDaysAgo: 21, template: "page", views: 640, body: `Kami ingin Anda puas dengan yang Anda terima. Kalau ada yang tidak beres, kabari kami.

Pengembalian bisa diajukan dalam 7 hari sejak paket diterima, dengan syarat:

- Produk belum dipakai dan belum dicuci.
- Label dan kemasan asli masih terpasang.
- Ada foto/video saat paket dibuka bila alasannya cacat produk atau salah kirim.

Cacat produk atau salah kirim: ongkos kirim balik kami tanggung, dan Anda boleh memilih tukar ukuran, tukar produk, atau refund penuh.

Berubah pikiran atau salah pilih ukuran: penukaran tetap kami layani, namun ongkos kirim balik ditanggung pembeli.

Dana refund kami kembalikan ke rekening atau e-wallet asal dalam 3–5 hari kerja setelah barang kami terima dan kami periksa.

Tidak bisa dikembalikan: produk diskon akhir stok (tertulis jelas di halaman produk) dan produk custom sesuai permintaan.` },
  { title: "Syarat & Ketentuan", handle: "syarat-ketentuan", published: true, updatedDaysAgo: 30, template: "page", views: 410, body: `Dengan berbelanja di Batik Nusantara, Anda menyetujui ketentuan berikut.

Harga dan ketersediaan. Semua harga dalam Rupiah dan sudah termasuk pajak yang berlaku. Stok dapat berubah sewaktu-waktu; bila produk yang Anda pesan ternyata habis, kami akan menghubungi Anda untuk penggantian atau refund penuh.

Warna produk. Foto kami ambil dengan pencahayaan senetral mungkin, namun warna dapat tampak sedikit berbeda antar layar. Perbedaan tipis semacam ini tidak termasuk cacat produk.

Kain tulis. Motif batik tulis dikerjakan tangan, sehingga selalu ada variasi kecil antar potong. Itu tanda keasliannya, bukan kerusakan.

Pembayaran. Pesanan diproses setelah pembayaran terkonfirmasi. Pesanan yang belum dibayar dalam 24 jam akan dibatalkan otomatis dan stoknya dilepas kembali.

Pengiriman. Estimasi waktu kirim berasal dari kurir dan di luar kendali kami. Keterlambatan oleh kurir tidak menjadi dasar pembatalan sepihak, namun kami akan membantu menelusurinya.` },
  { title: "Kebijakan Privasi", handle: "kebijakan-privasi", published: true, updatedDaysAgo: 30, template: "page", views: 305, body: `Kami mengumpulkan data seperlunya saja, untuk mengantar pesanan Anda.

Yang kami simpan: nama, nomor WhatsApp, alamat pengiriman, dan riwayat pesanan. Itu saja.

Yang TIDAK kami simpan: nomor kartu, PIN, atau kredensial pembayaran apa pun. Pembayaran diproses oleh penyedia pembayaran berlisensi; data itu tidak pernah melewati sistem kami.

Kami membagikan data Anda hanya kepada pihak yang memang perlu untuk menyelesaikan pesanan — kurir pengiriman dan penyedia pembayaran. Kami tidak menjual data Anda kepada siapa pun.

Anda berhak meminta salinan data Anda, atau meminta kami menghapusnya. Sampaikan lewat WhatsApp dan kami proses dalam 7 hari kerja. Data pesanan yang wajib kami simpan untuk keperluan pembukuan akan kami pertahankan sesuai ketentuan yang berlaku.` },
  { title: "FAQ — Pertanyaan Umum", handle: "faq", published: false, updatedDaysAgo: 1, template: "page", views: 0, body: `Draf. Belum tayang.` },
];
const BLOGS = ["Berita Toko", "Tips & Panduan"];
const ARTICLES: Array<{ title: string; handle: string; blog: string; author: string; published: boolean; publishedDaysAgo: number; excerpt: string; comments: number; imageUrl: string; body: string }> = [
  { title: "Promo Gajian: Diskon s/d 40% Sepanjang Bulan Ini", handle: "promo-gajian-diskon", blog: "Berita Toko", author: "Ongki Pratama", published: true, publishedDaysAgo: 2, excerpt: "Nikmati potongan harga untuk ratusan produk pilihan selama periode gajian.", comments: 8, imageUrl: "/products/dress-batik.webp", body: `Gajian sudah cair, dan kami menyiapkan sesuatu untuk Anda.

Sepanjang bulan ini, ratusan produk pilihan kami turunkan harganya hingga 40%. Bukan harga coret yang dinaikkan dulu — harga sebelumnya bisa Anda cek sendiri di riwayat halaman produk.

Yang masuk promo:

- Koleksi dress midi dan dress batik — diskon hingga 40%.
- Atasan katun dan blouse — diskon 25%.
- Busana muslim: gamis, tunik, dan khimar — diskon 30%.

Beberapa catatan jujur. Stok ukuran populer (M dan L) biasanya habis lebih dulu, jadi kalau ada yang Anda incar, jangan menunggu terlalu lama. Produk diskon akhir stok tidak bisa ditukar — statusnya kami tulis jelas di halaman produknya masing-masing.

Promo berlaku otomatis di keranjang. Tidak perlu kode.` },
  { title: "5 Tips Memilih Ukuran Baju yang Pas saat Belanja Online", handle: "tips-memilih-ukuran-baju", blog: "Tips & Panduan", author: "Sari Melati", published: true, publishedDaysAgo: 5, excerpt: "Panduan singkat agar tidak salah ukuran ketika belanja fashion secara online.", comments: 3, imageUrl: "/products/blouse-katun.webp", body: `Salah ukuran adalah alasan nomor satu orang enggan belanja baju online. Padahal sebagian besar bisa dihindari dengan lima menit persiapan.

Ukur badan Anda, bukan menebak. Siapkan meteran kain. Ukur lingkar dada di titik terlebar, lingkar pinggang di bagian tersempit, dan lingkar pinggul di titik terlebar. Catat angkanya — sekali saja, dipakai seterusnya.

Baca size chart tiap produk, jangan andalkan "biasanya saya M". Ukuran M satu merek bisa berbeda 4 cm dari merek lain. Size chart kami tempel di setiap halaman produk, dalam sentimeter, bukan istilah samar.

Perhatikan bahannya. Katun dan linen nyaris tidak melar — pilih pas badan. Rajut dan jersey punya toleransi, jadi masih aman kalau ukuran Anda di antara dua nomor.

Kalau angka Anda di perbatasan, naik satu ukuran. Baju kebesaran bisa dikecilkan penjahit; baju kesempitan tidak bisa apa-apa.

Kalau masih ragu, tanya kami. Sebutkan angka lingkar dada dan tinggi badan Anda, kami sarankan ukurannya. Ini gratis, dan jauh lebih murah daripada ongkos kirim balik.` },
  { title: "Cara Merawat Baju Rajut Agar Awet", handle: "cara-merawat-rajut", blog: "Tips & Panduan", author: "Sari Melati", published: true, publishedDaysAgo: 9, excerpt: "Langkah mudah mencuci dan menyimpan baju rajut agar tidak melar.", comments: 12, imageUrl: "/products/cardigan-rajut.webp", body: `Baju rajut melar bukan karena bahannya jelek. Sembilan dari sepuluh kali, penyebabnya cara mencuci dan cara menyimpan.

Cuci dengan tangan, air dingin. Mesin cuci memutar dan menarik serat rajut sampai kehilangan bentuknya. Rendam sebentar dengan deterjen lembut, tekan-tekan pelan, jangan dikucek dan jangan diperas.

Jangan digantung saat basah. Ini kesalahan yang paling sering. Rajut basah itu berat, dan gantungan akan menarik bahunya sampai memanjang permanen. Gulung dengan handuk untuk menyerap air, lalu keringkan dengan cara dibentangkan mendatar.

Simpan dengan dilipat, bukan digantung. Berlaku juga untuk rajut kering — gravitasi bekerja pelan tapi pasti.

Bulu-bulu kecil itu wajar. Cukur pelan dengan alat pencukur kain atau silet tumpul. Jangan ditarik dengan tangan; itu justru menarik benangnya keluar.

Rajut yang dirawat begini bisa bertahan bertahun-tahun dan tetap jatuh bagus di badan.` },
  { title: "Pilihan Ekspedisi & Estimasi Sampai", handle: "pilihan-ekspedisi-estimasi-sampai", blog: "Berita Toko", author: "Ongki Pratama", published: true, publishedDaysAgo: 14, excerpt: "Ongkir semua ekspedisi tampil langsung di checkout — pilih yang termurah atau tercepat.", comments: 5, imageUrl: "/products/kemeja-oversized.webp", body: `Sekarang semua pilihan ekspedisi muncul langsung di halaman checkout, lengkap dengan ongkir dan estimasi harinya.

Begitu Anda memilih kecamatan tujuan, tarifnya dihitung real-time dari alamat gudang kami. Tidak ada ongkir kira-kira, dan tidak perlu tanya-tanya dulu lewat chat.

Yang perlu diketahui:

- Pesanan yang dibayar sebelum pukul 15.00 WIB kami serahkan ke kurir di hari yang sama.
- Layanan reguler biasanya 2–3 hari; layanan next day tiba keesokan harinya.
- Label "Termurah" dan "Tercepat" muncul otomatis supaya Anda tidak perlu membandingkan satu per satu.

Nomor resi dikirim lewat WhatsApp begitu paket dijemput kurir, jadi Anda bisa melacaknya sendiri.` },
  { title: "Rekomendasi Hadiah untuk Anak Sesuai Usia", handle: "rekomendasi-hadiah-anak", blog: "Tips & Panduan", author: "Dewi Anggraini", published: false, publishedDaysAgo: 1, excerpt: "Bingung memilih mainan edukatif? Simak rekomendasi berdasarkan usia anak.", comments: 0, imageUrl: "", body: `Draf. Belum tayang — menunggu koleksi anak dirilis.` },
  { title: "Panduan Menentukan Ukuran Baju yang Pas", handle: "panduan-ukuran-baju", blog: "Tips & Panduan", author: "Sari Melati", published: true, publishedDaysAgo: 25, excerpt: "Cara mengukur badan dan memilih size chart agar tidak salah beli.", comments: 2, imageUrl: "/products/dress-midi-bunga.webp", body: `Size chart hanya berguna kalau Anda tahu angka badan Anda sendiri. Berikut cara mengukurnya dengan benar, di rumah, tanpa alat khusus.

Yang Anda butuhkan hanya meteran kain (yang lentur, bukan meteran tukang) dan cermin. Kenakan pakaian tipis, jangan mengukur di atas jaket atau sweter.

Lingkar dada. Lingkarkan meteran di titik terpenuh dada, sejajar lantai. Tarik napas biasa — jangan ditahan, jangan dikempiskan.

Lingkar pinggang. Cari bagian tersempit badan, biasanya sedikit di atas pusar. Beri jarak satu jari agar tidak terlalu ketat.

Lingkar pinggul. Ukur di titik terlebar pinggul dan bokong, kaki rapat.

Panjang bahu ke pinggang. Dari tulang bahu turun ke garis pinggang — ini yang menentukan apakah potongan pinggang sebuah dress akan jatuh di tempat yang tepat.

Catat keempat angka itu, cocokkan dengan size chart di halaman produk. Bila dua nomor sama-sama masuk, pilih yang lebih besar untuk bahan kaku (katun, linen) dan yang lebih kecil untuk bahan melar (rajut, jersey).` },
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
// ⚠️ The two `keranjang` rows that used to sit at the top of this list were FICTION: they told the
// merchant to chase "Dress Midi Motif Bunga, still in Siti's cart" when no cart existed anywhere in
// the database — there was no cart table at all. They are gone. Cart follow-ups are now GENERATED
// from real `checkout_sessions` rows further down (search "keranjang follow-ups"), so every one of
// them points at a basket that exists, with the value and the phone that basket actually carries.
const FOLLOWUPS: Array<{ customer: string; phone: string; type: FType; context: string; dueDays: number; status: FStatus; lastMessage: string }> = [
  { customer: "Agus Salim", phone: "6281234511002", type: "pembayaran", context: "#PHI-4821 · Rp275.000", dueDays: 0, status: "menunggu", lastMessage: "" },
  { customer: "Budi Santoso", phone: "6281234511004", type: "pembayaran", context: "#INV-4818 · Rp189.000", dueDays: -2, status: "menunggu", lastMessage: "" },
  { customer: "Maya Sari", phone: "6281234511005", type: "pascabeli", context: "#INV-4815 · Rok Plisket Panjang", dueDays: 0, status: "terkirim", lastMessage: "Terima kasih sudah belanja! 🙏" },
  { customer: "Andi Pratama", phone: "6281234511006", type: "ulasan", context: "Cardigan Rajut Wanita", dueDays: 1, status: "menunggu", lastMessage: "" },
  { customer: "Dewi Lestari", phone: "6281234511007", type: "repeat", context: "Terakhir beli 32 hari lalu", dueDays: 0, status: "menunggu", lastMessage: "" },
  { customer: "Putri Ayu", phone: "6281234511008", type: "konfirmasi", context: "#INV-4820 · siap dikirim", dueDays: 0, status: "dibalas", lastMessage: "Oke kak, ditunggu ya" },
  { customer: "Hendra Gunawan", phone: "6281234511009", type: "pascabeli", context: "#INV-4809 · Madu Hutan Asli", dueDays: -1, status: "selesai", lastMessage: "Barang sudah diterima 👍" },
  { customer: "Wulan Dari", phone: "6281234511010", type: "repeat", context: "Pelanggan VIP · 45 hari", dueDays: 2, status: "menunggu", lastMessage: "" },
];
const WA_TEMPLATES: Array<{ name: string; type: string; body: string }> = [
  // ⚠️ NO `{{link}}` HERE, DELIBERATELY — `cartMessage` APPENDS the recovery link instead.
  // Two reasons, and the second is the one that bites:
  //  1. **The seed is not a migration.** A placeholder here reaches NEW stores only, so every store
  //     that already exists would still send a message with no way back — the exact bug being fixed.
  //     The append works for every store, today, with no data fix.
  //  2. This ONE body is also rendered by the CRM follow-up screens (`crm/page.tsx`,
  //     `followup-client.tsx`, `pipeline-client.tsx`), which work from `followups` rows and have no
  //     checkout session — so they CANNOT mint a link. `fillTemplate` leaves an unknown token
  //     verbatim, so seeding `{{link}}` would send the literal string `{{link}}` to a customer.
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
  // A MENU to the unified promo HUB (/promo), not a category — the hub gathers the flash sale, voucher
  // codes, free ongkir, and every discounted product on one page (PROMO P4).
  //
  // The manual "Promo Gajian" COLLECTION that used to sit alongside it is GONE. It was a hand-curated
  // list whose membership was literally `seededProducts.slice(0, 8)` — an arbitrary first-eight that
  // had nothing to do with what was actually discounted, so it advertised "Promo" over products at
  // full price while genuinely reduced ones sat outside it. `/promo` computes the same idea from the
  // real thing (flash sale ∪ markdowns ∪ vouchers ∪ free-ongkir) and cannot drift. The CAMPAIGN name
  // lives on where it belongs: the flash sale is still called "Promo Gajian" and it is the hub's title.
  //
  // Labelled **"Promo"**, not "Promo Gajian": the label named a COLLECTION while the href went to the
  // hub, so the one word the shopper reads promised a category and delivered a different page — and it
  // would go stale the moment the merchant renamed or deleted that collection. "Promo" is true of the
  // destination whatever the merchant is running this month.
  { label: "Promo", type: "url", href: "/promo" },
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
// DERIVED from ORDERS_SEED — not invented alongside it. This is the whole point: the revenue on
// the Dashboard is the sum of the orders in the Pesanan list, which is the money in the Saldo
// ledger. Three screens, one number.
//
// `visitors` is the one figure with no transaction behind it (nobody logged the browsing), so it is
// back-computed from orders at a plausible Indonesian fashion conversion rate (~2–3.5%) instead of
// being picked out of the air. The funnel events (analytics_events) are pinned to visitors and
// orders, so the conversion rate the dashboard shows is arithmetic over these same rows.
const DAILY = (() => {
  const rnd = mulberry32(20260701);
  const byDate = new Map<string, { sales: number; orders: number }>();
  // ⚠️ Anchor on TODAY, the same clock `placed_at` is written from (minutesAgo()). The seed carries
  // TWO anchors — TODAY (2026-07-02) and ADMIN_TODAY (2026-06-30) — and bucketing the rollup on one
  // while the orders are stamped from the other silently drops the rows that fall off the edge:
  // that cost Rp894.000 across 4 orders before it was caught. Derive both sides from one clock.
  for (let i = N_DAYS + 1; i >= 0; i--) {
    const d = new Date(TODAY);
    d.setUTCDate(d.getUTCDate() - i);
    byDate.set(d.toISOString().slice(0, 10), { sales: 0, orders: 0 });
  }
  for (const o of ORDERS_SEED) {
    if (o.status === "batal") continue; // a cancelled order is not revenue
    const d = new Date(TODAY.getTime() - o.minutesAgo * 60_000).toISOString().slice(0, 10);
    const cur = byDate.get(d);
    if (!cur) continue;
    cur.sales += o.total;
    cur.orders += 1;
  }
  return [...byDate.entries()].map(([date, v]) => ({
    date,
    sales: v.sales,
    orders: v.orders,
    visitors: Math.max(v.orders, Math.round(v.orders / (0.02 + rnd() * 0.015))),
  }));
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
  // Static REFERENCE data — never wiped by a demo reseed. `kelurahan` (78.764 rows) is on this list
  // because it is what the checkout's kodepos auto-fill reads: it was missing, so every SEED_FORCE=1
  // silently deleted it and broke address entry until someone re-imported by hand. CLAUDE.md names it
  // as one of the two landmines in this package; the keep-list is where that warning has to be true.
  //
  // ⚠️ IT ONLY WORKS FOR A TABLE WITH NO FK PATH OUT OF THE LIST. `cascade` reaches any table that
  // references one being truncated, so adding a store-scoped table here is a no-op that READS like
  // protection — measured, with Postgres printing `truncate cascades to table "…"` for all three of
  // `store_tracking_channels`, `page_templates`, `flash_sales`. That is the trap this comment exists
  // to close, and `src/seed-guard.ts` is the guard that replaces the longer list nobody can write.
  // (`kelurahan` is on the list DESPITE having an FK — to `kiriminaja_areas`, which is kept too.)
  const rows = await client<{ table_name: string }[]>`
    select table_name from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
      and table_name not in ('__drizzle_migrations', 'kiriminaja_areas', 'kelurahan', 'product_taxonomy')`;
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
  // Refuse (unless SEED_DESTROY_CONFIG=1) when this database holds rows no seed writes back — see
  // the note at the top of `seed-guard.ts` for why a longer keep-list is not the fix. Deliberately
  // OUTSIDE the `SEED_FORCE` branch above: that skip only counts `stores`.
  await assertTruncateIsDeliberate(client, () => client.end());
  await truncateAll();

  // plans (config)
  await db.insert(schema.plans).values(PLANS.map((p) => ({ key: p.key, name: p.name, priceIdr: p.price, blurb: p.blurb, features: p.features })));

  // the one account + owner + store + membership + settings + stats
  const [account] = await db.insert(schema.accounts).values({ name: STORE.name, plan: STORE.plan, createdAt: daysAgo(STORE.createdDaysAgo) }).returning();
  const [user] = await db.insert(schema.users).values({ email: STORE.email, name: STORE.owner, passwordHash: hashPassword(seedPassword(`Seller  ${STORE.email}`)) }).returning();
  const [store] = await db.insert(schema.stores).values({
    accountId: account.id,
    name: STORE.name,
    // RENAMED 2026-08-12: `batiknusantara`, no hyphen — deliberately NOT `slugify(STORE.name)`,
    // which yields `batik-nusantara`. The live storefront host is batiknusantara.tokophi.id, so a
    // fresh DB must be born under the new slug; databases that already exist are brought over by
    // `rename-batik-slug.ts` in the deploy migrate chain (idempotent, runs before the demo seeds).
    slug: "batiknusantara",
    // The demo store (Task 8.27, migration 0113): its seeded orders, ledger and invoices are not
    // platform money and every super-admin KPI excludes it. The migration flags the store that
    // already exists on production; this flags the one a fresh database is born with.
    isDemo: true,
    city: STORE.city,
    // The shop's OWN CS channel and pitch (migration 0049). These used to be platform CONSTANTS in
    // apps/storefront/src/data/store.ts, so `wa.me/6281234567890` — the canonical Indonesian dummy
    // number — shipped as a live "Hubungi via WhatsApp" button on every page of every store. Every
    // one of them opened a chat with nobody.
    //
    // The 6 demo stores below deliberately leave these NULL: that is the case the storefront must
    // handle, and it does — no number means no button, rather than a button that goes nowhere.
    whatsapp: "6281234500999",
    tagline: "Busana wanita modern — batik & ready-to-wear",
    // Design tokens (0092): the batik-boutique look is this store's explicit CHOICE now, not the
    // platform default. elegan/hangat reproduces the original hand-picked palette exactly — the
    // demo must render identical before/after the token system (that identity is the proof the
    // derivation is precise). The other demo stores leave `theme` NULL: that exercises the
    // no-choice fallback every real store starts from.
    theme: { font: "elegan", tone: "hangat" },
    // Public shop identity (0063) — set ONLY on the primary demo store, and this is the point of it:
    // the storefront footer's FILLED state is what a prospective merchant sees when they look at the
    // demo, so the demo has to show it. The 6 other stores leave all of these NULL (same as whatsapp
    // above), which is what exercises the empty-state gating that must never render an orphan row.
    // ⚠️ `address` is the PUBLIC shop address, NOT the courier pickup (store_settings.sender_address) —
    // see the schema note on stores.address. Handles are usernames, no @, no URL.
    address: "Jl. Malioboro No. 52\nKel. Sosromenduran, Gedongtengen\nYogyakarta 55271",
    phone: "0274-551234",
    socialInstagram: "batiknusantara",
    socialTiktok: "batik.nusantara",
    socialFacebook: "batiknusantara.id",
    socialPinterest: "batiknusantara",
    socialX: "batiknusantara",
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
  // COD is ON for the demo merchant. `cod_enabled` defaults to FALSE (0038), and the seed used to
  // leave it there — so COD was switched on by hand in the UI and then silently switched back OFF by
  // the next re-seed, taking a business decision with it. The platform half of the policy was already
  // seeded (platform_cod + codAllowed = SPX only, below); this is the merchant half. The other six
  // demo stores keep the default (off) — that is realistic, and it keeps the toggle meaningful.
  // PICKUP ADDRESS (alamat pengambilan) — it was NULL on every column, and ongkir is priced FROM it.
  // With it empty the rate endpoint fell back to fuzzy-matching the store's city name, so every quote
  // was a guess. A warehouse in a different city from the registered shop address is normal here
  // (gudang ≠ kantor), and seeding it that way is deliberate: Batik Nusantara is registered in
  // Yogyakarta but ships out of Surabaya, so a rate computed from the WRONG origin is immediately
  // visible as wrong instead of accidentally matching. `senderKecamatanId` is a KiriminAja district
  // id (6138 = Gubeng, Surabaya) — the same currency as the shopper's `destinationId`, so the origin
  // needs no resolution and cannot be guessed at.
  await db.insert(schema.storeSettings).values({
    storeId: store.id,
    codEnabled: true,
    senderName: "Gudang Batik Nusantara",
    senderPhone: "081234567890",
    senderAddress: "Jl. Raya Gubeng No. 42, Gubeng",
    senderKecamatanId: 6138,
    senderKecamatanName: "Gubeng, Surabaya, Jawa Timur",
    // no senderLat/senderLng — those columns are dead (instant/same-day delivery removed).
  });
  await db.insert(schema.storeStats).values({ storeId: store.id, gmvIdr: STORE.gmv, ordersCount: STORE.orders, productsCount: CATALOG.length, ship7dAvg: 15, updatedAt: TODAY });

  // One demo custom domain so the CNAME flow is reproducible from a fresh seed. `.test` never resolves
  // publicly, and `astro.config.mjs` allows it in dev (Vite's Host guard), so `curl -H 'Host:
  // toko-demo.test' localhost:4327` renders this store with canonical/og:url/sitemap on the custom host.
  // is_primary=true → primaryOrigin() returns https://toko-demo.test. See CUSTOM_DOMAIN.md.
  await db.insert(schema.storeDomains).values({
    storeId: store.id,
    host: "toko-demo.test",
    status: "active",
    isPrimary: true,
    verificationToken: "demotoken0123456789abcdef01234567",
    verifiedAt: TODAY,
  });

  // catalog: product → 1 default variant (price) + inventory (stock) + base media (image)
  const seededProducts: Array<{ id: string; variantId: string; category: string; unitsSold: number }> = [];
  // Reviews reference a product by NAME (REVIEWS[].product). Without this map the seed wrote
  // `productName` and left `product_id` NULL on every row — so NO product could ever carry a rating,
  // and the merchant's real, moderated reviews never reached a shopper. The storefront aggregates
  // ratings from `reviews` (apps/storefront/src/data/catalog.ts), so an unlinked review is invisible.
  const productIdByName = new Map<string, string>();
  for (const [ci, c] of CATALOG.entries()) {
    const meta = STOREFRONT_META[c.slug];
    const [p] = await db.insert(schema.products).values({
      // Catalog number (ADR 0013). Assigned from the CATALOG index so a reseed reproduces the same
      // numbers byte-for-byte, like every other value here — the seed's whole contract.
      number: 1001 + ci,
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
      // Shipping dims (cm) — the FOLDED PARCEL, per garment kind. See `product-dims.ts`.
      // ⚠️ These were `1, 1, 1`, and the comment defending it had the divisor wrong (`÷6000`, not
      // `÷6`) and the conclusion wrong with it: 1×1×1 is not "the courier bills actual weight", it is
      // "the parcel is DECLARED to the courier as a one-centimetre cube", because `createShipment`
      // sends these exact columns. N33.
      ...packedDims(c.slug),
      ratingValue: meta?.rating[0] ?? null,
      ratingCount: meta?.rating[1] ?? 0,
      hasVariants: true,
      createdAt: new Date(c.addedTs),
    }).returning();
    productIdByName.set(c.name, p.id);
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
          // `seq` = the permanent catalog number (ADR 0013); `position` = display order. They start out
          // equal and diverge the first time a merchant reorders or deletes a variant.
          seq: vPos + 1,
          productId: p.id, storeId: store.id, title: `${w} / ${u}`, position: vPos,
          option1: w, option2: u, priceIdr: c.price, compareAtIdr: meta?.compareAt ?? null,
          // Real apparel weight, 150–300 g. It was NULL on every variant, and the checkout
          // papered over that with `totalQty * 500` — a fabricated weight priced every parcel.
          // Deterministic (mulberry32), never Math.random(): the seed must reproduce byte-for-byte.
          weightGrams: 150 + Math.round(rndV() * 150),
        }).returning();
        if (vPos === 0) v = nv;
        await db.insert(schema.inventoryLevels).values({ variantId: nv.id, locationId: loc.id, available: Math.round(3 + rndV() * 40) });
        vPos++;
      }
    }
    if (!v) throw new Error(`no variant seeded for ${c.slug}`);
    // High-water mark past the seqs just handed out, so the next variant a merchant adds cannot reuse
    // one (ADR 0013). Set here rather than at insert because the count is only known now.
    await db.update(schema.products).set({ variantSeqNext: vPos + 1 }).where(eq(schema.products.id, p.id));
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

  // The allocation counter must start ABOVE the numbers just seeded. `truncateAll()` wipes
  // `store_counters` like every other table, so without this the first product a merchant creates
  // after a reseed is handed #1001 — which the seed already gave to a different product — and the
  // create fails on `products_storeId_number_unique`.
  await db
    .insert(schema.storeCounters)
    .values({ storeId: store.id, productNext: 1001 + CATALOG.length })
    .onConflictDoUpdate({ target: schema.storeCounters.storeId, set: { productNext: 1001 + CATALOG.length } });

  // customers (capture name → id for order linking)
  //
  // registered_at (0044): NULL = GUEST. Guest is the NORMAL case in Indonesia — checkout never asks
  // for an account, so most buyers never make one — 17 of these 24 never did. Only the heaviest
  // repeat buyers bothered: the rule is `orders >= 30` (an explicit, checkable rule, not a coin
  // flip), which is exactly the shopper who wants to look up her own order history.
  // `password_hash` is scrypt `salt:hash`, the same format as `users` — a registered customer can
  // actually log in once the storefront account area exists.
  const isRegistered = (c: (typeof CUSTOMERS)[number]) => c.orders >= 30;
  const custRows = await db.insert(schema.customers).values(
    CUSTOMERS.map((c) => {
      const createdAt = new Date(ADMIN_TODAY.getTime() - c.joinedDaysAgo * 86_400_000);
      return {
        storeId: store.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        city: c.city,
        ordersCount: c.orders,
        totalSpentIdr: c.spent,
        segment: c.segment,
        tags: ["pelanggan", c.segment],
        // They made the account at (or right after) their first purchase — not before it.
        registeredAt: isRegistered(c) ? createdAt : null,
        // A demo SHOPPER account. Random per customer and deliberately NOT printed: nothing in this
        // repo logs in as one, so a credential nobody holds is strictly safer than one everybody
        // does. Pin `SEED_OWNER_PASSWORD` if you need to drive the shopper login by hand.
        passwordHash: isRegistered(c) ? hashPassword(PINNED_PASSWORD ?? tempPassword()) : null,
        createdAt,
      };
    }),
  ).returning({ id: schema.customers.id, name: schema.customers.name });
  const custByName = new Map(custRows.map((c) => [c.name, c.id]));

  // ---- customer_addresses ----
  // The table and its schema existed, and the seed NEVER wrote a single row (0 of them). So every
  // screen that wanted a shipping address had nothing to read — and the order detail page filled the
  // hole by INVENTING one (`Jl. Merdeka No. {hash % 90}`). A missing row does not stay missing; it
  // gets fabricated somewhere downstream. Seed it, and the fabrication has nothing left to justify it.
  //
  // Street names are per-city so an address in Surabaya does not read like one in Medan.
  const STREETS: Record<string, string[]> = {
    Jakarta: ["Jl. Kemang Raya", "Jl. Tebet Barat", "Jl. Cipete Utara"],
    Bandung: ["Jl. Dago", "Jl. Riau", "Jl. Cihampelas"],
    Surabaya: ["Jl. Darmo", "Jl. Kertajaya", "Jl. Rungkut"],
    Medan: ["Jl. Gatot Subroto", "Jl. Setia Budi", "Jl. Iskandar Muda"],
    Makassar: ["Jl. Pettarani", "Jl. Boulevard", "Jl. Hertasning"],
    Semarang: ["Jl. Pandanaran", "Jl. Gajahmada", "Jl. Pemuda"],
    Yogyakarta: ["Jl. Malioboro", "Jl. Kaliurang", "Jl. Palagan"],
    Denpasar: ["Jl. Sunset Road", "Jl. Teuku Umar", "Jl. Gatot Subroto Timur"],
    Bekasi: ["Jl. Ahmad Yani", "Jl. Cut Meutia", "Jl. Kalimalang"],
    Depok: ["Jl. Margonda Raya", "Jl. Juanda", "Jl. Sawangan"],
  };
  // Real postcode prefixes. A random 5-digit number would LOOK like a postcode and be wrong —
  // "31501" is not Medan — and a plausible-looking wrong value is the exact species of fake this
  // codebase keeps having to hunt down. Prefix is real, the last two digits vary.
  const POST_OF: Record<string, string> = {
    Jakarta: "12", Bandung: "40", Surabaya: "60", Medan: "20", Makassar: "90",
    Semarang: "50", Yogyakarta: "55", Denpasar: "80", Bekasi: "17", Depok: "16",
  };
  const PROV_OF: Record<string, string> = {
    Jakarta: "DKI Jakarta", Bandung: "Jawa Barat", Surabaya: "Jawa Timur", Medan: "Sumatera Utara",
    Makassar: "Sulawesi Selatan", Semarang: "Jawa Tengah", Yogyakarta: "DI Yogyakarta",
    Denpasar: "Bali", Bekasi: "Jawa Barat", Depok: "Jawa Barat",
  };
  const addrRnd = mulberry32(9090);
  await db.insert(schema.customerAddresses).values(
    CUSTOMERS.map((c) => {
      const streets = STREETS[c.city] ?? ["Jl. Merdeka"];
      const street = streets[Math.floor(addrRnd() * streets.length)];
      return {
        customerId: custByName.get(c.name)!,
        label: "Rumah",
        recipient: c.name,
        phone: c.phone,
        address: `${street} No. ${1 + Math.floor(addrRnd() * 120)}, RT 0${1 + Math.floor(addrRnd() * 8)}/RW 0${1 + Math.floor(addrRnd() * 9)}`,
        city: c.city,
        province: PROV_OF[c.city] ?? "Jawa Barat",
        postcode: `${POST_OF[c.city] ?? "40"}${String(100 + Math.floor(addrRnd() * 899))}`,
      };
    }),
  );

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
    const [c] = await db.insert(schema.collections).values({ storeId: store.id, title: col.name, handle: slugify(col.name), emoji: col.emoji, description: col.blurb ?? null, type: col.type, published: col.published, imageUrl: col.imageUrl ?? null }).returning();
    let members: string[];
    if (col.name === "Produk Terlaris") {
      members = [...seededProducts].sort((a, b) => b.unitsSold - a.unitsSold).slice(0, 10).map((p) => p.id);
    } else {
      members = seededProducts.filter((p) => p.category === col.name).map((p) => p.id);
    }
    if (members.length) {
      await db.insert(schema.collectionProducts).values(members.map((productId, i) => ({ collectionId: c.id, productId, position: i })));
    }
  }

  // Halaman Promo — one demo single-page COD landing (Seller → Halaman Promo → /promo/<handle>).
  const promoProductId = productIdByName.get("Celana Kulot Wide Leg");
  if (promoProductId) {
    await db.insert(schema.promoPages).values({
      storeId: store.id,
      productId: promoProductId,
      enabled: true,
      headline: "Celana Kulot Wide Leg — Adem & Jatuh Rapi",
      subheadline: "Kulot wide leg warna netral. Bahan adem, tidak menerawang, cutting tinggi bikin kaki terlihat jenjang.",
      badge: "PILIHAN UNGGUL",
      benefits: ["Bahan adem, tidak menerawang", "Cutting pinggang tinggi, kaki terlihat jenjang", "Warna netral, gampang dipadupadan"],
      idealFor: ["kerja", "kondangan", "santai", "kuliah"],
      content: {
        problemTitle: "Celana kerja itu-itu saja bikin penampilan datar",
        problemBullets: [
          "Celana lama sudah longgar di lutut dan warnanya pudar",
          "Bahan panas dan menerawang, tidak nyaman dipakai seharian",
          "Susah dipadupadan, akhirnya baju bagus jarang kepakai",
        ],
        agitation: "Makin ditunda, makin sering merasa kurang percaya diri saat ke kantor atau kondangan.",
        solutionTitle: "Satu kulot yang menyelesaikan semuanya",
        solutionBody:
          "Celana Kulot Wide Leg dari bahan adem yang jatuh rapi, pinggang tinggi yang menutup dengan nyaman, dan warna netral yang cocok dengan hampir semua atasan. Sekali beli, langsung jadi andalan.",
        guarantee: "Produk original, dijahit rapi, dan dilayani admin resmi. Tukar jika ukuran tidak sesuai.",
      },
      countdownMinutes: 20,
      showScarcity: true,
    });
  }

  // Custom-HTML landing (/lp/<slug>) — merchant-pasted markup + a product for checkout.
  const lpProductId = productIdByName.get("Set Piyama Satin Wanita");
  if (lpProductId) {
    await db.insert(schema.landingPages).values({
      storeId: store.id,
      slug: "piyama-cantik",
      title: "Piyama Satin Premium",
      productId: lpProductId,
      enabled: true,
      countdownMinutes: 15,
      showScarcity: true,
      formConfig: { email: false, quantity: true, trustBadges: true, summary: true }, // demo: qty stepper on
      // A COMPLETE example landing (hero → problem → solution → benefits grid → testimonials →
      // guarantee), pure inline styles + one <style> block so it renders anywhere the merchant pastes
      // it. The OrderFunnel is auto-appended by /lp/[slug].astro.
      html: `<style>.lp-wrap{font-family:Inter,system-ui,sans-serif;color:#1f2937;}.lp-sec{max-width:640px;margin:0 auto;padding:36px 20px;}.lp-chip{display:inline-block;background:#ecfdf5;color:#047857;font-size:12px;font-weight:700;letter-spacing:.06em;padding:6px 14px;border-radius:999px;}.lp-h{font-size:30px;line-height:1.15;font-weight:800;margin:16px 0 12px;color:#111827;}.lp-hl{background:linear-gradient(transparent 60%,#bbf7d0 60%);padding:0 2px;}.lp-card{border:1px solid #e5e7eb;border-radius:14px;padding:18px 20px;}.lp-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}.lp-badge{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;}.lp-img{width:100%;border-radius:16px;display:block;}</style>
<div class="lp-wrap"><div style="background:linear-gradient(160deg,#052e16,#0b3d24);color:#fff;text-align:center;"><div class="lp-sec" style="padding-top:52px;padding-bottom:52px;"><span class="lp-chip">EDISI TERBATAS · STOK MENIPIS</span><h1 class="lp-h" style="color:#fff;font-size:34px;">Tidur Gerah & Baju Rumahan Kucel? <span style="color:#86efac;text-decoration:underline;">Saatnya Ganti</span> Piyama Satin.</h1><p style="font-size:16px;opacity:.92;margin:0;">Bahan satin premium yang adem, jatuh rapi, dan tetap terlihat anggun — dipakai tidur maupun santai di rumah.</p><img class="lp-img" src="/products/piyama-satin.webp" alt="Set Piyama Satin Premium" loading="lazy" style="box-shadow:0 20px 40px rgba(0,0,0,.35);" /><div style="margin-top:20px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;font-size:13px;opacity:.95;"><span>✅ Bahan Adem</span><span>🚚 Bisa COD</span><span>🛡️ Garansi Tukar</span><span>⭐ 4.8/5</span></div></div></div>
<div class="lp-sec" style="padding-top:8px;"><div class="lp-chip" style="background:#fef2f2;color:#b91c1c;">MASALAH YANG SERING DIRASA</div><h2 class="lp-h" style="font-size:24px;">Kenapa Tidur Sering Terasa <span class="lp-hl">Nggak Nyaman?</span></h2><div style="display:flex;flex-direction:column;gap:12px;margin-top:14px;"><div class="lp-card">⚠️ &nbsp;Baju tidur lama sudah melar, bahannya kasar, dan bikin gerah semalaman.</div><div class="lp-card">⚠️ &nbsp;Kaus rumahan seadanya bikin penampilan asal-asalan padahal di rumah paling lama.</div><div class="lp-card">⚠️ &nbsp;Panik kalau ada tamu atau kurir datang — harus lari ganti baju dulu.</div></div></div>
<div style="background:#f0fdf4;"><div class="lp-sec"><div class="lp-chip">SOLUSINYA</div><h2 class="lp-h" style="font-size:24px;">Satu Set Piyama yang <span class="lp-hl">Menyelesaikan Semuanya</span></h2><p style="color:#374151;font-size:15px;line-height:1.6;">Piyama Satin Premium dari bahan halus yang jatuh rapi, pinggang nyaman, dan warna kalem yang cocok dipakai tidur maupun santai. Sekali beli, langsung jadi andalan.</p><div class="lp-grid" style="margin-top:16px;"><img class="lp-img" src="/products/piyama-satin-2.webp" alt="Detail bahan satin" loading="lazy" /><img class="lp-img" src="/products/piyama-satin-3.webp" alt="Tampilan piyama" loading="lazy" /></div></div></div>
<div class="lp-sec"><h2 class="lp-h" style="font-size:22px;">Kenapa Ribuan Wanita Memilihnya</h2><div class="lp-grid" style="margin-top:12px;"><div class="lp-card"><div class="lp-badge" style="background:#ecfdf5;">🌬️</div><strong style="display:block;margin-top:10px;">Adem Semalaman</strong><span style="color:#6b7280;font-size:13px;">Satin halus, tidak menempel & tidak gerah.</span></div><div class="lp-card"><div class="lp-badge" style="background:#eff6ff;">✨</div><strong style="display:block;margin-top:10px;">Terlihat Mahal</strong><span style="color:#6b7280;font-size:13px;">Warna kalem, bukan warna pasaran.</span></div><div class="lp-card"><div class="lp-badge" style="background:#fef3c7;">🧎‍♀️</div><strong style="display:block;margin-top:10px;">Potongan Longgar</strong><span style="color:#6b7280;font-size:13px;">Bebas bergerak, tidak menekan perut.</span></div><div class="lp-card"><div class="lp-badge" style="background:#fce7f3;">🎁</div><strong style="display:block;margin-top:10px;">Cocok Jadi Hadiah</strong><span style="color:#6b7280;font-size:13px;">Untuk ibu, kakak, adik, atau sahabat.</span></div></div></div>
<div style="background:#0b3d24;color:#fff;"><div class="lp-sec"><h2 class="lp-h" style="color:#fff;font-size:22px;">Kata Pelanggan</h2><div style="display:flex;flex-direction:column;gap:12px;"><div style="background:rgba(255,255,255,.08);border-radius:12px;padding:16px;"><div style="color:#fde047;">★★★★★</div><p style="margin:8px 0 4px;font-size:14px;">"Bahannya adem banget, jatuhnya rapi. Dipakai video call juga masih pantes."</p><span style="font-size:12px;opacity:.8;">— Rina, Bandung ✔</span></div><div style="background:rgba(255,255,255,.08);border-radius:12px;padding:16px;"><div style="color:#fde047;">★★★★★</div><p style="margin:8px 0 4px;font-size:14px;">"Langsung beli 2 buat aku sama ibu. Nyaman & warnanya cantik."</p><span style="font-size:12px;opacity:.8;">— Dewi, Surabaya ✔</span></div></div></div></div>
<div class="lp-sec"><div class="lp-card" style="border-color:#bbf7d0;background:#f0fdf4;display:flex;gap:12px;align-items:flex-start;"><span style="font-size:22px;">🛡️</span><div><strong style="display:block;margin-bottom:4px;">Garansi Tukar & Bayar di Tempat</strong><span style="color:#4b5563;font-size:14px;">Cek barang dulu saat kurir datang. Kalau ukuran tidak sesuai, tinggal tukar. Produk original, dijahit rapi, dilayani admin resmi.</span></div></div><p style="text-align:center;color:#6b7280;font-size:14px;margin-top:20px;">Tinggal pilih paket & isi data di bawah — barang dikirim, bayar saat sampai. 👇</p></div></div>`,
    });
  }

  // Real KiriminAja district ids, one per demo city. The orders snapshot these (0042) so the parcel
  // has an authoritative destination the courier can actually be booked to — a typed city name is a
  // claim; a kecamatan id is what KiriminAja acts on, and it is what the COD province gate trusts.
  const districtByCity = new Map<string, number>();
  for (const city of CITIES) {
    const [row] = await db
      .select({ id: schema.kiriminajaAreas.id })
      .from(schema.kiriminajaAreas)
      .where(eq(schema.kiriminajaAreas.cityName, city))
      .limit(1);
    if (row) districtByCity.set(city, row.id);
  }
  const shipRnd = mulberry32(3131);
  // Independent stream (own seed, drawn once per order, right here) so it cannot shift any of
  // ORDERS_SEED's own draws — every customer/city/status/total stays byte-identical to before.
  // ~15% COD is the only demo data that exercises the COD fee schedule end to end (order_financials
  // + the real 3%+PPN11% formula); every other order stays plain `transfer`, unchanged.
  const codRnd = mulberry32(6600);

  // orders (+ line items + payment) — customers link by name
  // Captured so a RECOVERED checkout session (0044) can point at the real order it became —
  // `recovered_order_id` is the only thing that makes "pulih" a fact instead of a guess.
  const seededOrders: Array<{ id: string; customer: string; total: number; picks: number[]; minutesAgo: number }> = [];
  for (const o of ORDERS_SEED) {
    // Drawn for EVERY order, before any eligibility test, so the stream stays positional: a change
    // to the allow-list re-labels orders but never shifts the draw for the ones after it.
    const codDraw = codRnd() < 0.15;
    // COD's own fee (3% of goods, +PPN 11% on the fee — @tokophi/lib/order-finance, the SAME function
    // the checkout API calls) rides on top of the goods total; a plain transfer order pays no fee.
    const codCandidate =
      codDraw && COD_ALLOWED_PROVINCES.includes(PROV_OF[o.city] ?? "")
        ? calculateOrderFinance({ subtotalIdr: o.total, shippingListIdr: 0, paymentKind: "cod" })
        : null;
    // The cap is tested against what the courier would actually COLLECT (goods + fee), not the
    // subtotal — that is the number apps/admin/lib/cod.ts compares, and the fee can cross the line.
    const finance = codCandidate && codCandidate.orderPayableIdr <= COD_MAX_IDR ? codCandidate : null;
    const isCod = finance !== null;
    const orderTotal = finance ? finance.orderPayableIdr : o.total;
    const [ord] = await db.insert(schema.orders).values({
      storeId: store.id,
      number: o.number,
      customerId: custByName.get(o.customer) ?? null,
      status: o.status,
      financialStatus: o.status === "batal" ? "pending" : "dibayar",
      channel: CHANNEL_MAP[o.channel],
      subtotalIdr: o.total,
      totalIdr: orderTotal,
      city: o.city,
      province: PROV_OF[o.city] ?? null,
      // Shipping address SNAPSHOT (0042) — generated AT the order's own destination city, not looked
      // up from the customer. That lookup is precisely the bug: a customer's saved address lives on
      // the person and moves with them, so 624 of 685 orders ended up "shipping" to a city the order
      // was never for. Snapshotting at purchase makes the order self-contained.
      shipRecipient: o.customer,
      shipPhone: CUSTOMERS.find((c) => c.name === o.customer)?.phone ?? null,
      shipAddress: `${(STREETS[o.city] ?? ["Jl. Merdeka"])[Math.floor(shipRnd() * (STREETS[o.city]?.length ?? 1))]} No. ${1 + Math.floor(shipRnd() * 120)}, RT 0${1 + Math.floor(shipRnd() * 8)}/RW 0${1 + Math.floor(shipRnd() * 9)}`,
      shipPostcode: `${POST_OF[o.city] ?? "40"}${String(100 + Math.floor(shipRnd() * 899))}`,
      shipDistrictId: districtByCity.get(o.city) ?? null,
      placedAt: minutesAgo(o.minutesAgo),
    }).returning();
    await db.insert(schema.orderLineItems).values(
      o.picks.map((idx) => ({ orderId: ord.id, variantId: seededProducts[idx].variantId, title: CATALOG[idx].name, qty: 1, priceIdr: CATALOG[idx].price, totalIdr: CATALOG[idx].price })),
    );
    if (finance) {
      // order_financials is what creditSaleForPayment (and this seed's own ledger insert below) read
      // to keep the COD fee OUT of seller proceeds — without this row a COD payment's full cash
      // amount (goods + fee) would fall back to the legacy credit path and over-pay the seller.
      await db.insert(schema.orderFinancials).values({
        storeId: store.id,
        orderId: ord.id,
        goodsDiscountIdr: finance.goodsDiscountIdr,
        shippingDiscountIdr: finance.shippingDiscountIdr,
        includedSalesTaxIdr: finance.includedSalesTaxIdr,
        goodsProceedsIdr: finance.goodsProceedsIdr,
        shippingChargedIdr: finance.shippingChargedIdr,
        codFeeBeforeVatIdr: finance.codFeeBeforeVatIdr,
        codFeeVatIdr: finance.codFeeVatIdr,
        codFeeFinalIdr: finance.codFeeFinalIdr,
        orderPayableIdr: finance.orderPayableIdr,
        expectedGatewayFeeIdr: finance.gatewayFeeIdr,
      });
    }
    // storeId is the RLS key (0036) — the app write paths always set it; the seed used to omit it,
    // which left every seeded payment orphaned (store_id NULL = belongs to no tenant).
    await db.insert(schema.payments).values({ orderId: ord.id, storeId: store.id, method: isCod ? "cod" : "transfer", amountIdr: orderTotal, status: o.status === "batal" ? "gagal" : "berhasil", paidAt: o.status === "batal" ? null : minutesAgo(o.minutesAgo) });
    seededOrders.push({ id: ord.id, customer: o.customer, total: o.total, picks: o.picks, minutesAgo: o.minutesAgo });
  }

  // customers.last_order_at (0044) — DERIVED from the orders just written, never typed in beside them.
  await db.execute(sql`
    update customers c
       set last_order_at = o.last_at
      from (select customer_id, max(placed_at) as last_at from orders where customer_id is not null group by customer_id) o
     where o.customer_id = c.id
  `);

  // Saldo ledger (migrations 0040 + 0041) — DERIVED from the payments above, not invented beside
  // them. Every collected payment (`berhasil`) is booked as one `sale`: `available` once the order
  // is finished (`selesai`), otherwise `pending` (money held until the order sticks). A `batal`
  // order collected nothing, so it is booked nothing. This is the same rule the app writes at
  // runtime and the same rule migration 0041 backfills with — one rule, one number, three screens
  // (Dashboard revenue = Pesanan totals = Saldo book).
  //
  // The credit itself is goods-only, the SAME expression `creditSaleForPayment` uses
  // (apps/admin/lib/ledger-credit.ts): orders with an `order_financials` row (COD, above) credit
  // goods_proceeds_idr, never the fee-inclusive payment amount — a plain `p.amount_idr` credit would
  // silently pay the seller the buyer's COD fee too. Legacy orders (no order_financials, the other
  // 85%) fall back to subtotal − discount, unchanged from before.
  await db.execute(sql`
    insert into ledger_entries (store_id, order_id, payment_id, kind, status, amount_idr, note, created_at, available_at)
    select p.store_id, o.id, p.id, 'sale',
           case when o.status in ('selesai', 'retur') then 'available' else 'pending' end::ledger_status,
           coalesce(f.goods_proceeds_idr + greatest(coalesce(o.tax_idr, 0) - f.included_sales_tax_idr, 0), greatest(o.subtotal_idr - o.discount_idr, 0)),
           'Penjualan ' || o.number,
           coalesce(p.paid_at, o.placed_at),
           case when o.status in ('selesai', 'retur') then coalesce(p.paid_at, o.placed_at) end
      from payments p join orders o on o.id = p.order_id
      left join order_financials f on f.order_id = o.id
     where p.status = 'berhasil' and o.status <> 'batal'
    on conflict do nothing
  `);

  // ─────────────────────────────────────────────────────────────────────────────
  // checkout_sessions (0044) — the carts that never became orders.
  //
  // Indonesia abandons ~82–83% of carts (global ~70%). A seed that showed 3 tidy abandoned carts
  // next to 200 orders would be a toy: it would tell a merchant abandonment is a rounding error,
  // which is the opposite of true. So the volume is DERIVED from the orders themselves, per day:
  //
  //     abandoned(day) = round(4 × orders(day))   →   4 / (4 + 1) = 80% abandonment
  //
  // and the RESCUED ones are pulled OUT of that pool (≈14% of it → recovery ≈ 12%, the honest band
  // for WhatsApp cart recovery — not the 30–40% a vendor deck would claim).
  //
  // ⚠️ `abandoned_at` (0045) is what separates a RESCUE from an ordinary sale. Every order also has a
  // checkout session behind it, and those sessions end up `pulih` too — but they never went quiet, so
  // they carry `abandoned_at = NULL`. Count them as recoveries and a shop that has never saved a
  // single cart reports a ~100% recovery rate. So both kinds are seeded here, distinguishable:
  //   rescued  = abandoned_at IS NOT NULL and recovered_at IS NOT NULL   (went quiet, then came back)
  //   straight = abandoned_at IS NULL     and recovered_at IS NOT NULL   (an ordinary sale)
  //
  // Every `pulih` row points at an order that actually exists in `orders`. Nothing here is a status
  // nobody can observe: there is no `terkirim`-style claim, and no `kedaluwarsa` rows either — no
  // job expires carts yet, so seeding that state would be inventing a lifecycle we do not run.
  // ─────────────────────────────────────────────────────────────────────────────
  const CK_WINDOW_DAYS = 30;
  const ckRnd = mulberry32(7373);
  const pick = <T>(arr: T[]): T => arr[Math.floor(ckRnd() * arr.length)];

  // orders bucketed by day-ago (same clock the orders were stamped from)
  const ordersByDay = new Map<number, typeof seededOrders>();
  for (const o of seededOrders) {
    const d = Math.floor(o.minutesAgo / 1440);
    if (d >= CK_WINDOW_DAYS) continue;
    (ordersByDay.get(d) ?? ordersByDay.set(d, []).get(d)!).push(o);
  }

  type CkStep = "keranjang" | "kontak" | "alamat" | "pengiriman" | "pembayaran";
  // How far they got before leaving. Most never even reach the contact form — which is exactly why
  // the ones that DID leave a phone number are worth so much more than the rest.
  const STEP_MIX: Array<[CkStep, number]> = [
    ["keranjang", 0.46], ["kontak", 0.2], ["alamat", 0.15], ["pengiriman", 0.11], ["pembayaran", 0.08],
  ];
  const rollStep = (): CkStep => {
    let r = ckRnd();
    for (const [s, w] of STEP_MIX) { if ((r -= w) <= 0) return s; }
    return "keranjang";
  };
  const STEP_RANK: Record<CkStep, number> = { keranjang: 0, kontak: 1, alamat: 2, pengiriman: 3, pembayaran: 4 };

  const cartItems = (picks: number[]) =>
    picks.map((idx) => {
      const p = CATALOG[idx];
      const qty = ckRnd() < 0.18 ? 2 : 1;
      return { handle: p.slug, name: p.name, variant: (WARNA_BY_SLUG[p.slug] ?? ["Default"])[0], qty, price: p.price };
    });
  const cartSubtotal = (items: ReturnType<typeof cartItems>) => items.reduce((a, i) => a + i.price * i.qty, 0);

  type CkRow = typeof schema.checkoutSessions.$inferInsert;
  const ckRows: CkRow[] = [];
  let ckSeq = 0;

  for (let d = 0; d < CK_WINDOW_DAYS; d++) {
    const dayOrders = ordersByDay.get(d) ?? [];
    if (dayOrders.length === 0) continue;
    const nAbandoned = Math.round(dayOrders.length * 4);
    const nRescued = Math.min(Math.round(nAbandoned * 0.14), dayOrders.length);

    // ---- abandoned: never became anything ----
    for (let k = 0; k < nAbandoned; k++) {
      const step = rollStep();
      const rank = STEP_RANK[step];
      const items = cartItems(Array.from({ length: 1 + Math.floor(ckRnd() * 3) }, () => Math.floor(ckRnd() * CATALOG.length)));
      // A quarter of the identified carts belong to someone who has bought here before — the admin
      // can then open the whole customer, not just a phone number.
      const known = rank >= 1 && ckRnd() < 0.25 ? pick(CUSTOMERS) : null;
      const city = known?.city ?? pick(CITIES);
      const anon = rank === 0; // never reached the contact form → we have nothing but a session id
      const startedMin = d * 1440 + Math.floor(ckRnd() * 1380);
      ckRows.push({
        storeId: store.id,
        sessionId: `ck-${d}-${k}-${ckSeq++}`,
        customerId: known ? custByName.get(known.name) ?? null : null,
        name: anon ? null : known?.name ?? pick(CUST_POOL),
        phone: anon ? null : known?.phone ?? "0812" + String(1000000 + Math.floor(ckRnd() * 8999999)),
        email: anon || ckRnd() < 0.45 ? null : known?.email ?? null,
        address: rank >= 2 ? `${(STREETS[city] ?? ["Jl. Merdeka"])[0]} No. ${1 + Math.floor(ckRnd() * 120)}` : null,
        city: rank >= 2 ? city : null,
        province: rank >= 2 ? PROV_OF[city] ?? null : null,
        postcode: rank >= 2 ? `${POST_OF[city] ?? "40"}${String(100 + Math.floor(ckRnd() * 899))}` : null,
        districtId: rank >= 2 ? districtByCity.get(city) ?? null : null,
        items,
        subtotalIdr: cartSubtotal(items),
        shippingIdr: rank >= 3 ? 20_000 : 0,
        step,
        status: "ditinggal",
        createdAt: minutesAgo(startedMin),
        updatedAt: minutesAgo(startedMin - Math.floor(2 + ckRnd() * 25)), // last touch, a few minutes later
        // The sweep flips a session to `ditinggal` once it has been quiet for 60 minutes — that hour
        // is when the cart was actually given up on, so that is what `abandoned_at` says.
        abandonedAt: minutesAgo(startedMin - Math.floor(2 + ckRnd() * 25) - 60),
      });
    }

    // ---- pulih: the sessions that BECAME one of this day's orders ----
    // Two different things, and the difference is the whole point of `abandoned_at`:
    //   k < nRescued        → went quiet, was chased, came back  → a real RESCUE
    //   k >= nRescued       → walked straight through to payment → an ordinary sale
    for (let k = 0; k < dayOrders.length; k++) {
      const o = dayOrders[k];
      const cust = CUSTOMERS.find((c) => c.name === o.customer);
      const items = cartItems(o.picks);
      const rescued = k < nRescued;
      // A rescue started a day or two before it finally paid; a straight-through checkout takes
      // minutes.
      const startedMin = rescued ? o.minutesAgo + 1440 + Math.floor(ckRnd() * 2880) : o.minutesAgo + 6 + Math.floor(ckRnd() * 20);
      ckRows.push({
        storeId: store.id,
        sessionId: `ck-${rescued ? "pulih" : "lurus"}-${d}-${k}-${ckSeq++}`,
        customerId: custByName.get(o.customer) ?? null,
        name: o.customer,
        phone: cust?.phone ?? null,
        email: cust?.email ?? null,
        city: cust?.city ?? null,
        items,
        subtotalIdr: o.total,
        shippingIdr: 20_000,
        step: "pembayaran",
        status: "pulih",
        recoveredOrderId: o.id,
        recoveredAt: minutesAgo(o.minutesAgo),
        // The rescue went quiet an hour after its last touch; the straight-through sale never did.
        abandonedAt: rescued ? minutesAgo(startedMin - 90) : null,
        createdAt: minutesAgo(startedMin),
        updatedAt: minutesAgo(o.minutesAgo),
      });
    }
  }

  // A few carts still OPEN right now — not abandoned yet (nobody has left; they are mid-checkout).
  // Excluded from every abandonment number on purpose: calling a live cart "abandoned" would be a lie
  // by 20 minutes.
  //
  // ⚠️ These are stamped from the REAL clock, not the 2026-07-02 demo anchor: the storefront's ageing
  // sweep flips anything quieter than 60 minutes of `now()` to `ditinggal`, so an anchor-dated "aktif"
  // row would silently stop being aktif the moment the sweep next runs.
  for (let k = 0; k < 3; k++) {
    const items = cartItems([Math.floor(ckRnd() * CATALOG.length)]);
    const startedMin = 8 + Math.floor(ckRnd() * 40);
    ckRows.push({
      storeId: store.id,
      sessionId: `ck-aktif-${k}`,
      name: k === 0 ? pick(CUST_POOL) : null,
      phone: k === 0 ? "0812" + String(1000000 + Math.floor(ckRnd() * 8999999)) : null,
      items,
      subtotalIdr: cartSubtotal(items),
      step: k === 0 ? "kontak" : "keranjang",
      status: "aktif",
      createdAt: new Date(Date.now() - startedMin * 60_000),
      updatedAt: new Date(Date.now() - Math.max(1, startedMin - 5) * 60_000),
    });
  }
  for (let i = 0; i < ckRows.length; i += 500) {
    await db.insert(schema.checkoutSessions).values(ckRows.slice(i, i + 500));
  }

  // CMS: pages
  await db.insert(schema.pages).values(
    PAGES.map((p) => ({
      storeId: store.id,
      title: p.title,
      handle: p.handle,
      body: p.body,
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
      body: a.body,
      excerpt: a.excerpt,
      author: a.author,
      imageUrl: a.imageUrl || null,
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

  // keranjang follow-ups — REAL ones, derived from carts that exist.
  // The merchant has already opened WhatsApp on the three biggest recent baskets that left a phone
  // number. `sent_at` records THAT: we opened the chat. It is not proof the message was delivered or
  // read — wa.me cannot tell us — so the status stays `menunggu`, never `terkirim`.
  const contactable = ckRows
    .filter((r) => r.status === "ditinggal" && r.phone && (r.createdAt as Date).getTime() > TODAY.getTime() - 7 * 86_400_000)
    .sort((a, b) => (b.subtotalIdr ?? 0) - (a.subtotalIdr ?? 0))
    .slice(0, 3);
  if (contactable.length) {
    await db.insert(schema.followups).values(
      contactable.map((r) => {
        const items = (r.items as Array<{ name: string; qty: number }>) ?? [];
        const label = items.length > 1 ? `${items[0].name} +${items.length - 1} lainnya` : items[0]?.name ?? "Keranjang";
        return {
          storeId: store.id,
          customerId: r.customerId ?? null,
          phone: r.phone!,
          type: "keranjang" as const,
          context: `${label} · Rp${(r.subtotalIdr ?? 0).toLocaleString("id-ID")}`,
          dueAt: r.createdAt as Date,
          status: "menunggu" as const,
          sentAt: new Date((r.updatedAt as Date).getTime() + 45 * 60_000), // WA dibuka ~45 mnt setelah cart ditinggal
          lastMessage: null,
        };
      }),
    );
  }

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
      // THE FK, not just the display name. Every seeded review used to land with product_id = NULL,
      // which meant no product could show a rating at all — while the PDP separately advertised a
      // FAKE "4.8 · 187 ulasan" from the denormalised `products.rating_value` columns that nothing
      // recomputes. Those columns are now ignored by the storefront; this link is what makes a real
      // rating appear.
      productId: productIdByName.get(r.product) ?? null,
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

  // ---- saldo: the ledger (migration 0040) ----
  // Seeded from the orders themselves, so the money in Saldo is the money in Pesanan is the money
  // on the Dashboard. One `sale` entry per paid order; it is `available` (withdrawable) once the
  // order is `selesai`, `pending` while the order is still in flight — the release rule.
  // A returned order gets an OPPOSING entry rather than an edit, keeping the book append-only.
  const paidOrders = await db
    .select({ id: schema.orders.id, status: schema.orders.status, number: schema.orders.number, placedAt: schema.orders.placedAt })
    .from(schema.orders)
    .where(eq(schema.orders.storeId, store.id));
  const paidMap = new Map(paidOrders.map((o) => [o.id, o]));
  // ONLY successful payments become money. A `gagal` payment (the seed writes one for every
  // cancelled order) is not revenue — crediting it would put cash in the ledger that nobody ever
  // paid. Caught because the ledger had 685 entries against 642 non-cancelled orders.
  const pays = await db
    .select({ orderId: schema.payments.orderId, total: schema.payments.total, amountIdr: schema.payments.amountIdr })
    .from(schema.payments)
    .where(and(eq(schema.payments.storeId, store.id), eq(schema.payments.status, "berhasil")));
  const ledgerRows = pays
    .map((p) => {
      const o = p.orderId ? paidMap.get(p.orderId) : undefined;
      if (!o) return null;
      const amount = (p.total ?? 0) || p.amountIdr;
      const done = o.status === "selesai";
      return {
        storeId: store.id,
        orderId: o.id,
        kind: "sale" as const,
        status: (done ? "available" : "pending") as "available" | "pending",
        amountIdr: amount,
        note: `Penjualan ${o.number}`,
        createdAt: o.placedAt,
        availableAt: done ? o.placedAt : null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  // ONE entry per ORDER, not per payment: `ledger_one_sale_per_order` is a partial unique index, and
  // an order with two successful payments (a partial, a retry) would violate it. Dedupe here rather
  // than discover it as a crash — which is exactly how this was found: the seed died on the
  // constraint and every insert AFTER it (platform_payout) silently never ran, so a "successful"
  // reseed left the payout policy table empty.
  const byOrder = new Map<string, (typeof ledgerRows)[number]>();
  for (const r of ledgerRows) {
    const prev = byOrder.get(r.orderId);
    if (prev) prev.amountIdr += r.amountIdr; // partial payments sum into one sale
    else byOrder.set(r.orderId, { ...r });
  }
  const uniqueLedger = [...byOrder.values()];
  for (let i = 0; i < uniqueLedger.length; i += 2000) {
    // onConflictDoNothing: the dev server may be live and writing its own entries while the seed
    // runs. The book must survive that, not race it.
    await db.insert(schema.ledgerEntries).values(uniqueLedger.slice(i, i + 2000)).onConflictDoNothing();
  }

  // ⚠️ NO `analytics_daily` INSERT. The table is RETIRED (2026-08-03) — the Dashboard/Analitik
  // series is now derived from `orders` + `analytics_events` at read time (`getDailyStats()` in
  // apps/admin/lib/data/analytics.ts). This insert was the table's ONLY writer in the whole repo,
  // which is exactly what was wrong with it: the six demo stores it did not cover showed an empty
  // dashboard over real orders, and on the store it did cover the numbers froze on the day the
  // seed ran while the orders kept arriving. Do not restore it — a second source of truth for
  // money is how one screen ends up contradicting the screen beside it.
  //
  // `DAILY` itself stays: it is the generator for the funnel events below (visitors + orders per
  // day), not a rollup anybody reads.

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
    INVOICES.map((inv) => ({ number: inv.number, accountId: account.id, storeId: store.id, planKey: STORE.plan, amountIdr: SUB_MONTHLY, taxIdr: SUB_MONTHLY_CHARGE.taxIdr, status: inv.status, issuedAt: daysAgo(inv.daysAgo) })),
  );

  // platform activity
  await db.insert(schema.platformActivity).values(ACTIVITY.map((a) => ({ kind: a.kind, text: a.text, ts: minutesAgo(a.minutesAgo) })));

  // platform operator (super-admin login). ⚠️ THE HIGHEST-VALUE ROW THIS FILE WRITES — the control
  // plane reaches every tenant, including impersonation. Its password is minted separately from the
  // merchant's on purpose; they shared one constant, and that is how one leak opened both.
  await db.insert(schema.platformAdmins).values({ email: "admin@tokophi.id", name: "Admin Platform", passwordHash: hashPassword(seedPassword("Super Admin  admin@tokophi.id")), role: "owner" });

  // support tickets (2-sided demo) — for Batik Nusantara
  const [tkt1] = await db.insert(schema.supportTickets).values({ storeId: store.id, subject: "Cara menghubungkan domain kustom?", status: "answered", createdAt: minutesAgo(4 * 60), lastMessageAt: minutesAgo(90) }).returning();
  await db.insert(schema.supportMessages).values([
    { ticketId: tkt1.id, storeId: store.id, sender: "merchant", body: "Halo, saya mau pakai domain sendiri (batiknusantara.id). Bagaimana caranya?", createdAt: minutesAgo(4 * 60) },
    { ticketId: tkt1.id, storeId: store.id, sender: "platform", body: "Halo! Tambahkan domain di Pengaturan lalu arahkan CNAME ke cname.tokophi.cc — kami bantu verifikasi setelahnya. Pakai CNAME, jangan salin alamat IP.", createdAt: minutesAgo(90) },
  ]);
  const [tkt2] = await db.insert(schema.supportTickets).values({ storeId: store.id, subject: "Tagihan bulan ini belum masuk", status: "open", createdAt: minutesAgo(30), lastMessageAt: minutesAgo(30) }).returning();
  await db.insert(schema.supportMessages).values({ ticketId: tkt2.id, storeId: store.id, sender: "merchant", body: "Saya sudah bayar VA tapi status masih menunggu. Mohon dicek ya.", createdAt: minutesAgo(30) });

  // Obrolan — shopper ⇄ merchant chat (migration 0043). Deterministic like everything else here:
  // anchored to TODAY via minutesAgo(), no Math.random(), so the demo inbox is stable across seeds.
  // 3 visitors × 4 conversations: (1) anonymous + unread, (2) assigned + answered, (3) linked to a
  // real customer + order, (4) closed.
  const [convOrder] = await db
    .select({ id: schema.orders.id, number: schema.orders.number, customerId: schema.orders.customerId })
    .from(schema.orders)
    .where(eq(schema.orders.storeId, store.id))
    .orderBy(desc(schema.orders.placedAt))
    .limit(1);
  const [vis1] = await db.insert(schema.chatVisitors).values({ storeId: store.id, name: "Rina", phone: "081234567801", userAgent: "Mozilla/5.0 (Linux; Android 14)", firstSeenAt: minutesAgo(180), lastSeenAt: minutesAgo(12) }).returning();
  const [vis2] = await db.insert(schema.chatVisitors).values({ storeId: store.id, name: "Dewi", firstSeenAt: minutesAgo(600), lastSeenAt: minutesAgo(240) }).returning();
  const [vis3] = await db.insert(schema.chatVisitors).values({ storeId: store.id, name: CUSTOMERS[0].name, phone: CUSTOMERS[0].phone, customerId: custByName.get(CUSTOMERS[0].name) ?? null, firstSeenAt: minutesAgo(2880), lastSeenAt: minutesAgo(1440) }).returning();

  const seedConv = async (
    v: { id: string },
    c: {
      status: "open" | "snoozed" | "closed"; unreadMerchant: number; lastAgo: number; entryUrl: string;
      productHandle?: string | null; customerId?: string | null; orderId?: string | null; assigned?: boolean;
      msgs: Array<{ sender: "customer" | "merchant" | "system"; body: string; ago: number }>;
    },
  ) => {
    const last = c.msgs[c.msgs.length - 1];
    const [conv] = await db.insert(schema.conversations).values({
      storeId: store.id, visitorId: v.id, customerId: c.customerId ?? null, orderId: c.orderId ?? null,
      status: c.status, assignedUserId: c.assigned ? user.id : null,
      unreadMerchant: c.unreadMerchant, unreadVisitor: 0,
      lastMessageAt: minutesAgo(c.lastAgo), lastMessageBody: last.body.slice(0, 140),
      entryUrl: c.entryUrl, productHandle: c.productHandle ?? null,
      createdAt: minutesAgo(c.msgs[0].ago),
    }).returning();
    await db.insert(schema.conversationMessages).values(
      c.msgs.map((m) => ({
        conversationId: conv.id, storeId: store.id, sender: m.sender,
        senderUserId: m.sender === "merchant" ? user.id : null,
        body: m.body, createdAt: minutesAgo(m.ago),
      })),
    );
  };

  await seedConv(vis1, {
    status: "open", unreadMerchant: 2, lastAgo: 12, entryUrl: `/produk/${CATALOG[0].slug}`, productHandle: CATALOG[0].slug,
    msgs: [
      { sender: "customer", body: `Kak, ${CATALOG[0].name} ini ready ukuran L?`, ago: 18 },
      { sender: "customer", body: "Kalau ready saya mau ambil 2 ya kak 🙏", ago: 12 },
    ],
  });
  await seedConv(vis2, {
    status: "open", unreadMerchant: 0, lastAgo: 240, entryUrl: "/", assigned: true,
    msgs: [
      { sender: "customer", body: "Halo, ongkir ke Surabaya berapa ya?", ago: 300 },
      { sender: "merchant", body: "Halo kak Dewi! Ongkir ke Surabaya mulai Rp18.000 (reguler, 2-3 hari). Bisa dicek otomatis di halaman checkout ya.", ago: 240 },
    ],
  });
  await seedConv(vis3, {
    status: "open", unreadMerchant: 1, lastAgo: 1440, entryUrl: "/checkout/sukses",
    customerId: convOrder?.customerId ?? null, orderId: convOrder?.id ?? null,
    msgs: [
      { sender: "system", body: `Obrolan ditautkan ke pesanan ${convOrder?.number ?? "-"}.`, ago: 1500 },
      { sender: "customer", body: "Pesanan saya sudah dikirim belum ya kak?", ago: 1440 },
    ],
  });
  await seedConv(vis1, {
    status: "closed", unreadMerchant: 0, lastAgo: 2700, entryUrl: "/kategori/batik",
    msgs: [
      { sender: "customer", body: "Bahan batiknya katun apa sutra?", ago: 2880 },
      { sender: "merchant", body: "Katun primissima kak, adem dipakai seharian.", ago: 2760 },
      { sender: "customer", body: "Oke makasih kak!", ago: 2700 },
    ],
  });

  // additional demo stores (platform view + healthcheck variety)
  let invSeq = 9100;
  let ordSeq = 8000;
  for (const d of DEMO_STORES) {
    const [acc] = await db.insert(schema.accounts).values({ name: d.name, plan: d.plan, createdAt: daysAgo(d.createdDaysAgo) }).returning();
    const [u] = await db.insert(schema.users).values({ email: d.email, name: d.owner, passwordHash: hashPassword(seedPassword(`Seller  ${d.email}`)) }).returning();
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
      const charge = firstPaid ? SUB_MONTHLY_CHARGE : SUB_FIRST_MONTH_CHARGE;
      await db.insert(schema.invoices).values(d.invoices.map((inv) => ({ number: `INV-${invSeq++}`, accountId: acc.id, storeId: st.id, planKey: d.plan, amountIdr: charge.total, taxIdr: charge.taxIdr, status: inv.status, issuedAt: daysAgo(inv.daysAgo) })));
    }
    if (d.lastOrderDaysAgo !== null) {
      // a few orders; the most-recent placedAt drives the "activity" health signal
      const offsets = [d.lastOrderDaysAgo, d.lastOrderDaysAgo + 4, d.lastOrderDaysAgo + 11];
      await db.insert(schema.orders).values(offsets.map((off) => ({
        storeId: st.id, number: `PHI-${ordSeq++}`, status: "selesai" as const, financialStatus: "dibayar" as const,
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
  // ⚠️ The seed used to write `services: c.services` — a plain STRING array ("REG", "BEST") from the
  // hand-written roster. But every reader now expects OBJECTS ({type, name, group, cod, codAllowed}),
  // written by syncCouriersFromKiriminaja(). The result on a fresh database: ZERO services were
  // COD-allowed, so COD could not be exercised AT ALL, and a new developer would reasonably conclude
  // the feature was broken. It was not — the seed was speaking the old dialect.
  //
  // The authoritative roster still comes from KiriminAja (Sync in super-admin). This is an OFFLINE
  // MIRROR of it so a fresh clone can exercise the whole chain without an API key.
  //
  // ⚠️ It must stay a MIRROR, not an approximation. The previous stand-in listed only 11 of the 20
  // services the API actually returns, so on a seeded database the Seller's "Same Day" group was
  // EMPTY and AnterAja Same Day / SAP One Day / J&T JND / Sicepat CARGO / Jagopack / BIGPACK /
  // Boss Pack could not be offered to a shopper at all — services KiriminAja will happily book,
  // that no merchant could sell. Every entry below was captured from
  // POST /api/mitra/v6.1/shipping_price (sandbox, 2026-07-14, origin 2099 Menteng → destination 356
  // Coblong, 1 kg): 10 couriers, 20 services, `cod` exactly as the API reports it.
  //
  // `codAllowed` follows the current platform policy: SPX only, because a refused COD parcel ships
  // back free on SPX and is billed to the merchant everywhere else. That is a POLICY, not a
  // capability — super-admin can widen it per service without a deploy.
  const SEED_SERVICES: Record<string, Array<{ type: string; name: string; group: string; cod: boolean }>> = {
    spx: [
      { type: "1", name: "SPX Standard", group: "regular", cod: true },
      { type: "3", name: "SPX Economy", group: "economy", cod: true },
    ],
    jne: [
      { type: "REG23", name: "JNE Express Reguler", group: "regular", cod: true },
      { type: "YES23", name: "JNE Express YES", group: "next_day", cod: true },
    ],
    sicepat: [
      { type: "REG", name: "Sicepat REGULER", group: "regular", cod: true },
      { type: "GOKIL", name: "Sicepat CARGO PER KG (MINIMAL 10KG)", group: "cargo", cod: true },
    ],
    jnt: [
      { type: "EZ", name: "J&T EZ", group: "regular", cod: true },
      { type: "JND", name: "J&T JND", group: "next_day", cod: false },
    ],
    anteraja: [
      { type: "FLREG", name: "AnterAja Regular Flat", group: "regular", cod: true },
      { type: "ND", name: "AnterAja Next Day", group: "next_day", cod: false },
      { type: "SD", name: "AnterAja Same Day", group: "one_day", cod: false },
    ],
    ninja: [{ type: "Standard", name: "Ninja Xpress Standard", group: "regular", cod: true }],
    sap: [
      { type: "UDRREG", name: "SAP Satria Reg", group: "regular", cod: true },
      { type: "UDRONS", name: "SAP One Day Services", group: "one_day", cod: false },
    ],
    lion: [
      { type: "REGPACK", name: "Regpack", group: "regular", cod: true },
      { type: "JAGOPACK", name: "Jagopack", group: "economy", cod: true },
      { type: "BOSSPACK", name: "Boss Pack", group: "next_day", cod: false },
      { type: "BIGPACK", name: "BIGPACK", group: "cargo", cod: false },
    ],
    idx: [{ type: "00", name: "ID Express Standard", group: "regular", cod: true }],
    jtcargo: [{ type: "REG", name: "J&T Cargo Regular", group: "cargo", cod: true }],
  };
  // Couriers the platform does not offer by default (super-admin can switch them on).
  // ⚠️ ALIGNED TO PRODUCTION 2026-08-12 — this used to be ["idx", "jtcargo"], the opposite of what
  // production runs (idx=t, jtcargo=t, ninja=f). Forensics showed prod's state is an OPERATOR
  // decision, not seed residue (no seed epoch ever set idx/jtcargo on; `saveCouriers` is the only
  // writer of `enabled`, and the operator demonstrably worked that card on 2026-07-16 — see
  // specs/docs/tasks/2026-08-12-n41-remediation-executed.md §③). The seed follows the operator,
  // never the other way around; a future flip is a super-admin toggle, not a seed edit.
  const COURIERS_OFF = ["ninja"];
  await db.insert(schema.platformCouriers).values(
    // KiriminAja codes from the shared roster; niche ones off by default (super-admin toggles).
    COURIERS.map((c) => ({
      courier: c.code,
      services: (SEED_SERVICES[c.code] ?? []).map((s) => ({
        ...s,
        codAllowed: s.cod && c.code === "spx", // platform policy today: COD via SPX only
      })),
      enabled: !COURIERS_OFF.includes(c.code),
    })),
  );
  await db.insert(schema.platformCod).values({ enabled: true, maxAmountIdr: COD_MAX_IDR, allowedProvinces: COD_ALLOWED_PROVINCES, feePct: 0 });

  // The merchant's PER-SERVICE selection (store_shipping_methods) — never seeded, so a fresh database
  // had ZERO rows and /api/public/ongkir fell back to the courier-level filter, which is exactly the
  // hole fixed in 35b88a4: services the seller never picked (Jagopack, BIGPACK, Sicepat CARGO, SAP One
  // Day) reappeared at checkout. Seed the demo merchant as having accepted everything the platform
  // enables (incl. both SPX ones, so COD is exercisable out of the box).
  const enabledCouriers = COURIERS.filter((c) => !COURIERS_OFF.includes(c.code));
  const merchantServices = enabledCouriers.flatMap((c) =>
    (SEED_SERVICES[c.code] ?? []).map((s) => ({ storeId: store.id, courier: c.code, service: s.type, enabled: true })),
  );
  if (merchantServices.length) await db.insert(schema.storeShippingMethods).values(merchantServices);
  // Payout policy. The seed TRUNCATES every table, and this one was never re-inserted — so after any
  // re-seed `platform_payout` was EMPTY and min_payout_idr silently fell back to a code default while
  // the super-admin screen showed a policy that did not exist in the DB. Seed it explicitly.
  // `release_on: "selesai"` is the safe default and is deliberate: see migration 0040.
  await db.insert(schema.platformPayout).values({ releaseOn: "selesai", minPayoutIdr: 50_000, autoApprove: false });
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
  revealCredentials();
  await client.end();
}

/**
 * THE ONLY COPY THAT WILL EVER EXIST. `tempPassword()` returns a string that is hashed and
 * discarded — nothing writes it to a table, a log table or a file, and there is no mailer and no
 * forgot-password route anywhere under `apps/` (checked). If this block does not print, the account
 * it minted is unreachable until somebody resets it from super-admin.
 * (The glob that named those routes is gone on purpose: a `*` followed by `/` ENDS this comment, and
 * the draft's version did exactly that — `tsc` then read the prose as code and failed on `app`.)
 *
 * Printed to STDOUT, once, at the very end so it is the last thing in a deploy log rather than
 * buried under 1.500 inserts.
 */
function revealCredentials() {
  if (!MINTED.length) return;
  if (PINNED_PASSWORD) {
    console.log(`\n⚠️  SEED_OWNER_PASSWORD was set: all ${MINTED.length} seeded accounts share ONE password you chose.`);
    return;
  }
  const pad = Math.max(...MINTED.map(([who]) => who.length));
  console.log("\n🔑 SEEDED LOGINS — random per account, shown ONCE. Copy them now; nothing stores them.");
  for (const [who, pw] of MINTED) console.log(`   ${who.padEnd(pad)}   ${pw}`);
  console.log("   (set SEED_OWNER_PASSWORD to pin them to a string of your own instead)\n");
}

main().catch(async (e) => {
  console.error(e);
  // ⚠️ REVEAL ON FAILURE TOO. The seed is not one transaction — it is ~1.500 inserts, and the owner
  // and the platform operator are written in the FIRST few. A crash at insert 900 therefore leaves
  // real, hashed, working accounts in the database whose passwords exist only in this process's
  // memory, and the re-run needs `SEED_FORCE=1` because `stores` is no longer empty. Printing here
  // costs nothing on a clean run (the list is empty before the first mint) and is the difference
  // between "re-run it" and "open psql".
  revealCredentials();
  await client.end();
  process.exit(1);
});
