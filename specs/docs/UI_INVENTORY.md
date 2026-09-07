# TokoΦ — UI Inventory (screen map)

> The go-to map of TokoΦ's surface area across **all four apps**. Routes enumerated from the
> filesystem (`apps/*/app` and `apps/*/src/pages`) — first on 2026-07-02, **re-swept 2026-09-07**
> against the generated [`PAGE_MAP.md`](./PAGE_MAP.md) (which is the authority for *which URL is
> which file, what it reads, what gates it*; this file keeps the *purpose and interactions*).
> **Every surface reads and writes local PostgreSQL** (Drizzle, `@tokophi/db`): Seller reads go
> through `lib/data/*` under `withCurrentTenant` (RLS), writes through `lib/actions/*` server
> actions under `withTenant`; Super Admin reads `lib/data.ts` on the owner connection and every
> mutation in `lib/actions.ts` opens with `platformGate(min)`. The line that stood here until
> 2026-09-07 — *"the rest is still deterministic seeded mock. Mutations don't persist yet (M3)"* —
> had been false since July: `apps/super-admin/lib/mock.ts` no longer exists and
> `apps/admin/lib/mock/store.ts` survives only as a **type** source (`Activity`, `BlogPost`,
> `Collection`, …) for the DB-backed readers.

## Four surfaces
| App | Package | Port (dev) | Stack | Who uses it |
|---|---|---|---|---|
| **admin** ("Seller") | `@tokophi/admin` | `:3000` | Next.js (App Router) | The merchant / shop owner |
| **super-admin** ("Super Admin") | `@tokophi/super-admin` | `:3001` | Next.js (App Router) | Us — platform control plane (all stores / billing / payouts) |
| **storefront** | (Astro app) | `:4327` | Astro **SSR** (`output: "server"`, `@astrojs/node`) — **one container serves every store**, tenant from the `Host` header (ADR 0009) | The shopper |
| **landing** | `@tokophi/landing` | — | Astro static, **no DB on purpose** | Prospects on `tokophi.com` |

Shared code: `@tokophi/ui` (shadcn on **Base UI**), `@tokophi/lib` (formatters, billing, provider clients), `@tokophi/data` (menu helpers), `@tokophi/sections` (Store Builder registry).

## Legend
- **UI:** ✅ done · 🟡 partial/stub
- **Data:** **✅ DB** = reads AND writes real Postgres (verified through `PAGE_MAP.md`'s data/actions columns + the code on 2026-09-07) · **🟡 demo rows** = the query is honest, the rows are seed data (see `STATUS.md`) · **⚪ static** = an in-code list, no DB
- Dynamic segments shown as `[id]` / `[handle]`. Editor/detail screens are split into a server `page.tsx` + a `"use client"` component (e.g. `product-editor.tsx`, `order-detail.tsx`).

---

## 1) Seller (`apps/admin/app/(admin)`) — merchant

### Sidebar IA (`lib/nav.ts`, read 2026-09-07)
`Utama:` Dashboard · Pesanan▸ · Keuangan▸ · Produk▸ · Pelanggan▸ · Obrolan · CRM▸ · Promo▸ · Analitik · Pemasaran
`Toko Online:` Tema · Halaman · Blog · Files · Navigasi
`Sistem:` Bantuan · Pengaturan
(▸ = expandable submenu — Pesanan: Pesanan Saya / Pengiriman Massal / Pengembalian-Pembatalan · Keuangan: Ringkasan / Penghasilan / Saldo Saya · Produk: Kategori / Inventori / Pembelian · Pelanggan: Keranjang Ditinggal / Segmen / Ulasan · CRM: Follow-up WA / Pipeline / Template · Promo: Voucher (`/diskon`) / Flash Sale / Landing Page (`/promo`))

**Channel model:** the only **sales channel** is "Toko Online". "Sumber/atribusi" (Dashboard/Analitik "Sumber Penjualan", Pesanan "Sumber") = **Meta Ads · TikTok Ads · Google Ads · Organic · Other**, read from `orders.channel` (last-click from the storefront's UTM/click-id capture — "dari pesanan toko Anda", never "menurut Meta").

### Dashboard, Orders, Money
| Route | Purpose | Key components / interactions | Status |
|---|---|---|---|
| `/` | Store dashboard | KPI cards (delta `null` → "—" when there is no previous period), date-range picker, sales chart from `getDailyStats()` (dense series ending today, WIB buckets), activity feed, returns tile, top products, "Sumber Penjualan" | ✅ DB |
| `/pesanan` | Order list | table, status tabs + counts (`perlu_dikirim`, `pengembalian`, …), source + payment filters (validated before the enum cast), row → `[id]` | ✅ DB |
| `/pesanan/[id]` | Order detail (`order-detail.tsx`) | line items, customer, timeline; status advance via `applyOrderStatusChange` (the ONE writer of `orders.status`, `ALLOWED` transition table); "Cek Ongkir" rate list + `createShipment` (books ANY service, difference debited/credited to the seller ledger); cancel shipment (AWB only); payment bill creation | ✅ DB |
| `/pesanan/massal` | Pengiriman Massal (`massal-client.tsx`) | bulk queue: `bulkGenerateResi` books **the service the shopper paid for** (no picker), label PDF via `/api/admin/labels`, `markLabelsPrinted` (reports what the UPDATE matched), sudah/belum-dicetak filter | ✅ DB |
| `/keuangan` | Keuangan — Ringkasan | finance summary from `lib/data/finance.ts` (immutable per-order finance rows) | ✅ DB |
| `/keuangan/penghasilan` | Penghasilan | period tabs, reconciliation view (`reconciliation.ts`) | ✅ DB |
| `/saldo` | Saldo Saya (`saldo-client.tsx`) | derived balance (Σ `ledger_entries` by status — no stored column), pending funds itemised, `requestPayout`, payout history incl. transfer reference / rejection reason | ✅ DB |

### Products (Produk▸)
| Route | Purpose | Key components / interactions | Status |
|---|---|---|---|
| `/produk` | Product list | compact table w/ `ProductThumb`, grid toggle; tabs+counts, quick-filters, sort, category + date filter, bulk select | ✅ DB |
| `/produk/baru` | New product (reuses editor) | same editor as `[id]`, empty state | ✅ DB |
| `/produk/[id]` | Product editor (`product-editor.tsx`) | title / media (real upload → `product_media`, 5 MB cap) / desc, harga+margin, inventori, **varian**, dimensions (`products.length/width/height` — part of the quote), organisasi, taxonomy (`taxonomy-field.tsx`), SEO; archive-delete when referenced by orders | ✅ DB |
| `/produk/kategori` | Collections list (Kategori) | list, search, Manual/Otomatis + status badges, rows → editor | ✅ DB |
| `/produk/kategori/baru` · `/[id]` | Collection editor (`collection-editor.tsx`) | Manual vs Otomatis, conditions builder, members, image, SEO; hard delete | ✅ DB |
| `/produk/inventori` | Inventory | stat cards, tabs (menipis/habis), editable stock stepper → bulk save to `inventory_levels` (policy `0100`) | ✅ DB |
| `/produk/pembelian` | Purchase Orders (Pembelian) | line-item PO builder → `purchase_orders`+items; "Terima barang" adds qty to `inventory_levels`; cancel = delete; codes unique **per store** (`0084`) | ✅ DB |

**The Seller's product URL is the catalog NUMBER** (`/produk/1042`), not the UUID — ADR 0013 §7.1. It is the number shown on the product list, searchable in ⌘K, and the one a Merchant Center / Events Manager disapproval names. A UUID-shaped URL redirects to it once, so old bookmarks keep working. The storefront's public URL stays the handle (`/produk/kemeja-linen`) — that is an SEO surface and the feed's `link`.

### Customers (Pelanggan▸) & Chat
| Route | Purpose | Key components / interactions | Status |
|---|---|---|---|
| `/pelanggan` | Customer list | list, segment tabs, sort, bulk select, rows → detail; **Tamu vs Terdaftar badge** (`customers.registered_at IS NULL` = guest — the **normal** case: buying never requires an account) | ✅ DB |
| `/pelanggan/keranjang` | **Keranjang Ditinggal** (`keranjang-client.tsx`) | abandoned checkouts from `checkout_sessions` (0044/0045): abandon + recovery rate cards (`rescued = abandoned_at IS NOT NULL AND recovered_at IS NOT NULL`), tabs counted with true SQL totals, has-phone-first ranking, one-click **WA recovery** with a signed 7-day recovery link; records **"WA dibuka"**, never "terkirim" | ✅ DB |
| `/pelanggan/[id]` | Customer detail (`customer-detail.tsx`) | stats, order history, activity, contact, address, tags+notes (0010), segment, Kirim WA/email | ✅ DB |
| `/pelanggan/segmen` | Segments (Segmen) | segment cards (count, growth, rule), create/delete | ✅ DB |
| `/pelanggan/ulasan` | Reviews (Ulasan) | rating stats, status tabs, moderation (terbit/menunggu) | ✅ DB |
| `/obrolan` | Obrolan (shopper ⇄ merchant chat, 0043) | threads + reply; the storefront side is `/api/chat/*` | ✅ DB |

### CRM (WhatsApp)
| Route | Purpose | Key components / interactions | Status |
|---|---|---|---|
| `/crm` | CRM overview | follow-ups due today, pipeline funnel, KPIs | ✅ DB |
| `/crm/followup` | WhatsApp follow-up | worklist (keranjang/pembayaran/pascabeli/repeat/ulasan), **Kirim WA** (real `wa.me` + filled template), mark-done → `followups.status`; `keranjang` follow-ups come from real `checkout_sessions` rows | ✅ DB |
| `/crm/pipeline` | Sales pipeline | kanban (Baru→Menang), lead cards, WA quick-action | ✅ DB |
| `/crm/template` | WA templates | `wa_templates` as chat bubbles, placeholder legend, create | ✅ DB |

### Promo, Analytics, Marketing
| Route | Purpose | Key components / interactions | Status |
|---|---|---|---|
| `/diskon` · `/baru` · `/[id]` | Vouchers (`discount-editor.tsx`) | code (unique per store, 0084) / type / value / limits / period; **`nonaktif` = OFF, the dates are the schedule**; blank period = `ends_at NULL`; usage limit enforced in the order txn's UPDATE | ✅ DB |
| `/flash-sale` · `/baru` · `/[id]` | Flash Sale (`flash-editor.tsx`) | per-product sale price + window; `isLive`/`isUpcoming` derived server-side on one clock; reaches variant rows | ✅ DB |
| `/promo` · `/[id]` | Promo landing pages (`promo-editor-client.tsx`) | funnel pages rendered by the storefront's `/promo/[handle]` | ✅ DB |
| `/promo/html/baru` · `/[id]` | Landing HTML (`landing-editor-client.tsx`) | raw pasted markup rendered at `/lp/[slug]` — **`set:html` EXECUTES**, so changing the HTML needs `landing:html` (owner only); everything else `content:write` | ✅ DB |
| `/analitik` | Analytics | KPIs (delta `number \| null`), trends, by channel, funnel/device from `analytics_events` ("—" when a store has none), region | ✅ DB |
| `/pemasaran` | Marketing | Tab **Saluran** = Meta/Google/TikTok cards: labels from `ad_channels`, attributed sales from `orders.channel` (the seeded spend/impressions columns are demo — 🟡) · Tab **Pelacakan** = per-store pixel + CAPI setup (ADR 0012, `store_tracking_channels`, encrypted tokens, 7-day delivery strip) · **Feed** cards (Google / TikTok catalog XML) | ✅ DB (🟡 demo spend on Saluran) |

**`/pemasaran` → Pelacakan (ADR 0012)** — one card per channel (Meta Pixel · Google GA4/Ads · TikTok Pixel): Pixel/Tag ID + "Aktifkan pelacakan" switch; advanced matching is **always on** since `0103` (the column is a dead record); server-side section (Conversions API / Measurement Protocol / Events API) with an encrypted access-token field (shows `••••••••` + "Token sudah tersimpan", never the value) and an optional test-event code; a **7-day delivery health strip**. Gated by `useCan("integrations:write")` — **owner only**. Provider names ARE shown here on purpose (the assets are the merchant's own — ADR 0012 §0.7 — unlike the white-labelled shipping/payment providers of ADR 0004).

### Online store content (Toko Online)
| Route | Purpose | Key components / interactions | Status |
|---|---|---|---|
| `/halaman` · `/baru` · `/[id]` | Pages (`page-editor.tsx`) | title/handle/body, published, template, SEO | ✅ DB |
| `/blog` · `/baru` · `/[id]` | Articles (`article-editor.tsx`) | title/handle/body/excerpt, blog/author, tags, **featured image** (real upload, 2 MB cap), SEO | ✅ DB |
| `/files` | Files (`files-client.tsx`) | the store's `media` rows — every upload from every editor lands here | ✅ DB |
| `/navigasi` | Menu builder | drag-drop menus (Menu Utama/Footer), nested typed items; save = delete + re-insert tree in `menus`/`menu_items` | ✅ DB |
| `/tema` · `/tema/[id]` | **Store Builder** (ADR 0009) | `@measured/puck` editor, full-bleed; three template types (`homepage` = whole page · `category` = body under `CategoryHero` · `product` = PDP tail) with a **per-type palette** (`SECTIONS_BY_TEMPLATE_TYPE`); brand-colour dialog (one hex → palette); gated `theme:write` | ✅ DB |

### System & Account
| Route | Purpose | Key components / interactions | Status |
|---|---|---|---|
| `/pengaturan` | Settings | store profile, **Pengiriman** (per-**service** picks → `store_shipping_methods`, COD badge on SPX Standard/Economy only; "Bayar di Tempat (COD)" switch → `store_settings.cod_enabled`; sender address = a KiriminAja district id), Pajak, **Pengguna/peran** (`inviteStoreUser` — `on conflict do nothing … returning`, credential revealed only when the row was written; roles owner/admin/staff/gudang/advertiser/cs since `0105`), custom domain. *(The Pembayaran tab was removed 2026-07-13 — channels are a platform decision, ADR 0004.)* | ✅ DB |
| `/bantuan` · `/[id]` | Bantuan (support tickets) | ticket list + thread with the platform's support desk (`support_tickets`/`support_messages`, RLS `0035`) | ✅ DB |
| `/akun/profil` · `/keamanan` · `/langganan` | Akun (tabbed, NOT under Pengaturan) | profile; password change (rotating revokes other sessions, `0088`); subscription state + payment history, printable `/faktur/[number]` | ✅ DB |
| `/faktur/[number]` | Printable invoice | renders the STORED `tax_idr`, never a derived one | ✅ DB |
| `/login` · `/daftar` | Auth | email/password (scrypt) + Google OAuth (`/api/auth/google/*`); jose JWT in an httpOnly `session` cookie; rate-limited per IP (15/min); self-serve registration provisions a store | ✅ DB |

**Seller cross-cutting:** shell = sidebar (expandable submenus, badge counts) + topbar (search ⌘K over `lib/data/search.ts`, notif, theme) + subscription badge; `PermissionsProvider` feeds `useCan`/`<Can>` from the session role; sonner toasts on save/delete; impersonated sessions show the operator banner and exit via `/impersonate/exit`. **Fashion demo:** women's-clothing products with AI-generated photos (`public/products/*.webp`), rendered via `ProductThumb` (image + emoji fallback).

---

## 2) Super Admin (`apps/super-admin/app/(platform)`) — platform control plane

Rebuilt 2026-09-07 from the directory (11 pages), `lib/route-roles.ts` (the rank **floor** each page checks as its first await — `support` 1 < `admin` 2 < `owner` 3; an unlisted route is `owner`) and the exports of `lib/actions.ts` (34 `platformGate(min)` call sites). Every page reads `lib/data.ts` on the owner connection; every mutation is a server action that opens with `platformGate(min)` and writes a `platform_activity` row. There is **one plan, "TokoΦ"** — the Pemula/Bisnis/Skala tiers this table used to list are legacy and unused.

| Route | Purpose | Key interactions / actions (`lib/actions.ts`) | Floor | Status |
|---|---|---|---|---|
| `/` | Platform dashboard | KPIs: MRR, ARR (MRR×12), Diterima (paid invoices), Saldo merchant (float), Toko aktif `n / total` (+ trial / ditangguhkan), Pendaftar baru 30h; revenue series chart (`getRevenueSeries`, `revenue-chart.tsx`); status distribution (`StatusSlice`, includes VIP — slices sum to every store); risk queue (`getRiskQueue`, keyed on `billingStatus`); pending approvals; latest invoices; activity feed. **Forwards** a lower rank to its landing instead of refusing (only page that does) | `admin` | ✅ DB |
| `/toko` | Store catalog (`toko-client.tsx`) | tabs Semua / Trial / Aktif / VIP / Menunggak / Ditangguhkan + health filter (Sehat / Perhatian / Bermasalah, `getHealthMap`); search; **Tambah toko** → `createStore` (mints a 60-bit owner password, revealed once); row menu: `impersonateStore` ("Buka Dashboard Seller" — one-time grant, `impersonation_grants` 0098), `liftSuspension` (inline), `setStoreComped` (VIP), `approveStore`; "Tangguhkan…" links to the detail because a reason is required | `support` | ✅ DB |
| `/toko/[id]` | Store detail (`store-detail.tsx` + `saldo-section.tsx`) | profile, health verdict, billing state (`computeBilling`: `status` / `billingStatus` / `operatorSuspended`), invoices, users, activity, **Saldo & transaksi** (ledger movements, payouts, money signals — paged). Actions: `impersonateStore`, `suspendStore(reason ≥ 5 chars)` / `liftSuspension`, `approveStore`, `compStore` ("Gratiskan 1 bulan"), `extendTrial`, `setStoreComped`, `resetOwnerPassword` (owner rank), `addStoreUser` (`outcome: created \| linked`), `setStoreUserRole`, `removeStoreUser`, `resetStoreUserPassword` (owner rank when the target is an owner), `createManualInvoice` (real VA via AutoLaris), `sendPaymentReminder` | `support` | ✅ DB |
| `/paket` | Paket & Billing (`paket-client.tsx`) | single-plan card (trial 3 d → Rp50rb → Rp275rb/mo; PPN per the global toggle), finance + subscription + conversion stats, invoices table with status tabs; `setInvoiceStatus` — **bookkeeping only**, does NOT move `stores.current_period_end` (owner ruling 2026-08-20; both the menu and the toast say so) | `admin` | ✅ DB |
| `/pencairan` | Payout queue (`pencairan-client.tsx`) | every store's pending/processing/paid/rejected payouts with bank details; `processPayout` (menunggu → diproses), `markPayoutPaid(ref)` — compare-and-swap on `status='diproses'`, typed conflict message otherwise, **nothing posted to the ledger**; `rejectPayout(reason)` restores the balance with an opposing entry; `savePayoutPolicy` (release on `selesai`/`dikirim`, minimum payout) | `admin` | ✅ DB |
| `/tiket` | Support desk (`tiket-client.tsx`) | all stores' tickets; tabs Semua / Perlu dibalas / Dibalas / Selesai | `support` | ✅ DB |
| `/tiket/[id]` | Ticket thread (`thread-client.tsx`) | `replyTicketAdmin`, `setTicketStatus(open \| answered \| closed)` | `support` | ✅ DB |
| `/analitik` | Keuangan & Analitik | KPIs (MRR, ARR, Diterima incl. PPN, GMV merchant — "bukan pendapatan kami"), subscription mix (Uji coba / Berbayar / VIP / Menunggak / Ditangguhkan), GMV per city, platform float, conversion, courier cost absorbed; **system status** strip: KiriminAja (`sys.kaEnv` — shows sandbox/production), AutoLaris, Database (store count), Server (`node:os` metrics) | `admin` | ✅ DB (server metrics live from the process) |
| `/pengaturan` | Platform settings (`pengaturan-client.tsx`) | **payment channels** (`syncPaymentChannels` from the PSP, `savePaymentChannels` on/off — these are what checkout reads); gateways (`saveGateways` — `enabled` is a RECORD, gates nothing; the "Aktif" badge was removed); **couriers** (`syncCouriersFromKiriminaja`, `saveCouriers`, `saveCodAllowed` per service); `testKiriminajaConnection` (province list, reports env) · `testAutolarisConnection` (⚠️ creates a real **Rp10.000 QRIS bill** — `alTestConnection`); **Keuangan**: `setSubscriptionPpn` (global PPN toggle, `0101`, default OFF); **operators**: `invitePlatformAdmin` (owner rank, random password revealed once), `resetPlatformAdminPassword` | `admin` (owner-only actions refuse at their own gate) | ✅ DB |
| `/log-sistem` | System / audit log over `platform_activity` | filter jenis (enum) · toko · teks (LIKE, escaped) as a GET form; table (icon, catatan, toko → `/toko/[id]`, waktu WIB + relatif); DB-side pagination 25/page with real `href` links | `admin` | ✅ DB |
| `/update-log` | Update Log Development (`update-log-client.tsx`) | searchable, filterable, paged list of releases / bug fixes for human operators — an **in-code list** (`lib/data/dev-logs.ts`), not a table | `support` | ⚪ static |

**Super Admin cross-cutting:** own shell (`platform-shell.tsx`); shares `@tokophi/ui` + `@tokophi/lib`; identity = `platform_admins` row re-read on **every request** (rank never from the cookie; a dead-but-valid cookie is sent to `/api/auth/signout`, the one API route this app has); operators change their own password from the avatar menu (`changePlatformPassword`, session-gated); store lifecycle segments `trial → first_month → regular → vip` (`storeSegment()`), VIP = `stores.comped`; an operator suspension is `stores.suspended_at` (0086), separate from billing. A denial renders `RouteDenied` with HTTP 200 (Server Components cannot set a status without `authInterrupts`).

---

## 3) Storefront (`apps/storefront/src/pages`) — shopper (Astro SSR, multi-tenant by `Host`)

Every route below resolves the tenant in `src/middleware.ts` (`getStoreByHost()` → `Astro.locals.store` + catalog) and reads the DB through `src/data/*`. Demo store: `batiknusantara.tokophi.id` (renamed from `batik-nusantara` 2026-08-12).

| Route | Purpose | Key components / interactions | Status |
|---|---|---|---|
| `/` (`index.astro`) | Beranda | rendered from the store's `homepage` template (`page_templates.sections`, `SectionRenderer` with an exhaustive `default:` guard) or the platform default (`tema-platform`); hero carousel with promoted `srcset`; Jurnal section renders nothing until an article is published | ✅ DB |
| `/produk` (`produk/index.astro`) | Semua Produk | `ProductListing.astro`: server-side sort, 12-per-page pagination, one empty state | ✅ DB |
| `/produk/[handle]` | Product detail | gallery with real width variants, variant picker (availability server-rendered; an impossible combination refuses the sale), flash price applied per variant, reviews, related; `product` template = PDP tail | ✅ DB |
| `/kategori` · `/kategori/[handle]` | Category index / listing | `CategoryHero` is ALWAYS rendered (h1 + breadcrumb + BreadcrumbList JSON-LD); a `category` template replaces only the body | ✅ DB |
| `/cari` | Search results | full-page results; the ⌘K palette on every route uses `/api/search` (server-built `srcset` per row) | ✅ DB |
| `/promo` · `/promo/[handle]` | Promo hub / promo landing (`LandingLayout`) | vouchers + flash sales that are usable NOW (`status <> 'nonaktif'` + window); per-promo funnel page with its own order form (kodepos POSTed) | ✅ DB |
| `/lp/[slug]` | Landing HTML (`LandingLayout`) | merchant-pasted markup via `set:html` — **executes**, owner-only to edit; carries the COD order form | ✅ DB |
| `/keranjang` | Cart | client-side cart (localStorage), qty edit, totals, proceed to checkout | ✅ DB (catalog) |
| `/checkout` | Checkout (`CheckoutLayout`, its OWN design system) | contact/address form with `<form novalidate>` + Indonesian messages, kecamatan cascade (kota/provinsi derived, **kodepos required and always editable**), **live ongkir** from `/api/public/ongkir` (platform ∩ store services, effective COD flag, cheapest promoted to a 2nd row), COD hint naming the one unmet condition, payment channels from `platform_payment_channels` with the **enforced** fee schedule (`@tokophi/lib/payment-fees`), progressive `checkout_sessions` capture, signed recovery link restore (`?r=`) | ✅ DB — driven in a browser, 0 console errors |
| `/checkout/sukses` · `/thanks` | Order success (checkout / landing funnel) | thanks page with payment UX (VA copy, downloadable QR named per order, per-method tutorials — E2E-verified with real AutoLaris payments 2026-08-27); browser Purchase event only when the SERVER says the order converted (COD converts here; prepaid is released by the payment callback) | ✅ DB |
| `/blog` · `/blog/[handle]` | Journal index / article | DB-backed via `content.ts`, featured images through `/api/uploads/*`, absolute `og:image` | ✅ DB |
| `/halaman/[handle]` | Static pages (tentang-kami, cara-pemesanan, …) | `pages` rows; the footer menu links resolve here (the "dead links" this row used to report are gone) | ✅ DB |
| `/kontak` | Contact | per-store WhatsApp + email links | ✅ DB |
| `/404` | Not found | | ✅ |

**Storefront endpoints** (all in `src/pages/api` + `feed`): `POST /api/checkout-session` (progressive capture, bot + rate gated, fails quiet 204) · `POST /api/track` (`analytics_events`) · `/api/chat/{send,poll,read}` (shopper side of Obrolan) · `GET /api/search` · `/feed/google.xml` + `/feed/tiktok.xml` (catalog ids via `retailerId()`, ADR 0013) · `/sitemap.xml` · `/robots.txt`. Ongkir, order, promo and pay-callback are **NOT here** — they are the admin's public API (`apps/admin/app/api/public/**`, tenant = `storeSlug` in the body, by design). Nav header/footer come from the store's `menus` rows, not from `@tokophi/data`.

⚠️ **There is no `/akun` route** on the storefront and there must not be a registration wall: buying never requires an account (`customers.registered_at IS NULL` = guest is the normal case). The old "🟡 stub (no auth)" row described a file that no longer exists.

---

## 4) Landing (`apps/landing/src/pages`) — `tokophi.com`, static, no DB
`/` · `/fitur` · `/cara-kerja` · `/demo` · `/faq` · `/kontak` · `/pembayaran-pengiriman` · `/privasi` · `/404` + `/sitemap.xml`. Must serve even when everything else is down (no `depends_on: postgres`).

---

## Not built yet (planned, all apps)
Draft/manual orders · refunds beyond `retur` status · stock transfers · supplier CRUD · loyalty · email/WA campaigns & automations · gift cards · custom reports/export · notification templates · per-customer voucher limits / product eligibility / voucher stacking (see AGENTS.md "Promo") · a platform-wide PSP kill-switch (would have to be enforced at `/api/public/order` + `lib/actions/payments.ts` first).

## Wireframes
Admin screenshots in `../wireframes/` are from the July mock era and are **not** a current reference. Regenerate via Playwright (system Chrome channel) — not `chrome --headless` (mis-sizes Recharts).

*Living doc — add a row when a screen ships. `test/page-map-fresh.test.ts` catches a new page that is missing from `PAGE_MAP.md`; nothing catches one missing from here, so check this file when that test goes red.*
