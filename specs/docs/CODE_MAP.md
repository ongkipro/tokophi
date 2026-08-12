# TokoΦ — Development Map (code · design · structure)

> The one-stop map of the codebase: where everything lives and how it connects. Pairs with
> `SCHEMA.md` (data model), `ARCHITECTURE.md` (why), `DEPLOY.md` (ops), `WORKLOG.md` (history).
> Keep this in sync when you add a surface, package, table, or major feature.

---

## 1. Overview

TokoΦ is a **Shopify-style commerce SaaS for Indonesia** — Bahasa Indonesia UI, IDR. **Empat** surface (admin/Seller · super-admin · storefront · landing), satu monorepo, satu PostgreSQL. **Single-plan billing** (Rp275rb/mo + PPN 11%), all features unlocked. Provider brands (KiriminAja/AutoLaris) hidden from clients (white-label).

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
    landing/        # @tokophi/landing — situs pemasaran Astro untuk tokophi.com (9 halaman: fitur,
                    #   cara-kerja, demo, harga, faq, kontak, pembayaran-pengiriman, privasi, …).
                    #   Sudah BUKAN "Segera hadir" — string itu tak ada lagi di sana.
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
| `db` | `db`, `client`, `schema` (**80 tables**), `migrations/` (**0000–0094**, 95 files), `seed.ts` | **server-only** (`postgres` is a serverExternalPackage). `withTenant`/`withCurrentTenant` live in each app's `lib/tenant.ts`, not here. |
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
| Pelanggan | `/pelanggan`(+`/[id]`,`/segmen`,`/ulasan`,**`/keranjang`**) | customers (guest vs registered), segments, reviews, **checkout** | `customers.ts`, `segments.ts`, **`checkout.ts`** |
| CRM | `/crm`(+`/followup`,`/pipeline`,`/template`) | crm | `crm.ts` |
| Diskon | `/diskon`(+`/baru`,`/[id]`) | discounts | `discounts.ts` |
| Analitik / Pemasaran | `/analitik`, `/pemasaran` | `analytics.ts`, `marketing.ts`, **`tracking.ts`** (`getTrackingStatus` ungated / `getTrackingConfig` + `getTrackingHealth` gated on `integrations:write`), **`feed.ts`** (`getFeedStatus` — the Katalog Iklan card) | **`tracking.ts`** (save pixel/CAPI config, test connection, clear token, switch `catalog_id_scheme`) |
| Toko Online | `/halaman`,`/blog`,`/navigasi`,**`/files`**,`/tema` | pages, articles, menus, **media**, theme | `pages.ts`,`articles.ts`,`menus.ts`,**`media.ts`**,`theme.ts` |
| **Akun** | `/akun/{profil,keamanan,langganan}` | billing (`getBilling`,`getMyInvoices`) | `profile.ts`,`security.ts`,`billing.ts` |
| **Bantuan** | `/bantuan`(+`/[id]`) | — | `support.ts` |
| Faktur (print) | `/faktur/[number]` (outside `(admin)`) | billing (`getFaktur`) | billing (`getInvoicePayment`) |
| Pengaturan | `/pengaturan` | shipping/payment-settings reads | `shipping.ts`,`payment-settings.ts` |
| Uploads serving + cron + callbacks | `/api/uploads/[name]` (public) · `/api/cron/billing` (daily) · **`/api/cron/tracking`** (KiriminAja AWB poller, 15 min) · **`/api/cron/tracking-events`** (conversion delivery worker, 60 s) · `/api/public/pay/callback` · `/impersonate` | — | — |

**Auth/RBAC/tenancy:** `lib/auth.ts` (jose JWT session), `lib/rbac.ts` (`requireCapability`) + `lib/rbac-policy.ts` (role→cap matrix, client-safe), `lib/tenant.ts` (`withTenant`/`withCurrentTenant` → `tokophi_app` role + `app.store_id` GUC → RLS). `middleware.ts` = edge JWT gate.

**Shipping & COD:** `lib/cod.ts` (`getCodPolicy` — the **single** answer to "may this order be paid on delivery?", five conditions; enforced in `app/api/public/order/route.ts`, the boundary) · `lib/actions/shipping.ts` (`getStoreServices`/`saveStoreServices` → the merchant's **per-service** picks in `store_shipping_methods`; `getCodEnabled`/`setCodEnabled` → `store_settings.cod_enabled`) · `components/admin/pengaturan/jasa-kirim-card.tsx` (the Pengiriman UI: service list with COD badges + the COD switch) · `app/api/public/ongkir/route.ts` (live rates ∩ platform-enabled couriers ∩ picked services, each labelled with the **effective** COD flag).

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

**Its own two API routes — the storefront's only writes**, both tenant-resolved from the `Host` header (`Astro.locals.store`), never from the body, and both **fail quiet** (204 + an `x-…` reason header) because a broken beacon must never break a working page:

| Route | Writes | Guards |
|---|---|---|
| `POST /api/track` | `analytics_events` | bot-UA reject · 30/min/IP |
| **`POST /api/checkout-session`** | **`checkout_sessions`** — progressive capture **as the shopper types** (debounced beacons from `checkout.astro`), upsert on `(store_id, session_id)`, `step` only ever moves **forward**, a `pulih` row is never resurrected. Also carries the opportunistic **`aktif → ditinggal` sweep** (60 min of silence, ≤ once/min per SSR process — **no cron**) | bot-UA reject · 60/min/IP |

`src/lib/recovery.ts` re-exports `@tokophi/lib/recovery` and **verifies** the signed recovery link (`/checkout?r=…`): an HS256 JWT `{sid, st}` (jose), store-bound, 7-day expiry, secret `CHECKOUT_RECOVERY_SECRET ?? AUTH_SECRET`. Deliberately **not** a raw session id — that would be a bearer credential over a stranger's name, phone and address the moment the link is forwarded or leaks via `Referer`. `/api/public/order` flips the session to `pulih` + `recovered_at` when it becomes an order.

> ✅ **The mint now has a caller (2026-08-03) — and the reason it never did is worth keeping.**
> This line once read "mints/verifies" and that half was false for the life of the feature:
> `signRecoveryToken` lived in `apps/storefront/src/lib`, **which the admin cannot import**, so it had
> ZERO callers in all four apps. Every downstream piece — `verifyRecoveryToken`, the "Selamat datang
> kembali" banner, the basket restore, the field pre-fill — was live code nothing could reach, and four
> docs recorded it as working. The pair moved to **`packages/lib/src/recovery.ts`** so both surfaces can
> reach it; `apps/admin/lib/data/checkout.ts#getAbandonedCarts` mints one per cart with a phone and
> `lib/cart-message.ts#cartMessage` puts it in the WhatsApp body.
> ⚠️ **Keep the pair in `packages/lib`.** Moving either half back into one app re-creates the exact gap.
> `apps/admin/lib/recovery-wired.test.ts` fails if the call disappears — a unit test cannot see a
> missing wire, because each half passes its own tests in isolation. See `REQUIREMENTS.md` SEC-13.

---

## 7. Data mapping (schema domains → SCHEMA.md)

**80 tables** (diukur ulang 2026-08-12 dari `packages/db/src/schema.ts` + `drizzle/meta/_journal.json` + keluaran `npm run verify-rls` — see `SCHEMA.md` §1). Domains: **identity** (accounts, stores, store_stats, users, store_users, locations) · **catalog** (products, product_media, product_options/variants, inventory_levels, collections + membership/conditions, **media**) · **suppliers/purchasing** · **orders/fulfillment** (orders, line_items, payments, immutable order finance, shipment bookings) · **customers/CRM** (customers — `registered_at` NULL = guest, **checkout_sessions** 0044/0045, segments, leads, followups, wa_templates) · **discounts** · **content** (pages, articles, menus, **page_templates** ADR 0009) · **marketing/analytics** · **platform**.

**RLS** (`0012`) on **52 of 53** store-scoped tables, enforced under `tokophi_app`; the deliberate exception is `platform_activity`. Owner exceptions: auth, super-admin, storefront, `/api/public/*`, cron.

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
**Conversion tracking, attribution & catalog feeds (ADR 0011 / 0012 / 0013):**
`packages/lib/src/tracking-ids.ts` is the **ONE** definition of a catalog id — `retailerId()` /
`itemGroupId()` / `purchaseEventId()`. The feeds, the storefront pixel and the CAPI sender all call it;
two copies of this rule is how a merchant's catalog silently splits in half ·
`apps/admin/lib/tracking-events.ts` (`enqueuePurchase` / `releasePurchase` / `purchaseFacts` — the ONE
place a conversion becomes a job, built from the COMMITTED ORDER, never from the request) ·
`apps/admin/lib/capi.ts` (the three provider senders + `sanitize`; Meta Graph, GA4 Measurement Protocol,
TikTok Events API — hashing rules and the per-provider meaning of `value` live here) ·
`apps/admin/app/api/cron/tracking-events/route.ts` (the drain: retention → reconcile → claim → send →
verdict) · `apps/admin/lib/ad-channel.ts` (`adChannel()` → `orders.channel`, called from
`api/public/order`) · `apps/admin/lib/crypto.ts` (`INTEGRATION_TOKEN_KEY`, AES-256-GCM, AAD-scoped) ·
`apps/storefront/src/components/MarketingPixels.astro` (the browser half — fbq/gtag/ttq bootstrap + the
whole funnel; rendered by **Layout, CheckoutLayout AND LandingLayout**: a layout that forgets it is a
silent outage) · `apps/storefront/src/lib/product-feed.ts` + `src/pages/feed/{google,tiktok}.xml.ts`
(one builder, two profiles) · `apps/storefront/src/data/tracking.ts` (`storeTrackingPixels`, cached).

| **Single-plan billing + PPN** | `@tokophi/lib/billing` (`computeBilling`,`storeSegment`,`quote`,`withPpn`) · admin `lib/data/billing.ts` + `lib/actions/billing.ts` · `/akun/langganan` + `PaySubscription` + `/faktur/[number]` · cron `/api/cron/billing` |
| **Store lifecycle segments + VIP** | `stores.comped/compedReason/compedAt` + `store_stats.ship7dAvg` (migr 0026/0027) · super-admin `/toko` tabs + `/toko/[id]` control · `SegmentBadge` |
| **Two-level courier/payment** | platform_* tables · super-admin Pengaturan · client `payment-methods-card`/shipping · storefront ∩ filter |
| **Payment gateway fees** | `@tokophi/lib/payment-fees` · `store_settings.payment_fee_bearer` (migr 0028) · client `payment-fees-card` |
| **Support tickets (2-sided)** | `support_tickets`/`support_messages` (migr 0030) · admin `/bantuan` + `lib/actions/support.ts` · super `/tiket` + `data.ts`/`actions.ts` |
| **Media library + WebP** | `media` table (migr 0033) · `lib/actions/media.ts` (`saveImage` sharp→WebP, already-WebP kept pixel-perfect) · `/files` · `/api/uploads/[name]` · 2MB cap |
| **Store Builder (ADR 0009)** | `page_templates` (migr 0031/0032) · `stores.logo_url/brand_color` · `@tokophi/sections` · admin `/tema` (Puck) · storefront renderer · `@tokophi/lib/colors` |
| **Impersonation** | super `impersonateStore` (signed token) → admin `/impersonate` route (cookie exchange, relative-redirect) |
| **Payments (real)** | KiriminAja (shipping) + AutoLaris (VA/QRIS) — `@tokophi/lib/{kiriminaja,autolaris}` · pay callback `/api/public/pay/callback` |
| **Abandoned checkout + guest/registered customers** | `checkout_sessions` + `customers.registered_at/password_hash/last_order_at` (migr **0044**/**0045**) · storefront `src/pages/api/checkout-session.ts` (progressive capture + the `aktif→ditinggal` sweep) + `src/lib/recovery.ts` (signed `?r=` link) + `checkout.astro` (debounced beacons, `?r=` restore) · `/api/public/order` stamps `pulih`/`recovered_at` · admin `lib/data/checkout.ts` + `lib/actions/checkout.ts` (WA recovery → a `followups` row) · `/pelanggan/keranjang` + `components/admin/pelanggan/{account-badge,checkout-step-badge}.tsx` |

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
- **Migrations:** `packages/db/drizzle/` — current head **0094**. `npm run generate` after schema edits; migrate runs on deploy. ⚠️ **Write every migration idempotent** (`add column if not exists`, `create index if not exists`, `do $$ … exception when duplicate_object then null; end $$` for enums): drizzle applies the whole pending batch in ONE transaction, so a single "already exists" rolls back every migration behind it — on 2026-07-30 that left 16 unapplied on the shared dev DB and printed nothing anyone noticed.
- **Env** (Coolify): `DATABASE_URL`, `AUTH_SECRET`, `KIRIMINAJA_*`, `AUTOLARIS_*`, `CRON_SECRET`, `PUBLIC_APP_URL`, `ADMIN_URL`, `PUBLIC_ONGKIR_API`, `PUBLIC_ORDER_API`.
- **Deferred → prod:** uploads → MinIO/S3 (currently container volume, admin-served — storefront can't yet show *uploaded* product images, only seeded `/products/*.webp`) · email/WA comms (tickets/reminders audit-only now) · HTTPS + custom domain (tokophi.com in Cloudflare, DNS not pointed) · Hetzner migration (host-agnostic).
