# Shipping & COD

> On `main` the general Shipping & COD rules (KiriminAja quote, COD chain, cancel-by-AWB, the seller flow)
> still live inline in `AGENTS.md` → "Shipping & COD". PR #421 moves them into this file. **When #421 is
> merged, keep both halves: its moved body first, then this Mengantar section unchanged.**
> **If this file and the code disagree, the code wins — fix this file.** Decisions D1–D18 / O-items:
> `specs/docs/tasks/2026-11-05-shipping-mengantar-decisions.md`. Ops / go-live: `specs/docs/DEPLOY.md` § Mengantar.

## Mengantar (second shipping provider, Partner Business API — live in production since 2026-11-12)

- **The provider is a fact about the STORE (ADR 0019, owner 2026-11-13).** `stores.shipping_provider`
  (`kiriminaja` default | `mengantar`) is set ONLY by Super Admin (store page → "Penyedia pengiriman",
  `setStoreShippingProvider`) or by a signup code (`signup_codes`, `/daftar?kode=`). The seller never
  chooses. A store is born on KiriminAja ("kalo Mengantar harus double register").
- **The platform switch is the master kill-switch above it.** `shipping_provider_config.active_provider`
  (`kiriminaja` | `mengantar`, id = 1): `kiriminaja` = Mengantar OFF for every store; `mengantar` = each store
  follows its own column. Precedence row > env `SHIPPING_PROVIDER` > `kiriminaja`, an unrecognised value is
  ignored (`resolveShippingProvider`), cached 60 s per process. The default provider
  (`DEFAULT_SHIPPING_PROVIDER`) is KiriminAja, and KiriminAja stays configured: it is every fallback below.
- **Dispatch is per store, per quote (D11 as amended by ADR 0019).** `quoteShipping`
  (`apps/admin/lib/shipping-quote.ts`) quotes Mengantar ONLY when switch = mengantar ∧ the order is NOT COD ∧
  `MENGANTAR_ENV` is named in this process ∧ **the store is set to Mengantar** ∧ the store's own account opens
  (`openStoreMengantar`). Anything else — a KiriminAja store (even one holding a connected account),
  unconnected store, rotating key, Mengantar down, no origin area, zero rates on the full courier scope —
  falls back to KiriminAja. The quote's `provider` field says who actually priced it. Never add a second
  dispatcher. Truth table: `shipping-quote-mengantar.test.ts` / ADR 0019 §3.
- **An account is registered ONLY for a store set to Mengantar — enforced at the sink.** `connectStoreMengantar`,
  `enqueueMengantarConnect`, `requeueMengantar` (so `kickMengantarConnect`) and the retry sweep check
  `stores.shipping_provider` first (`storeShippingProvider`), so no door can register a KiriminAja store. A
  `registering` row of a store moved away is still reconciled. Moving a store TO Mengantar queues its account
  only if it has none (`awaiting_consent` — the owner's "Hubungkan Mengantar" click); moving AWAY leaves the
  row. Existing orders keep their stamp either way.
- **Signup codes.** An unknown, inactive or malformed code is REFUSED (one sentence, `SignupCodeError`), never
  ignored. The code is re-read inside the signup transaction (`FOR SHARE`). The Mengantar consent sentence is
  on `/daftar` ONLY for a code that maps to Mengantar, and consent is recorded only when the posted
  `mengantarConsentFor` equals the submitted code. KiriminAja sellers see no provider brand (ADR 0004).
- **Rank.** Moving a store and managing codes share ONE constant, `SHIPPING_PROVIDER_MIN_RANK`
  (`apps/super-admin/lib/store-shipping-provider.ts`, owner today; it is also the `/kode-daftar` floor).
- 🔴 **COD NEVER travels Mengantar (O4/D9).** Every Mengantar rate is `cod: false`; a COD quote passes
  `cod: true`, which always lands on KiriminAja; `/api/public/order` refuses a COD order whose re-quote
  came back `mengantar` (403 `cod_not_allowed`); `bookMengantar` refuses a COD order again. Three locks on
  purpose — do not remove one because "the other two hold".
- **`codRequote` (D12).** `/api/public/ongkir` answers `codRequote: true` when the prepaid quote came from
  Mengantar; `checkout.astro` then re-quotes with `cod: true` when the shopper picks COD (and without it when
  they leave COD), so the rates on screen match the payment method. A neutral boolean — the provider name
  never reaches a shopper (ADR 0004; the Seller surface MAY say "Mengantar", O5/D10, `provider-label.test.ts`).
- **The order stamp decides everything after checkout.** `/api/public/order` re-quotes and writes
  `orders.shipping_provider` (+ `ship_mengantar_area_id`) from THAT quote. Rates, booking, cancel and
  tracking dispatch on the stamp (`isMengantarOrder` in `lib/actions/shipping.ts`; NULL = legacy = KiriminAja),
  never on the switch — flipping the switch back moves new quotes only. A booking also stamps `mg_env` +
  `mg_seller_id`; cancel / pay / tracking reopen THAT account and refuse on `env_mismatch` / `seller_mismatch`.
- **Booking re-prices on the server** (`bookMengantar` → `orderRates`): a service absent from the fresh
  quote is refused, and a caller-sent `cost` that differs from the fresh price is refused ("Tarif berubah …")
  — `input.cost` is display state, never the price booked.
- **Prepaid needs a successful payment.** `bookMengantar` refuses an order with no `payments.status =
  'berhasil'` row. No ledger debit on a Mengantar booking (O3/D8): the seller's own Mengantar wallet pays
  the courier and the buyer's shipping is passed through to the seller (`FINANCE.md` §2).
- **A short wallet does not fail the booking.** The order is created `isPaid:false` with no waybill,
  stored `mg_is_paid = false` ("Ongkir pengiriman BELUM dibayar"); the seller tops up in their Mengantar
  app and presses **Bayar ongkir** → `payMengantarUnpaid` → `POST /order/pay-unpaid {batch_id, courier}`,
  claimed by compare-and-swap `false → null → true`. A partial pay leaves every claimed order `null` until
  tracking settles it — never guess which were paid.
- **The waybill is written only when Mengantar returns a real `cnote_no`.** The booking `_id` / `ORDER_ID`
  go to `mg_order_id` / `mg_order_code`, NEVER to `awb`; with no waybill the result is `awbPending` and the
  `cron-tracking` sweep (`sweepMengantarTracking`, polling — there is no Mengantar webhook, D16) fills it.
  A waybill is not a pickup: booking moves the order to `diproses` only.
- **Cancel differs from KiriminAja:** `cancelMengantar` deletes by the provider `_id`, so a fresh booking
  with no waybill CAN be cancelled. A confirmed `deletedCount` is the confirmation (the order vanishes from
  `GET /order`; it never turns CANCELED).
- **An unreadable write is not a failure.** A timeout / 5xx / unreadable 2xx on `POST /order` leaves the
  booking `unknown` and blocks every retry until an operator reconciles it. The `idempotencyKey` is SENT
  but NOT relied on in production.
- **`MENGANTAR_ENV` must be NAMED.** Unset reads as `sandbox`, and a sandbox booking looks like a real one.
  So the Super Admin switch refuses Mengantar unless `MENGANTAR_ENV` is set in its process, `quoteShipping`
  ignores the switch in a process without it, and registration parks the row (`configuration_blocked`).
  The Partner origin is a FIXED table (`MENGANTAR_ORIGINS`); production `partner` is `null` until
  Mengantar publishes it (O2) — every Partner call refuses until then.
- 🔴 **Every deploy truncates the area bridge.** `seed-areas.ts` truncates and reloads `kiriminaja_areas`
  + `kelurahan` (where the `mengantar_area_id` bridge columns live) on every deploy, then rebuilds them with
  `bridgeMengantarAreas` (`packages/db/src/mengantar-bridges.ts`) when `mengantar_areas` has rows. Until
  the seed container exits (~2 min after Coolify says "finished") every Mengantar quote falls back. Any
  new writer of those tables must call `bridgeMengantarAreas` too.
- **Owner-attached accounts (O11).** `ops/mengantar-attach-own-key.ts` attaches an account the store owner
  already owns (the demo store `batiknusantara` in production) with `partner_id` NULL. That NULL is the
  marker: `rotateStoreMengantarKey` and `refreshStoreMengantarKey` skip it (our partner never registered
  that seller; its key is managed in the owner's Mengantar app). Not a seller feature — there is still no
  key field anywhere in the product (D13).
