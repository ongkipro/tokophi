# Changelog — TokoΦ

All notable changes. Dates are absolute. Phase: local backend done (Postgres + Drizzle, RBAC + RLS enforcing) · **rebranded to TokoΦ 2026-07-08** · focus = admin-client feature depth (VPS infra deferred).

## 2026-07-13

### 🔴 Security: RLS on `payments` + `media` (migration `0036`) — live and proven in production
- `payments` is **money**, written from the merchant admin, and had **no RLS**: tenant isolation rested entirely on application code. One forgotten `where` and store A could read or mutate store B's payments. Every other store-scoped table was already held by the database.
- The subtle part: `payments.store_id` was **nullable and NULL on every seeded row** (only production code ever set it). A nullable tenant key matches no policy — enabling RLS naively would have made every payment vanish from the app. The migration backfills `store_id` from the parent order, sets NOT NULL + FK, and only then enables RLS.
- **Proven on production data** as the non-owner `tokophi_app` role: the owning store sees its 60 payments, another store sees **0**, a query with no tenant context sees **0**, and a forged cross-tenant insert is rejected — `new row violates row-level security policy`. `verify-rls` is now 38/39 (`platform_activity` is a deliberate owner-only platform log).

### 🔴 Security: the payment callback now fails CLOSED
- `secretOk()` returned `true` when `AUTOLARIS_CALLBACK_SECRET` was missing, so a lost or mistyped env var would have silently opened the endpoint that marks orders **paid** and extends store subscriptions — with nothing but a `console.warn`. It now returns 401 in production (dev still runs without a secret). Verified live.

### Removed the client-admin "Pembayaran" tab
- It let a merchant choose payment channels and who bears the gateway fee — but **nothing read either value**. The storefront checkout reads the *platform's* channel list (ADR 0004: channels are a platform decision), and no pricing code has ever consulted `payment_fee_bearer`. The tab saved, toasted "berhasil", and changed nothing a shopper would see.
- The columns are kept (dropping them is a destructive migration). **A merchant-facing fee-bearer feature does not exist** — if it is wanted, it has to be built into checkout pricing, not merely stored. `AGENTS.md`/`CLAUDE.md` corrected: it described the feature as if it shipped.

### SEO hygiene — admin panels are noindex; `www` redirects to the apex
- **Both admin panels were crawlable after the cutover** (`app.tokophi.com/login` and `rich.tokophi.com/login` served 200 with no robots header, and `/robots.txt` redirected to `/login`). Now `noindex, nofollow` in **three layers** per app: `X-Robots-Tag` from `next.config.ts headers()` (covers `/api/*`, static assets, non-HTML), the same header stamped in `middleware.ts` (a redirect short-circuits before `headers()` runs), plus `metadata.robots` and `app/robots.ts`.
- **Merchant product photos stay indexable** — `/api/uploads/*` is carved out (`X-Robots-Tag: all` + `Allow:`). Those photos are served from the admin origin but embedded in public storefronts, so a blanket noindex would have removed every merchant's product photography from Google Images.
- **Storefronts and the landing page remain fully indexable** — verified live.
- **`www.tokophi.com` → 301 → `tokophi.com`**, path and query preserved (Traefik redirect router). Note: Coolify passes compose labels to Docker without docker-compose's `$$` → `$` unescaping, so the Traefik regex replacement must be written `${1}`, not `$${1}` — the escaped form shipped a literal `https://tokophi.com/${1}` in the `Location` header.

### Landing page — one screen, adaptive
- The front door now fits **a single viewport with no scrolling** at mobile, tablet, and desktop sizes (`100dvh`, not `100vh`). Where the content cannot fit — landscape phones — it is **cut rather than allowed to scroll**. Verified in production at six viewports in both light and dark: `scrollHeight == innerHeight`, `scrollWidth == innerWidth`, zero console errors.
- Copy rewritten around "Seluruh toko Anda, dalam satu panel."; every claim checked against the concept doc and the billing code. Added `robots.txt` and an auto-generated `sitemap.xml`.

### 🚀 `tokophi.com` is live — domain cutover + per-merchant storefronts
- **`<slug>.tokophi.com` serves that merchant's storefront**, from a single storefront container, with the tenant resolved from the `Host` header. Verified in production: `batik-nusantara.tokophi.com` → "Batik Nusantara", `kopi-senja.tokophi.com` → "Kopi Senja", an unknown slug → a clean 404.
- **The self-serve loop is closed:** a store signed up through the real `/daftar` form on production immediately had a working HTTPS storefront at its own subdomain — **no deploy, no DNS change, no manual configuration**. (Test tenant purged afterwards.)
- Surfaces: `tokophi.com` + `www` → the new **landing** app · `app.` → client admin · `rich.` → super-admin · `toko.` → demo store. Old `.sslip.io` hosts still routed as a fallback.
- **TLS:** Let's Encrypt cannot issue a wildcard over HTTP-01, so the per-merchant hosts are served with a **Cloudflare Origin CA certificate** (valid to 2041) installed as Traefik's default certificate. It is trusted **only by Cloudflare**, so every `tokophi.com` DNS record must stay **proxied** — which also means the origin IP is never exposed. Scheme `<slug>.tokophi.com` (one label deep) was chosen because Cloudflare's free Universal SSL covers only a single wildcard level.
- **Traefik router priority is load-bearing:** the wildcard rule also matches `app.`/`rich.`, and Traefik ranks routers by rule *length* by default — the regexp is longer, so without an explicit `priority=1` the storefront would have taken over the admin domain.

### Landing page (`apps/landing`)
- New static Astro app for the apex — "Segera hadir", with working **Masuk** / **Daftar toko** links. Deliberately has **no database and no dependency on Postgres**: the front door must be servable even when everything behind it is down.
- **Fixed a bug it shipped with:** the CTAs rendered `href=""` in production. A bare `ARG` with no `--build-arg` sets the env var to the *empty string*, not `undefined`, so the page's `??` fallback never fired — invisible in local dev, where the variable was simply absent.

### Self-serve signup + Google OAuth (P1.6)
- **`/daftar`** — public signup: one transaction creates account + owner user (scrypt) + store (`trial`, +3 days) + `store_users(owner)` + location + settings + stats + a `platform_activity(signup)` row (`apps/admin/lib/provision.ts`). Slug auto-dedupes; duplicate email rejected. Verified end-to-end against the real DB.
- **Google OAuth** — migration `0034` (`users.auth_provider`, `users.google_sub`), `/api/auth/google/{start,callback}` (jose + Google JWKS). Google on `/daftar` provisions a store; Google on `/login` with an unknown email is rejected (no silent store creation). Existing password users keep their `password_hash` when linking. **Feature-flagged** — with the env unset the button is hidden and the routes redirect. ⚠️ Not yet exercised against real Google credentials.

### Storefront: `Host`-header multi-tenant (ADR 0009 complete)
- **One storefront deploy now serves every store.** The module-level `STORE`/`STORE_ID` singletons are gone: an Astro middleware resolves the tenant from the request `Host` and puts `{store, catalog}` on `Astro.locals`; the catalog is memoized per store id (15s TTL, `STOREFRONT_CACHE_TTL_MS`).
- **Resolution order:** custom domain (seam — no column yet) → `<slug>.$STOREFRONT_BASE_DOMAIN` → first host label (the sslip box) → fallback `STORE_SLUG`. The fallback fires **only when the host names no store at all**; a host naming an unknown slug returns a clean 404 ("Toko tidak ditemukan") rather than serving another merchant's storefront. `RESERVED` labels (`www/app/rich/admin/api/cname/toko/…`) never resolve as a store slug.
- **Checkout branding** — `checkout.astro` renders the resolved store's `logo_url` (wordmark fallback when null).
- `astro build` remains **DB-free** (verified with `DATABASE_URL` unset), so the fast-start/zero-downtime property from 2026-07-10 is intact.

### Tema: named template variants
- `/tema` is now a **template manager** — create/rename/set-default/delete named templates per type (Beranda/Kategori/Produk) and assign one per kategori and per produk (with bulk apply). The Puck builder moved to `/tema/[id]`.
- **No migration needed** — `0031` already shipped `collections.template_id` + `products.template_id`. At most one default per `(store_id, type)`, enforced app-side; deleting a template NULLs any assignment pointing at it. All actions `requireCapability("theme:write")` + `withTenant`.
- ⏳ The storefront still renders only the **homepage** template; category/product template rendering is the next slice.

### 🔴 Security: RLS retrofit for support tickets (migration `0035`)
- `support_tickets` / `support_messages` shipped in migration `0030` — **after** the `0012` RLS migration — and had **no RLS at all**. `lib/actions/support.ts` used the bare **owner** connection with a hand-written `storeId` filter and no `requireCapability`: tenant isolation for tickets rested entirely on application code.
- **Fixed:** `support_messages.store_id` added + backfilled from the parent ticket (NOT NULL + FK); RLS + the standard `tenant_isolation` policy enabled on both tables. Admin reads moved to `lib/data/support.ts` under `withCurrentTenant`; writes go through `requireCapability("support:write")` + `withTenant`. **The database is the boundary now, not app code.**
- New capability `support:write`, granted to **all four roles** — anyone in a store must be able to ask for help; the tenant boundary is RLS, not the role. `requireCapability(cap, { allowSuspended })` lets a **suspended** store still open a ticket (otherwise it could not contact us about the billing problem that suspended it).
- **Verified in psql:** as `tokophi_app` with store A's `app.store_id`, store B's ticket returns 0 rows *even when fetched by primary key*, and inserting a row for store B raises `new row violates row-level security policy`. Super-admin (owner connection) still reads across stores.
- `verify-rls` no longer hand-maintains a table list — it derives the store-scoped set from the catalog (every table with a `store_id`) and **fails** if one lacks RLS. **36/39 green.** ⚠️ Newly surfaced: `media`, `payments`, `platform_activity` have a `store_id` and **no RLS** (`media` is merchant data) — whitelisted and tracked in BACKLOG.

### Storefront renders category/product templates
- Category and product pages now resolve a template (`collections.template_id` / `products.template_id` → the type's default → the hand-built page). One query per store, memoized in the existing catalog cache; the build stays DB-free. An empty template degrades to the fallback instead of rendering a blank page. A Grid Produk with no explicit collection scopes itself to the category being viewed (or the product's category, minus the product itself).
- **A product template replaces only the tail of the product page** — the buy box (galeri, harga, varian, Tambah ke Keranjang) and Ulasan always remain, because no section in the registry can render them and a full replace would ship product pages **with no way to buy**. A `product-detail` section is the proper fix (BACKLOG).
- `/tema` warns when a category template has no **Grid Produk** section — such a template lists no products at all.

### Docs
- **`specs/docs/CHAT_SPEC.md`** — shopper⇄merchant chat spec (separate tables from `support_*`, short-polling transport, anonymous-visitor JWT cookie, 7 slices). Nothing built yet; chat migration slot moved to `0036`.

## 2026-07-10

### Storefront → Astro SSR (zero-downtime deploys)
- **Converted the storefront from SSG-built-at-container-start to SSR** (`@astrojs/node` standalone, `output: 'server'`). The old image ran a full `astro build` at container start (~1–2 min), so every deploy had a window where the new container returned nothing / "not found" until the static build finished — the origin-side cause of deploy downtime.
- **Now:** the catalog is read from Postgres at **server boot** (module-level in `src/data/catalog.ts`), not during `astro build`. The image builds **without a DB** (bundling only) and the container starts in **seconds** (`node dist/server/entry.mjs`).
- **Dynamic routes** (`produk/[handle]`, `kategori/[handle]`) drop `getStaticPaths` → resolve per-request from `Astro.params` (real + virtual `semua`/`promo-gajian` collections; `404` on unknown handle).
- `apps/storefront/Dockerfile` builds at image time + runs the node server; `HOST=0.0.0.0`/`PORT=4327`. Compose storefront healthcheck `start_period` 120s → 30s.
- **Healthcheck fix**: `@astrojs/node` binds IPv4 `0.0.0.0` only, but busybox `wget localhost` resolves `::1` (IPv6) first → false "unhealthy" → Traefik 404 on the live box. Changed the storefront healthcheck to `http://127.0.0.1:4327/`. (The old `serve` bound dual-stack, so `localhost` had worked.)
- **Verified:** builds with `DATABASE_URL` unset; server boots ~1s and serves `/`, `/produk/<h>`, `/kategori/<h>`, `/kategori/semua` (200), unknown handles (404), `/_astro/*` assets (200). Still single-tenant (store by slug at boot); ADR 0009 `Host`-header multi-tenant builds on this base (TODO).

### Support tickets (2-sided) + super-admin manual billing + fixes
- **Support tickets** (migr 0030 `support_tickets` + `support_messages`): **client admin `/bantuan`** (list, open new, thread + reply + close; nav "Bantuan") ↔ **super-admin `/tiket`** (all tickets, status tabs perlu-dibalas/dibalas/selesai, reply as platform + close/reopen; nav "Tiket"). Chat-style thread both sides; store-scoped for merchants, cross-tenant for platform. Seeded 2 demo tickets.
- **Super-admin manual billing** (store detail → Kontrol langganan): **Buat tagihan (VA)** (`createManualInvoice` — reuse-or-create one AutoLaris VA subscription invoice, no duplicate, VA revealed in a dialog, audit-logged) + **Kirim pengingat bayar** (`sendPaymentReminder` — recorded to the store audit; email/WA comms deferred).
- **Image uploads → WebP**: 2MB client cap; server converts every raster to WebP via `sharp` (EXIF-rotate, ≤2000px, q82), SVG passthrough; served via public `/api/uploads/[name]` route (`next start` doesn't serve runtime files in `public/uploads`).
- **Subscription pay flow**: pick cycle → **Lanjutkan pembayaran** → pick platform channel (dialog) → VA/QRIS; no more instant-VA-on-click, no duplicate invoices (reuse pending, migr 0029 `invoices.channel/qr/payment_url`); invoice rows clickable → `/faktur/[number]` (unpaid resumes payment).
- **Seed fix**: billing lifecycle dates now relative to the real clock (`fromNow`) so segments don't lapse on deploy-date drift — Trial tab populated.

### Client-admin "Akun" section (split from Pengaturan)
- **New `/akun/*` route group** with a shared layout + tab nav (Profil · Keamanan · Langganan) — cohesive account UI, own header, active-tab highlight. Moved the 3 pages out of `/pengaturan/*`; Pengaturan is now store-settings only.
- **Profil page** (`/akun/profil`): identity card (avatar, name, email, role, store, joined) + editable name/email (`updateProfile`, email-uniqueness) + quick-link to Keamanan.
- **Top-right avatar menu** made functional: Profil / Keamanan / Langganan are real links (were dead) + Keluar.
- **Subscription badge moved under the logo** (sidebar): stable position (own bordered block above the nav) — no longer shifts on nav clicks; status dot + label + days; VIP → violet pill.

### Subscription billing: PPN 11% + payment history + printable faktur
- **PPN 11%**: plan prices are the DPP (ex-tax); merchant pays base + 11% PPN. `@tokophi/lib/billing` `PPN_RATE`/`withPpn()`/`baseFromTotal()`; `paySubscription` charges the PPN-inclusive total; seed invoices store totals (305.250 / 55.500). Langganan page + pay buttons show the breakdown + note; faktur itemizes Subtotal (DPP) + PPN 11% + Total. MRR stays at the DPP (VIP excluded).
- **Riwayat pembayaran** on the Langganan page: the store's own invoices (no. faktur, jenis, jumlah, status, tanggal) + total dibayar; `getMyInvoices` (owner conn, scoped to session store).
- **Printable faktur** `/faktur/[number]`: standalone print-ready invoice sheet (issuer TokoΦ, bill-to store/owner, line item, Subtotal/PPN/Total, LUNAS/menunggu, VA) + Cetak/Simpan-PDF (`window.print`, `print:hidden` chrome); ownership-scoped via `getFaktur`.

### Payment-gateway fees + grouped client-admin payment menu
- **Fee schedule** `@tokophi/lib/payment-fees` (white-label, per successful storefront txn): VA Rp4.000, e-wallet 2,4%, QRIS 1%, retail (Indomaret/Alfamart) Rp4.000; `paymentFee()` + `splitFee()`; `FeeBearer` (seller | buyer | split).
- **Client admin → Pengaturan → Pembayaran**: new **Biaya Pembayaran** card (fee table + who-bears picker Penjual/Pembeli/50:50, persisted to `store_settings.payment_fee_bearer`, migr 0028) **+** the payment methods menu rebuilt from mock flat toggles into a **grouped, functional** list (COD standalone, then QRIS / Virtual Account / E-Wallet / Minimarket collapsible with counts) that loads platform-enabled channels and persists the store's subset to `store_settings.payment_channels`. Tidied keterangan; dropped legacy tier badge.

### Super-admin store-control overhaul (billing segments + full per-store control)
> _(also 2026-07-09 below — kept together)_

## 2026-07-09

### Billing — single-plan subscription lifecycle (full, operational)
- **Model**: one plan "TokoΦ", **all features** (no tier-gating). Monthly: 3-day free trial → **Rp50rb** first month (promo) → **Rp275rb/month**. **Annual: Rp225rb/mo = Rp2.700.000/yr** (save Rp50rb/mo); paying annually straight from the trial grants a **bonus month → 13 months** (migr 0024 adds invoice `cycle`/`period_months`; callback extends by `addMonths`). `store` subscription fields (`trial_ends_at`/`current_period_end`/`first_invoice_paid`; migr 0022), `store_status += past_due`. `@tokophi/lib/billing` = pricing + `computeBilling()` (trial → active → past_due → 3-day grace → suspended).
- **Client admin**: real subscription in sidebar + `/pengaturan/langganan` (status, countdown, next amount incl promo) + **Bayar/Perpanjang/Aktifkan** → creates a real AutoLaris VA. New store → 3-day trial.
- **Pay + activation**: `paySubscription()` → AutoLaris VA + subscription invoice (`kind/reff/trx/va` cols, migr 0023); pay callback matches the subscription invoice → marks paid + extends `current_period_end` +1mo + `active`.
- **Enforcement**: `requireCapability` throws `SuspendedError` when past grace → all writes blocked (storefront + paying stay up); admin banner for past-due/suspended.
- **Super-admin**: MRR = Rp275rb × active; dashboard "Ringkasan Langganan" + "Status Toko" (aktif/trial/menunggak/ditangguhkan); `/paket` rebuilt = single-plan card + subscription-status breakdown + invoices; store detail shows real subscription state. **Toko list now shows the COMPUTED real-time status** (consistent with detail + enforcement). `getSubscriptionStats()` computes status counts from every store's lifecycle.
- **Analitik → "Keuangan & Analitik"**: finance KPIs (MRR/ARR/pendapatan diterima/GMV) + Ringkasan Pendapatan (lunas/menunggu/tahunan) + Corong Langganan + GMV per kota + **Sistem & Integrasi** status (KiriminAja/AutoLaris/DB/server) via `getFinanceStats()`/`getSystemStatus()`. Dropped legacy per-tier aggregates.
- **Annual plan** (Shopify-style): monthly Rp275rb OR **annual Rp2.700.000 (Rp225rb/mo, save Rp50rb/mo)**; paying annually straight from the trial → **13 months** (bonus). `quote(cycle, firstPaid)` + `addMonths()`; invoices `cycle`/`period_months` (migr 0024); langganan page has Bulanan + Tahunan buttons.
- **Billing cron** `/api/cron/billing` (CRON_SECRET-guarded, schedule daily): syncs stored status to the real-time lifecycle + auto-generates a monthly VA invoice for past-due/suspended stores with no pending subscription invoice. Verified: `{stores:7, statusSynced:1, invoicesCreated:2}`.

### Super-admin store-control overhaul (billing segments + full per-store control)
- **Store lifecycle segments** (migr 0026/0027): the store catalog is split into the 4 sessions **Trial → Bulan pertama (Rp50rb) → Reguler (Rp275rb) → VIP (gratis)**. `@tokophi/lib/billing` gains `storeSegment()` + `SEGMENT_META`; `computeBilling` handles `comped` (VIP → always active, no charge, never suspended/billed — admin `getBilling` + cron read `comped` too).
- **VIP / comp (the "hapus langganan" one-door control)**: `stores.comped/compedReason/compedAt` — super-admin bypasses billing for high-volume merchants hosted free. Store detail shows a VIP banner + **volume-based recommendations** (`store_stats.ship7dAvg`: high volume → suggest VIP, VIP gone quiet → suggest revert).
- **Toko list redesigned**: 4 segment tabs with counts; each row a 1-line summary (segment badge, status, health, GMV, **kiriman/hari 7d**, orders); row menu Jadikan/Cabut VIP; dropped legacy tier column/filter.
- **Store detail = full control**: Gratiskan 1 bulan (`compStore`), Perpanjang trial (`extendTrial`), Jadikan/Cabut VIP (`setStoreComped`), **Reset password owner** + **manage store users** (add/remove/role/reset-pw, one-time temp-password reveal — all scrypt-hashed), suspend/activate; **real per-store invoices** + an **audit log** (`platform_activity.storeId` + `admin` kind — every operator action is recorded).
- **Single-plan cleanup**: seed invoices → Rp275rb/Rp50rb (no more Bisnis/Skala/Pemula tiers), fixed legacy activity text; dashboard + paket show `TokoΦ`/segment, not tier badges. MRR excludes VIP.

### Super-admin Pengaturan redesign (2-column + grouped channels + courier services)
- **2-column layout** like the client-admin Pengaturan: sticky left rail (Pembayaran / Kurir / Tim Platform), content switches per section instead of one long scroll.
- **Payment channels grouped into collapsible sections** by kind — QRIS + COD standalone, then **Virtual Account** / **E-Wallet** / **Minimarket** accordions, each with an `N/M aktif` count + chevron (auto-open when something's enabled). Built on the existing kit (no new dep).
- **Non-active channels locked**: the green "Aktif di AutoLaris" badge comes only from **Sync** (probe `rc=00`), not the toggle; inactive channels show a muted "Belum aktif · Sync" badge with a disabled toggle so a channel AutoLaris rejects can't be offered (would break checkout). Banner shows `N/M channel aktif`.
- **Courier services as chips**: each KiriminAja courier lists its service levels (Reguler highlighted as primary; ekspres/kargo muted) + an `N/M kurir aktif` banner count.
- **Sync now upserts** probed channels (inserts roster codes missing from the DB, e.g. VA Danamon) so the list can't silently drop a channel.

### Super-admin Pengaturan + Analitik polish + integration tests
- **Pengaturan payment unified**: the separate "Gateway Pembayaran" + "Metode Pembayaran AutoLaris" cards are now **one "Pembayaran" section** styled exactly like the courier card — AutoLaris appears **once** as the PSP aggregator banner (Aktif badge + **Test koneksi** + **Sync**), followed by a single flat toggle list of COD + channels (each with an "Aktif di AutoLaris" badge), and one **Simpan** for the whole section. Removes the duplicate AutoLaris naming; precise parity with the ekspedisi list.
- **Analitik → "Server (VPS) · realtime"** card: CPU / RAM / uptime via `node:os` (`getServerMetrics()`; host-level inside the container), color-graded bars, beside the finance + integration status.
- **Integration active/configured rules extracted** to a pure, testable `@tokophi/lib/integration-status` module — `channelActiveFromRc` (AutoLaris `rc="00"` = active) + `isConfigured` (non-empty key); `autolaris`/`kiriminaja` now delegate to it so the "Aktif" badges + "Test koneksi" have one source of truth. Added **vitest** + `integration-status.test.ts` (5 cases) + root `test`/`test:watch` scripts.

### Two-level courier + payment control (super-admin → merchant → shopper)
- **Couriers**: shared roster `@tokophi/lib/couriers` (12 codes incl **SPX**); `platform_couriers` by code (super-admin enable) → client admin picks a subset (`store_settings.couriers`) → ongkir = (merchant ?? all) ∩ platform-enabled. Fixed hard-coded/mock courier list.
- **Payment channels**: `platform_payment_channels` (migr 0020) — super-admin toggle list + **Sync dari AutoLaris** (live-probe → auto-enable active); checkout offers only platform-enabled (`AUTOLARIS_KNOWN_CHANNELS` roster; validation loosened).

### Fixes
- **Impersonation** (super-admin "Buka panel admin" → client admin loaded empty): 3 layered prod-only bugs — cross-subdomain cookie (→ `/impersonate` token exchange), `ADMIN_URL` baked at build (→ runtime read), Node-runtime `req.url` leaking internal `localhost:3000` behind Traefik (→ relative-Location redirect). Verified E2E.
- **MRR chart** near-invisible (fill opacity 0.35 → 0.7).
- Order cancel now restores stock + fails pending payment; white-label courier labels; dropped inactive payment channels (BSI/DANA).

### Deploy infra (Docker + Coolify) + hosting decisions
- **Dev server live**: Vultr Singapore (8 vCPU/16GB AMD, `45.76.146.40`) provisioned via `vultr-cli` + **Coolify v4.1.2**. Hosting = 2-phase **DEV Vultr SG (credit) → PROD Hetzner SG** (migration trivial: Coolify+git+`pg_dump`+Cloudflare). Domain `tokophi.com` in Cloudflare (DNS not pointed). Edge=Cloudflare, origin=Traefik/Coolify (skip HAProxy).
- **Dockerized** for Coolify **Docker Compose** build pack: `apps/*/Dockerfile` (context=repo root; admin/super-admin `next start`, storefront SSG **builds at container start** then `serve`), `.dockerignore`, `docker-compose.coolify.yml` (postgres + one-off migrate/seed + 3 apps + healthchecks), `.env.coolify.example`. **Validated locally** (migrate+seed 7030 areas, all 3 apps serving).
- **Full gotchas/fixes runbook** → `specs/docs/DEPLOY.md` (Nixpacks fails on workspaces → Docker Compose; dummy `DATABASE_URL` at build; storefront build-at-start; migrate bypasses dotenv; RLS role needs superuser; Vultr no-Jakarta/IPv4-included vs Hetzner IPv4-fee; migration steps). New dotfiles skill `vultr`.

### Order-cancel consistency + WYSIWYG editor
- **Restore stock on cancel** + **fail pending payment on cancel** (`setOrderStatus`): cancelling a live order returns reserved stock (mirrors checkout decrement, guarded vs double-restore) and marks still-`menunggu` payments `gagal` so a cancelled order can't be paid later.
- **Rich-text editor (Tiptap, free/MIT)**: `RichTextEditor` (bold/italic/strike, H2/H3, lists, quote, link, undo/redo) replaces the plain textarea + fake toolbars in Halaman + Blog editors; stores HTML in `body`, SSR-safe.

### Packages + scaling prep + docs
- **De-dup**: KiriminAja + AutoLaris clients consolidated into `@tokophi/lib` (server-only `./kiriminaja` + `./autolaris` subpaths) — admin + super-admin now share one canonical client (deleted 4 duplicate files).
- **Pricing cache** (`@tokophi/lib/cache`): in-proc TTL cache wraps `kaShippingPrice` (10 min per route) — cuts KiriminAja rate-limit risk + latency under ad traffic (1st call 5.8s → cached 0.03s). KV/Redis-ready swap for prod.
- **Docs**: `UML.md` refreshed to the implemented state (commerce loop, express+instant shipping, data-layer, Cloudflare-native scaling topology sized for 50–100 clients / 10–30k traffic); `SYSTEM_GUIDE.md` §10 adds the scaling plan.

### Shipping — instant courier (same-day) E2E + UAT (insurance/COD/cancel) + product weight/dims
- **Instant courier** (GoSend/Grab/Borzo): grouped checkout (**📦 Ekspedisi** vs **⚡ Kirim Instan**, geolocation) + **create wired end-to-end** — checkout → pick instant → `kaCreateInstantOrder` dispatches a driver (verified: order + real instant order_id, status `dikirim`). Gotchas: `shipping_price` = `shipping_costs` (not total), top-level `order_prefix`, `service_type`, fresh price. Store coords via Pengaturan → **"Gunakan lokasi saat ini"** (geolocation).
- **UAT (Everpeaks) coverage** (per official `kiriminaja/node` SDK): `request_pickup` supports `insurance_amount`, `cod` (amount; only on `cod:true` services), `width/length/height` (volumetric). **Cancel/void** = `/api/mitra/v3/cancel_shipment {awb, reason≥5}`. Admin Buat Pengiriman: Asuransi + COD toggles + Batalkan.
- **Product weight & dimensions** (migration 0018): editor Berat (gram, prioritized + examples) + Dimensi P×L×T (cm, volumetric explainer); shipment sends real Σweight + max dims. Fix: editing a product no longer changes its handle/URL.
- **COD** recorded — storefront COD checkout writes a `method=cod` payment row; admin shows "COD (Bayar di Tempat)".
- QA: 6 key admin routes crawled → 0 console errors; 3 surfaces build clean; RLS verified.

## 2026-07-08

### Shipping — local KiriminAja area database (7k districts)
- Imported the KiriminAja district map (`districts-mapped.xlsx` → `packages/db/data/kiriminaja-areas.csv`, **7030 kecamatan / 37 provinces**) into a **`kiriminaja_areas`** reference table (migration 0017; `npm run seed:areas`; excluded from demo-reseed truncation). Its `id` = the KiriminAja area id (verified 5507=Semarang Barat, 6981=Danurejan/Yogya).
- `lib/data/areas.ts resolveArea()` — **local table first** (instant, no rate limit, offline) → live `get_address_by_name` fallback; wired into shipping rates/search/create-shipment + the public ongkir endpoint. Pricing + order creation still hit the live API.

### Commerce loop closed — storefront checkout creates a real DB order + linked payment
- New public endpoint `apps/admin/app/api/public/order` — the storefront checkout now **creates a real order** (upsert customer + `orders` + `order_line_items`) and, for non-COD, an **AutoLaris payment linked by `orderId`**. Runs as owner with an explicit `store_id`.
- **Checkout** posts the whole order → real order number **`WEB-…`**; the **sukses page** shows the real number + payment instruction. Storefront orders now **appear in the merchant admin** (Pesanan list + detail) with the linked payment.
- **Pay callback** syncs the linked order → `financialStatus = dibayar` when paid. Verified E2E: VA BCA checkout → `WEB-527789622` (order + line item + payment) → shown in admin → callback → payment berhasil + order dibayar.
- **Payment integrated in the merchant admin**: order detail "Buat Tagihan" (VA/QRIS/DANA, persisted+linked) + real payment status (`getOrderPayment`/`createOrderPayment`).

### Payments — AutoLaris payment gateway (platform-managed) + brand hidden from client
- **Single platform PSP = AutoLaris** (VA 6 banks / QRIS / DANA). `gateway_provider` enum += `autolaris` (migration 0016); seed drops Midtrans/Xendit/Duitku; `payments` table extended (trx_id/channel/va/qr/url/total/admin). Key in gitignored `.env.local` (`AUTOLARIS_API_KEY`/`AUTOLARIS_BASE`), never committed.
- **Super-admin** Pengaturan → Gateway Pembayaran: AutoLaris + live **"Test koneksi"** (`alTestConnection` creates a nominal QRIS bill, checks `rc=00`).
- **Client "tinggal pakai"**: storefront checkout payment channels (QRIS/VA/DANA — generic labels) → public no-auth endpoint `apps/admin/app/api/public/pay` (`create_payment`) → **sukses page shows the real VA number / QRIS / e-wallet instruction**; callback endpoint marks paid; `PUBLIC_PAY_API` env-driven. Verified E2E: VA BCA → real VA `1551410210002419`, total Rp188.500.
- **Brand hidden from client** (per request): removed **"KiriminAja"** (shipping) + **"AutoLaris"** (payment) from the merchant admin + storefront UI — merchants/shoppers see generic labels ("ongkir real-time", "Virtual Account BCA", "dikelola TokoΦ"). Super-admin (platform) still shows the provider brands.

### Shipping — tracking (Lacak) + order auto-status
- Buat Pengiriman advances the order to **"dikirim"**; the order-detail Pengiriman card shows a **"Terdaftar di KiriminAja"** badge + a **"Lacak"** button → `trackShipment()` polls `/api/mitra/tracking`, syncs the real courier AWB when assigned (sandbox returns not-yet-available for a freshly-created shipment — shown as a friendly "menunggu penjemputan"). Webhook-based status push is a prod item (needs a public URL).

### Shipping — real AWB creation working (Buat Pengiriman end-to-end)
- With a registered `KIRIMINAJA_ORDER_PREFIX` (gitignored), **Buat Pengiriman now creates a real KiriminAja pickup**. `request_pickup` package required a few more fields (found by iterating the sandbox validation): `item_name`, `shipping_cost` (= chosen rate cost), `cod`, `package_type_id`. The returned `kj_order_id`/resi is saved to `orders.awb`/`courier`; the order detail + printed label show the real resi/courier. Verified E2E: INV-4821 → "resi 5758-INV4821" persisted.

### Storefront — checkout with live KiriminAja ongkir
- New **public no-auth endpoint** `apps/admin/app/api/public/ongkir` (CORS) — `op=search` (area autocomplete) + `op=rates` (live `shipping_price`); the platform key stays server-side (never in the storefront bundle). `middleware.ts` excludes `/api/public/`.
- **Checkout** (`checkout.astro`): a **"Kecamatan Tujuan"** autocomplete → live courier list from KiriminAja → selecting a service updates **ongkir + total**; replaces the old static shipping radios. Verified E2E: Semarang Barat → 18 live services → Rp27rb ongkir, total recomputed.

### Shipping — KiriminAja config + create shipment + print label (roadmap #1–3)
- **Super-admin config + Test koneksi** — aggregator is now **KiriminAja** (enum `aggregator_provider` += `kiriminaja`, migration 0014); Pengaturan → Integrasi Kurir has a live **"Test koneksi"** (`kaTestConnection()` → `/api/mitra/province`, gated by `requirePlatformAdmin`). Verified: "Terhubung (sandbox) — 37 provinsi".
- **Store sender address** (migration 0015: `store_settings.sender_*`) — admin Pengaturan → Pengiriman has an **"Alamat Pengirim (KiriminAja)"** card: kecamatan autocomplete (`get_address_by_name`) + phone/address/lat-lng, persisted per store.
- **Buat Pengiriman** — the Cek Ongkir dialog gets a **"Buat"** per rate → `createShipment()` builds `request_pickup` (sender from settings + recipient resolved from the order) → saves **AWB/courier** on the order (`orders.awb/courier/ka_order_id`). `order_id` uses `KIRIMINAJA_ORDER_PREFIX` (default `TOKOPHI`) — **must be registered in the KA dashboard** (sandbox rejects unregistered prefixes with a clear hint).
- **Cetak label PDF** — the "Cetak" stub is now a real **100×150mm shipping label** (courier, barcode+resi/AWB, penerima/pengirim, isi, COD/total) → browser print → Save as PDF; uses the real AWB once a shipment exists.
- Verified E2E: sender saved (Yogyakarta), Buat reaches KiriminAja (blocked only on the registered prefix), label renders, Test koneksi green — all console-clean.

### Shipping — KiriminAja live rates (real courier API integration)
- **Real KiriminAja Mitra API integration** (platform-managed aggregator, ADR 0004). `apps/admin/lib/kiriminaja.ts` client — sandbox base `https://tdev.kiriminaja.com` + Bearer key (in gitignored `.env.local`, **not committed**; `.env.example` placeholder). Endpoints verified against the Postman collection (version prefix varies per endpoint: `shipping_price`=v6.1, `get_address_by_name`=v2, `province`/`tracking`=unversioned).
- **Client admin (order detail): "Cek Ongkir"** — `lib/actions/shipping.ts getShippingRates()` resolves the store city + order destination → KiriminAja district IDs (`get_address_by_name`) → live rates (`shipping_price`), shown in a dialog (courier, ETD, cost, COD badges). Verified E2E: order INV-4821 → **18 live services** (Yogyakarta→Semarang), console-clean.
- **Fix: `/pesanan/[id]` 404** — `getOrder` chained `.where()` after `.groupBy()` (landed as HAVING → 0 rows → every order detail 404'd). Now applies the filter before groupBy.
- **Next**: super-admin KiriminAja config + live "Test koneksi"; create-order (→ AWB/resi) + print shipping label PDF.

### Admin — functional global search (⌘K) + docs de-stale
- **Global search** (`lib/data/search.ts getSearchIndex()`, RLS-scoped: products/orders/customers) — the topbar search was cosmetic; now a real filter with a grouped dropdown (Produk/Pesanan/Pelanggan) linking to entity routes; ⌘K focuses, Esc/click-outside closes. Verified: "dress" → 3 product results.
- **Docs**: de-staled README/PRD/ARCHITECTURE/SCHEMA/BACKLOG/TASKS/AGENTS — 53→54 tables, migrations 0000–0016, `platform_admins` (0013); removed "writes pending/mock" (writes are done); BACKLOG marks variants / CSV / global search / super-admin control plane / storefront as done.

### Admin — CSV export (dead "Ekspor" buttons now work)
- New `lib/csv.ts exportCsv()` (client-side, UTF-8 BOM for Excel). Wired all 6 previously-inert **Ekspor** buttons to download the current data: **Pesanan** (filtered orders), **Pelanggan** (filtered customers), **Inventori** (products + live stock), **Analitik** + **Dashboard** (product performance), **Pemasaran** (ad-channel report incl. ROAS). Verified: `pesanan.csv` downloads with 60 rows + correct headers.

### Storefront — variant picker + fashion variant seed (end-to-end variants)
- **Seed**: all 14 Batik Nusantara (fashion niche) products now carry **real Warna × Ukuran variants** (`WARNA_BY_SLUG` × `STOREFRONT_META.sizes` → `product_options` + per-combo `product_variants` + inventory; position-0 = default so list/catalog/orders still read correctly).
- **Catalog** (`data/catalog.ts`) now reads each product's real `options` + `variants` (price/stock per combo), not just the default variant / legacy `products.sizes`.
- **Product page** (`produk/[handle].astro`) — legacy size buttons replaced with a **real variant picker**: one button group per option (Warna, Ukuran); selecting a combo resolves the variant and **live-updates price + a stock indicator** (Stok tersedia / Sisa N / Stok habis → disables add-to-cart). Falls back to legacy sizes for option-less products.
- **Cart is variant-aware**: add-to-cart stores the chosen combo; keranjang + checkout show "Varian: {combo}". Verified E2E: pick Sage/L on Dress Midi → stock "tersedia (32)", cart shows "Varian: Sage / L", console-clean. Storefront builds (29 pages).

### Admin — Real product variants (the deferred core commerce feature)
Schema already supported it (`product_options`, `product_variants` option1/2/3+sku+price, `inventory_levels`); the admin was the gap. Now fully wired:
- **Editor** (`produk/[id]/product-editor.tsx`) — the "Varian" section is a real, **adaptive TikTok-Shop/Shopee-style builder**: **locked to 2 option types** (e.g. Warna + Ukuran, "+" add hidden at 2), custom names, **chip values** (type + Enter to add, ✕ to remove, Backspace pops last), an auto-regenerating **cartesian variant matrix** with per-variant **SKU / harga / stok**, and a **"Terapkan ke semua"** bulk price/stock apply. Edits **hydrate** from saved variants. (`MAX_OPTIONS = 2`; data/actions still support 3 via option1/2/3.)
- **Product list** now shows the **"from" price (min variant)** + **total stock summed across variants** (`getProducts` aggregates) instead of only the default variant.
- **Data** (`lib/data/products.ts`) — `getProduct` returns `options[]` + `variants[]` (+ `hasVariants`); `Product` type extended.
- **Actions** (`lib/actions/products.ts`) — `ProductInput` gains `options`/`variants`; create inserts options + one variant per combo (+ inventory); **update reconciles by option-combo key** — matched variants update in place (keep stock/history), new combos insert, removed combos delete **only if not referenced by `order_line_items`** (else preserved).
- Verified E2E (Playwright → DB): create Ukuran×Warna → 6 variants + per-variant stock override persists; edit hydrates 6 rows; adding "Hijau" → 9 variants with the 6 originals matched (stock kept), **zero duplicates**. Build + console clean.

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
- **admin → DB (Pemasaran) — ADMIN NOW 100% DB-BACKED**: migration 0008 (`ad_channels` +name/brand/pixel/aggregate/`campaigns` jsonb; `ad_metrics.channel_key` nullable); seeded 3 ad-channels + 11 per-province rollup rows; `lib/data/marketing.ts` (`getAdChannels`/`getProvinceStats`); Pemasaran split (server-wrapper + `pemasaran-client.tsx`, `force-dynamic`), sub-tabs threaded with props. Verified parity + 0 console errors. **All 16 admin modules read PostgreSQL** (54 tables).
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
