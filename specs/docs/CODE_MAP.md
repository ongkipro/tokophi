# TokoΦ — Development Map (code · design · structure)

> The one-stop map of the codebase: where everything lives and how it connects. Pairs with
> `SCHEMA.md` (data model), `FLOWS.md` (**§5 = shipping end to end — read it before touching checkout**),
> `ARCHITECTURE.md` (why), `DEPLOY.md` (ops), `WORKLOG.md` (history).
> **Verified against the code and the DB on 2026-07-14.** Keep it in sync when you add a surface, package,
> table, or major feature.

---

## 1. Overview

TokoΦ is a **Shopify-style commerce SaaS for Indonesia** — Bahasa Indonesia UI, IDR. **Four** surfaces, one monorepo, one PostgreSQL. **Single-plan billing** (Rp275rb/mo + PPN 11%), all features unlocked. Provider brands (KiriminAja/AutoLaris) hidden from clients (white-label, ADR 0004).

| Surface | Package | Stack | Who uses it | Port (dev) |
|---|---|---|---|---|
| **admin** ("Seller") | `@tokophi/admin` | Next.js 16 (App Router, Turbopack) | a merchant/shop owner | 3000 |
| **super-admin** | `@tokophi/super-admin` | Next.js 16 | us (platform control plane) | 3001 |
| **storefront** | `@tokophi/storefront` | Astro **SSR** (`@astrojs/node` standalone) — ONE deploy, tenant from the `Host` header (ADR 0009) | shoppers | 4327 |
| **landing** | `@tokophi/landing` | Astro static — the apex front door | visitors | 4328 |

**The numbers, counted (not remembered), 2026-07-14:**

| | |
|---|---|
| Tables in `packages/db/src/schema.ts` | **68** |
| Migrations | **50** (`0000` … `0049`) |
| RLS | **43 of the 44 store-scoped tables** — every table with a `store_id` except `platform_activity` (our log *about* tenants) |

> ⚠️ The **shared dev DB reports 69 tables / 44 RLS** because an unmerged branch's `color_palettes` migration
> has been applied to it. Count against `schema.ts` on `main`, not against the shared container, or you will
> keep "discovering" a table that is not in the codebase.

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
| `db` | `db`, `client`, `schema` (**68 tables**), `drizzle/` (**0000–0049**), `seed.ts`, `seed-areas.ts`, `verify-rls` | **server-only** (`postgres` is a serverExternalPackage). `withTenant`/`withCurrentTenant` live in each app's `lib/tenant.ts`, not here. **Two landmines live here — see §12.** |
| `lib` | `./billing` (pricing, `computeBilling`, `storeSegment`, `withPpn`), `./format` (IDR/num), **`./couriers`** (the courier POLICY — ADR 0010), `./kiriminaja`, `./autolaris`, `./validate` (`normalizePhone` → canonical `62…`, name/address/email/postcode), `./payment-fees` (display only — **zero importers**), `./integration-status`, `./totp`, `./cache`, `./colors` | Pure/shared. `kiriminaja`/`autolaris` are `server-only`. |
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
| Analitik / Pemasaran | `/analitik`, `/pemasaran` | analytics, marketing | — |
| Toko Online | `/halaman`,`/blog`,`/navigasi`,**`/files`**,`/tema` | pages, articles, menus, **media**, theme | `pages.ts`,`articles.ts`,`menus.ts`,**`media.ts`**,`theme.ts` |
| **Akun** | `/akun/{profil,keamanan,langganan}` | billing (`getBilling`,`getMyInvoices`) | `profile.ts`,`security.ts`,`billing.ts` |
| **Bantuan** | `/bantuan`(+`/[id]`) | — | `support.ts` |
| Faktur (print) | `/faktur/[number]` (outside `(admin)`) | billing (`getFaktur`) | billing (`getInvoicePayment`) |
| Pengaturan | `/pengaturan` | shipping/payment-settings reads | `shipping.ts`,`payment-settings.ts` |
| Uploads serving | `/api/uploads/[name]` (public) · `/api/cron/billing` · `/api/public/pay/callback` · `/impersonate` | — | — |

**Auth/RBAC/tenancy:** `lib/auth.ts` (jose JWT session), `lib/rbac.ts` (`requireCapability`) + `lib/rbac-policy.ts` (role→cap matrix, client-safe), `lib/tenant.ts` (`withTenant`/`withCurrentTenant` → `tokophi_app` role + `app.store_id` GUC → RLS). `middleware.ts` = edge JWT gate.

### 4.1 Shipping & COD — the single-owner files

**Full flow: [`FLOWS.md` §5](./FLOWS.md#5-shipping-end-to-end--address-cascade--quote--snapshot--booking--label). Read it before touching any of these.**

> **Kecamatan PRICES the parcel. Kelurahan BOOKS it.** `shipping_price` accepts village ids and **ignores
> them** — tariffs are kecamatan-level. The kelurahan is for `request_pickup` and the label. **Do not add
> village ids to the pricing call.**

| File | Owns |
|---|---|
| `lib/shipping-quote.ts` | **THE ONE PLACE A SHIPPING PRICE IS PRODUCED** (`quoteShipping`, `findRate`). Both `/api/public/ongkir` *and* `/api/public/order` call it — two copies would be two prices, and the one the order keeps decides what the merchant is paid. Origin = `store_settings.sender_kecamatan_id`; weight = the DB; scope = (platform-enabled) ∩ (the seller's per-service picks). **Always names the couriers** in the KiriminAja call (unfiltered = 5.513 ms / 18 services; named = 512 ms / 14). |
| `lib/cod.ts` | **THE ONE PLACE COD IS DECIDED** (`getCodPolicy`, five conditions). Enforced in `/api/public/order` — **that endpoint is the boundary**; hiding the option in the storefront is UX. Never `if (courier === "spx")`: widening COD is a data change (`codAllowed`). |
| `lib/shipping-weight.ts` | `weightForCart` — Σ `product_variants.weight_grams`. NULL → 500 g fallback, **reported** in `weightFallback[]`, never silent. 1 kg billable minimum. `body.weight` **does not exist** in the request any more. |
| `lib/data/areas.ts` | `resolveArea` · `areaById` (kota/provinsi **derived** from the district id) · `kelurahanOptions` (KiriminAja first, local `kelurahan` table as the `id:null` fallback) · `verifyKelurahan` (a client-supplied village id is **proven against the destination district** or dropped to NULL). |
| `lib/address.ts` | `composeAddress` — de-duplicating address composition, used by **both** the seller's pickup card and `createShipment`, so the screen cannot disagree with the parcel. |
| `lib/actions/shipping.ts` | `createShipment` (books with the order's **snapshot ids**, `destinationGuessed` warning on the legacy city-name fallback) · cancel · track · `saveStoreServices` · `setCodEnabled`. |
| `packages/lib/src/couriers.ts` | **The courier POLICY** (ADR 0010): `SELLER_COURIER_CODES` (8) · `BASELINE_COURIER_CODES` = **spx, jne** (a seller cannot switch them off — ⚠️ courier-level in code, **service-level** in policy: only the *standard* service is meant to be locked) · `PRIMARY_CHAIN` · the instant-courier guard. |
| `lib/courier-coverage.ts` | **"Enabled" ≠ "available".** Probes, per courier, whether it actually collects from *this store's* pickup district (`kaCoverage`). **UNKNOWN is first-class** — no pickup address or a failed probe renders no coverage claim, and a failure is never cached as "does not collect". |
| `packages/lib/src/kiriminaja.ts` | The client. ⚠️ **Version prefixes VARY per endpoint:** `shipping_price` **v6.1** · `request_pickup` **v6.1** · `get_address_by_name` **v2** · `cancel_shipment` **v3** · `kelurahan` / `province` / `tracking` **unversioned**. |

**Order snapshot (0042 + 0049):** `orders.ship_recipient / ship_phone / ship_address / ship_district_id / ship_kelurahan_id / ship_kelurahan_name / ship_postcode`. The shipment is booked with **those exact ids** — the old code re-resolved the destination from the free-text city name and could book a parcel to the wrong district.

**The roster is a UNION of 4 reference routes** (`ROSTER_ROUTES` in `packages/lib/src/kiriminaja.ts`) — KiriminAja has no list-couriers endpoint, and a single lane once hid TIKI entirely.

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

`src/lib/recovery.ts` mints/verifies the **signed** recovery link (`/checkout?r=…`): an HS256 JWT `{sid, st}` (jose), store-bound, 7-day expiry, secret `CHECKOUT_RECOVERY_SECRET ?? AUTH_SECRET`. Deliberately **not** a raw session id — that would be a bearer credential over a stranger's name, phone and address the moment the link is forwarded or leaks via `Referer`. `/api/public/order` flips the session to `pulih` + `recovered_at` when it becomes an order.

---

## 7. Data mapping (schema domains → SCHEMA.md)

**68 tables** (verified from the catalog — see `SCHEMA.md` §1). Domains: **identity** (accounts, stores, store_stats, users, store_users, locations) · **catalog** (products, product_media, product_options/variants, inventory_levels, collections + membership/conditions, **media**) · **suppliers/purchasing** · **orders/fulfillment** (orders — incl. the **`ship_*` address snapshot** 0042/0049, line_items, payments, fulfillments) · **customers/CRM** (customers — `registered_at` NULL = guest, **checkout_sessions** 0044/0045, segments, leads, followups, wa_templates) · **discounts** · **content** (pages, articles, menus, **page_templates** ADR 0009) · **marketing/analytics** · **platform** (plans[legacy], invoices, platform_activity, platform_admins, platform_payment_gateways/channels/cod, platform_couriers, shipping_aggregator) · **support** · **chat** · **shipping reference** (`kiriminaja_areas` **7.030** kecamatan · `kelurahan` **78.764** villages, BPS/Kemendagri codes — see below) · **settings** (store_settings: couriers[], `cod_enabled`, `sender_kecamatan_id`/`sender_kelurahan_id`/`sender_zip`, tax; `payment_channels[]`/`payment_fee_bearer` are **dead columns**).

> ⚠️ **The `kelurahan` table's ids are BPS/Kemendagri codes (`34.02.13.2004`), NOT KiriminAja ids (`31483`).**
> **They are not bookable.** Only ids from the live API (`POST /api/mitra/kelurahan`) can be booked. The local
> table is a name + kodepos fallback only.

**RLS** (`0012`, extended by 0032/0035/0036) on **43 of the 44 store-scoped tables**, enforced under `tokophi_app` — `checkout_sessions` included, because a half-typed checkout carries a name, a phone and an address. Sole store-scoped exception: `platform_activity`. Owner exceptions by design: auth, super-admin, storefront, `/api/public/*`, cron.

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
| **Shipping, kelurahan-precise** | `lib/shipping-quote.ts` · `lib/cod.ts` · `lib/shipping-weight.ts` · `lib/data/areas.ts` · `lib/address.ts` · `lib/actions/shipping.ts` · `@tokophi/lib/{couriers,kiriminaja}` · migrations **0042** (`ship_*` snapshot) + **0046** (`kelurahan` ref table) + **0049** (`ship_kelurahan_id/_name`, `sender_zip`) — **see §4.1 + FLOWS §5 + ADR 0010** |
| ~~**Payment gateway fees**~~ | **DOES NOT EXIST.** `@tokophi/lib/payment-fees` has **zero importers** and is display-only; `store_settings.payment_fee_bearer` + `payment_channels` are **dead columns** (kept, not dropped) and the client "Pembayaran" tab that wrote them was removed 2026-07-13 — nothing ever read either value. If a fee-bearer feature is wanted it must be **built into checkout pricing**, not merely stored. |
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

- **Live on `tokophi.com`** (since 2026-07-13): `tokophi.com`/`www` = landing · `app.` = admin · `rich.` = super-admin · `toko.` = demo store · **`<slug>.tokophi.com` = that merchant's storefront** (ONE container serves every store; tenant from the `Host` header, ADR 0009). Host: Vultr Singapore + **Coolify v4** (Docker Compose build pack). Deploy = push `main` → Coolify. ⚠️ Every DNS record must stay **Cloudflare-proxied** — the wildcard TLS is a Cloudflare **Origin CA** cert, which browsers do not trust directly. See `DEPLOY.md`.
- **Compose** (`docker-compose.coolify.yml`): `postgres` (volume `tokophi-pgdata`) + one-off `migrate` (drizzle migrate + **idempotent seed**, `SEED_FORCE=1` to force) + `admin` (volume `tokophi-uploads`) + `super-admin` + `storefront` + `landing` (**no DB, no `depends_on`** — it must serve even when the rest is down) + `cron` (daily billing) + `backup` (daily `pg_dump -Fc`, keeps last 7).
- **Migrations:** `packages/db/drizzle/` — current head **0049**. `npm run generate` after schema edits; migrate runs on deploy.
- **Env** (Coolify): `DATABASE_URL`, `AUTH_SECRET`, `KIRIMINAJA_*`, `AUTOLARIS_*`, `CRON_SECRET`, `PUBLIC_APP_URL`, `ADMIN_URL`, `PUBLIC_ONGKIR_API`, `PUBLIC_ORDER_API`, `CHECKOUT_RECOVERY_SECRET`.
- **Deferred → prod:** uploads → MinIO/S3 (currently a container volume, admin-served) · email/WA comms (tickets/reminders are audit-only) · `KIRIMINAJA_ENV=production` (**it defaults to `sandbox` — an unset env in production silently talks to the sandbox and books no real parcels**) · Hetzner migration (host-agnostic).

---

## 12. ⚠️ Two shared landmines in `packages/db`

Both cost a working day; both are invisible until something downstream is silently broken.

1. **`npm run seed` used to WIPE the 78k-row `kelurahan` reference table.** It was missing from `truncateAll()`'s
   keep-list (next to `kiriminaja_areas`), so every reseed silently killed the checkout's kodepos auto-fill until
   someone re-ran `seed:areas`. Fixed — **keep it in the keep-list.**
2. **A migration whose journal `when` is stamped in the FUTURE makes drizzle SKIP later migrations — while
   printing "migrations applied successfully".** `drizzle-kit` applies a migration only when
   `folderMillis > max(created_at)`. `0048`'s `when` is `1784106162290` (in the future), so a truthfully-stamped
   `0049` was skipped **silently**. `0049` bumps its `when` above it. **Anyone adding `0050` must check
   `packages/db/drizzle/meta/_journal.json` and do the same** until `0048` is corrected. A silent data-loss trap.

**And one process trap:** local `main` was once ~90 commits behind `origin/main`, and a session built a duplicate
"foundation" on the stale base — conflicting column names, and a migration that never applied.
**`git fetch && git log origin/main` before starting anything.**
