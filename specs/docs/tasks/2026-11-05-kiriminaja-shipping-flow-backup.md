# KiriminAja shipping flow — backup map for a provider replacement (2026-11-05)

> **Purpose.** A code-traced snapshot of how TokoΦ ships today through KiriminAja (the platform-managed
> courier aggregator, ADR 0004), written so the integration can be replaced or put behind a second
> provider without losing a rule that is currently enforced only by the shape of the code.
> Read-only audit: no code, data, or configuration was changed to produce it.
>
> **Scope of evidence.** Every claim cites `file:line` on branch `feat/storefront-redesign`
> (worktree `tokophi-storefront-redesign`, read 2026-11-05). Where a doc and the code disagree, the
> code is recorded as the truth and the drift is listed in §10. Anything not provable from the
> repository is marked **UNVERIFIED**.
>
> ⚠️ `specs/docs/rules/shipping-cod.md` does not exist on this branch (the AGENTS.md split landed on
> `docs/split-agents-md`); the same rules were read from this branch's `AGENTS.md` §"Shipping & COD"
> (`AGENTS.md:639-731`) and §"Order lifecycle" (`AGENTS.md:1019-1120`).

---

## 1. One-paragraph summary

The storefront never talks to KiriminAja. It calls two **public, unauthenticated** routes on the
Seller app (`app.tokophi.com`): `/api/public/ongkir` (area search, kelurahan list, live rates) and
`/api/public/order` (which **re-quotes** server-side and stores our price). Every rate comes from one
function, `quoteShipping` (`apps/admin/lib/shipping-quote.ts:120`), which prices from the **seller's**
pickup district, the **seller's** catalogue weights and a `stackedDims` box, filters by
platform-enabled couriers ∩ the seller's per-service picks, and stamps an **effective** COD flag from
`cod-policy.ts`. No shipment is booked at checkout. The seller books later from the Seller app
(`createShipment`, single order with a rate picker, or `bulkGenerateResi`, which books the service the
shopper paid for). A booking returns no waybill; the `cron-tracking` sidecar polls every 15 min and
fills `orders.awb`, `orders.sorting_code`, and moves `orders.status` forward through
`applyOrderStatusChange`. A bearer-authenticated webhook only *hints* (it triggers a verified tracking
pull). Cancel goes by AWB only. Keys live encrypted in `shipping_aggregator`, editable from Super Admin,
with env-var fallback.

---

## 2. Sequence diagrams

### 2.1 Quote (checkout)

```mermaid
sequenceDiagram
    autonumber
    actor S as Shopper
    participant CO as storefront checkout.astro
    participant ONG as POST /api/public/ongkir
    participant AR as lib/data/areas.ts
    participant Q as lib/shipping-quote.ts quoteShipping
    participant DB as PostgreSQL
    participant KA as KiriminAja

    S->>CO: types kecamatan
    CO->>ONG: {op:"search", q}
    ONG->>AR: resolveArea(q)
    AR->>DB: kiriminaja_areas ILIKE, ranked (city > district)
    alt no local hit
        AR->>KA: POST /api/mitra/v2/get_address_by_name
    end
    ONG-->>CO: [{id (KA district id), text, district, city, province}]
    CO->>ONG: {op:"kelurahan", destinationId}
    ONG->>DB: kelurahan WHERE district_id (name, postcode only; no vendor id)
    ONG-->>CO: kelurahan list -> kodepos auto-fill
    CO->>ONG: {op:"rates", storeSlug, destinationId, items[handle,variant,qty], itemValue}
    Note over CO,ONG: first call = FAST_COURIERS spx,jne; second call all:true prefetched
    ONG->>Q: quoteShipping(storeId, destinationId, items, couriers?)
    Q->>DB: platform_couriers (enabled), store_settings.sender_kecamatan_id, store_shipping_methods
    Q->>DB: weightForCart (variant weight_grams, products l/w/h)
    Q->>KA: POST /api/mitra/v6.1/shipping_price (10-min cache, key incl. dims + env/key fingerprint)
    KA-->>Q: results[] {service, service_type, cost, etd, cod, group, ...}
    Q->>DB: getCodPolicy (platform_cod, store cod_enabled, platform_couriers.services[].codAllowed)
    Q-->>ONG: rates filtered platform ∩ store, cod = KA.cod AND policy.allows
    ONG-->>CO: rates (provider error text replaced by SHIPPING_QUOTE_UNAVAILABLE)
```

### 2.2 Order (re-quote, store our price)

```mermaid
sequenceDiagram
    autonumber
    participant CO as checkout.astro
    participant ORD as POST /api/public/order
    participant AR as lib/data/areas.ts
    participant Q as quoteShipping
    participant COD as cod.ts / cod-policy.ts
    participant DB as PostgreSQL

    CO->>ORD: {storeSlug, items, address{kodepos,kelurahan}, shipping{service, serviceType, destId}, channelCode}
    ORD->>AR: areaById(destId) -> refuse if unknown; kota/provinsi DERIVED from it
    ORD->>AR: resolveDestinationKelurahan(destId, name) -> exact match -> ka_kelurahan_id or null
    ORD->>Q: quoteShipping(couriers:[service]) with SERVER-priced subtotal
    Q-->>ORD: fresh rates (KA outage => order refused)
    ORD->>ORD: findRate(service, serviceType) else 400 "tidak tersedia lagi"
    ORD->>ORD: shippingIdr = rate.cost; voucher / free-ship; calculateOrderFinance (COD fee 3% + PPN)
    alt payment = COD
        ORD->>ORD: refuse unless rate.cod
        ORD->>COD: policy.reason(courier, type, total, province from district)
    end
    ORD->>DB: INSERT orders (shipping_idr, courier, service_type, ship_* snapshot, ship_district_id, ship_kelurahan_*), order_financials
    Note over ORD,DB: NO booking here. awb / ka_order_id stay NULL.
```

### 2.3 Book (Seller: single order or bulk)

```mermaid
sequenceDiagram
    autonumber
    actor M as Seller
    participant UI as order-detail.tsx / massal-client.tsx
    participant B as bulkGenerateResi
    participant CS as createShipment
    participant GR as getShippingRates
    participant DB as PostgreSQL
    participant KA as KiriminAja

    alt bulk (/pesanan/massal)
        M->>UI: Atur pengiriman (<=50 orders)
        UI->>B: bulkGenerateResi(numbers)
        B->>GR: per order, rate for orders.courier + service_type
        B->>CS: createShipment(service, type, cost, insurance:false)
    else single (Cek Ongkir)
        M->>UI: Cek Ongkir
        UI->>GR: getShippingRates(orderNumber) (insurance:1, any in-scope service)
        M->>CS: createShipment(chosen service, cost shown)
    end
    CS->>CS: requireCapability(orders:write), in-scope, prepaid-must-be-paid, COD derived from payments.method
    CS->>GR: re-quote; refuse if serverCost != input.cost
    CS->>DB: advisory lock; shipment_bookings 'reserved' + ledger debits for cost delta
    CS->>KA: POST /api/mitra/v6.2/request_pickup (schedule = tomorrow 10:00 WIB)
    alt transport error
        CS->>DB: booking 'unknown' (do not rebook)
    else status false
        CS->>DB: booking 'failed' + reversal ledger rows
    else ok
        CS->>DB: booking 'accepted'; orders.ka_order_id, ka_pickup_number, ka_payment_*, ka_shipping_cost_idr, awb (only details[0].awb)
        CS->>DB: applyOrderStatusChange -> diproses
    end
```

### 2.4 Track (cron, Lacak, webhook)

```mermaid
sequenceDiagram
    autonumber
    participant SC as cron-tracking sidecar (sleep 900)
    participant CR as GET /api/cron/tracking
    participant WH as POST /api/public/kiriminaja/webhook
    participant KT as lib/ka-tracking.ts
    participant DB as PostgreSQL
    participant KA as KiriminAja

    SC->>CR: x-cron-secret header
    CR->>DB: orders with ka_order_id, status in (diproses, dikirim), 5 per store round-robin
    loop each order
        CR->>KA: POST /api/mitra/tracking {order_id}
        KA-->>CR: {status, text, status_code, details{awb, sorting_code}, histories}
        CR->>CR: parseKaTracking; realWaybill(awb, ref); outcomeFromTrackingCode
        CR->>KT: syncOrderFromKa(order, outcome, awb, problemNote, cancelReply, sortingCode)
        KT->>DB: FOR UPDATE; awb/sorting_code; problem flag set/clear; forward-only status via applyOrderStatusChange
    end
    CR->>DB: cron_runs upsert (summary)
    KA->>WH: Bearer <active KA key>, {method, data:[{order_id, awb, sorting_code}]}
    WH->>KT: verifyKaHint(order_id) -> kaTrack (verified pull) -> syncOrderFromKa
```

### 2.5 Cancel

```mermaid
sequenceDiagram
    autonumber
    actor M as Seller
    participant CX as cancelShipment
    participant DB as PostgreSQL
    participant KA as KiriminAja
    participant CR as cron/tracking + syncOrderFromKa

    M->>CX: Batalkan pengiriman
    CX->>CX: refuse if no awb (booking ref is never used), refuse if pending or terminal status
    CX->>DB: lock; booking accepted -> cancellation_requested (intent persisted BEFORE vendor call)
    CX->>KA: POST /api/mitra/v3/cancel_shipment {awb, reason}
    alt rejected
        CX->>DB: booking back to accepted + note
    else accepted or transport error
        CX->>DB: stays cancellation_requested (queued up to 48 h at vendor)
    end
    CR->>KA: later tracking pull
    CR->>DB: decideCancelReconcile: canceled -> voided + clear awb/ka_order_id; shipped/delivered/returned/problem -> revert to accepted; not found -> problem flag
```

---

## 3. Module map

### 3.1 Provider client and config (`packages/lib`)

| Module | Responsibility | Evidence |
|---|---|---|
| `packages/lib/src/kiriminaja.ts` | HTTP client `ka()` (Bearer, 8 s timeout, JSON body parsed even on 4xx/5xx, `KaTransportError` on non-JSON); all endpoint wrappers; order-id builder; kelurahan/coordinate sink guards; roster harvest; credit balance; connection test | `ka()` `:133-165`; `KaTransportError` `:124-129`; cache scope `:21-24` |
| `packages/lib/src/kiriminaja-tracking.ts` | Pure tracking-body parser, `realWaybill`, sorting-code normaliser, couriers that need a sorting code, webhook-hint binding | `parseKaTracking` `:56-79`; `realWaybill` `:88-95`; `SORTING_CODE_COURIERS` `:128`; `sortingCodeFromHint` `:145-150` |
| `packages/lib/src/provider-config.ts` | Pure precedence resolver (DB row > env > default `sandbox`), 60 s in-process cache, injectable loader, `maskKey`, brand-free accessors | `KA_BASE` `:37-40`; `resolveKiriminaja` `:102-127`; TTL `:165`; `getProviderConfig` `:201-222`; `providerConfigSync` `:231-238`; accessors `:245-262` |
| `packages/db/src/provider-config.ts` | DB half: reads/decrypts `shipping_aggregator`, registers the loader, writers (key per env, active env, order prefix, tested-at) which invalidate the cache | loader `:40-54`; GCM scope `provider:kiriminaja:<env>` `:25`; writers `:66-99` |
| `packages/lib/src/crypto.ts` | AES-256-GCM at rest, key derived (scrypt) from `INTEGRATION_TOKEN_KEY` | `:1-30`, `KEY_ENV` `:35` |
| `packages/lib/src/couriers.ts` | Display roster (code → name), instant-courier guard (`isInstantCourier`, `isInstantService`) | `COURIERS` `:20-31`; guard `:61-78` |
| `packages/lib/src/integration-status.ts` | `isConfigured(key)` = non-empty string | `:19` |
| `packages/lib/src/provider-label.ts` | `SHIPPING_SERVICE = "TokoΦ Kirim"` brand mask for client-facing copy (ADR 0004) | `:35` |
| `packages/lib/src/cache.ts` | In-process TTL cache used for `ka:price`, `ka:roster`, `ka:balance` | `:6` |
| `packages/lib/src/order-finance.ts` | COD fee: max(Rp2.500, 3% of base) + PPN 11%, charged to buyer on COD orders | `:8-9`, `:92-98` |

### 3.2 Area data

| Module | Responsibility | Evidence |
|---|---|---|
| `apps/admin/lib/data/areas.ts` | `searchAreaLocal` (ranked ILIKE over `kiriminaja_areas`), `resolveArea` (local first, live `get_address_by_name` fallback), `areaById`, `provinceForDistrict`, `kelurahanForDistrict` (public, no vendor id), `kelurahanWithKaIdForDistrict` (seller path), `resolveDestinationKelurahan` | `:44-76`, `:91-96`, `:118-133`, `:135-143`, `:155-162`, `:202-223` |
| `apps/admin/lib/kelurahan-pick.ts` | Pure exact-match (never fuzzy), both-or-neither name+vendor id | `:64-73` |
| `apps/admin/lib/pickup-address.ts` | Composes the sender `address` string (street, `Kel. <name>`, postcode) | `:22-31` |
| `packages/db/src/area-coords.ts` | `resolveAreaCoords`: kelurahan centroid → district centroid → null | `:24-48` |
| `packages/db/src/seed-areas.ts` | Loads `data/kiriminaja-areas.csv` + `data/kelurahan.csv` (run on every deploy) | `:10`, `:55`; compose `docker-compose.coolify.yml:95` |
| `packages/db/scripts/build-ka-kelurahan-ids.mjs` | Offline walk of `POST /api/mitra/kelurahan` per district → `ka_kelurahan_id` column of the CSV (name match) | header `:1-20`; env `:52-68`; fetch `:119` |
| `packages/db/scripts/build-area-coords.mjs`, `build-kelurahan.mjs` | Centroids (Kemendagri boundaries) and kelurahan/postcode CSV | header `build-area-coords.mjs:3` |

### 3.3 Quoting, COD, scope

| Module | Responsibility | Evidence |
|---|---|---|
| `apps/admin/lib/shipping-quote.ts` | **The one price producer.** Origin = `sender_kecamatan_id` (fallback: fuzzy store city, flagged `originFrom:"store-city"`); weight/box from DB; platform ∩ store filter; effective COD flag; `FAST_COURIERS = ["spx","jne"]`; `findRate` | `quoteShipping` `:120-221`; origin `:148-158`; scope `:163-169`, `:207-208`; KA call `:176-189`; COD `:194-206`; `FAST_COURIERS` `:110`; `findRate` `:113-118` |
| `apps/admin/lib/shipping-weight.ts` | `weightForCart` / `weightForOrder` (Σ `weight_grams`×qty, default 500 g per weightless line, 1 kg billable floor) and `stackedDims` (max length × max width, height from Σ volume, rounded up) | `DEFAULT_WEIGHT_GRAMS` `:33`; `MIN_BILLABLE_GRAMS` `:36`; `stackedDims` `:98-105`; `weightForCart` `:109-169`; `weightForOrder` `:172-204` |
| `apps/admin/lib/cod.ts` + `cod-policy.ts` | Loads 3 rows; pure 5-condition gate (`allows`, `reason`) | `getCodPolicy` `cod.ts:17-46`; `buildCodPolicy` `cod-policy.ts:83-148` |
| `apps/admin/app/api/public/ongkir/route.ts` | Public route: `search`, `kelurahan`, `rates`; CORS `*`; rate limit 60/min; body cap; provider text hidden | ops `:58-151`; rate limit `:41`; not-configured `:43-45` |
| `apps/admin/lib/public-guard.ts` | `readPublicBody`, `rateLimited`, `MAX_CART_ITEMS`, `SHIPPING_QUOTE_UNAVAILABLE` copy | `:128-129` |

### 3.4 Checkout and order

| Module | Responsibility | Evidence |
|---|---|---|
| `apps/storefront/src/pages/checkout.astro` | Calls ongkir (`ONGKIR_API` env), FAST then `all:true` prefetch, stale-route guards, `syncCod` + `#cod-hint`, `setKodepos`, `loadKelurahan`; posts `shipping{service, serviceType, destId}` to `ORDER_API` | endpoints `:26-29`; kelurahan `:1807-1811`; search `:1988`; rates `:2207`, `:2261`; order body `:2736-2744`; `syncCod` `:1421` |
| `apps/admin/app/api/public/order/route.ts` | Validates district (`areaById`), re-derives kelurahan, **re-quotes** scoped to picked courier, `findRate`, COD gate, writes shipping fields | district `:384-392`; kelurahan `:405`; re-quote `:655-697`; COD `:792-815`; insert `:985-1022`; rate limit 10/min `:194` |

### 3.5 Seller fulfilment

| Module | Responsibility | Evidence |
|---|---|---|
| `apps/admin/lib/actions/shipping.ts` | `getShippingRates` (orders:write, insurance:1, `kaCodFee`), `searchArea`, `kelurahanOptions`, `get/saveSenderAddress` (re-derives vendor kelurahan id), `getPlatformServices`, `get/saveStoreServices` (full replace), `get/setCodEnabled`, `get/setFreeShip`, `createShipment`, `cancelShipment`, `trackShipment`, `fillDemoResi` (non-production only) | `:157-298`, `:301`, `:326`, `:348-415`, `:458`, `:494-532`, `:534-556`, `:558-595`, `:636-1291`, `:1309-1445`, `:1487-1550`, `:1552-1580` |
| `apps/admin/lib/actions/bulk-shipping.ts` | `bulkGenerateResi` (≤50, service the shopper paid for, no picker), `bulkFetchResi`, `markLabelsPrinted` (`.returning()`) | `BULK_MAX` `:31`; `:52-109`; `:112-130`; `:135-151` |
| `apps/admin/lib/shipment-payment.ts` | Separates COD vs non-COD (VA) courier settlement from `ka_payment_status` (`unpaid` blocks) | `:50-63` |
| `apps/admin/lib/data/bulk-labels.ts` + `app/api/admin/labels/route.ts` + `components/admin/pesanan/shipping-label.ts` | Label HTML (Code 128) only for orders with `awb`; sorting-code slot for spx/idx/jnt/jtcargo; route gated by `orders:write` | `bulk-labels.ts:41-136`; route `:14-21`; `buildLabelHtml` `shipping-label.ts:151-152` |
| `apps/admin/lib/data/bulk-shipping.ts`, `data/order-detail.ts`, `data/returns.ts` | Pengiriman Massal queue; order screen incl. shipment payment state; COD return-rate per courier | `order-detail.ts:565` |
| UI: `app/(admin)/pesanan/[id]/order-detail.tsx`, `pesanan/massal/massal-client.tsx`, `components/admin/pengaturan/{sender-address-card,jasa-kirim-card}.tsx`, `app/(admin)/pengaturan/page.tsx` | Cek Ongkir / book / Lacak / cancel; bulk book/fetch/print; pickup address; service picker + COD toggle | `order-detail.tsx:31-35,298,339`; `massal-client.tsx:16,127,167,243-247` |
| `apps/admin/lib/provision.ts`, `lib/actions/register.ts` | Signup stores `sender_kecamatan_id` from the form verbatim (not checked against `kiriminaja_areas`) | `register.ts:58,84`; `provision.ts:298` |

### 3.6 Tracking

| Module | Responsibility | Evidence |
|---|---|---|
| `apps/admin/app/api/cron/tracking/route.ts` | Poll set, per-order `kaTrack`, permanent-4xx flag, cancel reconcile on not-found, evidence log, `cron_runs` | query `:97-124`; `PER_STORE_BATCH` `:33`; loop `:145-276`; retryable 4xx `:71` |
| `apps/admin/lib/ka-tracking.ts` | `outcomeFromTrackingCode` (numeric code map; text can at most reach `shipped`), `syncOrderFromKa` (single writer of awb/sorting_code/problem; forward-only), `clearStaleTrackingRejection`, `verifyKaHint` | `:38-76`; `OUTCOME_STATUS` `:80-87`; `RANK` `:91`; `:105-297`; `:315-328`; `:346-376` |
| `apps/admin/lib/cancel-reconcile.ts` | Pure decision table for a pending cancel | `decideCancelReconcile`, `isNotFoundReply` |
| `apps/admin/app/api/public/kiriminaja/webhook/route.ts` | Bearer must equal the **active KA API key** (timing-safe); ≤50 hints; each hint → `verifyKaHint` | auth `:30-39`; handler `:130-178` |
| `docker-compose.coolify.yml` `cron-tracking` | alpine loop, `wget` with `x-cron-secret`, `CRON_INTERVAL_SEC=900` | `:454-479` |

### 3.7 Super Admin (platform control)

| Module | Responsibility | Evidence |
|---|---|---|
| `apps/super-admin/lib/actions.ts` | `saveCouriers` (enable per courier), `saveCodAllowed` (per service, ceiling = KA `cod`), `saveGateways` (`cod` key toggles `platform_cod.enabled`), `testKiriminajaConnection`, `syncCouriersFromKiriminaja` (new services `codAllowed=false`, vanished couriers disabled), `saveProviderCredentials` / `setProviderEnv` / `saveProviderOrderPrefix` (owner), `testProviderKey` | `:515-525`, `:530-536`, `:555-585`, `:587-594`, `:623-697`, `:726-764` |
| `apps/super-admin/lib/provider-credentials.ts` | Key shape check, save/test/switch flows; env switch tests the TARGET key first and refuses on failure | `:54`, `:81`, `:98`, `:140`, `:161-185` |
| `apps/super-admin/lib/ka-probe.ts`, `lib/data.ts` | Health probe classification (cached), credit balance badge | `classifyKaProbe` `ka-probe.ts:35`; `data.ts:541-580` |
| `apps/super-admin/app/(platform)/pengaturan/{page,pengaturan-client,provider-keys}.tsx` | Kurir card, COD per service, provider keys per env, env switch, prefix | — |

---

## 4. Data model

| Table / column | Meaning | Writer(s) | Reader(s) |
|---|---|---|---|
| `kiriminaja_areas` (`id` = **KA district id**, names, `lat`,`lng`) `schema.ts:1794-1808` | 7 030 vendor districts; THE id currency for origin, destination, COD province | `seed-areas.ts` on every deploy | `areas.ts`, `area-coords.ts` |
| `kelurahan` (`id` Kemendagri text, `district_id` → KA district, `name`, `postcode`, `ka_kelurahan_id` vendor int nullable, `lat`,`lng`) `schema.ts:1812-1848` | postcode auto-fill; vendor subdistrict id (~94% filled) | `seed-areas.ts` from CSV | `areas.ts`, `area-coords.ts` |
| `store_settings.sender_name/phone/address` `:1740-1742`, `sender_kecamatan_id` `:1743`, `sender_kecamatan_name`, `sender_kelurahan_id` (vendor id) `:1745`, `sender_kelurahan_name`, `sender_postcode` `:1751`; `sender_lat/lng` DEAD `:1755` | pickup / quote origin | `saveSenderAddress`, `provisionStore` | `quoteShipping`, `getShippingRates`, `createShipment` |
| `store_settings.couriers text[]` `:1759` | legacy courier-level filter, no writer left | none (`shipping.ts:417-427`) | `quoteShipping:168` fallback |
| `store_settings.cod_enabled` `:1768`; `free_ship_enabled/min_idr` `:1771-1772` | merchant COD opt-in; auto free shipping | `setCodEnabled`, `setFreeShip` | `cod.ts`, order route |
| `store_shipping_methods (store_id, courier, service, enabled)` unique triple `:1931-1943` | per-SERVICE merchant pick; empty = fallback to platform pool | `saveStoreServices` | `quoteShipping`, `shippingScope` |
| `platform_couriers (courier, services jsonb [{type,name,group,cod,codAllowed}], enabled)` `:1881-1886` | platform courier pool + per-service COD allowance | `syncCouriersFromKiriminaja`, `saveCouriers`, `saveCodAllowed`, seed | quote, cod-policy, Jasa Kirim |
| `platform_cod (enabled, max_amount_idr, allowed_provinces jsonb, fee_pct DEAD)` `:1908-1916` | COD platform switch + risk limits (seed: Rp2.000.000, 6 provinces, `seed.ts:117-118,1906`) | `saveGateways` (enabled only); cap/provinces have **no UI writer** (seed only) | `cod.ts` |
| `shipping_aggregator (provider enum, api_key DEAD, enabled DEAD, sandbox_key_enc, production_key_enc, active_env default 'sandbox', sandbox/production_order_prefix, *_tested_at)` `:1863-1879` | credentials + active env per provider row | `packages/db/src/provider-config.ts` writers | loader |
| enum `aggregator_provider` = `biteship, rajaongkir, shipper, kiriminaja` `:212-217` | already admits other providers | — | — |
| `orders.shipping_idr` `:918`, `ship_recipient/phone/address/postcode` `:934-937`, `ship_district_id` (KA district) `:940`, `ship_kelurahan_name`, `ship_kelurahan_id` (KA vendor id) `:954-955` | what the shopper paid + destination snapshot | order route | `createShipment`, `getShippingRates` |
| `orders.courier`, `service_type` `:971,977` | the service the shopper bought (codes, not names) | order route; overwritten by `createShipment` with the booked service | bulk booking, labels, COD return report |
| `orders.awb` `:964`, `sorting_code` `:970`, `ka_order_id` `:996`, `ka_pickup_number`, `ka_payment_status`, `ka_payment_url` `:1010-1012`, `ka_shipping_cost_idr` `:1019`, `label_printed_at` `:983`, `problem_at`, `problem_note` `:992-995`, `returned_at`, `return_reason` `:912-913` | booking identity, waybill, courier settlement, flags | `createShipment`, `syncOrderFromKa` (only writer of awb after booking + sorting_code), `markLabelsPrinted`, `fillDemoResi` (non-prod) | tracking cron, labels, order screens |
| `shipment_bookings` `:1057-1090` (status enum `reserved, unknown, accepted, cancellation_requested, failed, voided, refunded` `:136-144`; `provider_reference` UNIQUE, `provider_booking_id` UNIQUE, cost delta columns; partial unique one-active-per-order) | append-only booking ledger, reservation before the vendor call | `createShipment`, `cancelShipment`, `syncOrderFromKa` | cron query, cancel |
| `ledger_entries.shipment_booking_id`, `component` (`shipping-order-debit`, `shipping-balance-debit`, `*-reversal`) `:1633-1634` | seller pays a costlier booked service | `createShipment:987-1012`, reversal `:1160-1170` | balance |
| `order_financials.shipping_charged_idr`, `cod_fee_*` `:1027-1053` | immutable checkout allocation | order route `:1047-1049` | `createShipment:943-958` |

Migrations touching the area: `0017` (kiriminaja_areas), `0038` (cod_enabled), `0042` (ship_* snapshot), `0046` (kelurahan), `0047` (courier roster normalise), `0088` (ka_payment_*), `0094` (order_financials, shipment_bookings, ledger component), `0107` (ka_kelurahan_id), `0108` (ship_kelurahan_*), `0109` (coords), `0110` (sorting_code), `0111` (provider_config), `0115` (order prefix). Files under `packages/db/drizzle/`.

---

## 5. External API endpoints used

All via `ka()` in `packages/lib/src/kiriminaja.ts`, `Authorization: Bearer <key>`, base per env (`provider-config.ts:37-40`: sandbox `https://tdev.kiriminaja.com`, production `https://client.kiriminaja.com`).

| Method + path | Function | Callers | Notes |
|---|---|---|---|
| `POST /api/mitra/v2/get_address_by_name` `{search}` | `kaAddressByName` `:169-172` | `areas.ts:95` (only when local table has no hit) | answer key `data` |
| `POST /api/mitra/v6.1/shipping_price` | `kaShippingPrice` `:218-264` | `shipping-quote.ts:176`, `shipping.ts:249`, `kaServices` `:594` | 10-min cache, empty answers not cached; dims omitted when absent; `courier[]` narrows latency only |
| `POST /api/mitra/v6.2/request_pickup` | `kaCreateOrder` `:417-529` | `shipping.ts:1075` | `platform_name:"mitra"`, `drop:false`, `package_type_id:7`, items manifest, coords, zipcodes, kelurahan ids conditional; `awb:""` → undefined `:522`; refusals arrive as HTTP 400 JSON |
| `POST /api/mitra/v3/cancel_shipment` `{awb, reason}` | `kaCancelShipment` `:544-547` | `shipping.ts:1396` | AWB only |
| `POST /api/mitra/tracking` `{order_id}` | `kaTrack` `:554-557` | cron `:154`, `shipping.ts:1501`, `ka-tracking.ts:361` | `order_id` ≤ 20 chars; body has `details`, no `data` |
| `GET /api/mitra/v6.2/credit/balance` | `kaCreditBalance` `:658-690` | `shipping.ts:1185` (diagnose a refused booking), super-admin `data.ts:574` | sandbox = "unsupported", not Rp0 |
| `POST /api/mitra/province` `{}` | `kaTestConnection` `:697-716` | super-admin test + probe + env switch | answers `datas` |
| `POST /api/mitra/kelurahan` `{kecamatan_id}` | offline script only | `build-ka-kelurahan-ids.mjs:119` | answers `results` |
| Inbound `POST https://app.tokophi.com/api/public/kiriminaja/webhook` | webhook route | vendor (registered via `set_callback`, per `KIRIMINAJA.md` §0.2) | registration itself is **UNVERIFIED** from code (no `set_callback` call in repo) |

Not called, deliberately: `v6.2/pin/validate` (account locks after 3 wrong PINs, `kiriminaja.ts:642-647`), `v6.1/awb/print` (we render labels), `v4/instant/*` (removed, `:531-534`).

---

## 6. Config and secrets (names only)

| Name | Where | Effect |
|---|---|---|
| `shipping_aggregator.sandbox_key_enc` / `production_key_enc` | DB, AES-GCM, scope `provider:kiriminaja:<env>` | wins over env |
| `shipping_aggregator.active_env` | DB | wins over `KIRIMINAJA_ENV`; default `sandbox` |
| `shipping_aggregator.sandbox_order_prefix` / `production_order_prefix` | DB | wins over `KIRIMINAJA_ORDER_PREFIX`; code default `TOKOPHI` (`provider-config.ts:85`) |
| `KIRIMINAJA_API_KEY` | env (admin, super-admin, scripts) | fallback key |
| `KIRIMINAJA_ENV` | env | fallback env; unset ⇒ `sandbox` |
| `KIRIMINAJA_ORDER_PREFIX` | env | fallback prefix |
| `INTEGRATION_TOKEN_KEY` | env | derives the at-rest cipher key (`crypto.ts:35`) |
| `CRON_SECRET` | env (admin + sidecar) | header `x-cron-secret` for `/api/cron/tracking` |
| `CRON_INTERVAL_SEC` | sidecar env (900) | poll cadence + `?every=` liveness threshold |
| `PUBLIC_ONGKIR_API`, `PUBLIC_ORDER_API` | storefront env | where checkout calls (`checkout.astro:26-27`) |
| `CONCURRENCY`, `PACE_MS`, `ONLY_DISTRICTS`, `LIMIT_DISTRICTS`, `OUT` | `build-ka-kelurahan-ids.mjs` only | offline walk tuning |
| Vendor IP allow-list | vendor portal, per env | egress IP of the VPS must be listed; lapse = 401 naming the IP (`KIRIMINAJA.md` §0.1, `DEPLOY.md:80`) |

Health surfaces: `apps/admin/app/api/health/env/route.ts:34` (`providerHealthSummary`: env + key SOURCE, never value), `apps/admin/lib/env-health.ts:48-50`.

**Current active env in production: UNVERIFIED.** The code comments record a Super Admin switch to production on 2026-09-17 (`kiriminaja.ts:15-17`) and a production credit-balance read on 2026-09-23 (`:637-638`), while `KIRIMINAJA.md` §0.1/§0.9 still say "sandbox until UAT accepted". The truth is the `shipping_aggregator.active_env` row on production, which this audit did not read.

---

## 7. KiriminAja-specific surface (grep "kiriminaja", case-insensitive, plus vendor-shaped ids)

### 7.1 Provider-specific — must be replaced or wrapped

- `packages/lib/src/kiriminaja.ts` — the whole client, `KaRate`/`KaService`/`KaSender`/`KaPackage`/`KaItem` shapes, order-id rules (`KA_ORDER_ID_MAX=20`), sink guards, reference route `2099 → 356` for roster harvest `:577-578`.
- `packages/lib/src/kiriminaja-tracking.ts` — tracking envelope, `MOCK-<ref>` refusal, sorting-code couriers.
- `packages/lib/src/provider-config.ts` (`KA_BASE`, `resolveKiriminaja`, `activeKa*`), `packages/db/src/provider-config.ts` (KA row loader/writers).
- `apps/admin/lib/ka-tracking.ts` — numeric status-code map is KA's (`:38-76`).
- `apps/admin/lib/cancel-reconcile.ts` — "tidak ditemukan" heuristics are KA's wording.
- `apps/admin/app/api/public/kiriminaja/webhook/route.ts` — path, payload `{method, data[]}`, Bearer = KA key.
- `apps/admin/app/api/cron/tracking/route.ts` — poll set keyed on `ka_order_id`.
- `apps/admin/lib/actions/shipping.ts` — `createShipment` builds `KaSender`/`KaPackage`, error-hint parsing of vendor text (`prefix`, `batas pemrosesan`, `saldo`) `:1176-1192`, `kaCreditBalance` fallback, `fillDemoResi`.
- `apps/admin/lib/shipment-payment.ts` — `unpaid|pending|paid` are KA's `payment_status` values.
- `apps/admin/lib/data/areas.ts` — live fallback `kaAddressByName`; `splitAreaText` assumes KA's text format.
- `apps/super-admin/lib/actions.ts` (`syncCouriersFromKiriminaja`, `testKiriminajaConnection`, provider credential actions), `lib/provider-credentials.ts`, `lib/ka-probe.ts`, `lib/data.ts` (probe, balance), `app/(platform)/pengaturan/{page,pengaturan-client,provider-keys}.tsx`, `app/(platform)/analitik/page.tsx`, `lib/data/dev-logs.ts`, `lib/refused.ts`.
- DB: table `kiriminaja_areas` (name + id space), `kelurahan.ka_kelurahan_id`, `orders.ka_order_id / ka_pickup_number / ka_payment_status / ka_payment_url / ka_shipping_cost_idr`, `shipping_aggregator` KA columns, `platform_couriers.services[].type` (KA `service_type` codes such as SPX `"1"`/`"3"`).
- Data/scripts: `packages/db/data/kiriminaja-areas.csv`, `kelurahan.csv` (`ka_kelurahan_id` column), `ka-kelurahan-unmatched.csv`, `scripts/build-ka-kelurahan-ids.mjs`, `scripts/build-area-coords.mjs`, `src/seed-areas.ts`, `src/seed.ts` (aggregator row `:1830`, couriers `:1895`, COD `:1906`), `src/seed-guard.ts`, `src/backfill-ship-address.ts`, `src/product-dims.ts`.
- Ops: `ops/kiriminaja-uat-sim.ts`, `ops/tokophi-probe.sh`, `ops/uat-sheet-render.mjs`, `ops/tokophi-n33-product-dimensions.sql`, `docker-compose.coolify.yml` (`cron-tracking`), `.env.example`, `.env.coolify.example`.
- Tests pinned to KA: `packages/lib/src/{kiriminaja,kiriminaja-v62,kiriminaja-tracking,kiriminaja-cache-scope,ka-credit-balance,ka-kelurahan-id,ka-order-id,provider-config}.test.ts`, `apps/admin/lib/{ka-sorting-code,ka-status-codes,ka-webhook,cancel-shipment,shipment-payment,shipping-manifest}.test.ts`, `app/api/public/kiriminaja/webhook/route.auth.test.ts`, `apps/super-admin/lib/{ka-probe,provider-credentials}.test.ts`, `packages/db/src/{area-coords,kelurahan-csv}.test.ts`.

### 7.2 Provider-agnostic in behaviour (only comments, names or the district id currency mention KA)

- `apps/admin/lib/shipping-quote.ts`, `shipping-weight.ts`, `cod.ts`, `cod-policy.ts`, `kelurahan-pick.ts`, `pickup-address.ts`, `public-guard.ts`, `order-status-refusal.ts`, `data/{order-detail,bulk-shipping,bulk-labels,returns}.ts`, `actions/{bulk-shipping,payments,register}.ts`, `crypto.ts`, `env-health.ts`, `api/health/env/route.ts`, `api/public/{ongkir,order,pay/callback}/route.ts`, `components/admin/pesanan/shipping-label.ts`, `components/admin/pengaturan/{jasa-kirim-card,sender-address-card}.tsx`, `app/(admin)/{pengaturan,pesanan}/**`, `app/(admin)/produk/[id]/product-editor.tsx`.
- `packages/lib/src/{couriers,cache,crypto,integration-status,provider-label,order-finance,validate,autolaris}.ts` (AutoLaris is payment only; `autolaris.ts:322`).
- Storefront: `checkout.astro`, `keranjang.astro`, `OrderFunnel.astro`, `promo/[handle].astro`, `api/checkout-session.ts`, `lib/checkout-cod-floor.test.ts` — talk only to our public API.
- ⚠️ "Agnostic" still assumes the **KA district id** as the area key everywhere (`ship_district_id`, `sender_kecamatan_id`, `destinationId`), and KA service codes in `orders.service_type`. That is the deepest coupling (§9.2).

---

## 8. Switches that can disable KiriminAja, and what checkout does then

| Switch | Effect in code | Checkout outcome |
|---|---|---|
| No key anywhere (DB row empty AND `KIRIMINAJA_API_KEY` unset) → `kiriminajaConfigured()` false (`kiriminaja.ts:121`) | ongkir returns `{ok:false, "Shipping belum dikonfigurasi."}` `ongkir/route.ts:43-45`; `quoteShipping` same `:121`; cron records error `cron/tracking:84-92`; seller actions refuse `shipping.ts:171,638` | **No order can be placed** — the order route re-quotes and fails (`order/route.ts:688-695`) |
| Vendor down / 401 / IP lapse | `quoteShipping` returns `fromProvider:true`; public routes show `SHIPPING_QUOTE_UNAVAILABLE` and log the vendor text | **No order** (documented as deliberate, `AGENTS.md:722`) |
| Vendor account with 0 couriers activated | empty `results`, not cached | checkout shows zero rates; no order |
| `active_env` / `KIRIMINAJA_ENV` | which host + key + prefix | invisible to shoppers; sandbox bookings never get collected |
| `platform_couriers.enabled` per courier | filters rates | see trap §9.1 #1 when ALL are disabled |
| `store_shipping_methods` | per-store service filter | none picked ⇒ platform pool |
| `platform_cod.enabled` (via `saveGateways` key `cod`), `store_settings.cod_enabled`, `services[].codAllowed`, cap, provinces | COD only | COD option hidden with a reason; prepaid still works |
| `shipping_aggregator.enabled` | **read by nothing** (`super-admin/lib/data.ts:1051-1054`) | no effect — there is **no kill switch** for the provider short of removing the key |

---

## 9. Invariants and traps

### 9.1 Found in code during this audit (not already written down, or contradicting a doc)

1. **Disabling every platform courier removes the platform filter instead of closing shipping.** `quoteShipping` applies the platform filter only `if (platformOn.length)` (`shipping-quote.ts:207`), and the seller-side `inScope` short-circuits on `!scope.platformOn.length` (`shipping.ts:93`). With all `platform_couriers.enabled=false`, every KA rate passes (still narrowed by a store's `store_shipping_methods` if it has rows). COD stays off because `cod-policy.ts:95` skips disabled rows. Verified by reading; not executed.
2. **`kiriminajaConfigured()` is synchronous** and on a fresh replica answers from env before the DB row loads (`kiriminaja.ts:115-121`, `provider-config.ts:231-238`). A deployment with the key only in the DB can refuse the very first ongkir request after a restart.
3. **Webhook Bearer = the active KA API key** (`webhook/route.ts:30-39`). Rotating the key or switching env changes what the vendor must send; the vendor-side auth contract is undeclared (`KIRIMINAJA.md` §"The callback's AUTHENTICATION is undeclared") — **UNVERIFIED** whether the vendor actually sends this header.
4. **Signup stores `sender_kecamatan_id` without checking it exists** (`register.ts:80-84`); `saveSenderAddress` does not validate it either (`shipping.ts:370-415`). A bad id yields no rates rather than a wrong price.
5. **`platform_cod.max_amount_idr` / `allowed_provinces` have no editor** — seed values only (`seed.ts:117-118,1906`); grep of `apps/super-admin` finds no writer.
6. **`createShipment` overwrites `orders.courier`/`service_type` with the BOOKED service** (`shipping.ts:1250-1262` region, the `.set({ courier: input.service, serviceType: input.serviceType })`), so after a Cek Ongkir re-pick the order no longer records what the shopper paid for; `shipment_bookings` + `shipping_idr` keep the money side.
7. **COD amount sent to the courier = `orders.total_idr`** (`shipping.ts:1121`), which includes the buyer-side COD fee computed by `order-finance.ts:92-98` — the platform's fee formula must match the courier's or the parcel collects the wrong cash.
8. **The tracking poll has no global cap** — 5 per store per tick (`cron/tracking:33,112-123`); total calls scale with store count. `DEPLOY.md` still says "capped at 100 per tick".

### 9.2 Already documented (keep these when replacing)

| Invariant | Source |
|---|---|
| Ongkir origin is the seller's pickup district; `body.originCity` ignored; fallback flagged `originFrom:"store-city"` | `AGENTS.md:640`; `shipping-quote.ts:144-158` |
| One price producer; order re-quotes; `body.shipping.cost` never read; unknown service rejected, never re-couriered; vendor outage fails the order | `AGENTS.md:722`; `shipping-quote.ts:10-24` |
| Item prices and weights from DB, never from the cart | `AGENTS.md:723`; `shipping-weight.ts:6-24` |
| Quote and booking describe the same box (`stackedDims`, dims in cache key); never hard-code a volumetric divisor | `AGENTS.md:663-678`; `shipping-weight.ts:78-97`; `kiriminaja.ts:241-243` |
| COD = chain of platform switch ∧ cap ∧ provinces ∧ `codAllowed` ∧ store opt-in; `cod.ts` is the one answer; order route is the boundary; never `if (courier === "spx")`; new synced services default `codAllowed=false` | `AGENTS.md:651-655`; `cod-policy.ts:9-25`; `super-admin/lib/actions.ts:598-621` |
| COD is a fact of the order (`payments.method`); `createShipment` refuses a disagreeing caller; prepaid must be paid before booking | `AGENTS.md:1021-1031`; `shipping.ts:726-737` |
| `orders.status` has one writer, `applyOrderStatusChange`; tracking moves forward only; free text never reaches a money-moving status | `AGENTS.md:1033-1042`; `ka-tracking.ts:25-37,278-293` |
| `awb` only from a real courier waybill (`details[0].awb`, `realWaybill`); `""` and `MOCK-<ref>` refused; label cannot print without it | `AGENTS.md:705-709`; `kiriminaja.ts:515-522`; `kiriminaja-tracking.ts:81-95` |
| Cancel by AWB only; refused before the call when no AWB; `status:true` = queued ≤48 h; intent persisted before the call | `AGENTS.md:713-722`; `shipping.ts:1338-1385` |
| Pickup = tomorrow 10:00 `Asia/Jakarta` | `AGENTS.md:719-721`; `shipping.ts:1020-1026` |
| `order_id` ≤ 20 chars incl. prefix; never truncate; per-attempt base36 suffix; prefix must be registered at the vendor and travels with the key | `kiriminaja.ts:38-113`; `provider-config.ts:75-87` |
| Kelurahan id spaces: Kemendagri text vs KA int; only KA int may be sent; exact name match; both or neither | `kiriminaja.ts:266-315`; `kelurahan-pick.ts:48-73` |
| Coordinates: centroids only, both or neither, never 0,0, inside Indonesia | `kiriminaja.ts:317-347` |
| Provider brand and provider text never reach shopper/merchant copy (ADR 0004) | `provider-label.ts:20-35`; `public-guard.ts:128-129`; `provider-label.test.ts` |
| Caches scoped by env + key fingerprint; empty answers never cached | `kiriminaja.ts:12-24,259-262,605-608` |
| Non-COD bookings are owed to the vendor (VA); `unpaid` blocks the waybill | `shipment-payment.ts`; `schema.ts:997-1019` |
| Seller-chosen costlier service is debited from seller ledger; refused if balance short; cheaper = platform margin | `AGENTS.md:690-704`; `shipping.ts:943-1012` |
| `cron-tracking` is its own sidecar; if resi stop appearing, check the container first; vendor IP allow-list lapse reads as 401 naming the IP | `AGENTS.md:710-712`; `KIRIMINAJA.md` §0.7; `DEPLOY.md:80` |
| `KIRIMINAJA_ENV` unset = sandbox, and sandbox bookings look identical to production ones | `AGENTS.md:641-649` |
| `province` is POST `{}` answering `datas`; versions differ per endpoint on purpose | `AGENTS.md:680-683` |
| Never call `pin/validate` (3 attempts lock the account) | `kiriminaja.ts:642-647` |
| Instant couriers out of scope; guard in every roster/quote/booking path | `couriers.ts:37-78` |

---

## 10. Doc drift found (code wins; fix these docs separately)

| Doc / comment | Says | Code says |
|---|---|---|
| `AGENTS.md:663-678`, `shipping-weight.ts:54-56` (CartWeight comment) | box = max per axis | `stackedDims` stack since 2026-09-14 (`shipping-weight.ts:83-105`) |
| `specs/docs/FLOWS.md:273-325` §5 | ongkir body carries `weight`; instant branch books at checkout; `orders.courier` NULL | no weight in body; instant removed; order writes `courier`/`service_type` (`order/route.ts:993-1000`) |
| `KIRIMINAJA.md` §5 title "Webhooks — they exist, we use none of them" | no webhook | webhook route exists and is used (`webhook/route.ts`); §0.2 of the same file is correct |
| `KIRIMINAJA.md` §0.1/§0.7, `DEPLOY.md:551-553` | prod still sandbox; cutover = env var + redeploy | env/key/prefix switch from Super Admin (`setProviderEnv`), DB wins over env; actual prod env UNVERIFIED |
| `DEPLOY.md:547` | tracking sweep capped at 100 per tick | 5 per store per tick, no global cap (`cron/tracking:33`) |
| `schema.ts:1747-1751` (senderPostcode), `pickup-address.ts:8-12` | sender zipcode / kelurahan_id never sent | both sent when held (`kiriminaja.ts:460,467`) |
| `AGENTS.md` §"The public API" | four public routes | a fifth unauthenticated route: `/api/public/kiriminaja/webhook` (Bearer-gated) |

---

## 11. Adapter seam — what a second provider must implement

Today the consumers import KiriminAja functions directly (call-site list in §11.3). The narrowest seam
that keeps every invariant above is a provider module exposing the **same shapes** the consumers
already depend on. Signatures below are the existing KA ones (`packages/lib/src/kiriminaja.ts`,
`kiriminaja-tracking.ts`, `provider-config.ts`); a second provider implements them with its own wire format.

### 11.1 Functions

```ts
// configuration
configured(): boolean;                                   // kiriminajaConfigured, sync, cached
getConfig(): Promise<{ env: "sandbox" | "production"; base: string; key: string | null; orderPrefix: string }>;
testConnection(cfg?): Promise<{ ok: boolean; env: string; configured: boolean; httpStatus?: number; text?: string; message: string }>;
creditBalance(cfg?): Promise<{ ok: true; balance: number } | { ok: false; unsupported: boolean; error: string }>;

// areas (only a live fallback today; the local table is the primary source)
addressByName(search: string): Promise<{ id: number; text: string }[]>;

// pricing
shippingPrice(p: {
  origin: number; destination: number; weight: number;           // grams, billable
  lengthCm?: number; widthCm?: number; heightCm?: number;
  itemValue?: number; insurance?: 0 | 1; couriers?: string[];
}): Promise<{ ok: boolean; results: Rate[]; error?: string }>;
type Rate = {
  service: string;        // courier code (spx, jne, ...)
  service_name: string;   // human label
  service_type: string;   // booking code, stored in orders.service_type + store_shipping_methods.service
  cost: string | number; etd: string;
  cod: boolean;           // provider COD capability (ceiling for codAllowed)
  group: string;          // cargo | regular | next_day | economy | one_day
  setting?: { cod_fee?; minimum_cod_fee?; cod_fee_amount? } | null;
  insurance?: string | number | null; force_insurance?: boolean;
};
codFee(rate): { amount: number | null; pct: number | null; minimum: number | null };
services(): Promise<{ ok: boolean; services: { courier; serviceType; name; group; cod }[]; error?: string }>;

// booking
buildOrderRef(orderNumber: string, attempt: number, prefix?: string): string;   // must THROW, never truncate
createOrder(sender: KaSender, pkg: KaPackage, schedule: string /* "YYYY-MM-DD 10:00:00" WIB */): Promise<{
  ok: boolean; awb?: string; kaOrderId?: string; pickupNumber?: string;
  paymentStatus?: "unpaid" | "pending" | "paid" | string; paymentUrl?: string; error?: string;
}>;
cancelShipment(awb: string, reason: string): Promise<{ ok: boolean; error?: string }>;   // ok = accepted/queued

// tracking
track(orderId: string): Promise<{ ok: boolean; tracking?: Tracking; error?: string; httpStatus: number }>;
type Tracking = { awb: string | null; sortingCode: string | null; statusCode: number | string | null; text: string | null;
                  histories: { date: string; desc: string; statusCode: number | null }[]; keys: string[] };
realWaybill(awb, ref): string | null;
outcomeFromTrackingCode(code): "booked" | "shipped" | "delivered" | "returned" | "canceled" | "problem" | null;
courierNeedsSortingCode(courier): boolean;

// webhook
verifyWebhook(req): boolean;     // today: Bearer === active key
parseWebhookHints(body): { orderId: string; awb?: unknown; sortingCode?: unknown }[];

// errors
class TransportError extends Error { path; httpStatus; snippet }   // non-JSON reply; JSON refusals return ok:false
```

`KaSender` / `KaPackage` / `KaItem` are at `kiriminaja.ts:376-416`; reuse them as the neutral booking DTO.

### 11.2 Data the second provider also needs (the hard part)

1. **Area id mapping.** `orders.ship_district_id`, `store_settings.sender_kecamatan_id`, `destinationId` and `kiriminaja_areas.id` are KA district ids. A second provider needs a mapping table `(kiriminaja_area_id → provider_area_id)` or the area table must become provider-neutral with per-provider id columns. Same for `kelurahan.ka_kelurahan_id`.
2. **Service codes.** `orders.service_type`, `store_shipping_methods.service`, `platform_couriers.services[].type` hold KA `service_type` codes; COD allowance is keyed `courier:type` (`cod-policy.ts:66`). A second provider's codes must either be normalised to ours or the tables gain a provider column.
3. **Booking identity.** `orders.ka_order_id`, `ka_pickup_number`, `ka_payment_*`, `ka_shipping_cost_idr` are KA-named; `shipment_bookings.provider_reference/provider_booking_id` are already neutral — the poller should key off `shipment_bookings` + a provider column rather than `orders.ka_order_id`.
4. **Config row.** `shipping_aggregator.provider` enum already admits `biteship, rajaongkir, shipper`; the loader (`packages/db/src/provider-config.ts:29-32`) reads only the `kiriminaja` row.
5. **Status-code map** (`ka-tracking.ts:38-76`) and **cancel reconcile wording** (`cancel-reconcile.ts`) are per provider.

### 11.3 Call sites to repoint

`kaShippingPrice` → `shipping-quote.ts:176`, `actions/shipping.ts:249` · `kaCreateOrder` → `shipping.ts:1075` · `kaCancelShipment` → `shipping.ts:1396` · `kaTrack` → `cron/tracking/route.ts:154`, `shipping.ts:1501`, `ka-tracking.ts:361` · `kaServices` → `super-admin/lib/actions.ts:627` · `kaCreditBalance` → `shipping.ts:1185`, `super-admin/lib/data.ts:574` · `kaTestConnection` → `super-admin/lib/actions.ts:593`, `data.ts:560`, `provider-credentials.ts` deps · `kaAddressByName` → `areas.ts:95` · `kaCodFee` → `shipping.ts:293` · `buildKaOrderRef` + `activeKaOrderPrefix` → `shipping.ts:937` · `kiriminajaConfigured` → `shipping-quote.ts:121`, `ongkir/route.ts:43`, `shipping.ts:171,638`, `cron/tracking/route.ts:84` · `activeKaKey` → `webhook/route.ts:30` · `activeKaEnv` → `shipping.ts:1556`, `pesanan/[id]/page.tsx:22` · `providerHealthSummary` → `api/health/env/route.ts:34`.

---

## 12. Not verified in this audit

- Which env/key production actually uses today (`shipping_aggregator.active_env` row).
- Whether the vendor sends `Authorization: Bearer <key>` on webhook calls, and whether `set_callback` is registered for the current env.
- The SPX "free return on refused COD" belief behind SPX-only COD (`AGENTS.md:651`, `data/returns.ts:5-14`).
- Live behaviour of trap §9.1 #1 (all couriers disabled) — derived from code reading only.
- No tests, builds, or live API calls were run for this document.
