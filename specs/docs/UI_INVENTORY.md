# Indostore — UI Inventory (screen map)

> The go-to map of Indostore's surface area across **all three apps**. Routes enumerated
> from the actual filesystem (`apps/*/app` and `apps/storefront/src/pages`) on 2026-07-02.
> Data is moving from mock → **local PostgreSQL** (Drizzle, `@indostore/db`): super-admin + 15 admin modules read the DB (via `lib/data/*`, `dynamic="force-dynamic"`); the rest is still deterministic seeded mock. Mutations don't persist yet (M3).

## Three surfaces
| App | Package | Port | Stack | Who uses it |
|---|---|---|---|---|
| **admin** | `@indostore/admin` | `:3000` | Next.js (App Router) | The merchant / shop owner |
| **super-admin** | `@indostore/super-admin` | `:3001` | Next.js (App Router) | Us — platform control plane (all stores/plans/billing) |
| **storefront** | `@indostore/storefront` | `:4327` | Astro (static) | The shopper (demo store "Batik Nusantara") |

Shared code: `@indostore/ui` (shadcn on **Base UI**), `@indostore/lib` (formatters), `@indostore/data` (canonical nav menu).

## Legend
- **UI:** ✅ done · 🟡 partial/stub
- **Data:** all **mock** today (admin → `apps/admin/lib/mock/store.ts`; super-admin → `apps/super-admin/lib/mock.ts`; storefront → `apps/storefront/src/data/catalog.ts` + `@indostore/data`)
- **Save:** ❌ none yet (persistence lands in M3)
- Dynamic segments shown as `[id]` / `[handle]`. Editor/detail screens are split into a server `page.tsx` + a `"use client"` component (e.g. `product-editor.tsx`, `order-detail.tsx`).

---

## 1) Admin (`apps/admin/app/(admin)`) — merchant

### Sidebar IA
`Utama:` Dashboard · Pesanan · Produk▸ · Pelanggan▸ · CRM▸ · Diskon · Analitik · Pemasaran
`Toko Online:` Halaman · Blog · Navigasi
`Sistem:` Pengaturan
(▸ = expandable submenu — Produk: Kategori/Inventori/Pembelian · Pelanggan: Segmen/Ulasan · CRM: Follow-up WA/Pipeline/Template)

**Channel model:** the only **sales channel** is "Toko Online". "Sumber/atribusi" (Dashboard/Analitik "Sumber Penjualan", Pesanan "Sumber") = **Meta Ads · TikTok Ads · Google Ads · Organic · Other**.

### Dashboard & Orders
| Route | Purpose | Key components / interactions | Status |
|---|---|---|---|
| `/` | Store dashboard | KPI cards, Facebook-style date-range picker, sales chart (Recharts), live activity feed, sales target, top products, "Sumber Penjualan" | ✅ mock |
| `/pesanan` | Order list | table, status tabs + counts, source filter, detail via row → `[id]` | ✅ mock |
| `/pesanan/[id]` | Order detail (`order-detail.tsx`) | full order: line items, customer, timeline/status, totals; status actions (no persist) | ✅ mock |

### Products (Produk▸)
| Route | Purpose | Key components / interactions | Status |
|---|---|---|---|
| `/produk` | Product list | Shopify-style compact table (default) w/ `ProductThumb`, grid toggle; tabs+counts, stat quick-filters, sort, category + date filter, bulk select, "Ditambahkan" date+time | ✅ mock |
| `/produk/baru` | New product (reuses editor) | same editor as `[id]`, empty state | ✅ mock |
| `/produk/[id]` | Product editor (`product-editor.tsx`) | title/media/desc, harga+margin, inventori, **varian toggle**, channels, organisasi, SEO (content-width), "Tindakan lainnya" (ubah kategori / stok / buat PO) | ✅ mock |
| `/produk/kategori` | Collections list (Kategori) | list, search, Manual/Otomatis + status badges, rows → editor | ✅ mock |
| `/produk/kategori/baru` | New collection | reuses collection editor | ✅ mock |
| `/produk/kategori/[id]` | Collection editor (`collection-editor.tsx`) | Manual vs Otomatis, **conditions builder** (all/any + field/op/value), members/preview, image, publish/channels/template, SEO | ✅ mock |
| `/produk/inventori` | Inventory | stat cards, tabs (menipis/habis), **editable stock stepper**, incoming, stock value | ✅ mock |
| `/produk/pembelian` | Purchase Orders (Pembelian) | stat cards, status tabs, PO table, create dialog | ✅ mock |

### Customers (Pelanggan▸)
| Route | Purpose | Key components / interactions | Status |
|---|---|---|---|
| `/pelanggan` | Customer list | list, segment tabs, sort, bulk select, rows → detail | ✅ mock |
| `/pelanggan/[id]` | Customer detail (`customer-detail.tsx`) | full profile: stats (belanja/pesanan/AOV/terakhir), order history, activity, contact, address, tags+notes, segment, Kirim WA/email | ✅ mock |
| `/pelanggan/segmen` | Segments (Segmen) | segment cards (count, growth, rule), create dialog | ✅ mock |
| `/pelanggan/ulasan` | Reviews (Ulasan) | rating stats, status tabs, **moderation** (terbit/menunggu) | ✅ mock |

### CRM (WhatsApp)
| Route | Purpose | Key components / interactions | Status |
|---|---|---|---|
| `/crm` | CRM overview | follow-ups due today, pipeline funnel, KPIs | ✅ mock |
| `/crm/followup` | WhatsApp follow-up | worklist (keranjang/pembayaran/pascabeli/repeat/ulasan), type/status tabs, **Kirim WA** (real `wa.me` + filled template), mark-done | ✅ mock |
| `/crm/pipeline` | Sales pipeline | kanban (Baru→Menang), lead cards, source badges, WA quick-action | ✅ mock |
| `/crm/template` | WA templates | templates as chat bubbles, placeholder legend, create dialog | ✅ mock |

### Marketing, Discounts, Analytics
| Route | Purpose | Key components / interactions | Status |
|---|---|---|---|
| `/diskon` | Discounts list | codes, %/nominal/ongkir, usage, create | ✅ mock |
| `/diskon/baru` | New discount | reuses discount editor | ✅ mock |
| `/diskon/[id]` | Discount editor (`discount-editor.tsx`) | code/type/value/limits/dates, status | ✅ mock |
| `/analitik` | Analytics | KPIs, trends, by category/channel, funnel, region, device, ROAS | ✅ mock |
| `/pemasaran` | Marketing (ads) | Meta/Google/TikTok summary+ROAS, per-channel, **province filter + Performa per Provinsi**, pixel/CAPI/GA4 tracking tab | ✅ mock |

### Online store content (Toko Online)
| Route | Purpose | Key components / interactions | Status |
|---|---|---|---|
| `/halaman` | Pages list | rows → edit | ✅ mock |
| `/halaman/baru` | New page | reuses page editor | ✅ mock |
| `/halaman/[id]` | Page editor (`page-editor.tsx`) | title/handle/body, published, template, SEO (content-width), prefilled | ✅ mock |
| `/blog` | Blog/article list | rows → edit | ✅ mock |
| `/blog/baru` | New article | reuses article editor | ✅ mock |
| `/blog/[id]` | Article editor (`article-editor.tsx`) | title/handle/body/excerpt, blog/author, tags, featured image, SEO (content-width), prefilled | ✅ mock |
| `/navigasi` | Menu builder | **drag-drop** menus (Menu Utama/Footer), nested typed items (beranda/koleksi/produk/halaman/blog/url), add/edit/delete; sourced from `@indostore/data`; content uses Indonesian storefront slugs | ✅ mock |

### System
| Route | Purpose | Key components / interactions | Status |
|---|---|---|---|
| `/pengaturan` | Settings | store profile, **Pembayaran** (transfer/QRIS/e-wallet/COD/VA), **Pengiriman** (JNE/J&T/SiCepat/…), Pajak (PPN 11%), Pengguna/peran | ✅ mock |

**Admin cross-cutting:** shell = sidebar (expandable submenus) + topbar (store switcher, search, notif, theme) + plan card. Deterministic mock (no hydration mismatch). Base UI gotchas handled (`render` prop, patched `DropdownMenuLabel`, SEO preview standardized to content-column width). sonner toasts on save/delete. **Fashion demo:** 14 women's-clothing products with AI-generated photos (`public/products/*.webp`), rendered via `ProductThumb` (image + emoji fallback).

---

## 2) Super-admin (`apps/super-admin/app/(platform)`) — platform control plane

| Route | Purpose | Key components / interactions | Status |
|---|---|---|---|
| `/` | Platform dashboard | KPIs (MRR/GMV/Toko Aktif/Signups/Churn/ARPU), **MRR trend chart** (`mrr-chart.tsx`), plan distribution bars, top stores by GMV, platform activity feed | ✅ mock |
| `/toko` | Stores list | stat cards, search (nama/owner/email), plan + status filters, table → detail, row actions (Lihat detail / Impersonasi / Tangguhkan via toast) | ✅ mock |
| `/toko/[id]` | Store detail (`store-detail.tsx`) | per-store profile: GMV/orders/products stats, owner/contact, plan, billing/invoices, impersonate/suspend actions | ✅ mock |
| `/paket` | Plans & billing | MRR/paid-customers/invoices summary, 3 plan cards (Pemula/Bisnis/Skala, "Populer" ring), invoices table w/ status tabs | ✅ mock |
| `/analitik` | Platform analytics | GMV per plan, GMV per city (top 8), store-status breakdown | ✅ mock |
| `/pengaturan` | Platform settings | **platform-managed** payment gateways + shipping aggregator toggles, users/roles, COD config | ✅ mock |

**Super-admin cross-cutting:** own shell/layout; shares `@indostore/ui` + `@indostore/lib`; plans = Pemula/Bisnis/Skala; store status = aktif/trial/ditangguhkan; deterministic mock anchored `TODAY=2026-07-02`.

---

## 3) Storefront (`apps/storefront/src/pages`) — shopper (Astro, demo store "Batik Nusantara")

| Route | Purpose | Key components / interactions | Status |
|---|---|---|---|
| `/` (`index.astro`) | Beranda / home | hero, featured products, collection tiles (from catalog), bestsellers | ✅ mock |
| `/kategori/[handle]` | Category / collection listing | product grid, count, **client-side sort** (terbaru/termurah/termahal), empty state | ✅ mock |
| `/kategori/semua` | Virtual "Semua Produk" | all products (virtual collection in `getStaticPaths`) | ✅ mock |
| `/kategori/promo-gajian` | Virtual "Promo Gajian" | products with `compareAt` or `bestseller` (virtual collection) | ✅ mock |
| `/produk/[handle]` | Product detail | **5-image gallery** (`productImages`), price/compareAt, sizes, description, related (same collection), add-to-cart | ✅ mock |
| `/keranjang` | Cart | client-side cart (localStorage), qty edit, totals, WhatsApp checkout deep-link, proceed to checkout | ✅ mock |
| `/checkout` | Checkout | contact/address form, **province** picker, **shipping** options (JNE/SiCepat/GoSend), **payment** methods (transfer/QRIS/COD), order summary | ✅ mock |
| `/checkout/sukses` | Order success | thank-you, generated order number (client), next steps | ✅ mock |
| `/akun` | Account (login/register) | login form; submit shows "aktif setelah backend terhubung" demo note | 🟡 stub (no auth) |
| `/blog` (`blog/index.astro`) | Blog index | article cards (hardcoded in-page list); **no article detail route yet** | 🟡 partial |
| `/kontak` | Contact | WhatsApp + email links, contact info/hero | ✅ mock |

**Storefront gaps:** no `/halaman/[handle]` route yet (footer menu links to `/halaman/tentang-kami`, `/cara-pemesanan`, etc. — currently dead), no `/blog/[handle]` article detail. Nav header/footer sourced from `@indostore/data` (`MAIN_MENU`/`FOOTER_MENU`).

---

## Not built yet (planned, all apps)
Draft/manual orders · abandoned checkout · refunds/returns · stock transfers · supplier CRUD · loyalty · email/WA campaigns & automations · gift cards · custom reports/export · domains · notification templates · real auth/accounts · storefront CMS pages (`/halaman/*`) + article detail (`/blog/*`) · live "edit in admin → storefront" (needs M3 backend).

## Wireframes
Admin screenshots in `../wireframes/`. Regenerate via Playwright (system Chrome channel) — not `chrome --headless` (mis-sizes Recharts).

*Living doc — add a row when a screen ships; flip Save to ✅ when it persists via Supabase.*
