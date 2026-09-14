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

## 0. The whole integration on one page (peta integrasi — read this first, 2026-09-14)

Everything KiriminAja touches in TokoΦ, by layer. The sections below this one are the vendor
contract and the history; this is the map. When a row here disagrees with the code, the code wins
and this row is a bug.

### 0.1 Environment and identity

| item | value | where |
|---|---|---|
| Base URL | sandbox `https://tdev.kiriminaja.com` · production `https://client.kiriminaja.com` — **same API** (owner ruling 2026-08-03) | `packages/lib/src/kiriminaja.ts` (`KIRIMINAJA_ENV`, default **sandbox**) |
| Credential | `KIRIMINAJA_API_KEY` (`Authorization: Bearer`) — **never in a body, a URL or a document** | Coolify env; the super-admin Pengaturan card shows the active env (N35) |
| Account prefix | `KIRIMINAJA_ORDER_PREFIX` = `5758` (sandbox) — `order_id` ≤ 20 chars INCLUDING the prefix (Task 8.20) | `buildKaOrderRef` / `kaOrderId` throw rather than truncate |
| IP allow-list | the platform's egress IP `45.77.33.112` must be allow-listed per environment at the vendor portal; a lapse reads as `401` naming the IP, NOT as a bad key | §"The sandbox enforces an IP ALLOW-LIST"; re-request it for production at cutover (Task 8.9) |
| Production state | **`KIRIMINAJA_ENV=sandbox`** until the UAT sheet is accepted and the production key issued | Task 8.9 (owner) |

### 0.2 Endpoints we call — and the one rule per endpoint

| step | endpoint | caller | the rule that keeps it honest |
|---|---|---|---|
| area search | `POST /api/mitra/v2/get_address_by_name` (live fallback) · local `kiriminaja_areas` first | `apps/admin/lib/data/areas.ts` | ranked so a CITY beats a same-named village; `%`/`_` escaped |
| kelurahan of a district | `POST /api/mitra/kelurahan` → `results[].id` = the vendor's subdistrict id | `packages/db/scripts/build-ka-kelurahan-ids.mjs` → `kelurahan.ka_kelurahan_id` (`0107`) | the ONLY id ever sent as `kelurahan_id`; `kelurahan.id` is a Kemendagri code and `assertKaKelurahanId` refuses it |
| courier roster | `shipping_price` on one reference route (there is no list endpoint) | `kaServices()`, super-admin `syncCouriersFromKiriminaja` | roster = `platform_couriers`; COD allowance per service (`codAllowed`, SPX only) |
| quote | `POST /api/mitra/v6.1/shipping_price` (v6.1 IS the current one; there is no v6.2 rate endpoint) | `apps/admin/lib/shipping-quote.ts` — **the one price producer** — for `/api/public/ongkir` AND the re-quote inside `/api/public/order`; `getShippingRates` for the seller (quoted with `insurance: 1`) | origin = the seller's pickup district, never the client's; weight + `stackedDims` box from the seller's catalogue; cached 10 min keyed on all of it |
| book + pickup | `POST /api/mitra/v6.2/request_pickup` | `kaCreateOrder` ← `createShipment` (single order, seller picks a service) and `bulkGenerateResi` (the service the shopper paid for) | the FULL v6.2 payload (§0.4); schedule = tomorrow 10:00 WIB; `drop: false` pinned; `awb` written only from `details[0].awb` (a booking ref is never a resi) |
| tracking | `POST /api/mitra/tracking` (`order_id` ≤ 20) → `{ status, text, status_code, details: { awb, sorting_code, … }, histories }` — **no `data` key** | `api/cron/tracking` every 15 min (up to 5 orders per store per tick) + "Lacak" + the webhook's verified pull — all through `kaTrack` → `parseKaTracking` (`@tokophi/lib/kiriminaja-tracking`) | fills `orders.awb` only through `realWaybill` (refuses our ref, `MOCK-<ref>`, DEMO/TEST), `orders.sorting_code`, and maps the top-level package `status_code` → order status forward-only (`ka-tracking.ts`) |
| cancel | `POST /api/mitra/v3/cancel_shipment` — **by AWB, never the order id** | `cancelShipment` | refused before the call when no AWB exists; `status:true` = queued for cancellation (≤ 48 h), not cancelled |
| webhook | `POST https://app.tokophi.com/api/public/kiriminaja/webhook` (registered via `set_callback`) | `api/public/kiriminaja/webhook/route.ts` | hint-only: fails closed on a missing/wrong Bearer, logs the SHAPE of a rejection, never advances state without a tracking pull |
| province / health | `POST /api/mitra/province` (`{}` body, answers in `datas`) | super-admin "Test koneksi" | 37 provinces = healthy; `Unauthorized` = key, `401 + IP` = allow-list |
| not called | `v6.2/credit/balance`, `pin/validate` (account is Term-of-Payment — "Unable to find your endpoint target"), `v6.1/awb/print` (we render the label ourselves), `v4/instant/*` (removed) | — | §"Endpoints the spec documents that we do not use" |

### 0.3 Data — what we store, and where it comes from

| table / file | rows | purpose | producer |
|---|---|---|---|
| `kiriminaja_areas` (+ `lat`,`lng` `0109`) | 7 030 | the vendor's districts: ongkir origin/destination ids, province for the COD allow-list, district centroid (95,8%) | `packages/db/data/kiriminaja-areas.csv` ← vendor export; centroids ← `scripts/build-area-coords.mjs` (Kemendagri boundaries) |
| `kelurahan` (`id` Kemendagri · `ka_kelurahan_id` vendor · `postcode` · `lat`,`lng`) | 78 764 | postcode auto-fill at checkout; the vendor's subdistrict id (94,0%); village centroid (99,6%) | `data/kelurahan.csv` ← `build-kelurahan.mjs` (wilayah + kodepos) + `build-ka-kelurahan-ids.mjs` (vendor walk, claim-once) + `build-area-coords.mjs` — all reloaded by `seed-areas.ts` on every deploy (truncate + insert; reference data, not store data) |
| `store_settings.sender_*` | per store | the seller's pickup: name, phone, address, `sender_kecamatan_id`, `sender_kelurahan_id` (vendor id), `sender_postcode`; `sender_lat/lng` are DEAD (the centroid rule replaces them) | Pengaturan → Alamat (`sender-address-card.tsx`) |
| `store_shipping_methods` + `store_settings.couriers` (fallback) · `store_settings.cod_enabled` | per store | which services this seller offers; whether the seller opts into COD | Pengaturan → Pengiriman / Jasa Kirim |
| `platform_couriers` (`services[].codAllowed`) · `platform_cod` (enabled, cap, provinces) | platform | the courier pool and the COD policy — `apps/admin/lib/cod.ts` is the ONE place that answers "may this be paid on delivery?" | Super Admin → Pengaturan |
| `orders.sorting_code` (`0110`) | per order | the courier's routing code for the AWB — required on the label for SPX, ID Express, J&T, J&T Cargo; cleared with the AWB; sandbox always NULL | `syncOrderFromKa` only — from `details.sorting_code`, or a webhook `processed_packages` row whose `awb` equals the verified AWB (`sortingCodeFromHint`) |
| `orders.ship_district_id` · `ship_kelurahan_id` (`0108`) · `ship_postcode` · `ship_address` · `courier` · `service_type` · `shipping_idr` · `awb` · `ka_order_id` · `label_printed_at` | per order | the destination the quote was issued for, the service the shopper paid for, and the booking's identity | `/api/public/order` (server re-derives; never the request's ids), `createShipment`, `cron/tracking`, `markLabelsPrinted` |
| `shipment_bookings` · `ledger_entries` (`shipping-order-debit`, `shipping-balance-debit`) | per booking | the reservation and the reconciliation of quote vs actual courier cost (seller pays a costlier choice; a cheaper one is platform margin) | `createShipment` |

### 0.4 The booking payload (v6.2) — every field, and which rule produced it

| field | source | rule |
|---|---|---|
| `name`, `phone`, `address` (sender) | `store_settings.sender_*`; address composed with kelurahan + postcode | phone normalised to `62…` |
| `kecamatan_id`, `kelurahan_id` | `sender_kecamatan_id`, `sender_kelurahan_id` | kelurahan omitted when NULL; vendor id only |
| `zipcode` | `sender_postcode`, else the district's sole postcode | omitted, never `""` |
| `latitude`, `longitude` | `resolveAreaCoords` (kelurahan centroid → district centroid) | both or neither; `coordFields` refuses 0,0 / outside Indonesia |
| `schedule` | tomorrow 10:00 `Asia/Jakarta` | couriers enforce a cut-off; `now + 1h` is refused |
| `packages[].order_id` | `buildKaOrderRef(order, attempt)` | ≤ 20 chars with prefix; unique per attempt |
| `destination_*` (name, phone, address, kecamatan, kelurahan, zipcode, latitude, longitude) | the order's snapshot; kelurahan/centroid only when the district is the one the id was derived against (a guessed district ⇒ omitted) | never re-couriered, never a wrong id |
| `weight`, `width`, `length`, `height` | Σ variant weight × qty (≥ 1 kg); **`stackedDims`** (largest footprint, height holds Σ item volumes, rounded up) | the SAME box the quote priced — the validator prices the manifest |
| `qty` | Σ `items[].qty` | derived, never 1 by default |
| `item_value`, `item_name` | goods subtotal; `Pesanan <number>` | — |
| `service`, `service_type`, `shipping_cost` | the service booked; `shipping_cost` = the FRESH quote's `cost` (`serverCost`), refused if it moved from what the seller saw | never the browser's number |
| `cod` | `orders.total_idr` for a COD order (goods + shipping + 3% + PPN 11% = T&C §5), else 0 | derived from `payments.method`, refuses a caller that disagrees; insurance on COD is the seller's cost |
| `insurance_amount` | the quote's `insurance` fee when the seller ticked insurance OR the service is `force_insurance` | never the goods value |
| `package_type_id` | 7 | 9's semantics undocumented — conservative |
| `drop` | `false` | pickup flow, pinned |
| `note` | optional free text | omitted when empty |
| `items[]` | one per `order_line_items` row: name, price PER UNIT, weight (≥ 1 g), the line's OWN box (≥ 1 cm; never the package's), qty, `metadata.sku` / `variant_label` | a manifest that cannot contradict the parcel |

### 0.5 The seller's flow, end to end

1. **Pengaturan → Alamat**: pickup district + kelurahan (vendor id) + postcode. **Pengiriman / Jasa Kirim**: services offered, COD opt-in.
2. **Checkout** (`checkout.astro` → `/api/public/ongkir`): kecamatan search, kelurahan when the kodepos is ambiguous, quote from the seller's pickup district over the seller's catalogue weight + box; COD only when all five conditions hold (`cod.ts`), with a one-line reason when not.
3. **Order** (`/api/public/order`): re-quotes with the same function, stores OUR price for the service picked, re-derives district/kelurahan ids server-side.
4. **Proses → Atur pengiriman**: `bulkGenerateResi` books the paid service; the single-order "Cek Ongkir" lets the seller pick any service with the cost difference reconciled to the seller's ledger.
5. **Resi terbit**: `awb` arrives when a courier accepts the pickup — `cron-tracking` (15 min sidecar) fills it; "Ambil resi"/"Lacak" are shortcuts, not the mechanism. The **sorting code** arrives with it (`processed_packages` / `details.sorting_code`) on the same write.
6. **Cetak label**: `/api/admin/labels` renders our own 100×150 mm label (`shipping-label.ts`, Code 128) only once a real AWB exists; the **sorting code** is printed large above the barcode, and for SPX / ID Express / J&T / J&T Cargo the slot is always drawn — filled, or dashed "Belum tersedia" — while the bulk screen warns (`missingSortingCode`) before the stack is printed; `markLabelsPrinted` reports what it wrote.
7. **Tracking → status**: courier status mapped forward-only onto `orders.status` through `applyOrderStatusChange`; webhook is a hint, tracking pull is the truth.
8. **Cancel**: by AWB only, before collection; non-COD voids are queued up to 48 h.

Full narrative with the money side: `FLOWS.md` §5 (shipping) and §1 (the COD gate).

### 0.6 Money rules the vendor enforces (all measured)

- **Volumetric weight** applies whenever it exceeds actual weight; the divisor is the courier's (`÷ 6` regular, `÷ 4` trucking) — we send dimensions and never hard-code a divisor. **The v6.2 validator prices Σ `items[].(w×l×h×qty)`**, so the quote's box is built from the same sum (`stackedDims`).
- **COD**: fee = (goods + shipping + insurance) × 3% (J&T Express 4%) + PPN 11%, min Rp2.500; COD value = base + fee; platform bounds Rp10.000–Rp3.000.000 (T&C §5). Our checkout charges exactly that fee to the buyer on SPX (`@tokophi/lib/payment-fees`).
- **Insurance**: the fee is the quote's `insurance` field (SPX Rp300, JNE Rp2.500, J&T Cargo Rp5.000 at 1 kg); some services force it (`force_insurance: true` — AnterAja REG, Ninja, J&T Cargo on the UAT route).
- **Return cost** on a refused COD parcel: SPX / IDX / SAP / Ninja / Lion free (period-bound), others 50–100% of the outbound fare — the reason COD is SPX-only here (T&C §6).
- **Non-COD shipping cost is owed by us** to the vendor (VA / Term-of-Payment); an unpaid booking never gets a waybill (`shipment-payment.ts` separates the two flows).

### 0.7 Operations

| concern | how |
|---|---|
| resi not appearing | check the `cron-tracking` sidecar container first (`docker logs cron-tracking`); `awbFilled` sat at 0 for a week when it was down |
| every rate 401 with the VPS IP in the text | the allow-list lapsed at the vendor portal — owner re-adds `45.77.33.112`; the key is fine |
| a UAT / contract experiment | `ops/kiriminaja-uat-sim.ts` — SANDBOX ONLY (refuses production), run from the allow-listed admin container (overlay under `/tmp/uat`, `server-only` stubbed; BUILD-LOG 2026-09-14 has the recipe); prints the scenario-1 body off the wire |
| the UAT sheet | Markdown at `specs/docs/uat/` → `node ops/uat-sheet-render.mjs <sheet.md> <out.pdf>` (vector logos, images inlined, Chromium) |
| cutover (Task 8.9) | owner submits the sheet → production key → `KIRIMINAJA_ENV=production` + key in Coolify → redeploy → the env badge reads `production` → one real booking a courier collects → `DEPLOY.md` records the date. Re-request the production allow-list first |
| sensitive: never | the key in a body/URL/doc; a booking ref stored as `awb`; a cancel by order id; a coordinate of `0,0`; a client-posted origin, weight or price |

### 0.7b Two tracking defects found while wiring the sorting code (2026-09-14)

🔴 **The tracking body was never read.** `POST /api/mitra/tracking` answers `details` + a top-level
`status_code` (measured from the allow-listed container, and their OpenAPI says the same). All three
consumers — the poller, the webhook's verified pull, "Lacak" — cast `r.data`, a key the response has
never had, so every successful pull parsed to `{}`. Production's own evidence line recorded
`ok=true statusType="undefined"` with no `keys` on every row. Nothing could fill `awb`, move a status,
or read a sorting code, whatever the courier did. `kaTrack` now parses once (`parseKaTracking`) and
returns `tracking`, never the envelope, so `tsc` refuses a consumer that guesses the shape again.

🔴 **The sandbox's "waybill" is `MOCK-<our booking ref>`** (all eight UAT parcels: `MOCK-5758-UAT1080737`,
…, status 105 "Menunggu Pickup"). It is not equal to our ref, so the old `awb !== ref` test would have
ACCEPTED it: with the parser fixed and that test left in place, the production poller (still on the
sandbox) would have stamped `MOCK-5758-PHI4970` into `orders.awb` and the label would have printed a
resi no courier can scan. `realWaybill(awb, ref)` refuses our ref, anything containing it, and
MOCK/DEMO/TEST/DUMMY-prefixed values, and is the ONE test all three consumers use. This also corrects
what the UAT sheet said through revision 3: the sandbox did not "fail to issue an AWB" — it issued a mock
one we could not see; cancel-by-AWB still cannot be exercised against a legitimate number.

### 0.8 Guards (what fails if a rule above is broken)

`packages/lib/src/kiriminaja-tracking.test.ts` (the measured tracking envelope, `realWaybill` vs `MOCK-<ref>`, sorting-code normaliser, the four couriers, the webhook-hint binding, `kaTrack` returns parsed tracking) · `apps/admin/lib/ka-sorting-code.test.ts` (the one writer against real Postgres: with a waybill, never without, replaced with a new AWB, never cleared by silence, cleared on void, malformed refused; + source claims that the receiver passes the row as a hint, the verifier binds it, no consumer reads `r.data` or a bare `!== ref`) · `packages/lib/src/kiriminaja.test.ts` (client) · `kiriminaja-v62.test.ts` (the v6.2 payload: path, `drop`, no `add_cost`, zipcodes, items + metadata + note, qty = Σ, both coordinate pairs / omitted / 0,0 refused, kelurahan ids, empty-string AWB, HTTP-400 refusals) · `ka-kelurahan-id.test.ts` (the id-space sink) · `packages/db/src/area-coords.test.ts` (centroid resolver, real Postgres) · `kelurahan-csv.test.ts` (one vendor id per village) · `apps/admin/lib/shipping-weight.test.ts` (`stackedDims`) · `shipping-dimensions.test.ts` (dimensions threaded end to end, one box rule in 4 places) · `shipping-manifest.test.ts` (manifest, postcodes, quoted insurance, coordinates only from the resolver) · `destination-kelurahan.test.ts` (guessed district ⇒ no village id) · `cod-policy.test.ts` (the five conditions) · `ka-status-codes.test.ts` · `ka-webhook.test.ts` + `webhook/route.auth.test.ts` · `shipping-label.test.ts` · `bulk-shipping.test.ts` · `provider-label.test.ts` (the brand never reaches a merchant string) · `tracking-ids.test.ts`.

### 0.9 What is still open

- Production has never booked: `KIRIMINAJA_ENV=sandbox` (Task 8.9, owner-gated on the UAT sheet).
- The seller's rate picker does not yet show "asuransi wajib" / the fee per service (the data is on `Rate`; visual task).
- The insurance fee on a forced service is charged to the seller by the vendor and not yet posted to the seller ledger.
- Sorting code is PREPARED end to end (column `0110`, ingest from tracking + `processed_packages`, label slot, bulk warning) but has never carried a real value — production-only. Open with the vendor: whether production tracking fills `details.sorting_code` like the webhook, and any per-courier layout (SPX two columns?) (UAT action item 4). Courier logo on the label is still a name. The webhook's auth header contract is undeclared (action item 5).
- Cancel-by-AWB cannot be tested on the sandbox: its AWB is `MOCK-<ref>` (action item 3).
- Whether Lion / Pos need a precise coordinate rather than a centroid (action item 2).

## The UAT sheet (what unlocks production) — `specs/docs/uat/`

KiriminAja grants a production key against a filled UAT sheet on THEIR template ("Template UAT -
KiriminAja - MitraAPI V1"). The filled sheet is tracked here so it does not live on one laptop:

| File | What it is |
|---|---|
| `specs/docs/uat/UAT-TokoPhi-KiriminAja-MitraAPI-V1-2026-09-14.md` | **revision 2 — the current sheet**, Markdown (tracked; Markdown does not trigger a deploy). Filled after KiriminAja's review of revision 1 ("endpoint v6.2, payload still v6.1"): all 8 scenarios re-booked 2026-09-14 with the full v6.2 payload, the request body of scenario 1 printed verbatim as evidence |
| `specs/docs/uat/label-5758-UAT5032514.png` | the sample label the sheet embeds (rendered 2026-09-12 by `shipping-label.ts` for the run-1 COD OID; the module is unchanged) |
| `specs/docs/uat/UAT-TokoPhi-KiriminAja-MitraAPI-V1-2026-09-12.html` | revision 1, as submitted and reviewed (self-contained HTML, no API key). Kept as the record of what the vendor saw |

**Render:** `node ops/uat-sheet-render.mjs specs/docs/uat/<sheet>.md ~/Downloads/<sheet>.pdf` —
micromark + GFM tables (already a transitive dependency) into the same print CSS and vector header as
revision 1, images inlined, Chromium via Playwright. Revision 2 renders to **8 pages, 0,22 MB**
(portal cap 10 MB). The PDF is deliberately not tracked (derivable; the repo has no binary documents);
the copy rendered 2026-09-14 has sha256 recorded in `BUILD-LOG.md` under that date.
**Status and next step: root `TASKS.md` Task 8.9** — the owner submits the sheet, the provider
approves, then `KIRIMINAJA_ENV=production` + the production key in Coolify.

⚠️ Revision 1 was tracked as `.html`, and a commit touching a non-Markdown file under `specs/` DOES
deploy (the Coolify watch rule is exclusion-only, `!**/*.md` — `DEPLOY.md` → Watch Paths). That is why
revision 2 is Markdown. Adding `!specs/**` to that rule is the owner-side fix.

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

### ✅ Mostly closed 2026-09-09 (Task 8.14) — and one field turned out to be a TRAP

Now sent unconditionally: sender `zipcode` (`store_settings.sender_postcode`, falling back to the
district's own postcode when that district has exactly one), `destination_zipcode`
(`orders.ship_postcode`, required at checkout since 2026-08-03), and `packages[].items` — one entry per
`order_line_items` row, `price` PER UNIT per the schema, never one synthetic line.

🔴 **TWO ID SPACES EXIST FOR ONE VILLAGE AND ONLY ONE OF THEM IS A COURIER ID** (Task 8.17, closed
2026-09-10 for the sender half). `kelurahan.id` is a **Kemendagri** village code — text, dotted,
13 characters ("34.02.07.2001"), built by `packages/db/scripts/build-kelurahan.mjs` and joined to
KiriminAja's districts BY NAME. It is the key the POSTCODE dataset is published under, which is the
only reason that table exists, so it can never be overwritten. Migration **`0107_kelurahan_ka_id`**
adds `kelurahan.ka_kelurahan_id` ALONGSIDE it: KiriminAja's own subdistrict id, a small integer.

**The endpoint, verified live (sandbox, read-only, 2026-09-10).** `POST /api/mitra/kelurahan`
`{"kecamatan_id": 548}` → HTTP 200

```json
{"status":true,"text":"Courier Loaded","method":"get_kelurahan_from_kecamatan_id",
 "results":[{"id":31483,"kelurahan_name":"Bawuran","kecamatan_id":548,"postal_code":"55791"}, …]}
```

⚠️ It answers in **`results`**, not the `datas` every other hierarchy endpoint uses (the spec says so).
⚠️ **`postal_code` is real but UNDOCUMENTED** — absent from the OpenAPI schema. We do not write it; the
committed postcode stays the Kemendagri one the whole table is built on.
🔴 **`status:false` IS A VENDOR ERROR, NOT "NO DATA".** At concurrency 4 the endpoint soft-throttles and
answers **HTTP 200** with `{"status":false,"text":"Oops, terjadi kesalahan…","endpoint":"kelurahan"}` —
no 429, no error status. A first run read that as missing coverage and reported **179 of 300 districts
empty (59,7%)**; sixty seconds later the same three district ids (548, 2788, 1) all returned full lists.
The populator therefore separates three outcomes — data / honestly empty / our failure — retries the
third, and never counts it as the second.

**Measured match rate** (200-district stride sample across every province, concurrency 2, 2026-09-10):
2 423 kelurahan considered → **2 228 exact (91,95%) + 70 fuzzy (2,89%) = 94,84% matched**, **125
unmatched (5,16%)**, **0 districts with no vendor data**, **0 failures**. The unmatched are name
mismatches, concentrated in Sumatera Utara (19), Aceh (15) and NTT (15); every one is listed with its
province in `packages/db/data/ka-kelurahan-unmatched.csv`. ⚠️ This 5% is a DIFFERENT gap from the ~4%
of KiriminAja districts our Kemendagri join never resolved (295 of 7 030) — that one costs the kodepos
auto-fill, this one costs the subdistrict id.

**What is wired.** `kelurahanOptions()` now returns `{name, postcode, kaKelurahanId}` and the Seller's
pickup form writes the vendor id into `store_settings.sender_kelurahan_id`; `saveSenderAddress`
re-derives it against the chosen district and drops to NULL if it does not resolve. Both booking fields
stay **conditional** — NULL means the field is omitted, exactly as before. **The DESTINATION half is
NOT wired:** `orders` still carries no kelurahan column (checkout collects one only to derive the
kodepos; `/api/public/order` ignores it), so `destination_kelurahan_id` has no producer yet.
**The guard:** `packages/lib/src/ka-kelurahan-id.test.ts` — `assertKaKelurahanId` throws on a Kemendagri
code, as a string AND as the 10-digit number a `Number()`/`replace` upstream would produce, and a
`codeOnly` claim pins that `kiriminaja.ts` writes those two fields nowhere but through it.

⚠️ **Coordinates: confirmed unfillable, column by column.** `store_settings.sender_lat`/`sender_lng` are
dead columns (nothing reads or writes them), `orders` has no coordinate columns, and neither
`kiriminaja_areas` nor `kelurahan` carries a centroid. Omitted, never zeroed.

**Measured against the live sandbox, read-only (no booking):** `shipping_price` 6138→2107, 1 kg,
20×20×10 → HTTP 200, 22 services; the same quote plus `zipcode`, `destination_zipcode` and a real
`items[]` → HTTP 200 with a **byte-identical sorted service:type=cost list**. So the Go service tolerates
extra keys and the added fields change no price. ⚠️ Only the array ORDER varies between calls — never
compare `results[0]` across two calls. `request_pickup` was NOT called, so nothing yet proves the
booking validator accepts these; that needs a real sandbox pickup and the owner's say-so.

### ✅ Every field the v6.2 spec marks required is sent when we hold it — closed 2026-09-14

KiriminAja's review of UAT revision 1 (2026-09-14) said it in one line: *"endpoint yang digunakan
sudah versi 6.2 namun struktur payload yang digunakan masih versi 6.1."* Diffing the two schemas in
their OpenAPI, "v6.2 structure" means exactly: `items[]` (with `metadata.sku`/`variant_label`),
`zipcode` + `destination_zipcode` required, `kelurahan_id` + `destination_kelurahan_id` required,
`qty` required, and **both coordinate pairs required**. The 2026-08-24 simulation predated Task 8.14,
so what the vendor reviewed was genuinely the old shape.

| field | ours (since) |
|---|---|
| `zipcode` / `destination_zipcode` | sent (8.14, 2026-09-09) — stored postcode, else the district's sole postcode; omitted when neither exists |
| `kelurahan_id` / `destination_kelurahan_id` | sent (8.17, 0107/0108) — KiriminAja's own id, omitted when NULL |
| `items[]` + `metadata` | sent (8.14) — one line per `order_line_items` row, price PER UNIT, `sku`/`variant_label` from the variant |
| `latitude`/`longitude` + `destination_*` | **sent (0109, 2026-09-14)** — the CENTROID of the kelurahan, else the district (`resolveAreaCoords`), from the Kemendagri boundaries dataset. NEVER `0,0`; `coordFields` in `kiriminaja.ts` throws on 0,0, a lone coordinate, or a point outside Indonesia |
| `note` | sent when non-empty |

**Why a centroid is the honest coordinate.** A shopper gives a street, a WhatsApp number, a kecamatan
and (where the kodepos is ambiguous) a kelurahan; nothing here geocodes a street. For a REGULAR
courier the vendor's own pricing response says `use_geolocation: false`, so the coordinate is
informational and the centroid of the smallest known area is the truthful value. Whether Lion/Pos
need a precise point is action item 2 on the UAT sheet. Coverage: 78 415 / 78 764 kelurahan (99,6%)
and 6 735 / 7 030 districts (95,8%) carry a centroid; the rest omit the fields, as before.

### The vendor's second review (2026-09-14, on revision 2) — four rules, all now in code

KiriminAja answered revision 2 per OID. Every remark reduces to one of four rules, and each is now
enforced where the payload is built, not left to a caller:

| rule (their words) | ours |
|---|---|
| *"paket tanpa asuransi … courier service dengan param `force_insurance: false`"* | a service whose quote says `force_insurance: true` is insured whether or not the seller ticked the box: `insured = input.insurance \|\| selectedRate.forceInsurance` in `createShipment`. The rate list now carries `forceInsurance` per service |
| *"value dari param `insurance_amount` didapatkan dari param `insurance` saat get pricing"* | `insurance_amount` = the quote's own `insurance` FEE (Rp300 on SPX, Rp2.500 on JNE, Rp5.000 on J&T Cargo at 1 kg — measured), **never the goods value**, which is what it was. The seller's rate list is quoted with `insurance: 1` so the fee is known for every service; `cost` is unaffected |
| *"param `qty` diluar array of items merupakan total dari param `qty` dalam array of item"* | derived in `kaCreateOrder` from the manifest (`Σ items[].qty`); `pkg.qty` only stands in for a caller with no lines |
| *"cod amount = cod fee + item value + shipping cost + insurance; cod fee = (…) × (3% atau 4%) + 11%"* (T&C §5) | `cod` = `orders.total_idr`, which the checkout already builds as goods + shipping + 3% + PPN 11% on the fee — the same formula. Insurance on a COD parcel is the seller's choice AFTER the buyer's total was fixed, so it is the seller's cost and is NOT added to what the courier collects. ⚠️ J&T Express is 4% in the T&C; COD is SPX-only here (3%), so no mismatch today — widen COD to J&T and the platform fee must follow |

*"request pickup ulang dengan kalkulasi volume minimal 2kg"*: the volumetric scenarios were re-booked
at 40×30×20 cm / 400 g = 4.000 g volumetric, and the sandbox accepted the multi-kg bookings at their
own quoted price (`5758-UAT2080740` NCS Rp37.000, `UAT4080742` AnterAja Rp28.000, `UAT6080744` /
`UAT8080746` SPX Rp80.728) — the August "Ongkir tidak sesuai above 1 kg" drift is gone under v6.2.

🔴 **AND THE BOOKING VALIDATOR PRICES `items[]`, NOT THE PACKAGE BOX — measured 2026-09-14.** Four
probe bookings of one 15×15×24 cm / 400 g parcel at its own quoted price (AnterAja REG Rp7.000):
items of 1×1×1 → accepted (`5758-PRB11159`); one line = the box, the rest 1×1×1 → accepted
(`5758-PRB21159`); one line = the box → accepted (`5758-PRB31200`); **two lines EACH = the box, i.e.
2× the volume → "Ongkir tidak sesuai"** (`5758-PRB41201`, not created). The first v6.2 run of the
simulation, whose manifest carried the box's dimensions on every line × qty (3× the volume), was
refused on all four volumetric scenarios the same way. So the chargeable weight is
`max(actual, Σ items[].(w×l×h×qty) ÷ divisor)`, and a quote built on "the largest item per axis" —
which ignored quantity and every line but the biggest — under-prices any multi-line order: the N30
mismatch one level down. `stackedDims` (`apps/admin/lib/shipping-weight.ts`) is now the ONE rule for
the box in the checkout quote, the seller's re-quote and the booking: the largest footprint, and a
height that holds Σ item volumes, rounded UP (a quote above the vendor's own figure is accepted —
probe A). The manifest carries each line's OWN dimensions (a line with none sends 1 cm, never the
package's). Pinned by `shipping-weight.test.ts` and `shipping-dimensions.test.ts`.

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

### ✅ RESOLVED 2026-09-09 ~17:00 WIB — but the docs still never mention the IP allow-list

**Outcome first:** the allow-list took effect and production prices shipping again. Measured at 17:06:
`/api/mitra/province` → `200`, 37 provinces; the public `op:"rates"` path → 4 rates, COD true, origin
resolved to the seller's real pickup district; a Chromium drive of the live checkout showed the order
total move from Rp110.000 to **Rp125.400** (goods + Rp15.400 ongkir), 0 console errors.

⚠️ **BOTH keys pass now — the old 64-char one and the new `v4.local.` one.** So the fix was the IP entry
on the account, not the credential, and **no key swap was needed**. Production was never redeployed: the
running container already held the working key. Whoever reads this next should not assume a new key is
part of the remedy.

⏱ **It is not instant.** The dashboard showed the key active at 16:16 with the IP already listed, and
the API still refused at 16:42. It began answering between 16:42 and 17:06 — roughly **30–50 minutes**
after the entry looked correct on screen. Do not conclude the whitelist is broken from one probe.

### The docs never mention the IP allow-list at all

`## Environments`, `## Authentication` and `## Rate Limits` describe base URLs, the Bearer header and
429s. **Nothing anywhere in 18 KB of prose says an API key is bound to an IP address**, yet the sandbox
enforces exactly that (`401 "Your IP address <ip> were not allowed to access this API. #1"`). Measured
2026-09-09 from two different networks: the message always names the CALLER's address, and a garbage
key answers `"Unauthorized."` instead — so the key authenticates first and the IP check runs after it.
Treat the allow-list as an undocumented, vendor-side gate: it cannot be reasoned about from the docs,
it is applied with a delay of tens of minutes, and only a live probe proves it.

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

### 🔴 The callback's AUTHENTICATION is undeclared — and our receiver fails closed on it

The spec declares `expressShipmentEvent` with **`security: null`**: no authentication documented on the
incoming callback. Our receiver (`apps/admin/app/api/public/kiriminaja/webhook`) requires
`Authorization: Bearer <KIRIMINAJA_API_KEY>` and REFUSES anything else — correctly, because that endpoint
writes `orders.awb` and advances status, so an unsigned write is not an option.

**If the vendor really sends no header, every genuine event is 401'd and nothing says so.** That is the
open question. Registered 2026-09-09 by the owner; as of that date **no genuine callback has arrived**
(one can only fire on a shipment event) — the single rejection in 24 h of production logs, at 08:59:38
UTC, was an unauthenticated probe of our own.

So the rejection log now records the SHAPE of what was presented and never a value:

```
[ka-webhook] unauthorized webhook call rejected auth=present scheme=bearer credLen=23 lenMatch=no ip=… hdrs=x-callback-token,x-ka-signature
```

`hdrs=` lists candidate auth header NAMES only, so a real call reveals what KiriminAja authenticates
with **even if we never guessed the header name**. Four readings of the first genuine rejection, with
the action for each, are written above the function. ⚠️ `scheme=` is a CLASS (`bearer`/`other`/`none`),
never the caller's first word: `Authorization: <secret>` with no scheme would otherwise print the whole
secret.

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

### 🔴 `order_id` — the booking endpoint and the tracking endpoint disagree, and we are on the wrong side

Read straight from the spec, 2026-09-09:

| endpoint | field | constraint |
|---|---|---|
| `POST /api/mitra/v6.2/request_pickup` | `packages[].order_id` | **no `maxLength`** |
| `POST /api/mitra/tracking` | `order_id` | **`maxLength: 20`** |

So a booking is accepted with an id the tracking endpoint declares it will not take. Measured with a
REAL production order number (`PHI-768771328ISC`, 16 chars): `shipping.ts:814` builds
`orderNumber` stripped of non-alphanumerics + 8 characters of the booking UUID, and `kiriminaja.ts`
prefixes it — giving **28 characters** with the configured prefix `5758`, and **31** with the code's
`TOKOPHI` fallback. The limit is 20.

This is the strongest available explanation for issue #12's *"`awbFilled` has only ever been 0"*: the
poller asks tracking for an id longer than tracking accepts. It cannot be fully separated from "no
production booking has ever been made" until one is — but the arithmetic no longer needs a booking.

⚠️ **Do not fix it by truncating at send time.** An id the vendor stores in truncated form is an id we
can never look it up by again. Shorten the CONSTRUCTION and guard the total. Task 8.20.

✅ **CLOSED 2026-09-09 (Task 8.20).** The construction lives in `buildKaOrderRef`
(`packages/lib/src/kiriminaja.ts`): the constant `PHI` is dropped — the vendor prefix already
identifies us — and the 8-character UUID slice becomes a ONE-character base36 **attempt counter**
(`count(*)` of the order's `shipment_bookings`, read under the reservation's own lock, so it is exact
rather than probabilistic). `5758` → `5758-768771328ISC0` (**18**, order number intact); `TOKOPHI` →
`TOKOPHI-68771328ISC0` (**20** exactly). `kaOrderId()` THROWS rather than trimming, and a prefix that
would leave under 8 body characters is refused at construction. Nothing needed migrating: production
`shipment_bookings` is **0 rows** and the 7 non-null `orders.ka_order_id` are seeded demo strings.

⚠️ **The poller is still not proven.** `orders.ka_order_id` holds the vendor's **`kj_order_id`**, and
the one authorised sandbox booking shows the vendor EXTENDING what we sent — `5758-N29` (8) came back
as `5758-N2975e1537124` (**18**, ten characters appended). `cron/tracking` queries with that value, so
an 18-character `order_id` of ours could still return a ~28-character `kj_order_id` and breach the same
limit. Whether `/api/mitra/tracking` wants the id we SENT or the `kj_order_id` — and whether that
suffix is a fixed ten characters — cannot be settled without a real booking.
