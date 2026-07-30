# TokoΦ — CRITICAL FLOWS

> Every diagram below carries the **real file and function names** and the **actual guards** as they exist
> in the tree on **2026-07-13**. Read with [`SYSTEM_MAP.md`](./SYSTEM_MAP.md) (structure) and
> [`STATUS.md`](./STATUS.md) (what is real vs. seeded vs. fake).

---

## 1. Shopper checkout — including the COD gate

The COD decision is a **money** decision, so it is enforced at the API boundary, **before any row is written**.
Hiding the option in the storefront UI is UX. A script POSTing `channelCode:"cod"` straight at the endpoint gets a
**403 with no order created** — never a silently-downgraded order (which would hide a COD request as a "transfer").

```mermaid
sequenceDiagram
    autonumber
    actor S as Shopper
    participant SF as storefront<br/>checkout.astro
    participant ONG as admin<br/>POST /api/public/ongkir
    participant ORD as admin<br/>POST /api/public/order
    participant COD as lib/cod.ts<br/>getCodPolicy()
    participant KA as KiriminAja
    participant AL as AutoLaris
    participant DB as PostgreSQL<br/>(owner conn)

    S->>SF: fill address
    SF->>ONG: {op:"search", q}
    ONG->>DB: resolveArea() → kiriminaja_areas
    ONG-->>SF: districts[] (each with destId)

    SF->>ONG: {op:"rates", storeSlug, destinationId, weight: qty*500}
    ONG->>DB: origin = store_settings.sender_kecamatan_id (the seller's PICKUP address)
    Note over ONG,DB: ⚠️ Fixed in a68f7af: origin used to be resolveArea(body.originCity),<br/>a CITY NAME posted by the shopper's browser — so the seller's real<br/>warehouse was ignored AND an untrusted client string set the price.<br/>sender_kecamatan_id IS a KiriminAja district id (same currency as<br/>destinationId): nothing to resolve, nothing to guess. No pickup<br/>address → fall back to the store's REGISTERED city and say so<br/>(originFrom:"store-city") — a fuzzy match is a guess, so show it.
    ONG->>DB: platform_couriers.enabled ∩ store_shipping_methods (per SERVICE)
    Note over ONG,DB: keyed "courier:service_type" — a service_type is only<br/>unique within its courier. NO rows = the merchant never<br/>opened the Jasa Kirim card → fall back to the courier-level<br/>list, never a checkout with zero shipping options
    ONG->>KA: kaShippingPrice(origin, destination, weight)
    KA-->>ONG: services[] (each with a raw cod flag)
    ONG->>COD: getCodPolicy(store.id)
    Note over ONG,COD: rate.cod = KiriminAja's cod<br/>AND policy.allows(service, serviceType)<br/>— the EFFECTIVE flag, not the raw one
    ONG-->>SF: {rates[], codEnabled}

    S->>SF: pick service + channel, submit
    SF->>ORD: {storeSlug, items, customer, address,<br/>shipping:{service,serviceType,cost,destId}, channelCode}

    rect rgb(255, 240, 240)
        Note over ORD,COD: ── THE COD GATE — before ANY row is written ──
        ORD->>ORD: rateLimited(req,"order",10,60_000) → 429?
        ORD->>DB: stores WHERE slug = storeSlug
        ORD->>ORD: total = subtotal + shippingIdr
        alt channelCode === "cod"
            ORD->>COD: getCodPolicy(store.id)
            ORD->>DB: provinceForDistrict(destId)
            Note over ORD: province comes from the DISTRICT the quote<br/>was issued for — NOT address.provinsi,<br/>which the buyer types and can lie about
            alt district unverifiable AND allowedProvinces is non-empty
                ORD-->>SF: 403 cod_not_allowed (FAIL CLOSED)
            end
            ORD->>COD: policy.reason({courier, serviceType, total, province})
            Note over COD: 1 platform_cod.enabled<br/>2 store_settings.cod_enabled<br/>3 total <= platform_cod.max_amount_idr<br/>4 province ∈ allowed_provinces (normalised)<br/>5 platform_couriers.services[].cod && codAllowed
            alt any of the five fails
                ORD-->>SF: 403 {code:"cod_not_allowed", error}
            end
        end
    end

    ORD->>DB: upsert customers (by email, within store)
    ORD->>DB: resolve each item → product_variants, then check inventory_levels
    alt any line is short
        ORD-->>SF: {ok:false, "Stok … tidak mencukupi"} — nothing written
    end
    ORD->>DB: INSERT orders (status='baru', financial_status='pending')
    ORD->>DB: INSERT order_line_items[]
    ORD->>DB: UPDATE inventory_levels SET available = GREATEST(available - qty, 0)

    ORD->>DB: UPDATE checkout_sessions SET status='pulih', recovered_order_id, recovered_at, customer_id<br/>WHERE store_id = ? AND session_id = ?
    Note over ORD,DB: THIS session became THAT order — the only honest<br/>definition of "recovered". Non-fatal by design: a paid<br/>order must never fail because a marketing table did.

    alt COD
        ORD->>DB: INSERT payments (method='cod', status='menunggu', provider='cod')
        Note over ORD,DB: menunggu, NOT berhasil — the platform holds<br/>NOTHING at checkout. Cash exists at the door.
        ORD-->>SF: {ok, orderNumber, cod:true}
    else prepaid (VA / QRIS / e-wallet)
        ORD->>AL: alCreatePayment({reffId: order.number, channelCode, amount: total, callbackUrl})
        AL-->>ORD: {trxId, virtualAccount|qr|paymentCode, admin, total}
        ORD->>DB: INSERT payments (status='menunggu', provider='autolaris', trx_id, reff_id)
        ORD-->>SF: {ok, orderNumber, payment:{channel:{code,label,kind}, va|qr|url}}
        Note over SF: only a GENERIC channel label crosses the wire —<br/>the PSP brand is never exposed (ADR 0004)
    end
    SF->>S: redirect /checkout/sukses
```

**Instant (same-day) is a separate leg.** If the shopper picks an instant service, `/api/public/order` calls
`kaCreateInstantOrder()` with the store's `sender_lat/lng` and, on success, sets `orders.awb`, `orders.courier`,
`orders.ka_order_id` and jumps the order straight to `dikirim`. Instant is **never COD** — `lib/cod.ts` nulls the
service out for instant orders because instant is not in the roster.

---

## 2. Payment callback (AutoLaris → admin)

Single endpoint, four jobs: mark the payment, sync the order, **credit the ledger**, and extend subscriptions.

```mermaid
sequenceDiagram
    autonumber
    participant AL as AutoLaris
    participant CB as admin<br/>POST /api/public/pay/callback
    participant LC as lib/ledger-credit.ts<br/>creditSaleForPayment()
    participant DB as PostgreSQL

    AL->>CB: POST {trx_id, reff_id, status:"PAID"|"EXPIRED"}<br/>X-Callback-Token: <secret>

    rect rgb(255, 240, 240)
        Note over CB: ── AUTH — fails CLOSED in production ──
        CB->>CB: rateLimit(`paycb:${clientIp}`, 60, 60_000) → 429?
        CB->>CB: secretOk(provided)
        Note over CB: expected = process.env.AUTOLARIS_CALLBACK_SECRET<br/>if UNSET and NODE_ENV === "production" → return false<br/>(it used to `return true` + console.warn — a landmine:<br/>a cleared env var silently opened the endpoint that<br/>marks orders PAID and extends subscriptions)<br/>else timingSafeEqual(provided, expected)
        alt !secretOk
            CB-->>AL: 401 {ok:false, error:"unauthorized"}
        end
    end

    CB->>CB: mapped = PAID→'berhasil' | EXPIRED→'gagal' | else null
    CB->>DB: UPDATE payments SET status=mapped, paid_at=…<br/>WHERE (trx_id=? OR reff_id=?) AND status <> mapped
    Note over CB,DB: the `status <> mapped` predicate is the idempotency<br/>guard — an AutoLaris retry updates 0 rows and returns nothing

    alt mapped = 'berhasil'
        loop each updated payment row
            CB->>DB: UPDATE orders SET financial_status='dibayar'
            CB->>LC: creditSaleForPayment(db, payment.id)
            LC->>DB: INSERT ledger_entries (kind='sale', amount_idr = payments.amount_idr)<br/>status = CASE WHEN orders.status IN ('selesai','retur')<br/>THEN 'available' ELSE 'pending' END<br/>WHERE payments.status='berhasil' AND orders.status <> 'batal'<br/>ON CONFLICT DO NOTHING
            Note over LC,DB: double-credit is impossible because of the DB,<br/>not because of a check-then-write in the app:<br/>UNIQUE INDEX ledger_one_sale_per_payment (0041)
        end
    end

    Note over CB,DB: ── the SAME endpoint also settles subscription invoices ──
    CB->>DB: UPDATE invoices SET status=… WHERE (trx_id|reff_id) AND kind='subscription'
    alt paid
        CB->>DB: UPDATE stores SET current_period_end = addMonths(max(now, cpe), periodMonths),<br/>first_invoice_paid = true, status = 'active'
    end
    CB-->>AL: 200 {ok:true}
    Note over CB,AL: always 200 for AUTHORIZED callers so AutoLaris<br/>does not retry forever. Unauthorized still gets 401.
```

**Amount, precisely.** The ledger credits `payments.amount_idr` (the order total the merchant is owed), **not**
`payments.total` (which adds the gateway's admin fee — the gateway's money, never the merchant's). This is what keeps
Dashboard revenue, the Pesanan list and the Saldo ledger the same number.

---

## 3. Order lifecycle — and what each transition does to inventory and to the ledger

One function: `apps/admin/lib/actions/orders.ts#setOrderStatus`. Guarded by `requireCapability("orders:write")`,
then the whole body — the status change, the inventory move and the ledger move — runs inside **one**
`withTenant(storeId, …)` transaction, so the book can never disagree with the order it describes.

```mermaid
stateDiagram-v2
    [*] --> baru : /api/public/order writes the row<br/>inventory DECREMENTED here
    baru --> diproses
    diproses --> dikirim
    dikirim --> selesai
    baru --> batal
    diproses --> batal
    dikirim --> batal
    dikirim --> retur : "Tandai retur" + reason
    selesai --> retur : parcel comes back
    selesai --> [*]
    batal --> [*]
    retur --> [*]
```

| Transition | Inventory | Payments | Ledger (`settleOrderLedger`) |
|---|---|---|---|
| **→ `baru`** (order created) | **−qty** on each `inventory_levels` row (`GREATEST(available - qty, 0)`) | prepaid: `menunggu` bill · COD: `menunggu` COD row | nothing — no money has been collected |
| `baru → diproses → dikirim` | unchanged | unchanged | nothing. **Release does NOT happen at despatch**, deliberately: a parcel can only be *returned* after it shipped, and for COD the cash does not exist yet |
| **→ `selesai`** | unchanged | `collectCodOnDelivery()` flips any `method='cod' AND status='menunggu'` payment to **`berhasil`** — `selesai` **is** the delivery signal (there is no courier "delivered" webhook) | `creditSalesForOrder()` books anything collected and not yet in the book, then `UPDATE ledger_entries SET status='available', available_at=now() WHERE order_id=? AND kind='sale' AND status='pending'` |
| **→ `batal`** | **+qty restored** | any `menunggu` payment → **`gagal`** | nothing is booked (`creditSaleForPayment` explicitly skips `orders.status='batal'`) |
| **→ `retur`** | **+qty restored** — the goods are back on the shelf, same as `batal` | any `menunggu` payment → **`gagal`** (a refused COD parcel collected no cash) | an **OPPOSING entry**, never an edit of the sale: `INSERT ledger_entries (kind='retur', amount_idr = -sale.amount_idr, status = sale.status)`. Also sets `orders.returned_at` + `return_reason`. |

Two subtleties that are easy to get wrong and are handled:

1. **The claw-back carries the SAME status as the sale it reverses.** A parcel can be returned straight from `dikirim`,
   where the sale is still `pending`. Reversing that out of `available` (as an earlier version did, unconditionally)
   would drive the withdrawable balance **negative** while the held pool still showed the money. Reverse a pending sale
   out of `pending`, a released one out of `available`; either way the pair nets to zero.
2. **The inventory restore is guarded on the previous status** (`if (restores && order.status !== status)`), so a repeat
   click cannot double-restore stock. The ledger's equivalent guarantee is the DB's:
   `UNIQUE INDEX ledger_one_retur_per_order`.

---

## 4. Money — sale → pending → available → payout → approval / rejection

The balance is **derived, never stored**: `Σ amount_idr WHERE status='available'`. A stored balance is a number that can
silently disagree with the movements that produced it; a derived one cannot.

```mermaid
sequenceDiagram
    autonumber
    actor M as Merchant (owner)
    participant SAL as admin /saldo
    participant RP as lib/actions/ledger.ts<br/>requestPayout()
    participant DB as PostgreSQL
    actor OP as Platform operator
    participant PC as super-admin /pencairan<br/>lib/actions.ts

    Note over DB: money arrives → callback → ledger_entries(kind='sale', status='pending')
    Note over DB: order reaches 'selesai' → settleOrderLedger →<br/>status='available', available_at=now()

    M->>SAL: read balance
    SAL->>DB: lib/data/ledger.ts#getBalance()<br/>Σ filter(available) / Σ filter(pending) / −Σ(kind='payout') / −Σ(kind='retur')

    M->>RP: Tarik saldo (amount)
    RP->>RP: requireCapability("settings:write")
    Note over RP: settings:write is OWNER-only — an `admin` role cannot withdraw

    rect rgb(240, 245, 255)
        Note over RP,DB: ── ONE transaction: withTenant(storeId) ──
        RP->>DB: store_settings.bank_{name,account,holder} — present?
        alt missing
            RP-->>M: "Lengkapi rekening bank dulu sebelum menarik saldo."
        end
        RP->>DB: platform_payout.min_payout_idr (fallback 50_000)
        RP->>DB: SELECT Σ amount_idr WHERE status='available' ... FOR UPDATE
        Note over RP,DB: FOR UPDATE is the whole point — two concurrent<br/>withdrawals would otherwise each read the same balance,<br/>each pass the check, and the merchant walks away with twice it.<br/>The check must HOLD until the write lands.
        alt want <= 0 | want < minPayout | want > available
            RP-->>M: reject, nothing written
        end
        RP->>DB: INSERT payouts (status='menunggu', bank_* SNAPSHOTTED)
        Note over RP,DB: bank details are copied onto the payout — if the merchant<br/>edits their account later, history must still show where<br/>the money actually went
        RP->>DB: INSERT ledger_entries (kind='payout', status='available', amount_idr = −want)
        Note over RP,DB: it leaves the available pool IMMEDIATELY — it is spoken for
    end
    RP-->>M: ok

    OP->>PC: /pencairan — queue
    PC->>DB: getPayouts() → payouts ⋈ stores

    alt Approve
        OP->>PC: processPayout(id)  [requirePlatformAdmin]
        PC->>DB: SELECT … FOR UPDATE, then UPDATE payouts SET status='diproses'
        Note over PC,DB: NO ledger write — the merchant was already debited at request time
        OP->>PC: markPayoutPaid(id) after the real bank transfer
        PC->>DB: UPDATE payouts SET status='selesai', paid_at=now()
        Note over PC,DB: still NO ledger write — re-crediting would double-count
        PC->>DB: platform_activity (kind='admin')
    else Reject
        OP->>PC: rejectPayout(id, reason)  [reason REQUIRED]
        rect rgb(255, 240, 240)
            PC->>DB: SELECT payouts FOR UPDATE — reject if already 'selesai' or 'gagal'
            PC->>DB: net = Σ amount_idr FROM ledger_entries WHERE payout_id = ?
            Note over PC,DB: the reversal is computed from what the LEDGER holds<br/>for this payout, NOT from payouts.amount_idr — so it is<br/>exact by construction and cannot over/under-refund if the<br/>two ever disagree. A payout already reversed nets to 0<br/>and posts nothing.
            PC->>DB: INSERT ledger_entries (kind='adjustment', status='available',<br/>amount_idr = −net, payout_id = same)
            Note over PC,DB: an OPPOSING entry, NOT an edit. The negative payout row<br/>stays — it is a true record of what happened. Replay the<br/>book and the two cancel to zero. APPEND-ONLY.
            PC->>DB: UPDATE payouts SET status='gagal', note=reason
        end
        PC->>DB: platform_activity — amount, reason, restored
    end
```

**Release timing.** `platform_payout.release_on` defaults to `'selesai'` and the super-admin can flip it to `'dikirim'`.
✅ **It IS read now (fixed 2026-07-14, `0776e99`).** `settleOrderLedger()` reads the row and releases at whatever it
says. It previously hardcoded `if (status === "selesai")`, so the toggle persisted and changed nothing — an operator
could flip it, believe the policy had changed, and it had not. **A knob that moves nothing is worse than no knob.**

The default should stay `selesai`. Release-on-despatch looks generous and is a trap: a shipped parcel can still come
back, so the merchant could withdraw money for goods that return — and on COD the cash does not exist at despatch at
all (the courier collects at the door and settles days later).

---

## 5. Shipping — roster sync → merchant selection → ongkir → shipment

```mermaid
sequenceDiagram
    autonumber
    actor OP as Platform operator
    participant SA as super-admin /pengaturan<br/>syncCouriersFromKiriminaja()
    participant KA as KiriminAja
    participant DB as PostgreSQL
    actor M as Merchant
    participant AD as admin /pengaturan<br/>Jasa Kirim
    actor S as Shopper
    participant ONG as POST /api/public/ongkir
    participant ORD as POST /api/public/order

    OP->>SA: "Sync dari KiriminAja"  [requirePlatformAdmin]
    SA->>KA: kaServices()
    Note over SA,KA: ⚠️ KiriminAja has NO list-couriers endpoint.<br/>kaServices() prices ONE hardcoded reference route<br/>(origin 2099 Menteng → dest 356 Coblong, 1kg, Rp100k)<br/>and harvests the services out of the shipping_price<br/>response. Cached 24h. The roster is only as complete<br/>as that single route.
    KA-->>SA: services[] {courier, serviceType, name, group, cod}
    SA->>DB: UPSERT platform_couriers.services (jsonb)<br/>{type, name, group, cod, codAllowed}
    Note over SA,DB: a previous super-admin codAllowed decision is PRESERVED —<br/>otherwise it follows KiriminAja's cod flag.<br/>Couriers KA no longer offers are DISABLED, never deleted<br/>(old orders still reference them).
    OP->>SA: tick per-service COD  → saveCodAllowed()
    SA->>DB: platform_couriers.services[].codAllowed
    Note over SA,DB: KiriminAja's own `cod` flag is the hard ceiling:<br/>codAllowed = s.cod && wanted

    M->>AD: pick SERVICES + COD toggle  [requireCapability("settings:write")]
    AD->>DB: store_shipping_methods (courier, service) — saveStoreServices()<br/>store_settings.cod_enabled — setCodEnabled()
    Note over AD,DB: the card says "Pilih layanan yang ditawarkan ke pembeli<br/>saat checkout" and each row states its COD status:<br/>green COD badge on SPX Standard + SPX Economy,<br/>"Tidak mendukung COD." on everything else

    S->>ONG: {op:"rates", storeSlug, destinationId, weight}
    ONG->>DB: origin = store_settings.sender_kecamatan_id (seller's pickup address)
    Note over ONG,DB: NOT body.originCity. Proven by moving the warehouse:<br/>Gubeng/Surabaya → Coblong/Bandung repriced SPX Standard<br/>Rp17.000 → Rp17.700 and SPX Economy Rp12.700 → Rp10.400,<br/>while an injected originCity:"Jakarta Pusat" was ignored.
    ONG->>DB: platformOn = platform_couriers WHERE enabled
    ONG->>DB: picked = store_shipping_methods WHERE enabled
    Note over ONG: effective = platformOn ∩ picked, keyed "courier:service_type"<br/>— platform is the HARD cap. ⚠️ Fixed in 35b88a4: this used to<br/>filter on store_settings.couriers (the COURIER list), so every<br/>SERVICE the seller switched off was still offered at checkout —<br/>14 rates for 11 picks. NO picked rows = fall back to the<br/>courier-level list rather than show zero options.
    ONG->>KA: kaShippingPrice(origin, destination, weight, itemValue)
    KA-->>ONG: rates[]
    ONG->>ONG: rate.cod = KA.cod && getCodPolicy(store).allows(service, serviceType)
    ONG-->>S: rates[] filtered to `effective`, each with the EFFECTIVE cod flag

    S->>ORD: submit (shipping.service, shipping.serviceType, shipping.destId)
    alt instant (same-day)
        ORD->>KA: kaCreateInstantOrder(origin = store sender_lat/lng, dest = shopper lat/lng)
        KA-->>ORD: {orderId}
        ORD->>DB: orders.awb = orderId, orders.courier = "<SVC> Instant",<br/>orders.ka_order_id, orders.status = 'dikirim'
    else regular
        Note over ORD,DB: ⚠️ NO shipment is booked at checkout.<br/>orders.courier / awb / ka_order_id stay NULL.<br/>kaCreateOrder() exists in packages/lib and is called from<br/>lib/actions/shipping.ts (merchant-initiated), NOT from the<br/>public order API. See STATUS.md — orders.courier is NULL<br/>on 700/700 rows in the live DB.
    end
```

Tracking: the storefront has **no** `/api/track`-style shipment lookup; `kaTrack()` exists in `packages/lib` and is
reachable from the merchant admin only.

---

## 6. Auth, session, and how RLS actually enforces tenancy

Three separate identities. They do not overlap.

| Identity | Table | Cookie | Guard |
|---|---|---|---|
| Merchant user | `users` ⋈ `store_users` (role) | `session` | `middleware.ts` (edge JWT) + `requireCapability(cap)` (real boundary) |
| Platform operator | `platform_admins` | `platform_session` | `middleware.ts` + `requirePlatformAdmin()` |
| Shopper | none — there is no shopper account system | none | `/akun` on the storefront is a **non-functional demo form** |

```mermaid
sequenceDiagram
    autonumber
    actor U as Merchant user
    participant MW as apps/admin/middleware.ts (edge)
    participant AU as lib/auth.ts
    participant RB as lib/rbac.ts<br/>requireCapability()
    participant TN as lib/tenant.ts<br/>withTenant / withCurrentTenant
    participant PG as PostgreSQL

    U->>AU: signIn(email, password)
    AU->>PG: findLogin() — users ⋈ store_users  [OWNER connection]
    Note over AU,PG: this read MUST be owner: there is no session yet,<br/>so there is no app.store_id to set. Under RLS it would<br/>lock everyone out.
    AU->>AU: verify scrypt "salt:hash" (timingSafeEqual)
    AU->>U: Set-Cookie: session = jose HS256 JWT {userId, storeId, role}<br/>httpOnly, AUTH_SECRET

    U->>MW: GET /pesanan  (cookie: session)
    MW->>MW: jwtVerify(token, AUTH_SECRET) — edge-safe, NO DB
    alt invalid
        MW-->>U: 302 /login  (+ X-Robots-Tag: noindex,nofollow)
    end

    rect rgb(240, 255, 240)
        Note over RB,PG: ── READ path (lib/data/*) ──
        MW->>TN: RSC render → getOrders()
        TN->>AU: getSession()
        TN->>PG: BEGIN
        TN->>PG: select set_config('app.store_id', $storeId, true)
        TN->>PG: SET LOCAL ROLE tokophi_app
        Note over TN,PG: no session ⇒ NIL UUID 00000000-…-0000 ⇒<br/>the policy matches no rows ⇒ FAILS CLOSED
        TN->>PG: SELECT … FROM orders
        Note over PG: POLICY tenant_isolation ON orders<br/>USING (store_id = app_current_store_id())<br/>app_current_store_id() =<br/>nullif(current_setting('app.store_id', true), '')::uuid
        PG-->>TN: only this store's rows — enforced by the DATABASE
        TN->>PG: COMMIT (role + GUC are transaction-local)
    end

    rect rgb(255, 250, 235)
        Note over RB,PG: ── WRITE path (lib/actions/*) ──
        U->>RB: server action, e.g. setOrderStatus()
        RB->>RB: session = getSession() → if (!can(role, cap)) throw ForbiddenError
        RB->>RB: if (getBilling().readOnly) throw SuspendedError
        Note over RB: subscription past its grace period ⇒ the whole panel is<br/>read-only. support:write opts out (allowSuspended) — a<br/>suspended store must still be able to ask us for help.
        RB->>TN: withTenant(session.storeId, …)
        TN->>PG: same GUC + SET LOCAL ROLE tokophi_app
        TN->>PG: UPDATE / INSERT …
        Note over PG: WITH CHECK (store_id = app_current_store_id())<br/>⇒ a forged cross-tenant insert raises<br/>"new row violates row-level security policy"
    end
```

**45 of the 70 tables carry that policy** (re-verified from `pg_class.relrowsecurity` on 2026-07-14). The DB, not
application code, is the tenant boundary — for the Seller panel (`apps/admin`).

**The deliberate exceptions**, and why:

| Exception | Connection | Why it is not a bug |
|---|---|---|
| `lib/auth.ts` | owner | Reads `store_users` before a session exists. |
| `apps/super-admin/**` | owner | Cross-tenant by definition. `withTenant` is never called there (grepped: zero source hits). |
| `apps/storefront` | owner | Resolves the tenant from `Host`, then reads that store's catalog + writes `analytics_events` (`/api/track`) and `checkout_sessions` (`/api/checkout-session`) with a **Host-derived** `store_id` (never client-supplied — the capture body has no field for one). |
| **`/api/public/*`** | owner + an explicit `store_id` from `storeSlug` | ⚠️ **The real hole.** The shopper has no session, so there is no GUC to set. Tenant correctness on the *checkout* path — the path that writes orders, payments and inventory — rests on application code. On the VPS this becomes PostgREST with the `store_id` JWT claim feeding the GUC. Until then, treat `/api/public/order` as unguarded by the database. |
| `/api/cron/billing` | owner | Iterates every store on purpose. |

---

## 7. Abandoned checkout — progressive capture, ageing, and WhatsApp recovery

Migrations **0044** / **0045**. The flow that has **no event of its own**: abandonment is the *absence*
of an order, so nothing fires when it happens. The row is therefore written **as the shopper types**,
and judged later by what never happened to it.

Indonesia abandons **82–83%** of carts (market research, not our measurement, against a ~70% global
figure) and we recorded **none** of them — while the CRM was already showing `keranjang` follow-ups
with a WhatsApp template ready to send, pointing at baskets that did not exist.

```mermaid
sequenceDiagram
    autonumber
    actor S as Shopper
    participant CO as storefront<br/>checkout.astro
    participant CAP as storefront<br/>POST /api/checkout-session
    participant ORD as admin<br/>POST /api/public/order
    participant DB as PostgreSQL
    actor M as Merchant
    participant KJ as admin<br/>/pelanggan/keranjang
    participant RC as lib/actions/checkout.ts<br/>recordCartContact()
    participant WA as WhatsApp (wa.me)

    rect rgb(240, 245, 255)
        Note over S,DB: ── PROGRESSIVE CAPTURE — there is no "abandon" event to wait for ──
        S->>CO: types name / phone / address
        CO->>CAP: debounced beacon (~1.2 s of quiet, flushed on blur,<br/>step change, visibilitychange and pagehide)
        Note over CO,CAP: sendBeacon on the way out. Fire-and-forget:<br/>a capture that dies must NEVER break a working checkout.
        CAP->>CAP: bot-UA reject · 60/min/IP · store = locals.store (HOST header)
        Note over CAP: a store id in the body is never read — the body has<br/>no place to put one. One shop cannot write a cart<br/>into another shop's funnel.
        CAP->>DB: UPSERT checkout_sessions ON (store_id, session_id)<br/>status='aktif', items snapshot, step = FURTHEST reached
        Note over CAP,DB: step never regresses — beacons have no ordering<br/>guarantee. setWhere status <> 'pulih' — a row that<br/>already became an order is settled history.
    end

    rect rgb(255, 250, 235)
        Note over CAP,DB: ── AGEING — opportunistic, no cron ──
        CAP->>DB: UPDATE checkout_sessions SET status='ditinggal',<br/>abandoned_at = coalesce(updated_at, created_at)<br/>WHERE status='aktif' AND updated_at < now() - 60 min
        Note over CAP,DB: at most once a minute per SSR process, on the store<br/>being written to, riding the (store_id, status,<br/>updated_at) index. abandoned_at is the moment it went<br/>QUIET, not "now" — and it is what separates a RESCUE<br/>from an ordinary sale later.
    end

    alt the shopper completes the checkout
        S->>ORD: POST /api/public/order (sessionId = the same id)
        ORD->>DB: INSERT orders + line items, decrement stock
        ORD->>DB: UPDATE checkout_sessions SET status='pulih',<br/>recovered_order_id, recovered_at, customer_id
        Note over ORD,DB: straight through → abandoned_at is NULL → an ORDINARY SALE<br/>came back after ditinggal → abandoned_at is set → a RESCUE
    else the merchant chases it
        M->>KJ: Keranjang Ditinggal — ranked by phone first,<br/>then basket value decayed by age
        KJ->>WA: wa.me deep link, `keranjang` wa_template pre-filled<br/>(+ /checkout?r=<signed HS256 JWT {sid, st}, 7 d>)
        M->>RC: recordCartContact(id)  [requireCapability crm:write]
        RC->>DB: INSERT followups (type='keranjang', sent_at=now,<br/>status='menunggu')
        Note over RC,DB: sent_at means "WA DIBUKA", never "terkirim".<br/>wa.me is a deep link — delivery and read are things<br/>we cannot observe, so we do not claim them.
        S->>CO: clicks the link → verifyRecoveryToken(r, store.id)
        Note over CO: store-bound and self-expiring. NOT a raw session id,<br/>which would be a bearer credential over a stranger's<br/>name, phone and address the moment the link leaks.
        CO->>DB: restore basket + typed fields from the snapshot<br/>(the price the shopper SAW, not today's price)
        Note over CO,DB: a `pulih` row is never re-hydrated — it was already<br/>bought, and re-offering it would push a double purchase.
    end
```

### 7.1 The four numbers on the screen, and why one of them needed a migration

Every figure on `/pelanggan/keranjang` is a `count` / `sum` over `checkout_sessions` + `orders`
(`apps/admin/lib/data/checkout.ts`, wrapped in `withCurrentTenant`). Nothing is modelled, blended or
estimated, and what cannot be counted — *was the message delivered? read?* — is **not shown at all**.

```sql
rescued       = abandoned_at IS NOT NULL AND recovered_at IS NOT NULL   -- a save
straight-thru = abandoned_at IS NULL     AND recovered_at IS NOT NULL   -- an ordinary sale, NOT a save
abandonRate   = ditinggal / (ditinggal + orders)
recoveryRate  = rescued   / (rescued + ditinggal)
```

**`aktif` sessions are excluded from both sides of both ratios** — the shopper is still typing, and
nobody has abandoned anything yet. An order counts as a completed checkout **even if it was later
cancelled**: the checkout still finished.

**Why `abandoned_at` (0045) had to exist.** A checkout that sailed straight through *also* ends as
`status='pulih'`. On the local data (store `batik-nusantara`, 30-day window anchored at
`CHECKOUT_TODAY = 2026-07-02`): **792 ditinggal · 198 orders · 100 rescued · 90 straight-through** →
abandonRate **80,0%**, recoveryRate **11,2%**. The naive `pulih / (pulih + ditinggal)` reports
**19,3%** on that same data — it would tell a shop it "rescued" every ordinary sale it ever made. A
number that looks real and is wrong is worse than no number.

**`phone` is the column this table is paid for.** Recovery in Indonesia travels on WhatsApp, not email,
so the list ranks carts with a number first and says plainly that the rest (`anonim`) cannot be
contacted at all — rather than quietly hiding them and implying every cart is actionable.

---

## 8. Ad click → order → conversion at the provider (ADR 0011 / 0012 / 0013)

Two halves of ONE sale. The shopper's browser and our server both report it, and they carry the **same
`event_id`**, so the provider counts one conversion rather than two. Everything here is per store — the
pixel id and the CAPI token belong to the merchant, not to TokoΦ (ADR 0012).

### The rules this flow exists to protect

1. **The order row is the evidence, never the request.** `purchaseFacts()` re-reads value, line items,
   discount, ongkir and PPN from the database (`apps/admin/lib/tracking-events.ts`). A success page is
   not proof that a sale happened.
2. **One id helper, or nothing matches.** `<g:id>` in the feed and `content_ids` in every event both come
   from `retailerId()` (`packages/lib/src/tracking-ids.ts`), with `stores.catalog_id_scheme` as a
   *parameter*, never an `if` at a call site. A mismatch does not degrade matching — it **zeroes** it.
3. **Prepaid is not a conversion until the money lands.** COD converts at the thanks page; VA/QRIS is
   enqueued HELD (parked at `2126-01-01`) and released by the payment callback.
4. **`value` does not mean the same thing to every provider.** Meta and TikTok take the all-in total;
   GA4 takes goods only (subtotal − discount), with `shipping` and `tax` as their own parameters. All
   four numbers ride on the delivery row so the sender chooses, instead of one figure lying to two of
   them. Browser and server must compute goods **identically** or GA4 receives two revenues for one
   `transaction_id`.
5. **Every layout a shopper can convert under must render `MarketingPixels`.** `CheckoutLayout` was
   missed once and `LandingLayout` twice — the second time it cost the entire paid-traffic funnel, with
   build, lint and `astro check` all green.

### The path

```
LANDING (any page)                  MarketingPixels.astro
  ?fbclid / ?gclid / ?ttclid   →    vendor SDKs write _fbc / _gcl_aw; we persist ttclid (28 d)
  ?utm_source / ?utm_medium    →    we persist utm (30 d) — the ONLY signal that says "paid"
  PageView · ViewContent (exact variant id, ADR 0013 §7.2)

CHECKOUT  /checkout  or  /promo/<handle> · /lp/<slug>  (OrderFunnel)
  InitiateCheckout — exact ids win; value and units describe the SAME lines as the ids
  POST /api/public/order  { trackingCookies: { fbp, fbc, ga, gcl, ttp, ttclid, utmSource, utmMedium } }

SERVER  api/public/order
  adChannel(trackingCookies)  →  orders.channel        (lib/ad-channel.ts)
  enqueuePurchase(store, order, client, { hold: !isCod })
      → one tracking_event_deliveries row per configured channel
      → COD: due now.   Prepaid: parked at 2126-01-01 (HELD)
  responds { tracking: { eventId, contentIds, browserPurchase } }

BROWSER  /checkout/sukses  or  /thanks
  Purchase, only when the SERVER said browserPurchase === true

PAYMENT  api/public/pay/callback  →  releasePurchase()  →  held rows become due

CRON  api/cron/tracking-events, every 60 s
  purge (30 d) → reconcile (release paid, back-fill missing) → claim → send → verdict
```

### 8.1 Facts worth stating once, here

- **`event_id` is `purchase:{order_number}`, the order number alone.** ADR 0012 §14.3 proposed
  `purchase:{store_id}:{order_id}`; `orders.number` already carries a platform-wide unique constraint, so
  the store namespace buys no collision resistance and would publish the tenant key into three ad
  platforms' logs. An identifier handed to Meta cannot be un-handed.
- **`fbclid` is NOT proof of an ad.** Meta appends it to every outbound Facebook/Instagram/Messenger
  link, organic included. Google's `gclid` and TikTok's `ttclid` really are paid-only. So `adChannel`
  reads `utm_medium` first, then the paid-only click ids, and books a bare `_fbc` as `other` — "came
  from Meta", not "came from a Meta ad". A merchant who tags their ad URLs (`utm_medium=cpc`) gets
  `meta_ads` properly; one who does not gets an honest `Lainnya` instead of inflated ad revenue.
- **`send_to` is mandatory on the GA4-shaped gtag event.** Without it gtag broadcasts to the DEFAULT
  group — including any `AW-` tag configured on the same page — and Google Ads receives two purchases
  per sale, only one of which carries a `transaction_id`.
- **The browser Purchase is gated by the server.** `browserPurchase` is true only for COD:
  `/checkout/sukses` is where an **unpaid** VA/QR is displayed, so firing there for a prepaid order
  would report a conversion for every abandoned payment screen.
- **A store with no channel configured pays nothing.** `enqueuePurchase` checks `store_tracking_channels`
  FIRST, before building the four-query fact set, because it runs inline on the checkout's hot path.
- **Non-fatal by contract.** Callers wrap `enqueuePurchase` in try/catch — a marketing table must never
  fail an order. Which is exactly why the cron's back-fill sweep has to exist.
- **Ops:** sidecar `cron-tracking-events` (`sleep 60`) in `docker-compose.coolify.yml`. Needs
  `CRON_SECRET` (fail-closed in production) **and** `INTEGRATION_TOKEN_KEY`. See `DEPLOY.md`.
