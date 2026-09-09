# Decision Register — tokophi

Updated: 2026-09-08

> **Index only.** The full records live in `specs/decisions/` (ADRs) and, for owner rulings that
> never got an ADR, in the named section of `AGENTS.md` / `specs/docs/FINANCE.md`. Dates in the ADR
> table are the ADR's own `Date:` line where it has one, otherwise the file's first commit
> (`git log --diff-filter=A --date=short`). Never rewrite an entry; supersede it.

## Architecture Decision Records (`specs/decisions/`)

| ID | Status | Decision | Date | File |
|---|---|---|---|---|
| ADR 0001 | accepted | Stack: Next.js admin + Astro storefront, mock-data-first | 2026-07-02 | `0001-stack-and-mock-first.md` |
| ADR 0002 | accepted | shadcn/ui on **Base UI**, not Radix (`render` prop, no `asChild`) | 2026-07-02 | `0002-shadcn-base-ui.md` |
| ADR 0003 | partly superseded by 0009 | Scope (no Apps; "no Themes" reversed) + multi-tenancy model | 2026-07-02 | `0003-scope-and-multitenancy.md` |
| ADR 0004 | accepted | Payments, COD and shipping are **platform-managed**; provider brands hidden from merchants | 2026-07-02 | `0004-platform-managed-payments-shipping.md` |
| ADR 0005 | accepted | Monorepo with shared packages (npm workspaces) | 2026-07-02 | `0005-monorepo-shared-packages.md` |
| ADR 0006 | accepted | Shared nav source: auto-connect admin ↔ storefront | 2026-07-02 | `0006-shared-nav-source-auto-connect.md` |
| ADR 0007 | accepted | Persistence: Postgres + Drizzle (dev) → self-hosted Postgres on the VPS (prod) | 2026-07-03 | `0007-backend-postgres-drizzle.md` |
| ADR 0008 | accepted (single-tenant wording stale) | One control plane + one multi-tenant admin + storefront per client | 2026-07-03 | `0008-per-client-provisioning-model.md` |
| ADR 0009 | accepted | Self-serve Store Builder; one storefront container, tenant from `Host` | 2026-07-10 | `0009-self-serve-store-builder.md` |
| ADR 0010 | **deliberately never written** | Held for a courier-policy ADR whose curation was reversed; the live KiriminAja API is the roster (`packages/lib/src/couriers.ts`). Number stays unused — see the intake note in ADR 0012 | — | — |
| ADR 0011 | accepted | Standard product taxonomy (Google Product Category) beside the merchant's own | 2026-07-23 | `0011-product-taxonomy-google-category.md` |
| ADR 0012 | accepted | Meta Commerce integration uses **tenant-owned** assets; conversion built from the order row | 2026-07-28 | `0012-meta-commerce-tenant-owned-integration.md` |
| ADR 0013 | accepted | Stable, system-generated catalog product ids (`retailerId()`, one scheme per store) | 2026-07-29 | `0013-stable-catalog-product-ids.md` |
| ADR 0014 | superseded by 0015 (2026-08-12) | Platform absorbs the courier's shipping cost on COD orders | 2026-08-05 | `0014-platform-absorbs-cod-shipping.md` |
| ADR 0015 | accepted (owner, issue #180) | Net Seller proceeds + shipping reconciliation (`order-finance.ts`) | 2026-08-12 | `0015-net-seller-proceeds-and-shipping-reconciliation.md` |
| ADR 0017 | accepted (structural changes; the ~0 s options remain an owner decision) | Deploy window: health-first in-place swap on Coolify compose — consistent container names, `migrate` gate dropped from routed apps, `start_interval: 2s`; **81–115 s → 7–8 s** accepted as the floor (0016 reserved for Task 5.8) | 2026-08-28 | `0017-zero-downtime-deploy.md` |

## Owner rulings without an ADR (recorded in `AGENTS.md` unless noted)

| ID | Status | Decision | Date | Evidence |
|---|---|---|---|---|
| DEC-001 | accepted | Subscription prices are DPP; PPN 11 % is a **global toggle** `platform_finance.subscription_ppn_enabled`, **default OFF** at launch | 2026-08-24 | migration `0101`; `specs/docs/FINANCE.md`; `subscriptionCharge()` in `@tokophi/lib/billing` |
| DEC-002 | accepted | Ad-platform conversion `value` = **goods only** (no ongkir, no admin fee) on Meta, Google, TikTok; GA4 carries `shipping`/`tax` separately | 2026-08-24 | AGENTS.md "Conversion tracking"; `apps/admin/lib/tracking-events.ts` |
| DEC-003 | accepted | Marking an invoice paid by hand is **bookkeeping** — it never moves `stores.current_period_end`; entitlement moves on payment events only | 2026-08-20 | `apps/super-admin/lib/invoice-flip-is-bookkeeping.test.ts` |
| DEC-004 | accepted | `platform_payment_gateways.enabled` is a **record, not a switch** — gates nothing; the "Aktif" badge was removed, the column kept | 2026-08-20 | `apps/super-admin/lib/gateway-enabled-is-not-a-gate.test.ts` |
| DEC-005 | accepted | Order fees (COD 3 % + PPN on fee, QRIS 0,7 %, VA flat, e-wallet 2,4 %) are **enforced** in checkout pricing, buyer pays | 2026-08-24 | `packages/lib/src/payment-fees.ts`; `/api/public/order` |
| DEC-006 | accepted | KiriminAja sandbox and production share one API contract; cutover is an endpoint swap only | 2026-08-03 | AGENTS.md "Shipping & COD" |
| DEC-007 | accepted | Marketing pixels load on **first interaction** (10 s backstop, no `requestIdleCallback`); the lost bounce-PageView is accepted | 2026-08-01 | `MarketingPixels.astro`; `scripts/check-pixel-defer.mjs` |
| DEC-008 | accepted | A delivery-ledger run that failed, was fixed and re-passed may still `PASS` ("resolved, not unblemished") | 2026-09-01 | `~/dotfiles/docs/task-change-boundary.md` |
| DEC-009 | accepted | Repository visibility is **private** (fourth flip, 2026-09-04). Public windows: 2026-08-27→28 and 2026-09-01→04, both opened by owner order to revive GitHub Actions; closed 2026-09-04 by owner order after PR #380/#381 merged. Rule (project memory): never flip without a new explicit order. Consequence: Actions minutes are metered again. | `gh api repos/ongkipro/tokophi --jq .visibility` → `private`; BUILD-LOG 2026-08-28, 2026-09-01, 2026-09-04 |

Use stable IDs (`DEC-nnn`). When a ruling needs alternatives and consequences spelled out, write the
ADR in `specs/decisions/` (0016 is RESERVED for the buyer-account decision, Task 5.8 — `0016-global-buyer-account.md`, not yet written; next free number is **0018**) and link it here.
