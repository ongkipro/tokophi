-- Public shop identity: social handles + the address a shopper is allowed to see.
--
-- ⚠️ `address` here is NOT `store_settings.sender_address`, and the two must never be conflated.
-- `sender_address` is the SHIPPING PICKUP point — it prices ongkir and it is where a courier
-- physically collects the parcel. Two reasons it cannot double as the public address:
--   1. A merchant may ship from a warehouse or a 3PL while their shop is somewhere else entirely.
--   2. Most sellers here start from home. Publishing the pickup address in the storefront footer
--      would put a private home address on every page of a public website, without ever asking.
-- So this is a separate, deliberately-entered, public-facing field. Empty is the normal case.
--
-- Handles are stored WITHOUT the @ and without a URL — just the username. The storefront builds the
-- link; storing a full URL invites a merchant to paste anything (including someone else's profile,
-- or a javascript: scheme) and makes validation a URL-parsing problem instead of a username one.
ALTER TABLE stores ADD COLUMN address text;
ALTER TABLE stores ADD COLUMN phone text;
ALTER TABLE stores ADD COLUMN social_instagram text;
ALTER TABLE stores ADD COLUMN social_tiktok text;
ALTER TABLE stores ADD COLUMN social_facebook text;
ALTER TABLE stores ADD COLUMN social_pinterest text;
ALTER TABLE stores ADD COLUMN social_x text;
