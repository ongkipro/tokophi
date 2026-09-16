-- Provider credentials and environment MANAGED FROM SUPER ADMIN (Task 8.33, 2026-09-17).
--
-- Until now the KiriminAja and AutoLaris keys were read ONLY from the container environment
-- (`KIRIMINAJA_API_KEY`, `KIRIMINAJA_ENV`, `AUTOLARIS_API_KEY`), and `shipping_aggregator.api_key` /
-- `platform_payment_gateways.credentials` were dead columns nothing read. Rotating a key or moving
-- from sandbox to production was therefore a redeploy — invisible to the operator, unaudited, and
-- (N35) a wrong `KIRIMINAJA_ENV` looks perfectly healthy because the sandbox answers with the same
-- shapes as production.
--
-- These columns hold the keys ENCRYPTED AT REST (AES-256-GCM, the same cipher as
-- `store_tracking_channels.token_enc`; scope = `provider:kiriminaja:<env>` / `provider:autolaris:key`
-- as GCM AAD, so a blob copied between columns does not decrypt). Precedence at runtime: a DB row
-- with a key wins over the env var; the env var is the fallback so an existing deploy keeps working.
--
-- `active_env` is the environment the platform BOOKS AGAINST. `sandbox` by default — the same
-- default the env var had — and it can only be flipped by an owner-rank operator after the target
-- environment's key passed a live test (`setProviderEnv`).
-- `*_tested_at` = when that stored key last passed its provider's test call; NULL = never tested.
--
-- `api_key` and `credentials` are NOT dropped (a destructive migration; same standing as
-- `store_settings.payment_channels`). They stay dead.
--
-- Idempotent (AGENTS.md): drizzle applies the whole pending batch in ONE transaction, so a single
-- "already exists" rolls back every migration behind it while printing "migrations applied
-- successfully".
alter table "shipping_aggregator" add column if not exists "sandbox_key_enc" text;--> statement-breakpoint
alter table "shipping_aggregator" add column if not exists "production_key_enc" text;--> statement-breakpoint
alter table "shipping_aggregator" add column if not exists "active_env" text not null default 'sandbox';--> statement-breakpoint
alter table "shipping_aggregator" add column if not exists "sandbox_tested_at" timestamp with time zone;--> statement-breakpoint
alter table "shipping_aggregator" add column if not exists "production_tested_at" timestamp with time zone;--> statement-breakpoint
alter table "platform_payment_gateways" add column if not exists "credentials_enc" text;--> statement-breakpoint
alter table "platform_payment_gateways" add column if not exists "tested_at" timestamp with time zone;--> statement-breakpoint

comment on column "shipping_aggregator"."sandbox_key_enc" is
  'KiriminAja SANDBOX api key, AES-256-GCM (v1:iv:tag:ct, scope provider:kiriminaja:sandbox). NULL = fall back to KIRIMINAJA_API_KEY env. Written only by saveProviderCredentials (owner).';--> statement-breakpoint
comment on column "shipping_aggregator"."production_key_enc" is
  'KiriminAja PRODUCTION api key, encrypted as sandbox_key_enc (scope provider:kiriminaja:production). NULL = fall back to env.';--> statement-breakpoint
comment on column "shipping_aggregator"."active_env" is
  'Environment the platform books against: sandbox | production. Default sandbox (same as the old KIRIMINAJA_ENV default). Flipped only by setProviderEnv after the target key passed a live test.';--> statement-breakpoint
comment on column "shipping_aggregator"."sandbox_tested_at" is
  'When the stored sandbox key last passed kaTestConnection. NULL = never tested.';--> statement-breakpoint
comment on column "shipping_aggregator"."production_tested_at" is
  'When the stored production key last passed kaTestConnection. NULL = never tested.';--> statement-breakpoint
comment on column "platform_payment_gateways"."credentials_enc" is
  'AutoLaris api key, AES-256-GCM (scope provider:autolaris:key). NULL = fall back to AUTOLARIS_API_KEY env. The legacy jsonb credentials column stays dead.';--> statement-breakpoint
comment on column "platform_payment_gateways"."tested_at" is
  'When the stored AutoLaris key last passed alTestConnection. NULL = never tested.';
