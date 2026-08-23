# TokoΦ — Audit Remediation & System Perfection Tasks

> Traceable task backlog for resolving audit findings from Claude, Codex, and OMP.
> Each task traces to a verified finding, names exact files, and carries a runnable "Done when" check.

> **Historical intake status (Stages 0–3):** Tasks 0.1, 0.2, 1.2, 1.3, 2.2, and 2.3 are verified in the current source. Task 1.1 remains open as Task 5.16. Task 2.1 changed labels but did not prove a restricted runtime and is superseded by Task 4.12. Task 3.1 is superseded by Task 4.13. Stages 4–7 are the only active execution queue.

## Stage 0: Security & Infra Blockers

### Task 0.1: Remove Published Insecure Secrets & Harden `resolveAuthSecret()`
- **Tracing:** `SEC-C1` / `SEC-001`
- **Target Files:** `docker-compose.coolify.yml`, `packages/lib/src/secret.ts`
- **Change:**
  1. Update `docker-compose.coolify.yml` to remove default string `${AUTH_SECRET:-dev-insecure-change-me}` and `${POSTGRES_PASSWORD:-tokophi}`, replacing with required variable expansion `${AUTH_SECRET:?AUTH_SECRET must be set}` and `${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}`.
  2. Update `packages/lib/src/secret.ts` to reject known insecure fallback literals (`dev-insecure-change-me`, `dev-insecure-*`, `dev-insecure-secret-change-me`) even if length >= 16.
- **Done when:** `vitest run packages/lib/src/secret.test.ts` passes and `resolveAuthSecret("dev-insecure-change-me")` throws in production runtime.

### Task 0.2: Fix Traefik Docker Compose Syntax
- **Tracing:** `INF-C2`
- **Target Files:** `docker-compose.coolify.yml`
- **Change:** Fix `${1}` invalid interpolation syntax in `docker-compose.coolify.yml` Traefik label definitions.
- **Done when:** `docker compose -f docker-compose.coolify.yml config -q` runs cleanly without syntax parsing errors.

---

## Stage 1: Merchant Data Loss & Admin UI Fixes

### Task 1.1: Fix CMS Page Body Loading & Preservation
- **Tracing:** `ADM-C1` / `CMS-001`
- **Target Files:** `apps/admin/lib/data/pages.ts`, `apps/admin/app/(admin)/halaman/[id]/page-editor.tsx`
- **Change:**
  1. Include `body` column in `toPage()` and `getPage()` in `apps/admin/lib/data/pages.ts`.
  2. Update `page-editor.tsx` to load and preserve `page.body` instead of overwriting with `seedBody(page.title)`.
- **Done when:** Opening an existing page in page editor displays its real `body`, and saving updates `body` without generating filler text.

### Task 1.2: Fix Decimal Tax Rate Input Parsing
- **Tracing:** `ADM-C2`
- **Target Files:** `apps/admin/app/(admin)/pengaturan/pajak-card.tsx`
- **Change:** Fix string replacement logic in `pajak-card.tsx` so decimal numbers (e.g. `11.5`) parse correctly to `11.5` instead of stripping the period (`115` -> `100%`).
- **Done when:** Inputting `11.5` sets `rate` to `11.5` and saves correctly.

### Task 1.3: Add Safe Navigation for Empty Follow-up Templates
- **Tracing:** `ADM-C3`
- **Target Files:** `apps/admin/app/(admin)/crm/followup/followup-client.tsx`
- **Change:** Replace direct dereference `templates[0].body` with safe optional chaining `templates[0]?.body ?? ""`.
- **Done when:** Loading the Followup client screen with 0 templates renders without crashing.

---

## Stage 2: Multi-Tenant RLS & Operations

### Task 2.1: Enforce Restricted DB Role (`tokophi_app`) in Compose
- **Tracing:** `INF-H3` / `TEN-001`
- **Target Files:** `docker-compose.coolify.yml`
- **Change:** Set `DATABASE_RUNTIME_ROLE: app` for `admin`, `super-admin`, and `storefront` services in `docker-compose.coolify.yml`.
- **Done when:** Production Compose configuration executes app services under `tokophi_app` role with PostgreSQL RLS active.

### Task 2.2: Schedule Order Expiry Cron Worker
- **Tracing:** `ORD-H1` / `OPS-001`
- **Target Files:** `docker-compose.coolify.yml`
- **Change:** Add `order-expiry-cron` runner service in `docker-compose.coolify.yml` calling `/api/cron/order-expiry`.
- **Done when:** `docker compose config` includes `order-expiry` cron service with `CRON_SECRET` authentication.

### Task 2.3: Fix 50-Store Truncation in Super Admin KPIs
- **Tracing:** `SUPER-001`
- **Target Files:** `apps/super-admin/lib/data.ts`
- **Change:** Add dedicated SQL aggregate queries for total stores, platform GMV, and active signups instead of slicing `getStores()` default 50 rows.
- **Done when:** `getPlatformStats()` computes aggregates across the entire `stores` table regardless of row count.

---

## Stage 3: Payment Verification & Final Validation

### Task 3.1: Harden Payment Callback & Identity Matching
- **Tracing:** `PAY-001` / `PAY-H1` / `SEC-M5`
- **Target Files:** `apps/admin/app/api/public/pay/callback/route.ts`, `packages/lib/src/pay-callback.ts`
- **Change:** Enforce exact single-payment resolution by `trx_id` / `payment_id` and accept `x-callback-token` header authentication.
- **Done when:** `npm test` passes `pay-callback.test.ts` and payment callback rejects ambiguous multi-row matches.

---

## 2026-08-16 Pre-Release Audit Queue

**Status:** Accepted for implementation; no remediation code has been changed in this planning pass.

**Source of truth:** [`specs/docs/REQUIREMENTS.md`](specs/docs/REQUIREMENTS.md) defines the accepted contract. [`specs/docs/AUDIT-SUMMARY.md`](specs/docs/AUDIT-SUMMARY.md) records the evidence. This file owns implementation order and acceptance checks.

**Release rule:** TokoΦ remains blocked from unrestricted production release until every Stage 4 task and the Stage 7 release gate pass. Stage 5 and Stage 6 items may be explicitly deferred only by an owner decision recorded in the repository; silence is not deferral.

## Stage 4: P0 Release Blockers

### Task 4.1: Remove the Reusable Responsive-Audit Credential
- **Requirement:** `NF-10`
- **Target Files:** `apps/admin/scripts/audit-responsive.mjs`, its focused script test or invocation check.
- **Change:** Remove the embedded default email/password. Require explicit test credentials through environment variables and fail before opening a browser when either value is absent.
- **Done when:** Running the audit without credentials exits non-zero without attempting login; a focused check confirms no reusable credential literal remains in the script; the audit still authenticates when explicit local test credentials are supplied.

### Task 4.2: Enforce Store Availability in Public Order Creation
- **Requirement:** `F-T9`
- **Related requirement:** `F-P4`
- **Target Files:** `apps/admin/app/api/public/order/route.ts`, focused public-order integration tests.
- **Change:** Resolve the store through the same public-servability contract used by the storefront and reject `pending`, `suspended`, or otherwise blocked stores before cart, inventory, customer, order, payment, or checkout-session writes.
- **Done when:** Integration tests submit the same valid payload to active and blocked stores; active succeeds, each blocked state returns the accepted 404/403 contract, and blocked attempts leave every affected table unchanged.

### Task 4.3: Make Payment Request Creation Idempotent
- **Requirement:** `F-M13`
- **Target Files:** `apps/admin/lib/actions/payments.ts`, `packages/db/src/schema.ts`, one new numbered migration, payment request tests.
- **Change:** Introduce one stable idempotency key per order/payment intent, enforce uniqueness in PostgreSQL, and replay the accepted result instead of creating another provider charge. Do not rely on check-then-insert.
- **Done when:** A concurrent two-request test observes one provider call, one active payment row, and the same accepted payment identity from both callers; retry after a process restart remains deterministic.

### Task 4.4: Replace Fabricated Incoming Inventory with Receipt Facts
- **Requirement:** `F-C6`
- **Related requirements:** `SEC-6`, `F-C2`
- **Target Files:** `apps/admin/lib/data/inventory.ts`, focused inventory data tests.
- **Change:** Derive incoming quantities from persisted purchase-order receipt state. If the schema does not contain a receipt fact, show pending/unknown rather than deriving a percentage from ordered quantity.
- **Done when:** Fixtures for unreceived, partially received, and fully received purchase orders return only stored quantities; no constant percentage or inferred receipt quantity remains in the data path.

### Task 4.5: Fix Multi-Variant Quick Stock Updates
- **Requirement:** `F-C7`
- **Target Files:** `apps/admin/app/(admin)/produk/inventori/inventori-client.tsx`, `apps/admin/lib/actions/inventory.ts`, focused inventory action tests.
- **Change:** Send the selected variant id, exact intended quantity, and expected prior value for each edit. Reject stale updates and report which row must be reloaded.
- **Done when:** A two-variant test edits one variant without changing the other; stale expected stock is rejected; the browser flow reloads and displays the persisted per-variant quantities.

### Task 4.6: Make `Buat PO` Create a Real Purchase Order
- **Requirement:** `F-C10`
- **Target Files:** `apps/admin/app/(admin)/produk/[id]/product-editor.tsx`, `apps/admin/lib/actions/purchases.ts`, focused purchase-order tests.
- **Change:** Connect the product-editor dialog to the existing purchase-order action with validated supplier, variant, quantity, and cost data. Keep the dialog open on failure and remove any success behavior that only closes the UI.
- **Done when:** The browser flow creates exactly one purchase order and line item for the selected variant; save failure remains visible with no row written; a repeat submission cannot duplicate the accepted request.

### Task 4.7: Persist Navigation Menu Creation
- **Requirement:** `F-P7`
- **Target Files:** `apps/admin/app/(admin)/navigasi/navigasi-client.tsx`, `apps/admin/lib/actions/menus.ts`, focused navigation tests.
- **Change:** Make create-menu insert the menu and initial items in one tenant transaction. Return a typed accepted/error result and show success only after the transaction commits.
- **Done when:** Create, reload, edit, and delete work against persisted rows; injected item-insert failure rolls back the menu; no success toast appears on rejection.

### Task 4.8: Make Checkout Order Creation Transactionally Idempotent
- **Requirement:** `F-O8`
- **Target Files:** `apps/admin/app/api/public/order/route.ts`, `packages/db/src/schema.ts`, one assigned migration, concurrent public-order tests.
- **Change:** Claim `(store_id, checkout_session_id)` inside the order transaction with a database uniqueness contract. Replay the accepted order for the same session; never rely on the current preflight read.
- **Done when:** Two concurrent valid submissions produce one order, one inventory decrement, and one stable response identity; retry after process restart is deterministic.

### Task 4.9: Serialize Purchase-Order Receipt
- **Requirement:** `F-C11`
- **Target Files:** `apps/admin/lib/actions/purchases.ts`, purchase receipt tests, schema/migration only if an accepted state constraint is missing.
- **Change:** Lock or conditionally transition the purchase order and update inventory in the same transaction. A second receipt attempt must observe the committed terminal state and perform no increment.
- **Done when:** A concurrent two-request DB test records one receipt transition and one inventory increment; replay returns the accepted terminal result without mutation.

### Task 4.10: Make Paid Subscription Callbacks Monotonic
- **Requirement:** `F-M14`
- **Target Files:** `apps/admin/app/api/public/pay/callback/route.ts`, subscription billing actions/helpers, callback tests.
- **Change:** Lock the invoice, make paid terminal for callbacks, and extend entitlement once only. Reject or safely ignore stale non-paid events after payment.
- **Done when:** Tests for paid → expired, paid → paid, and paid → expired → paid preserve paid status and extend the period exactly once.

### Task 4.11: Replace URL Impersonation JWTs with One-Time Exchanges
- **Requirement:** `SEC-10`
- **Target Files:** `apps/super-admin/lib/actions.ts`, `apps/admin/app/impersonate/route.ts`, session/auth types, one assigned migration/storage primitive if needed, impersonation tests.
- **Change:** Mint a short-lived opaque one-time exchange, consume it atomically server-side, preserve signed operator context in a bounded merchant session, and provide explicit exit. Never place reusable bearer material in a URL.
- **Done when:** One exchange succeeds once; replay, tamper, and expiry fail closed; a downstream merchant write identifies both operator and merchant; exit removes operator context.

### Task 4.12: Prove Restricted Database Identity or Fail Closed
- **Requirement:** `SEC-18`
- **Target Files:** `packages/db/src/client.ts`, `docker-compose.coolify.yml`, per-surface startup/runtime probes, restricted-role tests.
- **Change:** Remove owner-URL fallback from app-role mode. Require explicit restricted credentials and verify effective `session_user/current_user` lacks superuser and BYPASSRLS before serving traffic. Do not print connection strings.
- **Done when:** Admin, Super Admin, and Storefront refuse mislabeled owner credentials; accepted app credentials report the restricted role; cross-tenant probes remain blocked.
- **Status:** `[x]` **DONE 2026-08-22** — 🔴 **DEPLOYMENT PRECONDITION: `APP_DATABASE_URL` must be set in Coolify on the `admin` service (pointing at the restricted role `tokophi_app`) BEFORE this merges.** `${APP_DATABASE_URL:?…}` fails the deploy at compose-parse time without it — the whole stack, not just admin. `tokophi_app` was given `LOGIN` + a password by the owner on 2026-08-22 (`rolcanlogin = t`, `rolsuper = f`, `rolbypassrls = f`, verified).
  Shipped: **two pools**. `db` stays the OWNER handle for the enumerated paths that have no tenant to scope by (auth's pre-session read, `api/public/**`, cron, `provision.ts`, super-admin, storefront); new **`appDb`** is the RESTRICTED pool and `withTenant()` is its only caller, so all 79 merchant files run on a connection with no superuser and no BYPASSRLS to `RESET ROLE` back to. The `?? ownerUrl` fallback is gone: app-role mode with no `APP_DATABASE_URL` refuses to start, and the connected role is proved against `pg_roles` (`current_user` **and** `session_user`) once per process before the first tenant query. No connection string reaches any log or error.
  ⚠️ **The preflight's runbook was wrong and is superseded** — pointing all three services at `tokophi_app` is an outage, not a hardening step: all 50 policies are `TO PUBLIC` and, measured on production with no tenant GUC, `stores`/`store_users`/`products` return **0 / 0 / 0**. super-admin and storefront have **zero** `withTenant` call sites, so both are now labelled `owner` (what they have silently been). Evidence, mutation matrix and the live app-role run: `BUILD-LOG.md` [2026-08-22 15:35 UTC] + `specs/docs/tasks/2026-08-22-task-4.12-restricted-db-identity.md`.
  Still open, deliberately: `FORCE ROW LEVEL SECURITY` (0 tables — owner decision, preflight §3) and giving the cross-tenant readers a tenant context so they could move off the owner pool.

### Task 4.13: Harden First-Party Callback and Cron Authentication
- **Requirement:** `SEC-16`
- **Target Files:** `apps/admin/app/api/public/pay/callback/route.ts`, admin cron routes, `packages/lib/src/pay-callback.ts`, every caller, endpoint tests.
- **Change:** Resolve exactly one payment identity, reject ambiguous matches, and accept reusable first-party credentials only through headers or verified signatures. Remove secret-bearing query parameters from generated callback and cron URLs.
- **Done when:** Callback tests reject zero/ambiguous identities and query-only credentials; header/signature paths pass; source and log scans contain no first-party reusable secret in URLs.

## Stage 5: P1 High-Priority Remediation

### Task 5.1: Reconcile Remote and Local Shipment Cancellation
- **Requirement:** `F-S12`
- **Target Files:** `apps/admin/lib/actions/shipping.ts`, shipping cancellation tests, schema/migration only if a durable reconciliation state is absent.
- **Change:** Separate courier acceptance from local reconciliation. Persist a retryable reconciliation state when the courier cancels successfully but local order/shipment/ledger updates fail.
- **Done when:** Fault injection after remote success produces a durable non-success state; a retry converges without issuing a second effective cancellation or double-reversing ledger/inventory state.

### Task 5.2: Persist or Remove Every Product Editor Control
- **Requirement:** `F-C8`
- **Target Files:** `apps/admin/app/(admin)/produk/[id]/product-editor.tsx`, `apps/admin/lib/actions/products.ts`, `packages/db/src/schema.ts` only where accepted fields already have storage.
- **Change:** Wire sales-channel and tag controls through the existing product update contract and round-trip them, or remove controls that have no accepted product behavior. Do not add speculative schema for display-only toggles.
- **Done when:** Every retained control changes a persisted field and survives reload; a focused source/contract test proves no rendered submit field is omitted from the update payload.

### Task 5.3: Make Store-User Invitations Retriable and Truthful
- **Requirement:** `SEC-15`
- **Target Files:** `apps/admin/lib/actions/users.ts`, `apps/admin/components/admin/pengaturan/pengguna-card.tsx`, invitation integration tests.
- **Change:** Make the database row authoritative, handle uniqueness races deterministically, and distinguish created, already invited, accepted, and failed states. Never show accepted/success solely because an email operation succeeded.
- **Done when:** Tests cover duplicate retry, concurrent invite, database failure after mail success, and an already accepted user; each UI message matches durable state and no duplicate membership is created.

### Task 5.4: Distinguish Checkout Search Failure from No Results
- **Requirement:** `F-F10`
- **Target Files:** `apps/storefront/src/pages/checkout.astro`, district-search endpoint tests or browser fixtures.
- **Change:** Represent idle, loading, results, empty, and error as distinct states. Preserve typed input and offer retry after timeout/5xx; use “not found” only for a successful empty response.
- **Done when:** Browser verification covers successful selection, empty result, timeout/5xx, retry recovery, keyboard navigation, and screen-reader status messaging without losing the shopper's input.

### Task 5.5: Remove the Shared 320 px Seller Topbar Overflow
- **Requirement:** `F-F11`
- **Related requirement:** `NF-7`
- **Target Files:** `apps/admin/components/admin/topbar.tsx`, the existing responsive audit script.
- **Change:** Fix the shared topbar layout at the component boundary; preserve store identity, balance access, menu access, focus order, and touch targets.
- **Done when:** The responsive audit reports zero horizontal overflow at 320 px on all 15 seller routes, and browser verification confirms keyboard/touch access to every topbar control.

### Task 5.6: Make Product Editor Navigation Guards State-Aware
- **Requirement:** `F-C9`
- **Target Files:** `apps/admin/app/(admin)/produk/[id]/product-editor.tsx`, focused browser tests.
- **Change:** Derive dirty state from persisted form fields, install guards only while dirty, clear them after accepted save, and retain them after failed save.
- **Done when:** Browser tests cover untouched navigation, dirty navigation, cancel/continue choices, successful save then navigation, and failed save; only the dirty cases warn.

### Task 5.7: Add the Full Commerce Lifecycle Integration Test
- **Requirement:** `NF-9`
- **Target Files:** existing DB-coupled test harness plus one lifecycle integration test near the public-order/payment domain.
- **Change:** Exercise cart/order creation, stock decrement, one successful payment callback, duplicate callback replay, order transition, ledger credit/release, cancellation/return restoration, and tenant isolation using real PostgreSQL transactions.
- **Done when:** The test fails on duplicate credit, stock drift, cross-tenant access, or wrong order/payment transition; `npm run test:db` runs it without skips and remains deterministic in the full suite.

### Task 5.8: Decide the TokoΦ Account Release Scope
- **Requirement:** `F-K11`
- **Related requirements:** `F-K12`, `F-K13`
- **Target Files:** `specs/docs/TOKOPHI_ACCOUNT_SPEC.md`, `specs/PRD.md`, release/readiness docs that currently claim or omit the account surface.
- **Change:** Record one explicit owner decision: integrate the accepted account architecture into the production release, or defer the account and remove it from production release claims. Do not treat the standalone localStorage prototype as production evidence.
- **Done when:** One decision is recorded with owner, rationale, release impact, and acceptance boundary; every canonical product/release document agrees; implementation tasks are added only if integration is chosen.

### Task 5.9: Make Multi-Store Selection Explicit and Deterministic
- **Requirement:** `F-T10`
- **Target Files:** `apps/admin/lib/auth.ts`, session/store-context actions, `apps/admin/components/admin/topbar.tsx`, auth and browser tests.
- **Change:** Replace unordered first-membership selection with an explicit authorized store context, persist the choice safely, and populate the switcher from every live membership.
- **Done when:** Two-membership tests select deterministically, switching changes tenant context, revocation invalidates the old choice, and no-membership login fails clearly.

### Task 5.10: Enforce Payout State Transitions in the Mutation
- **Requirement:** `F-M15`
- **Target Files:** `apps/super-admin/lib/actions.ts`, payout action tests.
- **Change:** Lock the payout and require `status='diproses'` in the paid transition. Return a typed conflict for every other source state while preserving ledger entries.
- **Done when:** Tests attempt each payout status; only `diproses → selesai` succeeds, repeated completion is idempotent/non-mutating, and no ledger amount changes.
- **Status:** `[x]` **DONE 2026-08-22** — guard moved into the UPDATE's own WHERE (`payout-transition.ts`); typed conflicts; `apps/super-admin/lib/payout-transition.test.ts` drives all four source statuses against real PostgreSQL (6 mutations, 6 reds). See `BUILD-LOG.md` 2026-08-22.

### Task 5.11: Restore and Gate a Green Lint Baseline
- **Requirement:** `NF-13`
- **Target Files:** the six reported lint offenders, root `package.json`, `.github/workflows/ci.yml`.
- **Change:** Fix source-level lint errors without weakening rules, add one root command covering Admin and Super Admin, and run it in CI.
- **Done when:** The root lint command exits zero locally and is a required CI step; no ignore or rule-disable is added solely to hide the baseline.

### Task 5.12: Build Every Deployable Surface in CI
- **Requirement:** `NF-14`
- **Target Files:** root `package.json`, `.github/workflows/ci.yml`, existing workspace build configuration.
- **Change:** Add explicit production-native builds for Admin, Super Admin, Storefront, and Landing after checks/tests, reusing workspace scripts rather than introducing a build wrapper.
- **Done when:** CI configuration proves all four build commands are required; a clean local run builds each surface successfully with documented environment boundaries.

### Task 5.13: Make HTTP Contract Coverage Reproducible
- **Requirement:** `NF-15`
- **Target Files:** `specs/openapi/admin-api.yaml`, `specs/openapi/storefront-api.yaml`, `specs/openapi/account.yaml`, `specs/openapi/headless.yaml`, route inventory/validation scripts, root `package.json`, CI.
- **Change:** Inventory every HTTP route, classify internal exclusions explicitly, document accepted public operations in the owning contract, and pin syntax/coverage/breaking-change validation in the repository.
- **Done when:** `npm run verify:openapi` exits zero from a clean install, undocumented non-excluded routes fail the gate, and all owned OpenAPI files validate without relying on an ambient global tool.

### Task 5.14: Establish One Canonical Documentation Authority Map
- **Requirement:** `NF-16`
- **Target Files:** `specs/README.md`, canonical product/architecture/security/API/operations/release documents, historical audit headers.
- **Change:** Name one owner document per concern, demote audits to dated evidence, remove conflicting “canonical/current/production-ready” claims, repair stale links, and keep repository documents as the only source of current status.
- **Done when:** An ownership-map check finds one authority per concern; all canonical links resolve; historical reports cannot be read as current certification.

### Task 5.15: Repair Active Requirement-to-Evidence Traceability
- **Requirement:** `NF-17`
- **Target Files:** `specs/docs/REQUIREMENTS.md`, `TASKS.md`, active status/evidence documents, `scripts/check-traceability.py` (new), root `package.json`.
- **Change:** Add the smallest repository-owned checker for authoritative active contracts, fix malformed tables and invalid IDs there, and map every active task to one primary requirement and runnable acceptance check. Preserve historical IDs as history, not active obligations.
- **Done when:** `npm run verify:traceability` exits zero; every Stage 4–6 task resolves to one requirement; no active requirement is silently orphaned or falsely marked verified.

### Task 5.16: Preserve Persisted CMS Page Bodies
- **Requirement:** `F-F12`
- **Target Files:** `apps/admin/lib/data/pages.ts`, `apps/admin/app/(admin)/halaman/[id]/page-editor.tsx`, focused page data/action and browser tests.
- **Change:** Initialize the editor from `page.body`, preserve an intentionally empty body, and remove runtime title-derived filler from the edit path.
- **Done when:** Populated and empty pages open, save, and reload without replacement text or data loss.

### Task 5.17: Enforce Platform Roles at Route Entry
- **Requirement:** `SEC-9`
- **Target Files:** `apps/super-admin/middleware.ts`, `apps/super-admin/lib/platform-auth.ts`, protected route layouts/pages, focused authorization tests.
- **Change:** Declare the minimum platform role for each protected route group and enforce it before the page loads privileged data. Keep action-level authorization as the final mutation boundary; route checks are additive, not a replacement.
- **Done when:** Direct requests from `support`, `admin`, and `owner` sessions exercise every protected route class; under-privileged sessions receive the accepted denial without privileged data loading, and all action-level guards remain green.
- **Status:** `[x]` **DONE 2026-08-22** — `lib/route-roles.ts` declares the floor per route group; `platformRouteGate(path)` runs above every page's first read. Measured live with three real operator rows across all eight route classes (9 mutations, 9 reds). Action gates untouched. See `BUILD-LOG.md` 2026-08-22.

### Task 5.18: Make Per-Courier Return Analytics Honest
- **Requirement:** `F-S8`
- **Target Files:** `apps/admin/app/api/public/order/route.ts`, `apps/super-admin/lib/data.ts`, `apps/super-admin/app/(platform)/analitik/page.tsx`, focused analytics/query tests.
- **Change:** Preserve the server-verified courier and service snapshots already written by new checkout orders. Compute per-courier delivery/return rates only from rows with known courier identity, expose known-versus-legacy-unknown coverage, and never fold unknown historical rows into a named courier or a misleading denominator.
- **Done when:** Fixtures containing current orders and legacy `courier IS NULL` rows show correct per-courier numerators/denominators plus an explicit unknown coverage count; the report cannot present unknown history as zero returns or as “Tidak diketahui” performance.

### Task 5.19: Resolve COD Return Economics and Reserve Policy
- **Requirement:** `F-S9`
- **Related requirement:** `F-S10`
- **Target Files:** one new numbered decision record under `specs/decisions/`, `apps/super-admin/app/(platform)/pengaturan/pengaturan-client.tsx`, `apps/super-admin/lib/data.ts`, `packages/db/src/schema.ts`, COD policy tests and canonical product/release docs.
- **Change:** Obtain written KiriminAja/SPX return-cost terms and record the owner decision. Until evidence exists, keep COD policy restrictive and remove unsupported “free return” claims. Do not activate or charge the unused `platform_cod.fee_pct`; if a platform reserve fee is approved, define payer, taxable base, VAT, refund/return treatment, ledger ownership, and immutable order snapshot, then add the resulting implementation tasks before changing checkout totals.
- **Done when:** The decision record cites the provider evidence or states it is unavailable; UI, schema status, policy code, and release claims agree; COD cannot widen because of an unverified premise; no fee is charged without the complete accepted money contract and its own executable tasks.

### Task 5.20: Verify the Real Google OAuth Contract
- **Requirement:** `F-T6`
- **Target Files:** `apps/admin/app/api/auth/google/start/route.ts`, `apps/admin/app/api/auth/google/callback/route.ts`, auth/session tests, canonical operations/readiness docs.
- **Change:** With owner-provided test OAuth credentials supplied only through the environment, exercise start, state validation, callback, existing-user login, new-user policy, provider denial, replay, and disabled-feature behavior. Fix only contract failures proven by the smoke test; never copy credentials into fixtures, logs, or documents.
- **Done when:** A real test-account browser run completes the accepted login/session flow; invalid state, replay, denial, and disabled configuration fail safely; operations docs name required configuration and evidence boundaries without exposing credentials.

## Stage 6: P2 Hardening

### Task 6.1: Separate Offline Checks from Release Evidence
- **Requirement:** `NF-18`
- **Target Files:** root `package.json`, DB test setup/output, `specs/docs/DEVELOPMENT_READINESS.md`, release gate documentation.
- **Change:** Give offline and DB-required suites distinct commands and labels; make the release command require the dedicated test database and fail on skipped DB-coupled suites. Remove stale claims that a build runs lint when it does not.
- **Done when:** The offline command reports its boundary, the release command cannot pass without all DB suites, and canonical readiness docs name the exact commands without equating the two.

### Task 6.2: Add Direct Tenant Isolation for `inventory_levels`
- **Requirement:** `F-T8`
- **Related requirements:** `SEC-1`, `F-T1`
- **Target Files:** `packages/db/src/schema.ts`, one new numbered migration, `packages/db/src/verify-rls.ts`, `packages/db/src/verify-rls-app.ts`.
- **Change:** Enforce direct-ID store isolation through an accepted RLS policy derived from the variant/product ownership chain, without adding a denormalized `store_id` unless the policy cannot be made safe and performant otherwise.
- **Done when:** Restricted-role tests prove cross-store select/update/delete by known row id returns or affects zero rows; same-store operations still pass; migration and Drizzle schema remain in parity.

### Task 6.3: Move Public Rate Limits to Shared Production Enforcement
- **Requirement:** `NF-6`
- **Related requirement:** `F-F5`
- **Target Files:** `apps/admin/lib/public-guard.ts`, `apps/storefront/src/pages/api/track.ts`, production edge configuration and focused multi-instance tests.
- **Change:** Enforce the existing endpoint quotas in a shared production boundary that survives process restart and scales across replicas. Keep local development deterministic without silently weakening production.
- **Done when:** A multi-instance test cannot exceed the configured quota by alternating instances; restart does not reset the production counter; endpoint-specific limits and 429 responses remain documented and verified.

### Task 6.4: Remove Unused Direct Dependencies
- **Requirement:** `NF-19`
- **Target Files:** workspace `package.json` files, root lockfile, import audit.
- **Change:** Confirm each reported dependency against runtime, build, test, and config imports; remove only unreferenced direct dependencies and regenerate the authoritative lockfile.
- **Done when:** Dependency audit is clean and all four production builds plus focused tests pass from a clean install; no dependency is removed solely from a heuristic report.

### Task 6.5: Sanitize or Reject Active SVG Uploads
- **Requirement:** `SEC-17`
- **Target Files:** `apps/admin/lib/actions/media.ts`, focused upload tests.
- **Change:** Validate actual content, then either sanitize SVG against a strict allowlist or reject SVG while keeping supported raster formats. Do not trust filename extension or client MIME.
- **Done when:** Tests reject or neutralize scripts, event handlers, `foreignObject`, remote references, and MIME/extension mismatch; valid supported images still upload and render.
- **Status:** `[x]` **DONE 2026-08-23** — REJECTS, does not sanitise (a partial strip ships a file believed clean — same ruling as `set:html`). `lib/image-content.ts` is pure: `sniffImageKind` reads magic bytes + an SVG root surviving BOM/prolog/DOCTYPE/comments, `activeSvgConstruct` names the offender. ⚠️ The gate went into **`lib/image-store.ts`**, not the `lib/actions/media.ts` this entry names: `saveImage` has two importers and the other one is the store LOGO (`actions/store-profile.ts`) — gating the named file would have left that path open. 16 tests; full repo 126 files / 1041 tests green. The CSP on `api/uploads/[name]` remains the execution boundary — two layers, keep both. See `specs/docs/tasks/2026-08-23-svg-upload-content-gate.md`.

### Task 6.6: Split the Two Oversized Release-Critical Modules
- **Requirement:** `NF-12`
- **Target Files:** `apps/storefront/src/pages/checkout.astro`, `apps/admin/app/(admin)/produk/[id]/product-editor.tsx`, existing package scripts/CI.
- **Change:** After functional fixes land, extract only cohesive state/behavior already present into stack-native modules/components; add an enforceable size budget for these entry files. Do not introduce generic frameworks or one-implementation abstractions.
- **Done when:** Both entry files are below the accepted threshold, their existing browser contracts remain green, and the size guard fails when either file regresses above the configured limit.

### Task 6.7: Remove Runtime Mock Fixtures from Production Type Paths
- **Requirement:** `NF-20`
- **Target Files:** `apps/admin/lib/mock/store.ts`, all 51 current type-only consumers, `apps/admin/lib/types/domain.ts` (new).
- **Change:** Move only consumed types into the admin's canonical domain-type module, migrate every importer, then delete the unreferenced generated runtime fixture source.
- **Done when:** Production source and bundles contain no mock fixture generator, all 51 former consumers typecheck, and no duplicate domain type remains in another module.

### Task 6.8: Standardize Package Manager and Lockfiles
- **Requirement:** `NF-21`
- **Target Files:** root/workspace package manifests, lockfiles, CI and contributor commands.
- **Change:** Choose the repository's established package manager, declare it once, remove conflicting nested/alternate lockfiles after verifying they are not independent projects, and align CI/install commands.
- **Done when:** A clean install uses one authoritative lockfile with no mutation, every workspace check/build runs through the declared manager, and CI rejects lockfile drift.

### Task 6.9: Persist Per-Store Public Contact Email
- **Requirement:** `F-F7`
- **Target Files:** `packages/db/src/schema.ts`, one new numbered migration, `apps/admin/lib/actions/profile.ts`, `apps/admin/components/admin/pengaturan/store-profile-card.tsx`, `apps/storefront/src/pages/kontak.astro`, focused tenant/action and browser tests.
- **Change:** Add one nullable, validated public contact email owned by the store profile; round-trip it through the existing tenant-scoped profile action and render it only for that store. Remove any shared email fallback; an unset email is an honest empty state.
- **Done when:** Two-store tests persist and render different emails without cross-tenant access; invalid addresses are rejected; clearing the field survives reload and does not expose a shared placeholder.

## Parallel Execution Contract

Development starts from a fresh worktree based on the collaboration baseline. Independent lanes launch together; tasks sharing a release-critical file stay in one lane to prevent contradictory contracts.

| Wave | Parallel lane | Tasks | Dependency |
|---|---|---|---|
| 1 | A | 4.1 | None |
| 1 | B | 4.2 → 4.8 | Same public-order transaction; sequential |
| 1 | C | 4.3 → 4.10 → 4.13 | Same payment callback/identity surface; sequential |
| 1 | D | 4.4 | None |
| 1 | E | 4.5 → 4.6 → 4.9 | Same product/inventory/PO contract; sequential |
| 1 | F | 4.7 | None |
| 1 | G | 4.11 | None |
| 1 | H | 4.12 | None |
| 2 | A | 5.1 | Wave 1 DB baseline merged |
| 2 | B | 5.2 → 5.6 | Same product editor; sequential |
| 2 | C | 5.3 | None |
| 2 | D | 5.4 | None |
| 2 | E | 5.5 | None |
| 2 | F | 5.7 | Wave 1 accepted contracts merged |
| 2 | G | 5.8 | Product decision; independent of code lanes |
| 2 | H | 5.9 | Task 4.11 session contract merged |
| 2 | I | 5.10 | None |
| 2 | J | 5.11 → 5.12 | Same CI workflow; sequential |
| 2 | K | 5.13 | None |
| 2 | L | 5.14 → 5.15 | Authority map before traceability repair |
| 2 | M | 5.16 | None |
| 2 | N | 5.17 | None |
| 2 | O | 5.18 | None |
| 2 | P | 5.19 | Owner/provider evidence; independent of code lanes |
| 2 | Q | 5.20 | Owner-provided test OAuth client; secrets stay out of repository evidence |
| 3 | A | 6.1 | Tasks 5.11–5.15 merged |
| 3 | B | 6.2 → 6.9 | Migration coordinator assigns both numbers; sequential |
| 3 | C | 6.3 | None |
| 3 | D | 6.4 → 6.8 | Same manifests and lockfile; sequential |
| 3 | E | 6.5 | None |
| 3 | F | 6.6 | All checkout/product-editor functional changes merged |
| 3 | G | 6.7 | Task 6.4 import audit complete |

### Cross-Lane Contracts

1. **Database migrations:** one coordinator assigns migration numbers before Wave 1 starts; lanes never invent competing numbers.
2. **Public order availability:** Task 4.2 owns the servability result contract; every later public endpoint reuses it rather than defining another status matrix.
3. **Payment identity:** Task 4.3 owns provider-request idempotency; Tasks 4.10 and 4.13 consume that identity for monotonic subscription state and exact authenticated callback resolution.
4. **Inventory:** Task 4.5 owns mutation payload semantics; Task 6.2 changes database isolation only.
5. **Product editor:** one lane owns Tasks 4.6, 5.2, and 5.6 in that order; Task 6.6 refactors only after behavior is verified.
6. **Checkout:** Task 5.4 fixes behavior before Task 6.6 moves code; the refactor must preserve the browser fixtures.
7. **Validation:** lanes run focused checks only. The integration owner runs the full repository gates once after all accepted changes are integrated.
8. **COD economics:** Task 5.19 records the provider evidence and owner decision before any implementation may widen COD or charge a reserve fee.

## Stage 7: Release Gate

After Stages 4–6 are integrated:

1. Run `npm run lint`.
2. Run `npm test` for the explicit offline suite, then `npm run test:release` against the dedicated test database with zero skipped DB suites.
3. Run `npm run build:all` for Admin, Super Admin, Storefront, and Landing.
4. Run seller-admin and storefront browser matrices at desktop and 320 px, including keyboard paths and the affected error states.
5. Run RLS, migration, secret, source-size, OpenAPI coverage, documentation-authority, and traceability guards.
6. Re-run every Stage 4/P0 reproduction and record before/after evidence in `specs/docs/AUDIT-SUMMARY.md`.
7. Update requirement statuses only from executable evidence; then update `specs/docs/tasks/OPEN.md` and release readiness. No Stage 5/6 deferral is valid without a named owner decision recorded in the repository.
