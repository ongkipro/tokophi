# TokoΦ — Backlog & task board

> Prioritized work list derived from a full screening of the codebase. Living doc — update as items ship.
> Companion to `CONCEPT.md` (what/why), `SCHEMA.md` (backend target), `UI_INVENTORY.md` (screen status), `../PRD.md`.
> Legend: `[ ]` todo · `[~]` partial · `[x]` done. Updated 2026-07-03.

## P0 — Foundation (do before/for backend)
- [~] **Backend** — ✅ **local PostgreSQL 16 + Drizzle** (`@tokophi/db`, 54 tables, migrations 0000–0013) live: all 3 surfaces read + all 12 admin editors write + local auth (jose JWT) + **RBAC** (capability matrix gates all mutations) + **RLS ENFORCING at runtime** (migration 0012 + admin routes every read/write through the non-owner `tokophi_app` role via `withTenant`/`withCurrentTenant`; `verify-rls` + `verify-rls-app` + E2E green) + local media upload. ⏳ then the VPS server itself (self-hosted Postgres + PostgREST + Storage). See `SCHEMA.md` + ADR 0007/0008.
- [x] **Extend the data-layer seam to ALL screens.** ✅ Reads via `lib/data/*` (super-admin + 16 admin modules + storefront `@tokophi/db`). ✅ Writes via `lib/actions/*` (all 12 editors). `lib/mock` kept only for decorative bits (live ticker, analitik breakdowns).
- [x] **Auth + real multi-tenant.** ✅ local login/session + **RBAC** (capability matrix, `store_id` from the session) + **RLS enforcing at runtime** (admin routes every read/write through `tokophi_app` via `withTenant`/`withCurrentTenant`). Store switcher is still cosmetic (single-tenant demo), but the tenancy boundary is real. VPS just points PostgREST at the same setup.

## P1 — Functional completeness (mostly wireable now, no backend)
- [x] **RBAC UI rollout.** ✅ infra (`lib/rbac-policy.ts` + `useCan`/`<Can>` + role badge) + **all admin editors** gate their write/delete/create controls per role (Produk, Diskon, Halaman, Blog, Kategori, Pelanggan, CRM, Segmen, Pembelian, Inventori, Navigasi, Pesanan, Pengaturan). Playwright-verified across owner/staff/gudang. (Server actions still enforce — UI is UX.)
- [ ] **De-dup: migrate `apps/admin` to consume `@tokophi/ui` + `@tokophi/lib`** and delete its local `components/ui` + `lib/format`/`utils`. (Monorepo is set up; super-admin already uses the shared packages; admin still has its own copies — see AGENTS.md. Do this carefully so the mature admin keeps building.)
- [~] **Super-admin: deepen** — ✅ DONE (2026-07-08): provisioning ("Tambah toko" one-txn tenant onboard), **real impersonation** (mints admin session → opens admin scoped to the store via RLS), settings persistence (gateways/couriers/COD), team invite (real `platform_admins`), billing actions (mark invoice), composite healthcheck, platform-admin auth (`platform_session`). ⏳ still: support/tickets, saved reports.
- [x] Edit routes for content: `/halaman/[id]`, `/blog/[id]` (prefilled) — done.
- [x] Fix no-op "Edit" menu items (Produk, Kategori) — now open editors.
- [x] Storefront slugs Indonesian & consistent: `/produk/`, `/kategori/`, nav uses `/blog//halaman/` — done.
- [x] Toasts (sonner) on save/delete for Produk, Koleksi, Menu — done. **[ ] extend** to remaining editors (Halaman, Blog, Pelanggan, Pengaturan, Diskon) + destructive **confirm dialogs** before delete.
- [ ] **Pesanan detail page** `/pesanan/[id]` (today only a Sheet); draft/manual order; refund/return; abandoned checkout.
- [ ] **Diskon edit route** `/diskon/[id]` (today create-only dialog).
- [x] **Real variants** — DONE (2026-07-08): adaptive TikTok-Shop/Shopee-style editor (2 option types, chip values, "Terapkan ke semua" bulk apply) → cartesian matrix (per-variant sku/harga/stok) → reconcile-by-combo (history-safe) → storefront variant picker → variant-aware cart. All 14 fashion products seeded Warna×Ukuran.
- [~] **Media / rich-text** — ✅ real product **image upload** (`public/uploads/` + `product_media`, 5MB cap, per-image delete). ⏳ still: video slot, Storage (VPS/MinIO/S3), **Tiptap** rich-text for product/page/article bodies (currently textarea + decorative toolbar).
- [x] **Ekspor CSV** — DONE (2026-07-08): all 6 Ekspor buttons (Pesanan/Pelanggan/Inventori/Analitik/Dashboard/Pemasaran) download real CSV via `lib/csv.ts`.
- [x] **Global search (⌘K)** — DONE (2026-07-08): topbar returns real results (products/orders/customers, RLS-scoped) linking to entity routes; ⌘K focus.

## P2 — Missing modules (from the concept feature map)
- [x] **Storefront (Astro)** — DONE: Batik Nusantara reads the shared catalog live; real variant picker (Warna/Ukuran → live price+stock) + variant-aware cart (keranjang/checkout).
- [ ] Produk: **transfer stok** antar-lokasi, **pemasok (supplier) CRUD** (PO references suppliers).
- [ ] Pelanggan: **loyalitas/poin**.
- [ ] CRM: **broadcast & otomasi WhatsApp** (today: follow-up worklist + templates + pipeline only).
- [ ] Pemasaran: **kampanye email/WA**, automations (welcome, abandoned-cart).
- [ ] **Kartu hadiah (gift cards)**, **Domain**, **Template notifikasi** (toggles exist in Pengaturan; message editor doesn't).
- [ ] Analitik: **laporan kustom** + saved reports.

## P3 — Polish
- [ ] Loading/skeleton states (all static today).
- [ ] Full dark-mode visual QA pass.
- [ ] Accessibility audit (aria mostly present; not formally checked).
- [ ] Tests (none yet) — at least smoke tests per route.
- [ ] "Rentang khusus…" custom date range (currently disabled "segera").

## Recently shipped (context)
**Monorepo** (npm workspaces): `apps/admin` + `apps/super-admin` + `packages/ui` (shared shadcn/Base UI) + `packages/lib` (formatters). **Super Admin platform panel** (Dashboard MRR/GMV/churn, Toko/merchant management + detail, Paket & Billing, Analitik, Pengaturan) on the shared design system, :3001. · CRM module (Follow-up WA/Pipeline/Template) · product sub-modules (Kategori/Koleksi editor Manual+Otomatis, Inventori stepper, Purchase Orders) · customer detail page · collection editor · Halaman/Blog edit routes · Pemasaran province filter · Pengaturan redesign (settings-nav + Notifikasi) · **fashion-niche demo with 14 AI-generated product photos** · product list → Shopify-style compact table · channel model (sales channel = Toko Online; attribution = Meta/TikTok/Google Ads + Organic/Other) · concept docs (CONCEPT/SCHEMA/UI_INVENTORY).

*How to use: pull the top unchecked P0/P1 item, ship it, check it, add a CHANGELOG line, and update `UI_INVENTORY.md` if a screen changed.*
