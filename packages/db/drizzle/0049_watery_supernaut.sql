ALTER TABLE "stores" ADD COLUMN "whatsapp" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "tagline" text;--> statement-breakpoint
-- Backfill the demo store so the storefront has a REAL number to show. Everyone else stays NULL, and
-- a NULL store renders no WhatsApp button at all — see apps/storefront/src/data/store.ts. That is the
-- point: the platform constant `6281234567890` used to ship as a live "Hubungi via WhatsApp" button on
-- every page of every store, and every one of them opened a chat with nobody.
UPDATE "stores" SET
  "whatsapp" = '6281234500999',
  "tagline"  = 'Busana wanita modern — batik & ready-to-wear'
WHERE "slug" = 'batik-nusantara';
