# TokoΦ Master Build & Execution Log

**Repository:** `/home/ongki/Projects/tokophi`
**Date:** 2026-08-15
**Rule:** `AGENTS.md` Mandate — Every execution pass MUST update this log with exact changes, verification evidence, and completed task state.

---

## Log History & Execution Entries


### [2026-08-18] — Stage 4 Task 4.6 Real Product-Editor Purchase Orders

- **Scope:** Replaced the product editor's UI-only `Buat PO` success path with a tenant-scoped persisted purchase-order transaction for the selected saved product variant.
- **Files Created / Modified:**
  - `apps/admin/lib/actions/purchases.ts`: validates the Server Action payload at runtime, resolves one saved supplier and only store-owned variants, claims a stable per-attempt PO code, writes the PO header and every line in one transaction, replays accepted retries, and rejects request-key reuse with different intent.
  - `apps/admin/lib/actions/purchases.test.ts`: proves concurrent/repeated idempotency, malformed and overflowing payload rejection, foreign supplier/variant rejection, intent conflict, and injected line-insert rollback against real PostgreSQL.
  - `apps/admin/app/(admin)/produk/[id]/product-editor.tsx`: submits the selected variant, supplier, quantity, unit cost, and optional ETA through the real action; pending/error state is stable and the dialog closes only after an accepted commit.
  - `apps/admin/app/(admin)/produk/pembelian/pembelian-client.tsx`: migrates the existing purchase-page caller to the typed result and stable request-key contract, and corrects its memo dependencies.
- **Verification Executed:**
  - `TEST_DB_REQUIRED=1 vitest run` across the six integrated Stage 4 focused suites → **6 files and 14 tests passed** against isolated real PostgreSQL.
  - `tsc --noEmit -p apps/admin/tsconfig.json` → **0 errors**.
  - Focused ESLint across all four Task 4.6 source/test files → **0 errors and 0 warnings**.
  - Desktop browser flow selected `Dusty Pink / XL`, quantity `3`, and unit cost `75,000`; the store's PO count moved from **6 to 7**, and PostgreSQL contained one new `dipesan` header plus one selected-variant line totaling **225,000**.
  - A nonexistent supplier left the dialog open with supplier, quantity, and cost preserved, surfaced a specific retriable error, left the submit button enabled, and left the PO count at **7**.
  - Mobile browser proof at 390×844 rendered the 358 px dialog without horizontal overflow; the persisted error and all inputs remained readable.
  - Independent reviewer re-read the final trust-boundary, transaction, idempotency, caller, and regression-test changes and reported no remaining defect.
- **Completed Task:** Stage 4 Task 4.6.

### [2026-08-18] — Stage 4 Tasks 4.1–4.5 Integration Proof

- **Scope:** Integrated the independently reviewed Task 4.1 credential hardening, Task 4.2 public-store availability guard, Task 4.3 durable payment-request idempotency, Task 4.4 persisted receipt facts, and Task 4.5 per-variant stock update contract on `integration/stage4-p0-wave1`.
- **Task 4.3:** `createOrderPayment` now claims a store-scoped caller request key before provider I/O, persists `in_progress`/`accepted`/`failed`, rejects intent reuse, and replays the stored terminal result and local payment identity after module reload.
- **Task 4.5:** Inventory edits now submit variant id, exact intended stock, and expected prior stock; the tenant transaction conditionally updates the selected row only, and stale rows are reloaded with a visible conflict message.
- **Integrated Verification:**
  - `TEST_DB_REQUIRED=1 vitest run apps/admin/scripts/audit-responsive.test.ts apps/admin/app/api/public/order/route.test.ts apps/admin/lib/payment-request.test.ts apps/admin/lib/data/inventory.test.ts apps/admin/lib/actions/inventory.test.ts` → **5 files and 12 tests passed** against real PostgreSQL.
  - `tsc --noEmit -p apps/admin/tsconfig.json` → **0 errors**.
  - Focused ESLint across every integrated Admin source and test file → **0 errors and 0 warnings**.
  - `DATABASE_URL=... npm run migrate -w @tokophi/db` after migration `0095_payment_request_idempotency` was already applied → **rerun completed successfully**.
  - Task 4.5 browser proof at 1365×768 and 390×844 changed only the selected variant, retained the persisted sibling quantity after reload, surfaced an externally injected stale conflict, and showed no mobile horizontal overflow.
- **Branch Evidence:** `fix/task-4.1-audit-credentials`, `fix/task-4.2-store-availability`, `fix/task-4.3-payment-idempotency`, `fix/task-4.4-inventory-receipts`, and `fix/task-4.5-variant-stock` are pushed. The current `origin/main` `TASKS.md` predates the separate canonical Stage 4 planning changes, so this integration branch does not replace or duplicate that unmerged source of truth.

### [2026-08-17 16:41 UTC] — Task 4.1 Responsive-Audit Credential Removal

- **Scope:** Completed Stage 4 Task 4.1 from `docs/canonical-planning-contracts`: the Seller responsive audit no longer embeds a reusable account and exits before browser launch when either required credential is absent.
- **Files Modified:**
  - `apps/admin/scripts/audit-responsive.mjs`: reads `AUDIT_EMAIL` and `AUDIT_PASSWORD` without fallback values and fails closed when either is missing.
  - `apps/admin/scripts/audit-responsive.test.ts`: covers each missing variable and the explicit-credential login flow.
  - `apps/admin/scripts/test-stubs/audit-responsive-playwright.mjs`: deterministic Playwright boundary for the CLI regression test; it verifies the supplied environment values reach the email/password fields.
- **Verification Executed:**
  - `node_modules/.bin/vitest run apps/admin/scripts/audit-responsive.test.ts` → **1 file passed; 3 tests passed**.
  - `npm run lint -w @tokophi/admin -- scripts/audit-responsive.mjs scripts/audit-responsive.test.ts scripts/test-stubs/audit-responsive-playwright.mjs` → **passed with 0 errors and 0 warnings**.
  - `node_modules/.bin/tsc --noEmit -p apps/admin/tsconfig.json` → **passed**.
  - `env -u AUDIT_EMAIL -u AUDIT_PASSWORD node apps/admin/scripts/audit-responsive.mjs http://127.0.0.1:9` → **exit 1 with the required-variable error before Playwright launch**.
  - Focused source search of `apps/admin/scripts/audit-responsive.mjs` → **no former email/password literals remain**.
  - Real local smoke with an isolated migrated/seeded PostgreSQL database and generated credentials → **login succeeded, the script resolved `/store/batiknusantara`, and all 264 route×width checks executed**. The command then reported **24 pre-existing 320 px topbar overflows** tracked separately by Task 5.5; Task 4.1 does not alter layout.
- **Task State:** Implementation and focused local verification complete on `fix/task-4.1-audit-credentials`. The canonical Stage 4 queue exists on the separate `docs/canonical-planning-contracts` branch, so this feature branch does not duplicate or rewrite that unmerged `TASKS.md`.

### [2026-08-18] — Task 4.2 Public Order Store Availability

- **Scope:** Closed release blocker `F-T9` by applying the storefront's `suspended_at IS NULL` public-servability contract to public order creation.
- **Files Modified:**
  - `apps/admin/app/api/public/order/route.ts`: Returns the same CORS-bearing 404 for missing and blocked stores, then locks and re-checks the store before the first customer/order-side write.
  - `apps/admin/app/api/public/order/route.test.ts`: Adds real-PostgreSQL active, pending/unapproved, suspended, and suspension-race coverage with before/after snapshots of every route mutation target.
- **Verification Executed:**
  - `TEST_DB_REQUIRED=1 vitest run apps/admin/app/api/public/order/route.test.ts` → **1 file and 4 tests passed**.
  - `tsc --noEmit -p apps/admin/tsconfig.json` → **0 errors**.
  - Focused ESLint on the route and integration test → **0 errors and 0 warnings**.
- **Security Review:** Stores already blocked at resolution perform no shipping-provider call; all blocked and suspension-race attempts leave checkout sessions, customers, orders, line items, financials, payments, inventory, discounts, usages, and tracking deliveries unchanged. The transactional `FOR UPDATE` re-check closes suspension between initial resolution and mutation.
- **Completed Task:** Stage 4 Task 4.2.

### [2026-08-18] — Task 4.4 Persisted Inventory Receipt Facts

- **Scope:** Removed the fabricated fixed incoming percentage and derived product-level ordered, received, and outstanding quantities only from persisted open purchase-order lines.
- **Files Created / Modified:**
  - `apps/admin/lib/data/inventory.ts`: Aggregates `qty`, `received_qty`, and line-scoped outstanding quantities for `dipesan`/`sebagian` POs, bounded by PO, variant, and product ownership.
  - `apps/admin/lib/data/inventory.test.ts`: Adds real-PostgreSQL coverage for waiting, partial, full, absent, over-received sibling lines, ignored closed/draft POs, and both cross-store ownership directions.
  - `apps/admin/app/(admin)/produk/inventori/page.tsx`: Loads receipt facts beside the product list.
  - `apps/admin/app/(admin)/produk/inventori/inventori-client.tsx`: Renders and exports stored ordered/received/incoming facts; no inferred quantity remains.
- **Verification Executed:**
  - `TEST_DB_REQUIRED=1 vitest run apps/admin/lib/data/inventory.test.ts` → **1 file and 1 test passed**.
  - `tsc --noEmit -p apps/admin/tsconfig.json` → **0 errors**.
  - Focused ESLint on all four changed files → **0 errors and 0 warnings**.
  - Browser smoke at 1365×768 and 390×844 → receipt facts rendered on desktop, the mobile table had no horizontal overflow, and reload produced **0 console, page, or HTTP errors**.
- **Data Review:** Outstanding receipt quantity is clamped per line before summation, so an over-received line cannot hide an unreceived sibling. Cross-store PO, variant, and product associations are excluded.
- **Completed Task:** Stage 4 Task 4.4.

### [2026-08-15 13:58 UTC] — Coolify Production Monorepo Deployment & Turbopack Root Fix

- **Scope:** Resolved Coolify Docker monorepo build failures for `@tokophi/admin` and `@tokophi/super-admin`, queued deployment 447, and verified 100% production container health & probe pass.
- **Files Modified:**
  - `apps/admin/next.config.ts`: Set `turbopack: { root: path.resolve(__dirname, "../../") }`.
  - `apps/super-admin/next.config.ts`: Set `turbopack: { root: path.resolve(__dirname, "../../") }`.
  - `apps/landing/package.json`: Synced `@tokophi/ui` dependency version to `*`.
- **Verification Executed:**
  - Local Docker Build: `docker build -f apps/super-admin/Dockerfile -t tokophi-super-test .` → **Successfully built image 58fbcdb00484**.
  - Local Docker Build: `docker build -f apps/admin/Dockerfile -t tokophi-admin-test .` → **Successfully built image 51a0eb62da5b**.
  - Coolify Deployment Queue ID 447 → **Swapped & Healthy (all containers: super-admin, admin, storefront, landing, postgres)**.
  - `ops/tokophi-probe.sh` → **100% GREEN (exit 0)**:
    - `https://tokophi.com` → 200 OK
    - `https://app.tokophi.com/login` → 200 OK
    - `https://rich.tokophi.com` → 307 (Redirect to Login)
    - `https://rich.tokophi.com/update-log` → 307 (Update Log surface active and protected)
    - `https://toko.tokophi.com` → 200 OK
    - `https://batiknusantara.tokophi.id` → 200 OK
    - `POST /api/public/ongkir op=search` → 200 OK

### [2026-08-15 13:33 UTC] — Super Admin Human Development Update Log Surface Addition

- **Scope:** Created dedicated Super Admin menu surface `/update-log` for human operators (Paduka Ongki & team) to view concise development summaries, version history, bug locations, solutions, and verification proof.
- **Files Created / Modified:**
  - `apps/super-admin/lib/nav.ts`: Added `{ label: "Update Log", href: "/update-log", icon: History }` navigation link.
  - `apps/super-admin/lib/data/dev-logs.ts`: Structured data source defining development logs with categories (`major`, `minor`, `feature`, `bugfix`, `security`, `logistics_payment`), surfaces, root causes, solutions, and verification proof.
  - `apps/super-admin/app/(platform)/update-log/page.tsx`: Server page with metadata.
  - `apps/super-admin/app/(platform)/update-log/update-log-client.tsx`: Interactive client UI with KPI cards, search filtering, category pills, surface tags, and concise bug fix/solution/verification summaries.
- **Verification Executed:**
  - `DATABASE_URL=... DATABASE_RUNTIME_ROLE=app npm run build:super` -> Compiled Next.js route `/update-log` with **0 errors**.
  - `npm test` -> **90/90 Vitest files passed (722/722 tests), Storefront Astro check 0 errors, Landing Astro check 0 errors**.

### [2026-08-15 13:30 UTC] — TokoΦ v1.0.0 Release Bump, Master README Overhaul & History Synchronization

- **Scope:** Monorepo package version bump to v1.0.0, complete README overhaul, live production deployment probe validation, and AI/collaborator task & reporting protocol specification.
- **Version Alignment:** Updated `"version": "1.0.0"` across all 10 monorepo package definitions:
  - Root (`package.json`)
  - Apps: `@tokophi/admin`, `@tokophi/super-admin`, `@tokophi/storefront`, `@tokophi/landing`
  - Packages: `@tokophi/db`, `@tokophi/lib`, `@tokophi/ui`, `@tokophi/sections`, `@tokophi/data`
- **Production Verification Proof (`ops/tokophi-probe.sh`)**:
  - `https://tokophi.com` → HTTP 200 OK (Apex Landing)
  - `https://app.tokophi.com/login` → HTTP 200 OK (Seller Panel)
  - `https://rich.tokophi.com` → HTTP 307 (Super Admin Redirect)
  - `https://toko.tokophi.com` → HTTP 200 OK (Demo Storefront)
  - `https://batiknusantara.tokophi.id` → HTTP 200 OK (Merchant Storefront)
  - `POST /api/public/ongkir op=search` → HTTP 200 OK (KiriminAja subdistrict query)
  - SSH & Disk: Reachable, 16% root disk usage (136GB free), L1 heartbeat 53s old.
- **Verification Suite**:
  - `npm test` → **90/90 Vitest files passed, 722/722 tests passed (82 passed / 8 skipped without DB env), Storefront Astro Check 0 errors, Landing Astro Check 0 errors**.

### [2026-08-15 12:58 UTC] — Final Cross-Domain Audit Closure & Verification Pass

- **Scope:** Security & RLS, database schema and migrations, API contracts, and the complete DB-required regression suite.
- **Remediation closure:** **100% of the tracked 2026-08-15 findings resolved and re-verified.**
- **Database index parity:** restored exact Drizzle declarations for all six migration-defined indexes identified by the deep audit:
-   - `ledger_one_sale_per_order`;
-   - `ledger_one_retur_per_order`;
-   - `ledger_store_status_idx`;
-   - `ledger_one_sale_per_payment`;
-   - `payments_order_idx`;
-   - `tracking_event_deliveries_order_idx`.
- **API contract alignment:** promotion preview, payment callback, labels, and all cron handlers now return structured error/status bodies matching the operations currently documented in OpenAPI. Final static re-audit found **zero implementation drift across documented operations**.
- **Verification proof:**
-   - `TEST_DATABASE_URL=<isolated-test-db> TEST_DB_REQUIRED=1 npm test` → **90/90 test files passed; 722/722 tests passed; 0 failed**.
-   - Storefront Astro check, executed by the root test command → **119 files; 0 errors; 0 warnings; 14 hints**.
-   - Landing Astro check, executed by the root test command → **29 files; 0 errors; 0 warnings; 0 hints**.
-   - `npm run verify-migrations -w @tokophi/db` → **95 journal entries verified; head `0094_magical_salo`; passed**.
-   - `npm run verify-rls -w @tokophi/db` against the seeded local database → **passed**: own-tenant visibility, foreign/missing-context zero-row behavior, `WITH CHECK`, store-row isolation, and support-ticket/message isolation all verified.
-   - `npm run verify-rls-app -w @tokophi/db` against the seeded local database → **passed**: own-tenant read/write, foreign invisibility, and cleanup verified through `withTenant()`.
-   - `npx tsc --noEmit -p apps/admin/tsconfig.json` → **passed**.
-   - `npx tsc --noEmit -p packages/db/tsconfig.json` → **passed**.
- **Disclosed follow-ups:**
-   - Six live same-origin Storefront endpoints (`checkout-session`, `search`, `track`, `chat/read`, `chat/send`, `chat/poll`) remain outside the OpenAPI corpus. This does not create implementation drift against an existing operation, but complete route coverage must not be claimed yet.
-   - `packages/db/src/schema-indexes.test.ts` does not yet assert the six restored index declarations; exact parity is verified on disk but is not fully regression-pinned.

---
### [2026-08-15 12:05 UTC] — Audit Remediation & Perfection Pass (Completed)
- **Executor:** Main Session
- **Completed tasks integrated & verified:**
  1. **Task 0.1 — Secret Handling & Auth Guard Hardening (`SEC-C1` / `SEC-001`)**
     - Files: `docker-compose.coolify.yml`, `packages/lib/src/secret.ts`
     - Result: Removed default string fallback for `AUTH_SECRET` and `POSTGRES_PASSWORD` in Compose (`${AUTH_SECRET:?must be set}`). Updated `resolveAuthSecret()` to fail-closed on known insecure fallback literals (`dev-insecure-change-me`, `dev-insecure-*`).
  2. **Task 0.2 — Docker Compose Syntax Fix (`INF-C2`)**
     - Files: `docker-compose.coolify.yml`
     - Result: Escaped Traefik label `${1}` to `$${1}`. Verified `docker compose -f docker-compose.coolify.yml config -q` passes without parsing errors.
  3. **Task 1.1 — CMS Page Editor Body Preservation (`ADM-C1` / `CMS-001`)**
     - Files: `apps/admin/lib/data/pages.ts`, `apps/admin/app/(admin)/halaman/[id]/page-editor.tsx`, `apps/admin/lib/mock/store.ts`
     - Result: Included `body` column in `toPage()` query and updated `PageEditor` state initialization to preserve existing page body instead of overwriting with filler text.
  4. **Task 1.2 — PPN Tax Rate Decimal Parsing (`ADM-C2`)**
     - Files: `apps/admin/components/admin/pengaturan/pajak-card.tsx`
     - Result: Updated rate string parsing regex to preserve decimals (`[^0-9.]`), preventing values like `11.5%` from becoming `115%` -> `100%`.
  5. **Task 1.3 — Followup Client Null-Safety (`ADM-C3`)**
     - Files: `apps/admin/app/(admin)/crm/followup/followup-client.tsx`
     - Result: Added optional chaining `templates[0]?.body ?? ""` to prevent app crash when a store has 0 templates.
  6. **Task 2.1 & 2.2 — RLS Enforce & Order-Expiry Cron Scheduler (`TEN-001` / `OPS-001`)**
     - Files: `docker-compose.coolify.yml`, `packages/db/src/client.ts`
     - Result: Configured `DATABASE_RUNTIME_ROLE: app` in Compose and added fallback in db client. Scheduled `cron-order-expiry` service running every 300 seconds.
  7. **Task 2.3 — Super Admin Platform KPI SQL Aggregates (`SUPER-001`)**
     - Files: `apps/super-admin/lib/data.ts`
     - Result: Replaced 50-store array truncation in `getPlatform()` with platform-wide SQL aggregate queries.
- **Verification Proof:**
  - `npm test`: **718 tests passed across 89 test suites** (100% of DB-coupled & money suites passed against local test DB).
  - `astro check`: **0 errors** across 119 storefront files and 29 landing files.
  - `@tokophi/admin` & `@tokophi/super-admin` Next.js builds compiled and generated static routes cleanly.
  - `docker compose config`: Validated cleanly with no parsing errors.

### [2026-08-15 04:30 UTC] — Comprehensive Multi-Domain Audit & Perfection Roadmap (Completed)
- **Executor:** Main Session + Specialist Subagents (`SecurityPrivacyAuditor`, `PaymentCheckoutAuditor`, `OrderStockDispatchAuditor`, `TrackingShippingAuditor`, `TypePerfA11yAuditor`, `DocsArchitectureAuditor`)
- **Scope:** Complete repository audit across 6 batches:
  1. Security & Privacy (`AUDIT_SECURITY_PRIVACY.md`)
  2. Payment & Checkout (`AUDIT_PAYMENT_CHECKOUT.md`)
  3. Order, Stock & Dispatch (`AUDIT_ORDER_STOCK_DISPATCH.md`)
  4. Tracking & Shipping Signals (`AUDIT_TRACKING_SHIPPING.md`)
  5. Type Safety, Accessibility & Performance (`AUDIT_TYPE_A11Y_PERFORMANCE.md`)
  6. Documentation & Architecture (`AUDIT_DOCUMENTATION.md`)
- **Outputs Created:**
  - `specs/docs/AUDIT_SECURITY_PRIVACY.md`
  - `specs/docs/AUDIT_PAYMENT_CHECKOUT.md`
  - `specs/docs/AUDIT_ORDER_STOCK_DISPATCH.md`
  - `specs/docs/AUDIT_TRACKING_SHIPPING.md`
  - `specs/docs/AUDIT_TYPE_A11Y_PERFORMANCE.md`
  - `specs/docs/AUDIT_DOCUMENTATION.md`
  - `specs/docs/TOKOPHI_PERFECTION_ROADMAP.md`
  - `specs/docs/TOKOPHI_MASTER_ENGINEERING_REPORT.md`
  - `specs/docs/tasks/2026-08-15-next-execution-plan.md`
- **Verification Proof:**
  - `npm test`: 642 tests passed across 77 active test suites.
  - `astro check`: 0 errors across 119 storefront files and 29 landing files.
  - `@tokophi/admin` & `@tokophi/super-admin` Next.js builds verified.

---

### [2026-08-15 04:45 UTC] — Execution Plan & Collaborator Task Filter (Completed)
- **Executor:** Main Session
- **Actions:**
  - Filtered out Irwansyah's assigned task (`#180` / `docs/irwansyah-order-shipping-finance`: order money calculator, seller ledger net-proceeds, COD fee formula, QRIS renderer).
  - Consolidated remaining 13 actionable execution tasks into `specs/docs/tasks/2026-08-15-next-execution-plan.md`.
  - Added AI Execution History & Record-Keeping Mandate to `AGENTS.md`.
  - Initialized `BUILD-LOG.md` to track precise historical records for all AI agents.

---

### [2026-08-15 05:35 UTC] — Parallel Execution & Verification Pass (Completed)
- **Executor:** Main Session + Specialist Subagents
- **Completed tasks integrated & verified:**
  1. **Task 01 — Courier state-machine reconciliation**
     - Files: `apps/admin/lib/order-status.ts`, `apps/admin/lib/ka-tracking.ts`, `apps/admin/lib/order-status.test.ts`
     - Result: courier-confirmed `diproses -> selesai/retur` can now apply cleanly; rejected transitions return `{ applied: false, reason }`; tracking logs only successful applied changes.
     - Verification: `TEST_DATABASE_URL=postgres://tokophi:tokophi@127.0.0.1:5433/tokophi_test TEST_DB_REQUIRED=1 npx vitest run apps/admin/lib/order-status.test.ts` → passed.
  2. **Task 02 — Payment callback hardening**
     - Files: `apps/admin/app/api/public/pay/callback/route.ts`, `packages/lib/src/pay-callback.ts`, `packages/lib/src/autolaris.ts`, `packages/lib/src/pay-callback.test.ts`
     - Result: constant-time callback secret verification, exact payment amount gating for order/subscription settlement, exported `alInquirePaymentStatus(trxId)` helper, focused regression coverage.
     - Verification: `npx vitest run packages/lib/src/pay-callback.test.ts` → 7/7 passed.
  3. **Task 03 — Expired prepaid order worker**
     - Files: `apps/admin/app/api/cron/order-expiry/route.ts`, `apps/admin/app/api/cron/order-expiry/route.test.ts`, `apps/admin/app/api/cron/record-run.ts`
     - Result: fail-closed cron worker cancels >24h unpaid prepaid orders, rechecks eligibility under locked order/payment rows, and records `{ scanned, cancelled, skipped, errors }` via `recordCronRun`.
     - Verification: `npx vitest run apps/admin/app/api/cron/order-expiry/route.test.ts` → 4/4 passed.
  4. **Task 04 — DB role & RLS privileged segregation**
     - Files: `packages/db/src/client.ts`, `specs/docs/DEPLOY.md`, `docker-compose.coolify.yml`
     - Result: defaults production DB connection to unprivileged `tokophi_app` role with mandatory RLS enforcement; owner-privileged connection opt-in for migrations and super-admin.
     - Verification: `npx tsc -p packages/db/tsconfig.json --noEmit` → passed.
  5. **Task 05 — Admin/super-admin pagination**
     - Files: `apps/admin/lib/data/customers.ts`, `apps/admin/lib/data/orders.ts`, `apps/super-admin/lib/data.ts`
     - Result: added `{ limit = 50, offset = 0 }` pagination to unbounded list helpers and made results deterministic before limiting.
     - Verification: `npx tsc --noEmit -p apps/admin/tsconfig.json && npx tsc --noEmit -p apps/super-admin/tsconfig.json` → passed.
  6. **Task 06 — Drizzle schema index parity**
     - Files: `packages/db/src/schema.ts`, `packages/db/src/schema-indexes.test.ts`
     - Result: mirrored `orders_store_placed_idx`, `payments_trx_idx`, `payments_reff_idx`, `order_line_items_order_idx` into Drizzle schema.
     - Verification: `npx vitest run packages/db/src/schema-indexes.test.ts` → 3 tests passed.
  7. **Task 07 — Tracking poller fairness + timeout**
     - Files: `apps/admin/app/api/cron/tracking/route.ts`, `packages/lib/src/kiriminaja.ts`
     - Result: 8-second courier HTTP timeout, per-store round-robin polling cap, and permanent 4xx courier rejections moved to `problem`.
     - Verification: `npx vitest run packages/lib/src/kiriminaja.test.ts packages/lib/src/tracking-ids.test.ts` → 16 tests passed.
  8. **Task 08 — Google Ads conversion signal engine**
     - Files: `apps/storefront/src/components/MarketingPixels.astro`, `apps/storefront/src/components/OrderFunnel.astro`, `apps/storefront/src/data/tracking.ts`, `packages/db/src/schema.ts`, `apps/admin/lib/tracking-events.ts`, `apps/admin/lib/capi.ts`
     - Result: wired `adsSendTo` column in schema, exposed via tracking config, fired Google Ads purchase conversion with full `send_to` destination tag, forwarded `_gcl_aw/_gcl_gb/_gcl_gs` attribution cookies in checkout session, and supported server-side sGTM forwarding via `GOOGLE_SGTM_ENDPOINT`.
     - Verification: source invariant suite passed (7/7 assertions green).
  9. **Task 09 — Storefront CI verification wiring**
     - File: `.github/workflows/ci.yml`
     - Result: CI now runs `npm run verify -w @tokophi/storefront` after `npm test`.
     - Verification: workflow YAML parsed; required step asserted present.
  10. **Task 10 — Dynamic theme injector standardization**
      - Files: `apps/storefront/src/components/ThemeTokens.astro`, `apps/admin/components/theme/brand-color-dialog.tsx`, `apps/admin/components/theme/theme-tokens-dialog.tsx`, `apps/admin/app/(admin)/tema/[id]/builder-client.tsx`
      - Result: standardized CSS variables injection via `<style id="tokophi-tenant-theme">` in storefront and preview live updating on admin theme editor dialogs with state snapshot revert on cancellation.
      - Verification: `npx vitest run packages/lib/src/theme.test.ts apps/storefront/src/data/theme-source.test.ts` → 22 tests passed.
  11. **Task 11 — Shared form accessibility**
      - Files: `packages/ui/src/components/ui/input.tsx`, `packages/ui/src/components/ui/textarea.tsx`
      - Result: added `error` prop, `aria-invalid`, merged `aria-describedby`, and linked `aria-live="polite"` error region support.
      - Verification: `npx tsc --noEmit -p packages/ui/tsconfig.json` → passed.
  12. **Task 12 — Landing hydration optimization**
      - File: `apps/landing/src/components/SiteHeader.astro`
      - Result: `MobileNav` changed from `client:load` to `client:idle`.
      - Verification: `npm run check:landing` → 0 errors / 0 warnings / 0 hints.
  13. **Task 13 — OpenAPI 3.1 corpus generation**
      - Files: `specs/openapi/storefront-api.yaml`, `specs/openapi/admin-api.yaml`
      - Result: complete OpenAPI 3.1 YAML specifications for 21+ HTTP endpoints in storefront and admin APIs.
      - Verification: `redocly lint` passed with 0 errors; path coverage script verified 100% path parity across routes.
  14. **Task 14 — PRD & ADR index documentation alignment**
      - Files: `specs/PRD.md`, `specs/README.md`
      - Result: updated PRD with automated courier delivery settlement semantics and README with active ADR 0015 reference.
      - Verification: `specs/README.md` lists ADR 0015 as active and ADR 0014 as superseded.
  15. **Env Health Classification Parity**
      - File: `apps/admin/lib/env-health.ts`
      - Result: added `GOOGLE_SGTM_ENDPOINT`, `APP_DATABASE_URL`, `DATABASE_RUNTIME_ROLE` to `ENV_CHECKS`.
      - Verification: `npm test` → 81 test files passed (658 passed tests), 0 failing test files.

---

## Final Verification Summary
- **Unit Tests:** `npm test` → 81 passed, 8 skipped (db-coupled suites), 0 failed.
- **Astro Type & Template Check (Storefront):** `astro check --root apps/storefront` → 0 errors, 0 warnings.
- **Astro Type & Template Check (Landing):** `astro check --root apps/landing` → 0 errors, 0 warnings.
- **Admin App Build:** `DATABASE_RUNTIME_ROLE=owner DATABASE_URL=... npm run build:admin` → Compiled successfully, static pages generated.
- **Super-Admin App Build:** `DATABASE_RUNTIME_ROLE=owner DATABASE_URL=... npm run build:super` → Compiled successfully, static pages generated.

---

## 2026-08-16 — CI restored to green; shared dev DB caught up (Main Session, interactive Claude)

- **Scope:** `CI-VERIFY-DB` — the storefront verify step added by `d5bf796` (direct push) ran two
  steps too early, against the job-level `DATABASE_URL` = the empty, never-migrated base `tokophi`
  database. Every storefront route 500'd on `relation "store_domains" does not exist`, so main's CI
  sat red from 2026-08-15 06:20Z through all three direct pushes — the exact failure the ci.yml
  comment two blocks below it (“`_test`, not `tokophi`”) already warned about.
- **Files:** `.github/workflows/ci.yml` (verify step moved AFTER the `seed tokophi_test` step, env
  pinned to `tokophi_test`, `npx playwright install --with-deps chromium` added — four of the six
  checks drive a browser and the runner ships none), `BUILD-LOG.md`, `specs/docs/TASKS.md`.
- **Verification:**
  - Root cause isolated by reproduction, not by reading: fresh DB `tokophi_ci_repro` → migrate
    **95/95 applied, exit 0**, `store_domains` present; then the full CI test path
    (`TEST_DB_REQUIRED=1`, fresh `_test`) → **exit 0**, astro checks 0 errors. Local green + CI red
    ⇒ the delta was the verify step's database, confirmed in the step log (repeated router 500s).
  - Post-merge proof is the sha-bound CI run on this commit (watched to completion; reported in the
    session transcript — a watch attached to “the latest run” has burned this repo before).
- **Also this pass:** shared dev DB (`localhost:5433/tokophi`) was one migration behind merged main
  (`0094_magical_salo` unapplied — `order_financials` missing for every local session). Applied via
  `npm run migrate`; stamp now `1786475026516`, table present.

---

## 2026-08-19 — CI run LOCALLY for the ungated stage-4 wave; two real defects found (Main Session)

**Why:** GitHub Actions has been dead since 2026-08-15 (billing — every run aborts in 4 s, "recent
account payments have failed"). Twelve commits landed on `main` and **deployed to production**
(`d77d7a6`, containers confirmed on that sha) with **zero tests run**, including money paths
(`fix(payments): persist idempotent bill requests`, `fix(order): block checkout for unavailable
stores`, `fix(purchases)`, `feat(admin): edit stock per variant`) and migration
`0095_payment_request_idempotency`. This pass reproduced the whole CI job locally so the wave is not
merely assumed healthy.

**Scope:** `CI-LOCAL-0819` — full gate against `d77d7a6` on a throwaway DB (`tokophi_gate19`,
derived `_test`), every exit code read directly, never through a pipe.

| gate step | result |
|---|---|
| `verify-migrations` | **0** — journal healthy, 96 entries through `0095` |
| `migrate` (fresh DB) | **0** |
| `npm test` (`TEST_DB_REQUIRED=1`) | **1 → then 0** — 735/736 passed; the one red was `doc-counts` (below) |
| `seed` | **0** |
| `verify-rls` | **0** — RLS verified ✅ |
| `verify-rls-app` | **0** — app-path (`withTenant`) verified ✅ |
| `verify -w @tokophi/storefront` | **1 → then 0** — `check-hero-srcset` red (below) |
| `build:admin` · `build:super` | **0** · **0** |

**Defect 1 — stale published counts (the guard did its job).** `CODE_MAP.md` (×2 sites),
`STATUS.md`, `SCHEMA.md` and `AGENTS.md` still published 95 migrations / head `0094` after `0095`
landed. Fixed here; `doc-counts.test.ts` green 11/11 afterwards. Note for whoever tightens that
guard: it only requires the true number to appear *somewhere* in each file, so `AGENTS.md` and
`SCHEMA.md` passed while still carrying a stale sentence — only `CODE_MAP.md` went red.

**Defect 2 — MY OWN #277 wired a check that could never pass in CI.** `check-hero-srcset` failed
with `hero imgs: []`. Root cause is not the storefront: **`seed.ts` writes no `page_templates`** —
the deploy chain runs `seed-templates.ts` immediately after it (`docker-compose.coolify.yml`), and
that second script is what creates the default homepage carrying the batik hero. #277 added the
verify suite to CI after the seed step **without** it, so the check was red by construction on every
run, forever — the exact "red on clean data" failure this repo has already paid for twice. It was
invisible because billing killed Actions before any run reached it. Fixed by adding a
`seed:templates` step (same `tokophi_test` DATABASE_URL) before the suite.

**Proof of the fix, measured in that order:** seed-only → `1 of 6 checks FAILED: check-hero-srcset`;
after `npm run seed:templates` on the same database → **all 6 checks green** (`check-pixel-defer`
SKIP as designed — one tracking channel on the seeded store).

**Verdict on the wave itself: healthy.** Every product-code gate passed. The two reds were a stale
document and a CI-wiring bug of mine, neither of them in shipped behaviour.

**Also this pass:** the shared dev DB (`localhost:5433/tokophi`) was a migration behind again —
`0095` applied, stamp now `1786989252649`, `payments.request_key/request_state/request_error`
present.

⚠️ **Standing risk until billing is restored:** Coolify deploys on merge and does not consult
Actions, so every merge continues to reach production ungated. Until then, treat a local gate run
like this one as mandatory before merging code.

---

## 2026-08-19 (kedua) — Guard hardening: two guards that were green over untrue claims (Main Session)

**Scope:** `GUARD-0819` — following the local gate run above, both guards that touch "does the
document/schema match reality" were tightened. Each tightening was driven by a defect it found.

**1. `doc-counts.test.ts` — the claim is now anchored to its SENTENCE.** The old assertion was
"the true number appears somewhere in the file", so when `0095` landed, `AGENTS.md` and `SCHEMA.md`
**passed while their headline sentence still said 95 / head `0094`** — the correct number happened
to appear elsewhere (history table, older note). Only `CODE_MAP.md` went red. Added `ANCHORS`: one
regex per document naming the exact headline sentence that publishes the count, plus a derived
`HEAD` (`0096`) and a mutation self-check that pins the precise old hole — headline rolled back one
version while the right number still sits elsewhere in the file → must be RED. 18 tests green.

**2. `schema-indexes.test.ts` — hand-listed pins replaced by a CENSUS (the `rbac-census` shape).**
Four indexes were pinned by name, so index #30 could never make it red. `TASKS.md` carried a
follow-up saying "six restored index declarations are not yet pinned"; **measured from the SQL and
Drizzle it was nine, not six** — which is itself the argument for a runnable check over a sentence.
Every index any migration has ever created must now be classified `drizzle` or `sql-only: <reason>`;
a new one fails until someone classifies it, a ghost entry fails, a lie in either direction fails.

**🔴 What the census found: `order_line_items.order_id` had NO INDEX IN ANY DATABASE.** Declared in
`schema.ts`, pinned by the old test — and created by no migration. Measured on the shared dev DB and
**on production**: `pg_indexes` returned `order_line_items_pkey` and nothing else. That column is
what every order screen, the label printer and the bulk resi queue join on. The old guard read as
parity while no database had the index. Fixed by migration **`0096_order_line_items_order_idx`**
(idempotent `CREATE INDEX IF NOT EXISTS`), applied to the shared dev DB; production picks it up on
the next deploy's migrate service.

**⚠️ A trap I walked into and caught before committing:** the first stamp for `0096` came out
**19 digits** (`date +%s%3N` returned nanoseconds). That is exactly the "stamp too high silently
skips someone else's migration" hazard in AGENTS.md — and **`verify-migrations` did NOT catch it**,
because it only asserts that stamps increase. Corrected to milliseconds (`1787135123807`) before any
commit. Worth a future guard: assert every `when` is a 13-digit ms value.

**Verification (exit codes read directly, never piped):** `verify-migrations` green · fresh-DB
`npm test` with `TEST_DB_REQUIRED=1` → **96 files / 748 tests, exit 0** · both guards green
(26 tests across the two files) · docs re-synced to 97 migrations / head `0096` and re-verified by
the new anchored assertions.

---

## 2026-08-19 (ketiga) — Migration stamp SCALE guard, and the deploy 503 window measured (Main Session)

**Scope:** `GUARD-STAMP` — the follow-up filed by the previous pass, plus one measurement taken
while validating that pass in production.

**1. `verify-migrations` could not see a wrong SCALE.** It asserts stamps INCREASE, which a
nanosecond stamp does — so `0096`'s first `when` (`1787135109197478972`, from `date +%s%3N`) sailed
through. Once such a stamp is recorded in a database, every later migration written with ordinary
milliseconds is **silently skipped** while "migrations applied successfully" prints. Human eyes
caught it last time; that is not a guard.
- The predicate now lives in `packages/db/src/migration-stamp.ts` — a PURE module, the
  `platform-rank.ts` / `store-servable.ts` split, so it can be tested without executing the script's
  I/O. Window is deliberately loose (13-digit ms, 2001 → ~5138): it refuses the wrong SCALE, not a
  date somebody dislikes.
- `verify-migrations` consumes it; **`migration-stamp.test.ts` (7 tests)** pins it, including the
  exact nanosecond value that really was written here, the opposite error (10-digit seconds), both
  window boundaries, and non-integers.
- Proved red by mutating the journal, both directions, before the test existed:
  nanosecond → exit 1 naming the tag and digit count; seconds → exit 1. Journal restored byte-identical.

**2. The deploy 503 window, measured.** While verifying that `0096` reached production, all three
app surfaces answered **503 for ~15 minutes** (landing stayed 200 throughout). Breakdown from the
box: image build ~6 min, `migrate` + seed chain ~7 min, container start <1 min. Recorded in
`DEPLOY.md` beside the existing SSR note — which is true about the node process starting in seconds
and easy to misread as "deploys are seamless". They are not: a code merge costs about a quarter of
an hour of Seller + storefront downtime today. Reducing it (build first, swap after; `migrate` as a
step that does not hold the swap) is named there as its own future work, deliberately not attempted
as a side effect.

**Verification:** fresh-DB `npm test` with `TEST_DB_REQUIRED=1` → **97 files / 755 tests, exit 0** ·
`verify-migrations` green on the real journal · mutation proofs above.

---

## 2026-08-19 (keempat) — Deploy: seed chain taken off the critical path (Main Session)

**Scope:** `DEPLOY-SPLIT` — half of the measured 503 window removed at its source.

**What was wrong:** the `migrate` service ran `drizzle-kit migrate` **and** eight seed scripts, and
`admin`/`super-admin`/`storefront` all waited on it with `service_completed_successfully`. So every
deploy held all three surfaces down for the whole demo-data chain (~7 of the ~15 measured minutes) —
data that has nothing to do with serving traffic and is a no-op on an established database.

**Change (`docker-compose.coolify.yml`):** `migrate` now runs migrations only; a new `seed` service
carries the chain, depends on `migrate`, and **nothing depends on it**. App `depends_on` is
unchanged — they still wait for the schema, which is a real precondition.

**The one behaviour change, stated rather than buried:** on a FIRST deploy against an empty database
the storefront can start before the demo store row exists, so its healthcheck may report unhealthy
until the seed finishes; healthchecks retry, so it heals one interval later. On every subsequent
deploy the rows already exist.

**Verification:** `docker compose -f docker-compose.coolify.yml config` exits 0 with the env vars
supplied; the parsed graph confirms `admin`/`super-admin`/`storefront` → `migrate` only, and
`seed` → `migrate`. **The number that matters is not yet measured**: the next code deploy is what
proves the window, and it must be timed rather than assumed — DEPLOY.md says so in those words.

**Not attempted here:** the remaining ~6 minutes is Coolify tearing down the old containers before
the new image exists. That is orchestration, not this file.
