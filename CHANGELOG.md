# Changelog — TokoΦ

All notable changes. Dates are absolute. Phase: local backend done (Postgres + Drizzle, RBAC + RLS enforcing) · **rebranded to TokoΦ 2026-07-08** · focus = admin-client feature depth (VPS infra deferred).

## 2026-07-08

### Super Admin — store healthcheck + impersonation (connected to admin)
- **Multi-store seed**: 6 demo stores added alongside Batik Nusantara (accounts + owners + stats + invoices + orders), engineered for a realistic health spread (2 sehat / 2 perhatian / 3 bermasalah). The whole platform view (dashboard, plan/status distribution, invoices) is now real cross-store data.
- **Composite healthcheck** (`apps/super-admin/lib/health.ts`) — per-store verdict (Sehat/Perhatian/Bermasalah) + 0–100 score derived from DB signals: billing (overdue/failed invoices), activity (order recency), stock (out-of-stock products), subscription status. No live pings (single-machine local).
- **UI**: Toko list gets a Kesehatan column + health filter + Sehat/Perhatian/Bermasalah stat cards; store detail gets a Healthcheck panel (per-check breakdown + score bar); dashboard gets a "Kesehatan Platform" rollup + "Perlu perhatian" list.
- **Impersonation ("Buka panel admin")** — super-admin mints the admin session cookie for a store's owner (`lib/session.ts` + `lib/actions.ts`, shared `AUTH_SECRET`, localhost host-scoped cookie) and opens the admin (:3000) scoped to that store via RLS. Verified end-to-end (admin serves the impersonated owner, not Batik Nusantara). Admin app untouched.
- **Store lifecycle actions** — suspend/activate + change plan (super-admin's first mutations, owner connection cross-tenant). `verify-rls` still green; super-admin + admin builds clean; console-clean.

### Super Admin — functional control plane (provisioning, settings persistence, team, billing)
Audit found several read-only / fake-save surfaces; all now real writes (each gated by `requirePlatformAdmin()`), in `lib/actions.ts`:
- **Provisioning `createStore()`** — "Tambah toko" on the Toko page onboards a full tenant in one transaction (account + owner user + store + membership + location + settings + zeroed stats), status **Trial**, slug auto, owner password `tokophi123`; redirects to the new store. Was entirely missing.
- **Settings persistence `saveGateways()`/`saveCouriers()`** — the Pengaturan payment-gateway & courier toggles + Simpan now write `platform_payment_gateways`/`platform_couriers`/`platform_cod` (were `toast`-only fakes).
- **Platform team = real operators** — Tim Platform now reads `platform_admins` (`getPlatformAdmins()`) instead of a hardcoded array; "Undang" (`invitePlatformAdmin()`) inserts a real operator row.
- **Billing actions `setInvoiceStatus()`** — Paket invoice rows get a Tandai dibayar/menunggu/gagal menu (was display-only).
- Verified E2E (Playwright + DB): create store → trial store + owner persisted; toggle Duitku → `enabled=true`; invite → `platform_admins` row; mark INV-9006 → `dibayar`. Console-clean; reseeded to a pristine 7-store state.

### Super Admin — platform-admin auth (gaps closed) + impersonation-correct admin
- **Platform-admin auth**: `platform_admins` table (migration 0013) + seeded **admin@tokophi.id / tokophi123**; `lib/platform-auth.ts` uses a **distinct `platform_session` cookie** (separate from the admin `session` it mints for impersonation); login page + `signIn`/`signOut` + `middleware.ts` route protection. `requirePlatformAdmin()` now **gates** `impersonateStore`/`setStoreStatus`/`setStorePlan` (the earlier "unguarded" follow-up is resolved). Layout split into a server layout (reads session) + client `PlatformShell` (account menu + logout).
- **Admin reflects the session store**: `apps/admin/lib/data/store.ts getStoreName()` → the admin topbar store-switcher + dashboard greeting now show the *actual* store (so impersonating "Kopi Senja" shows Kopi Senja + owner Rangga + RLS-scoped data, not the hardcoded "Batik Nusantara"). Verified E2E via Playwright.
### Admin — full multi-store polish (store identity data-driven)
- **All "Batik Nusantara" identity hardcodes wired to the session store** via a `StoreProvider`/`useStoreName()` context (set once in the admin layout from `getStoreName()`): topbar store-switcher (now lists the active store only), dashboard greeting, **Pengaturan** (profile name + input), **product editor** vendor default, and **CRM** WhatsApp message fills (`crm/page` server-fetched; pipeline/followup via context/param). Verified impersonating Kopi Senja → Pengaturan + CRM show "Kopi Senja", zero "Batik Nusantara" leak.
- **NaN% fixed**: empty-store channel donut now shows `0%` instead of `NaN%` (guarded divide-by-zero in `channel-chart.tsx`).
- **Live activity feed is now real & per-store** (`lib/data/activity.ts getActivityFeed()`, RLS-scoped): derived from the store's own recent orders, signups, reviews, and low-stock — replacing the static mock. Verified impersonating Kopi Senja → feed shows its 3 orders ("Pelanggan dari Bandung…"), zero Batik product leak. (The "N pengunjung online" ticker stays a decorative realtime widget.)

### Rebrand: indostore → TokoΦ
- Full rename across the monorepo: display brand **TokoΦ** (φ symbol); identifiers `tokophi` (folder, npm scope `@indostore/*` → `@tokophi/*`, root pkg).
- **DB:** role `indostore_app` → `tokophi_app`; docker container/volume + Postgres user·pass·db → `tokophi`; `DATABASE_URL` updated. Owner login is now **ongki@batiknusantara.id / tokophi123**.
- Folder `~/projects/indostore` → `~/projects/tokophi` (git history kept); docs `~/Documents/Development/tokophi`. New **private** repo `ongkipro/tokophi` (old `ongkipro/indostore` abandoned).
- Added a **TokoΦ (Φ) favicon** (`app/icon.svg`, indigo) for admin + super-admin, replacing the create-next-app defaults.
- Verified: `migrate` + `seed` + `verify-rls` pass under `tokophi_app`; admin·super-admin·storefront build clean. Zero residual "indostore" across repo **and** external docs.

## 2026-07-04

### RLS runtime enforcement (local) — admin runs as the non-owner role
- **`apps/admin/lib/tenant.ts`** — `withCurrentTenant(fn)` (reads the session → runs inside `withTenant`) + re-exports `withTenant`. Every tenant query now runs in a transaction that sets `app.store_id` + `SET LOCAL ROLE tokophi_app`, so Postgres RLS **actually enforces at runtime** (the app process still connects as owner, but each tenant query drops to the restricted role — the exact VPS/PostgREST model).
- **All 14 admin `lib/data/*` reads** wrapped in `withCurrentTenant`; **all 13 `lib/actions/*` writes** wrapped in `withTenant(session.storeId, …)` (store_id from the RBAC session). `lib/auth.ts` (login, reads `store_users` pre-session) + super-admin (cross-tenant) + storefront (per-client build) intentionally stay on the owner connection.
- **`npm run verify-rls-app`** proves the actual `withTenant` path: own tenant reads its rows + writes/reads-back its own discount; a foreign tenant sees 0 of either; `WITH CHECK` blocks cross-store writes; cleanup ok. Playwright E2E: all admin pages render their data (customers 24 / inventori 14 / diskon 6 / …) with zero errors, and an in-app customer-note write persists — all through the restricted role. `build:admin`/`build:super`/storefront all clean.

### RBAC UI — role-aware controls
- **Client-safe policy** (`lib/rbac-policy.ts`) — the role→capability matrix + `can()` extracted so the UI and the server guard (`lib/rbac.ts`) share ONE source of truth.
- **`PermissionsProvider` + `useCan()` + `<Can>`** (`components/admin/permissions.tsx`) — role flows from the session (layout) to client components; the topbar shows a role badge (Pemilik/Admin/Staf/Gudang).
- **Gated across ALL admin editors** (write/delete/create controls hidden per role; server actions stay the security boundary): Produk (list+editor), Pengaturan (owner-only), Diskon, Halaman, Blog, Kategori (editors + list CTAs + row Hapus), Pelanggan (tag/catatan save), CRM follow-up (Tandai selesai), Segmen (Buat/Hapus), Pembelian (Buat PO / terima / batalkan), Inventori (Simpan stok), Navigasi (Simpan menu), Pesanan (advance status).
- **Verified** via Playwright across roles (owner/staff/gudang): e.g. Produk owner sees Simpan+Hapus, staff Simpan-only, gudang neither+no media; Diskon Buat = staff✓/gudang✗; Inventori & Pembelian = staff✗/gudang✓; owner all✓.

### M3 — RBAC + Row-Level Security (tenant isolation)
- **RBAC (`apps/admin/lib/rbac.ts`)** — capability model + role→capability matrix (owner=all · admin=all−settings · staff=shop ops (no product-delete / warehouse / settings) · gudang=inventori+pembelian only). `can(role, cap)` + `requireCapability(cap)` (returns the session JWT or throws `ForbiddenError`).
- **All 13 mutating action files gated** (`lib/actions/*`) — each mutation calls `requireCapability(...)`; store-scoped creates now take `store_id` from the session (removed the per-file "first store" helper).
- **RLS migration `0012_tenant_rls`** — non-owner `tokophi_app` role + grants, `app_current_store_id()` GUC reader, and `ENABLE ROW LEVEL SECURITY` + `tenant_isolation` policy (`USING` + `WITH CHECK` on `store_id`) across all **32 store-scoped tables**. Registered in the drizzle journal so `npm run migrate` applies it.
- **`withTenant(storeId, fn)`** (`packages/db/src/rls.ts`) — per-txn `set_config('app.store_id', …, true)` + `SET LOCAL ROLE tokophi_app`; ready for the VPS switch.
- **`npm run verify-rls`** proves isolation: right tenant → 14 products, wrong/no-GUC tenant → 0 (fail-closed), cross-tenant INSERT blocked by `WITH CHECK`. Verified; `build:admin` clean.
- At this stage RLS was policy-only (app connected as owner, bypassing it). **Superseded the same day** by the "RLS runtime enforcement" entry above — the admin now routes every read/write through `tokophi_app` via `withTenant`, so RLS enforces live. RBAC (app-layer) is enforced.

## 2026-07-03

### M3 — backend: local Postgres + Drizzle, super-admin live
- **Decision: prod backend = self-hosted PostgreSQL + PostgREST on a VPS (NOT Supabase).** Local dev already plain Postgres → same Drizzle migrations carry up, no rework. Reframed all docs + ADR 0007 + `.env.example` (dropped `NEXT_PUBLIC_SUPABASE_*`); Auth (JWT) / Storage (VPS/MinIO/S3) / RLS are self-hosted.
- **`@tokophi/db`** (Drizzle): 52 tables + 32 enums from SCHEMA.md, versioned migrations (`drizzle/0000..0002`), seed + reset. Root `docker-compose.yml` = PostgreSQL 16 @ :5433. **ADR 0007**.
- **super-admin wired to PostgreSQL**: new server-only `lib/data.ts`; `lib/mock.ts` slimmed to config; client pages split (`*-client.tsx` + server wrapper); all DB pages `dynamic="force-dynamic"`. Verified: build clean + parity + live-mutation test.
- **Schema deltas** for a faithful platform view: `stores.city`, `store_stats` rollup, `invoices.number`; `menu_items.parent_id` self-FK.
- **Per-client topology decided** — **ADR 0008** (one control plane + one multi-tenant admin + storefront-per-client on one shared DB). Docs refreshed: PRD, ARCHITECTURE (§9–10), UML (§1/§10 + provisioning sequence), SCHEMA, WORKLOG.
- **admin → DB (Produk)**: seeded catalog (14 products + variants/inventory/media, migration 0003 adds `products.emoji`/`units_sold`, `collections.emoji`); `apps/admin/lib/data/products.ts` (`getProducts`/`getProduct`); Produk list + editor now `force-dynamic` from Postgres (uuid routes). Verified parity + 0 console errors.
- **admin → DB (Diskon/Pelanggan/Kategori)**: seeded 24 customers, 6 discounts, 8 collections + 32 memberships; `lib/data/{discounts,customers,collections}.ts`; 6 more routes wired (list + detail/editor, server-wrapper + `*-client.tsx`, `force-dynamic`). Discount status/endsInDays + collection counts derived. Verified parity + 0 console errors.
- **admin → DB (Pesanan/orders)**: seeded 60 orders + 153 line-items + 60 payments (buildOrders parity, linked to customers/variants); `lib/data/orders.ts` (`getOrders`/`getOrder`); Pesanan list + detail wired (`/pesanan/INV-4819`, `force-dynamic`). Verified parity + 0 console errors.
- **admin → DB (Halaman/Blog)**: migration 0004 (`pages.template`/`views`, `articles.comments`); seeded 7 pages + 2 blogs/6 articles; `lib/data/{pages,articles}.ts`; Halaman + Blog list + editors wired (`force-dynamic`). Verified parity + 0 console errors.
- **admin → DB (Inventori/CRM)**: Inventori reuses `getProducts`; migration 0005 (`followups.last_message`); seeded 12 leads + 10 followups + 6 wa_templates; `lib/data/crm.ts`; 5 routes wired (Inventori + CRM overview/Follow-up/Pipeline/Template). Verified parity + 0 console errors.
- **admin → DB (Pembelian/Segmen/Ulasan)**: migration 0006 (`customer_segments.growth`, `reviews.product_name`/`emoji`); seeded 4 suppliers + 6 POs + items, 6 segments, 8 reviews; `lib/data/{purchases,segments,reviews}.ts`; 3 routes wired. Verified parity + 0 console errors.
- **admin → DB (Navigasi)**: seeded menus/menu_items (recursive, 2 menus / 17 items from canonical MAIN_MENU/FOOTER_MENU); `lib/data/menus.ts` reconstructs the `NavMenu[]` tree from flat menu_items; Navigasi builder wired (`force-dynamic`). Verified parity + 0 console errors.
- **admin → DB (Dashboard/Analitik)**: new `analytics_daily` rollup table (migration 0007) seeded with the 120-day series; refactored `lib/data/dashboard.ts` to pure functions (data passed in) + `lib/data/analytics.ts`; Dashboard + Analitik split into server-wrapper + `*-client.tsx` (`force-dynamic`), reading daily-stats/products/orders from DB (live-feed + funnel/region/ROAS breakdowns kept mock). Verified parity + 0 console errors.
- **admin → DB (Pemasaran) — ADMIN NOW 100% DB-BACKED**: migration 0008 (`ad_channels` +name/brand/pixel/aggregate/`campaigns` jsonb; `ad_metrics.channel_key` nullable); seeded 3 ad-channels + 11 per-province rollup rows; `lib/data/marketing.ts` (`getAdChannels`/`getProvinceStats`); Pemasaran split (server-wrapper + `pemasaran-client.tsx`, `force-dynamic`), sub-tabs threaded with props. Verified parity + 0 console errors. **All 16 admin modules read PostgreSQL** (53 tables).
- **Local media upload (product images)**: `lib/actions/media.ts` — `uploadProductImage` writes real files to `apps/admin/public/uploads/` (gitignored, 5MB image cap) + inserts a `product_media` row; `deleteProductImage` removes the row + file. Seed now loads 5 media rows/product (base + `-2..-5`); `getProduct` returns `media[]`; product editor Media section shows the real rows with an "Unggah" button + per-image delete. Verified via UI (upload → 5→6 tiles + row + file; delete → 6→5 + gone). VPS storage = MinIO/S3 later.
- **Local admin auth (login + session + route protection)**: migration 0011 (`users.password_hash`, scrypt); seeded owner **ongki@batiknusantara.id / tokophi123**. `lib/auth.ts` (verify/findLogin/jose-JWT session in httpOnly cookie), `lib/actions/auth.ts` (signIn/signOut), `app/login/page.tsx`, `middleware.ts` (edge JWT check → `/login`). Topbar shows the user + logout. Verified: unauth→/login, wrong-pw error, login→dashboard, logout. `AUTH_SECRET` env. Aligns with the VPS/PostgREST JWT plan; RBAC+RLS next.
- **Mutations — Pembelian PO builder · ALL ADMIN EDITORS NOW PERSIST**: `lib/actions/purchases.ts` — `createPurchaseOrder` (line items → `purchase_orders`+`po_items`), `receivePurchaseOrder` (status→diterima + adds each line qty to `inventory_levels`), `cancelPurchaseOrder` (delete). Rebuilt the PO dialog into a real line-item builder (product picker + qty + HPP + live total); wired row "Tandai diterima"/"Batalkan". Verified via UI (create PO ×7 → receive → stock 22→29 → cancel). **All 12 admin editors now persist writes** via server actions.
- **Mutations — CRM follow-up + Segmen persist**: `lib/actions/{crm,segments}.ts` (`"use server"`). CRM "Tandai selesai" writes `followups.status`; Segmen "Buat segmen" dialog creates a `customer_segments` row + card "Hapus" deletes it. Verified via UI (follow-up selesai 1→2; segment create + delete). **11 write operations now persist.** (Pembelian PO deferred — needs a real line-item builder.)
- **Mutations — Navigasi menu + Pelanggan tags/notes persist**: `lib/actions/{menus,customers}.ts` (`"use server"`). Navigasi "Simpan menu" replaces the whole `menu_items` tree (delete + recursive re-insert with parent_id/position); Pelanggan detail persists tags/notes (migration 0010 added `customers.tags` jsonb + `notes`, seeded `tags=["pelanggan",<segment>]`, added a Simpan button). Verified via UI (delete Kontak → 12→11 items; add tag/note). **9 write operations now persist.**
- **Mutations — order status + Inventori stock + Kategori persist**: `lib/actions/{orders,inventory,collections}.ts` (`"use server"`). Order detail's primary action advances status (baru→diproses→dikirim→selesai); Inventori tracks dirty rows + a "Simpan N perubahan" button writes stock to `inventory_levels`; Kategori editor persists the core collection (create/edit/delete). Verified via UI (INV-4789→diproses, stock 22→27, collection create+delete). **7 write operations now persist.**
- **Mutations — Diskon + Halaman + Blog create/edit/delete persist**: `lib/actions/{discounts,pages,articles}.ts` (`"use server"`) → Drizzle + `revalidatePath`; each editor's Simpan/Hapus wired (`useRouter`/`useTransition`). Diskon maps status+period→dates; new articles go to the store's first blog. Hard delete (no history FK). Verified via UI (create discount/page/article + delete). 4 editors now persist (Produk + these 3).
- **Mutations — Produk create/edit/delete persist**: `apps/admin/lib/actions/products.ts` (`"use server"`) → Drizzle insert/update on products+variant+inventory+media + `revalidatePath`; product editor Simpan/Hapus wired (`useRouter`/`useTransition`). Delete = archive (products referenced by order line-items); `getProducts` filters archived. Verified end-to-end via UI (create → edit price → delete). Establishes the write pattern for the remaining editors.
- **storefront → DB — ALL THREE SURFACES NOW READ POSTGRESQL**: migration 0009 enriches `products` (`sizes` jsonb, `badge`, `bestseller`, `rating_value`, `rating_count`) + seeds `description`/`compare_at`/collection blurbs; `apps/storefront/src/data/catalog.ts` rewritten to read `@tokophi/db` via top-level await (same exports → ~12 `.astro` consumers unchanged); `astro.config` surfaces `DATABASE_URL` + `ssr.external:["postgres"]`. `astro build` clean (29 pages from DB); home + product verified — 0 console errors, parity. **Reads are done end-to-end.** Next: mutations persist, self-hosted Auth + Storage + Postgres RLS.
- **docs perfected** — de-staled all docs to current backend state (no more "backend deferred / 51 tables / 9 modules"); AGENTS/PRD/ARCHITECTURE/GUIDE/UML/UI_INVENTORY/DATA_MODEL/TASKS/BACKLOG/README reflect 52 tables + super-admin + 12 admin modules; wiring pattern documented.
- storefront: product **ratings** (stars on cards + product-detail reviews summary) — data-driven from `catalog.ts`.

## 2026-07-01

### M1.5 — docs refresh + backlog
- Docs brought current (2026-07-02): PRD status/roadmap (+M1.5), README status, CONCEPT, UI_INVENTORY, and a new **BACKLOG.md** (prioritized P0–P3 task board from a full screening). AGENTS: ProductThumb/images/toast/Indonesian-slug conventions.

### M1 — Indonesian collection slug + product added-date filter
- Collection (Kategori) storefront slug is now Bahasa Indonesia: /kategori/ (was /collections/).
- Products carry a deterministic addedTs (date+time added). Product list shows "Ditambahkan <tgl>" on cards and a "Ditambahkan" column (date+time) in the table view, plus a date-range filter (Semua/7/30/90 hari). Helpers dateTimeShort/dateShort in lib/format.

### M1 — CRM (WhatsApp follow-up) + concept docs + channel model
- New CRM module (submenu): Overview, Follow-up WA (wa.me deep links + templates), Pipeline kanban, Template WA.
- Concept matured in docs/: CONCEPT.md, SCHEMA.md (backend-ready, proves backend-defer is safe), UI_INVENTORY.md.
- Channel model clarified: sales channel = Toko Online only; analytics attribution = Meta Ads / TikTok Ads / Google Ads / Organic / Other (Dashboard/Analitik "Sumber Penjualan", Pesanan "Sumber").

### M1 — Collection editor + SEO alignment
- Kategori upgraded to Shopify-style Collections: full editor at /produk/kategori/[id] (SSG) + /produk/kategori/baru — Manual/Otomatis type, automated conditions builder (all/any + field/operator/value), product members/preview, image, publish/channels/template, SEO. List rows -> editor; Buat kategori -> full page.
- SEO "Pratinjau mesin pencari" card moved into the main content column (col-span-2) across all 4 editors -> aligned with the content width, not full-width.

### M1 — Shopify-style submenus + province filter
- Sidebar submenus (expandable, auto-open in section): Produk → Kategori / Inventori / Pembelian; Pelanggan → Segmen / Ulasan. 5 new sub-pages (collections, inventory w/ stock stepper, purchase orders, customer segments, review moderation).
- Pemasaran: filter by Indonesian province (rescopes KPIs) + "Performa per Provinsi" table. Mock PROVINCES/AD_PROVINCES.
- Fix: DropdownMenuLabel -> plain <div> (Base UI Menu.GroupLabel threw "MenuGroupContext missing" when opened standalone) — fixes latent error across all dropdowns.

### M1 — Editor refinements
- SEO "Pratinjau mesin pencari" moved from the sidebar to a full-width card **below the content** in Blog/Halaman/Produk editors (Shopify-style; blog card renamed from "SEO").
- Product editor **"Tindakan lainnya" dropdown** (edit mode): Ubah kategori, Perbarui stok/inventori (set/tambah/kurangi + reason, live new stock), Buat pesanan pembelian (Purchase Order: pemasok/jumlah/biaya-unit/ETA + live total), + Duplikat/Arsipkan. Mock dialogs.

### M1 — Produk list UI/UX polish
- Status tabs w/ counts (Semua/Aktif/Draft/Stok Menipis) + clickable stat-card quick-filters; sort dropdown; active filter chips w/ clear.
- Bulk selection (grid hover-checkbox + list checkboxes) with a selection action bar (Jadikan Aktif/Draft, Hapus, Batal) + selected-row highlight.
- Richer grid cards (large image tile, price+stock inline, terjual count, Draft dim/overlay); refined list table (Kategori col, responsive).
- Mock: curated 2 drafts + 2 low-stock for meaningful tabs/badges. Console + build clean.

### M1 — Product editor
- **Full Shopify-style product editor** at `/produk/[id]` (edit, SSG per product via `generateStaticParams`) and `/produk/baru` (new): title + rich-text description, media, pricing (live margin/profit), inventory (SKU/barcode/qty + low-stock hint), variants toggle + builder, shipping, and sidebar (status Aktif/Draft, sales channels, organization/category/vendor/tags, SEO with Google preview + auto-slug). Delete in edit mode.
- Wired the Produk list: product cards + table rows navigate to the editor (stretched-link overlay so the ⋯ actions still work, console-clean); "Tambah Produk" now opens the full `/produk/baru` page (replaced the quick-add dialog). 31 routes; build + tsc + console clean.

### M1 — Marketing & analytics
- **Pemasaran** (new menu, Utama group) — ads + conversion tracking for **Meta / Google / TikTok**:
  - *Ringkasan* — blended spend/revenue/ROAS/conversions + spend-vs-revenue bar chart + channel comparison table (belanja/impresi/klik/CTR/CPC/konversi/pendapatan/ROAS).
  - *Saluran Iklan* — per-channel cards (connection status, ROAS/CPA, top campaigns, connect/manage).
  - *Pelacakan* — pixel/tracking setup (Meta Pixel + Conversions API, Google Tag GA4 + Google Ads conversion, TikTok Pixel + Events API).
- **Analitik expanded** — conversion funnel, sales by region (Indonesian cities), device split + new-vs-returning, and an ad-performance (ROAS) summary linking to Pemasaran.
- Mock added: `AD_CHANNELS`, `FUNNEL`, `REGION_SALES`, `DEVICE_SPLIT`, `NEW_VS_RETURNING`. 14 routes; build + tsc + console clean.

### M1 — Content section ("Toko Online")
- Screened real Shopify content structures via Shopify CLI (`shopify store execute`): `Page`, `Blog`/`Article`, `Menu` + `MenuItemType` enum — used to model the UI faithfully.
- **Halaman** — pages list + Shopify-style two-column editor (content, visibility, template, SEO Google-preview, auto-slug). Routes `/halaman`, `/halaman/baru`.
- **Blog** — posts list (blog tabs, authors, comments) + article editor (content, excerpt, featured image, tags, SEO). Routes `/blog`, `/blog/baru`.
- **Navigasi** — menu builder (Menu Utama/Footer, nested typed items, typed link picker, add/edit/delete in local state). Route `/navigasi`.
- Sidebar regrouped into `NAV_GROUPS` (Utama / Toko Online / Sistem).
- Mock data added: `PAGES`, `BLOG_POSTS` + `BLOG_CATEGORIES`, `MENUS` + `NavItem`/`NavMenu`/`NavItemType`.
- Fix: Base UI `nativeButton={false}` on `Button` rendered as `Link` (removed the dev-overlay "1 Issue" console error). Build + tsc + console all clean (13 routes).

### M1 — Core modules
- **Pesanan** — status tabs + counts, filters, table, detail Sheet (line items + timeline), pagination.
- **Produk** — stat cards, filters, grid/list toggle, product cards, add-product Dialog.
- **Pelanggan** — segment tabs, stat cards, sortable table, profile Sheet.
- **Diskon** — usage progress, status tabs, create-discount Dialog.
- **Analitik** — KPIs + sales trend + category bar chart + channel donut + top products (reuses dashboard components/data layer).
- **Pengaturan** — Tabs: Profil / Pembayaran / Pengiriman / Pajak / Pengguna (Indonesian couriers + e-wallets/QRIS/COD).
- Mock data extended: `CUSTOMERS`, `DISCOUNTS`.

### M0 — Scaffold + Dashboard
- Monorepo skeleton; `admin/` = Next.js 16 (App Router, Turbopack) + Tailwind v4 + shadcn/ui (Base UI) + Recharts + lucide + date-fns. Indigo brand accent.
- Admin shell: grouped sidebar, topbar (store switcher, search, notifications, account, dark-mode toggle), responsive drawer.
- **Dashboard** (flagship): KPI cards + SVG sparklines, Facebook-style date-range switcher (Hari ini/Kemarin/7d/30d/Bulan ini/Bulan lalu + compare-to-previous), sales area chart (current vs prev), live activity feed w/ realtime ticker, recent orders, top products, channel donut, order-status breakdown, monthly target.
- Deterministic seeded mock (`lib/mock/store.ts`, anchored `TODAY=2026-06-30`) + thin data layer (`lib/data/`) + `IDR`/id-ID formatting.

## Unreleased / next
- M2: sample Astro storefront; deepen admin interactions (submitting forms → state, detail pages).
- M3: self-hosted Postgres/PostgREST backend (auth + DB + RLS `store_id`) replacing the mock data layer.
- M4: payments/couriers integration, multi-store provisioning, storefront deploy pipeline.

## 2026-07-02 — Monorepo + Super Admin
- Restructured to a **monorepo** (npm workspaces): apps/admin + apps/super-admin + packages/ui (shared shadcn/Base UI) + packages/lib (formatters). Both apps build.
- **Super Admin** platform control plane (Dashboard/Toko/Paket & Billing/Analitik/Pengaturan) on the shared design system; 18 mock merchant stores; runs on :3001.
- Docs: AGENTS/README/PRD/BACKLOG updated for the monorepo + 3-surface model.
- Docs: PRD v0.3 (payments/shipping model + doc links), **UML.md** (Mermaid: components/ER/sequence/deployment/roles), **TASKS.md** (prototype task breakdown, Epics 0–6).
