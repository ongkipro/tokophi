# ADR 0008 — Per-client topology: one control plane + one multi-tenant admin + storefront-per-client

**Status:** accepted, amended by **ADR 0009** (2026-07-09) · **Date:** 2026-07-03 · Extends ADR 0003 (multi-tenancy) with the concrete "how do we run many clients" model.

> ⚠️ **Amended:** the storefront row below (**1 templated codebase, 1 deploy _per client_**, `STORE_SLUG`-per-deploy) is **superseded**. Storefront is now **1 codebase, 1 deploy, SSR multi-tenant** — resolves the store from the `Host` header/custom domain at request time (also tracked in `PROD_PLAN.md` §5). This is required for the self-serve store builder (ADR 0009): a merchant's save must be reflected on the next page load, which a per-client static build can't do without a redeploy. Original text kept for history.

## Context
The product serves many merchants ("clients"). The natural mental model is:

```
Super Admin  ─┬─ Client A: admin + storefront
              ├─ Client B: admin + storefront
              └─ Client C: admin + storefront   …
```

The question: does each client get their **own admin app + own database**, or do they **share** one admin + one database, each scoped by `store_id`? This decides how painful onboarding, updates, and ops are.

## Decision — shared codebases, per-client *storefront deploys*, one database
| Layer | Instances | Tenancy |
|---|---|---|
| **Super Admin** (`apps/super-admin`) | **1 app, 1 deploy** | cross-tenant (platform) — creates/suspends stores, plans, billing |
| **Client Admin** (`apps/admin`) | **1 app, 1 deploy — multi-tenant** | every merchant signs into the **same** admin; the session resolves their `store_id`; RLS scopes everything to their store |
| **Storefront** (`apps/storefront`) | ~~1 templated codebase, 1 deploy _per client_~~ → **1 codebase, 1 deploy, SSR multi-tenant** (ADR 0009) | resolves `store_id` from `Host`/custom domain per-request; reads that store's catalog/pages/**theme (page_templates)** live from the shared DB |
| **Database** | **1 shared PostgreSQL** | every tenant row has `store_id`; **RLS** isolates; super-admin bypasses |

**"Client Admin A / B" is the same admin app, scoped** — not a separate deploy per client. Adding a client does **not** spin up a new admin or a new DB.

### Onboarding a new client = 3 steps (no new admin, no new DB)
1. **super-admin** creates the `account` + `store` (+ owner `user`/`store_users`, plan, default settings/location).
2. Seed starter data / let the merchant fill it in via their (scoped) admin.
3. **Deploy one storefront** with that store's `STORE_SLUG` + custom domain (Cloudflare, "1 client 1 deploy" — matches the petcue/pixsgo pattern).

## Why (this is the "enak ngelola" argument)
- **Patch once, everyone benefits.** One admin codebase/deploy to ship & fix vs *N* per-client admins.
- **One DB to migrate & back up** vs *N*. super-admin's cross-tenant dashboards come for free (single source).
- **Storefronts stay independent where it matters** — public-facing, per-client branding, domain, and deploy cadence — without forking the admin or the data model.
- **Cheap:** free tiers cover the first clients; cost scales with usage, not with a full stack per client.

## Trade-offs & mitigations
- **Shared DB ⇒ RLS correctness is critical** (one policy bug = cross-tenant leak). Mitigate: RLS keyed on `store_id`, **always** scope in the `lib/data` layer too (defence in depth), and test tenant isolation.
- ~~Storefront customization beyond tokens/config = a branch/override per client (storefronts are a service, not a self-serve theme editor — ADR 0003).~~ **Reversed — ADR 0009**: customization is self-serve via the section-based store builder; checkout stays locked/uniform (branding tokens only).
- **Hard isolation** (a client demands a dedicated DB for compliance) → promote just that client to its own database; the escape hatch in ADR 0003 stands.

## Consequences
- The storefront must become **store-parameterized** (`STORE_SLUG` env → load that store by slug). Today it's a single hard-coded shop ("Batik Nusantara"); parameterizing it is the storefront-→-DB task.
- The admin needs a **store switcher + membership check** (`store_users`) once Auth lands; until then it operates on a single seeded store.
- super-admin is the **only** surface that reads across `store_id` (already true, now DB-backed).

## Current status (MVP)
**Seeded single-tenant** — one real store (**Batik Nusantara**) across super-admin + admin + storefront. The topology above is the **target**; we prove the full vertical slice on one store first, then replicate (add more `store` rows + storefront deploys) with no new admin/DB. super-admin metrics are computed honestly for one store (no fabricated cross-store figures).
