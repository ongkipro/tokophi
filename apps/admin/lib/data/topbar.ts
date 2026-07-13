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
  /** Withdrawable today — released once the order reached `selesai`. */
  available: number;
  /** Held against orders still in flight. Not the merchant's money yet, and a return takes it back. */
  pending: number;
  /** Clawed back by returned parcels (absolute). Shown so the chip never has to explain a drop. */
  returned: number;
};

export type TopbarNotif = { id: string; title: string; sub: string; href: string };

export type TopbarData = { balance: Balance; notifs: TopbarNotif[] };

// Stock at or below this is worth telling the merchant about.
const LOW_STOCK_THRESHOLD = 20;

export async function getTopbarData(): Promise<TopbarData> {
  return withCurrentTenant(async (db: Tx) => {
    // ── balance ───────────────────────────────────────────────────────────────
    // Read from the LEDGER (migration 0040), not from sum(payments).
    //
    // This chip used to show every successful payment as "Saldo" — Rp18,9jt — as if all of it were
    // the merchant's to take. Two thirds of it was still held against orders that had not been
    // completed, and some of it had already been clawed back by a return. A sum cannot tell those
    // apart; a ledger can, and showing a seller money they cannot actually withdraw is the kind of
    // number that gets a platform shouted at.
    const bal = (await db.execute(sql`
      select
        coalesce(sum(amount_idr) filter (where status = 'available'), 0)::bigint as "available",
        coalesce(sum(amount_idr) filter (where status = 'pending'), 0)::bigint   as "pending",
        coalesce(-sum(amount_idr) filter (where kind = 'retur'), 0)::bigint      as "returned"
      from ledger_entries
    `)) as unknown as { available: string | number; pending: string | number; returned: string | number }[];

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
        returned: Number(bal[0]?.returned ?? 0),
      },
      notifs,
    };
  });
}
