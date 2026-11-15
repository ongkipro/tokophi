-- SHIP-PROVIDER-PER-STORE (owner 2026-11-13, ADR 0019): the shipping provider becomes a fact about the
-- STORE, chosen by Super Admin (or by a signup code), never by the seller.
--   Owner: "jadi ada 2 → seller bisa KiriminAja (ekspedisinya) atau Mengantar. Super admin yang menentukan
--   dan atau via code ketika register." · "default pakai KiriminAja, soalnya kalo Mengantar harus double
--   register" · "bentuk kode daftar dari super admin aja, yang boleh mengganti ya super admin".
--
-- What this adds, and why each piece is shaped the way it is:
--   1. `stores.shipping_provider` — text + CHECK, NOT an enum value (`ALTER TYPE … ADD VALUE` cannot run
--      inside the one transaction drizzle applies a pending batch in). Default 'kiriminaja': a store is on
--      KiriminAja unless an operator or a signup code puts it on Mengantar. A Mengantar seller account is
--      only ever registered for a store set to 'mengantar' (packages/db/src/mengantar-account.ts).
--      `shipping_provider_config.active_provider` (0116) STAYS as the platform master switch:
--      'kiriminaja' there = Mengantar off for every store (an emergency kill-switch); 'mengantar' = each
--      store follows this column. COD always quotes KiriminAja whatever either says (O4/O6).
--   2. `signup_codes` — operator-made codes a self-serve signup may enter (`/daftar?kode=`). Each maps to a
--      provider. Codes are never deleted (deactivated instead) so a store's `signup_code` always names a
--      real row. Upper-case canonical form enforced by CHECK (the app normalises before it reads).
--      PLATFORM table, no store_id: RLS ENABLED WITH NO POLICY — the strictest setting, the same one
--      impersonation_grants (0098) and rate_limit_counters (0106) use. Every reader/writer is an OWNER-pool
--      path (signup before a session exists, Super Admin); the merchant role `tokophi_app` has no business
--      reading another platform's codes, and with RLS on and no policy it sees zero rows. Falls outside
--      verify-rls check 6 (it lists tables with neither store_id nor RLS) without an exception entry.
--   3. `stores.signup_code` — which code a store signed up with, FK → signup_codes(code) ON DELETE RESTRICT:
--      the usage count on the Super Admin screen is DERIVED (`count(*) … where signup_code = code`), so it
--      cannot drift, and the FK makes a dangling code a DB impossibility. Nullable: most stores used none.
--
-- BACKFILL (production effect stated on purpose — the seed is not a migration, see AGENTS.md): every store
-- that already holds a `connected` store_mengantar_accounts row in ANY env is set to 'mengantar', so a store
-- that quotes through Mengantar today keeps doing so after the deploy. On production on 2026-11-13 that is
-- exactly ONE store, the demo store `batiknusantara` (owner-attached account, O11). Every other store —
-- including those whose signup queued a `pending` Mengantar row — becomes 'kiriminaja' and is no longer
-- registered; their rows stay (history), the retry sweep skips them, and an operator who moves the store to
-- Mengantar later picks the row up again.
--
-- Idempotent (AGENTS.md / specs/docs/rules/migrations.md): every statement can re-run; the backfill only
-- moves 'kiriminaja' → 'mengantar' for connected stores, so a re-run after an operator moved a store back
-- would flip it again — it never re-runs after it is journalled, and before that nobody can have moved one.
-- ⚠️ Numbering: written as 0117 after origin/main's 0116; open branches (feat/pay-retry, feat/kelola-plugin)
-- may also claim 0117. Whoever merges second RENUMBERS AND RE-STAMPS. Never applied to the shared `tokophi`
-- dev DB before merge.

alter table "stores" add column if not exists "shipping_provider" text not null default 'kiriminaja';--> statement-breakpoint
do $$ begin
  alter table "stores" add constraint "stores_shipping_provider_check" check ("shipping_provider" in ('kiriminaja', 'mengantar'));
exception when duplicate_object then null; end $$;--> statement-breakpoint
comment on column "stores"."shipping_provider" is
  'Which provider quotes this store''s NON-COD checkouts (ADR 0019). Set only by Super Admin (owner rank, audit-logged) or by a signup code; the seller never chooses. mengantar = quoted through the store''s own connected Mengantar account while the platform switch (shipping_provider_config.active_provider) is mengantar; otherwise kiriminaja. COD is always kiriminaja. A Mengantar seller account is registered only for stores set to mengantar.';--> statement-breakpoint

create table if not exists "signup_codes" (
  "code" text primary key,
  "shipping_provider" text not null,
  "active" boolean not null default true,
  "note" text,
  "created_by" uuid references "platform_admins"("id") on delete set null,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  constraint "signup_codes_code_check" check ("code" ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'),
  constraint "signup_codes_provider_check" check ("shipping_provider" in ('kiriminaja', 'mengantar')),
  constraint "signup_codes_note_check" check ("note" is null or char_length("note") <= 200)
);--> statement-breakpoint
alter table "signup_codes" enable row level security;--> statement-breakpoint
comment on table "signup_codes" is
  'Signup codes made in Super Admin (ADR 0019). A self-serve signup that enters an ACTIVE code is created on that code''s shipping_provider; an unknown or inactive code is refused (never silently the default). Never deleted — deactivated. RLS on, no policy: owner pool only.';--> statement-breakpoint
comment on column "signup_codes"."code" is 'Canonical upper-case code (A-Z, 0-9, dash; 3–32 chars). The app normalises input (trim + upper-case) before reading.';--> statement-breakpoint
comment on column "signup_codes"."shipping_provider" is 'Provider a store signing up with this code is created on. mengantar also shows the Mengantar consent on /daftar.';--> statement-breakpoint

alter table "stores" add column if not exists "signup_code" text;--> statement-breakpoint
do $$ begin
  alter table "stores" add constraint "stores_signup_code_fk" foreign key ("signup_code") references "signup_codes"("code") on delete restrict;
exception when duplicate_object then null; end $$;--> statement-breakpoint
create index if not exists "stores_signup_code_idx" on "stores" ("signup_code") where "signup_code" is not null;--> statement-breakpoint
comment on column "stores"."signup_code" is
  'The signup code this store registered with (NULL = none). Usage counts on the Super Admin screen are derived from this column.';--> statement-breakpoint

update "stores" s set "shipping_provider" = 'mengantar'
 where s."shipping_provider" = 'kiriminaja'
   and exists (select 1 from "store_mengantar_accounts" a where a."store_id" = s."id" and a."state" = 'connected');
