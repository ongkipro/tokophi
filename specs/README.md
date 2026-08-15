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

Start with the current queue, then verify every claim against code and the target database. The older
status/schema documents are useful historical evidence, but their frozen counts are not a current
runtime contract.

| Doc | What it answers |
|---|---|
| **[docs/tasks/OPEN.md](docs/tasks/OPEN.md)** | **Current session entrypoint:** owner decisions, ready work, external blockers, and runnable gates. If it disagrees with another task document, verify the code and fix the stale document |
| **[PRD.md](PRD.md)** | What the product is, the money model, the COD policy, the four surfaces. Aspirational items are labelled aspirational |
| **[docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)** | What must be **true** — functional + non-functional requirements as **verifiable statements**, each with the query or grep that checks it. Includes the security invariants learned the hard way |
| **[docs/STATUS.md](docs/STATUS.md)** | 🟢 REAL / 🟡 SEEDED-BUT-COMPUTED / 🔴 FAKE. Historical evidence; re-check dated claims before using them |
| **[docs/SYSTEM_MAP.md](docs/SYSTEM_MAP.md)** | Every route → its data layer → its tables, per surface. Where the RLS boundary actually sits |
| **[docs/FLOWS.md](docs/FLOWS.md)** | The six critical flows as sequence diagrams: checkout + COD gate, payment callback, order lifecycle, money, shipping, auth/RLS |
| **[docs/UML.md](docs/UML.md)** | ER/class diagram, order + ledger state machines, component and deployment diagrams. **Every diagram is validated with mermaid-cli** |
| **[docs/SCHEMA.md](docs/SCHEMA.md)** | Annotated schema snapshot generated from `information_schema` / `pg_class`; its 2026-07-14 counts are historical, so query the target catalog before relying on them |
| **[docs/BACKLOG.md](docs/BACKLOG.md)** | Long-form priority history. Use `docs/tasks/OPEN.md`, not its old “next up” section, to choose current work |

**Supporting:** [ARCHITECTURE](docs/ARCHITECTURE.md) · [CONCEPT](docs/CONCEPT.md) ·
[CHAT_SPEC](docs/CHAT_SPEC.md) · [DEPLOY](docs/DEPLOY.md) · [CODE_MAP](docs/CODE_MAP.md) ·
[UI_INVENTORY](docs/UI_INVENTORY.md) · [WORKLOG](docs/WORKLOG.md) · [PROD_PLAN](docs/PROD_PLAN.md) ·
[DATA_MODEL](docs/DATA_MODEL.md) · [TASKS](docs/TASKS.md) · **wireframes/**

> ⚠️ **DATA_MODEL.md, TASKS.md, GUIDE.md, SYSTEM_GUIDE.md and CONCEPT.md predate the backend** and
> describe a mock-first product. `STATUS.md`, `SCHEMA.md`, `BACKLOG.md`, and `tasks/NEXT.md` also retain
> dated findings intentionally. **Code and the target database win; `tasks/OPEN.md` is the maintained
> handoff.**

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

---

## Current baseline (verified 2026-08-05)

`origin/main` is the collaboration baseline. The production catalog reports **77 public tables**, **51
with RLS**, and **90 applied migrations**; the repository journal also contains 90 entries and ends at
`0089_platform_password_revokes_sessions`. The repository contains **55 test files**. These are
observations, not constants: re-run the catalog query and `npm test` when a change depends on them.

The unresolved work and its evidence are maintained in **[docs/tasks/OPEN.md](docs/tasks/OPEN.md)**.
