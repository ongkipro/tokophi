-- A CENTROID for every village and district we know (Task 8.14, KiriminAja UAT feedback 2026-09-14).
--
-- `POST /api/mitra/v6.2/request_pickup` marks `latitude`/`longitude` (sender) and
-- `destination_latitude`/`destination_longitude` (each package) REQUIRED; KiriminAja's review of
-- our UAT sheet rejected a payload without them as "still the v6.1 structure". Nothing in this
-- product geocodes a street — a shopper gives a street, a WhatsApp number, a kecamatan and, where
-- the kodepos is ambiguous, a kelurahan — so the honest coordinate for an address is the centroid
-- of the smallest administrative area it is known to be in. That is enough for a REGULAR courier
-- (the vendor's own pricing response says `use_geolocation: false` for SPX/JNE/…); it is NOT a
-- street-level point and must never be presented as one.
--
-- Source: the Kemendagri boundaries dataset (cahyadsn/wilayah_boundaries, MIT), keyed by the SAME
-- codes `kelurahan.id` carries, loaded into the two reference CSVs by scripts/build-area-coords.mjs
-- and seeded by seed-areas.ts on every deploy. A district's centroid is that of the kecamatan its
-- kelurahan rows belong to; a district with no kelurahan rows keeps NULL.
--
-- NULLABLE ON PURPOSE. NULL means "unknown" and every caller then omits the field — a booking is
-- never sent with 0,0 (a real point in the Gulf of Guinea a dispatcher would route on).
-- No index: nothing looks a row up by its coordinates.
--
-- Idempotent (AGENTS.md): drizzle applies the whole pending batch in ONE transaction, so a single
-- "already exists" rolls back every migration behind it while printing "migrations applied
-- successfully".
alter table "kiriminaja_areas" add column if not exists "lat" double precision;--> statement-breakpoint
alter table "kiriminaja_areas" add column if not exists "lng" double precision;--> statement-breakpoint
alter table "kelurahan" add column if not exists "lat" double precision;--> statement-breakpoint
alter table "kelurahan" add column if not exists "lng" double precision;--> statement-breakpoint

comment on column "kiriminaja_areas"."lat" is
  'Centroid latitude of the kecamatan this KiriminAja district maps to (Kemendagri boundaries dataset). Fallback coordinate for a v6.2 booking when no kelurahan is known. NULL = unknown, field omitted; never 0.';--> statement-breakpoint
comment on column "kiriminaja_areas"."lng" is
  'Centroid longitude — see lat.';--> statement-breakpoint
comment on column "kelurahan"."lat" is
  'Village centroid latitude (Kemendagri boundaries dataset, keyed by kelurahan.id). Sent as (destination_)latitude to v6.2/request_pickup. NULL = unknown, fall back to the district centroid, then omit; never 0.';--> statement-breakpoint
comment on column "kelurahan"."lng" is
  'Village centroid longitude — see lat.';
