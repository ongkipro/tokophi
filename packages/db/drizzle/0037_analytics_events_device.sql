-- /analitik rendered a conversion funnel, a device split, regional sales and a new-vs-returning
-- ring from HARDCODED constants in apps/admin/lib/mock/store.ts — identical for every store, and
-- presented as the merchant's own numbers. Everything else on the page was a real DB read, which
-- made the fiction harder to spot.
--
-- The funnel + device breakdown are the two that cannot be derived from orders alone: they need
-- storefront events. `analytics_events` already existed (with RLS) but was an empty shell — 0 rows
-- and no writer. It also had no `device`, so a device split was impossible even in principle.
--
-- Add it, and let the seed populate the table so the dashboard COUNTS rows instead of quoting
-- constants. The real storefront tracking script that will write here lives in BACKLOG P1.8.
ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "device" text;--> statement-breakpoint

-- The funnel/device queries scan by (store_id, ts) and group by type/device.
CREATE INDEX IF NOT EXISTS "analytics_events_store_ts_idx" ON "analytics_events" ("store_id", "ts");
