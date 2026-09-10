-- The DESTINATION subdistrict on the order, in both id spaces (Task 8.17, destination half).
--
-- 0107 gave `kelurahan` KiriminAja's own subdistrict id and wired the SENDER side: the Seller's
-- pickup form stores `store_settings.sender_kelurahan_id` and the booking sends `kelurahan_id`.
-- The destination half had no producer at all — the checkout already collects a kelurahan (it is
-- how the kodepos is derived) and posts it, and `/api/public/order` threw it away.
--
-- TWO COLUMNS, BECAUSE THEY ARE TWO DIFFERENT FACTS:
--   `ship_kelurahan_name`  the NAME the shopper picked, snapshotted onto the order for exactly the
--                        reason the street is (0042): the address belongs to the transaction, not
--                        to the person. A buyer who moves house must not move their past orders.
--   `ship_kelurahan_id`    KiriminAja's OWN id, re-derived server-side against `ship_district_id`,
--                        never taken from the request. It is what `v6.2/request_pickup` accepts as
--                        `destination_kelurahan_id`. NEVER the Kemendagri code `kelurahan.id`.
--
-- ⚠️ NULL IS THE COMMON CASE AND IT IS NOT A DEFECT TO CLOSE IN THE CHECKOUT. The kelurahan picker
-- is shown only where it changes the answer: 5 520 of 6 735 districts (82,0%) have exactly ONE
-- postcode across every village in them, so the kodepos is filled from the district alone and the
-- shopper is never asked which village. Adding a required choice to an Indonesian checkout to win
-- a field the courier already books without is the trade this repo refuses everywhere else. NULL
-- means "not asked", and the booking omits the field exactly as it always has.
--
-- ⚠️ THIS MIGRATION ADOPTS TWO COLUMNS THAT ALREADY EXIST ON THE SHARED DEV CONTAINER AND NOWHERE
-- ELSE. `orders.ship_kelurahan_id` and `orders.ship_kelurahan_name` arrived there from
-- `0049_shipping_kelurahan`, which lost its slot to a second `0049` (`0049_watery_supernaut`) and
-- was never re-numbered — so they are in no `.sql`, in no `schema.ts` on any branch, and NOT on
-- production (verified 2026-08-03; `seed-recent.ts` carries the same warning). Measured on the dev
-- container 2026-09-10: `integer` nullable and `text` nullable, i.e. EXACTLY the shapes below. The
-- names here match theirs deliberately, so this migration converges the two databases instead of
-- leaving dev with a near-duplicate third column; `if not exists` then makes it a no-op there and a
-- real create everywhere else. An unreproducible artefact becomes a tracked migration.
--
-- No index: nothing looks an order up by either column — they are carried to the booking and
-- printed, never searched.
--
-- Idempotent (AGENTS.md): drizzle applies the whole pending batch in ONE transaction, so a single
-- "already exists" rolls back every migration behind it while printing "migrations applied
-- successfully".
alter table "orders" add column if not exists "ship_kelurahan_name" text;--> statement-breakpoint
alter table "orders" add column if not exists "ship_kelurahan_id" integer;--> statement-breakpoint

comment on column "orders"."ship_kelurahan_name" is
  'Destination subdistrict NAME as the shopper picked it, snapshotted onto the order. NULL when the checkout never asked (the district had a single postcode).';--> statement-breakpoint
comment on column "orders"."ship_kelurahan_id" is
  'KiriminAja subdistrict id for the destination, re-derived server-side against ship_district_id and never taken from the request. Sent as destination_kelurahan_id to v6.2/request_pickup. NULL = unknown or not asked, and the field is then omitted. Never the Kemendagri code kelurahan.id.';
