import "server-only";
import { schema } from "@tokophi/db";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import { eq, sql, type SQL } from "drizzle-orm";
import type { Order } from "@/lib/mock/store";

const TODAY = new Date("2026-07-02T00:00:00Z");
const CHANNEL_DISPLAY: Record<string, string> = {
  meta_ads: "Meta Ads", tiktok_ads: "TikTok Ads", google_ads: "Google Ads", organic: "Organic", other: "Other",
};

const sel = {
  number: schema.orders.number,
  customer: schema.customers.name,
  city: schema.orders.city,
  total: schema.orders.totalIdr,
  status: schema.orders.status,
  channel: schema.orders.channel,
  placedAt: schema.orders.placedAt,
  awb: schema.orders.awb,
  courier: schema.orders.courier,
  items: sql<number>`count(${schema.orderLineItems.id})`.mapWith(Number),
};

// `where` is applied BEFORE groupBy (chaining .where() after .groupBy() lands as HAVING → 0 rows).
function q(db: Tx, where?: SQL) {
  const base = db
    .select(sel)
    .from(schema.orders)
    .leftJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
    .leftJoin(schema.orderLineItems, eq(schema.orderLineItems.orderId, schema.orders.id));
  return (where ? base.where(where) : base).groupBy(schema.orders.id, schema.customers.name);
}

function toOrder(r: {
  number: string; customer: string | null; city: string | null; total: number;
  status: "baru" | "diproses" | "dikirim" | "selesai" | "batal" | "retur"; channel: string; placedAt: Date; items: number;
  awb?: string | null; courier?: string | null;
}): Order {
  return {
    id: "#" + r.number,
    customer: r.customer ?? "—",
    city: r.city ?? "",
    total: r.total,
    items: r.items,
    status: r.status,
    channel: CHANNEL_DISPLAY[r.channel] ?? r.channel,
    minutesAgo: Math.round((TODAY.getTime() - r.placedAt.getTime()) / 60_000),
    awb: r.awb ?? null,
    courierName: r.courier ?? null,
  };
}

export async function getOrders(): Promise<Order[]> {
  return withCurrentTenant(async (db) => {
    const rows = await q(db);
    return rows.map(toOrder).sort((a, b) => a.minutesAgo - b.minutesAgo);
  });
}

export async function getOrder(number: string): Promise<Order | null> {
  return withCurrentTenant(async (db) => {
    const rows = await q(db, eq(schema.orders.number, number)).limit(1);
    return rows[0] ? toOrder(rows[0]) : null;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Pesanan Saya — the Shopee-Seller-Centre-shaped list (server-side filter/search/page).
//
// TABS. Shopee's six tabs mapped onto OUR `order_status` enum + `orders.financial_status`.
// The five non-"Semua" tabs are a strict PARTITION of the table: every order lands in exactly
// one, and they sum to count(*). No order is counted twice, none is missed.
//
//   Belum Bayar   status in (baru, diproses) AND financial_status <> 'dibayar'
//   Perlu Dikirim status in (baru, diproses) AND financial_status  = 'dibayar'
//   Dikirim       status = 'dikirim'
//   Selesai       status = 'selesai'
//   Pengembalian  status in ('batal', 'retur')
//
// Why "Belum Bayar" is NOT simply `payments.status <> 'berhasil'`. Checked against the data:
// that predicate returns 43 orders, and all 43 are `batal` — a cancelled order whose payment
// failed. Not one is an order a seller should be chasing for money; they would be looking at the
// same 43 rows twice, once here and once under Pengembalian/Pembatalan. So the tab is scoped to
// orders that are still LIVE and awaiting dispatch (`baru`/`diproses`) and unpaid — which today is
// genuinely 0, because in this store every live order arrived already paid (all 685 payments are
// `transfer`, 642 `berhasil` / 43 `gagal`, and every `gagal` one belongs to a cancelled order).
// The empty state says exactly that instead of pretending the tab is broken.
//
// `financial_status` is used as the paid flag rather than joining `payments`: it is the
// authoritative column and agrees with `payments` on every row in this tenant (43 `pending` orders
// ⇔ 43 `gagal` payments). Keeping Belum Bayar to pre-dispatch orders also means a shipped COD
// parcel (unpaid until delivery, by definition) will not surface here as if it were a chase.
//
// NOT BUILT: "Batas Waktu Pengiriman" (Shopee's dispatch-SLA countdown). There is no promised
// dispatch date anywhere in the schema — no SLA column, no fulfilment deadline, nothing to
// subtract from. A countdown here would be a number we invented. The column is omitted and the
// screen says so out loud.
// ─────────────────────────────────────────────────────────────────────────────

// The types + label tables are client-safe and live in `components/admin/pesanan/order-list-types.ts`
// (this module is `server-only`; a "use client" file cannot import from it). Re-exported so server
// callers keep a single import.
export type {
  OrderTab, OrderSearchField, OrderListLine, OrderListRow, OrderTabCounts, OrderListResult,
} from "@/components/admin/pesanan/order-list-types";
export {
  ORDER_TABS, ORDER_SEARCH_FIELDS, PAYMENT_METHOD_LABEL,
} from "@/components/admin/pesanan/order-list-types";

import type {
  OrderTab, OrderSearchField, OrderTabCounts, OrderListResult,
} from "@/components/admin/pesanan/order-list-types";
import { PAYMENT_METHOD_LABEL } from "@/components/admin/pesanan/order-list-types";

export type OrderListParams = {
  tab?: OrderTab;
  field?: OrderSearchField;
  q?: string;
  courier?: string;
  method?: string;
  page?: number;
  pageSize?: number;
};

// A COD order is "ready to ship" the moment it is placed — the cash is collected on delivery, not
// before — so it belongs in Perlu Dikirim, not Belum Bayar, even though financial_status is still
// pending until delivery. Without this carve-out COD orders (the dominant channel) never appeared in
// the shipping queue at all. Identified by the COD payment row.
const IS_COD = sql`exists (select 1 from payments p where p.order_id = o.id and p.method = 'cod')`;

const TAB_WHERE: Record<OrderTab, SQL | null> = {
  semua: null,
  belum_bayar: sql`o.status in ('baru','diproses') and o.financial_status <> 'dibayar' and not ${IS_COD}`,
  perlu_dikirim: sql`o.status in ('baru','diproses') and (o.financial_status = 'dibayar' or ${IS_COD})`,
  dikirim: sql`o.status = 'dikirim'`,
  selesai: sql`o.status = 'selesai'`,
  pengembalian: sql`o.status in ('batal','retur')`,
};

const whereOf = (conds: SQL[]): SQL =>
  conds.length ? sql`where ${sql.join(conds, sql` and `)}` : sql.empty();

// Search/courier/method — everything EXCEPT the tab. Shared by the count pass and the row pass so
// the tab badges can never disagree with the table under them.
function filterConds(p: OrderListParams): SQL[] {
  const conds: SQL[] = [];
  const term = p.q?.trim();
  if (term) {
    const like = `%${term}%`;
    switch (p.field ?? "no") {
      case "pembeli":
        conds.push(sql`coalesce(nullif(o.ship_recipient,''), c.name, '') ilike ${like}`);
        break;
      case "produk":
        conds.push(sql`exists (select 1 from order_line_items li where li.order_id = o.id and li.title ilike ${like})`);
        break;
      case "resi":
        conds.push(sql`coalesce(o.awb,'') ilike ${like}`);
        break;
      default:
        conds.push(sql`o.number ilike ${like}`);
    }
  }
  if (p.courier) conds.push(sql`o.courier = ${p.courier}`);
  if (p.method) {
    conds.push(sql`exists (select 1 from payments p where p.order_id = o.id and p.method = ${p.method}::payment_method)`);
  }
  return conds;
}

export async function getOrderList(params: OrderListParams = {}): Promise<OrderListResult> {
  const tab: OrderTab = params.tab && TAB_WHERE[params.tab] !== undefined ? params.tab : "semua";
  const pageSize = params.pageSize ?? 10;
  const conds = filterConds(params);
  const where = whereOf(conds);                                        // counts: filters only, no tab
  const tabWhere = TAB_WHERE[tab];
  const rowWhere = whereOf(tabWhere ? [...conds, tabWhere] : conds);   // rows: filters + active tab

  return withCurrentTenant(async (db) => {
    // 1) tab counts — a single grouped pass over the filtered set (count(*), never an estimate)
    const [countRow] = (await db.execute(sql`
      select
        count(*)::int                                                                                          as "semua",
        count(*) filter (where o.status in ('baru','diproses') and o.financial_status <> 'dibayar' and not ${IS_COD})::int as "belum_bayar",
        count(*) filter (where o.status in ('baru','diproses') and (o.financial_status = 'dibayar' or ${IS_COD}))::int    as "perlu_dikirim",
        count(*) filter (where o.status = 'dikirim')::int                                                      as "dikirim",
        count(*) filter (where o.status = 'selesai')::int                                                      as "selesai",
        count(*) filter (where o.status in ('batal','retur'))::int                                             as "pengembalian"
      from orders o
      left join customers c on c.id = o.customer_id
      ${where}
    `)) as unknown as OrderTabCounts[];

    const counts: OrderTabCounts = {
      semua: Number(countRow?.semua ?? 0),
      belum_bayar: Number(countRow?.belum_bayar ?? 0),
      perlu_dikirim: Number(countRow?.perlu_dikirim ?? 0),
      dikirim: Number(countRow?.dikirim ?? 0),
      selesai: Number(countRow?.selesai ?? 0),
      pengembalian: Number(countRow?.pengembalian ?? 0),
    };

    const total = counts[tab];
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, params.page ?? 1), pageCount);
    const offset = (page - 1) * pageSize;

    // 2) the page of orders
    const orderRows = (await db.execute(sql`
      select
        o.id::text                                              as "id",
        o.number                                                as "number",
        coalesce(nullif(o.ship_recipient,''), c.name, '—')      as "buyer",
        coalesce(o.city,'')                                     as "city",
        o.ship_address                                          as "address",
        o.total_idr::bigint                                     as "total",
        o.status::text                                          as "status",
        (o.financial_status = 'dibayar')                        as "paid",
        o.courier                                               as "courier",
        o.awb                                                   as "awb",
        (o.problem_at is not null)                              as "problem",
        o.problem_note                                          as "problemNote",
        o.placed_at                                             as "placedAt",
        (select p.method::text from payments p where p.order_id = o.id
         order by p.paid_at desc nulls last limit 1)            as "paymentMethod"
      from orders o
      left join customers c on c.id = o.customer_id
      ${rowWhere}
      order by o.placed_at desc
      limit ${pageSize} offset ${offset}
    `)) as unknown as {
      id: string; number: string; buyer: string; city: string; address: string | null;
      total: string | number; status: Order["status"]; paid: boolean; courier: string | null;
      awb: string | null; problem: boolean; problemNote: string | null;
      placedAt: Date; paymentMethod: string | null;
    }[];

    // 3) their line items (product-led row: photo + name + variant + qty)
    const ids = orderRows.map((r) => r.id);
    const lineRows = ids.length
      ? ((await db.execute(sql`
          select
            li.order_id::text                                   as "orderId",
            li.title                                            as "title",
            li.qty::int                                         as "qty",
            pv.title                                            as "variant",
            p.emoji                                             as "emoji",
            coalesce(
              (select pm.url from product_media pm where pm.product_id = p.id order by pm.position limit 1),
              case when p.handle is null then null else '/products/' || p.handle || '.webp' end
            )                                                   as "image"
          from order_line_items li
          left join product_variants pv on pv.id = li.variant_id
          left join products p on p.id = pv.product_id
          where li.order_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
          order by li.order_id, li.title
        `)) as unknown as {
          orderId: string; title: string; qty: number; variant: string | null; emoji: string | null; image: string | null;
        }[])
      : [];

    const byOrder = new Map<string, typeof lineRows>();
    for (const l of lineRows) {
      const arr = byOrder.get(l.orderId) ?? [];
      arr.push(l);
      byOrder.set(l.orderId, arr);
    }

    // 4) filter options — built from what the DB actually holds, never a hardcoded vendor list.
    const courierRows = (await db.execute(sql`
      select distinct o.courier as "courier" from orders o
      where o.courier is not null and o.courier <> '' order by 1
    `)) as unknown as { courier: string }[];

    // Real per-method order counts. COD is always offered (it is the filter merchants ask for
    // first) even at zero — a truthful "COD 0" beats hiding the option, and `payments.method`
    // has no COD row yet because nothing books COD.
    const methodRows = (await db.execute(sql`
      select p.method::text as "value", count(distinct p.order_id)::int as "count"
      from payments p join orders o on o.id = p.order_id
      group by 1 order by 2 desc
    `)) as unknown as { value: string; count: number }[];
    const methods = methodRows.map((m) => ({
      value: m.value,
      label: PAYMENT_METHOD_LABEL[m.value] ?? m.value,
      count: Number(m.count),
    }));
    if (!methods.some((m) => m.value === "cod")) {
      methods.push({ value: "cod", label: PAYMENT_METHOD_LABEL.cod, count: 0 });
    }

    return {
      rows: orderRows.map((r) => {
        const lines = byOrder.get(r.id) ?? [];
        return {
          id: "#" + r.number,
          number: r.number,
          buyer: r.buyer,
          city: r.city,
          address: r.address,
          total: Number(r.total),
          paymentMethod: r.paymentMethod,
          paid: Boolean(r.paid),
          status: r.status,
          courier: r.courier,
          awb: r.awb,
          problem: Boolean(r.problem),
          problemNote: r.problemNote,
          minutesAgo: Math.round((TODAY.getTime() - new Date(r.placedAt).getTime()) / 60_000),
          lines: lines.slice(0, 2).map((l) => ({
            title: l.title,
            variant: l.variant,
            qty: Number(l.qty),
            image: l.image,
            emoji: l.emoji,
          })),
          lineCount: lines.length,
          totalQty: lines.reduce((s, l) => s + Number(l.qty), 0),
        };
      }),
      counts,
      total,
      page,
      pageCount,
      pageSize,
      couriers: courierRows.map((c) => c.courier),
      methods,
    };
  });
}

/**
 * The sidebar's Pesanan badge: orders the seller must ACT on right now.
 *
 * Deliberately the SAME predicate as the `perlu_dikirim` tab (`TAB_WHERE` above) — paid, not yet
 * shipped — so the badge and the list it links to can never disagree. Before this it was the literal
 * string `badge: "7"` in `lib/nav.ts`: a number that had never counted anything and was wrong for
 * every store on the platform, forever.
 *
 * Why "paid + unshipped" and not every unprocessed order: `status in ('baru','diproses')` also
 * contains the UNPAID ones (the `belum_bayar` tab), and those are not the seller's move — they are
 * waiting on the buyer. A badge that counts work you cannot do is a badge that teaches people to
 * ignore badges.
 */
export async function getPerluDikirimCount(): Promise<number> {
  return withCurrentTenant(async (db) => {
    const [row] = (await db.execute(sql`
      select count(*)::int as n
      from orders o
      where o.status in ('baru','diproses') and (o.financial_status = 'dibayar' or ${IS_COD})
    `)) as unknown as { n: number }[];
    return row?.n ?? 0;
  });
}
