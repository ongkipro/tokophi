# TokoΦ

Shopify-style commerce SaaS for Indonesia — Bahasa Indonesia UI, IDR, WhatsApp, COD, local couriers,
QRIS / virtual accounts. One Postgres, four surfaces, and the platform collects the money and pays the
merchant out. Live at [tokophi.com](https://tokophi.com) since 2026-07-13.

**Stack:** npm-workspaces monorepo — Next.js (Seller `app.`, Super Admin `rich.`) · Astro SSR (multi-tenant
storefront `<slug>.tokophi.id`) · static Astro (landing) · PostgreSQL 16 + Drizzle, self-hosted on Coolify.

## Read first

- [`AGENTS.md`](./AGENTS.md) — the working agreement every AI CLI and collaborator reads before coding
- [`specs/README.md`](./specs/README.md) — the authority map: one owner document per concern
- [`TASKS.md`](./TASKS.md) — the one execution queue · [`STATUS.md`](./STATUS.md) — delivery state · [`BUILD-LOG.md`](./BUILD-LOG.md) — history
- [`PRD.md`](./PRD.md) · [`ARCHITECTURE.md`](./ARCHITECTURE.md) · [`DECISIONS.md`](./DECISIONS.md) · [`RELEASE.md`](./RELEASE.md) · [`OBSERVABILITY.md`](./OBSERVABILITY.md)

## Run

```bash
npm install
docker compose up -d db              # PostgreSQL 16 @ localhost:5433
cp .env.example .env                 # see AGENTS.md "Database"
npm run migrate -w @tokophi/db
npm run seed    -w @tokophi/db       # the owner password prints ONCE
npm run dev:admin                    # http://localhost:3000
npm run dev:super                    # http://localhost:3001
npm test
```

More than one agent works in this checkout and database at once — read the shared-worktree rules in
`AGENTS.md` before re-seeding, killing a dev server, or writing a migration.
