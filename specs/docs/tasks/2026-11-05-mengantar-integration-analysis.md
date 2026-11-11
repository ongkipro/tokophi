# Mengantar integration analysis — replacing KiriminAja behind the same seam

> **Superseded in part (2026-11-05, Mengantar Partner Business API):** the single platform key, the platform wallet, the platform-wide booking lease, the ledger shipping-delta debit for Mengantar and the status webhook described below are RETIRED. Every store now has its own Mengantar seller account; see decisions D7–D18 in `2026-11-05-shipping-mengantar-decisions.md`.

- Date: 2026-11-05 · Author: research subagent (read-only pass; this file is its only write)
- Scope: how TokoΦ would talk to the **Mengantar production API**, modelled on the working
  integration in `adsbookcms`, while KiriminAja stays in the codebase and can be switched back.
- Owner direction (2026-11-05): target **PRODUCTION** Mengantar exactly as adsbookcms uses it, not the sandbox.
- No external API was called. No secret value was read or printed; credentials are named by
  variable/column only.
- **UNVERIFIED** marks every claim that rests on documentation, a second-hand note, or inference
  rather than code or a measurement made here.

Sources read (all local):

| Source | What it is | State read |
|---|---|---|
| `~/Projects/adsbookcms` | Astro + Cloudflare Workers/D1 order system with a live Mengantar + AutoLaris integration | `main` @ `a913fcb` (2026-11-03), identical to `origin/main` (checked with `gh api`) |
| `~/Projects/mengantar-documentation` | ongki.pro's Mengantar API reference (Indonesian), synced with `https://api-public.mengantar.com/docs/` | `d97821c` (2026-09-25) |
| Mengantar reconciliation contract note, 2026-09-15 (kept off-repo) | read-only capture of `/invoices` and `/order` shapes on a production account | draft note |
| `~/Projects/99ribu/data/shipping/` | Mengantar area catalogue harvested from `/address/search` | `647b8c7` + **uncommitted** 2026-11-05 dataset |
| skills `mengantar-api`, `autolaris-h2h` | this machine's integration notes | the `mengantar-api` skill marks its own endpoint claims unverified as of 2026-10-02; the documentation repo and adsbookcms code are newer and win |
| TokoΦ worktree `tokophi-storefront-redesign` | current KiriminAja seam | `a2388bae` (2026-11-03) |

---

## 1. Mengantar API summary

### 1.1 Transport and auth (as adsbookcms uses it in production)

| Item | Value | Evidence |
|---|---|---|
| Production base URL | `https://api-public.mengantar.com` | `adsbookcms/src/lib/provider-config.ts:3`, client default `src/lib/mengantar-client.ts:405` |
| Sandbox base URL | `https://sandbox.mengantar.com`, **not used** per owner direction | docs `01-api-reference.md` §1 |
| Auth | The API key goes **in the URL path**: `{BASE}/api/public/{API_KEY}/…`. There is no `Authorization` header. | `mengantar-client.ts:411-413` |
| Client-source header | `x-client-source: directCall` (WooCommerce integrators send `woocommerce`) | `mengantar-client.ts:416-419` |
| Body encodings | JSON for `/order`, `/order/pay-unpaid`; **`application/x-www-form-urlencoded`** for `POST /address` and `POST /time` (adsbookcms). The docs show JSON for both; either is accepted (UNVERIFIED for JSON on `/time`) | `mengantar-client.ts:504-521, 547-561` |
| Envelope | `{ success, data, message }`; failure adds `errors`, `errorsFront` | docs §1 |
| Timeout | adsbookcms: 10 s, via an `AbortController` | `mengantar-client.ts:262, 421-422` |
| Key hygiene | Every error message has the key (raw and URL-encoded) replaced with `[REDACTED]` | `mengantar-client.ts:264-271, 456-476` |

**adsbookcms config names for the production key.** TokoΦ's Super Admin would store the same value:

- Worker secret / env: **`MENGANTAR_API_KEY`** (`src/env.d.ts:30`), optional **`MENGANTAR_BASE_URL`** (`provider-config.ts:71`).
- Dashboard-saved override: D1 **`stores.mengantar_api_key`** (`src/db/migrations/0000_futuristic_talisman.sql:93`) and
  **`stores.mengantar_base_url`** (`0005_last_harpoon.sql:1`), written from `/admin` (`src/pages/api/admin/settings.ts:626-650`).
  The DB value wins over the env value (`provider-config.ts:68`). ⚠️ adsbookcms stores it **in plaintext** in D1.
- Related per-account ids: `MENGANTAR_PICKUP_ADDRESS_ID`, `MENGANTAR_ORIGIN_AREA_ID` (`env.d.ts:39-40`), superseded by
  `warehouses.pickup_address_id` / `warehouses.origin_area_id` (`0000_futuristic_talisman.sql:107-108`).

### 1.2 Endpoints

The paths below are relative to `{BASE}/api/public/{KEY}`. "adsbookcms" means the endpoint is called in shipped code; "docs" means only the documentation repo describes it.

| Method | Path | Purpose | Key request → response fields | Used by adsbookcms |
|---|---|---|---|---|
| GET | `/address/search?keyword=` | Area search (origin/destination ids) | `keyword` (province/city/district/kelurahan/zip; AND of substrings) → `data[]{ _id (24-hex), PROVINCE_NAME, CITY_NAME, DISTRICT_NAME, SUBDISTRICT_NAME, ZIP_CODE, ORIGIN_CODE, DESTINATION_CODE }`. **Hard cap of 50 rows, no paging** (99ribu README) | yes, `mengantar-client.ts:485-491` |
| GET | `/address` | List the account's pickup addresses | → `data[]{ _id, PICKUP_NAME, PICKUP_PIC, PICKUP_PIC_PHONE, PICKUP_ADDRESS, PICKUP_AUTOFILL }` | yes, `:496-499` |
| POST | `/address` | Create a pickup address, or update it in place when `_id` is sent | `PICKUP_AUTOFILL` (area `_id`), `PICKUP_ADDRESS`, `PICKUP_PIC`, `PICKUP_PIC_PHONE`, `PICKUP_NAME`, opt. `pinpointData{lat,lng}`, `SHIPPER_*` return address → `data._id` (sometimes missing; adsbookcms re-lists) | yes, `:504-542` |
| PUT / DELETE | `/address/{id}` / `/address` | Update / delete a pickup address | docs §3.4-3.5 | no |
| POST | `/time` | Create a pickup slot | `address_id`, `date` **`mm-dd-yyyy`**, `time` ∈ `9:00…18:00`, at least **90 min ahead** → `data{_id,date,time}` | yes, `:547-561` |
| GET | `/time?address=` | List the slots of an address | → `data[]{_id,date,time}` | yes, `:566-569` |
| GET | `/order/estimate` | Account-priced quote | `origin_id`, `destination_id`, `courier=all`, `weight` (**kg**), opt. `COD_AMOUNT`, `isDangerousGoods` → `data` is a **map keyed by courier** (`JNE, JNECargo, SiCepat, SiCepatCargo, SAP, SAPLite, SapCargo, iDexpress, iDexpressCargo, JT, lion, anteraja, pos, spx`), each with `price, unsupported, unsupported_cod, codFee, estimatedPrice, estimatedSpecialPrice, discount*, estimate_delivery?, estimatedDate?, unsupportedOriginSpx?` | yes, `:574-633` |
| GET | `/api/order/allEstimatePublic`, `/api/order/allEstimate3PL` (no key) | Public / 3PL price lists | 404 observed 2026-09-25 for the public one (docs §5.2) | no |
| GET | `/getReceiverScoreByNumberUser?search=` | Buyer RTS history by phone | 403 `Not allowed` unless whitelisted | client only, `:638-643` |
| POST | `/order` | **Create shipment(s)**, batched per courier | `courier` (shipment name), `pickup{type:"dropOff"\|"scheduledPickup", address_id, time_id?, volume?}`, `orders[]{customerName, customerPhone, customerAddress, customerAddressDataId (area _id), parcelContent, weight (kg), quantity, COD \| goodsValue, destinationMark, deliveryInstruction, assignee, dontIncludeSubdistrict, opt. cargo, isDangerousGoods, customProducts[], dropShipper}` → `success, batch_id, data[]{ _id, ORDER_ID, cnote_no, isPaid, batch_id }` | yes, `mengantar-order.ts:265-329` |
| POST | `/order/pay-unpaid` | Pay a non-COD batch left unpaid by a low wallet | `{batch_id, courier}` | client only (`:682-693`), **no caller** |
| GET | `/order?tracking_id=` · `?order_id=` · list filters | Tracking / order lookup | → `data[]{cnote_no, ORDER_ID, courier, status (JSON string of boolean flags), history[]{desc, date "DD-MM-YYYY HH:mm" WIB}}` | yes, `:648-664` |
| DELETE | `/order` | Cancel / delete | `{courier, ids:[…]}` (docs §9; `ids` vs `orderIds` semantics UNVERIFIED); Anteraja only after 5 min | **no** |
| GET / DELETE | `/batch` | List / delete batches | docs | no |
| GET | `/invoices` | Wallet mutations + **`balance`**; COD reconciliation invoices | `page,size,keyword (cnote_no),dateRange,invoiceFilter` → `data[]`, `balance`; `typeReconciliation.subItems[]{cnote_no, amount, COD_AMOUNT, COD_FEE, estimatedSpecialPrice}` | no (reconciliation note) |
| POST / GET | `/label-generation`, `/label-generation/{id}` | Async PDF label (BETA, whitelisted, **8 prints / 60 s**) | `{orderId, courier, format}` → `labelGenerationId` → poll `COMPLETED.downloadUrl` (valid 15 min) | no |
| POST | `/order/getPerformancePublic` | Courier performance per city | docs | no |
| POST → us | Webhook | Status push, **HMAC-SHA256 hex of `x-timestamp + "." + rawBody`** with the dashboard's Webhook Secret; body `{cnote_no, order_id, courier, status_category}`; retries 3× (~1/5/15 s), **5 s** deadline, auto-pause after 20 consecutive failures in 24 h | **no** (adsbookcms polls; its Kelola plugin uses the same HMAC shape for a different purpose, `src/plugins/kelola/sync.ts:10`). Webhooks were rolled out to selected accounts only, so enablement for the platform account is UNVERIFIED |

### 1.3 Known traps (production)

1. **Three courier namespaces.** An estimate key (`SAP`, `SAPLite`, `JNECargo`, `spx`) is a different string from the
   `POST /order` shipment name (`Sap`, `JNE`+`cargo:true`, `spx`) and from the display label. The single-courier estimate is
   case-sensitive (`Sap` ✓, `SAP` ✗, measured 2026-09-25). Whether `POST /order` is case-sensitive is **UNVERIFIED**.
   adsbookcms books with the **estimate key verbatim** (`order.courier_code` → `courier`, `mengantar-order.ts:290`) and ships SAP
   **disabled** by default (`src/lib/install.ts:59`). That may be what keeps the mismatch from ever being exercised.
   How to book `SAPLite` as distinct from `SAP` (both map to `Sap`) is **UNVERIFIED**.
2. **SPX.** It is quoted only through `courier=all`; every single-courier spelling returns `400 Invalid courier`. `unsupportedOriginSpx:true` must be read
   as `unsupported`. Booking with `courier:"spx"` was confirmed by Mengantar support but **has never been observed live** (adsbookcms
   BUILD-LOG 2026-09-25 L5836-5838). TokoΦ's COD is **SPX-only** today, so this is the first thing to prove.
3. **Low wallet does not fail.** A non-COD order is created with `isPaid:false, cnote_no:null`. Recovery is `POST /order/pay-unpaid`
   with `batch_id`. adsbookcms flags it as `MENGANTAR_WALLET_UNPAID` (`mengantar-order.ts:169-185`) but never calls pay-unpaid.
4. **409 on concurrent creates** for JT / SiCepat. Only one `POST /order` may be in flight per **account**.
5. **POS COD is gated per account.** It needs a delivered rate of at least 82% over a rolling 21–60 days. The estimate still says `unsupported_cod:false`;
   the refusal arrives only at create time, as 403 with `status ∈ {new_seller, insufficient, blocked}` (`mengantar-client.ts:321-369`).
6. **`price` vs `estimatedSpecialPrice`.** `price` is the public courier charge. `estimatedSpecialPrice` is the discounted
   integrator cost. adsbookcms bills `price` and never the special price (`mengantar-client.ts:612-614`).
7. **No dimensions anywhere.** Estimate and order both take weight only (kg). Any volumetric re-weigh the courier does lands after the fact; how Mengantar bills it is **UNVERIFIED**.
8. **The outcome of `POST /order` can be unknown.** On a timeout, a 5xx or an unreadable 2xx, the shipment may exist. The docs name no idempotency key, so `destinationMark` is the only marker of our order number (dedup on Mengantar's side is **UNVERIFIED**).
9. **`status` in `GET /order` is a JSON *string* of flags**, e.g. `{"DELIVERED_COMPLETED":true}` (`mengantar-client.ts:163-179`;
   statuses seen in production: DELIVERED, DELIVERY PROBLEM, PENDING PICKUP, RTS — reconciliation note).
10. **The area catalogue is kelurahan-level and capped.** There are 50 rows per search and no paging. Mengantar's spellings differ (`ILIR BARAT II`,
    `BOGOR BARAT - KOTA`), and new kecamatan are missing (99ribu README).
11. **Production only (owner).** Every booking is real and charges the wallet (non-COD). There is **no sandbox to rehearse in**, so the
    first booking and its cancellation have to be a deliberate, owner-approved single order.

---

## 2. How adsbookcms does it

### 2.1 Map (Mengantar)

| Concern | Where | Notes |
|---|---|---|
| HTTP client | `src/lib/mengantar-client.ts` (694 lines) | one class: `searchAddress`, pickup address CRUD, `/time`, `estimateRates`, tracking, `createShipment`, `payUnpaidOrder`, receiver score |
| Credentials | `src/lib/provider-config.ts:46-92` | DB row → env → default base URL; `source: dashboard\|server\|none`; an explicit `null` clears a stored key (`:38-44`) |
| Area resolve + cache | `src/lib/mengantar-areas.ts`, `src/db/migrations/0071_mengantar_areas.sql` | the form picks a district from a bundled Kepmendagri catalogue (`src/data/indonesia-districts.ts`) and resolves it **once** to a Mengantar `_id` via `/address/search`. One row per `district\|city\|province`, 30-day TTL (`:63`). **Only exact matches are stored** (`:198-210`). The migration seeds rows from order history |
| Quote | `src/lib/shipping-quote.ts` | warehouse choice by province; `estimateRates` with weight from the variant; filtered by `courier_rules` (`is_enabled`, `is_cod_enabled`); COD filters `unsupported_cod` (`:249, :279`); **does not send `COD_AMOUNT`** at checkout because the store bills its own COD fee (`:236-245`); city-average fallback rate for COD only |
| COD fee | `src/lib/payment-fee-policy.ts:23-45` | the store's own 3% + 11% VAT, deliberately **not** Mengantar's `codFee` |
| Booking payload | `src/lib/mengantar-order.ts:265-302` | `COD = order.total_amount` for COD, else `goodsValue`; `destinationMark` = order number; weight = unit × qty |
| Booking orchestration | `src/lib/mengantar-dispatch.ts` | see §2.2 |
| Pickup slots | `mengantar-order.ts:31-150`, `mengantar-dispatch.ts:74-137` | drop-off by default; a scheduled pickup re-uses an existing slot from `GET /time` before `POST /time`; hour compared numerically (`sameMengantarSlot`) |
| Tracking | `src/pages/api/admin/shipping.ts:309-430` | **manual "sync" action**, no cron and no webhook. `GET /order?tracking_id=cnote_no` → `mapMengantarStatusEvidence` (`mengantar-client.ts:185-237`) → forward-only advance (`:239-260`); the raw latest description is stored separately (`0040_provider_shipping_status.sql`) |
| AutoLaris | `src/lib/autolaris-client.ts` (`/api/h2h/submit`, `/advice`, `/list_payment`, `:83-93`), `src/pages/api/webhooks/autolaris.ts` | payment rail (QRIS/VA) only. "Physical fulfilment remains Mengantar's" (`:83`) |

### 2.2 Patterns worth copying

1. **Exactly-once guard around `POST /order`** (`mengantar-dispatch.ts`):
   - claim the order with a conditional `UPDATE … SET provider_dispatch_error='DISPATCHING', claimed_at` that has a stale-claim TTL (`:400-427`);
   - acquire a **single account-wide lease** row via compare-and-swap with expiry and backoff, to avoid the 409 (`:147-198`, used at `:456`);
   - set `shipmentRequested=true` before the call. On timeout, network failure, 5xx or unreadable 2xx, raise `MengantarOutcomeUnknownError` (`mengantar-client.ts:376-387, 437-469`) and **block the order from re-push** until an operator checks Mengantar (`recordDispatchUnknown` `:209-220`, `releaseUnknownMengantarDispatch` `:226-238`);
   - once the answer is parsed (`shipmentAccepted`), a later local failure records the accepted id rather than plain failure (`linkAcceptedMengantarShipment` `:247-270`);
   - persist with a WHERE that re-asserts every input the payload was built from (`:500-536`), plus a conflict branch (`:542-568`).
2. **Typed errors for business refusals**: `MengantarPosCodIneligibleError` turns **POS COD off at checkout** automatically (`:292-303`, `:618`), and `MengantarNotWhitelistedError` handles whitelisted endpoints.
3. **Area id cached locally and only on an exact match**, never a guess stored for a month (`mengantar-areas.ts:1-33, 198-210`).
4. **Status mapping that is forward-only and flag-based**, with the raw provider description kept as evidence (`mengantar-client.ts:185-260`).
5. **Never bill `estimatedSpecialPrice`; skip Cargo keys; treat `unsupportedOriginSpx` as unsupported** (`:606-614`).
6. **Key redaction** in every error path (`:264-271`).

### 2.3 Mistakes to avoid (or not to inherit)

| # | adsbookcms behaviour | Why TokoΦ must not copy it |
|---|---|---|
| A1 | The dispatch reads **only the first line item** (`ORDER BY oi.id LIMIT 1`, `mengantar-dispatch.ts:359-373`); weight = that line's unit weight × its qty, and `parcelContent` names that line alone | A multi-line TokoΦ order would under-declare weight. Sum every line (TokoΦ already has `weightForCart`) |
| A2 | Books with the estimate key as `courier` (§1.3 trap 1) | Map estimate key → shipment name (+`cargo`) in one table |
| A3 | Key stored **plaintext** in D1 | TokoΦ already encrypts provider keys (`shipping_aggregator.*_key_enc`, 0111); do the same |
| A4 | `payUnpaidOrder` has no caller; an unpaid order waits for a human | TokoΦ needs a visible "unpaid" state plus a pay-unpaid action, mirroring `ka_payment_status` / `shipment-payment.ts` |
| A5 | No cancel (`DELETE /order`) and no label endpoint | TokoΦ has both flows today and must keep them |
| A6 | Tracking is a manual button only | TokoΦ's `cron-tracking` sidecar + webhook-as-hint model must carry over |
| A7 | Single-tenant: one account per install, one lease row per DB | TokoΦ is **multi-tenant on one platform account**: lease, wallet, POS-COD eligibility and webhook are shared by every store (see risks) |

---

## 3. Area data plan

### 3.1 The id spaces

| Space | Where | Grain | Example |
|---|---|---|---|
| KiriminAja district id | `kiriminaja_areas.id` (7,030 rows), `store_settings.sender_kecamatan_id`, `orders.ship_district_id` | kecamatan, integer | `2099` |
| KiriminAja subdistrict id | `kelurahan.ka_kelurahan_id` (nullable) | kelurahan, integer | `31483` |
| Kemendagri village code | `kelurahan.id` (78,764 rows, carries the **postcode**) | kelurahan, dotted text | `34.02.07.2001` |
| **Mengantar area `_id`** | none yet | **kelurahan**, 24-hex ObjectId | `5fc62dd8f8f44b34aa4bc94a` |

The KiriminAja integer ids **cannot** be converted to Mengantar ids. The only bridge is names plus postcode.

### 3.2 99ribu's dataset

- `~/Projects/99ribu/data/shipping/mengantar-areas.json.gz` (897 KB): `{source, harvested_at, count, areas:[{id, province, city, district, subdistrict, postal_code}]}`.
  Counted here: **82,374 kelurahan rows**, 7,103 distinct province/city/district triples, 8,296 postcodes, 0 rows without a postcode.
  `harvested_at` = 2026-11-04. Harvest report: 25,959 queries, 0 failed, 210 queries still capped at 50 rows (dense Aceh gampong),
  145 Kepmendagri kecamatan with no Mengantar counterpart.
- ⚠️ The 82,374-row file is **uncommitted** in 99ribu (`git status`: ` M data/shipping/mengantar-areas.json.gz`, `?? README.md`). The committed
  version is the 2026-10-30 harvest (79,391 rows per its README). Pick and pin one file before importing.
- Producer: `~/Projects/99ribu/scripts/mengantar-areas.ts` (`harvest`, `harvest-extra`, `harvest-zip`, `build`, `load`). It calls only `/address/search`.
  Its Postgres shape is `99ribu/migrations/0042_mengantar_areas.sql` (`app.shipping_area`: `id ~ '^[0-9a-f]{24}$'` check, postal check,
  `dataset_version`, postal index).
- Licence: the rows are **Mengantar's own catalogue**, harvested from its API. **Redistribution terms are UNVERIFIED.** Storing it in our
  database in order to call Mengantar is the same use 99ribu makes of it. Committing the gz into TokoΦ's public-facing repo is a
  question for the owner. The harvest's driver list `indonesia-districts.json` is MIT (cahyadsn/wilayah, Kepmendagri 2025).

### 3.3 Mapping feasibility (measured offline, 2026-11-05)

A throwaway script joined TokoΦ's committed CSVs (`packages/db/data/kiriminaja-areas.csv`, `kelurahan.csv`) to the 99ribu dataset with a
naive normaliser: upper-case, drop brackets, `KOTA`/`KABUPATEN`, and non-alphanumerics. Nothing was written.

| Join | Result |
|---|---|
| KiriminAja district ↔ Mengantar (district, city) | **6,900 / 7,030 (98.2%)** match; 130 unmatched |
| TokoΦ kelurahan ↔ Mengantar by (name, postcode), unique | 50,525 |
| …ambiguous (several `_id`s) | 129 |
| …further matches by (name, district) | 20,671 |
| …unmatched | **7,439 / 78,764 (9.4%)** |

The 130 districts and 7,439 kelurahan can be reduced by aliasing Roman numerals and slashes, and by a Mengantar-side search by postcode. Those are the same
techniques 99ribu's `build` step already applies.

### 3.4 Recommendation

**Import 99ribu's dataset as a new reference table, and bridge from the existing tables.** Do not replace the KiriminAja tables: they keep
KiriminAja runnable, and they own the postcode and centroid data.

1. **Migration `0116_mengantar_areas.sql`**, hand-written and idempotent per `specs/docs/rules/migrations.md`. Re-check the next number against
   `origin/main` before writing it: the journal ends at `0115` on this worktree and on `origin/main` today.
   ```sql
   -- Mengantar's own area catalogue (kelurahan grain). Reference data, not store-scoped (no RLS),
   -- same class as kiriminaja_areas / kelurahan. Loaded by packages/db/scripts/load-mengantar-areas.mjs.
   create table if not exists mengantar_areas (
     id text primary key,                                   -- Mengantar `_id`
     province text not null, city text not null, district text not null,
     subdistrict text not null, postal_code text not null default '',
     dataset_version text not null,
     constraint mengantar_areas_id_check check (id ~ '^[0-9a-f]{24}$'),
     constraint mengantar_areas_postal_check check (postal_code = '' or postal_code ~ '^[0-9]{5}$')
   );
   create index if not exists mengantar_areas_postal_idx on mengantar_areas (postal_code);
   create index if not exists mengantar_areas_district_idx on mengantar_areas (district, city);
   -- Bridges: nullable, a NULL means "not matched", never a guess.
   alter table kelurahan        add column if not exists mengantar_area_id text;
   alter table kiriminaja_areas add column if not exists mengantar_area_id text;  -- district representative (see 3.5)
   alter table store_settings   add column if not exists sender_mengantar_area_id text;
   alter table store_settings   add column if not exists mengantar_pickup_address_id text;
   alter table orders           add column if not exists ship_mengantar_area_id text;
   comment on column kelurahan.mengantar_area_id is '…';  -- one per column, per repo convention
   ```
   Foreign keys are left out on purpose, because a refreshed dataset may drop an id an old order still names (99ribu `load` upserts and never deletes for the same reason).
2. **Loader script** `packages/db/scripts/load-mengantar-areas.mjs`: read the pinned gz, upsert in batches, then fill the bridges
   using exactly the §3.3 join with the 99ribu aliasing rules. **Only unique matches are written.** Ambiguous and unmatched rows are printed with counts,
   the same discipline as `ka-kelurahan-unmatched.csv`. The loader is re-runnable and idempotent. It runs on the shared dev DB only after the migration is
   merged and deployed (repo DB rules). Data in production is loaded by an explicit, approved step, because **the seed is not a migration**.
3. **Runtime resolve fallback**, the adsbookcms pattern: when a checkout destination has no `mengantar_area_id`, search
   `/address/search` with `kelurahan + postcode`, then `district + city`. Store the answer only on an exact match.
4. **Refresh** follows 99ribu's README procedure. TokoΦ never runs its own harvester; it imports 99ribu's artefact (one owner of the dataset).

### 3.5 Grain decision (open)

Mengantar ids are per kelurahan. TokoΦ's checkout asks for the kelurahan **only when the kecamatan has more than one postcode** (82% of districts have
one; `schema.ts` comment on `orders.ship_kelurahan_id`). There are two options:

- **(a) Quote by a district representative** (`kiriminaja_areas.mengantar_area_id` = one kelurahan of that district, chosen deterministically, e.g. the one matching the district's main postcode) and **book with the kelurahan** when known. adsbookcms effectively does this: it books with
  `items[0]` of a district search. Whether a different kelurahan in the same kecamatan can change the price is **UNVERIFIED**. It probably cannot, since
  `DESTINATION_CODE` looks district-level (`DJJ20411` in the docs example), but this needs one measurement.
- **(b) Always require a kelurahan when the provider is Mengantar.** This is more correct, but it adds a required field to checkout and is against the current
  "ask only where it changes the answer" rule.

Recommendation: (a). Before go-live, measure price equality across the kelurahan of 20 districts with read-only `/order/estimate` calls.

---

## 4. KiriminAja → Mengantar mapping per TokoΦ operation

| Operation | TokoΦ today (KiriminAja) | Mengantar equivalent | Gap / behaviour change |
|---|---|---|---|
| **Area search** (checkout, seller pickup form) | local `kiriminaja_areas` + `kelurahan` (`apps/admin/lib/data/areas.ts`); `kaAddressByName` fallback | local `mengantar_areas` via the bridges; `/address/search` fallback (50-row cap) | grain is kelurahan (§3.5); spellings differ, so search stays on the existing tables and only the **id** changes |
| **Quote** (`apps/admin/lib/shipping-quote.ts`, the ONE price producer) | `POST v6.1/shipping_price` (origin/dest district id, grams, **L×W×H**, item_value, couriers[]) → services with `service`, `service_type`, `cost`, `etd`, `cod`, `group`, `setting.cod_fee*` | `GET /order/estimate?courier=all` (area `_id`s, **kg**, opt. `COD_AMOUNT`) → map keyed by courier with `price`, `unsupported`, `unsupported_cod`, `codFee`, ETD only sometimes | **No service_type**: one rate per estimate key, so `QuotedRate.code` = normalised courier and `type` = estimate key (`JNE`, `SAPLite`, …). **No dimensions**: "same box" holds trivially, but volumetric surcharges become post-hoc (UNVERIFIED). **No `group`**: derive it (`*Cargo` → cargo, `SAPLite` → economy, else regular). **No `couriers[]` narrowing**: `courier=all` is one call, so `FAST_COURIERS` loses its purpose. Measure latency (UNVERIFIED). Min 1 kg billing matches today's `billableGrams`. Cache key: origin, dest, kg, COD flag, provider |
| **COD rule** (`apps/admin/lib/cod.ts` / `cod-policy.ts`) | `platform_cod` ∧ `platform_couriers.services[].codAllowed` (SPX only) ∧ `store_settings.cod_enabled`; rate's raw `cod` | same three switches; the raw capability becomes `!unsupported_cod && !unsupported && !unsupportedOriginSpx` | `codAllowed` is keyed on (courier, type), so new service rows are needed for Mengantar keys. **SPX booking via Mengantar is unproven** (§1.3 trap 2). Add the **POS-COD auto-off** on a 403 (adsbookcms pattern). Per-courier COD caps (JT/AnterAja/POS 2 jt, SiCepat 2.5 jt, JNE/ID 5 jt, docs `02` §3.2) sit under the platform's own Rp2 jt cap, so no conflict today |
| **COD fee** | KiriminAja `setting.cod_fee_amount` shown on the seller's Cek Ongkir | `codFee`, only when `COD_AMOUNT` is sent; observed **3.33% = 3% + 11% VAT** of COD_AMOUNT (reconciliation note, 550/554) | `COD_AMOUNT` must be goods + ongkir, so it needs a second estimate (or our own computation) after the rate is picked. Whether `estimatedSpecialPrice` includes the COD fee is **UNRESOLVED** (note §open questions) |
| **Booking** (`actions/shipping.ts` `createShipment` → `kaCreateOrder`) | `POST v6.2/request_pickup`: sender block + `packages[]` with `order_id` = `${prefix}-${ref}` (≤20 chars), item manifest, `cod`, `shipping_cost`, `schedule` | `POST /order`: `courier` (shipment name), `pickup{…address_id}`, `orders[]{…, COD \| goodsValue, destinationMark = order number, customProducts[]}` | The sender is a **pre-registered pickup address** (`POST /address` per store → `store_settings.mengantar_pickup_address_id`), not a block per booking. There is **no client order id**, so idempotency is ours (adsbookcms §2.2.1). `customProducts` is optional, but if sent, weight and qty must equal the sums exactly. The **one-booking-at-a-time lease is platform-wide**. `COD` = what the buyer pays (`orders.total_idr`), same as adsbookcms `total_amount` (`mengantar-dispatch.ts:479`) |
| **Payment of a non-COD booking** (`shipment-payment.ts`, `ka_payment_status`, `ka_payment_url`) | booking returns `payment_status` + VA/QR `qr_url` | the platform **wallet** is debited; a low balance gives `isPaid:false, cnote_no:null` → top up → `POST /order/pay-unpaid {batch_id, courier}` | no per-order payment URL; one wallet for all stores. Store `batch_id` + `isPaid`. Wallet balance comes from `GET /invoices` → `balance` (Super Admin tile + alert) |
| **AWB fill** (`cron-tracking`, `ka-tracking.ts`) | booking returns `awb: null`; the cron fills `orders.awb` once the courier accepts, and **AWB appearance ⇒ `dikirim`** | `cnote_no` is usually returned **at booking** (null only if unpaid or pending) | 🔴 **The "AWB appeared ⇒ dikirim" rule must not carry over.** With Mengantar a waybill exists before pickup, so `dikirim` must come from a PICKED UP / ON DELIVERY status. For a null `cnote_no`, poll `GET /order?order_id=ORDER_ID` |
| **Tracking statuses** | numeric codes 100–905 → `booked/shipped/delivered/returned/canceled/problem`; free text can only reach `shipped` | webhook `status_category`: `PENDING PICKUP`→booked · `PICKED UP`, `ON DELIVERY`→shipped · `DELIVERED`→delivered · `RTS`→returned · `CANCELED`/`CANCELLED`→canceled · `UNDELIVERED`, `PICKUP FAILED`, `ERROR`→problem · `ACTIVE/WAITING NEXT PROCESS`→null. Polled `status` = JSON flags (`DELIVERED_COMPLETED`, `RTS*`, …) | Keep the rule that **money-moving outcomes come only from a verified pull** (`verifyKaHint` equivalent: webhook → `GET /order?tracking_id=`). The full polled flag vocabulary is **UNVERIFIED**; adsbookcms's list (`mengantar-client.ts:193-229`) is the best evidence. `problem` must clear when movement resumes (existing `problem_at` contract) |
| **Webhook** (`api/public/kiriminaja/webhook`) | bearer = our key echoed, no signature, so the body is a hint | HMAC-SHA256 over `x-timestamp.rawBody`, secret from the Mengantar dashboard | stronger auth, but **still a hint**. Must answer 200 within 5 s (enqueue, then verify). Needs a raw body (`req.text()` before parse) and a timestamp window. The official test vector (docs §11.4) makes a ready unit test. Enablement for the platform account is UNVERIFIED |
| **Cancel** (`cancelShipment` → `kaCancelShipment`, AWB only) | by AWB; non-COD void queued up to 48 h | `DELETE /order {courier, ids:[_id]}` | keyed by **Mengantar `_id`**, not AWB, so a fresh booking *can* be cancelled. Anteraja: only after 5 min. Whether it works after pickup, and wallet refund timing, are **UNVERIFIED**. adsbookcms has no cancel, so this is new ground and the first production test must include it |
| **Label** (`components/admin/pesanan/shipping-label.ts`, `bulk-labels.ts`) | our own rendered label + `sorting_code` from tracking | `POST /label-generation` (BETA, whitelist, 8/min, async, URL valid 15 min) | whether a courier accepts our self-rendered label without Mengantar's routing codes is **UNVERIFIED**. Ask Mengantar for `labelGeneration` whitelisting. Until then, keep our label and print `DESTINATION_CODE`/`ORIGIN_CODE` if present |
| **Pickup** | `schedule` = tomorrow 10:00 WIB inside the booking | `pickup.type: "dropOff"` (adsbookcms default) **or** `scheduledPickup` + `time_id` (`POST /time`, `mm-dd-yyyy`, slots 9–18, ≥90 min) + `volume` (`volumeMotor/Mobil/Truck`) | one slot per pickup address per day, re-used via `GET /time`. A rejected slot must leave the order in a "choose pickup time" state, not failed (docs `08` §B) |
| **Courier roster** (`kaServices`) | price one reference route and harvest the services | same trick: one `courier=all` estimate on a reference route, keyed by estimate key | Cargo keys excluded (adsbookcms `:606`); Ninja discontinued since 2026-09-01 |
| **Balance / health** (`kaCreditBalance`, `kaTestConnection`) | KA credit endpoint | `GET /invoices?size=1` → `balance`; "test connection" = `GET /address` | read-only, safe on production |

---

## 5. Implementation plan

### 5.1 `packages/lib/src/mengantar.ts`

This mirrors `kiriminaja.ts`, and only this package names the vendor (ADR 0004).

```ts
export type MengantarConfig = { base: string; key: string | null; keySource: ConfigSource; webhookSecret: string | null };
export class MengantarTransportError extends Error {}      // non-JSON / network, carries path + status, key redacted
export class MengantarOutcomeUnknownError extends Error {}  // timeout, network drop, 5xx, unreadable 2xx on a WRITE
export class MengantarPosCodIneligibleError extends Error { status; deliveredRate; minimumDeliveredRate }
export class MengantarNotWhitelistedError extends Error {}

mgSearchArea(keyword): Promise<MgArea[]>
mgPickupAddresses(): Promise<MgPickupAddress[]>
mgUpsertPickupAddress(input): Promise<string /* _id */>              // re-list when data._id is missing
mgPickupSlot(addressId, date: "YYYY-MM-DD", hour): Promise<string /* time_id */>  // GET /time first, then POST
mgEstimate({ originId, destinationId, kg, codAmount? }): Promise<MgRate[]>        // map → array, flags normalised, cargo skipped
mgCreateOrder(payload): Promise<{ id; orderId; batchId; cnoteNo: string | null; isPaid: boolean }>
mgPayUnpaid(batchId, courier)
mgTrackByCnote(cnote) / mgTrackByOrderId(orderId): Promise<MgTracking>           // parses the flag-JSON once
mgCancel(courier, ids)
mgBalance(): Promise<{ balance: number | null }>
mgVerifyWebhook(secret, timestamp, rawBody, signature): boolean                  // timing-safe, hex
shipmentName(estimateKey): { courier: string; cargo: boolean } | null           // the ONE namespace map (§1.3 #1)
outcomeFromMengantar(statusOrFlags): Outcome | null                              // shared Outcome type with KA
```

Rules carried over: redact the key from every error; a fixed 10 s timeout; read business failures from the body (do not throw on a 4xx with JSON); `price`, never `estimatedSpecialPrice`, as the shopper price; record `estimatedSpecialPrice` as our cost (analogue of `ka_shipping_cost_idr`).

### 5.2 Provider config and the Super Admin setting

`packages/lib/src/provider-config.ts` gains `resolveMengantar({row, env})`. It stays pure and table-tested:

- row (decrypted by the `@tokophi/db` loader) > env `MENGANTAR_API_KEY` > none. Base URL: env `MENGANTAR_BASE_URL` > `https://api-public.mengantar.com`.
  These are the **same names adsbookcms uses**, so one secret value serves both.
- **No `active_env` for Mengantar** (owner: production only). That removes the KiriminAja sandbox-looks-like-production trap
  for this provider, at the price of every call being live (risk R2).
- `webhookSecret` from `MENGANTAR_WEBHOOK_SECRET` or the row.
- `ProviderConfig` gains `mengantar` and a top-level **`shipping: "kiriminaja" | "mengantar"`** (row > env `SHIPPING_PROVIDER` > `"kiriminaja"`).
  The safe default is today's behaviour.
- `maskKey()` stays the only form a key takes outside the resolver; `providerHealthSummary()` adds `mengantar.key` source + active provider.

Storage (same migration or a sibling one; idempotent, text with CHECK instead of a new enum value. `ALTER TYPE … ADD VALUE` cannot be used inside
the same migration transaction that uses it):

```sql
create table if not exists shipping_provider_config (
  id smallint primary key default 1 check (id = 1),
  active_provider text not null default 'kiriminaja' check (active_provider in ('kiriminaja','mengantar')),
  mengantar_key_enc text,             -- AES at rest, scope provider:mengantar:key (same helper as 0111)
  mengantar_webhook_secret_enc text,
  mengantar_tested_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into shipping_provider_config (id) values (1) on conflict do nothing;
```

The Super Admin "Pengiriman / Aggregator" card adds a Mengantar panel with: key input (write-only, masked tail), webhook secret, **Test koneksi**
(`GET /address` + `/invoices` balance, both read-only), wallet balance, and the **active provider switch**. Switching is `owner` rank, requires a reason,
is audit-logged to `platform_activity`, and calls `invalidateProviderConfig()`. The switch is refused while Mengantar has no key, no tested-at, or no
pickup address for any store with orders in `diproses`. KiriminAja's panel and keys stay untouched.

### 5.3 Provider switch design

- **Booking is stamped per order**: new `orders.shipping_provider text` (null = legacy = kiriminaja) + `orders.mg_order_id`, `mg_order_code`,
  `mg_batch_id`, `mg_is_paid` (prefix `mg_` mirrors `ka_`). **Tracking, cancel, label and pay follow the order's own stamp**, never the
  current switch. Flipping the switch mid-flight must not strand KiriminAja parcels: the KiriminAja cron and webhook keep serving `ka_order_id` rows until
  none are open.
- **Quote and checkout follow the switch.** `quoteShipping` dispatches on `cfg.shipping`. The `/api/public/order` re-quote calls the same
  function, so the quote and re-quote can never come from two providers. The order route stamps `shipping_provider` from the quote it re-made.
- Store-level data per provider: `store_settings.sender_kecamatan_id` (KiriminAja) and `sender_mengantar_area_id` + `mengantar_pickup_address_id`
  (Mengantar). Saving the seller's pickup form writes both, and registers or updates the Mengantar pickup address when Mengantar is configured.
- Courier selection: `platform_couriers.services[]` and `store_shipping_methods` are keyed by (courier, type). Give the Mengantar services their
  own rows (type = estimate key) so the two rosters never collide. The merchant re-selects once after the switch, and the UI says so.

### 5.4 Files to change

| File | Change |
|---|---|
| `packages/lib/src/mengantar.ts` (+ `mengantar-tracking.ts`) | new client + pure parsers |
| `packages/lib/src/provider-config.ts` | `resolveMengantar`, `shipping` selector, env names, health summary |
| `packages/db/drizzle/0116_*.sql` + journal | areas table, bridges, order/store columns, `shipping_provider_config` |
| `packages/db/src/schema.ts` | Drizzle defs for the above |
| `packages/db/src/…` loader | decrypt the new row into `ProviderRows` |
| `packages/db/scripts/load-mengantar-areas.mjs` | import + bridge fill |
| `apps/admin/lib/shipping-quote.ts` | provider dispatch; `QuotedRate` from Mengantar map; COD flag from `unsupported_cod` |
| `apps/admin/lib/cod-policy.ts` / `cod.ts` | no rule change; Mengantar service rows in `platform_couriers`; POS auto-off hook |
| `apps/admin/app/api/public/ongkir/route.ts`, `…/order/route.ts` | destination id per provider; stamp `shipping_provider`; provider text never reaches the shopper |
| `apps/admin/lib/actions/shipping.ts` | `createShipment` / `cancelShipment` / `trackShipment` / sender address branch on the order's provider; claim + platform-wide lease + outcome-unknown (copy adsbookcms §2.2.1) |
| `apps/admin/lib/shipment-payment.ts` | wallet-unpaid state + pay-unpaid action |
| `apps/admin/lib/ka-tracking.ts` → shared `tracking-sync.ts` | one sync function, outcome from either mapper; the "AWB ⇒ dikirim" rule becomes KiriminAja-only |
| `apps/admin/app/api/cron/tracking/route.ts` | also sweep `mg_order_id` rows (cnote null → by ORDER_ID) |
| `apps/admin/app/api/public/<webhook>/route.ts` | HMAC verify → enqueue hint → verified pull. The path name must pass the brand guard; choose a neutral path or add an allowance |
| `apps/admin/components/admin/pesanan/shipping-label.ts`, `lib/data/bulk-labels.ts` | provider-aware label fields |
| `apps/super-admin/lib/actions.ts`, `lib/data.ts`, the aggregator card, `ka-probe.ts` analogue | config panel, switch, balance |
| `packages/lib/src/provider-label.test.ts` | add `mengantar` to `BRAND` |
| `specs/docs/rules/shipping-cod.md`, `AGENTS.md` Shipping & COD, `SECURITY.md`, `FINANCE.md`, `SLA-DRP.md` | document the second provider, the wallet, the shared-account risks |

### 5.5 Tests to add

- `provider-config.test.ts`: Mengantar precedence table (row > env > none), `shipping` default `kiriminaja`, the mask.
- `mengantar.test.ts` (fetch mocked): key never present in any thrown message (raw and URL-encoded); timeout or 5xx on `POST /order` ⇒
  `MengantarOutcomeUnknownError`; JSON 4xx ⇒ business error; POS 403 trio parsed; `courier=all` map → rates, cargo skipped,
  `unsupportedOriginSpx` ⇒ unsupported; `price` used and `estimatedSpecialPrice` never; `shipmentName()` table (`SAP→Sap`, `JNECargo→JNE+cargo`, unknown ⇒ null).
- `mengantar-webhook.test.ts`: the **official test vector** (secret `testsecret`, ts `1787548800000`, expected
  `05826dec…a111`) passes; a one-byte body change fails; a stale timestamp fails; the body is never trusted for money (it spends one pull).
- `outcomeFromMengantar` table: every `status_category`, both cancel spellings, flag-JSON inputs, garbage ⇒ null.
- Dispatch exactly-once (DB-coupled suite, `npm run test:db`): concurrent `createShipment` on one order produces one HTTP call; outcome-unknown blocks re-push;
  lease is platform-wide across two stores.
- Quote ⇄ re-quote parity: the same input gives the same `QuotedRate[]` from the same provider; a provider switch between quote and order makes the order
  route reject the picked service (fresh-quote rule), never re-courier it.
- Booking payload: weight = Σ all lines (guards against A1); `COD` = `total_idr`; `customProducts` sums equal weight/qty when sent.
- Area loader: id regex, unique-only bridge writes, idempotent second run.
- Each new source-reading guard proven red against a mutated copy (repo testing rule).

### 5.6 Rollout order

1. Land migration + loader + client + config with `shipping = kiriminaja`. This is dark and changes nothing for shoppers.
2. Read-only production probes, owner-approved: `GET /address`, `/invoices` balance, `/order/estimate` on 20 districts (grain question §3.5) and on the
   SPX COD routes in the 6 COD provinces.
3. **One owner-approved production booking**, non-COD, on a real parcel, then **cancel it** via `DELETE /order`. Record the request/response shapes
   (sanitised) in `specs/docs/tasks/`. Repeat once with SPX COD before COD is offered.
4. Register the webhook URL, verify one real event.
5. Flip the switch for the platform, watch the first real orders end to end (book → pickup → tracking → delivered → COD reconciliation via `/invoices`).

---

## 6. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **One platform account shared by every store.** One lease (409), one wallet, one **POS-COD delivered rate**, one RTS reputation: a single high-RTS merchant can block COD POS for all | high | platform-wide lease; POS-COD auto-off; per-store RTS monitoring; ask Mengantar about sub-accounts (UNVERIFIED) |
| R2 | **Production-only**: every test booking is real money and a real courier visit; there is no rehearsal | high | read-only probes first; single approved booking + cancel; never run booking code in CI or tests (mocked fetch only); a code-level refusal when `NODE_ENV=test` |
| R3 | **Same key as adsbookcms** (if the owner reuses that account): the two systems' leases don't see each other (409 cross-traffic), wallet and COD reconciliation are mixed, POS-COD eligibility is shared | high | prefer a **separate Mengantar account for TokoΦ**; if shared, match reconciliation strictly by `cnote_no` we issued |
| R4 | **Duplicate shipment** after timeout or 5xx on `POST /order` (no idempotency key) | high (money) | adsbookcms claim + outcome-unknown + operator release; search by `destinationMark` before release (filter support UNVERIFIED) |
| R5 | **AWB before pickup**: reusing "AWB ⇒ dikirim" marks every order shipped at booking; a buyer is told it is on its way and RANK is forward-only | high | status-driven `dikirim` for Mengantar orders; a test that pins it |
| R6 | **SPX via Mengantar never booked live**, and COD is SPX-only | high | step 3 of rollout before COD; keep KiriminAja as the instant fallback switch |
| R7 | **COD money map changes**: Mengantar collects and pays out to the platform wallet (`amount = COD_AMOUNT − estimatedSpecialPrice` per AWB); KiriminAja settles differently. `creditSaleForPayment` / seller ledger timing must be re-specified | high | FINANCE.md decision before the switch; reconcile from `/invoices` `typeReconciliation` |
| R8 | **Webhook-delivered = COD cash.** A forged or replayed event could settle an order | high | HMAC + timestamp window + verified pull (body is a hint), as today |
| R9 | **Non-COD wallet runs dry** → silent `isPaid:false`, no waybill | medium | balance tile + alert threshold; unpaid state visible per order; pay-unpaid action |
| R10 | **Courier name namespace** (`SAP` vs `Sap`, Lite, Cargo) books the wrong service or is refused | medium | one `shipmentName()` table + test; SAP/Lite disabled until proven |
| R11 | **Area mismatch** (9.4% of kelurahan, 1.8% of districts unmatched; new kecamatan absent) → wrong destination or no quote | medium | unique-only bridges; live exact-match resolve; the checkout shows "tidak ditemukan" rather than a guess |
| R12 | **Volumetric re-weigh** not quoted (no dimensions in the API) → post-hoc cost | medium | record `estimatedSpecialPrice` at booking and compare with the invoice amount |
| R13 | **Self-rendered label rejected** without Mengantar routing data | medium | request `labelGeneration` whitelist; respect the 8/min limit |
| R14 | Dataset licence and redistribution terms for Mengantar's catalogue | low–medium | owner decision before committing the gz to TokoΦ |
| R15 | Brand leakage: Mengantar's name in shopper or seller copy (ADR 0004) | low | extend the `provider-label.test.ts` `BRAND` regex |

## 7. Open questions for the owner / Mengantar

1. A dedicated Mengantar account for TokoΦ, or the adsbookcms account (R3)?
2. COD settlement: does the platform wallet receive COD and then pay sellers through our ledger (R7)?
3. Webhook availability on the chosen account; `labelGeneration` whitelist.
4. `DELETE /order` semantics (`ids` vs `orderIds`, after pickup, refund timing).
5. `POST /order` courier case-sensitivity; how to book `SAPLite`.
6. Does `estimatedSpecialPrice` include the COD fee and its VAT?
7. Which 99ribu dataset version to pin, and whether the gz may live in this repo.

## 8. Quote/checkout wiring (implemented 2026-11-05, branch `feat/shipping-mengantar`, local only)

What now follows the platform switch (`getProviderConfig().shipping`): `quoteShipping`
(`apps/admin/lib/shipping-quote.ts`), therefore `/api/public/ongkir` (`op:"rates"`) and the
`/api/public/order` re-quote. Booking, tracking, cancel and label are **not** wired yet.

**Dispatch.** `quoteShipping` → `quoteKiriminaja` (the old body, unchanged) or `quoteMengantar`. Both return the
same `Quote`, now carrying `provider` and `destinationAreaId`. The order route stamps
`orders.shipping_provider = quote.provider` and, for Mengantar, `orders.ship_mengantar_area_id = quote.destinationAreaId`
— from the quote it re-made, never from the request. The ongkir route's configured check is
`shippingConfigured()` (the active provider's key), and its response shape is unchanged: provider and
Mengantar ids are not returned to the browser.

**Origin.** `store_settings.sender_mengantar_area_id` only. No store-city fuzzy fallback for Mengantar
(a guessed origin is a pickup we cannot book) → "Alamat pengambilan toko belum diatur."

**Destination** (the checkout still sends the KiriminAja district id; it may send a kelurahan NAME):
1. the picked kelurahan's `kelurahan.mengantar_area_id` (exact, case/space-insensitive name match inside that
   district — `pickMengantarKelurahan`);
2. else the district representative `kiriminaja_areas.mengantar_area_id`;
3. else "Ongkir belum tersedia untuk kecamatan ini." — no live `mgSearchArea` resolve was added (nothing stored, nothing guessed).

Note: the storefront does **not** send `kelurahan` on `op:"rates"` today, while the order route does. So the price the
shopper SAW is the district representative's and the price the order STORES may be the kelurahan's. The order always
stores the server re-quote, so this is a displayed-vs-charged gap only if two kelurahan of one kecamatan price
differently — §3.5's UNVERIFIED measurement. If it does differ, either send `kelurahan` from the checkout or quote the
order by the representative and book by the kelurahan.

**Weight.** `weightForCart` (Σ every line, 1 kg floor) → `billableGrams / 1000` kg, sent unrounded (e.g. `1.5`).
No dimensions (trap 7).

**Mapping.** `MgRate` → `QuotedRate`: `code` = `mgCourierCode(key)` (TokoΦ courier code: `JT`→`jnt`,
`iDexpress`→`idx`, `SAP`→`sap` (`SAPLite` is never quoted or booked — M8), …; additive helper in `packages/lib/src/mengantar.ts`), `type` = estimate key
verbatim, `cost` = `price` (never `estimatedSpecialPrice`), `group` = `mgGroup`, `etd` when present. Unknown keys and
Cargo are never quoted. **COD: every Mengantar rate has `cod:false` and the quote has `codEnabled:false`**, whatever
`unsupported_cod` says. The order route also refuses `channelCode:"cod"` on a Mengantar quote outright (403
`cod_not_allowed`), before any write. Consequence: the COD-only order funnel (`OrderFunnel.astro`) shows "COD belum
tersedia" while the switch is on Mengantar. That is intended for phase 1.

**Cache.** `mgEstimateCacheKey` = `mengantar:estimate:<sha256(base+key)[:12]>:<origin>:<dest>:<kg>`, 10 min, non-empty
answers only. KiriminAja's stays `ka:price:…`.

**The courier-filter rule** (`mengantarRates`, pure, tested):
1. **Platform:** the rate's TokoΦ courier must be in `platform_couriers` enabled (instant excluded). **An empty
   platform list quotes nothing.** The KiriminAja branch's "empty = no filter" (`if (platformOn.length)`, backup doc
   §9.1 #1) is deliberately not copied. The KiriminAja branch itself is unchanged.
2. **Store courier column** (`store_settings.couriers`), when set: the courier must be in it.
3. **Store per-service** (`store_shipping_methods`, enabled rows):
   - If rows exist whose `service` is a Mengantar estimate key of that row's courier (e.g. `sap:SAPLite`), only those
     keys are quoted.
   - Otherwise, if the store has KiriminAja rows, only the couriers those rows name are quoted, at every Mengantar
     service for them. The merchant keeps their couriers until they save a Mengantar selection.
   - With no rows, there is no further narrowing.
4. `couriers` (the checkout's fast pair / the order's picked courier) only **narrows** the answer. Mengantar answers
   `courier=all` in one call, so it is no longer a latency control, and it never widens past 1–3.

Saving a Mengantar per-service selection needs the Seller "Jasa Kirim" card to offer estimate keys; that UI is a later
step. Until then rule 3's second case applies.

**Tests.** `apps/admin/lib/shipping-quote-mengantar.test.ts` covers dispatch both ways (real Mengantar client, stubbed
`fetch`), mapping, kg, Σ lines, price-not-special, COD forced off, destination order, missing origin, empty platform,
provider-flagged errors, and the cache. `apps/admin/app/api/public/ongkir/route.test.ts` covers the contract, and that
provider words are replaced by `SHIPPING_QUOTE_UNAVAILABLE`. `apps/admin/app/api/public/order/route.test.ts`, under
"SHIP-MENGANTAR phase 1", covers the stamp, the COD 403, the fresh-quote rejection and provider text.

**Still UNVERIFIED (measure before go-live, read-only `/order/estimate` calls):**
- price equality across the kelurahan of one kecamatan (§3.5), which decides whether the kelurahan-first destination
  can make the charged price differ from the displayed one;
- whether `/order/estimate` accepts a fractional `weight` and how it rounds; the booking must send the same kg;
- the `estimate_delivery` / `estimatedDate` ETD fields' presence per courier;
- latency of `courier=all` against the KiriminAja fast-pair 0.5 s;
- how many districts have a NULL `kiriminaja_areas.mengantar_area_id` once the loader has run on real data (each one
  is a checkout with no rates under Mengantar);
- that no KiriminAja `service_type` string equals a Mengantar estimate key of the same courier; rule 3 would read it
  as a Mengantar selection;
- `resolveArea`'s live KiriminAja fallback (area search) is still KiriminAja-only. Under Mengantar with no KiriminAja
  key, a search that misses the local table is not covered here.

## 9. Booking / tracking / cancel / webhook / label wiring (implemented 2026-11-05, local only)

Everything below follows the ORDER's `shipping_provider` stamp (NULL = KiriminAja), never the switch.

- **Dispatch.** `actions/shipping.ts` `getShippingRates` / `createShipment` / `cancelShipment` / `trackShipment` read the
  stamp (through RLS) after `requireCapability`, and hand a Mengantar order to `lib/mengantar-shipping.ts` /
  `lib/mengantar-tracking.ts`. `bulkGenerateResi` / `bulkFetchResi` call those actions, so they dispatch per order.
- **Booking (`bookMengantar`).** Guards → re-quote (same `mengantarRates` scope, kecamatan representative as the price
  destination, Σ-lines kg) → pickup address (`POST /address` once per store, CAS-stored) → slot (tomorrow 10:00 WIB,
  `scheduledPickup`) → **claim** (`shipment_bookings` `reserved` under the store advisory lock + order row lock; the
  partial unique index is the DB-level guarantee) → **platform lease** (`pg_advisory_xact_lock`, one `POST /order` in
  flight; 409 retried 2×) → identity first (`accepted`, `provider_booking_id = _id`) → order `mg_*` + `awb` only from a
  real `cnote_no` → `diproses`. Outcome unknown ⇒ `unknown`, re-book refused until an operator reconciles by order number
  (`destinationMark`). COD refused (phase scope). Seller cost delta uses the KiriminAja path's ledger rule (a second copy,
  marked `lazy:`).
- **Unpaid** (`isPaid:false`): stored as `mg_is_paid=false`, shown as "Ongkir pengiriman BELUM dibayar"; becomes
  `true` when tracking sees a cnote. **No pay-unpaid trigger is built** — owner decision (it debits the shared wallet).
- **Tracking.** `cron/tracking` runs `sweepMengantarTracking` when the Mengantar key is set (KiriminAja sweep unchanged).
  Pull by cnote, else by ORDER_ID. One writer: `syncOrderFromKa` (provider-neutral; its confirmed-void branch also clears
  `mg_*`). Status ONLY from `outcomeFromMengantar` — a waybill never means `dikirim`.
- **Cancel (`cancelMengantar`).** Intent first, `DELETE /order {courier: mg_courier, ids: [mg_order_id]}`, answer after;
  no AWB needed. Reconciled by tracking (CANCELED → voided + ids cleared; moved → reverted; 404/empty → "attention").
- **Webhook** `POST /api/public/mengantar/webhook`: header-only HMAC, fail closed, body is a hint → verified pull
  (3 s timeout), lookup restricted to Mengantar-stamped orders. Replay = idempotent re-apply.
- **Label.** Our own label with the cnote; "Ref booking" = ORDER_ID; the KiriminAja sorting-code warning is not raised
  for Mengantar orders (R13 unverified — `labelGeneration` whitelist still to request).
- **Tests.** `apps/admin/lib/mengantar-shipping.test.ts`, `mengantar-webhook.test.ts`, `actions/shipping-dispatch.test.ts`.

Still to decide / prove (owner): pay-unpaid trigger; pickup vs drop-off; operator release of an `unknown` booking; the
first approved live booking + cancel (records the real `POST /order` / `DELETE /order` shapes and whether a deleted
order still answers `GET /order`).

### 9.1 Owner rulings implemented (2026-11-05, phase 3b)

- **Pickup** follows the provider's schedule: earliest still-bookable slot from `GET /time` (documented with NO parameters; only rows that NAME this address count, and documented rows name none — audit 2026-11-11), else
  the earliest rule-valid slot via `POST /time`; an unreadable schedule refuses the booking. The seller sees the slot.
- **Pay-unpaid** and **unknown-booking release** are OWNER actions on Super Admin `/pengiriman`
  (`apps/super-admin/lib/mengantar-ops.ts`) — CAS claims, verified pulls, reasons, audit lines naming the operator.
- **Live test**: `ops/mengantar-live-booking-test.ts` (run instructions in its header; `--check` first).


## 10. Docs audit 2026-11-11 (live docs re-fetched: unchanged since the 2026-11-05 snapshot)

Both live pages (`/docs/` Public, `/docs/partner/` Partner) were compared word-for-word with the 2026-11-05 copies: only
punctuation spacing differs. Findings fixed on `feat/mengantar-default-ready` (BUILD-LOG 2026-11-11 "docs audit"):

- `POST /time` hour must be ZERO-PADDED (`"09:00"`): the sandbox refuses `"9:00"` with "Time allowed 09:00, … 20:00" —
  every 9 a.m. scheduled pickup would have failed. Found only by running the client against the sandbox.
- `POST /address` and `POST /time` send JSON (as documented; both sandbox-proven). `pinpointData` is accepted and stored.
- `GET /time` rows carry only `{_id, date, time}` — never reused for an address; a slot this process created is
  remembered until it stops being bookable, so bookings do not stack a slot per parcel.
- POS is not quoted under scheduled pickup (needs `pinpointData`; TokoΦ stores no coordinates); AnterAja is not
  quoted under drop-off.
- `DELIVERED_PENDING` → delivered; a tracking row with `isDeleted: true` reads as not found.
- Partner: partner-level refusals stop the retry sweep; deterministic 400s and `SELLER_NOT_FOUND` → `failed`;
  `PARTNER_DEACTIVATED` waits 24 h; a repeat register with `apiKey: null` → `blocked`; the card shows the email
  Mengantar registered; a 403 on a store key fetches the current key with get-key (docs: never re-register).

Still open (owner): consent. The docs say "Get their agreement to the Mengantar Terms and Conditions and Privacy
Policy … it has to happen on your side". Today signup records consent without showing any Mengantar text, and a
Super Admin `createStore` registers with no consent at all (D14 made both automatic). Not changed without a ruling.
Also unverified: what `ordersClosedDestination` / `jneOrdersUnsuported` carry on a refused `POST /order`.
