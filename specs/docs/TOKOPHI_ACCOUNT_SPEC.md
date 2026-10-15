# TokoΦ Account — Global Buyer Identity and UX Specification

> **Status — 2026-10-15: LOCAL DEVELOPMENT AUTHORISED, PRODUCTION RELEASE NOT DECIDED.** The owner
> directed local development of the buyer account ("sambil kita develop local kebutuhan akun user
> (pembeli)", 2026-10-15). That moves root `TASKS.md` Task 5.8 from "build, defer or drop" to
> "build locally"; whether and when it ships is still Task 5.8. [ADR 0016](../decisions/0016-global-buyer-account.md)
> remains **PROPOSED** — its draft lives on `feature/buyer-account-local` (`8dc12d7`) and is not
> accepted here. Sections 1–15 are that branch's 2026-08-12 draft, carried verbatim as the working
> product contract; §17 is the implementation plan against `main` as of 2026-10-15.
>
> **Canonical ownership:** This document owns global buyer-account behavior, object lifecycle, buyer/merchant projections, UI/UX contracts, and the account implementation plan (§17). [`SECURITY.md`](SECURITY.md) owns authentication/control requirements; [`PRIVACY-COMPLIANCE.md`](PRIVACY-COMPLIANCE.md) owns applicability, consent/rights/retention gates (still a stub); `packages/db/src/schema.ts` owns implemented storage; [`../openapi/account.yaml`](../openapi/account.yaml) will own HTTP operations once written. Execution state lives in root `TASKS.md` Stage 10.
>
> **Superseded draft:** `PRD-BUYER-ACCOUNT.md` (account-ux-local branch, 2026-09-26) and its copy in [`tasks/2026-09-26-buyer-account-prd.md`](tasks/2026-09-26-buyer-account-prd.md) are research input, not a second PRD. Where they disagree with this file, this file wins — see §17.6.
>
> **Prototype:** [`../../prototypes/tokophi-account/`](../../prototypes/tokophi-account/) (fixture-only; design notes in its `DESIGN.md`). Prototype acceptance is UX evidence only, never auth, privacy, API or database evidence.

## 1. Product intent

TokoΦ Account gives a buyer one identity and one order hub across participating TokoΦ merchants while preserving each merchant's independent customer and order ownership.

### Core invariant

```text
Buyer: may see their own linked orders across stores.
Merchant: may see only its own customer projection and store-owned orders.
Platform: may join the layers only through the accepted identity service and audited link.
```

### Initial value

- One phone-verified account.
- Cross-store order history and tracking.
- Order-derived store history with a safe return-to-store path.
- Saved contact and delivery addresses.
- Faster returning-buyer checkout through explicit store authorization, prefill review, and confirmation.
- Order claim, unlink, and closure workflows.

### Non-goals

- Payment vault, saved card, wallet, balance, credit, or financing.
- Required login before checkout.
- Cross-store cart or checkout.
- Cross-store buyer data shown to merchants.
- Global merchant CRM segmentation or advertising audiences.
- Loyalty, referrals, subscriptions, social features, reviews, returns, or refunds.
- Shared cookies across tenant/custom domains.

## 2. Actors and jobs

| Actor | Primary job | Scope | Must never gain |
|---|---|---|---|
| Guest buyer | Complete checkout without registration | One store/order | Global order history or another person's claim |
| TokoΦ buyer | View own cross-store orders, return to stores previously purchased from, reuse contact/address, control account | Own global subject and consented links | Merchant-internal notes, financial/provider/platform data |
| Merchant staff | Serve the buyer for this store | Own tenant customer/orders | Other-store orders, global addresses, sessions, aggregate spend |
| Platform support | Resolve narrowly approved identity/recovery cases | Capability- and case-scoped | OTP plaintext, permanent buyer impersonation, unrestricted merchant projection |
| Identity service | Verify, authorize, revoke, project | Global identity boundary | Merchant business decisions or payment custody |

## 3. Canonical objects

### Global buyer subject

Owns:

- stable opaque subject ID;
- verified phone identifier and optional email;
- profile display values;
- verification/recovery state;
- central sessions/devices;
- global saved addresses;
- consent and store-link records;
- account lifecycle/audit;
- bounded cross-store order and order-derived store-history read models.

It does not own merchant notes, segments, checkout-session marketing state, payment/ledger truth, or fulfillment mutations.

### Store customer projection

The existing `customers` row remains owned by one `store_id`. It carries the name/contact and CRM relationship that merchant legitimately uses for its own commerce. Physical rows are never merged across stores.

### Buyer/store/customer link

Proposed association:

```text
buyer_store_links
- buyer_subject_id
- store_id
- customer_id
- status: pending | active | revoked
- consent_version
- consented_at
- linked_at
- revoked_at
- claim_method
- last_verified_at
```

The exact schema is not accepted until data/security review. The semantic contract is accepted: this audited link is the only bridge between global identity and store-scoped commerce.

### Order projection

Orders remain tenant-owned. The global hub receives only an allowlisted projection:

- merchant public name/logo/contact;
- order number/date;
- item identity, quantity, accepted price snapshot;
- totals and safe payment status;
- fulfillment status, courier, AWB/tracking;
- immutable delivery snapshot;
- merchant support link.

Excluded:

- merchant notes/tags/segments;
- fraud/risk labels;
- cost, margin, payout, ledger, invoice internals;
- provider secrets/IDs not intended for buyers;
- another customer or store aggregate;
- staff/platform audit records.

## 4. Lifecycle

### Buyer account

| State | Meaning | Entry | Exit |
|---|---|---|---|
| `absent` | No global subject | Guest | Verification accepted |
| `verification_pending` | Challenge exists, no account access | Start sign-in/create/claim | Verified, expired, locked, cancelled |
| `active` | Normal account | Successful verification/recovery | Suspended or closure pending |
| `recovery_pending` | Sensitive recovery under policy | Approved recovery start | Active, cancelled, suspended |
| `suspended` | Access disabled; commerce records unchanged | Abuse/support/security decision | Approved recovery/reactivation or closure |
| `closure_pending` | Reversible delay if policy requires | Buyer closure request | Cancelled or closed |
| `closed` | Credentials/sessions disabled and convenience data processed | Closure completion | No automatic reactivation |

### Store link

| State | Buyer visibility | Merchant visibility | Transition |
|---|---|---|---|
| `none` | Store/order not in hub | Ordinary guest/customer | Buyer starts connect/claim |
| `pending` | Safe pending state only | No global identity detail | Verification + consent + proof |
| `active` | Store orders allowed by projection | Connected/verified indicator only | Buyer unlink, account closure, security revoke |
| `revoked` | Link no longer used for new aggregation | Connection removed/revoked | New explicit consent required |

Revoking a link never deletes or mutates the store's historical order/payment/ledger records.

## 5. Primary journeys

### A. Guest checkout then connect

1. Buyer completes checkout as guest.
2. Commerce backend confirms order.
3. Success page offers an optional TokoΦ Account connection.
4. Buyer starts a central account flow; checkout success remains visible/recoverable.
5. Central origin verifies the buyer and requests explicit store-link consent.
6. Historical/new order is linked only after accepted proof.
7. Failure, expiry, cancellation, or provider outage leaves the order untouched.

### B. Returning buyer at another store

1. Buyer chooses `Masuk dengan TokoΦ` from Store B.
2. Store B redirects to `account.tokophi.com/authorize` with exact redirect URI, state, PKCE challenge, store client identity, and requested scopes.
3. Central origin authenticates/reuses its own session and shows what Store B requests.
4. Buyer accepts or declines connection/data sharing.
5. Central origin returns one short-lived, single-use authorization code.
6. Store B's same-origin BFF exchanges the code and receives only the accepted projection.
7. Store B creates a host-scoped session; the cart remains local and unchanged.

Declining or failing authorization returns the buyer to the same cart/checkout state with guest checkout available.

### C. Cross-store order hub

1. Buyer opens the central hub.
2. Orders are grouped/filterable by status and identifiable by merchant.
3. Buyer opens a detail projection with immutable line-item titles and prices, canonical order and financial states, accepted totals, fulfillment, tracking, immutable delivery snapshot, bounded payment state, and merchant support path.
4. Store-specific actions redirect to the responsible merchant where applicable.

### D. Return to a previously purchased store

1. Buyer opens `Toko`, an order-derived list of merchants represented in eligible linked or claimed orders.
2. Each entry shows enough recent-order context to distinguish the store without exposing merchant-internal customer data.
3. The buyer opens a connected-store profile with bounded order context and any currently advertised voucher projection.
4. `Kunjungi toko` opens that merchant's current promo hub; it never recreates an old cart or order and never claims that a voucher is reserved or applicable.
5. The destination storefront revalidates the current catalog, publication state, variant availability, price, promotion, quota, and stock.
6. Optional future favorites/following remain a separate product decision; store history does not imply that the buyer follows a merchant.

### E. Historical order claim

1. Buyer provides or follows an order-specific access path.
2. System verifies the central identifier and order-specific possession proof.
3. Buyer sees merchant identity and exact link consequences before consent.
4. Successful claim creates/activates the store link and adds eligible orders.
5. Phone match alone never enumerates or exposes prior orders.

### F. Saved-data checkout

1. Buyer explicitly signs in or authorizes the current store; guest checkout remains available.
2. Store receives only the accepted contact projection and the global saved address selected for this checkout. A reusable Indonesian address must carry the courier destination/district ID needed to quote honestly, not only display text.
3. Checkout presents the prefilled data as a reviewable summary, never as a silently accepted order.
4. Buyer validates the recipient, phone, postcode, selected district, and delivery address, then confirms or edits them. The UI may display `+62`; the existing order boundary normalizes the submitted phone to canonical `62…`.
5. Shipping availability, service/rate, promotions, inventory, tax, COD eligibility, and totals are recalculated before final order confirmation. The displayed item price may be submitted only as a stale-cart assertion; it never prices the order. A `409` repricing response updates the cart and requires explicit reconfirmation.
6. Accepted order stores its immutable contact, line-item, amount, courier/service, and shipping snapshots.
7. Later profile/address edits or account unlinking do not change historical orders.

### G. Sign-out, unlink, and closure

- Sign-out affects the selected central/tenant session as defined; revoke-all terminates every central session and invalidates dependent grants according to policy.
- Unlink stops future global aggregation for that store and removes reusable projection access; store commerce records remain.
- Closure revokes credentials/sessions immediately, processes global convenience data, and leaves store records under approved retention/anonymization rules.

### H. Buyer notification center

1. Buyer opens the contextual notification center from the global account topbar; it does not become a fifth primary navigation destination.
2. Items are bounded projections of buyer-visible order, fulfillment, payment, or explicitly consented store-promotion events.
3. Order actions resolve through the canonical `PHI-` order number; promotion actions open the responsible connected-store profile.
4. Read state and delivery preferences remain private to the buyer. Merchant CRM notes, platform billing, advertising outbox events, and other-store customer data never appear.
5. The local prototype stores read state only for the current session. Production requires an accepted event source, retention policy, preference model, delivery pipeline, and API.

### I. Store voucher handoff

1. A connected-store profile may advertise a voucher only when the store-owned projection says it is not disabled, is inside its time window, and has not exhausted a known usage limit.
2. The account displays code, benefit, minimum purchase, and expiry as non-authoritative discovery metadata.
3. `Salin kode` copies text only; it does not apply, reserve, or validate the voucher.
4. `Kunjungi toko` opens the canonical merchant promo hub. The merchant checkout remains authoritative for cart minimum, flash-sale interaction, quota races, final discount, shipping, tax, stock, and total.
5. An unprovisioned storefront has no external action and no fabricated voucher inventory.

## 6. Screen contracts

### Global account shell

**Conceptual origin:** `account.tokophi.com`.

**Navigation:** clean same-origin paths `/orders`, `/stores`, `/addresses`, and `/account`. Mobile uses the same four-destination app navigation; nested transaction routes are `/orders/{PHI-number}`, `/orders/{PHI-number}/receipt`, `/orders/{PHI-number}/tracking`, and `/orders/{PHI-number}/payment`. Notifications remain contextual at `/notifications`. No merchant storefront branding may imply that one merchant owns the account.

**Entry distinction:** `tokophi.com` is the seller-focused public site and its generic `Masuk` action leads to the email/password `Dashboard Seller` at `app.tokophi.com/login`. Buyer authentication belongs to the separate account origin, is labelled `Akun Pembeli`, uses the phone number used at checkout, and provides a secondary explicit seller-portal escape. Buyer and seller sessions, credentials, roles, and audiences never overlap.

**Persistent prototype label:** `Prototype Akun TokoΦ · Data lokal` on every local-only screen.

### Overview

- Account identity and verification status.
- Active order summary.
- Recent cross-store orders.
- Saved-address summary.
- Connected-store summary with privacy explanation.
- Primary action follows current job, never generic marketing CTA.

States: loading skeleton, no orders, one store, many stores, partial provider/order projection failure, expired session, suspended account.

### Orders list

- Filters: Semua, Aktif, Selesai; filters are URL-addressable in the eventual implementation.
- Each item shows merchant, order number, date, status, total, and next relevant fact.
- Empty result differs from load failure.
- Pagination/cursor behavior must preserve filters and back-navigation.

### Order transaction surfaces

- `/orders/{PHI-number}` is the transaction overview: merchant identity and support route, canonical order and financial states, immutable lines, accepted totals, delivery snapshot, and links to the bounded receipt, tracking, and payment views.
- `/orders/{PHI-number}/receipt` is labelled `Bukti pesanan` or `Rincian transaksi`, uses the canonical `orders.number` `PHI-…` identity, and may be printed. It never mints or displays an `INV-…` identifier because that namespace belongs to merchant subscription billing.
- `/orders/{PHI-number}/tracking` shows chronological events, courier, service, tracking number, current/upcoming semantics, delivery snapshot, and explicit problem/return truth. It does not fabricate a live map or ETA.
- `/orders/{PHI-number}/payment` shows method, payment status, amount, admin fee, total, provider reference/transaction ID, and supported instructions from a real payment record. A resume action requires a real unexpired payment URL/session; QR fixtures never become fake QR images.
- Immutable line-item `title`, `qty`, `price_idr`, and `total_idr`; the accepted variant is part of the stored title.
- Accepted `subtotal_idr + shipping_idr + tax_idr - discount_idr = total_idr`.
- Canonical order state (`baru`, `diproses`, `dikirim`, `selesai`, `batal`, `retur`) remains separate from financial state (`pending`, `dibayar`, `refund_sebagian`, `refund`) and payment status (`menunggu`, `berhasil`, `gagal`).
- Fulfillment/courier/service/tracking and an explicit shipping-problem state appear only when supported by the order projection.
- Immutable delivery snapshot includes the authoritative courier district ID; display city/province never replace that ID.
- No merchant-internal or provider-secret fields.

### Store history

- Derived only from eligible linked or claimed orders; a phone match, browsing event, or abandoned checkout cannot add a store.
- Deduplicated by stable public store identity and ordered by most recent eligible purchase by default.
- Each item shows merchant identity, current public storefront availability, and bounded recent-order context.
- Each item opens a connected-store profile; the external `Kunjungi toko` handoff lives on that profile and does not silently restore an old cart.
- Closed, suspended, unlinked, or unavailable stores use explicit safe states; historical orders remain accessible according to policy.
- Store history is not a wishlist, follow graph, loyalty relationship, or merchant marketing audience.

### Connected-store profile

- Shows stable public store identity, category, order-derived relationship context, recent eligible orders, and current storefront availability.
- May show only an explicitly bounded active-voucher projection from that store. It must disclose that checkout recalculates eligibility and the final amount.
- Uses `Salin kode` only as a copy convenience and `Kunjungi toko` as the single external handoff to the exact canonical merchant storefront homepage.
- Never exposes merchant notes, segment, other-store data, global buyer spend, or an inferred follow/loyalty relationship.
- Unavailable stores retain historical order access but expose neither a fake storefront action nor voucher inventory.

### Notification center

- Contextual topbar destination with an accessible unread count; it does not change the four-item primary navigation.
- Supports bounded order, shipment, payment-reminder, and explicitly consented store-promotion projections.
- Every action resolves to an allowlisted account route or the responsible store profile; raw UUIDs and arbitrary URLs are prohibited.
- Read/unread state, preferences, retention, and delivery require a central account contract. The prototype labels session-only state and performs no delivery.
- Loading, empty, partial, error, all-read, and retry states remain understandable without color-only meaning.

### Returning-buyer checkout summary

- After explicit store authorization, show the accepted contact and selected saved address in a concise review step. The address projection must include a valid courier district ID and five-digit postcode.
- Buyer can confirm unchanged data or edit/select another address without re-entering every field.
- Never auto-submit merely because all fields are present.
- Recalculate shipping service/rate, promotions, inventory, tax, COD eligibility, and final totals after address or cart changes and before order acceptance.
- If the order boundary reports stale prices, replace the stale cart values, explain the difference, and require a separate confirmation of the new total before retrying.
- Authorization decline, expiry, or account-service failure preserves the cart and returns to guest checkout.

### Buyer COD trust status

- This is an account-owned, transparent COD-eligibility projection, not a public credit score, permanent blacklist, account suspension, or merchant-owned label.
- Only reviewed courier outcomes `310` (recipient says the order was not placed) and `311` (recipient refuses COD payment) are attributable events. Outcome `301`, cancellation `300`, recipient/address problems, courier/provider failure, seller cancellation, duplicate order, and unresolved disputes do not count.
- Three confirmed attributable events inside a rolling 180-day window temporarily restrict COD for 90 days. Events expire; overturned evidence or an accepted appeal removes the event; successful evidence may support manual review.
- Restriction affects COD only. Prepaid VA/QRIS methods remain available, subject to their own real gateway/session state.
- Normalized phone and exact normalized delivery-address fingerprints may help link an already verified restriction. A phone/address match never creates an event or permanent denial by itself; shared addresses and recycled numbers require review.
- The buyer sees the state, attributable count/threshold, window, restriction end when applicable, event evidence, consequence, and appeal route. Merchants do not receive cross-store event detail.
- Production scoring is blocked until raw courier outcome code, provider event identity, occurrence time, source order, review state, and policy version are persisted. The current generic `return_reason` fallback is insufficient evidence.


### Saved addresses

- List, add, edit, set default, delete.
- Label, recipient, phone, full Indonesian address, courier district ID plus derived district label/city/province, and five-digit postcode.
- Deleting a default address requires explicit replacement/confirmation policy.
- Historical order snapshots never change.

### Profile and security

- Name, verified phone, optional email.
- Phone change through re-verification/recovery.
- Current and other sessions/devices with last activity and revoke action.
- Revoke all sessions.
- Connected stores with unlink action and consequence explanation.
- Account closure with category-specific retention disclosure.

### Connect/claim

- Merchant identity.
- Requested data/scopes.
- Why the connection is needed.
- Continue, decline, expired, already-used, wrong-store, locked, and provider-down states.
- Never hide guest continuation.

### Merchant customer projection

Existing merchant customer list/detail may show:

- `Akun TokoΦ terhubung` or `Tamu`/not connected;
- phone/account verification freshness where operationally justified;
- store-owned profile/contact;
- store-owned orders, carts, notes, and follow-up permitted by existing RBAC.

It must never show:

- another store name/order;
- cross-store order count or lifetime value;
- global saved addresses not used for this store's order;
- central devices/sessions/recovery;
- connected-store list;
- global browsing/wishlist/activity;
- platform risk or support case outside the merchant's scope.

## 7. Responsive and accessibility contract

- Buyer account: mobile-first single column; desktop account shell may use sidebar + content.
- Merchant admin follows the existing responsive table/detail patterns; no new dashboard shell.
- Inputs compute to at least 16 px on mobile; touch targets at least 44 px.
- All controls have visible focus; status is never color-only.
- OTP inputs expose one coherent label/instruction/error, support paste, and do not auto-submit unexpectedly.
- Async status/order/address changes use appropriate live announcements without moving focus.
- Keyboard and screen-reader users can complete connect, claim, address, session revoke, unlink, and closure.
- At 200% zoom and narrow width, primary information/actions remain available without two-dimensional page scrolling.
- Back, forward, refresh, deep links, and a second tab do not corrupt cart, claim, or unsaved form state.

## 8. Localization and commerce invariants

- UI is Bahasa Indonesia; technical documentation remains English.
- Money is whole IDR and formatted with `id-ID` conventions.
- Dates/times display an explicit relevant timezone where ambiguity matters.
- Indonesian names, phone variants, address lines, RT/RW, district, province, and postcode must fit without truncating required identity. UI formatting may show `+62`; commerce writes use canonical `62…`.
- Buyer account never recomputes or authorizes price, shipping, discount, tax, COD, stock, payment, or fulfillment. It renders bounded projections and submits buyer choices/assertions to the responsible store boundary.
- Sign-in or connection never silently changes cart/store/variant/quantity/promotion/shipping. A stale-price `409` requires visible repair and reconfirmation.

## 9. Privacy and consent contract

- Cross-store aggregation is a distinct purpose and must not be silently inferred from checkout.
- Consent records store version, subject, store, requested scopes, time, outcome, and revocation where approved.
- Store authorization requests the minimum projection required for the current job.
- Buyer can inspect connected stores and revoke future access.
- Privacy/legal owner must decide controller/processor relationships, lawful basis, notices, rights, retention, deletion, backups, support access, children/minors, and Singapore/cross-border implications before launch.
- No OTP, token, full address, payment instruction, or unnecessary order payload enters analytics/logs.

## 10. Security and session contract

- Central account and merchant/storefront sessions have separate cookie names, audiences, issuers, lifetimes, and revocation.
- Authorization code is short-lived, single-use, redirect-bound, client/store-bound, and PKCE-bound.
- `state` protects the browser return; exact registered redirect URI is mandatory.
- Central cookies are HttpOnly, Secure, host-scoped, and never shared with tenant/custom domains.
- Sensitive changes require recent verification according to accepted policy.
- Rate limits are shared across replicas and consider identifier, account, store/client, trusted IP/device signals, and provider budget without enumeration.
- Session/device listing, current-device sign-out, revoke-other, and revoke-all are required.
- Account takeover, lost/recycled phone, provider outage, delayed/out-of-order OTP, recovery abuse, and support misuse have explicit recovery/runbooks.

## 11. API and renderer boundaries

- The tenant/headless `/api/v1` contract uses store context and remains separate from global account operations.
- Global account operations belong to a proposed, not-deployed account-origin OpenAPI contract.
- Tenant storefronts receive only scoped projections after central authorization; they never query the entire global subject/order hub.
- Account responses use `Cache-Control: private, no-store`; secrets and tokens never enter URLs except the short-lived authorization code returned to an exact redirect URI.
- Account UI may aggregate multiple stores; merchant admin and store APIs remain tenant-scoped.

## 12. Prototype contract

The local prototype must:

- use clean History API paths with direct-load fallback; hash fragments are not account routes;
- use deterministic sample data only;
- show at least three merchant orders to demonstrate cross-store identity;
- show an order-derived `Toko` destination with a safe connected-store profile;
- expose a contextual local notification center with session-only read state and no delivery claim;
- open each order-derived store through a nested profile before external handoff;
- show only active local voucher fixtures with an explicit store-checkout authority disclosure;
- use `Kunjungi toko` for the exact canonical merchant storefront homepage handoff and never claim voucher application or reservation;
- show the returning-buyer prefill-review-confirm pattern without claiming production persistence;
- expose bounded transaction overview, printable order receipt, tracking, and payment routes without inventing an invoice identity, live tracking map, payment session, or QR image;
- demonstrate a proposed reversible COD warning/restriction policy while explicitly preserving prepaid methods and labelling production enforcement as not implemented;
- label every account screen `Prototype Akun TokoΦ · Data lokal`;
- avoid real OTP fields that imply delivery unless visibly simulated;
- make no network call to auth, payment, shipping, tracking, or production APIs;
- preserve existing guest checkout behavior;
- add a merchant projection sketch that contains no cross-store information;
- use existing storefront/admin tokens and components rather than a new design system;
- pass desktop/mobile browser, keyboard, and console inspection.

Prototype acceptance is evidence for UX decisions only. It is not authentication, authorization, privacy, API, database, or production evidence.

## 13. Analytics contract

Prototype emits no production analytics. Future accepted events are limited to stable journey outcomes such as account-connect-started/completed/declined, order-claim-result, address-selected, store-profile-opened, store-return-clicked, voucher-code-copied, notification-opened, checkout-prefill-reviewed, and session-revoked. Events must use opaque IDs, consent-aware delivery, no OTP/token/address/payment/voucher-eligibility payload, and no merchant-visible cross-store aggregation. Store-history membership is derived server-side from eligible orders, never from analytics.

## 14. Acceptance matrix

| Scenario | Expected |
|---|---|
| Guest checks out without account | Order succeeds; connect is optional and post-confirmation. |
| Buyer signs into Store B with non-empty cart | Cart remains Store B's local cart and unchanged. |
| Buyer views hub | Only their consented/claimed orders across stores appear. |
| Buyer opens Toko | Only merchants from their eligible linked/claimed orders appear; browsing and phone matches add nothing. |
| Buyer opens a connected-store profile | Only bounded store identity, eligible recent orders, storefront availability, and store-owned promotion projections appear. |
| Buyer sees an advertised voucher | Account explains that application, quota, cart minimum, and final discount are recalculated at merchant checkout. |
| Buyer copies a voucher | Only the code is copied; no apply, reservation, order, cart, or server write is implied. |
| Buyer chooses Kunjungi toko | Exact canonical merchant storefront homepage opens in a new tab; account state and historical cart are not submitted. |
| Buyer opens a notification | A buyer-visible bounded route opens; read state is private and session-only in the prototype. |
| Authorized returning buyer checks out | Accepted contact/address is prefilled for review; buyer confirms or edits before order submission. |
| Saved address changes the destination | Shipping availability/rate and final totals are recalculated before confirmation. |
| Buyer opens a transaction subpage | Receipt, tracking, and payment views use the same canonical `PHI-…` order identity and only supported fixture fields. |
| Buyer has two confirmed attributable COD refusals in 180 days | Warning is visible; COD remains available; no account or prepaid restriction occurs. |
| Buyer reaches three confirmed attributable COD refusals in 180 days | COD alone is restricted for 90 days; prepaid remains available and the buyer sees evidence and appeal semantics. |
| Phone/address matches without an attributable courier outcome | No strike or permanent denial is created. |
| Store A merchant opens customer | Only Store A projection/orders appear; no cross-store inference. |
| Same buyer shops at Store B | Separate Store B customer row links to the same global subject after consent. |
| Historical phone matches | No enumeration; order-specific proof is still required. |
| Saved address changes | Historical order snapshots remain unchanged. |
| Buyer declines store connection | Returns safely; guest checkout remains available. |
| Authorization code is replayed/wrong redirect/wrong store | Rejected without creating a session/link. |
| Global session expires mid-task | Safe reauthentication preserves non-sensitive task context. |
| Store link is revoked | New global aggregation stops; merchant commerce records remain. |
| Account closes | Sessions revoke; global convenience data and store commerce follow separate approved policies. |
| Account takeover suspected | Revoke-all/recovery path is available and audited. |

## 15. Open implementation gates

1. OTP provider, sender identity, cost, fallback, and recovery.
2. Final schema/link constraints, migration, duplicate reconciliation, and rollback.
3. Central/tenant session/token lifetimes and revocation propagation.
4. Exact redirect/client registration and custom-domain lifecycle.
5. Historical claim proof and order-access token design.
6. Consent notice, lawful basis, roles, rights, retention, deletion, and transfer review.
7. Proposed account-origin OpenAPI acceptance and conformance harness.
8. Shared abuse-control provider and quotas.
9. Identity alerting, support capability, incident response, rollout, and rollback.
10. Notification event ownership, preference/read-state schema, delivery channels, retention, and account OpenAPI contract.
11. Store-promotion projection ownership, freshness/cache policy, tenant boundary, and account OpenAPI contract.
12. Owner acceptance of the implemented local buyer and merchant prototype.
13. COD trust-policy owner approval; raw courier outcome/event persistence; attribution review; phone/address linkage safeguards; appeal, expiry, retention, audit, rollout, and rollback.

## 16. Local prototype evidence — 2026-08-11

**Observed:** [`../../prototypes/tokophi-account/`](../../prototypes/tokophi-account/) contains a dependency-free, local-only prototype. Run `PORT=4187 node prototypes/tokophi-account/dev-server.mjs` from the repository root; the native Node server provides direct-load fallback for clean account paths. The prototype makes no application/API request and labels every view `Prototype Akun TokoΦ · Fixture lokal · Tanpa API produksi atau penulisan data`.

Implemented buyer sketches:

- phone-first `Akun Pembeli` login with Indonesian `+62` normalization, explicit local-demo OTP state, keyboard validation, resend feedback, complete logout reset, and a secondary verified `Dashboard Seller` escape;
- four-destination buyer navigation: Pesanan, Toko, Alamat, Akun;
- cross-store order filters, transaction overview, printable order receipt, shipment tracking, and payment detail on clean nested paths;
- order-derived store history for three merchants, with one verified live storefront destination and explicit unavailable prototype states for two unprovisioned storefronts;
- store history opens a bounded connected-store profile; `Kunjungi toko` opens the exact canonical storefront homepage and does not restore historical cart state;
- contextual notification center with seven order/promotion fixtures, an initial accessible unread count of three, allowlisted account actions, individual read state, and local mark-all-read feedback;
- connected-store profiles for all three order-derived merchants, with explicit unavailable states for unprovisioned storefronts;
- three active Batik voucher fixtures using canonical `persen`, `gratis_ongkir`, and `nominal` kinds, active-window/quota filtering, real clipboard copying, and a non-authoritative eligibility disclosure;
- returning-buyer contact/address prefill as an explicit review-edit-confirm pattern with guest fallback, courier district ID, canonical phone submission, authoritative re-quote/recalculation, and stale-price reconfirmation;
- immutable line-item, amount, courier/service, payment, and delivery projections using the current canonical enums and `PHI-` order identity;
- saved addresses that preserve the district ID required for a future quote;
- profile, verified phone, sessions/devices, connected stores, and closure explanation;
- optional post-checkout store-consent dialog with explicit shared/not-shared fields.

Implemented merchant sketch:

- admin-style customer detail for Batik Nusantara, Kopi Senja, and TechReady;
- a distinct customer ID, metrics, notes, address snapshot, and order set per selected tenant;
- only an `Akun TokoΦ terhubung` indicator for the global relation;
- an explicit deny panel for other-store orders, global addresses, sessions/devices, global spend, and recovery data.

**Browser evidence:** Chromium exercised direct deep-path login at `/orders/PHI-202951778F2Y/tracking?cod=restricted`, preserving the route through demo OTP `123456`. Desktop `1440×1000` exercised order overview, receipt, tracking, completed VA payment, pending QRIS without a fake QR/session, completed COD payment, restricted account, checkout, store profile, and notifications. Every route had the expected heading and primary-nav ownership, zero horizontal overflow, no broken product images, and no console error.

**Live-entry evidence:** Browser inspection of `tokophi.com` found that its seller login resolves to `https://app.tokophi.com/login`. The prototype keeps buyer phone/OTP identity separate, links the wordmark to `https://tokophi.com`, and routes `Masuk ke Dashboard Seller` to that verified seller destination. Successful buyer login resolves root `/` to `/orders`; a requested clean deep path remains intact.

**Login precision evidence:** The existing centered desktop/mobile login measurements remain valid. The clean-path smoke run additionally proved that root-relative CSS, script, and product-image assets load from a nested route without 404s.

**Returning-checkout prototype evidence:** `/checkout` retains the Batik fixture, semantic contact/address/shipping/payment fieldsets, guest fallback, deterministic repricing, and no-write simulation. Under the local `?cod=restricted` policy fixture, only the COD radio is disabled; VA and QRIS remain available. Checkout focus mode hides unrelated navigation without overflow and `/stores` remains the safe return path.

**Decision boundary:** This evidence accepts no API, schema, auth, privacy/legal, security, scoring, COD-enforcement, or production claim. Owner visual/product review remains required before the prototype can close gate 12.

**Remaining backend boundary:**

- `specs/openapi/account.yaml` is a proposed contract only; no central account origin, phone challenge service, account session, PKCE client registry, consent grant, or store-scoped projection handler is deployed.
- The current storefront checkout remains guest-capable and submits to the existing tenant order endpoint. The local account and returning-checkout screens make no network request and create no order, payment, account, address, session, or consent record.
- Current persisted customer addresses are tenant-scoped and do not carry the KiriminAja destination ID required for deterministic reuse. A global saved-address model and migration must be accepted before wiring account checkout.
- Existing orders remain the commerce authority. The future account service may expose immutable, consent-bounded projections, but must not mint a second order identity, rewrite money, fulfillment, payment, or delivery state, or reveal another tenant's data.
- Production work still requires accepted IAM, threat-model, privacy/legal, retention/deletion, account-recovery, observability, and rollout decisions. Prototype approval is not approval of those contracts.

**Buyer transaction identity:**

- Buyer commerce uses the globally unique `orders.number` value with the canonical `PHI-` prefix. The buyer UI labels it `Nomor pesanan`.
- Tokophi does not persist a second buyer invoice number. `INV-` seed values and runtime `SUB-` values belong only to merchant subscription billing and must not appear as buyer order references.
- A payment row uses the same `PHI-` value in `payments.reff_id`; `payments.trx_id` is the provider transaction identifier when the gateway returns one. COD has no gateway transaction ID.
- Internal order, customer, payment, session, and store UUIDs remain relationship keys. Buyer-facing navigation and support references use the order number, never a raw UUID.

**Social-profile prototype evidence:** Chromium exercised `/account?cod=restricted` at desktop `1440×1000` and mobile `390×844`. It rendered the private identity, derived activity counts, connected stores, addresses, and a proposed `Status akses COD` card: three of three reviewed events, 180-day window, COD-only restriction through 9 November 2026, prepaid availability, expiry/appeal explanation, and an explicit no-production-enforcement label. Mobile had zero horizontal overflow and 44 px primary controls.

**Transaction-reference prototype evidence:** All six buyer orders use only canonical `PHI-…` order numbers and matching payment references. Clean routes `/orders/{PHI-number}`, `/receipt`, `/tracking`, and `/payment` displayed immutable lines/totals, courier/AWB, payment method/status/amount/admin fee/total, conditional gateway transaction ID, and delivery snapshot without minting a buyer invoice. The QRIS-pending fixture exposed neither a fake QR nor a resume action because it has no valid URL/session.

**Notification and connected-store prototype evidence:** Chromium exercised `/notifications` and `/stores/batik-nusantara` on desktop and mobile. Selecting the unread promotion moved to the clean public-slug route, changed unread count from three to two, and activated only `Toko`; browser Back returned to notifications and Forward restored the store profile. `Kunjungi toko` resolved exactly to `https://batik-nusantara.tokophi.id/` with `noopener noreferrer`. Both viewports had zero horizontal overflow; the fixed mobile navigation remained clear of content.

**COD evidence boundary:** Production currently maps courier outcomes to canonical order states and may persist a generic return reason, but it does not preserve enough raw provider evidence to attribute buyer COD refusal safely. Codes `310` and `311`, provider event identity, occurrence time, source order, review state, expiry, appeal, audit, and policy version must be implemented and accepted before any score or restriction can run.

## 17. Implementation plan — local phase 1 (written 2026-10-15 against `main` `702e957d`)

### 17.1 What `main` already has, and what it does not

| Need | On `main` today | Reuse |
|---|---|---|
| Phone normalisation | `normalizePhone` (`@tokophi/lib/validate`) → canonical `62…` | Every buyer identifier goes through it; no second parser. |
| Shared, replica-safe rate limit | `rate_limit_counters` (0106) via `@tokophi/lib/rate-limit-store` | OTP send/verify keys per phone **and** per IP. |
| Session cookie options | `@tokophi/lib/session-cookie` (HttpOnly, Secure in production) | The account cookie uses it; host-only, its own name. |
| JWT signing | `jose` + `authSecret()` (`@tokophi/lib/secret`) | Same primitive as Seller sessions; separate audience. |
| Revocation from a row, every request | Super Admin rule "rank from the row, never the cookie" | The session JWT carries a session id; the `buyer_sessions` row decides. |
| Store customer | `customers` per `store_id`, `registered_at` NULL = guest, `password_hash` dormant | Never merged across stores; the link points at it (§3). |
| Order snapshot | `orders.ship_*` frozen at purchase (0042) | REQ-019 invariant is already true; the hub reads the snapshot. |
| OTP delivery | **nothing** (no WhatsApp/SMS provider anywhere) | `OtpSender` seam + dev stub (`@tokophi/lib/buyer-otp`, Task 10.1). |
| Buyer identity, sessions, links, addresses | **nothing** | New tables (§17.4), one migration after `0116` lands. |
| A host for the account UI | **nothing** | Proposed `apps/account` (§17.3). |

### 17.2 Requirements (phase 1)

IDs are `ACC-*`; each task in root `TASKS.md` Stage 10 traces to exactly one. All are **Must** unless marked.

- **ACC-1** (event) When a visitor submits a valid Indonesian mobile number, the system shall create a sign-in challenge storing only `hashOtp(phone, code)`, deliver the 6-digit code through the configured `OtpSender`, and on a correct code within 5 minutes create or reuse the `buyer_accounts` row for that phone and start a session.
  - Acceptance: Given phone `0812…`, When the buyer submits the code printed by the dev sender, Then one `buyer_accounts` row with `phone = '62812…'` exists, a `buyer_sessions` row exists, the HttpOnly account cookie is set, and the challenge's `consumed_at` is stamped.
- **ACC-2** (unwanted) If a code is wrong, expired, already used, or the challenge has 5 wrong attempts, then the system shall refuse it without revealing which, start no session, and refuse a resend within 60 s of the last one.
  - Acceptance: Given a live challenge, When 5 wrong codes are sent, Then the 6th submission — even the correct code — is refused and no session row exists; a resend inside 60 s is refused with the remaining seconds.
- **ACC-3** (event) When the buyer chooses "Keluar dari perangkat lain", the system shall revoke every other session of that account and keep the current one.
  - Acceptance: Given two sessions, When one revokes the others, Then the other cookie's next request is signed out and the current one still works.
- **ACC-4** (event) When a signed-in buyer submits an order number whose order phone equals the buyer's verified phone, and accepts the store-link consent, the system shall create (or re-activate) the `buyer_store_links` row for that store and customer.
  - Acceptance: Given order `PHI-…` placed with the buyer's phone, When they claim it and consent, Then an `active` link exists for that store; a different phone, an unknown number, or declined consent creates nothing and the message does not distinguish "unknown" from "not yours".
- **ACC-5** (state) While a store link is `active`, the system shall list that store's orders for the linked customer in the hub, using only the allowlisted projection of §3 (no notes, tags, fees, ledger, provider ids).
  - Acceptance: Given links to stores A and B, When the hub loads, Then orders from A and B appear and none from store C (which shares the phone but has no link); the response body contains none of the excluded fields.
- **ACC-6** (state, Should) While links exist, the system shall list the linked stores ("Toko") derived from eligible linked orders, each opening the store's canonical storefront.
  - Acceptance: Given links to A and B, When Toko opens, Then exactly A and B appear with their storefront URL.
- **ACC-7** (ubiquitous) The system shall let the buyer keep up to 10 saved addresses, each with the KiriminAja district id, and one primary; editing or deleting one never changes an order snapshot.
  - Acceptance: Given an order shipped to address X, When X is edited, Then the order's `ship_*` columns are unchanged; an 11th address is refused.
- **ACC-8** (event) When the buyer unlinks a store, the system shall set the link `revoked`, stop showing that store's orders, and leave every store-owned row unchanged.
  - Acceptance: Given an active link, When unlinked, Then the hub drops the store and `orders`/`customers`/`payments` row counts for that store are identical before and after.
- **ACC-9** (event, Should) When a guest checkout completes, the success page shall offer an optional "Simpan ke Akun TokoΦ" link to the account origin, and guest checkout shall stay exactly as it is.
  - Acceptance: Given a guest order, When the success page renders, Then the link is present and the order and checkout flow are byte-for-byte unchanged with the link absent or broken.

Phase 2 (not planned in tasks yet): store authorization with PKCE + checkout prefill (§5B/F), notification center (§5H), voucher handoff (§5I), COD standing (gate 13), phone change, recovery intake, account closure.

### 17.3 Architecture — proposal, owner decision OD-2

- **Host: a new `apps/account`** (Astro SSR, `@astrojs/node` standalone, like `apps/storefront`; dev port 4329; proposed prod host `account.tokophi.com`, **not deployed**).
  - Rejected — a route inside `apps/storefront`: every storefront request is tenant-resolved from `Host`, so its cookie would be per-shop; the account must be one origin across all shops (§10).
  - Rejected — a route inside `apps/admin`: that origin carries the Seller session; mixing buyer and merchant cookies on `app.tokophi.com` widens the merchant surface for no gain.
- **Database role: the owner connection (`db`)**, the same standing as the storefront and `/api/public/*` — a buyer is cross-tenant by definition, so there is no `store_id` to put in the GUC. Every query carries an explicit `buyer_id` predicate, and tenant rows are reached **only** through an `active` `buyer_store_links` join. Negative tests (ACC-5) are what hold this, not RLS.
- **Session:** jose JWT (audience `tokophi-account`) in a host-only cookie `tphi_account`, carrying a `buyer_sessions.id`; the row is read on every request (revoked/absent ⇒ signed out).

### 17.4 Data schema — proposed, one migration after `0116` is on `main`

| Table | Columns | Notes |
|---|---|---|
| `buyer_accounts` | `id`, `phone` unique (canonical `62…`), `name`, `email`, `status` (`active`/`suspended`/`closed`), `created_at` | No `store_id`: platform-level. |
| `buyer_otp_challenges` | `id`, `phone`, `code_hash`, `expires_at`, `attempts`, `consumed_at`, `sent_at` | Index `(phone, sent_at desc)`; rows older than a day are purged by the existing cron. |
| `buyer_sessions` | `id`, `buyer_id`, `created_at`, `last_seen_at`, `revoked_at`, `user_agent` | Consumed with one `update … where revoked_at is null returning` per check. |
| `buyer_store_links` | `buyer_id`, `store_id`, `customer_id`, `status`, `consent_version`, `consented_at`, `revoked_at`, `claim_method` | Unique `(buyer_id, store_id)`. **Has `store_id` → `verify-rls` will require an RLS policy**; give it one (`store_id = app_current_store_id()`) so a merchant read can only ever see its own store's links. |
| `buyer_addresses` | `id`, `buyer_id`, `label`, `recipient`, `phone`, `address`, `district_id` (KiriminAja), `kelurahan`, `postal_code`, `is_primary` | Max 10 enforced in the action; one primary via partial unique index. |

### 17.5 OTP delivery

`OtpSender` (`@tokophi/lib/buyer-otp`) is the only seam. Local development uses `devOtpSender`, which prints the code to the server log and **throws in a production build**, so a missing provider fails loudly instead of logging live codes. The production provider (WhatsApp Business API or an SMS vendor), sender identity, cost per message and fallback are owner decision OD-1.

### 17.6 Where the 2026-09-26 PRD draft is overruled

| Draft | Ruling here | Why |
|---|---|---|
| REQ-007: aggregate **all** orders matching the verified phone across all stores | ACC-4/ACC-5: only stores the buyer claimed and consented to | §5E.5 — a phone match never enumerates orders; recycled numbers would expose a stranger's history. |
| "Midtrans, Xendit, DOKU, AutoLaris" | AutoLaris is the only gateway | `main` — `@tokophi/lib/autolaris`, ADR 0004. |
| REQ-013 "payment simulation button" | Prototype fixture only | No payment action exists in phase 1. |
| REQ-025/026 COD standing + appeal | Phase 2, gated | Gate 13: policy owner approval, courier outcome persistence. |
| REQ-006 recovery intake | Phase 2 | Needs operator capability + runbook (§10). |
| `/account`, `/orders` paths under `akun.tokophi.com` | `account.tokophi.com`, paths per prototype | Host is OD-2; paths stay the prototype's. |

### 17.7 Owner decisions (open questions)

| ID | Question | Blocks |
|---|---|---|
| OD-1 | OTP provider (WhatsApp Business API vs SMS vendor), sender identity, budget, fallback. | Any non-local use of ACC-1. |
| OD-2 | Host: new `apps/account` at `account.tokophi.com` (proposed) or another shape. | Task 10.3. |
| OD-3 | May a store **affiliate** (Stage 9, form-only today) sign in with this same buyer account to see commissions? Not built; deciding it later costs a link table, deciding it never costs nothing. | Nothing in phase 1. |
| OD-4 | Is "verified phone = order phone + order number" enough proof to claim an order, or is an order-specific token (sent on the success page / WhatsApp) required? | Task 10.5. |
| OD-5 | Task 5.8: does the account ship to production, and when. | Deploy only. |
| OD-6 | Privacy review (`PRIVACY-COMPLIANCE.md` is a stub): consent text, retention, deletion, UU PDP. | Production only. |

### 17.8 Tasks

Root [`TASKS.md`](../../TASKS.md) **Stage 10** (10.1–10.11). Milestone order: primitives → schema → sign-in → sessions → claim/link → hub → Toko → addresses → unlink → success-page offer → browser + tenant-negative verification. Close each with `specs/docs/STATUS.md`.
