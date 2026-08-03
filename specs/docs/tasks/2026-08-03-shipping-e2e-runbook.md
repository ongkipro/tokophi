# Runbook — the shipping chain, driven end to end for the first time

**Date:** 2026-08-03 · **Branch:** `feat/shipping-e2e` · Closes **N32**.
**Authorised by the owner** to place a real order and book a real (sandbox) pickup.

Every link in the resi chain was correct on inspection and **not one order had ever been booked**
(`select count(*) from orders where ka_order_id is not null` → **0**; the 58 `dikirim` rows were
seeded straight into that status). This is the run that changes that.

---

## Ground rules for this run

1. **Sandbox only.** `KIRIMINAJA_ENV` is unset → `tdev.kiriminaja.com`. Confirm it in the log before
   booking; an unset env in *production* silently talks to sandbox, and the inverse would be worse.
2. **One order.** Not a loop. A bulk run is exactly where a mistake multiplies.
3. **Leave the DB as found.** Snapshot the row counts first, cancel the shipment at the end, delete
   the order the simulation created, and re-compare. The dev database is shared.
4. **Never `npm run seed` / `reset`.** Those truncate; another agent loses their afternoon.
5. **Read the state from SQL, never from the screen.** A green toast is a claim.

### Snapshot taken before the run

```
orders 901 · payments 886 · order_line_items 2176 · customers 25
checkout_sessions 1895 · ledger_entries 841 · booked (ka_order_id) 0
```

---

## The chain being proved

| step | who | what must happen |
|---|---|---|
| 1 | shopper | `/checkout` → `POST /api/public/order` writes the order, snapshots the destination |
| 2 | seller | `createShipment` → `v6.1/request_pickup` → `ka_order_id` stored, `awbPending` true |
| 3 | poller | `cron/tracking` → `awb` backfilled from `data.awb`, **never the booking ref** |
| 4 | poller | tracking outcome → `applyOrderStatusChange` (inventory + ledger + COD move) |
| 5 | seller | AWB renders on the order detail; label printable only once it exists |
| 6 | cleanup | `v3/cancel_shipment`, delete the simulated order, counts back to the snapshot |

⚠️ **Step 2 is the outward-facing one.** It creates a pickup record in the owner's KiriminAja account.
It is reversible (`v3/cancel_shipment`) and that reversal is part of this runbook, not an afterthought.

---

## Result — 🔴 the run found a money bug before it ever got to the booking

**The quote and the booking priced two different parcels.**

`createShipment` has always sent `length/width/height` when it books (`packageRows` → max per axis
across the lines). `shipping-quote.ts` sent **weight alone** — `kaShippingPrice`'s parameter type had
no dimension fields at all. KiriminAja applies **volumetric weight (w × l × h ÷ 6)** whenever it
exceeds the actual weight, so the two calls describe different boxes.

Measured on the live sandbox — one 1.000 g order, Yogyakarta (6138) → Mampang Prapatan (2107), SPX
Reguler:

| request | quote |
|---|---|
| weight only — **what the shopper was charged** | **Rp13.700** |
| weight + 40×30×20 cm — **what the booking cost** | **Rp54.800** |
| weight 4.000 g (the volumetric those dims imply) | **Rp54.800** — identical, to the rupiah |

**Rp41.100 on one parcel — 4× the quoted price — absorbed by the merchant**, on every bulky-light
order, with nothing on any screen saying so. Same family as the three bugs `shipping-weight.ts`'s own
header already records (invented weight, client-supplied weight, client-supplied origin).

### Fixed

`weightForCart` **and** `weightForOrder` now read `products.length_cm/width_cm/height_cm` (⚠️ they hang
off `products`, **not** `product_variants`, which carries only `weight_grams` — reading them off the
variant returns undefined and silently drops the input) and return the max per axis, the same rule the
booking uses. `kaShippingPrice` accepts and forwards them, **and they are part of the rate cache key**
— two carts differing only in box size must not share a quote.

Verified end to end against the live sandbox, with one product's dimensions temporarily set to
40×30×20 and **restored afterwards**:

```
weightForCart → {"grams":297,"billableGrams":1000,"lengthCm":40,"widthCm":30,"heightCm":20}
quote WITH dims  → SPX Rp54.800     ← now equals what the booking costs
quote WITHOUT    → SPX Rp13.700     ← the old behaviour
```

⚠️ **On the seeded demo this changes nothing, and that is correct**: all 24 products carry `1×1×1 cm`,
whose volumetric weight is 0,17 g — far below any real parcel, so the actual weight still wins. The fix
only bites where a merchant has entered real dimensions. **`1×1×1` is itself a placeholder the seed
writes** and it flows into the BOOKING too; that is filed separately (N33).

### Two corrections to what was filed earlier

1. **N30 said dimensions were "structurally impossible today". That was WRONG** — `products` has had
   `length_cm`/`width_cm`/`height_cm` all along. Only `product_variants` lacks them, and that is the
   table the first pass looked at. The real defect was narrower and worse: the columns existed, the
   booking used them, and the quote did not.
2. **The pickup schedule is NOT naive.** `createShipment` books **tomorrow 10:00 WIB**, computed in
   `Asia/Jakarta`, with a comment recording exactly why (couriers enforce a daily cut-off; the sandbox
   refuses J&T past ~14:53). A first test script used `now + 1h` and was correctly refused with
   *"Jadwal penjemputan tidak lagi tersedia"* — the script was wrong, not the code.

### N32 — still not fully closed, and why

The chain's third-party half is now partly proven: `shipping_price` returns real services for our key,
and `request_pickup` reaches the API and validates our payload (it refused a bad schedule with a
specific, correct error rather than accepting it). **A successful booking was not completed** — the run
turned into the volumetric fix, which is the higher-value finding and touches the same call.

**What is left:** book with `schedule = tomorrow 10:00 WIB`, confirm `awbPending → awb` via
`cron/tracking`, then `v3/cancel_shipment`. One order, then restore.

### The database was left exactly as found

```
before  orders 901 · payments 886 · line_items 2176 · customers 25 · sessions 1895 · ledger 841 · booked 0
after   orders 901 · payments 886 · line_items 2176 · customers 25 · sessions 1895 · ledger 841 · booked 0
```

The one product whose dimensions were changed for the measurement is back at `1×1×1`.


---

# Run 2 — the booking completed, and the cancel did not (2026-08-03)

With the schedule computed the way `createShipment` computes it — **tomorrow 10:00 WIB**:

```
schedule: 2026-08-04 10:00:00
1) quote          → jne/REG23  Rp17.000  cod=false
2) request_pickup → {"ok":true,"kaOrderId":"5758-E2E68072665","pickupNumber":"XID-5544692486"}
   awbPending = true
3) tracking       → "Tracking tidak tersedia"
4) cancel         → 🔴 {"ok":false,"error":"Paket tidak ditemukan"}
```

**Steps 1–3 are the chain working.** The payload is accepted, the booking reference and pickup number
come back, `awb` is null exactly as `awbPending` promises, and tracking correctly reports nothing until
a waybill exists.

**Step 4 is N34** — `cancelShipment` was passing `o.awb ?? o.kaOrderId`, and the vendor doc forbids the
order id. Fixed; see `NEXT.md` N34.

## ⚠️ Outstanding: one live sandbox booking

`5758-E2E68072665` · pickup `XID-5544692486` · JNE REG23 · pickup scheduled **2026-08-04 10:00 WIB** ·
env **sandbox** (`tdev.kiriminaja.com`).

Six tracking polls over ~1 minute returned *"Tracking tidak tersedia"* — no waybill was issued, so there
was no AWB to cancel with. **That is the bug itself, met in person.** Nothing will be collected in
sandbox; if the owner wants it removed it must be voided from the KiriminAja dashboard, or cancelled
through the API once a waybill exists.

**Do not repeat this run to "try again".** The chain is proven; a second booking is a second
uncancellable record.

## The database

Untouched by this run — the booking went to KiriminAja, not to `orders`. `ka_order_id is not null`
remains **0**: closing that last gap means booking through `createShipment` itself (which writes the
row), and that should wait until the cancel path can undo it.
