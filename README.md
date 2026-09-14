# TokoΦ

> **Status:** in active development, live in production | **Repo:** private
> **Stack:** npm-workspaces monorepo — Next.js (Seller + Super Admin) + Astro SSR (multi-tenant storefront) + static Astro (landing) over PostgreSQL / Drizzle, self-hosted deployment

## Overview

Shopify-style commerce SaaS for Indonesia: Bahasa Indonesia UI, IDR, and the way Indonesian sellers
actually work — WhatsApp, COD, local couriers, QRIS / virtual accounts. One Postgres, four surfaces,
and the platform collects the money and pays the merchant out, which makes the **ledger** the most
consequential code in the repository. Provider brands (courier aggregator, payment gateway) are
platform-managed and never shown to merchants or shoppers (ADR 0004).

## Quick Links

Every document below is authoritative for its own subject. Do not restate one inside another; the
authority map that names an owner per concern is [`specs/README.md`](specs/README.md).

- 📋 [PRD](./PRD.md) — entrypoint → the product requirements in [`specs/PRD.md`](specs/PRD.md)
- ✅ [Tasks](./TASKS.md) — **the one execution queue** (staged, each task with a runnable "Done when")
- 📊 [Status](./STATUS.md) — delivery state machine, blockers, next verified action → detail in [`specs/docs/STATUS.md`](specs/docs/STATUS.md)
- 🏗️ [Architecture](./ARCHITECTURE.md) — the record of what is built → design in [`specs/docs/ARCHITECTURE.md`](specs/docs/ARCHITECTURE.md)
- 📝 [Decisions](./DECISIONS.md) — ADR index + owner rulings (`DEC-nnn`) → [`specs/decisions/`](specs/decisions/)
- 🚀 [Release](./RELEASE.md) — the release on production now, its base, risk and rollback
- 📡 [Observability](./OBSERVABILITY.md) — post-deploy probe contract and what actually watches the box
- 📜 [Build log](./BUILD-LOG.md) — durable execution history, one entry per pass with its evidence
- 🤖 [Agents](./AGENTS.md) — the working agreement every AI CLI and collaborator reads first (`CLAUDE.md` → symlink)
- 🗺️ [Page map](specs/docs/PAGE_MAP.md) — generated: every URL of all four surfaces → file, data/actions, gate, tests
- 💰 [Finance](specs/docs/FINANCE.md) · 🔐 [Security](specs/docs/SECURITY.md) · 🚢 [Deploy](specs/docs/DEPLOY.md) · 🗄️ [Schema](specs/docs/SCHEMA.md)

## Quickstart

```bash
git clone <this-repo> && cd tokophi
npm install
docker compose up -d db                 # PostgreSQL 16 @ localhost:5433
cp .env.example .env                    # DATABASE_URL etc. — see AGENTS.md "Database"
npm run migrate -w @tokophi/db          # versioned migrations (hand-written, idempotent)
npm run seed    -w @tokophi/db          # demo data — the owner password prints ONCE at the end
npm run dev:admin                       # Seller  → http://localhost:3000
npm run dev:super                       # Super Admin → http://localhost:3001
npm test                                # vitest incl. real-Postgres money suites + astro check
```

⚠️ More than one AI agent works in this checkout and against this database at the same time. Before
re-seeding, killing a dev server, or generating a migration, read the **"MULTIPLE AGENTS SHARE THIS
WORKTREE"** section of `AGENTS.md`.

## Key Features (what is actually running)

- **Seller panel** — products/variants, orders with courier booking + label printing, inventory,
  discounts/vouchers/flash sales, customers + abandoned-checkout recovery over WhatsApp, Store Builder,
  landing pages, analytics derived live from orders, team roles (RBAC), subscription + payouts.
- **Storefront** — one container serving every merchant by `Host` (`<slug>.tokophi.id`, custom domains
  via Cloudflare for SaaS), guest checkout, live courier rates, COD gate, QRIS/VA prepaid via the
  payment gateway, deferred marketing pixels + server-side conversions.
- **Super Admin** — every store, billing/invoices, payouts, payment channels + fee schedule, courier
  roster, impersonation (one-time exchange), system log, cron liveness, update log.
- **Platform invariants** — RLS on 54/55 store-scoped tables under a restricted DB role; the ledger
  balance is derived, never stored; every fee is the provider's measured figure; 100+ guard tests that
  read source and were each proved red before being trusted.

## Environment

- **Production:** four surfaces (landing, storefront, Seller, Super Admin) on a self-hosted domain — see `DEPLOY.md`
- **Staging:** none — one production box; a PR's CI builds all four surfaces (`.github/workflows`)
- **Local:** http://localhost:3000 (Seller) · http://localhost:3001 (Super Admin) · storefront per `apps/storefront` README
