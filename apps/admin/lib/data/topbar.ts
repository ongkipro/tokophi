import "server-only";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import { sql } from "drizzle-orm";

// Topbar facts: the merchant's balance + the notification bell.
//
// The bell used to render TWO HARDCODED lines ("3 pesanan baru menunggu", "Stok 'Earphone TWS'
// menipis — sisa 4 unit"). Both were fiction, and the product didn't even exist: "Earphone TWS" is
// a leftover from an old electronics catalogue — the demo store sells women's fashion. A merchant
// was being alerted about stock for a product they never sold.
//
// Everything below is counted from the store's own rows, RLS-scoped. If there is nothing to say,
// it says nothing — an empty alert list is a real result, not a reason to invent one.

export type Balance = {
  /** Collected from shoppers via successful payments — what the platform owes the merchant. */
  available: number;
  /** Bills created but not yet paid (VA/QRIS awaiting payment). Not yet the merchant's money. */
  pending: number;
};

export type TopbarNotif = { id: string; title: string; sub: string; href: string };

export type TopbarData = { balance: Balance; notifs: TopbarNotif[] };

// Stock at or below this is worth telling the merchant about.
const LOW_STOCK_THRESHOLD = 20;

export async function getTopbarData(): Promise<TopbarData> {
  return withCurrentTenant(async (db: Tx) => {
    // ── balance ───────────────────────────────────────────────────────────────
    // `total` is the PPN/fee-inclusive figure the shopper actually paid; older rows only carry
    // amount_idr, hence the coalesce.
    const bal = (await db.execute(sql`
      select
        coalesce(sum(coalesce(nullif(total, 0), amount_idr)) filter (where status = 'berhasil'), 0)::bigint as "available",
        coalesce(sum(coalesce(nullif(total, 0), amount_idr)) filter (where status = 'menunggu'), 0)::bigint as "pending"
      from payments
    `)) as unknown as { available: string | number; pending: string | number }[];

    // ── notifications ─────────────────────────────────────────────────────────
    const newOrders = (await db.execute(sql`
      select count(*)::int as "n" from orders where status = 'baru'
    `)) as unknown as { n: number }[];

    const lowStock = (await db.execute(sql`
      select p.title as "title", sum(il.available)::int as "stock"
      from inventory_levels il
      join product_variants v on v.id = il.variant_id
      join products p        on p.id = v.product_id
      where p.archived_at is null
      group by p.id, p.title
      having sum(il.available) <= ${LOW_STOCK_THRESHOLD}
      order by 2 asc
      limit 3
    `)) as unknown as { title: string; stock: number }[];

    const notifs: TopbarNotif[] = [];
    const n = Number(newOrders[0]?.n ?? 0);
    if (n > 0) {
      notifs.push({
        id: "orders-new",
        title: `${n} pesanan baru menunggu`,
        sub: "Perlu diproses",
        href: "/pesanan",
      });
    }
    for (const r of lowStock) {
      notifs.push({
        id: `stock-${r.title}`,
        title: `Stok “${r.title}” menipis`,
        sub: `Sisa ${Number(r.stock)} unit`,
        href: "/produk/inventori",
      });
    }

    return {
      balance: {
        available: Number(bal[0]?.available ?? 0),
        pending: Number(bal[0]?.pending ?? 0),
      },
      notifs,
    };
  });
}
