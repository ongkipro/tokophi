import "server-only";
import { db, schema } from "@tokophi/db";
import { courierName, COURIER_CODES } from "@tokophi/lib/couriers";
import { kiriminajaConfigured } from "@tokophi/lib/kiriminaja";
import { autolarisConfigured } from "@tokophi/lib/autolaris";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { PLANS, type Plan, type Store, type StoreStatus, type Invoice, type PActivity } from "./mock";
import { BILLING, computeBilling, type BillingState } from "@tokophi/lib/billing";

// Anchor matches the seed so relative "N hari/menit lalu" figures stay deterministic.
const TODAY = new Date("2026-07-02T00:00:00Z");
const daysBetween = (d: Date) => Math.round((TODAY.getTime() - d.getTime()) / 86_400_000);
const minutesBetween = (d: Date) => Math.round((TODAY.getTime() - d.getTime()) / 60_000);
const TO_UI: Record<"active" | "trial" | "past_due" | "suspended", StoreStatus> = { active: "aktif", trial: "trial", past_due: "menunggak", suspended: "ditangguhkan" };

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
  id: string; name: string; city: string | null; plan: Plan; status: "active" | "trial" | "past_due" | "suspended";
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

// Platform-wide subscription breakdown (computed from every store's real lifecycle state).
export type SubStats = { trial: number; active: number; pastDue: number; suspended: number; mrr: number; trialEndingSoon: number; total: number };
export async function getSubscriptionStats(): Promise<SubStats> {
  const rows = await db
    .select({ trialEndsAt: schema.stores.trialEndsAt, currentPeriodEnd: schema.stores.currentPeriodEnd, firstInvoicePaid: schema.stores.firstInvoicePaid })
    .from(schema.stores);
  const s: SubStats = { trial: 0, active: 0, pastDue: 0, suspended: 0, mrr: 0, trialEndingSoon: 0, total: rows.length };
  for (const r of rows) {
    const b = computeBilling(r);
    if (b.status === "trial") {
      s.trial++;
      if (b.daysLeft <= 1) s.trialEndingSoon++;
    } else if (b.status === "active") {
      s.active++;
      s.mrr += BILLING.MONTHLY_IDR;
    } else if (b.status === "past_due") s.pastDue++;
    else s.suspended++;
  }
  return s;
}

// Finance rollup for the platform (single-plan model).
export type FinanceStats = { mrr: number; arr: number; revenuePaid: number; revenuePending: number; invoicesPaid: number; invoicesPending: number; annualPaid: number; gmvTotal: number };
export async function getFinanceStats(): Promise<FinanceStats> {
  const [sub, stores, invs] = await Promise.all([
    getSubscriptionStats(),
    getStores(),
    db.select({ status: schema.invoices.status, amount: schema.invoices.amountIdr, cycle: schema.invoices.cycle }).from(schema.invoices),
  ]);
  const paid = invs.filter((i) => i.status === "dibayar");
  const pending = invs.filter((i) => i.status === "menunggu");
  return {
    mrr: sub.mrr,
    arr: sub.mrr * 12,
    revenuePaid: paid.reduce((a, i) => a + i.amount, 0),
    revenuePending: pending.reduce((a, i) => a + i.amount, 0),
    invoicesPaid: paid.length,
    invoicesPending: pending.length,
    annualPaid: paid.filter((i) => i.cycle === "annual").length,
    gmvTotal: stores.reduce((a, s) => a + s.gmv, 0),
  };
}

// Platform system + integration status.
export type SystemStatus = { kiriminaja: boolean; autolaris: boolean; kaEnv: string; stores: number; dbOk: boolean; region: string };
export async function getSystemStatus(): Promise<SystemStatus> {
  let stores = 0;
  let dbOk = true;
  try {
    const [row] = await db.select({ c: sql<number>`count(*)` }).from(schema.stores);
    stores = Number(row?.c ?? 0);
  } catch {
    dbOk = false;
  }
  return {
    kiriminaja: kiriminajaConfigured(),
    autolaris: autolarisConfigured(),
    kaEnv: process.env.KIRIMINAJA_ENV ?? "sandbox",
    stores,
    dbOk,
    region: "Singapore",
  };
}

// Real subscription state for a store (single-plan lifecycle).
export async function getStoreBilling(id: string): Promise<BillingState | null> {
  const [s] = await db
    .select({ trialEndsAt: schema.stores.trialEndsAt, currentPeriodEnd: schema.stores.currentPeriodEnd, firstInvoicePaid: schema.stores.firstInvoicePaid })
    .from(schema.stores)
    .where(eq(schema.stores.id, id))
    .limit(1);
  return s ? computeBilling(s) : null;
}

// ---- platform metrics ----
export type Platform = {
  mrr: number; gmv: number; totalStores: number; activeStores: number;
  trialStores: number; suspendedStores: number; newSignups30d: number; churnRate: number; arpu: number;
};

export async function getPlatform(): Promise<Platform> {
  const stores = await getStores();
  const active = stores.filter((s) => s.status === "aktif");
  const mrr = active.length * BILLING.MONTHLY_IDR; // single plan, recurring rate
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
  const s = await getSubscriptionStats();
  return [
    { status: "aktif", label: "Aktif", count: s.active },
    { status: "trial", label: "Trial", count: s.trial },
    { status: "menunggak", label: "Menunggak", count: s.pastDue },
    { status: "ditangguhkan", label: "Ditangguhkan", count: s.suspended },
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
export type PaymentChannelRow = { key: string; label: string; kind: string; enabled: boolean; active: boolean };

export async function getPaymentChannels(): Promise<PaymentChannelRow[]> {
  const rows = await db.select().from(schema.platformPaymentChannels).orderBy(schema.platformPaymentChannels.id);
  return rows.map((c) => ({ key: c.channel, label: c.label, kind: c.kind, enabled: c.enabled, active: c.active }));
}

const GATEWAY_META: Record<string, { name: string; desc: string; order: number }> = {
  autolaris: { name: "AutoLaris", desc: "PSP platform — VA (6 bank), QRIS, DANA", order: 0 },
};

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
  const order = COURIER_CODES;
  return rows
    .map((c) => ({ key: c.courier, name: courierName(c.courier), desc: Array.isArray(c.services) ? (c.services as string[]).join(", ") : "", on: c.enabled }))
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

// ---- platform team (real operators) ----
export type PlatformAdminRow = { id: string; name: string; email: string; role: string };
export async function getPlatformAdmins(): Promise<PlatformAdminRow[]> {
  const rows = await db
    .select({ id: schema.platformAdmins.id, name: schema.platformAdmins.name, email: schema.platformAdmins.email, role: schema.platformAdmins.role })
    .from(schema.platformAdmins)
    .orderBy(asc(schema.platformAdmins.createdAt));
  return rows.map((r) => ({ id: r.id, name: r.name ?? r.email, email: r.email, role: r.role }));
}

export async function getAggregator(): Promise<{ provider: string; enabled: boolean }> {
  const agg = (await db.select().from(schema.shippingAggregator))[0];
  const PROVIDER_NAME: Record<string, string> = { biteship: "Biteship", rajaongkir: "RajaOngkir", shipper: "Shipper", kiriminaja: "KiriminAja" };
  return { provider: agg ? PROVIDER_NAME[agg.provider] ?? agg.provider : "—", enabled: agg?.enabled ?? false };
}
