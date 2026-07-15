-- Saldo, part 2: CREDIT the book. Migration 0040 built the ledger and nothing ever wrote a `sale`
-- into it. `lib/actions/ledger.ts` could only withdraw; `lib/actions/orders.ts` could only release
-- or claw back entries that were never created. The book stayed empty, so every merchant's balance
-- read Rp0 no matter how much money came in. A ledger that is never credited is not a ledger.
--
-- Three things happen here:
--   1. `ledger_entries.payment_id` — a `sale` exists because a shopper PAID, so the entry points at
--      the payment that collected the money (and at the order, as before).
--   2. A partial unique index (one `sale` per payment) — gateway callbacks retry, buttons get
--      double-clicked. The no-double-credit guarantee lives in the DB, not in a check-then-write
--      race in the app. Same precedent as 0040's `ledger_one_retur_per_order`.
--   3. A BACKFILL — every payment already collected (`status = 'berhasil'`) gets its `sale` entry:
--      `available` if the order is finished (`selesai`/`retur` — collected AND released), otherwise
--      `pending`. Cancelled orders (`batal`) collected nothing and are skipped.
--      Idempotent: re-running inserts nothing, and it cannot double-credit a sale the new writer
--      has already inserted (NOT EXISTS + the unique indexes).
--
-- RLS: 0040 already ENABLEd row-level security with a `tenant_isolation` policy on both
-- `ledger_entries` and `payouts`, and `tokophi_app` holds its grants via 0012's default privileges.
-- Checked against the live catalog, not assumed — nothing to fix here.
ALTER TABLE "ledger_entries" ADD COLUMN IF NOT EXISTS "payment_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- One credit per payment, enforced by the DB rather than by hoping the callback fires exactly once.
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_one_sale_per_payment" ON "ledger_entries" ("payment_id") WHERE "kind" = 'sale';--> statement-breakpoint

-- ── BACKFILL ────────────────────────────────────────────────────────────────────────────────────
-- Money already collected but never booked. `amount_idr` is the payment's `amount_idr` (the order
-- total the merchant is owed), NOT `total` — `total` adds the gateway's admin fee, which is the
-- gateway's money and never was the merchant's. Keeping to the order total is also what keeps the
-- Dashboard revenue, the Pesanan list and the Saldo ledger the same number.
INSERT INTO "ledger_entries" ("store_id", "order_id", "payment_id", "kind", "status", "amount_idr", "note", "created_at", "available_at")
SELECT COALESCE(p.store_id, o.store_id),
       o.id,
       p.id,
       'sale',
       CASE WHEN o.status::text IN ('selesai', 'retur') THEN 'available' ELSE 'pending' END::ledger_status,
       p.amount_idr,
       'Penjualan ' || o.number,
       COALESCE(p.paid_at, o.placed_at, now()),
       CASE WHEN o.status::text IN ('selesai', 'retur') THEN COALESCE(p.paid_at, o.placed_at, now()) END
  FROM payments p
  JOIN orders o ON o.id = p.order_id
 WHERE p.status = 'berhasil'
   AND o.status <> 'batal'
   AND NOT EXISTS (
     SELECT 1 FROM ledger_entries l
      WHERE l.kind = 'sale' AND (l.payment_id = p.id OR l.order_id = o.id)
   )
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- An order that already came back must not leave its credit standing. The claw-back mirrors the one
-- `setOrderStatus` writes: an OPPOSING entry (never an edit of the sale), carrying the SAME status
-- as the sale it reverses — so a pending sale is cancelled out of `pending`, and a released one is
-- taken back out of `available`.
INSERT INTO "ledger_entries" ("store_id", "order_id", "kind", "status", "amount_idr", "note", "available_at")
SELECT l.store_id, o.id, 'retur', l.status, -l.amount_idr, 'Retur ' || o.number,
       CASE WHEN l.status = 'available' THEN COALESCE(o.returned_at, now()) END
  FROM ledger_entries l
  JOIN orders o ON o.id = l.order_id
 WHERE l.kind = 'sale' AND o.status::text = 'retur'
   AND NOT EXISTS (
     SELECT 1 FROM ledger_entries r WHERE r.kind = 'retur' AND r.order_id = o.id
   )
ON CONFLICT DO NOTHING;
