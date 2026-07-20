import "server-only";
import { sql } from "drizzle-orm";
import { withCurrentTenant } from "@/lib/tenant";

// Pengiriman Massal — the queue a seller packs from.
//
// Scope: orders that are PAID (or COD) and still need a seller action on the parcel. That is the
// `perlu_dikirim` predicate (lib/data/orders.ts — tab + sidebar badge) PLUS orders already flipped to
// `dikirim` that have no AWB yet; see the scope fragment below for why. Unpaid orders are excluded:
// they are the buyer's move, not the seller's. This queue is therefore a SUPERSET of `perlu_dikirim`
// — if you change one predicate, read the other; they are relatives, not clones.
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
    // COD orders ship before payment (cash on delivery), so they belong in the queue while still
    // financial_status='pending' — same carve-out as the Perlu Dikirim tab. Without it COD parcels
    // could never be bulk-booked.
    //
    // ⚠️ `dikirim` WITH NO AWB IS IN SCOPE ON PURPOSE — do NOT "tidy" this back to two statuses.
    // The waybill is issued asynchronously: booking returns awb:null and the tracking poller fills it
    // later. That poller can advance the STATUS without an AWB (cron/tracking guards on
    // `if (!realAwb && !outcome) continue`, so syncOrderFromKa(number,"shipped",null) is reachable).
    // With the old scope such an order dropped out of Pengiriman Massal the instant it flipped to
    // `dikirim` — and this is the ONLY screen carrying "Ambil resi" and bulk "Cetak resi", so the
    // seller was left with an order marked Dikirim, no resi, no label and no way to fetch one.
    // No AWB = unfinished work = still in the queue. It leaves the moment a real resi lands.
    // Terminal statuses (selesai/batal/retur) stay out regardless — nothing left to print there.
    //
    // `ka_order_id is not null` is part of the condition, not decoration: it means the parcel was
    // actually BOOKED through KiriminAja and a waybill is genuinely pending. An order shipped outside
    // the aggregator has no resi coming, and the screen's own gate is `canFetch = kaOrderId && !awb`,
    // so listing it would add a row with every button disabled — noise that teaches sellers to ignore
    // this queue. Without this clause the demo seed (which books nothing) dumped all 39 `dikirim`
    // orders in here and the screen looked broken.
    const scope = sql`(o.status in ('baru','diproses') or (o.status = 'dikirim' and o.awb is null and o.ka_order_id is not null)) and (o.financial_status = 'dibayar' or exists (select 1 from payments p where p.order_id = o.id and p.method = 'cod'))`;

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
