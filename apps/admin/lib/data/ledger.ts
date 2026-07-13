import "server-only";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import { sql } from "drizzle-orm";

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
 */

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
};

export async function getPendingFunds(): Promise<PendingFund[]> {
  return withCurrentTenant(async (db: Tx) => {
    const rows = (await db.execute(sql`
      select
        o.id            as "orderId",
        o.number        as "number",
        l.amount_idr    as "amount",
        o.status::text  as "status",
        o.placed_at     as "placedAt",
        exists (select 1 from payments p where p.order_id = o.id and p.method = 'cod') as "isCod"
      from ledger_entries l
      join orders o on o.id = l.order_id
      where l.status = 'pending' and l.kind = 'sale'
      order by o.placed_at desc
    `)) as unknown as PendingFund[];
    return rows.map((r) => ({ ...r, amount: Number(r.amount), placedAt: new Date(r.placedAt) }));
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
};

export async function getMovements(limit = 50): Promise<Movement[]> {
  return withCurrentTenant(async (db: Tx) => {
    const rows = (await db.execute(sql`
      select l.id, l.kind::text as "kind", l.status::text as "status", l.amount_idr as "amount",
             l.note, l.created_at as "createdAt", o.number as "orderNumber"
      from ledger_entries l
      left join orders o on o.id = l.order_id
      order by l.created_at desc
      limit ${limit}
    `)) as unknown as Movement[];
    return rows.map((r) => ({ ...r, amount: Number(r.amount), createdAt: new Date(r.createdAt) }));
  });
}

export type PayoutRow = {
  id: string;
  amount: number;
  status: string;
  bankName: string | null;
  bankAccount: string | null;
  requestedAt: Date;
  paidAt: Date | null;
};

export async function getPayouts(): Promise<PayoutRow[]> {
  return withCurrentTenant(async (db: Tx) => {
    const rows = (await db.execute(sql`
      select id, amount_idr as "amount", status::text as "status",
             bank_name as "bankName", bank_account as "bankAccount",
             requested_at as "requestedAt", paid_at as "paidAt"
      from payouts order by requested_at desc limit 20
    `)) as unknown as PayoutRow[];
    return rows.map((r) => ({
      ...r,
      amount: Number(r.amount),
      requestedAt: new Date(r.requestedAt),
      paidAt: r.paidAt ? new Date(r.paidAt) : null,
    }));
  });
}

/** The merchant's bank account + the platform's payout policy. */
export type PayoutContext = { bankName: string | null; bankAccount: string | null; bankHolder: string | null; minPayout: number };

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
