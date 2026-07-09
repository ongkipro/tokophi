# TokoΦ — Diagrams (UML / Mermaid)

> Renders on GitHub / any Mermaid viewer. Kept text-based so it lives with the code.
> Companion to `SYSTEM_GUIDE.md` (overview), `../PRD.md`, `SCHEMA.md`. Updated 2026-07-09.
>
> **Current state:** monorepo (npm workspaces) — 3 apps (`apps/admin` Next 16 :3000, `apps/super-admin` Next 16 :3001, `apps/storefront` Astro 5 :4327) + **4 shared packages** (`@tokophi/db`, `@tokophi/lib` [+ server-only `kiriminaja`/`autolaris`/`cache` subpaths], `@tokophi/ui`, `@tokophi/data`). **Backend fully wired** on local PostgreSQL 16 (Docker :5433) via `@tokophi/db` (55 tables, migrations 0000–0018, RLS enforcing). **Commerce loop is COMPLETE**: storefront checkout → real DB order + inventory + payment + shipping; merchant admin runs it; callbacks close it. **Real integrations**: KiriminAja (shipping — express + instant, area DB, pricing cache) + AutoLaris (payment — VA/QRIS/DANA + COD), both platform-managed + brand-hidden from clients. Prod target = self-hosted Postgres on a VPS (ADR 0007, NOT Supabase) + Cloudflare-native edge (CDN/R2/Images/KV); per-client topology = ADR 0008.

## 1. System context / container (C4-ish)
> Who talks to what: shoppers→storefront, merchants→admin, platform→super-admin; the 3 apps sit on shared packages; self-hosted Postgres + payment/shipping integrations are platform-managed and land at M3.
```mermaid
graph TB
  Shopper([Pembeli / shopper]):::user
  Merchant([Merchant / pemilik toko]):::user
  PlatformAdmin([Platform admin — kita]):::user

  subgraph Monorepo["Monorepo (npm workspaces)"]
    Admin["apps/admin :3000<br/>merchant admin (Next 16)"]
    SuperAdmin["apps/super-admin :3001<br/>platform control plane (Next 16)"]
    Storefront["apps/storefront :4327<br/>per-client shop (Astro 5)"]
    subgraph Packages["packages/*"]
      UI["@tokophi/ui<br/>shadcn/Base UI + tokens"]
      Lib["@tokophi/lib<br/>formatters/types"]
      Data["@tokophi/data<br/>canonical MAIN_MENU / FOOTER_MENU"]
      Db["@tokophi/db<br/>Drizzle schema + client"]
    end
  end

  subgraph Backend["Backend — Postgres now, self-hosted VPS target"]
    PGSQL[("local PostgreSQL 16<br/>store_id scoping · Drizzle")]
    subgraph Sb["Self-hosted Postgres — VPS (prod)"]
      Auth["Auth"]
      Storage["Storage (media)"]
    end
  end

  subgraph Integrations["Platform integrations (set up by us — ADR 0004)"]
    PG["Payment gateway<br/>AutoLaris (VA/QRIS/DANA) + COD"]
    AGG["Shipping aggregator<br/>KiriminAja (all couriers)"]
  end

  Shopper --> Storefront
  Merchant --> Admin
  PlatformAdmin --> SuperAdmin

  SuperAdmin --> UI
  SuperAdmin --> Lib
  Admin --> Data
  Storefront --> Lib
  Storefront --> Data

  SuperAdmin --> Db
  Db ==>|live now| PGSQL
  Admin -. next .-> PGSQL
  Storefront -. next .-> PGSQL
  PGSQL -. prod target .-> Sb
  Admin -. M3 .-> Storage
  SuperAdmin -. configures .-> PG
  SuperAdmin -. configures .-> AGG
  Storefront -. M3 .-> PG
  Storefront -. M3 .-> AGG

  classDef user fill:#eef,stroke:#88a;
```

## 2. Monorepo components — who imports what
> The 3 apps and 3 packages, with **actual** import edges verified in the repo. `@tokophi/data` is the only package shared by *both* admin and storefront (single nav source). Admin still ships its **own local `components/ui/*`** (Base UI) rather than `@tokophi/ui` — de-dup is backlog (ADR 0005).
```mermaid
graph LR
  subgraph apps
    AD["apps/admin<br/>Next 16 · local components/ui/*"]
    SA["apps/super-admin<br/>Next 16"]
    SF["apps/storefront<br/>Astro 5"]
  end
  subgraph packages
    UI["@tokophi/ui"]
    LIB["@tokophi/lib"]
    DATA["@tokophi/data<br/>menu (MAIN_MENU / FOOTER_MENU)"]
  end

  SA --> UI
  SA --> LIB
  SF --> LIB
  SF --> DATA
  AD --> DATA

  AD -. "backlog: adopt" .-> UI
  SF -. "own Astro components" .-> UI

  classDef pkg fill:#efe,stroke:#8a8;
  class UI,LIB,DATA pkg;
```

## 3. Data model (ER — key entities)
> Target relational shape for M3. Adds content/nav entities (`pages`, `menus`+`menu_items`, `articles`) alongside catalog, orders, customers, discounts. Payments/shipping config lives at platform level, not here (see note + ADR 0004).
```mermaid
erDiagram
  accounts ||--o{ stores : owns
  accounts ||--o{ subscriptions : has
  plans ||--o{ subscriptions : on
  subscriptions ||--o{ invoices : bills
  stores ||--o{ store_users : members
  users ||--o{ store_users : "belongs to"
  stores ||--o{ products : sells
  products ||--o{ product_variants : has
  products ||--o{ product_media : has
  stores ||--o{ collections : groups
  collections ||--o{ collection_products : contains
  products ||--o{ collection_products : "in"
  stores ||--o{ orders : receives
  orders ||--o{ order_line_items : has
  order_line_items }o--|| product_variants : of
  orders ||--o{ fulfillments : ships
  orders ||--|| payments : "paid via"
  stores ||--o{ customers : has
  customers ||--o{ orders : places
  stores ||--o{ leads : crm
  stores ||--o{ followups : crm
  stores ||--o{ discounts : offers
  stores ||--o{ pages : content
  stores ||--o{ articles : blog
  stores ||--o{ menus : nav
  menus ||--o{ menu_items : contains
  menu_items ||--o{ menu_items : children

  accounts {
    uuid id PK
    string name
    enum plan
  }
  stores {
    uuid id PK
    uuid account_id FK
    string name
    string slug
    enum status
  }
  users {
    uuid id PK
    string email
    string name
  }
  store_users {
    uuid id PK
    uuid store_id FK
    uuid user_id FK
    enum role
  }
  products {
    uuid id PK
    uuid store_id FK
    string title
    enum status
    string category
  }
  product_variants {
    uuid id PK
    uuid product_id FK
    int price_idr
    int stock
    string sku
  }
  orders {
    uuid id PK
    uuid store_id FK
    uuid customer_id FK
    enum status
    enum channel
    int total_idr
  }
  order_line_items {
    uuid id PK
    uuid order_id FK
    uuid variant_id FK
    int qty
    int price_idr
  }
  fulfillments {
    uuid id PK
    uuid order_id FK
    string courier
    string tracking_no
    enum status
  }
  payments {
    uuid id PK
    uuid order_id FK
    enum method
    enum status
    int amount_idr
  }
  customers {
    uuid id PK
    uuid store_id FK
    string name
    enum segment
    int total_spent_idr
  }
  discounts {
    uuid id PK
    uuid store_id FK
    enum type
    int value
    enum status
  }
  pages {
    uuid id PK
    uuid store_id FK
    string handle
    string title
  }
  articles {
    uuid id PK
    uuid store_id FK
    string handle
    string title
    enum status
  }
  menus {
    uuid id PK
    uuid store_id FK
    string handle
    string title
    bool is_default
  }
  menu_items {
    uuid id PK
    uuid menu_id FK
    uuid parent_id FK
    string label
    enum item_type
    string href
    int position
  }
```
> Payments/shipping/COD config is **platform-level** (see `SCHEMA.md`): `shipping_aggregator`, `platform_couriers`, `platform_payment_gateways`, `platform_cod`; per-store rows keep only `enabled` flags. `menus`/`menu_items` mirror the canonical shapes in `@tokophi/data` (see §6).

## 4. Commerce loop — storefront checkout → order → payment → shipping (IMPLEMENTED)
> The real, working end-to-end loop. Cart lives in `localStorage`; checkout calls the platform proxy endpoints (in `apps/admin/app/api/public/*`, no-auth, CORS) which own the KiriminAja/AutoLaris keys. `/api/public/order` creates the order + inventory + payment; callbacks close it. Provider brands are hidden from the shopper (white-label).
```mermaid
sequenceDiagram
  actor Pembeli
  participant SF as Storefront (Astro)
  participant OG as /api/public/ongkir (proxy)
  participant OR as /api/public/order (proxy)
  participant KA as KiriminAja
  participant AL as AutoLaris (PSP)
  participant DB as Postgres (RLS)
  participant AD as Merchant admin

  Pembeli->>SF: produk → keranjang (localStorage)
  Pembeli->>SF: checkout — cari kecamatan tujuan
  SF->>OG: op=search (resolveArea: DB lokal → KA fallback)
  SF->>OG: op=rates (KA shipping_price, cache 10m)
  OG-->>SF: tarif Ekspedisi + (⚡) Instan (geolokasi)
  Pembeli->>SF: pilih kurir + metode bayar → Bayar
  SF->>OR: {items, customer, address, shipping, channelCode, instant?}
  OR->>DB: cek stok → upsert customer → insert order + line items (variantId) → kurangi stok
  alt instant
    OR->>KA: v4/instant/pickup/request (dispatch driver)
    KA-->>OR: instant order_id → order.awb, status dikirim
  end
  alt non-COD
    OR->>AL: create_payment (VA/QRIS/DANA)
    AL-->>OR: trx_id + VA/QRIS → payments row (linked)
  else COD
    OR->>DB: payments row (method=cod)
  end
  OR-->>SF: orderNumber (WEB-…) + instruksi bayar
  SF-->>Pembeli: /sukses (No. pesanan + VA/QRIS)
  DB-->>AD: order muncul di Pesanan + payment linked
  AL->>OR: callback (PAID) → payment berhasil + order dibayar
```

## 5. Shipping — express (resi/AWB) + instant (same-day) (IMPLEMENTED)
> Merchant admin creates shipments from an order. Express = district-id based (pickup → AWB); Instant = coordinate based (dispatch a driver now). Insurance/COD/dimensions supported (volumetric). Area names resolve from the local `kiriminaja_areas` table first (no rate limit).
```mermaid
flowchart TD
  A[Order detail — Cek Ongkir] --> B{Jenis}
  B -->|Ekspedisi| C[shipping_price v6.1<br/>district IDs + weight+dims+insurance]
  B -->|Instan| D[v4/instant/pricing<br/>lat/long + gosend/grab/borzo]
  C --> E["Buat Pengiriman (request_pickup v6.1)<br/>+insurance_amount +cod +package dims"]
  E --> F["orders.awb / courier / kaOrderId · status dikirim"]
  F --> G["Lacak (tracking) · Cetak label PDF (100×150) · Batalkan (cancel_shipment)"]
  D --> H["request_pickup instant (shipping_costs, order_prefix)"]
  H --> F
```

## 6. Shared nav — single source of truth (`@tokophi/data`)
> `@tokophi/data/menu` exports canonical `MAIN_MENU` + `FOOTER_MENU`. Both the admin menu builder and the storefront header **derive** from it, so they stay in sync. **Today** this is a build-time sync (edit the file → rebuild both). **M3** persists menus in self-hosted Postgres so runtime edits in the admin UI go live on the storefront (ADR 0006).
```mermaid
flowchart TB
  subgraph SRC["@tokophi/data/menu (canonical)"]
    MM["MAIN_MENU: MenuItem[]"]
    FM["FOOTER_MENU: MenuItem[]"]
  end

  subgraph ADMIN["apps/admin — Navigasi (menu builder)"]
    AS["lib/mock/store.ts<br/>toNavItems(MAIN_MENU/FOOTER_MENU) → MENUS"]
    BUILDER["/navigasi drag-drop builder<br/>(edits = local React state)"]
  end

  subgraph STORE["apps/storefront — header/footer"]
    NAV["src/data/nav.ts<br/>MAIN_NAV = MAIN_MENU.map(...)"]
    HEADER["Header.astro / Footer"]
  end

  MM --> AS --> BUILDER
  FM --> AS
  MM --> NAV --> HEADER
  FM --> NAV

  BUILDER -. "M3: persist to Postgres" .-> DB[("menus / menu_items")]
  DB -. "M3: live read" .-> HEADER

  classDef now fill:#eef,stroke:#88a;
  class SRC,ADMIN,STORE now;
```
> Sync direction now is **file → both surfaces (build-time)**. The dotted edges are the M3 upgrade: admin UI edits persist to `menus`/`menu_items` and the storefront reads them live.

## 7. Data-layer seam (IMPLEMENTED — server-only → Postgres via RLS)
> Screens never touch storage directly. Admin/super-admin read through server-only `lib/data/*` selectors + write via `lib/actions/*` server actions; the storefront reads `src/data/catalog.ts` (via `@tokophi/db`). Admin tenant queries run inside `withTenant`/`withCurrentTenant` (sets `app.store_id` GUC + `SET LOCAL ROLE tokophi_app`) so RLS enforces. `lib/mock/*` remains only as deterministic seed-parity shape.
```mermaid
graph TB
  subgraph Screens
    A1["admin (admin)/* + api/public/*"]
    S1["super-admin (platform)/*"]
    F1["storefront pages/*.astro"]
  end
  subgraph Seam["Server-only data/actions"]
    AD["admin lib/data/* (withCurrentTenant) + lib/actions/* (withTenant)"]
    SD["super-admin lib/data.ts + actions.ts (owner, cross-tenant)"]
    SC["storefront src/data/catalog.ts (build/SSR)"]
    INT["@tokophi/lib/{kiriminaja,autolaris,cache}"]
  end
  DB[("PostgreSQL 16 + RLS (tokophi_app role)")]
  EXT["KiriminAja · AutoLaris (live APIs)"]

  A1 --> AD --> DB
  A1 --> INT --> EXT
  S1 --> SD --> DB
  F1 --> SC --> DB
```

## 8. Deployment & scaling (target — Cloudflare-native, sized for 50–100 clients / 10–30k ad traffic)
> Storefront static+edge absorbs ad traffic cheaply; the load-bearing paths are **images** and **live ongkir** — solved by R2+Cloudflare Images and KV/in-proc pricing cache. DB is self-hosted Postgres on a VPS (ADR 0007, NOT Supabase) behind a pooler.
```mermaid
graph LR
  Ads[Ad traffic 10–30k] --> CDN
  subgraph Cloudflare[Cloudflare edge]
    CDN[CDN / Pages — Astro storefronts]
    IMG[Cloudflare Images + R2 — product media]
    KV[Workers KV / Cache API — ongkir & KPI cache]
    Q[Cloudflare Queues / Inngest — callbacks · notif · shipment]
    W["Workers (opsi) — /api/public/*"]
  end
  subgraph VPS[VPS — Coolify/Docker]
    ADMIN[admin + super-admin Next]
    POOL[PgBouncer / Hyperdrive]
    PG[(Postgres 16 + RLS)]
  end
  EXT[KiriminAja · AutoLaris]

  CDN --> W --> POOL --> PG
  CDN --> IMG
  W --> KV
  W --> EXT
  ADMIN --> POOL
  Q --> EXT
  Q --> PG
```
> **Priority before ads:** ① R2 + Cloudflare Images (media) · ② KV cache for `shipping_price` (avoid KiriminAja rate-limit) · ③ DB pooling · ④ Queue for async (callbacks/notif/shipment). Backend extraction (Hono/Workers) + full Redis are optional at this scale. Open decision: storefront **SSG-rebuild-per-store** vs **SSR + edge-cache** (better for 50–100 stores with frequent updates).

## 9. User roles (who touches what)
> Access map across the three surfaces; RLS by `store_id` enforces tenant isolation at M3 (ADR 0003), super-admin is the cross-tenant platform plane.
```mermaid
graph LR
  Platform["Platform admin (us)"] --> SA["super-admin: toko, paket, billing,<br/>gateway/kurir/COD config"]
  Owner["Store owner"] --> AD["admin: produk, pesanan, CRM,<br/>navigasi, aktifkan metode/kurir"]
  Staff["Staf / gudang"] --> AD2["admin: pesanan, stok (peran terbatas)"]
  Buyer["Pembeli"] --> SF2["storefront: belanja, checkout"]
```

## 10. Per-client topology & provisioning (ADR 0008)
> One control plane + one **multi-tenant** admin + a **storefront per client**, all on one shared DB. "Client Admin A/B" = the *same* admin app scoped by `store_id` — not a deploy per client.
```mermaid
graph TB
  Super["Super Admin<br/>(1 deploy, cross-tenant)"] --> DB[("shared PostgreSQL<br/>store_id + RLS")]
  Admin["Client Admin<br/>(1 multi-tenant deploy)"] --> DB
  subgraph Clients["Per client = a store_id + a storefront deploy"]
    A["Storefront A<br/>STORE_SLUG=a · domain A"]
    B["Storefront B<br/>STORE_SLUG=b · domain B"]
    C["Storefront C<br/>STORE_SLUG=c · domain C"]
  end
  A --> DB
  B --> DB
  C --> DB
  MA([Merchant A]) -->|login → store_id=A| Admin
  MB([Merchant B]) -->|login → store_id=B| Admin
```

**Onboard a client (3 steps, no new admin/DB):**
```mermaid
sequenceDiagram
  participant P as Platform (super-admin)
  participant DB as shared Postgres
  participant CF as Cloudflare
  participant M as Merchant
  P->>DB: 1. create account + store (+owner, plan, settings, location)
  P->>CF: 2. deploy storefront (STORE_SLUG + custom domain)
  M->>DB: login → admin scoped to store_id (RLS)
  M->>DB: 3. fill catalog / pages via scoped admin
  Note over DB,CF: storefront reads that store by slug → live shop
```
*Living doc — update diagrams when the architecture moves.*
