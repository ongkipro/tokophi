# TokoΦ (Tokophi) v1.0.0

**Shopify-style multi-tenant commerce SaaS built for Indonesia.** One core platform executes high-scale merchant stores: a **Seller** dashboard for shop owners (`apps/admin`), a **Super Admin** control plane for platform operators (`apps/super-admin`), an **Apex Landing** surface (`apps/landing`), and **one multi-tenant Storefront engine (`apps/storefront`) that serves every merchant** — dynamically resolving tenants from the incoming HTTP `Host` header.

Bahasa Indonesia First · IDR Currency Native · Engineered around Indonesian commerce realities: WhatsApp, COD, QRIS, Virtual Accounts (VA), and local 3PL courier aggregations (KiriminAja).

> **Production Platform Status (v1.0.0)**: Live on `tokophi.com` since 2026-07-13. Fully remediated, audited, and verified across 6 domain audit batches (Security & RLS, Payment & Checkout, Order & Stock, Tracking & Logistics, Performance & A11y, Master Engineering Certification).
> **Database Invariants**: 80 PostgreSQL tables, 95 migrations (`0000` through `0094_magical_salo`), 53 store-scoped RLS tables, and 90 Vitest test suites (722 total tests verified green).

**New here? Read [`AGENTS.md`](AGENTS.md) first** — multiple AI agents and collaborators operate on this monorepo. Then review [`specs/docs/SYSTEM_GUIDE.md`](specs/docs/SYSTEM_GUIDE.md) and [`specs/docs/TOKOPHI_MASTER_ENGINEERING_REPORT.md`](specs/docs/TOKOPHI_MASTER_ENGINEERING_REPORT.md) for full system architecture.

---

## 🏛️ The Four Core Surfaces

One deployment per surface. The storefront container is multi-tenant by construction: **it is not per-merchant** — a single Astro SSR container serves every store, resolving `<slug>.tokophi.id` (or custom merchant domains) via request headers.

| Surface | Application | Target User | Technology Stack | Local Port |
|---|---|---|---|---|
| **Seller Dashboard** | `apps/admin` | Merchant / Shop Owner | Next 16 (Turbopack) · shadcn on **Base UI** | `:3000` |
| **Super Admin** | `apps/super-admin` | Platform Operators | Next 16 (Turbopack) · Shared UI | `:3001` |
| **Storefront Engine** | `apps/storefront` | Shoppers & Buyers | Astro 5 SSR · **Multi-tenant by Host** | `:4327` |
| **Apex Landing** | `apps/landing` | Public / Marketing | Astro 5 Static · No Database | `:4328` |

### Monorepo Architecture

```
tokophi/
  apps/
    admin/          @tokophi/admin       — Next.js 16 Seller Dashboard
    super-admin/    @tokophi/super-admin — Next.js 16 Platform Control Plane
    storefront/     @tokophi/storefront  — Astro 5 SSR Multi-tenant Storefront
    landing/        @tokophi/landing     — Astro 5 Static Apex Marketing Site
  packages/
    db/             @tokophi/db          — Drizzle ORM, 95 Migrations, 80 Tables, Seeders
    ui/             @tokophi/ui          — shadcn on Base UI + OMP Design Tokens
    lib/            @tokophi/lib         — IDR Formatters, AutoLaris, KiriminAja, CAPI, Auth
    sections/       @tokophi/sections    — Store Builder Section Registry (Admin + Storefront)
    data/           @tokophi/data        — Navigation & Taxonomy Fallbacks
  specs/            PRD · System Architecture · Audit Reports · ADRs · Tasks & Status
  ops/              Watchdog · Witness Probe (`tokophi-probe.sh`) · Cleanup Scripts
```

Demo Merchant Store: **Batik Nusantara** (Slug: `batiknusantara`, Women's Fashion, 14 products × 5 images, real Warna×Ukuran variants).

---

## ⚡ Quickstart

```bash
# 1. Install all monorepo dependencies
npm install

# 2. Start PostgreSQL 16 container (ports 5433:5432)
docker compose up -d db

# 3. Apply canonical Drizzle migrations (0000 → 0094)
npm run migrate -w @tokophi/db

# 4. Seed demo store data (Batik Nusantara + accounts)
npm run seed -w @tokophi/db

# 5. Seed KiriminAja district lookup database (78k subdistrict rows)
npm run seed:areas -w @tokophi/db

# 6. Start development servers
npm run dev:admin                   # Seller dashboard -> http://localhost:3000
npm run dev:super                   # Super admin      -> http://localhost:3001
npm run dev -w @tokophi/storefront  # Storefront SSR   -> http://localhost:4327
```

> ⚠️ **Storefront Environment Note**: The storefront reads runtime config from `process.env`, not `import.meta.env` (Docker images build environment-agnostic). Always ensure `DATABASE_URL` and `STORE_SLUG` are present in shell scope when running `astro dev` directly.

---

## 🔐 Database, Row-Level Security & Isolation

- **Engine**: PostgreSQL 16 + Drizzle ORM. 80 tables, 95 migrations. All currency & money fields use `bigint` IDR (no floating point rounding).
- **Tenant Isolation**: **53 store-scoped tables** enforce PostgreSQL Row-Level Security (`tenant_isolation` policy).
- **Runtime Enforcer**: Every merchant read (`lib/data/*` via `withCurrentTenant`) and write (`lib/actions/*` via `withTenant`) executes inside a transaction setting `app.store_id` and dropping DB connection privileges to the non-owner `tokophi_app` role.
- **Verification Gate**:
  ```bash
  npm run verify-rls -w @tokophi/db     # Verifies RLS policies across all catalog tables
  npm run verify-ledger -w @tokophi/db  # Verifies double-entry ledger balance integrity
  ```

---

## 💳 Logistics, Payments & Signal Engine

- **Shipping Aggregator (KiriminAja)**: Ongkir rates are computed strictly server-side from the merchant's verified pickup district (`store_settings.sender_kecamatan_id`). Client-side origin tampering is impossible.
- **Payments Gateway (AutoLaris)**: Platform-managed Virtual Accounts (BCA, Mandiri, BRI, BNI, Permata) + QRIS. Inactive or unchargeable channels are automatically excluded from the checkout interface.
- **COD (Cash on Delivery)**: Enforced via a 3-way check boundary: platform ceiling + province allowlist + courier service capability (`codAllowed`) + merchant toggle. Verified server-side at `/api/public/order`.
- **Conversion Signal Engine**: Full server-side CAPI integration for Meta Ads & TikTok Ads with `event_id` deduplication, Advanced Matching (SHA-256), and server-authoritative Purchase signals.

---

## 🤖 AI, Agent & Collaborator Working Protocol

All AI systems (OMP, Claude, Codex, Pi, Antigravity) and human collaborators MUST adhere to the mandatory working protocol detailed in [`AGENTS.md`](AGENTS.md):

1. **Auto-Task Tracking (`specs/docs/TASKS.md`)**: Check and update task states (`[ ]` todo → `[~]` in progress → `[x]` done) in real-time. Never yield unflagged tasks.
2. **Execution Logging & History (`BUILD-LOG.md`)**: Append structured session logs, modified file lists, and runnable verification proof to [`BUILD-LOG.md`](BUILD-LOG.md) upon completing any work item.
3. **Status Synchronization (`specs/docs/STATUS.md`)**: Update system status timestamps and executable test metrics in [`specs/docs/STATUS.md`](specs/docs/STATUS.md) whenever platform state changes.
4. **Master Report Maintenance**: Maintain [`specs/docs/TOKOPHI_MASTER_ENGINEERING_REPORT.md`](specs/docs/TOKOPHI_MASTER_ENGINEERING_REPORT.md) and task specifications under [`specs/docs/tasks/`](specs/docs/tasks/).

---

## 🧪 Testing & Verification Commands

```bash
# Full test suite (Vitest + Storefront Astro Check + Landing Astro Check)
npm test

# Isolated Vitest unit tests
npx vitest run

# Storefront typecheck & diagnostic audit
npm run check:storefront

# Landing page typecheck & diagnostic audit
npm run check:landing

# Next.js Admin production build verification
npm run build:admin

# Next.js Super Admin production build verification
npm run build:super

# External Production Witness Probe (Run from local machine/probe node)
ops/tokophi-probe.sh
```

---

## 📚 Core System Documentation Directory

| Document Path | Description |
|---|---|
| [`AGENTS.md`](AGENTS.md) | **Read first.** Multi-agent working agreement, domain invariants & AI collaborator protocol. |
| [`BUILD-LOG.md`](BUILD-LOG.md) | Executed build & audit log history, timestamped verification records. |
| [`specs/docs/STATUS.md`](specs/docs/STATUS.md) | System status summary, real executable test counts, migration readiness. |
| [`specs/docs/TASKS.md`](specs/docs/TASKS.md) | Prototype & production task breakdown with AC & progress state. |
| [`specs/docs/TOKOPHI_MASTER_ENGINEERING_REPORT.md`](specs/docs/TOKOPHI_MASTER_ENGINEERING_REPORT.md) | Master Engineering & Architecture Report across all 6 audit domains. |
| [`specs/docs/SYSTEM_GUIDE.md`](specs/docs/SYSTEM_GUIDE.md) | Complete whole-system tour & surface breakdown. |
| [`specs/docs/DEPLOY.md`](specs/docs/DEPLOY.md) | Infrastructure, Coolify, Traefik, Docker Compose & production deployment guide. |
| [`specs/docs/AUDIT_SECURITY_PRIVACY.md`](specs/docs/AUDIT_SECURITY_PRIVACY.md) | Security, RLS, Auth Guard & Privacy audit documentation. |
| [`specs/docs/AUDIT_PAYMENT_CHECKOUT.md`](specs/docs/AUDIT_PAYMENT_CHECKOUT.md) | Payment gateway, AutoLaris, COD & Checkout flow audit. |
| [`specs/docs/AUDIT_ORDER_STOCK_DISPATCH.md`](specs/docs/AUDIT_ORDER_STOCK_DISPATCH.md) | Order state machine, ledger credit & stock management audit. |
| [`specs/docs/AUDIT_TRACKING_SHIPPING.md`](specs/docs/AUDIT_TRACKING_SHIPPING.md) | KiriminAja 3PL courier tracking & shipping calculation audit. |
| [`specs/docs/AUDIT_TYPE_A11Y_PERFORMANCE.md`](specs/docs/AUDIT_TYPE_A11Y_PERFORMANCE.md) | TypeScript strictness, accessibility & page speed performance audit. |
| [`specs/decisions/`](specs/decisions/) | Architecture Decision Records (ADRs 0001 through 0012). |

---

*Private Repository — Confidential property of TokoΦ Commerce Platform (`github.com/ongkipro/tokophi`).*
