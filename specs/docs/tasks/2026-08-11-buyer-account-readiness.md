# TokoΦ Account Readiness Backlog

> **Status:** Planned only. [ADR 0016](../../decisions/0016-global-buyer-account.md) accepts a global TokoΦ buyer identity with isolated per-store customer/order projections. [`TOKOPHI_ACCOUNT_SPEC.md`](../TOKOPHI_ACCOUNT_SPEC.md) is the canonical product and UX contract.
>
> **No authorization:** No buyer registration/authentication endpoint, OTP delivery, session, schema migration, account-origin deployment, production data link, or OpenAPI operation is authorized by this backlog.
>
> **Current evidence:** `customers.registered_at` and `customers.password_hash` exist but are dormant schema, not an auth system. Storefront buying remains guest-first. Buyer identity must never reuse merchant `users`, `store_users`, `platform_admins`, their sessions, roles, recovery, or cookie/JWT audiences.

## Accepted direction

- One global TokoΦ buyer subject.
- `customers` and orders remain store-scoped and are never physically merged across merchants.
- A consent-stamped link joins the global subject to one store customer projection.
- Buyer may see an allowlisted projection of their own orders across connected stores.
- Merchant may see only its own customer and order projection.
- Guest checkout remains available; account connect happens after order acceptance or by explicit returning-buyer action.
- Central account origin uses authorization code + PKCE and exact redirect binding; tenant/custom domains never share buyer cookies.
- Initial product: identity, saved addresses/contact prefill with explicit review and confirmation, cross-store order hub/tracking, order-derived store history with return-to-store links, consented store connections, sessions/devices, claim/unlink/closure.
- Payment vault/wallet, cross-store cart, loyalty, and merchant cross-store analytics are out of scope.

## Work packages

### 1. Local UI/UX prototype

**Owner:** product/design + frontend · **Gate:** before API/schema implementation

Build deterministic local-only sketches for:

- account overview;
- cross-store orders list and detail;
- saved addresses;
- order-derived store history and safe return-to-store links;
- returning-buyer prefill review/confirm states;
- profile/security/sessions/connected stores;
- connect/claim states;
- merchant customer projection showing only its own account-link status.

**Done when:** the prototype meets `TOKOPHI_ACCOUNT_SPEC.md` §12, passes desktop/mobile/keyboard/browser inspection, and owner decisions are recorded. Prototype is not backend or security evidence.

### 2. Privacy and jurisdiction decision

**Owner:** privacy/legal owner + product owner · **Gate:** before schema/API approval

Decide and record:

- controller/processor or other applicable role allocation;
- purpose/lawful basis and consent version for cross-store aggregation;
- notices, export/access/correction/unlink/closure workflows;
- retention/deletion/anonymization for global convenience data versus store commerce records;
- backup/log/analytics/support propagation;
- children/minors and recycled/shared phone handling;
- Singapore hosting/remote access and onward-transfer mechanism.

**Done when:** [`PRIVACY-COMPLIANCE.md`](../PRIVACY-COMPLIANCE.md) has qualified-owner decisions and evidence for every account row; no `Unknown` account launch gate remains.

### 3. Data model and tenant boundary

**Owner:** platform/data + security · **Gate:** before migration

Define:

- global subjects, identifiers, sessions/devices, addresses, consent/link, claim, recovery, and audit data;
- store-scoped `customers` ownership and immutable order/address snapshots;
- foreign keys/unique constraints preventing cross-store link mismatch;
- non-owner runtime roles and exact RLS/transaction-boundary enforcement;
- buyer order projection allowlist and merchant denylist;
- duplicate/null/malformed data screening, migration/rollback, deletion dependencies, and seed parity.

**Done when:** schema proposal, migration plan, rollback, cross-tenant conformance matrix, and data-screening output are accepted; owner connection and broad `public` privileges are absent from runtime design.

### 4. Identity, OTP, recovery, and abuse controls

**Owner:** security/identity + product/support · **Gate:** before auth implementation

Decide:

- phone normalization/uniqueness and optional email role;
- OTP provider, sender identity, sandbox, timeout, resend, attempts, expiry, lockout, fallback, budget, and delivery evidence;
- account existence/phone enumeration resistance;
- recycled/shared/lost phone, SIM swap, phone change delay/notification, and support recovery;
- central session lifetime, rotation, device list, sign-out, revoke-one/revoke-all, and sensitive-action re-verification;
- shared rate limits across replicas and provider-cost protection;
- narrow platform-support capabilities with immutable audit and no permanent impersonation.

**Done when:** threat/control matrix, provider sandbox evidence, recovery policy, abuse quotas, support runbook, and secrets plan are accepted.

### 5. Central authorization and client topology

**Owner:** identity/platform + security · **Gate:** before connecting any storefront

Specify:

- central origin deployment and availability;
- registered store clients and exact redirect URIs;
- authorization-code + PKCE, state, nonce where applicable, code lifetime/single-use, store/client binding, and scopes;
- host-scoped central and tenant/BFF session cookies with separate names/audiences/issuers;
- no bearer token in query, fragment, logs, analytics, or local storage;
- custom-domain verification, activation, rotation, suspension, deletion, and redirect invalidation;
- web, external renderer, and native-client differences.

**Done when:** sequence diagrams, redirect registry lifecycle, conformance tests, failure/recovery behavior, and rollback are accepted.

### 6. Account-origin OpenAPI

**Owner:** identity/API + security · **Gate:** before route implementation

Review and accept [`../../openapi/account.yaml`](../../openapi/account.yaml), the proposed and explicitly not-deployed OpenAPI 3.1 contract. It remains separate from:

- observed legacy storefront writes in `openapi/current.yaml`;
- proposed tenant/headless commerce API in `openapi/headless.yaml`.

Cover:

- authorize/code exchange;
- OTP challenge/verification;
- account/profile;
- cross-store orders and detail;
- saved addresses;
- order-derived store history (`GET /stores`), distinct from consent connections;
- returning-checkout contact/address projection and review contract;
- store connections/consent/unlink;
- historical order claim;
- sessions/devices/revocation;
- phone change/recovery;
- closure/export request state where accepted.

Resolve the remaining policy-owned operations (phone change/recovery and export request) only after their workflows are accepted. Preserve exact errors, idempotency/replay rules, cache policy, rate-limit responses, pagination, whole-IDR safety, scope/store binding, and no tenant selector where the account subject determines ownership.

**Current evidence:** Redocly validates `account.yaml` as OpenAPI 3.1; the only warning is deliberate because browser `/authorize` correctly responds with `302`, while the generic rule expects a `2XX`. **Done when:** owners accept the contract, every accepted route has `operationId`, errors/security/caching are explicit, generated types/SDK are verified, and route conformance tests are planned.

### 7. New-order linking and guest preservation

**Owner:** storefront/commerce + identity · **Gate:** before production rollout

- Keep checkout guest-first.
- Offer connect only after order acceptance or explicit sign-in.
- Never roll back, duplicate, hide, or auto-submit an order when linking or prefill fails.
- Link authenticated new orders under current accepted consent.
- Preserve cart/store/variant/quantity/promotion/shipping across auth round trips.
- Present accepted contact/address prefill for explicit buyer validation and confirmation; re-quote shipping and recompute authoritative totals before order creation.
- Send `Belanja lagi` to the current merchant storefront without reconstructing an historical cart.

**Done when:** browser/API/DB tests cover guest, signed-in, declined, expired, replayed, wrong-store, provider-down, duplicate-submit, and account-service outage paths.

### 8. Historical claims

**Owner:** identity/security + commerce/support · **Gate:** before showing historical orders

- Phone match alone cannot enumerate or link orders.
- Require current verified identifier plus order-specific possession proof.
- Resolve shared/recycled phone, typo, buyer reassignment, cancellation/refund, and support escalation.
- Audit every attempt and protect against brute force.

**Done when:** owner accepts proof policy and adversarial tests show no cross-buyer/store disclosure.

### 9. Buyer hub and merchant projection

**Owner:** buyer product + merchant admin + security · **Gate:** before UI release

Implement only the accepted screen/field contracts in `TOKOPHI_ACCOUNT_SPEC.md`:

- buyer order projection includes merchant, items, totals, safe payment/fulfillment/tracking, address snapshot, support path;
- merchant projection includes only its own customer/link status and store-owned orders;
- global addresses/sessions/store links/cross-store aggregates never enter merchant queries or cache keys.

**Done when:** component, API, and database conformance tests cover every allow/deny row and accessible empty/error/loading/expired/suspended states.

### 10. Privacy operations and account lifecycle

**Owner:** privacy + identity + service/support · **Gate:** before account launch

- Export/access/correction/unlink/closure request intake and identity proof.
- Two-layer closure: central credentials/convenience data versus retained/anonymized store commerce records.
- Revocation propagation, backups/logs/analytics/provider handling, legal holds, evidence, and user-visible status.
- Incident response for account takeover, identity-link error, cross-store exposure, and recovery abuse.

**Done when:** runbooks execute against staged data, evidence is retained/redacted as approved, and the buyer sees accurate outcomes/limitations.

### 11. Observability, rollout, and recovery

**Owner:** service/identity/security · **Gate:** before staged production

- Outcomes and latency for challenge, verification, authorize/exchange, projection, claim, revoke, and closure.
- Shared abuse/provider-budget signals without PII/token leakage.
- Named alert recipient and off-box delivery.
- SLO/error budget, dependency health, fallback behavior, staged cohort, rollback, and central-account outage plan.
- Reconciliation for link/order projection correctness.

**Done when:** alerts are delivered to a human, failure drills pass, rollback is tested, and account outage cannot block guest checkout.

## Required conformance matrix

| Scenario | Required result |
|---|---|
| Buyer subject links Store A and Store B | Two separate store customer rows; one consented global subject. |
| Store A merchant queries customer | Store A data only; no Store B existence or aggregate leaks. |
| Buyer queries hub | Own allowlisted orders only; no merchant internals. |
| Buyer queries store history | Only stores represented in eligible linked/claimed orders; browsing, phone match, or connection alone adds nothing. |
| Buyer selects Belanja lagi | Current storefront opens; catalog, price, promotion, and stock are revalidated. |
| Returning buyer authorizes data reuse | Accepted contact/address is shown for review and edit; no silent submission; guest path remains available. |
| Browser changes `store_slug`, redirect, state, or code | Fail closed; no session/link/order disclosure. |
| Code/token replay | Rejected; original accepted result remains unique/audited. |
| OTP delayed, repeated, guessed, or provider fails | No enumeration; quotas and recovery apply. |
| Phone is recycled/shared | No historic order enumeration or automatic claim. |
| Global account is closed | Sessions revoke; store books/orders remain under approved policy. |
| Account service unavailable | Existing cart and guest checkout remain usable. |
| Merchant/admin session is presented to account origin | Rejected; audiences and cookies are separate. |

## Sequence

1. Accept this direction and prototype the buyer/merchant UX locally.
2. Record prototype decisions in ADR/spec.
3. Complete privacy, data-boundary, OTP/recovery, and session/client gates.
4. Accept account-origin OpenAPI and data model.
5. Build central identity and conformance harness.
6. Build new-order linking, historical claims, projections, and lifecycle operations.
7. Complete privacy/operations evidence and staged rollout.

No implementation package may skip steps 1–4 because dormant account-like columns already exist.
