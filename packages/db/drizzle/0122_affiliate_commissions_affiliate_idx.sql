-- The affiliate's own commission ledger had no index on the column it joins and filters by.
--
-- `affiliate_commissions` shipped in 0116 with ONE index, `(store_id, status)`. But the ledger an
-- affiliate actually opens is scoped to the affiliate, not the store: `apps/account/src/data/affiliate.ts`
-- joins on `affiliate_id` (and its `count`/`sum` twin does the same), as does the Seller's per-affiliate
-- detail in `apps/admin/lib/data/affiliates.ts`. With only the store index available the planner reads
-- EVERY commission row in the store and discards all but one affiliate's: a store with 50 affiliates
-- makes each affiliate's page read ~50x the rows it returns, and the sort for the 200-row page runs over
-- the whole set. It is correct today and gets slower in exactly the stores the programme succeeds in.
--
-- `(affiliate_id, status)` and not `(affiliate_id)` alone: every reader filters by status, or derives
-- "siap dibayar" from `status = 'pending' and eligible_at <= now()`.
--
-- Idempotent (AGENTS.md): drizzle applies the whole pending batch in ONE transaction, so a single
-- "already exists" would roll back every migration behind it while printing success.
create index if not exists "affiliate_commissions_affiliate_idx"
  on "affiliate_commissions" ("affiliate_id", "status");
