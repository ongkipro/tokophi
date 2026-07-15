ALTER TABLE "stores" ADD COLUMN "whatsapp" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "tagline" text;
-- No backfill on purpose. Both columns stay NULL, and a NULL store renders NO WhatsApp button and no
-- tagline (apps/storefront/src/data/store.ts) — which is the whole point: a real merchant must set
-- their OWN number, and until they do, no button is more honest than a placeholder that opens a chat
-- with nobody (the platform constant 6281234567890 used to ship as a live button on every store).
-- The LOCAL demo store gets a number from the seed (packages/db/src/seed.ts), not from this migration,
-- so production data is never touched with a made-up number.
