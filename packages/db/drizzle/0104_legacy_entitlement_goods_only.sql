-- Owner report 2026-08-24: "penarikan masih membawa biaya pengiriman". The LEGACY arm (orders with
-- no order_financials) of both the ledger credit and this view included shipping: the ledger fell
-- back to payments.amount_idr (historically goods+shipping) and the view used total−tax. Both now
-- read `greatest(subtotal − discount, 0)` — goods only, the same figure, one rule. The financials
-- arm is unchanged (already goods + added PPN − debit, migration 0102). Idempotent.
CREATE OR REPLACE VIEW "order_seller_entitlements" AS
 SELECT o.id AS order_id,
    o.store_id,
    COALESCE(f.shipping_charged_idr, o.shipping_idr) AS shipping_charged_idr,
    COALESCE(f.goods_proceeds_idr, GREATEST(o.subtotal_idr - o.discount_idr, 0)) AS goods_proceeds_idr,
    COALESCE(b.seller_debit_idr, 0::numeric) AS seller_shipping_debit_idr,
    f.order_id IS NULL AS legacy,
    (CASE WHEN f.order_id IS NULL
          THEN GREATEST(o.subtotal_idr - o.discount_idr, 0)::numeric
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
