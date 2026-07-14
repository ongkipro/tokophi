-- An order must carry the address it was SHIPPED TO, frozen at the moment of purchase.
--
-- It carried only `city`/`province`. The street, recipient and phone were looked up from
-- `customer_addresses` — which lives on the CUSTOMER and changes. So when a buyer moved house,
-- every past order silently moved with them: reprint the label for a parcel shipped last month and
-- it goes to the new address.
--
-- This was not hypothetical. 624 of 685 orders already had a customer address in a DIFFERENT city
-- from the order's own destination. The model was drifting, quietly, with nothing to catch it —
-- and the order detail page papered over the hole by INVENTING a street (`Jl. Merdeka No. …`).
--
-- The address is part of the TRANSACTION, not part of the person. So it is snapshotted here.
--
-- `ship_district_id` is the KiriminAja kecamatan the ongkir was quoted against and the parcel is
-- booked to. It is the authoritative destination: a typed city name is a claim, a district id is
-- what the courier actually acts on (and it is what the COD province gate already trusts).
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ship_recipient" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ship_phone" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ship_address" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ship_postcode" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ship_district_id" integer;--> statement-breakpoint

-- Backfill what can be known HONESTLY, and nothing more.
--
-- recipient + phone come from the customer — those do not move house.
UPDATE "orders" o
   SET "ship_recipient" = c."name",
       "ship_phone"     = c."phone"
  FROM "customers" c
 WHERE c."id" = o."customer_id"
   AND o."ship_recipient" IS NULL;--> statement-breakpoint

-- The STREET is only backfilled where the customer's saved address is in the SAME city as the
-- order's destination. Where they disagree (the 624), we do NOT guess: a wrong street on a parcel
-- is worse than a missing one, and the order detail already tells the merchant to confirm the
-- address with the buyer. Leaving it NULL is the honest answer, and it is visible.
UPDATE "orders" o
   SET "ship_address"  = ca."address",
       "ship_postcode" = ca."postcode"
  FROM "customer_addresses" ca
 WHERE ca."customer_id" = o."customer_id"
   AND ca."city" IS NOT DISTINCT FROM o."city"
   AND o."ship_address" IS NULL;
