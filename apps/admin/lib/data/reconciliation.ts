import "server-only";
import { sql } from "drizzle-orm";
import { withCurrentTenant } from "@/lib/tenant";
import type { Tx } from "@/lib/tenant";
import { latestPaymentFirst } from "@/lib/data/order-payment";

export type ReconciliationMismatch = {
  orderNumber: string;
  orderPayable: number;
  paymentTotal: number;
  expectedGatewayFee: number;
  actualGatewayFee: number;
  expectedLedger: number;
  ledgerNet: number;
};

/**
 * Authorized, tenant-scoped orders whose immutable allocation, the bill we issued, or the ledger disagrees.
 *
 * Task 8.25 (a): the platform SETS the gateway fee (`order_financials.expected_gateway_fee_idr`) and
 * submits `buyerPayable` (= order payable + that fee) to the PSP as the grand total, so
 * `payments.admin_fee` / `payments.total` are our own figures written at checkout — never the
 * provider's arithmetic. A mismatch here therefore means OUR write path disagreed with itself
 * (a re-bill that dropped the fee, a hand-edited row), not that the provider priced the fee
 * differently. The provider's own fee nets against settlement and is not in this query.
 */
export async function reconciliationMismatchRows(
  db: Tx,
  storeId: string,
  limit = 50,
): Promise<ReconciliationMismatch[]> {
  const rows = (await db.execute(sql`
    with latest_payment as (
      select distinct on (payments.order_id)
             payments.order_id, payments.total, payments.admin_fee
        from payments
       where payments.store_id = ${storeId}
       order by payments.order_id, ${latestPaymentFirst()}
    ), ledger as (
      select l.order_id, sum(l.amount_idr)::bigint as net
        from ledger_entries l
       where l.store_id = ${storeId}
       group by l.order_id
    )
    select o.number as "orderNumber",
           f.order_payable_idr as "orderPayable",
           coalesce(p.total, f.order_payable_idr) as "paymentTotal",
           f.expected_gateway_fee_idr as "expectedGatewayFee",
           coalesce(p.admin_fee, 0) as "actualGatewayFee",
           case when o.status in ('batal', 'retur') then -e.seller_shipping_debit_idr
                else e.seller_entitlement_idr end as "expectedLedger",
           coalesce(l.net, 0) as "ledgerNet"
      from orders o
      join order_financials f on f.order_id = o.id
      join order_seller_entitlements e on e.order_id = o.id
      left join latest_payment p on p.order_id = o.id
      left join ledger l on l.order_id = o.id
     where o.store_id = ${storeId}
       and (
         f.order_payable_idr <> o.total_idr
         or (p.order_id is not null and p.total <> f.order_payable_idr + coalesce(p.admin_fee, 0))
         or (p.order_id is not null and f.expected_gateway_fee_idr <> coalesce(p.admin_fee, 0))
         or (o.financial_status = 'dibayar' and coalesce(l.net, 0) <>
             case when o.status in ('batal', 'retur') then -e.seller_shipping_debit_idr
                  else e.seller_entitlement_idr end)
       )
     order by o.placed_at desc
     limit ${Math.max(1, Math.min(200, Math.floor(limit)))}
  `)) as unknown as Array<Record<string, string | number>>;
  return rows.map((row) => ({
    orderNumber: String(row.orderNumber),
    orderPayable: Number(row.orderPayable),
    paymentTotal: Number(row.paymentTotal),
    expectedGatewayFee: Number(row.expectedGatewayFee),
    actualGatewayFee: Number(row.actualGatewayFee),
    expectedLedger: Number(row.expectedLedger),
    ledgerNet: Number(row.ledgerNet),
  }));
}

export async function getReconciliationMismatches(
  limit = 50,
): Promise<ReconciliationMismatch[]> {
  return withCurrentTenant((db, storeId) =>
    reconciliationMismatchRows(db, storeId, limit),
  );
}
