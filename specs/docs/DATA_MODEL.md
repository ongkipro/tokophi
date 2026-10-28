# TokoΦ — Data Model

> The entities the UI works with, and how they map to the **PostgreSQL** tables (live via `@tokophi/db` — see `SCHEMA.md`, which is derived from the catalog and wins on any disagreement).
> ⚠️ **Historical shape notes.** This file was written in the mock-data era. The mock files it names (`apps/admin/lib/mock/store.ts`, `apps/super-admin/lib/mock.ts`) and the shared `@tokophi/data` package were **deleted** (Task 6.7, 2026-09-09); every surface now reads the database, the admin's view types live in `apps/admin/lib/types/domain.ts`, and the storefront reads per request via `apps/storefront/src/data/catalog.ts`. Where a heading below says `*-mock`, read it as "the flat view shape".
>
> Content entities mirror **Shopify Admin API** shapes so the eventual API feels familiar. Aligned with `SCHEMA.md`.
> **ADR 0009 (Store Builder):** `page_templates` entity (store-scoped, `type` = homepage/category/product, `sections` jsonb) plus `template_id` FKs on `collections`/`products` and `stores.logo_url` — migrated (`0026`/`0027`). See [`decisions/0009-self-serve-store-builder.md`](../decisions/0009-self-serve-store-builder.md).

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
> **Store Builder (ADR 0009):** `collections.template_id` picks which `category`-type `page_templates` row renders this collection's storefront page (null = store default). `products.template_id` is the equivalent for product pages.

### Page Template  *(new — ADR 0009, no mock; admin-authored via the Store Builder)*
`id, store_id, type(homepage|category|product), name, sections(jsonb — ordered [{type,config}]), is_default`
→ `page_templates`. One row per template a merchant assembles by drag-and-drop (Puck) from the curated section registry (Hero, Product Grid, Banner, Testimoni, …). `sections[].type` maps to the same-named component on both the admin editor (React) and the storefront renderer (Astro) — one config schema drives both. Checkout is **not** a `page_templates` type — it's locked/uniform, reading only `stores.logo_url`/`stores.name`.

### Order  *(mock: `Order`, `ORDERS`)*
`id, customer, city, total, items, status(baru|diproses|dikirim|selesai|batal), channel, minutesAgo→created_at`
→ `orders` (+ `order_line_items`, `payments`, `fulfillments`).
- **`channel` = attribution/traffic source, NOT a sales channel.** Enum: **Meta Ads · TikTok Ads · Google Ads · Organic · Other** (the only sales channel is Toko Online).

### Customer  *(mock: `Customer`, `CUSTOMERS`)*
`id, name, email, phone, city, orders, spent, segment(baru|reguler|loyal|vip), joinedDaysAgo`
→ `customers` (+ `customer_addresses`). Segment is derived (spent/orders thresholds) — later a computed column/view.
- **Guest vs registered (migration 0044):** `registered_at` (NULL = **guest**), `password_hash`, `last_order_at`. **Buying never requires an account** — a registration wall in front of an Indonesian checkout loses the sale — so *guest is the normal case*, and the read layer (`apps/admin/lib/data/customers.ts`) exposes it as `registered: boolean` with a deliberately neutral `Tamu` badge. The identity that does the work is the **phone**, not the email. `password_hash` is provisioned; there is **no shopper login yet**.

### Checkout session  *(new — migration 0044/0045, no mock: it is captured live)*
`id, store_id, session_id, customer_id, name, phone, email, address, city, province, postcode, district_id, items(jsonb [{handle,name,variant,qty,price}]), subtotal_idr, shipping_idr, step(keranjang|kontak|alamat|pengiriman|pembayaran), status(aktif|ditinggal|pulih|kedaluwarsa), abandoned_at, recovered_order_id, recovered_at, created_at, updated_at`
→ `checkout_sessions`, UNIQUE `(store_id, session_id)`, indexed on `(store_id, status, updated_at)`, **RLS** like every other tenant table (a half-typed checkout carries a name, a phone and an address — it is merchant data).
- **Written progressively, as the shopper types** (debounced beacons from `checkout.astro` → `apps/storefront/src/pages/api/checkout-session.ts`, the table's only writer from the shop). There is no "abandon" event to listen for: abandonment is the **absence** of an order, so the row is captured up-front and judged later by what never happened to it. `session_id` is the **same** id the funnel beacons carry, so a cart joins its own journey. `step` only ever moves **forward** (`sendBeacon` has no ordering guarantee).
- **Ageing:** `aktif → ditinggal` after 60 minutes of silence, by an opportunistic sweep in that same endpoint. No cron. `abandoned_at` is stamped as `coalesce(updated_at, created_at)` — *the moment it went quiet*, not "now".
- **`abandoned_at` is what makes the metrics honest:** a straight-through checkout also ends as `pulih`, so `rescued = abandoned_at IS NOT NULL AND recovered_at IS NOT NULL`, while `abandoned_at IS NULL AND recovered_at IS NOT NULL` is an ordinary sale, **not** a save. `abandonRate = ditinggal / (ditinggal + orders)`; `recoveryRate = rescued / (rescued + ditinggal)`; `aktif` sessions are excluded from both — nobody has abandoned anything yet.
- Read by `apps/admin/lib/data/checkout.ts` → `/pelanggan/keranjang`; the WhatsApp recovery attempt is recorded in **`followups`** (`type='keranjang'`) by `apps/admin/lib/actions/checkout.ts`. Recovery links back into the storefront are **signed** HS256 JWTs `{sid, st}` (`packages/lib/src/recovery.ts` — shared, because the ADMIN mints and the STOREFRONT verifies), never a raw session id. Minted by `getAbandonedCarts` and appended to the WA body by `cartMessage`.

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
- The `keranjang` type finally has a **real cart behind it** (`checkout_sessions`, 0044) — it used to point at a basket that never existed. A recovery attempt writes `status='menunggu'` + `sent_at` (= *"kontak dibuka"*), **never `terkirim`**: `wa.me` is a deep link, so delivery and read are things we cannot observe and therefore do not claim.

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

### Catalog identity  *(REAL — migration 0081, ADR 0013)*
`products.number` (per store, `unique(store_id, number)`) · `products.variant_seq_next` (high-water
mark) · `product_variants.seq` (`unique(product_id, seq)`) · `store_counters(store_id, product_next)` ·
`stores.catalog_id_scheme` (`handle` | `number`)

```text
store_counters 1──1 stores          (allocation counter; one statement, race-free)
stores        1──n products         (number is dense PER STORE: #1001, #1002, …)
products      1──n product_variants (seq is dense PER PRODUCT, never reused)

catalog id    = `{products.number}-{product_variants.seq}`   → <g:id> AND content_ids
item_group_id = `{products.number}`
```
Both ids are allocate-once, so renaming a handle, reordering variants or deleting a sibling leaves
every surviving id unchanged — which is the whole point, because Google/Meta/TikTok treat a changed id
as "product deleted, new product appeared" and offer no re-key.

### Tracking channel  *(REAL — `store_tracking_channels`, migration 0079, ADR 0012)* — Pemasaran → Pelacakan
`store_id, channel(meta|google|tiktok), enabled, pixel_id, capi_enabled, capi_token_ciphertext,
advanced_matching, test_event_code`
**Not the same thing as `ad_channels` above** — that one is demo/label data. This is the merchant's own
live pixel config: the storefront fires from it, and the conversion cron authenticates with it. One row
per (store, channel); `pixel_id` is public, the token is AES-256-GCM at rest and never leaves the server.

### Conversion delivery  *(REAL — `tracking_event_deliveries`, migration 0080, ADR 0012)*
`store_id, channel, event_name, event_id, order_id, status(queued|processing|succeeded|failed|dead_letter),
attempt_count, next_attempt_at, delivered_at, payload(jsonb), last_error_code, last_error_message`

```text
stores 1──n store_tracking_channels        (unique: store_id + channel)
stores 1──n tracking_event_deliveries      (unique: store_id + channel + event_id)
orders 1──n tracking_event_deliveries      (one row per enabled channel, per sale)
orders 1──n order_line_items ──n product_variants ──1 products
                                   └── retailerId(handle, position, count) → payload.contentIds
                                       …the SAME string /feed/google.xml emits as <g:id>
```
The queue has no worker process: `api/cron/tracking-events` drains it (ADR 0012 §0.1). `payload` holds
commerce facts only — buyer identity is read fresh at send time, hashed in the provider adapter, and
never stored on the row.

### Province marketing stat  *(mock: `ProvinceStat`, `AD_PROVINCES`, `PROVINCES`)*
`province, spend, impressions, clicks, conversions, revenue, reach` → `ad_metrics` grouped by `province` ("Performa per Provinsi").

---

## Content entities (Shopify-modeled)

### Page  *(mock: `CmsPage`, `PAGES`)* — Shopify `Page`
`id, title, handle, published, updatedDaysAgo, template(templateSuffix), views` + body(HTML) + SEO → `pages`. Storefront URL `/halaman/<handle>` (route built).

### Blog + Article  *(mock: `BlogPost`, `BLOG_POSTS`, `BLOG_CATEGORIES`)* — Shopify `Blog` + `Article`
`BlogPost = id, title, handle, blog(category), author, published, publishedDaysAgo, excerpt, comments` + body + tags + featured image + SEO → `blogs` (1) ⟶ `articles` (N). Storefront `/blog` list + article detail `/blog/<handle>` both built (2026-07-14).

### Menu + MenuItem  *(per-store `menus` ⟶ `menu_items`)* — Shopify `Menu` + `MenuItem`
- **Canonical source:** the store's own `menus` / `menu_items` rows (per tenant). The admin Navigasi editor writes them (`apps/admin/lib/actions/menus.ts`) and the storefront reads the same tree (`apps/storefront/src/data/nav.ts`), so they cannot drift. `MenuItemType = beranda | koleksi | produk | halaman | blog | url`. Default menus: `main-menu` ("Menu Utama", header) and `footer`.
- → `menus` ⟶ `menu_items` (self-referential `parent_id`). Item types map to Shopify `MenuItemType` (`FRONTPAGE, COLLECTION, PRODUCT, PAGE, BLOG, ARTICLE, HTTP`).

---

## Storefront entities — storefront-mock (`apps/storefront/src/data/catalog.ts`)

Self-contained mock for the demo store, kept 1:1 with the admin fashion demo (same product handles + images).

- **Store**  *(`STORE`)* — `name, tagline, whatsapp, city` (demo: "Batik Nusantara").
- **Collection**  *(`COLLECTIONS`)* — `handle, name, emoji, blurb`. Plus **virtual collections** defined in `kategori/[handle].astro` `getStaticPaths`: `semua` (all products) and `promo-gajian` (compareAt||bestseller).
- **Product**  *(`PRODUCTS`)* — `handle, name, price, compareAt?, category, categoryHandle, image, description, sizes[], badge?, bestseller?`. Helpers: `productImages` (5-image gallery), `bestsellers`, `byCollection`, `findProduct`, `findCollection`.
- Nav header/footer read the store's own `menus`/`menu_items`. Cart is client-side (localStorage); checkout province/shipping/payment options are page-local mock arrays.

---

## Platform entities — super-admin *(historical; the mock file is gone, the live reads are `apps/super-admin/lib/data*`)*

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
Inventory locations, refunds, gift cards, loyalty, notification templates, domains, **storefront customer accounts** (`customers.password_hash` exists; nothing reads it). ~~abandoned carts~~ — shipped in 0044/0045 (`checkout_sessions`). Add the rest when the corresponding screens ship.

*Living doc — update alongside the mocks whenever an entity is added.*


## Addendum 2026-09-11 — village ids come in TWO spaces (migrations `0107`, `0108`)

The body above predates these columns; `SCHEMA.md` is the catalog of record. A village on our side has
two ids and only one is a courier id: **Kemendagri** `kelurahan.id` (text, `"34.02.07.2001"` — the key the
POSTCODE dataset is published under) and **KiriminAja** `kelurahan.ka_kelurahan_id` (integer, from
`POST /api/mitra/kelurahan`; 74 017 of 78 764 filled, one id per village per district, guarded by
`packages/db/src/kelurahan-csv.test.ts`). The order snapshots the destination in both:
`orders.ship_kelurahan_name` (what the shopper picked) and `orders.ship_kelurahan_id` (re-derived
server-side against `ship_district_id`, never taken from the request; omitted from the booking when the
district was itself a guess). Sender side: `store_settings.sender_kelurahan_id`. Rationale and the
matcher defect the full walk exposed: root `TASKS.md` Task 8.17; vendor contract: `KIRIMINAJA.md`.
