# Indostore — Prototype task breakdown

> Granular, executable work items to take the prototype from **UI-mock** → **working product**.
> Higher-level priorities live in `BACKLOG.md`; this is the detailed plan. Updated 2026-07-03.
> **Legend:** `[ ]` todo · `[~]` partial · `[x]` done · size **S**/**M**/**L** · AC = acceptance criteria.
> **How to work:** pull the top unchecked task in the current epic → ship → check it → add a CHANGELOG line → update `UI_INVENTORY.md` if a screen changed.

---

## Epic 0 — Monorepo hygiene (foundation)
- [x] Monorepo (npm workspaces): `apps/admin`, `apps/super-admin`, `packages/ui`, `packages/lib`. Both build.
- [ ] **De-dup admin → shared packages** · **M** · migrate `apps/admin` to import `@indostore/ui` + `@indostore/lib`; delete its local `components/ui` + `lib/format`/`utils`. AC: admin builds using the packages, zero duplicate UI, console clean.
- [ ] **Turborepo pipeline** · **S** · add `turbo.json` (build/lint/dev). AC: `turbo run build` builds both apps with caching.
- [ ] **Shared config** · **S** · `packages/config` (tsconfig + eslint + tailwind preset) consumed by all apps/packages.

## Epic 1 — Admin prototype completeness (still mock)
- [x] **Pesanan detail page** `/pesanan/[id]` — full page (line items+foto, ringkasan→total, linimasa, pelanggan/pengiriman/pembayaran, status actions+toast). Sheet removed; rows navigate.
- [ ] **Draft / pesanan manual** create flow · **M** · new-order form (pilih pelanggan+produk, hitung total). AC: draft appears in list.
- [ ] **Varian produk (real)** · **L** · per-variant SKU/harga/stok table + option combinations; mock model in store. AC: varian toggle produces an editable variant grid.
- [ ] **Media upload UI** · **M** · multi-image add/reorder/remove (mock) + the 1 video slot wired. AC: reorder works; primary image settable.
- [x] **Diskon create + edit** — `/diskon/baru` + `/diskon/[id]` reusable DiscountEditor; list Buat/Edit/rows wired; create dialog removed.
- [ ] **Toasts + confirm dialogs** everywhere · **S** · destructive actions (Hapus di Halaman/Blog/Pelanggan/Diskon/Produk list) get a confirm dialog + toast. AC: no silent destructive clicks.
- [ ] **Ekspor CSV** · **S** · Analitik/Inventori/Pemasaran export buttons generate a client-side CSV from mock. AC: file downloads.
- [ ] **Global search (⌘K)** · **M** · topbar search returns real matches across produk/pesanan/pelanggan. AC: results navigate.
- [ ] **Loading skeletons** · **S** · add to chart-heavy screens (Dashboard/Analitik/Pemasaran).

## Epic 2 — Super-admin prototype completeness
- [ ] **Provisioning "Buat toko"** · **M** · wizard (nama, owner, paket, subdomain) → adds a store (mock). AC: new store in Toko list.
- [ ] **Impersonation stub** · **S** · "Masuk sebagai" opens the merchant admin context (mock deep link/banner). AC: visible "sedang meng-impersonasi" state.
- [ ] **Support / tiket** screen · **M** · list + detail of merchant support tickets (mock).
- [ ] **Billing depth** · **M** · invoice detail, ubah paket flow, dunning states (gagal bayar → tangguhkan). AC: status transitions visible.
- [ ] **Platform config detail** · **S** · gateway/aggregator credential forms (mock) + COD rules (limit/area/fee).

## Epic 3 — Data-layer seam (PRE-BACKEND — do before M3)
- [ ] **Shared domain types** · **M** · move entity types (Product/Order/Customer/Store/…) to `@indostore/lib`; both apps import them. AC: no type drift between apps.
- [~] **Wrap admin reads in `lib/data/*`** · **L** · ✅ done (as DB queries) for products/orders/customers/collections/inventory/crm/discounts/pages/articles/purchases/segments/reviews — 12 modules. ⏳ Dashboard/Analitik, Pemasaran still import `@/lib/mock` directly.
- [x] **Wrap super-admin reads in `lib/data/*`** · **M** · done — `apps/super-admin/lib/data.ts` (stores/plans/invoices/metrics), all pages DB-backed.
- [ ] *(Why: makes M3 a "fill query bodies" job, not a UI rewrite.)*

## Epic 4 — Storefront (M2)
- [x] **Scaffold `apps/storefront`** · Astro 5 + Tailwind v4, workspace-linked, uses `@indostore/lib`. Builds clean (22 pages).
- [x] **Pages** · beranda (hero/unggulan/koleksi/values), `/kategori/[handle]`, `/produk/[handle]` (size + add-to-cart + Beli via WA), `keranjang` (cart + WA checkout).
- [~] **Data source** · self-contained catalog mirroring the admin fashion demo. **TODO:** share via `packages/data` so admin+storefront read one source.
- [~] **SEO** · per-page title/description done. **TODO:** sitemap + feed.
- [x] **Bespoke brand theme** · editorial women's-fashion look (Playfair display + rose/cream tokens) — proves the "per-client look".
- [ ] **Deploy to Cloudflare** · **S** · wire CF Pages/Workers deploy.

## Epic 5 — Backend (M3 — local Postgres/Drizzle → Supabase)
- [x] **Schema (`@indostore/db`)** · **L** · 52 tables/enums from `SCHEMA.md` as Drizzle + versioned migrations on **local PostgreSQL 16** (Docker). Seeded single-tenant "Batik Nusantara" = parity with mock. *(RLS policies written; enabled at Supabase — ADR 0007.)*
- [~] **Swap `lib/data` bodies → queries** · **L** · ✅ super-admin (all 5) + admin 13 modules read the DB (`force-dynamic`). ⏳ remaining admin modules (Dashboard/Analitik, Pemasaran) + storefront.
- [ ] **Auth + RBAC** · **M** · Supabase Auth (email/OTP) + `store_users`; store switcher scopes data. AC: login → see only your store.
- [ ] **Mutations persist** · **L** · save product/collection/order, stock adjust, PO, CRM → Drizzle `insert/update`. AC: refresh keeps changes.
- [ ] **Storage + rich-text** · **M** · media upload to Supabase Storage; Tiptap for bodies.
- [x] **Super-admin cross-tenant** · **M** · reads across `store_id`; MRR/GMV/etc. from DB (single-tenant now).

## Epic 6 — Platform integrations (M4)
- [ ] **Payment gateway** · **L** · Midtrans/Xendit behind platform config; COD rules; webhook → order status.
- [ ] **Shipping aggregator (Biteship)** · **L** · live ongkir by enabled courier/service; create shipment; resi + tracking webhook.
- [ ] **Settlement / payout** · **L** · platform collects → payout to merchant, minus fee/margin; ledger.
- [ ] **Subscriptions/billing** · **M** · recurring plan billing (Pemula/Bisnis/Skala); invoices; dunning.
- [ ] **Domains + deploy pipeline** · **M** · custom domain per store; automated per-client storefront deploy.

---

## Suggested order (dependencies)
1. **Epic 0** de-dup + turbo (clean base).
2. **Epic 3** data-layer seam (unblocks a smooth M3) — do in parallel with Epic 1 polish.
3. **Epic 1 / Epic 2** finish the mock prototype (demo-complete).
4. **Epic 4** storefront (M2) — makes it a real end-to-end demo.
5. **Epic 5** Supabase (M3) — it becomes a working product.
6. **Epic 6** integrations (M4) — production-grade.

## Definition of Done (per task)
Builds (`npm run build:*`) + **console 0 issues** · responsive · Bahasa Indonesia + IDR · Base UI conventions (see `apps/admin/AGENTS.md`) · CHANGELOG line · `UI_INVENTORY.md` updated if a screen changed.
