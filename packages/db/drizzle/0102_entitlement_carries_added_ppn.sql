-- FIN-02b (owner rulings 2026-08-24): the seller receives GOODS OMSET + GOODS PPN.
-- FIN-01 taught the LEDGER that (creditSaleForPayment books goods_proceeds + (orders.tax_idr −
-- included_sales_tax_idr)); this view — the number every tenant finance screen and the
-- reconciliation compare against — still summed goods_proceeds alone, so an exclusive-PPN store's
-- Keuangan/Penghasilan under-reported by exactly the tax, and reconciliation would flag every such
-- order as a mismatch against a ledger that is correct.
--
-- THE FORMULA MUST MATCH apps/admin/lib/ledger-credit.ts EXACTLY — one truth about someone's money:
--   entitlement = goods_proceeds + greatest(orders.tax_idr − included_sales_tax_idr, 0) − shipping debit
-- Inclusive-mode stores get no add-back (the expression cancels: tax is inside the sticker price and
-- therefore inside goods_proceeds). LEGACY rows (no order_financials) keep their historical
-- expression untouched — there is no trustworthy goods/tax split to improve, and inventing one would
-- move numbers merchants have already reconciled.
-- Idempotent by nature (CREATE OR REPLACE, same column list + one appended column).
CREATE OR REPLACE VIEW "order_seller_entitlements" AS
 SELECT o.id AS order_id,
    o.store_id,
    COALESCE(f.shipping_charged_idr, o.shipping_idr) AS shipping_charged_idr,
    COALESCE(f.goods_proceeds_idr, o.total_idr - o.tax_idr) AS goods_proceeds_idr,
    COALESCE(b.seller_debit_idr, 0::numeric) AS seller_shipping_debit_idr,
    f.order_id IS NULL AS legacy,
    (CASE WHEN f.order_id IS NULL
          THEN (o.total_idr - o.tax_idr)::numeric
          ELSE f.goods_proceeds_idr::numeric
             + GREATEST(COALESCE(o.tax_idr, 0) - f.included_sales_tax_idr, 0)::numeric
     END) - COALESCE(b.seller_debit_idr, 0::numeric) AS seller_entitlement_idr,
    (CASE WHEN f.order_id IS NULL THEN 0
          ELSE GREATEST(COALESCE(o.tax_idr, 0) - f.included_sales_tax_idr, 0)
     END) AS sales_tax_added_idr
   FROM orders o
     LEFT JOIN order_financials f ON f.order_id = o.id
     LEFT JOIN LATERAL ( SELECT sum(shipment_bookings.seller_debit_idr) AS seller_debit_idr
           FROM shipment_bookings
          WHERE shipment_bookings.order_id = o.id AND (shipment_bookings.status = ANY (ARRAY['accepted'::shipment_booking_status, 'cancellation_requested'::shipment_booking_status]))) b ON true;
