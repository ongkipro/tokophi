# TokoΦ Next Execution Plan — Production Readiness & Perfection Tasks

**Date:** 2026-08-15
**Authority:** Master Engineering Audit Synthesis (`specs/docs/AUDIT_*.md`, `specs/docs/TOKOPHI_*.md`)
**Target Workspace:** `/home/ongki/Projects/tokophi`
**Status:** APPROVED FOR EXECUTION

---

## Executive Summary & Task Traceability Matrix

This execution plan translates the findings of the 6-batch domain audit and perfection roadmap into 14 concrete, numbered, and fully traceable tasks. Each task addresses specific P0/P1/P2 findings or perfection mandates and contains explicit "Done when" acceptance criteria.

```
┌────────────────────────────────────────────────────────────────────────────┐
│                  TokoΦ Phased Execution Task Roadmap                        │
├────────────────────────────────────────────────────────────────────────────┤
│ Phase 1: Critical Security & Money Boundary Hardening (Tasks 1 – 4)         │
│   • T-01: Order State Machine & Courier Sync Reconciliation (P0)          │
│   • T-02: Payment Callback Verification & Amount Check (P0)                │
│   • T-03: Prepaid Order Expiry & Stock Reclamation Worker (P0)             │
│   • T-04: Production DB Role & RLS Privileged Role Segregation (P0)        │
├────────────────────────────────────────────────────────────────────────────┤
│ Phase 2: High-Volume Reliability & Data Integrity (Tasks 5 – 8)            │
│   • T-05: Admin & Super-Admin Query Paginator Standardization (P1)         │
│   • T-06: Drizzle Schema Index Mirroring (0083/0085 Parity) (P1)           │
│   • T-07: Tracking Poller Partitioning & Timeout Signals (P1)              │
│   • T-08: Google Ads Conversion Signal Engine Pipeline (P1)                │
├────────────────────────────────────────────────────────────────────────────┤
│ Phase 3: UI/UX, Theme Engine & Accessibility Perfection (Tasks 9 – 12)    │
│   • T-09: Storefront Browser-Driven Regression Suite CI Integration (P1)  │
│   • T-10: Dynamic Theme CSS Variable Injector Standardization (P2)         │
│   • T-11: Accessible Form Error Announcers & ARIA Attributes (P2)          │
│   • T-12: Landing Hydration Optimization (client:idle) (P2)                │
├────────────────────────────────────────────────────────────────────────────┤
│ Phase 4: Documentation & OpenAPI Contract Governance (Tasks 13 – 14)      │
│   • T-13: OpenAPI 3.1 Specification Corpus Generation (P0/P1)              │
│   • T-14: PRD & ADR Index Documentation Alignment (P1/P2)                 │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Critical Security & Money Boundary Hardening

### Task 1: Order State Machine & Courier Sync Reconciliation (P0)
- **Target Files:** `apps/admin/lib/order-status.ts`, `apps/admin/lib/ka-tracking.ts`.
- **Traceability:** `AUDIT_ORDER_STOCK_DISPATCH.md` (§3.1).
- **Description:** Reconcile `order-status.ts`'s `ALLOWED` transition matrix with `ka-tracking.ts`'s forward-rank sync model so courier-confirmed delivery/return skips (`diproses → selesai` / `diproses → retur`) complete state updates, ledger credits, and COD cash collection without silent no-ops.
- **Done when:**
  1. `ALLOWED["diproses"]` includes `"selesai"` and `"retur"` for courier-confirmed sync paths.
  2. `applyOrderStatusChange` returns a status result object (`{ applied: boolean, reason?: string }`).
  3. `ka-tracking.ts` only logs `status:...` change when `applied === true`.
  4. Unit test in `apps/admin/lib/order-status.test.ts` verifies that `diproses → selesai` from courier sync completes order status update, COD payment flip to `berhasil`, and ledger credit insertion.

### Task 2: Payment Callback Verification & Amount Check (P0)
- **Target Files:** `apps/admin/app/api/public/pay/callback/route.ts`, `packages/lib/src/autolaris.ts`, `packages/lib/src/pay-callback.ts`.
- **Traceability:** `AUDIT_PAYMENT_CHECKOUT.md` (`PAY-01`, `PAY-02`, `PAY-03`).
- **Description:** Replace query-string bearer token with HMAC/signature verification, validate paid amount against order total, add server-to-server status inquiry check, and enforce unique indexes on `payments.reff_id` and `payments.trx_id`.
- **Done when:**
  1. `pay/callback/route.ts` verifies webhook signature via HMAC SHA-256 constant-time comparison.
  2. Callback handler verifies `body.amount == payment.amount` before marking payment `berhasil`.
  3. `autolaris.ts` exports `alInquirePaymentStatus(trxId)` and callback performs live inquiry check for amounts > Rp 1.000.000.
  4. Migration adds `CREATE UNIQUE INDEX` on `payments.trx_id` and `payments.reff_id`.

### Task 3: Prepaid Order Expiry & Stock Reclamation Worker (P0)
- **Target Files:** `apps/admin/app/api/cron/order-expiry/route.ts`, `apps/admin/lib/actions/orders.ts`.
- **Traceability:** `AUDIT_PAYMENT_CHECKOUT.md` (`PAY-04`).
- **Description:** Implement an automated cron job that sweeps unpaid VA/prepaid orders exceeding their 24-hour TTL, marks them `batal`, and restores allocated inventory to `inventory_levels`.
- **Done when:**
  1. `/api/cron/order-expiry` route sweeps `pending_payment` orders older than `expires_at` (or 24h).
  2. Expired orders transition to `batal` via `applyOrderStatusChange` and stock is restored atomically.
  3. Cron execution is registered in `docker-compose.coolify.yml` sidecars and `recordCronRun` logs execution metrics.

### Task 4: Production DB Role & RLS Privileged Role Segregation (P0)
- **Target Files:** `packages/db/src/client.ts`, `specs/docs/DEPLOY.md`, `docker-compose.yml`.
- **Traceability:** `AUDIT_SECURITY_PRIVACY.md` (§3.1).
- **Description:** Configure production database connections to use the `tokophi_app` unprivileged role (`NOSUPERUSER`) with mandatory PostgreSQL Row-Level Security (RLS) enforcement.
- **Done when:**
  1. `packages/db/src/client.ts` uses `tokophi_app` credentials in non-development environments.
  2. `packages/db/src/verify-rls.ts` passes against the restricted role.
  3. Documentation in `specs/docs/DEPLOY.md` explicitly documents role creation and privilege grants.

---

## Phase 2: High-Volume Reliability & Data Integrity

### Task 5: Admin & Super-Admin Query Paginator Standardization (P1)
- **Target Files:** `apps/admin/lib/data/*`, `apps/super-admin/lib/data/*`.
- **Traceability:** `AUDIT_TYPE_A11Y_PERFORMANCE.md` (§2.4).
- **Description:** Refactor all unbounded table queries (`getOrders`, `getProducts`, `getCustomers`, `getStores`, `getActivity`) to use explicit `.limit()` and `.offset()` parameters.
- **Done when:**
  1. Every list data helper accepts `{ limit?: number, offset?: number }` parameters with default limit = 50.
  2. UI table components display pagination controls (`<Previous />`, `<Next />`, page indicators).
  3. Source check confirms no unbounded `.select().from(...)` remains in `apps/admin/lib/data` or `apps/super-admin/lib/data`.

### Task 6: Drizzle Schema Index Mirroring (0083/0085 Parity) (P1)
- **Target Files:** `packages/db/src/schema.ts`.
- **Traceability:** `AUDIT_TYPE_A11Y_PERFORMANCE.md` (§2.4).
- **Description:** Update Drizzle schema definitions in `packages/db/src/schema.ts` to include indexes added via raw SQL in migrations `0083` and `0085` (`orders_store_placed_idx`, `payments_trx_idx`, `order_line_items_order_idx`).
- **Done when:**
  1. `packages/db/src/schema.ts` explicitly declares index definitions for `orders`, `payments`, and `orderLineItems`.
  2. `npx drizzle-kit check` (or schema diff check) shows zero schema-to-migration drift.

### Task 7: Tracking Poller Partitioning & Timeout Signals (P1)
- **Target Files:** `apps/admin/app/api/cron/tracking/route.ts`, `packages/lib/src/kiriminaja.ts`.
- **Traceability:** `AUDIT_TRACKING_SHIPPING.md` (`TS-02`, `TS-06`).
- **Description:** Add `AbortSignal` timeouts (8s) to KiriminAja HTTP fetch calls and partition the 100-item shipping tracking sweep across stores to ensure tenant fairness and prevent queue starvation.
- **Done when:**
  1. `kiriminaja.ts` fetch wrapper accepts `AbortSignal.timeout(8000)`.
  2. `cron/tracking/route.ts` selects orders using round-robin per `store_id` (max 5 orders per store per tick).
  3. Orders returning permanent 4xx error codes from 3PL API are flagged `problem` and moved out of the active polling queue.

### Task 8: Google Ads Conversion Signal Engine Pipeline (P1)
- **Target Files:** `apps/storefront/src/components/MarketingPixels.astro`, `apps/admin/lib/capi.ts`, `apps/admin/lib/tracking-events.ts`.
- **Traceability:** `AUDIT_TRACKING_SHIPPING.md` (`TS-04`, `TS-10`).
- **Description:** Wire prepaid purchase conversion events to Google Ads signal engines (both browser `gtag` and server-side GA4 Measurement Protocol / sGTM) and preserve `gclid`/`gbraid` attribution keys.
- **Done when:**
  1. `MarketingPixels.astro` fires Google Ads `purchase` event for both COD and prepaid orders.
  2. `lib/capi.ts` or `lib/tracking-events.ts` includes Google Ads server-side purchase event dispatcher.
  3. `gclid` and `gbraid` URL query parameters are persisted in checkout session cookies and attached to order conversion payloads.

---

## Phase 3: UI/UX, Theme Engine & Accessibility Perfection

### Task 9: Storefront Browser-Driven Regression Suite CI Integration (P1)
- **Target Files:** `.github/workflows/ci.yml`, `apps/storefront/package.json`.
- **Traceability:** `AUDIT_TYPE_A11Y_PERFORMANCE.md` (§1).
- **Description:** Add `npm run verify -w @tokophi/storefront` (which runs `check-image-widths`, `check-hero-srcset`, `check-pdp-srcset`, `check-search-srcset`, `check-pixel-defer`, `check-h1-floor`) to GitHub Actions CI workflow.
- **Done when:**
  1. `.github/workflows/ci.yml` includes the step `npm run verify -w @tokophi/storefront`.
  2. CI run passes cleanly across all 6 storefront performance and responsive checks.

### Task 10: Dynamic Theme CSS Variable Injector Standardization (P2)
- **Target Files:** `apps/storefront/src/layouts/Layout.astro`, `apps/admin/app/(admin)/tema/theme-editor-client.tsx`.
- **Traceability:** `TOKOPHI_PERFECTION_ROADMAP.md` (§2.2).
- **Description:** Standardize dynamic theme token injection via `<style id="tokophi-tenant-theme">` in storefront `Layout.astro` and mirror changes live in the admin theme editor preview iframe.
- **Done when:**
  1. Storefront renders design tokens (`--color-primary`, `--color-accent`, `--radius-btn`) from store settings in layout head.
  2. Admin theme editor updates dynamic CSS variables in real time without iframe page reloads.

### Task 11: Accessible Form Error Announcers & ARIA Attributes (P2)
- **Target Files:** `packages/ui/src/components/ui/input.tsx`, `apps/storefront/src/components/OrderFunnel.astro`.
- **Traceability:** `AUDIT_TYPE_A11Y_PERFORMANCE.md` (§2.3).
- **Description:** Add `aria-invalid`, `aria-describedby`, and `aria-live="polite"` error announcement containers to form inputs across `@tokophi/ui` and storefront components.
- **Done when:**
  1. Form inputs set `aria-invalid="true"` when validation fails.
  2. Live error messages render inside `<div aria-live="polite">` so screen readers announce form errors immediately.

### Task 12: Landing Hydration Optimization (client:idle) (P2)
- **Target Files:** `apps/landing/src/components/SiteHeader.astro`.
- **Traceability:** `AUDIT_TYPE_A11Y_PERFORMANCE.md` (§2.2).
- **Description:** Change `MobileNav.tsx` hydration directive in `SiteHeader.astro` from `client:load` to `client:idle` to eliminate unnecessary React hydration on initial page paint.
- **Done when:**
  1. `SiteHeader.astro` renders `<MobileNav client:idle />`.
  2. `npm run check:landing` and `npm run build` pass cleanly.

---

## Phase 4: Documentation & OpenAPI Contract Governance

### Task 13: OpenAPI 3.1 Specification Corpus Generation (P0/P1)
- **Target Files:** `specs/openapi/storefront-api.yaml`, `specs/openapi/admin-api.yaml`.
- **Traceability:** `AUDIT_DOCUMENTATION.md` (§1.2).
- **Description:** Generate comprehensive OpenAPI 3.1 YAML contracts for all 21+ implemented HTTP endpoints (`/api/public/order`, `/api/public/promo`, `/api/public/ongkir`, `/api/public/pay/callback`, `/api/admin/labels`, etc.).
- **Done when:**
  1. `specs/openapi/storefront-api.yaml` and `admin-api.yaml` exist and parse cleanly under OpenAPI 3.1 schema validators.
  2. All request body attributes, response payloads, error codes, and authentication requirements are documented.

### Task 14: PRD & ADR Index Documentation Alignment (P1/P2)
- **Target Files:** `specs/PRD.md`, `specs/README.md`.
- **Traceability:** `AUDIT_DOCUMENTATION.md` (§1.2).
- **Description:** Update `specs/PRD.md` to document automated courier delivery settlement and update `specs/README.md` to reference active ADR 0015.
- **Done when:**
  1. `specs/PRD.md` accurately describes `ka-tracking.ts` delivery-to-selesai automated status and ledger settlement flow.
  2. `specs/README.md` lists ADR 0015 as active and ADR 0014 as superseded.

---

## Execution & Verification Status (Refreshed 2026-08-15 12:15 UTC)

+ **Status:** **ALL 14 TASKS VERIFIED & GREEN**
+ **Test Suite Results:**
  + `TEST_DATABASE_URL=... npm test`: **90 Passed**, 0 Failed (722 individual tests passed, 100%).
  + `npx vitest run packages/lib/src/secret.test.ts`: **1 Passed**, 0 Failed (4 tests passed, 100%).
  + `npm run check:storefront`: **0 Errors** (119 files).
  + `npm run check:landing`: **0 Errors** (29 files).
  + `npm run build:admin`: **Compiled successfully**, static pages generated.
  + `npm run build:super`: **Compiled successfully**, static pages generated.
  + `docker compose -f docker-compose.coolify.yml config -q`: **Validated Cleanly**.
