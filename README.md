# TokoΦ

TokoΦ is a multi-tenant commerce SaaS for Indonesian merchants. One monorepo serves the seller admin, platform super-admin, multi-tenant storefront, public landing page, shared packages, and the local TokoΦ Account prototype.

## Release status

**Pre-release; unrestricted production release is blocked.**

The current evidence boundary is [`specs/docs/AUDIT-SUMMARY.md`](specs/docs/AUDIT-SUMMARY.md). Accepted behavior and known gaps are in [`specs/docs/REQUIREMENTS.md`](specs/docs/REQUIREMENTS.md). Repository-root [`TASKS.md`](TASKS.md) is the only active remediation queue and release gate.

Do not infer readiness from version `1.0.0`, historical release notes, green health endpoints, or dated audit reports. Production mutations and deployments require explicit owner approval.

## Documentation authority

| Concern | Owner document |
|---|---|
| Contributor rules and repository invariants | [`AGENTS.md`](AGENTS.md) |
| Product intent and scope | [`PRD.md`](PRD.md) |
| Implemented system shape | [`specs/docs/ARCHITECTURE.md`](specs/docs/ARCHITECTURE.md) |
| Accepted decisions | [`specs/decisions/`](specs/decisions/) |
| Verifiable behavior and gaps | [`specs/docs/REQUIREMENTS.md`](specs/docs/REQUIREMENTS.md) |
| Current audit evidence and release blockers | [`specs/docs/AUDIT-SUMMARY.md`](specs/docs/AUDIT-SUMMARY.md) |
| Current implementation queue | [`TASKS.md`](TASKS.md) |
| Current runtime and seeded-data status | [`specs/docs/STATUS.md`](specs/docs/STATUS.md) |
| Deployment procedure and safety boundary | [`specs/docs/DEPLOY.md`](specs/docs/DEPLOY.md) |
| Security model and unresolved risks | [`specs/docs/SECURITY.md`](specs/docs/SECURITY.md) |
| Change history | [`CHANGELOG.md`](CHANGELOG.md) |

[`specs/README.md`](specs/README.md) is the complete documentation index. Dated audits, handoffs, `BACKLOG.md`, `WORKLOG.md`, and `specs/docs/tasks/NEXT.md` are historical evidence, not current instructions.

## Repository layout

```text
apps/
  admin/          Seller admin and public order/payment routes
  super-admin/    Platform operations
  storefront/     Multi-tenant Astro storefront
  landing/        Public marketing site
packages/
  db/             Drizzle schema, migrations, seeds, RLS verification
  lib/            Shared domain and integration logic
  ui/             Shared UI primitives
  data/           Shared static data
  sections/       Storefront section contracts and renderer registry
prototypes/
  tokophi-account/  Browser-runnable local account prototype
specs/
  decisions/      Accepted ADRs
  docs/           Canonical and historical system documentation
  openapi/        Observed and proposed API contracts
```

## Local verification

Use Node.js `22.12.0` and the checked-in npm lockfile.

```bash
npm ci
npm test
```

`npm test` runs the default Vitest suite plus Astro checks for Storefront and Landing. Database-coupled suites are intentionally separate and require a dedicated test database:

```bash
TEST_DATABASE_URL=postgresql://... npm run test:db
```

Build the two Next.js applications explicitly:

```bash
npm run build:admin
npm run build:super
```

The release command and its database boundary are still tracked by `TASKS.md`; do not treat the default suite as the release gate.

## Development start

```bash
npm run dev:admin
npm run dev:super
```

Run the local Account prototype separately:

```bash
npm run dev:account-prototype
```

Environment variable names and deployment wiring belong in [`specs/docs/DEPLOY.md`](specs/docs/DEPLOY.md) and checked-in example files. Never commit credentials or paste live values into documentation.
