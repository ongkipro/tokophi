# TokoΦ Documentation & Architecture Audit

**Audit batch:** 6 — Documentation & Architecture  
**Audit date:** 2026-08-15  
**Repository:** `/home/ongki/Projects/tokophi`  
**Output:** `specs/docs/AUDIT_DOCUMENTATION.md`  
**Mode:** read-only application audit; this report is the only file created  
**Evidence basis:** repository source, configuration, migrations, tests, specifications, and deployment material present in the audited worktree

---

## 1. Executive Summary & Domain Scope

### 1.1 Scope

This audit covers the documentation system and its agreement with the implemented TokoΦ platform across:

- the repository working agreement (`AGENTS.md`) and root `README.md`;
- product specifications in `specs/`, including the PRD and specialist feature specifications;
- architecture, system maps, data models, flows, UML/Mermaid diagrams, security, environment, availability, and deployment guides in `specs/docs/`;
- architectural decisions in `specs/decisions/`;
- active and historical task/handoff material in `specs/docs/tasks/` and archived audit evidence;
- the expected OpenAPI corpus under `specs/openapi/`;
- the implemented surfaces and packages used to verify claims: Admin, Super Admin, Storefront, Landing, `@tokophi/db`, `@tokophi/lib`, `@tokophi/ui`, `@tokophi/sections`, and `@tokophi/data`;
- CI and documentation-related regression guards.

No application code, configuration, migration, test, or runtime data was changed. No project-wide formatter, linter, build, or test command was run.

### 1.2 Overall conclusion

The repository contains unusually rich operational history and many valuable, evidence-aware documents. `AGENTS.md`, `STATUS.md`, `SECURITY.md`, `DEPLOY.md`, `SLA-DRP.md`, and the task handoffs preserve real failure modes rather than generic advice. The code also has strong automated controls for migrations, RLS, database-backed behavior, Astro checking, and TypeScript in CI.

However, the documentation corpus is not presently a reliable contract system. It is a layered historical record in which several documents claim authority while describing different platform generations. The highest-risk problems are:

1. **No OpenAPI specification exists.** `specs/openapi/` is absent, while the repository implements at least 21 non-placeholder HTTP operations across Admin, Super Admin, and Storefront, plus public XML feeds and sitemaps. Public checkout, shipping, promotion, payment callback, cron, tracking, chat, search, upload, OAuth, and label endpoints therefore have no machine-readable request/response/security contract or compatibility gate.
2. **Money and shipment behavior has drifted in the PRD.** `specs/PRD.md:90-94` says COD is completed when the merchant manually moves an order to `selesai` because there is no courier delivery signal. Current code in `apps/admin/lib/ka-tracking.ts` maps KiriminAja numeric delivery code `200` to `delivered`, then to `selesai`, and reuses the atomic order-status transition that collects COD and updates the ledger. This is a consequential contract mismatch.
3. **Advertising/tracking status is materially stale.** `specs/PRD.md:285-288` still lists Meta/Google/TikTok integration as not built, while `tracking_channels`, `tracking_event_deliveries`, `/api/track`, and `/api/cron/tracking-events` implement tenant-configured browser/server event delivery. Conversely, ADR 0012 describes a much larger tenant-owned Meta OAuth/catalog architecture that is not the implementation currently shipped. The corpus conflates an accepted architectural direction, an unimplemented plan, and the provider-neutral tracking system that actually exists.
4. **Architecture diagrams are structurally outdated.** UML and system maps publish old database/migration/RLS counts, call `@tokophi/sections` “types only” although it exports runtime constants and helpers, omit the public promo edge and production worker/backup/domain components, and describe the Admin container as Next.js standalone despite the production guide documenting a non-standalone `next start` deployment.
5. **Deployment guidance contradicts itself.** `DEPLOY.md` correctly says cron sidecars are the only schedulers and warns that a Coolify Scheduled Task would create a second caller (`:210-216`), but its older domain cutover checklist still instructs the operator to update a Coolify Scheduled Task (`:589`). The same file retains an obsolete “sslip.io / landing not built” section (`:549-551`) after documenting the live domain elsewhere.
6. **The documentation regression guard is too weak for its stated purpose.** `packages/db/src/doc-counts.test.ts` merely asserts that each selected document contains the current number somewhere. A document can retain several contradictory numbers and still pass. It covers only four documents, does not validate RLS counts, links, diagrams, OpenAPI, requirement traceability, or semantic code agreement.
7. **The ADR index is stale.** `specs/README.md` lists ADR 0014 as the active COD-shipping decision and omits ADR 0015, even though ADR 0014 marks itself superseded by ADR 0015. This can directly mislead ledger and settlement work.

### 1.3 Risk summary

| Severity | Count | Meaning |
|---|---:|---|
| **P0 — release/financial contract risk** | 3 | Missing public API contract; stale COD/shipping semantics; ambiguous active financial ADR |
| **P1 — architecture/operations regression risk** | 8 | Conflicting authorities, stale diagrams, deployment contradictions, ungoverned ADR/requirements drift |
| **P2 — maintainability/completeness risk** | 5 | Missing ownership metadata, link/diagram gates, UI state contracts, environment schema, archive boundaries |

The recommended response is not another broad rewrite. TokoΦ needs a small canonical documentation spine, generated inventories, explicit document lifecycle metadata, and CI checks that fail on the exact drift classes already observed.

---

## 2. Current Implementation Analysis & Code Evidence

### 2.1 Implemented architecture baseline

Repository evidence establishes the following current shape:

| Layer | Implemented evidence | Documentation consequence |
|---|---|---|
| **Landing** | `apps/landing`, Astro static, no `@tokophi/db` dependency | Keep it a separate availability boundary; do not depict it as part of Admin |
| **Storefront** | `apps/storefront`, Astro SSR, tenant resolution by request host, direct DB reads plus Storefront API writes | Architecture must show both DB access and HTTP calls to Admin; “read-only” is not a complete trust-boundary description |
| **Seller Admin** | `apps/admin`, Next.js RSC/server actions, public APIs, OAuth, cron endpoints, media endpoint | This is simultaneously a UI and the current commerce API/worker host; contracts must make that coupling explicit |
| **Super Admin** | `apps/super-admin`, cross-tenant control plane | Owner-connection access is an explicit trust boundary, not merely another UI |
| **Database** | `packages/db/src/schema.ts`, Drizzle journal ending at index 94 (`0094_magical_salo`), `withTenant()` in `packages/db/src/rls.ts` | Counts must be generated at review time; RLS behavior must be tied to executable catalog verification |
| **Tenant wrapper** | `apps/admin/lib/tenant.ts` obtains the session store and calls `withTenant`; comments explicitly warn that `stores` is not protected by a `store_id` policy | Diagrams and security docs must distinguish RLS-covered tables from parent/child tables requiring explicit predicates |
| **Sections** | `packages/sections/src/registry.ts` exports `HERO_INTERVAL_MS`, `heroSlides()`, `SECTION_TYPES`, labels, defaults, icon values, and template-type lists in addition to types | “Types only, zero runtime” is false and should be removed from the primary architecture documents |
| **Shipping state** | `apps/admin/lib/ka-tracking.ts` maps courier status to forward-only order transitions; delivered becomes `selesai`; the transition runs atomically via `applyOrderStatusChange` | PRD, flow, sequence, and settlement documentation must describe courier-driven completion and the remaining uncertainty around provider code `200` |
| **Tracking delivery** | `tracking_channels`, `tracking_event_deliveries`, Storefront `/api/track`, Admin `/api/cron/tracking-events` | The product status must distinguish shipped provider-neutral conversion delivery from unbuilt Meta OAuth/catalog sync |
| **Production topology** | `docker-compose.coolify.yml` includes Postgres, migration, four apps, cron sidecars, backup, and shared volumes | Deployment diagrams must show service topology, scheduling ownership, persistence, and backup boundaries rather than only four apps plus Postgres |

### 2.2 Documentation corpus and authority model

`specs/README.md` attempts to establish an authority order: active work in `docs/tasks/OPEN.md`, product intent in `PRD.md`, requirements in `REQUIREMENTS.md`, implementation status in `STATUS.md`, and code/database as final truth. It also explicitly admits that `DATA_MODEL.md`, `TASKS.md`, `GUIDE.md`, `SYSTEM_GUIDE.md`, and `CONCEPT.md` predate the backend.

That warning is honest but insufficient. The same index still recommends several stale documents in “Read these first,” calls `SYSTEM_MAP.md` an every-route map, claims every UML diagram is validated, and publishes a dated baseline. A reader cannot safely infer whether a paragraph is:

- a current normative requirement;
- an accepted but not implemented architectural decision;
- an observed implementation state at a dated revision;
- a historical incident record;
- an open proposal; or
- a superseded statement retained for context.

The corpus uses prose warnings instead of enforceable lifecycle metadata. This makes “code wins” the only dependable conflict resolver, which defeats the purpose of load-bearing specifications.

### 2.3 Detailed drift register

#### DOC-01 — No OpenAPI corpus or machine-readable API contract (**P0**)

**Evidence**

- `specs/openapi/` does not exist and no `.yaml`/`.yml`/`.json` OpenAPI document exists under `specs/`.
- Implemented Admin route operations include labels, Google OAuth start/callback, signout, billing/domain/shipping/tracking-event crons, environment health, public shipping/order/promo/payment callback, and media retrieval.
- Storefront implements search, checkout-session capture, event tracking, and chat send/read/poll operations.
- Super Admin exposes signout. Public Google/TikTok feeds, robots, and sitemaps add non-JSON HTTP contracts.

**Impact**

- Storefront and Admin can silently disagree on field names, nullability, errors, CORS, rate limits, and money units.
- Payment providers and cron callers have no canonical authentication/retry/idempotency contract.
- HTTP behavior cannot be linted, versioned, diffed, code-generated, or contract-tested.
- Documentation currently requires readers to reconstruct schemas from route implementations and comments.

**Directive**

Create an OpenAPI 3.1 root contract with domain files for `public-commerce`, `storefront`, `operations`, `auth`, and `media`. Document XML feeds either as explicit OpenAPI responses or in a linked feed contract. Every operation must define authentication, tenant resolution, request caps, IDR integer semantics, status codes, error envelopes, idempotency/retry behavior, and examples. Generate or validate focused contract tests against handlers.

#### DOC-02 — Conflicting “authoritative” documents (**P1**)

**Evidence**

- `specs/README.md` calls several documents primary while warning that multiple documents are intentionally stale.
- `ARCHITECTURE.md:3` calls itself authoritative, yet `ARCHITECTURE_RECOMMENDATIONS.md:130-157` already records incompatible architecture documents.
- `SYSTEM_GUIDE.md` calls itself “the one doc,” but describes three surfaces and migrations only through `0016`.
- `AGENTS.md` mixes coding rules, architecture, production incidents, backlog state, and historical notes across more than one thousand lines.

**Impact**

Two engineers can follow different documents faithfully and implement incompatible behavior. Historical preservation has become indistinguishable from normative guidance.

**Directive**

Declare exactly one owner per concern: product contract, architecture, API, data, IAM/security, operations, and active work. Add a standard header to every non-archive document: `Status`, `Owner`, `Last verified`, `Verified revision`, `Normative/Aspirational/Historical`, `Supersedes`, and `Review trigger`. Move incident narratives behind links from short standing rules.

#### DOC-03 — COD delivery and ledger semantics are stale in the PRD (**P0**)

**Evidence**

- `specs/PRD.md:90-94` states there is no courier delivered signal and the merchant signals delivery by moving the order to `selesai`.
- `apps/admin/lib/ka-tracking.ts:9-13` states status follows the courier; `outcomeFromTrackingCode()` maps numeric `200` to `delivered`; `OUTCOME_STATUS` maps `delivered` to `selesai`.
- `syncOrderFromKa()` calls the same atomic order transition used by manual changes, so COD collection, inventory, and ledger effects follow the courier transition.
- `apps/admin/app/api/cron/tracking/route.ts:45-48` records an unresolved provider-documentation ambiguity: code `200` may mean delivered or picked up, and mapping it incorrectly could settle money early.

**Impact**

This is not editorial drift. It changes who authoritatively moves money and which external status can settle COD proceeds. A developer following the PRD could remove or duplicate the courier-driven transition.

**Directive**

Update the product and flow contracts to name both transition sources, precedence, forward-only rules, terminal-state handling, row locking, and financial side effects. Record the provider-code ambiguity as an explicit operational risk with evidence and a verification owner; do not bury it in source comments.

#### DOC-04 — Active COD-shipping ADR is misindexed (**P0**)

**Evidence**

- ADR 0014 marks itself “superseded by ADR 0015.”
- ADR 0015 is accepted and defines net Seller proceeds and shipping reconciliation.
- `specs/README.md` lists ADR 0014 as the current decision and omits ADR 0015.

**Impact**

The index directs engineers to a superseded financial model. Settlement, ledger, payout, and reporting work may use the wrong source of truth.

**Directive**

Make the ADR registry generated or validated. Show 0014 as superseded and 0015 as active. Require bidirectional supersession links and reject an accepted index entry whose document status is superseded.

#### DOC-05 — Tracking implementation and Meta roadmap are conflated (**P1**)

**Evidence**

- `specs/PRD.md:285-288` says Meta/Google/TikTok ad integration does not exist.
- `DEPLOY.md:303-305` documents `/api/cron/tracking-events` delivering to Meta CAPI, GA4 Measurement Protocol, and TikTok Events API.
- ADR 0012 is marked accepted but contains a long unchecked implementation plan for Meta OAuth, tenant-owned assets, catalog push, dedicated `meta_*` tables, diagnostics, and webhooks. It also contains in-place corrections and “as shipped” exceptions.
- The current schema and route names use generic `tracking_channels` and `tracking_event_deliveries`, not the full dedicated architecture described by ADR 0012.

**Impact**

Product, engineering, privacy, and support cannot tell what “Meta integration” means. Browser/server event forwarding may be mistaken for OAuth/catalog ownership, or the unbuilt plan may be marketed as shipped.

**Directive**

Split this into: (1) a concise accepted decision, (2) a current capability contract for provider-neutral event forwarding, and (3) a separately statused roadmap for OAuth/catalog integration. Remove execution task checklists from the ADR and trace each remaining requirement to implementation evidence.

#### DOC-06 — UML and system maps are outdated (**P1**)

**Evidence**

- `UML.md` publishes 68-table/46-migration/RLS-on-44 labels in diagrams.
- `SYSTEM_MAP.md` contains multiple obsolete table/migration counts and a drift appendix that is itself now historical.
- UML and `specs/README.md` describe `@tokophi/sections` as “types only, zero runtime”; `packages/sections/src/registry.ts` exports runtime helpers and registries.
- The component diagram includes Storefront → Admin order/ongkir but omits promo preview.
- The deployment diagram omits migration, billing/tracking/domain/event cron sidecars, backup, watchdog/probe, Cloudflare for SaaS custom-hostname control, and production persistence details.
- The diagram calls Admin “Next.js standalone,” while `DEPLOY.md` explains that Admin and Super Admin ship full `node_modules` and run `next start`.

**Impact**

Trust boundaries, failure domains, deployable units, and runtime dependencies are misrepresented. Architecture review based on the diagrams will miss workers, secrets, stateful volumes, and critical API coupling.

**Directive**

Regenerate component, container/deployment, tenant-boundary, order/ledger, and external-integration diagrams from a single current baseline. Remove volatile counts from diagrams or inject them from generated evidence. Add diagram ownership and Mermaid validation in CI.

#### DOC-07 — Deployment guide contains mutually exclusive scheduler instructions (**P1**)

**Evidence**

- `DEPLOY.md:210-216` says the Compose sidecar is the only billing scheduler and a Coolify Scheduled Task would create a second caller.
- `DEPLOY.md:589` instructs operators to update the Coolify Scheduled Task URL.
- `DEPLOY.md:549-551` retains an obsolete pre-domain-cutover state saying production uses sslip.io and Landing is not built.

**Impact**

An operator following the wrong section can double-run billing or diagnose the wrong production topology. In an operational runbook, contradictory historical steps are a live defect.

**Directive**

Remove obsolete procedures from the executable runbook and place them in a dated incident/history appendix. Every runbook step must have one current command, expected output, failure branch, rollback, and last-exercised date.

#### DOC-08 — Cron secrets are documented and deployed in query strings (**P1 security**)

**Evidence**

- Compose cron sidecars call endpoints using `?secret=$CRON_SECRET`.
- `DEPLOY.md` repeats the query-string form.
- Route handlers also support `x-cron-secret`.
- Existing audit evidence notes that process inspection can expose the expanded query-string secret.

**Impact**

Secrets can appear in process listings, proxy/access logs, error reports, observability tools, and copied URLs. Documentation normalizes the less safe authentication path.

**Directive**

Document and use header-only cron authentication. Remove query-parameter acceptance after all callers migrate. Treat cron routes as internal API operations with rotation, replay/idempotency, and redaction requirements.

#### DOC-09 — Custom-domain specification’s “current state” is stale (**P1**)

**Evidence**

- `CUSTOM_DOMAIN.md:373-376` says no domain UI, action, capability, or component exists.
- The repository contains `apps/admin/lib/actions/domain.ts`, `lib/data/domain.ts`, `components/admin/pengaturan/domain-card.tsx`, Cloudflare SaaS helpers, domain cron handling, and `store_domains` migrations.
- Current action comments state TXT ownership verification and Cloudflare for SaaS provisioning are implemented.

**Impact**

The document is useful as design history but unsafe as a current implementation guide. Test plans and support procedures may target states that no longer exist.

**Directive**

Convert the opening inventory to an evidence-stamped implementation matrix and move original design assumptions to a history appendix. Document the actual state machine, polling owner, retries, terminal/error states, removal restrictions, support-ticket path, and primary-domain redirect behavior.

#### DOC-10 — Frozen count drift and a false-positive guard (**P1**)

**Evidence**

- PRD, README, SYSTEM_GUIDE, ARCHITECTURE, SYSTEM_MAP, UML, SCHEMA, STATUS, and AGENTS publish different historical table, migration, and RLS totals.
- `doc-counts.test.ts` checks only AGENTS, STATUS, CODE_MAP, and SCHEMA.
- Its regex passes when a document contains the current number anywhere; it does not reject stale contradictory numbers in the same file.
- RLS counts are deliberately excluded from the test.

**Impact**

The guard can stay green while the human-readable contract remains contradictory—the exact failure class its comments say it prevents.

**Directive**

Stop publishing mutable counts in conceptual documents. Generate a single `CURRENT_BASELINE.md` or JSON evidence artifact from schema/journal/catalog checks. If counts remain elsewhere, require an explicit generated marker and reject any non-historical conflicting count in the same document.

#### DOC-11 — Requirements are not fully traceable (**P1**)

**Evidence**

- `REQUIREMENTS.md` has useful IDs and a `Verify` column, but accepted declarations do not consistently carry one accountable owner, source requirement, acceptance evidence ID, constraints, and change history.
- Several verification cells are manual greps or commands rather than durable test/evidence references.
- No task-to-requirement-to-test validator runs in CI.
- Some status claims are dated observations without expiry or revision binding.

**Impact**

A requirement can be marked MET after its evidence changes or disappears. Tasks can close without proving the intended observable contract.

**Directive**

Adopt stable namespaces (`PR`, `SEC`, `TEN`, `API`, `DATA`, `SLO`, `OPS`, `UX`, `TEST`, `EVID`). Every accepted requirement must name status, owner, source, statement, acceptance, constraints, evidence, and revision. CI should validate references and orphaned accepted requirements.

#### DOC-12 — ADR lifecycle hygiene is incomplete (**P2**)

**Evidence**

- ADRs use inconsistent headers and status formats.
- ADR 0012 contains architecture, product requirements, implementation file trees, test strategy, and a multi-phase task plan in one document.
- Number 0010 is intentionally absent; this is explained only inside ADR 0012 rather than in the ADR index.
- Supersession is not reliably reflected by the index.

**Impact**

Decisions are hard to scan, acceptance is confused with implementation completion, and automated lifecycle validation is impractical.

**Directive**

Standardize ADR headers and keep ADRs decision-focused: context, decision, alternatives, consequences, status, supersedes/superseded-by, owner, and date. Put product requirements and tasks in their own traced documents. Reserve numbers explicitly in the index.

#### DOC-13 — Environment contract is fragmented (**P2**)

**Evidence**

- Environment variables are distributed across root `.env.example`, `.env.coolify.example`, Storefront `.env.example`, Compose, application code, deployment prose, and a protected `/api/health/env` route.
- No typed or generated environment manifest defines required/optional status per service and environment.
- Documentation includes historical defaults and provider setup details that can drift independently.

**Impact**

A fresh deployment can satisfy one guide while missing a runtime variable used by another service. Secret/non-secret classification and rotation ownership are not centrally auditable.

**Directive**

Create a generated environment matrix with variable, consumer, required environments, secret classification, safe default, validation owner, and rotation/redeploy behavior. Make each service validate its own required variables at startup or health-check time without returning secret values.

#### DOC-14 — UI route/state contracts are incomplete (**P2**)

**Evidence**

- `UI_INVENTORY.md`, wireframes, system maps, and feature specs document many screens but are not tied to a generated route inventory.
- Current operational features such as custom-domain provisioning and tracking diagnostics evolved after several UI documents.
- UI documentation does not consistently enumerate loading, empty, permission-denied, suspended, provider-degraded, retrying, mobile, keyboard, and destructive-confirmation states.

**Impact**

A page can be “documented” and visually present while critical operational states remain unspecified or regress.

**Directive**

For every operator and shopper journey, maintain a route contract with roles/capabilities, data dependencies, state matrix, responsive behavior, accessibility acceptance, mutations, optimistic behavior, error recovery, audit events, and analytics events.

#### DOC-15 — Archive and active-work boundaries are porous (**P2**)

**Evidence**

- `docs/tasks/OPEN.md`, `NEXT.md`, `BACKLOG.md`, dated task files, `WORKLOG.md`, `STATUS.md`, and archived audits all contain status-like statements.
- The index says OPEN wins, but other files continue to use current-tense directives and unchecked boxes.

**Impact**

Search results surface superseded tasks without context; agents may resurrect completed or reversed work.

**Directive**

Use one active task register. Give every dated task a terminal header (`Completed`, `Superseded`, `Abandoned`, or `Historical evidence`) and link its replacement. Exclude archives from default documentation search/indexing where tooling permits.

#### DOC-16 — Performance and capacity claims lack one measurable contract (**P2**)

**Evidence**

- `PROD_PLAN.md` contains target-scale discussion and future Cloudflare KV/R2/Queue recommendations.
- `CLOUDFLARE-PERF.md`, deployment notes, rate-limit helpers, request caps, and caching TTLs contain separate performance facts.
- No single SLO/budget document maps shopper flows to latency, payload, cache, external-provider timeout, database query, and concurrency budgets.

**Impact**

Performance changes are judged by local fixes rather than a measurable end-to-end budget. Aspirational infrastructure can be mistaken for deployed capacity.

**Directive**

Define budgets per critical flow: storefront HTML, product image, search, shipping quote, promo preview, order creation, chat poll, tracking ingest, cron drain, and admin list. Mark each metric observed/proposed and name its measurement method.

---

## 3. Edge Case, Regression & Vulnerability Assessment

### 3.1 Documentation-driven failure scenarios

| Scenario | Failure mechanism | Consequence | Required control |
|---|---|---|---|
| Engineer follows PRD COD text | Implements manual-only delivery completion and overlooks courier transition | COD cash is never collected, or is collected twice through competing paths | One order-state contract traced to `applyOrderStatusChange` and courier tests |
| Engineer follows ADR index | Uses superseded ADR 0014 financial model | Wrong Seller proceeds, shipping reconciliation, ledger reports, or payout amount | Validated ADR registry and supersession graph |
| Storefront changes request field | No OpenAPI/contract test detects divergence from Admin | Checkout failure, wrong variant, shipping mismatch, or ambiguous user error | OpenAPI plus consumer/provider contract tests |
| Provider retries callback | Callback auth/idempotency behavior exists only in code comments | Duplicate effects or accidental retry suppression | Webhook operation contract with idempotency key and replay matrix |
| Operator follows old DEPLOY section | Adds Coolify Scheduled Task while sidecar is active | Duplicate billing/tracking execution and race exposure | Single current scheduler runbook; destructive duplicate-scheduler check |
| Cron URL appears in process/logs | Secret is carried in query string | Credential disclosure enabling platform-wide cron invocation | Header-only auth and secret rotation runbook |
| New section type lands | Diagram and docs still say types-only and omit runtime defaults/helper behavior | Storefront/editor compatibility or saved-data migration is misunderstood | Versioned section schema and exhaustive compatibility tests |
| New migration lands | Frozen counts remain in multiple docs | False architecture conclusions and noisy audit churn | Generated baseline, no conceptual counts |
| Domain state changes | Stale spec says feature absent | Missing support, retry, or certificate-state handling | Actual domain state-machine contract and UI state matrix |
| Tracking feature marketed | ADR 0012 accepted status is read as shipped capability | Merchant expects OAuth/catalog ownership that does not exist | Capability matrix separating shipped, partial, planned, and externally blocked |

### 3.2 Security and privacy documentation gaps

1. **Authentication schemes are undocumented as contracts.** Session cookies, platform cookies, signed impersonation JWTs, callback secrets, cron secrets, OAuth state, and anonymous host-based tenancy appear in separate source/docs locations. There is no canonical trust-boundary matrix.
2. **Query-string secrets are an avoidable exposure.** The documentation should not preserve this as a normal invocation form.
3. **Anonymous owner-connection routes require explicit tenant-resolution contracts.** Public order/ongkir/promo and Storefront APIs rely on host or slug resolution outside an authenticated merchant session. Each route must document fail-closed behavior and forbidden fallbacks.
4. **Tracking privacy semantics are fragmented.** ADR 0012 discusses minimization; schema/source comments describe retained client match keys and a 30-day purge. The system needs one data inventory covering purpose, consent, fields, recipients, retention, purge proof, and disconnect/deletion behavior.
5. **No credential was found in the audited Markdown by the targeted assignment-pattern scan.** This is positive evidence, not proof of a complete secret scan. CI should still scan docs, examples, screenshots metadata, and history with an established secret scanner.
6. **Infrastructure identifiers are widely documented.** Production IPs, topology, service names, and operational commands are appropriate only if repository access is strictly controlled. The docs should label their sensitivity and avoid copying identifiers into public-facing artifacts.

### 3.3 Data and schema edge cases

- RLS statements must distinguish: tables with `store_id`, parent `stores`, store-scoped children without `store_id`, deliberate platform exceptions, owner-connection jobs, and Super Admin cross-tenant access.
- A schema count is not a data contract. Nullability, constraints, cascades, uniqueness, state enums, retention, and transaction boundaries are the contract and should be generated or referenced directly.
- The section/template JSON contract has no visible schema version in the documentation. Backward compatibility for saved `page_templates.sections` needs explicit rules when defaults, section types, or config fields change.
- Feed identifiers are governed by ADR 0013 and shared tracking IDs; OpenAPI/feed documentation must pin stable IDs, variant rules, and migration behavior to prevent catalog re-keying.
- Order/payment/ledger documentation must define atomicity and repair behavior for gateway creation after transaction commit, callback replay, return reversal, shipping reconciliation, and payout snapshots.

### 3.4 Operational edge cases

- The backup runbook correctly admits that off-host backup and restore exercises are incomplete. These must remain marked as unproven until a dated drill artifact exists.
- A successful health check is not deploy currency. The runbook should require a revision/migration/response fingerprint for all four apps and critical workers.
- Cron sidecars are workers and need contracts for schedule, run-on-start, overlap, batch limit, fairness, timeout, lease/claim semantics, error accounting, liveness, and ownership.
- External probes and watchdogs need a named alert recipient and tested notification path; a script present in `ops/` is not evidence that monitoring is installed or observed.
- Historical commands that reference retired hosts or schedulers must never remain inside the current execution path.

---

## 4. Test Suite Coverage & Regression Matrix

### 4.1 Existing strengths

The CI workflow provides meaningful application safeguards:

- full-history migration-journal verification;
- database-backed Vitest execution with `TEST_DB_REQUIRED=1`;
- migration of an isolated test database;
- seeded SQL-level RLS verification and application-level `withTenant()` verification;
- Astro checks for Storefront and Landing;
- TypeScript checks for Admin and Super Admin.

Focused tests also protect important component contracts such as COD policy, input validation, shipping dimensions, tenant wrappers, tracking identifiers, session revocation, schema migration integrity, ledger behavior, template registry behavior, Storefront host resolution, checkout fields, cart variants, and accessibility source invariants.

These strengths reduce implementation regression. They do not make the documentation contract complete.

### 4.2 Coverage matrix

| Contract area | Existing executable evidence | Coverage quality | Missing regression control |
|---|---|---|---|
| Migration journal | `verify-migrations` in CI with full Git history | **Strong** for journal integrity | Generated documentation baseline and journal-to-doc binding |
| RLS catalog and app path | `verify-rls`, `verify-rls-app`, DB-backed CI | **Strong** for tested database | Requirement IDs linked to tests; generated RLS inventory; child-table review list surfaced in docs |
| Ledger/order invariants | DB-backed unit/integration tests | **Strong but distributed** | One normative state/financial contract and route-level scenarios |
| Public order validation | Helper/unit tests (`validate`, `cod-policy`, `public-guard`, dimensions) | **Partial** | Handler-level request/response/status/idempotency contract tests |
| Shipping quote and tracking | Focused helper/state tests | **Partial to strong internally** | Provider contract fixtures, code-200 verification evidence, OpenAPI operation schemas |
| Payment callback | Source-level idempotency/security logic | **Partial** | HTTP callback contract tests: missing/wrong secret, replay, unknown reference, each terminal status, malformed/capped body |
| Promo API | Shared discount logic and source implementation | **Partial** | Preview/order parity contract at HTTP boundary; OpenAPI examples/error responses |
| Storefront APIs | Focused tests for host/cart/checkout source behavior | **Partial** | Contract tests for search/chat/track/checkout-session operations and cross-origin behavior |
| Cron workers | Route logic and cron-run recording | **Partial** | Schedule/overlap/run-on-start/timeout/batch/retry contract tests and Compose-to-route conformance |
| OAuth/auth routes | Session and revocation tests | **Partial** | Redirect/cookie/state/error OpenAPI or dedicated auth-flow contract |
| Environment parity | `/api/health/env`, `.env` examples, parity guide | **Partial/manual** | Generated env manifest and per-service startup validation |
| Documentation counts | `packages/db/src/doc-counts.test.ts` | **Weak** | Reject conflicting counts; cover all current docs; generate rather than grep |
| Requirements traceability | Manual IDs/Verify column | **Weak** | Reference graph validator, orphan/evidence/owner checks |
| ADR lifecycle | Manual index | **None automated** | Status/supersession/index validator |
| OpenAPI | No spec or validator | **None** | OpenAPI 3.1 lint, bundle, breaking-change diff, handler contract tests |
| Markdown links | No repository gate found | **None** | Internal link/anchor/image validation |
| Mermaid diagrams | Historical claim of `mermaid-cli` rendering; no dependency/CI gate found | **None current** | Render every Mermaid fence in CI |
| UI route/state inventory | Wireframes and manual inventories | **Partial/manual** | Generated route inventory and role/state acceptance matrix |
| Deployment runbook | Detailed prose and dated observations | **Manual** | Scripted smoke probes, restore drill artifact, duplicate-scheduler check, currency proof |
| Secret hygiene in docs | No credential-like assignment found by this audit’s targeted scan | **Manual/limited** | CI secret scanner for tracked files and history |

### 4.3 Required documentation regression suite

The minimum useful suite should fail on observable documentation defects, not formatting preferences:

1. **`docs:links`** — resolve every relative Markdown link, anchor, referenced image, ADR, task replacement, and OpenAPI `$ref`.
2. **`docs:mermaid`** — render every Mermaid block using the pinned CLI version.
3. **`docs:baseline`** — generate/check schema table/enums, migration head/count, route inventory, packages, and RLS summary from source/catalog evidence.
4. **`docs:trace`** — validate unique permanent IDs, one owner per accepted requirement, source/evidence references, no orphan accepted requirement, and valid task primary requirement.
5. **`docs:adr`** — validate headers, index inclusion, reserved gaps, and bidirectional supersession.
6. **`openapi:lint`** — lint and bundle OpenAPI 3.1 with no unresolved refs or duplicate operation IDs.
7. **`openapi:breaking`** — compare the proposed bundle with the main-branch bundle; require an explicit compatibility decision for removed/changed public contracts.
8. **Contract smoke tests** — exercise public commerce, callback, cron auth, Storefront search/chat/track/session, and media behavior against documented examples.
9. **`docs:secrets`** — scan documentation, examples, generated reports, and relevant history for credentials.
10. **Archive hygiene** — fail if an archived/superseded task is linked as the current entrypoint or lacks a terminal lifecycle marker.

---

## 5. Actionable Engineering Perfection Directives

### 5.1 Canonical documentation architecture

Adopt this smallest authoritative pack:

| Canonical artifact | Owns | Must not own |
|---|---|---|
| `specs/PRODUCT.md` or refreshed `PRD.md` | Product goals, actors, money/COD policies, capability matrix, non-goals | Database counts, implementation file trees, task checklists |
| `specs/docs/ARCHITECTURE.md` | Current containers/components, trust boundaries, data flows, external systems, scaling decisions | Historical status diary |
| `specs/openapi/openapi.yaml` + domain files | HTTP requests/responses/auth/errors/idempotency | UI copy or internal implementation detail |
| `specs/docs/DATA.md` | Entity invariants, ownership, retention, state machines, migrations compatibility | Frozen row counts |
| `specs/docs/IAM_SECURITY.md` | Identities, sessions, RBAC, RLS, secrets, threat boundaries, provider trust | General incident chronology |
| `specs/docs/OPERATIONS.md` + runbooks | Deployment, rollback, backup/restore, cron, monitoring, on-call evidence | Superseded host/scheduler instructions |
| `specs/docs/REQUIREMENTS.md` | Stable testable requirements and traceability | Unowned prose wishes |
| `specs/docs/tasks/OPEN.md` | Only current work queue and external blockers | Completed session history |
| `specs/archive/` | Immutable historical evidence | Normative current instructions |

Existing documents can be consolidated into this spine without deleting valuable history. Add short tombstone headers to superseded files rather than leaving active-looking prose.

### 5.2 Frontend and UI/UX directives

1. Generate route inventories for Admin, Super Admin, Storefront, and Landing and reconcile them with `UI_INVENTORY.md`.
2. Define a state matrix per screen: initial/loading/empty/success/validation error/permission denied/suspended/provider unavailable/retry in progress/terminal failure.
3. Document responsive breakpoints and mobile-specific commerce/operator behavior, not only screenshots.
4. Add keyboard order, focus return, dialog escape, form labeling, live-region, reduced-motion, contrast, and single-`h1` acceptance requirements.
5. For checkout, pin client-to-API field mapping, display/repriced totals, promo preview parity, shipping re-quote behavior, retry messaging, double-submit prevention, and recovery after ambiguous network failure.
6. For domains and integrations, document polling cadence, stale state, reconnect/remove constraints, support escalation, and privacy copy.
7. For Store Builder, version the stored section document; define unknown section/field behavior, default migration, editor/storefront compatibility, and rollback.

### 5.3 Backend and API directives

1. Author OpenAPI 3.1 from current handlers, not from aspirational endpoints.
2. Use shared component schemas for IDR amounts, UUIDs, order numbers, pagination, problem details, CORS, and rate-limit responses.
3. Define tenant resolution explicitly for every anonymous endpoint: Host, store slug, signed token, or provider reference; never imply that RLS protects owner-connection routes.
4. Define mutation idempotency and retry semantics for order creation, payment callbacks, checkout sessions, chat send, tracking ingest, and cron drains.
5. Document maximum body size, item counts, string lengths, timeouts, and external-provider failure mapping.
6. Treat cron routes as internal APIs with header authentication, overlap policy, batch/fairness, leases, run accounting, and health evidence.
7. Document which server actions are intentionally not HTTP APIs; avoid inventing REST endpoints for in-process RSC actions.
8. Version public breaking changes or coordinate atomic consumer/provider deployment with an explicit compatibility record.

### 5.4 Database and data directives

1. Generate the schema catalog and migration baseline; do not hand-maintain counts in conceptual docs.
2. Publish ownership for every table: tenant, platform, public derived, operational queue, or audit.
3. Document RLS coverage and every reviewed exception, including child tables without `store_id` and the `stores` parent-table rule.
4. Tie order, payment, shipment, ledger, invoice, payout, refund/return, and reconciliation state transitions to transaction boundaries and database constraints.
5. Define deletion/cascade/retention behavior for customer data, chat, checkout sessions, tracking delivery payloads, media, integration tokens, domains, and audit records.
6. Version JSON/JSONB contracts such as page-template sections and event/client payloads.
7. Include forward/backward migration compatibility and rollback limits in every data-changing requirement.

### 5.5 Security and privacy directives

1. Produce one trust-boundary matrix covering shopper, Seller user, platform operator, cron caller, AutoLaris, KiriminAja, Google OAuth, Cloudflare, Meta, Google Ads, and TikTok.
2. Migrate cron callers to `x-cron-secret`; remove query-string secrets and document rotation.
3. Define callback verification, replay handling, timing-safe comparison, source distrust, and re-fetch rules per provider.
4. Bind every capability-sensitive UI/action/API to its RBAC requirement and denial behavior.
5. Maintain a privacy inventory for tracking identifiers and provider delivery: purpose, lawful/consent basis as applicable, exact fields, hashing, recipient, retention, purge trigger, and deletion/disconnect semantics.
6. Scan docs/examples/history for credentials in CI; keep screenshots and copied production output out of normative docs unless redacted.
7. Label operations documents as repository-confidential if they retain production addresses and service topology.

### 5.6 Performance and reliability directives

1. Establish measurable budgets for storefront HTML, image delivery, API latency, DB query count, provider timeout, body size, and cron throughput.
2. Separate observed capacity from proposed Cloudflare KV/R2/Queue architecture.
3. Document cache keys, tenant dimensions, TTL, invalidation trigger, and safe-stale behavior for storefront catalog, shipping quotes, domains, and provider status.
4. Define rate-limit scope and distributed-runtime limitations; in-process limits must not be described as globally authoritative.
5. Include dependency-failure behavior: Postgres unavailable, KiriminAja timeout, AutoLaris failure, tracking provider throttling, Cloudflare API degradation, and disk pressure.
6. Require deploy currency proof and worker liveness evidence in addition to HTTP health.
7. Record backup RPO/RTO as achieved only after off-host copy and restore drills produce dated evidence.

### 5.7 Documentation ownership and change workflow

For every change that affects an observable contract:

1. identify affected requirement IDs before implementation;
2. update the canonical contract and OpenAPI/diagram in the same change;
3. add or update executable evidence;
4. run focused documentation and contract gates;
5. record breaking/compatible status;
6. update the capability matrix and active task only after evidence passes;
7. archive replaced prose with an explicit supersession link.

A code comment may explain a local hazard, but a money-, security-, privacy-, tenant-, or operations-critical rule must also have an owned canonical contract. Conversely, a document may not claim an implementation is complete solely because a design or task list exists.

---

## 6. Prioritized Remediation Plan and Acceptance Criteria

### Phase A — Contract safety (**P0**)

1. Correct PRD courier-driven COD completion and reconcile it with FLOWS/UML/STATUS.
2. Correct the ADR index: show 0014 superseded and 0015 active.
3. Create the OpenAPI 3.1 skeleton and fully specify public order, ongkir, promo, payment callback, tracking, checkout-session, and cron authentication first.
4. Remove the contradictory Scheduled Task instruction from the active deploy path.

**Accepted when:** a new engineer can identify the active COD/settlement decision from one index; all money-moving HTTP operations have valid bundled schemas and error/idempotency rules; no active runbook instructs a second scheduler.

### Phase B — Architecture truth (**P1**)

1. Replace stale component and deployment diagrams.
2. Correct section-package, tracking, domain, container, and worker descriptions.
3. Split ADR 0012 decision/current capability/roadmap.
4. Establish the canonical document ownership table and lifecycle headers.
5. Replace query-string cron authentication documentation and callers.

**Accepted when:** Mermaid renders in CI; diagrams show all current deployable units and trust boundaries; no primary doc calls `@tokophi/sections` types-only; tracking capability cannot be confused with Meta OAuth/catalog; cron secrets do not appear in URLs or process arguments.

### Phase C — Durable regression controls (**P1/P2**)

1. Add link, traceability, ADR, baseline, OpenAPI, Mermaid, and secret checks.
2. Replace source-text count occurrence tests with generated evidence and conflict detection.
3. Generate route and environment inventories.
4. Add handler-level contract tests for critical APIs.
5. Mark all historical tasks and documents with terminal lifecycle status.

**Accepted when:** each guard has a fixture or test proving it goes red for the intended defect; accepted requirements have owners and evidence; an API breaking change is detected automatically; stale counts cannot coexist unnoticed; every active doc link and diagram validates.

### Phase D — Full-stack perfection specification (**P2**)

1. Complete UI/UX state matrices and accessibility acceptance for every critical journey.
2. Complete data retention/privacy and operational worker contracts.
3. Define end-to-end performance budgets and failure-mode behavior.
4. Record off-host backup and restore-drill evidence.

**Accepted when:** the product can be reviewed from actor journey through UI state, API operation, authorization, transaction, data retention, observability, and recovery evidence without reconstructing the contract from source comments.

---

## 7. Final Assessment

TokoΦ does not lack documentation; it lacks a reliable separation between **decision, requirement, observed state, runbook, task, and history**. The current corpus contains excellent institutional knowledge, but the most consequential claims—money movement, courier authority, tracking capability, API boundaries, scheduling, and tenant isolation—must stop depending on readers finding the newest correction among many dated narratives.

The target is a smaller and stricter system:

- one canonical owner per concern;
- machine-readable HTTP and generated source inventories;
- permanent requirements and evidence references;
- lifecycle-aware ADRs and archives;
- diagrams and links that CI actually validates;
- current runbooks with no historical instructions in the execution path;
- explicit capability status that never markets an accepted plan as a shipped feature.

Until those controls land, code and the target database remain the final truth, but that should be treated as a documented-system defect—not the steady-state documentation architecture.
