# TokoΦ — Prototype task breakdown

> **Refreshed 2026-08-15 12:58 UTC** — **90/90 Test Files Passed; 722/722 Tests Passed** with DB-required suites enabled.
> **Tracked audit remediation:** **100% resolved and re-verified.** RLS passed, the 95-entry migration journal is healthy through `0094_magical_salo`, documented OpenAPI operations have zero implementation drift, and all six audited migration-defined indexes have full Drizzle parity.
> **Coverage follow-ups remain explicit:** six Storefront same-origin API routes are absent from the OpenAPI corpus, and the six restored index declarations are not yet pinned in `schema-indexes.test.ts`.
> **Legend:** `[ ]` todo · `[~]` partial · `[x]` done · size **S**/**M**/**L** · AC = acceptance criteria.
> **How to work:** pull the top unchecked task in the current epic → ship → check it → add a CHANGELOG line → update `UI_INVENTORY.md` if a screen changed.

---

## Epic 0 — Monorepo hygiene (foundation)
- [x] Monorepo (npm workspaces): `apps/admin`, `apps/super-admin`, `packages/ui`, `packages/lib`. Both build.
- [ ] **De-dup admin → shared packages** · **M** · migrate `apps/admin` to import `@tokophi/ui` + `@tokophi/lib`; delete its local `components/ui` + `lib/format`/`utils`. AC: admin builds using the packages, zero duplicate UI, console clean.
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
- [ ] **Shared domain types** · **M** · move entity types (Product/Order/Customer/Store/…) to `@tokophi/lib`; both apps import them. AC: no type drift between apps.
- [~] **Wrap admin reads in `lib/data/*`** · **L** · ✅ done (as DB queries) for products/orders/customers/collections/inventory/crm/discounts/pages/articles/purchases/segments/reviews — 12 modules.
- [x] **Wrap super-admin reads in `lib/data/*`** · **M** · done — `apps/super-admin/lib/data.ts` (stores/plans/invoices/metrics), all pages DB-backed.
- [ ] *(Why: makes M3 a "fill query bodies" job, not a UI rewrite.)*

## Epic 4 — Storefront (M2)
- [x] **Scaffold `apps/storefront`** · Astro 5 + Tailwind v4, workspace-linked, uses `@tokophi/lib`. Builds clean (22 pages).
- [x] **Pages** · beranda (hero/unggulan/koleksi/values), `/kategori/[handle]`, `/produk/[handle]` (size + add-to-cart + Beli via WA), `keranjang` (cart + WA checkout).
- [~] **Data source** · self-contained catalog mirroring the admin fashion demo. **TODO:** share via `packages/data` so admin+storefront read one source.
- [~] **SEO** · per-page title/description done. **TODO:** sitemap + feed.
- [x] **Bespoke brand theme** · editorial women's-fashion look (Playfair display + rose/cream tokens) — proves the "per-client look".
- [ ] **Deploy to Cloudflare** · **S** · wire CF Pages/Workers deploy.

## Epic 5 — Backend (M3 — local Postgres/Drizzle → self-hosted VPS)
- [x] **Schema (`@tokophi/db`)** · **L** · 70 tables from `SCHEMA.md` as Drizzle + versioned migrations on **local PostgreSQL 16** (Docker). Seeded single-tenant "Batik Nusantara" = parity with mock.
- [x] **RLS (tenant isolation, enforcing at runtime)** · **L** · migration `0012` = RLS + `tenant_isolation` (`USING`/`WITH CHECK` on `store_id`) on all 32 store-scoped tables + non-owner `tokophi_app` role + `withTenant()`/`withCurrentTenant()`. The admin runs every read + write through the restricted role, so RLS enforces live (auth/super-admin/storefront stay owner). `verify-rls` + `verify-rls-app` + Playwright E2E green.
- [~] **Swap `lib/data` bodies → queries** · **L** · ✅ super-admin (all 5) + admin 16 modules read the DB (`force-dynamic`). ⏳ storefront.
- [x] **Auth + RBAC** · **M** · ✅ **local auth** (email/password → jose JWT httpOnly cookie, `middleware.ts` protects admin, owner `ongki@batiknusantara.id`) + ✅ **RBAC** (`lib/rbac.ts` `requireCapability` gates all 13 mutating action files by `store_users.role`; store_id from the session) + ✅ **RBAC UI** (`lib/rbac-policy.ts` + `useCan`/`<Can>` + role badge; **all admin editors** gate controls per role, Playwright-verified across owner/staff/gudang).
- [x] **Mutations persist** · **L** · ✅ all 12 admin editors save/edit/delete → Drizzle `insert/update` (`lib/actions/*`); refresh keeps changes. Incl. PO create/receive→stock, order-status, stock adjust, CRM follow-up.
- [~] **Storage + rich-text** · **M** · ✅ **local media upload done** (product images → `public/uploads/` + `product_media`). ⏳ Tiptap rich-text for bodies; VPS storage (MinIO/S3) later.
- [x] **Super-admin cross-tenant** · **M** · reads across `store_id`; MRR/GMV/etc. from DB (single-tenant now).

## Epic 7 — Self-serve Store Builder (ADR 0009, worktree `store-builder`, uncommitted)
- [x] **Schema** · `page_templates` + `template_id` FKs + `stores.brand_color`/`logo_url` (migrations 0031–0032, RLS extended).
- [x] **Puck mechanism** · `@measured/puck` embedded at `/tema`, gated `theme:write`; `@tokophi/sections` shared registry (admin Puck config ↔ Astro renderer, one config shape).
- [x] **8 sections v1** · Hero, Grid Produk (mode terlaris/terbaru/acak, max 2/page), Banner Promo, Testimoni (carousel), Image+Teks, Marquee, Rich Text, Navigasi Kategori.
- [x] **Brand colour system** · `@tokophi/lib/colors` generates a 7-shade scale from one merchant hex; storefront `Layout.astro` overrides `--color-brand-*` — every existing utility re-themes for free.
- [x] **Builder UI/UX polish** · full-bleed (`AdminChrome` hides sidebar/topbar on `/tema`), Puck re-themed indigo via its CSS vars, fields swapped to admin's own Input/Textarea/Label.
- [ ] **Category/product template variants** · **L** · many-per-store named templates + assignment UI per collection/product (schema ready, `page_templates.type` already supports it — only the admin management screen is missing).
- [ ] **SSR multi-tenant storefront** · **L** · resolve `store_id` from `Host` header, 1 deploy for all stores (already decided in `PROD_PLAN.md` §5 independent of this epic; Store Builder saves need it to reflect on a *deployed* storefront without a rebuild).
- [ ] **Checkout branding** · **S** · wire `stores.logo_url` into `checkout.astro`'s header (column exists, unread).
- [ ] **Merge to main** · **M** · rebase the `store-builder` worktree branch (still uncommitted as of 2026-07-10, branched before 13 since-landed main commits) — check `lib/rbac-policy.ts`, `lib/nav.ts`, `app/(admin)/layout.tsx` for conflicts with the concurrent billing/Akun work.

## Epic 6 — Platform integrations (M4)
- [~] **Payment gateway** · **L** · ✅ **AutoLaris** integrated (super-admin config + Test koneksi; admin "Buat Tagihan" → VA/QRIS/DANA persisted+linked; storefront checkout create payment → VA/QRIS). ⏳ still: callback signature verify + payment→order-status webhook sync.
- [~] **Shipping aggregator (KiriminAja)** · **L** · ✅ **live ongkir DONE** (2026-07-08): real KiriminAja Mitra API client (`apps/admin/lib/kiriminaja.ts`) + `getShippingRates()` → **"Cek Ongkir"** in the order detail shows live rates (resolves store/dest city → district IDs → `shipping_price`). ⏳ still: super-admin config + Test koneksi; create shipment (`request_pickup` → resi/AWB, needs store sender address); print label PDF; tracking webhook.
- [ ] **Settlement / payout** · **L** · platform collects → payout to merchant, minus fee/margin; ledger.
- [ ] **Subscriptions/billing** · **M** · recurring plan billing (Pemula/Bisnis/Skala); invoices; dunning.
- [~] **Domains + deploy pipeline** · **M** · custom domain per store — add/verify/resolve + admin UI BUILT (2026-07-15); TLS activation + automated per-client deploy pending.

### Conversion tracking, tenant-owned — **ADR 0012**, epic
Every store advertises with THEIR OWN pixels/assets; TokoΦ automates the plumbing, `store_id`-isolated
throughout. Phase checklists + acceptance criteria: **`specs/decisions/0012-meta-commerce-tenant-owned-integration.md`** (§30).
Background work = cron route + DB job table (no worker app, §0.1). Catalog ids MUST equal the existing
`/feed/google.xml` `<g:id>` (§0.2 — one shared `retailerId()` helper enforces it).

> **SCOPE DECISION (2026-07-29):** ship the **manual-pixel path** first — the merchant pastes their own
> Pixel/Tag ID + server token, exactly like Shopify's tracking setup. This needs **no Meta Developer
> App** and works today. OAuth + Catalog PUSH (P4/P5/P6/P10) stay deferred: ADR §0.2 already says the
> existing PULL feed covers the catalog, and those phases cannot be live-verified without credentials.
> **COD attribution signed off:** COD = Purchase at order creation (the thanks page); prepaid = Purchase
> when the gateway callback confirms payment.

- [x] **P1 — Shared ids + provider boundary** · **M** · `@tokophi/lib/tracking-ids` (`retailerId`, `purchaseEventId`, unit-tested + wired into `google.xml.ts` so feed and events cannot drift); `apps/admin/lib/capi.ts` = the ONE provider boundary (Meta CAPI · GA4 MP · TikTok Events API) with retry classification + `capi-sanitize.ts` (tested).
- [x] **P2 — Schema + migrations** · **L** · `store_tracking_channels` (0079) + `tracking_event_deliveries` (0080, `tracking_delivery_status` enum, due/store indexes, `unique(store_id,channel,event_id)`); RLS on both, `verify-rls` green 48/49.
- [x] **P3 — Token encryption + env** · **S** · versioned AES-256-GCM (`apps/admin/lib/crypto.ts`, `INTEGRATION_TOKEN_KEY`, `v1:` prefix so keys can rotate); refuses to store a token when unset; redaction in `capi-sanitize.ts`; documented in `DEPLOY.md`.
- [ ] **P4 — Meta OAuth + asset selection** · **L** · **DEFERRED** — needs a Meta Developer App (`META_APP_ID`/`SECRET`/redirect URI). The manual token path above covers the MVP.
- [x] **P5a — Catalog feeds hardened + stable ids** · **L** · **ADR 0013**: `products.number` + `product_variants.seq` (migration 0081) → catalog id `{number}-{seq}`, allocate-once; one shared feed builder serving `/feed/google.xml` (Google + Meta) and the new `/feed/tiktok.xml`; fixed the whole-feed XML rejection, the flash-sale price mismatch, the `in_stock` enum, photo-less items, and added `sale_price` / `identifier_exists` / `product_type` / extra images. Per-store cutover (`stores.catalog_id_scheme`) because a re-key is one-way.
- [ ] **P5b — Catalog PUSH sync engine** · **L** · **DEFERRED** — the PULL feeds above serve all three providers; push (Meta Catalog API) needs OAuth, and is an upgrade rather than a prerequisite.
- [ ] **P6 — Transaction-safe sync triggers** · **M** · **DEFERRED** with P5.
- [x] **P7 — Storefront tenant pixel + browser events** · **M** · `MarketingPixels.astro` — per-store fbq/gtag/ttq bootstrap, PageView · ViewContent · AddToCart · InitiateCheckout · Purchase, server-issued shared `event_id`, catalog-matching `content_ids`, hashed advanced matching. ⚠️ **No consent gate exists in this repo** — tracked below.
- [x] **P8 — Server-side conversion delivery** · **L** · enqueue from committed order state (`lib/tracking-events.ts`), `api/cron/tracking-events` + `cron-tracking-events` sidecar (60 s), atomic claim, bounded backoff → `dead_letter`, idempotent by `unique(store_id,channel,event_id)`.
- [x] **P9a — Seller diagnostics** · **M** · per-channel 7-day health strip (terkirim/antre/dicoba ulang/gagal + last sanitized error) on Pemasaran → Pelacakan.
- [ ] **P9b — Super-admin Meta Health** · **S** · cross-tenant delivery health table (sanitized, no tokens) + retry action. *(not built)*
- [ ] **P10 — Webhooks + lifecycle hardening** · **M** · **DEFERRED** with P4 (provider webhooks need the app).
- [ ] **P11 — Live verification with real pixels** · **M** · **BLOCKED on credentials**: a real Meta Pixel + CAPI token, GA4 property + MP secret, TikTok pixel + Events API token. Everything above is verified by build/tests/RLS + code review only — **no live provider call has been made**. Record honestly in `WORKLOG.md` when it happens.
- [x] **Credential lifecycle** · **M** · per-channel "Uji koneksi" probe (Meta empty-`data` auth probe, TikTok body-code probe, GA4 honestly labelled "format only — Google does not validate credentials"), "Hapus token" (the clear path existed but was unreachable), `capiConfigured` = decryptable rather than present, audit entries on credential change, rate-limited retries, owner-only READ on the Pelacakan tab.
- [ ] **Consent gating (privacy)** · **M** · ADR 0012 §15.7 expects marketing tracking to respect consent. TokoΦ has **no consent mechanism at all** today (no banner, no stored preference). Needs its own decision — do not fake it with a `localStorage` flag nobody sets.

---

## Suggested order (dependencies)
1. **Epic 0** de-dup + turbo (clean base).
2. **Epic 3** data-layer seam (unblocks a smooth M3) — do in parallel with Epic 1 polish.
3. **Epic 1 / Epic 2** finish the mock prototype (demo-complete).
4. **Epic 4** storefront (M2) — makes it a real end-to-end demo.
5. **Epic 5** self-hosted Postgres (M3) — it becomes a working product.
6. **Epic 6** integrations (M4) — production-grade.

## Definition of Done (per task)
Builds (`npm run build:*`) + **console 0 issues** · responsive · Bahasa Indonesia + IDR · Base UI conventions (see `apps/admin/AGENTS.md`) · CHANGELOG line · `UI_INVENTORY.md` updated if a screen changed.
