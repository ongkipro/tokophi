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
- [x] **`@indostore/db`** package (Drizzle): `src/schema.ts` = **52 tables + 32 enums** from SCHEMA.md (snake_case casing, money=`bigint` IDR), `client.ts` singleton, **versioned migrations** (`drizzle/0000..0002`), `seed.ts`, `reset.ts`. Root **`docker-compose.yml`** = PostgreSQL 16 @ :5433. ADR 0007.
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

**Next up (resume here):**
1. **admin → DB, remaining**: **Dashboard/Analitik** (aggregate sales/KPIs from `orders` — replaces the synthetic DAYS series; the big one), Inventori (variant/inventory edit), Halaman/Blog (`pages`/`articles`), CRM/Pemasaran/Navigasi. Optional: wire OrderDetail + customer order-history to the *real* seeded line-items.
2. **storefront → DB**: parameterize by `STORE_SLUG`, read catalog/pages by `store_id` (ADR 0008).
3. **Mutations** (save/edit/delete) → Drizzle `insert/update`; toasts already in place.
4. **Supabase**: connect (Auth + Storage + RLS), same migrations; M4 real payment/courier integrations.
5. **E1 sisa / E0 de-dup / Turborepo** (unchanged from before).
