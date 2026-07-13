# TokoΦ — Development Map (code · design · structure)

> The one-stop map of the codebase: where everything lives and how it connects. Pairs with
> `SCHEMA.md` (data model), `ARCHITECTURE.md` (why), `DEPLOY.md` (ops), `WORKLOG.md` (history).
> Keep this in sync when you add a surface, package, table, or major feature.

---

## 1. Overview

TokoΦ is a **Shopify-style commerce SaaS for Indonesia** — Bahasa Indonesia UI, IDR. Three surfaces, one monorepo, one PostgreSQL. **Single-plan billing** (Rp275rb/mo + PPN 11%), all features unlocked. Provider brands (KiriminAja/AutoLaris) hidden from clients (white-label).

| Surface | Package | Stack | Who uses it | Port (dev) |
|---|---|---|---|---|
| **admin** | `@tokophi/admin` | Next.js 16 (App Router, Turbopack) | a merchant/shop owner | 3000 |
| **super-admin** | `@tokophi/super-admin` | Next.js 16 | us (platform control plane) | 3001 |
| **storefront** | (Astro app) | Astro 5 **SSR** (`@astrojs/node` standalone; catalog read at server boot) | shoppers | 4327 |

---

## 2. Structure mapping (monorepo)

```
tokophi/
  apps/
    admin/          # merchant admin — 39 routes, 22 action files, 22 data files
    super-admin/    # platform control plane — 8 routes
    storefront/     # Astro SSR shopper site — ONE deploy serves every store (tenant from the Host header):
                    #   src/middleware.ts → getStoreByHost() → {store, catalog} on Astro.locals
                    #   src/data/store.ts (host→store, RESERVED labels, custom-domain SEAM) · cache.ts (per-store TTL)
    landing/        # @tokophi/landing — static Astro front door for tokophi.com ("Segera hadir").
                    #   NO database, NO depends_on: postgres — must serve even when the rest is down.
  packages/
    db/             # @tokophi/db — Drizzle schema + migrations + seed + client (server-only)
    lib/            # @tokophi/lib — shared pure logic (billing, formatters, courier/PSP clients, …)
    ui/             # @tokophi/ui — shadcn-on-Base-UI components + Tailwind v4 tokens (super-admin uses these)
    data/           # @tokophi/data — shared menu/data helpers
    sections/       # @tokophi/sections — Store Builder section registry (Puck) (ADR 0009)
  specs/docs/       # PRD, schema, architecture, this map, worklog, decisions/
  docker-compose.coolify.yml   # prod stack (Postgres + migrate + 3 apps + billing cron)
```

**Admin still has its OWN `components/ui` + `lib`** (not yet on `@tokophi/ui`). Super-admin consumes `@tokophi/ui`. TODO: de-dup admin onto shared UI.

---

## 3. Packages mapping (`@tokophi/*`)

| Package | Exports / key modules | Notes |
|---|---|---|
| `db` | `db`, `client`, `schema` (57 tables), `migrations/`, `seed.ts` | **server-only** (`postgres` is a serverExternalPackage). `withTenant`/`withCurrentTenant` live in each app's `lib/tenant.ts`, not here. |
| `lib` | `./billing` (pricing, `computeBilling`, `storeSegment`, `withPpn`), `./format` (IDR/num), `./couriers`, `./kiriminaja`, `./autolaris`, `./payment-fees`, `./integration-status`, `./totp`, `./cache`, `./colors` | Pure/shared. `kiriminaja`/`autolaris` are `server-only`. |
| `ui` | 23 components (`button card dialog dropdown-menu table tabs switch …`) + `lib/utils` (cn) + Tailwind tokens | **shadcn on Base UI** — `render` prop not `asChild`, no `Select`. |
| `data` | menu helpers | small shared. |
| `sections` | `registry.ts` — Store-Builder section catalog | consumed by admin `/tema` (Puck) + storefront renderer. |

---

## 4. Code mapping — admin (`apps/admin`)

Pattern: **route** (`app/(admin)/<x>/page.tsx`, `dynamic="force-dynamic"`) → **read** (`lib/data/<x>.ts`, `withCurrentTenant`) → **write** (`lib/actions/<x>.ts`, `"use server"` + `requireCapability`) → **UI** (`*-client.tsx` + `components/admin/<x>/`).

| Domain | Route(s) | Data (`lib/data/`) | Actions (`lib/actions/`) |
|---|---|---|---|
| Dashboard | `/` | dashboard/summary/series | — |
| Produk | `/produk`(+`/baru`,`/[id]`) | products | `products.ts`, `media.ts` |
| Produk › Inventori/Kategori/Pembelian | `/produk/inventori`,`/kategori`,`/pembelian` | inventory, collections, purchases | `inventory.ts`, `collections.ts`, `purchases.ts` |
| Pesanan | `/pesanan`(+`/[id]`) | orders | `orders.ts` |
| Pelanggan | `/pelanggan`(+`/[id]`,`/segmen`,`/ulasan`) | customers, segments, reviews | `customers.ts`, `segments.ts` |
| CRM | `/crm`(+`/followup`,`/pipeline`,`/template`) | crm | `crm.ts` |
| Diskon | `/diskon`(+`/baru`,`/[id]`) | discounts | `discounts.ts` |
| Analitik / Pemasaran | `/analitik`, `/pemasaran` | analytics, marketing | — |
| Toko Online | `/halaman`,`/blog`,`/navigasi`,**`/files`**,`/tema` | pages, articles, menus, **media**, theme | `pages.ts`,`articles.ts`,`menus.ts`,**`media.ts`**,`theme.ts` |
| **Akun** | `/akun/{profil,keamanan,langganan}` | billing (`getBilling`,`getMyInvoices`) | `profile.ts`,`security.ts`,`billing.ts` |
| **Bantuan** | `/bantuan`(+`/[id]`) | — | `support.ts` |
| Faktur (print) | `/faktur/[number]` (outside `(admin)`) | billing (`getFaktur`) | billing (`getInvoicePayment`) |
| Pengaturan | `/pengaturan` | shipping/payment-settings reads | `shipping.ts`,`payment-settings.ts` |
| Uploads serving | `/api/uploads/[name]` (public) · `/api/cron/billing` · `/api/public/pay/callback` · `/impersonate` | — | — |

**Auth/RBAC/tenancy:** `lib/auth.ts` (jose JWT session), `lib/rbac.ts` (`requireCapability`) + `lib/rbac-policy.ts` (role→cap matrix, client-safe), `lib/tenant.ts` (`withTenant`/`withCurrentTenant` → `tokophi_app` role + `app.store_id` GUC → RLS). `middleware.ts` = edge JWT gate.

---

## 5. Code mapping — super-admin (`apps/super-admin`)

| Route | Renders | Reads (`lib/data.ts`) | Writes (`lib/actions.ts`) |
|---|---|---|---|
| `/` | Dashboard: platform KPIs, MRR chart, health rollup, activity | `getPlatform`,`getMrrSeries`,`getSubscriptionStats`,`getInvoices`,`getActivity` | — |
| `/toko` | Store catalog — 4 segment tabs, 1-line summaries | `getStores`,`getHealthMap` | `createStore`,`setStoreStatus`,`setStoreComped` |
| `/toko/[id]` | Store detail — full control panel | `getStoreById`,`getStoreHealth`,`getStoreBilling`,`getStoreInvoices`,`getStoreUsers`,`getStoreActivity`,`getStoreComp` | `impersonateStore`, `compStore`, `extendTrial`, `setStoreComped`, `resetOwnerPassword`, `add/remove/setStoreUserRole/resetStoreUserPassword`, `createManualInvoice`, `sendPaymentReminder` |
| `/paket` | Billing — single-plan card + invoices | `getFinanceStats`,`getSubscriptionStats`,`getInvoices` | `setInvoiceStatus` |
| **`/tiket`** (+`/[id]`) | Support tickets (all stores) | `getAllTickets`,`getTicketAdmin` | `replyTicketAdmin`,`setTicketStatus` |
| `/analitik` | Keuangan & Analitik + realtime server metrics | `getFinanceStats`,`getSystemStatus`,`getServerMetrics` | — |
| `/pengaturan` | Platform config: payment channels (grouped) + couriers + team | `getPaymentChannels/Gateways`,`getCouriers`,`getAggregator`,`getPlatformAdmins` | `syncPaymentChannels`,`save*`,`test*Connection`,`invitePlatformAdmin` |

**Auth:** `lib/platform-auth.ts` (`requirePlatformAdmin`), `lib/session.ts` (impersonation token signing), `lib/health.ts` (store healthcheck). Cross-tenant reads on the **owner** connection.

---

## 6. Code mapping — storefront (Astro)

`/` · `/produk/[handle]` · `/kategori/[handle]` · `/keranjang` · `/checkout`(+`/sukses`) · `/blog` · `/akun` · `/kontak`. **SSR** (`@astrojs/node` standalone, `output: 'server'`): reads the DB via `@tokophi/db` at **server boot** (module-level in `src/data/catalog.ts`), so the container starts fast (no build-at-start). Dynamic routes resolve per-request from `Astro.params` (404 on unknown handle) — no `getStaticPaths`. Ongkir + order + pay proxied to the admin's public APIs (`PUBLIC_ONGKIR_API`/`PUBLIC_ORDER_API`). Store Builder sections render from `page_templates.sections`.

---

## 7. Data mapping (schema domains → SCHEMA.md)

57 tables. Domains: **identity** (accounts, stores, store_stats, users, store_users, locations) · **catalog** (products, product_media, product_options/variants, inventory_levels, collections + membership/conditions, **media**) · **suppliers/purchasing** · **orders/fulfillment** (orders, line_items, payments) · **customers/CRM** · **discounts** · **content** (pages, articles, menus, **page_templates** ADR 0009) · **marketing/analytics** · **platform** (plans[legacy], invoices, platform_activity, platform_admins, platform_payment_gateways/channels/cod, platform_couriers, shipping_aggregator) · **support** (support_tickets, support_messages) · **settings** (store_settings: couriers[], payment_channels[], payment_fee_bearer, tax, sender).

**RLS** (`0012`) on 32 store-scoped tables, enforced under `tokophi_app`. Owner exceptions: auth, super-admin, storefront.

---

## 8. Design mapping

- **System:** shadcn/ui **on Base UI (`@base-ui/react`), NOT Radix** + **Tailwind v4** (tokens in `@tokophi/ui/styles`). Indigo `--primary`, `rounded-xl`, soft shadows, `text-muted-foreground` for secondary, `tabular-nums` for figures, AA, theme-aware (light/dark).
- **The 3 mistakes to avoid:** triggers use `render={<Button/>}` (not `asChild`); **no `Select`** (use DropdownMenu/Tabs/buttons); `Button`-as-link needs `nativeButton={false}`.
- **Components:** shared in `packages/ui/src/components/ui/` (23). Admin has its own `components/ui/` mirror (de-dup pending).
- **Shell:** admin = `components/admin/` (sidebar, topbar, brand, nav-links) + per-screen subfolders (analitik/blog/halaman/navigasi/pelanggan/pemasaran/pengaturan). Super-admin = `app/(platform)/platform-shell.tsx` + `components/bits.tsx` (badges/icons).
- **Recurring patterns:** 2-column settings rail (super-admin Pengaturan, client Akun) · segment/status tabs with counts · collapsible grouped lists (payment channels) · chat-thread (support) · KPI cards · print sheet (`/faktur`) · drag-drop uploader (Files).
- **Nav:** admin `lib/nav.ts` (`NAV_GROUPS`), super-admin `lib/nav.ts` (`NAV`).

---

## 9. Feature → files mapping (key features)

| Feature | Core files |
|---|---|
| **Single-plan billing + PPN** | `@tokophi/lib/billing` (`computeBilling`,`storeSegment`,`quote`,`withPpn`) · admin `lib/data/billing.ts` + `lib/actions/billing.ts` · `/akun/langganan` + `PaySubscription` + `/faktur/[number]` · cron `/api/cron/billing` |
| **Store lifecycle segments + VIP** | `stores.comped/compedReason/compedAt` + `store_stats.ship7dAvg` (migr 0026/0027) · super-admin `/toko` tabs + `/toko/[id]` control · `SegmentBadge` |
| **Two-level courier/payment** | platform_* tables · super-admin Pengaturan · client `payment-methods-card`/shipping · storefront ∩ filter |
| **Payment gateway fees** | `@tokophi/lib/payment-fees` · `store_settings.payment_fee_bearer` (migr 0028) · client `payment-fees-card` |
| **Support tickets (2-sided)** | `support_tickets`/`support_messages` (migr 0030) · admin `/bantuan` + `lib/actions/support.ts` · super `/tiket` + `data.ts`/`actions.ts` |
| **Media library + WebP** | `media` table (migr 0033) · `lib/actions/media.ts` (`saveImage` sharp→WebP, already-WebP kept pixel-perfect) · `/files` · `/api/uploads/[name]` · 2MB cap |
| **Store Builder (ADR 0009)** | `page_templates` (migr 0031/0032) · `stores.logo_url/brand_color` · `@tokophi/sections` · admin `/tema` (Puck) · storefront renderer · `@tokophi/lib/colors` |
| **Impersonation** | super `impersonateStore` (signed token) → admin `/impersonate` route (cookie exchange, relative-redirect) |
| **Payments (real)** | KiriminAja (shipping) + AutoLaris (VA/QRIS) — `@tokophi/lib/{kiriminaja,autolaris}` · pay callback `/api/public/pay/callback` |

---

## 10. Conventions (hard rules)

- **Single plan** — do NOT reintroduce Pemula/Bisnis/Skala tiers (legacy). Prices are DPP; merchant pays base + **PPN 11%**.
- **RLS + RBAC** on every new admin DB path: reads `withCurrentTenant`, writes `requireCapability` → `withTenant`. Never a bare module-level `db` for tenant data.
- **White-label** — never show KiriminAja/AutoLaris brands to clients; generic labels only (super-admin sees brands).
- **Determinism** — no `Date.now()`/`Math.random()` in render paths (seeded, `TODAY` anchor). **Exception:** billing lifecycle dates in the seed use real clock (`fromNow`).
- **Money** IDR via `IDR()`; **Base UI** rules (§8); build must pass + dev overlay 0 issues.
- **Secrets** never committed (gitignored `.env*`). Passwords scrypt `salt:hash`, zero plaintext.

---

## 11. Infra mapping

- **Live:** Vultr Singapore (`45.76.146.40`) + **Coolify v4** (Docker Compose build pack). Domains `admin.`/`super.`/`toko.45.76.146.40.sslip.io`. Deploy = push `main` → Coolify (or API `POST /api/v1/deploy?uuid=…`).
- **Compose** (`docker-compose.coolify.yml`): `postgres` (volume `tokophi-pgdata`) + one-off `migrate` (drizzle migrate + **idempotent seed**, `SEED_FORCE=1` to force) + `admin` (volume `tokophi-uploads`) + `super-admin` + `storefront` (builds at start) + `cron` (daily billing) + `backup` (daily `pg_dump -Fc` → `tokophi-backups` volume, keeps last 7).
- **Migrations:** `packages/db/drizzle/` — current head **0033**. `npm run generate` after schema edits; migrate runs on deploy.
- **Env** (Coolify): `DATABASE_URL`, `AUTH_SECRET`, `KIRIMINAJA_*`, `AUTOLARIS_*`, `CRON_SECRET`, `PUBLIC_APP_URL`, `ADMIN_URL`, `PUBLIC_ONGKIR_API`, `PUBLIC_ORDER_API`.
- **Deferred → prod:** uploads → MinIO/S3 (currently container volume, admin-served — storefront can't yet show *uploaded* product images, only seeded `/products/*.webp`) · email/WA comms (tickets/reminders audit-only now) · HTTPS + custom domain (tokophi.com in Cloudflare, DNS not pointed) · Hetzner migration (host-agnostic).
