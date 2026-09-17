import "server-only";
import { db, schema } from "@tokophi/db";
import { courierName, COURIER_CODES, isInstantCourier, isInstantService } from "@tokophi/lib/couriers";
import { kaTestConnection, type KaTestResult } from "@tokophi/lib/kiriminaja";
import { cached } from "@tokophi/lib/cache";
import { classifyKaProbe, type KaProbe } from "./ka-probe";
import { autolarisConfigured } from "@tokophi/lib/autolaris";
import { getProviderConfig, maskKey, resolveAutolaris, resolveKiriminaja, type ProviderEnv } from "@tokophi/lib/provider-config";
import { encryptionAvailable } from "@tokophi/lib/crypto";
import { autolarisRow, kiriminajaRow, loadProviderRows } from "@tokophi/db/provider-config";
import { and, asc, count, desc, eq, ilike, sql, type SQL } from "drizzle-orm";
import { likeContains } from "@tokophi/lib/like";
import { LOG_PAGE_SIZE, logPages, type LogQuery } from "./activity-log";
import { type Store, type StoreStatus, type Invoice, type PActivity } from "./types";
import { computeBilling, storeSegment, type BillingState } from "@tokophi/lib/billing";
import { subscriptionKpiBucket } from "./subscription-kpi";

// Task 8.27 — the seeded demo store (`stores.is_demo`) is flagged, not purged, and every platform
// money figure joins through this so its fixture orders never read as marketplace GMV.
// An INNER join on purpose: an order whose store is gone is not platform money either.
const NOT_DEMO = sql`join stores sd on sd.id = o.store_id and sd.is_demo = false`;

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
  isDemo: boolean;
  suspendedAt: string | null; suspendedReason: string | null; approvedAt: string | null;
  createdAt: string; owner: string | null; email: string | null;
  gmv: string | number; orders: number; orders30d: number; products: number; lastOrderAt: string | null;
};

function rowToStore(r: StoreRow): Store {
  const bill = {
    trialEndsAt: r.trialEndsAt ? new Date(r.trialEndsAt) : null,
    currentPeriodEnd: r.currentPeriodEnd ? new Date(r.currentPeriodEnd) : null,
    firstInvoicePaid: r.firstInvoicePaid,
    comped: r.comped,
    suspendedAt: r.suspendedAt ? new Date(r.suspendedAt) : null,
    suspendedReason: r.suspendedReason,
    // 0090 — the signup queue. Without it every queued store reads as plainly "ditangguhkan".
    approvedAt: r.approvedAt ? new Date(r.approvedAt) : null,
  };
  const state = computeBilling(bill);
  return {
    id: r.id,
    name: r.name,
    owner: r.owner ?? "",
    email: r.email ?? "",
    city: r.city ?? "",
    status: BILL_TO_UI[state.status],
    segment: storeSegment(bill),
    comped: r.comped,
    isDemo: r.isDemo,
    operatorSuspended: state.operatorSuspended,
    pendingApproval: state.pendingApproval,
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
    s.suspended_at         as "suspendedAt",
    s.approved_at          as "approvedAt",
    s.suspended_reason     as "suspendedReason",
    s.comped, s.is_demo as "isDemo", s.created_at as "createdAt",
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

export async function getStores(
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<Store[]> {
  const rows = (await db.execute(
    sql`${STORES_SQL} order by "gmv" desc nulls last limit ${limit} offset ${offset}`,
  )) as unknown as StoreRow[];
  return rows.map(rowToStore);
}

export async function getStoreById(id: string): Promise<Store | null> {
  const rows = (await db.execute(sql`${STORES_SQL} where s.id = ${id} limit 1`)) as unknown as StoreRow[];
  return rows[0] ? rowToStore(rows[0]) : null;
}

// Platform-wide subscription breakdown (computed from every store's real lifecycle state).
//
// ⚠️ `active` is PAYING stores only — the ones whose current period is backed by a PAID invoice
// (Task 8.26, finance audit F3). A period granted by "Gratiskan N bulan" is `comped`: an active
// panel, no revenue, never MRR. Before this, production counted 12 comped stores as Rp600.000 of
// MRR. The rule itself is `subscriptionKpiBucket` (pure, table-tested); this function only feeds it
// the two invoice facts it needs — the newest paid subscription invoice and the newest comp (0113).
//
// `demo` is the seeded demo store (`stores.is_demo`, Task 8.27): counted here so the Status Toko
// slices still sum to every store, and EXCLUDED from every money figure on the dashboard.
export type SubStats = {
  trial: number;
  active: number; // paying — MRR
  comped: number; // active on a granted period — NOT MRR
  pastDue: number;
  suspended: number; // operator-suspended + lapsed
  vip: number;
  demo: number;
  mrr: number;
  trialEndingSoon: number;
  total: number;
};
export async function getSubscriptionStats(): Promise<SubStats> {
  const rows = (await db.execute(sql`
    select
      s.trial_ends_at       as "trialEndsAt",
      s.current_period_end  as "currentPeriodEnd",
      s.first_invoice_paid  as "firstInvoicePaid",
      s.comped,
      s.suspended_at        as "suspendedAt",
      s.is_demo             as "isDemo",
      -- newest PAID subscription invoice (legacy seeded rows carry kind NULL and count as subscription)
      (select max(coalesce(i.paid_at, i.issued_at)) from invoices i
        where i.store_id = s.id and i.status = 'dibayar' and coalesce(i.kind, 'subscription') <> 'comp') as "lastPaidAt",
      -- newest period the platform GRANTED (0113)
      (select max(i.issued_at) from invoices i
        where i.store_id = s.id and i.kind = 'comp') as "lastCompAt"
    from stores s
  `)) as unknown as {
    trialEndsAt: string | Date | null; currentPeriodEnd: string | Date | null; firstInvoicePaid: boolean; comped: boolean;
    suspendedAt: string | Date | null; isDemo: boolean; lastPaidAt: string | Date | null; lastCompAt: string | Date | null;
  }[];
  const at = (v: string | Date | null) => (v ? new Date(v) : null);
  const s: SubStats = { trial: 0, active: 0, comped: 0, pastDue: 0, suspended: 0, vip: 0, demo: 0, mrr: 0, trialEndingSoon: 0, total: rows.length };
  const now = new Date();
  for (const r of rows) {
    const v = subscriptionKpiBucket({
      trialEndsAt: at(r.trialEndsAt),
      currentPeriodEnd: at(r.currentPeriodEnd),
      firstInvoicePaid: r.firstInvoicePaid,
      comped: r.comped,
      suspendedAt: at(r.suspendedAt),
      isDemo: r.isDemo,
      lastPaidAt: at(r.lastPaidAt),
      lastCompAt: at(r.lastCompAt),
    }, now);
    s.mrr += v.mrr;
    if (v.trialEndingSoon) s.trialEndingSoon++;
    switch (v.bucket) {
      case "demo": s.demo++; break;
      case "suspended": case "lapsed": s.suspended++; break;
      case "vip": s.vip++; break;
      case "trial": s.trial++; break;
      case "paid": s.active++; break;
      case "comped": s.comped++; break;
      case "pastDue": s.pastDue++; break;
    }
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
    // A comp invoice (0113) is a granted period, not a bill: Rp0, never revenue, never counted.
    // The demo store's bills are seed fixtures (8.27) — out.
    db.select({ status: schema.invoices.status, amount: schema.invoices.amountIdr })
      .from(schema.invoices)
      .leftJoin(schema.stores, eq(schema.stores.id, schema.invoices.storeId))
      .where(and(sql`coalesce(${schema.invoices.kind}, 'subscription') <> 'comp'`, sql`coalesce(${schema.stores.isDemo}, false) = false`)),
    db.execute(sql`select coalesce(sum(o.total_idr) filter (where o.status <> 'batal'), 0)::bigint as "gmv" from orders o ${NOT_DEMO}`) as unknown as Promise<{ gmv: string }[]>,
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
/**
 * WHAT CARRYING PARCELS COSTS US — the courier's shipping cost on orders we have booked.
 *
 * The platform absorbs the shipping cost on COD orders (**ADR 0014**): the courier collects the
 * gross total from the buyer, remits it to us NET of what it keeps, and the merchant is still
 * credited the gross. That difference leaves the platform's float, and until this it left no trace
 * anywhere — no ledger kind, no column, no screen.
 *
 * ⚠️ Three honesties this type is shaped around, all of which a naive `sum()` would destroy:
 *
 * 1. **COD and prepaid are separate numbers.** Only COD is decided by ADR 0014; prepaid runs the
 *    same shape but is explicitly NOT decided, and the two must never be added into one figure that
 *    implies they were.
 * 2. **`NULL` means NOT RECORDED, never zero.** `orders.ka_shipping_cost_idr` arrived with migration
 *    0088; every booking before it has NULL. Coalescing those to 0 would report a small, confident,
 *    wrong number — and it would be smallest exactly where the history is longest. They are counted
 *    separately as `unrecordedOrders`.
 * 3. **This is the SHIPPING cost only.** KiriminAja documents no COD settlement fee and
 *    `platform_cod.fee_pct` is read by nothing, so the true absorbed amount is this OR MORE. The
 *    screen must not present it as the total cost of COD.
 */
export type CourierCostAbsorbed = {
  /** Shipping cost on delivered COD orders — the money ADR 0014 says we absorb. */
  codIdr: number;
  codOrders: number;
  /** Same figure for prepaid orders. Same mechanics; NOT decided by ADR 0014. */
  prepaidIdr: number;
  prepaidOrders: number;
  /** Booked orders whose cost predates 0088. NOT zero-cost — cost unknown. */
  unrecordedOrders: number;
};

/**
 * Only orders that actually reached the buyer are counted. A booking that was cancelled or returned
 * did not necessarily cost us a full carry, and claiming it did would overstate the very number this
 * function exists to keep honest.
 */
export async function getCourierCostAbsorbed(conn: Pick<typeof db, "execute"> = db): Promise<CourierCostAbsorbed> {
  const [r] = (await conn.execute(sql`
    select
      coalesce(sum(o.ka_shipping_cost_idr) filter (where p.method = 'cod'), 0)::bigint as "codIdr",
      count(*) filter (where p.method = 'cod'  and o.ka_shipping_cost_idr is not null)::int as "codOrders",
      coalesce(sum(o.ka_shipping_cost_idr) filter (where p.method is distinct from 'cod'), 0)::bigint as "prepaidIdr",
      count(*) filter (where p.method is distinct from 'cod' and o.ka_shipping_cost_idr is not null)::int as "prepaidOrders",
      count(*) filter (where o.ka_shipping_cost_idr is null)::int as "unrecordedOrders"
      from orders o
      left join payments p on p.order_id = o.id
      ${NOT_DEMO}
     where o.ka_order_id is not null
       and o.status = 'selesai'
  `)) as unknown as {
    codIdr: string; codOrders: number; prepaidIdr: string; prepaidOrders: number; unrecordedOrders: number;
  }[];
  return {
    codIdr: Number(r?.codIdr ?? 0),
    codOrders: Number(r?.codOrders ?? 0),
    prepaidIdr: Number(r?.prepaidIdr ?? 0),
    prepaidOrders: Number(r?.prepaidOrders ?? 0),
    unrecordedOrders: Number(r?.unrecordedOrders ?? 0),
  };
}

export type PlatformFloat = {
  available: number; // withdrawable by merchants right now
  pending: number; // not yet settled
  payoutObligation: number; // payouts menunggu + diproses — transfers we still owe
  payoutPendingCount: number;
  // BUYERS' money we hold for cancelled prepaid orders (`refunds` menunggu + diproses, Task 8.31).
  // A separate figure from the payout obligation on purpose: that one is owed to MERCHANTS out of
  // their ledger balance; this one never entered any ledger — it is the buyer's, and the only record
  // that we owe it is this table. Summing the two would hide which side of the counter is waiting.
  refundObligation: number;
  refundPendingCount: number;
  storesWithBalance: number;
};
export async function getPlatformFloat(): Promise<PlatformFloat> {
  const [led] = (await db.execute(sql`
    select
      coalesce(sum(amount_idr) filter (where status = 'available'), 0)::bigint as "available",
      coalesce(sum(amount_idr) filter (where status = 'pending'), 0)::bigint   as "pending",
      count(distinct store_id)::int                                            as "stores"
    from ledger_entries
    where store_id not in (select id from stores where is_demo) -- 8.27: demo money is not float
  `)) as unknown as { available: string; pending: string; stores: number }[];
  const [po] = (await db.execute(sql`
    select
      coalesce(sum(amount_idr) filter (where status in ('menunggu','diproses')), 0)::bigint as "owed",
      count(*) filter (where status in ('menunggu','diproses'))::int                        as "cnt"
    from payouts
    where store_id not in (select id from stores where is_demo)
  `)) as unknown as { owed: string; cnt: number }[];
  const [rf] = (await db.execute(sql`
    select
      coalesce(sum(amount_idr) filter (where status in ('menunggu','diproses')), 0)::bigint as "owed",
      count(*) filter (where status in ('menunggu','diproses'))::int                        as "cnt"
    from refunds
  `)) as unknown as { owed: string; cnt: number }[];
  return {
    available: Number(led?.available ?? 0),
    pending: Number(led?.pending ?? 0),
    payoutObligation: Number(po?.owed ?? 0),
    payoutPendingCount: Number(po?.cnt ?? 0),
    refundObligation: Number(rf?.owed ?? 0),
    refundPendingCount: Number(rf?.cnt ?? 0),
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
     and coalesce(i.kind, 'subscription') <> 'comp'                                -- a comp is Rp0, not collected
     and i.store_id not in (select id from stores where is_demo)                   -- 8.27
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
        exists (select 1 from invoices i where i.store_id = st.id and i.status = 'dibayar'
                   and coalesce(i.kind, 'subscription') <> 'comp')                                  as ever_paid -- a comp is not a conversion
      from stores st
      where st.comped = false   -- VIP never had to convert; counting them flatters the rate
        and st.is_demo = false  -- 8.27
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

/**
 * Which KiriminAja key is live — `sandbox` books nothing and moves no parcel, `production` books
 * for real and bills a merchant.
 *
 * ONE reader, called by both surfaces that print it (Analitik → Sistem, and the connection card on
 * Pengaturan → Kurir). A second `process.env.KIRIMINAJA_ENV ?? "sandbox"` next to the card would be
 * a second place to drift, and the two would then disagree about which environment is live — the
 * exact failure the card exists to prevent. Since Task 8.33 it reads the SAME seam that chooses the
 * base URL (`@tokophi/lib/provider-config`: the Super Admin's row first, `KIRIMINAJA_ENV` second),
 * so the badge cannot disagree with the booking.
 */
export const kaEnvName = async (): Promise<ProviderEnv> => (await getProviderConfig()).kiriminaja.env;

/**
 * What Super Admin → Pengaturan shows about the platform's own provider keys (Task 8.33): WHICH
 * environment is live and where that decision came from, whether a key is stored per environment,
 * its MASKED tail, and when it last passed a live test. Never the key itself — `maskKey` is the only
 * shape that leaves the server, and the row's ciphertext never leaves `packages/db`.
 */
export type ProviderKeyStatus = {
  /** A key exists for this slot — stored in the DB row, or (fallback) in the container env. */
  present: boolean;
  source: "db" | "env" | "none";
  /** `…1234` — the last four characters — or `—`. */
  masked: string;
  /** ISO timestamp of the last successful live test of the STORED key; null = never / not stored. */
  testedAt: string | null;
};
export type ProviderStatus = {
  /** `INTEGRATION_TOKEN_KEY` is set, so a key can be stored at all. Without it the inputs are disabled, with the reason. */
  encryptionAvailable: boolean;
  kiriminaja: {
    activeEnv: ProviderEnv;
    envSource: "db" | "env" | "default";
    sandbox: ProviderKeyStatus;
    production: ProviderKeyStatus;
  };
  autolaris: ProviderKeyStatus;
};
export async function getProviderStatus(): Promise<ProviderStatus> {
  const [rows, ka, al] = await Promise.all([loadProviderRows(), kiriminajaRow(), autolarisRow()]);
  const env = {
    KIRIMINAJA_ENV: process.env.KIRIMINAJA_ENV,
    KIRIMINAJA_API_KEY: process.env.KIRIMINAJA_API_KEY,
    AUTOLARIS_API_KEY: process.env.AUTOLARIS_API_KEY,
    AUTOLARIS_BASE: process.env.AUTOLARIS_BASE,
  };
  const active = resolveKiriminaja({ row: rows.kiriminaja, env });
  // Each slot is resolved AS IF it were the active env, so a slot shows the same key the platform
  // would use after switching to it — including the env-var fallback, which is what "present" means
  // on a deploy that has never opened this card.
  const slot = (e: ProviderEnv): ProviderKeyStatus => {
    const r = resolveKiriminaja({ row: { ...rows.kiriminaja, activeEnv: e }, env });
    const testedAt = e === "production" ? ka?.productionTestedAt : ka?.sandboxTestedAt;
    return { present: !!r.key, source: r.keySource, masked: maskKey(r.key), testedAt: r.keySource === "db" ? (testedAt?.toISOString() ?? null) : null };
  };
  const alCfg = resolveAutolaris({ row: rows.autolaris, env });
  return {
    encryptionAvailable: encryptionAvailable(),
    kiriminaja: { activeEnv: active.env, envSource: active.envSource, sandbox: slot("sandbox"), production: slot("production") },
    autolaris: { present: !!alCfg.key, source: alCfg.keySource, masked: maskKey(alCfg.key), testedAt: alCfg.keySource === "db" ? (al?.testedAt?.toISOString() ?? null) : null },
  };
}

/**
 * One compose cron sidecar's last tick, as recorded by `apps/admin/app/api/cron/record-run.ts`.
 *
 * `intervalSec` is the loop's OWN `sleep`, forwarded by the sidecar as `?every=`; the staleness
 * threshold is derived from it (`analitik/cron-liveness.ts`) so the alarm's cadence cannot drift from
 * the schedule it is watching. `null` = the caller did not report one, and the reader then refuses to
 * judge rather than invent a number.
 */
export type CronRunRow = { job: string; lastRunAt: Date; intervalSec: number | null; ok: boolean; result: unknown };

// ── Task 8.3: KiriminAja HEALTH, not key presence ────────────────────────────────────────────────
//
// `SystemStatus.kiriminaja` was `kiriminajaConfigured()` — the env key is non-empty. It read green
// for the whole of 2026-09-07 while the sandbox answered 401 (IP allow-list lapsed) and every quote
// on every checkout failed; only a container log said so. The tile now reads a LIVE probe of the
// province endpoint (free), cached in-process for five minutes so a page render costs at most one
// vendor call per replica per interval — and a FAILED probe is cached too, or an outage would turn
// every Pengaturan/Analitik render into a fresh 4-second stall. The manual "Test koneksi" button
// calls `kaTestConnection` directly and therefore bypasses this cache on purpose.
//
// The timeout races the vendor call: `ka()` already aborts at 8 s, but a page must not wait that
// long for a status badge. The loser is abandoned, not cancelled — it holds no resource but a socket.
const KA_PROBE_TTL_MS = 5 * 60_000;
const KA_PROBE_TIMEOUT_MS = 4_000;

export async function getKiriminajaProbe(): Promise<KaProbe> {
  // Keyed per environment: a probe cached under sandbox must not paint the badge for five minutes
  // after the switch to production.
  const env = await kaEnvName();
  return cached(`ka:probe:${env}`, KA_PROBE_TTL_MS, async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<KaTestResult>((resolve) => {
      timer = setTimeout(
        () => resolve({ ok: false, env, configured: true, message: `Tidak ada jawaban dari KiriminAja dalam ${KA_PROBE_TIMEOUT_MS / 1000} detik.` }),
        KA_PROBE_TIMEOUT_MS,
      );
    });
    const r = await Promise.race([kaTestConnection(), timeout]).finally(() => clearTimeout(timer));
    return { ...classifyKaProbe(r), probedAt: Date.now() };
  });
}

// Platform system + integration status.
export type SystemStatus = { kiriminaja: boolean; kiriminajaProbe: KaProbe; autolaris: boolean; kaEnv: string; stores: number; dbOk: boolean; region: string; crons: CronRunRow[] };
export async function getSystemStatus(): Promise<SystemStatus> {
  // Kicked off first so the vendor round-trip overlaps the DB reads below.
  const probe = getKiriminajaProbe();
  let stores = 0;
  let dbOk = true;
  try {
    const [row] = await db.select({ c: sql<number>`count(*)` }).from(schema.stores);
    stores = Number(row?.c ?? 0);
  } catch {
    dbOk = false;
  }
  // Cron liveness (0091). Its OWN try/catch: a container running ahead of the migration must not take
  // out the integrations card beside it — a missing table means "nothing has reported", which is
  // already the honest neutral state the reader renders for an absent row.
  let crons: CronRunRow[] = [];
  try {
    crons = await db
      .select({
        job: schema.cronRuns.job,
        lastRunAt: schema.cronRuns.lastRunAt,
        intervalSec: schema.cronRuns.intervalSec,
        ok: schema.cronRuns.ok,
        result: schema.cronRuns.result,
      })
      .from(schema.cronRuns);
  } catch (err) {
    console.error("[super-admin] cron_runs unreadable", err);
  }
  const kiriminajaProbe = await probe;
  return {
    // Green means the vendor ANSWERED and said yes — never "a key exists". Pinned by `ka-probe.test.ts`.
    kiriminaja: kiriminajaProbe.state === "ok",
    kiriminajaProbe,
    autolaris: autolarisConfigured(),
    kaEnv: await kaEnvName(),
    stores,
    dbOk,
    region: process.env.DEPLOY_REGION ?? "lokal", // was hardcoded "Singapore" on a laptop
    crons,
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
    select coalesce(nullif(o.city, ''), '—') as "city",
           sum(o.total_idr)::bigint          as "gmv",
           count(*)::int                   as "orders"
    from orders o
    ${NOT_DEMO}
    where o.status <> 'batal'
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
    .select({ trialEndsAt: schema.stores.trialEndsAt, currentPeriodEnd: schema.stores.currentPeriodEnd, firstInvoicePaid: schema.stores.firstInvoicePaid, comped: schema.stores.comped, suspendedAt: schema.stores.suspendedAt, suspendedReason: schema.stores.suspendedReason, approvedAt: schema.stores.approvedAt })
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
  const [sub, gmvRes, totalRes, new30dRes] = await Promise.all([
    getSubscriptionStats(),
    db.execute(sql`select coalesce(sum(o.total_idr), 0)::bigint as gmv from orders o ${NOT_DEMO} where o.status <> 'batal'`),
    db.execute(sql`select count(*)::int as count from stores`),
    db.execute(sql`select count(*)::int as count from stores where created_at >= now() - interval '30 days'`),
  ]);
  const gmv = Number((gmvRes[0] as Record<string, unknown> | undefined)?.gmv ?? 0);
  const totalStores = Number((totalRes[0] as Record<string, unknown> | undefined)?.count ?? 0);
  const newSignups30d = Number((new30dRes[0] as Record<string, unknown> | undefined)?.count ?? 0);
  const paying = sub.active; // non-comped, inside a paid period
  return {
    mrr: sub.mrr,
    gmv, // merchants' transaction value across ALL stores — NOT our revenue
    totalStores,
    activeStores: sub.active + sub.comped + sub.vip, // panels that are open — paying or not
    trialStores: sub.trial,
    pastDueStores: sub.pastDue,
    suspendedStores: sub.suspended,
    newSignups30d,
    arpu: paying ? Math.round(sub.mrr / paying) : 0,
  };
}

// ⚠️ THE SLICES MUST SUM TO EVERY STORE, or the shares beside them are shares of nothing.
//
// VIP was missing, so the card totalled 6 while the KPI next to it read "Toko aktif 2 / 7" — the
// comped store existed in one number and not in the other, and every percentage on the card was
// computed against the short denominator. `vip` is its OWN slice rather than folded into "Aktif":
// it is a distinct lifecycle segment here (its own tab in the Toko catalog) and hiding it inside
// Aktif is how it went missing in the first place.
//
// Its key is deliberately NOT `StoreStatus` — that union describes a store's *billing* status badge
// and has no VIP member; widening it would put a value into every badge component that none of them
// render. This card owns its own key.
//
// `digratiskan` (a granted period, 8.26) and `demo` (8.27) are slices for the same reason: a store
// in either is a store, and folding it into Aktif would put it back into the MRR headcount.
export type StatusSlice = "aktif" | "digratiskan" | "trial" | "menunggak" | "ditangguhkan" | "vip" | "demo";
export async function getStatusDistribution(): Promise<{ status: StatusSlice; label: string; count: number }[]> {
  const s = await getSubscriptionStats();
  return [
    { status: "aktif", label: "Aktif (berbayar)", count: s.active },
    { status: "digratiskan", label: "Digratiskan", count: s.comped },
    { status: "vip", label: "VIP (gratis)", count: s.vip },
    { status: "trial", label: "Trial", count: s.trial },
    { status: "menunggak", label: "Menunggak", count: s.pastDue },
    { status: "ditangguhkan", label: "Ditangguhkan", count: s.suspended },
    { status: "demo", label: "Demo", count: s.demo },
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
/**
 * THE SIGNUP REVIEW QUEUE — who is waiting on US, oldest first (0090).
 *
 * Deliberately NOT folded into `getRiskQueue()` below. That list answers "who is about to stop paying
 * us", and its own comment records why an operator-suspended store is excluded from it: a suspension
 * is a decision we already made, not a risk to be worked. A signup awaiting review is the opposite
 * shape — nobody has decided anything yet, and the clock is OURS. Mixing the two would file every
 * queued shop at severity 100 forever and bury the churn signals the list exists for.
 *
 * `approved_at IS NULL AND suspended_at IS NOT NULL` is the same predicate `computeBilling()` turns
 * into `pendingApproval`; it is expressed in SQL here because the count has to come from the whole
 * table, not from a page of it.
 *
 * Oldest first, because the merchant was promised "biasanya dalam 1×24 jam" on their own dashboard —
 * newest-first would serve whoever arrived last while the person who has waited longest scrolls off.
 */
export type PendingStore = { id: string; name: string; email: string; owner: string; hoursWaiting: number };

export async function getPendingApprovals(): Promise<PendingStore[]> {
  const rows = (await db.execute(sql`
    select s.id, s.name, s.created_at as "createdAt",
           u.email as "email", u.name as "owner"
    from stores s
    left join store_users su on su.store_id = s.id and su.role = 'owner'
    left join users u on u.id = su.user_id
    where s.approved_at is null and s.suspended_at is not null
    order by s.created_at asc
  `)) as unknown as { id: string; name: string; createdAt: string; email: string | null; owner: string | null }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email ?? "",
    owner: r.owner ?? "",
    hoursWaiting: Math.max(0, Math.round((Date.now() - new Date(r.createdAt).getTime()) / 3_600_000)),
  }));
}

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
    .select({ id: schema.stores.id, trialEndsAt: schema.stores.trialEndsAt, currentPeriodEnd: schema.stores.currentPeriodEnd, firstInvoicePaid: schema.stores.firstInvoicePaid, comped: schema.stores.comped, suspendedAt: schema.stores.suspendedAt })
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

    // 1) billing lifecycle — the clock that ends in a suspension.
    //
    // `billingStatus`, not `status`: this queue is "who is about to stop paying us", and an OPERATOR
    // suspension is a decision we already made, not a risk to be worked. Reading the effective status
    // here would file every store we deliberately locked at severity 100, permanently, at the top of
    // the operator's morning worklist — and `daysLeft` is forced to 0 by the override, so the grace
    // and trial countdowns beside it would have been wrong too.
    if (!s.comped) {
      if (state.billingStatus === "past_due") reasons.push({ kind: "grace", daysLeft: state.daysLeft });
      else if (state.billingStatus === "suspended") reasons.push({ kind: "suspended" });
      else if (state.billingStatus === "trial" && state.daysLeft <= TRIAL_ENDING_DAYS) reasons.push({ kind: "trial_ending", daysLeft: state.daysLeft });
    }

    // 2) money that did not arrive
    for (const r of invRows.filter((r) => r.storeId === s.id)) {
      if (r.status === "gagal") reasons.push({ kind: "failed_invoice", count: Number(r.cnt), amount: Number(r.amount) });
      else reasons.push({ kind: "unpaid_invoice", count: Number(r.cnt), amount: Number(r.amount), oldestDays: intervalDays(r.oldest) });
    }

    // 3) a paying store that has stopped trading is next month's churn — but a store still on trial
    //    with no orders is just new, so it is not counted.
    if (state.billingStatus !== "trial") {
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

export async function getActivity(
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<PActivity[]> {
  const rows = await db
    .select()
    .from(schema.platformActivity)
    .orderBy(desc(schema.platformActivity.ts))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    text: r.text,
    minutesAgo: minutesBetween(r.ts),
  }));
}

// ---- /log-sistem: the whole audit log, filtered and paged IN THE DATABASE ----
//
// `getActivity` above is the dashboard's 8-row peek; this is the screen that answers "who changed
// what, and when?" across every store. Paged by `limit/offset` against a `count(*)` rather than
// sliced in the browser: `platform_activity` is append-only and grows with every operator action,
// so a "load it all and filter client-side" list is the query that gets slower every week.
//
// The filters arrive from `parseLogQuery` (`activity-log.ts`), which has already whitelisted `kind`
// against the enum and `storeId` as a uuid — nothing here casts a raw URL value. The search is a
// `LIKE` over the text, escaped via `likeContains` (`%` and `_` are wildcards; an unescaped `_`
// once matched all 842 orders on the seller side).
export type ActivityLogRow = PActivity & { storeId: string | null; storeName: string | null; ts: number };

export async function getActivityLog(q: LogQuery): Promise<{ rows: ActivityLogRow[]; total: number; page: number }> {
  const conds: SQL[] = [];
  if (q.kind) conds.push(eq(schema.platformActivity.kind, q.kind));
  if (q.storeId) conds.push(eq(schema.platformActivity.storeId, q.storeId));
  if (q.q) conds.push(ilike(schema.platformActivity.text, likeContains(q.q)));
  const where = conds.length ? and(...conds) : undefined;

  // Count FIRST, then clamp: `?page=99` on an 11-row log must fetch the last page, not offset 2450
  // and render "11 catatan" over an empty table (measured in a browser before this line existed).
  const [{ total }] = await db.select({ total: count() }).from(schema.platformActivity).where(where);
  const { page } = logPages(total, q.page, LOG_PAGE_SIZE);
  const rows = await db
      .select({
        id: schema.platformActivity.id,
        kind: schema.platformActivity.kind,
        text: schema.platformActivity.text,
        storeId: schema.platformActivity.storeId,
        storeName: schema.stores.name,
        ts: schema.platformActivity.ts,
      })
      .from(schema.platformActivity)
      .leftJoin(schema.stores, eq(schema.stores.id, schema.platformActivity.storeId))
      .where(where)
      .orderBy(desc(schema.platformActivity.ts), desc(schema.platformActivity.id))
      .limit(LOG_PAGE_SIZE)
      .offset((page - 1) * LOG_PAGE_SIZE);
  return {
    total,
    page,
    rows: rows.map((r) => ({ id: r.id, kind: r.kind, text: r.text, storeId: r.storeId, storeName: r.storeName, ts: r.ts.getTime(), minutesAgo: minutesBetween(r.ts) })),
  };
}

/** `id` + `name` of every store, for the filter — deliberately not `getStores()`, which computes billing per row. */
export async function getStoreOptions(): Promise<{ id: string; name: string }[]> {
  return db.select({ id: schema.stores.id, name: schema.stores.name }).from(schema.stores).orderBy(asc(schema.stores.name));
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

// ⚠️ `platform_payment_gateways.enabled` IS NOT A GATE — it is a legacy column, kept but unenforced
// (owner ruling, 2026-08-20). Nothing on any payment path reads it: `/api/public/order` and
// `lib/actions/payments.ts` gate on `autolarisConfigured()` (the env key) ∧
// `platform_payment_channels.enabled`. The `on` flag below is carried for COD — which IS enforced,
// via `platform_cod.enabled` — and for the shape of the row; do not build a status light on the
// AutoLaris one. Same standing as `store_settings.payment_channels`: kept because dropping a column
// is a destructive migration, not because anything consults it.
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

// `enabled` is deliberately NOT returned (Task 8.12): `shipping_aggregator.enabled` is a record no
// shipping path reads, and its only consumer was a status light — see the Kurir card's comment.
export async function getAggregator(): Promise<{ provider: string; env: string }> {
  const agg = (await db.select().from(schema.shippingAggregator))[0];
  const PROVIDER_NAME: Record<string, string> = { biteship: "Biteship", rajaongkir: "RajaOngkir", shipper: "Shipper", kiriminaja: "KiriminAja" };
  // N35: the card said WHICH aggregator but never WHICH KEY. "Terhubung" against the sandbox and
  // "Terhubung" against production read identically, and only one of them moves a real parcel — the
  // operator had to press Test koneksi (whose message carries it) or leave for Analitik to find out.
  return { provider: agg ? PROVIDER_NAME[agg.provider] ?? agg.provider : "—", env: await kaEnvName() };
}

// Single-row platform finance config (0101). Missing row = the migration default: PPN OFF —
// the same fallback the three invoice creators use, so the toggle can never SHOW a state it does not BILL.
export async function getPlatformFinance(): Promise<{ subscriptionPpnEnabled: boolean }> {
  const [row] = await db.select({ on: schema.platformFinance.subscriptionPpnEnabled }).from(schema.platformFinance).where(eq(schema.platformFinance.id, 1)).limit(1);
  return { subscriptionPpnEnabled: row?.on ?? false };
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

/**
 * ⚠️ THERE IS DELIBERATELY NO `acceptedDaysAgo` HERE ANY MORE (2026-08-22).
 *
 * It was `daysBetween(store_users.accepted_at)`, and the column could not carry that claim: the
 * operator path (`addStoreUser`) stamped it at the moment the BUTTON was pressed, and the merchant
 * path stamped it identically to `invited_at`, to the millisecond. Both writes have been removed —
 * `accepted_at` is stamped once, by the first successful sign-in — but the ROWS THAT ALREADY EXIST
 * still hold the old timestamp, so a non-null value proves nothing about them. NULL means "never
 * signed in"; non-null means "either they signed in, or this row predates the fix".
 *
 * Nothing on any screen rendered the derived figure, so it is gone rather than relabelled: a
 * one-sided fact nobody displays is a trap waiting for the next person who needs a column like it.
 * If an operator-facing "sudah pernah masuk" indicator is wanted, it needs the column read directly
 * with that ambiguity stated on screen — not a days-ago number that reads like a measurement.
 */
export type StoreUserRow = { id: string; userId: string; name: string; email: string; role: string };
export async function getStoreUsers(storeId: string): Promise<StoreUserRow[]> {
  const rows = await db
    .select({ id: schema.storeUsers.id, userId: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.storeUsers.role })
    .from(schema.storeUsers)
    .innerJoin(schema.users, eq(schema.users.id, schema.storeUsers.userId))
    .where(eq(schema.storeUsers.storeId, storeId))
    .orderBy(asc(schema.storeUsers.invitedAt));
  return rows.map((r) => ({ id: r.id, userId: r.userId, name: r.name ?? r.email, email: r.email, role: r.role }));
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

// ── Refunds — the buyer's money on a cancelled prepaid order (Task 8.31) ───────────────────────────
// Written ONLY by `applyOrderStatusChange` (apps/admin/lib/order-status.ts) when an order carrying a
// `berhasil` non-COD payment moves to batal/retur; settled by hand from /pencairan. Same operator
// queue shape as payouts: open first, newest first inside each bucket, settled rows sink.
export type RefundStatus = "menunggu" | "diproses" | "selesai" | "gagal";
export type RefundRow = {
  id: string;
  storeId: string;
  storeName: string;
  orderId: string;
  orderNumber: string;
  buyerName: string | null;
  buyerPhone: string | null;
  method: string; // payments.method — which rail the money came in on (where it goes back)
  amount: number;
  status: RefundStatus;
  reason: string | null; // why the obligation exists (cancellation / return reason)
  note: string | null; // transfer reference on selesai, refusal reason on gagal
  requestedAt: Date;
  paidAt: Date | null;
  minutesAgo: number;
};

const REFUND_RANK = sql<number>`case ${schema.refunds.status}
  when 'menunggu' then 0 when 'diproses' then 1 when 'selesai' then 2 else 3 end`;

export async function getRefunds(): Promise<RefundRow[]> {
  const rows = await db
    .select({
      id: schema.refunds.id,
      storeId: schema.refunds.storeId,
      storeName: schema.stores.name,
      orderId: schema.refunds.orderId,
      orderNumber: schema.orders.number,
      // The order's SNAPSHOT (0042) — who this money goes back to, as they were at purchase.
      buyerName: schema.orders.shipRecipient,
      buyerPhone: schema.orders.shipPhone,
      method: schema.payments.method,
      amount: schema.refunds.amountIdr,
      status: schema.refunds.status,
      reason: schema.refunds.reason,
      note: schema.refunds.note,
      requestedAt: schema.refunds.requestedAt,
      paidAt: schema.refunds.paidAt,
    })
    .from(schema.refunds)
    .innerJoin(schema.stores, eq(schema.stores.id, schema.refunds.storeId))
    .innerJoin(schema.orders, eq(schema.orders.id, schema.refunds.orderId))
    .innerJoin(schema.payments, eq(schema.payments.id, schema.refunds.paymentId))
    .orderBy(asc(REFUND_RANK), desc(schema.refunds.requestedAt));
  const now = Date.now();
  return rows.map((r) => ({
    ...r,
    minutesAgo: Math.max(0, Math.round((now - r.requestedAt.getTime()) / 60_000)),
  }));
}

export type RefundSummary = {
  pendingCount: number;
  pendingAmount: number;
  processingCount: number;
  processingAmount: number;
  paidCount: number;
  paidAmount: number;
};
export async function getRefundSummary(): Promise<RefundSummary> {
  const rows = await db.select({ status: schema.refunds.status, amount: schema.refunds.amountIdr }).from(schema.refunds);
  const s: RefundSummary = { pendingCount: 0, pendingAmount: 0, processingCount: 0, processingAmount: 0, paidCount: 0, paidAmount: 0 };
  for (const r of rows) {
    if (r.status === "menunggu") { s.pendingCount++; s.pendingAmount += r.amount; }
    else if (r.status === "diproses") { s.processingCount++; s.processingAmount += r.amount; }
    else if (r.status === "selesai") { s.paidCount++; s.paidAmount += r.amount; }
  }
  return s;
}

// platform_payout is a single-row table that may not have been seeded — fall back to the schema
// defaults rather than showing the operator an empty policy card.
// `platform_payout.auto_approve` is intentionally NOT here: nothing writes it (savePayoutPolicy takes
// only releaseOn + minPayoutIdr) and nothing renders it, so surfacing it was a dead read. Column kept
// (dropping is a destructive migration); this type just stops pretending it's live.
export type PayoutPolicy = { releaseOn: "selesai" | "dikirim"; minPayoutIdr: number };
export const PAYOUT_POLICY_DEFAULT: PayoutPolicy = { releaseOn: "selesai", minPayoutIdr: 50_000 };

export async function getPayoutPolicy(): Promise<PayoutPolicy> {
  const [row] = await db.select().from(schema.platformPayout).limit(1);
  if (!row) return PAYOUT_POLICY_DEFAULT;
  return {
    releaseOn: row.releaseOn === "dikirim" ? "dikirim" : "selesai",
    minPayoutIdr: row.minPayoutIdr,
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
