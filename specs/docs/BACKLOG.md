# TokoΦ — Backlog & task board

> **Reconciled against the code and the database 2026-07-14.** Items that shipped are marked and
> collapsed; items that are still open are stated **honestly**, including the ones we would rather not
> look at. Legend: `[ ]` todo · `[~]` partial · `[x]` done.
>
> Companions: [`STATUS.md`](./STATUS.md) (real vs fake) · [`REQUIREMENTS.md`](./REQUIREMENTS.md)
> (verifiable statements) · [`PRD.md`](../PRD.md).

---

## 🚚 Shipping: Proses → auto-book → courier-driven status — DECIDED, PART-BUILT (2026-07-16)

> **Decided with the user 2026-07-16. The DATA foundation is shipped; the flow is not built.**
> Read this before touching the order state machine or the booking UI.

**Where it stands — UPDATED 2026-07-16 after the chain ran end-to-end for the first time.**

✅ **BOOKING WORKS. Proven, not assumed** (sandbox `request_pickup`, real order data):
```
status: true · pickup_number: XID-4775140108 · service SPX / type 1 · awb: null
```
Three things that were only ever *comments in the code* are now measured facts:
- **`composePickupAddress` is accepted by KiriminAja** — `"Jl. Raya Gubeng No. 42, Kel. Gubeng, 60281"` went through. The kelurahan+kodepos work (0051) was build-green but unproven; it is proven now.
- **`awb` comes back `null`** — the waybill does **not** exist until a courier accepts the pickup. This is why the UI must say *"resi menyusul"* and poll; a spinner "until the resi appears" would hang on a **successful** booking. Decision 2 is validated by reality, not taste.
- **`service_type` (0053) immediately paid off** — SPX Standard was selected exactly, no coin flip.

The seller's UI flow works too: **Cek Ongkir → pick → Buat** produced 2 booked orders (`ka_order_id` set). The reason production had 0 AWBs was never a bug — **that flow had simply never been run**. "Proses pesanan" does not book (it only sets status), which is the whole point of decision 1.

⚠️ **CORRECTION, recorded so nobody re-derives the wrong lesson:** a first probe failed with *"Prefix packages.0.order_id tidak sesuai dengan yang anda daftarkan"* and was mis-diagnosed as the root cause of the 0 AWBs. It was not. Production's `KIRIMINAJA_ORDER_PREFIX` was **always correct (`5758`)**; the probe had hardcoded the code's default (`TOKOPHI`) and then diagnosed its own error. The registered prefix is **`5758`** — if `request_pickup` ever 400s on the prefix again, that is the value.

🐛 **A bug that could only surface after the first successful booking** (fixed + migration `0054`): `createShipment` wrote `courier: input.serviceName`, so booking replaced the code (`spx`) with a display name (`"SPX Standard"`). `orders.courier` is a **join key** — to `platform_couriers` (`codAllowed` for the COD policy, and `group` for the 1 day/reguler/ekonomi/cargo filter) and to the per-courier COD return report — so every booked order silently dropped out of all of them, and one row ended up incoherent (courier `"SAP Satria Reg"` carrying JNE's `REG23`). **The lesson worth keeping: this was invisible until a booking succeeded, because a booked order is the one you stop looking at.**

- 14 production orders still claim `status='dikirim'` **with no AWB and no courier**. Demo seed, but the demo lies about shipping.
- ⚠️ **`KIRIMINAJA_ENV=sandbox` in production.** The user's call is to treat sandbox as real while building (the API is identical; going live is one env flip). **The one thing that must not be forgotten at launch:** a sandbox AWB is *not* a real waybill, so a seller would print a fake resi and stick it on a real parcel. Flip `KIRIMINAJA_ENV=production` before any real seller ships.

### ✅ BUILT 2026-07-16 — Pengiriman Massal (`/pesanan/massal`)

**How it works** (three verbs, in the order physics forces — see the honesty note below):
1. **Generate resi** → `bulkGenerateResi` re-quotes each order and books it with the service **the shopper paid for** (`orders.courier` + `service_type`, both now recorded). No rate picker: the order already knows. A service no longer quoted is **rejected**, never silently swapped — re-couriering someone's parcel behind their back is the same lie as re-pricing it.
2. **Ambil resi** → `bulkFetchResi` polls KiriminAja; `trackShipment` persists the waybill when the courier issues it.
3. **Cetak resi** → `POST /api/admin/labels` → `getBulkLabels` renders **one document of 100×150mm thermal labels** (`buildLabelHtml` per order, each with its own `@page`) → one print dialog → `markLabelsPrinted` stamps `label_printed_at`.

**Filters (all live, verified against real data):** service group **1 Hari / Reguler / Ekonomi / Cargo / Next Day** (via `platform_couriers.services[].group` ⋈ `orders.service_type` — impossible before 0053), **jasa kirim**, **status cetak** (sudah/belum, via 0055), **isi** (bijian = 1 item / bundling = >1).

**Nav:** the old **"Perlu Dikirim"** sub-item was **removed** — it was a saved link to `?tab=perlu_dikirim`, the same view the list already has a tab for and the parent row now points at (it is what the badge counts). Three doors onto one room. **Pengiriman Massal** takes its place.

**Deliberate choices, so nobody "fixes" them back:**
- **Sequential, not parallel** — each item is a live call that books a REAL pickup. 50 at once risks rate-limiting mid-run and an unknowable half-state, and a duplicate pickup is not a retry, it is a second parcel.
- **Partial failure is reported per order**, never summarised into "berhasil". 8 booked / 2 failed must read as exactly that — the seller has to know *which* two.
- **Orchestration only** — it calls `createShipment`/`trackShipment`, it does not re-implement them. A second copy of the booking logic is how the seller's list and the courier's parcel end up disagreeing (exactly what `composePickupAddress` did when it existed twice).
- **"Ditandai dicetak", never "berhasil dicetak"** — we render the label; we cannot observe the printer. Same rule as the CRM's "WA dibuka".
- `getBulkShipping` uses **LEFT JOINs**: an order whose courier no longer resolves must still be LISTED. Dropping it silently from the packing queue is how a parcel goes unsent.

### ▶ STILL TO PERFECT — tasks for this workflow

1. **[ ] Tracking poller + `orders.awb` fill.** The booking succeeds with `awb: null`; something must fetch the waybill when the courier issues it. `kaTrack` / `trackShipment` already exist — no new API. This is the **prerequisite for everything else**: no AWB → no label → no bulk print.
2. **[ ] Status follows the courier (decision 3).** `createShipment` still hardcodes `status: "dikirim"` on booking — the timeline claims "in transit" while the parcel is on the seller's shelf. Should be `diproses` on booking, `dikirim` when the courier accepts (the same moment the AWB appears). ⚠️ Touches the order state machine and the existing manual path.
3. **[ ] Auto-book on "Proses pesanan" (decisions 1 + 5).** One button: confirm → book the service the shopper paid for (`courier`+`service_type`, both now recorded) → honest result (resi, or "dibooking, resi menyusul"). Old orders backfilled by 0053 can auto-book too.
4. **[ ] `orders.label_printed_at` + printed/not-printed filter.** Does not exist. Needed for the marketplace-style status and for Pengiriman Massal's filter. Cancelling must stay possible after printing.
5. **[ ] Courier change by the seller** — except COD (SPX-locked). Seller pays the difference; do **not** rewrite the buyer's `shipping_idr`.
6. **[~] Pengiriman Massal — BUILT, not yet exercised.** The page, filters, bulk book/fetch/print and the thermal document all work and render (verified at 1400px, 0 page errors, filters showing real counts). **But not one label has been printed yet**, because production has **0 AWBs** — so `Cetak resi` has had nothing to print. Until (1) lands and a waybill actually arrives, this is proven to *compile and render*, not proven to *ship a parcel*. Do not call it done.
7. **[ ] Exercise the bulk path end-to-end**: select 2 orders → Generate resi → Ambil resi until a waybill lands → Cetak → confirm the thermal document is 100×150mm per label and `label_printed_at` stamps. This is the only thing that turns (6) from "renders" into "works".
8. **[ ] Print-run honesty**: `getBulkLabels` returns `skipped[]` (orders with no printable AWB) and the API passes it through, but the UI currently ignores it. An order silently missing from a print run is a parcel that silently does not ship — surface it.

**Decisions (user, 2026-07-16):**
1. **"Proses pesanan" auto-books.** One button: confirm → book the service the **shopper already paid for** → show the resi. No asking the seller which service — the order knows.
2. **The resi is NOT synchronous, and the UI must not pretend it is.** KiriminAja returns `awb: null` until a courier *accepts the pickup* (already documented at `order-detail.tsx:220`, and the existing manual flow already says so honestly). A spinner "until the resi appears" would hang on something we do not control. Correct: book → *"Dibooking. Resi menyusul setelah kurir menerima."* → poll (`trackShipment` exists) → resi lands → `Cetak resi` enables.
3. **Status follows the COURIER, not the seller's clicks** — the user's framing, and it is the better one. Booking → `diproses` (booked, awaiting pickup); the parcel becomes `dikirim` when the courier actually accepts — *which is the same moment the AWB appears*. Then the timeline/history is built from **KiriminAja tracking events**, not hand-set states. ⚠️ This **changes the order state machine**: `createShipment` currently jumps straight to `dikirim` on booking, which makes the timeline claim "in transit" while the parcel is still on the seller's shelf. That change touches the existing manual booking path too — it is why "Diproses" currently means nothing.
4. **The seller may change the courier** in the order detail — **except COD, which is locked to SPX** (`lib/cod.ts`: SPX is the only courier with `codAllowed`; production already agrees, all 4 COD orders are spx). **A unilateral courier change is the SELLER's cost:** the buyer paid `orders.shipping_idr` for the service they picked; if the seller moves to a pricier courier the difference is the seller's, and the buyer's number must not be rewritten.
5. **Proses *is* "cetak resi"** — one action, not two. The marketplace shape the user wants: **print status per order (`sudah dicetak` / `belum dicetak`) + a filter on it**, exactly like Shopee/Tokopedia. **Cancelling stays possible from the order detail even AFTER the label is printed** — a printed label is paper, not a commitment; `cancelShipment` already exists.
   ⚠️ **`orders.label_printed_at` does not exist** — there is no print state anywhere in the schema today (grep found only comments about printing). It needs a column before the status or its filter can be anything but invented. It is also the honest anchor for **Pengiriman Massal**'s "sudah/belum dicetak" filter.
   ⚠️ Note the ordering trap: printing requires a **real AWB** (`buildLabelHtml` refuses without one — deliberately), and the AWB is not synchronous (decision 2). So "Proses = cetak resi" cannot literally print on click for every order: it books, and the label becomes printable when the courier issues the waybill. The UI must say that rather than show a print button that silently does nothing.

**Shipped foundation (migration `0053`):** `orders.service_type` — `courier` alone was ambiguous (SPX Standard type `1` = `regular` vs SPX Economy type `3` = `economy`: different products, different prices), so auto-booking would have been a coin flip on the buyer's money. Checkout now records `rate.type` beside `rate.code`. This is also the join key to `platform_couriers.services[].group`, i.e. **the `1 day / reguler / ekonomi / cargo` filter the user wants for Pengiriman Massal is now buildable** — it was not before.

**Still to build:** the auto-book button (2 + 3), the tracking poller + history, the courier-change control (4), and only then **Pengiriman Massal / bulk label print** — which has nothing to print until a booking succeeds. See also the `Pengiriman Massal` + returns-IA notes: those menus were deliberately left out of `lib/nav.ts` because *"a nav row that opens onto nothing is worse than a nav row that isn't there"*, and that still holds.

---

## 📱 UI/UX mobile & admin — DECIDED IN PRINCIPLE, PARKED (2026-07-16)

> **Status: agreed, not started. Do not build without re-confirming — the last open decision is below.**
> Discussed with the user 2026-07-16. Shipped groundwork is listed at the end; this section is the
> plan for the part that is NOT built.

**The framing that settled it.** "Responsive vs a separate mobile app" is a false choice — UI has three
layers, and the real question is *which layer may differ*:

| Layer | May it differ on mobile? |
|---|---|
| **Navigation / shell** (how you move, what a thumb can reach) | **YES — this is the only layer that should fork** |
| **Screen layout** (table vs cards) | Responsive only — **already done**, see below |
| **Content & logic** (data, rules, actions) | **NEVER** — this is where drift is born |

**A separate mobile UI is rejected**, and this session produced the proof rather than the theory:
`composePickupAddress` existed in two copies and the seller was shown one pickup address while the
courier was handed another — *silently*. That was **one function**. Sixteen modules × two UIs is that
failure mode, industrialised. Also rejected: gestures/swipe (fragile, undiscoverable, expensive) and a
PWA/native shell — the latter only earns its cost if we want **push notifications for new orders**,
which is a genuine argument, but a separate project.

**Why the nav layer alone deserves the fork.** Navigation today is a hamburger at the **top-left** — the
hardest point on a 6.5" screen for a thumb. Every move costs a stretch → a drawer → a scan of 16 items.
Harmless on a desktop; a tax on every step on a phone.

**The seller's actual mobile jobs** (confirmed by the user — *not* my assumption, and the whole design
rests on it): **cek pesanan masuk · proses kirim · cek saldo · balas chat**. Explicitly **not** global
setup — that stays desktop work. A menu to reach everything else must still exist. Note the first two
are the *same screen* (Pesanan), so four jobs = three destinations.

**Proposed shell (below `md` only; desktop untouched):**

| Tab | Why it earns the most expensive space on the screen |
|---|---|
| **Beranda** | Antrian Kerja = "what do I have to do" — the real answer to "cek pesanan masuk" |
| **Pesanan** | where processing + shipping happen. **Badge = new-order count** |
| **Saldo** | money |
| **Obrolan** | **Badge = unread** |
| **Lainnya** | the other 16 menus — opens the **existing** `NavLinks` drawer the hamburger uses today |

**The badges are the point, not the bar.** The #1 job is *"cek"*. If checking requires **opening** a
screen, the design failed. Badges answer it without opening anything. Beranda and Pesanan only look
redundant: **Beranda = check, Pesanan = do.**

Cheap and reversible on purpose: "Lainnya" re-opens the drawer that already exists, so this is a
**relocation, not a rebuild** — zero new screens, zero new logic. The hamburger simply retires below `md`.

**Two traps to handle up front (verify with a screenshot, never assume):**
1. **The bar covers content** — a "Simpan" button or the last table row buried under it. Content needs
   bottom padding equal to the bar height.
2. **iPhone safe area** — without `env(safe-area-inset-bottom)` the bar collides with the home
   indicator. This is exactly what makes a web app feel *not* like an app.

**⚠️ OPEN DECISION — answer before building:** does **Beranda** stay a tab, or does a phone land
straight on **Pesanan** after login (freeing the slot for e.g. Produk)? Not decided.

**⚠️ OPEN SYSTEM QUESTION (raised, not decided):** the Pesanan mobile card intentionally **drops the
`…` dropdown** (Lihat detail / Batalkan) — the whole card is a tap target to the detail page, where the
full actions live. Consequence: **on a phone a seller cannot cancel an order from the list**; desktop
still can. That is a product decision, not CSS. Options: (a) leave it — cancel is destructive and the
detour reduces mis-taps on a small screen (my preference); (b) restore the dropdown for full parity.

**Already shipped (the responsive layer — reusable, adopt as you go):**
- `components/admin/tab-strip.tsx` — `TabStrip`, used by the 4 counted strips (Pesanan/Saldo/Blog/Diskon).
- `components/admin/responsive-table.tsx` — `ResponsiveTable` + `DataCard` + `DataRow`. Real `<Table>`
  from `md` up, cards below. Adopted by **Pesanan** + **Produk** (deliberately different shapes — Produk
  forced the `lead` checkbox slot and an unstyled `title`, which is how you learn a component is reusable
  rather than merely fitted to its first screen). It does **not** auto-convert a table: a good card has a
  hierarchy a table lacks, and only the screen knows which column leads.
- `scripts/audit-responsive.mjs` — `npm run audit:responsive -w @tokophi/admin`. 21 routes × 11 real
  device widths, fails on horizontal overflow. Currently **264/264 clean**; keep it that way.
- ⚠️ **What the audit cannot see:** it proved "nothing scrolls sideways" while Pesanan's tabs were
  rendering *on top of* the toolbar and Produk's price column was off-screen. **Passing it is not the
  same as being usable — look at the screens.**

**Not yet adopted:** the tables on Inventori / Pembelian / Pelanggan / CRM / Ulasan etc. Mechanical work;
the component is proven on two different shapes.

---

## 🧾 Deferred from the 2026-07-16 checkout/storefront polish

Parked deliberately while the checkout page was finished. Each is real, each was measured, and none is
a guess — the evidence is in `CHANGELOG.md` under the same date.

- **[x] `byCollection` reads `collection_products`** (2026-07-16). It inferred membership by
  slugifying a product's category TEXT and hoping it matched the handle; the table the Kategori editor
  writes was never read. Worst case found: **"Promo Gajian" is a MANUAL collection** — the merchant
  hand-picked 8 products and the shop rendered `filter(p => p.compareAt || p.bestseller)` instead, a
  guess overriding their curation on a page advertising a promo. Now 7 render (the 8 minus a draft),
  matching the DB exactly. `promo-gajian`/`produk-terlaris` left `VIRTUAL_COLLECTION_HANDLES` — they
  are real rows and only looked virtual because membership was invisible; `semua` alone remains.
- **[x] Draft products were on the shop** (2026-07-16, found while fixing the above). The catalog
  filtered `!= 'archived'`, and the enum is active|draft|archived — so 2 of the demo's 14 products were
  browsable, openable and cart-able while `/api/public/order` (correctly `= 'active'`) would reject
  them at the end. The shopper filled in name, address, kecamatan and payment to be told the product
  does not exist. `semua` 14 → 12.
- **[ ] `rate.cod` enforcement is committed but NOT exercised end-to-end.** `/api/public/order` now
  rejects a COD order whose live per-destination rate came back `cod:false`. Reviewed and typechecked
  only: proving it needs a KiriminAja quote for a district in an allow-listed province where SPX
  returns `cod:false`, and I did not find one. Until then the guard is untested code on the money path.
- **[ ] The stock decrement targets EVERY `inventory_levels` row for a variant, with no location
  filter** — while the check sums across them. Every variant has exactly 1 row today (96/96 verified),
  so it is correct now; the unique key is `(variant_id, location_id)`, so multi-location is a supported
  shape, and the day a variant has two rows this subtracts the full qty from each. The real question is
  *which location ships*, which is a design decision, not a patch.
- **[x] Kecamatan search is ranked** (2026-07-16). It had **no `order by` at all** — 7.030 districts,
  `limit 8`, whatever Postgres returned: "Semarang" put *Suti Semarang, Kabupaten Bengkayang,
  Kalimantan Barat* first. ⚠️ The obvious fix (exact district first) is ALSO wrong, and only measuring
  showed it: "Bandung" then ranks *Bandung, Kabupaten Tulungagung* — a village — above every district
  of Kota Bandung, because the village is literally named "Bandung" while Kota Bandung's districts are
  "Bandung Kidul", "Bandung Kulon"… Nobody typing "Bandung" means the village. So an exact **city**
  match outranks an exact district match, and `Kota` outranks `Kabupaten` (723 vs 6.307 — the kota are
  where the parcels are). Verified: Semarang/Bandung/Malang/Denpasar all return their own city's
  districts. LIKE wildcards are escaped too — a lone `%` matched all 7.030 rows.
- **[ ] The Store Builder does not validate section links against live targets.** The demo's
  `CategoryNav` linked `/kategori/outerwear` after that collection turned out to be `published=false`
  (fixed in the seed, but only because I knew). `getFooterNav`/`getMainNav` already drop dead links at
  render; the builder should refuse to save them, or warn.

---

## 🔴 The five that matter most

Not the biggest, not the newest — the ones where the product is currently **lying, leaking, or
unmeasurable**. Ordered.

1. **[x] `orders.courier` is recorded at checkout** (2026-07-16). `/api/public/order` now writes
   `courier: rate.code` on the order — the courier of the fresh server-side quote it matched (never the
   client's raw claim; a picked service not in the quote already rejects the order). So the per-courier
   COD return-rate report — the instrument the entire COD policy bets on — is now a `group by courier`
   instead of an impossibility. (Existing rows stay NULL; new checkouts populate it. Full shipment
   booking at checkout is still deferred — `awb`/`kaOrderId` are set when the seller books the pickup.)
2. **[ ] Verify the "SPX free return" claim with KiriminAja, in writing.** The whole SPX-only COD
   policy rests on it and **it is unverified**: free returns are a *Shopee Seller Center* benefit, we
   reach SPX through *KiriminAja* (a different contract), and the KiriminAja API has **no return field
   at all** (`KaRate` = service, service_name, service_type, cost, etd, cod, group). If returns are in
   fact billed through KiriminAja, the rationale collapses and we have restricted COD to one courier
   for nothing. **This is one email — the draft is ready below, just send it.**

   <details><summary>📧 Ready-to-send email to KiriminAja (2026-07-16)</summary>

   > **Kepada:** support / account manager KiriminAja
   > **Subjek:** Konfirmasi kebijakan retur COD untuk layanan SPX
   >
   > Halo tim KiriminAja,
   >
   > Kami mengintegrasikan COD (Cash on Delivery) via API KiriminAja dan ingin mengonfirmasi satu hal
   > soal **paket COD yang ditolak / gagal diantar**:
   >
   > 1. Untuk layanan **SPX (SPX Standard `type=1` dan SPX Economy `type=3`)** — jika penerima menolak
   >    paket COD, apakah **ongkos retur (pengembalian paket ke penjual) GRATIS** bagi penjual, atau
   >    **dibebankan** ke penjual?
   > 2. Apakah kebijakan retur ini **sama** untuk kurir lain yang tersedia di KiriminAja (JNE, J&T,
   >    SiCepat, dll), atau **berbeda per kurir**?
   > 3. Apakah biaya retur (jika ada) muncul di response API `KaRate`, atau ditagih terpisah di dashboard?
   >
   > Kami perlu kepastian tertulis karena ini menentukan kurir mana yang kami izinkan untuk COD.
   >
   > Terima kasih.

   **On the answer:** "retur gratis di SPX, dibebankan di kurir lain" → the SPX-only policy stands as-is.
   "retur dibebankan di SPX juga" → the rationale collapses; open COD to all couriers behind a buyer-paid
   fee pool (`platform_cod.fee_pct`, currently 0 and read by nothing — see the COD-fee item under P1).
   Record the reply verbatim in this file when it arrives.
   </details>
3. **[x] `invitePlatformAdmin` escalation — CLOSED** (verified in code 2026-07-15). Now
   `requirePlatformAdmin("owner")` (was `admin`-gated), `role` is whitelisted against
   `["support","admin","owner"]` (was `input.role || "admin"`, which accepted anything), and it
   audit-logs via `logPlatform`. An `admin` can no longer mint an `owner`. ⚠️ Residual (minor, tracked):
   it still seeds a fixed `DEV_PASSWORD` (`tokophi123`) for the new operator — acceptable only because
   there is no mailer to send an invite; replace with a random token when the mailer lands.
4. **[x] `lib/actions/billing.ts` is gated — CLOSED** (verified in code 2026-07-15). Both
   `createSubscriptionPayment` and `cancelSubscriptionInvoice` now call
   `requireCapability("settings:write", { allowSuspended: true })` as their first statement (was
   `getSession()` alone). `allowSuspended` is deliberate: a suspended store must still be able to pay its
   way back in — refusing that payment would lock a paying merchant out permanently.
5. **[x] Tests for the money/checkout paths — DONE** (2026-07-15). **63 tests, all green** (was 1 file).
   - **Pure-logic** (`packages/lib`): `validate.test.ts` (checkout input boundary — phone normalisation
     incl. the no-operator-prefix rule, name/email/address/kodepos/dest_id) + `billing.test.ts` (PPN
     round-trip, promo + annual-bonus quote, the trial→active→past_due→suspended lifecycle).
   - **COD gate** (`apps/admin/lib/cod-policy.test.ts`): the five-condition decision logic was extracted
     from `lib/cod.ts` (DB loader) into a pure `lib/cod-policy.ts` (`buildCodPolicy`, same split as
     `rbac-policy.ts` vs `rbac.ts`) and exercised with fixtures.
   - **Ledger + order state machine** (`apps/admin/lib/ledger-credit.test.ts`): run against a REAL
     throwaway Postgres, each test inside a transaction that is ALWAYS rolled back (full isolation, zero
     pollution — gated on `TEST_DATABASE_URL`; the suite SKIPS without it so plain `vitest run` stays
     green; it is NEVER the shared dev DB — see CLAUDE.md). Covers: a sale is booked only for a collected
     (`berhasil`) payment, at `amount_idr` not `total`, `pending` vs `available` by order status; **the
     "double-credit is a DB impossibility" claim is PROVEN** — a second raw sale insert is rejected by
     `ledger_one_sale_per_payment`; COD collected at the door; release honours `platform_payout.release_on`;
     the `retur` claw-back is an opposing entry that nets to zero, carries the sale's status (a pending
     sale reversed out of pending → available can never go negative), and is idempotent
     (`ledger_one_retur_per_order`). The state machine (`applyOrderStatusChange`, extracted from
     `setOrderStatus` so it is callable — same seam as `settleOrderLedger`) restores stock on **batal AND
     retur**, cannot double-restore (guarded on previous status), and fails a still-pending payment.
   - Setup: `docker exec <db> psql -U tokophi -d postgres -c 'CREATE DATABASE tokophi_test'` →
     `DATABASE_URL=…/tokophi_test npx drizzle-kit migrate` (in `packages/db`) →
     `TEST_DATABASE_URL=…/tokophi_test npx vitest run`. All behaviour-identical refactors; `tsc` clean.

---

## P0 — Foundation

- [x] **Backend** — local PostgreSQL 16 + Drizzle (`@tokophi/db`): **70 tables, 51 migrations
  (`0000`–`0050`), RLS on 45**. All four surfaces read; all admin editors write; local auth (jose JWT) +
  RBAC + **RLS enforcing at runtime** under the non-owner `tokophi_app` role.
- [x] **Data-layer seam on every screen** — reads via `lib/data/*`, writes via `lib/actions/*`.
- [x] **Auth + real multi-tenancy** — the tenancy boundary is the database, not application code.
- [ ] **VPS: self-hosted Postgres + PostgREST + Storage (MinIO/S3).** Media is still local disk
  (`public/uploads/`). ADR 0007 / 0008.

---

## P1 — Money, shipping, COD

### Shipped

- [x] **The ledger** (migrations `0040` + `0041`). `0040` built the book and **nothing ever wrote a
  `sale` into it** — the withdraw path worked, the release and claw-back paths worked, on entries that
  were never created; every merchant's balance read Rp0 no matter how much came in. `0041` credits it.
  Balance derived, book append-only, three partial unique indexes make double-credit a DB impossibility.
- [x] **Payouts + super-admin `/pencairan`** — request (owner-only, advisory-locked, bank snapshot),
  process, mark paid (**no ledger write** — already debited), reject (**opposing `adjustment`** computed
  from the ledger, not from `payouts.amount_idr`).
- [x] **The release rule is actually read** (`0776e99`) — `platform_payout.release_on`, default
  `selesai`. It was hardcoded while the super-admin toggle changed nothing. A knob that moves nothing is
  worse than no knob.
- [x] **`retur` order status** (`0039`) — restores inventory (exactly like `batal`; missing it would have
  quietly shrunk real stock on every refused COD parcel), fails the pending payment, claws the credit
  back with an opposing entry carrying the sale's status.
- [x] **COD enforced end-to-end** (`0038`) — five conditions, server-side in `/api/public/order`
  **before any row is written**. `max_amount_idr` and `allowed_provinces` were stored and read
  **nowhere**; they bounded nothing. Now they bound.
- [x] **COD is switched ON** (`35b88a4`) — the feature was built and never turned on. All three switches
  now agree: `platform_cod.enabled` (cap **Rp2.000.000**, **6** allow-listed provinces) ∧
  `platform_couriers.services[].codAllowed` = **SPX only** (SPX Standard `type=1` + SPX Economy
  `type=3`; every other courier is `codAllowed=false` *even where KiriminAja reports `cod=true`*) ∧
  `store_settings.cod_enabled = true` for batik-nusantara (default **false** — the merchant opts in, via
  Pengaturan → Pengiriman → "Bayar di Tempat (COD)"). **Verified in a real browser**, 0 console errors:
  the COD badge appears on the two SPX rates only, and "COD (Bayar di Tempat)" appears in Pembayaran
  only while an SPX service is selected.
- [x] **The checkout offers exactly the services the seller picked** (`35b88a4`) — `/api/public/ongkir`
  filtered on `store_settings.couriers` (the COURIER list) while the Jasa Kirim card promises *"Pilih
  layanan yang ditawarkan ke pembeli saat checkout"* and writes to **`store_shipping_methods`** (per
  service), so **every service the seller switched OFF was still offered**: **14 rates, 4 never
  enabled** (Jagopack, Sicepat CARGO, BIGPACK, SAP One Day) → **10** after the fix. Now
  **(platform-enabled couriers) ∩ (per-service picks)**, keyed `"<courier>:<service_type>"`; no rows =
  fall back to courier-level rather than a checkout with zero shipping options.
- [x] **The COD province is verified, not typed** (`f846cba`) — resolved from the KiriminAja district id
  the ongkir quote was issued for. Fail-closed if unresolvable.
- [x] **Live KiriminAja courier roster** — the hand-written roster had drifted badly (it listed TIKI and
  Pos Indonesia, which the API returns *neither* of, and gave SPX service names that do not exist).
- [x] **Shipment booking** (`request_pickup` → AWB) — and **`orders.awb` no longer stores our own order
  id** (`0b3cdda`), which had been printing an unscannable barcode on real parcels under "No. resi".
- [x] **Order address snapshot** (`0042`) — an order carries the address it was *shipped to*.
- [x] **Pesanan rebuilt as a seller centre** (`4b4775c`) — Shopee-style tabs, server-side
  search/filter/paging. The five status tabs are a **strict partition** (`0+24+23+595+43 = 685`).
- [x] **Money endpoints fail CLOSED** — pay callback and the billing cron both 401 in production when
  their secret is unset.

### Open

- [ ] **🔴 `orders.courier` NULL on 699/700** — see the top-five list.
- [ ] **🔴 Verify the SPX free-return claim** — see the top-five list.
- [ ] **COD fee (`platform_cod.fee_pct`)** — currently `0` and **read by nothing** (2 grep hits: the
  schema and the seed). This is the lever that would let COD open on **all** couriers instead of one: a
  2–3% fee charged to the buyer (normal and accepted in Indonesia; every marketplace does it) funds a
  return pool so the merchant does not eat the return leg alone. **Strictly better than
  courier-restriction if the SPX claim turns out to be false.**
- [ ] **No super-admin UI for `max_amount_idr` / `allowed_provinces` / `fee_pct`.** They are *enforced*
  (from the seed) but not editable from the panel — while the `/pengaturan` copy says "limit & area
  diatur di sini". Either build the form or fix the copy.
- [x] **The seed writes legacy string services** into `platform_couriers.services` — **fixed.** It now
  writes objects (`{type,name,group,cod,codAllowed}`), `codAllowed = cod && courier === "spx"`, so a
  fresh DB has 2 COD-allowed services and COD is exercisable without pressing "Sync dari KiriminAja".
  Extended in `540af0a`: the seed also writes `store_settings.cod_enabled = true` for Batik Nusantara
  and **11 `store_shipping_methods` rows**. Both were missing, and both mattered — a re-seed used to
  switch COD off (the column defaults to FALSE) and leave the per-service table empty, which
  `/api/public/ongkir` reads as "the seller never opened the card" and answers with the courier-level
  fallback, re-offering services the seller never picked. Verified on a forced re-seed.
- [ ] **The seed has no `retur` orders, no `cod` payments, and no `payouts`.** The three most expensive
  code paths in the product have **no demo data** and cannot be exercised by clicking around.
- [ ] **`KIRIMINAJA_ENV` defaults to `sandbox`** — an unset env in production silently books nothing.
  Make production refuse to start instead. **This is now the last thing standing between the shop and
  real tariffs:** ongkir is a genuine KiriminAja call, genuinely priced from the seller's pickup
  address, and the storefront renders exactly what the server returns (verified 8/8) — but it all
  talks to `tdev.kiriminaja.com`. Everything downstream of the price is real; the price is not.
- [ ] **Pickup address is unvalidated against the courier.** `sender_kecamatan_id` is trusted as a
  KiriminAja district id because the picker writes it — but nothing re-checks it, and a merchant with
  a stale or hand-edited id would price every order from the wrong city with no error. Cheap fix:
  verify the id resolves in `kiriminaja_areas` on save.
- [ ] Cetak label PDF (still a toast stub) · tracking webhook · parcel weight is hardcoded `qty × 500 g`.

---

## P1 — Security & integrity

- [x] **RLS on `support_*`** (`0035`), **on `payments` + `media`** (`0036`, proven on production data).
- [x] **Platform operator roles enforced** (`0776e99`) — `support` < `admin` < `owner`.
- [x] **Impersonation is `owner`-only and audited** (`571ed17`).
- [x] **Every fabricated number removed from the super-admin** (`571ed17`) — `store_stats` (a rollup that
  disagreed with the `orders` it summarised by up to **140×**), a `mulberry32` MRR chart, five of six
  delta chips hardcoded to `0`, a hardcoded `churnRate: 0`, two **disagreeing** MRR figures on one page,
  and `ship7d_avg` — a metric with **no source at all** that drove a banner recommending the operator
  **give away a Rp275rb/mo subscription**.
- [x] **Every fabricated number removed from the order detail** (`2a5ffc4`) — line items, ongkir, a
  back-solved "Penyesuaian" line, courier, resi, payment method, street address, and the barcode bars on
  the printed label.
- [x] **Pemasaran stops inventing ad performance** (`62df4a1`) — there is no Meta/Google/TikTok
  integration; the cards now say "Belum terhubung".
- [x] **The CRM stops chasing carts that never existed** (`9206220`) — "keranjang ditinggal" follow-ups
  (chase *Dress Midi Motif Bunga*, chase *Gamis Syari Polos*) were being shown for baskets that
  **existed nowhere in the database**. It was sending merchants after ghosts. The seed now derives its 3
  cart follow-ups from **real `checkout_sessions` rows**; orphan cart follow-ups: **0**. Also killed: the
  Pelanggan stat card's **"Total Pelanggan 3.128 · +8,2% bulan ini"** — the store has **24** customers,
  and nothing anywhere computed a month-over-month change.

- [x] **`invitePlatformAdmin` escalation — CLOSED** (2026-07-15) — see the top-five list.
- [x] **`billing.ts` capability gate — CLOSED** (2026-07-15) — see the top-five list.
- [x] **Super-admin audit gaps — CLOSED** (2026-07-15). All the previously-silent privileged mutations
  now write to `platform_activity`: `setInvoiceStatus` (**money** — a manual "dibayar" is `logStore`d),
  `setStoreUserRole` (privilege change — logs the user + new role), `saveGateways` + `saveCodAllowed`
  (**platform payment / COD risk policy** — `logPlatform`d with the diff), and `createStore`. Joins
  `invitePlatformAdmin` (logged 2026-07-15) and the add/remove/reset user actions that already logged.
  `tsc` clean. An unlogged privileged mutation is indistinguishable from an attack; there are none left
  among the store-lifecycle / billing / settings actions.
- [ ] **The `support` platform role is unreachable** — **zero** actions accept it, including the ticket
  actions its own doc comment says it exists for. Either wire it or delete it.
- [ ] **Platform role checks are action-only** — the middleware and page guards check for *a* session,
  not a role, so a lower-privileged operator sees every screen and the buttons throw on click.
- [ ] **`/api/public/*` runs on the owner connection, outside RLS** — **the single largest RLS hole, on
  the most security-sensitive path in the system.** Tenant correctness at checkout rests on application
  code passing an explicit `store_id`. Options: a `store_id`-scoped read role for the public path, or an
  explicit, documented acceptance. Not a silent one.
- [x] **`POST /api/public/pay` deleted** (2026-07-16) — it was an unauthenticated route that took the
  `amount` FROM THE BODY and created a real VA/QRIS bill via AutoLaris, called by **nothing** (no
  storefront source read `PUBLIC_PAY_API`; the real flow creates the payment server-side inside
  `/api/public/order` with the server-computed amount). Removed the route file and the dangling
  `PUBLIC_PAY_API` from `.env.example`. **`/api/public/pay/callback` (the live AutoLaris callback) is
  untouched** — different route, still needed.
- [ ] **All rate limits are in-process** — they do not survive a restart and do not hold across replicas.
  `/api/track` in particular has no proof-of-work, signature or session check: a distributed script with
  a browser UA can inflate a store's funnel. Move to the Cloudflare edge.
- [x] **`AUTH_SECRET` insecure fallback is now impossible in production** (2026-07-16). A shared
  `@tokophi/lib/secret` (`authSecret()` / `authSecretBytes()`, zero-dep so it is edge-safe) resolves the
  key and **fails CLOSED**: in production a missing/short `AUTH_SECRET` **throws**; only in development
  does it return the well-known dev string. Wired into all 8 sites across the three apps (admin +
  super-admin middleware/auth/session/impersonate, storefront chat + recovery). The throw is **lazy** —
  it fires when the key is first used at runtime, never at module load — so `next build`/`astro build`
  (which run with `NODE_ENV=production` but WITHOUT the runtime `AUTH_SECRET`) still build (proven: an
  import-only load does not throw). Prod already sets a 64-char `AUTH_SECRET`, so runtime behaviour is
  unchanged; this only removes the silent forgeable-key path.
- [x] **Login rate limit on both panels** (2026-07-16) — `signIn` in `apps/admin/lib/actions/auth.ts`
  (15/min per IP) and `apps/super-admin/lib/actions/auth.ts` (10/min — the control plane, kept tighter)
  cap attempts by client IP (`cf-connecting-ip` → `x-forwarded-for`) via `@tokophi/lib/cache` `rateLimit`,
  BEFORE the scrypt password check. ⚠️ In-process — does not survive a restart or span replicas (the same
  known limitation as every rate limit here; Cloudflare-edge move still tracked below) — but far better
  than the previous NONE, and generous enough not to lock out a NAT'd office.
- [ ] **`platform_activity` has a `store_id` and no RLS.** Deliberate (it is our log *about* tenants), but
  it deserves a written decision + a comment, not a silent whitelist entry.

---

## P1 — Honesty debt

- [x] **The storefront `/blog` reads the DB** (2026-07-14). `src/data/content.ts` (`getArticles`/`getArticle`,
  per-tenant, short-TTL) + Medium-shaped `/blog/[handle]` + `/halaman/[handle]`. Every query hard-filters
  `status='terbit'` so a draft **404s** (proven). The hardcoded 4-article array is deleted; the merchant's
  Blog/Halaman editors now reach a shopper. (6 articles + 6 pages were `terbit` and unreachable before.)
- [x] **Per-store WhatsApp + tagline** (2026-07-15). Migration `0049` added `stores.whatsapp`/`tagline`
  (nullable). `DEFAULT_WHATSAPP = "6281234567890"` is **removed** — a store with no number renders **no**
  WhatsApp button (honest) rather than a shared dummy. The merchant sets both in admin → Pengaturan → Profil
  (`StoreProfileCard` + `saveStoreProfile`, normalises `08…`/`+62…` → `62…`). Merged + deployed + validated
  full-circle in a browser. **Email is still shared** — no per-store email column, and no mailer to use it,
  so it is not a live gap; deferred with the mailer.
- [ ] **`SECTION_DEFAULTS` ships fake testimonials** and a "Gratis Ongkir" marquee onto live storefronts.
  `page_templates` has 0 rows, so **every** store falls back to them. A real merchant's shop currently
  displays invented customer quotes.
- [ ] **`apps/admin/lib/mock/store.ts` still exists**, with six `mulberry32` generators, imported by ~10
  client components (almost entirely for its **types**, plus `TODAY` / `PRODUCTS` / `BLOG_CATEGORIES`).
  Extract the types, delete the generators. It is one careless import from putting invented data back on
  a screen.
- [ ] **`astro.config.mjs` hardcodes `site: "https://batiknusantara.id"`** — one demo brand baked into a
  multi-tenant app.
- [ ] **`/akun` on the storefront is a dead demo form.**
- [x] **Stale source comments fixed** (2026-07-16) — `lib/data/analytics.ts`, `lib/data/funnel.ts` and
  `schema.ts` all claimed `analytics_events` had no writer and the tracker was "still to come". It has
  been written by `apps/storefront/src/pages/api/track.ts` since `b7ae0ff` (47k+ rows locally); the
  comments now say so. Comment-only, no runtime change.

---

## P1 — Feature completeness

- [x] Self-serve signup (`/daftar` → one-transaction `provision.ts`).
- [x] Store Builder / "Tema" (ADR 0009) — homepage + category + product templates, brand colour,
  8 sections, SSR multi-tenant storefront, checkout branding. Hero carousel folded back into the
  **shared** Puck config (`5016bb3`) after shipping first as a fork the storefront could not render.
- [x] Real variants · CSV export · ⌘K search · RBAC UI rollout · content edit routes · order detail.
- [x] Landing page on the apex + SEO hygiene + `www` → apex 301.
- [x] **Abandoned-checkout capture** (migrations `0044` + `0045`, `d7fc92f`) — `checkout_sessions`, written
  by the storefront **as the shopper types** (debounced beacons), because **there is no "abandon" event to
  listen for: abandonment is the ABSENCE of an order**. A sweep flips `aktif` → `ditinggal` after 60 min
  of silence and stamps `abandoned_at`. `0045` exists because a straight-through checkout **also** ends
  `pulih`: without it the naive `pulih/(pulih+ditinggal)` renders a **19,3%** "recovery rate" and tells a
  shop it rescued every ordinary sale. Real rates (30-day window, `aktif` excluded from both sides):
  **abandon 80,0%**, **recovery 11,2%** (ditinggal 792 · orders 198 · rescued 100). Recovery links are
  **signed, store-bound, 7-day HS256 tokens**, never the raw session id.
- [x] **`/pelanggan/keranjang`** (`9206220`) — **792 abandoned carts that until this week were not recorded
  at all.** Ranked by what a merchant can act on: has-phone first, then basket value **decayed by age**
  (`subtotal / (1 + minutesAgo/1440)`). Tabs count with **true SQL totals**, not the loaded slice.
  WhatsApp recovery records **"WA dibuka", not "terkirim"** — wa.me cannot tell us whether the message was
  sent or read, and we do not display what we cannot observe.
- [x] **Guest vs registered customers** (`0044`) — `customers.registered_at IS NULL` = guest (7 terdaftar /
  17 tamu). Buying never requires an account, so **Tamu is the NORMAL case, not a defect**: a registration
  wall in front of an Indonesian checkout is the most reliable way to lose the sale. The UI styles Tamu as
  neutral and Terdaftar as the extra.

- [~] **Google OAuth** — code done, **UNPROVEN**. The code-exchange / JWKS path has **never been run
  against real Google credentials**. Feature-flagged, so an unset env hides the button rather than
  crashing.
- [~] **Chat (shopper ⇄ merchant)** — spec done ([`CHAT_SPEC.md`](./CHAT_SPEC.md)); **migration `0043`
  landed** (`chat_visitors`, `conversations`, `conversation_messages`, with RLS). Application code was in
  flight and uncommitted at the time of writing. Note: CHAT_SPEC targets migration `0036`, which was
  taken by the payments/media RLS migration — the real slot is `0043`.
- [~] **Custom domain for a merchant** — 📄 spec ([`CUSTOM_DOMAIN.md`](./CUSTOM_DOMAIN.md)); **slices 1–3 BUILT + deployed
  2026-07-15**, slice 4 (Cloudflare-for-SaaS cert issuance → `active`) blocked on the user (cost + a CNAME-target domain).
  **Built:** migration `0050` `store_domains` + RLS; `slugFromCustomDomain()` resolves an `active` host to a slug;
  `StoreInfo.primaryHost` + `primaryOrigin()` route canonical/`og:url`/sitemap to the primary; admin UI `DomainCard`
  (Pengaturan → Domain) adds a domain and **TXT-verifies ownership for real** (`node:dns` `resolveTxt`), showing copyable
  CNAME+TXT records. **HONEST GAP kept visible:** a verified domain rests at `provisioning` and the UI does NOT let the
  merchant flip it to `active` — a shopper is only served once a TLS cert exists, which is slice 4. Original design notes:
  `store_domains` table (a domain is a *process*, not a value — apex+www, states pending→active→error);
  **301** to the primary host, not `rel=canonical` (a canonical is a hint, a 301 is a directive) — GET/HEAD only,
  never `/api/*` (a 301 on POST drops the body → kills the checkout beacons); **Cloudflare for SaaS** over
  Traefik+LE (HTTP-01 needs the CNAME target grey-clouded, which publishes the origin IP); **TXT verification**
  before we serve anything (skip it and someone CNAMEs `bank-example.com` at us → TLS-valid phish under our name).
  Two seams already landed: `slugFromCustomDomain()` (now a real `store_domains` resolver) and **`primaryOrigin()`** in
  `apps/storefront/src/data/store.ts` — every canonical/og:url/sitemap already flows through it, so switching the
  subdomain→custom-domain primary is a one-line change. ⚠️ **Migration slot: `0050`** (spec says `0049`, taken by
  whatsapp/tagline). Riskiest UNVERIFIED thing: what SNI/Host Cloudflare presents to our origin for a custom
  hostname, given the zone is Full(strict) and the origin only has the `*.tokophi.com` Origin CA cert — needs a
  30-min throwaway-domain experiment before slice 4. **Slice 1 (pickup-ready):** migration `0050` + `store_domains`
  + RLS + `slugFromCustomDomain()` body + `StoreInfo.primaryHost` — verifiable with `curl -H 'Host: …'`, no DNS/CF/cost.
- [~] **Payment gateway — AutoLaris VA/QRIS** works end-to-end (6 channels live: QRIS + 5 VA, filtered on
  `enabled AND active` = we offer it AND the gateway accepts it on a live probe; e-wallets/retail refused by
  the vendor, so not rendered). Callback is idempotent. ⚠️ **ONE gap, BLOCKED ON THE VENDOR:** the callback
  (`apps/admin/app/api/public/pay/callback/route.ts`) authenticates with an **interim shared secret**
  (`X-Callback-Token`), NOT the real AutoLaris HMAC signature — the code says so and points at PROD_PLAN §7.
  Cannot be built until AutoLaris confirms the signing spec. Until then a leaked token = a forged
  "paid" callback. And `KIRIMINAJA_ENV`/the AutoLaris env default to **sandbox** — real tariffs are one env flip away.
- [x] **Custom-domain admin UI** (2026-07-15) — `DomainCard` in Pengaturan → Domain (`settings:write`, RLS via
  `withTenant`): states belum diverifikasi → menunggu DNS → menunggu aktivasi (provisioning) → aktif → error,
  copyable CNAME+TXT records, Bahasa Indonesia copy. `addDomain`/`verifyDomain`/`setPrimaryDomain`/`removeDomain`
  in `lib/actions/domain.ts`; reads via `listDomains()` (server action, so the client never imports `server-only`).
- [ ] **`product-detail` section** — a product template currently replaces only the *tail* of the PDP; the
  buy box is always kept, because no registry section can render it and a full replace would ship
  unbuyable product pages.
- [ ] **De-dup `apps/admin` onto `@tokophi/ui` + `@tokophi/lib`** and delete its local `components/ui` +
  `lib/format`. Super-admin already consumes the shared packages.
- [ ] **Diskon edit route** `/diskon/[id]` (create-only dialog today).
- [ ] Tiptap rich text (textarea + a decorative toolbar today) · video slot · MinIO/S3.

---

## ✅ P2.0 — Checkout input validation + the client-priced ongkir (DONE 2026-07-14)
> The rest of the theme: **the checkout trusted the browser**. Origin (fixed), COD province (fixed), weight (fixed) — and then the two that were still open: the ongkir **price** and every **typed field**.

**Done — `/api/public/order` is now the boundary, in full:**
- [x] **The ongkir is RE-QUOTED server-side.** `shipping.cost` from the body is not read at all (the field is gone from the storefront payload). `lib/shipping-quote.ts` is now the ONE function that produces a price — `/api/public/ongkir` and the order API call the same code (same origin, same DB weight, same platform∩store service scope) and the order stores **the price the server computed for the service the shopper picked**. A service that is not in the fresh quote → the order is **rejected**, never silently re-couriered. Posting `shipping:{cost:0}` now writes the real Rp13.700.
- [x] **…and the item prices too.** Same hole, bigger: `items[].price` was summed straight into `orders.subtotal_idr` + the line items, so `price: 0` bought the goods for nothing. Prices, titles and the variant now come from `product_variants`; an unknown/archived handle is refused.
- [x] **WhatsApp normalised, not rejected** (`@tokophi/lib/validate` `normalizePhone`): `0812…` / `812…` / `+62 812-…` / `62 812…` → **`62xxxxxxxxx`**. Structure only (after `62` it starts with `8`, national part 9–12 digits) — **no operator-prefix table**, which would one day refuse a real customer on a new prefix. Normalised on write from every path (checkout API, abandoned-cart capture, chat, seller pickup phone) and **backfilled** (migration `0048`: customers 26/26, orders 687/687, plus leads/followups/wa_messages/chat_visitors/customer_addresses). `waLink()` normalises too — `wa.me/08…` never opened a chat.
- [x] **Email: shape only, optional, NO domain whitelist** (there is no mailer; a gmail/yahoo allow-list would reject corporate/university/self-hosted buyers).
- [x] **Nama:** letters (incl. diacritics), spaces, `.`, `'`, `-` — `Nur'aini`, `M. Rizky`, `Siti binti Abdullah` all pass; digits/symbols are refused.
- [x] **Alamat:** letters AND digits (RT/RW and house numbers are the point) + ordinary punctuation; only junk is refused (emoji, control chars, one repeated character, < 10 chars).
- [x] **Kecamatan: no character rule.** The real check is that the `dest_id` **resolves in `kiriminaja_areas`** — that is what the parcel is booked against. Kota + Provinsi are now **derived from it** and the typed values are ignored (they were a claim; the COD gate already refused to trust them).
- [x] **Kode pos:** 5 digits, optional (still typeable for the ~4% of districts with no kelurahan data).
- [x] Client-side copies of the rules live in `checkout.astro` **for early feedback only** — the API re-normalises and re-validates everything.

**The rule to keep:** *over-validation is itself a bug.* A rejected legitimate name / new carrier prefix / unusual address costs a sale and nobody ever finds out. **Normalise generously, reject narrowly.**

## ✅ P1.9 — Shipping weight comes from the DB, not the browser (DONE 2026-07-14/16)
> **The bug (found 2026-07-14 by the user: "Mampang, Jakarta Selatan → SPX Standard Rp40rb"):** `checkout.astro` prices every parcel with **`weight: totalQty * 500`** — a fabricated 500 g per item. The real column `product_variants.weight_grams` exists and the Seller's product editor has always had a required "Berat (gram)" field — it was simply **NULL on all 96 variants**, so nobody noticed the checkout never read it.
>
> Measured on the live API (Surabaya → Mampang Prapatan, SPX Standard): 3.000 g → **Rp41.100** (what the user saw) · 1.500 g → Rp27.400 · **675 g (3 items at their REAL ~225 g) → Rp13.700**. Shoppers were being quoted **3× the true postage** — a silent conversion killer for an apparel store, and nobody would ever know why the carts were abandoned.
>
> ✅ **Done already:** weights backfilled (96 variants, 150–300 g, stable per-id; prod + local), dims set to 1×1×1 (volumetric negligible → the courier bills the ACTUAL weight, correct for apparel), and `seed.ts` now seeds weight deterministically (mulberry32 — never `Math.random()`).
>
> ❌ **Still open — and this is the important half:** the checkout still sends the weight **from the browser**. Filling the data is not enough if the client is still the one doing the arithmetic. **Weight is a price input, so it must be computed server-side**, exactly like the ongkir ORIGIN (now read from the seller's pickup address, not a client-posted city) and the COD PROVINCE (now read from the KiriminAja district id, not the buyer's typed text). Same lesson, third time: **a claim from the client is not a fact.** A script posting `weight: 100` for a 5 kg parcel gets the cheap quote and the **merchant eats the difference with the courier**.

- [x] `/api/public/ongkir` `op=rates` accepts `items: [{variantId, qty}]` and **sums
  `product_variants.weight_grams` itself** (`lib/shipping-weight.ts` `weightForCart`, shared by ongkir +
  the order re-quote via `shipping-quote.ts`); `body.weight` is not read at all and `checkout.astro` no
  longer sends it. Committed `1234dcc`.
- [x] Variants with a NULL weight → 500 g fallback **and a warning on the Seller's Produk list** (2026-07-16):
  `getProducts` flags each product with `bool_or(weight_grams is null)`; `produk-client.tsx` shows an amber
  **"Berat belum diisi"** on those rows/cards (grid + table). The fallback is now visible, not silent.
- [~] Weight required for new products — the editor already marks "Berat (gram)" required (the `*`) and the
  list now warns on the missing ones; a HARD server reject on save is deliberately NOT added (it would
  refuse legacy/CSV imports — same "over-validation is a bug" rule). The warning is the honest surfacing.

## 🟡 P1.8 — Healthcheck & watchdog (L1 BUILT + LIVE 2026-07-15; L2/L3/alerts still open)
> **Why this is here:** on 2026-07-14 production went down **three times** and every deploy failed **silently for an hour** — and *every single one* was found only because someone happened to look. Nothing told us. That is the gap: not the bugs, the **absence of a witness**.
>
> **The three failure shapes seen (design against these, not against a generic "is it up?"):**
> 1. **Containers created but never started.** Coolify built `admin`/`super-admin`/`storefront`, left them in `created` (exit 0, no logs, disk fine), and moved on. The site 503'd; `landing` stayed up (it has no deps — that design held). Recovery was a plain `docker start`.
> 2. **Deploy failing while the API answers "queued".** `npm ci` refused to run (lockfile out of sync — `playwright` in `package.json`, absent from the lock), so **every** build died at `RUN npm ci` for an hour. `POST /api/v1/deploy` kept returning `deployment queued`. Coolify's own `application_deployment_queues` table said `failed` the whole time — nobody was reading it.
> 3. **A migration that never applied.** The journal referenced `0046_good_dust` whose `.sql` was never committed → `drizzle-kit migrate` died → the `kelurahan` table never existed → `/api/public/ongkir op=kelurahan` 500'd on every checkout. **And the 500 surfaced in the browser as a CORS error** (an uncaught throw returns Next's own 500, which carries no CORS headers), so the message pointed at the wrong layer for hours.
>
> **Design (3 layers — one is not enough, each catches what the others cannot):**
> - **L1 — self-healing watchdog ON the box** (cron, 1 min): any of the 4 app containers in `created`/`exited` → `docker start` it. Fixes shape #1 with no human awake. **Needs no credentials — can be built today.**
> - **L2 — external probe** (must NOT run on the box; a watchdog on a dead box is worthless): the 5 public hosts **plus one endpoint that actually touches Postgres** — a container can be `healthy` while the DB is gone, so a static page proving 200 proves nothing. Suggested: `POST /api/public/ongkir {op:"search"}` (hits `kiriminaja_areas`).
> - **L3 — deploy-failure alarm** (shape #2): read Coolify's `application_deployment_queues` for `status='failed'`. Do not trust the deploy API's response.
>
> **Blocked on ONE decision from the user: where do alerts go?** Telegram (fastest to a phone; needs a @BotFather bot token + chat id in `~/.config/ai-local/secrets.env`), or email/SMTP. Until that exists, L1 can still ship (self-heal + `/var/log/tokophi-watchdog.log`) — it just heals in silence.

- [x] **L1 self-healing watchdog — BUILT + LIVE on the VPS** (2026-07-15). `ops/tokophi-watchdog.sh`
  (in the repo) installed at `/usr/local/bin/tokophi-watchdog.sh`, fired every minute by
  `/etc/cron.d/tokophi-watchdog`. It `docker start`s any of the 4 app containers (`admin`, `super-admin`,
  `storefront`, `landing`) found in `created`/`exited`, matched by the stable
  `<svc>-l7r4qaqcml4zigw1dc7iptun-` prefix. **Deliberately narrow:** never touches `postgres`/`backup`/
  `coolify`/`cron`, and never `migrate` (which is *supposed* to be `exited (0)` — starting it re-runs
  migrations); only acts on `created`/`exited`, leaving a `running`-but-unhealthy or `restarting`
  crash-loop to L2/L3. No credentials, no network. Writes a heartbeat to `/var/run/tokophi-watchdog.last`
  every run (an observable "the watchdog is alive" signal for L2, since the log stays quiet on a healthy
  box). **Proven end-to-end:** `docker stop landing` → watchdog → `running` again + HTTP 200 + a `HEAL`
  log line; cron firing confirmed via the heartbeat advancing + syslog `CRON … tokophi-watchdog.sh`.
  Survives a bad deploy because it lives on the **host**, not in an app container. ⚠️ Re-install after a
  full VPS reprovision: copy `ops/tokophi-watchdog.sh` + the cron.d line (see DEPLOY.md).
- [ ] **L2 external probe** incl. a DB-touching endpoint, off-box. Can now also read the L1 heartbeat
  (`/var/run/tokophi-watchdog.last`) to detect a dead watchdog / dead box.
- [ ] **L3 deploy-failure alarm** reading Coolify's queue table, not its API response
- [ ] **Alert channel** — user decision (Telegram bot token / SMTP). ⚠️ **This is what still blocks L2/L3:**
  L1 heals in silence; L2/L3 have nowhere to send an alert until this is chosen.

## P1.7 — Domain cutover (LIVE, residual items)

- [x] DNS, Traefik wildcard router (`priority=1` — load-bearing), landing app, SEO hygiene, `www` 301.
- [x] **Verified in production:** a store signed up through the real `/daftar` got a working HTTPS
  storefront at `<slug>.tokophi.com` with **zero deploys and zero DNS work**.
- [ ] **⏳ YOU: set the zone's SSL mode to `Full (strict)`** — our API token lacks *Zone Settings: Edit*.
- [ ] **⏳ YOU:** check `site:app.tokophi.com` / `site:rich.tokophi.com` and purge anything already indexed
  via Search Console → Removals. The `noindex` header handles everything not yet indexed.
- [ ] Move the `www` redirect to the Cloudflare edge · Cloudflare cache rules.
- [ ] De-dup `noRobots()` (copy-pasted into both apps' `middleware.ts`) into `@tokophi/lib`.
- [ ] **Billing-cron URL + the AutoLaris callback URL still point at the old host** — verify the AutoLaris
  dashboard.
- [ ] Revoke the `claude-domain-cutover` Coolify token.

---

## P1.8 — Abandoned-cart capture: what go-live still needs

The feature is built and proven **locally, end-to-end, in a real browser**. None of that is true in
production yet.

- [ ] **🔴 Not deployed.** Both commits (`d7fc92f`, `9206220`) sit on `worktree-super-admin-overhaul` and
  are **not merged to main**, so Coolify has shipped none of it. **Production still runs without
  abandoned-cart capture** — every cart a real shopper leaves today is still lost, unrecorded.
- [ ] **The ageing sweep is opportunistic** — it piggybacks on storefront traffic, so **a store with no
  visitors never ages its own carts**. Acceptable now. On the VPS, decide between a cron and having the
  read layer derive `ditinggal` on the fly.
- [ ] **The capture rate limiter is in-process memory** (per SSR process) — the same known gap as
  `/api/track`. Multi-instance needs a Cloudflare rule.
- [ ] **Set `CHECKOUT_RECOVERY_SECRET` in the production env.** It falls back to `AUTH_SECRET`, which
  works — but it means **rotating the auth secret silently invalidates every outstanding recovery link**.
- [ ] **Google OAuth has still never been run against real credentials** (see *Feature completeness*
  above) — a signup blocker, not an abandoned-cart one, but it is the other thing standing between this
  branch and a merchant using it.

---

## P2 — Missing modules

- [ ] Produk: transfer stok antar-lokasi (`stock_transfers` exists, 0 rows, no UI) · pemasok CRUD.
- [ ] Pelanggan: loyalitas / poin.
- [ ] CRM: WhatsApp broadcast & automation (today: follow-up worklist + templates + pipeline).
- [~] Pemasaran: kampanye email/WA, automations (welcome, abandoned-cart). **Abandoned-cart recovery is
  now MANUAL** — the carts are captured and `/pelanggan/keranjang` opens a filled `wa.me` on one click.
  What is missing is the **automation** (send without a human, on a schedule).
- [ ] Kartu hadiah · Template notifikasi (toggles exist; the message editor does not).
- [ ] Analitik: laporan kustom + saved reports.
- [ ] **A real ad-platform integration** — or the permanent removal of `ad_channels` / `ad_metrics`. The
  tables exist and describe a product we do not have.

---

## P3 — Polish

- [ ] Loading / skeleton states.
- [ ] Full dark-mode visual QA pass.
- [ ] Accessibility audit (aria mostly present; never formally checked).
- [ ] "Rentang khusus…" custom date range.

---

*How to use: pull the top unchecked item, ship it, check it, add a `CHANGELOG.md` line, and re-verify
[`STATUS.md`](./STATUS.md). **Do not check an item off because the code exists — check it off because you
ran it.***
