# TokoΦ Account — Global Buyer Identity and UX Specification

> **Status — 2026-10-15: LOCAL DEVELOPMENT AUTHORISED, PRODUCTION RELEASE NOT DECIDED.** The owner
> directed local development of the buyer account ("sambil kita develop local kebutuhan akun user
> (pembeli)", 2026-10-15). That moves root `TASKS.md` Task 5.8 from "build, defer or drop" to
> "build locally"; whether and when it ships is still Task 5.8. [ADR 0016](../decisions/0016-global-buyer-account.md)
> remains **PROPOSED** — its draft lives on `feature/buyer-account-local` (`8dc12d7`) and is not
> accepted here. Sections 1–15 are that branch's 2026-08-12 draft, carried verbatim as the working
> product contract; **§17 is the PRD (rev 2, 2026-10-15): phases, `ACC-*` requirements, decisions and owner questions against `main`. Where §1–15 assume a phone-verified account or phone-match claims, §17 wins: phase 1 is Google sign-in + an order-specific claim token, phone comes in phase 2.**
>
> **Canonical ownership:** This document owns global buyer-account behavior, object lifecycle, buyer/merchant projections, UI/UX contracts, and the account implementation plan (§17). [`SECURITY.md`](SECURITY.md) owns authentication/control requirements; [`PRIVACY-COMPLIANCE.md`](PRIVACY-COMPLIANCE.md) owns applicability, consent/rights/retention gates (still a stub); `packages/db/src/schema.ts` owns implemented storage; [`../openapi/account.yaml`](../openapi/account.yaml) will own HTTP operations once written. Execution state lives in root `TASKS.md` Stage 10.
>
> **Superseded draft:** `PRD-BUYER-ACCOUNT.md` (account-ux-local branch, 2026-09-26) and its copy in [`tasks/2026-09-26-buyer-account-prd.md`](tasks/2026-09-26-buyer-account-prd.md) are research input, not a second PRD. Where they disagree with this file, this file wins — see §17.11.
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

## 17. PRD — buyer account, phased delivery (rev 2, 2026-10-15)

> **Rev 2, owner direction 2026-10-15:** *"api wa ini dan sms belum aku urus"* → *"prd baru sekalian
> affiliate dan user akun kau buat dan sempurnakan, untuk wa dan sms nanti aja masuk task"*. No
> WhatsApp or SMS provider exists, so **phase 1 must need none**: Google sign-in + an order-specific
> claim token. Phone OTP (ACC-1/ACC-2) moves to phase 2 behind the platform messaging task (root
> `TASKS.md` Task 8.38). Rev 1 (same day, `3c667cb0`) is superseded where this section says so; IDs
> are never renumbered or reused.

### 17.1 Overview

A buyer who ordered from one or more TokoΦ shops gets one place — `account.tokophi.com` (proposed,
OD-2) — to see those orders, track them, find the shop again and keep delivery addresses, without
TokoΦ ever showing one merchant another merchant's buyer, and without making login a condition of
checkout. Why now: the owner directed local development (2026-10-15), and the store affiliate
programme (Stage 9, spec `specs/AFFILIATE_SPEC.md` on branch `feat/store-affiliate`) needs a
sign-in for affiliates to see their own commissions — one identity serves both.

### 17.2 What `main` already has, and what it does not

| Need | On `main` today | Reuse |
|---|---|---|
| Phone normalisation | `normalizePhone` (`@tokophi/lib/validate`) → canonical `62…` | Every buyer identifier goes through it; no second parser. |
| Shared, replica-safe rate limit | `rate_limit_counters` (0106) via `@tokophi/lib/rate-limit-store` | OTP send/verify keys per phone **and** per IP. |
| Session cookie options | `@tokophi/lib/session-cookie` (HttpOnly, Secure in production) | The account cookie uses it; host-only, its own name. |
| JWT signing | `jose` + `authSecret()` (`@tokophi/lib/secret`) | Same primitive as Seller sessions; separate audience. |
| Revocation from a row, every request | Super Admin rule "rank from the row, never the cookie" | The session JWT carries a session id; the `buyer_sessions` row decides. |
| Store customer | `customers` per `store_id`, `registered_at` NULL = guest, `password_hash` dormant | Never merged across stores; the link points at it (§3). |
| Order snapshot | `orders.ship_*` frozen at purchase (0042) | REQ-019 invariant is already true; the hub reads the snapshot. |
| OTP delivery | **nothing** (no WhatsApp/SMS provider anywhere; owner has not set one up) | `OtpSender` seam + dev stub (`@tokophi/lib/buyer-otp`, Task 10.1) — wired in phase 2 only. |
| Google sign-in | `@tokophi/lib/google-oauth` (moved from `apps/admin/lib/google.ts` 2026-10-15, Task 10.12; `authorizeUrl`, `exchangeCode`: code flow, `state` cookie, id_token verified against Google JWKS, `email_verified` required) | Lifted into `@tokophi/lib` so admin and account share one implementation (Task 10.12). |
| Order-specific proof | **nothing** — `/checkout/sukses` renders the order the checkout script kept in `localStorage` from the order API response; `/thanks` (the `/promo` funnel) reads the number from the query | Signed claim token (§17.8 D-3, Task 10.13). |
| Buyer identity, sessions, links, addresses | **nothing** | New tables (§17.9), one migration after `0116` lands. |
| A host for the account UI | **nothing** | Proposed `apps/account` (§17.8 D-1). |

### 17.3 Users and current workaround

| Role | Job to be done | Current workaround | Evidence status |
|---|---|---|---|
| Guest buyer | Buy without registering | Checkout as today; nothing to sign up for | Observed (`main`: guest-only checkout) |
| Returning buyer | Find "my order" again, check its status, reach the shop | Keeps the WhatsApp chat or the success-page tab; asks the seller | Assumed — no buyer research beyond the 2026-09-26 draft |
| Multi-store buyer | See orders from several TokoΦ shops in one list | None — each shop is a separate site | Assumed |
| Store affiliate | See own referral commissions | Asks the seller over WhatsApp; the affiliate has no login (Stage 9 is form-only) | Observed (`feat/store-affiliate`) |
| Merchant | Serve its own buyers | Seller panel `/pelanggan`; must never see cross-store data | Observed |

First-use journey (phase 1): checkout → success page → "Simpan ke Akun TokoΦ" → Google sign-in →
consent screen naming the shop → order appears in "Pesanan".

### 17.4 Product, audience and market context

- Country-specific: Indonesia; Bahasa Indonesia UI, IDR, `id-ID` (NF-4); mobile-first (390 px).
- Indonesian buyers are phone/WhatsApp-first. Google sign-in is chosen for phase 1 **because it needs
  no messaging provider**, not because it is the preferred identity; phone becomes the second factor
  of identity in phase 2. Assumption, owner-visible: a meaningful share of buyers will accept Google
  sign-in. Not measured.
- Trust: no payment instrument is ever stored (§1 non-goals); a phone match alone never reveals an
  order (§5E.5).

### 17.5 Goals, success measure, non-goals

**Goals**
- G-1: a buyer can reach an order they placed from any TokoΦ shop after closing the success page, without contacting the seller.
- G-2: no merchant can see another merchant's buyers or orders through the account (0 cross-tenant reads in the negative sweep).
- G-3: phase 1 ships locally with zero dependency on a WhatsApp/SMS provider.
- G-4: a store affiliate signs in with the same account and sees every store they promote, each store's commissions apart (**phase 1 since 2026-10-15**).

**Success measure** (read 30 days after a production launch, which is still undecided — OD-5):
share of orders claimed into an account; baseline 0 % (no account exists), target set by the owner
at launch. Local phase is judged by the acceptance criteria below, not by a metric.

**Non-goals (phase 1–3)** — everything in §1 non-goals, plus: phone OTP before Task 8.38 is done;
SMS/WhatsApp notifications; returning-buyer checkout prefill and PKCE store authorisation (§5B/F);
notification centre (§5H); voucher handoff (§5I); COD standing (gate 13); account recovery intake;
email sending of any kind (the platform has no email provider either).

### 17.6 Core features and phases

| Feature | Phase | Requirements |
|---|---|---|
| Google sign-in, sessions, sign-out, revoke other devices | 1 | ACC-10, ACC-3 |
| Claim link on the success page (signed, order-specific) | 1 | ACC-13 |
| Claim an order + consent to link its store | 1 | ACC-11 |
| "Pesanan" — claimed orders only | 1 | ACC-12 |
| "Toko" — linked stores with a way back | 1 | ACC-6 |
| Saved addresses | 1 | ACC-7 |
| Unlink a store | 1 | ACC-8 |
| Close the account (self-service, irreversible) | 1 — built 2026-10-19 | ACC-15 |
| Phone OTP sign-in / add phone to an account | 2 (blocked on Task 8.38) | ACC-1, ACC-2 |
| Full history of a linked store for a phone-verified buyer | 2 | ACC-5 |
| **Affiliate area — one account, many stores** (apply while signed in, accept a seller invitation, every store's code/link/commissions) | **1 — built 2026-10-15** (owner: "akun affiliate itu buat seperti akun user -> jadi bisa affiliate banyak toko bukan personal") | ACC-14, AFFILIATE_SPEC `F-A15` |

### 17.7 Requirements

IDs `ACC-*`, EARS, MoSCoW. **Rev-1 rows keep their IDs**; changed ones are marked.

- **ACC-1** (Must, phase 2, event) When a visitor submits a valid Indonesian mobile number, the system shall create a sign-in challenge storing only `hashOtp(phone, code)`, deliver the 6-digit code through the configured `OtpSender`, and on a correct code within 5 minutes create or reuse the `buyer_accounts` row for that phone and start a session. *(Rev 2: moved to phase 2 — needs Task 8.38.)*
  - Acceptance: Given phone `0812…`, When the buyer submits the code printed by the dev sender, Then one `buyer_accounts` row with `phone = '62812…'` exists, a `buyer_sessions` row exists, the HttpOnly account cookie is set, and the challenge's `consumed_at` is stamped.
- **ACC-2** (Must, phase 2, unwanted) If a code is wrong, expired, already used, or the challenge has 5 wrong attempts, then the system shall refuse it without revealing which, start no session, and refuse a resend within 60 s of the last one.
  - Acceptance: Given a live challenge, When 5 wrong codes are sent, Then the 6th submission — even the correct code — is refused and no session row exists; a resend inside 60 s is refused with the remaining seconds.
- **ACC-3** (Must, phase 1, event) When the buyer chooses "Keluar dari perangkat lain", the system shall revoke every other session of that account and keep the current one.
  - Acceptance: Given two sessions, When one revokes the others, Then the other cookie's next request is signed out and the current one still works.
- **ACC-4** — **SUPERSEDED by ACC-11 (rev 2).** Claim by "verified phone = order phone" needs phone verification, which needs a provider; the token claim answers OD-4 instead.
- **ACC-5** (Must, phase 2, state) While a store link is `active` **and** the buyer's verified phone equals that store customer's phone, the system shall list every order of that customer in the hub, through the allowlisted projection of §3 (no notes, tags, fees, ledger, provider ids). *(Rev 2: phase 2, adds the phone condition; phase 1 uses ACC-12.)*
  - Acceptance: Given links to stores A and B and a verified phone matching both customers, When the hub loads, Then all A and B orders appear and none from store C (same phone, no link); the response body contains none of the excluded fields.
- **ACC-6** (Should, phase 1, state) While links exist, the system shall list the linked stores ("Toko") derived from the buyer's claimed orders, each opening the store's canonical storefront.
  - Acceptance: Given links to A and B, When Toko opens, Then exactly A and B appear with their storefront URL.
- **ACC-7** (Must, phase 1, ubiquitous) The system shall let the buyer keep up to 10 saved addresses, each with the KiriminAja district id, and one primary; editing or deleting one never changes an order snapshot.
  - Acceptance: Given an order shipped to address X, When X is edited, Then the order's `ship_*` columns are unchanged; an 11th address is refused.
- **ACC-8** (Must, phase 1, event) When the buyer unlinks a store, the system shall set the link `revoked`, stop showing that store's orders, and leave every store-owned row unchanged.
  - Acceptance: Given an active link, When unlinked, Then the hub drops the store and `orders`/`customers`/`payments` row counts for that store are identical before and after.
- **ACC-9** — **SUPERSEDED by ACC-13 (rev 2).** The success-page offer now carries the claim token; a bare link proves nothing.
- **ACC-10** (Must, phase 1, event) When a visitor completes Google sign-in and Google's id_token verifies (issuer, audience, signature) with `email_verified = true` and the returned `state` equals the state cookie, the system shall find the `buyer_accounts` row by Google `sub` (else create one holding `sub`, email and name) and start a session.
  - Acceptance: Given a dev Google client, When the buyer signs in twice, Then exactly one `buyer_accounts` row exists for that `sub`, each sign-in creates a `buyer_sessions` row, and the `tphi_account` cookie is HttpOnly and host-only. A mismatched `state`, a Google `error`, an unverified email or a failed exchange creates no row and no cookie.
- **ACC-11** (Must, phase 1, event) When a signed-in buyer opens a valid claim link and accepts the consent screen naming the store and what is shared, the system shall record the claim for that order and create (or re-activate) the `buyer_store_links` row for that store and customer.
  - Acceptance: Given a valid token for order `PHI-…`, When the buyer consents, Then one `buyer_order_claims` row and one `active` link exist. A tampered, expired or wrong-order token, a declined consent, or an order already claimed by **another** buyer creates nothing and shows one identical message; the same buyer re-claiming is a no-op success.
- **ACC-12** (Must, phase 1, state) While the buyer has claims, the hub shall list exactly the claimed orders whose store link is `active`, through the allowlisted projection of §3.
  - Acceptance: Given claims on one order in A and one in B, and another A order of the same customer that was not claimed, When the hub loads, Then exactly the two claimed orders appear; revoking B's link drops B's order; no excluded field is in the response; requesting an unclaimed order by id or number returns not-found.
- **ACC-13** (Must, phase 1, event) When a storefront order is created, the success page shall offer "Simpan ke Akun TokoΦ" carrying a claim token bound to that order (D-3); guest checkout and the order request/response contract stay unchanged except for the added token field.
  - Acceptance: Given a guest order, When the success page renders, Then the link carries a token that verifies for that order id only and expires after 30 days; with the account origin env unset the page renders exactly as before; the order API's existing fields are byte-identical.
- **ACC-14** (Should, phase 3, event) Where the store affiliate programme exists, when a signed-in buyer opens an affiliate invitation link issued by the seller on approval and accepts it, the system shall bind that affiliate record to the buyer account and show that affiliate's commissions for that store only.
  - Acceptance: Given an approved affiliate in store A, When the buyer accepts A's invitation, Then the account shows A's commissions for that affiliate and nothing from store B; an invitation for another affiliate or an already-bound one creates nothing. Matching by email or phone alone binds nothing.

- **ACC-15** (Must, phase 1, event) When the signed-in buyer confirms "Tutup akun", the system shall revoke every session, delete the account's saved addresses and order claims, revoke every store link, detach the account from its affiliate records, blank name/email/phone and replace the Google identity with an inert marker, and leave every store-owned row unchanged; while any of the account's programmes still owes it a ready or held commission it shall refuse and name those stores.
  - Acceptance: Given an account with a link, a claim, an address, an affiliate record and two sessions, When it closes, Then status is `closed`, no session row is unrevoked, no link is active, no claim or address remains, the order row is byte-identical, the affiliate row survives with no account, a second close is refused, and signing in with the same Google identity creates a different, empty account; Given an unpaid commission, When it tries to close, Then nothing changes and the refusal names the store.


### 17.8 Technical decisions (ADR-lite)

- **D-1 Host — new `apps/account`** (Astro SSR, `@astrojs/node` standalone like `apps/storefront`; dev port 4329; proposed prod host `account.tokophi.com`, **not deployed**; owner decision OD-2).
  **Why:** one origin across every shop (§10). **Rejected:** a route in `apps/storefront` — every request there is tenant-resolved from `Host`, so its cookie would be per shop; a route in `apps/admin` — that origin carries the Seller session, and mixing buyer and merchant cookies on `app.tokophi.com` widens the merchant surface for no gain.
  **Consequence:** a fifth deployable surface (compose service, Traefik router, DNS record) when production is decided.
- **D-2 Google sign-in reuses the admin flow, not a library.** `authorizeUrl` / `exchangeCode` moved from `apps/admin/lib/google.ts` into `@tokophi/lib/google-oauth` (Task 10.12, done 2026-10-15); `googleConfig(redirectVar)` reads ONE client id/secret and a per-app redirect variable (admin `GOOGLE_REDIRECT_URI`, account `ACCOUNT_GOOGLE_REDIRECT_URI`). Same contract as today: authorization-code flow, random `state` in an HttpOnly cookie compared on return, id_token verified against Google's JWKS with issuer + audience, `email_verified` required. The account app has its **own** redirect URI; Google requires `redirect_uri` to "exactly match one of the authorized redirect URIs for the OAuth 2.0 client", HTTPS except localhost, no raw IP hosts (developers.google.com/identity/protocols/oauth2/web-server, read 2026-10-15) — so the owner adds the account callback to the existing client or creates a second one (OD-7). PKCE is **not** relied on: the confidential-client + `state` pattern already in production is kept.
  **Consequence:** buyer and merchant identities stay separate tables (`buyer_accounts` vs `users`) even for the same Google account; a seller who also buys has two sessions on two origins, by design.
- **D-3 Claim token — stateless HMAC, single claimant.** As built (`@tokophi/lib/claim-token`, Task 10.13): `token = base64url(orderId "." issuedAtSec) "." base64url(HMAC-SHA256(ACCOUNT_CLAIM_SECRET, "order-claim:" ‖ orderId "." issuedAtSec))`; secret under 32 chars = feature off; 60 s future skew tolerated; only the canonical encoding verifies, issued by `/api/public/order` as one added response field, kept by the checkout script with the rest of the order and placed in the success-page link (`/checkout/sukses` renders client-side from `localStorage`; the `/thanks` funnel gets it in its query); valid 30 days. No new table for issuance. **Single claimant** is enforced by `buyer_order_claims` (unique `order_id`): the first buyer to consent owns the claim; a forwarded link after that is refused. Verification is constant-time.
  **Why:** answers OD-4 without a provider, and the proof is order-specific — unlike a phone match, which §5E.5 forbids as enumeration. **Rejected:** a random token stored per order (a migration on the money path's table for no extra guarantee); phone + order number (needs OTP).
  **Consequence:** whoever holds the link before the buyer claims it can claim that **one** order (same exposure as the success-page URL today); it never grants other orders of that customer — that needs phase 2 phone verification (ACC-5). Secret rotation invalidates unclaimed links.
- **D-4 Database role — owner connection.** A buyer is cross-tenant, so there is no `store_id` for the GUC. Every query carries an explicit `buyer_id` predicate and reaches tenant rows only through an `active` link **and** a claim (phase 1). Negative tests (ACC-12, Task 10.11) hold this, not RLS. `buyer_store_links` and `buyer_order_claims` have `store_id` and get RLS policies so a merchant-side read can only see its own store.
- **D-5 Session** — jose JWT (audience `tokophi-account`) in host-only cookie `tphi_account`, carrying a `buyer_sessions.id`; the row is read on every request (revoked/absent ⇒ signed out), the Super Admin "rank from the row, never the cookie" rule.

### 17.9 Data schema — proposed, one migration after `0116` is on `main`

| Table | Columns | Notes |
|---|---|---|
| `buyer_accounts` | `id`, `google_sub` unique nullable, `email`, `phone` unique nullable (canonical `62…`, set only by phase-2 verification), `phone_verified_at`, `name`, `status` (`active`/`suspended`/`closed`), `created_at` | No `store_id`. Check: at least one of `google_sub`, `phone`. |
| `buyer_sessions` | `id`, `buyer_id`, `created_at`, `last_seen_at`, `revoked_at`, `user_agent` | |
| `buyer_store_links` | `buyer_id`, `store_id`, `customer_id`, `status`, `consent_version`, `consented_at`, `revoked_at`, `claim_method` (`token` / `phone`) | Unique `(buyer_id, store_id)`; RLS `store_id = app_current_store_id()`. |
| `buyer_order_claims` | `order_id` **unique**, `buyer_id`, `store_id`, `claimed_at` | Single claimant (D-3); RLS as above. |
| `buyer_addresses` | `id`, `buyer_id`, `label`, `recipient`, `phone`, `address`, `district_id` (KiriminAja), `kelurahan`, `postal_code`, `is_primary` | Max 10 in the action; one primary via partial unique index. |
| `buyer_otp_challenges` | `id`, `phone`, `code_hash`, `expires_at`, `attempts`, `consumed_at`, `sent_at` | **Phase 2 migration**, not in the first one. |
| affiliate binding | **Built in `0117`:** `affiliates.account_id` (→ `buyer_accounts`, nullable, unique with `store_id`), `affiliates.invite_hash` (sha256, partial unique), `affiliates.invite_expires_at` | **Phase 1** (2026-10-15). Binding only by applying while signed in or by the seller's single-use invitation — never email/phone. |

**As built 2026-10-15 (`0117_tokophi_account`, branch `feat/accounts`):** `buyer_accounts` and
`buyer_sessions` exactly as above, with **RLS enabled and no policy** (the `impersonation_grants` /
`rate_limit_counters` shape — `tokophi_app` sees zero rows; `apps/account` uses the owner connection
with an explicit `buyer_id` predicate), plus the affiliate binding row. `buyer_store_links`,
`buyer_order_claims` and `buyer_addresses` are **not** in `0117`; they come with Tasks 10.5–10.8.

### 17.10 Messaging dependency

`OtpSender` (`@tokophi/lib/buyer-otp`) stays the only seam for phone codes; `devOtpSender` prints the
code locally and **throws in a production build**. The production sender is not an account concern:
it is the platform **messaging channel**, root `TASKS.md` **Task 8.38** (one sender interface for
OTP, order/shipping notices, abandoned-cart and CRM follow-up, affiliate notices). Phase 2 starts
when that task is done.

### 17.11 Where the 2026-09-26 PRD draft is overruled

| Draft | Ruling here | Why |
|---|---|---|
| REQ-007: aggregate **all** orders matching the verified phone across all stores | ACC-11/ACC-12 (claimed orders), ACC-5 (phase 2, linked + verified) | §5E.5 — a phone match never enumerates orders; recycled numbers would expose a stranger's history. |
| Passwordless phone OTP as the only sign-in | Google first (ACC-10), phone in phase 2 | No messaging provider (owner, 2026-10-15). |
| "Midtrans, Xendit, DOKU, AutoLaris" | AutoLaris is the only gateway | `main` — `@tokophi/lib/autolaris`, ADR 0004. |
| REQ-013 "payment simulation button" | Prototype fixture only | No payment action exists in phase 1. |
| REQ-025/026 COD standing + appeal | Out of scope | Gate 13. |
| REQ-006 recovery intake | Out of scope | Needs operator capability + runbook (§10). |
| `/account`, `/orders` under `akun.tokophi.com` | `account.tokophi.com`, paths per prototype | Host is OD-2. |

### 17.12 Risks

| Risk | Mitigation |
|---|---|
| A forwarded success link is claimed by someone else first | Exposure is one order (already visible at that URL today); claimer is recorded; support can release a claim (phase 2 runbook). |
| Cross-tenant leak through the owner connection | Claim + active link required on every read; Task 10.11 negative sweep; RLS on the two `store_id` tables for merchant-side reads. |
| Google client misconfigured in production (redirect URI) | Feature-flagged like admin: unset env ⇒ no button, no crash (`googleConfig()` pattern). |
| Buyers expect phone, not Google | Phase 2 adds phone; phase-1 claim works with either identity. |
| Migration number collides with `0116` | No migration until `feat/store-affiliate` is on `main`; re-read `origin/main` journal first. |
| Privacy obligations (UU PDP) unreviewed | Production gated on OD-6; local data only. |

### 17.13 Open owner decisions

| ID | Question | Blocks |
|---|---|---|
| OD-1 | Messaging provider (WhatsApp Business API vs SMS vendor), sender identity, budget, fallback — **now Task 8.38**. | Phase 2. |
| OD-2 | Host: new `apps/account` at `account.tokophi.com` (proposed). | Task 10.3. |
| OD-3 | ✅ **Answered 2026-10-15 (owner: "oke boleh"): YES**, then the same day **widened** ("akun affiliate itu buat seperti akun user -> jadi bisa affiliate banyak toko bukan personal"): the affiliate area is **phase 1** of this app — one account, many stores; existing rows bound by seller invitation (ACC-14), new ones by applying while signed in. | — (built on `feat/accounts`) |
| OD-9 | Return / complaint path: does the buyer account show a store-defined return window and a way to open a complaint, as the marketplaces do (Shopee: 2/7/15 days by store tier)? Needs a store setting and an order event; today the order page says only "hubungi toko". See §19. | A return-request task. |
| OD-10 | Store-side withholding on affiliate commission (PPh, NPWP collection) — stores pay affiliates directly, so the duty is theirs, not the platform's. Owner + tax adviser; **no screen may say the platform deducts tax**. See §19. | Any commission-payout copy or flow. |
| OD-11 | Affiliate click tracking (the marketplaces show clicks → orders → commission). There is no click data; a storefront change, not an account-app one. | A "Klik" column. |
| OD-8 | Should the account app list stores with an open affiliate programme (a directory)? | **Open — default no** in phase 1 (AFFILIATE_SPEC OD-A6). |
| OD-4 | ~~Proof for claiming an order~~ — **answered by D-3** (signed order-specific token, single claimant). **Validity CLOSED 2026-10-15** — owner delegated ("rekomendasimu kau sesuaikan"): **30 days**. It covers delivery plus the complaint window, keeps a leaked link short-lived, and an order missed after 30 days is still reachable in phase 2 by verified-phone claim (ACC-5). | — |
| OD-5 | ✅ **Answered 2026-10-15 (owner: "local development dulu sampai final"):** local development only until the feature is final — no push, no PR, no production. When it ships is decided then. | Deploy only. |
| OD-6 | Privacy review (`PRIVACY-COMPLIANCE.md` is a stub): consent text, retention, deletion, UU PDP. | Production only. |
| OD-7 | ✅ **Answered 2026-10-15 (owner: "pakai client yang sudah ada"): reuse the existing client.** Owner step (Google Cloud Console → that OAuth client → Authorized redirect URIs): add the account callback — local `http://localhost:4329/auth/google/callback` now; the production URI once OD-2 fixes the host. | Any sign-in from the account app. |

### 17.14 Milestones and tasks

Root [`TASKS.md`](../../TASKS.md) **Stage 10**. Phase 1 order: 10.1 (done) → 10.12 Google lift → 10.2
schema (after `0116`) → 10.3 sign-in → 10.13 claim token → 10.5 claim + link → 10.6 hub → 10.7 Toko
→ 10.8 addresses → 10.4 sessions → 10.9 unlink → 10.10 success-page offer → 10.11 browser +
tenant-negative sweep. Phase 2 = 10.14 (after Task 8.38). Phase 3 = 10.15 (after Stage 9 + OD-3).
Close each phase in `specs/docs/STATUS.md`.

## 18. UI/UX completion — port the accepted prototype, one shell for buyer and affiliate (2026-10-16)

> **Owner direction 2026-10-16:** *"pakai itu aja kita sempurnakan … kebutuhan di dalamnya di
> lengkapi dan sempurnakan termasuk kebutuhan affiliate ini secara ui ux bisa sama dengan user akun
> namun isi dan navigasi beda"*. "Itu" is the local prototype (`prototypes/tokophi-account`, §12, §16,
> served at `:4187`). The phase-1 app built on 2026-10-15 used its own simpler design; this section
> replaces that design with the prototype's and completes every screen that real data can back.
> Visual decisions, composition contract and render evidence live in `apps/account/DESIGN.md`.

### 18.1 Principle — the prototype is the visual contract, the database is the content contract

1. **Look and structure come from the prototype**: Seller-aligned tokens (`prototypes/tokophi-account/DESIGN.md`),
   Geist, 256 px sidebar, 64 px topbar, centred content capped at 1120 px, mobile bottom navigation,
   status-first order detail, card anatomy without nested boxes.
2. **Content comes only from real rows.** A prototype element whose data or action has no backend
   in phase 1 is **left out**, not mocked: no fake buttons, counts, vouchers, notifications or
   payment simulation (spec §1 non-goals, §17.5 non-goals). Each omission is listed in §18.5 with
   the task that would unlock it.
3. **Every page works without JavaScript** (server-rendered Astro forms and links). Client script
   is allowed only for progressive conveniences: copy-to-clipboard, theme toggle, district search
   suggestions, dialog focus.
4. **No new migration.** Everything below reads tables that exist on `feat/accounts`
   (`0117`, `0118`, the store's order/payment/product rows).

### 18.2 Two workspaces, one shell

One account, two jobs. Both use the same shell, tokens and components; the **sidebar header carries
a workspace switch** ("Belanja" / "Affiliate"), and the navigation, the home page and the mobile
bottom bar change with it. The switch is a pair of links (no client state); the workspace is derived
from the path (`/affiliate/**` = Affiliate, everything else = Belanja). "Akun" is shared.

| | Belanja (buyer) | Affiliate |
|---|---|---|
| Home | `/` Beranda | `/affiliate` Ringkasan |
| Nav | Beranda · Pesanan · Toko · Alamat · Akun | Ringkasan · Komisi · Program · Gabung · Akun |
| Mobile bar | same five | same five |
| Sidebar identity | name + email, "Akun pembeli" | name + email, "Affiliate · N toko" |
| Empty first-run | "Simpan pesanan pertama" (how the claim link works) | "Gabung program toko" (store address form) |

The workspace switch is shown only when it leads somewhere useful: a buyer with no affiliate row sees
"Affiliate" as a quiet entry in Akun ("Jadi affiliate toko"), not as a permanent second workspace.

### 18.3 Routes

Buyer routes follow §6 (clean English paths). Entry links that **other apps already emit** keep their
path, because they are contracts with the storefront and the Seller dashboard: `/klaim` (success
page), `/affiliate/undangan` (seller invitation), `/masuk` (sign-in). The 2026-10-15 Indonesian
buyer paths (`/pesanan`, `/toko`, `/alamat`, `/akun`, `/sesi`) were never published and are gone
(no redirects; removed 2026-10-16 after the audit).

| Path | Screen | Data |
|---|---|---|
| `/masuk` | Sign-in (prototype `login-shell`: context column + card) | Google; local dev sign-in only in dev |
| `/` | Beranda | §18.4 A |
| `/orders` | Pesanan — search, store filter, status tabs (URL-addressable `?q=&toko=&status=`) | `myOrders` + filters |
| `/orders/{PHI}` | Status-first detail | `myOrder` |
| `/orders/{PHI}/receipt` | Bukti pesanan (printable, `PHI-…` identity, never `INV-…`) | `myOrder` |
| `/stores`, `/stores/{slug}` | Toko + connected-store profile | `myStores` + recent orders of that store |
| `/addresses`, `/addresses/edit` | Alamat | `addresses.ts` |
| `/account` | Profil & keamanan | account, sessions, linked stores |
| `/klaim` | Consent screen | `previewClaim` / `claimOrder` |
| `/affiliate` | Ringkasan | `myAffiliateStores` |
| `/affiliate/komisi` | Cross-store commission ledger, filter by store and state | new read, §18.4 F |
| `/affiliate/program`, `/affiliate/{id}` | Programmes and one programme | `myAffiliateDetail` |
| `/affiliate/gabung`, `/affiliate/undangan` | Join, accept invitation | existing |

### 18.4 Screen contracts as built

**A. Beranda (buyer).** `Halo, {name}` (no emoji, no eyebrow). One **action card per real job**,
most urgent first, only when it exists: prepaid order with `payments.status = 'menunggu'` → "Selesaikan
pembayaran" (opens the order's payment section); order `dikirim` with an AWB → "Paket sedang dikirim"
+ copy AWB. Stat tiles (2×2 on phones): Pesanan aktif, Toko terhubung, Alamat tersimpan, and — only
for an affiliate — Komisi siap dibayar. "Pesanan terbaru" (3, with the first line item's product
photo when `product_media` has one, else a neutral package icon). "Beli lagi": up to 3 distinct
products from delivered orders that still exist and are active in that store, linking to the
storefront product page — no price promise (the storefront decides the current price).
"Bantuan": claim another order, manage addresses, sign out other devices.

**B. Pesanan.** Search (order number or line title), store select, status tabs Semua · Belum bayar ·
Aktif (`baru`/`diproses`/`dikirim`) · Selesai · Dibatalkan/Retur. Each card: product photo, store,
status badge, date, first line + "+N produk", total, and the **next fact** as a link label
("Selesaikan pembayaran", "Lacak: JNE JP…", "Lihat bukti pesanan"). Result count. Distinct empty
states: no orders at all (how to save one) vs. no match (clear filters).

**C. Order detail.** Heading = human status ("Menunggu pembayaran", "Dalam pengiriman" …); meta line
store · `PHI-…` · date. Summary card: total, status badge, primary action by state (pay → payment
section; shipped → copy AWB; otherwise "Hubungi {toko}" WhatsApp when the store has a number) and
secondary "Bukti pesanan". Sections (anchors, not JS tabs): **Pembayaran** (method, status, amount,
fee, total; for an unpaid VA the account number with copy, for e-wallet the provider `url` as
"Lanjutkan di …"; a QR string is never drawn as an image — the buyer is sent to the store's
`/checkout/sukses` equivalent only if one exists, else told to pay via the VA/URL shown); **Pengiriman**
(courier, AWB with copy, progress steps; no fabricated events, map or ETA); **Produk** (photo, title
incl. variant, qty × price); **Dikirim ke** (snapshot + "Perubahan alamat tersimpan tidak mengubah
alamat pesanan ini."); **Rincian total** (subtotal, ongkir, pajak, diskon, payment fee remainder,
total).

**D. Bukti pesanan.** One printable page: store, `PHI-…`, dates, lines, totals, payment, ship-to.
`@media print` hides the shell.

**E. Toko / connected-store profile.** List ordered by last purchase: store initial avatar, name,
order count, last order date, "Lihat toko" (profile) . Profile: relationship context (first/last
order, count), recent orders of that store, privacy note, **Kunjungi toko** (the canonical origin,
one external handoff), **Putuskan** behind a confirm dialog explaining the consequence (§ACC-8).

**F. Affiliate Ringkasan / Komisi / Program.** Ringkasan: three totals across stores (Siap dibayar,
Masih ditahan, Sudah dibayar) with a one-line explanation of the H+3 hold; per-programme rows (store,
status badge, code, orders, ready amount); a "Bagikan" shortcut per active programme. Komisi: one
ledger across every programme of the account — date, store, `PHI-…`, base, commission, state badge
(belum selesai / ditahan s.d. {date} / siap / dibayar {date} / batal), filters by store and state,
query carries `account_id = me` exactly as `myAffiliateDetail` does. Program detail: code, share link
with copy, status banner (menunggu/ditolak/nonaktif), that store's totals and ledger, the bank account
**masked** (`•••• 1234`, read-only — changing a payout account stays with the seller, because an
affiliate-editable payout account is a fraud path), and "Pertanyaan pembayaran: hubungi toko".
Gabung: store address → store card → form (existing `joinProgramme`). Undangan: consent card.

**G. Akun.** Informasi pribadi (name editable — `buyer_accounts.name`; email from Google read-only);
Keamanan dan perangkat (`buyer_sessions`: this device, others with last activity, "Keluarkan" per
device and "Keluar dari perangkat lain" — ACC-3; "Keluar dari akun"); Toko terhubung summary with link
to Toko; Alamat summary; Affiliate entry. Theme: Terang / Gelap / Sistem.

**H. States everywhere.** Empty, not-found (404 page in the shell), form error next to the field with
values kept, success notice as `role="status"`, confirm dialogs for destructive actions (native
`<dialog>` with a no-JS `<details>` fallback is acceptable).

### 18.5 Prototype elements deliberately left out (no backend in phase 1)

| Prototype element | Why out | Unlocks with |
|---|---|---|
| Phone + OTP sign-in, "Ubah nomor HP", "Nomor lama tidak bisa diakses" | No messaging provider | Task 8.38 → 10.14 |
| Notification bell / `/notifications`, notification preferences | No delivery channel, no central contract (§6) | Task 8.38 + a notification task |
| Voucher cards, "Voucher tersedia" tile | Non-goal §5I; no bounded voucher projection | separate task |
| Help/complaint requests, return requests | No operator intake | phase 2 runbook |
| Payment simulation, QR image | §12: QR fixtures never become fake images; no payment action in phase 1 | — |
| Tracking timeline / events | No shipment-event table | shipping events task |
| COD trust status | Gate 13 | gate 13 |
| "Minta salinan data" | Needs operator capability + privacy review | OD-6 |
| "Ajukan penutupan akun" | **Built as self-service "Tutup akun" (ACC-15, 2026-10-19)** — no operator intake needed; retention of backups and store-side copies still needs the privacy review | OD-6 (retention only) |
| Guest checkout demo, merchant projection sketch | Belong to the storefront / Seller apps | — |
| Prototype banner "Mode Uji Coba Lokal" | The app runs on real rows; a dev-only footer note replaces it | — |

### 18.6 Acceptance (Task 10.16–10.19)

- Every route above renders at 390 and 1280 px, light and dark, with no horizontal overflow and no
  console error; keyboard reaches every control with a visible focus ring; touch targets ≥ 44 px on
  phones.
- Buyer negative sweep unchanged (another account → 404 on any order, store profile or receipt);
  affiliate negative sweep: another account's programme id or ledger row → 404/absent.
- `astro check` 0 errors, account tests green on the branch DB, `astro build` succeeds, and the
  committed `apps/account/scripts/check-ui.mjs` drives the routes against the build.
- design-taste gate (`design-gate.py apps/account`) exits 0 with an independent visual review.
- ACC-15: the closure test above (real Postgres; five mutations proved red) and the live refusal for an
  account with unpaid commission.

## 19. Market research and content review (2026-10-19)

Owner direction: research the Indonesian market before perfecting content, UX and this document.
Method, sources and **evidence grades** are in
[`tasks/2026-10-19-account-market-research.md`](tasks/2026-10-19-account-market-research.md). The grade
matters: several findings rest on press or vendor pages, none was verified inside a marketplace app,
and for sign-in preference **nothing was found**. A decision below that rests on a weak grade says so.

### 19.1 What the research changes

| # | Finding (grade) | Decision |
|---|---|---|
| R1 | Marketplaces tab orders by the buyer's next action (belum bayar → perlu dikirim → dikirim → selesai → batal/pengembalian) and give a tracking entry on the order (A/B). | **Already matched** (§6 Orders list, status-first detail). No change. |
| R2 | Shopee completes orders by the system ~2 days after arrival and states a short, tiered return window (A for the windows, B for the 2026 change). | **Deferred — OD-9.** We have no return event and no store-defined window; inventing "7 hari" would be a claim with no data behind it. The order page keeps "hubungi toko". |
| R3 | E-wallet ~60% of purchases, QRIS fastest-growing, COD ~40% and declining, 51% abandon when their method is missing (B/C, Xendit-only, n=1,000). | **No account change.** The order page already shows method, status, fees and "bayar ke kurir"; method availability is a checkout concern. |
| R4 | No evidence on phone/WhatsApp OTP vs Google (N; vendor claims only). | **Phase order unchanged** (Google now, phone OTP phase 2 on Task 8.38). The preference is an experiment to run, never a sentence to publish. |
| R5 | UU PDP gives withdrawal, stop and deletion rights; PP 33/2026 (reported, text unread) wants consent that is specific, separate from T&C, and informed beforehand (B). | Claim consent already satisfies the reported shape (separate unticked checkbox, scope listed above it, per-store withdrawal). **Gap closed: ACC-15 "Tutup akun".** Legal confirmation against the PP text stays OD-6. |
| R6 | Affiliate commission is shown as estimate → validated → paid; only completed, unreturned orders count (C). | **Vocabulary kept** (Siap dibayar / Ditahan / Dibayar, H+N hold). It is the same model under different words. |
| R7 | Marketplaces withhold tax on affiliate payout and collect a 16-digit NPWP (B for the principle; current rates unverified). | **TokoΦ stores pay directly, so no platform withholding exists.** No screen may imply it; the store-side duty is OD-10. |
| R8 | Marketplace affiliate dashboards show clicks (C). | **Not built — OD-11.** There is no click data; a column would be invented. |

### 19.2 Content review of the built screens — what changed

- **Beranda:** the order shown in the status strip is no longer repeated in "Pesanan terbaru"; the
  column called "Bantuan" held settings shortcuts, so it is "Pintasan". The count tile for saved
  addresses was dropped earlier (rounds 6–7).
- **Order detail:** a delivered order has nothing to track, so the four-step list (derived from status,
  with no times) is one line; its primary action is "Bukti pesanan" and Produk leads, because that is why
  a buyer reopens a finished order. The "Hubungi toko" button is not duplicated at the top of a finished
  order; contact stays in "Butuh bantuan?". An in-flight order still leads with Pengiriman.
- **Akun:** "Tutup akun" (ACC-15) with a plain statement of what goes and what stays, a refusal that names
  the store when commission is still owed, and a sign-in notice afterwards.
- **Left as is, on purpose:** the Belanja/Affiliate switch on every phone page (the accepted prototype
  carries it); "Beli lagi" without a price (the account has no price projection and must not show a stale
  one); two scrolling chip rows on Komisi.

### 19.3 What closure does not do

It does not delete backups or store-side copies of the buyer's data (names and phones a store holds on its
own customer and affiliate rows). Those follow each store's retention and the privacy review (OD-6). The
product copy says exactly that: store records "tidak berubah dan tetap menjadi catatan toko".
