# TokoΦ — Specs & Docs

**Shopify-style commerce SaaS for Indonesia.** Bahasa Indonesia UI, IDR, tuned to how Indonesian
sellers actually work: WhatsApp, COD, local couriers, QRIS/e-wallets.

**Four surfaces**, one Postgres. The platform collects the money and pays the merchant out — which
makes us a custodian, and makes the ledger the most consequential thing in the codebase.

- **Code:** `~/Projects/tokophi` — monorepo (npm workspaces)
- **Coding conventions & gotchas:** `AGENTS.md` (repo root) — **read it, shadcn here runs on Base UI, not Radix**
- **Changelog:** `CHANGELOG.md`

---

## Read these first

Start from the authority map below. Verify dated claims against code and the target environment.

| Concern | Canonical owner |
|---|---|
| Product scope and non-goals | Repository-root [`PRD.md`](../PRD.md) |
| Implemented architecture | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Accepted architectural decisions | [`decisions/`](decisions/) |
| Verifiable behavior and requirement status | [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) |
| Current audit evidence and release blockers | [`docs/AUDIT-SUMMARY.md`](docs/AUDIT-SUMMARY.md) |
| Active remediation queue and release gate | Repository-root [`TASKS.md`](../TASKS.md) |
| Runtime, seeded-data, and environment status | [`docs/STATUS.md`](docs/STATUS.md) |
| Deployment procedure | [`docs/DEPLOY.md`](docs/DEPLOY.md) |
| Security posture | [`docs/SECURITY.md`](docs/SECURITY.md) |
| Documentation applicability and validation boundary | [`docs/DEVELOPMENT_READINESS.md`](docs/DEVELOPMENT_READINESS.md) |

Supporting domain references:

- [`docs/SYSTEM_MAP.md`](docs/SYSTEM_MAP.md) maps routes, data layers, and tables.
- [`docs/FLOWS.md`](docs/FLOWS.md) and [`docs/UML.md`](docs/UML.md) describe critical flows and state machines.
- [`docs/SCHEMA.md`](docs/SCHEMA.md) is a dated schema snapshot; query the target database before relying on counts.
- [`docs/PRIVACY-COMPLIANCE.md`](docs/PRIVACY-COMPLIANCE.md) records engineering applicability, open policy owners, and legal-review gates.
- [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md) records current signals, blind spots, proposed SLIs, and runbooks.
- [`openapi/storefront-api.yaml`](openapi/storefront-api.yaml) and [`openapi/admin-api.yaml`](openapi/admin-api.yaml) describe observed HTTP boundaries.
- [`docs/HEADLESS_STOREFRONT_SPEC.md`](docs/HEADLESS_STOREFRONT_SPEC.md), [`openapi/headless.yaml`](openapi/headless.yaml), [`docs/TOKOPHI_ACCOUNT_SPEC.md`](docs/TOKOPHI_ACCOUNT_SPEC.md), and [`openapi/account.yaml`](openapi/account.yaml) are proposed contracts; they are not deployed behavior.

Historical audits, `docs/BACKLOG.md`, `docs/WORKLOG.md`, `docs/TASKS.md`, and `docs/tasks/NEXT.md` remain evidence only. [`docs/tasks/OPEN.md`](docs/tasks/OPEN.md) is a concise navigation handoff; it does not own work beside root `TASKS.md`.

---

## The four surfaces

| Surface | App | Who | Tech | Dev port | Prod host |
|---|---|---|---|---|---|
| **admin** | `apps/admin` | merchant operators | Next.js (RSC + server actions) | :3000 | `app.tokophi.com` |
| **super-admin** | `apps/super-admin` | the platform (us) | Next.js | :3001 | `rich.tokophi.com` |
| **storefront** | `apps/storefront` | shoppers | Astro **SSR** | :4327 | `<slug>.tokophi.com` |
| **landing** | `apps/landing` | the world | Astro **static** | :4328 | `tokophi.com` |

**The admin hosts the entire public HTTP API** (`/api/public/*`, `/api/cron/*`, `/api/uploads/*`) and the
media store. **The landing page has no database dependency, on purpose** — the front door must serve when
everything behind it is down. The storefront is **one deploy serving every tenant**, resolved from the
`Host` header (ADR 0009).

Demo storefront = **"Batik Nusantara"** (women's fashion, 14 products × 5 AI images).

## Monorepo layout

```
tokophi/
  apps/
    admin/         # merchant admin (:3000) + ALL public API routes
    super-admin/   # platform control plane (:3001)
    storefront/    # Astro SSR, multi-tenant by Host (:4327)
    landing/       # Astro static, apex (:4328) — no DB
  packages/
    db/            # @tokophi/db       — Drizzle schema + withTenant() (the RLS boundary)
    lib/           # @tokophi/lib      — format, billing, autolaris, kiriminaja, cache
    ui/            # @tokophi/ui       — shadcn on Base UI + design tokens
    sections/      # @tokophi/sections — TYPES ONLY: the Store Builder contract
    data/          # @tokophi/data     — canonical nav
```

`@tokophi/sections` is what stops the admin's Puck editor and the storefront's Astro renderer from
drifting: a section added on one side and not the other is a **type error**, not a blank slot on a live
shop.

## Quickstart

```bash
npm ci                             # exact lockfile, all workspaces
docker compose up -d db            # PostgreSQL 16 @ localhost:5433
npm run migrate -w @tokophi/db     # apply migrations
npm run seed    -w @tokophi/db     # seeds only an empty DB; SEED_FORCE=1 is destructive

npm run dev:admin                  # → http://localhost:3000
npm run dev:super                  # → http://localhost:3001
cd apps/storefront && npm run dev  # → http://localhost:4327
```

The seed mints a random password per account and prints each credential once at the end. For local-only
repeatable access, set `SEED_OWNER_PASSWORD` to a private value before seeding; never set it on an
internet-facing environment and never commit it.

The seed creates per-service shipping rows, including both seeded SPX services, so local COD flows are
exercisable without a live courier sync. Use Super Admin → Pengaturan → “Sync dari KiriminAja” only
when the task depends on the provider's current roster.

## Key conventions

- **shadcn/ui runs on Base UI (`@base-ui/react`), NOT Radix.** Triggers use the **`render` prop, not
  `asChild`**; there is **no `Select`** primitive; a `Button` rendered as a link needs
  `nativeButton={false}`. This is the #1 source of mistakes. See `AGENTS.md`.
- **The tenant boundary is RLS, not a hand-written `WHERE`.** Admin reads wrap in `withCurrentTenant`,
  writes in `withTenant`. A bare module-level `db` in admin tenant code runs as **owner** and silently
  bypasses every policy.
- **Money is `bigint` whole rupiah** (`_idr` suffix), formatted via `@tokophi/lib`. Never a float.
- **Payments and shipping are platform-managed** (ADR 0004) — the merchant enables *methods* and picks
  *couriers*; credentials, tariffs and resi are ours. **Provider brands are never shown** to merchants or
  shoppers.
- **A number on screen must be traceable to a query.** If we cannot count it, the UI says "Belum
  terhubung" or shows an empty state. This rule exists because we have violated it, repeatedly, and it
  cost real trust.

## ADRs

| # | Decision |
|---|---|
| [0001](decisions/0001-stack-and-mock-first.md) | Stack: Next.js admin + Astro storefront, mock-first |
| [0002](decisions/0002-shadcn-base-ui.md) | shadcn/ui on Base UI |
| [0003](decisions/0003-scope-and-multitenancy.md) | No Themes/Apps + `store_id` RLS multi-tenancy |
| [0004](decisions/0004-platform-managed-payments-shipping.md) | Payments/COD/shipping are platform-managed |
| [0005](decisions/0005-monorepo-shared-packages.md) | Monorepo + shared packages |
| [0006](decisions/0006-shared-nav-source-auto-connect.md) | Shared nav source |
| [0007](decisions/0007-backend-postgres-drizzle.md) | Self-hosted Postgres + Drizzle (**not** Supabase) |
| [0008](decisions/0008-per-client-provisioning-model.md) | Per-client provisioning |
| [0009](decisions/0009-self-serve-store-builder.md) | Self-serve section-based Store Builder + SSR multi-tenant storefront |
| [0011](decisions/0011-product-taxonomy-google-category.md) | Google product taxonomy as the catalog category authority |
| [0012](decisions/0012-meta-commerce-tenant-owned-integration.md) | Tenant-owned Meta Commerce integration |
| [0013](decisions/0013-stable-catalog-product-ids.md) | Stable catalog product IDs |
| [0014](decisions/0014-platform-absorbs-cod-shipping.md) | **Superseded by ADR 0015** — former platform-absorbed COD shipping rule |
| [0015](decisions/0015-net-seller-proceeds-and-shipping-reconciliation.md) | **Accepted** — Net Seller proceeds and shipping reconciliation (supersedes ADR 0014) |
| [0016](decisions/0016-global-buyer-account.md) | **Accepted direction** — Global buyer identity with isolated per-store customer projections; runtime not deployed |

---

## Current baseline (verified 2026-08-16)

`origin/main` is the collaboration baseline. The latest executable repository verification reported
**90/90 Vitest files and 722/722 tests passing**, successful storefront and landing Astro checks, and
successful admin/super-admin TypeScript checks. The migration journal contains **95 entries** through
`0094_magical_salo`; the latest measured database/RLS snapshot reports **78 public tables** and RLS on
**51 of 52** store-scoped tables. These observations are dated evidence, not constants: re-run the
relevant check and query the target catalog whenever a change depends on them.

Current remediation work and its release gate are maintained only in repository-root [`TASKS.md`](../TASKS.md); supporting evidence belongs in [`docs/AUDIT-SUMMARY.md`](docs/AUDIT-SUMMARY.md).
