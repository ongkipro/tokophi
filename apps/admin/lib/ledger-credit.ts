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
 * New orders credit the immutable `order_financials.goods_proceeds_idr` PLUS the goods PPN that was
 * ADDED on top (owner ruling 2026-08-24: the seller receives goods omset + goods PPN — they remit
 * the tax; shipping and payment-admin fees are platform money). The added tax is derived from
 * stored facts, never recomputed: `orders.tax_idr` is the liability, `included_sales_tax_idr` the
 * portion already inside the sticker price, so `tax_idr − included` is exactly the exclusive-mode
 * PPN line the buyer paid on top. Inclusive-mode stores need no add-back — their proceeds already
 * carry the tax. Never shipping, gateway fee, COD fee, or fee VAT. Legacy orders have no
 * trustworthy goods/shipping discount split, so their historical `payments.amount_idr` behavior
 * remains unchanged rather than fabricating a backfill.
 *
 * Status follows the release rule (`platform_payout.release_on = 'selesai'`): the credit lands
 * `pending` and is released to `available` by `setOrderStatus` when the order reaches `selesai`.
 * A payment collected on an already-finished order (`selesai`/`retur` — e.g. COD collected on
 * delivery, or a backfill) is booked `available` straight away: it has already met the rule.
 */
export async function creditSaleForPayment(
  db: Db,
  paymentId: string,
): Promise<void> {
  await db.execute(sql`
    insert into ledger_entries (store_id, order_id, payment_id, kind, status, amount_idr, note, available_at)
    select coalesce(p.store_id, o.store_id), o.id, p.id, 'sale',
           case when o.status in ('selesai', 'retur') then 'available' else 'pending' end::ledger_status,
           coalesce(f.goods_proceeds_idr + greatest(coalesce(o.tax_idr, 0) - f.included_sales_tax_idr, 0), p.amount_idr),
           'Penjualan ' || o.number,
           case when o.status in ('selesai', 'retur') then now() end
      from payments p
      join orders o on o.id = p.order_id
      left join order_financials f on f.order_id = o.id
     where p.id = ${paymentId}
       and p.status = 'berhasil'
       -- A cancelled OR RETURNED order collected nothing; money that still arrives is refunded, not
       -- credited. 'retur' was missing, and it is the worse of the two: the claw-back has ALREADY run
       -- by then (it found no sale to reverse and inserted nothing), the order is terminal so nothing
       -- re-runs it, and the status->status mapping books a late payment on a returned order as
       -- IMMEDIATELY WITHDRAWABLE. Stock restored and the merchant keeps the money.
       -- Reachable because pay/callback transitions on "status differs", so a failed payment on a
       -- still-live VA can reach 'berhasil' long after the return.
       and o.status not in ('batal', 'retur')
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
export async function collectCodOnDelivery(
  db: Db,
  orderId: string,
): Promise<string[]> {
  const rows = (await db.execute(sql`
    update payments
       set status = 'berhasil', paid_at = coalesce(paid_at, now())
     where order_id = ${orderId} and method = 'cod' and status = 'menunggu'
    returning id
  `)) as unknown as { id: string }[];
  // Cash is now in hand → the order is paid. Mark financial_status so the order list stops showing a
  // delivered COD order as "Belum Bayar". Guarded on the collected payment + not-already-paid, so it
  // is idempotent and never marks a prepaid-but-unpaid order paid by accident.
  await db.execute(sql`
    update orders set financial_status = 'dibayar'
     where id = ${orderId} and financial_status <> 'dibayar'
       and exists (select 1 from payments p where p.order_id = orders.id and p.method = 'cod' and p.status = 'berhasil')
  `);
  return rows.map((r) => r.id);
}

/** Book every already-collected (`berhasil`) payment on an order. */
export async function creditSalesForOrder(
  db: Db,
  orderId: string,
): Promise<void> {
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
  args: {
    storeId: string;
    orderId: string;
    status: string;
    prevStatus: string;
  },
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
  }

  // ── Release: WHEN does a sale become withdrawable? ─────────────────────────
  //
  // `platform_payout.release_on` is the platform's answer, and until now it was a setting that
  // NOTHING READ — the release was hardcoded to `selesai` while migration 0040's own header (mine)
  // claimed the rule was tunable without a deploy. A knob that moves nothing is worse than no knob:
  // an operator flips it, believes the policy changed, and it did not. It is read here now.
  //
  // The default is `selesai`, and it should stay there. Releasing at `dikirim` looks generous and
  // is a trap: a parcel can only be RETURNED after it shipped, so the merchant could withdraw money
  // for goods that come back — and for COD the cash does not exist at despatch at all (the courier
  // collects at the door and settles days later). The super-admin screen says so on the toggle.
  const [pol] = (await db.execute(sql`
    select release_on as "releaseOn" from platform_payout limit 1
  `)) as unknown as { releaseOn: string }[];
  const releaseOn = pol?.releaseOn === "dikirim" ? "dikirim" : "selesai";

  if (status === releaseOn) {
    await db.execute(sql`
      update ledger_entries
         set status = 'available', available_at = now()
       where order_id = ${orderId}
         and status = 'pending'
         and (
           kind = 'sale'
           or (kind = 'adjustment' and component = 'shipping-order-debit')
         )
    `);
  }

  // A return OR a cancellation claws the credit back. Written as an OPPOSING entry, never by editing
  // the sale: the book stays append-only, so it can always be replayed and audited. The partial unique
  // index (ledger_one_retur_per_order) makes a double-click physically unable to double-refund — the
  // guarantee lives in the DB, not in the hope that the UI behaves.
  //
  // `batal` needs this too, not just `retur`: a PREPAID order (AutoLaris) is credited the moment its
  // payment lands, so cancelling it after payment must reverse that credit — otherwise the merchant
  // could withdraw money for an order they refunded. An UNPAID cancel has no `sale` row, so the SELECT
  // finds nothing and inserts nothing (correct). Both reversal kinds are mutually exclusive and
  // terminal, so "one reversal per order" (the retur index) is exactly the right guarantee; only the
  // note differs. The claw-back carries the SAME status as the sale it reverses (pending-out-of-
  // pending, available-out-of-available) so the pair nets to zero without driving a pool negative.
  if ((status === "retur" || status === "batal") && prevStatus !== status) {
    await db.execute(sql`
      insert into ledger_entries (store_id, order_id, kind, status, amount_idr, note, available_at)
      select ${storeId}, ${orderId}, 'retur', l.status, -l.amount_idr,
             (case when ${status} = 'batal' then 'Pembatalan ' else 'Retur ' end) || o.number,
             case when l.status = 'available' then now() end
        from ledger_entries l
        join orders o on o.id = l.order_id
       where l.order_id = ${orderId} and l.kind = 'sale'
      on conflict do nothing
    `);
  }

  // An accepted courier booking stays chargeable when the order is cancelled or returned. Its
  // order-funded debit therefore leaves the pending pool and becomes an available charge; unlike
  // merchandise it is never reversed merely because the parcel/order later failed.
  if (status === "retur" || status === "batal") {
    await db.execute(sql`
      update ledger_entries l
         set status = 'available', available_at = coalesce(available_at, now())
        from shipment_bookings b
       where l.order_id = ${orderId}
         and l.shipment_booking_id = b.id
         and l.kind = 'adjustment'
         and l.component = 'shipping-order-debit'
         and l.status = 'pending'
         and b.status in ('accepted', 'cancellation_requested')
    `);
  }
}
