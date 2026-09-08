# Architecture — tokophi

Updated: 2026-09-08
Expected stack: Existing repository — npm-workspaces monorepo: Next.js (admin, super-admin) + Astro SSR (storefront) + static Astro (landing) over PostgreSQL 16 / Drizzle

> **This is the RECORD of what is built, not the design.** It is a one-screen index; every section
> points at the document that owns the detail. Design and rationale: `specs/docs/ARCHITECTURE.md`,
> `specs/PRD.md`, `specs/decisions/`. Every count below was read off disk on 2026-09-08 (the
> command is named beside it); re-derive, never copy.

## Selected capabilities

| Capability | Decision | Proven operational |
|---|---|---|
| Database | PostgreSQL 16 + Drizzle (`packages/db`), RLS on store-scoped tables | Yes — `npm run verify-rls -w @tokophi/db` → `RLS verified` (2026-09-08) |
| Authentication | Local email/password (scrypt) → jose JWT in httpOnly `session` cookie; RBAC (`lib/rbac.ts`) + RLS | Yes — live logins on `app.` / `rich.` since 2026-07-13 |
| Deployment target | Self-hosted: Cloudflare → Coolify/Traefik → Docker Compose on one Vultr VPS | Yes — live on `tokophi.com` since 2026-07-13 (`specs/docs/DEPLOY.md`) |

## Current system

**Monorepo (4 surfaces, 2 shared packages + db).** `apps/admin` = the merchant's **Seller** panel
(`app.tokophi.com`); `apps/super-admin` = the platform control plane (`rich.tokophi.com`);
`apps/storefront` = one multi-tenant Astro SSR container, tenant resolved from the `Host` header in
`src/middleware.ts` (ADR 0009) → `<slug>.tokophi.id` (canonical) with `<slug>.tokophi.com` redirecting;
`apps/landing` = static apex. Shared: `packages/ui`, `packages/lib` (formatters, billing, fees,
password mint, KiriminAja/AutoLaris clients), `packages/db`. Route-level map of all four surfaces:
**`specs/docs/PAGE_MAP.md`** (generated, `node scripts/gen-page-map.mjs`); concern-level map:
`specs/docs/CODE_MAP.md`, `specs/docs/SYSTEM_MAP.md`.

**Data layer.** `packages/db/src/schema.ts` → **82 `pgTable`s**; `drizzle/meta/_journal.json` →
**106 migrations, `0000_familiar_sugar_man` … `0105_roles_advertiser_cs`**. Money is `bigint` IDR.
Two pools (`packages/db/src/client.ts`): `db` = owner (`DATABASE_URL`), `appDb` = restricted
(`APP_DATABASE_URL`, role proved against `pg_roles` when `DATABASE_RUNTIME_ROLE=app`), and
`withTenant()` / `withCurrentTenant()` (`apps/admin/lib/tenant.ts`) are `appDb`'s only callers — they
set `app.store_id` and `SET LOCAL ROLE tokophi_app` so RLS policies apply. Verifier output today:
`store-scoped tables with RLS: 54/55` (exception `platform_activity`), `11 un-RLS'd child tables, all
reviewed`. Annotated catalog: `specs/docs/SCHEMA.md`. Ledger/balance invariants: AGENTS.md "Order
lifecycle" + `npm run verify-ledger -w @tokophi/db`.

**Identity.** Merchant: `apps/admin/lib/auth.ts` (`SESSION_COOKIE = "session"`, JWT signed with
`AUTH_SECRET`), edge `middleware.ts` checks the cookie, `store_users.role` re-read per request; RBAC
capability matrix `lib/rbac-policy.ts`. Platform: `apps/super-admin/lib/platform-session.ts` — rank
comes from `platform_admins` on every request, never the cookie; `platform-rank.ts` ladder
`support < admin < owner`; per-route floor `lib/route-roles.ts`. Impersonation = one-time exchange via
`impersonation_grants` (migration 0098). Boundaries, rate limits, known gaps: **`specs/docs/SECURITY.md`**.

**Providers (platform-managed, brands hidden from merchants — ADR 0004).** Shipping + COD:
KiriminAja (`packages/lib/src/kiriminaja.ts`; `KIRIMINAJA_ENV` defaults to sandbox; quote =
`apps/admin/lib/shipping-quote.ts`; COD decision = `apps/admin/lib/cod.ts`). Payments: AutoLaris
(`packages/lib/src/autolaris.ts`, `pay-callback.ts`); fee schedule enforced at `/api/public/order`
(`payment-fees.ts`). Money map: **`specs/docs/FINANCE.md`**. Flows: `specs/docs/FLOWS.md` §5, §8.

**Deploy topology.** Cloudflare (proxied, Origin CA wildcard) → Coolify/Traefik on Vultr `volumdev`
(45.77.33.112) → `docker-compose.coolify.yml` services: `postgres`, `migrate` (exits 0), `seed`,
`admin`, `super-admin`, `storefront`, `landing`, sidecars `cron`, `cron-tracking`,
`cron-tracking-events`, `cron-order-expiry`, `cron-domains`, `backup` (6-hourly `pg_dump`, keep 14 d),
`backup-offsite` (rclone → R2, inert + unhealthy until credentialed). Runbook + every gotcha:
**`specs/docs/DEPLOY.md`**; availability/DR: `specs/docs/SLA-DRP.md`.

## Boundaries

- Tenant boundary = `app.store_id` GUC under `tokophi_app` (RLS) **plus** an explicit `storeId`
  WHERE on every table without `store_id` (AGENTS.md "child-table rule"). Owner-pool exceptions,
  deliberately: auth's pre-session read, `apps/admin/app/api/public/**`, cron, provisioning,
  super-admin, storefront.
- Public write surface = the four `api/public/*` routes (`ongkir`, `order`, `promo`, `pay/callback`),
  body-capped by `readPublicBody()`; tenant is `storeSlug` in the body by design (see AGENTS.md).
- Secrets never in URLs: cron routes take `x-cron-secret` (`apps/admin/lib/cron-auth.ts`); the pay
  callback signs `?cb=<reff>.<hmac>`.

## Data

Authoritative store: Postgres on the `tokophi-pgdata` volume. Migrations are the only schema
channel (`npm run migrate -w @tokophi/db`; write them idempotent; `npm run verify-migrations`).
Backups: on-box dumps in `tokophi-backups` (`tokophi-YYYYMMDD-HHMMSS.dump`), offsite copy not yet
credentialed as of the last log entry (BUILD-LOG 2026-09-03). The seed is not a migration — it never
changes an existing store.

## Decisions

Index in `DECISIONS.md`; full ADRs in `specs/decisions/`.

## Verification

`npm test` (vitest incl. real-Postgres money suites + `astro check`) · `npm run verify-rls -w @tokophi/db`
· `npm run verify-ledger -w @tokophi/db` · `npm run verify -w @tokophi/storefront` (six browser checks)
· `node scripts/gen-page-map.mjs --check` · `npm run build:admin` / `build:super` · `npm run lint -w @tokophi/admin`.
