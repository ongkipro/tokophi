-- LEGACY LEDGER CORRECTION (owner report 2026-08-24: "penarikan masih membawa biaya pengiriman").
-- Legacy sale entries (orders with no order_financials) were credited from payments.amount_idr,
-- which contained shipping. This rewrites them to goods only — greatest(subtotal − discount, 0),
-- the SAME expression the credit path and the order_seller_entitlements view use since 0104 —
-- and moves each order's retur claw-back mirror in lockstep so reversed orders stay netted at 0.
--
-- ⚠️ Ends in ROLLBACK on purpose (same standing as ops/tokophi-orphan-cleanup.sql): read the
-- BEFORE/AFTER prints, then re-run with COMMIT. Payout rows (order_id IS NULL) and
-- shipping-order-debit adjustments are untouched by construction.
begin;

select 'BEFORE' as t, l.kind, count(*), sum(l.amount_idr)::bigint
  from ledger_entries l
  join orders o on o.id = l.order_id
  left join order_financials f on f.order_id = o.id
 where f.order_id is null and l.kind in ('sale','retur')
 group by l.kind;

update ledger_entries l
   set amount_idr = greatest(o.subtotal_idr - o.discount_idr, 0)
  from orders o
  left join order_financials f on f.order_id = o.id
 where l.order_id = o.id and f.order_id is null and l.kind = 'sale'
   and l.amount_idr <> greatest(o.subtotal_idr - o.discount_idr, 0);

-- the claw-back mirrors: one opposing 'retur' row per reversed sale (ledger_one_retur_per_order);
-- courier-debit preservations live under kind='adjustment' and are not matched here.
update ledger_entries l
   set amount_idr = -greatest(o.subtotal_idr - o.discount_idr, 0)
  from orders o
  left join order_financials f on f.order_id = o.id
 where l.order_id = o.id and f.order_id is null and l.kind = 'retur' and l.amount_idr < 0
   and l.amount_idr <> -greatest(o.subtotal_idr - o.discount_idr, 0);

select 'AFTER' as t, l.kind, count(*), sum(l.amount_idr)::bigint
  from ledger_entries l
  join orders o on o.id = l.order_id
  left join order_financials f on f.order_id = o.id
 where f.order_id is null and l.kind in ('sale','retur')
 group by l.kind;

select 'BALANCE' as t, s.slug, l.status::text,
       sum(l.amount_idr)::bigint
  from ledger_entries l join stores s on s.id = l.store_id
 group by s.slug, l.status order by s.slug, l.status;

rollback; -- flip to COMMIT deliberately after reading the prints
