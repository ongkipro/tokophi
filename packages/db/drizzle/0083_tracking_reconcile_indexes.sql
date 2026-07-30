-- Indexes for the conversion-delivery RECONCILE sweep (cron/tracking-events).
--
-- The sweep answers two questions every tick, across every store:
--   1. which held rows belong to an order that has since been PAID (the payment webhook is the only
--      thing that releases them, and it has no retry, no poll and no manual path); and
--   2. which recent orders have NO delivery row at all (the enqueue runs after the order transaction
--      in a try/catch, so one transient throw loses a COD conversion permanently).
-- Both join deliveries to orders by `order_id` and bound the scan by `placed_at`. Neither column was
-- indexed, so without these the sweep is two sequential scans of the orders table once a minute.
create index if not exists tracking_event_deliveries_order_idx
  on tracking_event_deliveries (order_id);

create index if not exists orders_store_placed_idx
  on orders (store_id, placed_at);
