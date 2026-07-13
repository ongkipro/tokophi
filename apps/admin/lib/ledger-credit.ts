import { db as rootDb } from "@tokophi/db";
import { sql } from "drizzle-orm";

/**
 * Saldo — the WRITE side of the book (migration 0041).
 *
 * Migration 0040 built the ledger and nobody ever credited it. `lib/actions/ledger.ts` could
 * withdraw; `lib/actions/orders.ts` could release and claw back — entries that were never created.
 * The book stayed empty, so a merchant's balance read Rp0 no matter how much money came in.
 *
 * THE RULE: a `sale` is booked when the money is actually COLLECTED — that is, when a `payments`
 * row reaches `berhasil`, and nowhere else. Not when the order is placed (the shopper may never
 * pay), not when a bill is created (a VA number is not money), not when the parcel ships.
 *
 * COD is the case worth spelling out. With COD the shopper hands cash to the courier at the door,
 * so at checkout the platform holds NOTHING: the payment row is created `menunggu` and must stay
 * that way. It becomes `berhasil` only when the parcel is delivered — in this product the merchant
 * signals that by moving the order to `selesai` (there is no separate courier "delivered" webhook
 * yet), which is exactly when `collectCodOnDelivery` flips it and this credits it. A refused parcel
 * goes `batal`/`retur` instead, where `setOrderStatus` fails the pending payment — so cash that was
 * never collected is never booked. Crediting COD at checkout or at despatch would credit money
 * nobody is holding.
 *
 * Both entry points below are safe to fire twice: the guarantee is the DB's
 * (`ledger_one_sale_per_payment` / `ledger_one_sale_per_order` partial unique indexes +
 * ON CONFLICT DO NOTHING), never a check-then-write race in the app. Gateway callbacks retry;
 * buttons get double-clicked.
 */
export type Db = typeof rootDb;

/**
 * Book the `sale` for ONE collected payment.
 *
 * `amount_idr` is the payment's `amount_idr` (the order total the merchant is owed), NOT `total` —
 * `total` adds the gateway's admin fee, which is the gateway's money and never was the merchant's.
 * That also keeps the Dashboard revenue, the Pesanan list and the Saldo ledger the same number.
 *
 * Status follows the release rule (`platform_payout.release_on = 'selesai'`): the credit lands
 * `pending` and is released to `available` by `setOrderStatus` when the order reaches `selesai`.
 * A payment collected on an already-finished order (`selesai`/`retur` — e.g. COD collected on
 * delivery, or a backfill) is booked `available` straight away: it has already met the rule.
 */
export async function creditSaleForPayment(db: Db, paymentId: string): Promise<void> {
  await db.execute(sql`
    insert into ledger_entries (store_id, order_id, payment_id, kind, status, amount_idr, note, available_at)
    select coalesce(p.store_id, o.store_id), o.id, p.id, 'sale',
           case when o.status in ('selesai', 'retur') then 'available' else 'pending' end::ledger_status,
           p.amount_idr,
           'Penjualan ' || o.number,
           case when o.status in ('selesai', 'retur') then now() end
      from payments p
      join orders o on o.id = p.order_id
     where p.id = ${paymentId}
       and p.status = 'berhasil'
       -- a cancelled order collected nothing; if money did arrive it is refunded, not credited
       and o.status <> 'batal'
       and not exists (
         select 1 from ledger_entries l
          where l.kind = 'sale' and (l.payment_id = p.id or l.order_id = o.id)
       )
    on conflict do nothing
  `);
}

/**
 * COD: the courier collected the cash at the door. Flip the order's pending COD payment(s) to
 * `berhasil` — the honest moment the money exists — and return their ids so the caller can book
 * them. Idempotent: a payment already `berhasil` is not touched (the `menunggu` guard), and the
 * credit itself is guarded by the unique index anyway.
 */
export async function collectCodOnDelivery(db: Db, orderId: string): Promise<string[]> {
  const rows = (await db.execute(sql`
    update payments
       set status = 'berhasil', paid_at = coalesce(paid_at, now())
     where order_id = ${orderId} and method = 'cod' and status = 'menunggu'
    returning id
  `)) as unknown as { id: string }[];
  return rows.map((r) => r.id);
}

/** Book every already-collected (`berhasil`) payment on an order. */
export async function creditSalesForOrder(db: Db, orderId: string): Promise<void> {
  const rows = (await db.execute(sql`
    select id from payments where order_id = ${orderId} and status = 'berhasil'
  `)) as unknown as { id: string }[];
  for (const r of rows) await creditSaleForPayment(db, r.id);
}

/**
 * The order's money moves with its status — and it moves HERE, called by `setOrderStatus` inside
 * the same transaction as the status change, so the book can never disagree with the order it
 * describes. Call AFTER the order row has been updated.
 *
 * RELEASE on `selesai`, not on `dikirim` (`platform_payout.release_on`): a parcel can only be
 * RETURNED after it shipped, so releasing at despatch would let a merchant withdraw money for goods
 * that come back. For COD the cash does not even exist at despatch.
 */
export async function settleOrderLedger(
  db: Db,
  args: { storeId: string; orderId: string; status: string; prevStatus: string },
): Promise<void> {
  const { storeId, orderId, status, prevStatus } = args;

  if (status === "selesai") {
    // COD: `selesai` is the delivery signal, and delivery is when the courier hands the cash over.
    // That is the honest moment the money exists → the payment becomes `berhasil` and the sale
    // enters the book. A refused parcel goes `batal`/`retur` instead, where the pending payment is
    // failed — cash never collected, never credited.
    await collectCodOnDelivery(db, orderId);
    // Book anything collected on this order that is not in the book yet (the COD cash just now; a
    // prepaid order whose payment landed before the ledger existed). Double-credit is impossible:
    // the unique indexes decide that, not this call site.
    await creditSalesForOrder(db, orderId);

    await db.execute(sql`
      update ledger_entries
         set status = 'available', available_at = now()
       where order_id = ${orderId} and kind = 'sale' and status = 'pending'
    `);
  }

  // A return claws the credit back. Written as an OPPOSING entry, never by editing the sale: the
  // book stays append-only, so it can always be replayed and audited. The partial unique index
  // (ledger_one_retur_per_order) makes a double-click physically unable to double-refund — the
  // guarantee lives in the DB, not in the hope that the UI behaves.
  //
  // The claw-back carries the SAME status as the sale it reverses. A parcel can be returned straight
  // from `dikirim`, where the sale is still `pending` — reversing that out of `available` (as this
  // used to, unconditionally) would drive the withdrawable balance NEGATIVE while the held pool
  // still showed the money. Reverse a pending sale out of pending, a released one out of available;
  // either way the pair nets to zero.
  if (status === "retur" && prevStatus !== "retur") {
    await db.execute(sql`
      insert into ledger_entries (store_id, order_id, kind, status, amount_idr, note, available_at)
      select ${storeId}, ${orderId}, 'retur', l.status, -l.amount_idr,
             'Retur ' || o.number,
             case when l.status = 'available' then now() end
        from ledger_entries l
        join orders o on o.id = l.order_id
       where l.order_id = ${orderId} and l.kind = 'sale'
      on conflict do nothing
    `);
  }
}
