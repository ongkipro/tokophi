-- BILL-PRICE-2026-11 (owner 2026-11-13, ADR 0020): new subscription price (Rp178.500/month, annual
-- Rp1.713.600 = monthly × 12 − 20%), the Rp50rb first-month promo REMOVED, and a signup code that may
-- carry a discount on the store's FIRST subscription invoice ("Kode" on /daftar, ADR 0019's codes).
--
-- The prices themselves are code (`@tokophi/lib/billing` BILLING), not data — nothing here rewrites a
-- stored invoice: an invoice already issued keeps the amount it was issued with (owner decision 7). What
-- the schema needs is the DISCOUNT, in two places:
--
--   1. `signup_codes.discount_first_invoice_idr` — how much a code takes off the first invoice. Stored
--      PER CODE (the Super Admin form pre-fills Rp100.000; 0 = a provider-only code). Existing codes get
--      0: they were handed out as shipping-provider codes, and silently turning them into discount codes
--      would grant money nobody decided to grant. Set at creation only (no edit path) — so the amount a
--      store signed up under cannot change afterwards, and the creator may read it at invoice time.
--   2. `invoices.code_discount_idr` + `invoices.discount_code` — the discount THIS invoice carries and
--      the code it came from, stored at creation like `tax_idr` (0101): the faktur prints
--      "Potongan kode XXX −Rp100.000" from the row, never from today's code or today's price. The list
--      price is recoverable from the row alone: (amount_idr − tax_idr) + code_discount_idr.
--
-- "Never twice" (ADR 0020 §3): the discount belongs to the store's first PAID subscription invoice.
-- `codeDiscountFor()` refuses it once the store has paid anything; the creator reuses a live (menunggu)
-- invoice rather than minting a second; and the partial UNIQUE index below makes two LIVE discounted
-- invoices for one store a DB impossibility (the race the reuse-read alone cannot close). It is keyed on
-- `menunggu` only, NOT on `dibayar`, on purpose: the pay callback may legally move `gagal → dibayar` (a
-- PAID that arrives after its EXPIRED), and an index that made that UPDATE fail would turn received money
-- into a 500. The residual case — a merchant who pays a CANCELLED discounted VA after paying its
-- discounted re-issue — is recorded in the ADR as known, bounded by one discount amount.
--
-- Idempotent (AGENTS.md / migrations rules): drizzle applies the pending batch in ONE transaction, so a
-- single "already exists" silently rolls back every migration behind it.
-- ⚠️ Numbering: written as 0119 after origin/main's 0118_pay_retry. Whoever merges second RENUMBERS AND
-- RE-STAMPS. Never applied to the shared `tokophi` dev DB before merge.

alter table "signup_codes" add column if not exists "discount_first_invoice_idr" bigint not null default 0;--> statement-breakpoint
do $$ begin
  alter table "signup_codes" add constraint "signup_codes_discount_check" check ("discount_first_invoice_idr" >= 0);
exception when duplicate_object then null; end $$;--> statement-breakpoint
comment on column "signup_codes"."discount_first_invoice_idr" is
  'IDR (DPP) taken off the FIRST PAID subscription invoice of a store that signed up with this code (ADR 0020). 0 = no discount (provider-only code). Set when the code is created; never edited. Honoured even after the code is deactivated.';--> statement-breakpoint

alter table "invoices" add column if not exists "code_discount_idr" bigint not null default 0;--> statement-breakpoint
alter table "invoices" add column if not exists "discount_code" text;--> statement-breakpoint
do $$ begin
  alter table "invoices" add constraint "invoices_code_discount_check" check ("code_discount_idr" >= 0 and ("code_discount_idr" = 0 or "discount_code" is not null));
exception when duplicate_object then null; end $$;--> statement-breakpoint
create unique index if not exists "invoices_one_live_code_discount" on "invoices" ("store_id") where "code_discount_idr" > 0 and "status" = 'menunggu';--> statement-breakpoint
comment on column "invoices"."code_discount_idr" is
  'Signup-code discount (DPP, IDR) THIS invoice carries, decided at creation by createSubscriptionInvoice (ADR 0020). amount_idr already has it taken off (PPN, when on, is on the discounted DPP). List price = amount_idr - tax_idr + code_discount_idr.';--> statement-breakpoint
comment on column "invoices"."discount_code" is
  'The signup code the discount came from (printed on the faktur). NULL when code_discount_idr = 0.';
