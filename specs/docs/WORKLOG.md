# Indostore — Worklog (session log)

> Newest first. What we did + what's next, so any session can resume instantly.
> Pairs with `TASKS.md` (the plan) + `BACKLOG.md` (priorities). Git: local commits only — **do not push until told**.

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

**Navigasi + nav presisi (2026-07-02):** admin Navigasi = menu builder parent/child dengan **drag-and-drop reorder** (HTML5, tree-ops.ts) + aksi "Jadikan sub-menu"/"Naikkan jadi induk" (2 level). Storefront header kini **cermin presisi Menu Utama admin**: Beranda · Semua Produk · Kategori▾(6) · Promo Gajian · Blog · Kontak (dropdown desktop + accordion mobile via nav.ts). Halaman baru: /blog, /kontak, /kategori/semua, /kategori/promo-gajian (koleksi virtual). Data admin: hijab→Busana Muslim, +Loungewear. Supabase: belum (M3). Build+console clean.

**Docs pass + auto-connect (2026-07-02):** new **@indostore/data** package = single source of truth for nav; admin menu builder + storefront header both derive from it (auto-sync on rebuild). Declared @indostore/data dep in admin+storefront package.json. Full docs refresh: PRD→v0.4, README, ARCHITECTURE, **new GUIDE.md**, UML (9 Mermaid diagrams), ADR 0005 (monorepo) + 0006 (shared nav), UI_INVENTORY/DATA_MODEL/SCHEMA. Known gaps flagged: storefront /halaman/[handle] + /blog/[handle] not built; /akun is a no-auth stub.

**Backend M3 — local Postgres + Drizzle + super-admin live (2026-07-03):**
- [x] **`@indostore/db`** package (Drizzle): `src/schema.ts` = **53 tables + 32 enums** from SCHEMA.md (snake_case casing, money=`bigint` IDR), `client.ts` singleton, **versioned migrations** (`drizzle/0000..0002`), `seed.ts`, `reset.ts`. Root **`docker-compose.yml`** = PostgreSQL 16 @ :5433. ADR 0007.
- [x] **Seed** — **single-tenant MVP**: 3 plans + **one store "Batik Nusantara"** (account/owner/`store_users`/settings/`store_stats`), 6 invoices (`number`), 4 activity, platform gateways/couriers(Biteship)/COD. Idempotent (truncate). *(Decision: focus everything on 1 real store; multi-tenant topology = ADR 0008, target.)* super-admin metrics made honest for 1 store (cross-store deltas → 0, `newSignups30d` derived, trial note hidden when 0).
- [x] **Wire super-admin → DB**: new **server-only `lib/data.ts`** (getStores/getPlatform/getDeltas/getPlanDistribution/getStatusDistribution/getInvoices/getActivity/getMrrSeries/getPaymentGateways/getCouriers/getAggregator). `lib/mock.ts` slimmed to config (types + PLANS). Client pages split into `*-client.tsx` + server wrapper; `mrr-chart` takes `data` prop; all DB pages `dynamic="force-dynamic"`. **Verified**: `tsc` clean, `build:super` (6 ƒ dynamic), 6 screenshots from DB with 0 console errors + **perfect parity**; live-mutation test proved runtime reads.
- [x] **Screening/perfection**: `menu_items.parent_id` self-FK; 37 inferred type exports; `stores.city` + `store_stats` + `invoices.number` added so the platform view is faithful from DB; `reset` script (drops `public` **and** `drizzle` journal); apps wired (`@indostore/db` dep + `transpilePackages` + `serverExternalPackages:["postgres"]` + `.env.local`).
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
- [x] **Seed** menus/menu_items (recursive, parent_id + position; type NavItemType→DB enum): 2 menus (main-menu 12 items incl. Kategori→6 children, footer 5). Inlined `MAIN_MENU`/`FOOTER_MENU` from `@indostore/data` for seed parity.
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
- [x] **Rewrote `apps/storefront/src/data/catalog.ts`** to read `@indostore/db` via **top-level await** (build/SSR time) — **same exports** (`STORE`/`COLLECTIONS`/`PRODUCTS`/`productRating`/`bestsellers`/`byCollection`/`findProduct`/…), so all ~12 `.astro` consumers are unchanged. `astro.config.mjs` surfaces `DATABASE_URL` onto `process.env` (`loadEnv`) + `ssr.external:["postgres"]`; `apps/storefront/.env`(+example). `@indostore/db` added to deps.
- [x] **Verified**: `astro build` clean (29 pages, all 14 products + 6 category collections generated from DB), screenshots — home (hero/6-collection grid w/ live counts 3·3·2·3·2·1/bestsellers) + product (rating 4.8·214, price+compareAt −24%, Promo badge, sizes, gallery, review breakdown, related) — **0 console errors, parity**.
- ✅ **super-admin + all 16 admin modules + storefront all read PostgreSQL.** Reads are done end-to-end.

**Mutations — Produk create/edit/delete persist (2026-07-03):**
- [x] **`apps/admin/lib/actions/products.ts`** (`"use server"`): `createProduct`/`updateProduct`/`deleteProduct` → Drizzle insert/update on products+variant+inventory+media, `revalidatePath("/produk")`. **Delete = archive** (soft: `status='archived'`, products are referenced by historical `order_line_items`); `getProducts` now filters `ne(status,'archived')` so archived drop out of admin list + storefront.
- [x] **Wired `product-editor.tsx`**: `useRouter` + `useTransition`; Simpan → create/update, Hapus → delete (loading state "Menyimpan…", `router.push("/produk")` + `refresh`, toasts). **Verified end-to-end via UI**: CREATE (persisted + variant/inventory/media, handle slugified) → EDIT (price 157k→209k in DB) → DELETE (archived + gone from list). `tsc` + `build:admin` clean.
- **Pattern for the rest**: `lib/actions/<entity>.ts` server actions + wire the editor's save/delete + `revalidatePath`. Reseeded to clean state.

**Mutations — Diskon + Halaman + Blog persist (2026-07-03):**
- [x] **`lib/actions/{discounts,pages,articles}.ts`** (`"use server"`) — create/update/delete → Drizzle + `revalidatePath`. Diskon: status+period → `startsAt`/`endsAt` (anchored to `ADMIN_TODAY` so derived status round-trips), `type`→`kind`. Halaman: `published`→`status`, `updatedAt=now`. Blog: new articles assigned to the store's first blog (no picker), `published`→`status`+`publishedAt`. All hard-delete (no history FK). Wired each editor's Simpan/Hapus (`useRouter`+`useTransition`, added missing `toast` imports to page/article editors).
- [x] **Verified end-to-end via UI**: created a discount + page + article (all appear in their lists + DB), deleted the discount (gone from DB; fresh list load confirms). `tsc` + `build:admin` clean. Reseeded. *(Note: after a delete-redirect the list can show the row for one tick — router-cache timing; a fresh navigation is correct.)*

**Next up (resume here):**
1. **Extend mutations** to the remaining editors (Pelanggan, Kategori/collections, Navigasi save, Inventori stock stepper, order status) — same server-action pattern.
2. **Supabase**: Auth (login/RBAC via `store_users`) + Storage (media uploads) + enable RLS; then multi-tenant (beyond single-store seed) + per-client storefront via `STORE_SLUG`.
3. **E1 sisa / E0 de-dup / Turborepo** (unchanged).
