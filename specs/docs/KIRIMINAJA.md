# KiriminAja — the courier API, by flow

What the vendor documents, what TokoΦ actually calls, and where the two differ. Read this with
`FLOWS.md` §5 (which owns the *product* flow: address cascade → quote → order snapshot → booking →
label). This file owns the *vendor contract*.

Source: the captured docs at `~/Documents/kiriminaja/documents/` — 34 pages, 10 sections, captured
2026-07-07 from developer.kiriminaja.com. Re-read them before trusting anything here.

> **⚠️ The captured docs give HTTP verbs, not paths.** 25 of the 34 pages render `**Endpoint**: POST`
> with no URL after it — the portal's path widget was not captured. The only full URLs anywhere in the
> corpus are three instant-delivery curl samples. **Every path in the "we call" column below came from
> our own working code, not from the docs.** Do not invent a path for an endpoint we do not yet call;
> get it from the portal or from KiriminAja support.

| Environment | Base URL |
|---|---|
| Sandbox | `https://tdev.kiriminaja.com` |
| Production | `https://client.kiriminaja.com` |

`packages/lib/src/kiriminaja.ts` picks between them on `KIRIMINAJA_ENV === "production"`. Headers are
`Authorization: Bearer {api_key}`, `Accept: application/json`, `Content-Type: application/json`.
**The API is otherwise identical between the two** — cutover is an endpoint swap, not a port (#145).

## ⚠️ The sandbox enforces an IP ALLOW-LIST — and the platform's egress IP is the VPS IP

Learned 2026-09-07, after the VPS came back from a 70-hour billing suspension (`STATUS.md`,
`SLA-DRP.md` §2): every call to `tdev.kiriminaja.com` answered

```
401 {"status":false,"text":"Your IP address 45.77.33.112 were not allowed to access this API", ...}
```

— on `province` (the read-only connectivity check) and therefore on `shipping_price` too, so
`/api/public/ongkir` `op:"rates"` returned `SHIPPING_QUOTE_UNAVAILABLE` and **no order could be
placed** (the shopper string is ours by ADR 0004; the vendor's `text` only appears in the admin
container's `console.error`). Facts established from inside the admin container:

- **The key was intact and `KIRIMINAJA_ENV` was `sandbox`** — this was not a lost secret.
- **Our egress IP is exactly the VPS IP, `45.77.33.112`** (`fetch("https://api.ipify.org")` from the
  container). All four services share the box's one public address; Cloudflare sits in front of
  *inbound* traffic only and does not proxy our calls out.
- The developer sandbox keys are bound to an **IP allow-list on the KiriminAja developer portal**,
  and that list is what refused us. Fixing it is an **owner action on the vendor side** (portal or a
  KiriminAja support ticket); nothing in this repo can change it. Whether the list was reset by the
  provider, expired, or was never re-entered after the box was re-provisioned is **not known** — do
  not guess; ask KiriminAja.
- **Consequence for any future host move (Vultr → Hetzner, `DEPLOY.md`):** a new box is a new egress
  IP, and the sandbox — and presumably production — will refuse it until the allow-list is updated.
  Put "register the new IP with KiriminAja" on the migration checklist, *before* DNS moves.

**The probe** (run where the key already lives; it never prints the key — `DEPLOY.md` → "KiriminAja
401 after a restart" has the full three-step version):
```bash
docker exec $(docker ps --format '{{.Names}}' | grep -m1 '^admin-') node --input-type=module -e 'const r=await fetch("https://tdev.kiriminaja.com/api/mitra/province",{method:"POST",headers:{Authorization:"Bearer "+process.env.KIRIMINAJA_API_KEY,"Content-Type":"application/json"},body:"{}"}); console.log(r.status, await r.text())'
```
`200` + `{"status":true,"datas":[…]}` = allowed. `401` + the sentence above = allow-list.
Anything else is a different problem (key missing → `Shipping belum dikonfigurasi.` from our own
route; network → a thrown fetch error).

## What we call today

| Purpose | Path we call | Version status |
|---|---|---|
| Resolve an area by name | `/api/mitra/v2/get_address_by_name` | current |
| Quote a parcel | `/api/mitra/v6.1/shipping_price` | current |
| **Book + request pickup** | `/api/mitra/v6.2/request_pickup` | **current — migrated 2026-08-20 (N40)** |
| Cancel a shipment | `/api/mitra/v3/cancel_shipment` | current |
| Track | `/api/mitra/tracking` | current |
| Province list | `/api/mitra/province` | current |

## 1. Pickup is not a separate step

There is **no standalone "request pickup" endpoint.** Creating the express order *is* the pickup
request: the response's `method` is `request_pickup` and its text is `"Request pickup berhasil"`.
Pickup vs drop-off is a per-package boolean:

> `drop` — `true` = drop-off / cashless, `false` = pickup. Nullable; **default NOT STATED IN DOCS.**

⚠️ Because that default is undocumented, `kaCreateOrder` now sends **`drop: false` explicitly**. Every
booking this product makes is a pickup and the whole "Resi terbit" flow assumes it; pinning the value
we already depend on costs one field and removes a silent behaviour change from the vendor's side.

We never send `drop`, and our sandbox bookings come back as pickups, so the effective default is
pickup. Only **JNE, SiCepat and ID Express** support drop-off at all; all 15 express 3PLs support
pickup. Drop-off also changes the label (see §4).

The booking response carries three identifiers:

| Field | What it is | Do we keep it? |
|---|---|---|
| `details[].kj_order_id` | KiriminAja's internal order id | ✅ `orders.ka_order_id` |
| `details[].awb` | the waybill — **`null` at booking**, arrives later | ✅ `orders.awb` |
| `pickup_number` | the pickup number — **and the `payment_id`** | ❌ **dropped** |

`pickup_number` is what the Payment API takes as `payment_id` to answer "has this shipment been paid
for?" (`status_code`: `9` = unpaid, `0` = paid). We return it from `kaCreateOrder` and throw it away,
so we cannot reconcile a booking against its payment, and a merchant cannot quote it to support.

## 2. The pickup schedule

`schedule` is required at booking, format `YYYY-MM-DD HH:mm:ss`, in **"local time"** — the docs never
name WIB/WITA/WIT and the string carries no offset. We send tomorrow 10:00 in Asia/Jakarta.

There is a schedule-discovery endpoint (`POST`, path NOT STATED IN DOCS; **it has no documented
request body at all**) returning available windows:

```json
{ "clock": "2021-02-15 14:00:00", "until": "16:00", "expired": 1613385000, "libur": false }
```

`clock` = window start, `until` = window end (`HH:mm`), `expired` = unix ts when the slot stops being
offered, **`libur` = holiday flag**.

**We do not call it, and the docs say that is allowed:**

> "If your company prefers a fixed daily pickup process, you can set custom pickup hours and skip this
> endpoint." / "You can use your own working-hours pickup schedule, as long as pickup is requested
> before 16:00 (4:00 PM) local time."

So our fixed schedule is a legitimate choice, not a bug. What it costs us is the **`libur` flag** — we
have no way to know the courier is closed. NOT STATED IN DOCS: what happens if you book a `libur: true`
date, or submit a request after 16:00. Per-3PL cut-offs are mostly `false`; only **J&T Same Day
(10:00)** and **Paxel (14:00)** publish one. Per-service `cut_off_time` comes back on both the pricing
response and the courier-detail endpoint.

## 3. Status codes → order state

The vendor documents **38 codes** in three groups (Entry 100–105, Shipment 106–905, Final). The full
table with our mapping is encoded as a runnable guard: **`apps/admin/lib/ka-status-codes.test.ts`** —
that suite, not this paragraph, is the source of truth, and it fails if the mapping drifts.

Terminal (the "Final State" table): **200, 300, 333, 400, 500, 555, 703, 704**. Note that 333, 500 and
555 appear in *both* the Shipment and Final tables with identical wording; the docs never explain the
overlap.

Codes we deliberately do **not** map: `210` (SOP violation) / `211` (resolved) — flagging 210 without
a path that lowers the flag on 211 leaves a resolved violation reading as stuck forever; and `350`
(pickup cancellation *requested*, not granted).

## 4. The shipping label — we render it, there is no endpoint

**NOT STATED IN DOCS: any label endpoint, URL, format or size.** The booking response returns no label
field. `03-important-notes/03-shipping-label.md` is a *specification for a label you print yourself*,
and it lists required fields. Ours is `apps/admin/components/admin/pesanan/shipping-label.ts`
(100×150 mm, real Code 128 encoding of the AWB).

Required fields we do **not** print: **Sorting Code** (SPX additionally requires a *2-column* sorting
code, and SPX is our primary courier + COD rail), **Insurance Information**, **postal code** on sender
and recipient, **sender phone**, **service type**, and item **prices**. Sorting-code *values* must be
requested from KiriminAja (`tech@kiriminaja.com` or your PIC) — and `sorting_code` is also delivered
on the `processed_packages` webhook, which we do not receive (§5).

Courier-specific label rules: **JNE drop-off** must prefix the shipping type with `CASHLESS`; **J&T
Cargo** must print a routing code; **SPX** needs the 2-column sorting code. The JNE rule does not
apply to us today because we book pickups, not drop-offs.

The docs ask for barcode symbology "128A"; we emit Code 128-**B**. Any Code 128 variant decodes to the
same string and AWBs are uppercase alphanumeric, so this is a divergence worth knowing, not a defect.

## 5. Webhooks — they exist, we use none of them

Registration is `POST` with body `{"url": "..."}` (**path NOT STATED IN DOCS** — this is what blocks
us). One callback URL per account; it must resolve to a valid A/AAAA record.

Events, all carrying the AWB except the deprecated one:

| `method` | Meaning |
|---|---|
| `processed_packages` | **AWB created** — also the only carrier of `sorting_code` |
| `shipped_packages` | picked up by the courier |
| `canceled_packages` | canceled |
| `finished_packages` | delivered |
| `returned_packages` | returned (complete only once `returned_at` is populated) |
| `return_finished_packages` | **deprecated** — use `returned_packages` |

**There is no signature scheme.** No HMAC, no `X-Signature`, no timestamp/replay protection, no
documented IP allowlist. Authentication is a plain `Authorization: Bearer {api_key}` header — and the
docs never say *whose* key that is. A receiver can therefore only constant-time compare the bearer
against the expected key; `User-Agent: KiriminAja-Push-Services` is trivially spoofable and is not
auth.

**KiriminAja documents no server-side retry** — the retry advice is aimed at the *client*, and the
page says outright that a slow endpoint "may result in missed notifications". There is no event id,
so de-duplication has to key off `order_id` + `awb` + `method`. Both event pages name the fallback
themselves:

> "If our webhook endpoint is unavailable, use the Tracking API to pull shipment status directly."

**So a webhook must be added *beside* our 15-minute poller, never instead of it.** The poller is the
reconciliation path the vendor itself prescribes; the webhook is what makes the resi appear in seconds
rather than up to 15 minutes.

## 6. Paying KiriminAja — VA and COD are opposite directions

**One booking call carries two money flows, and they must never be conflated:**

| | **NON-COD (VA)** | **COD** |
|---|---|---|
| Who pays the courier | **we do** | the **buyer** does, at the door |
| Direction | us → KiriminAja | buyer → KiriminAja → merchant |
| `payment_method` | defaults to **`va`** | **ignored by the vendor** |
| Response carries | `payment_status`, `qr_url` | settlement scheme, no VA to pay |
| If unsettled | ⚠️ **no waybill is issued — the parcel does not ship** | n/a, nothing is owed |

The vendor is explicit: *"For COD packages, the system will automatically use the COD settlement
scheme; the `payment_method` field is ignored"*, and it rejects the combination outright with code
**4003** (`"Paket COD tidak dapat dibayar dengan KA Credit"`).

**The failure this separation exists to prevent:** a non-COD booking comes back `payment_status:
"unpaid"` with a `qr_url`, nobody pays it, **no waybill is ever issued** — so the tracking poller
finds nothing, the resi never appears, and the order reads "dibooking" on every screen with nothing
anywhere saying why. All three fields were parsed and thrown away, so the case was invisible.

Since **0088** we store what the vendor returned, verbatim: `orders.ka_pickup_number` (the vendor
also calls this the **`payment_id`**), `ka_payment_status`, `ka_payment_url`, plus
`ka_shipping_cost_idr` — the cost side of ongkir, which the DB had never held (`shipping_idr` is what
the *shopper* paid, and the seller may book a cheaper service than the shopper picked).

⚠️ **`apps/admin/lib/shipment-payment.ts` is the ONE place that separates the two flows**, and it
decides from the ORDER's own COD flag (`payments.method = 'cod'`), never from the vendor's payment
fields — the docs do not define what `payment_status` holds for a COD package, and guessing there
would put a false "belum dibayar" on parcels nobody owes anything for. NULL means *no reading*
(every booking before 0088), never *unpaid*.

v6.2 adds `payment_method: "credit"` (KA Credit), needing a 6-digit `pin` validated beforehand. KA
Credit **top-up and transaction history have no API** — dashboard only.

🔴 **COD settlement itself is NOT STATED IN DOCS**: no settlement endpoint, no disbursement schedule,
no fee schedule, no settlement webhook. And **we do not model it** — see **N42**: on `selesai` a COD
merchant is credited the **gross** total including ongkir as immediately-`available` money, while
KiriminAja remits **net** of the shipping cost it keeps. That difference is currently paid out of the
platform's own float.

## 7. Volumetric divisors

Round 0.3 / divisor **6000** for every courier a seller may use. The exceptions are **J&T Cargo
(5000)** and **Sentral Cargo (4000)** — both platform-only, so our `÷6000` is correct for the seller
set today and would be wrong the day J&T Cargo is offered.

## Open questions — do not guess these

Registration path for webhooks · paths for the schedule, payment, KA-Credit and utility endpoints ·
the named timezone behind "local time" · behaviour after the 16:00 cut-off · behaviour when booking a
`libur: true` date · the default value of `drop` (still undocumented — we now send it explicitly
rather than rely on it) · how to cancel before an AWB exists (cancellation takes the **AWB and only
the AWB**, which does not exist at booking) · what `package_type_id: 9` changes (the v6.2 doc offers
it for "regular packages" and its example sends it; the semantics are undocumented and cannot be
probed without booking, so we keep **7**).

### ✅ ANSWERED 2026-08-20 — the v6.2 destination fields

**Neither.** The question was `destination_province_id` vs `destination_provinsi_id`; the sandbox's
answer is that **v6.1's names ARE the v6.2 names** — `destination_kecamatan_id` and
`destination_kelurahan_id`, both `int`. v6.2 is a Go service, so sending a candidate field with the
wrong JSON type makes the unmarshal name the real struct field and stay silent for one that does not
exist; only those two bind (`RequestPickupV62RequestPackage`). Every name unique to the v6.2 doc —
including the table's `destination_subdistrict_id`/`destination_village_id` — is silently ignored,
and the doc omits the village field it actually has. Field-by-field evidence:
`specs/docs/tasks/2026-08-12-n40-v62-contract.md`.

### ⚠️ Two v6.2 behaviours that differ from v6.1, both measured

1. **Errors come back as HTTP 400**, often with no `method` field, where v6.1 used HTTP 200 with
   `{status:false}`. `ka()` parses the body regardless of status and callers read only
   `status`/`text`, which is why the migration was one line — **do not add an HTTP-status check.**
2. **A fresh booking answers `awb: ""`, not `awb: null`** (measured on the one authorised booking,
   2026-08-20: `kj_order_id 5758-…`, `pickup_number EPR-…`). `kaCreateOrder` normalises the empty
   string away, so `orders.awb` stays NULL until a courier really issues a waybill. An empty string
   is not a waybill: nothing crashes on it, but the row would claim one it does not have and
   `(awb is not null)` sorts it to the back of the tracking poller's queue.
   Also measured: a nonexistent destination id gets v6.2's **generic** create error instead of
   v6.1's specific *"Tujuan pengiriman … doesn't exists"* — the seller-facing message for a bad
   destination is less useful now, and that is the vendor's, not ours.

## The vendor publishes a machine-readable spec — read THAT, not the SPA (found 2026-09-09)

`https://developer.kiriminaja.com/docs` is a client-rendered page: fetching it returns a title and
nothing else, which is why previous passes here worked from prose and measurement. The sitemap names
the real source:

```
https://developer.kiriminaja.com/docs/openapi/json     # OpenAPI 3.1.0, info.version 6.2.0, ~199 KB
```

Retrieved 2026-09-09. **25 documented paths.** Check it against the client before assuming drift; it is the
only vendor artefact here that can be diffed.

### What the spec CONFIRMS about what we already shipped

| our code | the spec says | verdict |
|---|---|---|
| `v6.2/request_pickup` (migrated 2026-08-20, N40) | documented, and it is the newest pickup path | current |
| `v6.1/shipping_price` | **there is no v6.2 rate endpoint** — v6.1 IS the current one | current, not stale |
| `v3/cancel_shipment` takes the **AWB**, reason 5–200 chars | *"using its AWB, not the merchant order ID"*, *"The reason must contain 5 to 200 characters"* | confirmed |
| a non-COD void is queued, `status:true` ≠ cancelled | *"COD packages are canceled immediately. Non-COD packages may remain pending for up to 48 hours"*, example `data.success: "pending"`, text *"Paket akan dibatalkan dalam 2x24jam"* | confirmed |
| Task 5.1's reconciler maps tracking **300/302 → voided** | the status table: **`300` Canceled by client**, **`302` Pickup canceled by seller** (`300` is listed under *Final State*) | **the ASSUMPTION IS NOW DOCUMENTED** — 5.1 shipped calling this an assumption because nobody had driven a real cancel to completion; the vendor's own table says it |
| `/api/mitra/tracking` | *"This endpoint is throttled and may return `429 Too Many Requests`"* | our poller must keep its batch of 100 — do not widen it |

Other codes the table gives, none of which we map yet: `301` recipient refused · `310`/`311` recipient
disputes or will not pay · `333` destroyed by courier · `400` successfully returned · `500` package has
issues · `152` re-delivery · `210`/`211` SOP violation.

### What the spec says we are NOT sending — and we book successfully anyway

`v6.2/request_pickup` marks these **required**, and `kaCreateOrder` omits them or sends them
conditionally. Sandbox bookings succeed regardless (measured 2026-08-20, `5758-…`), so the server is
lenient TODAY — that is a grace period, not a contract.

| field | ours |
|---|---|
| `zipcode` (sender) | absent |
| `latitude`, `longitude` (sender) | absent |
| `kelurahan_id` (sender) | conditional |
| `destination_zipcode` | conditional |
| `destination_kelurahan_id` | conditional |
| `destination_latitude`, `destination_longitude` | absent |
| `items` (per package) | absent |

⚠️ **The coordinates are not merely unsent — we do not HAVE them.** `op === "instant"` was removed and
its own note records that it *"was the only consumer of shopper/store coordinates"*. Supplying them is
a data-model change (a geocode on the seller's pickup address and on the shopper's), not a client edit.
Tracked as a task; do not "fix" it by sending zeroes, which is a lie the courier would route on.

### Endpoints the spec documents that we do not use

- **`POST /api/mitra/set_callback`** — *"Registers or replaces the account webhook callback URL… Only
  one callback URL is supported per account. A new registration replaces the previous URL."* This is
  the missing half of N39: the receiver `api/public/kiriminaja/webhook` shipped 2026-08-24, but nothing
  in this repo has ever REGISTERED it, and no log records a manual registration. One URL per account
  is a shared-resource fact worth knowing before anyone calls it.
- **`GET /api/mitra/v6.2/credit/balance`** and **`POST /api/mitra/v6.2/pin/validate`** — the spec pairs
  them with pickup: validate the PIN and confirm the balance covers the shipping cost before booking.
  `request_pickup` accepts optional `pin` and `payment_method`. We send neither, and a booking that
  fails for insufficient balance is currently indistinguishable from any other refusal.
- `v6.1/awb/print`, `v6.1/addresses`, `v2/schedules`, `v2/get_payment`, `v3/set_whitelist_services`,
  `couriers`, `courier_services`, `couriers_group`, `city`/`kecamatan`/`kelurahan`,
  `calculations/cod`, and the whole `v4/instant/*` family (deliberately removed — TokoΦ ships regular
  expedition only).

### The webhook contract, in the vendor's own words

Two events: **`expressShipmentEvent`** (*"Sent when an express package is processed, shipped, canceled,
delivered, returned, or encounters a delivery problem"*) and `instantShipmentEvent`. Payload fields:
`method`, `data`, `payment`, `packages`. Two rules stated there that our receiver should be checked
against: **"Use `awb` and `order_id` together for idempotency"**, and **"`problem_packages` is not
terminal; wait for a later finished event"**.

⚠️ The official SDKs are BEHIND the spec: `kiriminaja/rust` (main) still calls
`/api/mitra/v6.1/request_pickup`. Do not treat an SDK as the contract.

## Deep read of the v6.2 spec prose — 2026-09-09 (28 sections, `info.description` ≈ 18 KB)

The endpoint list was read earlier the same day; this is the PROSE, which is where the operational
rules live. Re-downloaded and byte-identical, so the two passes describe one artefact.

### 🔴 The docs never mention the IP allow-list that is currently blocking us

`## Environments`, `## Authentication` and `## Rate Limits` describe base URLs, the Bearer header and
429s. **Nothing anywhere in 18 KB of prose says an API key is bound to an IP address**, yet the sandbox
enforces exactly that (`401 "Your IP address <ip> were not allowed to access this API. #1"`). Measured
2026-09-09 from two different networks: the message always names the CALLER's address, and a garbage
key answers `"Unauthorized."` instead — so the key authenticates first and the IP check runs after it.
Treat the allow-list as an undocumented, vendor-side gate: it cannot be reasoned about from the docs
and it must be confirmed with support.

⚠️ The prose also says a sandbox key comes from **`https://sandbox.kiriminaja.com`** (register → wait
for approval → *Integrasi*). **That host does not resolve in DNS** (checked 2026-09-09), while
`app.kiriminaja.com` answers 200. The documented sandbox onboarding path is therefore stale; keys in
practice come from the main dashboard with a *Sandbox* environment badge.

### Environments — our base URLs are confirmed correct

| Environment | Base URL |
|---|---|
| Sandbox | `https://tdev.kiriminaja.com` |
| Production | `https://client.kiriminaja.com` |

Exactly what `packages/lib/src/kiriminaja.ts` uses.

### ⚠️ The volumetric divisor is NOT a constant — correct any doc that says "÷ 6"

*"The documented shorthand is `width * length * height / 6` for regular, next-day, and same-day
services and `/ 4` for trucking. Courier service responses may expose divisors such as `6000`, `5000`,
or `4000`; use the returned courier configuration and its documented units rather than hard-coding a
divisor."*

**We are not exposed**: `kaShippingPrice` sends the dimensions and KiriminAja does the arithmetic —
this repo hard-codes no divisor anywhere (checked). But `AGENTS.md` stated a flat "÷ 6" as if it were
the rule, which would mislead anyone who ever decides to compute it locally. Corrected there.

### Money rules, in the vendor's words

- **Insurance:** `insurance_amount = item_value × insurance_percentage`, rounded UP to the nearest 100.
  The 3PL sets the percentage.
- **COD:** `subtotal = item_value + shipping_cost + insurance_amount`; `add_cost = subtotal ×
  cod_fee_percentage` rounded up; `cod = subtotal + add_cost`. ⚠️ Note the insurance term — a COD total
  that omits it under-collects. Our `kaCodFee` reads `cod_fee` / `cod_fee_amount` / `minimum_cod_fee`
  from the RATE's own `setting` rather than hard-coding a percentage, which is what *"the 3PL sets the
  COD percentage"* requires. ⚠️ Do not confuse this with the PLATFORM's own COD fee to the merchant
  (`@tokophi/lib/payment-fees`, `FINANCE.md`) — different money, different payer.
- **Pricing returns `results[].cost` as a STRING** while order creation takes an integer
  `shipping_cost`: *"parse the numeric value before sending it… rather than blindly copying a JSON
  string."* `kaShippingPrice` already coerces (its comment says numbers arrive as strings sometimes).

### 🔴 PIN: six digits, THREE attempts, then a lock

*"The PIN is six digits. The documented maximum is three attempts. Validation responses expose
`attempt`, `max_attempt`, and `lock_until`."* KA Credit deducts the shipping cost automatically after a
successful pickup, and the flow is: validate the PIN, confirm the balance covers the cost, then book.
**A naive retry loop around PIN validation can LOCK the platform account** — which would stop every
merchant's bookings at once. Any implementation of Task 8.16 must read `attempt`/`lock_until` and stop,
never retry blindly. Term-of-Payment accounts use neither KA Credit nor the PIN.

### Callback delivery — duplicates are guaranteed, retries are not documented

*"Delivery retry count, timeout, and backoff are not part of the documented contract, so integrations
must be idempotent and tolerate duplicate events."* Plus the earlier rule: *"use `awb` and `order_id`
together for idempotency"*. One publicly reachable URL per account, A/AAAA record required, a new
registration REPLACES the old one, and the vendor asks to be told before it changes (Task 8.15).

### Pickup schedule

`clock` = start datetime, local zone, `YYYY-MM-DD HH:mm:ss`; `until` = window end `HH:mm`; `expired` =
Unix timestamp after which the option is dead; `libur: true` = holiday. A custom working-hours pickup
is allowed only when requested **before 16:00 local**.

### Payments (`v2/get_payment`)

Express uses `data`, instant uses `result`. Express `status_code` is commonly a STRING: `9` unpaid,
`0` paid. `qr_content` is a payload the client renders into a QR image and may be null when QR is not
applicable or already paid. Express `created_at` is **UTC+7**.

### Other operational limits worth knowing

Sandbox is rate-limited and may answer 429; production limits are per-account and must be asked for.
Instant delivery (removed from this product) caps at 40.000 g and supports GoSend, Grab Express, Borzo.
Phone values are normalised by stripping spaces and hyphens; `08`, `+628` and `02` landlines are
accepted. *"Current mock success responses are illustrative and are not an authoritative production
response contract"* — do not build parsers from the doc's examples alone.
