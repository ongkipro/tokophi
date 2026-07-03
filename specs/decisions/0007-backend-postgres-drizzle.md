# ADR 0007 — Backend persistence: local Postgres + Drizzle (dev) → Supabase (prod)

**Status:** accepted · **Date:** 2026-07-03 · Supersedes the "backend = one Supabase, deferred" framing in ADR 0001/0003 for the *dev* stack.

## Context
Phase 1 shipped the three surfaces on deterministic mock data (ADR 0001). It's time to put a real database behind the data layer. `SCHEMA.md` already targets Postgres-with-RLS (Supabase-flavoured). We want to develop the backend **locally, cheaply, and offline**, while keeping a clean path to the managed target.

## Decision
- **Dev database = plain PostgreSQL 16 in Docker** (`docker-compose.yml`, host port `5433`, persisted volume). No cloud dependency to build backend logic.
- **ORM/query + migrations = Drizzle** (`drizzle-orm` + `drizzle-kit`, `postgres.js` driver) in a new shared package **`@indostore/db`** (`packages/db`): `src/schema.ts` (the whole model), `src/client.ts` (`db` singleton), `src/seed.ts`, `src/reset.ts`, versioned migrations in `drizzle/`.
- **Auth + Storage = `supabase-js`**, activated only when a Supabase project is connected. Until then, **tenancy is enforced in the app/data layer** (`store_id` scoping in every query), and **RLS policies are written but not enabled locally** (a plain-Postgres box has no `auth.*` JWT to evaluate them, and RLS-on with no policy would block all reads).
- **Prod target stays Supabase** (managed Postgres + Auth + Storage). Drizzle migrations apply unchanged; `db push`/`migrate` carry the same schema up. Money stays **integer rupiah** (`bigint`, `*_idr`).
- **casing = snake_case**: camelCase in TS ↔ snake_case columns, so the schema reads like `SCHEMA.md`.

## Consequences
- `import { db, schema } from "@indostore/db"` is **server-only** (`postgres` is in each app's `serverExternalPackages`; DB pages are `dynamic = "force-dynamic"`).
- Each Next app needs `DATABASE_URL` in `.env.local`; tooling reads the root `.env` (`dotenv -e ../../.env`).
- Two schemas hold state in Postgres: `public` (data) + `drizzle` (migration journal) — a full reset must drop **both** (`npm run reset -w @indostore/db`).
- The move to Supabase adds Auth/Storage/RLS and a hosted URL — **no schema rework**. If a client ever needs hard isolation, the DB-per-tenant escape hatch from ADR 0003 still applies.

## Status of the wiring
- **super-admin → DB: done** (all 5 pages live on Postgres via `apps/super-admin/lib/data.ts`).
- **admin → DB: next** (seed the demo store's catalog, then swap `apps/admin/lib/data/*` bodies).
- **storefront → DB: after admin** (read catalog/pages by `store_id`/slug).
