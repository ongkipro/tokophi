import "server-only";
import { db, schema } from "@tokophi/db";
import { courierName, COURIER_CODES } from "@tokophi/lib/couriers";
import { kiriminajaConfigured } from "@tokophi/lib/kiriminaja";
import { autolarisConfigured } from "@tokophi/lib/autolaris";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { PLANS, type Plan, type Store, type StoreStatus, type Invoice, type PActivity } from "./mock";
import { BILLING, computeBilling, storeSegment, type BillingState } from "@tokophi/lib/billing";

// Anchor matches the seed so relative "N hari/menit lalu" figures stay deterministic.
const TODAY = new Date("2026-07-02T00:00:00Z");
const daysBetween = (d: Date) => Math.round((TODAY.getTime() - d.getTime()) / 86_400_000);
const minutesBetween = (d: Date) => Math.round((TODAY.getTime() - d.getTime()) / 60_000);

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
// UI status is the REAL-TIME lifecycle (computeBilling), not the possibly-stale stored column,
// so the Toko list stays consistent with the store detail + enforcement.
const BILL_TO_UI: Record<"trial" | "active" | "past_due" | "suspended", StoreStatus> = { active: "aktif", trial: "trial", past_due: "menunggak", suspended: "ditangguhkan" };
function rowToStore(r: {
  id: string; name: string; city: string | null; plan: Plan;
  trialEndsAt: Date | null; currentPeriodEnd: Date | null; firstInvoicePaid: boolean; comped: boolean;
  createdAt: Date; gmv: number | null; orders: number | null; products: number | null; ship7d: number | null; owner: string | null; email: string | null;
}): Store {
  return {
    id: r.id,
    name: r.name,
    owner: r.owner ?? "",
    email: r.email ?? "",
    city: r.city ?? "",
    plan: r.plan,
    status: BILL_TO_UI[computeBilling(r).status],
    segment: storeSegment(r),
    comped: r.comped,
    gmv: r.gmv ?? 0,
    orders: r.orders ?? 0,
    products: r.products ?? 0,
    ship7d: r.ship7d ?? 0,
    createdDaysAgo: daysBetween(r.createdAt),
  };
}

const storeSelect = {
  id: schema.stores.id,
  name: schema.stores.name,
  city: schema.stores.city,
  plan: schema.stores.plan,
  trialEndsAt: schema.stores.trialEndsAt,
  currentPeriodEnd: schema.stores.currentPeriodEnd,
  firstInvoicePaid: schema.stores.firstInvoicePaid,
  comped: schema.stores.comped,
  createdAt: schema.stores.createdAt,
  gmv: schema.storeStats.gmvIdr,
  orders: schema.storeStats.ordersCount,
  products: schema.storeStats.productsCount,
  ship7d: schema.storeStats.ship7dAvg,
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
export type SubStats = { trial: number; active: number; pastDue: number; suspended: number; vip: number; mrr: number; trialEndingSoon: number; total: number };
export async function getSubscriptionStats(): Promise<SubStats> {
  const rows = await db
    .select({ trialEndsAt: schema.stores.trialEndsAt, currentPeriodEnd: schema.stores.currentPeriodEnd, firstInvoicePaid: schema.stores.firstInvoicePaid, comped: schema.stores.comped })
    .from(schema.stores);
  const s: SubStats = { trial: 0, active: 0, pastDue: 0, suspended: 0, vip: 0, mrr: 0, trialEndingSoon: 0, total: rows.length };
  for (const r of rows) {
    if (r.comped) { s.vip++; continue; } // VIP: active but no MRR, tracked separately
    const b = computeBilling(r);
    if (b.status === "trial") {
      s.trial++;
      if (b.daysLeft <= 1) s.trialEndingSoon++;
    } else if (b.status === "active") {
      s.active++;
      s.mrr += r.firstInvoicePaid ? BILLING.MONTHLY_IDR : BILLING.FIRST_MONTH_IDR; // first month contributes the promo rate
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

// Real-time server metrics. In a container, node:os reads the HOST kernel → these reflect the VPS
// (load/RAM/cores/uptime). CPU% is a load-per-core estimate.
export type ServerMetrics = { cpuPct: number; cpuLoad1: number; cpuCores: number; memUsed: number; memTotal: number; memPct: number; uptimeSec: number };
export async function getServerMetrics(): Promise<ServerMetrics> {
  const os = await import("node:os");
  const cores = os.cpus().length || 1;
  const load1 = os.loadavg()[0];
  const total = os.totalmem();
  const used = total - os.freemem();
  return {
    cpuPct: Math.min(100, Math.round((load1 / cores) * 100)),
    cpuLoad1: Math.round(load1 * 100) / 100,
    cpuCores: cores,
    memUsed: used,
    memTotal: total,
    memPct: Math.round((used / total) * 100),
    uptimeSec: Math.round(os.uptime()),
  };
}

// Real subscription state for a store (single-plan lifecycle).
export async function getStoreBilling(id: string): Promise<BillingState | null> {
  const [s] = await db
    .select({ trialEndsAt: schema.stores.trialEndsAt, currentPeriodEnd: schema.stores.currentPeriodEnd, firstInvoicePaid: schema.stores.firstInvoicePaid, comped: schema.stores.comped })
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
  const mrr = active.filter((s) => !s.comped).length * BILLING.MONTHLY_IDR; // single plan; VIP/comped excluded
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

// A courier + every service KiriminAja actually offers for it. `services` used to be a jsonb array
// of plain strings ("REG", "BEST") copied from a hand-written roster; syncCouriersFromKiriminaja()
// now writes OBJECTS carrying the live service_type, the speed group, KiriminAja's own `cod` flag,
// and the platform's `codAllowed` decision on top of it.
export type CourierService = {
  type: string; // KiriminAja service_type — the booking code ("REG23", "1", "FLREG")
  name: string;
  group: string; // cargo | regular | next_day | economy | one_day
  cod: boolean; // KiriminAja will collect cash for this service
  codAllowed: boolean; // …and we permit it (super-admin's call)
};
export type CourierRow = { key: string; name: string; on: boolean; services: CourierService[] };

export async function getCouriers(): Promise<CourierRow[]> {
  const rows = await db.select().from(schema.platformCouriers);
  const order = COURIER_CODES;
  return rows
    .map((c) => {
      const raw = Array.isArray(c.services) ? (c.services as unknown[]) : [];
      // Tolerate the legacy string[] shape: those rows predate the sync and carry no group/cod.
      // They render as a bare name and are replaced the next time the roster is pulled.
      const services: CourierService[] = raw
        .filter((s): s is CourierService => typeof s === "object" && s !== null && "type" in s)
        .map((s) => ({ ...s, codAllowed: !!s.cod && s.codAllowed !== false }));
      return { key: c.courier, name: courierName(c.courier), on: c.enabled, services };
    })
    .sort((a, b) => {
      // couriers KiriminAja returned but the old hand-written list never knew about (sap, idx,
      // lion, ninja, jtcargo…) sort after the known ones instead of jumping to the front on -1.
      const ai = order.indexOf(a.key), bi = order.indexOf(b.key);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.key.localeCompare(b.key);
    });
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

// ---- per-store control-plane detail (invoices, users, audit) ----
export type StoreInvoiceRow = { number: string; amount: number; status: "dibayar" | "menunggu" | "gagal"; kind: string | null; cycle: string | null; daysAgo: number };
export async function getStoreInvoices(storeId: string): Promise<StoreInvoiceRow[]> {
  const rows = await db
    .select({ number: schema.invoices.number, amount: schema.invoices.amountIdr, status: schema.invoices.status, kind: schema.invoices.kind, cycle: schema.invoices.cycle, issuedAt: schema.invoices.issuedAt })
    .from(schema.invoices)
    .where(eq(schema.invoices.storeId, storeId))
    .orderBy(desc(schema.invoices.issuedAt));
  return rows.map((r) => ({ number: r.number, amount: r.amount, status: r.status, kind: r.kind, cycle: r.cycle, daysAgo: daysBetween(r.issuedAt) }));
}

export type StoreUserRow = { id: string; userId: string; name: string; email: string; role: string; acceptedDaysAgo: number | null };
export async function getStoreUsers(storeId: string): Promise<StoreUserRow[]> {
  const rows = await db
    .select({ id: schema.storeUsers.id, userId: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.storeUsers.role, acceptedAt: schema.storeUsers.acceptedAt })
    .from(schema.storeUsers)
    .innerJoin(schema.users, eq(schema.users.id, schema.storeUsers.userId))
    .where(eq(schema.storeUsers.storeId, storeId))
    .orderBy(asc(schema.storeUsers.invitedAt));
  return rows.map((r) => ({ id: r.id, userId: r.userId, name: r.name ?? r.email, email: r.email, role: r.role, acceptedDaysAgo: r.acceptedAt ? daysBetween(r.acceptedAt) : null }));
}

// Per-store audit/activity: rows explicitly tagged with this store_id (operator actions + store events).
export async function getStoreActivity(storeId: string): Promise<PActivity[]> {
  const rows = await db
    .select()
    .from(schema.platformActivity)
    .where(eq(schema.platformActivity.storeId, storeId))
    .orderBy(desc(schema.platformActivity.ts))
    .limit(20);
  return rows.map((r) => ({ id: r.id, kind: r.kind, text: r.text, minutesAgo: minutesBetween(r.ts) }));
}

// ---- support tickets (platform view: all stores) ----
export type PTicket = { id: string; subject: string; status: string; storeName: string; lastMessageAt: Date; minutesAgo: number };
export async function getAllTickets(): Promise<PTicket[]> {
  const rows = await db
    .select({ id: schema.supportTickets.id, subject: schema.supportTickets.subject, status: schema.supportTickets.status, storeName: schema.stores.name, lastMessageAt: schema.supportTickets.lastMessageAt })
    .from(schema.supportTickets)
    .innerJoin(schema.stores, eq(schema.stores.id, schema.supportTickets.storeId))
    .orderBy(desc(schema.supportTickets.lastMessageAt));
  return rows.map((r) => ({ ...r, minutesAgo: minutesBetween(r.lastMessageAt) }));
}

export type PTicketDetail = { id: string; subject: string; status: string; storeName: string; storeId: string; messages: { id: string; sender: string; body: string; createdAt: Date }[] };
export async function getTicketAdmin(id: string): Promise<PTicketDetail | null> {
  const [t] = await db
    .select({ id: schema.supportTickets.id, subject: schema.supportTickets.subject, status: schema.supportTickets.status, storeId: schema.supportTickets.storeId, storeName: schema.stores.name })
    .from(schema.supportTickets)
    .innerJoin(schema.stores, eq(schema.stores.id, schema.supportTickets.storeId))
    .where(eq(schema.supportTickets.id, id))
    .limit(1);
  if (!t) return null;
  const messages = await db
    .select({ id: schema.supportMessages.id, sender: schema.supportMessages.sender, body: schema.supportMessages.body, createdAt: schema.supportMessages.createdAt })
    .from(schema.supportMessages).where(eq(schema.supportMessages.ticketId, id)).orderBy(asc(schema.supportMessages.createdAt));
  return { id: t.id, subject: t.subject, status: t.status, storeName: t.storeName, storeId: t.storeId, messages };
}
export async function getOpenTicketCount(): Promise<number> {
  const [row] = await db.select({ c: sql<number>`count(*)` }).from(schema.supportTickets).where(eq(schema.supportTickets.status, "open"));
  return Number(row?.c ?? 0);
}

// ---- pencairan (payouts — platform side) ----
//
// A merchant requests a payout from /saldo; nobody but us can approve it. This is the operator's
// queue. Cross-tenant on purpose: super-admin runs on the owner connection (the deliberate RLS
// exception), so it sees every store's requests in one list.
export type PayoutStatus = "menunggu" | "diproses" | "selesai" | "gagal";
export type PayoutRow = {
  id: string;
  storeId: string;
  storeName: string;
  amount: number;
  status: PayoutStatus;
  bankName: string | null;
  bankAccount: string | null;
  bankHolder: string | null;
  note: string | null;
  requestedAt: Date;
  paidAt: Date | null;
  minutesAgo: number;
};

// Sorted the way an operator actually works the queue: everything still OPEN first (menunggu, then
// diproses), newest first inside each bucket; settled rows (selesai/gagal) sink to the bottom.
const PAYOUT_RANK = sql<number>`case ${schema.payouts.status}
  when 'menunggu' then 0 when 'diproses' then 1 when 'selesai' then 2 else 3 end`;

export async function getPayouts(): Promise<PayoutRow[]> {
  const rows = await db
    .select({
      id: schema.payouts.id,
      storeId: schema.payouts.storeId,
      storeName: schema.stores.name,
      amount: schema.payouts.amountIdr,
      status: schema.payouts.status,
      bankName: schema.payouts.bankName,
      bankAccount: schema.payouts.bankAccount,
      bankHolder: schema.payouts.bankHolder,
      note: schema.payouts.note,
      requestedAt: schema.payouts.requestedAt,
      paidAt: schema.payouts.paidAt,
    })
    .from(schema.payouts)
    .innerJoin(schema.stores, eq(schema.stores.id, schema.payouts.storeId))
    .orderBy(asc(PAYOUT_RANK), desc(schema.payouts.requestedAt));
  // requestedAt is real-clock (a merchant just clicked), so "N menit lalu" is measured from NOW —
  // not from the seed's TODAY anchor, which would read as negative for anything requested today.
  const now = Date.now();
  return rows.map((r) => ({
    ...r,
    minutesAgo: Math.max(0, Math.round((now - r.requestedAt.getTime()) / 60_000)),
  }));
}

export type PayoutSummary = {
  pendingCount: number; // menunggu — waiting for an operator to pick it up
  pendingAmount: number;
  processingCount: number; // diproses — transfer initiated
  processingAmount: number;
  paidCount: number; // selesai — money left
  paidAmount: number;
};
export async function getPayoutSummary(): Promise<PayoutSummary> {
  const rows = await db
    .select({ status: schema.payouts.status, amount: schema.payouts.amountIdr })
    .from(schema.payouts);
  const s: PayoutSummary = { pendingCount: 0, pendingAmount: 0, processingCount: 0, processingAmount: 0, paidCount: 0, paidAmount: 0 };
  for (const r of rows) {
    if (r.status === "menunggu") { s.pendingCount++; s.pendingAmount += r.amount; }
    else if (r.status === "diproses") { s.processingCount++; s.processingAmount += r.amount; }
    else if (r.status === "selesai") { s.paidCount++; s.paidAmount += r.amount; }
  }
  return s;
}

// platform_payout is a single-row table that may not have been seeded — fall back to the schema
// defaults rather than showing the operator an empty policy card.
export type PayoutPolicy = { releaseOn: "selesai" | "dikirim"; minPayoutIdr: number; autoApprove: boolean };
export const PAYOUT_POLICY_DEFAULT: PayoutPolicy = { releaseOn: "selesai", minPayoutIdr: 50_000, autoApprove: false };

export async function getPayoutPolicy(): Promise<PayoutPolicy> {
  const [row] = await db.select().from(schema.platformPayout).limit(1);
  if (!row) return PAYOUT_POLICY_DEFAULT;
  return {
    releaseOn: row.releaseOn === "dikirim" ? "dikirim" : "selesai",
    minPayoutIdr: row.minPayoutIdr,
    autoApprove: row.autoApprove,
  };
}

// The store's comped/VIP state + reason (for the detail control card).
export async function getStoreComp(storeId: string): Promise<{ comped: boolean; reason: string | null; ship7d: number }> {
  const [s] = await db
    .select({ comped: schema.stores.comped, reason: schema.stores.compedReason, ship7d: schema.storeStats.ship7dAvg })
    .from(schema.stores)
    .leftJoin(schema.storeStats, eq(schema.storeStats.storeId, schema.stores.id))
    .where(eq(schema.stores.id, storeId))
    .limit(1);
  return { comped: s?.comped ?? false, reason: s?.reason ?? null, ship7d: s?.ship7d ?? 0 };
}

// ---- saldo & transaksi (per store — the platform's window into ONE merchant's money) ----
//
// The merchant reads the same book from /saldo (apps/admin/lib/data/ledger.ts) through RLS; we read
// it cross-tenant on the owner connection with an explicit `store_id = $id`. The FORMULAS are
// deliberately identical, character for character — the platform and the merchant must never
// disagree about the merchant's money, and the only way to guarantee that is to derive both sides
// from the same ledger with the same arithmetic instead of storing a balance anywhere.
//
//   tersedia (available) = Σ amount WHERE status = 'available'
//   dalam proses (pending) = Σ amount WHERE status = 'pending'
//   sudah dicairkan       = −Σ amount WHERE kind = 'payout'
//   ditarik oleh retur    = −Σ amount WHERE kind = 'retur'
export type StoreBalance = {
  available: number;
  pending: number;
  withdrawn: number;
  returned: number;
};

export async function getStoreBalance(storeId: string): Promise<StoreBalance> {
  const rows = (await db.execute(sql`
    select
      coalesce(sum(amount_idr) filter (where status = 'available'), 0)::bigint as "available",
      coalesce(sum(amount_idr) filter (where status = 'pending'), 0)::bigint   as "pending",
      coalesce(-sum(amount_idr) filter (where kind = 'payout'), 0)::bigint     as "withdrawn",
      coalesce(-sum(amount_idr) filter (where kind = 'retur'), 0)::bigint      as "returned"
    from ledger_entries
    where store_id = ${storeId}
  `)) as unknown as Record<keyof StoreBalance, string | number>[];
  const r = rows[0];
  return {
    available: Number(r?.available ?? 0),
    pending: Number(r?.pending ?? 0),
    withdrawn: Number(r?.withdrawn ?? 0),
    returned: Number(r?.returned ?? 0),
  };
}

// Ledger movements for one store, newest first. A busy store has thousands of rows, so this is
// paginated in SQL (limit/offset) — never "fetch all and slice in the browser".
export type StoreMovement = {
  id: string;
  kind: string; // sale | retur | payout | adjustment
  status: string; // pending | available
  amount: number; // SIGNED
  note: string | null;
  createdAt: Date;
  orderId: string | null;
  orderNumber: string | null;
};
export const MOVEMENTS_PER_PAGE = 25;

export async function getStoreMovements(
  storeId: string,
  page = 1,
  perPage = MOVEMENTS_PER_PAGE,
): Promise<{ rows: StoreMovement[]; total: number; page: number; pages: number }> {
  const [countRow] = (await db.execute(sql`
    select count(*)::int as "total" from ledger_entries where store_id = ${storeId}
  `)) as unknown as { total: number }[];
  const total = Number(countRow?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / perPage));
  const p = Math.min(Math.max(1, Math.trunc(page) || 1), pages);
  const rows = (await db.execute(sql`
    select l.id, l.kind::text as "kind", l.status::text as "status", l.amount_idr as "amount",
           l.note, l.created_at as "createdAt", l.order_id as "orderId", o.number as "orderNumber"
    from ledger_entries l
    left join orders o on o.id = l.order_id
    where l.store_id = ${storeId}
    order by l.created_at desc, l.id desc
    limit ${perPage} offset ${(p - 1) * perPage}
  `)) as unknown as StoreMovement[];
  return {
    rows: rows.map((r) => ({ ...r, amount: Number(r.amount), createdAt: new Date(r.createdAt) })),
    total,
    page: p,
    pages,
  };
}

// This store's withdrawal history. (The cross-store queue lives in /pencairan — this is the
// per-store slice, so an operator looking at one merchant does not have to go filter that list.)
export type StorePayout = {
  id: string;
  amount: number;
  status: PayoutStatus;
  bankName: string | null;
  bankAccount: string | null;
  bankHolder: string | null;
  note: string | null;
  requestedAt: Date;
  paidAt: Date | null;
};

export async function getStorePayouts(storeId: string): Promise<StorePayout[]> {
  return db
    .select({
      id: schema.payouts.id,
      amount: schema.payouts.amountIdr,
      status: schema.payouts.status,
      bankName: schema.payouts.bankName,
      bankAccount: schema.payouts.bankAccount,
      bankHolder: schema.payouts.bankHolder,
      note: schema.payouts.note,
      requestedAt: schema.payouts.requestedAt,
      paidAt: schema.payouts.paidAt,
    })
    .from(schema.payouts)
    .where(eq(schema.payouts.storeId, storeId))
    .orderBy(desc(schema.payouts.requestedAt));
}

/**
 * Monitoring signals — the point of showing a merchant's money to the PLATFORM.
 *
 * Every field below is computed from real rows. There is no "risk score": a weighted number nobody
 * can trace back to a fact is worse than no number, because an operator will act on it. What an
 * operator gets instead is four things they can check, each with the query behind it:
 *
 *  1. `neverWithdrawn` + `idleDays` — a store sitting on a withdrawable balance it has never taken.
 *     Either the merchant is stuck (bank details, min-payout, they cannot find the button) or the
 *     account is dormant and the platform is holding money it will eventually be asked for. Both
 *     are worth a call. Derived from payouts(status='selesai') = 0 while available ≥ min payout.
 *  2. `returRate` vs `platformReturRate` — retur ÷ (dikirim + selesai + retur) over the last 90
 *     days, next to the SAME ratio across all stores. A rate is meaningless alone; a rate against
 *     the platform baseline is a comparison an operator can act on.
 *  3. `returLast30` vs `returPrev30` — money clawed back by returns in the last 30 days against the
 *     30 before it. This is the spike detector, and it is stated as two amounts, not a verdict.
 *  4. `failedPayouts` — rejected withdrawals. Each one was refused by a human for a reason (wrong
 *     account holder, failed verification); a store collecting them deserves a look.
 *
 * Also carried: `cancelRate` (batal ÷ all orders, 90d) — the seed has no returns yet, and a
 * merchant cancelling a tenth of their own orders is the same class of problem.
 */
export type StoreMoneySignals = {
  neverWithdrawn: boolean;
  idleDays: number | null; // age of the OLDEST available (unwithdrawn) sale entry
  lastPaidAt: Date | null;
  openPayouts: number; // menunggu + diproses — money already deducted, awaiting us
  failedPayouts: number;
  returOrders: number;
  shippedOrders: number; // dikirim + selesai + retur — the denominator that can actually be returned
  cancelledOrders: number;
  totalOrders: number;
  returRate: number; // 0..1, last 90d
  cancelRate: number; // 0..1, last 90d
  platformReturRate: number; // same window, all stores — the baseline
  returLast30: number; // IDR clawed back (positive)
  returPrev30: number;
  returCountLast30: number;
  minPayout: number;
};

export async function getStoreMoneySignals(storeId: string): Promise<StoreMoneySignals> {
  // Windows are anchored to the seed's TODAY (like every other relative figure in this file), and
  // passed as ISO text with an explicit cast — the raw-SQL driver binds parameters as text.
  const since90 = new Date(TODAY.getTime() - 90 * 86_400_000).toISOString();
  const since30 = new Date(TODAY.getTime() - 30 * 86_400_000).toISOString();
  const since60 = new Date(TODAY.getTime() - 60 * 86_400_000).toISOString();

  const [payoutRow] = (await db.execute(sql`
    select
      count(*) filter (where status = 'selesai')::int                as "done",
      count(*) filter (where status = 'gagal')::int                  as "failed",
      count(*) filter (where status in ('menunggu','diproses'))::int as "open",
      max(paid_at) filter (where status = 'selesai')                 as "lastPaidAt"
    from payouts where store_id = ${storeId}
  `)) as unknown as { done: number; failed: number; open: number; lastPaidAt: string | null }[];

  // The oldest still-available sale entry: how long this store's money has been sitting withdrawable.
  const [idleRow] = (await db.execute(sql`
    select min(created_at) as "oldest"
    from ledger_entries
    where store_id = ${storeId} and status = 'available' and kind = 'sale'
  `)) as unknown as { oldest: string | null }[];

  const [orderRow] = (await db.execute(sql`
    select
      count(*) filter (where status = 'retur')::int                            as "retur",
      count(*) filter (where status = 'batal')::int                            as "batal",
      count(*) filter (where status in ('dikirim','selesai','retur'))::int     as "shipped",
      count(*)::int                                                            as "total"
    from orders
    where store_id = ${storeId} and placed_at >= ${since90}::timestamptz
  `)) as unknown as { retur: number; batal: number; shipped: number; total: number }[];

  const [baselineRow] = (await db.execute(sql`
    select
      count(*) filter (where status = 'retur')::int                        as "retur",
      count(*) filter (where status in ('dikirim','selesai','retur'))::int as "shipped"
    from orders
    where placed_at >= ${since90}::timestamptz
  `)) as unknown as { retur: number; shipped: number }[];

  const [returRow] = (await db.execute(sql`
    select
      coalesce(-sum(amount_idr) filter (where created_at >= ${since30}::timestamptz), 0)::bigint                              as "last30",
      coalesce(-sum(amount_idr) filter (where created_at >= ${since60}::timestamptz and created_at < ${since30}::timestamptz), 0)::bigint  as "prev30",
      count(*) filter (where created_at >= ${since30}::timestamptz)::int                                                      as "countLast30"
    from ledger_entries
    where store_id = ${storeId} and kind = 'retur'
  `)) as unknown as { last30: string; prev30: string; countLast30: number }[];

  const policy = await getPayoutPolicy();
  const balance = await getStoreBalance(storeId);
  const done = Number(payoutRow?.done ?? 0);
  const oldest = idleRow?.oldest ? new Date(idleRow.oldest) : null;
  const shipped = Number(orderRow?.shipped ?? 0);
  const baseShipped = Number(baselineRow?.shipped ?? 0);

  return {
    neverWithdrawn: done === 0 && balance.available >= policy.minPayoutIdr,
    idleDays: oldest ? Math.max(0, daysBetween(oldest)) : null,
    lastPaidAt: payoutRow?.lastPaidAt ? new Date(payoutRow.lastPaidAt) : null,
    openPayouts: Number(payoutRow?.open ?? 0),
    failedPayouts: Number(payoutRow?.failed ?? 0),
    returOrders: Number(orderRow?.retur ?? 0),
    shippedOrders: shipped,
    cancelledOrders: Number(orderRow?.batal ?? 0),
    totalOrders: Number(orderRow?.total ?? 0),
    returRate: shipped > 0 ? Number(orderRow?.retur ?? 0) / shipped : 0,
    cancelRate: Number(orderRow?.total ?? 0) > 0 ? Number(orderRow?.batal ?? 0) / Number(orderRow.total) : 0,
    platformReturRate: baseShipped > 0 ? Number(baselineRow?.retur ?? 0) / baseShipped : 0,
    returLast30: Number(returRow?.last30 ?? 0),
    returPrev30: Number(returRow?.prev30 ?? 0),
    returCountLast30: Number(returRow?.countLast30 ?? 0),
    minPayout: policy.minPayoutIdr,
  };
}
