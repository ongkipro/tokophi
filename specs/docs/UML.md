# Indostore — Diagrams (UML / Mermaid)

> Renders on GitHub / any Mermaid viewer. Kept text-based so it lives with the code.
> Companion to `../PRD.md`, `SCHEMA.md`, `CONCEPT.md`. Updated 2026-07-02.

## 1. System context & components (C4-ish)
```mermaid
graph TB
  Shopper([Pembeli]):::user
  Merchant([Merchant / pemilik toko]):::user
  PlatformAdmin([Platform admin — kita]):::user

  subgraph Monorepo["Monorepo (npm workspaces)"]
    SuperAdmin["apps/super-admin<br/>platform control plane (Next.js)"]
    Admin["apps/admin<br/>merchant admin (Next.js)"]
    Storefront["apps/storefront<br/>per-client shop (Astro) — M2"]
    UI["packages/ui<br/>shared shadcn/Base UI + tokens"]
    Lib["packages/lib<br/>shared formatters/types"]
  end

  subgraph Backend["Backend — M3 (Supabase, managed)"]
    Auth["Auth"]
    DB[("Postgres + RLS by store_id")]
    Storage["Storage (media)"]
  end

  subgraph Integrations["Platform integrations (set up by us)"]
    PG["Payment gateways<br/>Midtrans / Xendit / Duitku + COD"]
    AGG["Shipping aggregator<br/>Biteship (all couriers)"]
  end

  Shopper --> Storefront
  Merchant --> Admin
  PlatformAdmin --> SuperAdmin
  Admin --> UI
  Admin --> Lib
  SuperAdmin --> UI
  SuperAdmin --> Lib
  Storefront --> UI
  Admin --> DB
  SuperAdmin --> DB
  Storefront --> DB
  DB --- Auth
  Admin --- Storage
  SuperAdmin -. configures .-> PG
  SuperAdmin -. configures .-> AGG
  Storefront --> PG
  Storefront --> AGG

  classDef user fill:#eef,stroke:#88a;
```

## 2. Data model (ER — key entities)
```mermaid
erDiagram
  accounts ||--o{ stores : owns
  accounts ||--o{ subscriptions : has
  plans ||--o{ subscriptions : on
  subscriptions ||--o{ invoices : bills
  stores ||--o{ store_users : members
  stores ||--o{ products : sells
  products ||--o{ product_variants : has
  products ||--o{ product_media : has
  stores ||--o{ collections : groups
  collections ||--o{ collection_products : contains
  stores ||--o{ orders : receives
  orders ||--o{ order_line_items : has
  order_line_items }o--|| product_variants : of
  stores ||--o{ customers : has
  customers ||--o{ orders : places
  stores ||--o{ leads : crm
  stores ||--o{ followups : crm
  stores ||--o{ discounts : offers
  stores ||--o{ pages : content
  stores ||--o{ menus : content

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
  customers {
    uuid id PK
    uuid store_id FK
    string name
    enum segment
    int total_spent_idr
  }
```
> Payments/shipping/COD config is **platform-level** (see `SCHEMA.md`): `shipping_aggregator`, `platform_couriers`, `platform_payment_gateways`, `platform_cod`; per-store keeps only `enabled` flags.

## 3. Checkout + payment + shipping (platform-managed)
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

## 4. Deployment
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

## 5. User roles (who touches what)
```mermaid
graph LR
  Platform["Platform admin (us)"] --> SA["super-admin: toko, paket, billing,<br/>gateway/kurir/COD config"]
  Owner["Store owner"] --> AD["admin: produk, pesanan, CRM,<br/>aktifkan metode/kurir"]
  Staff["Staf / gudang"] --> AD2["admin: pesanan, stok (peran terbatas)"]
  Buyer["Pembeli"] --> SF2["storefront: belanja, checkout"]
```
*Living doc — update diagrams when the architecture moves.*
