# TokoΦ

**Shopify-style commerce SaaS for Indonesia.** One platform runs many merchant stores: a **Seller** dashboard the shop owner uses, a **Super Admin** control plane we use to run the platform, and **one storefront container that serves every merchant** — the tenant is resolved from the request's `Host` header.

Bahasa Indonesia UI · IDR · built around how Indonesians actually buy: WhatsApp, COD, QRIS, VA, local couriers.

> **Live** on `tokophi.com` since 2026-07-13. Deliberately **no Apps/Plugins marketplace**. There *is* a drag-and-drop Store Builder (`/tema`), but no "Themes" gallery — a merchant composes their own homepage from a fixed section registry.

**New here? Read [`AGENTS.md`](AGENTS.md) first** — several agents share this repo, this database and this machine, and the rules in it were learned by breaking things. Then [`specs/docs/SYSTEM_GUIDE.md`](specs/docs/SYSTEM_GUIDE.md) for the whole-system tour.

---

## The four surfaces

One deploy per surface. The storefront is the interesting one: **it is not per-merchant** — a single container serves every store, and `<slug>.tokophi.com` (or, later, a merchant's own domain) decides which.

| Surface | App | Who | Stack | Local |
|---|---|---|---|---|
| **Seller dashboard** | `apps/admin` | the shop owner | Next 16 · shadcn on **Base UI** | `:3000` |
| **Super Admin** | `apps/super-admin` | us (the platform) | Next 16 · shared UI | `:3001` |
| **Storefront** | `apps/storefront` | shoppers | Astro 5 SSR · **multi-tenant by Host** | `:4327` |
| **Landing** | `apps/landing` | the apex (`tokophi.com`) | Astro, static, **no DB on purpose** | `:4328` |

```
tokophi/
  apps/       admin · super-admin · storefront · landing
  packages/
    db/         @tokophi/db       — Drizzle schema, migrations, seed (the source of truth)
    ui/         @tokophi/ui       — shadcn on Base UI + design tokens
    lib/        @tokophi/lib      — IDR/number formatters, billing, colours, integrations
    sections/   @tokophi/sections — Store Builder section registry (shared by admin + storefront)
    data/       @tokophi/data     — fallback nav, used only when a store has no menu of its own
  specs/      PRD · ARCHITECTURE · ADRs · BACKLOG · WORKLOG · CHAT_SPEC · CUSTOM_DOMAIN
```

Demo store: **Batik Nusantara** (women's fashion, 14 products × 5 images, real variants Warna×Ukuran).

---

## Quickstart

```bash
npm install                       # all workspaces
docker compose up -d db           # PostgreSQL 16 → localhost:5433
npm run migrate -w @tokophi/db    # apply migrations (canonical)
npm run seed    -w @tokophi/db    # demo data — idempotent
npm run seed:areas -w @tokophi/db # KiriminAja districts + kelurahan→kodepos (78k rows, one-off)

npm run dev:admin                 # seller dashboard → :3000   (ongki@batiknusantara.id / tokophi123)
npm run dev:super                 # super admin      → :3001   (admin@tokophi.id / tokophi123)
npm run dev -w @tokophi/storefront   # storefront    → :4327
```

⚠️ The storefront reads its config from **`process.env`, not `import.meta.env`** (the Docker image is built without env, so anything read at build time would bake in as `undefined`). `astro dev` only loads `.env` into `import.meta.env` — so export `DATABASE_URL` and `STORE_SLUG` in the shell, or the tenant will not resolve and you get a clean *"Toko tidak ditemukan"* 404.

**Builds:** `npm run build:admin` · `npm run build:super` · `npm run build -w @tokophi/storefront`

---

## Database

**PostgreSQL 16 in Docker + Drizzle.** 70 tables · migrations through `0050`. Money is `bigint` IDR (no decimals, survives aggregates). Prod target is self-hosted Postgres + PostgREST on a VPS — **not** Supabase (ADR 0007).

```bash
npm run studio     -w @tokophi/db   # Drizzle Studio
npm run generate   -w @tokophi/db   # after editing src/schema.ts → a new migration
npm run verify-rls -w @tokophi/db   # proves tenant isolation actually holds
npm run reset      -w @tokophi/db   # drops public + drizzle schemas
```

⚠️ **`npm run reset` and `SEED_FORCE=1 npm run seed` TRUNCATE everything** and hand out new `store_id`s — anyone else mid-verification loses their data and their session, silently. Announce before you re-seed; prefer a targeted SQL write.

### Row-Level Security is real, and it is enforced at runtime

**44 of the 45 store-scoped tables** carry the `tenant_isolation` policy, and the admin does not merely *hope* it holds: every read (`lib/data/*` via `withCurrentTenant`) and every write (`lib/actions/*` via `withTenant`) runs inside a transaction that sets `app.store_id` and **drops to the non-owner `tokophi_app` role**, so Postgres enforces the policy live rather than the app remembering a `where` clause.

`verify-rls` derives the store-scoped set **from the catalog**, so a new table with a `store_id` and no policy fails the check instead of quietly shipping. The one exception is `platform_activity` — the platform's own audit log, read cross-tenant by super-admin and written before a session exists. That is a decision, not a gap.

Auth, super-admin and the storefront run on the owner connection **on purpose**: an anonymous shopper has no session and therefore no GUC to set, which makes the *application* the isolation boundary there. Every storefront query filters on `store_id` explicitly.

**RBAC** is a separate layer (`lib/rbac.ts`): every mutating server action calls `requireCapability()` first. The UI's `useCan()` gating is UX — the server action is the boundary.

---

## What runs the money

- **Shipping — KiriminAja.** Ongkir is priced **from the seller's pickup address** (`store_settings.sender_kecamatan_id`, which *is* a KiriminAja district id). It used to come from a city name posted by the **shopper's browser** — an untrusted string deciding a price, and a Surabaya merchant quoting Yogyakarta rates. **Never let the client choose the origin.**
- ⚠️ **`KIRIMINAJA_ENV` defaults to `sandbox`** (`tdev.kiriminaja.com`). The rates are genuine API responses and genuinely origin-driven — they are **not production tariffs**, and an unset env in production silently talks to sandbox. That flag is the last step between the demo and real money.
- **Payments — AutoLaris** (VA/QRIS). Channels are filtered on `enabled AND active`: *we* choose to offer it, *and* the gateway actually accepts it (probed live). Six channels pass today — QRIS + five Virtual Accounts. The e-wallets are refused by the gateway, so they are not rendered: a payment method that cannot be charged has no business on the checkout.
- **COD** is a chain of three agreements — platform cap + province allow-list, per-service `codAllowed` (SPX only), and the merchant's own switch — and `/api/public/order` **re-checks every one**. Hiding the option in the storefront is UX; **that endpoint is the boundary.**
- **Provider brands are hidden from merchants** (ADR 0004) — generic labels only. Only super-admin sees KiriminAja/AutoLaris.

---

## Conventions that will bite you

- **shadcn here runs on Base UI (`@base-ui/react`), NOT Radix.** Triggers use `render`, not `asChild`. There is **no `Select`** primitive. A `Button` rendered as a link needs `nativeButton={false}`. See [`apps/admin/AGENTS.md`](apps/admin/AGENTS.md).
- **A control that cannot work must not be rendered.** Not greyed out, not with an excuse — *absent*. A shop that shows a payment method it cannot charge, a rating it did not count, or a form that discards the message it says it received, is lying to a shopper. This rule has teeth: an audit removed a fake login page (it swallowed passwords), a newsletter that submitted nowhere, and product ratings invented by the seed.
- **Money and checkout paths must be EXERCISED, not typechecked.** `astro check`, lint and build all stayed green while a `ReferenceError` inside a client `<script>` blocked the **entire rate load** — no rates, no COD, no order at all. Only a browser caught it.
- **Determinism:** no `Date.now()` / `Math.random()` in a render path. Seeded data is anchored to a fixed `TODAY`, so SSR === client.
- **Money is IDR** via `@tokophi/lib`; figures use `tabular-nums`.

---

## Gates

```bash
npm run verify-rls -w @tokophi/db              # tenant isolation actually holds
npm run audit:responsive -w @tokophi/storefront # 10 routes × 11 device widths (320→1920)
```

The responsive audit fails on **any horizontal overflow** — the one symptom that reliably means the layout broke, invisible in a screenshot at a single width, and exactly what a shopper feels on a phone. It has caught real breaks that the eye missed (a `flex-1` inside a `flex-col` sizing the *height*; an implicit `auto` grid track sized from its *content*).

---

## Docs

| | |
|---|---|
| [`AGENTS.md`](AGENTS.md) | **Read first.** Multi-agent working agreement + the domain rules (shipping, COD, payments). |
| [`CHANGELOG.md`](CHANGELOG.md) | What changed, and *why* — written to be read, not skimmed. |
| [`specs/docs/WORKLOG.md`](specs/docs/WORKLOG.md) | Session log, newest first. Resume from here. |
| [`specs/docs/BACKLOG.md`](specs/docs/BACKLOG.md) | Prioritised work. Pull the top unchecked item. |
| [`specs/docs/SYSTEM_GUIDE.md`](specs/docs/SYSTEM_GUIDE.md) | Whole-system tour. |
| [`specs/docs/DEPLOY.md`](specs/docs/DEPLOY.md) | Cloudflare + Traefik + Coolify on Vultr, and the TLS gotchas. |
| [`specs/docs/CUSTOM_DOMAIN.md`](specs/docs/CUSTOM_DOMAIN.md) | Merchant custom domains via CNAME (spec + slices 1–3 built 2026-07-15; TLS activation pending). |
| [`specs/docs/CHAT_SPEC.md`](specs/docs/CHAT_SPEC.md) | Shopper ⇄ merchant chat. |
| [`specs/decisions/`](specs/decisions/) | ADRs. `0004` platform-managed payments/shipping · `0007` Postgres+PostgREST · `0009` Store Builder + multi-tenant storefront. |

Private repo — `github.com/ongkipro/tokophi`.
