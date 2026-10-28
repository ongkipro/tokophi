# Shipping & COD

> Moved **verbatim** from `AGENTS.md` on 2026-10-28 (Claude Code warns when `AGENTS.md` exceeds 150k chars, and it is
> loaded in full into every session). `AGENTS.md` keeps a short digest of the rules plus a pointer here; this file keeps
> the reasoning and the incident history. Words like "above"/"below"/"the next section" refer to the old single-file
> layout — follow the named file or section instead. **If this file and the code disagree, the code wins — fix this file.**

- **Ongkir is priced FROM the seller's pickup address** (`store_settings.sender_kecamatan_id`, set in Pengaturan → Alamat). That column **is** a KiriminAja district id — the same currency as the shopper's `destinationId` — so there is nothing to resolve and nothing to guess. It used to be `resolveArea(body.originCity || "Yogyakarta")`: a **city name posted by the shopper's browser**, fuzzy-matched, with a hard-coded fallback. Two bugs in one line — the seller's real warehouse was ignored (a Surabaya merchant quoted Yogyakarta rates on every order), and **an untrusted client string decided a price**. `body.originCity` is now ignored. **Never let the client choose the origin.** If no pickup address is set we fall back to the store's *registered* city (still the shop's data, never the shopper's) and say so in the response (`originFrom: "store-city"`) — a quote built on a fuzzy match is a guess and must be visible as one.
- ⚠️ **Rates are REAL KiriminAja API calls, but `KIRIMINAJA_ENV` defaults to `sandbox`**
  (`tdev.kiriminaja.com`). **The API is the SAME on both** — owner's ruling, 2026-08-03: same contract,
  same response shapes, so the cutover is an endpoint swap and nothing else. Do not treat it as an
  integration risk, do not write a parity check, and do not budget for API differences at cutover.
  ⚠️ **And that is exactly why a wrong setting is INVISIBLE.** A sandbox booking returns a `kaOrderId`
  and `pickup_number` shaped identically to a production one (measured: `5758-E2E68072665` /
  `XID-5544692486`), so a deploy on the wrong endpoint reads as perfectly healthy — orders say
  "dibooking", resi appear on schedule, and no courier ever collects. `unset` resolves to **sandbox**,
  so the failure mode is the default. Surfacing the active env is `NEXT.md` N35.

- **COD is ON and it is a CHAIN of three agreements** — break any link and COD silently disappears: `platform_cod.enabled` (+ cap **Rp2.000.000**, **6** allow-listed provinces: DI Yogyakarta, Jawa Tengah, Jawa Barat, DKI Jakarta, Banten, Jawa Timur) ∧ `platform_couriers.services[].codAllowed` = **SPX only** (SPX Standard `type=1`, SPX Economy `type=3` — every other courier is `codAllowed=false` **even where KiriminAja reports `cod=true`**, because a refused parcel is *believed* to return free on SPX; ⚠️ **that belief is UNVERIFIED**) ∧ `store_settings.cod_enabled` (**default false**, migration 0038 — the merchant opts in at Pengaturan → Pengiriman → "Bayar di Tempat (COD)").
- **`apps/admin/lib/cod.ts` is the ONE place that answers "may this order be paid on delivery?"** (five conditions). `/api/public/order` **rejects** a COD order that fails any of them — hiding the option in the storefront is UX; **that endpoint is the boundary**. Never re-implement the check elsewhere, and never `if (courier === "spx")`: widening COD must stay a data change (`codAllowed`), not a deploy.
  - ⚠️ **A COD-enabled store whose current selection doesn't qualify now sees a REASON, not a blank** (`checkout.astro` `#cod-hint`, written by `syncCod`). This deliberately reverses the old "hide silently, no excuse" rule: the silent hide made "COD on but invisible" look like a bug to the merchant testing it. It is a one-line explanation of the single unmet condition (non-SPX courier / SPX doesn't serve the route / province off the allow-list / over the cap) — **not** a clickable greyed-out COD row (that would be a payment we'd reject, dressed as a choice). Still UX; the endpoint is still the boundary.
- **The merchant's shipping selection is PER SERVICE** (`store_shipping_methods`, written by `saveStoreServices`), not per courier — a courier-level list cannot express "I ship JNE Reguler but not JNE YES". `/api/public/ongkir` filters rates by **(platform-enabled couriers) ∩ (picked services)**, keyed `"<courier>:<service_type>"`; **no rows = the merchant never opened the card → fall back to `store_settings.couriers`** rather than render a checkout with zero shipping options. It filtered on the courier column until `35b88a4` and offered services the seller had switched OFF.
- The `cod` flag on a rate is the **effective** one (KiriminAja capability × platform `codAllowed` × the store's `cod_enabled`) — never the raw courier capability.
- 🔴 **THE QUOTE AND THE BOOKING MUST DESCRIBE THE SAME BOX** (fixed 2026-08-03, N30).
  KiriminAja applies **volumetric weight** whenever it exceeds the actual weight. ⚠️ **The divisor is NOT a constant** (vendor spec, read 2026-09-09): `w × l × h ÷ 6` is the shorthand for regular/next-day/same-day, **÷ 4 for trucking**, and courier configs may expose `6000`/`5000`/`4000` — the doc says use the RETURNED courier configuration, never a hard-coded divisor. We are not exposed today because we send the dimensions and let them do the arithmetic; this repo hard-codes no divisor. Do not introduce one.
  `createShipment` has ALWAYS sent `length/width/height` when it books (`packageRows` → max per axis);
  the QUOTE sent weight alone, so the two priced different parcels and the merchant absorbed the gap.
  Measured live, one 1.000 g order, 6138 → 2107, SPX Reguler: **weight only Rp13.700 · weight +
  40×30×20 cm Rp54.800 · weight 4.000 g Rp54.800** — the dimensional figure and the volumetric one
  agree to the rupiah. **Rp41.100 on one parcel, 4× the quoted price.**
  ⚠️ **The dimensions live on `products`, NOT on `product_variants`** (which carries only
  `weight_grams`). An earlier audit checked the variant, found nothing, and wrongly concluded the
  columns did not exist — they have been there all along. `weightForCart` **and** `weightForOrder` now
  read them and return the max per axis; `kaShippingPrice` forwards them; **they are part of the rate
  cache key**, because two carts differing only in box size must not share a quote. Guarded by
  `apps/admin/lib/shipping-dimensions.test.ts`.
  ⚠️ **The seed writes `1×1×1 cm` for every product** — 0,17 g volumetric, so it never binds on the
  quote, but it is *also* what the BOOKING declares to the courier. Filed as N33.

- **`province` is a POST with a `{}` body, not a GET** — a GET returns
  `"Method GET is not supported for this route"`, and the payload key is **`datas`**, not `data`.
  Endpoint versions genuinely differ per route (`v6.1` price/pickup · `v3` cancel · `v2`
  get_address_by_name · unversioned province/tracking); that is the docs' own scheme, not drift.
- **THE SELLER'S SHIPPING FLOW, end to end — four steps, and step 3 is AUTOMATIC:**

  | # | step | what happens | where |
  |---|---|---|---|
  | 1 | **Proses** | `baru → diproses` via `applyOrderStatusChange` (the only writer of `orders.status`) | order detail · `/pesanan` |
  | 2 | **Atur pengiriman** | `bulkGenerateResi` books with **the service the SHOPPER paid for** (`orders.courier` + `service_type`) — deliberately NO rate picker. `createShipment` (order-detail single-order screen) is DIFFERENT — see below | order detail · `/pesanan/massal` |
  | 3 | **Resi terbit** | booking returns `awb: null` (`awbPending`); **`cron-tracking` fills `orders.awb` on its own, every 15 min**, up to 5 orders PER STORE per tick (round-robin), for orders with a `ka_order_id` in `diproses`/`dikirim`. ⚠️ Until 2026-09-14 it could not: every tracking consumer read `r.data`, which the response never has — see `KIRIMINAJA.md` §0.7b; the sandbox `awb` is `MOCK-<ref>` and is refused | `api/cron/tracking` |
  | 4 | **Cetak label** | `/api/admin/labels`, then `markLabelsPrinted` stamps `label_printed_at` — the "sudah/belum dicetak" filter | `/pesanan/massal` |

  ⚠️ **Step 2 is NOT one behavior — the two screens genuinely differ, on purpose (verified in code
  2026-08-28).** `/pesanan/massal` matches the doc above exactly: no picker, books whatever the
  shopper already paid for. The single-order screen (`order-detail.tsx`, button **"Cek Ongkir"**) is
  a deliberate escape hatch: it opens a real KiriminAja rate list and lets the seller book ANY
  service, not gated on order status (booking itself advances `baru → diproses` if needed, via the
  same `applyOrderStatusChange`, so clicking it before "Proses" just reorders the two steps rather
  than corrupting anything). **This is not the N30 quote/booking mismatch class — the buyer's charged
  `orders.shipping_idr` never changes, and the cost difference is reconciled, not hidden:**
  `createShipment` (`apps/admin/lib/actions/shipping.ts:784-891`) refuses a stale quote
  (`serverCost !== input.cost`), then computes `sellerDebit = max(0, actualCourierCost −
  shippingChargedToBuyer)` and `platformMargin = max(0, shippingChargedToBuyer − actualCourierCost)`.
  A costlier courier choice is **debited from the seller's own ledger balance**
  (`ledger_entries`, component `shipping-order-debit`) — and refused outright
  (*"Saldo Seller tidak cukup untuk selisih ongkir…"*) if the seller can't cover it; a cheaper choice
  becomes platform margin. Same `sellerShippingDebitIdr`/`platformShippingMarginIdr` mechanism as
  `order-finance.ts`. Treat this as intentional flexibility with its own guard, not a bug to unify
  away with the bulk screen.
  ⚠️ **Step 3 is the one that gets described wrongly.** The waybill is issued when a courier ACCEPTS
  the pickup, not when we book — so `awb: null` is the normal post-booking state, not a failure. The
  poller is what makes it appear; **"Ambil resi" / "Lacak" are shortcuts for a merchant who does not
  want to wait, not the mechanism.** The UI used to say *"klik 'Ambil resi' lagi nanti"*, which
  described the automatic feature as manual and left sellers watching a queue.
  ⚠️ **A label cannot be printed before step 3.** `createShipment` writes `awb` ONLY from
  `details[0].awb` — never the booking ref — so an unprinted label is never a fake resi.
  ⚠️ **`cron-tracking` is a SEPARATE sidecar** (`sleep 900`) from the daily `cron` loop, and its own
  compose comment records that `awbFilled` sat at 0 for a week when it was not running. If resi stop
  appearing on their own, check that container before touching code.
- 🔴 **CANCEL TAKES THE AWB, AND ONLY THE AWB** (fixed 2026-08-03, N34). The vendor doc says it in as
  many words — *"awb: AWB Number Already Obtained, **Not Order ID**"*. `cancelShipment` built
  `o.awb ?? o.kaOrderId`, and **every fresh booking has `awb: null`** (that is what `awbPending`
  means), so the fallback fired on exactly the parcel a merchant had just created and KiriminAja
  answered **"Paket tidak ditemukan"** — the shipment stayed live at the courier while the merchant
  read an error that sounds like it never existed. That window — booked by mistake, seconds ago — is
  precisely when someone cancels. A booking with no waybill is now refused BEFORE the call, naming the
  next step ("Klik 'Lacak'…") rather than quoting the vendor.
  ⚠️ **Cancellation is only possible before the courier collects, and a non-COD void is QUEUED up to
  48 h** — `status: true` means "accepted for cancellation", not "cancelled".
- **A booking returns `awb: null`; the waybill lands later.** Verified live 2026-08-03:
  `request_pickup` → `{ok:true, kaOrderId:"5758-…", pickupNumber:"XID-…"}` with no AWB, and
  `tracking` answering *"Tracking tidak tersedia"* until one exists. `cron/tracking` is what fills it
  (`awbFilled`), and it must never store the booking ref as the waybill — `createShipment` writes
  `awb` **only** from `details[0].awb` for that reason.
  ⚠️ **The pickup schedule is TOMORROW 10:00 WIB, computed in `Asia/Jakarta`, and that is deliberate**
  — couriers enforce a daily cut-off. A test that books `now + 1h` is correctly refused with
  *"Jadwal penjemputan tidak lagi tersedia"*; the script is wrong, not the code.
- **`apps/admin/lib/shipping-quote.ts` is the ONE place a shipping PRICE is produced.** `/api/public/ongkir` quotes the checkout and **`/api/public/order` RE-QUOTES the order before it writes `orders.shipping_idr`** — same function, same origin, same DB weight, same platform∩store service scope. `body.shipping.cost` is **not read** (the storefront no longer sends it): the order stores the price *we* computed for the service the shopper picked (matched on `courier`+`service_type`), and a picked service that is **not in the fresh quote is REJECTED**, never silently re-couriered. Do NOT "validate the client's number against ours" — a tolerance is just a smaller hole. ⚠️ Consequence: a KiriminAja outage now fails the order. Deliberate — a parcel we cannot price is a parcel we cannot ship.
- **Item prices come from `product_variants`, not from the cart.** `items[].price` used to be summed into `orders.subtotal_idr` + the line items, so `price: 0` bought the goods for nothing. The client says WHAT is in the cart (handle + variant + qty); the server says what it costs, what it weighs, and where it ships from.
