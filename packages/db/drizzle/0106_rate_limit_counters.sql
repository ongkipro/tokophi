-- Rate limits that survive a redeploy and span replicas (Task 6.3 / NF-6).
--
-- `rateLimit()` in @tokophi/lib/cache was an in-process `Map`, and its own comments admitted both
-- holes: it reset on every redeploy (measured cadence: several a day, so an attacker's quota was
-- refilled for them for free) and it did not span replicas. It gates `signIn` on both panels, all
-- four `api/public/*` routes, sign-up, the tracking retries and the storefront chat.
--
-- WHY POSTGRES AND NOT A CLOUDFLARE RULE. An edge rule is zone configuration this repository cannot
-- create or verify, and — the deciding point — the edge cannot see an ACCOUNT: the per-account login
-- brake AGENTS.md calls for keys on an email address that lives inside the POST body of a Next
-- server action. Cloudflare stays the right OUTER wall, absorbing volume before it costs a
-- round-trip; it is a recommendation, not a replacement for this row.
--
-- ONE STATEMENT IS THE WHOLE DESIGN. The bump is a single
--
--   insert into rate_limit_counters (...) values (...)
--   on conflict (key) do update set count = ..., window_start = ... returning count, window_start
--
-- so the read, the fixed-window roll and the increment happen atomically under the row lock: two
-- replicas bumping the same key cannot both observe the same count. Splitting it into a select
-- followed by an update is the race `receivePurchaseOrder` and `markPayoutPaid` have each already
-- paid for. The text lives in packages/lib/src/rate-limit-store.ts; drizzle has no expression for it,
-- so schema.ts models the TABLE and nothing queries it through the ORM.
--
-- NO store_id, deliberately: an unauthenticated shopper, a sign-in that has not happened yet and a
-- payment callback have no tenant. RLS IS ENABLED WITH NO POLICY, the strictest setting and the same
-- one impersonation_grants (0098) uses — the owner connection is the only writer, and `tokophi_app`
-- has no business reading its own store's counters, let alone anyone else's. With RLS on it also
-- falls outside verify-rls check 6, which lists tables that have neither a store_id nor RLS.
--
-- No FK anywhere on purpose: the subject of a key is an IP or an email address, not a row, and a
-- counter that could be deleted by a cascade would be a limiter an attacker can reset.
--
-- Idempotent (AGENTS.md): drizzle applies the whole pending batch in ONE transaction, so a single
-- "already exists" rolls back every migration behind it while printing "migrations applied
-- successfully".
create table if not exists "rate_limit_counters" (
  "key" text primary key not null,
  "window_start" timestamp with time zone not null,
  "count" integer default 0 not null,
  "expires_at" timestamp with time zone not null
);--> statement-breakpoint
-- Only for the opportunistic sweep (`delete ... where expires_at < now()`, run every ~256th bump).
-- There is no cron for this table and it needs none: a key nobody hits again is a few dozen bytes.
create index if not exists "rate_limit_counters_expires_idx" on "rate_limit_counters" ("expires_at");--> statement-breakpoint
alter table "rate_limit_counters" enable row level security;--> statement-breakpoint

comment on table "rate_limit_counters" is
  'Shared fixed-window rate-limit counters, one row per limiter key. Bumped by an atomic insert-on-conflict from packages/lib/src/rate-limit-store.ts. No store_id (no tenant to scope to); RLS on with no policy on purpose - owner connection only.';
