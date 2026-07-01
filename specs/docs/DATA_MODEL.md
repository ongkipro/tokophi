# Indostore — Data Model

> Mock shapes live in `admin/lib/mock/store.ts`. This maps them to future Postgres/Supabase tables. Content entities mirror **Shopify Admin API** shapes (screened live via `shopify store execute`), so the eventual API feels familiar.

## Conventions (future DB)
- Every business table carries **`store_id`** (multi-tenant) with **Row-Level Security** scoping to the current store.
- `id` = uuid; timestamps `created_at`/`updated_at`; money stored in **IDR minor-unit-free integers** (Rupiah has no cents in practice) — the UI formats via `IDR()`.
- Handles are unique per store; SEO stored as `seo_title` / `seo_description` (mirrors Shopify metafields `global.title_tag` / `global.description_tag`).

## Commerce entities

### Product  *(mock: `Product`)*
`id, name, emoji|image, price, stock, status(active|draft), category, unitsSold` → table `products` (+ future `product_variants`, `product_media`, `collections`/`product_collections`).

### Order  *(mock: `Order`)*
`id, customer, city, total, items, status(baru|diproses|dikirim|selesai|batal), channel, minutesAgo→created_at` → `orders` (+ `order_line_items`, `fulfillments`, `payments`). Channel ∈ {Toko Online, Instagram, WhatsApp, TikTok Shop, Google}.

### Customer  *(mock: `Customer`)*
`id, name, email, phone, city, orders, spent, segment(baru|reguler|loyal|vip), joinedDaysAgo` → `customers`. Segment is derived (spent/orders thresholds) — later a computed column or view.

### Discount  *(mock: `Discount`)*
`id, code, type(persen|nominal|ongkir), value, status(aktif|terjadwal|kadaluarsa), used, limit, endsInDays` → `discounts` (+ usage tracking).

### Analytics  *(mock: `DAYS`/`hourlyFor` + `FUNNEL`, `REGION_SALES`, `DEVICE_SPLIT`, `NEW_VS_RETURNING`)*
Daily series (`date, sales, orders, visitors`) + hourly distribution for "today/yesterday", plus conversion funnel steps, sales-by-region, device split, and new-vs-returning. Later: an `analytics_events` table aggregated into daily/hourly rollups + funnel/region/device dimensions; the `lib/data` range functions (`getSummary/getSeries/...`) become queries.

### Marketing / Ad channels  *(mock: `AdChannel`)* — Pemasaran
`key(meta|google|tiktok), name, brand, connected, pixelLabel, pixelId, pixelActive, capiActive, spend, impressions, clicks, conversions, revenue, campaigns[]` → `ad_channels` (connection + tracking config per store) + `ad_metrics` (daily spend/impressions/clicks/conversions/revenue per channel/campaign, pulled from Meta/Google/TikTok Marketing APIs). Derived: ROAS = revenue/spend, CTR = clicks/impressions, CPC = spend/clicks, CPA = spend/conversions. **Tracking** (pixels/Conversions API/GA4/Events API) config stored per channel; server-side conversion events (CAPI) fire from order webhooks later.

## Content entities (Shopify-modeled)

### Page  *(mock: `CmsPage`)* — Shopify `Page`
`id, title, handle, published(isPublished), template(templateSuffix), updatedDaysAgo, views` + body(HTML) + SEO → `pages`. Storefront URL `/pages/<handle>`.

### Blog + Article  *(mock: `BlogPost` + `BLOG_CATEGORIES`)* — Shopify `Blog` + `Article`
`BlogPost = id, title, handle, blog(category), author, published, publishedDaysAgo, excerpt(summary), comments` + body(HTML) + tags + featured image + SEO → `blogs` (1) ⟶ `articles` (N). URL `/blogs/<blog>/<handle>`.

### Menu + MenuItem  *(mock: `NavMenu` + `NavItem`)* — Shopify `Menu` + `MenuItem`
`NavMenu = handle, title, isDefault, items[]`. `NavItem = id, title, type, target(url/resourceId), children[]`.
`NavItemType = beranda | koleksi | produk | halaman | blog | url` — maps to Shopify `MenuItemType` (`FRONTPAGE, COLLECTION, PRODUCT, PAGE, BLOG, ARTICLE, HTTP, …`). Default menus: `main-menu` ("Menu Utama", header) and `footer`. Items nest one level in the UI (Shopify allows deeper). → `menus` ⟶ `menu_items` (self-referential `parent_id`).

## Settings (mock inline in Pengaturan)
Store profile, payment methods (Transfer/QRIS/OVO/GoPay/DANA/COD/VA), couriers (JNE/J&T/SiCepat/AnterAja/Pos/GoSend/Grab), tax (PPN 11%), users/roles → `stores`, `store_payment_methods`, `store_shipping_methods`, `store_users`.

## Deferred
Inventory locations, refunds, gift cards, abandoned carts, reviews (could reuse the Judge.me-style pattern from petcue/pixsgo). Add when the corresponding admin screens are built.
