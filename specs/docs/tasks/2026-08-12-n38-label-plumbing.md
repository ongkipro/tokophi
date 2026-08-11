# N38 — label plumbing (the four unblocked fields) · 2026-08-12

**Branch:** `feat/n38-label-fields` (worktree `.claude/worktrees/n38-label`), base `origin/main` @ `951173c`.
**Scope:** the PLUMBING half of N38 only — fields already persisted in the DB, flowed onto the label.
**Out of scope, deliberately untouched:** insurance (needs a column — still not persisted), sorting
code (blocked on the vendor + webhook N39), booking/quote/checkout, `platform_cod`.

## What changed

- [x] `apps/admin/components/admin/pesanan/shipping-label.ts` — `LabelInput` grew `serviceName`,
      `destinationPostcode`, `senderPhone`, `senderPostcode`, and `items[].priceLabel` (all optional,
      same pattern as the existing `senderLine`/`weightLabel` slots; absent ⇒ the label renders
      exactly as before). Template prints: service name under the courier; each kodepos as its OWN
      bold field on the Penerima/Pengirim box header (no longer glued into the address string); the
      sender's phone; `@Rp…` per item. New shared pure helpers `formatWeight(grams)` and
      `composeSenderLine({address, kecamatanName})` so the two callers cannot format differently.
- [x] `apps/admin/lib/data/order-detail.ts` — `getOrderDetail` now returns
      `shipment.serviceType`/`serviceName` (lateral over `platform_couriers.services`, same lookup
      `bulk-shipping.ts` uses), `shipment.weightGrams` (**billable** grams via `weightForOrder`, the
      same number `createShipment` declares to the courier), and a new top-level `sender`
      (`store_settings.sender_phone/address/kecamatan_name/postcode`, filtered on `storeId`
      explicitly — new `OrderSender` type). **Contract change: `OrderDetail` has a new `sender` key
      and `OrderShipment` three new fields** — additive, no existing field changed.
- [x] `apps/admin/app/(admin)/pesanan/[id]/order-detail.tsx` — single-label caller fills every new
      slot; kodepos removed from the glued destination string (now its own field).
- [x] `apps/admin/lib/data/bulk-labels.ts` — bulk SQL now selects `service_type` + service name
      (lateral), joins `store_settings` for the sender, computes weight per order (Σ variant grams,
      missing = `DEFAULT_WEIGHT_GRAMS`, floored at `MIN_BILLABLE_GRAMS` — same rule as
      `weightForOrder`), and adds `price` to the items JSON; caller fills the same slots as the
      single path.
- [x] 🐛 **Pre-existing bug fixed on the way (it blocked the AC):** the bulk items subquery read
      `li.variant` — a column that has NEVER existed on `order_line_items` (only `variant_id`) —
      so `getBulkLabels` threw Postgres 42703 on EVERY call and bulk "Cetak resi" always failed
      (verified present on `origin/main:apps/admin/lib/data/bulk-labels.ts` line 29). The variant
      title now joins from `product_variants.title`, the same source the single path uses.
- [x] New test `apps/admin/components/admin/pesanan/shipping-label.test.ts` — 6 tests: filled slots
      render, absent slots degrade to the old label (no `null`/`undefined`/empty shells), new slots
      are HTML-escaped, `formatWeight` (id-ID kg / g / null-not-"0 g"), `composeSenderLine`.

## Verification (all really run)

- [x] `npm test` (with dev `DATABASE_URL`) — exit 0; vitest alone: **79 files / 666 tests passed**
      (includes the new 6), plus the storefront/landing `astro check`s green.
- [x] `npm run lint -w @tokophi/admin` — **0 errors** (23 pre-existing warnings, none in touched files).
- [x] `npm run build:admin` — green. ⚠️ Needs `DATABASE_URL` in the env: the worktree has no
      gitignored `.env.local`, and without it page-data collection fails on `/api/public/promo` —
      that failure is environmental, not code.
- [x] **Browser, prod build** (`next build` + `next start -p 3038`, dev does not hydrate): logged in
      as the seeded owner, order **PHI-5397** (sicepat REG, COD, 3 lines) → "Cetak resi" (demo-resi
      path) → label shows **Sicepat REGULER**, recipient kodepos **80339** and sender kodepos
      **60281** as their own bold fields, sender phone + address line, **1 KG**, and `@Rp…` per item.
      Same order selected on `/pesanan/massal` → bulk "Cetak resi (1)" → identical label.
      Screenshots in the session log. Console: **0 JS errors**; one 404 for
      `/api/uploads/produk-….webp` — a merchant-upload file that does not exist on this machine's
      disk (uploads are gitignored); pre-existing, unrelated.
- [x] **Shared dev DB left exactly as found** (temporary writes, all reverted and re-read):
      `stores.current_period_end` back to `2026-08-04 03:59:23.814+00` (was extended to 2026-09-04
      to get past the billing lock, same value the N31 session recorded), `store_settings.sender_postcode`
      back to `NULL` (was set to `60281` to eyeball the field), `PHI-5397.awb` + `label_printed_at`
      back to `NULL` (the demo/print flow had stamped them).

## Still open on N38 (NOT this branch)

- **Insurance** — never persisted; needs a column (booking consumes `input.insurance` once;
  `bulk-shipping.ts` hardcodes `insurance: false`). Deliberately not started: migration = out of
  this task's scope.
- 🔴 **Sorting code** — blocked twice: values must be requested from KiriminAja support, and they
  arrive on the `processed_packages` webhook we do not receive (N39). SPX (primary courier, COD
  rail) needs the 2-column form.

**NEXT:** decide the insurance column (order-level boolean + amount?), then N39's webhook receiver
is what unblocks the sorting code.
