# ADR 0018 — Mengantar shipping: per-store seller accounts behind a platform provider switch

**Status:** accepted · **Date:** 2026-11-05 (recorded 2026-11-13) · **Decided by:** the owner — rulings O1–O11
in `specs/docs/tasks/2026-11-05-shipping-mengantar-decisions.md` (D7–D18 and the 2026-11-12 directions)
**Amends:** ADR 0004 (who owns the courier account), ADR 0015 (shipping money on a Mengantar-booked order)
**Supersedes:** none — KiriminAja stays the default provider and the COD path

> **Amended 2026-11-13 by [ADR 0019](0019-store-level-shipping-provider.md):** the provider is now chosen PER
> STORE (`stores.shipping_provider`, Super Admin or a signup code; default KiriminAja). D11 gains "∧ the store is
> set to Mengantar"; D14's automatic registration applies only to such stores (signup with a Mengantar code,
> or a store an operator moved), and `createStore` no longer queues an account. The switch below stays as the
> platform master kill-switch. Everything else in this record stands.

## 1. Context

Until 2026-11, every shipment went through ONE platform-owned aggregator account (KiriminAja, ADR 0004): the
platform quoted, booked and paid the courier, and ADR 0015 reconciled the difference against the Seller ledger.
The owner wanted Mengantar (the courier aggregator already used by the owner's other businesses) and, after a
first single-key design (D1, D4), ruled on 2026-11-05: *"create dari sana = seller punya akun mengantar …
menggantikan mengantar personal sebelumnya"* — every store gets its OWN Mengantar seller account, created by
TokoΦ through the Mengantar **Partner Business API**.

Why it had to be decided as architecture, not configuration:
- A per-store account means a per-store **secret** (the seller key travels in the URL path of every call),
  a per-store **wallet** that pays the courier, and per-store **consent** that Mengantar requires the partner to
  collect ("it has to happen on your side").
- Money changes owner: the courier is paid from the seller's Mengantar wallet, not by the platform.
- Two providers must coexist per order: an order quoted by one must be booked, tracked and cancelled by the same.

**Decision drivers:** sellers keep their own courier relationship and wallet (O3, O5); no store may lose
checkout because its account is missing or broken (O6); COD stays on the proven path (O4); no secret in a
browser, a log line or a seller-visible field (D13); the platform can switch providers centrally (O1).

**Non-goals:** Mengantar COD; bring-your-own-key (D13); webhooks (D16 — polling); removing KiriminAja;
the owner's 2026-11-12 "every store must use Mengantar" direction (recorded, not decided — see §6).

## 2. Considered options

- **A — One platform Mengantar key for every store (D1, the first design).** Good: no registration, no
  per-store secrets. Bad: one wallet, one booking lease and one RTS reputation shared by every store and by the
  owner's other business (risk R3); the platform carries every store's courier bill. Retired by the owner.
- **B — Sellers paste their own Mengantar key.** Good: simplest code. Bad: a secret field in the Seller UI,
  support load for wrong keys, no consent trail; refused (D13, "no bring-your-own-key").
- **C — TokoΦ registers a Mengantar seller account per store through the Partner API, behind a platform
  switch, KiriminAja as fallback and COD path (chosen).** Good: per-store wallet and reputation, zero-setup for
  the seller, central switch, safe fallback. Bad: a registration state machine, sealed per-store keys, a
  consent capture, and a dependency on Mengantar issuing the production Partner origin + IP allow-list (O2).

## 3. Decision

Chosen: **C**.

- **Switch.** `shipping_provider_config.active_provider` (Super Admin, owner rank) picks the default quoting
  provider for the platform. `MENGANTAR_ENV` must be named (`production` | `sandbox`); unset never means
  production.
- **Per-order dispatch (D11).** A quote goes to Mengantar only when switch = mengantar ∧ the order is not COD
  ∧ the store has a `connected` account for that env; otherwise KiriminAja. `apps/admin/lib/shipping-quote.ts`
  stays the ONE producer of a price. The order is stamped (`orders.shipping_provider`, plus `mg_env` /
  `mg_seller_id`) and booking, tracking and cancel follow the stamp, never the current switch.
- **COD never travels Mengantar (O4/O6).** The order route, `bookMengantar` and the quote all refuse it; a
  connected store's prepaid quote carries `codRequote: true` so choosing COD re-quotes on the default provider.
- **Accounts.** `store_mengantar_accounts` (PK `store_id, env`, RLS) holds the state machine (pending →
  registering → connected; awaiting_approval, email_taken, blocked, failed). Registration is automatic after
  signup approval and Super Admin creation (D14, D15), uses the owner's TokoΦ email (D13), and requires recorded
  owner consent (Terms + Privacy links, refused under impersonation).
- **Secrets.** The partner credential is per env in `shipping_provider_config`; each seller key is sealed with
  AES-GCM under `INTEGRATION_TOKEN_KEY`, scope `mengantar:<store>:<env>:<seller>:v<n>`, never shown, never
  logged (`redactKey`). Rotation regenerates through the Partner API.
- **Money (amends ADR 0015 for Mengantar-stamped orders, O3).** No TokoΦ ledger shipping debit: the seller's
  own Mengantar wallet pays the courier (`seller_debit_idr = 0`), and the buyer's shipping is passed through to
  the seller's TokoΦ balance. A short wallet leaves the booking unpaid until `pay-unpaid`; the AWB arrives later.
- **Brand (amends ADR 0004, O5).** Seller copy may say "Mengantar"; shoppers never see a provider brand.
- **Owner-attached account (O11, 2026-11-12).** Until the production Partner origin exists, ONE store — the
  demo store `batiknusantara` — runs on an account the owner already owns, attached by the owner-run
  `ops/mengantar-attach-own-key.ts`. Marker: a connected row with `partner_id` NULL; such a row is never
  rotated or refreshed through the Partner API. Not a seller feature; there is still no key field anywhere.

Affected: `packages/lib/src/{mengantar,mengantar-partner,provider-config}.ts`,
`packages/db/src/{mengantar-account,mengantar-bridges,seed-areas}.ts`, migration `0116`,
`apps/admin/lib/{shipping-quote,mengantar-shipping,mengantar-readiness}.ts`, `apps/admin/lib/actions/mengantar.ts`,
the Seller "Akun Mengantar" card, Super Admin `/pengiriman`, `/api/public/{ongkir,order}`, `cron/tracking`.

## 4. Consequences

- **Positive:** each store's courier bill, wallet and RTS reputation are its own; the seller does nothing to
  start; the platform can switch providers or fall back per store without a deploy; COD keeps its proven path.
- **Negative:** a seller with an empty Mengantar wallet gets unpaid bookings (no AWB) until they top up; two
  providers and a registration state machine to operate; area data needs a bridge (`kiriminaja_areas` /
  `kelurahan` → `mengantar_areas`, rebuilt on every deploy because the seed truncates those tables);
  production registration is blocked on Mengantar (O2) — today only the owner-attached demo store ships
  through Mengantar.
- **Neutral:** KiriminAja code, money rules (ADR 0015) and COD policy are unchanged for every order it books;
  an order's provider is a fact about the order, fixed at checkout.

## 5. Confirmation

- `apps/admin/lib/mengantar-shipping.test.ts`, `apps/admin/lib/shipping-quote-mengantar.test.ts` (the D11
  dispatch rule), `apps/admin/lib/mengantar-account.test.ts` (state machine, sealing scope, rotation fence,
  owner-attached rows), `apps/admin/lib/mengantar-readiness.test.ts`,
  `packages/lib/src/{mengantar,mengantar-partner}.test.ts`, `apps/super-admin/lib/mengantar-{credentials,ops}.test.ts`,
  `apps/admin/lib/mengantar-consent.test.ts` (consent shown, impersonation refused),
  `packages/db/src/mengantar-bridges.test.ts` (bridge survives the deploy-time truncate),
  `packages/lib/src/provider-label.test.ts` (no brand reaches a shopper).
- Production evidence: BUILD-LOG 2026-11-12 (demo store quotes through Mengantar; COD and other stores stay on
  KiriminAja) and 2026-11-13 (sandbox `idempotencyKey` replay = one shipment).
- Rules: `specs/docs/rules/shipping-cod.md` (Mengantar section); secrets: `specs/docs/SECURITY.md`.

## 6. More information

- Open: O2 (production Partner origin + allow-listed IP); `idempotencyKey` replay in production; the first real
  Mengantar booking + cancel on production (test order `PHI-555925447U5H`, 2026-11-13).
- **Revisit** when the owner rules on the 2026-11-12 direction "every store must use its own Mengantar account":
  it touches consent for stores whose owner never agreed, `email_taken` versus D13, and whether D11's
  KiriminAja fallback stays. That ruling is a new ADR superseding the fallback part of this one.
- Design and contract notes: `specs/docs/tasks/2026-11-05-mengantar-integration-analysis.md`; KiriminAja flow
  backup: `specs/docs/tasks/2026-11-05-kiriminaja-shipping-flow-backup.md`; ops: `specs/docs/DEPLOY.md`.
