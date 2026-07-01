# Indostore — UI inventory (screen status)

> Every admin screen that exists today, its state, and what backend work it needs.
> All data is **mock** (`admin/lib/mock/store.ts`); forms don't persist yet. Routes verified by `npm run build`.

Legend: **UI** ✅ done · 🟡 partial — **Data** mock (all today) — **Save** ❌ none yet (M3)

## Sidebar IA
`Utama:` Dashboard · Pesanan · Produk▸ · Pelanggan▸ · CRM▸ · Diskon · Analitik · Pemasaran
`Toko Online:` Halaman · Blog · Navigasi
`Sistem:` Pengaturan
(▸ = expandable submenu — Produk: Kategori/Inventori/Pembelian · Pelanggan: Segmen/Ulasan · CRM: Follow-up WA/Pipeline/Template)

## Channel model
- **Saluran penjualan = hanya "Toko Online"** (product/collection editors).
- **Sumber/atribusi** (Dashboard/Analitik "Sumber Penjualan", Pesanan "Sumber") = **Meta Ads · TikTok Ads · Google Ads · Organic · Other**.

## Screens
| Route | Screen | UI | Key features | Needs for "real" |
|---|---|---|---|---|
| `/` | Dashboard | ✅ | KPIs, FB-style date range, sales chart, live activity, target, top products | rollups over orders/events |
| `/pesanan` | Pesanan | ✅ | list, status filter/tabs, detail sheet + timeline | `orders`+lines, mutations, refunds ⬜ |
| `/produk` | Produk (list) | ✅ | **Shopify-style compact table (default)** w/ small thumbnails, + compact grid toggle; tabs+counts, stat quick-filters, sort, category + **date filter**, bulk select, "Ditambahkan" date+time | `products` CRUD |
| `/produk/[id]` · `/produk/baru` | Produk editor | ✅ | title/media/desc, harga+margin, inventori, varian toggle, channels, organisasi, SEO(content-width), **Tindakan lainnya** (ubah kategori / stok / Purchase Order) | variants+media+inventory tables, save, upload, rich-text |
| `/produk/kategori` | Kategori (Koleksi) list | ✅ | list, search, Manual/Otomatis + status badges, rows→editor | `collections` CRUD |
| `/produk/kategori/[id]` · `/baru` | Collection editor | ✅ | Manual vs Otomatis, **conditions builder** (all/any + field/op/value), members/preview, image, publish/channels/template, SEO | `collections`(+products/conditions), save |
| `/produk/inventori` | Inventori | ✅ | stat cards, tabs (menipis/habis), **editable stock stepper**, incoming, value | `inventory_levels`, adjustments |
| `/produk/pembelian` | Pembelian (Purchase Orders) | ✅ | stat cards, status tabs, PO table, create dialog | `purchase_orders`(+items/suppliers) |
| `/pelanggan` | Pelanggan | ✅ | list, tabs, sort, bulk select, rows→detail | `customers` |
| `/pelanggan/[id]` | Detail pelanggan | ✅ | profil penuh: stat (belanja/pesanan/AOV/terakhir), riwayat pesanan, aktivitas, kontak, alamat, tag+catatan, segmen, Kirim WA/email | `customers`(+orders join) |
| `/pelanggan/segmen` | Segmen | ✅ | segment cards (count, growth, rule), create dialog | `customer_segments`, rule engine |
| `/pelanggan/ulasan` | Ulasan | ✅ | rating stats, status tabs, **moderation** (terbit/menunggu) | `reviews`, status mutations |
| `/diskon` | Diskon | ✅ | codes, %/nominal/ongkir, usage, create | `discounts` |
| `/analitik` | Analitik | ✅ | KPIs, trends, by category/channel, funnel, region, device, ROAS | rollups/reports, export |
| `/pemasaran` | Pemasaran | ✅ | Meta/Google/TikTok summary+ROAS, per-channel, **province filter + Performa per Provinsi**, pixel/CAPI/GA4 tracking tab | `ad_channels`/`ad_metrics`, real pixel config |
| `/crm` | CRM overview | ✅ | follow-up due today, pipeline funnel, KPIs | — |
| `/crm/followup` | Follow-up WA | ✅ | WA follow-up worklist (keranjang/pembayaran/pasca-beli/repeat/ulasan), type/status tabs, **Kirim WA** (real wa.me + filled template), mark-done | `followups`, WA send log |
| `/crm/pipeline` | Pipeline | ✅ | sales kanban (Baru→Menang), lead cards, source badges, WA quick-action | `leads` |
| `/crm/template` | Template WA | ✅ | WA templates as chat bubbles, placeholder legend, create dialog | `wa_templates` |
| `/halaman` · `/halaman/baru` · `/halaman/[id]` | Halaman | ✅ | list (rows→edit) + create/**edit** editor (prefilled), SEO(content-width) | `pages` CRUD |
| `/blog` · `/blog/baru` · `/blog/[id]` | Blog | ✅ | list (rows→edit) + create/**edit** article editor (prefilled), SEO(content-width) | `articles`/`blogs` CRUD |
| `/navigasi` | Navigasi | ✅ | menu builder (Utama/Footer), nested typed items, add/edit/delete; content uses Indonesian storefront slugs (`/kategori//blog//halaman/`) | `menus`/`menu_items` |
| `/pengaturan` | Pengaturan | ✅ | profil toko, **Pembayaran** (transfer/QRIS/e-wallet/COD/VA), **Pengiriman** (JNE/J&T/SiCepat/…), Pajak (PPN 11%), Pengguna/peran | settings tables, integrations (M4) |

## Cross-cutting done
- Shell: sidebar (expandable submenus), topbar (store switcher, search, notif, theme), plan card.
- Base UI gotchas handled; `DropdownMenuLabel` patched; SEO preview standardized to content-column width across all editors.
- Deterministic mock (no hydration mismatch); build + tsc + **console clean** on every route.
- **Fashion demo:** 14 women's-clothing products with **AI-generated photos** (`public/products/*.webp`, ~244KB total); `ProductThumb` (image + emoji fallback) used in product list/inventori/dashboard/collection previews.
- **sonner toasts** on save/delete (Produk, Koleksi, Menu) — more editors pending (see BACKLOG).

## Not built yet (planned)
Draft/manual orders · abandoned checkout · refunds/returns · stock transfers · supplier CRUD · loyalty · email/WA campaigns & automations · gift cards · custom reports/export · domains · notification templates · **the storefront (Astro) app**.

## Wireframes
Screenshots in `../wireframes/` (01…19). Regenerate via Playwright (system Chrome channel) — not `chrome --headless` (mis-sizes Recharts).

*Living doc — add a row when a screen ships; flip Save to ✅ when it persists via Supabase.*
