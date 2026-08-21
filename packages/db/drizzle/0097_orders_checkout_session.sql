-- Task 4.8 — ONE ORDER PER CHECKOUT SESSION, ENFORCED BY THE DATABASE.
--
-- `/api/public/order` already refused a resubmitted checkout, but it refused it with a PREFLIGHT
-- READ (checkout_sessions.recovered_order_id joined to orders) taken before the write transaction
-- opens. Two submissions racing -- a double tap, a retried request, a flaky connection the browser
-- retries on the shopper's behalf -- both read "no order yet", both pass, and both write. The
-- shopper is billed twice and the stock is decremented twice. A read is advisory; a constraint is
-- the rule.
--
-- PARTIAL, on purpose: checkout_session_id is NULL for every order that did not come from a
-- storefront checkout session (the seed's orders, an order placed where the session beacon never
-- ran), and NULLs must not collide with one another. TEXT because the identifier is the
-- storefront's checkout_sessions.session_id STRING, not that row's uuid -- the API receives the
-- former and never sees the latter.
--
-- Idempotent, like every migration here: drizzle applies the whole pending batch in ONE
-- transaction, so a single "already exists" rolls back every migration behind it and prints
-- nothing anyone reads.
alter table "orders" add column if not exists "checkout_session_id" text;

create unique index if not exists "orders_one_per_checkout_session"
  on "orders" ("store_id", "checkout_session_id")
  where "checkout_session_id" is not null;
