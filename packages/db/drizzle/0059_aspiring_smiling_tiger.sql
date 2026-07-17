-- The ONLY access pattern on kelurahan: "give me the kelurahan of the district the shopper just
-- picked". 78k rows, read on every checkout — measured on the dev DB: seq scan 25.4ms vs 0.25ms
-- indexed (~100x). The index existed on this machine only because it was created by hand; no
-- registered migration ever built it, so a fresh database shipped the checkout without it.
CREATE INDEX IF NOT EXISTS "kelurahan_district_idx" ON "kelurahan" USING btree ("district_id");

-- NOTE — the generator also emitted ADD COLUMN for orders.service_type, orders.label_printed_at and
-- stores.favicon_url. Those columns already exist: 0053, 0055 and 0057 created them, but the meta
-- snapshots were never regenerated, so drizzle-kit believed they were missing. Replaying them here
-- would fail on a fresh database (0053 adds the column, then this would hit a duplicate). They are
-- dropped from this SQL on purpose; 0059_snapshot.json records the real shape, which is what
-- repairs the drift for the next `generate`.
