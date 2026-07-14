# TokoΦ — UML

> **Rewritten 2026-07-14 from the code and the live database.** The previous version described 55
> tables, migrations `0000–0018`, three surfaces, and drew the admin and storefront as *not yet* on
> Postgres. All four were false.
>
> **Every diagram in this file has been rendered with `@mermaid-js/mermaid-cli` v11.16.0.** A diagram
> that does not render is worse than no diagram: it looks like documentation and communicates nothing.
> A previous pass shipped four broken ones — a `;` inside `sequenceDiagram` message text terminates the
> statement, so the message silently becomes a syntax error.
>
> Companions: [`SYSTEM_MAP.md`](./SYSTEM_MAP.md) (routes → tables) · [`FLOWS.md`](./FLOWS.md)
> (sequence diagrams for the seven critical flows) · [`SCHEMA.md`](./SCHEMA.md) (the catalog) ·
> [`REQUIREMENTS.md`](./REQUIREMENTS.md) (what must be true).

---

## 1. Domain model — ER / class diagram

The load-bearing entities only. Money is `bigint` IDR throughout. 68 tables exist; the rest hang
off these.

```mermaid
erDiagram
    accounts ||--o{ stores : owns
    stores ||--o{ store_users : "has members"
    users ||--o{ store_users : "belongs to"
    stores ||--|| store_settings : "1:1 config"
    stores ||--o{ locations : "stock sites"
    stores ||--o{ invoices : "subscription billing"

    stores ||--o{ products : ""
    products ||--o{ product_variants : ""
    products ||--o{ product_media : ""
    product_variants ||--o{ inventory_levels : "available qty"
    locations ||--o{ inventory_levels : ""
    stores ||--o{ collections : ""
    collections ||--o{ collection_products : ""

    stores ||--o{ customers : ""
    customers ||--o{ orders : places
    stores ||--o{ orders : ""
    orders ||--o{ order_line_items : ""
    product_variants ||--o{ order_line_items : "variant_id nullable"

    stores ||--o{ checkout_sessions : "abandoned checkout"
    customers ||--o{ checkout_sessions : "customer_id, set when it becomes an order"
    checkout_sessions ||--o| orders : "recovered_order_id"
    stores ||--o{ followups : "WhatsApp worklist"

    orders ||--o{ payments : "1..n"
    payments ||--o| ledger_entries : "kind=sale, 1 per payment"
    orders ||--o{ ledger_entries : "kind=sale or retur"
    payouts ||--o{ ledger_entries : "kind=payout or adjustment"
    stores ||--o{ ledger_entries : ""
    stores ||--o{ payouts : "withdrawal requests"

    stores ||--o{ analytics_events : "5 event types"
    stores ||--o{ page_templates : "store builder"
    stores ||--o{ support_tickets : "merchant to platform"
    stores ||--o{ conversations : "shopper to merchant"

    orders {
        uuid id PK
        uuid store_id FK "tenant key, RLS"
        uuid customer_id FK
        text number "WEB-xxxxxxxxx"
        enum status "baru diproses dikirim selesai batal retur"
        enum financial_status "pending dibayar refund_sebagian refund"
        bigint subtotal_idr
        bigint shipping_idr
        bigint total_idr
        text city "buyer-typed, do NOT trust"
        text province "buyer-typed, do NOT trust"
        text courier "NULL on 699 of 700 rows"
        text awb "real waybill only, never our order id"
        text ka_order_id "KiriminAja booking ref"
        int ship_district_id "0042 the verified destination - PRICES the parcel"
        int ship_kelurahan_id "0049 KiriminAja village id - BOOKS the parcel"
        text ship_kelurahan_name "0049"
        text ship_postcode "0042"
        text ship_address "0042 snapshot, not a lookup"
        timestamptz returned_at "0039"
    }

    payments {
        uuid id PK
        uuid order_id FK
        uuid store_id FK "NOT NULL since 0036"
        enum method "transfer qris ovo gopay dana va cod"
        enum status "menunggu berhasil gagal"
        bigint amount_idr "what the MERCHANT is owed"
        bigint admin_fee "the gateway cut"
        bigint total "amount_idr plus admin_fee"
        text provider "autolaris or cod"
    }

    ledger_entries {
        uuid id PK
        uuid store_id FK
        uuid order_id FK
        uuid payment_id FK "0041"
        uuid payout_id FK
        enum kind "sale retur payout adjustment"
        enum status "pending available"
        bigint amount_idr "SIGNED, negative is money out"
        timestamptz available_at
    }

    payouts {
        uuid id PK
        uuid store_id FK
        bigint amount_idr
        enum status "menunggu diproses selesai gagal"
        text bank_name "SNAPSHOT at request time"
        text note "rejection reason"
    }

    customers {
        uuid id PK
        uuid store_id FK
        text phone "THE identity here, not the email"
        timestamptz registered_at "0044 - NULL means GUEST, the normal case"
        text password_hash "0044 - provisioned, NO reader yet"
        timestamptz last_order_at "0044 - backfilled from orders"
    }

    checkout_sessions {
        uuid id PK
        uuid store_id FK "tenant key, RLS, ALWAYS from the Host header"
        text session_id "same id the funnel beacons carry"
        uuid customer_id FK "set when it becomes an order"
        text phone "the field this table is paid for"
        jsonb items "snapshot - handle name variant qty price"
        bigint subtotal_idr
        enum step "keranjang kontak alamat pengiriman pembayaran - forward only"
        enum status "aktif ditinggal pulih kedaluwarsa"
        timestamptz abandoned_at "0045 - when it went QUIET"
        uuid recovered_order_id FK
        timestamptz recovered_at
        timestamptz updated_at "the last time anyone touched it"
    }
```

**The three relationships that carry the most weight:**

1. `payments.amount_idr` → `ledger_entries.amount_idr`. The ledger credits what the *merchant* is
   owed, never `payments.total` — the gateway's admin fee is the gateway's money and never was the
   merchant's. This single choice is why Dashboard revenue, the Pesanan list and Saldo agree **by
   construction** rather than by coincidence.
2. `orders.ship_district_id` (0042) is the **verified** destination. `orders.province` is what the
   buyer typed. Money decisions read the former. See §5.
2b. `orders.ship_kelurahan_id` (0049) is **KiriminAja's own village id**, verified to belong to
   `ship_district_id` before it is stored. **Kecamatan PRICES the parcel; kelurahan BOOKS it** —
   `shipping_price` ignores village ids, `request_pickup` needs one. The shipment is booked from this
   snapshot, never re-resolved from the free-text city name (which once shipped Surabaya → Lampung).
3. `checkout_sessions.recovered_order_id` → `orders` (0044) is what makes "recovered" a **join** rather
   than a vibe: *this* session became *that* order. Paired with `abandoned_at` (0045) it is also the
   only way to tell a **rescue** from an ordinary sale. See §9.

---

## 2. Component diagram — four surfaces, five packages, one database

```mermaid
graph TB
    subgraph clients["Actors"]
        SH["Shopper"]
        ME["Merchant"]
        OP["Platform operator - us"]
    end

    subgraph apps["Deployable surfaces"]
        LAND["landing - Astro static<br/>tokophi.com<br/>NO DB dependency"]
        SF["storefront - Astro SSR<br/>slug.tokophi.com<br/>tenant = Host header"]
        ADM["admin - Next.js RSC<br/>app.tokophi.com<br/>plus ALL public API routes"]
        SA["super-admin - Next.js RSC<br/>rich.tokophi.com<br/>cross-tenant"]
    end

    subgraph pkgs["Shared packages"]
        DBP["@tokophi/db<br/>Drizzle schema plus withTenant"]
        LIB["@tokophi/lib<br/>format billing autolaris<br/>kiriminaja cache totp"]
        UIP["@tokophi/ui<br/>shadcn on Base UI"]
        SEC["@tokophi/sections<br/>TYPES ONLY - the builder contract"]
        DAT["@tokophi/data<br/>canonical nav"]
    end

    subgraph ext["Third parties"]
        AL["AutoLaris - PSP<br/>VA QRIS e-wallet"]
        KA["KiriminAja<br/>courier aggregator"]
    end

    PG[("PostgreSQL 16<br/>68 tables - 50 migrations<br/>RLS on 43 of 44 store-scoped")]
    DISK[/"public/uploads<br/>local media"/]

    SH --> SF
    SH --> LAND
    ME --> ADM
    ME --> LAND
    OP --> SA

    SF -->|"POST /api/public/ongkir<br/>POST /api/public/order"| ADM
    SF -->|"img src"| ADM
    SA -->|"signed 2-min JWT to /impersonate"| ADM

    ADM --> DBP
    SA --> DBP
    SF --> DBP
    ADM --> LIB
    SA --> LIB
    SF --> LIB
    ADM --> UIP
    SA --> UIP
    ADM --> SEC
    SF --> SEC
    ADM --> DAT
    SF --> DAT

    DBP --> PG
    ADM --> DISK

    ADM -->|"alCreatePayment"| AL
    AL -->|"POST /api/public/pay/callback<br/>shared secret - fails CLOSED"| ADM
    ADM -->|"kaShippingPrice / kaCreateOrder"| KA
    SA -->|"kaServices roster sync"| KA
```

**Three facts in this diagram that surprise people:**

- **The admin hosts the entire public HTTP API.** `/api/public/*`, `/api/cron/*`, `/api/uploads/*` all
  live in `apps/admin`. The storefront reaches them over HTTP, like any third party would.
- **`landing` has no `@tokophi/db` dependency and no `DATABASE_URL`.** That is the feature: the front
  door must serve when everything behind it is down.
- **`@tokophi/sections` is types-only, zero runtime.** It is the one contract shared by the admin's
  Puck editor and the storefront's Astro renderer — the thing that stops the two from drifting.

**There are only four cross-surface edges.** Everything else goes through the database. No service
mesh, no internal RPC, no queue.

| Edge | Mechanism |
|---|---|
| storefront → admin | `fetch` to `PUBLIC_ONGKIR_API` / `PUBLIC_ORDER_API` |
| storefront → admin (images) | `ADMIN_BASE` derived from `new URL(PUBLIC_ONGKIR_API).origin` — **a load-bearing coupling**: change the ongkir URL and product images silently move |
| super-admin → admin | 2-minute JWT → `/impersonate` → a real `session` cookie (cookies do not cross subdomains) |
| AutoLaris → admin | webhook `POST /api/public/pay/callback` |

---

## 3. Order lifecycle — state machine

`baru → diproses → dikirim → selesai | batal | retur`. Enum `order_status`; migration **0039** added
`retur`.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> baru : checkout writes the order<br/>INVENTORY IS DECREMENTED HERE

    baru --> diproses : merchant confirms
    baru --> batal : cancel
    diproses --> dikirim : shipment booked via kaCreateOrder
    diproses --> batal : cancel
    dikirim --> selesai : delivered
    dikirim --> retur : parcel refused or sent back
    selesai --> retur : returned after completion

    batal --> [*]
    selesai --> [*]
    retur --> [*]

    note right of baru
        Stock leaves at CHECKOUT, not at despatch.
        An order that exists has already taken the stock.
    end note

    note right of selesai
        THE RELEASE POINT. A sale becomes withdrawable
        here and NOT at dikirim. A parcel can only be
        returned after it shipped, so releasing at
        despatch would let a merchant withdraw money for
        goods that come back. On COD the cash does not
        even exist yet at despatch.
    end note
```

### 3.1 What every transition does to inventory and to the ledger

This is the table to read before touching `setOrderStatus`. Source: `apps/admin/lib/actions/orders.ts`
+ `apps/admin/lib/ledger-credit.ts#settleOrderLedger`, both inside **one transaction**, so the book can
never disagree with the order it describes.

| Transition | `inventory_levels` | `payments` | `ledger_entries` |
|---|---|---|---|
| *(checkout)* → `baru` | **− qty** per line (`GREATEST(available − qty, 0)`) | insert `menunggu` (COD) **or** an AutoLaris bill | — |
| `baru → diproses` | — | — | — |
| `diproses → dikirim` | — | — | — |
| **`* → selesai`** | — | COD: `menunggu → berhasil` (`collectCodOnDelivery`) — the honest moment the cash exists | **`sale` booked** if absent (`creditSalesForOrder`), then every `pending` sale on the order → **`available`** |
| **`* → batal`** | **+ qty** restored | any `menunggu` → **`gagal`** | — (a cancelled order is never credited: `creditSaleForPayment` excludes `o.status='batal'`) |
| **`* → retur`** | **+ qty** restored | any `menunggu` → **`gagal`** | **opposing entry** `kind='retur'`, `amount = −sale.amount`, **carrying the same `status` as the sale it reverses** |
| *(gateway callback)* | — | `menunggu → berhasil` | **`sale` booked**: `pending` normally, `available` if the order is already `selesai`/`retur` |

**Four subtleties, each of which was once a bug:**

1. **`retur` restores inventory, exactly like `batal`.** The goods are back on the merchant's shelf in
   both cases. Missing this would have quietly shrunk real stock on every refused COD parcel.
2. **Both restores are guarded on the previous status** (`order.status !== status`), so a repeat click
   cannot double-restore.
3. **The claw-back carries the sale's status.** A parcel can be returned straight from `dikirim`, where
   the sale is still `pending`. Reversing that out of `available` (as the code originally did,
   unconditionally) drives the withdrawable balance **negative** while the held pool still shows the
   money. Reverse a pending sale out of pending, a released one out of available; either way the pair
   nets to zero.
4. **Cancelling fails the pending payment.** For a refused COD parcel this is the whole point: cash
   that was never collected must never become collectable later.

---

## 4. Money — the ledger state machine

`platform_payout.release_on` (default `'selesai'`) decides the release point, and it **is** read
(`settleOrderLedger`). Until `0776e99` it was hardcoded to `selesai` while the super-admin toggle saved
a value that changed nothing — a knob that moves nothing is worse than no knob.

```mermaid
stateDiagram-v2
    direction LR
    state "money collected" as collected
    state "sale / pending" as pending
    state "sale / available" as available
    state "payout entry - NEGATIVE" as payoutEntry
    state "adjustment entry - POSITIVE" as adjustment

    [*] --> collected : payments.status reaches berhasil<br/>gateway callback OR COD cash at the door
    collected --> pending : creditSaleForPayment<br/>credits amount_idr, never total
    pending --> available : order reaches release_on, default selesai
    pending --> [*] : retur posts an opposing PENDING entry
    available --> [*] : retur posts an opposing AVAILABLE entry

    available --> payoutEntry : requestPayout<br/>advisory lock, OWNER only
    payoutEntry --> adjustment : super-admin REJECTS the payout
    payoutEntry --> [*] : super-admin marks it PAID<br/>no ledger write, already debited

    note right of available
        saldo tersedia = SUM amount_idr WHERE status = available
        dana dalam proses = SUM amount_idr WHERE status = pending
        The balance is DERIVED. It is never stored.
    end note
```

| Invariant | Enforced by |
|---|---|
| The book is **append-only** — nothing is ever edited in place | convention + review. A reversal is always a **new opposing entry** |
| A retried gateway callback cannot credit twice | `ledger_one_sale_per_payment` (partial unique index) |
| A double-clicked "Retur" cannot double-refund | `ledger_one_retur_per_order` (partial unique index) |
| Two concurrent withdrawals cannot both pass the balance check | `pg_advisory_xact_lock(hashtext(store_id))` inside the txn |
| A rejected payout restores **exactly** what left | the adjustment is computed from `Σ ledger_entries WHERE payout_id = ?`, **not** from `payouts.amount_idr` |
| Only a store **owner** can withdraw | `requestPayout` requires `settings:write`, which only `owner` holds |
| Marking a payout PAID writes **no** ledger entry | the merchant was already debited at request time. Re-crediting would double-count |

> **Why an advisory lock and not `FOR UPDATE`?** It *was* `FOR UPDATE`, originally — and
> `select sum(amount_idr) … for update` is rejected outright by Postgres ("FOR UPDATE is not allowed
> with aggregate functions"). **Every withdrawal threw.** The guard against losing money was itself the
> thing that broke the feature, and `tsc` cannot see inside a SQL string. Money paths must be
> *exercised*, not typechecked. The advisory lock is also O(1) in ledger size, where row-locking an
> ever-growing table is not.

---

## 5. COD — the five-condition gate

`apps/admin/lib/cod.ts#getCodPolicy` is the single place that answers "may this be paid on delivery?".
All five conditions must agree, and they are checked **server-side in `/api/public/order` before any
row is written**. Hiding the option at checkout is UX; *this* is the boundary. A script POSTing
`channelCode:"cod"` straight at the API gets a 403 and zero rows — never a silently-downgraded order
that hides a COD request as a "transfer".

```mermaid
flowchart TD
    REQ["POST /api/public/order<br/>channelCode = cod"] --> C1{"platform_cod.enabled"}
    C1 -- no --> DENY["403 cod_not_allowed<br/>ZERO rows written"]
    C1 -- yes --> C2{"store_settings.cod_enabled<br/>default FALSE"}
    C2 -- no --> DENY
    C2 -- yes --> C3{"total is within<br/>platform_cod.max_amount_idr<br/>0 means no cap"}
    C3 -- no --> DENY
    C3 -- yes --> RES["provinceForDistrict ship_district_id<br/>via kiriminaja_areas"]
    RES --> VER{"district resolvable"}
    VER -- no --> DENY
    VER -- yes --> C4{"province is in<br/>platform_cod.allowed_provinces<br/>empty means anywhere"}
    C4 -- no --> DENY
    C4 -- yes --> C5{"service.cod AND service.codAllowed<br/>AND the courier row is enabled"}
    C5 -- no --> DENY
    C5 -- yes --> OK["order written<br/>payments row method=cod status=menunggu"]
```

**Condition 4 does not read `address.provinsi`.** The buyer types that by hand and a hostile client can
simply lie — "DKI Jakarta", then ship to Papua. The province is resolved from the **KiriminAja district
id the ongkir quote was issued for**, which is what the parcel is actually booked against. If COD is
requested and the district cannot be verified, the request is **refused**. An unverifiable destination
is exactly the case `allowed_provinces` exists to stop, and this is money — "probably fine" is not good
enough.

**Why COD is narrow today (SPX Standard + SPX Economy only).** *Not* because KiriminAja restricts it —
it reports `cod = true` on **14 services across 10 couriers**. The asymmetry that costs money is
**RETURNS**: a refused COD parcel is claimed to ship back free on SPX and to be billed to the merchant
elsewhere. **That claim is UNVERIFIED** — free returns are a *Shopee Seller Center* benefit and we
reach SPX through *KiriminAja*, a different contract with no return field in its API at all. The
narrowing is therefore a per-service boolean an operator can flip
(`platform_couriers.services[].codAllowed`), **not `if (courier === "spx")` welded into the code**.
Widening is a tick box, not a deploy. See [`BACKLOG.md`](./BACKLOG.md).

---

## 6. Deployment

One VPS, Docker Compose behind Traefik, Cloudflare in front. There is no Kubernetes, no queue, no
pub/sub — and the chat transport (short polling, not SSE) was chosen *because* of this box, not in
spite of it.

```mermaid
graph TB
    subgraph edge["Cloudflare"]
        CF["DNS plus TLS plus CDN<br/>www 301 to apex"]
    end

    subgraph vps["VPS - single host, Docker Compose plus Traefik"]
        TR["Traefik<br/>routes by Host"]
        C1["landing<br/>Astro static"]
        C2["storefront<br/>Astro SSR - node standalone"]
        C3["admin<br/>Next.js standalone"]
        C4["super-admin<br/>Next.js standalone"]
        C5[("postgres 16<br/>persisted volume")]
        VOL[/"uploads volume"/]
    end

    subgraph third["Third parties"]
        AL2["AutoLaris"]
        KA2["KiriminAja"]
    end

    CF --> TR
    TR -->|"tokophi.com"| C1
    TR -->|"slug.tokophi.com"| C2
    TR -->|"app.tokophi.com"| C3
    TR -->|"rich.tokophi.com"| C4

    C2 --> C5
    C3 --> C5
    C4 --> C5
    C3 --> VOL
    C2 -.->|"HTTP - ongkir, order, images"| C3

    C3 --> AL2
    C3 --> KA2
    C4 --> KA2
    AL2 -.->|"webhook"| C3
```

| Surface | Host | Indexable | DB access |
|---|---|:--:|---|
| `landing` | `tokophi.com` / `www.` → 301 | **yes** | **none** |
| `storefront` | `<slug>.tokophi.com`, `toko.` | **yes** | read-only, owner conn |
| `admin` | `app.tokophi.com` | **no** — `noindex, nofollow` in 3 layers | `withTenant` (RLS) |
| `super-admin` | `rich.tokophi.com` | **no** — `noindex, nofollow` in 3 layers | owner conn (cross-tenant) |

The three noindex layers per panel are `next.config.ts headers()` (covers `/api/*`, static assets,
non-HTML) + the same header re-stamped in `middleware.ts` (a redirect short-circuits before
`headers()` runs) + `metadata.robots` and `app/robots.ts`. All three are needed; the first alone was
not enough, which is how both panels ended up crawlable after the domain cutover.

**`/api/uploads/*` is deliberately carved OUT** (`X-Robots-Tag: all`). Merchant product photos are
served from the admin origin but embedded in public storefronts — a blanket noindex would have removed
every merchant's product photography from Google Images.

`astro build` for the storefront is **DB-free** (verified with `DATABASE_URL` unset). That is what
preserves the zero-downtime deploy: the image builds even when the database is unreachable.

---

## 7. Identity and access

Three **non-overlapping** identities. A merchant login never grants control-plane access, and the
shopper has no identity at all.

```mermaid
graph LR
    subgraph ids["Three identities - no overlap"]
        M["Merchant<br/>cookie: session<br/>tables: users plus store_users"]
        P["Platform operator<br/>cookie: platform_session<br/>table: platform_admins"]
        S["Shopper<br/>NO identity<br/>chat visitors get tokophi_chat"]
    end

    M --> RBAC["requireCapability cap<br/>lib/rbac.ts - THE boundary"]
    RBAC --> TEN["withTenant storeId<br/>SET app.store_id<br/>SET LOCAL ROLE tokophi_app"]
    TEN --> PGA[("Postgres<br/>RLS ENFORCED")]

    P --> PROLE["requirePlatformAdmin min<br/>rank support 1, admin 2, owner 3"]
    PROLE --> OWNER[("Postgres owner conn<br/>RLS BYPASSED by design<br/>cross-tenant")]

    S --> PUB["/api/public/*<br/>owner conn plus explicit store_id"]
    PUB --> OWNER
```

### 7.1 Merchant RBAC (`store_users.role`)

`lib/rbac-policy.ts` is the client-safe matrix; `lib/rbac.ts#requireCapability` is the server guard and
**the** security boundary — it is the first statement of every mutating server action, and it throws.
The UI gating (`useCan` / `<Can>`) is convenience only and secures nothing.

| Role | Capabilities |
|---|---|
| `owner` | all |
| `admin` | all **except `settings:write`** |
| `staff` | `products:write`, `discounts:write`, `content:write`, `orders:write`, `customers:write`, `crm:write`, `media:write`, `support:write` |
| `gudang` | `inventory:write`, `purchases:write`, `support:write` |

Two consequences worth naming out loud:

- **`requestPayout` requires `settings:write` → only an `owner` can withdraw money.** Correct, and not
  obvious from the capability name.
- `requireCapability` **also** blocks writes when the subscription is past its grace period
  (`getBilling().readOnly` → `SuspendedError`). `support:write` opts out via `allowSuspended` — a
  suspended store must still be able to contact us about the billing problem that suspended it.

### 7.2 Platform roles (`platform_admins.role`)

Ranked, not a matrix: `requirePlatformAdmin(min)` compares `RANK[session.role] >= RANK[min]`
(`support` 1 < `admin` 2 < `owner` 3). Added in `0776e99` — before that the role was carried in the JWT
and **never read**, so a `support` operator could reject payouts, reset passwords and impersonate.

| Guard | Actions |
|---|---|
| `owner` | `impersonateStore`, `resetOwnerPassword` |
| `admin` (default) | everything else — 28 call sites, including every payout and COD-policy action |
| `support` | **zero call sites** — the role exists and can do nothing, not even the ticket queue its own doc comment says it is for |

⚠️ **Known escalation, tracked in [`BACKLOG.md`](./BACKLOG.md):** `invitePlatformAdmin` is
`admin`-gated, takes `role` **unvalidated**, and is **not audit-logged** — so an `admin` operator can
mint themselves an `owner` and thereby reach the two `owner`-only actions. Enforcement is at the
**action** layer only: the middleware and page guards check for *a* session, not for a role, so a
lower-privileged operator sees every screen and the buttons throw on click.

---

## 8. Store Builder — why the editor and the renderer cannot drift

```mermaid
graph LR
    SECT["@tokophi/sections<br/>SECTION_TYPES<br/>SECTION_DEFAULTS<br/>StoredTemplateData<br/>heroSlides<br/>TYPES ONLY - zero runtime"]

    PUCK["apps/admin<br/>lib/theme/puck-config.tsx<br/>Puck drag-drop editor"]
    PREV["apps/admin<br/>components/theme/sections<br/>React preview"]
    REND["apps/storefront<br/>components/sections<br/>Astro SectionRenderer"]

    PT[("page_templates<br/>type: homepage category product<br/>sections: jsonb")]

    SECT --> PUCK
    SECT --> PREV
    SECT --> REND
    PUCK -->|"writes"| PT
    PT -->|"reads at SSR"| REND
```

The admin writes `page_templates.sections`; the storefront reads it at SSR. Both sides import their
shape from `@tokophi/sections`, so a section added on one side and not the other is a **type error**,
not a silently blank slot on a live shop.

The hero carousel (`8fad2f9` → `5016bb3`) is the worked example of what happens when you skip that: it
shipped first as a **fork** of the shared config inside the admin, which meant the storefront could not
render what the merchant built. It was folded back into the shared registry (`heroSlides()`,
`HERO_INTERVAL_MS`) and the fork deleted.

---

## 9. Abandoned checkout — a state machine with no event to listen for

`checkout_sessions` (migration **0044**, `abandoned_at` in **0045**). Every other state machine in this
document is driven by something that *happens*. This one is not: **abandonment is the ABSENCE of an
order.** Nothing fires. So the row is written **as the shopper types** — debounced beacons from
`checkout.astro` into `apps/storefront/src/pages/api/checkout-session.ts`, the table's only writer from
the shop — and it is judged later by what never happened to it.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> aktif : first beacon<br/>UPSERT on store_id + session_id<br/>store_id from the HOST HEADER, never the body

    aktif --> aktif : more beacons<br/>step moves FORWARD only<br/>sendBeacon has no ordering guarantee
    aktif --> ditinggal : 60 min of silence<br/>opportunistic sweep in the SAME endpoint<br/>abandoned_at = coalesce(updated_at, created_at)
    aktif --> pulih : POST /api/public/order<br/>STRAIGHT THROUGH - abandoned_at stays NULL

    ditinggal --> aktif : the shopper comes back and types again
    ditinggal --> pulih : the order finally happens<br/>RESCUED - abandoned_at AND recovered_at are both set

    pulih --> [*] : settled history<br/>a late beacon can NEVER resurrect this row

    note right of ditinggal
        There is no cron. The sweep runs at most once a
        minute per SSR process, on the store being written
        to, riding the store_id + status + updated_at index.
        abandoned_at is stamped as the moment it went QUIET,
        not as "now" - updated_at IS that moment.
    end note

    note right of pulih
        pagehide fires on the redirect to /checkout/sukses,
        so a stray beacon arrives AFTER the order. The upsert
        carries setWhere status <> 'pulih' - otherwise that
        beacon would flip a real sale back to aktif and
        un-recover it.
    end note
```

### 9.1 Why `abandoned_at` exists — the metric would otherwise be a lie

A checkout that **sailed straight through** also ends as `status='pulih'`. Without a column saying
*this one first went quiet*, the two are indistinguishable, and the obvious formula counts every
ordinary sale as a rescue.

| Quantity | Definition | Local data (30 d, `CHECKOUT_TODAY=2026-07-02`) |
|---|---|---|
| abandoned | `status = 'ditinggal'` | **792** |
| orders | `orders` placed in the window (a completed checkout — **including one later cancelled**; the checkout still finished) | **198** |
| **rescued** | `abandoned_at IS NOT NULL AND recovered_at IS NOT NULL` | **100** |
| straight-through | `abandoned_at IS NULL AND recovered_at IS NOT NULL` — an **ordinary sale**, not a save | **90** |
| `abandonRate` | `ditinggal / (ditinggal + orders)` | **80,0%** |
| `recoveryRate` | `rescued / (rescued + ditinggal)` | **11,2%** |

The naive `pulih / (pulih + ditinggal)` would report **19,3%** on exactly this data — it would tell a
shop it "rescued" every ordinary sale it has ever made. **A number that looks real and is wrong is
worse than no number.** `aktif` sessions are excluded from **both** sides of both ratios: the shopper
is still typing and nobody has abandoned anything yet.

**Context, not our measurement:** Indonesia abandons **82–83%** of carts against a ~70% global figure,
and recovery here travels on **WhatsApp**, not email — which is why `phone` is the column this table is
paid for, and why the merchant's action is a `wa.me` deep link.

### 9.2 The recovery link is signed, and that is not decoration

The merchant's WhatsApp message links back into the checkout, and clicking it restores the basket
**plus everything the shopper had typed** — name, phone, address. So the link **cannot** be
`/checkout?sid=<session id>`: session ids are generated in the browser and echoed in every tracking
beacon, and a raw id in a URL is a **bearer credential over a stranger's personal data** the moment the
link is forwarded, screenshotted, or leaks through a `Referer` header. Guessing is not even the main
risk — leakage is.

`apps/storefront/src/lib/recovery.ts` therefore mints an **HS256 JWT `{sid, st}`** (jose), keyed on
`CHECKOUT_RECOVERY_SECRET ?? AUTH_SECRET`:

| Property | Consequence |
|---|---|
| unforgeable | no secret, no token — guessing session ids buys nothing |
| **store-bound** (`st`) | a token minted for store A is rejected on store B's host, so one shared secret across tenants is still safe |
| self-expiring (7 days) | a forwarded link goes dead on its own; a raw id never would |
| stateless | no token column in 0044, and none is needed — the token is derived from the row |

A bad, expired, or other-tenant token renders the **ordinary empty checkout**, never an error. A
session already `pulih` is never re-hydrated: it was already bought, and re-hydrating it would push the
shopper to buy it twice.

---

## Validation

All 9 diagrams above — 1 `erDiagram`, 3 `stateDiagram-v2`, 1 `flowchart`, 4 `graph` — were rendered to
SVG with `@mermaid-js/mermaid-cli` **v11.16.0** on **2026-07-14**. Re-validate after editing:

```bash
printf '{"executablePath":"/usr/bin/google-chrome","args":["--no-sandbox"]}' > /tmp/pp.json
npx @mermaid-js/mermaid-cli -i specs/docs/UML.md -o /tmp/uml-check.md -p /tmp/pp.json
```

**The failure mode to watch for:** a `;` inside `sequenceDiagram` message text terminates the
statement. Write "then", or an em dash — never a semicolon.
