-- ─────────────────────────────────────────────────────────────────────────────
-- 0056 — repair ledger notes still naming an order number that no longer exists.
--
-- Migration 0052 renamed every order to the PHI- prefix. It did not touch `ledger_entries.note`,
-- which embeds the number as FREE TEXT ("Penjualan INV-5188"). 642 rows were left pointing at a
-- number that does not resolve: the order is PHI-5188, the ledger says INV-5188. My migration, my
-- omission — 0052 renamed the thing and left every reference to it behind.
--
-- Why it matters even though the screen looks fine: `getMutations` JOINs `o.number`, so the Mutasi
-- table renders the CORRECT number and the rot is invisible there. The EXPORT does not — it ships
-- `Keterangan: r.note` verbatim (lib/data/ledger.ts). So the CSV a merchant hands their accountant
-- names 642 orders that cannot be found in the orders list. A money export that cannot be reconciled
-- against the orders it claims to describe is worse than no export: it is confidently wrong, and the
-- person who finds out is the one being paid to find things like this.
--
-- Re-derived from `orders.number`, NOT string-replaced on the prefix. Same reasoning as 0054: resolve
-- against the live source of truth so any stale prefix (INV-, WEB-, anything a future rename leaves
-- behind) converges, instead of hardcoding the one mismatch I happen to be looking at today.
--
-- The WRITERS were always correct — lib/ledger-credit.ts and seed.ts both build the note from
-- `'Penjualan ' || o.number` at insert time, so new rows and a fresh seed are already right. This
-- repairs history only, and it is idempotent: the WHERE makes a second run a no-op.
-- ─────────────────────────────────────────────────────────────────────────────

update ledger_entries l
   set note = 'Penjualan ' || o.number
  from orders o
 where o.id = l.order_id
   and l.note like 'Penjualan %'
   and l.note <> 'Penjualan ' || o.number;
