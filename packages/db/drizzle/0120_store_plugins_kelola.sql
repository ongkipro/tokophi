-- KEL-001 (owner 2026-11-13): first-party plugin layer + the Kelola CRM plugin. Design:
-- specs/docs/KELOLA_PLUGIN_SPEC.md §4 · ADR 0021. Reference implementation: AdsBookCMS ADR-028
-- (`plugins` + plugin-owned `plugin_kelola_orders`), ported to one multi-tenant Postgres:
--
--   1. `store_plugins` — AdsBookCMS `plugins`, plus `store_id`. A store with no row has the plugin
--      DORMANT: no outbound request, no plugin rows, no menu entry (ADR-027 §2). The Kelola webhook URL
--      (its token rides in the URL path) + secret are sealed together in `secret_enc` (AES-GCM,
--      INTEGRATION_TOKEN_KEY, scope `<plugin>:<store_id>:v<secret_v>` — the mengantarKeyScope shape).
--   2. `plugin_kelola_orders` / `plugin_kelola_leads` — the plugin's own push state. NO foreign key to
--      `orders` / `checkout_sessions`: a plugin must never block the core from deleting a row (orphans
--      are harmless). The work queue is DERIVED (orders LEFT JOIN this table), so nothing is enqueued
--      inside the order transaction. `claimed_at` is a 5-minute lease taken by ONE statement before any
--      network call, so the after() hook and the cron cannot both POST the same order.
--   3. Deliberately NOT added: any `orders.kelola_*` column. AdsBookCMS added exactly those (0063–0065)
--      and removed them in 0066 — a core table must not carry one plugin's state.
--
-- All three are store-scoped → RLS, the standard tenant_isolation policy.
-- Idempotent (AGENTS.md / specs/docs/rules/migrations.md): every statement can re-run.
-- ⚠️ Numbering: written as 0117 on the paused feat/kelola-plugin; RENUMBERED AND RE-STAMPED to 0119 on
-- feat/kelola-plugin-v2 after main landed 0117_store_shipping_provider + 0118_pay_retry, and AGAIN to 0120
-- (stamp 1787546011751) after main landed 0119_subscription_code_discount (PR #468) with the same stamp
-- (both old tags RETIRED in src/verify-migrations.ts). Never applied to the shared `tokophi` dev DB before merge.
--
-- Aktif / Nonaktif (owner 2026-11-13, "plugins (aktif, non aktif)"): `enabled` is the switch. Turning it OFF
-- keeps the sealed credential and the push history; `disabled_at` records WHEN, so turning it back ON can
-- mark the orders/leads that arrived while it was off as skipped (never back-filled — the seller said "off"
-- for them). Uninstall ("Hapus koneksi") deletes the row and this store's plugin rows.

create table if not exists "store_plugins" (
  "store_id" uuid not null references "stores"("id"),
  "plugin" text not null,
  "enabled" boolean not null default false,
  "settings" jsonb not null default '{}'::jsonb,
  "secret_enc" text,
  "secret_v" integer not null default 0,
  "connected_at" timestamp with time zone,
  "broken_at" timestamp with time zone,
  "activated_at" timestamp with time zone,
  "disabled_at" timestamp with time zone,
  "updated_at" timestamp with time zone not null default now(),
  constraint "store_plugins_pk" primary key ("store_id", "plugin"),
  constraint "store_plugins_plugin_check" check ("plugin" ~ '^[a-z][a-z0-9_-]{0,31}$')
);--> statement-breakpoint
-- A database that ran this file before `disabled_at` existed (the paused branch's own DB) gets it here.
alter table "store_plugins" add column if not exists "disabled_at" timestamp with time zone;--> statement-breakpoint
alter table "store_plugins" enable row level security;--> statement-breakpoint
drop policy if exists "tenant_isolation" on "store_plugins";--> statement-breakpoint
create policy "tenant_isolation" on "store_plugins" using (store_id = app_current_store_id()) with check (store_id = app_current_store_id());--> statement-breakpoint
create index if not exists "store_plugins_active_idx" on "store_plugins" ("plugin") where "enabled" and "broken_at" is null;--> statement-breakpoint
comment on table "store_plugins" is
  'First-party plugins a store has activated (ADR 0021, AdsBookCMS ADR-028). No row = dormant: the core never calls the plugin for that store.';--> statement-breakpoint
comment on column "store_plugins"."settings" is
  'Non-secret settings only (e.g. {"webhook_url_masked": …, "push_leads": false}). Never holds a credential.';--> statement-breakpoint
comment on column "store_plugins"."secret_enc" is
  'AES-GCM (INTEGRATION_TOKEN_KEY), scope <plugin>:<store_id>:v<secret_v>. For kelola: JSON {webhook_url, webhook_secret} — the URL carries Kelola''s token. Never returned to a browser, never logged.';--> statement-breakpoint
comment on column "store_plugins"."connected_at" is
  'FIRST successful connection (kept on a re-save; cleared on disconnect). Nothing placed before it is ever pushed (spec §4.4, no backfill). Moving it on a re-save would drop every order placed while the credential was broken.';--> statement-breakpoint
comment on column "store_plugins"."disabled_at" is
  'When the store last switched the plugin OFF (null while on). Re-activation marks the orders/leads placed since then as skipped (gave_up_at, attempts 0) — they are never pushed automatically; "Kirim ulang" on one order still can.';--> statement-breakpoint
comment on column "store_plugins"."broken_at" is
  'Set when the provider answered 401/404 (credential refused). The cron skips the store until the credential is saved again, which clears it.';--> statement-breakpoint

create table if not exists "plugin_kelola_orders" (
  "store_id" uuid not null references "stores"("id"),
  "order_id" uuid not null,
  "claimed_at" timestamp with time zone,
  "synced_at" timestamp with time zone,
  "gave_up_at" timestamp with time zone,
  "attempts" integer not null default 0,
  "last_error" text,
  "last_note" text,
  "remote_id" text,
  constraint "plugin_kelola_orders_pk" primary key ("store_id", "order_id")
);--> statement-breakpoint
alter table "plugin_kelola_orders" enable row level security;--> statement-breakpoint
drop policy if exists "tenant_isolation" on "plugin_kelola_orders";--> statement-breakpoint
create policy "tenant_isolation" on "plugin_kelola_orders" using (store_id = app_current_store_id()) with check (store_id = app_current_store_id());--> statement-breakpoint
comment on table "plugin_kelola_orders" is
  'Kelola plugin push state, one row per order the plugin touched. No FK to orders on purpose. claimed_at = 5-minute send lease; synced_at = Kelola holds it (201 or duplikat); gave_up_at = 400, never retried.';--> statement-breakpoint
comment on column "plugin_kelola_orders"."last_error" is 'Token-redacted. Seller-facing only — never shown to a shopper.';--> statement-breakpoint
comment on column "plugin_kelola_orders"."last_note" is 'Kelola''s duplikatDari when it judged the order a same-buyer duplicate (201 status batal).';--> statement-breakpoint

create table if not exists "plugin_kelola_leads" (
  "store_id" uuid not null references "stores"("id"),
  "session_id" uuid not null,
  "claimed_at" timestamp with time zone,
  "synced_at" timestamp with time zone,
  "gave_up_at" timestamp with time zone,
  "attempts" integer not null default 0,
  "last_error" text,
  constraint "plugin_kelola_leads_pk" primary key ("store_id", "session_id")
);--> statement-breakpoint
alter table "plugin_kelola_leads" enable row level security;--> statement-breakpoint
drop policy if exists "tenant_isolation" on "plugin_kelola_leads";--> statement-breakpoint
create policy "tenant_isolation" on "plugin_kelola_leads" using (store_id = app_current_store_id()) with check (store_id = app_current_store_id());--> statement-breakpoint
comment on table "plugin_kelola_leads" is
  'Kelola plugin lead-push state, one row per abandoned checkout_session pushed (opt-in per store). Same lease/sync/give-up columns as plugin_kelola_orders.';
