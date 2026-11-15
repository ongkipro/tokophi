# SHIP-MENGANTAR — Mengantar Partner Business API: owner decisions (2026-11-05)

Context: `2026-11-05-kiriminaja-shipping-flow-backup.md` (current system), `2026-11-05-mengantar-integration-analysis.md` (target).

| # | Decision | Owner answer | Consequence |
|---|---|---|---|
| D1 | Mengantar account | **Same account / API key as adsbookcms** (`MENGANTAR_API_KEY`) | Risk R3 accepted: the booking lease, wallet, POS-COD delivered rate and RTS reputation are shared with adsbookcms and every TokoΦ store. Reconciliation must match strictly by the `cnote_no` / `_id` TokoΦ issued. The platform-wide lease cannot see adsbookcms traffic — expect occasional 409s and retry with backoff. |
| D2 | Scope of phase 1 | **Phased, safe**: provider switch in Super Admin, Mengantar client, 99ribu area data, quote + checkout + booking + tracking + cancel for **non-COD** | COD via Mengantar stays OFF until one SPX COD booking is proven in production with explicit owner approval (risk R6). |
| D3 | Branch | **Separate**: `feat/shipping-mengantar` (worktree `~/Projects/tokophi-shipping-mengantar`) | The storefront redesign (`feat/storefront-redesign`) and this money-path change are reviewed and merged independently. |
| D4 | Environment | **Production Mengantar API only** (no sandbox), as adsbookcms | No rehearsal environment: tests use mocked fetch only; the first real booking + cancel is a single owner-approved action. |
| D5 | Migration number | Next after `origin/main` (`0115`) → written as `0116`; PR #424 also claims 0116–0122 | Renumber **and re-stamp** at merge time per `specs/docs/rules/migrations.md`; never applied to the shared `tokophi` DB before merge — local work uses the clone `tokophi_shipping`. |
| D6 | AutoLaris (payments) | In adsbookcms an AutoLaris "scan / delivered" notification means money arrived but still needs manual verification. **In TokoΦ, money in ⇒ confirmed automatically, no manual verification.** | To verify against TokoΦ's current `api/public/pay/callback` before any change. |

## Partner model (2026-11-05, second round) — supersedes D1 and D4

Owner, 2026-11-05: *"harusnya pakai sandbox kita ya beda api … create dari sana = seller punya akun mengantar"*,
and *"menggantikan mengantar personal sebelumnya"*. The single platform key (D1) and "production only" (D4)
are retired: every store gets **its own Mengantar seller account**, created by TokoΦ through the Mengantar
Partner Business API. Contract details: Mengantar partner docs (private, kept off-repo).

| # | Decision | Owner answer | What the code does |
|---|---|---|---|
| D7 (O1) | Partner account | *"akun sama saat ini, kedepan mungkin bisa ganti"* — the same partner account as GeraiExpress for now | Partner id + secret are **swappable config**: an encrypted row per env in `shipping_provider_config` (Super Admin → Pengaturan → Kurir, owner rank, probed before saving) with `MENGANTAR_PARTNER_ID` / `MENGANTAR_PARTNER_SECRET` as env fallback; never hard-coded. Each seller row records `partner_id` (which partner registered it). The 60/min + 1,000/day partner limits are SHARED with GeraiExpress while this lasts. |
| D8 (O3) | Prepaid shipping on a Mengantar order | Pass it through to the **seller's** TokoΦ balance; the seller pays the courier from their own Mengantar wallet | No ledger debit for Mengantar bookings (`seller_debit_idr = 0`, no `shipping-*-debit`). `creditSaleForPayment` and the view `order_seller_entitlements` (`shipping_pass_through_idr`, 0116) add the buyer-paid shipping on `shipping_provider = 'mengantar'` orders. FINANCE.md §2. |
| D9 (O4) | COD via Mengantar | Stays **OFF** | A COD order is quoted with `cod: true` → always the default provider; the order route and `bookMengantar` still refuse a Mengantar COD. |
| D10 (O5) | Brand on the Seller surface | Seller UI **may say "Mengantar"**; shoppers never see a provider brand | ADR 0004 relaxed for the Seller only: `provider-label.test.ts` keeps the Mengantar pattern on the storefront, the landing site and `apps/admin/app/api/public/**`. KiriminAja / AutoLaris stay hidden everywhere. ADR 0004 carries an addendum. |
| D11 (O6) | Store without a connected account while the switch is on Mengantar | **Falls back to KiriminAja** for quotes and booking; COD always KiriminAja ("COD default = KiriminAja") | `quoteShipping` quotes Mengantar only for (switch = mengantar) ∧ (not COD) ∧ (store connected); else KiriminAja. The order stamp (`orders.shipping_provider`) records who actually quoted; booking/tracking follow the stamp. |
| D12 | (consequence of D11) COD on a CONNECTED store's checkout | — **closed 2026-11-05** | The prepaid quote of a connected store answers `codRequote: true` (a neutral flag; no provider name reaches the shopper). Picking COD re-quotes the same destination with `cod: true` (the default provider, the route `/api/public/order` re-makes for a COD order); leaving COD re-quotes without it, so the rates on screen always match the payment method. A COD quote with no COD-capable service drops COD for that destination with the existing hint. Browser-proven against a stubbed ongkir API (`checkout.astro`, BUILD-LOG 2026-11-05 08:20). |
| D13 (O7) | Existing Mengantar users | **No bring-your-own-key.** Always registered NEW with the email registered with us (the store owner's TokoΦ email) | `connectStoreMengantar` registers with `users.email` of the store owner; a 409 (email already a Mengantar user) → state `email_taken`, a clear Seller message, store stays on KiriminAja. No key field exists anywhere. |
| D14 (O10) | Who connects, when | *"jangan lock by sistem — yang terhubung akun Mengantar ketika daftar di kita aja"* | Automatic: signup (`provisionStore`) and Super Admin `createStore` queue the account (`pending`), never awaited, never failing store creation. One-click **"Hubungkan Mengantar"** in Seller Pengaturan → Pengiriman (owner only, `settings:write`, one consent line). The key is fetched from the Partner API, sealed (AES-GCM, scope `mengantar:<store>:<env>:<seller>:v<n>`), never shown. Rotation = system (regenerate once; a lost answer is recovered with get-key) by the store owner or Super Admin owner rank. Failures leave the store on KiriminAja; the cron (`cron/tracking`) retries queued rows. |
| D15 | self-serve signups — **owner confirmed 2026-11-05 ("sistem approval tetap berlaku")** | — | A self-serve store is born unapproved and its email is unproven (0090). Registration WAITS for approval (`awaiting_approval`), and `approveStore` releases it — Mengantar holds the partner responsible for the accounts it opens. |
| D16 (O9) | Tracking | Polling | The existing cron sweep pulls each order with ITS OWN account (`mg_env` + `mg_seller_id` → that store's key). The Mengantar webhook route was removed (per-seller secrets, set only by the seller). |
| D17 | Environment | Sandbox first | `MENGANTAR_ENV` = `sandbox` (default) \| `production`, fixed origin table. Production Partner origin is unknown → production onboarding is queued (`configuration_blocked`) until Mengantar provides it (+ the allow-listed VPS IP). |
| D18 | Pickup mode | — | Sandbox lists no pickup slots, so `MENGANTAR_PICKUP_MODE=dropOff` (or the booking option) books drop-off; production default stays `scheduledPickup` (with the now-required `volume`). |

## Owner ruling 2026-11-13 — the provider is chosen PER STORE (ADR 0019, `SHIP-PROVIDER-PER-STORE`)

Owner: *"jadi ada 2 → seller bisa KiriminAja (ekspedisinya) atau Mengantar. Super admin yang menentukan dan atau
via code ketika register."* · *"default pakai KiriminAja, soalnya kalo Mengantar harus double register"* ·
*"bentuk kode daftar dari super admin aja, yang boleh mengganti ya super admin"*. This settles the 2026-11-12
direction below the other way: Mengantar is per store and opt-in by the platform, not mandatory.

| # | Point | Ruling / default | Code |
|---|---|---|---|
| P1 | Who decides a store's provider | Super Admin, or a signup code at registration; never the seller | `stores.shipping_provider` (0117), `setStoreShippingProvider` |
| P2 | Default | KiriminAja; a Mengantar account only for a store set to Mengantar | sink checks in `mengantar-account.ts`; `createStore` no longer queues |
| P3 | Signup codes | made in Super Admin (owner-confirmed), each maps to a provider; unknown/inactive → refused | `signup_codes`, `/kode-daftar`, `provisionStore` |
| P4 | Rank | "super admin" — rank not named; **default owner**, ONE constant `SHIPPING_PROVIDER_MIN_RANK` (owner-confirmable, one line to lower) | `store-shipping-provider.ts`, `route-roles.ts` |
| P5 | Platform switch | kept as the master kill-switch (`kiriminaja` = Mengantar off for all) | `quoteShipping` |
| P6 | COD | unchanged — always KiriminAja (O4/O6) | `quoteShipping` |

Production effect of 0117: only stores already holding a `connected` account become `mengantar` — the demo store
`batiknusantara`. Stores whose signup queued a `pending` row become KiriminAja and are no longer registered.

## Owner direction 2026-11-12 — every store on its own Mengantar account (NOT implemented yet) — superseded 2026-11-13 by ADR 0019 (above)

Owner: *"nanti masing-masing toko wajib pakai akun mengantar / register akun mengantar ulang yang belum sync
dengan mengantar"*. Target state: no store stays on the KiriminAja fallback for lack of an account; every
store that is not synced is (re-)registered through the Partner API. Today's code already registers every
consented store automatically (signup, approval, the production sweep carries pre-go-live consent) — what
"wajib" adds, and what still needs a ruling before code:
- **Consent stays per owner** (Mengantar partner docs): a store whose owner never agreed (Super Admin-created,
  older than the consent line) can be QUEUED and nagged (Dashboard banner) but not registered silently.
- **`email_taken`** (owner email already a Mengantar user; D13 = no bring-your-own-key) cannot be registered
  "again" with the same email — the owner changes the TokoΦ login email, or D13 is revisited.
- **D11 fallback** (unconnected → KiriminAja) is the shopper's safety net while any store is unsynced; making
  Mengantar mandatory means deciding what checkout does for a store that is still not connected.
- Blocked on the production Partner origin + IP allow-list (O2) like everything else in production.

Also 2026-11-12 (owner): the demo store `batiknusantara` (`toko.tokophi.com`) ships from the Surabaya warehouse
registered on the existing Mengantar seller account — Jl. Pakis Tirtosari X No. 5, Pakis, Sawahan, Surabaya
60256 (Mengantar area `5fc6461cf8f44b34aa4cd7f8`); editable in Seller → Pengaturan → Alamat.

Still open (re-checked 2026-11-13): O2 (production Partner origin + allow-listed IP), and whether `idempotencyKey`
replays in PRODUCTION (sent, not relied on — the sandbox half is answered below). Closed: **O8** — the consent line
links Mengantar's live Terms + Privacy pages, verified 2026-11-11 (§ Consent below; `components/admin/mengantar-consent.tsx`);
**D12** — closed 2026-11-05 (table above).

### `idempotencyKey` replay — sandbox measured twice (SHIP-MENGANTAR-IDEMPOTENCY, 2026-11-13)

**Verdict (sandbox): the same key + the same body creates ONE shipment.** Re-measured 2026-11-13 07:50 UTC with
`ops/mengantar-sandbox-idempotency.ts` (real client `mgCreateOrder`, sandbox origin hard-coded, a sandbox seller key
read in-process from `secrets-env`, JT drop-off, 1 kg non-COD, one `destinationMark` per run, sequential calls):

| Call | Key / body | HTTP | Result |
|---|---|---|---|
| A | K1 / P | 200 | `_id …7659`, ORDER_ID `261113AI5F2J`, batch `26111314T6Z3Y4` |
| B | K1 / P (replay, +3 s) | 200 | the SAME `_id`, ORDER_ID and batch as A — no second shipment |
| C | K2 / P (control) | 200 | a NEW `_id …768d` (ORDER_ID `261113JBNWE4`) — Mengantar does not dedupe on `destinationMark` |
| D | K1 / P′ (one field changed) | 422 | `IDEMPOTENCY_KEY_REUSED`; our client throws `MengantarOutcomeUnknownError` (conservative) |

Read-back (`GET /order?batch=` per batch + `?order_id=` per ORDER_ID): exactly **2** live shipments carried the run's
mark (A=B and C). Both cancelled (`DELETE /order` → `deletedCount` 1 each); afterwards both batches list 0 rows and
both ORDER_IDs read back `isDeleted: true`. **Leftovers: none.** Same result as the first probe (2026-11-05, BUILD-LOG).

Limits of the evidence: sandbox only (production still unproven — measuring it books a real parcel on a real wallet);
both bookings came back `isPaid:false`, `cnote_no:null` (sandbox wallet did not pay), so a replay of a PAID booking
was not observed; the 24 h retention (M19) and a replay while the first request is still in flight were not tested
(the second would violate the one-POST-per-account rule).

What it means for our code: the key is minted per ATTEMPT (`tokophi-${bookingId}`,
`apps/admin/lib/mengantar-shipping.ts:543`), so it is only ever re-sent inside `createWith409Retry` (`:364-371`).
A lost answer does not replay — it leaves the booking `unknown` (`:561`) and the claim (`:454-513`, partial unique
index `shipment_one_active_per_order`) refuses every re-book until an operator reconciles. So no double-book window
exists today whichever way production behaves; the key is a second net, not the first. Possible follow-up (not
done, main-session decision): an `unknown` booking younger than 24 h could be reconciled by RE-SENDING its stored
payload with the SAME key — in the sandbox that returns the original `_id` instead of a second parcel — but only
after the same is seen in production.



## Consent (owner ruling 2026-11-11) — refines D14

Owner: *"1 boleh kamu sesuaikan dan sempurnakan textnya juga ui ux nya"* and *"bukannya daftar ke kita akan otomatis
terhubung ke mengantar?"* — yes: **signing up still creates the store's Mengantar account automatically** (after
approval, D15). What changed is that it is now AGREED to, as the Mengantar Partner docs require ("Get their agreement
to the Mengantar Terms and Conditions and Privacy Policy … it has to happen on your side"):

| Path | Consent | What happens |
|---|---|---|
| Signup (`/daftar`, form or Google) | the sentence under the form, on every step, links Mengantar's [Terms](https://www.mengantar.com/terms/) + [Privacy](https://www.mengantar.com/privacy-policy/) and TokoΦ's privacy page | recorded (`consent_source = signup`, the new owner) → registered after approval |
| Seller "Hubungkan Mengantar" | the same agreement next to the button | recorded (`pengaturan`, the clicker) → registered now |
| Super Admin `createStore` / approval / retry, cron | none — the owner never saw anything | **no registration, no call**: row `pending` + `awaiting_consent`; the card says "Perlu persetujuan" and the Dashboard banner asks the owner to connect |

Code: `connectStoreMengantar` refuses without `consented_at` (test "no owner consent …"); `components/admin/mengantar-consent.tsx`
holds the sentence and URLs (guard `lib/mengantar-consent.test.ts`). O8 (which T&C/Privacy versions) is answered by
linking Mengantar's live pages, verified 2026-11-11.
