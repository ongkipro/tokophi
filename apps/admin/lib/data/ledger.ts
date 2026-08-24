import "server-only";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import { sql, type SQL } from "drizzle-orm";
import {
  LEDGER_STATUS_LABEL,
  PAGE_SIZE,
  type LedgerStatus,
  type SaldoTab,
} from "@/components/admin/saldo/ledger-ui";

/**
 * Saldo — read side.
 *
 * The balance is DERIVED from the ledger, never stored. A stored balance is a number that can
 * silently disagree with the movements that produced it; a derived one cannot.
 *
 *   saldo tersedia    = Σ amount WHERE status = 'available'   (withdrawable)
 *   dana dalam proses = Σ amount WHERE status = 'pending'     (held: order not finished yet)
 *
 * Note what this replaces: the topbar chip used to show `sum(payments)` — Rp18,9jt — as if all of
 * it were the merchant's to take. In truth two thirds of it was still held against unfinished
 * orders. A single sum cannot tell those apart, which is exactly why a ledger exists.
 *
 * PAGING + FILTERING HAPPEN IN SQL. The demo store already carries ~640 ledger entries and a real
 * one will carry tens of thousands; shipping all of them to the browser to slice there would make
 * the page slower every single day it is used. Every list below is `LIMIT/OFFSET` over an ordered
 * query and reports its own `total` via `count(*) over ()`, so the pager knows how many pages
 * exist without a second round trip.
 */

// The client-safe constants live in components/admin/saldo/ledger-ui (see the note there); they are
// re-exported so server callers still have a single import.
export { LEDGER_STATUS_LABEL, PAGE_SIZE };
export type { LedgerStatus, SaldoTab };

export type LedgerFilters = {
  /** inclusive, YYYY-MM-DD */
  from?: string;
  /** inclusive, YYYY-MM-DD */
  to?: string;
  status?: LedgerStatus;
  page?: number;
};

export type Paged<T> = { rows: T[]; total: number; page: number; pageCount: number };

const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** `where` builder shared by every list — a filter that only worked on page 1 would be a lie. */
function whereOf(parts: (SQL | null)[]): SQL {
  const on = parts.filter((p): p is SQL => p !== null);
  return on.length ? sql`where ${sql.join(on, sql` and `)}` : sql``;
}

/**
 * Date bounds, in the seller's day — not the server's.
 *
 * These columns are `timestamptz` (stored UTC) and the UI prints them in WIB. Comparing the bounds
 * in UTC therefore cuts the day at 07:00 WIB: a sale at 30 Jun 23:30 WIB is 30 Jun 16:30 UTC, so
 * "sampai 30 Juni" kept it — but a sale at 1 Jul 06:00 WIB is 30 Jun 23:00 UTC, and it ALSO came
 * back, rendered as "1 Jul" inside a June filter. A ledger that shows July rows in a June export is
 * a ledger a merchant stops trusting, so the boundary is anchored to Asia/Jakarta midnight.
 *
 * `to` is INCLUSIVE: the seller means "sampai 30 Juni", not "up to midnight on the 30th".
 */
const TZ = "Asia/Jakarta";
const gte = (col: SQL, from?: string) =>
  isDate(from) ? sql`${col} >= (${from}::date)::timestamp at time zone ${TZ}` : null;
const lte = (col: SQL, to?: string) =>
  isDate(to) ? sql`${col} < (${to}::date + 1)::timestamp at time zone ${TZ}` : null;

/**
 * Ledger status → SQL. `payout` rows are `status='available'` in the table (the money left the
 * available pool the moment it was spoken for), so "sudah ditarik" is a KIND, not a status —
 * filtering on the raw status column would silently return the wrong rows.
 */
function statusOf(status: LedgerStatus | undefined): SQL | null {
  switch (status) {
    case "proses":
      return sql`l.status = 'pending'`;
    case "belum":
      return sql`l.status = 'available' and l.kind <> 'payout'`;
    case "ditarik":
      return sql`l.kind = 'payout'`;
    default:
      return null;
  }
}

const pageOf = (p: number | undefined) => Math.max(1, Math.floor(p ?? 1));

function paged<T>(rows: (T & { total?: string | number })[], page: number): Paged<T> {
  const total = Number(rows[0]?.total ?? 0);
  const clean = rows.map((r) => {
    const row = { ...r };
    delete row.total; // window-function scaffolding — never crosses into props
    return row as T;
  });
  return { rows: clean, total, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export type Balance = {
  available: number; // withdrawable today
  pending: number; // held against orders that have not reached `selesai`
  withdrawn: number; // paid out to date (absolute value)
  returned: number; // clawed back by returns (absolute value)
};

export async function getBalance(): Promise<Balance> {
  return withCurrentTenant(async (db: Tx) => {
    const rows = (await db.execute(sql`
      select
        coalesce(sum(amount_idr) filter (where status = 'available'), 0)::bigint          as "available",
        coalesce(sum(amount_idr) filter (where status = 'pending'), 0)::bigint            as "pending",
        coalesce(-sum(amount_idr) filter (where kind = 'payout'), 0)::bigint              as "withdrawn",
        coalesce(-sum(amount_idr) filter (where kind = 'retur'), 0)::bigint               as "returned"
      from ledger_entries
    `)) as unknown as Record<keyof Balance, string | number>[];
    const r = rows[0];
    return {
      available: Number(r?.available ?? 0),
      pending: Number(r?.pending ?? 0),
      withdrawn: Number(r?.withdrawn ?? 0),
      returned: Number(r?.returned ?? 0),
    };
  });
}

/** Unfiltered totals — the tab labels must not move when a filter is applied, or they stop being landmarks. */
export type LedgerCounts = { pending: number; movements: number; payouts: number };

export async function getLedgerCounts(): Promise<LedgerCounts> {
  return withCurrentTenant(async (db: Tx) => {
    const rows = (await db.execute(sql`
      select
        count(*) filter (where status = 'pending' and kind = 'sale')::bigint as "pending",
        count(*)::bigint                                                     as "movements",
        (select count(*) from payouts)::bigint                               as "payouts"
      from ledger_entries
    `)) as unknown as Record<keyof LedgerCounts, string | number>[];
    const r = rows[0];
    return {
      pending: Number(r?.pending ?? 0),
      movements: Number(r?.movements ?? 0),
      payouts: Number(r?.payouts ?? 0),
    };
  });
}

/**
 * "Dana dalam proses" — held money, itemised per ORDER so the merchant can see exactly which
 * invoice their money is sitting behind and what has to happen for it to be released. A lump sum
 * ("Rp12,6jt tertahan") tells a seller nothing and reads as the platform sitting on their cash.
 */
export type PendingFund = {
  orderId: string;
  number: string;
  amount: number;
  status: string; // order status — WHY it is still held
  placedAt: Date;
  isCod: boolean;
  customer: string | null;
  city: string | null;
};

export async function getPendingFunds(f: LedgerFilters = {}): Promise<Paged<PendingFund>> {
  const page = pageOf(f.page);
  return withCurrentTenant(async (db: Tx) => {
    const where = whereOf([
      sql`l.status = 'pending'`,
      sql`l.kind = 'sale'`,
      gte(sql`o.placed_at`, f.from),
      lte(sql`o.placed_at`, f.to),
    ]);
    const rows = (await db.execute(sql`
      select
        o.id            as "orderId",
        o.number        as "number",
        l.amount_idr    as "amount",
        o.status::text  as "status",
        o.placed_at     as "placedAt",
        c.name          as "customer",
        o.city          as "city",
        exists (select 1 from payments p where p.order_id = o.id and p.method = 'cod') as "isCod",
        count(*) over ()::bigint as "total"
      from ledger_entries l
      join orders o on o.id = l.order_id
      left join customers c on c.id = o.customer_id
      ${where}
      order by o.placed_at desc, o.number desc
      limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}
    `)) as unknown as (PendingFund & { total: string })[];
    return paged(
      rows.map((r) => ({ ...r, amount: Number(r.amount), placedAt: new Date(r.placedAt) })),
      page,
    );
  });
}

/** Every movement, newest first — the audit trail behind the two numbers above. */
export type Movement = {
  id: string;
  kind: string;
  status: string;
  amount: number; // signed
  note: string | null;
  createdAt: Date;
  orderNumber: string | null;
  orderId: string | null; // the order behind this entry (null for payout/adjustment) → opens the detail
};

export async function getMovements(f: LedgerFilters = {}): Promise<Paged<Movement>> {
  const page = pageOf(f.page);
  return withCurrentTenant(async (db: Tx) => {
    const where = whereOf([
      gte(sql`l.created_at`, f.from),
      lte(sql`l.created_at`, f.to),
      statusOf(f.status),
    ]);
    const rows = (await db.execute(sql`
      select l.id, l.kind::text as "kind", l.status::text as "status", l.amount_idr as "amount",
             l.note, l.created_at as "createdAt", o.number as "orderNumber", o.id as "orderId",
             count(*) over ()::bigint as "total"
      from ledger_entries l
      left join orders o on o.id = l.order_id
      ${where}
      order by l.created_at desc, l.id desc
      limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}
    `)) as unknown as (Movement & { total: string })[];
    return paged(
      rows.map((r) => ({ ...r, amount: Number(r.amount), createdAt: new Date(r.createdAt) })),
      page,
    );
  });
}

export type PayoutRow = {
  id: string;
  amount: number;
  status: string;
  bankName: string | null;
  bankAccount: string | null;
  bankHolder: string | null;
  // Meaning is keyed by status: `gagal` ⇒ the operator's rejection reason, `selesai` ⇒ the bank
  // transfer reference. Both are written by the super-admin payout actions.
  note: string | null;
  requestedAt: Date;
  paidAt: Date | null;
};

export async function getPayouts(f: LedgerFilters = {}): Promise<Paged<PayoutRow>> {
  const page = pageOf(f.page);
  return withCurrentTenant(async (db: Tx) => {
    const where = whereOf([gte(sql`requested_at`, f.from), lte(sql`requested_at`, f.to)]);
    const rows = (await db.execute(sql`
      select id, amount_idr as "amount", status::text as "status",
             bank_name as "bankName", bank_account as "bankAccount", bank_holder as "bankHolder",
             note, requested_at as "requestedAt", paid_at as "paidAt",
             count(*) over ()::bigint as "total"
      from payouts
      ${where}
      order by requested_at desc, id desc
      limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}
    `)) as unknown as (PayoutRow & { total: string })[];
    return paged(
      rows.map((r) => ({
        ...r,
        amount: Number(r.amount),
        requestedAt: new Date(r.requestedAt),
        paidAt: r.paidAt ? new Date(r.paidAt) : null,
      })),
      page,
    );
  });
}

/** The merchant's bank account + the platform's payout policy. */
export type PayoutContext = {
  bankName: string | null;
  bankAccount: string | null;
  bankHolder: string | null;
  minPayout: number;
};

export async function getPayoutContext(): Promise<PayoutContext> {
  return withCurrentTenant(async (db: Tx) => {
    const rows = (await db.execute(sql`
      select s.bank_name as "bankName", s.bank_account as "bankAccount", s.bank_holder as "bankHolder",
             (select min_payout_idr from platform_payout limit 1) as "minPayout"
      from store_settings s limit 1
    `)) as unknown as PayoutContext[];
    const r = rows[0];
    return {
      bankName: r?.bankName ?? null,
      bankAccount: r?.bankAccount ?? null,
      bankHolder: r?.bankHolder ?? null,
      minPayout: Number(r?.minPayout ?? 50_000),
    };
  });
}

/* ────────────────────────────────────────────────────────────────────────────
   Invoice behind the held money.

   "Rp392.000 tertahan di INV-4517" only settles a seller's nerves if they can open it and see the
   buyer, where the parcel is going, and which variants are in the box. That is what decides whether
   they chase the courier or the customer. All of it is real: orders ⋈ customers ⋈ order_line_items
   ⋈ product_variants ⋈ products.

   The existing /pesanan/[id] page does NOT show this — it fabricates its line items from a hash of
   the order id and prints a made-up street ("Jl. Merdeka No. 42"). Linking there would have shown
   the merchant invented variants for a real invoice, so this reads the actual rows instead.
   ──────────────────────────────────────────────────────────────────────────── */

export type InvoiceLine = {
  id: string;
  product: string;
  variant: string | null;
  sku: string | null;
  qty: number;
  price: number;
  total: number;
};

export type InvoiceDetail = {
  orderId: string;
  number: string;
  status: string;
  placedAt: Date;
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  total: number;
  courier: string | null;
  awb: string | null;
  customer: string | null;
  phone: string | null;
  email: string | null;
  /** street address if the buyer has one on file; city/province otherwise */
  address: string | null;
  city: string | null;
  province: string | null;
  postcode: string | null;
  lines: InvoiceLine[];
};

export async function getInvoiceDetail(orderId: string): Promise<InvoiceDetail | null> {
  return withCurrentTenant(async (db: Tx) => {
    const [head] = (await db.execute(sql`
      select
        o.id as "orderId", o.number, o.status::text as "status", o.placed_at as "placedAt",
        o.subtotal_idr as "subtotal", o.discount_idr as "discount", o.shipping_idr as "shipping",
        o.tax_idr as "tax", o.total_idr as "total", o.courier, o.awb,
        c.name as "customer",
        coalesce(a.phone, c.phone) as "phone",
        c.email,
        a.address,
        coalesce(a.city, o.city, c.city)         as "city",
        coalesce(a.province, o.province, c.province) as "province",
        a.postcode
      from orders o
      left join customers c on c.id = o.customer_id
      left join lateral (
        select ca.address, ca.phone, ca.city, ca.province, ca.postcode
        from customer_addresses ca where ca.customer_id = c.id limit 1
      ) a on true
      where o.id = ${orderId}
      limit 1
    `)) as unknown as (Omit<InvoiceDetail, "lines"> & Record<string, unknown>)[];

    if (!head) return null;

    const lines = (await db.execute(sql`
      select li.id, p.title as "product", v.title as "variant", v.sku,
             li.qty, li.price_idr as "price", li.total_idr as "total"
      from order_line_items li
      left join product_variants v on v.id = li.variant_id
      left join products p on p.id = v.product_id
      where li.order_id = ${orderId}
      order by li.title
    `)) as unknown as InvoiceLine[];

    return {
      ...head,
      placedAt: new Date(head.placedAt),
      subtotal: Number(head.subtotal),
      discount: Number(head.discount),
      shipping: Number(head.shipping),
      tax: Number(head.tax),
      total: Number(head.total),
      lines: lines.map((l) => ({
        ...l,
        qty: Number(l.qty),
        price: Number(l.price),
        total: Number(l.total),
        // A line whose product row was hard-deleted still has its historical title on the line item.
        product: l.product ?? "(produk dihapus)",
      })),
    } as InvoiceDetail;
  });
}

/* ────────────────────────────────────────────────────────────────────────────
   CSV export.

   Exports the WHOLE filtered set, not the 20 rows on screen — an export that silently stopped at
   the current page would quietly under-report the seller's money. Columns are the ones an
   Indonesian seller reconciles a bank statement against: Masuk / Keluar as separate columns (a
   single signed column is unusable in a spreadsheet SUM), date, invoice, and status.
   ──────────────────────────────────────────────────────────────────────────── */

export type CsvRow = Record<string, string | number>;
const EXPORT_CAP = 10_000;

// Same reason as the filter bounds: the CSV must date a row in the seller's day, not the server's,
// or a row exported from a June filter lands in the spreadsheet stamped 1 July.
const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const day = (d: Date) => dayFmt.format(d); // YYYY-MM-DD

const KIND_ID: Record<string, string> = {
  sale: "Penjualan",
  retur: "Retur",
  payout: "Penarikan",
  adjustment: "Penyesuaian",
};

export async function getExportRows(tab: SaldoTab, f: LedgerFilters = {}): Promise<CsvRow[]> {
  return withCurrentTenant(async (db: Tx) => {
    if (tab === "proses") {
      const where = whereOf([
        sql`l.status = 'pending'`,
        sql`l.kind = 'sale'`,
        gte(sql`o.placed_at`, f.from),
        lte(sql`o.placed_at`, f.to),
      ]);
      const rows = (await db.execute(sql`
        select o.number, o.placed_at as "placedAt", o.status::text as "status", o.city,
               c.name as "customer", c.phone, l.amount_idr as "amount",
               exists (select 1 from payments p where p.order_id = o.id and p.method = 'cod') as "isCod"
        from ledger_entries l
        join orders o on o.id = l.order_id
        left join customers c on c.id = o.customer_id
        ${where}
        order by o.placed_at desc
        limit ${EXPORT_CAP}
      `)) as unknown as {
        number: string; placedAt: string; status: string; city: string | null;
        customer: string | null; phone: string | null; amount: string; isCod: boolean;
      }[];
      return rows.map((r) => ({
        Tanggal: day(new Date(r.placedAt)),
        Invoice: r.number,
        Pelanggan: r.customer ?? "",
        Telepon: r.phone ?? "",
        Kota: r.city ?? "",
        "Status pesanan": r.status,
        COD: r.isCod ? "Ya" : "Tidak",
        "Jumlah tertahan": Number(r.amount),
      }));
    }

    if (tab === "penarikan") {
      const where = whereOf([gte(sql`requested_at`, f.from), lte(sql`requested_at`, f.to)]);
      const rows = (await db.execute(sql`
        select requested_at as "requestedAt", paid_at as "paidAt", status::text as "status",
               bank_name as "bankName", bank_account as "bankAccount", bank_holder as "bankHolder",
               note, amount_idr as "amount"
        from payouts ${where} order by requested_at desc limit ${EXPORT_CAP}
      `)) as unknown as {
        requestedAt: string; paidAt: string | null; status: string;
        bankName: string | null; bankAccount: string | null; bankHolder: string | null;
        note: string | null; amount: string;
      }[];
      return rows.map((r) => ({
        "Tanggal pengajuan": day(new Date(r.requestedAt)),
        "Tanggal cair": r.paidAt ? day(new Date(r.paidAt)) : "",
        Bank: r.bankName ?? "",
        "No. rekening": r.bankAccount ?? "",
        "Atas nama": r.bankHolder ?? "",
        Status: r.status,
        // Rejection reason (gagal) or bank-transfer reference (selesai) — same rule as PayoutRow.
        Keterangan: r.note ?? "",
        Jumlah: Number(r.amount),
      }));
    }

    const where = whereOf([
      gte(sql`l.created_at`, f.from),
      lte(sql`l.created_at`, f.to),
      statusOf(f.status),
    ]);
    const rows = (await db.execute(sql`
      select l.created_at as "createdAt", l.kind::text as "kind", l.status::text as "status",
             l.amount_idr as "amount", l.note, o.number as "orderNumber"
      from ledger_entries l
      left join orders o on o.id = l.order_id
      ${where}
      order by l.created_at desc, l.id desc
      limit ${EXPORT_CAP}
    `)) as unknown as {
      createdAt: string; kind: string; status: string; amount: string;
      note: string | null; orderNumber: string | null;
    }[];
    return rows.map((r) => {
      const amt = Number(r.amount);
      return {
        Tanggal: day(new Date(r.createdAt)),
        Jenis: KIND_ID[r.kind] ?? r.kind,
        Invoice: r.orderNumber ?? "",
        Keterangan: r.note ?? "",
        Status: r.kind === "payout" ? "Sudah ditarik" : r.status === "pending" ? "Dalam proses" : "Belum ditarik",
        Masuk: amt > 0 ? amt : 0,
        Keluar: amt < 0 ? -amt : 0,
      };
    });
  });
}
