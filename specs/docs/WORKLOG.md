# TokoΦ — Worklog (session log)

> Newest first. What we did + what's next, so any session can resume instantly.
> Pairs with `TASKS.md` (the plan) + `BACKLOG.md` (priorities). Repo: `github.com/ongkipro/tokophi` (private) — commit + push each increment.

## ▶ CURRENT STATE (2026-07-08) · REBRANDED indostore→TokoΦ · RBAC + RLS enforcing · Super-Admin healthcheck + impersonation done (multi-store) · next = admin-client depth (Real variants) &/or super-admin auth

**Everything runs locally on Linux** (Docker PostgreSQL 16 :5433 + Drizzle `@tokophi/db`, 53 tables, migrations 0000–0012). Done + verified end-to-end:
- **Reads:** all 3 surfaces (super-admin 5 pages + admin 16 modules + storefront) read Postgres.
- **Writes:** all **12 admin editors** persist via `lib/actions/*` server actions (Produk/Diskon/Halaman/Blog/Kategori CRUD · order-status · Inventori-stock · Navigasi · Pelanggan · CRM follow-up · Segmen · Pembelian PO create/receive→stock/cancel).
- **Auth (local):** email/password login → jose JWT httpOnly cookie, `middleware.ts` protects the admin (owner `ongki@batiknusantara.id / tokophi123`).
- **RBAC (local):** every mutating server action gates on a capability via `lib/rbac.ts` `requireCapability()` — role→capability matrix (client-safe in `lib/rbac-policy.ts`) for owner/admin/staff/gudang (role comes from the session JWT). Actions also derive `store_id` from the session. **UI:** `PermissionsProvider`/`useCan`/`<Can>` + topbar role badge; **ALL admin editors** hide their write/delete/create controls per role (Produk, Pengaturan, Diskon, Halaman, Blog, Kategori, Pelanggan, CRM, Segmen, Pembelian, Inventori, Navigasi, Pesanan).
- **RLS (local, ENFORCING at runtime):** migration `0012_tenant_rls` = `tenant_isolation` policy (`USING`/`WITH CHECK` on `store_id = app_current_store_id()`) on all **32 store-scoped tables** + non-owner `tokophi_app` role. **The admin now runs every query through `withTenant`** (`lib/tenant.ts`): all 14 `lib/data` reads via `withCurrentTenant` (session→GUC), all 13 `lib/actions` writes via `withTenant(session.storeId)` — each txn sets `app.store_id` + `SET LOCAL ROLE tokophi_app`, so RLS enforces live (the process connects as owner, but tenant queries drop to the restricted role). Auth (pre-session `store_users` read) + super-admin (cross-tenant) + storefront (per-client build) stay owner. **Verified**: `verify-rls` + `verify-rls-app` (the real withTenant path — read/write/isolation/WITH-CHECK) + Playwright E2E (all pages render, in-app write persists, 0 errors).
- **Media (local):** product image upload → `apps/admin/public/uploads/` + `product_media`.

**RBAC UI (ALL editors done):** `lib/rbac-policy.ts` (client-safe matrix) + `PermissionsProvider`/`useCan`/`<Can>` + topbar role badge; every admin editor gates its write/delete/create controls by role (verified via Playwright across owner/staff/gudang). Server actions stay the security boundary.

**▶ RESUME HERE (next session):** **admin-client feature depth** (user's focus; VPS deferred). Next pick = **Real variants** — schema already supports it (`product_options`, `product_variants` option1/2/3 + sku/price/cost, `inventory_levels` per variant/location); the gap is admin-only: the variant table in `apps/admin/app/(admin)/produk/[id]/product-editor.tsx` is UI-only (not wired/persisted), `lib/data/products.ts` reads only the default variant (position 0), and `lib/actions/products.ts` writes a single `Default` variant. Other admin backlog: `/pesanan/[id]` + `/diskon/[id]` detail routes, Tiptap rich-text, CSV export, de-dup admin → `@tokophi/ui`. (VPS + PostgREST + MinIO/S3 remains the later infra milestone.) Detail per-entry below (newest first).

## 2026-07-08 — Session: Super Admin healthcheck + impersonation ✅
- **Multi-store seed** (`packages/db/src/seed.ts` `DEMO_STORES`): +6 stores w/ engineered health spread (2 sehat / 2 perhatian / 3 bermasalah). Platform pages now show real cross-store data.
- **Healthcheck** (`apps/super-admin/lib/health.ts` + `health-types.ts`): composite verdict + score from billing/activity/stock/status signals (owner connection, cross-tenant). Wired into Toko list (column+filter+cards), store detail (panel), dashboard (rollup + perlu-perhatian).
- **Impersonation** (`lib/session.ts` mirrors admin's token contract + `lib/actions.ts impersonateStore`): "Buka panel admin" mints the admin `session` cookie for a store's owner (shared AUTH_SECRET, localhost cross-port) → admin scopes to that store via RLS. **Verified**: admin serves the impersonated owner (curl + Playwright, console-clean). Admin app unchanged.
- **Lifecycle**: `setStoreStatus`/`setStorePlan` (suspend/activate/change-plan) — super-admin's first writes. `verify-rls` green; builds clean.
- **Known gap**: super-admin has no auth → these actions are unguarded (gate before deploy).

## 2026-07-08 — Session: rebrand indostore → TokoΦ ✅
- Full rebrand (see CHANGELOG 2026-07-08): scope `@tokophi/*`, DB role `tokophi_app`, folder/repo `tokophi`, display brand **TokoΦ**, Φ favicon. Verified migrate/seed/verify-rls + 3-surface builds clean; zero residual "indostore" in repo + external docs.
- Decision: **focus shifts to the admin client** (merchant admin depth) before the VPS infra milestone.

## 2026-07-04 — Session: RBAC + local Postgres RLS ✅
**State before:** all reads + writes + local auth + local media done on local Postgres; paused at RBAC+RLS (single owner user).

**Done this session:**
- [x] **RBAC (`apps/admin/lib/rbac.ts`)** — capability model + role→capability matrix (owner=all · admin=all−settings · staff=shop ops, no product-delete/warehouse/settings · gudang=inventori+pembelian only). `can(role, cap)`, `requireCapability(cap)` (returns the session or throws `ForbiddenError`).
- [x] **Gated all 13 mutating action files** (`lib/actions/*`, auth.ts excluded): products (write/delete split), discounts, pages, articles, collections, menus (content), orders, inventory, purchases, customers, crm+segments. Each mutation calls `await requireCapability(...)`; store-scoped creates now take `store_id` from the session (removed the per-file "first store" helper).
- [x] **RLS migration `0012_tenant_rls`** — hand-authored (drizzle-kit doesn't model RLS): non-owner `tokophi_app` role + grants, `app_current_store_id()` GUC reader, and `ENABLE ROW LEVEL SECURITY` + `tenant_isolation` policy (`USING` + `WITH CHECK`) on all **32 `store_id` tables**. Registered in the drizzle journal (+ 0012 snapshot) so `npm run migrate` applies it. Applied clean.
- [x] **`withTenant(storeId, fn)`** (`packages/db/src/rls.ts`, exported) — per-txn `set_config('app.store_id', …, true)` + `SET LOCAL ROLE tokophi_app`. Ready for the VPS switch.
- [x] **`npm run verify-rls`** (`src/verify-rls.ts`) proves isolation: right tenant → 14 products, wrong tenant → 0, no-GUC → 0 (fail-closed), cross-tenant INSERT blocked by `WITH CHECK`. **All ✓.**
- **Verified:** `build:admin` clean (middleware + all routes intact), `verify-rls` all green.
- **Note:** locally the app connects as the table owner, which *bypasses* RLS by design — enforcement flips on when the VPS points `DATABASE_URL` at `tokophi_app` and queries run via `withTenant`. RBAC (app-layer) is enforced now regardless.

**Next:** RBAC UI polish (hide/disable per role + graceful ForbiddenError toast), then VPS activation. See CURRENT STATE banner.

## 2026-07-04 — Session: RLS runtime enforcement (local) ✅
**Done this session:**
- [x] **`apps/admin/lib/tenant.ts`** — `withCurrentTenant(fn)` (session→`withTenant`) + re-export `withTenant`. Makes every admin query run in a txn that sets `app.store_id` + `SET LOCAL ROLE tokophi_app`, so RLS enforces at runtime (process connects as owner; tenant queries drop to the non-owner role — the VPS/PostgREST model).
- [x] **All 14 `lib/data/*` reads** wrapped in `withCurrentTenant` (helpers threaded as `base(db: Tx)` where needed) — done via subagent, build-verified.
- [x] **All 13 `lib/actions/*` writes** wrapped in `withTenant(session.storeId, …)` (store_id from the RBAC session; single-statement → arrow, multi-statement → one atomic txn). `media.ts` keeps fs outside the txn.
- [x] **Kept owner (correctly):** `lib/auth.ts` (reads `store_users` before a session exists — else login locks out), super-admin (cross-tenant), storefront (per-client build, no session).
- [x] **`npm run verify-rls-app`** (new) exercises the REAL `withTenant` path: own-tenant read + write-and-read-back its own discount; foreign tenant sees 0 of both; WITH CHECK blocks cross-store write; cleanup. All ✓.
- [x] **Playwright E2E**: logged in as owner, every admin page renders its data (pelanggan 24, inventori 14, diskon 6, kategori 8, halaman 7, blog 6, segmen 17, crm 10, dashboard) with 0 runtime errors / 0 permission-denials; an in-app customer-note write persisted across reload — all through `tokophi_app`. `build:admin` + `build:super` + storefront all clean.
- **Next:** the VPS server itself (infra) — app side is done.

## 2026-07-04 — Session: RBAC UI rollout to ALL editors ✅
**Done this session:**
- [x] Applied the `useCan()`/`<Can>` gating (same pattern as Produk) to **every remaining admin editor**: Diskon, Halaman, Blog, Kategori (editors: Simpan/Hapus; lists: Buat/Tambah CTA + row Hapus), Pelanggan (tag/catatan save), CRM follow-up (Tandai selesai), Segmen (Buat/Edit/Hapus), Pembelian (Buat PO dialog + terima/batalkan row actions), Inventori (Simpan stok), Navigasi (Simpan menu), Pesanan (advance-status button). Each guards its handler + hides the control per capability; server actions still enforce.
- [x] **Verified via Playwright** (fresh login per role): Diskon Buat = staff✓/gudang✗ (discounts:write); Inventori Simpan + Pembelian Buat = staff✗/gudang✓ (inventory/purchases:write); owner all✓ — orthogonal cross-check of the matrix. `build:admin` compiled clean.
- **Next:** VPS activation (connect as `tokophi_app` + route through `withTenant()` so RLS enforces).

## 2026-07-04 — Session: RBAC UI (role-aware controls) ✅
**Done this session:**
- [x] **Client-safe policy split** — `lib/rbac-policy.ts` (Role/Capability/ROLE_CAPS/`can()`/`ROLE_LABEL`); `lib/rbac.ts` now imports it + keeps the server guard (`requireCapability`/`ForbiddenError`). One matrix, shared by server + UI.
- [x] **`components/admin/permissions.tsx`** — `PermissionsProvider` (role from the session, wraps the admin layout) + `useRole()`/`useCan(cap)`/`<Can capability>`. Topbar account menu shows a **role badge** (Pemilik/Admin/Staf/Gudang).
- [x] **Gated Produk (list + editor) + Pengaturan** as the reference: Produk list "Tambah Produk" + row "Arsipkan" + bulk Aktif/Draft/Hapus; editor Simpan (`products:write`) / Hapus produk (`products:delete`) / media Unggah+delete (`media:write`); Pengaturan save footers are owner-only (`settings:write`).
- [x] **Verified E2E via Playwright** (fresh login per role picks up the DB role → JWT): **owner** Simpan✓ Hapus✓; **staff** Simpan✓ Hapus✗ (no delete); **gudang** Simpan✗ Hapus✗ + no media upload. Screenshots confirm. RBAC matrix also unit-checked (11 cases green). `build:admin` clean.
- **Note:** server actions remain the security boundary (still throw `ForbiddenError`); UI gating is UX. Remaining editors follow the same `useCan` pattern — tracked as the next step.

## 2026-07-02 — Session: execute tasks (storefront built ✅)
**State before:** Monorepo (apps/admin :3000, apps/super-admin :3001, packages/ui, packages/lib), both UI-mock prototypes, clean. Pushed to private GitHub — **no further pushes until told**. Payments/shipping platform-managed (ADR 0004). Docs current (PRD v0.3, UML, TASKS, SCHEMA, BACKLOG).

**Done this session:**
- [x] Worklog created.
- [x] **E4 — Storefront (Astro) ✅** — `apps/storefront` (Astro 5 + Tailwind v4), editorial women's-fashion "Batik Nusantara": Layout/Header/Footer/ProductCard + beranda (hero + collage of real AI photos, 6 koleksi, bestseller, values band kirim/COD/QRIS, CTA), `kategori/[handle]`, `produk/[handle]` (size picker + add-to-cart localStorage + Beli via WA), `keranjang` (cart + WA checkout). **22 static pages, astro build clean, console clean.** Commit `d743f8d`.
- **3 surfaces now exist:** super-admin + merchant admin + storefront. 🎉

**Gotcha logged:** the box runs MANY other `astro dev` servers (report-petani-sejahtera, homeimprovement/"RIVA HOME", …). Our storefront's `--port 4322` was taken → Astro fell through to **:4327**. Always confirm the actual port from the dev log; pick a high free port and verify the page title before screenshotting.

**Also done this session (E1):**
- [x] **Pesanan detail page** `/pesanan/[id]` — full page (item + foto, ringkasan rekonsiliasi ke total, linimasa, sidebar pelanggan/pengiriman/pembayaran w/ Sumber). Sheet quick-view removed; rows navigate. Build+console clean.
- [x] **Diskon create+edit** — `/diskon/baru` + `/diskon/[id]` reusable DiscountEditor; list "Buat/Edit"+rows wired; create dialog removed.

**Also done (storefront + galeri + checkout, 2026-07-02):**
- [x] **5 gambar/produk** — generated 56 more AI photos (14×4) via `count:4` + `show_generations` file→jq→download (avoids 56 polls) → **70 webp** (1.6MB), 5 per product. *(Gotcha: `show_generations` big result saves to a file; jq it. Later products lag completion — re-fetch.)*
- [x] **Storefront gallery** (Shopify PDP: main + 5 thumbnails) via `productImages()`.
- [x] **Checkout flow** — `/checkout` (kontak/alamat/pengiriman/pembayaran + sticky ringkasan) → `/checkout/sukses` (clears cart). Cart CTA "Lanjut ke Checkout".
- [x] **Removed WhatsApp checkout** — product "Beli via WhatsApp" → **"Beli Sekarang"** (add+redirect /checkout); cart WA checkout removed. (Contact WA in header/footer kept as CS.)
- [x] **Admin ↔ storefront 1:1** — copied all 70 images into `apps/admin/public/products`; admin `productImages()` helper; **product editor Media shows the 5-image gallery** (same files as storefront). Same products/prices/categories/images both sides.

**Storefront UI/UX polish (2026-07-02):** collection cards use real product photos + gradient; brand-story band; newsletter; refined values/hero ("Lihat Koleksi" replaces WA); **mobile hamburger drawer nav** (fixed the missing mobile category nav); premium ProductCard (hover-zoom, wishlist, eyebrow); category page eyebrow header + sort dropdown; product page micro-polish (gallery intact). Storefront build + console clean.

**Navigasi + nav presisi (2026-07-02):** admin Navigasi = menu builder parent/child dengan **drag-and-drop reorder** (HTML5, tree-ops.ts) + aksi "Jadikan sub-menu"/"Naikkan jadi induk" (2 level). Storefront header kini **cermin presisi Menu Utama admin**: Beranda · Semua Produk · Kategori▾(6) · Promo Gajian · Blog · Kontak (dropdown desktop + accordion mobile via nav.ts). Halaman baru: /blog, /kontak, /kategori/semua, /kategori/promo-gajian (koleksi virtual). Data admin: hijab→Busana Muslim, +Loungewear. self-hosted Postgres: belum (M3). Build+console clean.

**Docs pass + auto-connect (2026-07-02):** new **@tokophi/data** package = single source of truth for nav; admin menu builder + storefront header both derive from it (auto-sync on rebuild). Declared @tokophi/data dep in admin+storefront package.json. Full docs refresh: PRD→v0.4, README, ARCHITECTURE, **new GUIDE.md**, UML (9 Mermaid diagrams), ADR 0005 (monorepo) + 0006 (shared nav), UI_INVENTORY/DATA_MODEL/SCHEMA. Known gaps flagged: storefront /halaman/[handle] + /blog/[handle] not built; /akun is a no-auth stub.

**Backend M3 — local Postgres + Drizzle + super-admin live (2026-07-03):**
- [x] **`@tokophi/db`** package (Drizzle): `src/schema.ts` = **53 tables + 32 enums** from SCHEMA.md (snake_case casing, money=`bigint` IDR), `client.ts` singleton, **versioned migrations** (`drizzle/0000..0002`), `seed.ts`, `reset.ts`. Root **`docker-compose.yml`** = PostgreSQL 16 @ :5433. ADR 0007.
- [x] **Seed** — **single-tenant MVP**: 3 plans + **one store "Batik Nusantara"** (account/owner/`store_users`/settings/`store_stats`), 6 invoices (`number`), 4 activity, platform gateways/couriers(Biteship)/COD. Idempotent (truncate). *(Decision: focus everything on 1 real store; multi-tenant topology = ADR 0008, target.)* super-admin metrics made honest for 1 store (cross-store deltas → 0, `newSignups30d` derived, trial note hidden when 0).
- [x] **Wire super-admin → DB**: new **server-only `lib/data.ts`** (getStores/getPlatform/getDeltas/getPlanDistribution/getStatusDistribution/getInvoices/getActivity/getMrrSeries/getPaymentGateways/getCouriers/getAggregator). `lib/mock.ts` slimmed to config (types + PLANS). Client pages split into `*-client.tsx` + server wrapper; `mrr-chart` takes `data` prop; all DB pages `dynamic="force-dynamic"`. **Verified**: `tsc` clean, `build:super` (6 ƒ dynamic), 6 screenshots from DB with 0 console errors + **perfect parity**; live-mutation test proved runtime reads.
- [x] **Screening/perfection**: `menu_items.parent_id` self-FK; 37 inferred type exports; `stores.city` + `store_stats` + `invoices.number` added so the platform view is faithful from DB; `reset` script (drops `public` **and** `drizzle` journal); apps wired (`@tokophi/db` dep + `transpilePackages` + `serverExternalPackages:["postgres"]` + `.env.local`).
- **Impl notes:** toko list now ordered by GMV desc; store-detail "ID toko" shows real uuid (was STR-2005). RLS not enabled locally (plain Postgres) — app-layer `store_id` scoping for now.
- **Docs:** ADR **0007** (Postgres+Drizzle stack) + **0008** (per-client topology); ARCHITECTURE §9–10, UML §1/§10 (+provisioning sequence), SCHEMA (implemented + deltas), PRD status/roadmap.

**admin → DB — Produk (catalog) live (2026-07-03):**
- [x] **Seed catalog** into Postgres (single-tenant): 14 products (Batik Nusantara) → each 1 default variant (price), inventory (stock), primary media (image). Deterministic from the admin mock (mulberry32, curated drafts/low-stock preserved). Schema deltas: `products.emoji` + `products.units_sold` (rollup cache), `collections.emoji` — migration `0003`.
- [x] **`apps/admin/lib/data/products.ts`** (server-only): `getProducts()` / `getProduct(id)` flatten products ⋈ variant ⋈ inventory ⋈ media → the admin `Product` shape (signatures unchanged).
- [x] **Wire Produk list + detail**: `produk/page.tsx` = server wrapper → `produk-client.tsx` (interactive); `produk/[id]` fetches `getProduct(id)` → existing `ProductEditor` (uuid route, `force-dynamic`, dropped `generateStaticParams`). **Verified**: `tsc` clean, `build:admin` (`/produk` + `/produk/[id]` ƒ dynamic), screenshots from DB — list (14 products, prices/stock/terjual/status/dates, low-stock + drafts match) + editor (5-image gallery, price/margin, category) — **0 console errors, parity**.

**admin → DB — Diskon + Pelanggan + Kategori live (2026-07-03):**
- [x] **Seed**: 24 customers (mulberry32(4242) parity), 6 discounts (startsAt/endsAt anchored → real terjadwal/aktif/kadaluarsa), 8 collections + **32 collection_products membership** (counts derived, real: Dress 3 / Terlaris 10 / Promo 8…).
- [x] **`lib/data/{discounts,customers,collections}.ts`** (server-only): `getDiscounts/getDiscount`, `getCustomers/getCustomer`, `getCollections/getCollection` → flat admin shapes. Discount status + `endsInDays` derived from dates; collection count via `count(collection_products)`.
- [x] **Wire 6 routes**: Diskon list+editor, Pelanggan list+detail, Kategori list+editor — each server-wrapper + `*-client.tsx`, detail via `getX(id)` (uuid, `force-dynamic`, dropped `generateStaticParams`). Detail/editor components take the flat entity (order-history/member-picker still read mock exports until orders seeded). **Verified**: `tsc` + `build:admin` clean (8 admin routes ƒ dynamic), screenshots from DB — 0 console errors, parity.

**admin → DB — Pesanan + orders live (2026-07-03):**
- [x] **Seed orders** (mirror buildOrders `mulberry32(555)` parity): **60 orders + 153 line-items + 60 payments**, linked to customers by name + product variants by pick-index; status dist matches (dikirim 17 / selesai 16 / diproses 15 / baru 7 / batal 5); channel enum-mapped; `placedAt` from `minutesAgo`.
- [x] **`lib/data/orders.ts`**: `getOrders`/`getOrder(number)` → flat admin `Order` (items count from `order_line_items`, channel display-mapped, `minutesAgo` from `placedAt`). Route keyed by human number (`/pesanan/INV-4819`).
- [x] **Wire Pesanan list + detail**: server-wrapper + `pesanan-client.tsx`; detail via `getOrder` (`force-dynamic`). OrderDetail still *fabricates* line-items from the flat order (reconciles to total) — real line-items are seeded for later. **Verified**: `tsc` + `build:admin` clean, screenshots — list (60, tab counts/customer/items/status/total) + detail (customer/channel/total/time from DB) — 0 console errors, parity.

**admin → DB — Halaman + Blog live (2026-07-03):**
- [x] **Seed CMS**: 7 pages (status/template/views/updatedAt), 2 blogs + 6 articles (blog channel, author, comments, publishedAt). Schema deltas: `pages.template` + `pages.views`, `articles.comments` — migration `0004`.
- [x] **`lib/data/{pages,articles}.ts`**: `getPages/getPage`, `getArticles/getArticle` → flat `CmsPage`/`BlogPost` (published from status enum, blog channel via join, days-ago from timestamps).
- [x] **Wire Halaman + Blog list + editors**: server-wrapper + `*-client.tsx`; detail via `getX(id)` (`force-dynamic`). **Verified**: `tsc` + `build:admin` clean, screenshots — Halaman (7, status/template/views) + Blog (6, tabs/blog/author/comments) — 0 console errors, parity.

**admin → DB — Inventori + CRM live (2026-07-03):**
- [x] **Inventori**: server-wrapper reuses `getProducts()` → `inventori-client.tsx` (stock stepper from real inventory). No new data.
- [x] **CRM**: seed 12 leads + 10 followups + 6 wa_templates (schema delta `followups.last_message`, migration `0005`); `lib/data/crm.ts` (`getLeads`/`getFollowups` [customer via join]/`getWaTemplates`; source display-mapped, dueDays/lastContact from timestamps, discount... status derived). Wired 4 CRM routes: overview (async server), Follow-up / Pipeline / Template (server-wrapper + `*-client.tsx`, `force-dynamic`). Pipeline `leadWaHref` moved into the component (passes `waHref` prop to `LeadCard`). **Verified**: `tsc` + `build:admin` clean, screenshots — Inventori (14 SKU), Pipeline (kanban 9 leads by stage), Follow-up (10, dueDays sort, customer join) — 0 console errors, parity.

**admin → DB — Pembelian + Segmen + Ulasan live (2026-07-03):**
- [x] **Seed**: 4 suppliers + 6 purchase_orders (+21 po_items for the count), 6 customer_segments, 8 reviews. Schema deltas: `customer_segments.growth` (real), `reviews.product_name` + `reviews.emoji` (denormalized — some demo reviews reference legacy, non-catalog products) — migration `0006`.
- [x] **`lib/data/{purchases,segments,reviews}.ts`**: `getPurchaseOrders` (supplier via join, items via `count(po_items)`, etaDays from `eta_date`), `getSegments`, `getReviews` (customer via join, product/emoji denormalized). Wired 3 pages (server-wrapper + `*-client.tsx`, `force-dynamic`). **Verified**: `tsc` + `build:admin` clean, screenshots — Pembelian (6 PO, tab counts/supplier/item/total/ETA), Segmen, Ulasan (8, rating avg, customer join) — 0 console errors, parity. **12 admin modules now DB-backed.**

**admin → DB — Navigasi live (2026-07-03):**
- [x] **Seed** menus/menu_items (recursive, parent_id + position; type NavItemType→DB enum): 2 menus (main-menu 12 items incl. Kategori→6 children, footer 5). Inlined `MAIN_MENU`/`FOOTER_MENU` from `@tokophi/data` for seed parity.
- [x] **`lib/data/menus.ts`** `getMenus()` reconstructs the `NavMenu[]` tree from flat menu_items (parent→children map, type mapped back). Wired Navigasi (server-wrapper + `navigasi-client.tsx`, `force-dynamic`; `seedMenus()`→prop clone). **Verified**: `tsc` + `build:admin` clean, screenshot — 2 menus, hierarchical 12-item builder (Kategori sub-menu + children) — 0 console errors, parity. **16 admin modules now DB-backed.**

**admin → DB — Dashboard + Analitik live (2026-07-03):**
- [x] **Seed** `analytics_daily` rollup (new table, migration `0007`): 120-day daily sales/orders/visitors series (mirror mock `buildDays`, mulberry32(20260701)).
- [x] **Refactored `lib/data/dashboard.ts` → pure functions** (take `days`/`products`/`orders`/`activities` as params — client-safe, range switcher re-derives). `lib/data/analytics.ts` `getDailyStats()`. Split Dashboard (`page.tsx` server → `dashboard-client.tsx`) + Analitik (server → `analitik-client.tsx`), both `force-dynamic`, fetching daily-stats + products + orders. Live-activity feed + online count kept from mock (decorative realtime); Analitik's funnel/region/device/ROAS breakdowns kept mock. **Verified**: `tsc` + `build:admin` clean, screenshots — Dashboard (KPIs/sales chart/top products/status from DB) + Analitik — 0 console errors, parity.

**admin → DB — Pemasaran live · ADMIN NOW 100% DB-BACKED (2026-07-03):**
- [x] **Seed**: 3 ad_channels (denorm config + aggregate + `campaigns` jsonb) + 11 per-province rows into `ad_metrics` (`channel_key` NULL = province rollup). Schema deltas (migration `0008`): `ad_channels` +name/brand/pixel_label/pixel_active/spend_idr/impressions/clicks/conversions/revenue_idr/campaigns; `ad_metrics.channel_key` nullable.
- [x] **`lib/data/marketing.ts`** (`getAdChannels`/`getProvinceStats`). Split Pemasaran (server-wrapper + `pemasaran-client.tsx`, `force-dynamic`); threaded `channels`/`provinces` through sub-tabs, `blendedTotals()` from props. **Verified**: `tsc` + `build:admin` clean, screenshot (stats/ROAS table/per-province) — 0 console errors, parity.
- ✅ **All 16 admin modules read PostgreSQL** (Produk/Diskon/Pelanggan/Kategori/Pesanan/Halaman/Blog/Inventori/CRM/Pembelian/Segmen/Ulasan/Navigasi/Dashboard/Analitik/Pemasaran). Only decorative bits stay mock (live-activity ticker; analitik funnel/region/device breakdowns).

**storefront → DB · ALL THREE SURFACES NOW READ POSTGRESQL (2026-07-03):**
- [x] **Enriched `products`** (migration `0009`): `sizes` (jsonb), `badge`, `bestseller`, `rating_value`, `rating_count`; seeded `description` + `variant.compare_at_idr` + `collections.description` (category blurbs) — from the storefront catalog values. (Admin catalog already matched storefront: same 14 handles/prices.)
- [x] **Rewrote `apps/storefront/src/data/catalog.ts`** to read `@tokophi/db` via **top-level await** (build/SSR time) — **same exports** (`STORE`/`COLLECTIONS`/`PRODUCTS`/`productRating`/`bestsellers`/`byCollection`/`findProduct`/…), so all ~12 `.astro` consumers are unchanged. `astro.config.mjs` surfaces `DATABASE_URL` onto `process.env` (`loadEnv`) + `ssr.external:["postgres"]`; `apps/storefront/.env`(+example). `@tokophi/db` added to deps.
- [x] **Verified**: `astro build` clean (29 pages, all 14 products + 6 category collections generated from DB), screenshots — home (hero/6-collection grid w/ live counts 3·3·2·3·2·1/bestsellers) + product (rating 4.8·214, price+compareAt −24%, Promo badge, sizes, gallery, review breakdown, related) — **0 console errors, parity**.
- ✅ **super-admin + all 16 admin modules + storefront all read PostgreSQL.** Reads are done end-to-end.

**Mutations — Produk create/edit/delete persist (2026-07-03):**
- [x] **`apps/admin/lib/actions/products.ts`** (`"use server"`): `createProduct`/`updateProduct`/`deleteProduct` → Drizzle insert/update on products+variant+inventory+media, `revalidatePath("/produk")`. **Delete = archive** (soft: `status='archived'`, products are referenced by historical `order_line_items`); `getProducts` now filters `ne(status,'archived')` so archived drop out of admin list + storefront.
- [x] **Wired `product-editor.tsx`**: `useRouter` + `useTransition`; Simpan → create/update, Hapus → delete (loading state "Menyimpan…", `router.push("/produk")` + `refresh`, toasts). **Verified end-to-end via UI**: CREATE (persisted + variant/inventory/media, handle slugified) → EDIT (price 157k→209k in DB) → DELETE (archived + gone from list). `tsc` + `build:admin` clean.
- **Pattern for the rest**: `lib/actions/<entity>.ts` server actions + wire the editor's save/delete + `revalidatePath`. Reseeded to clean state.

**Mutations — Diskon + Halaman + Blog persist (2026-07-03):**
- [x] **`lib/actions/{discounts,pages,articles}.ts`** (`"use server"`) — create/update/delete → Drizzle + `revalidatePath`. Diskon: status+period → `startsAt`/`endsAt` (anchored to `ADMIN_TODAY` so derived status round-trips), `type`→`kind`. Halaman: `published`→`status`, `updatedAt=now`. Blog: new articles assigned to the store's first blog (no picker), `published`→`status`+`publishedAt`. All hard-delete (no history FK). Wired each editor's Simpan/Hapus (`useRouter`+`useTransition`, added missing `toast` imports to page/article editors).
- [x] **Verified end-to-end via UI**: created a discount + page + article (all appear in their lists + DB), deleted the discount (gone from DB; fresh list load confirms). `tsc` + `build:admin` clean. Reseeded. *(Note: after a delete-redirect the list can show the row for one tick — router-cache timing; a fresh navigation is correct.)*

**Mutations — order status + Inventori stock + Kategori persist (2026-07-03):**
- [x] **`lib/actions/orders.ts`** `setOrderStatus(orderId, status)` — order-detail's primary action advances baru→diproses→dikirim→selesai (real DB write + `revalidatePath`).
- [x] **`lib/actions/inventory.ts`** `updateStock(updates[])` — Inventori stepper now tracks dirty rows + a "Simpan N perubahan" button writes all changed stock to `inventory_levels` (via each product's default variant).
- [x] **`lib/actions/collections.ts`** create/update/delete — Kategori editor persists core fields (title/handle/description/type/match/published); member/condition management deferred. Delete clears `collection_products`+`collection_conditions` first (hard delete).
- [x] **Verified end-to-end via UI**: order INV-4789 baru→diproses; celana-kulot stock 22→27; collection create + delete — all confirmed in DB. `tsc` + `build:admin` clean. Reseeded. **7 write operations now persist** (Produk/Diskon/Halaman/Blog/Kategori editors + order-status + Inventori-stock).

**Decision — prod backend = self-hosted Postgres + PostgREST on VPS, NOT Supabase (2026-07-03):**
- User: "gak pakai supabase, nanti pakai local → postgrest sql - vps". Prod target = **self-hosted PostgreSQL + PostgREST on a VPS** (RLS for `store_id`, JWT auth, self-hosted Storage MinIO/S3). Local dev is already plain Postgres, so the same Drizzle migrations carry up with no rework. **Reframed all docs** (ADR 0007 + PRD/README/AGENTS/ARCHITECTURE/UML/SCHEMA/TASKS/BACKLOG/CONCEPT/CHANGELOG + `.env.example`) from "Supabase" → "self-hosted Postgres (VPS)"; removed the `NEXT_PUBLIC_SUPABASE_*` env vars.

**Mutations — Navigasi menu + Pelanggan tags/notes persist (2026-07-03):**
- [x] **`lib/actions/menus.ts`** `saveMenu(handle, items)` — "Simpan menu" now persists the whole tree (delete all `menu_items` for that menu → re-insert recursively with `parent_id`/`position`, type mapped beranda→home etc.). Wired navigasi-client (`useRouter`+`useTransition`).
- [x] **`lib/actions/customers.ts`** `updateCustomer(id, {tags, notes})` — customer detail's tags/notes now persist (migration `0010` added `customers.tags` jsonb + `notes` text; seeded `tags=["pelanggan", <segment>]`). Added a "Simpan tag & catatan" button; `getCustomer` returns tags/notes; `Customer` type += `tags?`/`notes?`.
- [x] **Verified end-to-end via UI**: deleted "Kontak" + Simpan menu → main-menu 12→11 (Kontak gone in DB, tree intact); added tag "uji-db" + note → persisted. `tsc` + `build:admin` clean. Reseeded. **9 write operations now persist.**

**Mutations — CRM follow-up + Segmen persist (2026-07-03):**
- [x] **`lib/actions/crm.ts`** `setFollowupStatus(id, status)` — the Follow-up "Tandai selesai" now writes `followups.status='selesai'` (kept the instant local `done` Set for snappy UI).
- [x] **`lib/actions/segments.ts`** `createSegment`/`deleteSegment` — Segmen "Buat segmen" dialog (controlled inputs + open state) creates a `customer_segments` row; card "Hapus" deletes it.
- [x] **Verified end-to-end via UI**: marked a follow-up done (selesai 1→2 in DB); created "Segmen Uji DB" (in DB) + deleted it (gone). `tsc` + `build:admin` clean. Reseeded. **11 write operations now persist.**
- **Pembelian deferred**: the PO create dialog is a simplified item-*count*, not real line items — persisting it faithfully needs a proper line-item PO builder (pick products + qty) + a "Terima barang" flow that adds stock. Tracked for later.

**Mutations — Pembelian PO builder · ALL ADMIN EDITORS NOW PERSIST (2026-07-03):**
- [x] **`lib/actions/purchases.ts`** `createPurchaseOrder` (line items → `purchase_orders` + `po_items`, supplier matched by name, unique code, total from lines), `receivePurchaseOrder` (status→diterima + add each outstanding line qty to `inventory_levels`, set `received_qty`), `cancelPurchaseOrder` (delete items + PO). `getPurchaseProducts()` feeds the picker.
- [x] **Rebuilt the PO create dialog** into a real **line-item builder** (product dropdown + qty + HPP rows, live total) + wired row actions "Tandai diterima"/"Batalkan". `pembelian-client` takes `products`; `RowActions` takes `po`.
- [x] **Verified end-to-end via UI**: created PO-xxxxxx (celana-kulot ×7, total 462k, po_items row); received it → status diterima + celana-kulot stock 22→29; cancelled another PO → row+items gone. `tsc` + `build:admin` clean. Reseeded. **✅ All 12 admin editors persist writes (12 write areas).**

**Local admin auth — login + session + route protection (2026-07-03):**
- [x] **Schema** `users.password_hash` (migration `0011`); seed hashes the owner password (scrypt `salt:hash`) — **ongki@batiknusantara.id / tokophi123**, role owner.
- [x] **`lib/auth.ts`** (server-only): `verifyPassword` (scrypt), `findLogin` (users ⋈ store_users), `signSession`/`getSession` (**jose JWT** in httpOnly `session` cookie, `AUTH_SECRET`). **`lib/actions/auth.ts`** `signIn`/`signOut`. **`app/login/page.tsx`** (email+password, `useActionState`). **`middleware.ts`** (edge-safe JWT verify → redirect to `/login`; matcher excludes `_next`/static/`products/`). `(admin)/layout.tsx` is now async → reads session → Topbar shows the user + "Keluar".
- [x] **Verified end-to-end**: unauthenticated `/` + `/produk` → 307 `/login`; wrong password → inline error; correct → dashboard (user shown in topbar); logout → `/login`. `tsc` + `build:admin` clean (Middleware compiled; postgres stays out of the edge bundle). Added `AUTH_SECRET` to `.env`/`.env.local`/`.env.example`.

**Local media upload — product images → product_media (2026-07-03):**
- [x] **Seed** now loads **5 `product_media` rows/product** (base + `-2..-5`, positions 0–4) instead of 1 → 70 media rows. `getProduct` returns the real `media[]`; `Product` type += `media?`.
- [x] **`lib/actions/media.ts`** `uploadProductImage(productId, formData)` (writes the file to `apps/admin/public/uploads/`, 5MB image cap, inserts a `product_media` row at next position) + `deleteProductImage(mediaId, productId)` (removes the row + the local file). `public/uploads/` gitignored.
- [x] **Product editor Media section** rewritten to show the real `media[]` (was the derived `productImages()`), with a hidden file input + "Unggah" button (`useTransition`) and a hover **delete** per image.
- [x] **Verified end-to-end via UI** (behind login): uploaded a PNG → tile 5→6 + `product_media` row + file on disk; deleted it → 6→5 + row + file gone. `tsc` + `build:admin` clean.

**Next up (resume here):**
1. **RBAC + RLS (local)**: gate actions/routes by `store_users.role` (owner/admin/staff/gudang); then enable Postgres RLS (`store_id` from the JWT) once a request-scoped DB role/GUC is wired.
2. **(later) VPS**: self-hosted Postgres + PostgREST + Storage (MinIO/S3 for the uploads); multi-tenant + per-client storefront `STORE_SLUG`.
2. **Deploy to VPS**: stand up self-hosted Postgres + PostgREST; wire JWT Auth (login/RBAC via `store_users`) + Storage (media uploads) + enable RLS; then multi-tenant (beyond single-store seed) + per-client storefront via `STORE_SLUG`.
3. **E1 sisa / E0 de-dup / Turborepo** (unchanged).
