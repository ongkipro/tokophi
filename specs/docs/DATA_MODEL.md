# Indostore — Data Model

> The entities the UI works with, and how they map to the **PostgreSQL** tables (now live via `@indostore/db` — see `SCHEMA.md`). Super-admin + 16 admin modules already read the DB; the rest still read the mock shapes below.
> Mock shapes live in three places:
> - **admin-mock** → `apps/admin/lib/mock/store.ts`
> - **super-admin-mock** → `apps/super-admin/lib/mock.ts`
> - **storefront-mock** → `apps/storefront/src/data/catalog.ts`
> - **shared** → `packages/data/src/menu.ts` (`@indostore/data`) — canonical nav, imported by admin mock **and** the storefront.
>
> Content entities mirror **Shopify Admin API** shapes so the eventual API feels familiar. Aligned with `SCHEMA.md`.

## Conventions (future DB)
- Every business table carries **`store_id`** (multi-tenant) with **Row-Level Security** scoping to the current store.
- `id` = uuid; timestamps `created_at`/`updated_at`; money stored as **integer Rupiah** (no cents) — UI formats via `IDR()`.
- Handles unique per store; SEO stored as `seo_title` / `seo_description` (mirrors Shopify metafields `global.title_tag` / `global.description_tag`).
- **Payments & shipping are platform-managed** (ADR 0004): credentials/tariffs live at the platform level (super-admin); per-store rows only carry an `enabled` flag.

---

## Commerce entities — admin-mock

### Product  *(mock: `Product`, `PRODUCTS`)*
`id, name, emoji, image (/products/<slug>.webp), price, stock, status(active|draft), category, unitsSold, addedTs`
→ `products` (+ future `product_variants`, `product_media`, `product_options`).
- **Gallery:** `productImages(p)` = 5 images (base + `-2..-5.webp`) — same files the storefront uses (1:1).
- Flat `price`/`stock` today; target = variant-level price/stock + per-location inventory (the varian toggle + inventory stepper already anticipate this).

### Category / Collection  *(mock: `Collection`, `COLLECTIONS`)*
`id, name, emoji, products (count), type(manual|otomatis), published`
→ `collections` (+ `collection_products` for manual, `collection_conditions` for automated rules).
The editor exposes a conditions builder (all/any + field/op/value) that maps to `collection_conditions`.
> Storefront mirrors this as its own `Collection` (see below); admin `category` string on Product is the join key today.

### Order  *(mock: `Order`, `ORDERS`)*
`id, customer, city, total, items, status(baru|diproses|dikirim|selesai|batal), channel, minutesAgo→created_at`
→ `orders` (+ `order_line_items`, `payments`, `fulfillments`).
- **`channel` = attribution/traffic source, NOT a sales channel.** Enum: **Meta Ads · TikTok Ads · Google Ads · Organic · Other** (the only sales channel is Toko Online).

### Customer  *(mock: `Customer`, `CUSTOMERS`)*
`id, name, email, phone, city, orders, spent, segment(baru|reguler|loyal|vip), joinedDaysAgo`
→ `customers` (+ `customer_addresses`). Segment is derived (spent/orders thresholds) — later a computed column/view.

### Customer Segment  *(mock: `CustSegment`, `SEGMENTS`)*
`id, name, count, growth, description` → `customer_segments` (saved segment + rule engine, `member_count`).

### Review  *(mock: `Review`, `REVIEWS`)*
`id, customer, product, emoji, rating, text, status(terbit|menunggu), daysAgo`
→ `reviews` (moderation queue; Judge.me-style pattern from petcue/pixsgo).

### Discount  *(mock: `Discount`, `DISCOUNTS`)*
`id, code, type(persen|nominal|ongkir), value, status(aktif|terjadwal|kadaluarsa), used, limit, endsInDays`
→ `discounts` (+ `discount_usages`).

### Purchase Order  *(mock: `PurchaseOrder`, `PURCHASE_ORDERS`)*
`id, supplier, status(draft|dipesan|sebagian|diterima), items, total, etaDays, createdDaysAgo`
→ `purchase_orders` (+ `purchase_order_items`, `suppliers`). Suppliers are inline strings today.

---

## CRM entities — admin-mock

### Lead  *(mock: `Lead`, `LEADS`)* — pipeline
`id, name, phone, source(WhatsApp|Instagram|TikTok|Referral|Marketplace), stage(baru|dihubungi|nego|closing|menang|kalah), value_idr, lastContactDaysAgo, note`
→ `leads`.

### Follow-up  *(mock: `Followup`, `FOLLOWUPS`)* — WhatsApp worklist
`id, customer, phone, type(keranjang|pembayaran|konfirmasi|pascabeli|repeat|ulasan), context, dueDays, status(menunggu|terkirim|dibalas|selesai), lastMessage`
→ `followups`. Generated from events (abandoned cart, pending payment, delivered, repeat-due). "Kirim WA" = `wa.me` deep link with a filled template; real WhatsApp Business API send = M4 (`wa_messages` send log).

### WA Template  *(mock: `WaTemplate`, `WA_TEMPLATES`)*
`id, name, type(FollowupType | broadcast), body` — placeholders `{{nama}} {{produk}} {{no_pesanan}} {{total}} {{toko}}`
→ `wa_templates`.

---

## Analytics & Marketing — admin-mock

### Analytics series  *(mock: `DAYS`/`DayPoint`, `hourlyFor`, `FUNNEL`, `REGION_SALES`, `DEVICE_SPLIT`, `NEW_VS_RETURNING`)*
120-day daily series (`date, ts, sales, orders, visitors`) with weekly seasonality + Indonesian payday bumps; per-day hourly distribution; plus conversion funnel, sales-by-region, device split, new-vs-returning.
→ later `analytics_events` aggregated into daily/hourly rollups + funnel/region/device dimensions; the `lib/data` selectors (`getSummary/getSeries/…`) become queries. Live feed = `ACTIVITIES` (`Activity`), plus `ONLINE_NOW`, `CUSTOMER_COUNT`.

### Ad Channel  *(mock: `AdChannel`, `AD_CHANNELS`)* — Pemasaran
`key(meta|google|tiktok), name, brand, connected, pixelLabel, pixelId, pixelActive, capiActive, spend, impressions, clicks, conversions, revenue, campaigns[] (AdCampaign{name,spend,conversions,revenue})`
→ `ad_channels` (connection + tracking config) + `ad_metrics` (daily rollup per channel/campaign from Meta/Google/TikTok APIs). Derived: ROAS/CTR/CPC/CPA. Tracking (pixel/CAPI/GA4/Events API) config per channel; server-side conversion events fire from order webhooks later.

### Province marketing stat  *(mock: `ProvinceStat`, `AD_PROVINCES`, `PROVINCES`)*
`province, spend, impressions, clicks, conversions, revenue, reach` → `ad_metrics` grouped by `province` ("Performa per Provinsi").

---

## Content entities (Shopify-modeled) — admin-mock, `@indostore/data` for menus

### Page  *(mock: `CmsPage`, `PAGES`)* — Shopify `Page`
`id, title, handle, published, updatedDaysAgo, template(templateSuffix), views` + body(HTML) + SEO → `pages`. Storefront URL `/halaman/<handle>` (route TBD).

### Blog + Article  *(mock: `BlogPost`, `BLOG_POSTS`, `BLOG_CATEGORIES`)* — Shopify `Blog` + `Article`
`BlogPost = id, title, handle, blog(category), author, published, publishedDaysAgo, excerpt, comments` + body + tags + featured image + SEO → `blogs` (1) ⟶ `articles` (N). Storefront `/blog` list exists; article detail `/blog/<handle>` TBD.

### Menu + MenuItem  *(shared: `@indostore/data` → `MAIN_MENU`/`FOOTER_MENU`; admin re-wraps as `NavMenu`/`NavItem` in `MENUS`)* — Shopify `Menu` + `MenuItem`
- **Canonical source:** `packages/data/src/menu.ts`. `MenuItem = { id, label, type, href, children? }`; `MenuItemType = beranda | koleksi | produk | halaman | blog | url`.
- Admin `store.ts` maps it to `NavItem = { id, title, type, target, children? }` (label→title, href→target) so the **menu builder and storefront nav never drift** (single source of truth). Default menus: `main-menu` ("Menu Utama", header) and `footer`.
- → `menus` ⟶ `menu_items` (self-referential `parent_id`). Item types map to Shopify `MenuItemType` (`FRONTPAGE, COLLECTION, PRODUCT, PAGE, BLOG, ARTICLE, HTTP`).

---

## Storefront entities — storefront-mock (`apps/storefront/src/data/catalog.ts`)

Self-contained mock for the demo store, kept 1:1 with the admin fashion demo (same product handles + images).

- **Store**  *(`STORE`)* — `name, tagline, whatsapp, city` (demo: "Batik Nusantara").
- **Collection**  *(`COLLECTIONS`)* — `handle, name, emoji, blurb`. Plus **virtual collections** defined in `kategori/[handle].astro` `getStaticPaths`: `semua` (all products) and `promo-gajian` (compareAt||bestseller).
- **Product**  *(`PRODUCTS`)* — `handle, name, price, compareAt?, category, categoryHandle, image, description, sizes[], badge?, bestseller?`. Helpers: `productImages` (5-image gallery), `bestsellers`, `byCollection`, `findProduct`, `findCollection`.
- Nav header/footer consume `@indostore/data`. Cart is client-side (localStorage); checkout province/shipping/payment options are page-local mock arrays.

---

## Platform entities — super-admin-mock (`apps/super-admin/lib/mock.ts`)

- **Store**  *(`STORES`, `Store`)* — `id, name, owner, email, city, plan(pemula|bisnis|skala), status(aktif|trial|ditangguhkan), gmv, orders, products, createdDaysAgo` → `stores` (+ `accounts`).
- **Plan**  *(`PLANS`, `PlanInfo`)* — `key, name, price, blurb, features[]` → `plans` (Pemula Rp99k / Bisnis Rp299k / Skala Rp799k per month).
- **Platform metrics**  *(`PLATFORM`, derived)* — `mrr, gmv, totalStores, activeStores, trialStores, suspendedStores, newSignups30d, churnRate, arpu`; `planDistribution`; `MRR_SERIES` (12-month trend).
- **Invoice**  *(`INVOICES`, `Invoice`)* — `id, store, plan, amount, status(dibayar|menunggu|gagal), daysAgo` → `invoices`/billing.
- **Platform activity**  *(`P_ACTIVITY`, `PActivity`)* — `id, kind(signup|upgrade|payment|churn|support), text, minutesAgo`.

---

## Settings (mock inline in Pengaturan)
- **Admin:** store profile, tax (PPN 11%), users/roles → `store_settings`, `store_users`; payment/shipping method **toggles** only (platform-managed source of truth).
- **Super-admin:** platform payment gateways, shipping aggregator, COD config, platform users/roles → `platform_payment_gateways`, `shipping_aggregator`, `platform_couriers`, `platform_cod`.

## Deferred
Inventory locations, refunds, gift cards, abandoned carts, loyalty, notification templates, domains, storefront customer accounts. Add when the corresponding screens ship.

*Living doc — update alongside the mocks whenever an entity is added.*
