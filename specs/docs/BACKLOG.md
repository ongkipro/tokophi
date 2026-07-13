# TokoΦ — Backlog & task board

> Prioritized work list derived from a full screening of the codebase. Living doc — update as items ship.
> Companion to `CONCEPT.md` (what/why), `SCHEMA.md` (backend target), `UI_INVENTORY.md` (screen status), `../PRD.md`.
> Legend: `[ ]` todo · `[~]` partial · `[x]` done. Updated 2026-07-03.

## P0 — Foundation (do before/for backend)
- [~] **Backend** — ✅ **local PostgreSQL 16 + Drizzle** (`@tokophi/db`, 54 tables, migrations 0000–0016; payments+gateway+shipping cols) live: all 3 surfaces read + all 12 admin editors write + local auth (jose JWT) + **RBAC** (capability matrix gates all mutations) + **RLS ENFORCING at runtime** (migration 0012 + admin routes every read/write through the non-owner `tokophi_app` role via `withTenant`/`withCurrentTenant`; `verify-rls` + `verify-rls-app` + E2E green) + local media upload. ⏳ then the VPS server itself (self-hosted Postgres + PostgREST + Storage). See `SCHEMA.md` + ADR 0007/0008.
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
- [x] **Pesanan detail page** `/pesanan/[id]` — DONE: full detail route (status pipeline, shipping card + Cek Ongkir/Buat Pengiriman/Lacak/Cetak label, payment card + Buat Tagihan). ⏳ still: draft/manual order, refund/return, abandoned checkout.
- [x] **Payments — AutoLaris gateway** — DONE: super-admin config + Test koneksi; admin order "Buat Tagihan" (VA/QRIS/DANA, persisted+linked); storefront checkout create payment → sukses VA/QRIS. ⏳ still: callback signature verification.
- [x] **Storefront → real DB order** — DONE: checkout `/api/public/order` creates customer + order + line items + linked payment (`WEB-…`); appears in the merchant admin; pay callback → order `dibayar`. Line items resolve to `variantId`, **inventory decrements**, and **out-of-stock carts are rejected** (real oversell prevention). ⏳ still: restore stock on order-cancel; abandoned-cart.
- [ ] **Diskon edit route** `/diskon/[id]` (today create-only dialog).
- [x] **Real variants** — DONE (2026-07-08): adaptive TikTok-Shop/Shopee-style editor (2 option types, chip values, "Terapkan ke semua" bulk apply) → cartesian matrix (per-variant sku/harga/stok) → reconcile-by-combo (history-safe) → storefront variant picker → variant-aware cart. All 14 fashion products seeded Warna×Ukuran.
- [~] **Shipping — KiriminAja (real courier API)** — ✅ **live ongkir** in the order detail ("Cek Ongkir" → live rates via `shipping_price`, city→district resolved by `get_address_by_name`; key in gitignored `.env.local`). ⏳ still: super-admin config + "Test koneksi"; **Buat Pengiriman** (`request_pickup` → resi/AWB, needs a store sender address: kecamatan_id/kelurahan_id/lat/lng); **cetak label PDF** (the "Cetak" button is still a toast stub); tracking webhook. See `CHANGELOG.md` + `SYSTEM_GUIDE.md` §Integrations.
- [~] **Media / rich-text** — ✅ real product **image upload** (`public/uploads/` + `product_media`, 5MB cap, per-image delete). ⏳ still: video slot, Storage (VPS/MinIO/S3), **Tiptap** rich-text for product/page/article bodies (currently textarea + decorative toolbar).
- [x] **Ekspor CSV** — DONE (2026-07-08): all 6 Ekspor buttons (Pesanan/Pelanggan/Inventori/Analitik/Dashboard/Pemasaran) download real CSV via `lib/csv.ts`.
- [x] **Global search (⌘K)** — DONE (2026-07-08): topbar returns real results (products/orders/customers, RLS-scoped) linking to entity routes; ⌘K focus.

## P1.5 — Self-serve Store Builder / "Tema" (ADR 0009 — merged to `main` 2026-07-10, **NOT finished**)
> Core builder is live on `main` (`/tema`, `@measured/puck`, 8 sections, brand colour, migrations 0031–0032). **Still open** (see unchecked items below) — the "tema" feature is **not done yet**: template variants, checkout branding, and now that the storefront is SSR, live-reflect-on-deployed still needs `Host`-multi-tenant.
- [x] **Homepage drag-drop builder** — DONE: `@measured/puck` at `/tema` (`theme:write` gated), 8 sections (Hero/Grid Produk/Banner Promo/Testimoni/Image+Teks/Marquee/Rich Text/Navigasi Kategori), `@tokophi/sections` shared registry, `page_templates` schema (migrations 0031–0032). Verified E2E repeatedly (real drag-drop → publish → `astro build` → rendered HTML).
- [x] **Brand colour panel** — DONE: one merchant hex → full shade scale (`@tokophi/lib/colors`) → storefront-wide CSS-var override, no markup changes needed. `stores.brand_color` (migration 0031).
- [x] **Category/product template variants** — ✅ DONE (2026-07-13): `/tema` is a template manager (3 tabs, create/rename/set-default/delete + per-kategori & per-produk assignment + bulk apply); builder moved to `/tema/[id]`, saves per template id. **No migration** — `0031` already had `collections.template_id` + `products.template_id`. ⏳ **the storefront still renders only the homepage template** — consuming category/product templates is the next slice (contract in WORKLOG 2026-07-13).
- [x] **SSR multi-tenant storefront** — ✅ **DONE (2026-07-13)**: SSR base (2026-07-10) + **`Host`-header multi-tenant** — `getStoreByHost()` + Astro middleware put `{store, catalog}` on `Astro.locals`; per-store memoized catalog (15s TTL); resolution = custom domain (seam) → `<slug>.$STOREFRONT_BASE_DOMAIN` → first host label → fallback `STORE_SLUG`; unknown host → clean 404, never another merchant's store. ONE deploy serves EVERY store. Verified with 2 stores on one process + DB-free `astro build`.
- [x] **Checkout branding** — ✅ DONE (2026-07-13): `checkout.astro` renders the resolved store's `logo_url` (wordmark fallback when null); brand colour already flowed via CSS vars.
- [x] **Merge** — ✅ rebased onto `main` and landed (migrations renumbered 0031–0032; conflicts in layout/schema/lib resolved, re-verified). Tema now builds + deploys with the rest.

## P1.6 — Next up (onboarding + client comms) — planned 2026-07-11
> New capability track requested 2026-07-10. Turns TokoΦ from a single seeded demo into a self-serve, multi-merchant platform + gives each merchant a real customer-comms surface.

- [x] **Self-serve register (signup)** — ✅ DONE (2026-07-13): public `/daftar` → `lib/actions/register.ts` → `lib/provision.ts` `provisionStore()` (ONE txn: accounts→users(scrypt)→stores(trial, +3d)→store_users(owner)→locations→store_settings→store_stats→`platform_activity(signup)`), slug dedupe + email uniqueness → session cookie → redirect. Verified E2E against the real DB. Logic replicated from super-admin `createStore` (not imported — super-admin keeps its ANCHOR date; signup uses real `now()`).
- [~] **Google auth (OAuth login)** — code DONE (2026-07-13), **UNPROVEN**: migration `0034` (`users.auth_provider`, `users.google_sub`), `lib/google.ts` + `/api/auth/google/{start,callback}` (jose + Google JWKS). **Decided:** Google on `/daftar` auto-provisions a store; Google on `/login` with an unknown email is rejected (no silent store creation); existing password user + same verified email → link `google_sub`, KEEP `password_hash`. Feature-flagged (env unset → button hidden, routes redirect, no crash). ⏳ **needs real Google credentials** — the code-exchange/JWKS path has never actually run.
- [ ] **Custom domain for client** — a merchant attaches their own domain (e.g. `batiknusantara.com`) to their storefront. **Unblocked now** (`Host`-multi-tenant landed): the `slugFromCustomDomain()` SEAM in `apps/storefront/src/data/store.ts` is a one-function stub, and the host is already the cache key. Still needed: `stores.custom_domain` / `store_domains` migration + admin UI + Cloudflare-for-SaaS (`cname.tokophi.com`) or a Traefik per-domain router + cert. Supersedes the P2 "Domain" stub. White-label: their domain, our infra.
- [ ] **Ticketing UI/UX → customer⇄seller chat + merchant chat dashboard** — 📄 **SPEC DONE (2026-07-13): `specs/docs/CHAT_SPEC.md`** (7 slices, slice 1 unblocked). Decisions: `support_*` ("Tiket", merchant⇄platform) and the new "Obrolan" (shopper⇄merchant) stay **separate tables** sharing one extracted `<Thread>` UI; transport v1 = **short polling with a cursor** (no pub/sub exists; Traefik/CF mangle long-lived connections; payload = the future SSE payload so the upgrade is drop-in); anonymous shopper = signed jose JWT in a first-party httpOnly `tokophi_chat` cookie minted on first message; chat API lives in the storefront's own Astro routes (first-party cookie survives merchant custom domains). Migration `0035`. **Nothing built yet.**
- [x] **🔴 RLS retrofit for `support_*`** — ✅ **DONE (2026-07-13, migration `0035`)**: `support_messages.store_id` added + backfilled (NOT NULL + FK); RLS + the `0012` `tenant_isolation` policy on both support tables; admin reads → `withCurrentTenant` (`lib/data/support.ts`), writes → `requireCapability("support:write")` + `withTenant`. New cap granted to all 4 roles; `requireCapability(cap, {allowSuspended})` lets a suspended store still open a ticket. **Proven in psql:** as `tokophi_app` with store A's GUC, store B's ticket is invisible even by PK and an insert for store B is rejected by the policy. `verify-rls` now derives the table set from the catalog (36/39 green).
- [ ] **🔴 RLS for `media`, `payments`, `platform_activity`** (surfaced 2026-07-13 by the new catalog-derived `verify-rls`) — all three have a `store_id` but **no RLS**; currently whitelisted as `KNOWN_EXCEPTIONS`. **`media` is merchant data** (product images, written by `lib/actions/media.ts`) → the real one. Audit each write path, then enable RLS + policy and drop it from the exception list. **Next security slice.**
- [ ] **Hydration bug `/bantuan`** — `bantuan-client.tsx` calls `Date.now()` during render (breaks the determinism rule → SSR ≠ client). Pre-existing.
- [x] **Finish "Tema" / Store Builder** — ✅ DONE (2026-07-13): template variants + checkout branding + **the storefront now renders category/product templates** (assignment → type default → hand-built fallback; empty templates degrade instead of rendering blank; Grid Produk auto-scopes to the category/product in context).
- [ ] **`product-detail` section** — a product template currently replaces only the TAIL of the PDP; the buy box (galeri/harga/varian/Tambah ke Keranjang) + Ulasan are always kept, because **no registry section can render them** and a full replace would ship unbuyable product pages. Add a `product-detail` section to `@tokophi/sections` + admin Puck + an Astro renderer → then a product template can own the whole page.
- [ ] **Landing page for the apex** (`tokophi.com`) — still not built; the domain cutover points apex/`www` at a placeholder or a redirect to `app.` until it exists.
- [ ] **etc.** — capture more of the "own app / unified" vision as it firms up (notifications, presence, mobile).

## P1.7 — Domain cutover to `tokophi.com` — ✅ **DONE 2026-07-13, LIVE**
> Scheme: **`<slug>.tokophi.com`** (one label deep → free Cloudflare Universal SSL, stays proxied). TLS for the wildcard = **Cloudflare Origin CA cert** as Traefik's default cert (LE cannot issue a wildcard over HTTP-01) → **every record must stay PROXIED**. Full detail + gotchas in WORKLOG 2026-07-13 and `DEPLOY.md`.

- [x] DNS in Cloudflare — `@`, `www`, `app`, `rich`, `toko`, `*` → `45.77.33.112`, all **proxied**. (Proxied wildcard turned out to be allowed on the **Free** plan.)
- [x] Coolify per-service domains (old `.sslip.io` hosts kept alongside as a fallback) + **Traefik wildcard router** with **`priority=1`** — load-bearing: the regexp also matches `app.`/`rich.` and Traefik's default priority is rule LENGTH, so without it the storefront would have hijacked the admin host.
- [x] Cross-surface env → `https://app.tokophi.com`, plus `STOREFRONT_BASE_DOMAIN=tokophi.com` + `STORE_SLUG` fallback.
- [x] **Landing app** (`apps/landing`, static Astro, "Segera hadir", no DB) on the apex + `www`.
- [x] **Verified in production:** a store signed up through the real `/daftar` form got a working HTTPS storefront at `<its-slug>.tokophi.com` with **zero deploys and zero DNS work**.
- [x] **SEO hygiene** — admin + super-admin are `noindex, nofollow` in 3 layers (config header + middleware header + `metadata`/`robots.txt`), with `/api/uploads/*` carved out so merchant product photos stay in Google Images. Storefronts + landing stay indexable. Landing has `robots.txt` + `sitemap.xml`.
- [x] **`www` → apex 301** (Traefik `redirectregex`, path+query preserved).
- [ ] **⏳ YOU: set the zone's SSL mode to `Full (strict)`** in the Cloudflare dashboard — our API token lacks *Zone Settings: Edit*, so it could not be set programmatically.
- [ ] **⏳ YOU (if any panel URL is already indexed):** check `site:app.tokophi.com` / `site:rich.tokophi.com` and purge via Search Console → Removals. The `noindex` header handles everything not yet indexed.
- [ ] Move the `www` redirect to the **Cloudflare edge** (cheaper than hitting the origin) — needs *Zone → Config Rules → Edit* on the API token, which it currently lacks.
- [ ] De-dup: `noRobots()` is copy-pasted in both apps' `middleware.ts` — belongs in `@tokophi/lib`.
- [ ] Cloudflare cache rules: bypass for `app.`/`rich.`/`/api/*`; cache `/_astro/*` + `/products/*` on storefront hosts.
- [ ] Billing-cron URL + AutoLaris callback still point at the old host — move to `https://app.tokophi.com` (`PUBLIC_APP_URL` is already correct, verify the AutoLaris dashboard).
- [ ] A Coolify API token **`claude-domain-cutover`** was created for this cutover — revoke it when you want.

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
