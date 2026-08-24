-- 0101 — platform finance settings (owner ruling 2026-08-24) + invoice tax storage.
-- Idempotent throughout: drizzle applies the pending batch in ONE transaction.

-- Single-row platform finance config. `subscription_ppn_enabled` DEFAULT FALSE is the owner's
-- explicit launch decision ("default off dulu aja untuk next invoice pengguna baru atau berjalan"):
-- from the moment this deploys, newly created subscription invoices bill the flat DPP (Rp275rb)
-- until the toggle is switched on in Super Admin. Already-issued invoices are never rewritten.
CREATE TABLE IF NOT EXISTS "platform_finance" (
  "id" smallint PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  "subscription_ppn_enabled" boolean NOT NULL DEFAULT false,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
INSERT INTO "platform_finance" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

-- Invoices learn to STORE their tax instead of the faktur deriving it. Every historical
-- subscription invoice was created PPN-inclusive (withPpn), so the backfill recovers the same
-- breakdown baseFromTotal computed: base = round(total / 1.11), tax = total - base. Guarded on
-- tax_idr = 0 so a re-run is a no-op and post-toggle invoices (legitimately 0) are never touched —
-- they are only created AFTER this migration exists.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "tax_idr" bigint NOT NULL DEFAULT 0;
UPDATE "invoices"
   SET "tax_idr" = "amount_idr" - round("amount_idr" / 1.11)
 WHERE "kind" = 'subscription' AND "tax_idr" = 0 AND "amount_idr" > 0;
