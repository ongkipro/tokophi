# ADR 0016 — Global TokoΦ buyer identity with per-store customer projections

**Status:** accepted · **Date:** 2026-08-11 · **Decided by:** the owner · **Supersedes:** the per-store buyer-account recommendation in `docs/tasks/2026-08-11-buyer-account-readiness.md` and `docs/ARCHITECTURE_AUDIT_2026-08-11.md`
**Related:** ADR 0003 (shared multi-tenancy), ADR 0009 (SSR multi-tenant storefront), `docs/TOKOPHI_ACCOUNT_SPEC.md`

## Context

A buyer may purchase from several independent merchants running on TokoΦ. A separate account per store would repeat phone verification, addresses, sessions, and order-history navigation while producing little value beyond guest checkout.

The selected product direction is a TokoΦ-level account similar in product shape to a cross-store order and checkout identity: one buyer can authenticate once, reuse approved contact/address data, and see their own orders across participating TokoΦ stores. Each purchase, fulfillment, support relationship, and merchant customer record remains owned by the individual store.

The existing `customers` table is store-scoped commerce/CRM data. It must not become a global customer directory, and merchant access must never reveal the buyer's relationship with other stores.

## Decision

### One global buyer subject

TokoΦ owns one central buyer identity subject containing authentication identifiers, verification state, sessions/devices, account profile, global saved addresses, consent/link records, and a bounded cross-store order read model.

The conceptual first-party identity origin is:

```text
https://account.tokophi.com
```

The exact production hostname remains subject to DNS/deployment acceptance, but the trust boundary is accepted: it is a platform identity origin, not a tenant storefront or merchant-admin session.

### Store customer rows remain separate

Each merchant continues to own a separate `customers` record under `store_id`. Physical customer rows are never merged across stores.

A consent-stamped association links one global buyer subject to one store customer projection:

```text
global buyer subject
  -> buyer/store/customer link
      -> one store-scoped customers row
          -> that store's orders and addresses/snapshots
```

The association is the only cross-layer join. A merchant application may see that its own customer is connected and verified, but may not query the global profile or infer another merchant relationship.

### Buyer and merchant projections differ

The authenticated buyer may see a bounded projection of their own orders across linked stores: merchant identity, order number, items, totals, status, fulfillment/tracking, immutable delivery snapshot, and merchant support path.

A merchant sees only its own customer projection, its own orders, and the minimum connection/verification state required for that tenant's workflow. The merchant never sees cross-store order history, global addresses not selected for its order, device/session history, browsing activity, aggregate spend, or other store links.

### Guest checkout remains mandatory

An account is optional. Registration or sign-in must not block checkout. After an order is accepted, the buyer may link it to an existing/new TokoΦ Account. Failure or abandonment of account linking cannot roll back, duplicate, or hide the order.

### Central authorization handoff, not shared cookies

Hosted tenant storefronts and verified custom domains redirect to the central account origin using an authorization-code flow with PKCE, exact redirect URI, state, short lifetime, and single-use code. The tenant storefront/BFF exchanges the code and creates its own same-origin buyer session or receives a bounded projection.

No buyer session cookie is shared across unrelated tenant/custom domains. No bearer token is placed in a URL, browser analytics, or local storage.

### Consent-gated linking and historical claims

Linking a store customer record to the global subject requires an explicit buyer action and recorded consent/version. A future order placed while authenticated may link under that accepted consent. A historical order requires verified control of the account identifier plus order-specific possession proof; matching phone alone is insufficient.

### Two-layer closure and deletion

Closing the global account immediately revokes central sessions and removes/disables reusable credentials and global convenience data according to the approved policy. Store-owned order, payment, ledger, fulfillment, invoice, and legally retained commerce records are retained or anonymized under the applicable per-store policy. Closure must not corrupt merchant books or historical order snapshots.

## Initial capability

The initial product consists of:

1. phone verification and central session/device management;
2. global profile and saved delivery addresses;
3. consented store connections;
4. linking new orders and claiming eligible historical orders;
5. cross-store order history, detail, fulfillment, and tracking;
6. contact/address autofill at participating storefronts;
7. unlink and closure workflows subject to approved retention policy.

## Explicit non-goals

- Payment-card storage, a payment vault, buyer wallet, stored balance, or platform credit.
- Required account creation before checkout.
- Sharing buyer cookies across merchant/custom domains.
- Exposing cross-store activity or global buyer analytics to merchants.
- Combining carts or checkout across stores.
- Loyalty, referrals, subscriptions, social graph, or advertising audience features.
- Reusing merchant `users`, platform `platform_admins`, their cookies, JWT audiences, roles, or recovery flows.

## Consequences

### Positive

- One account and order hub create buyer value across the whole TokoΦ network.
- Returning checkout can reuse verified contact/address data without turning registration into a conversion wall.
- Store customer/commerce ownership and merchant tenant isolation remain intact.
- Payment-wallet risk is avoided in the initial release.

### Cost and risk

- TokoΦ becomes responsible for linking a person's activity across independent merchants, materially increasing privacy, account-takeover, recovery, deletion, support, and breach consequences.
- Central identity becomes a platform-critical service and requires shared abuse limits, off-box alerting, durable session revocation, and a separate account-origin API contract.
- Recycled/shared phone numbers make historical claims unsafe without order-specific proof.
- Runtime database role/RLS gaps must close before the global link/read model is implemented.

## Implementation gates

This ADR accepts product direction only. Implementation remains blocked until all of the following are accepted and evidenced:

1. qualified privacy/legal review of cross-store aggregation, consent, role allocation, retention, deletion, and transfer;
2. non-owner runtime database role design and cross-tenant/global-projection conformance tests;
3. OTP provider, recovery, phone-change, abuse/cost, and support policy;
4. authorization-code/PKCE, central/tenant session, revocation, redirect registry, and custom-domain lifecycle contract;
5. proposed `account.tokophi.com` OpenAPI contract and route conformance plan;
6. merchant projection field allowlist and buyer order projection denylist;
7. identity observability, alert recipient, rollback, staged rollout, and incident runbook;
8. local UI/UX prototype acceptance across buyer and merchant surfaces.

## Alternatives rejected

- **One independent buyer account per store.** Rejected because it duplicates verification and saved data, fragments order history, and creates little platform-level buyer value.
- **Make `customers` global.** Rejected because it destroys merchant ownership and tenant isolation semantics.
- **Shared account cookie across every custom domain.** Rejected because cookie scope, browser behavior, and tenant trust boundaries make it unsafe and unreliable.
- **Build the payment vault first.** Rejected because tokenized payment reuse adds financial/security scope before identity, consent, recovery, and order aggregation are proven.
