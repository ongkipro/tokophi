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

**Next up (resume here):**
1. **admin → DB** (biggest step to "terhubung keseluruhan"): (a) seed Batik Nusantara catalog into Postgres from `admin/lib/mock/store.ts`; (b) swap `apps/admin/lib/data/*` bodies to Drizzle (signatures unchanged). Then wrap entity-list direct-mock reads in `lib/data`.
2. **storefront → DB**: parameterize by `STORE_SLUG`, read catalog/pages by `store_id` (ADR 0008).
3. **Mutations** (save/edit/delete) → Drizzle `insert/update`; toasts already in place.
4. **Supabase**: connect (Auth + Storage + RLS), same migrations; M4 real payment/courier integrations.
5. **E1 sisa / E0 de-dup / Turborepo** (unchanged from before).
