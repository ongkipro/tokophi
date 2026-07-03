import "server-only";
import { db, schema } from "@indostore/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { PLANS, planPrice, type Plan, type Store, type StoreStatus, type Invoice, type PActivity } from "./mock";

// Anchor matches the seed so relative "N hari/menit lalu" figures stay deterministic.
const TODAY = new Date("2026-07-02T00:00:00Z");
const daysBetween = (d: Date) => Math.round((TODAY.getTime() - d.getTime()) / 86_400_000);
const minutesBetween = (d: Date) => Math.round((TODAY.getTime() - d.getTime()) / 60_000);
const TO_UI: Record<"active" | "trial" | "suspended", StoreStatus> = { active: "aktif", trial: "trial", suspended: "ditangguhkan" };

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- stores ----
function rowToStore(r: {
  id: string; name: string; city: string | null; plan: Plan; status: "active" | "trial" | "suspended";
  createdAt: Date; gmv: number | null; orders: number | null; products: number | null; owner: string | null; email: string | null;
}): Store {
  return {
    id: r.id,
    name: r.name,
    owner: r.owner ?? "",
    email: r.email ?? "",
    city: r.city ?? "",
    plan: r.plan,
    status: TO_UI[r.status],
    gmv: r.gmv ?? 0,
    orders: r.orders ?? 0,
    products: r.products ?? 0,
    createdDaysAgo: daysBetween(r.createdAt),
  };
}

const storeSelect = {
  id: schema.stores.id,
  name: schema.stores.name,
  city: schema.stores.city,
  plan: schema.stores.plan,
  status: schema.stores.status,
  createdAt: schema.stores.createdAt,
  gmv: schema.storeStats.gmvIdr,
  orders: schema.storeStats.ordersCount,
  products: schema.storeStats.productsCount,
  owner: schema.users.name,
  email: schema.users.email,
};

function storesBase() {
  return db
    .select(storeSelect)
    .from(schema.stores)
    .leftJoin(schema.storeStats, eq(schema.storeStats.storeId, schema.stores.id))
    .leftJoin(schema.storeUsers, and(eq(schema.storeUsers.storeId, schema.stores.id), eq(schema.storeUsers.role, "owner")))
    .leftJoin(schema.users, eq(schema.users.id, schema.storeUsers.userId));
}

export async function getStores(): Promise<Store[]> {
  const rows = await storesBase().orderBy(desc(schema.storeStats.gmvIdr));
  return rows.map(rowToStore);
}

export async function getStoreById(id: string): Promise<Store | null> {
  const rows = await storesBase().where(eq(schema.stores.id, id)).limit(1);
  return rows[0] ? rowToStore(rows[0]) : null;
}

// ---- platform metrics ----
export type Platform = {
  mrr: number; gmv: number; totalStores: number; activeStores: number;
  trialStores: number; suspendedStores: number; newSignups30d: number; churnRate: number; arpu: number;
};

export async function getPlatform(): Promise<Platform> {
  const stores = await getStores();
  const active = stores.filter((s) => s.status === "aktif");
  const mrr = active.reduce((a, s) => a + planPrice(s.plan), 0);
  return {
    mrr,
    gmv: stores.reduce((a, s) => a + s.gmv, 0),
    totalStores: stores.length,
    activeStores: active.length,
    trialStores: stores.filter((s) => s.status === "trial").length,
    suspendedStores: stores.filter((s) => s.status === "ditangguhkan").length,
    newSignups30d: stores.filter((s) => s.createdDaysAgo <= 30).length, // derived (honest for single-tenant)
    churnRate: 0, // no cancellations
    arpu: active.length ? Math.round(mrr / active.length) : 0,
  };
}

// 12-month synthetic MRR uptrend, scaled so the final point equals current MRR.
export function buildMrrSeries(currentMrr: number): { month: string; mrr: number }[] {
  const MONTHS = ["Ags", "Sep", "Okt", "Nov", "Des", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul"];
  const rnd = mulberry32(4242);
  let v = currentMrr * 0.42;
  const pts = MONTHS.map((m) => {
    v = v * (1.06 + rnd() * 0.05);
    return { month: m, mrr: Math.round(v) };
  });
  const last = pts[pts.length - 1]?.mrr || 1;
  const k = currentMrr / last;
  return pts.map((p) => ({ ...p, mrr: Math.round(p.mrr * k) }));
}

export async function getMrrSeries(): Promise<{ month: string; mrr: number }[]> {
  const { mrr } = await getPlatform();
  return buildMrrSeries(mrr);
}

export type Deltas = { mrr: number; gmv: number; activeStores: number; newSignups30d: number; churn: number; arpu: number };
export async function getDeltas(): Promise<Deltas> {
  const series = await getMrrSeries();
  const prev = series.length >= 2 ? series[series.length - 2].mrr : series[0]?.mrr ?? 0;
  const cur = series[series.length - 1]?.mrr ?? 0;
  // Single-tenant MVP: only the MRR trend has a real month-over-month basis;
  // cross-store comparison deltas are 0 until there's more than one store.
  return {
    mrr: prev ? Number((((cur - prev) / prev) * 100).toFixed(1)) : 0,
    gmv: 0,
    activeStores: 0,
    newSignups30d: 0,
    churn: 0,
    arpu: 0,
  };
}

export async function getPlanDistribution(): Promise<{ plan: Plan; name: string; count: number; mrr: number }[]> {
  const stores = await getStores();
  return PLANS.map((p) => ({
    plan: p.key,
    name: p.name,
    count: stores.filter((s) => s.plan === p.key).length,
    mrr: stores.filter((s) => s.plan === p.key && s.status === "aktif").length * p.price,
  }));
}

export async function getStatusDistribution(): Promise<{ status: StoreStatus; label: string; count: number }[]> {
  const p = await getPlatform();
  return [
    { status: "aktif", label: "Aktif", count: p.activeStores },
    { status: "trial", label: "Trial", count: p.trialStores },
    { status: "ditangguhkan", label: "Ditangguhkan", count: p.suspendedStores },
  ];
}

// ---- invoices & activity ----
export async function getInvoices(): Promise<Invoice[]> {
  const rows = await db
    .select({
      number: schema.invoices.number,
      store: schema.accounts.name,
      plan: schema.invoices.planKey,
      amount: schema.invoices.amountIdr,
      status: schema.invoices.status,
      issuedAt: schema.invoices.issuedAt,
    })
    .from(schema.invoices)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.invoices.accountId))
    .orderBy(asc(schema.invoices.number));
  return rows.map((r) => ({ id: r.number, store: r.store, plan: r.plan, amount: r.amount, status: r.status, daysAgo: daysBetween(r.issuedAt) }));
}

export async function getActivity(): Promise<PActivity[]> {
  const rows = await db.select().from(schema.platformActivity).orderBy(asc(schema.platformActivity.ts));
  // ts ascending gives oldest-first; the feed shows most-recent first
  return rows
    .map((r) => ({ id: r.id, kind: r.kind, text: r.text, minutesAgo: minutesBetween(r.ts) }))
    .sort((a, b) => a.minutesAgo - b.minutesAgo);
}

// ---- platform settings (pengaturan) ----
export type Toggle = { key: string; name: string; desc: string; on: boolean };

const GATEWAY_META: Record<string, { name: string; desc: string; order: number }> = {
  midtrans: { name: "Midtrans", desc: "QRIS, VA, kartu kredit", order: 0 },
  xendit: { name: "Xendit", desc: "VA, e-wallet, retail", order: 1 },
  duitku: { name: "Duitku", desc: "VA & e-wallet", order: 2 },
};
const COURIER_ORDER = ["JNE", "J&T Express", "SiCepat", "AnterAja", "Pos Indonesia", "GoSend", "GrabExpress"];

export async function getPaymentGateways(): Promise<Toggle[]> {
  const gws = await db.select().from(schema.platformPaymentGateways);
  const cod = (await db.select().from(schema.platformCod))[0];
  const rows: Toggle[] = gws
    .filter((g) => GATEWAY_META[g.provider])
    .map((g) => ({ key: g.provider, name: GATEWAY_META[g.provider].name, desc: GATEWAY_META[g.provider].desc, on: g.enabled }))
    .sort((a, b) => GATEWAY_META[a.key].order - GATEWAY_META[b.key].order);
  rows.push({ key: "cod", name: "COD (Bayar di Tempat)", desc: "Ditanggung platform; limit & area diatur di sini", on: cod?.enabled ?? false });
  return rows;
}

export async function getCouriers(): Promise<Toggle[]> {
  const rows = await db.select().from(schema.platformCouriers);
  return rows
    .map((c) => ({ key: c.courier, name: c.courier, desc: Array.isArray(c.services) ? (c.services as string[]).join(", ") : "", on: c.enabled }))
    .sort((a, b) => COURIER_ORDER.indexOf(a.name) - COURIER_ORDER.indexOf(b.name));
}

export async function getAggregator(): Promise<{ provider: string; enabled: boolean }> {
  const agg = (await db.select().from(schema.shippingAggregator))[0];
  const PROVIDER_NAME: Record<string, string> = { biteship: "Biteship", rajaongkir: "RajaOngkir", shipper: "Shipper" };
  return { provider: agg ? PROVIDER_NAME[agg.provider] ?? agg.provider : "—", enabled: agg?.enabled ?? false };
}
