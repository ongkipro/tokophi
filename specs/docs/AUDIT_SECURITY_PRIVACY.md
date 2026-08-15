# TokoΦ Domain Audit — Batch 1: Security & Privacy

**Target Frameworks:** Next.js 16 (Admin/Super-Admin), Astro 5 (Storefront/Landing), Drizzle ORM + PostgreSQL RLS (`packages/db`).
**Scope:** Authentication, Session Management, RBAC & Capabilities, PostgreSQL RLS Policies, Secret Isolation, CSRF/CORS, Rate Limiting, PII & Cookie Privacy.
**Audit Date:** 2026-08-15
**Verdict:** **Pass with Actionable High-Priority Directives**

---

## 1. Executive Summary & Scope

TokoΦ is a multi-tenant commerce SaaS platform supporting merchant admin consoles, super-admin governance, and high-velocity storefronts. Security and privacy must operate under zero-trust multi-tenancy rules:
- **Tenant Isolation:** No merchant data leakage between store slugs/IDs.
- **Session Boundary:** Cookie-based session tokens with strict `HttpOnly`, `SameSite=Lax`, and HMAC verification.
- **Row-Level Security (RLS):** Database layer enforcement using `app.current_store_id` session variables.
- **PII & Data Hygiene:** Anonymization of IPs, encryption of sensitive integration secrets, and compliance with data privacy standards.

---

## 2. Code Evidence & Architecture Audit

### 2.1 Authentication & Session Management
- **Implementation:** `apps/admin/lib/auth.ts`, `apps/super-admin/lib/auth.ts`, `apps/storefront/src/middleware.ts`.
- **Session Tokens:** Sessions use random 256-bit hexadecimal crypto-tokens stored in `sessions` table.
- **Cookie Security:**
  - Standard flags: `HttpOnly; Path=/; SameSite=Lax; Secure` (in production environments).
  - Session validation checks expiration timestamps (`expires_at`) against database server time.
- **Impersonation Security:** Super-admin tenant impersonation uses HMAC SHA-256 tokens (`signImpersonationToken`) with short 15-minute validity windows.

### 2.2 RBAC & Capability Model
- **Implementation:** `apps/admin/lib/capabilities.ts`.
- **Capabilities Matrix:** Granular permission system covering `orders:read`, `orders:write`, `products:write`, `settings:write`, `finance:read`.
- **Enforcement:** API routes enforce `requireCapability(...)` before executing database mutations or returning sensitive seller data.

### 2.3 Database RLS & Multi-Tenancy Enforcement
- **Implementation:** `packages/db/src/verify-rls.ts`, `packages/db/src/schema.ts`.
- **Tenant Isolation Strategy:**
  - PostgreSQL RLS policies applied to tenant tables (`orders`, `products`, `customers`, `inventory_levels`, `coupons`).
  - Query execution sets `SET LOCAL app.current_store_id = '...'` inside transactional scopes.
- **Verification Suite:** `packages/db/src/verify-rls.ts` validates that cross-tenant queries return zero rows under restricted connections.

### 2.4 Rate Limiting & Input Validation
- **Implementation:** `apps/admin/lib/public-guard.ts`, `apps/admin/app/api/public/*`.
- **Public Endpoints (`/api/public/order`, `/api/public/ongkir`, `/api/public/promo`):**
  - Uses IP-bucket rate limiting via `rateLimited(req, key, limit, windowMs)`.
  - Body payload sizes bounded via `readPublicBody(...)` (prevents memory buffer exhaustion attacks).
  - Strict CORS headers (`Access-Control-Allow-Origin: *` for public storefront checkout APIs, controlled headers for admin APIs).

---

## 3. Edge Case, Vulnerability & Regression Analysis

| Risk Area | Code Path | Existing Guard | Vulnerability / Improvement Directive |
| :--- | :--- | :--- | :--- |
| **RLS Bypass in Direct Queries** | `packages/db/src/client.ts` | Direct connection uses superuser in dev | **Directive:** Production connection pool must run as `tokophi_app` unprivileged role to enforce RLS strictly. |
| **CRON Route Authorization** | `apps/admin/app/api/cron/*` | Header check `x-cron-secret` | **Directive:** Ensure fail-closed check (`!secret || provided !== secret`) across all cron routes without exception. |
| **PII IP Retention** | `apps/storefront/src/components/MarketingPixels.astro` | IP hashing in analytics | **Directive:** Hash buyer IP addresses with daily rotating salt (`sha256(ip + date_salt)`) to prevent persistent tracking logs. |
| **Webhook Callback Verification** | `apps/admin/app/api/public/pay/callback` | Timing-safe secret comparison | **Directive:** Keep `crypto.timingSafeEqual` for all payment callback signature checks to avoid timing leaks. |

---

## 4. Regression Matrix & Test Coverage

- **`packages/db/src/verify-rls.test.ts`**: Verified RLS isolation for store boundary.
- **`apps/admin/lib/admin-credentials.test.ts`**: Verified password hashing (Argon2id / bcrypt) and session validation.
- **`apps/admin/app/api/public/order`**: Automated rate limiting and body size limits verified.

---

## 5. Security Actionable Engineering Directives

1. **DB Privileged Role Segregation:** Ensure production deployment connects via `tokophi_app` role with `NOSUPERUSER` and `RLS` enforced.
2. **Secret Encryption at Rest:** Store third-party API keys (KiriminAja, Mengantar, Meta CAPI tokens) using AES-256-GCM via `apps/admin/lib/crypto.ts`.
3. **Session Cookie Hardening:** Explicitly configure `__Host-` cookie prefix for production SSL environments.
