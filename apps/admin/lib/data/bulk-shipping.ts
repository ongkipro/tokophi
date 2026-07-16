import "server-only";
import { sql } from "drizzle-orm";
import { withCurrentTenant } from "@/lib/tenant";

// Pengiriman Massal — the queue a seller packs from.
//
// Scope: orders that are PAID and NOT yet shipped — the same predicate as the `perlu_dikirim` tab and
// the sidebar badge (lib/data/orders.ts), deliberately, so three surfaces can never disagree about
// what "needs shipping" means. Unpaid orders are excluded: they are the buyer's move, not the seller's.
//
// Every row carries the three facts the bulk actions branch on, and the UI must never guess them:
//   · booked   — `ka_order_id` exists: KiriminAja has the pickup. Booking again would duplicate it.
//   · hasResi  — a REAL `awb` from a courier. Only these can be printed (buildLabelHtml refuses
//                without one, on purpose). Booked-but-no-resi is the NORMAL state right after
//                booking: KiriminAja returns awb:null until a courier accepts the pickup (verified
//                against the sandbox 2026-07-16, pickup XID-4775140108).
//   · printed  — `label_printed_at` (0055). "We rendered it", not "a printer consumed paper".
//
// `group` (1 day / reguler / ekonomi / cargo) is NOT a column: it lives in
// platform_couriers.services[].group and is reachable only via orders.service_type (0053). That join
// is why the filter can exist at all — and why `orders.courier` must hold the CODE, not a display
// name (the bug 0054 repaired: "SPX Standard" joins to nothing).

export type BulkOrderRow = {
  number: string;
  buyer: string;
  city: string;
  total: number;
  courier: string | null;
  serviceType: string | null;
  serviceName: string | null;
  group: string | null;
  awb: string | null;
  kaOrderId: string | null;
  printedAt: Date | null;
  itemCount: number;
  isBundle: boolean;
};

export type BulkFilters = {
  group?: string; // one_day | regular | economy | next_day | cargo
  courier?: string;
  printed?: "yes" | "no";
  resi?: "yes" | "no";
  bundle?: "yes" | "no"; // isi pesanan: bijian (1 item) vs bundling (>1)
};

export type BulkShippingResult = {
  rows: BulkOrderRow[];
  groups: { key: string; count: number }[];
  couriers: { code: string; count: number }[];
  counts: { total: number; printed: number; withResi: number; booked: number };
};

export async function getBulkShipping(f: BulkFilters = {}): Promise<BulkShippingResult> {
  return withCurrentTenant(async (db) => {
    // The shared scope. Kept as one fragment so the rows, the counts and the facet counts below can
    // never drift apart — a facet that promises rows the list does not have is worse than no facet.
    const scope = sql`o.status in ('baru','diproses') and o.financial_status = 'dibayar'`;

    const conds = [scope];
    if (f.group) conds.push(sql`s->>'group' = ${f.group}`);
    if (f.courier) conds.push(sql`o.courier = ${f.courier}`);
    if (f.printed === "yes") conds.push(sql`o.label_printed_at is not null`);
    if (f.printed === "no") conds.push(sql`o.label_printed_at is null`);
    if (f.resi === "yes") conds.push(sql`o.awb is not null`);
    if (f.resi === "no") conds.push(sql`o.awb is null`);
    if (f.bundle === "yes") conds.push(sql`li.n > 1`);
    if (f.bundle === "no") conds.push(sql`li.n = 1`);
    const where = sql`where ${sql.join(conds, sql` and `)}`;

    // LEFT JOINs on purpose: an order whose courier/service no longer resolves (a courier the platform
    // disabled, or a row an old image corrupted) must still be LISTED — losing it silently from the
    // packing queue is how a parcel goes unsent. It just shows no group.
    const from = sql`
      from orders o
      left join customers c on c.id = o.customer_id
      left join platform_couriers pc on pc.courier = o.courier
      left join lateral jsonb_array_elements(pc.services) s on s->>'type' = o.service_type
      left join lateral (
        select count(*)::int as n from order_line_items l where l.order_id = o.id
      ) li on true
    `;

    const rows = (await db.execute(sql`
      select o.number, coalesce(o.ship_recipient, c.name, '—') as buyer, coalesce(o.city, '—') as city,
             o.total_idr::int as total, o.courier, o.service_type,
             s->>'name' as service_name, s->>'group' as "group",
             o.awb, o.ka_order_id, o.label_printed_at, li.n as item_count
      ${from} ${where}
      order by o.placed_at desc nulls last
      limit 200
    `)) as unknown as Record<string, unknown>[];

    // Facets are computed over the SCOPE, not over the filtered set — a filter must not hide the
    // counts you need to change your mind with.
    const facetFrom = sql`
      from orders o
      left join platform_couriers pc on pc.courier = o.courier
      left join lateral jsonb_array_elements(pc.services) s on s->>'type' = o.service_type
      where ${scope}
    `;
    const groups = (await db.execute(sql`
      select s->>'group' as key, count(*)::int as count ${facetFrom} and s->>'group' is not null
      group by 1 order by 2 desc
    `)) as unknown as { key: string; count: number }[];
    const couriers = (await db.execute(sql`
      select o.courier as code, count(*)::int as count ${facetFrom} and o.courier is not null
      group by 1 order by 2 desc
    `)) as unknown as { code: string; count: number }[];
    const [counts] = (await db.execute(sql`
      select count(*)::int as total,
             count(o.label_printed_at)::int as printed,
             count(o.awb)::int as "withResi",
             count(o.ka_order_id)::int as booked
      from orders o where ${scope}
    `)) as unknown as { total: number; printed: number; withResi: number; booked: number }[];

    return {
      rows: rows.map((r) => ({
        number: String(r.number),
        buyer: String(r.buyer),
        city: String(r.city),
        total: Number(r.total ?? 0),
        courier: (r.courier as string) ?? null,
        serviceType: (r.service_type as string) ?? null,
        serviceName: (r.service_name as string) ?? null,
        group: (r.group as string) ?? null,
        awb: (r.awb as string) ?? null,
        kaOrderId: (r.ka_order_id as string) ?? null,
        printedAt: (r.label_printed_at as Date) ?? null,
        itemCount: Number(r.item_count ?? 0),
        isBundle: Number(r.item_count ?? 0) > 1,
      })),
      groups,
      couriers,
      counts: counts ?? { total: 0, printed: 0, withResi: 0, booked: 0 },
    };
  });
}
