# Indostore — Backend schema (PostgreSQL, Drizzle)

> **Implemented** as `@indostore/db` (Drizzle) — **53 tables** on local **PostgreSQL 16** (Docker, port 5433). Prod target = self-hosted Postgres (ADR 0007). Source of truth = `packages/db/src/schema.ts`; this doc is the annotated reference.
> **Status:** super-admin (all 5) + **16 admin modules** read it **live** via `lib/data/*` (`force-dynamic`); all three surfaces (super-admin + admin + storefront) read it; only writes pending — swap those next (§M3). Keep `admin/lib/mock/store.ts` shaped like these tables.
> **Impl deltas vs the design below:** `stores.city`; **`store_stats`** rollup table (platform metrics cache); `invoices.number` ("INV-9001"); `products.emoji` + `products.units_sold` + storefront fields (`sizes`/`badge`/`bestseller`/`rating_value`/`rating_count`); `analytics_daily` rollup; `ad_channels` enriched (name/brand/pixel/aggregate/`campaigns` jsonb) + `ad_metrics.channel_key` nullable; `collections.emoji`; `pages.template` + `pages.views`; `articles.comments`; `followups.last_message`; `customer_segments.growth`; `reviews.product_name` + `reviews.emoji` (denorm — legacy demo products). RLS policies are written but **not enabled locally** (no `auth.*` on plain Postgres — they light up at self-hosted Postgres).

## Conventions
- **Postgres** on self-hosted Postgres. PK = `id uuid default gen_random_uuid()`. Timestamps `created_at/updated_at timestamptz default now()`.
- **Multi-tenant:** almost every table has `store_id uuid references stores(id)`. **RLS ON everywhere**; policy: row visible when `store_id = auth_store()` (a helper reading the caller's active store from JWT/`store_users`). Platform-admin role bypasses.
- **Money:** integer **rupiah** (no decimals) — column suffix `_idr`. Never floats for money.
- **Enums** as Postgres `enum` (or `text` + check). **Slugs/handles** unique per store: `unique(store_id, handle)`.
- **Soft delete** via `archived_at timestamptz null` where useful (products, collections).
- Money/derived (margin, ROAS) computed in queries/views, not stored.

## Identity & tenancy
```
accounts(id, name, plan enum[pemula|bisnis|skala], created_at)         -- billing owner
stores(id, account_id→accounts, name, slug unique, city, currency='IDR', timezone='Asia/Jakarta',
       plan, status enum[trial|active|suspended], created_at)
store_stats(store_id pk→stores, gmv_idr, orders_count, products_count, updated_at)  -- platform rollup CACHE (super-admin); refreshed by a job, seeded for demo
users(id, email unique, name, ...)                                      -- maps to auth.users
store_users(id, store_id→stores, user_id→users, role enum[owner|admin|staff|gudang],
            invited_at, accepted_at)                                    -- membership + RBAC
locations(id, store_id, name, address, is_default bool)                 -- gudang/lokasi stok
```
`auth_store()` resolves the caller's `store_id` from `store_users` (active store in session).

## Catalog — products
```
products(id, store_id, title, handle, description, status enum[active|draft|archived],
         product_type, vendor, category, emoji, units_sold, has_variants bool, archived_at, created_at,
         sizes jsonb, badge, bestseller bool, rating_value real, rating_count)  -- storefront-facing fields
product_media(id, product_id→products, url, alt, position)             -- real images (Storage)
product_options(id, product_id, name, position)                        -- e.g. "Ukuran","Warna"
product_variants(id, product_id, store_id, title, sku, barcode,
                 price_idr, compare_at_idr, cost_idr, weight_grams,
                 option1, option2, option3, position)                  -- the real sellable unit
inventory_levels(id, variant_id→product_variants, location_id→locations,
                 available int, incoming int, committed int,
                 unique(variant_id, location_id))                      -- stock per location
```
> Mock today: flat `Product{price,stock}`. Target: variant-level price/stock + per-location inventory. UI (varian toggle, inventori stepper, harga+margin) already anticipates this.

## Catalog — collections (Kategori)
```
collections(id, store_id, title, handle, description, image_url,
            type enum[manual|otomatis], match enum[all|any], published bool,
            template text, seo_title, seo_desc, archived_at)
collection_products(collection_id, product_id, position)               -- manual membership
collection_conditions(id, collection_id, field enum[tag|title|type|price|stock|category],
                      operator enum[eq|neq|gt|lt|contains], value text) -- automated rules
```
Automated members = products matching conditions (query/view). Mirrors the collection editor exactly.

## Suppliers & purchasing
```
suppliers(id, store_id, name, contact, phone, email)
purchase_orders(id, store_id, supplier_id→suppliers, code unique,
                status enum[draft|dipesan|sebagian|diterima],
                total_idr, eta_date, note, created_at)
purchase_order_items(id, purchase_order_id, variant_id, qty, cost_idr, received_qty)
stock_transfers(id, store_id, from_location, to_location, status, created_at)  -- planned
```

## Orders & fulfillment
```
orders(id, store_id, number unique, customer_id→customers null,
       status enum[baru|diproses|dikirim|selesai|batal],
       financial_status enum[pending|dibayar|refund_sebagian|refund],
       channel enum[meta_ads|tiktok_ads|google_ads|organic|other],  -- attribution source (NOT sales channel; the only sales channel is the online store)
       subtotal_idr, discount_idr, shipping_idr, tax_idr, total_idr,
       city, province, placed_at)
order_line_items(id, order_id, variant_id, title, qty, price_idr, total_idr)
payments(id, order_id, method enum[transfer|qris|ovo|gopay|dana|va|cod],
         amount_idr, status, paid_at)
fulfillments(id, order_id, courier text, tracking_no, status, shipped_at)  -- JNE/J&T/SiCepat/...
```

## Customers
```
customers(id, store_id, name, email, phone, city, province, tags jsonb, notes,
          orders_count int, total_spent_idr int, segment enum[baru|reguler|loyal|vip],
          created_at)
customer_addresses(id, customer_id, label, recipient, phone, address, city, province, postcode)
customer_segments(id, store_id, name, description, rule jsonb, member_count int)  -- saved segments
reviews(id, store_id, customer_id, product_id, rating int, body,
        status enum[terbit|menunggu], created_at)                       -- moderation queue
-- planned: loyalty_points(customer_id, balance, ...)
```

## CRM — WhatsApp follow-up & pipeline
```
leads(id, store_id, name, phone, source enum[whatsapp|instagram|tiktok|referral|marketplace],
      stage enum[baru|dihubungi|nego|closing|menang|kalah], value_idr, note, last_contact_at)
followups(id, store_id, customer_id→customers null, phone,
          type enum[keranjang|pembayaran|konfirmasi|pascabeli|repeat|ulasan],
          context, due_at, status enum[menunggu|terkirim|dibalas|selesai], sent_at)
wa_templates(id, store_id, name, type, body)   -- placeholders {{nama}}{{produk}}{{no_pesanan}}{{total}}{{toko}}
wa_messages(id, store_id, followup_id null, lead_id null, phone, body, sent_at)  -- send log (planned)
```
Follow-ups are generated from events (abandoned cart, pending payment, delivered order, repeat-due) → the worklist. "Kirim WA" = a wa.me deep link with a filled template; real WhatsApp Business API send is M4.

## Discounts
```
discounts(id, store_id, code unique, kind enum[persen|nominal|gratis_ongkir],
          value int, min_purchase_idr, usage_limit, used_count,
          starts_at, ends_at, status enum[aktif|terjadwal|nonaktif])
discount_usages(id, discount_id, order_id, used_at)
```

## Content (Toko Online)
```
pages(id, store_id, title, handle, body, status enum[terbit|draft], updated_at)
blogs(id, store_id, title, handle)                                     -- blog channels
articles(id, blog_id→blogs, store_id, title, handle, body, excerpt,
         author, image_url, status, seo_title, seo_desc, published_at)
menus(id, store_id, name, handle)                                      -- nav menus
menu_items(id, menu_id, parent_id→menu_items null, label,
           type enum[home|collection|product|page|blog|url|catalog], target, position)
```
Modeled from real Shopify Page/Blog/Article/Menu (screened via Shopify CLI).

## Marketing & analytics
```
ad_channels(id, store_id, key enum[meta|google|tiktok], connected bool, pixel_id,
            capi_enabled bool)
ad_metrics(id, store_id, channel_key, date, province,
           spend_idr, impressions, clicks, conversions, revenue_idr, reach)  -- daily rollup
analytics_events(id, store_id, ts, type, session_id, ...)              -- raw (or provider)
analytics_daily(id, store_id, date, sales_idr, orders, visitors, unique(store_id,date))  -- daily sales ROLLUP for Dashboard/Analitik
-- dashboards read daily rollups keyed by (store_id, date[, province][, channel])
```
Province filter + "Performa per Provinsi" = `ad_metrics` grouped by `province`. Analytics screens = rollups over `orders`/`analytics_events`.

## Settings
> **Payments/COD/couriers are platform-managed** (ADR 0004): credentials & tariffs live at the **platform/account** level and apply to all stores; per-store rows only carry an `enabled` flag (merchant just toggles).
```
store_settings(store_id pk, tax_rate_pct=11, tax_inclusive bool, ...)   -- PPN
-- platform-level (super-admin) = source of truth:
platform_payment_gateways(id, provider[midtrans|xendit|duitku], credentials jsonb, enabled, is_cod bool)
shipping_aggregator(id, provider[biteship|rajaongkir|shipper], api_key, enabled)  -- ONE connection, all couriers
platform_couriers(id, courier, services jsonb, enabled) -- from the aggregator: JNE/J&T/SiCepat/AnterAja/Pos/GoSend/Grab
platform_cod(id, enabled, max_amount_idr, allowed_provinces jsonb, fee_pct)
-- per-store = enable/disable only (no credentials):
store_payment_methods(id, store_id, method, enabled)                    -- transfer/QRIS/ewallet/COD/VA
store_shipping_methods(id, store_id, courier, service, enabled)         -- merchant picks courier AND each service (JNE.reg/JNE.yes/…)
domains(id, store_id, hostname, verified bool)                          -- planned
notification_templates(id, store_id, event, channel[email|wa], subject, body)  -- planned
```

## Platform & billing (super-admin control plane)
> Source: `apps/super-admin/lib/mock.ts`. Not store-scoped — these live at the **platform/account** level (no `store_id`); only platform-admins read them.
```
plans(id, key enum[pemula|bisnis|skala], name, price_idr, blurb, features jsonb)   -- subscription tiers
invoices(id, number unique, account_id→accounts, store_id→stores null, plan_key, amount_idr,
         status enum[dibayar|menunggu|gagal], issued_at)                            -- subscription billing ("INV-9001")
platform_activity(id, kind enum[signup|upgrade|payment|churn|support], text, ts)   -- platform feed
-- Derived (computed in queries/views, never stored):
--   MRR = sum(plan price of active accounts); GMV = sum(store gmv);
--   ARPU = MRR/active; churn_rate; plan_distribution; MRR_SERIES (monthly trend)
```
`accounts.plan` (see Identity & tenancy) references `plans.key`; `stores.status` = trial|active|suspended (UI: aktif|trial|ditangguhkan).

## Mock → table map (keep in sync)
| Mock (`lib/mock/store.ts`) | Target table(s) |
|---|---|
| `PRODUCTS` | `products` + `product_variants` + `inventory_levels` + `product_media` |
| `COLLECTIONS` | `collections` (+ `collection_products` / `collection_conditions`) |
| `PURCHASE_ORDERS` | `purchase_orders` (+ `_items`, `suppliers`) |
| `ORDERS` | `orders` (+ `order_line_items`, `payments`, `fulfillments`) |
| `CUSTOMERS` / `SEGMENTS` / `REVIEWS` | `customers` / `customer_segments` / `reviews` |
| `LEADS` / `FOLLOWUPS` / `WA_TEMPLATES` | `leads` / `followups` / `wa_templates` |
| `DISCOUNTS` | `discounts` |
| `PAGES` / `BLOG_POSTS` / `MENUS` | `pages` / `articles`(+`blogs`) / `menus`(+`menu_items`) |
| `AD_CHANNELS` / `AD_PROVINCES` / `DAYS` | `ad_channels` / `ad_metrics` |
| `MENUS` (admin) ← `MAIN_MENU`/`FOOTER_MENU` (`@indostore/data`) | `menus` (+ `menu_items`) |
| `STORES` (super-admin) | `stores` (+ `accounts`, `store_users`) |
| `PLANS` / `INVOICES` / `P_ACTIVITY` (super-admin) | `plans` / `invoices` / `platform_activity` |

## M3 migration steps (safe, contained)
1. ✅ **Local Postgres + Drizzle** (`@indostore/db`): all tables + enums as versioned migrations (`docker compose up -d db` → `npm run migrate`).
2. ✅ **Seed (single-tenant MVP)** — one store **Batik Nusantara** (+account/owner/membership/settings/store_stats), 3 plans, 6 invoices, activity, platform payments/shipping/COD. All 3 surfaces center on this one store; the multi-tenant topology (ADR 0008) is the target, seeded 1-store for now.
3. ✅ **Wire super-admin → DB** (`apps/super-admin/lib/data.ts`; `dynamic="force-dynamic"`) — 5 pages live, signatures unchanged, UI untouched.
4. 🟡 **Seed the store's catalog** (Batik Nusantara): ✅ products (14) + variants + inventory + media, **collections (8) + membership**, **customers (24)**, **orders (60) + line-items + payments**, **discounts (6)**, **analytics_daily (120-day rollup)**, **pages (7) + blogs/articles**, **leads (12) + followups (10) + wa_templates (6)**, **suppliers (4) + purchase_orders (6) + items**, **customer_segments (6)**, **reviews (8)**; ⏳ menus, ad_metrics, fulfillments.
5. 🟡 Replace **`admin/lib/data/*` bodies** with Drizzle — **signatures unchanged**: ✅ **all 16 modules** — Produk, Diskon, Pelanggan, Kategori, Pesanan, Halaman, Blog, Inventori, CRM, Pembelian, Segmen, Ulasan, Navigasi, Dashboard, Analitik, Pemasaran (list + detail/editor). All 16 admin modules done; ⏳ storefront + mutations next.
6. ⏳ Storefront reads its store by `store_id`/`STORE_SLUG` (ADR 0008).
7. ⏳ **Mutations** (save product/collection/order, stock adjust, PO) → `insert/update`.
8. ⏳ **self-hosted Postgres**: point `DATABASE_URL` at it, apply same migrations, enable **RLS** (`store_id = auth_store()`), wire **Auth** (email/OTP + `store_users` RBAC, store switcher) + **Storage** (media) + Tiptap rich-text.
9. ⏳ Real payment/courier integrations behind `store_payment_methods`/`store_shipping_methods` (M4).

*Living doc — update alongside the mock whenever an entity is added.*
