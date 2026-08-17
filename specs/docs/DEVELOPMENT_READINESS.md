# TokoΦ — Development Readiness

> **Scope — Decision:** This document is the canonical readiness and specification-ownership record for the TokoΦ platform documentation pack. It does not own product behavior, runtime architecture, database shape, API operations, privacy policy, telemetry design, or task priority.
>
> **Status — Decision:** Planning-ready is a controlled gate, not a claim that these documents are “perfect,” complete, or runtime proof. Code and runtime evidence remain authoritative for implemented behavior.
>
> **Owner — Decision:** Platform engineering owns this record. Unresolved cross-domain gates use the accountable role shown below.

## 1. Resolved context

| Item | Claim | Resolution | Evidence / review gate |
|---|---|---|---|
| Depth profile | **Decision** | `platform` | Four public/operator surfaces, shared multi-tenant data, money movement, public HTTP endpoints, scheduled jobs, and production infrastructure are evidenced by [`../PRD.md`](../PRD.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), and `docker-compose.coolify.yml`. Owner: platform engineering. |
| Product surfaces | **Observed** | Admin, super-admin, storefront, and landing | `apps/admin`, `apps/super-admin`, `apps/storefront`, `apps/landing`. |
| Activated overlays | **Decision** | `multi-tenant`, `identity`, `public-api`, `custom-domain`, `localized-ui`, `commerce`, `personal-data`, `cross-border`, `high-availability`, `data-analytics` | Evidence: `packages/db/src/schema.ts`, `apps/admin/app/api/public`, `specs/docs/CUSTOM_DOMAIN.md`, `specs/docs/SLA-DRP.md`, and [`PRIVACY-COMPLIANCE.md`](PRIVACY-COMPLIANCE.md). Owner: platform engineering. |
| Inactive overlays | **Decision** | `regulated-sector`, `ai-system`, `mobile-desktop`, `extension-plugin` | No canonical evidence activates these overlays. Re-evaluate before adding regulated-sector processing, an AI decision system, native clients, or an extension/plugin contract. [TBD owner=product lead; due=before approving any triggering initiative] |

## 2. Truth hierarchy

**Decision:** Resolve contradictions in this order; lower levels must be corrected rather than maintained as competing facts.

1. Executed production/runtime evidence and current infrastructure state.
2. Current code, migrations, and `packages/db/src/schema.ts` on the reviewed branch.
3. Machine-readable contracts: observed public behavior in [`../openapi/storefront-api.yaml`](../openapi/storefront-api.yaml) and [`../openapi/admin-api.yaml`](../openapi/admin-api.yaml), explicitly proposed tenant/headless behavior in [`../openapi/headless.yaml`](../openapi/headless.yaml), and explicitly proposed central-account behavior in [`../openapi/account.yaml`](../openapi/account.yaml).
4. Canonical domain documents in the ownership matrix below.
5. Generated snapshots such as [`SCHEMA.md`](SCHEMA.md), when their generation date and source are current.
6. Status, queue, and handoff documents.
7. Historical/modeling aids, audit history, worklogs, screenshots, and root landing-feature documents.

**Observed:** [`DATA_MODEL.md`](DATA_MODEL.md) is a historical/modeling aid; `packages/db/src/schema.ts` plus [`SCHEMA.md`](SCHEMA.md) are the current database truth. **Observed:** repository-root `PRD.md` and `TASKS.md` describe the landing feature; they are not platform canon. **Decision:** [`../PRD.md`](../PRD.md) remains the platform PRD, and [`tasks/OPEN.md`](tasks/OPEN.md) remains the active work queue.

## 3. Canonical ownership matrix

| Fact domain | Canonical owner | Supporting evidence; non-owner boundary | Accountable owner |
|---|---|---|---|
| Observable platform behavior and NFRs | [`../PRD.md`](../PRD.md) | [`REQUIREMENTS.md`](REQUIREMENTS.md) provides verifiable statements but must not redefine product scope. | Product lead |
| Business outcomes and unresolved commercial choices | [`PROD_PLAN.md`](PROD_PLAN.md) and accepted ADRs | Product requirements link decisions; they do not invent commercial policy. | Product lead |
| System, container, trust, and deployment boundaries | [`ARCHITECTURE.md`](ARCHITECTURE.md) | [`SYSTEM_MAP.md`](SYSTEM_MAP.md), [`UML.md`](UML.md), and `docker-compose.coolify.yml` support the current shape. | Platform architect |
| Database schema, constraints, and migrations | `packages/db/src/schema.ts` and [`SCHEMA.md`](SCHEMA.md) | [`DATA_MODEL.md`](DATA_MODEL.md) is historical/modeling guidance only. | Data/platform engineering |
| Identity and authorization | [`SECURITY.md`](SECURITY.md) | `apps/admin/lib/auth.ts`, `apps/admin/lib/rbac-policy.ts`, RLS migrations, and super-admin equivalents are implementation evidence. | Security owner |
| Public HTTP operations and compatibility | [`../openapi/storefront-api.yaml`](../openapi/storefront-api.yaml) and [`../openapi/admin-api.yaml`](../openapi/admin-api.yaml); proposed tenant/headless surface: [`../openapi/headless.yaml`](../openapi/headless.yaml); proposed central account surface: [`../openapi/account.yaml`](../openapi/account.yaml) | Route handlers remain implementation authority; both proposed files are explicitly not deployed. | API owner |
| Headless storefront behavior | [`HEADLESS_STOREFRONT_SPEC.md`](HEADLESS_STOREFRONT_SPEC.md) | Proposed requirements remain unimplemented until their named rollout evidence exists. | Storefront product owner |
| Global buyer-account product and UX behavior | [`TOKOPHI_ACCOUNT_SPEC.md`](TOKOPHI_ACCOUNT_SPEC.md) and [ADR 0016](../decisions/0016-global-buyer-account.md) | `SECURITY.md` owns controls, privacy owns legal/applicability gates, schema owns implemented storage, and [`../openapi/account.yaml`](../openapi/account.yaml) owns proposed HTTP operations. | Buyer product owner |
| Privacy applicability, inventory, rights, retention, and transfers | [`PRIVACY-COMPLIANCE.md`](PRIVACY-COMPLIANCE.md) | Security owns technical controls; data schema owns storage shape. | Privacy owner |
| Threats, security controls, encryption, and secrets | [`SECURITY.md`](SECURITY.md) | Privacy maps controls but does not claim their sufficiency. | Security owner |
| SLI/SLO/SLA and recovery | [`SLA-DRP.md`](SLA-DRP.md) | Observability owns signals and alert delivery, not contractual promises. | Service owner |
| Telemetry, alerts, rate limits, and operational signal boundaries | [`OBSERVABILITY.md`](OBSERVABILITY.md) | [`DEPLOY.md`](DEPLOY.md) owns procedures; scripts are executable evidence. | Service owner |
| Release, deploy, rollback, and migration procedure | [`DEPLOY.md`](DEPLOY.md) | [`ENVIRONMENT-PARITY.md`](ENVIRONMENT-PARITY.md) owns parity checks. | Release owner |
| Active implementation queue | Repository-root [`TASKS.md`](../../TASKS.md) | [`tasks/OPEN.md`](tasks/OPEN.md) is the short handoff; `NEXT.md`, audit directories, and worklogs preserve history. | Engineering lead |

## 4. Included and omitted artifacts

### Included

| Artifact | Claim | Reason / state |
|---|---|---|
| PRD, requirements, architecture, system map, flows, UML | **Observed** | Activated by the platform profile and multiple runtime/trust boundaries; paths are listed above. |
| Schema/data model | **Observed** | Persistent multi-tenant commerce and identity data exist; canonical split is explicit in §3. |
| Security, custom domain, SLA/DRP, deploy/parity | **Observed** | Identity, custom domains, production operation, recovery, and release concerns are evidenced. |
| Privacy/compliance and observability | **Decision** | Activated by personal-data, cross-border, and production-service overlays; canonical records are this suite’s new documents. |
| Storefront, admin, headless, and account OpenAPI | **Observed / Proposal** | `storefront-api.yaml` and `admin-api.yaml` record implemented public boundaries; `headless.yaml` defines proposed tenant `/api/v1`; `account.yaml` defines the separate proposed central identity/order-hub surface. All four are OpenAPI 3.1 contracts. Redocly reports one deliberate warning for the browser `/authorize` operation's correct `302` response. |
| Headless storefront specification | **Proposal** | Defines the additional renderer contract, accepted invariants, explicit v1 non-goals, phased rollout, and owner-gated Unknowns. |
| TokoΦ Account specification and ADR | **Accepted direction / Proposal** | Defines one global buyer subject with isolated per-store customer/order projections, guest-first behavior, central authorization handoff, UX contracts, non-goals, and named implementation gates. |

### Omitted as standalone canonical artifacts

| Artifact | Claim | Reason and review gate |
|---|---|---|
| BRD | **Decision** | Existing product/production planning and accepted ADRs currently carry business decisions; creating a second summary would duplicate facts. [TBD owner=product lead; due=before an external commercial or regulatory commitment requires a dedicated BRD] |
| Standalone billing specification | **Decision** | Money behavior is currently owned by the platform PRD, schema, requirements, and payment ADRs. [TBD owner=finance/product owner; due=before changing plans, custody, settlement, tax, refund, or payout policy] |
| Standalone IAM specification | **Decision** | Current identity policy is consolidated in `SECURITY.md` and code. [TBD owner=security owner; due=before adding a new identity provider, service identity, or authorization model] |
| Standalone design-system specification | **Decision** | `packages/ui`, `specs/THEME_EDITOR_SPEC.md`, and UI inventory are sufficient current owners. [TBD owner=design-system owner; due=before external component consumers or a compatibility promise] |
| Localization specification | **Decision** | The localized-UI overlay is active, but current Bahasa Indonesia/IDR behavior is owned by PRD and UI code. [TBD owner=product lead; due=before a second locale or currency] |
| AI-system specification | **Decision** | No AI decision/runtime system is evidenced. [TBD owner=product lead; due=before processing user data with an AI system] |
| Native mobile/desktop and extension/plugin specifications | **Decision** | No such product contracts are evidenced. [TBD owner=product lead; due=before approving either surface] |

## 5. Evidence-backed gaps

| Priority | Claim | Gap and evidence | Owner / closure gate |
|---|---|---|---|
| P0 | **Resolved 2026-08-16** | The pack validator scanned 128 specification files, 65 declarations, and 12 recognized task contracts with **0 findings** at both `ready` and `verified` stages after the broken link, malformed tables, unresolved requirement references, ownership gaps, and invalid task primaries were repaired or explicitly demoted as history. | Documentation owner; rerun `check-traceability.py` after contract changes. |
| P0 | **Unknown** | Alert recipient and delivery channel are undecided; `ops/tokophi-probe.sh::notify()` emits stdout but does not send Telegram or SMTP. | [TBD owner=service owner; due=before production-readiness approval] |
| P1 | **Observed** | Privacy retention, deletion execution, legal-role assignments, and the Singapore transfer mechanism are unresolved in [`PRIVACY-COMPLIANCE.md`](PRIVACY-COMPLIANCE.md). | [TBD owner=privacy owner; due=before legal/privacy review sign-off] |
| P1 | **Observed** | Scheduled jobs expose `cron_runs` and container logs, but stale/failing runs do not page an owner; backup and deploy-currency signals also require pull-based inspection. Evidence: `apps/admin/app/api/cron/record-run.ts`, `docker-compose.coolify.yml`, `ops/check-deploy-currency.sh`. | [TBD owner=service owner; due=before production-readiness approval] |
| P1 | **Observed** | Repository-root [`TASKS.md`](../../TASKS.md) records deployment, backup, security, and operational risks; [`tasks/OPEN.md`](tasks/OPEN.md) is its short handoff. Readiness documentation does not close those implementation risks. | Engineering lead; triage at each release gate. |
| P2 | **Observed** | Historical documents still contain stale snapshots and future/mock wording; explicit banners and the truth hierarchy prevent them from outranking code but do not make every paragraph current. | Documentation owner; correct when touched or when a contradiction affects planning. |
| P2 | **Proposal** | Enforce the passing deterministic link/table/reference/primary check in CI so later documentation changes cannot reintroduce the repaired baseline. | [TBD owner=documentation owner; due=before enforcing the validator in CI] |

## 6. Planning-ready gate

**Decision:** A planning package is ready only when all of the following are true:

1. Scope names the `platform` profile, activated overlays, surfaces, and explicit non-goals.
2. Every proposed behavior traces to one canonical owner; supporting documents link rather than restate competing facts.
3. P0 validator findings are fixed or carry an explicit disposition, owner, and gate.
4. API-dependent planning points to accepted machine-readable contracts; headless-dependent planning points to an accepted headless specification.
5. Privacy/security/commerce/legal Unknowns remain Unknown and have qualified owner gates; no document claims legal compliance.
6. Data changes are checked against `packages/db/src/schema.ts`, migrations, and current [`SCHEMA.md`](SCHEMA.md).
7. Operational acceptance names an observable signal, evidence command, failure boundary, runbook, and recipient; an stdout-only alert does not satisfy recipient delivery.
8. The plan checks current code/runtime evidence immediately before approval and records the reviewed revision/environment.

**Decision:** Passing this gate means the selected work is sufficiently bounded for planning. It does **not** mean the documentation is perfect, the implementation exists, production is healthy, or legal/privacy review is complete.
