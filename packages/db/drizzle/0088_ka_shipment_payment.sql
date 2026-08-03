-- The courier's OWN bill: who settles it, and whether they have.
--
-- One KiriminAja booking call carries TWO money flows that run in opposite directions, and the
-- response fields that tell them apart were parsed and thrown away for both:
--
--   · NON-COD — WE owe KiriminAja the shipping cost. `payment_method` defaults to `va`, so the
--     booking answers with `payment_status` (unpaid | pending | paid) and, while unpaid, a `qr_url`
--     to settle it. **An unpaid booking never gets a waybill.** The parcel does not ship, the
--     tracking poller keeps finding nothing, and the order reads "dibooking" on every screen with
--     nothing anywhere saying why. That silence is the defect these columns close.
--   · COD — KiriminAja collects from the BUYER and settles to the merchant. The vendor documents
--     that `payment_method` is IGNORED for COD packages and rejects the combination with code 4003,
--     so there is no VA for us to pay and an "unpaid" reading would be noise, not a debt.
--
-- `ka_pickup_number` is the vendor's `pickup_number`, which its own docs also call the **payment
-- id** — the handle the Payment API takes to ask "has this shipment been paid for?". We received it
-- on every booking since the integration shipped and persisted it nowhere, so no booking could be
-- reconciled against its payment and a merchant had nothing to quote to support.
--
-- The columns hold what the vendor returned, VERBATIM and uninterpreted. Which flow an order is on
-- is NOT re-derived from them: `apps/admin/lib/shipment-payment.ts` is the one place that separates
-- COD from VA, and it decides from the order's own COD flag (`payments.method = 'cod'`) — the same
-- expression lib/cod.ts and the Pesanan tabs partition on. NULL means "we have no reading", which
-- is every booking made before this migration; it does not mean unpaid.
--
-- Idempotent (see CLAUDE.md): drizzle applies the whole pending batch in ONE transaction, so a bare
-- `add column` that already exists rolls back every migration behind it — silently, while printing
-- "migrations applied successfully".
-- `ka_shipping_cost_idr` is the COST side of ongkir, which the database has never held. Distinct
-- from `orders.shipping_idr` = what the SHOPPER paid: the seller may book a different or cheaper
-- service than the shopper picked, and nothing recorded the difference. Storing it moves no money.
-- It is the prerequisite BACKLOG.md already names ("we only have the first half until the booking
-- flow records what KiriminAja charged") for computing a real ongkir margin — and for modelling
-- what KiriminAja nets out of a COD remittance before it reaches the merchant.
alter table "orders" add column if not exists "ka_pickup_number" text;
alter table "orders" add column if not exists "ka_payment_status" text;
alter table "orders" add column if not exists "ka_payment_url" text;
alter table "orders" add column if not exists "ka_shipping_cost_idr" bigint;
