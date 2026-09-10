-- KiriminAja's OWN subdistrict id, ALONGSIDE the Kemendagri code (Task 8.17).
--
-- `kelurahan.id` is a Kemendagri village code — text, dotted, 13 characters ("34.02.07.2001") —
-- built by scripts/build-kelurahan.mjs from the public wilayah/wilayah_kodepos datasets and joined
-- to KiriminAja's districts BY NAME. It is the key the POSTCODE data is published under, which is
-- the only reason this table exists, so it is NOT overwritten: the two id spaces have to stay
-- distinguishable or the postcode derivation loses its join key.
--
-- v6.2/request_pickup marks `kelurahan_id` and `destination_kelurahan_id` REQUIRED, and the id it
-- wants is the vendor's own: `POST /api/mitra/kelurahan` (kecamatan_id -> results[].id), a small
-- integer (31483 for Bawuran, Pleret, Bantul). Passing a Kemendagri code there would be a WRONG id,
-- which is worse than an absent one — so until this column is filled the fields stay omitted.
--
-- NULLABLE ON PURPOSE, and NULL is the normal state for part of the table: the vendor has no
-- subdistrict rows for some of its own districts, and a name match can legitimately fail. NULL
-- means "we do not know KiriminAja's id" and every caller omits the field rather than guessing.
--
-- No index: nothing looks a row up BY this column (the access pattern is still "give me the
-- kelurahan of the district the shopper picked", which kelurahan_district_idx already serves).
-- An index on a column no predicate names is bloat on 78k reference rows.
--
-- Idempotent (AGENTS.md): drizzle applies the whole pending batch in ONE transaction, so a single
-- "already exists" rolls back every migration behind it while printing "migrations applied
-- successfully".
alter table "kelurahan" add column if not exists "ka_kelurahan_id" integer;--> statement-breakpoint

comment on column "kelurahan"."ka_kelurahan_id" is
  'KiriminAja subdistrict id (POST /api/mitra/kelurahan -> results[].id). The ONLY value that may be sent as kelurahan_id / destination_kelurahan_id to v6.2/request_pickup. NULL = unknown, and the field is then omitted. Never confuse with kelurahan.id, which is a Kemendagri code.';
