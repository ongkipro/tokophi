# ADR 0019 — Store-level shipping provider, chosen by Super Admin or a signup code

**Status:** accepted (owner, 2026-11-13) · **Date:** 2026-11-13 · **Task:** `SHIP-PROVIDER-PER-STORE`
**Amends:** ADR 0018 — the dispatch rule (D11) and automatic registration (D14) · **Supersedes:** none
**Number is provisional until merge** (the paused `feat/kelola-plugin` drafted a local 0019) — re-scan
`specs/decisions/` before merging and renumber if taken.

## 1. Context

ADR 0018 put Mengantar behind ONE platform switch: when `shipping_provider_config.active_provider` =
`mengantar`, every store with a connected account quoted Mengantar, and signup (`provisionStore`) and Super
Admin `createStore` queued a Mengantar account for EVERY store (D14). The owner ruled on 2026-11-13:

- *"jadi ada 2 → seller bisa KiriminAja (ekspedisinya) atau Mengantar. Super admin yang menentukan dan atau
  via code ketika register."*
- *"default pakai KiriminAja, soalnya kalo Mengantar harus double register"* — a store is on KiriminAja unless
  Super Admin (or a signup code) puts it on Mengantar, and a Mengantar seller account is created ONLY for a
  store set to Mengantar.
- *"bentuk kode daftar dari super admin aja, yang boleh mengganti ya super admin"* — signup codes are made in
  Super Admin; only Super Admin changes a store's provider.
- The seller never chooses. COD stays KiriminAja (O4/O6, unchanged).

This also answers ADR 0018 §6's open "every store must use Mengantar" direction (2026-11-12) in the other
direction: Mengantar is per store, opt-in by the platform, not mandatory.

## 2. Considered options

- **A — Keep one platform switch, register everyone (ADR 0018 as is).** Refused by the owner: double
  registration for sellers who never asked for Mengantar.
- **B — Seller picks the provider in Pengaturan.** Refused: "Super admin yang menentukan".
- **C — A per-store provider column set by Super Admin or a signup code; the platform switch stays as the
  master kill-switch (chosen).**

## 3. Decision

Chosen: **C**.

**Data (migration 0117).** `stores.shipping_provider text not null default 'kiriminaja'` (CHECK in
`kiriminaja`, `mengantar`). `signup_codes(code PK, shipping_provider, active, note, created_by, …)` — platform
table, RLS on with no policy (owner pool only, like `impersonation_grants` / `rate_limit_counters`).
`stores.signup_code` → FK `signup_codes(code)` ON DELETE RESTRICT; codes are deactivated, never deleted, and the
usage count is derived from this column. Backfill: a store holding a `connected` Mengantar account in any env →
`mengantar` (production on 2026-11-13: the demo store `batiknusantara` only).

**The dispatch — still ONE function (`apps/admin/lib/shipping-quote.ts` → `quoteShipping`).**

| platform switch | store provider | order | account | quoted by |
|---|---|---|---|---|
| kiriminaja | any | any | any | **KiriminAja** (kill-switch: Mengantar off for everyone) |
| mengantar | kiriminaja | any | any — even connected | **KiriminAja** (the account is never opened) |
| mengantar | mengantar | COD | any | **KiriminAja** (O4) |
| mengantar | mengantar | prepaid | not connected | **KiriminAja** (fallback, O6) |
| mengantar | mengantar | prepaid | connected | **Mengantar** (the store's own key) |

Plus the ADR 0018 conditions that stay: `MENGANTAR_ENV` must be named in the pricing process, and a
Mengantar quote that cannot sell anything falls back. The order stamp (`orders.shipping_provider`) and
booking / tracking / cancel following the stamp are unchanged — moving a store never moves an order.

**Registration — only for a store set to Mengantar, enforced at the sink.** `connectStoreMengantar`,
`enqueueMengantarConnect`, `requeueMengantar` (hence `kickMengantarConnect`) and the retry sweep
(`retryMengantarAccounts`, incl. the sandbox→production carry-over) check `stores.shipping_provider` first, so
no door — signup, `createStore`, approval, cron, the Seller button, an operator retry — can register a
KiriminAja store by forgetting to ask. One exception: a `registering` row (a register call that may already
have landed) is still reconciled after the store was moved away, never abandoned half-made.

**Signup codes.** `/daftar` has an optional "Kode daftar" field, pre-filled from `?kode=`. The code is
normalised (trim, upper-case; `@tokophi/lib/signup-code`) and re-read **inside the signup transaction**
(`FOR SHARE`); an unknown, inactive or malformed code is **refused** with one sentence — never silently
ignored, because a typo landing a store on the wrong provider is the worse failure. The Google door carries the
code through an httpOnly cookie to the same boundary (`provisionStore`).

**Consent (partner docs: it "has to happen on your side").** The Mengantar consent sentence appears on
`/daftar` ONLY when the entered code maps to Mengantar; a hidden field posts the code it was shown for, and the
server records consent only when that equals the submitted code. Without it (or with a KiriminAja code) no
provider is named on the page (ADR 0004) and no consent is recorded; a Mengantar store created without consent
waits (`awaiting_consent`) for the owner's "Hubungkan Mengantar" click.

**Super Admin.** Store page → "Penyedia pengiriman": move one store, reason required (≥ 5 chars), outcome
re-read via `.returning()`, audit line in `platform_activity` naming before → after, operator and reason.
Moving TO Mengantar queues an account only if the store has none (`pending` + `awaiting_consent`, never
registered without the owner's consent); moving AWAY leaves the account row. `/kode-daftar`: list, create,
deactivate / re-activate, derived usage count. `/pengiriman` shows each store's provider. `createStore`
no longer queues an account (a store is born on KiriminAja).

**Rank — ONE constant.** `SHIPPING_PROVIDER_MIN_RANK` (`apps/super-admin/lib/store-shipping-provider.ts`) =
**owner**: it gates `setStoreShippingProvider`, `createSignupCode`, `setSignupCodeActive` and is the
`/kode-daftar` route floor. The owner named "Super Admin" without a rank; owner matches the platform switch and
the partner credential. Lowering it to `admin` is that one line (plus the route-roles test row that records the
change of mind).

**Seller.** The "Akun Mengantar" card, the Dashboard Mengantar banner and the Jasa Kirim Mengantar note
render only for a store on Mengantar; `getMengantarCard()` answers `null` otherwise and the card renders
nothing, not even a loading state. KiriminAja sellers see nothing new.

## 4. Consequences

- **Positive:** no store is registered at Mengantar unless the platform put it there; the owner can onboard
  Mengantar sellers in batches with a code; the switch remains an instant, platform-wide kill-switch.
- **Negative:** production stores whose signup queued a `pending` Mengantar row become KiriminAja stores and are
  no longer registered (their rows stay as history; moving the store to Mengantar picks them up again). A code is
  a lightly-guarded selector on a public form (see SECURITY.md) — what a guessed code buys is a self-serve store
  on a provider, still locked until approval.
- **Neutral:** ADR 0015 money rules, the order stamp, COD policy and the Mengantar account state machine are
  unchanged.

## 5. Confirmation

`apps/admin/lib/shipping-quote-mengantar.test.ts` (the truth table above, 7 rows),
`apps/admin/lib/mengantar-account.test.ts` (suite "ADR 0019 — only a store set to Mengantar gets an account"),
`apps/admin/lib/mengantar-consent.test.ts` (sentence only for a Mengantar code, bound to it; mutation-proved),
`apps/admin/lib/signup-code.test.ts` (signup boundary against the real DB),
`apps/super-admin/lib/store-shipping-provider.test.ts` (decisions, one rank constant, call sites),
`apps/super-admin/lib/route-roles.test.ts` (`/kode-daftar` floor), `packages/lib/src/signup-code.test.ts`
(normaliser = migration CHECK).

## 6. More information

- Owner-confirmable before merge: the rank (owner vs admin) — one line, above.
- Production data note: the migration's backfill flips only the demo store; nothing else changes provider.
- ADR 0018 keeps everything not named here (partner model, sealed keys, wallet, owner-attached account).
