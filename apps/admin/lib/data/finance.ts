import "server-only";
import { sql } from "drizzle-orm";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import { getBalance, type Balance } from "@/lib/data/ledger";
import { getBilling } from "@/lib/data/billing";
import type { ChannelSlice } from "@/lib/data/dashboard";
import type { BillingState } from "@tokophi/lib/billing";

// Keuangan — the summary page's numbers, and Penghasilan's breakdown.
//
// SHAPE OF THE MENU, and why these are separate pages rather than tabs:
//   Keuangan     — "is my money healthy?"       (this file's summary)
//   Penghasilan  — "what did I earn, and why is it not cash yet?"  (this file's periods)
//   Saldo Saya   — "what can I withdraw right now?"   (/saldo — its OWN tabs live inside it)
//   Tagihan      — "what do I pay TokoΦ?"             (/akun/langganan)
// Shopee and Tokopedia both split Penghasilan from Saldo, and the split is real, not cosmetic:
// earnings include money the platform is still holding; a balance is only what you can take today.
//
// `getBalance()` is REUSED, never re-derived. It is the one place the ledger is summed, and a second
// copy of that arithmetic is a second version of the truth about someone's money — the same failure
// composePickupAddress had when it existed twice, except this one is denominated in rupiah.
//
// Every number below is a real query. Nothing here is a placeholder: a finance screen that invents a
// figure is worse than a finance screen that does not exist, because the merchant will believe it.
// Where we cannot know something, the field is absent — not zero, not "—" standing in for a number.

export type Period = 7 | 30 | 90;

export type FinanceSummary = {
  balance: Balance;
  billing: BillingState | null;
  /** Net Seller entitlement in the window over COLLECTED orders only (`financial_status = 'dibayar'`). */
  revenue: number;
  /** Shipping actually charged to the buyer after Seller-funded shipping discounts. */
  shippingIn: number;
  orders: number;
  /** Orders whose money the platform still holds (they have not reached `selesai`). */
  heldOrders: number;
  /** Same window, previous period — for the honest "vs" comparison. */
  prevRevenue: number;
};

export type EarningRow = {
  /** ISO date (Asia/Jakarta day). */
  day: string;
  gross: number;
  shipping: number;
  orders: number;
};

/** Orders that count as SALES: never `batal` (never shipped) and never `retur` (came back). Counting
 *  them would inflate every figure on this page, and a merchant checking their revenue against their
 *  own bank statement is exactly who would catch it. */
const SALES = sql`o.status not in ('batal','retur')`;
/** …and COLLECTED (Task 8.28): the money actually arrived. `financial_status` becomes `dibayar` when a
 *  prepaid payment reaches `berhasil` (pay/callback) or when a COD parcel is delivered
 *  (`collectCodOnDelivery` at `selesai`). Until then a `baru` order with an unpaid VA is a hope, not
 *  revenue — and it used to be counted here as "Omzet" (measured on production 2026-09-16: 4 of a
 *  store's 5 real orders, Rp873.100, all unpaid, all in "Omzet 30 hari"). `heldOrders` deliberately
 *  keeps counting unpaid/unfinished orders: that tile answers "how many are still in flight", not
 *  "how much did I earn". */
const COLLECTED = sql`o.financial_status = 'dibayar'`;

/** THE window definition — one place, because two pages in this menu label a number "Omzet 30 hari"
 *  and a merchant reconciles them against each other.
 *
 *  It shipped broken: the summary used a rolling `now() - 30 days` (a 720-HOUR window) while the
 *  daily chart used 30 CALENDAR days in Asia/Jakarta. They disagreed by Rp 1.876.000 and 5 orders on
 *  the same store on the same afternoon, because the rolling window reached back into a partial
 *  17 Juni that the calendar one excluded. Both queries were "correct"; the section was still lying.
 *
 *  Calendar days win: a seller thinks in days that start at midnight WIB, not in 720-hour spans that
 *  slide with the clock. `days` counts today INCLUSIVE — 30 hari = today + the 29 before it, exactly
 *  the span generate_series draws. */
const WIN = (days: number) => sql`
  (o.placed_at at time zone 'Asia/Jakarta')::date
    >= (now() at time zone 'Asia/Jakarta')::date - ((${days} - 1) || ' days')::interval`;

/** The period immediately BEFORE `WIN(days)`, same length, no gap and no overlap. */
const PREV_WIN = (days: number) => sql`
  (o.placed_at at time zone 'Asia/Jakarta')::date
      >= (now() at time zone 'Asia/Jakarta')::date - ((${days * 2} - 1) || ' days')::interval
  and (o.placed_at at time zone 'Asia/Jakarta')::date
      <  (now() at time zone 'Asia/Jakarta')::date - ((${days} - 1) || ' days')::interval`;

// Seller earnings come from the central order_seller_entitlements view. New orders use the immutable
// allocation and accepted shipping debits; legacy rows retain their historical expression.
export async function getFinanceSummary(days: Period = 30): Promise<FinanceSummary> {
  const [balance, billing, agg] = await Promise.all([getBalance(), getBilling(), withCurrentTenant((db) => financeSummaryRows(db, days))]);
  return { balance, billing, ...agg };
}

/** The summary query on an already-scoped connection — the seam `finance-collected.test.ts` drives
 *  against real Postgres under `tokophi_app`, exactly like `dailyStatsRows`. */
export async function financeSummaryRows(db: Tx, days: Period): Promise<Omit<FinanceSummary, "balance" | "billing">> {
  const [row] = (await db.execute(sql`
    select
      coalesce(sum(e.seller_entitlement_idr) filter (where ${WIN(days)} and ${COLLECTED}), 0)::bigint as "revenue",
      coalesce(sum(e.shipping_charged_idr)   filter (where ${WIN(days)} and ${COLLECTED}), 0)::bigint as "shippingIn",
      count(*)                               filter (where ${WIN(days)} and ${COLLECTED})::int       as "orders",
      count(*)                               filter (where o.status in ('baru','diproses','dikirim'))::int as "heldOrders",
      coalesce(sum(e.seller_entitlement_idr) filter (where ${PREV_WIN(days)} and ${COLLECTED}), 0)::bigint as "prevRevenue"
    from orders o
    join order_seller_entitlements e on e.order_id = o.id
    where ${SALES}
  `)) as unknown as Record<string, string | number>[];
  return {
    revenue: Number(row?.revenue ?? 0),
    shippingIn: Number(row?.shippingIn ?? 0),
    orders: Number(row?.orders ?? 0),
    heldOrders: Number(row?.heldOrders ?? 0),
    prevRevenue: Number(row?.prevRevenue ?? 0),
  };
}

/** Daily earnings for the window. Grouped in Asia/Jakarta, not UTC: a seller's "today" ends at
 *  midnight WIB, and a chart that disagrees with their own day is a chart they cannot reconcile.
 *
 *  EVERY day in the window is returned, including the ones with no sales at all. `group by` alone
 *  emits only days that HAVE orders, which is harmless in a list (each row names its own date) and a
 *  lie in a chart: the line would join 25 Juni straight to 28 Juni as though they were adjacent, and
 *  a shop that closed for three days would render as an unbroken trend. The zero days ARE the
 *  information. Hence the generate_series left join. */
export async function getEarnings(days: Period = 30): Promise<EarningRow[]> {
  return withCurrentTenant((db) => earningsRows(db, days));
}

export async function earningsRows(db: Tx, days: Period): Promise<EarningRow[]> {
  {
    const rows = (await db.execute(sql`
      with span as (
        select generate_series(
          (now() at time zone 'Asia/Jakarta')::date - (${days - 1} || ' days')::interval,
          (now() at time zone 'Asia/Jakarta')::date,
          '1 day'
        )::date as day
      )
      select to_char(s.day, 'YYYY-MM-DD')              as day,
             coalesce(sum(e.seller_entitlement_idr), 0)::bigint as gross,
             coalesce(sum(e.shipping_charged_idr), 0)::bigint  as shipping,
             count(o.id)::int                          as orders
      from span s
      left join orders o
        on (o.placed_at at time zone 'Asia/Jakarta')::date = s.day
       and ${SALES} and ${COLLECTED}
      left join order_seller_entitlements e on e.order_id = o.id
      group by s.day
      order by s.day
    `)) as unknown as Record<string, string | number>[];
    return rows.map((r) => ({
      day: String(r.day),
      gross: Number(r.gross ?? 0),
      shipping: Number(r.shipping ?? 0),
      orders: Number(r.orders ?? 0),
    }));
  }
}

/** Where the money came from, by attribution channel — the one dimension of these orders that is
 *  both populated and genuinely analysable (organic / other / google_ads / meta_ads / tiktok_ads).
 *  Counted from `orders.channel`, never from an invented weight vector — the dashboard's channel mix
 *  used to multiply the period total by a hard-coded 34%/24%/… identical for every store, which is
 *  the same class of lie as inventing a rupiah figure. */
export async function getChannelMix(days: Period = 30): Promise<ChannelSlice[]> {
  return withCurrentTenant(async (db) => {
    const rows = (await db.execute(sql`
      select o.channel::text as channel, coalesce(sum(e.seller_entitlement_idr), 0)::bigint as value
      from orders o
      join order_seller_entitlements e on e.order_id = o.id
      where ${SALES} and ${COLLECTED} and ${WIN(days)}
      group by 1 having sum(e.seller_entitlement_idr) > 0 order by 2 desc
    `)) as unknown as Record<string, string | number>[];
    return rows.map((r) => ({ channel: CHANNEL_LABEL[String(r.channel)] ?? String(r.channel), value: Number(r.value ?? 0) }));
  });
}

/** The enum is a machine value; a seller reads Bahasa. */
const CHANNEL_LABEL: Record<string, string> = {
  organic: "Organik",
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
  tiktok_ads: "TikTok Ads",
  other: "Lainnya",
};
