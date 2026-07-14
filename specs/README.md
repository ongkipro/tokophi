# TokoΦ — Specs & Docs

**Shopify-style commerce SaaS for Indonesia.** Bahasa Indonesia UI, IDR, tuned to how Indonesian
sellers actually work: WhatsApp, COD, local couriers, QRIS/e-wallets.

**Four surfaces**, one Postgres. The platform collects the money and pays the merchant out — which
makes us a custodian, and makes the ledger the most consequential thing in the codebase.

- **Code:** `~/projects/tokophi` — monorepo (npm workspaces)
- **Coding conventions & gotchas:** `AGENTS.md` (repo root) — **read it, shadcn here runs on Base UI, not Radix**
- **Changelog:** `CHANGELOG.md`

---

## Read these first

Written from the code and the database, and re-verified 2026-07-14. **They are the authoritative ones.**

| Doc | What it answers |
|---|---|
| **[PRD.md](PRD.md)** | What the product is, the money model, the COD policy, the four surfaces. Aspirational items are labelled aspirational |
| **[docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)** | What must be **true** — functional + non-functional requirements as **verifiable statements**, each with the query or grep that checks it. Includes the security invariants learned the hard way |
| **[docs/STATUS.md](docs/STATUS.md)** | 🟢 REAL / 🟡 SEEDED-BUT-COMPUTED / 🔴 FAKE. **Read before you trust a number on a screen** |
| **[docs/SYSTEM_MAP.md](docs/SYSTEM_MAP.md)** | Every route → its data layer → its tables, per surface. Where the RLS boundary actually sits |
| **[docs/FLOWS.md](docs/FLOWS.md)** | The seven critical flows as sequence diagrams. **§5 = shipping end to end (address cascade → quote → order snapshot → booking → label) — read it before touching checkout** |
| **[docs/CODE_MAP.md](docs/CODE_MAP.md)** | The development map: structure, packages, where each concern lives, the two `packages/db` landmines |
| **[docs/UML.md](docs/UML.md)** | ER/class diagram, order + ledger state machines, component and deployment diagrams. **Every diagram is validated with mermaid-cli** |
| **[docs/SCHEMA.md](docs/SCHEMA.md)** | The database, **generated from `information_schema` / `pg_class`** — 68 tables, 50 migrations, RLS on 43 of the 44 store-scoped tables. Not from memory |
| **[docs/BACKLOG.md](docs/BACKLOG.md)** | What is left, honestly — including the five things that are currently lying, leaking, or unmeasurable |

**Supporting:** [ARCHITECTURE](docs/ARCHITECTURE.md) · [CONCEPT](docs/CONCEPT.md) ·
[CHAT_SPEC](docs/CHAT_SPEC.md) · [DEPLOY](docs/DEPLOY.md) · [CODE_MAP](docs/CODE_MAP.md) ·
[UI_INVENTORY](docs/UI_INVENTORY.md) · [WORKLOG](docs/WORKLOG.md) · [PROD_PLAN](docs/PROD_PLAN.md) ·
[DATA_MODEL](docs/DATA_MODEL.md) · **wireframes/**

> ⚠️ **DATA_MODEL.md, GUIDE.md and CONCEPT.md predate the backend** and
> describe a mock-first product. Where they disagree with the docs in the table above, **the table above
> wins.** Where anything disagrees with the database, **the database wins.**

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
npm install                        # all workspaces
docker compose up -d db            # PostgreSQL 16 @ localhost:5433
npm run migrate -w @tokophi/db     # apply migrations
npm run seed    -w @tokophi/db     # demo data (TRUNCATES first)

npm run dev:admin                  # → http://localhost:3000
npm run dev:super                  # → http://localhost:3001
cd apps/storefront && npm run dev  # → http://localhost:4327
```

Seeded owner login: **ongki@batiknusantara.id / tokophi123**

> ✅ **A fresh seed can exercise COD** with no API key and no clicking — the seed writes per-service
> *objects* (`{type,name,group,cod,codAllowed}`), `store_settings.cod_enabled = true` for Batik Nusantara,
> and the `store_shipping_methods` rows. (It used to write legacy *strings*, which `getCodPolicy` skips, so
> a fresh DB had **zero** COD-allowed services.)
>
> ⚠️ **The seed TRUNCATES.** It preserves the two reference tables (`kiriminaja_areas`, **`kelurahan`** —
> 78.764 rows) via a keep-list. `kelurahan` was **missing from that list**, so every reseed silently killed
> the checkout's kodepos auto-fill. Keep it there. And the shared dev DB is shared: **announce before you
> reseed.**

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
| **[0010](decisions/0010-courier-policy.md)** | **Courier policy: a curated seller list, an SPX+JNE baseline, per-origin availability** |

---

## Status (2026-07-14)

**All four surfaces are live products on a real database.** 68 tables, 50 migrations (`0000`–`0049`), RLS
enforcing on 43 of the 44 store-scoped tables. Auth + RBAC + tenant isolation are real. The **money system**
(append-only ledger, derived balance, payouts with approval, release on `selesai`) is real end-to-end. **COD**
is enforced through a five-condition server-side gate with the destination province verified from the
courier's district id, not from what the buyer typed. Orders support **`retur`**, which restores inventory
and claws the credit back.

**Shipping is precise end to end:** the address cascade is kecamatan → kelurahan (kota/provinsi/kodepos are
derived), the ongkir is priced from the **seller's** pickup address with the weight summed from the DB, the
order **snapshots** the destination ids, and the shipment is booked with those exact ids. **Kecamatan prices
the parcel; kelurahan books it** — see [FLOWS §5](docs/FLOWS.md) and [ADR 0010](decisions/0010-courier-policy.md).

**What is not real, and is documented as such:** there is **no ad-platform integration** · the storefront
blog is hardcoded · the per-courier COD return rate — the number the whole COD policy is betting on —
**cannot be computed**, because `orders.courier` is NULL on **702/702** rows · the "SPX free return" premise
the policy rests on is **UNVERIFIED** (and KiriminAja marks five other couriers COD-capable — the SPX-only
rule is **our** policy, not a courier limit) · `KIRIMINAJA_ENV` still defaults to **sandbox** · there is
**one test file in the repo**.

**Start at [docs/STATUS.md](docs/STATUS.md) and [docs/BACKLOG.md](docs/BACKLOG.md).**
