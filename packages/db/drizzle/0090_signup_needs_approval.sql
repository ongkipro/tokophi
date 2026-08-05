-- Self-serve signup lands in a REVIEW QUEUE, not in a live store.
--
-- `suspended_at` alone cannot say WHY a store is locked, and the two reasons need opposite words:
-- a store held because nobody has vetted it yet is not a store punished for abuse. The merchant is
-- shown `suspended_reason` verbatim, so without a second fact the first thing a person sees after
-- signing up is "Toko ditangguhkan oleh TokoΦ".
--
-- `approved_at IS NULL AND suspended_at IS NOT NULL` = waiting for a first review. Every store that
-- already exists is backfilled to its creation time: they were onboarded by an operator through
-- Super Admin (or predate the queue entirely), so they have effectively been approved — leaving
-- them NULL would put live shops into a queue they never belonged in, and any that are suspended
-- would start reading "menunggu persetujuan" to their owners.
--
-- Idempotent on purpose (AGENTS.md): drizzle applies the pending batch in ONE transaction, so a
-- single "already exists" rolls back every migration behind it.
alter table "stores" add column if not exists "approved_at" timestamp;

update "stores" set "approved_at" = coalesce("created_at", now()) where "approved_at" is null;

comment on column "stores"."approved_at" is
  'When a human first cleared this store to operate. NULL + suspended_at set = self-serve signup awaiting review. Set by super-admin approveStore; never cleared.';
