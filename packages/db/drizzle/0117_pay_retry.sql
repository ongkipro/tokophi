-- PAY-RETRY (2026-11-13) — "Bayar ulang": a shopper whose prepaid instruction EXPIRED or FAILED may
-- get a NEW instruction for the SAME order. Spec: specs/docs/tasks/2026-11-13-pay-retry.md.
--
-- Three facts the retry needs and the schema did not hold:
--
-- 1. `payments.expires_at` — the instant the provider stops accepting this instruction. AutoLaris
--    answers it (`payment_info.expired`, WIB wall-clock, no zone) and it was shown ONCE on
--    /checkout/sukses and thrown away, so nothing on the server could tell a live QR from a dead one.
--    Production holds QRIS rows still `menunggu` months after their 2 h window (the EXPIRED callback
--    never came). NULL = unknown: every row written before this migration, and any answer we could
--    not parse. Readers bound an unknown expiry conservatively (lib/pay-retry.ts), never optimistically.
-- 2. `payments.created_at` — attempt order. With more than one unpaid row per order, the old
--    tie-break `id desc` is a random uuid, so "the order's payment" would have been a coin toss
--    between the expired QR and the new one. Existing rows all get the migration instant (now() is
--    STABLE, so this is a metadata-only add); `id` still breaks that tie.
-- 3. `orders.pay_token_hash` — sha256 (hex) of the one-order secret the shopper's browser holds after
--    checkout. The retry endpoint is public and sessionless; an order NUMBER is printed on labels,
--    quoted in WhatsApp chats and typed by the seller, so it can never authorise anything. Only the
--    hash is stored (the impersonation-grant pattern). NULL for COD and for every order placed
--    before this migration — those keep the old path: the seller re-bills from the order screen.
--
-- Idempotent (AGENTS.md): drizzle applies the pending batch in ONE transaction, so one "already
-- exists" rolls back every migration behind it while printing "migrations applied successfully".
alter table "payments" add column if not exists "expires_at" timestamp with time zone;--> statement-breakpoint
alter table "payments" add column if not exists "created_at" timestamp with time zone default now() not null;--> statement-breakpoint
alter table "orders" add column if not exists "pay_token_hash" text;--> statement-breakpoint
comment on column "payments"."expires_at" is
  'When the provider stops accepting this instruction (AutoLaris payment_info.expired, parsed as WIB). NULL = unknown (pre-0117 rows, unparseable answer); lib/pay-retry.ts bounds an unknown expiry conservatively. PAY-RETRY.';--> statement-breakpoint
comment on column "payments"."created_at" is
  'Attempt order for an order with several instructions (PAY-RETRY). Pre-0117 rows carry the migration instant; id breaks the tie.';--> statement-breakpoint
comment on column "orders"."pay_token_hash" is
  'sha256 hex of the shopper-held secret that authorises /api/public/pay/retry for THIS order. Never the token itself. NULL = COD or placed before 0117 (no self-service retry). PAY-RETRY.';
