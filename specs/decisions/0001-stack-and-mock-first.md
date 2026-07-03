# ADR 0001 — Stack: Next.js admin + Astro storefront, mock-data-first

**Status:** accepted · **Date:** 2026-07-01

## Context
Building a Shopify-style commerce platform: a rich, interaction-heavy admin plus customer-facing storefronts. Need to visualize UI/UX fast and defer backend ("nanti tinggal backend"). Considered: static HTML prototypes first; one framework for everything; or the real production stacks from day one.

## Decision
- **Admin** = **Next.js (App Router) + shadcn/ui + Tailwind**. Admin is app-heavy (tables, forms, filters, auth, bulk actions) where React + a component library shines.
- **Storefront** = **Astro** (per client), for speed + SEO + island architecture; bespoke per brand.
- **Mock-data-first:** build the real stacks now, wired to typed mock fixtures behind a thin **data layer** (`lib/data/*`). No throwaway HTML. Swapping mock→API later is mechanical.

## Consequences
- The UI built now **is** the production UI — no rebuild.
- A clean seam (`lib/data`) must be maintained; screens must not import storage directly (list screens read mock arrays for brevity now → wrap in getters at backend time).
- Two codebases/stacks to maintain, but each fits its job. Shared design tokens keep them visually consistent.
- Backend (self-hosted Postgres) is a later, contained migration (ADR 0003 covers multi-tenancy).
