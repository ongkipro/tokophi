import "server-only";
import { db, schema } from "@tokophi/db";
import { courierName, COURIER_CODES, isInstantCourier, isInstantService, isSellerCourier, isBaselineCourier } from "@tokophi/lib/couriers";
import { kiriminajaConfigured, kaCoverage } from "@tokophi/lib/kiriminaja";
import { autolarisConfigured } from "@tokophi/lib/autolaris";
import { asc, desc, eq, sql } from "drizzle-orm";
import { type Store, type StoreStatus, type Invoice, type PActivity } from "./types";
import { BILLING, computeBilling, storeSegment, type BillingState } from "@tokophi/lib/billing";

// Every relative figure ("N hari lalu", 30-day windows) is measured from the REAL clock.
//
// This file used to anchor them to a fixed TODAY that matched the seed, which made a store silent
// for a fortnight read as if it had ordered yesterday. Dormancy that lies is worse than no dormancy
// figure at all, and `computeBilling()` was already on the real clock — so the page contradicted
// itself. One clock, the real one.
const daysBetween = (d: Date) => Math.round((Date.now() - d.getTime()) / 86_400_000);
const minutesBetween = (d: Date) => Math.round((Date.now() - d.getTime()) / 60_000);

// ---- stores ----
//
// ⚠️ `store_stats` (gmv_idr / orders_count / products_count / ship7d_avg) is NOT read here and must
// not be. It is a rollup nobody maintains and it disagrees with the rows it claims to summarise —
// e.g. it credited Batik Nusantara with Rp104,3jt over 502 orders when `orders` holds Rp241,3jt
// over 685, and it gave five stores 88–260 orders apiece when each has 3. Every figure below is
// derived from `orders` / `products` at read time. `ship7d_avg` has no source at all (`fulfillments`
// is empty, there is no `shipments` table) and is therefore GONE from the UI, not re-derived.
//
// UI status is the REAL-TIME lifecycle (computeBilling), not the possibly-stale stored column.
const BILL_TO_UI: Record<"trial" | "active" | "past_due" | "suspended", StoreStatus> = { active: "aktif", trial: "trial", past_due: "menunggak", suspended: "ditangguhkan" };

type StoreRow = {
  id: string; name: string; city: string | null;
  trialEndsAt: string | null; currentPeriodEnd: string | null; firstInvoicePaid: boolean; comped: boolean;
  createdAt: string; owner: string | null; email: string | null;
  gmv: string | number; orders: number; orders30d: number; products: number; lastOrderAt: string | null;
};

function rowToStore(r: StoreRow): Store {
  const bill = {
    trialEndsAt: r.trialEndsAt ? new Date(r.trialEndsAt) : null,
    currentPeriodEnd: r.currentPeriodEnd ? new Date(r.currentPeriodEnd) : null,
    firstInvoicePaid: r.firstInvoicePaid,
    comped: r.comped,
  };
  return {
    id: r.id,
    name: r.name,
    owner: r.owner ?? "",
    email: r.email ?? "",
    city: r.city ?? "",
    status: BILL_TO_UI[computeBilling(bill).status],
    segment: storeSegment(bill),
    comped: r.comped,
    gmv: Number(r.gmv ?? 0),
    orders: Number(r.orders ?? 0),
    orders30d: Number(r.orders30d ?? 0),
    products: Number(r.products ?? 0),
    lastOrderDays: r.lastOrderAt ? Math.max(0, daysBetween(new Date(r.lastOrderAt))) : null,
    createdDaysAgo: Math.max(0, daysBetween(new Date(r.createdAt))),
  };
}

// GMV excludes `batal` (cancelled) — a cancelled order is not transaction value; counting it
// inflates every store on the list. Returns (`retur`) ARE counted: the sale happened.
const STORES_SQL = sql`
  select
    s.id, s.name, s.city,
    s.trial_ends_at        as "trialEndsAt",
    s.current_period_end   as "currentPeriodEnd",
    s.first_invoice_paid   as "firstInvoicePaid",
    s.comped, s.created_at as "createdAt",
    u.name  as "owner",
    u.email as "email",
    coalesce(o.gmv, 0)::bigint  as "gmv",
    coalesce(o.orders, 0)::int  as "orders",
    coalesce(o.orders30d, 0)::int as "orders30d",
    o.last_order_at             as "lastOrderAt",
    coalesce(p.products, 0)::int as "products"
  from stores s
  left join store_users su on su.store_id = s.id and su.role = 'owner'
  left join users u on u.id = su.user_id
  left join lateral (
    select
      sum(total_idr) filter (where status <> 'batal')                                 as gmv,
      count(*)       filter (where status <> 'batal')                                 as orders,
      count(*)       filter (where status <> 'batal' and placed_at >= now() - interval '30 days') as orders30d,
      max(placed_at)                                                                  as last_order_at
    from orders where store_id = s.id
  ) o on true
  left join lateral (
    select count(*) as products from products where store_id = s.id and status = 'active'
  ) p on true
`;

export async function getStores(): Promise<Store[]> {
  const rows = (await db.execute(sql`${STORES_SQL} order by "gmv" desc nulls last`)) as unknown as StoreRow[];
  return rows.map(rowToStore);
}

export async function getStoreById(id: string): Promise<Store | null> {
  const rows = (await db.execute(sql`${STORES_SQL} where s.id = ${id} limit 1`)) as unknown as StoreRow[];
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
//
// `revenueFailed` is new and it is the number that actually costs money: an invoice the merchant
// TRIED to pay and could not. It was buried as one row among sixteen in the Tagihan table.
//
// What is NOT here: `annualPaid`. `invoices.cycle` is NULL on every seeded row, so the old count was
// structurally always 0 — a card that could never say anything. Gone rather than dressed up.
export type FinanceStats = {
  mrr: number; arr: number;
  revenuePaid: number; revenuePending: number; revenueFailed: number;
  invoicesPaid: number; invoicesPending: number; invoicesFailed: number;
  gmvTotal: number;
};
export async function getFinanceStats(): Promise<FinanceStats> {
  const [sub, invs, gmvRow] = await Promise.all([
    getSubscriptionStats(),
    db.select({ status: schema.invoices.status, amount: schema.invoices.amountIdr }).from(schema.invoices),
    db.execute(sql`select coalesce(sum(total_idr) filter (where status <> 'batal'), 0)::bigint as "gmv" from orders`) as unknown as Promise<{ gmv: string }[]>,
  ]);
  const sum = (st: string) => invs.filter((i) => i.status === st).reduce((a, i) => a + i.amount, 0);
  const cnt = (st: string) => invs.filter((i) => i.status === st).length;
  return {
    mrr: sub.mrr,
    arr: sub.mrr * 12,
    revenuePaid: sum("dibayar"),
    revenuePending: sum("menunggu"),
    revenueFailed: sum("gagal"),
    invoicesPaid: cnt("dibayar"),
    invoicesPending: cnt("menunggu"),
    invoicesFailed: cnt("gagal"),
    gmvTotal: Number(gmvRow[0]?.gmv ?? 0),
  };
}

/**
 * MONEY WE ARE HOLDING ON MERCHANTS' BEHALF — the platform's largest liability, and until now
 * invisible on every screen.
 *
 * Every rupiah in `ledger_entries` belongs to a merchant, not to us. `available` is withdrawable
 * today (they can ask for it at any moment); `pending` becomes withdrawable when the order settles.
 * `payoutObligation` is the slice already spoken for — a merchant clicked "Tarik saldo", the money
 * left their available pool, and we owe the bank transfer.
 *
 * This is emphatically NOT platform revenue. Platform revenue is `invoices` (Rp275rb/mo + PPN).
 * Conflating the two is the single most expensive mistake an operator of a marketplace can make.
 */
export type PlatformFloat = {
  available: number; // withdrawable by merchants right now
  pending: number; // not yet settled
  payoutObligation: number; // payouts menunggu + diproses — transfers we still owe
  payoutPendingCount: number;
  storesWithBalance: number;
};
export async function getPlatformFloat(): Promise<PlatformFloat> {
  const [led] = (await db.execute(sql`
    select
      coalesce(sum(amount_idr) filter (where status = 'available'), 0)::bigint as "available",
      coalesce(sum(amount_idr) filter (where status = 'pending'), 0)::bigint   as "pending",
      count(distinct store_id)::int                                            as "stores"
    from ledger_entries
  `)) as unknown as { available: string; pending: string; stores: number }[];
  const [po] = (await db.execute(sql`
    select
      coalesce(sum(amount_idr) filter (where status in ('menunggu','diproses')), 0)::bigint as "owed",
      count(*) filter (where status in ('menunggu','diproses'))::int                        as "cnt"
    from payouts
  `)) as unknown as { owed: string; cnt: number }[];
  return {
    available: Number(led?.available ?? 0),
    pending: Number(led?.pending ?? 0),
    payoutObligation: Number(po?.owed ?? 0),
    payoutPendingCount: Number(po?.cnt ?? 0),
    storesWithBalance: Number(led?.stores ?? 0),
  };
}

/**
 * Subscription revenue we actually COLLECTED, by month — real invoices, real payment dates.
 *
 * This replaces a 12-point "Pertumbuhan MRR" area chart whose every point was produced by
 * `mulberry32(4242)` compounding a random 6–11% per month and then rescaled so the last point
 * happened to land on today's MRR. The shape was invented; so was the "+x% MoM" printed beside it.
 * A subscription business's history IS its paid invoices, and we have them.
 *
 * Amounts are PPN-inclusive (that is what the merchant paid and what the row stores).
 */
export type RevenuePoint = { month: string; label: string; collected: number; invoices: number };
export async function getRevenueSeries(months = 12): Promise<RevenuePoint[]> {
  const rows = (await db.execute(sql`
    with span as (
      select generate_series(
        date_trunc('month', now()) - make_interval(months => ${months - 1}),
        date_trunc('month', now()),
        interval '1 month'
      ) as m
    )
    select
      to_char(span.m, 'YYYY-MM')                                   as "month",
      coalesce(sum(i.amount_idr), 0)::bigint                       as "collected",
      count(i.*)::int                                              as "invoices"
    from span
    left join invoices i
      on i.status = 'dibayar' and date_trunc('month', i.issued_at) = span.m
    group by span.m
    order by span.m
  `)) as unknown as { month: string; collected: string; invoices: number }[];
  const MONTH_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Ags", "Sep", "Okt", "Nov", "Des"];
  return rows.map((r) => ({
    month: r.month,
    label: MONTH_ID[Number(r.month.slice(5, 7)) - 1] ?? r.month,
    collected: Number(r.collected),
    invoices: Number(r.invoices),
  }));
}

/**
 * Trial → paid conversion, stated as the two counts it is made of.
 *
 * Definition (the only one the data supports): of the stores whose trial has ALREADY ENDED, how many
 * have at least one PAID invoice. Deliberately derived from `invoices`, not from the
 * `stores.first_invoice_paid` flag — the flag is a denormalised boolean and it is already wrong in
 * the seed (Gadget Murah ID carries first_invoice_paid = true with zero paid invoices; Hijab Amara
 * carries false while its Rp55.500 first-month invoice is marked dibayar). A conversion rate built
 * on a flag that disagrees with the money is not a conversion rate.
 *
 * With 7 stores this is a fragile percentage. It is shown as "5 dari 6" with the rate secondary,
 * because that is what it honestly is.
 */
export type Conversion = { trialsEnded: number; converted: number; rate: number; stillTrialing: number };
export async function getConversion(): Promise<Conversion> {
  const [r] = (await db.execute(sql`
    with s as (
      select
        st.id,
        (st.trial_ends_at is not null and st.trial_ends_at < now()) or st.current_period_end is not null as trial_ended,
        exists (select 1 from invoices i where i.store_id = st.id and i.status = 'dibayar')              as ever_paid
      from stores st
      where st.comped = false   -- VIP never had to convert; counting them flatters the rate
    )
    select
      count(*) filter (where trial_ended)::int                as "trialsEnded",
      count(*) filter (where trial_ended and ever_paid)::int  as "converted",
      count(*) filter (where not trial_ended)::int            as "stillTrialing"
    from s
  `)) as unknown as { trialsEnded: number; converted: number; stillTrialing: number }[];
  const trialsEnded = Number(r?.trialsEnded ?? 0);
  const converted = Number(r?.converted ?? 0);
  return {
    trialsEnded,
    converted,
    rate: trialsEnded ? converted / trialsEnded : 0,
    stillTrialing: Number(r?.stillTrialing ?? 0),
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
    region: process.env.DEPLOY_REGION ?? "lokal", // was hardcoded "Singapore" on a laptop
  };
}

/**
 * Where the platform's GMV physically goes — by the BUYER's delivery city, from `orders`.
 *
 * The old card was also called "GMV per Kota" but keyed on `stores.city` (where the MERCHANT is
 * registered) and fed by the store_stats rollup: a fabricated amount attributed to the wrong
 * geography. The delivery city is on the order row and is what courier coverage and COD policy are
 * actually decided against.
 *
 * Grouped by city, not province, for one reason: `orders.province` is NULL on all 700 rows, so a
 * province chart would be a single bar labelled "—". `orders.city` is populated on all 700.
 */
export type GeoRow = { city: string; gmv: number; orders: number };
export async function getGmvByCity(limit = 8): Promise<GeoRow[]> {
  const rows = (await db.execute(sql`
    select coalesce(nullif(city, ''), '—') as "city",
           sum(total_idr)::bigint          as "gmv",
           count(*)::int                   as "orders"
    from orders
    where status <> 'batal'
    group by 1
    order by "gmv" desc
    limit ${limit}
  `)) as unknown as { city: string; gmv: string; orders: number }[];
  return rows.map((r) => ({ city: r.city, gmv: Number(r.gmv), orders: Number(r.orders) }));
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
//
// MRR has exactly ONE definition now, and it lives in getSubscriptionStats(): the sum of what each
// paying store is actually billed next month (Rp50rb while on the first-month promo, Rp275rb after,
// VIP excluded). getPlatform() used to compute its own — active × Rp275rb — which ignored the promo
// and produced Rp1.100.000 on the same dashboard where the subscription card said Rp875.000. Two
// MRRs, one page. Now there is one.
//
// GONE, and not replaced:
//  · `churnRate` — was hardcoded `0` and rendered as a real KPI ("Churn 0%"). Nothing in the schema
//    records a cancellation: a store that leaves just stops paying and slides to suspended. Churn is
//    not computable, so it is not shown.
//  · `getDeltas()` — five of its six values were literal `0` rendered as "▲ 0%" delta chips under a
//    header reading "Perbandingan vs bulan lalu", and the sixth was the slope of a random series.
//  · `getPlanDistribution()` — Pemula/Bisnis/Skala tiers. Legacy, forbidden, and rendered nowhere.
export type Platform = {
  mrr: number; gmv: number; totalStores: number; activeStores: number;
  trialStores: number; pastDueStores: number; suspendedStores: number; newSignups30d: number; arpu: number;
};

export async function getPlatform(): Promise<Platform> {
  const [stores, sub] = await Promise.all([getStores(), getSubscriptionStats()]);
  const paying = sub.active; // non-comped, inside a paid period
  return {
    mrr: sub.mrr,
    gmv: stores.reduce((a, s) => a + s.gmv, 0), // merchants' transaction value — NOT our revenue
    totalStores: stores.length,
    activeStores: sub.active + sub.vip,
    trialStores: sub.trial,
    pastDueStores: sub.pastDue,
    suspendedStores: sub.suspended,
    newSignups30d: stores.filter((s) => s.createdDaysAgo <= 30).length,
    arpu: paying ? Math.round(sub.mrr / paying) : 0,
  };
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
      amount: schema.invoices.amountIdr,
      status: schema.invoices.status,
      issuedAt: schema.invoices.issuedAt,
    })
    .from(schema.invoices)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.invoices.accountId))
    .orderBy(desc(schema.invoices.issuedAt));
  return rows.map((r) => ({ id: r.number, store: r.store, amount: r.amount, status: r.status, daysAgo: daysBetween(r.issuedAt) }));
}

/**
 * THE OPERATOR'S WORKLIST — every store that needs a human today, and why, in one query.
 *
 * This is the screen that did not exist. The information was all in the database and all scattered:
 * a store's grace clock lived in `computeBilling` (store detail), its failed invoice lived in a
 * table row on /paket, its silence lived inside a health "verdict" that flattened four different
 * problems into one amber dot. An operator could not answer "who do I call this morning?"
 *
 * Each reason is a fact with a query behind it, and reasons stack — a store can be past-due AND
 * sitting on a failed payment AND dormant, which is exactly the store you call first.
 */
export type RiskReason =
  | { kind: "grace"; daysLeft: number } // past due, inside the 3-day grace → suspends in N days
  | { kind: "suspended" } // grace exhausted, storefront read-only
  | { kind: "failed_invoice"; count: number; amount: number } // tried to pay, payment failed
  | { kind: "unpaid_invoice"; count: number; amount: number; oldestDays: number }
  | { kind: "trial_ending"; daysLeft: number } // trial ends within 2 days, never paid
  | { kind: "dormant"; days: number } // paying, but no order in 30+ days → will not renew
  | { kind: "never_ordered" }; // paying, zero orders ever

export type RiskStore = { id: string; name: string; owner: string; email: string; comped: boolean; severity: number; reasons: RiskReason[] };

const DORMANT_DAYS = 30;
const TRIAL_ENDING_DAYS = 2;

export async function getRiskQueue(): Promise<RiskStore[]> {
  const [stores, invRows] = await Promise.all([
    getStores(),
    db.execute(sql`
      select store_id as "storeId", status,
             count(*)::int                  as "cnt",
             coalesce(sum(amount_idr),0)::bigint as "amount",
             max(now() - issued_at)         as "oldest"
      from invoices
      where store_id is not null and status in ('gagal','menunggu')
      group by store_id, status
    `) as unknown as Promise<{ storeId: string; status: "gagal" | "menunggu"; cnt: number; amount: string; oldest: { days?: number } | string }[]>,
  ]);
  const bill = await db
    .select({ id: schema.stores.id, trialEndsAt: schema.stores.trialEndsAt, currentPeriodEnd: schema.stores.currentPeriodEnd, firstInvoicePaid: schema.stores.firstInvoicePaid, comped: schema.stores.comped })
    .from(schema.stores);
  const billById = new Map(bill.map((b) => [b.id, b]));

  // Postgres returns an interval; the driver hands it back as an object ({days: n}) or a string.
  const intervalDays = (v: { days?: number } | string | null): number => {
    if (!v) return 0;
    if (typeof v === "object") return Number(v.days ?? 0);
    const m = /(\d+)\s*day/.exec(v);
    return m ? Number(m[1]) : 0;
  };

  const out: RiskStore[] = [];
  for (const s of stores) {
    const b = billById.get(s.id);
    if (!b) continue;
    const state = computeBilling(b);
    const reasons: RiskReason[] = [];

    // 1) billing lifecycle — the clock that ends in a suspension
    if (!s.comped) {
      if (state.status === "past_due") reasons.push({ kind: "grace", daysLeft: state.daysLeft });
      else if (state.status === "suspended") reasons.push({ kind: "suspended" });
      else if (state.status === "trial" && state.daysLeft <= TRIAL_ENDING_DAYS) reasons.push({ kind: "trial_ending", daysLeft: state.daysLeft });
    }

    // 2) money that did not arrive
    for (const r of invRows.filter((r) => r.storeId === s.id)) {
      if (r.status === "gagal") reasons.push({ kind: "failed_invoice", count: Number(r.cnt), amount: Number(r.amount) });
      else reasons.push({ kind: "unpaid_invoice", count: Number(r.cnt), amount: Number(r.amount), oldestDays: intervalDays(r.oldest) });
    }

    // 3) a paying store that has stopped trading is next month's churn — but a store still on trial
    //    with no orders is just new, so it is not counted.
    if (state.status !== "trial") {
      if (s.lastOrderDays == null) reasons.push({ kind: "never_ordered" });
      else if (s.lastOrderDays >= DORMANT_DAYS) reasons.push({ kind: "dormant", days: s.lastOrderDays });
    }

    if (!reasons.length) continue;
    const weight = (r: RiskReason) =>
      r.kind === "suspended" ? 100 : r.kind === "grace" ? 90 - r.daysLeft : r.kind === "failed_invoice" ? 70 : r.kind === "unpaid_invoice" ? 50 : r.kind === "trial_ending" ? 40 : r.kind === "never_ordered" ? 30 : 20;
    out.push({ id: s.id, name: s.name, owner: s.owner, email: s.email, comped: s.comped, severity: Math.max(...reasons.map(weight)), reasons });
  }
  return out.sort((a, b) => b.severity - a.severity || a.name.localeCompare(b.name));
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
// `sellerOffered` / `baseline` are NOT columns — they are the business roster in @tokophi/lib/couriers,
// carried to the screen so a platform operator can SEE that J&T Cargo and TIKI exist and are
// deliberately not offered to sellers, instead of wondering why they never show up in a store.
export type CourierRow = {
  key: string;
  name: string;
  on: boolean;
  services: CourierService[];
  sellerOffered: boolean; // in SELLER_COURIER_CODES — a merchant may switch it on
  baseline: boolean; // spx/jne — always on, cannot be switched off (COD rail + fallback)
};

export async function getCouriers(): Promise<CourierRow[]> {
  const rows = await db.select().from(schema.platformCouriers);
  const order = COURIER_CODES;
  return rows
    // Instant couriers are out of scope (see @tokophi/lib/couriers). A row left over from an older
    // sync is not shown or toggleable here — and the next sync disables it, since it can no longer
    // enter `byCourier`. Defence in depth: the sync guards the WRITE, this guards the READ.
    .filter((c) => !isInstantCourier(c.courier))
    .map((c) => {
      const raw = Array.isArray(c.services) ? (c.services as unknown[]) : [];
      // Tolerate the legacy string[] shape: those rows predate the sync and carry no group/cod.
      // They render as a bare name and are replaced the next time the roster is pulled.
      const services: CourierService[] = raw
        .filter((s): s is CourierService => typeof s === "object" && s !== null && "type" in s)
        .filter((s) => !isInstantService({ courier: c.courier, group: s.group }))
        .map((s) => ({ ...s, codAllowed: !!s.cod && s.codAllowed !== false }));
      return {
        key: c.courier,
        name: courierName(c.courier),
        // a baseline courier reads ON even if a stale row says otherwise — the action forces it true
        on: c.enabled || isBaselineCourier(c.courier),
        services,
        sellerOffered: isSellerCourier(c.courier),
        baseline: isBaselineCourier(c.courier),
      };
    })
    .sort((a, b) => {
      // couriers KiriminAja returned but the old hand-written list never knew about (sap, idx,
      // lion, ninja, jtcargo…) sort after the known ones instead of jumping to the front on -1.
      const ai = order.indexOf(a.key), bi = order.indexOf(b.key);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.key.localeCompare(b.key);
    });
}

// ---- per-store courier coverage (KiriminAja, per PICKUP ORIGIN) ----
//
// "Enabled" is not "the shopper will see it": a courier that does not COLLECT from this store's
// warehouse never appears in a quote, no matter how many toggles are green. J&T, measured, does not
// collect from Gubeng (Surabaya). This makes that visible on the store's page instead of leaving a
// merchant — and us — to guess why a courier never sells.
//
// One priced route per origin (kaCoverage), cached a day. Cross-tenant read on the owner connection,
// like everything else in super-admin.
export type StoreCoverage = {
  ok: boolean;
  originId: number | null; // store_settings.sender_kecamatan_id
  originName: string | null; // human district, from kiriminaja_areas
  covered: string[]; // courier codes that quote from this origin (platform-enabled ones only)
  missing: string[]; // platform-enabled couriers that do NOT collect here — the whole point
  message: string; // why, in Bahasa Indonesia, when we cannot answer
};

export async function getStoreCoverage(storeId: string): Promise<StoreCoverage> {
  const [settings] = await db
    .select({ origin: schema.storeSettings.senderKecamatanId })
    .from(schema.storeSettings)
    .where(eq(schema.storeSettings.storeId, storeId));
  const originId = settings?.origin ?? null;
  if (!originId) {
    return { ok: false, originId: null, originName: null, covered: [], missing: [], message: "Toko belum mengatur alamat penjemputan, jadi jangkauan kurir tidak bisa diperiksa." };
  }

  const [area] = await db
    .select({ district: schema.kiriminajaAreas.districtName, city: schema.kiriminajaAreas.cityName })
    .from(schema.kiriminajaAreas)
    .where(eq(schema.kiriminajaAreas.id, originId));
  const originName = area ? `${area.district}, ${area.city}` : null;

  const [cov, couriers] = await Promise.all([kaCoverage(originId), getCouriers()]);
  if (!cov.ok) {
    // an outage is UNKNOWN, never "no courier covers this store"
    return { ok: false, originId, originName, covered: [], missing: [], message: cov.error ?? "Gagal memeriksa jangkauan kurir." };
  }
  const enabled = couriers.filter((c) => c.on).map((c) => c.key);
  const covered = enabled.filter((c) => cov.couriers.includes(c));
  const missing = enabled.filter((c) => !cov.couriers.includes(c));
  return {
    ok: true,
    originId,
    originName,
    covered,
    missing,
    message: missing.length
      ? `${missing.map(courierName).join(", ")} tidak menjemput dari gudang toko ini — kurir ini tidak akan pernah muncul di checkout-nya.`
      : "Semua kurir aktif menjemput dari gudang toko ini.",
  };
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
//
// It used to also return `ship7d` (store_stats.ship7d_avg) — "kiriman/hari, 7 hari terakhir". There
// is no source for that figure anywhere: `fulfillments` is empty and no `shipments` table exists. It
// was a seeded integer, and it drove a banner that told the operator "Volume tinggi (24/hari) —
// pertimbangkan jadikan VIP gratis?", i.e. it invited them to give away a Rp275rb/mo subscription on
// the strength of a made-up number. Both are gone; the real volume figures (orders30d / GMV) are on
// the same page and an operator can read them.
export async function getStoreComp(storeId: string): Promise<{ comped: boolean; reason: string | null }> {
  const [s] = await db
    .select({ comped: schema.stores.comped, reason: schema.stores.compedReason })
    .from(schema.stores)
    .where(eq(schema.stores.id, storeId))
    .limit(1);
  return { comped: s?.comped ?? false, reason: s?.reason ?? null };
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
  // Windows run back from the REAL clock (as does every other relative figure in this file), and are
  // passed as ISO text with an explicit cast — the raw-SQL driver binds parameters as text.
  const now = Date.now();
  const since90 = new Date(now - 90 * 86_400_000).toISOString();
  const since30 = new Date(now - 30 * 86_400_000).toISOString();
  const since60 = new Date(now - 60 * 86_400_000).toISOString();

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
