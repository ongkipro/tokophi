# ADR 0005 — Monorepo with shared packages (npm workspaces)

**Status:** accepted · **Date:** 2026-07-02

## Context
The project started as a single Next.js merchant admin. It then grew two more surfaces: a **super-admin** platform control plane (toko/paket/billing, gateway & courier config) and a customer-facing **Astro storefront** ("Batik Nusantara"). Three separate repos would drift on design tokens, formatters, and — critically — the navigation menus that both admin and storefront render. We needed shared code and a single source of truth without heavyweight tooling.

## Decision
- **npm workspaces monorepo**, no extra build orchestrator. Root `package.json` globs `apps/*` + `packages/*`.
- **Apps:** `apps/admin` (Next 16, :3000), `apps/super-admin` (Next 16, :3001), `apps/storefront` (Astro 5, :4327).
- **Packages:** `@tokophi/ui` (shadcn on Base UI + design tokens), `@tokophi/lib` (formatters/types), `@tokophi/data` (canonical nav — see ADR 0006).
- **Consumption is pragmatic, not dogmatic:** super-admin uses `@tokophi/ui` + `@tokophi/lib`; storefront uses `@tokophi/lib` + `@tokophi/data`; admin uses `@tokophi/data` but **keeps its own local `components/ui/*`** for now (it predates the shared package). Next apps transpile the workspace packages via `next.config.ts`.

## Consequences
- One `npm install`, one place for shared formatters/tokens/nav; cross-surface consistency comes for free where packages are adopted.
- **Admin UI de-duplication is a known backlog item:** admin should migrate its local `components/ui/*` onto `@tokophi/ui` to remove the duplicate component set. Deferred to avoid churn on a working prototype.
- Packages ship raw TS/TSX (workspace source, no build step); consumers transpile. Fine while everything is internal and mock-first (ADR 0001).
- Adding a fourth surface later (e.g. a second storefront brand) is cheap: new `apps/*` entry, reuse packages.
