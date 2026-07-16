import "server-only";
import { sql } from "drizzle-orm";
import { withCurrentTenant } from "@/lib/tenant";
import { getBalance, type Balance } from "@/lib/data/ledger";
import { getBilling } from "@/lib/data/billing";
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
  /** Gross sales in the window, EXCLUDING cancelled/returned — those are not sales. */
  revenue: number;
  /** What the shopper paid for shipping in the window. Recorded on the order (orders.shipping_idr). */
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

export async function getFinanceSummary(days: Period = 30): Promise<FinanceSummary> {
  const [balance, billing] = await Promise.all([getBalance(), getBilling()]);
  const agg = await withCurrentTenant(async (db) => {
    const [row] = (await db.execute(sql`
      select
        coalesce(sum(o.total_idr)    filter (where o.placed_at >= now() - (${days} || ' days')::interval), 0)::bigint as "revenue",
        coalesce(sum(o.shipping_idr) filter (where o.placed_at >= now() - (${days} || ' days')::interval), 0)::bigint as "shippingIn",
        count(*)                     filter (where o.placed_at >= now() - (${days} || ' days')::interval)::int        as "orders",
        count(*)                     filter (where o.status in ('baru','diproses','dikirim'))::int                    as "heldOrders",
        coalesce(sum(o.total_idr)    filter (
          where o.placed_at >= now() - (${days * 2} || ' days')::interval
            and o.placed_at <  now() - (${days} || ' days')::interval
        ), 0)::bigint as "prevRevenue"
      from orders o
      where ${SALES}
    `)) as unknown as Record<string, string | number>[];
    return {
      revenue: Number(row?.revenue ?? 0),
      shippingIn: Number(row?.shippingIn ?? 0),
      orders: Number(row?.orders ?? 0),
      heldOrders: Number(row?.heldOrders ?? 0),
      prevRevenue: Number(row?.prevRevenue ?? 0),
    };
  });
  return { balance, billing, ...agg };
}

/** Daily earnings for the window. Grouped in Asia/Jakarta, not UTC: a seller's "today" ends at
 *  midnight WIB, and a chart that disagrees with their own day is a chart they cannot reconcile. */
export async function getEarnings(days: Period = 30): Promise<EarningRow[]> {
  return withCurrentTenant(async (db) => {
    const rows = (await db.execute(sql`
      select to_char((o.placed_at at time zone 'Asia/Jakarta')::date, 'YYYY-MM-DD') as day,
             coalesce(sum(o.total_idr), 0)::bigint    as gross,
             coalesce(sum(o.shipping_idr), 0)::bigint as shipping,
             count(*)::int                            as orders
      from orders o
      where ${SALES} and o.placed_at >= now() - (${days} || ' days')::interval
      group by 1 order by 1
    `)) as unknown as Record<string, string | number>[];
    return rows.map((r) => ({
      day: String(r.day),
      gross: Number(r.gross ?? 0),
      shipping: Number(r.shipping ?? 0),
      orders: Number(r.orders ?? 0),
    }));
  });
}
