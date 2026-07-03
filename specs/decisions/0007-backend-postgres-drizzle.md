# ADR 0007 — Backend persistence: local Postgres + Drizzle (dev) → self-hosted Postgres + PostgREST on VPS (prod)

**Status:** accepted · **Date:** 2026-07-03 · Supersedes the "backend = one Supabase, deferred" framing in ADR 0001/0003 for the *dev* stack.

## Context
Phase 1 shipped the three surfaces on deterministic mock data (ADR 0001). It's time to put a real database behind the data layer. `SCHEMA.md` already targets Postgres-with-RLS (portable, no managed-vendor lock-in). We want to develop the backend **locally, cheaply, and offline**, while keeping a clean path to the self-hosted VPS target.

## Decision
- **Dev database = plain PostgreSQL 16 in Docker** (`docker-compose.yml`, host port `5433`, persisted volume). No cloud dependency to build backend logic.
- **ORM/query + migrations = Drizzle** (`drizzle-orm` + `drizzle-kit`, `postgres.js` driver) in a new shared package **`@indostore/db`** (`packages/db`): `src/schema.ts` (the whole model), `src/client.ts` (`db` singleton), `src/seed.ts`, `src/reset.ts`, versioned migrations in `drizzle/`.
- **Auth (JWT) is done locally**; **Storage = self-hosted** (VPS / MinIO / S3-compatible), activated at deploy. **RLS is written + enabled locally** (migration `0012`, 2026-07-04): `tenant_isolation` policies keyed on a GUC (`app.store_id`, set per-txn — no Supabase `auth.*` dependency), enforced under the non-owner `indostore_app` role via `withTenant()`. The app connects as the owner locally (RLS bypassed) so reads/writes are unaffected until the VPS switches roles. **RBAC** (`lib/rbac.ts` capability matrix) gates every mutation now; app-layer `store_id` scoping (from the session) remains the belt-and-suspenders alongside RLS.
- **Prod target = self-hosted PostgreSQL + PostgREST on a VPS** (NOT Supabase — no managed-vendor dependency). PostgREST auto-exposes a REST API over the schema; RLS enforces `store_id` isolation; JWT carries the auth claims. Drizzle migrations apply unchanged; `migrate` carries the same schema up. Money stays **integer rupiah** (`bigint`, `*_idr`).
- **casing = snake_case**: camelCase in TS ↔ snake_case columns, so the schema reads like `SCHEMA.md`.

## Consequences
- `import { db, schema } from "@indostore/db"` is **server-only** (`postgres` is in each app's `serverExternalPackages`; DB pages are `dynamic = "force-dynamic"`).
- Each Next app needs `DATABASE_URL` in `.env.local`; tooling reads the root `.env` (`dotenv -e ../../.env`).
- Two schemas hold state in Postgres: `public` (data) + `drizzle` (migration journal) — a full reset must drop **both** (`npm run reset -w @indostore/db`).
- The move to the VPS adds self-hosted Auth/Storage + enables RLS and points `DATABASE_URL` at the VPS Postgres — **no schema rework**. If a client ever needs hard isolation, the DB-per-tenant escape hatch from ADR 0003 still applies.

## Status of the wiring
- **super-admin → DB: done** (all 5 pages live on Postgres via `apps/super-admin/lib/data.ts`).
- **admin → DB: next** (seed the demo store's catalog, then swap `apps/admin/lib/data/*` bodies).
- **storefront → DB: after admin** (read catalog/pages by `store_id`/slug).
