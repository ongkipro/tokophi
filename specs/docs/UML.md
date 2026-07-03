# Indostore — Diagrams (UML / Mermaid)

> Renders on GitHub / any Mermaid viewer. Kept text-based so it lives with the code.
> Companion to `../PRD.md`, `SCHEMA.md`, `CONCEPT.md`. Updated 2026-07-03.
>
> **Current state:** monorepo (npm workspaces) with 3 apps — `apps/admin` (Next 16, :3000, merchant admin), `apps/super-admin` (Next 16, :3001, platform control plane), `apps/storefront` (Astro 5, :4327, shopper shop "Batik Nusantara") — and **4 shared packages**: `@indostore/ui`, `@indostore/lib`, `@indostore/data`, **`@indostore/db`** (Drizzle schema/client + migrations). **Backend is being wired** on **local PostgreSQL 16** (Docker, port 5433) via `@indostore/db`: **super-admin (all 5 pages) + 16 admin modules** + storefront all read the DB (reads done end-to-end); only writes (mutations) still pending. Seeds are deterministic (mulberry32, `TODAY=2026-06-30`). Single-tenant "Batik Nusantara" MVP. Prod target = Supabase (ADR 0007); per-client topology = ADR 0008.

## 1. System context / container (C4-ish)
> Who talks to what: shoppers→storefront, merchants→admin, platform→super-admin; the 3 apps sit on shared packages; Supabase + payment/shipping integrations are platform-managed and land at M3.
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
      UI["@indostore/ui<br/>shadcn/Base UI + tokens"]
      Lib["@indostore/lib<br/>formatters/types"]
      Data["@indostore/data<br/>canonical MAIN_MENU / FOOTER_MENU"]
      Db["@indostore/db<br/>Drizzle schema + client"]
    end
  end

  subgraph Backend["Backend — Postgres now, Supabase target"]
    PGSQL[("local PostgreSQL 16<br/>store_id scoping · Drizzle")]
    subgraph Sb["Supabase — prod target"]
      Auth["Auth"]
      Storage["Storage (media)"]
    end
  end

  subgraph Integrations["Platform integrations (set up by us — ADR 0004)"]
    PG["Payment gateways<br/>Midtrans / Xendit / Duitku + COD"]
    AGG["Shipping aggregator<br/>Biteship (all couriers)"]
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
> The 3 apps and 3 packages, with **actual** import edges verified in the repo. `@indostore/data` is the only package shared by *both* admin and storefront (single nav source). Admin still ships its **own local `components/ui/*`** (Base UI) rather than `@indostore/ui` — de-dup is backlog (ADR 0005).
```mermaid
graph LR
  subgraph apps
    AD["apps/admin<br/>Next 16 · local components/ui/*"]
    SA["apps/super-admin<br/>Next 16"]
    SF["apps/storefront<br/>Astro 5"]
  end
  subgraph packages
    UI["@indostore/ui"]
    LIB["@indostore/lib"]
    DATA["@indostore/data<br/>menu (MAIN_MENU / FOOTER_MENU)"]
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
> Payments/shipping/COD config is **platform-level** (see `SCHEMA.md`): `shipping_aggregator`, `platform_couriers`, `platform_payment_gateways`, `platform_cod`; per-store rows keep only `enabled` flags. `menus`/`menu_items` mirror the canonical shapes in `@indostore/data` (see §6).

## 4. Storefront purchase flow (current — mock, no backend)
> Real shopper journey as built today: everything renders from mock catalog and the **cart lives in `localStorage`** (no server). Checkout collects address/shipping/payment then routes to a static success page. The payment/shipping calls are stubs until M3 (§5).
```mermaid
sequenceDiagram
  actor Pembeli
  participant SF as Storefront (Astro)
  participant Cat as src/data/catalog.ts (mock)
  participant LS as localStorage (cart)

  Pembeli->>SF: Buka beranda / kategori/[handle]
  SF->>Cat: Ambil produk (seeded mock)
  Cat-->>SF: Daftar produk + gambar
  Pembeli->>SF: Buka produk/[handle] (galeri 5 gambar)
  Pembeli->>SF: "Tambah ke keranjang"
  SF->>LS: Simpan item (write)
  Pembeli->>SF: Buka /keranjang
  SF->>LS: Baca item (read) → subtotal
  Pembeli->>SF: Lanjut /checkout (alamat + kurir + pembayaran)
  Note over SF: Ongkir/pembayaran = stub (real di M3, lihat §5)
  Pembeli->>SF: "Buat pesanan"
  SF->>LS: Kosongkan cart
  SF-->>Pembeli: /checkout/sukses
```

## 5. Checkout + payment + shipping — target (platform-managed, M3)
> Backend flow once Supabase + integrations land: storefront quotes ongkir via the aggregator, charges through the platform PSP account, writes the order (scoped by `store_id`), and it surfaces in the merchant admin in realtime. Platform settles and pays out (ADR 0004).
```mermaid
sequenceDiagram
  actor Pembeli
  participant SF as Storefront
  participant AGG as Aggregator (Biteship)
  participant PG as Gateway (platform acct)
  participant DB as Supabase
  participant AD as Merchant admin

  Pembeli->>SF: Checkout (pilih kurir/layanan yang diaktifkan toko)
  SF->>AGG: Cek ongkir (kurir + service enabled)
  AGG-->>SF: Tarif & ETA
  Pembeli->>SF: Bayar
  SF->>PG: Buat transaksi (akun platform)
  PG-->>SF: Status (dibayar/pending)
  SF->>DB: Insert order (store_id, channel=attribution)
  DB-->>AD: Order muncul di admin toko (realtime)
  AD->>AGG: Buat pengiriman → resi otomatis
  Note over PG,DB: Platform settle → payout ke merchant (potong fee)
```

## 6. Shared nav — single source of truth (`@indostore/data`)
> `@indostore/data/menu` exports canonical `MAIN_MENU` + `FOOTER_MENU`. Both the admin menu builder and the storefront header **derive** from it, so they stay in sync. **Today** this is a build-time sync (edit the file → rebuild both). **M3** persists menus in Supabase so runtime edits in the admin UI go live on the storefront (ADR 0006).
```mermaid
flowchart TB
  subgraph SRC["@indostore/data/menu (canonical)"]
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

  BUILDER -. "M3: persist to Supabase" .-> DB[("menus / menu_items")]
  DB -. "M3: live read" .-> HEADER

  classDef now fill:#eef,stroke:#88a;
  class SRC,ADMIN,STORE now;
```
> Sync direction now is **file → both surfaces (build-time)**. The dotted edges are the M3 upgrade: admin UI edits persist to `menus`/`menu_items` and the storefront reads them live.

## 7. Data-layer seam (mock today → Supabase later)
> The core of the mock-first bet (ADR 0001): screens never touch storage directly. They read through a thin data layer — `apps/admin/lib/mock/*`, `apps/storefront/src/data/*`, `@indostore/data` — that returns seeded fixtures today and becomes Supabase queries at M3 with the same shapes.
```mermaid
graph TB
  subgraph Screens
    A1["admin app/(admin)/* screens"]
    S1["super-admin app/(platform)/* screens"]
    F1["storefront pages/*.astro"]
  end
  subgraph Seam["Data layer (stable interface)"]
    AM["admin/lib/mock/store.ts"]
    SM["super-admin mock fixtures"]
    SC["storefront/src/data/catalog.ts + nav.ts"]
    DP["@indostore/data (menu)"]
  end
  subgraph Sources
    MOCK["Seeded mock (mulberry32, TODAY=2026-06-30)"]
    SB[("Supabase — M3<br/>Postgres + RLS by store_id")]
  end

  A1 --> AM
  S1 --> SM
  F1 --> SC
  F1 --> DP
  AM --> DP

  AM --> MOCK
  SM --> MOCK
  SC --> MOCK
  DP --> MOCK
  AM -. M3 .-> SB
  SM -. M3 .-> SB
  SC -. M3 .-> SB
  DP -. M3 .-> SB
```

## 8. Deployment (target)
> Where each app runs at M3: the two Next admins on Vercel, the per-client Astro storefront on Cloudflare, all backed by managed Supabase.
```mermaid
graph LR
  subgraph Vercel
    A[apps/admin :3000]
    S[apps/super-admin :3001]
  end
  subgraph Cloudflare
    F[apps/storefront — per client]
  end
  subgraph "Supabase (managed)"
    DB[(Postgres + RLS)]
    AU[Auth]
    ST[Storage]
  end
  A --> DB
  S --> DB
  F --> DB
  DB --- AU
  A --- ST
```

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
