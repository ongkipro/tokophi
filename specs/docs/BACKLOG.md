# Indostore — Backlog & task board

> Prioritized work list derived from a full screening of the codebase. Living doc — update as items ship.
> Companion to `CONCEPT.md` (what/why), `SCHEMA.md` (backend target), `UI_INVENTORY.md` (screen status), `../PRD.md`.
> Legend: `[ ]` todo · `[~]` partial · `[x]` done. Updated 2026-07-03.

## P0 — Foundation (do before/for backend)
- [~] **Backend** — ✅ **local PostgreSQL 16 + Drizzle** (`@indostore/db`, 53 tables) live: all 3 surfaces read + all 12 admin editors write + local auth (jose JWT) + local media upload. ⏳ **RBAC + RLS by `store_id`** (local), then VPS (self-hosted Postgres + PostgREST + Storage). See `SCHEMA.md` + ADR 0007/0008.
- [x] **Extend the data-layer seam to ALL screens.** ✅ Reads via `lib/data/*` (super-admin + 16 admin modules + storefront `@indostore/db`). ✅ Writes via `lib/actions/*` (all 12 editors). `lib/mock` kept only for decorative bits (live ticker, analitik breakdowns).
- [~] **Auth + real multi-tenant.** ✅ local login/session done; store switcher still cosmetic — ⏳ scope data by `store_id` (RBAC + RLS from the session JWT).

## P1 — Functional completeness (mostly wireable now, no backend)
- [ ] **De-dup: migrate `apps/admin` to consume `@indostore/ui` + `@indostore/lib`** and delete its local `components/ui` + `lib/format`/`utils`. (Monorepo is set up; super-admin already uses the shared packages; admin still has its own copies — see AGENTS.md. Do this carefully so the mature admin keeps building.)
- [ ] **Super-admin: deepen** — provisioning (create store) flow, real impersonation stub, support/tickets, platform-wide settings persistence, saved reports. (Dashboard/Toko/Paket/Analitik/Pengaturan shells done.)
- [x] Edit routes for content: `/halaman/[id]`, `/blog/[id]` (prefilled) — done.
- [x] Fix no-op "Edit" menu items (Produk, Kategori) — now open editors.
- [x] Storefront slugs Indonesian & consistent: `/produk/`, `/kategori/`, nav uses `/blog//halaman/` — done.
- [x] Toasts (sonner) on save/delete for Produk, Koleksi, Menu — done. **[ ] extend** to remaining editors (Halaman, Blog, Pelanggan, Pengaturan, Diskon) + destructive **confirm dialogs** before delete.
- [ ] **Pesanan detail page** `/pesanan/[id]` (today only a Sheet); draft/manual order; refund/return; abandoned checkout.
- [ ] **Diskon edit route** `/diskon/[id]` (today create-only dialog).
- [ ] **Real variants** — the product "Varian" toggle is UI-only; model per-variant sku/price/stock + inventory per location.
- [ ] **Real media upload** — image + the single video slot are mock; wire Storage + a real uploader; **rich-text editor** (Tiptap) for product/page/article bodies (currently textarea + decorative toolbar).
- [ ] **Ekspor** buttons (Analitik, Inventori, Pemasaran) do nothing — wire CSV export.
- [ ] Topbar **global search** (⌘K) is cosmetic — make it return real results.

## P2 — Missing modules (from the concept feature map)
- [ ] **Storefront (Astro)** — 1 sample brand reading the same catalog (M2). Makes "Lihat di toko" real.
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
