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

## What we call today

| Purpose | Path we call | Version status |
|---|---|---|
| Resolve an area by name | `/api/mitra/v2/get_address_by_name` | current |
| Quote a parcel | `/api/mitra/v6.1/shipping_price` | current |
| **Book + request pickup** | `/api/mitra/v6.1/request_pickup` | **⚠️ DEPRECATED — v6.2 is current** |
| Cancel a shipment | `/api/mitra/v3/cancel_shipment` | current |
| Track | `/api/mitra/tracking` | current |
| Province list | `/api/mitra/province` | current |

## 1. Pickup is not a separate step

There is **no standalone "request pickup" endpoint.** Creating the express order *is* the pickup
request: the response's `method` is `request_pickup` and its text is `"Request pickup berhasil"`.
Pickup vs drop-off is a per-package boolean:

> `drop` — `true` = drop-off / cashless, `false` = pickup. Nullable; **default NOT STATED IN DOCS.**

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

Since **0087** we store what the vendor returned, verbatim: `orders.ka_pickup_number` (the vendor
also calls this the **`payment_id`**), `ka_payment_status`, `ka_payment_url`, plus
`ka_shipping_cost_idr` — the cost side of ongkir, which the DB had never held (`shipping_idr` is what
the *shopper* paid, and the seller may book a cheaper service than the shopper picked).

⚠️ **`apps/admin/lib/shipment-payment.ts` is the ONE place that separates the two flows**, and it
decides from the ORDER's own COD flag (`payments.method = 'cod'`), never from the vendor's payment
fields — the docs do not define what `payment_status` holds for a COD package, and guessing there
would put a false "belum dibayar" on parcels nobody owes anything for. NULL means *no reading*
(every booking before 0087), never *unpaid*.

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
`libur: true` date · the default value of `drop` · how to cancel before an AWB exists (cancellation
takes the **AWB and only the AWB**, which does not exist at booking) · whether v6.2 wants
`destination_province_id` or `destination_provinsi_id` (**the docs contradict themselves**).
