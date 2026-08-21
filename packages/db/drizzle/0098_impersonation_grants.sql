-- Impersonation exchanges — a handle that is SPENT, not verified (Task 4.11 / SEC-10).
--
-- "Buka Dashboard Seller" used to put a session-shaped, AUTH_SECRET-signed JWT in the query string
-- and let `/impersonate` verify it. Verification is stateless by definition, so the same URL kept
-- working for its whole two-minute life — from browser history, from the next request's `Referer`,
-- from a reverse-proxy access log, from whatever a support operator pasted into a ticket. Replay was
-- not a bug in the route: there was nowhere to record that the link had already been used.
--
-- A ROW CAN BE SPENT. The exchange is one statement:
--
--   update impersonation_grants set consumed_at = now()
--    where token_hash = $1 and consumed_at is null and expires_at > now() returning …
--
-- One row updated = the exchange happened, exactly once. Zero rows = unknown handle, already
-- consumed, or expired — three causes, one fail-closed answer, and no third outcome to get wrong.
-- Postgres takes the row lock, so two concurrent redemptions cannot both win: the loser blocks,
-- re-evaluates the predicate after the winner commits, and matches nothing.
--
-- Only sha256(handle) is stored. The plaintext exists in the redirect URL and nowhere else, so a
-- dump of this table is worth nothing. Unsalted SHA-256 is correct for a 256-bit uniformly random
-- input (no dictionary to run, nothing for a work factor to buy) and would be wrong for a password.
--
-- RLS IS ENABLED WITH NO POLICY, DELIBERATELY, AND IT IS THE STRICTEST SETTING. Both writers use the
-- OWNER connection (super-admin mints; the admin's pre-session auth path spends), and the owner
-- bypasses RLS because no table here uses FORCE ROW LEVEL SECURITY. The merchant role `tokophi_app`
-- has no business reading a grant for its own store, let alone another's — with RLS on and no policy
-- it sees zero rows. A policy keyed on `app.store_id` would be strictly weaker while reading like
-- protection. `verify-rls` check 5 asks only for `relrowsecurity`, so this needs no exception entry.
--
-- Idempotent (AGENTS.md): drizzle applies the whole pending batch in ONE transaction, so a single
-- "already exists" rolls back every migration behind it while printing "migrations applied
-- successfully".
create table if not exists "impersonation_grants" (
  "id" uuid primary key default gen_random_uuid() not null,
  "token_hash" text not null,
  "store_id" uuid not null references "stores"("id") on delete cascade,
  "user_id" uuid not null references "users"("id") on delete cascade,
  "operator_id" uuid not null references "platform_admins"("id") on delete cascade,
  "operator_email" text not null,
  "operator_role" text not null,
  "expires_at" timestamp with time zone not null,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null
);--> statement-breakpoint
-- UNIQUE, not merely an index: two rows sharing a hash would make "spend the one row" ambiguous.
create unique index if not exists "impersonation_grants_token_hash_key" on "impersonation_grants" ("token_hash");--> statement-breakpoint
create index if not exists "impersonation_grants_store_idx" on "impersonation_grants" ("store_id");--> statement-breakpoint
alter table "impersonation_grants" enable row level security;--> statement-breakpoint

comment on table "impersonation_grants" is
  'One-time, expiry-bound exchanges for Buka Dashboard Seller. Spent by an atomic UPDATE; only sha256(handle) is stored. RLS on with no policy on purpose - control-plane rows, owner connection only.';
