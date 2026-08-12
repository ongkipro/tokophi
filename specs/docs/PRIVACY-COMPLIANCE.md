# TokoΦ — Privacy and Compliance Engineering Record

> **Scope — Decision:** This is the canonical engineering record for personal-data applicability, inventory, data-subject workflows, retention/deletion, transfers, and privacy-control mapping for the TokoΦ platform. It does not provide legal advice, determine legal roles or lawful bases, approve notices/contracts, or claim compliance.
>
> **Owner — Decision:** The privacy owner owns this record. Security controls remain canonical in [`SECURITY.md`](SECURITY.md); schema truth remains `packages/db/src/schema.ts` plus [`SCHEMA.md`](SCHEMA.md); runtime behavior remains authoritative over prose.
>
> **Review status — Unknown:** Qualified Indonesian privacy/legal review has not been evidenced. [TBD owner=privacy/legal owner; due=before legal/privacy review sign-off]

## 1. Engineering applicability record

### JUR-ID-1 — Indonesia personal-data processing

- Trigger facts: TokoΦ stores merchant/operator identity data and shopper/customer contact, address, order, payment-status, fulfillment, support, chat, and behavior data. Evidence: `packages/db/src/schema.ts`, `apps/admin/app/api/public/order/route.ts`, and `apps/storefront/src/pages/api/track.ts`.
- Authority/source: [Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi](https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022), official BPK legal-information page.
- Source status: in-force
- Publication date: 2022-10-17
- Effective date: 2022-10-17
- Retrieved date: 2026-08-11
- Decision: Unknown
- Qualified owner: [TBD owner=qualified Indonesian privacy/legal counsel; due=before legal/privacy review sign-off]
- Engineering impact: Activate the `personal-data` and Indonesia jurisdiction review overlays; maintain the inventory, control mapping, and review gates below. This record does not determine controller/processor roles, lawful bases, notice wording, consent requirements, statutory timelines, or transfer sufficiency.
- Recheck trigger: Before launch approval, before materially changing purposes/categories/recipients, and after a relevant law or regulator update.

### XFER-ID-SG-1 — Singapore hosting and remote access
- Trigger facts: The production architecture stores and processes the §2 data categories on a Singapore origin and permits operational remote access.

- Exporter/importer roles and locations: Contracting entities and legal roles are Unknown; the application/database origin is observed in Singapore. [TBD owner=privacy/legal owner; due=before transfer review]
- Data subjects/categories: Merchants, operators, shoppers, customers, leads, and support participants; categories are inventoried in §2.
- Purpose: Application hosting, database persistence, media delivery, operations, and recovery.
- Storage/remote access: Vultr Singapore hosts the consolidated application and database; operator/support access locations and roster are Unknown.
- Mechanism review: Unknown; no legally sufficient Indonesian transfer mechanism or review is evidenced.
- Safeguards: Technical controls are mapped in §6; contractual and organizational safeguards remain Unknown.
- Onward transfers: Cloudflare, logistics, payments, marketing, OAuth, and human-access paths in §3 require qualified review.
- Retention/deletion: Unknown; category-specific gates are recorded in §4.
- Evidence: [`DEPLOY.md`](DEPLOY.md), `docker-compose.coolify.yml`, `packages/db/src/schema.ts`, and the recipient map in §3.
- Owner: [TBD owner=privacy/legal owner; due=before transfer review]
- Status: Unknown
- Engineering gate: Do not describe the Singapore deployment as transfer-compliant until the qualified owner records the mechanism and required controls.

## 2. Data inventory

**Observed:** The inventory is an engineering map of current code/schema, not a complete record of processing activities or a legal classification. **Decision:** Each new table, provider, purpose, telemetry payload, or storage location that handles personal data must update this inventory before release. Owner: feature owner; approval: privacy owner.

| Categories and examples | Data subjects | Purposes evidenced in code | Systems / exact evidence paths | Claim |
|---|---|---|---|---|
| Merchant and operator identifiers: name, email, phone, Google subject, role, authentication/session linkage | Merchant owners/staff; platform operators | Account access, tenant membership, RBAC, support, operator access | `packages/db/src/schema.ts` (`users`, `store_users`, `platform_admins`); `apps/admin/lib/auth.ts`; `apps/super-admin/lib/auth.ts`; `apps/admin/app/api/auth/google/callback/route.ts` | **Observed** |
| Store and business profile: store name/slug, business/contact details, bank/payout configuration, custom domains | Merchants; merchant representatives | Store operation, billing, payout, domain provisioning | `packages/db/src/schema.ts` (`stores`, `store_settings`, `payouts`, `store_domains`); `apps/admin/lib/actions/settings.ts`; `apps/admin/lib/actions/domain.ts` | **Observed** |
| Shopper/customer identity and contact: name, email, phone/WhatsApp, account state | Shoppers, customers, leads | Guest/account checkout, order communication, CRM and follow-up | `packages/db/src/schema.ts` (`customers`, `leads`, `followups`, `checkout_sessions`, `orders`) | **Observed** |
| Global buyer-account data: central subject/identifiers, profile, verification state, sessions/devices, global saved addresses, store-link consent, claim/recovery/audit, and bounded cross-store order projections | TokoΦ Account users | Optional cross-store identity, checkout autofill, order hub/tracking, session/security and rights workflows | **Proposed, not implemented:** [ADR 0016](../decisions/0016-global-buyer-account.md), [`TOKOPHI_ACCOUNT_SPEC.md`](TOKOPHI_ACCOUNT_SPEC.md) | **Proposed / Unknown legal basis and role allocation** — [TBD owner=privacy/legal owner; due=before account schema/API approval] |
| Delivery data: full address, district/village/postcode, recipient/sender contact, courier references and tracking | Shoppers/customers; merchant sender contact | Quote, booking, label, tracking, fulfillment | `packages/db/src/schema.ts` (`orders`, `customer_addresses`, `fulfillments`); `apps/admin/app/api/public/ongkir/route.ts`; `apps/admin/lib/shipping-book.ts`; `apps/admin/app/api/admin/labels/route.ts` | **Observed** |
| Transaction and commerce data: cart, products, quantities, prices, discounts, order/payment/financial/fulfillment status, invoice and payout records | Shoppers/customers; merchants | Checkout, payment reconciliation, fulfillment, merchant ledger, billing | `packages/db/src/schema.ts` (`checkout_sessions`, `orders`, `order_line_items`, `payments`, `ledger_entries`, `invoices`, `payouts`) | **Observed** |
| Communications and submitted content: support tickets/messages, shopper chat, reviews, CRM notes, WhatsApp templates/message attempts | Shoppers/customers/leads; merchants/operators | Support, shopper–merchant chat, reviews, follow-up | `packages/db/src/schema.ts` (`support_tickets`, `support_messages`, `chat_visitors`, `conversations`, `conversation_messages`, `reviews`, `wa_messages`) | **Observed** |
| Behavioral and device data: visit/funnel events, device classification, source/channel, timestamps; network address used by guards | Shoppers/visitors; unauthenticated callers | Store analytics, funnel reporting, abuse throttling | `packages/db/src/schema.ts` (`analytics_events`); `apps/storefront/src/pages/api/track.ts`; `apps/admin/lib/public-guard.ts`; `packages/lib/src/cache.ts` | **Observed** |
| Marketing integration data: public pixel/tag IDs, encrypted merchant API tokens, event IDs, commerce payloads; contact values hashed before provider delivery | Merchants; shoppers/customers represented in conversion events | Product feeds, browser/server conversion measurement and deduplication | `packages/db/src/schema.ts` (`store_tracking_channels`, `tracking_event_deliveries`); `apps/admin/lib/capi.ts`; `apps/admin/app/api/cron/tracking-events/route.ts` | **Observed** |
| Media/uploads that may include people or identifying content | Merchants; shoppers or other depicted persons | Store content and media library | `packages/db/src/schema.ts` (`media`); `apps/admin/app/api/uploads`; `docker-compose.coolify.yml` (`tokophi-uploads`) | **Observed** |
| Operational records: application/container logs, cron summaries, audit/activity rows, watchdog/probe state, backups | Operators, merchants, shoppers where identifiers enter errors/payloads | Troubleshooting, liveness, security evidence, recovery | `packages/db/src/schema.ts` (`cron_runs`, `platform_activity`); `docker-compose.coolify.yml`; `ops/tokophi-watchdog.sh`; `ops/tokophi-probe.sh` | **Observed** |
| Sensitive/special legal categories | Any | No intended purpose established | No canonical classification or collection prohibition is evidenced | **Unknown** — [TBD owner=privacy/legal owner; due=before approving forms/imports that could solicit such data] |
| Children/minors | Shoppers or account users | No age policy or intended processing purpose established | No age gate or canonical policy evidenced | **Unknown** — [TBD owner=product and privacy/legal owner; due=before public-launch privacy approval] |

## 3. Processor, recipient, and transfer map

**Unknown:** Legal role labels below are not resolved; “recipient/service” describes engineering flow only. **Decision:** Contracts, entity names, subprocessors, locations, remote support access, onward transfers, and legal mechanisms must be verified by the qualified owner before the transfer gate.

| Recipient / service | Data sent or accessible | Purpose / flow | Location or transfer status | Owner / gate | Claim |
|---|---|---|---|---|---|
| Vultr-hosted Coolify/Postgres origin | All application database categories, uploads, backups, and origin logs | Hosting, persistence, deployment, recovery | Singapore observed; legal mechanism Unknown | [TBD owner=privacy/legal owner; due=before transfer review] | **Observed / Unknown** |
| Cloudflare | Hostnames, network/request metadata, cached/proxied content; custom-hostname configuration | DNS, TLS/proxy, CDN, custom domains | Processing locations, contractual role, and onward transfers Unknown | [TBD owner=privacy/legal owner; due=before transfer review] | **Observed / Unknown** |
| KiriminAja | Origin/destination and parcel/order/contact data required by quote, booking, label, tracking, and COD flows | Shipping aggregation and fulfillment | Recipient fields are evidenced; contract, retention, location, and onward transfers Unknown | [TBD owner=logistics and privacy/legal owner; due=before logistics production approval] | **Observed / Unknown** |
| AutoLaris | Payment/order identifiers, amount and callback state; exact provider payload is implementation-owned | Payment initiation and callback reconciliation | Contract, processing location, retention, and onward transfers Unknown | [TBD owner=payments and privacy/legal owner; due=before payments production approval] | **Observed / Unknown** |
| Meta, Google, and TikTok endpoints | Merchant configuration; commerce/conversion facts; contact identifiers transformed as implemented before server delivery | Catalog and advertising conversion measurement | Merchant enablement is configurable; provider role, locations, retention, and transfer mechanisms Unknown | [TBD owner=marketing integrations and privacy/legal owner; due=before enabling each provider for production merchants] | **Observed / Unknown** |
| Google OAuth | Login request and identity profile fields | Optional merchant authentication | Production enablement and legal/transfer terms Unknown | [TBD owner=identity and privacy/legal owner; due=before enabling Google sign-in in production] | **Observed / Unknown** |
| Proposed TokoΦ central account origin and future OTP/identity providers | Global buyer identifiers, challenge/verification metadata, sessions/devices, consent/store links, and bounded projections; exact provider fields TBD | Central authentication, authorization handoff, recovery, and account security | **Not deployed**; provider, entity, location, contract, retention, and transfer status Unknown | [TBD owner=identity and privacy/legal owner; due=before account provider/API approval] | **Proposed / Unknown** |
| WhatsApp via `wa.me` handoff | Prefilled recipient phone and message leave the browser when a user opens WhatsApp | Merchant-initiated follow-up | TokoΦ records an attempt, not delivery/read state; recipient role and transfer assessment Unknown | [TBD owner=CRM product and privacy/legal owner; due=before automated messaging] | **Observed / Unknown** |
| Human operators/support with SSH, database, or super-admin access | Potential access to hosted categories according to granted privileges | Operations, incident response, merchant support | Access roster, countries, review cadence, and offboarding evidence Unknown | [TBD owner=security owner; due=before production-access review] | **Unknown** |

## 4. Retention and deletion decision table

**Decision:** No unresolved row below authorizes indefinite retention. **Decision:** Do not invent a duration; a qualified owner must approve purpose-linked periods, legal holds, deletion propagation, backup handling, and evidence before the named gate.

| Data / store | Current engineering behavior | Approved policy | Owner / gate | Claim |
|---|---|---|---|---|
| Merchant/operator accounts and tenant membership | Rows persist; deletion lifecycle is not established here | Unknown | [TBD owner=identity and privacy/legal owner; due=before account-closure launch] | **Observed / Unknown** |
| Proposed global buyer subjects, identifiers, sessions/devices, addresses, store-link consent, claims, recovery, and audit | Not implemented; two-layer closure semantics accepted by ADR 0016 | Unknown: purpose-linked periods, withdrawal/unlink effect, account closure, deletion/anonymization, immutable audit, recovery evidence, and backup/log propagation require qualified review | [TBD owner=identity and privacy/legal owner; due=before account schema/API approval] | **Proposed / Unknown** |
| Customers, addresses, orders, payments, ledger, invoices, payouts, fulfillments | Persistent relational records; commerce/financial dependencies constrain deletion | Unknown; legal/contractual retention and deletion/anonymization rules require review | [TBD owner=finance and privacy/legal owner; due=before deletion workflow approval] | **Observed / Unknown** |
| Checkout sessions and abandoned-cart contact data | Persistent rows and application workflows exist | Unknown | [TBD owner=storefront product and privacy owner; due=before public-launch privacy approval] | **Observed / Unknown** |
| Analytics events | Persistent rows; no canonical purge policy evidenced | Unknown | [TBD owner=analytics and privacy owner; due=before analytics production approval] | **Observed / Unknown** |
| Tracking event deliveries | `apps/admin/app/api/cron/tracking-events/route.ts` deletes rows older than 30 days in bounded batches | **Unknown:** the implemented 30-day purge is not evidence of legal/policy approval | [TBD owner=marketing integrations and privacy owner; due=before conversion tracking production approval] | **Observed / Unknown** |
| Support, chat, reviews, CRM/follow-up/message attempts | Persistent rows; no unified deletion workflow evidenced | Unknown | [TBD owner=support/CRM and privacy owner; due=before data-subject request runbook approval] | **Observed / Unknown** |
| Media and uploads | Persistent Docker volume plus database metadata; tenant/account closure behavior not established | Unknown | [TBD owner=platform and privacy owner; due=before account-closure launch] | **Observed / Unknown** |
| Database backups | Compose deletes dump files by file age according to current script; off-box propagation is unresolved in [`SLA-DRP.md`](SLA-DRP.md) | Unknown; recovery need and privacy deletion behavior require joint approval | [TBD owner=service owner and privacy owner; due=before DR/privacy sign-off] | **Observed / Unknown** |
| Application/container/probe logs and audit/activity rows | Different stores have different behavior; no canonical platform-wide log retention/redaction policy exists | Unknown | [TBD owner=service and security owner; due=before observability production-readiness approval] | **Observed / Unknown** |
| Rate-limit and failed-login in-process counters | Ephemeral process-local maps reset on restart/redeploy | Not a durable retention mechanism; approved security evidence period Unknown | [TBD owner=security owner; due=before security monitoring approval] | **Observed / Unknown** |

## 5. Rights workflow map

**Unknown:** The applicable rights, exceptions, verification standard, and response timelines require qualified interpretation of the official authority. **Proposal:** Treat the following as engineering capabilities to design after that interpretation; they are not proof that a legal right is satisfied.

| Candidate workflow | Current evidence | Required engineering decision | Owner / gate | Claim |
|---|---|---|---|---|
| Inform / transparency | Product UI and documentation contain scattered explanations; no approved privacy notice is evidenced | Approve audience-specific notices, purposes, recipients, retention, contact, and version evidence | [TBD owner=privacy/legal owner; due=before public-launch privacy approval] | **Unknown** |
| Access / copy | Merchant screens expose subsets; no cross-system subject export or operator runbook is evidenced | Define identity verification, scope, format, provider/backups treatment, and audit trail | [TBD owner=privacy owner; due=before data-subject request runbook approval] | **Observed / Proposal** |
| Correction | Merchants can edit some customer/order/profile fields; no unified correction propagation is evidenced | Define authoritative fields, restricted commerce records, downstream recipients, and evidence | [TBD owner=data owner and privacy owner; due=before data-subject request runbook approval] | **Observed / Proposal** |
| Deletion / erasure | Some entity delete actions exist; no subject-level deletion/anonymization orchestration is evidenced | Define eligibility, financial/legal holds, tenant boundary, backups, logs, providers, and completion evidence | [TBD owner=privacy/legal, finance, and data owner; due=before deletion workflow approval] | **Observed / Proposal** |
| Objection, restriction, or withdrawal | Per-channel marketing enablement exists; no canonical subject preference/withdrawal ledger is evidenced | Legal owner determines applicability; product owner defines durable preference and downstream enforcement | [TBD owner=privacy/legal and marketing owner; due=before marketing production approval] | **Unknown / Proposal** |
| Complaint / contact | Support tickets exist; no designated privacy intake/escalation path is evidenced | Designate monitored intake, authorization, triage, deadline tracking, and closure evidence | [TBD owner=privacy owner; due=before public-launch privacy approval] | **Observed / Proposal** |

## 6. Incident and security-control mapping

**Decision:** [`SECURITY.md`](SECURITY.md) owns technical security controls and [`SLA-DRP.md`](SLA-DRP.md) owns recovery objectives/procedures; this table maps privacy concerns without claiming sufficiency.

| Privacy concern | Current technical evidence | Gap / gate | Claim |
|---|---|---|---|
| Tenant isolation and least privilege | RLS schema/migrations, `withTenant` patterns, RBAC, capability checks; see `packages/db/src`, `apps/admin/lib/rbac-policy.ts`, and [`SECURITY.md`](SECURITY.md) | Platform-table grants and access-review gaps remain tracked; privacy impact assessment not evidenced. Owner: security owner; due before security sign-off. | **Observed / Unknown** |
| Authentication and session protection | Password/session helpers, Google OAuth option, secure-cookie helper, login guards | Recovery, operator access review, and durable failed-login monitoring remain incomplete. Owner: identity/security owner; due before security sign-off. | **Observed / Unknown** |
| Data minimization and credential protection | Public-body/item caps; merchant CAPI tokens encrypted at rest; tracking queue excludes raw identity columns; health endpoint reports variable names/presence only | Inventory-level minimization review and key lifecycle approval are not evidenced. [TBD owner=security and privacy owner; due=before privacy/security sign-off] | **Observed / Unknown** |
| Transport and edge controls | Cloudflare/Traefik topology and HTTPS hosts are documented | Current configuration and both zones must be reverified; this record makes no transport-compliance claim. Owner: security owner; due at each production-readiness review. | **Observed / Decision** |
| Availability, backups, and recovery | Container health checks, watchdog, external probe, backup sidecar, [`SLA-DRP.md`](SLA-DRP.md) | Alert delivery, off-box backup, restore evidence, and privacy deletion propagation are unresolved. [TBD owner=service owner; due=before DR sign-off] | **Observed / Unknown** |
| Security/privacy incident detection | Logs, audit/activity rows, cron liveness, external probe, and failed-login witness exist in bounded forms | No evidenced privacy incident classification, recipient, notification decision tree, or exercise. [TBD owner=security incident commander and privacy/legal owner; due=before incident-response approval] | **Observed / Unknown** |
| Incident response record | Historical audit/worklog documents exist and must remain historical | Define a current runbook with containment, evidence preservation, affected-data/subject assessment, provider coordination, qualified legal decision, communications approval, and post-incident review. [TBD owner=security incident commander; due=before incident-response approval] | **Proposal** |

## 7. Mandatory legal/privacy review gates

| Gate | Required decision record | Owner | Claim |
|---|---|---|---|
| Public-launch privacy approval | Legal applicability/roles, purposes/bases, notices, subject categories, children/sensitive-data position, intake contact | [TBD owner=qualified Indonesian privacy/legal counsel; due=before public launch] | **Unknown** |
| Cross-border/processor approval | Vultr Singapore mechanism, Cloudflare and provider roles/terms, locations, safeguards, subprocessors/onward transfers, remote access | [TBD owner=privacy/legal owner; due=before transfer review] | **Unknown** |
| Retention/deletion approval | Approved periods or event rules per category, holds, deletion/anonymization, provider propagation, backups/logs, closure evidence | [TBD owner=privacy/legal owner with data/finance/service owners; due=before deletion workflow launch] | **Unknown** |
| Rights-runbook approval | Request intake, identity verification, scope/exceptions, deadlines, export/correction/deletion/restriction execution, audit evidence | [TBD owner=privacy owner; due=before accepting data-subject requests through a published channel] | **Unknown** |
| Incident-response approval | Severity/privacy assessment, decision authority, evidence, containment, notification analysis, communications, exercises | [TBD owner=security incident commander and privacy/legal owner; due=before incident-response approval] | **Unknown** |
| New-purpose/provider review | Inventory, necessity/minimization, user-facing disclosure, contract/transfer, retention, security, disable/rollback path | Feature owner plus privacy/security owners; due before release of the new purpose/provider | **Decision** |

## 8. Safe engineering evidence

**Decision:** Evidence collection must use non-production fixtures or aggregate/schema-only queries and must never print customer rows, tokens, session values, provider credentials, or secret environment values.

```bash
# Migration consistency check; reads configured local database metadata without printing credentials or rows.
npm run verify-migrations -w @tokophi/db

# Names/presence only; this endpoint requires an authorized operator-supplied secret.
# Do not paste the secret into documentation, shell history, logs, or chat.
curl --fail-with-body -H "x-cron-secret: $CRON_SECRET" "$ADMIN_URL/api/health/env"

# Inspect transfer/runtime declarations without resolving secret values.
docker compose -f docker-compose.coolify.yml config --services
```

**Unknown:** The evidence set required for qualified legal sign-off is not defined. [TBD owner=privacy/legal owner; due=before legal/privacy review sign-off]
