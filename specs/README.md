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
| Active remediation queue and release gate | Repository-root [`TASKS.md`](../TASKS.md) — **the one execution queue** |
| Historical epic ledger (evidence only — not a queue) | [`docs/TASKS.md`](docs/TASKS.md) |
| Runtime, seeded-data, and environment status | [`docs/STATUS.md`](docs/STATUS.md) |
| Deployment procedure | [`docs/DEPLOY.md`](docs/DEPLOY.md) |
| Security posture | [`docs/SECURITY.md`](docs/SECURITY.md) |
| Documentation applicability and validation boundary | [`docs/DEVELOPMENT_READINESS.md`](docs/DEVELOPMENT_READINESS.md) |

## Development-kit map — where each specification concern lives here

`development-kit` (dotfiles) routes work through one canonical artifact per concern and forbids a
rival document beside an existing one; `development-spec-suite` names the artifact set for a
`platform + multi-tenant + identity` product, which this is. TokoΦ predates the suite, so **no
`docs/spec/` pack exists and none should be created** — the table maps each suite concern to the
document that already owns it. An omitted concern is marked `Not applicable` with its reason and the
gate that would activate it, as the suite requires.

| Suite concern (reference artifact) | Owner here | Note |
|---|---|---|
| Business outcomes (`01-BRD`) | **Not applicable** — single owner-operator; no external sponsor. Activates if a commercial/regulatory commitment is signed (owner review) | pricing card: [`docs/PRICING.md`](docs/PRICING.md) |
| Product behavior + NFRs (`02-PRD`) | [`PRD.md`](PRD.md) (v0.5, verified against code) → requirement IDs in [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) | root `PRD.md` is the entrypoint |
| Technical design (`03`) | [`docs/CODE_MAP.md`](docs/CODE_MAP.md) · [`docs/SYSTEM_GUIDE.md`](docs/SYSTEM_GUIDE.md) · the long section notes in `AGENTS.md` | per-concern, not one document |
| System architecture (`04`) | design: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (dated 2026-07, see its header) · **record: root [`ARCHITECTURE.md`](../ARCHITECTURE.md)** · edges: [`docs/SYSTEM_MAP.md`](docs/SYSTEM_MAP.md) | the record wins on what the code does |
| Data model (`05`) | [`docs/SCHEMA.md`](docs/SCHEMA.md) (catalog of record) · [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) (entities) · [`docs/UML.md`](docs/UML.md) | `postgres-drizzle` owner |
| Tenant isolation (`06`) | [`docs/SECURITY.md`](docs/SECURITY.md) §tenant + `AGENTS.md` "Database" (two pools, child-table rule) · verifier `npm run verify-rls -w @tokophi/db` | |
| IAM / RBAC (`07`) | [`docs/SECURITY.md`](docs/SECURITY.md) §identity · `apps/admin/lib/rbac-policy.ts` · `apps/super-admin/lib/platform-rank.ts` + `route-roles.ts` | |
| Domain routing (`08`) | [`docs/CUSTOM_DOMAIN.md`](docs/CUSTOM_DOMAIN.md) · ADR 0009 | Cloudflare for SaaS |
| API specification (`09`) | [`openapi/storefront-api.yaml`](openapi/storefront-api.yaml) · [`openapi/admin-api.yaml`](openapi/admin-api.yaml) · [`openapi/headless.yaml`](openapi/headless.yaml) | `openapi-spec` owner; coverage guard in `verify:guards` |
| Design system / white-label (`10`) | [`docs/PATTERN_UIUX.md`](docs/PATTERN_UIUX.md) · [`docs/IMPROVEMENT_UIUX.md`](docs/IMPROVEMENT_UIUX.md) · tokens in `packages/ui/styles.css` · brand boundary ADR 0004 + `@tokophi/lib/provider-label` | `admin-dashboard` / `design-taste` owners |
| Billing & payments (`11`) | **[`docs/FINANCE.md`](docs/FINANCE.md)** (the one money map) · [`docs/PRICING.md`](docs/PRICING.md) · provider contract via skill `autolaris-h2h` | `DEC-001/005/010/011/012` |
| Shipping, courier, COD (`17` + fulfilment owner) | `AGENTS.md` "Shipping & COD" · [`docs/KIRIMINAJA.md`](docs/KIRIMINAJA.md) (vendor contract as measured) · [`docs/FLOWS.md`](docs/FLOWS.md) §5 | |
| Security architecture (`12`) | [`docs/SECURITY.md`](docs/SECURITY.md) · audits under `docs/AUDIT_*.md` | `application-security` owner |
| Privacy & compliance (`13`) | [`docs/PRIVACY-COMPLIANCE.md`](docs/PRIVACY-COMPLIANCE.md) — **stub**; activates with Task 5.8 (buyer accounts, owner decision) | `Unknown` until written — not `Not applicable` |
| SLA / DRP (`14`) | [`docs/SLA-DRP.md`](docs/SLA-DRP.md) | offsite backup still uncredentialed (Task 8.4) |
| CI/CD & migrations (`15`) | [`docs/DEPLOY.md`](docs/DEPLOY.md) · `.github/workflows/` · `npm run verify-migrations -w @tokophi/db` · ADR 0017 | migrations are hand-written |
| Observability & rate limits (`16`) | root [`OBSERVABILITY.md`](../OBSERVABILITY.md) (probes) · [`docs/SECURITY.md`](docs/SECURITY.md) (every rate limit with its value) · cron liveness on Super Admin → Analitik → Sistem | |
| UX flows & screen contracts (`17`) | [`docs/FLOWS.md`](docs/FLOWS.md) · [`docs/UI_INVENTORY.md`](docs/UI_INVENTORY.md) · generated [`docs/PAGE_MAP.md`](docs/PAGE_MAP.md) · storefront checkout rules in `AGENTS.md` "Checkout input" | `admin-product-ux` / `storefront-ux` owners |
| Market applicability (Indonesia) | `AGENTS.md` (phone/name/address normalisation, COD provinces, PPN toggle) · [`docs/FINANCE.md`](docs/FINANCE.md) | current-source required for tax/legal |
| Pack applicability (`CONTEXT-RECORD`) | this table | no `CONTEXT-RECORD.md` — no pack |
| Execution trace | root [`TASKS.md`](../TASKS.md) ↔ [`../BUILD-LOG.md`](../BUILD-LOG.md), traceability guard `scripts/verify-traceability.mjs` | |

Supporting domain references:

- [`docs/PAGE_MAP.md`](docs/PAGE_MAP.md) is the **generated** page-level index of all four surfaces — every URL → file, data/action modules, gate, tests (`node scripts/gen-page-map.mjs`; `test/page-map-fresh.test.ts` fails when stale). Start here to find a screen.
- [`docs/SYSTEM_MAP.md`](docs/SYSTEM_MAP.md) explains the surfaces, the tenant boundary and the cross-surface edges (dated; see its header for what is stale).
- [`docs/FLOWS.md`](docs/FLOWS.md) and [`docs/UML.md`](docs/UML.md) describe critical flows and state machines.
- [`docs/SCHEMA.md`](docs/SCHEMA.md) is a dated schema snapshot; query the target database before relying on counts.
- [`docs/PRIVACY-COMPLIANCE.md`](docs/PRIVACY-COMPLIANCE.md) is a **stub** (NOT WRITTEN on `main` — Task 5.8 owner decision; a draft sits on the unmerged `feature/buyer-account-local`). Today's data-handling rules are in `docs/SECURITY.md`.
- [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md) is a **pointer stub**: the probe contract is repository-root [`OBSERVABILITY.md`](../OBSERVABILITY.md); SLI/SLO, RTO/RPO and the recovery runbook are in [`docs/SLA-DRP.md`](docs/SLA-DRP.md).
- [`openapi/storefront-api.yaml`](openapi/storefront-api.yaml) and [`openapi/admin-api.yaml`](openapi/admin-api.yaml) describe observed HTTP boundaries.
- [`docs/HEADLESS_STOREFRONT_SPEC.md`](docs/HEADLESS_STOREFRONT_SPEC.md), [`openapi/headless.yaml`](openapi/headless.yaml), [`docs/TOKOPHI_ACCOUNT_SPEC.md`](docs/TOKOPHI_ACCOUNT_SPEC.md), and [`openapi/account.yaml`](openapi/account.yaml) are **stubs marked NOT WRITTEN — Task 5.8 owner decision**. They are not deployed behavior and not accepted contracts; each stub says where its draft (if any) lives. `npm run verify:doc-authority` keeps these links resolving; `npm run verify:openapi` skips the two YAML stubs by their `x-tokophi-status`.

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
| [0016](decisions/0016-global-buyer-account.md) | **NOT WRITTEN — stub** (Task 5.8 owner decision). Draft "Global buyer identity with isolated per-store customer projections" on unmerged `feature/buyer-account-local`; nothing accepted, runtime not deployed |

---

## Current baseline (verified 2026-08-16)

`origin/main` is the collaboration baseline. The latest executable repository verification reported
**90/90 Vitest files and 722/722 tests passing**, successful storefront and landing Astro checks, and
successful admin/super-admin TypeScript checks. The migration journal contains **95 entries** through
`0094_magical_salo`; the latest measured database/RLS snapshot reports **78 public tables** and RLS on
**51 of 52** store-scoped tables. These observations are dated evidence, not constants: re-run the
relevant check and query the target catalog whenever a change depends on them.

Current remediation work and its release gate are maintained only in repository-root [`TASKS.md`](../TASKS.md); supporting evidence belongs in [`docs/AUDIT-SUMMARY.md`](docs/AUDIT-SUMMARY.md).
