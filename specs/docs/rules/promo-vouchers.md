# Promo, voucher, flash sale — and per-store code uniqueness

> Moved **verbatim** from `AGENTS.md` on 2026-10-28 (Claude Code warns when `AGENTS.md` exceeds 150k chars, and it is
> loaded in full into every session). `AGENTS.md` keeps a short digest of the rules plus a pointer here; this file keeps
> the reasoning and the incident history. Words like "above"/"below"/"the next section" refer to the old single-file
> layout — follow the named file or section instead. **If this file and the code disagree, the code wins — fix this file.**

## Promo, voucher & flash sale


> ### 🏷️ THE RULE: **`nonaktif` means OFF. The DATES are the schedule.**
> Every reader filters `status <> 'nonaktif'` **plus** the `starts_at`/`ends_at` window — never
> `status = 'aktif'`. That means all THREE: the storefront's pricing read, the admin's pricing read,
> **and the seller's Flash Sale list badge** (`lib/data/flash.ts` `isLive`), which was missed on the
> first pass and so labelled a live sale "Berakhir" while the till was already discounting it. Requiring `aktif` is what made a `terjadwal` flash sale **never go live**
> (the editor saved `terjadwal`, both readers demanded `aktif`, and **nothing ever promoted the
> row**), and what let a `terjadwal` voucher be redeemable at checkout while invisible on `/promo`
> and labelled "Terjadwal" in the seller list — **three definitions of "usable" for one row**.

- **Never anchor a WRITE to a fixed date.** `lib/actions/discounts.ts` held
  `ADMIN_TODAY = 2026-06-30` (the seed's frame) and computed `starts_at`/`ends_at` from it, so on
  2026-07-29 **every voucher a merchant created was born already expired** — and because
  `endsInDays` seeds the editor's period field, opening a voucher and pressing Simpan wrote the lie
  back and moved its expiry **backwards**. The gap widened by a day, every day. The seed may be
  anchored; the app is not. Same rule for `lib/data/discounts.ts`, which derives the display status.
- **A blank period means NO end date** (`ends_at: NULL`), which is what the editor has always
  promised ("Kosongkan untuk diskon tanpa batas waktu") and what `applyDiscount` already handles.
  `Math.max(1, period)` turned that promise into a voucher that died the next day.
  ⚠️ **`endsInDays` is `number | null`, and `null` is NOT `0`.** Zero means "ends today"; collapsing
  the two made a never-expiring voucher render as "Berakhir hari ini" — and, because that value seeds
  the editor's period field, pressing Simpan on an ALREADY-EXPIRED voucher wrote `ends_at: NULL` and
  **resurrected it permanently**.
- **`nonaktif` is SURFACED, never derived away.** The display status used to be computed from the
  dates alone, so a switched-off voucher read as "kadaluarsa" and the editor wrote `aktif` back over
  it on the next save. The DB's own OFF switch wins over any date arithmetic.
- **An edit changes the discount, not its schedule.** `updateDiscount` keeps the row's existing
  `starts_at`. It used to mint a fresh anchor on every save, which walked `ends_at` one day earlier
  per Simpan and rescheduled a promo set for next month to two days from now — with no field on
  screen saying so, because the editor has no start-date input.
- **The usage limit is enforced in the UPDATE's own WHERE, inside the order txn** — never by the
  pre-check alone. `applyDiscount` reads `used_count` **outside any transaction, unlocked**, so it
  is advisory: N concurrent orders on the last slot all pass it. The conditional
  `UPDATE … WHERE used_count < usage_limit` is the lock; 0 rows updated ⇒ `VoucherExhausted` ⇒ the
  whole order rolls back with a 409 the shopper can act on. (A comment here claimed this was already
  race-safe for weeks while the increment was a bare `used_count + 1`.)
- **The badge's clock must be the PRICE's clock.** `isLive` was moved to the server and then the very
  next line computed "Terjadwal" from `Date.now()` **in the browser** — the merchant's own laptop
  clock deciding a label about a price this server sets. `isUpcoming` is now derived in
  `lib/data/flash.ts` on the same `now` as `isLive`, so the two cannot contradict each other.
- **A flash sale must reach the VARIANT rows, not just the headline price.** `data/catalog.ts`
  applies `Math.min(v.price, flash.price)` per variant, because the PDP's picker rewrites the price
  from `variants[]` on load — so a flash product WITH options rendered the **pre-sale** price next
  to its own "-43%" badge while `/api/public/order` charged the sale price.
- **Not implemented, do not pretend otherwise:** per-customer usage limit (no column —
  `discount_usages` has no `customer_id`, so it is not even derivable), product/collection
  eligibility, and voucher stacking. `min_purchase_idr` **is** enforced server-side but has no
  field in the editor.

## Codes are unique PER STORE, and the scope filter is load-bearing


`discounts.code` and `purchase_orders.code` are `UNIQUE (store_id, code)` since migration **0084**.
They used to be `UNIQUE (code)` — platform-wide — which on a multi-tenant product means the first
merchant to use a string owns it forever:

- **Vouchers**: Indonesian promo codes collide constantly (`GAJIAN`, `DISKON10`, `GRATISONGKIR`). One
  shop registering `GAJIAN25` blocked every other shop, and the rejection told the second merchant the
  code was taken — a working way to probe a competitor's codes.
- **Purchase orders**: worse, because the code is generated. `PO-${Date.now().toString().slice(-6)}`
  repeats every 10⁶ ms ≈ **16.7 minutes**, so two POs anywhere on the platform at the same point in
  that cycle collided and the second one simply failed to save. The generator is wider now, but the
  per-store scope is what makes a collision a local problem instead of a cross-tenant one.

⚠️ **`applyDiscount`'s `store_id` filter is now the ONLY thing stopping one store redeeming another's
code.** It used to be a second lock on a door only one key fitted; since 0084 it is the lock. Do not
"simplify" it away. `packages/db/src/per-store-codes.test.ts` pins both the composite unique and the
absence of a column-level `.unique()` — the edit that would silently restore the old behaviour
type-checks and passes everything else.
