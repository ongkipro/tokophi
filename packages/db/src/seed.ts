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
  await db.insert(schema.locations).values({ storeId: store.id, name: "Gudang Utama", isDefault: true });
  await db.insert(schema.storeSettings).values({ storeId: store.id });
  await db.insert(schema.storeStats).values({ storeId: store.id, gmvIdr: STORE.gmv, ordersCount: STORE.orders, productsCount: STORE.products, updatedAt: TODAY });

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

  console.log(`Seeded: ${PLANS.length} plans, 1 store (${STORE.name}), ${INVOICES.length} invoices, ${ACTIVITY.length} activity, platform payments/shipping/COD.`);
  await client.end();
}

main().catch(async (e) => {
  console.error(e);
  await client.end();
  process.exit(1);
});
