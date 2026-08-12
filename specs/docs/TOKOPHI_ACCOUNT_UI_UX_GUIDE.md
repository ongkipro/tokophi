# TokoΦ Account UI/UX Guide

> **Status — Proposed product and interaction contract.** The local prototype is evidence, not a deployed account service.
>
> **Language:** Buyer-facing UI uses Bahasa Indonesia. Technical documentation and implementation identifiers use English.
>
> **Safety boundary:** The prototype uses local fixtures and must not imply production authentication, notification delivery, voucher reservation, discount application, or persistence.

## 1. Product posture

TokoΦ Account is a private commerce utility, not a social network. It should feel familiar to Indonesian shoppers while keeping merchant data isolated.

The buyer should be able to:

1. identify the account and its verified contact;
2. understand what needs attention now;
3. open an order and resume the responsible store journey;
4. return to a previously purchased store;
5. discover currently advertised store vouchers without assuming eligibility;
6. reuse consented contact and address data after review;
7. control notifications, store connections, sessions, and closure.

Do not add public followers, likes, feeds, messaging, fabricated activity counts, cross-store merchant analytics, or gamification.

## 2. Information architecture

### Primary navigation

Keep exactly four destinations on desktop and mobile:

| Destination | Buyer job | Canonical route |
|---|---|---|
| Pesanan | Review cross-store order projections | `/orders` |
| Toko | Revisit stores derived from eligible orders | `/stores` |
| Alamat | Manage reusable delivery destinations | `/addresses` |
| Akun | Review identity, preferences, security, and connections | `/account` |

Notifications, transaction subpages, and store profiles are contextual destinations, not additional bottom-navigation items:

| Contextual destination | Entry | Route | Back destination |
|---|---|---|---|
| Notifications | Topbar bell | `/notifications` | Previous primary destination, with `/orders` as safe fallback |
| Order overview | Order or order notification | `/orders/{orders.number}` | `/orders` |
| Order receipt | Transaction overview | `/orders/{orders.number}/receipt` | Order overview |
| Shipment tracking | Transaction overview | `/orders/{orders.number}/tracking` | Order overview |
| Payment detail | Transaction overview or payment reminder | `/orders/{orders.number}/payment` | Order overview |
| Store profile | Store history, profile connection, or promo notification | `/stores/{merchant.slug}` | `/stores` |
| Returning checkout | Explicit store handoff/review journey | `/checkout` | `/stores` |

Routes use same-origin History API navigation and direct-load fallback; hash fragments are not routes. Nested order routes inherit Pesanan, store profiles inherit Toko, and notifications activate no primary item.

## 3. Global account shell

### Desktop

- Persistent global TokoΦ Account brand, not merchant-owned branding.
- Left navigation with identity context and four primary destinations.
- Main content uses one clear page title and a restrained maximum width.
- Topbar notification action precedes the profile action.

### Mobile

- Single-column content.
- Four-item fixed bottom navigation.
- Nested screens retain explicit back navigation.
- Content must leave safe clearance above fixed navigation.
- Primary interactive targets are at least 44 by 44 CSS pixels.

### Global feedback

- Route changes move programmatic focus to the main heading/content boundary.
- Local-only mutations use a polite toast or inline status.
- Destructive or consent-changing production actions require confirmation; prototype actions must state that nothing was written.
- Loading uses skeletons only where content shape is known. Empty and error states use direct recovery actions.

## 4. Notification center

### Purpose

The center summarizes buyer-relevant commerce events. It must not expose merchant-internal CRM notes, platform billing, advertising outbox events, or another store's customer data.

### Supported prototype types

| Type | Source of truth | Primary action |
|---|---|---|
| Order status | Existing order status/timeline projection | Open canonical order detail |
| Shipment update | Fulfillment timeline and AWB projection | Open canonical order detail |
| Payment reminder | Existing pending payment projection | Open canonical order detail; a future payment-resume action needs an accepted store-owned contract |
| Store promotion | Explicit local store-promo fixture | Open the connected-store profile |

Every item contains an opaque notification ID, store identity, type, title, short message, timestamp, read state, and safe route. Order actions use `orders.number` with the canonical `PHI-` prefix; raw order/customer/payment UUIDs never appear in buyer navigation.

### Read state

- Unread count appears on the topbar action and has an accessible label.
- Opening an item may mark it read in local session state.
- `Tandai semua dibaca` affects local session state only in the prototype.
- Profile notification toggles and inbox read state must explicitly say that they are not persisted.
- A production inbox requires an accepted central notification schema, retention policy, delivery pipeline, preference model, and API contract.

### States

| State | Expected behavior |
|---|---|
| Loading | Notification-shaped skeletons; bell remains reachable |
| Empty | Explain that no local notifications are available; no fake recommendations |
| Partial | Render available bounded events and identify missing fixture scope |
| Error | Preserve current route and offer retry |
| All read | Keep history visible and remove unread emphasis/count |

## 5. Connected-store profile

### Membership rule

A store may appear only when represented by an eligible linked or claimed order. Browsing, phone matching, abandoned checkout, notification delivery, or voucher discovery cannot add a connected store.

### Content hierarchy

1. Store identity: name, category, and connection/history context.
2. External handoff: one explicit `Kunjungi toko` action when a canonical storefront is available.
3. Active voucher fixtures advertised by that store.
4. Recent eligible orders at that store.
5. Privacy and tenant boundary.
6. Transparent unavailable state when the storefront is not provisioned.

Do not show merchant-internal customer segment, notes, global buyer spend, another store's orders, or inferred affinity/follow status.

### Store handoff rule

- `Kunjungi toko` opens the exact canonical merchant storefront homepage in a new tab with `noopener noreferrer`.
- The account never restores an old cart, preselects a historical variant, submits an order, or claims that a voucher was applied.
- The merchant storefront remains responsible for current publication, catalog, stock, cart, price, promotion, tax, shipping, COD, and checkout.
- Unprovisioned stores have no external CTA and no fabricated voucher inventory.

## 6. Voucher presentation

### Active-display predicate

A voucher may be advertised only when all known store-authoritative conditions hold:

```text
status != "nonaktif"
AND (startsAt is null OR now >= startsAt)
AND (endsAt is null OR now < endsAt)
AND (usageLimit is null OR usedCount < usageLimit)
```

This predicate is suitable for advertising, not final redemption. Cart eligibility and quota can change after display.

### Visible fields

- voucher code;
- benefit: percentage, nominal IDR, or free shipping;
- minimum purchase when non-zero;
- expiry when available;
- `Salin kode` as a local convenience;
- one shared store-level `Kunjungi toko` handoff.

Never show `Terapkan`, `Sudah dipakai`, `Dipesan`, `Dijamin`, or any state implying reservation or guaranteed eligibility.

Use this disclosure near the voucher list:

> Kode voucher berlaku di {storeName}. Potongan akhir dihitung saat checkout berdasarkan isi keranjang dan ketersediaan promo.

### Pricing authority

The merchant store's server-side `applyDiscount` flow remains authoritative. It rechecks status, time window, minimum subtotal, usage limit, and cart-dependent calculations. Flash-sale prices and automatic free shipping are separate store-authoritative mechanisms and must not be collapsed into an account-computed total.

## 7. Order and transaction language

| Concept | Buyer label | Canonical source |
|---|---|---|
| Order identity | Nomor pesanan | `orders.number`, `PHI-…` |
| Payment reference | Referensi pembayaran | `payments.reff_id`, same `PHI-…` value |
| Gateway transaction | ID transaksi gateway | `payments.trx_id`, when provider returns one |
| Shipment tracking | Nomor resi | Fulfillment/order AWB projection |

`INV-` and `SUB-` identifiers are merchant subscription billing references, not buyer invoices. The buyer account must not mint or display a second order identity.

### Transaction surfaces

- Overview leads with order state, merchant, total, delivery snapshot, and the next useful fact; receipt, tracking, and payment stay separate but share the same `PHI-…` identity.
- `Bukti pesanan` is a printable order receipt, not a tax invoice or second billing namespace.
- Tracking distinguishes completed, current, upcoming, problem, canceled, and return truth using existing events. No live map or ETA appears without provider evidence.
- Payment distinguishes order financial status from payment status, and displays method, amount, admin fee, total, reference, provider transaction ID, and supported instruction fields.
- Pending payment shows a resume action only when a real unexpired URL/session exists. A QR payload string is not rendered as a QR image.

### COD trust status

- Present this as `Status akses COD`, never a public score, permanent blacklist, or whole-account suspension.
- Default local state demonstrates two confirmed attributable outcomes out of the three-event threshold in a rolling 180-day window. COD remains available.
- A `?cod=restricted` fixture demonstrates a 90-day COD-only restriction after the third confirmed event; prepaid methods remain available.
- Only reviewed courier outcomes `310` and `311` can count. Other return/cancellation/problem outcomes and unresolved disputes do not count.
- Phone and exact normalized-address fingerprints can support identity review only. They never create a strike or permanent denial by themselves.
- Show threshold, time window, consequence, expiry, evidence category, and appeal/review path in text; never rely on color or a meter alone.
- Label this policy proposed until raw provider event identity/code, attribution, expiry, appeal, audit, and rollout contracts are implemented.


## 8. Profile and privacy

- Identity header shows only verified or explicitly labeled fixture facts.
- Activity counts are derived from loaded order/store/address fixtures.
- Transactional WhatsApp, unavailable email receipts, and opt-in store promotions are distinct preferences.
- Store connections list only consented/order-derived relationships.
- Session cards must not invent browser, device, location, or last-active facts.
- Merchant views remain store-scoped and never receive global addresses, other-store orders, global spend, sessions, or recovery data.

## 9. Visual system

- Reuse the existing off-white canvas, neutral cards, green primary accent, muted borders, and restrained shadows.
- Hierarchy comes from spacing, type weight, and grouped surfaces—not decorative gradients or excessive badges.
- Notification unread emphasis uses one subtle accent treatment; read items remain legible.
- Voucher cards may use a dashed boundary and monospace code, but the page must still read as an account utility rather than a campaign landing page.
- Store identity uses existing store marks and names; do not fabricate logos.
- Product imagery uses existing fixture assets with truthful alternative text and a non-deceptive fallback.

## 10. Accessibility and localization

- Use semantic buttons for local actions and anchors for external navigation.
- Icon-only controls require visible tooltip behavior where supported and an accessible name everywhere.
- Unread count must not be conveyed by color alone.
- Keyboard activation must work for notification rows, store cards, voucher copying, and back navigation.
- Focus remains visible; route transitions place focus predictably.
- `aria-live` announces route changes, copy confirmation, retry results, and local read-state changes without repeating full page content.
- Respect `prefers-reduced-motion`.
- Use `id-ID` whole-rupiah formatting and Asia/Jakarta calendar interpretation at approved backend boundaries.
- Buyer copy uses Bahasa Indonesia, not Malay; technical terms remain English where translation would reduce precision.

## 11. Prototype state matrix

| Surface | Normal | Loading | Empty | Partial | Error | Unavailable |
|---|---|---|---|---|---|---|
| Orders | Order list and filters | Skeleton list | No eligible orders | Bounded subset | Retry | Not applicable |
| Store history | Order-derived stores | Skeleton cards | No eligible stores | Bounded subset | Retry | Card explains missing storefront |
| Store profile | Identity, vouchers, recent orders | Profile skeleton | No eligible data | Bounded vouchers/orders | Retry | No external handoff or voucher claim |
| Notifications | Read/unread event list | Notification skeletons | No events | Bounded event subset | Retry | Unsupported action remains disabled/explained |
| Transaction overview/receipt | Canonical order and printable bounded receipt | Skeleton | Not found | Legacy fields labelled absent | Retry | Unsupported actions omitted |
| Tracking | Chronological supported events | Skeleton | No tracking events yet | Bounded event history | Retry | No map/ETA fabrication |
| Payment | Supported payment record and instructions | Skeleton | Honest legacy null state | Missing optional provider fields | Retry | No resume action without URL/session |
| COD trust | Eligible or warning status | Skeleton | No attributable events | Review pending | Retry | COD-only temporary restriction; prepaid remains |
| Addresses | Saved destination list | Skeleton cards | No saved addresses | Bounded subset | Retry | Missing district ID blocks deterministic reuse |
| Profile | Identity and controls | Identity plus skeleton body | Identity plus empty explanation | Derived bounded counts | Identity plus retry | Unimplemented preference remains disabled |

## 12. Production acceptance criteria

The UI contract is ready for production implementation only when:

1. central account identity, session, and consent models are accepted;
2. the proposed account OpenAPI contract is accepted and implemented with conformance evidence;
3. notification event ownership, read state, preferences, retention, and delivery are specified;
4. store promotion projection ownership and freshness are specified without bypassing tenant RLS;
5. account never claims voucher applicability before store checkout validates the cart;
6. canonical custom-domain/storefront handoff is resolved server-side;
7. global saved addresses include the approved courier destination ID model;
8. raw courier event evidence, attributable COD outcomes, expiry, appeal, audit, and linkage safeguards are accepted before COD enforcement;
9. payment-resume actions are backed by real unexpired store/gateway sessions;
10. recovery, unlink, closure, privacy rights, abuse controls, observability, rollout, and rollback are accepted;
11. desktop and mobile browser evidence covers keyboard navigation, direct deep paths, loading/empty/partial/error states, external handoff, and zero horizontal overflow.

## 13. Remaining product gaps

### Critical backend blockers

- No deployed central account origin, global buyer identity table, session service, consent grant, or projection handlers.
- `specs/openapi/account.yaml` remains proposed and has no notification or store-promotion projection contract.
- Store-scoped customer rows cannot safely substitute for a global buyer subject.

### High-priority service gaps

- No central notification inbox, automated buyer delivery pipeline, persistent preference model, or read-state retention.
- No approved cross-boundary store-promotion projection; final voucher evaluation must stay store-scoped.
- No accepted phone-change, account-recovery, session-revocation propagation, or abuse-control implementation.
- Persisted customer addresses remain tenant-scoped and lack the courier destination ID required for deterministic global reuse.
- Current tracking handling collapses provider outcomes into order states and a generic return reason; it does not yet persist sufficient raw evidence for safe buyer COD attribution.
- Privacy/legal, retention/deletion, account closure, incident response, rollout, and rollback decisions remain open.

### Product decisions still required

- Whether pending payments may expose a safe store-owned resume-payment action.
- Whether cancellation, return, refund, dispute, and review journeys belong in the central account or hand off to each merchant.
- Notification history retention, channel precedence, and transactional-versus-promotional consent rules.
- Voucher projection freshness, cache policy, and behavior when quota expires between account display and store checkout.
- COD policy ownership, raw evidence retention, event attribution/review, cross-store linkage safeguards, appeal, expiry, and rollout.

These gaps must remain explicit. A polished local prototype does not prove that the underlying identity, notification, promotion, or privacy systems exist.
