# TokoΦ — Audit Remediation & System Perfection Tasks

> Traceable task backlog for resolving audit findings from Claude, Codex, and OMP.
> Each task traces to a verified finding, names exact files, and carries a runnable "Done when" check.

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
