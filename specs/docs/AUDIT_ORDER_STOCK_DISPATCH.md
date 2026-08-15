# TokoΦ — Order, Stock & Dispatch Domain Audit (Batch 3)

**Scope:** Order lifecycle & state machine · inventory allocation & lock concurrency · shipping/parcel creation (`admin/labels`) · courier routing (KiriminAja, marketed to merchants as "Mengantar") · COD flow · status transition state machine · ledger credit/debit.
**Method:** Static evidence review of `apps/admin/lib/{order-status,ledger-credit,ka-tracking,cod,cod-policy,inventory-location,shipment-payment}.ts`, `apps/admin/lib/actions/{orders,shipping,bulk-shipping}.ts`, `apps/admin/app/api/{cron/tracking,admin/labels,public/order}/route.ts`, `apps/admin/lib/data/{bulk-labels,bulk-shipping,orders,order-detail,order-payment}.ts`, `packages/db/src/schema.ts` (orders, orderFinancials, shipmentBookings, inventoryLevels, stockTransfers, ledgerEntries, payments), the corresponding `drizzle/00*.sql` migrations, and the associated `*.test.ts` suites and ADRs (`specs/decisions/0004`, `0014`, `0015`).
**No application code was modified.** All statements below are grounded in the referenced file/line evidence; anything not directly observed is marked `[INFERENCE]`.

---

## 1. Executive Summary & Domain Scope

TokoΦ's order/stock/dispatch domain spans four coupled subsystems that all settle inside a single Postgres transaction per state change:

1. **Order lifecycle** — `orders.status` (`baru → diproses → dikirim → {selesai | batal | retur}`), driven by `applyOrderStatusChange` (`apps/admin/lib/order-status.ts`), the single writer for the status column, inventory restore, and ledger settlement.
2. **Inventory** — `inventory_levels` rows, decremented at order-creation time (`app/api/public/order/route.ts`) and restored on cancel/return (`order-status.ts`), always resolved through the single shared `defaultInventoryLevelId` helper (`lib/inventory-location.ts`).
3. **Shipping/dispatch** — KiriminAja-backed parcel booking, cancellation and tracking (`lib/actions/shipping.ts`, `lib/ka-tracking.ts`, `app/api/cron/tracking/route.ts`), bulk booking/label queues (`lib/data/bulk-shipping.ts`, `lib/data/bulk-labels.ts`, `app/api/admin/labels/route.ts`).
4. **COD & Ledger** — a five-condition COD eligibility gate (`lib/cod-policy.ts`) and a saldo ledger that books a `sale` credit only when cash is actually collected (`lib/ledger-credit.ts`, migrations `0040`/`0041`).

The engineering discipline in this codebase is unusually high: nearly every file under audit carries a long-form comment documenting a *previously shipped* bug, the concrete financial/data-integrity consequence, and the regression test that now guards it (e.g. `cancel-shipment.test.ts` guards the AWB-vs-`kj_order_id` fallback that made a merchant's own cancel button fail against a live parcel; `inventory-location.test.ts` guards a cross-tenant stock write). This audit's job is to find what that discipline has *not yet* caught.

**Headline finding (§3.1, P0):** the order-status **ALLOWED transition table** (`order-status.ts:41-56`) and the courier-tracking **poller's forward-rank model** (`ka-tracking.ts:88,178`) encode two different, silently incompatible theories of how status may move. When a courier reports an outcome that skips an intermediate status (a realistic and even common polling artifact — see §3.1), the poller's write is **silently discarded** by the ALLOWED gate, yet the poller unconditionally records it as a successful transition, and the cron endpoint's own health summary (`advanced` counter) reports success. The order is left stuck, the COD cash is never marked collected, and the merchant's saldo is never credited — with no error, log line, or alert anywhere in the path.

Beyond that, the audit found the domain's inventory-locking discipline (single-row `FOR UPDATE`, single shared location-resolution helper), COD gating (five independently-sourced switches, all server-side), and ledger design (booked only on `payments.status = 'berhasil'`, DB-enforced one-entry-per-order uniqueness) to be sound and well-tested. §3 and §5 catalogue the remaining gaps.

---

## 2. Current Implementation Analysis & Code Evidence

### 2.1 Order Lifecycle & State Machine

`orders.status` is a Postgres enum (`packages/db/src/schema.ts:83-96`: `baru | diproses | dikirim | selesai | batal | retur`). The **single** writer of this column across the whole app is `applyOrderStatusChange` (`apps/admin/lib/order-status.ts:15-93`), called from exactly two sites:

- `apps/admin/lib/actions/orders.ts` (`setOrderStatus`, manual admin action) — locks the order row with `SELECT ... FOR UPDATE` (`orders.ts:24-29`) before calling into the state machine, so two concurrent status changes on the same order serialize; the loser re-reads the already-updated `status` and lands on the state machine's own terminal/idempotency guards instead of double-applying a restore.
- `apps/admin/lib/ka-tracking.ts` (`syncOrderFromKa`, automated courier-tracking sync, §2.4) — runs inside a `withTenant` transaction (`Tx === Db === typeof rootDb`, per the inline comment) so inventory, payments and ledger settle atomically with the tracking-derived status write.

`applyOrderStatusChange` guards, in order (`order-status.ts:28-56`):

```
if (order.status === status) return;                       // idempotent no-op
if (order.status === "batal" || order.status === "retur") return;  // terminal, no further moves
const ALLOWED: Record<string, string[]> = {
  baru:     ["diproses", "dikirim", "batal"],
  diproses: ["dikirim", "batal"],
  dikirim:  ["selesai", "batal", "retur", "diproses"],
  selesai:  ["retur"],
};
if (!ALLOWED[order.status]?.includes(status)) return;
```

Passing this gate is required before **any** side effect runs — the stock-restore branch, the `orders` UPDATE, and the `settleOrderLedger` call (§2.6) all sit below line 56. A rejected transition is therefore a complete, silent no-op: nothing is written, and the caller receives no signal (the function returns `void`). See §3.1 for why this is the audit's primary finding.

Stock restore on `batal`/`retur` and the ledger settlement call both execute unconditionally once the ALLOWED gate passes; the `retur` branch additionally stamps `returnedAt`/`returnReason` (`order-status.ts`, the `.set(...)` block).

### 2.2 Inventory Allocation & Lock Concurrency

Every stock writer resolves the store's default warehouse row through one shared helper, `defaultInventoryLevelId` (`apps/admin/lib/inventory-location.ts`), which joins `inventory_levels → locations` and filters on `locations.storeId` — the only predicate capable of scoping the join, because `inventory_levels` itself carries no `store_id` column (child-table RLS cannot reach it). `inventory-location.test.ts` enforces this as a **source-scan invariant** (`schema.locations.storeId` must appear exactly twice in the file, once per exported function) precisely because the expression previously existed as five independent hand-written copies, four of which lacked the store filter.

The order-creation path (`app/api/public/order/route.ts`) decrements stock inside a write transaction:

- The availability pre-check, the `FOR UPDATE` re-check, and the decrement all resolve and lock the **same** `inventory_levels` row (by id, once), so the check and the write cannot disagree.
- Concurrent sellouts throw `OutOfStock` / `VoucherExhausted` from inside the transaction (causing a clean rollback) rather than returning a false-success — the file's own history note documents that this endpoint previously threw *after* the order row and line items were already committed, producing a double-decrement on retried requests, and that the fix was to wrap the whole handler so every code path — success, validation failure, and unexpected error — returns a CORS-safe JSON response instead of letting Next.js render an uncaught 500 (which the storefront's `.catch` turned into "try again," i.e. a second, stacking submission).
- The route caps `items.length` at `MAX_CART_ITEMS` (measured before this cap existed: 10,000 line items produced 50,498 index scans and a 63.8 s request that consumed the database without ever reaching the courier API).

Stock restore on cancellation (`order-status.ts`) and inbound stock movement (`stockTransfers`, `packages/db/src/schema.ts:771`, status enum incl. `"draft"`) both route through the same helper, keeping the "what we check is what we write" invariant intact for the current one-location-per-store deployment topology. The code's own comments flag that this invariant would need re-derivation the day multi-location fulfilment ships (see §5).

### 2.3 Shipping / Parcel Creation & Label Generation

`apps/admin/lib/actions/shipping.ts` (1,307 lines) is the sole write path to KiriminAja bookings:

- **`createShipment`** (`shipping.ts:573-900`) gates on `kiriminajaConfigured()`, re-derives the COD eligibility via `getCodPolicy`/`buildCodPolicy` (never trusts a client-supplied COD flag), resolves the destination district server-side (falling back to a city-name guess only when `destDistrictId` is absent, flagging the order with `destinationGuessed` — the audit observed 77 such orders on the dev DB carried in complete silence, i.e. no operator surface currently lists them, see §3), and schedules pickup against KiriminAja's real daily cut-off (14:53 WIB) rather than a client-supplied time. On success it books a **ledger debit** (`kind: "adjustment"`, `component: "shipping-order-debit"`, `status: "available"` if the reservation succeeded synchronously, `"pending"` otherwise) for the shipping cost the platform advances on the merchant's behalf (ADR `0014`/`0015`: the platform absorbs COD shipping cost and reconciles net seller proceeds).
- **`cancelShipment`** (`shipping.ts:1115-1214`) cancels **by AWB only** (`o.awb`), never by `kaOrderId`. `cancel-shipment.test.ts` pins this as a source-scan invariant, documenting that the previous `o.awb ?? o.kaOrderId` fallback fired on every freshly booked-but-not-yet-picked-up parcel (the exact moment a merchant is most likely to want to cancel) and was verified against the sandbox to return "Paket tidak ditemukan" while leaving the shipment live at the courier.
- **`trackShipment`** (`shipping.ts:1215-1230`) is a thin read; the real tracking write path is the cron poller (§2.4).

**Label generation** (`app/api/admin/labels/route.ts`, `lib/data/bulk-labels.ts`): a `POST` accepts up to 50 order numbers, resolves them tenant-scoped via `withCurrentTenant`, and returns pre-built label HTML (one `<style>@page{size:100mm 150mm}</style>` document per order, concatenated) plus a `skipped: string[]` array for orders that cannot be printed (no `resi`/AWB yet). The route explicitly never serializes the shipping-label payload as structured JSON to the client beyond the rendered HTML string — the code comment frames this as a deliberate anti-leak boundary, since the caller's own store scope is the only thing standing between "print my own labels" and reading another tenant's customer PII. `buildLabelHtml` throws (rather than silently omitting) if invoked with zero parts, so a missing-`awb` order can only ever be `skipped`, never rendered blank.

**Bulk booking queue** (`lib/data/bulk-shipping.ts`): scope predicate (line 81) is

```sql
(o.status in ('baru','diproses') or (o.status = 'dikirim' and o.awb is null and o.ka_order_id is not null))
and (o.financial_status = 'dibayar' or exists (select 1 from payments p where p.order_id = o.id and p.method = 'cod'))
```

This is a **third, independently hand-written COD predicate** (`exists (... p.method = 'cod')`), alongside `cod.ts`/`cod-policy.ts` (eligibility) and `shipment-payment.ts` (money-flow labelling) — none of the three share a helper. It is currently correct (COD orders ship before `financial_status` flips to `dibayar`), but it is exactly the pattern (`inventory-location.ts`'s "five hand-written copies") that has previously produced a tenant-boundary regression in this codebase; see §5.

### 2.4 Courier Tracking Poller & Status Sync

There is **no inbound webhook**. `app/api/cron/tracking/route.ts`'s own header comment states this explicitly and corrects an earlier (stale) comment that had falsely claimed a shared webhook path existed. KiriminAja does document a `processed_packages` webhook, but no route in `apps/admin/app/api/` implements it and nothing ever calls KiriminAja's set-callback endpoint — polling (this cron) is the **only** mechanism by which an AWB, a delivery, or a return ever reaches TokoΦ's database today.

The poller (`app/api/cron/tracking/route.ts`) sweeps orders still in `diproses`/`dikirim` with a `ka_order_id`, calls `kaTrack` per order, and delegates the interpretation to `apps/admin/lib/ka-tracking.ts`:

- `outcomeFromTrackingCode` (pure function, `ka-tracking.ts`) maps KiriminAja's numeric/text status codes to one of `"booked" | "shipped" | "delivered" | "returned" | "canceled" | "problem"`, treating unrecognized codes as `null` ("changes nothing", never a guess) — this mapping is exhaustively unit-tested against the vendor's documented status table (`ka-status-codes.test.ts`), including a dedicated assertion that free-text status strings can **never** produce a money-moving outcome.
- `OUTCOME_STATUS` (`ka-tracking.ts:77-87`) maps that outcome to an `OrderStatus` target; `RANK` (`ka-tracking.ts:88`) assigns `baru:0, diproses:1, dikirim:2, selesai:3, retur:4, batal:4` and the sync only *attempts* a transition when `RANK[target] > RANK[cur]` (forward-only, one comparison, no requirement that the jump be a single rank).
- On a qualifying outcome, `syncOrderFromKa` calls `applyOrderStatusChange` and then **unconditionally** appends `` `status:${cur}→${target}` `` to its `changed` result array (`ka-tracking.ts:180-187`) — there is no branch on the outcome of the call, because `applyOrderStatusChange` returns `void` and offers no success/failure signal.
- `cron/tracking/route.ts` derives its own `advanced` counter from `s.changed.some(c => c.startsWith("status"))` and persists `{scanned, advanced, awbFilled, problems, problemsCleared, errors}` as the cron's health-check record (`recordCronRun`) and its JSON response.

The forward-only RANK design is explicitly built to permit multi-step jumps (a delivery reported in one poll after the last-seen state was still `diproses`, because the intermediate "shipped" code fell in a gap between polls, or arrived out of order from the vendor) — see §3.1 for why the ALLOWED table on the other end of this call does not honor that design.

### 2.5 COD Policy & Payment Flow

`apps/admin/lib/cod-policy.ts` is a pure, DB-free decision function (`buildCodPolicy`) unit-tested with fixtures; `cod.ts` is the thin DB-loading half (`getCodPolicy`). COD eligibility for a given courier/service/province/amount requires **all five** independently sourced conditions to agree:

1. `platform_cod.enabled` — the platform allows COD at all.
2. `store_settings.cod_enabled` — the merchant opted in.
3. `amount ≤ platform_cod.max_amount_idr` (0 = no cap).
4. `platform_cod.allowed_provinces` is empty, or the buyer's normalized province is in the allow-list — resolved from the KiriminAja-confirmed **district id**, never the shopper-typed province string.
5. `platform_couriers.services[].codAllowed` for the exact courier + service type the buyer picked.

`shipment-payment.ts` separates the **two opposite-direction money flows a single KiriminAja booking can carry** — non-COD (merchant → KiriminAja, gated on the vendor's `payment_status`) vs COD (buyer → KiriminAja → merchant, where the vendor's own docs say it ignores `payment_method` for COD packages and rejects the combination with error code 4003) — and is tested (`shipment-payment.test.ts`) to never leak the payment-service-provider's name to a merchant-facing label (ADR `0004`: courier identity is a platform decision, never disclosed downstream).

COD settlement itself is a ledger concern, not a shipping concern: a COD `payments` row is created `"menunggu"` at checkout and stays that way — the platform holds nothing at that point — until `collectCodOnDelivery` (§2.6) flips it, which only happens as a side effect of the order reaching `selesai` through `applyOrderStatusChange`. This means COD settlement inherits every risk described in §3.1 for status transitions that skip `selesai`'s only legal predecessor (`dikirim`).

### 2.6 Ledger Credit/Debit & Saldo

`packages/db/src/schema.ts:1550` (`ledgerEntries`) and migrations `0040_ledger_payouts.sql` / `0041_ledger_credit_sale.sql` define the saldo book. The write side (`apps/admin/lib/ledger-credit.ts`) enforces one rule: **a `sale` is booked when a `payments` row reaches `berhasil`, and nowhere else** — not at order placement, not at bill creation, not at shipment.

- `creditSaleForPayment(db, paymentId)` inserts a `sale` entry, `status` = `'available'` immediately if the order is already `selesai`/`retur`, else `'pending'` (released later per `platform_payout.release_on`, defaulting to `'selesai'`).
- `collectCodOnDelivery(db, orderId)` flips every pending COD payment on the order to `berhasil` and stamps `financial_status = 'dibayar'`, then calls `creditSaleForPayment` for each — this is the **only** place a COD sale is ever credited, and it is called exclusively from `settleOrderLedger`'s `selesai` branch inside `order-status.ts`.
- `settleOrderLedger(db, {status, prevStatus})` is the dispatcher `applyOrderStatusChange` calls after every accepted status write; on `retur`/`batal` it flips any `pending` `shipping-order-debit` adjustment entries tied to an `accepted`/`cancellation_requested` shipment booking to `available` (the platform's shipping advance becomes a realized cost, and — per the inline comment — is deliberately never reversed even though merchandise value is).
- DB-level guarantees back the "never double-credit" claim independent of application logic: `0041_ledger_credit_sale.sql` creates `ledger_one_sale_per_order` and `ledger_one_return_per_order` as **partial unique indexes** on `ledger_entries(order_id) WHERE kind = 'sale' | 'retur'`, so a retried/duplicated credit is a constraint violation, not a silent double-book, in the database itself rather than only in the application's control flow.

Every code path above is reached only if `applyOrderStatusChange`'s ALLOWED gate (§2.1) accepts the transition — which is precisely the seam §3.1 identifies as broken for the automated tracking path.

---

## 3. Edge Case, Regression & Vulnerability Assessment

### 3.1 [P0] Courier-reported status skips are silently dropped, and the cron health-check reports success anyway

**Where:** `apps/admin/lib/order-status.ts:41-56` (the `ALLOWED` transition table) vs. `apps/admin/lib/ka-tracking.ts:88,177-187` (the `RANK`-based forward-only sync) vs. `apps/admin/app/api/cron/tracking/route.ts` (the `advanced` health metric).

**Mechanism.** `ALLOWED["diproses"]` is `["dikirim", "batal"]` only — it does **not** include `"selesai"` or `"retur"`. `ALLOWED["dikirim"]`, by contrast, includes all four possible forward/adjacent targets (`selesai, batal, retur, diproses`). The table was evidently built to gate the **manual** admin dropdown, where a human is expected to move an order forward one step at a time and where skipping straight from "processing" to "done" without ever marking it shipped is a plausible operator mistake worth blocking.

But the same function is the **only** entry point for `ka-tracking.ts`'s automated sync, whose entire design (`RANK`, `RANK[target] > RANK[cur]`) exists specifically to accept **any** forward jump, because a courier-tracking poll is not guaranteed to observe every intermediate state — the poller runs on a fixed interval, KiriminAja's own status codes are a superset the poller only samples, and a real parcel can plausibly go from "diserahkan ke kurir" straight to a "delivered" or "returned to sender" code between two consecutive poll runs (same-day/instant courier services in particular). When that happens with the order still sitting at `diproses` (i.e. no `dikirim` was ever observed — e.g. the intermediate "shipped" code was missed, or the courier accepted and delivered within one polling interval):

- `syncOrderFromKa` computes `target = "selesai"` (or `"retur"`), passes the `RANK` check (`3 > 1` / `4 > 1`), and calls `applyOrderStatusChange(tx, {order:{status:"diproses"}, status:"selesai"})`.
- Inside `applyOrderStatusChange`, `ALLOWED["diproses"].includes("selesai")` is `false` → the function returns at line 56, **before** the `orders.status` UPDATE and **before** `settleOrderLedger` runs.
- `syncOrderFromKa` does not check any return value (the callee is `Promise<void>`) and unconditionally executes `changed.push("status:diproses→selesai")` immediately after the `await`.
- `cron/tracking/route.ts` derives `advanced++` from `s.changed.some(c => c.startsWith("status"))` — this order counts toward `advanced` in the cron's JSON response and in `recordCronRun`'s persisted summary.

**Impact.**
- `orders.status` stays `"diproses"` (or `"dikirim"` for the equivalent `dikirim → selesai/retur` case, if the analogous gap ever opens there — though `dikirim`'s ALLOWED row is currently complete) **forever** — the state machine has no periodic re-check; the poller only re-attempts orders whose status is still `diproses`/`dikirim` with the query it already used, and every subsequent poll hits the exact same `RANK` pass / `ALLOWED` reject / silent-`changed.push` sequence, so this is not a transient miss that self-heals on the next run.
- For a COD order, `collectCodOnDelivery` never runs — the goods have been physically delivered and the cash collected by the courier, but the `payments` row stays `"menunggu"` and `financial_status` stays whatever it was pre-delivery, indefinitely.
- The ledger `sale` entry is never inserted — the merchant's saldo permanently under-reports revenue that has, in fact, already been earned and (for COD) collected.
- Any pending `shipping-order-debit` adjustment on the order is also never released to `available` on a would-be `retur`, because that release logic (in `settleOrderLedger`) is likewise never reached.
- The operator-facing signal (`advanced` in the cron summary / `docker logs` line) actively **misreports success**, which is the specific failure mode the cron route's own inline comment says it exists to prevent ("`awbFilled` was 0 for a week and 'the cron ran' would have been true all week" — the same class of blind spot, now reproduced one layer up, for `advanced`).
- The order remains queryable by the merchant only as "Diproses" indefinitely (no visible AWB-linked activity, since AWB was already filled by an earlier successful poll) with no problem flag set (`problem`/`problemAt` is a *separate* mapping from a *different* outcome family and is not triggered by an ALLOWED-gate rejection), so there is no UI surface that would even hint an intervention is needed.

**Reproduction path (deterministic, code-traceable):** an order reaches `diproses` → `createShipment` books it and sets `ka_order_id` (order stays `diproses`, per `shipping.ts`'s booking flow — booking does not itself advance status) → the cron poller's next run observes a KiriminAja tracking code that maps to `outcomeFromTrackingCode(...) === "delivered"` (e.g. code `200`, per `ka-status-codes.test.ts`'s documented mapping) before any poll ever observed a `"shipped"`-mapped code (e.g. codes `100-105`) — which is exactly the case for any courier/service where pickup-to-delivery duration is shorter than, or comparable to, the poll interval, or where the vendor emits the "shipped" code only transiently. No malformed input, no concurrent write, and no misconfiguration is required.

**Suggested resolution direction** (for the implementing team, no code changed here): either (a) extend `ALLOWED["diproses"]` to include `"selesai"` and `"retur"` — treating a courier-confirmed multi-step jump as legitimate once it has already passed the `RANK` forward-only check, since a courier fact is a stronger signal than the manual-dropdown ordering rule this table was built to enforce, or (b) have `ka-tracking.ts` walk the intermediate status (`diproses → dikirim → target`) inside the same transaction when a skip is detected, or (c) at minimum have `applyOrderStatusChange` return a boolean/enum indicating whether the guard rejected the transition, and have `syncOrderFromKa` push a distinguishable `"status-blocked:…"` entry (or the cron route surface it as an `error`/`skippedStatus` count) instead of silently reporting it as an ordinary advance.

### 3.2 [P1] `destinationGuessed` orders have no operator-facing surface

`shipping.ts`'s destination-resolution fallback (§2.3) silently guesses a district from a city name when `destDistrictId` is absent and flags the resulting order with `destinationGuessed`. The audit found no query, dashboard widget, or filter in `lib/data/{orders,order-detail,bulk-shipping}.ts` that surfaces `destinationGuessed = true` orders to an operator. A wrong district guess produces a wrong ongkir/COD-province decision and, per `cod-policy.ts`'s condition 4, can silently make a COD order **ineligible** (or wrongly eligible) for COD in a way the merchant has no way to discover before booking fails or a parcel is misrouted. This is not a code defect in the resolution logic itself (the guess-vs-confirmed distinction is correctly recorded), but the flag is currently write-only.

### 3.3 [P2] Triplicated COD predicate across `cod-policy.ts`, `shipment-payment.ts`, and `lib/data/bulk-shipping.ts`

As noted in §2.3, `bulk-shipping.ts:81` hand-rolls `exists (select 1 from payments p where p.order_id = o.id and p.method = 'cod')` rather than importing a shared "is this order COD" predicate. It is correct today, but the same codebase has already regressed exactly this pattern once (`inventory-location.ts`'s five-copy history, guarded now by a dedicated source-scan test). No test currently enforces that this file's COD predicate stays in sync with the canonical definition.

### 3.4 [P2] `applyOrderStatusChange`'s silent-return contract has no caller-side observability, by design, everywhere it is called

Beyond §3.1's specific automated-caller consequence, the manual caller (`actions/orders.ts:setOrderStatus`) has the identical blind spot: if a future UI control (or a scripted/API caller) ever requests a transition the `ALLOWED` table rejects, `setOrderStatus` returns successfully (no thrown error, no false-y result) and `revalidatePath` still fires — the admin UI will re-render the (unchanged) order and give no indication the requested status change was rejected. Today's UI reportedly limits the exposed dropdown to legal transitions [INFERENCE — the admin order-detail component was not in this audit's read set], but the state machine itself provides no defense-in-depth signal if that UI constraint is ever loosened or bypassed via direct action invocation.

### 3.5 [P3] No aging/backoff/prioritization documented in the tracking poller

`app/api/cron/tracking/route.ts`'s own header comment labels this "BACKLOG shipping #1/#2" and flags "no such path exists" for a webhook (§2.4). The poller sweeps all qualifying orders on a fixed interval with no visible retry/backoff for `kaTrack` failures beyond a per-order `try/catch` that pushes the order number into an `errors` array and continues — a failing order is retried at the same priority as every other order on the next full sweep, with no exponential backoff or dead-lettering. This is consistent with the file's own acknowledged backlog status rather than a newly discovered defect, and is listed here for completeness of the regression matrix rather than as a novel finding.

---

## 4. Test Suite Coverage & Regression Matrix

| Area | Test file | What it proves | Gap identified by this audit |
|---|---|---|---|
| Order state machine transitions | `AGENTS.md`-documented matrix (source: `order-status.ts` inline table) — **no dedicated `order-status.test.ts` found** in `apps/admin/lib/*.test.ts` | `ledger-credit.test.ts` exercises `applyOrderStatusChange` indirectly through `settleOrderLedger` scenarios (e.g. `selesai` on a COD order) | No test exercises the `ALLOWED` table's *rejection* branch (a call with a transition NOT in `ALLOWED`) at all — the silent-no-op path in §3.1/§3.4 is entirely untested |
| KiriminAja status-code → outcome mapping | `ka-status-codes.test.ts` | Exhaustively pins every documented vendor code to the correct `KaOutcome`, and that free text never yields a money-moving outcome, and that unknown codes are `null` | Does **not** test `syncOrderFromKa`'s integration with `applyOrderStatusChange` — i.e. it proves the *mapping* is correct but not that the *resulting status write actually lands*. This is precisely the seam where §3.1 lives, and it is the one integration point this otherwise very thorough suite does not cover |
| Ledger credit/settlement | `ledger-credit.test.ts` (838 lines, real Postgres via `TEST_DATABASE_URL`) | `creditSaleForPayment`, `collectCodOnDelivery`, `settleOrderLedger` scenarios including `selesai` on COD (collects cash + books available sale) | Does not include a scenario where `settleOrderLedger` is invoked as a **downstream consequence of a rejected `applyOrderStatusChange` call** — because the two functions are only ever tested at the unit level, the compound failure never surfaces |
| Inventory location resolution | `inventory-location.test.ts` | Source-scan invariant: `schema.locations.storeId` appears exactly twice (once per exported function); no sixth hand-copy of the tenant-scoping join can be reintroduced undetected | Sound; no gap found |
| Cancel-shipment AWB rule | `cancel-shipment.test.ts` | Source-scan invariant: the "BY AWB, AND ONLY BY AWB" correction comment and the "Not Order ID" vendor citation must both be present, positively asserted | Sound; no gap found. Note: this is a **source-scan**, not a behavioral test — it cannot catch a *new* logic path that reintroduces a `kaOrderId` fallback under a different code shape (only a re-addition of the literal pattern the comment describes) |
| COD/VA payment-flow separation | `shipment-payment.test.ts` | `shipmentPaymentState`/`shipmentPaymentLabel` correctly separate COD vs VA blocking semantics and never leak the PSP name | Sound; no gap found |
| COD eligibility gate | *(referenced in `cod.ts`/`cod-policy.ts` comments as fixture-tested; `cod-policy.test.ts` present in `apps/admin/lib/*.test.ts` glob but not read in full for this audit)* [INFERENCE — file exists, contents not exhaustively verified line-by-line in this pass] | — | Full line-by-line verification of `cod-policy.test.ts` against all five gate conditions was not performed in this audit pass; recommend a follow-up read to confirm all five conditions (platform enabled, store enabled, amount cap, province allow-list, per-service `codAllowed`) each have an independent negative-case test |
| Cron tracking summary accuracy | *(no test found)* | — | `advanced`/`awbFilled`/`problems` counters in `app/api/cron/tracking/route.ts` have no test asserting they reflect **actually persisted** state changes rather than merely `changed.push(...)` calls — this is the direct enabler of §3.1's silent-failure-reads-as-success characteristic |
| Public order creation (stock decrement, dedup, CORS-safe error path) | *(no dedicated `route.test.ts` found for `app/api/public/order/route.ts`)* [INFERENCE — glob for `**/*order*` and `**/*.test.ts` under `apps/admin/app` did not surface one] | — | The `OutOfStock`/`VoucherExhausted` concurrent-sellout paths and the double-charge-on-retry fix (both extensively documented in the route's own comments as previously-shipped bugs) do not appear to have a regression test in this codebase; recommend verifying whether integration coverage exists elsewhere (e.g. an e2e suite not captured by the `*.test.ts` glob) |

**Net assessment:** unit- and source-scan-level coverage for this domain is unusually rigorous and clearly battle-tested against real production incidents (every guarded file names the specific bug it prevents). The one systemic gap is **integration coverage across the automated-tracking → state-machine → ledger boundary** — every piece is well-tested in isolation, but the seam where they are composed (§3.1) has no test, and is exactly where this audit's headline defect lives.

---

## 5. Actionable Engineering Perfection Directives

### Backend / State Machine
1. **(P0, addresses §3.1)** Reconcile `order-status.ts`'s `ALLOWED` table with `ka-tracking.ts`'s forward-rank model. Either widen `ALLOWED["diproses"]` to accept `"selesai"`/`"retur"` (courier-confirmed skips are a stronger signal than the manual-dropdown ordering rule), or have the automated sync path walk intermediate states inside the same transaction, or thread a caller argument through `applyOrderStatusChange` that distinguishes "manual, enforce ALLOWED strictly" from "courier-confirmed, honor RANK forward-progress only."
2. **(P0, addresses §3.1/§3.4)** Change `applyOrderStatusChange`'s signature to return whether the transition was applied (e.g. `{applied: boolean, reason?: "same-status" | "terminal" | "not-allowed"}`) instead of `void`. Propagate this into `syncOrderFromKa`'s `changed` array (e.g. `status-rejected:diproses→selesai` instead of a bare `status:` entry) and into `cron/tracking/route.ts`'s summary as a distinct, alertable counter (`rejected`) separate from `advanced`.
3. **(P1, addresses §3.2)** Surface `destinationGuessed = true` orders in an operator-facing list/filter (mirroring the existing `perlu_dikirim`/bulk-shipping queue pattern) so a wrong-district guess can be corrected before it silently mis-prices ongkir or mis-decides COD eligibility.
4. **(P2, addresses §3.3)** Extract a single shared `isCodOrder(order | orderId)` predicate (backed by `payments.method = 'cod'`) and have `lib/data/bulk-shipping.ts` import it instead of hand-rolling the `exists (...)` clause, matching the precedent already set by `lib/inventory-location.ts` and `lib/cod-policy.ts` for other cross-cutting boundary checks.
5. **(P3, addresses §3.5)** When implementing the documented tracking-poller backlog (aging/backoff), ensure a repeatedly-failing order is deprioritized/dead-lettered rather than retried at uniform priority every sweep, and that `errors` in the cron summary is paired with the specific KiriminAja error payload for on-call diagnosis.

### Testing
6. Add an `order-status.test.ts` (or extend `ledger-credit.test.ts`) with an explicit case asserting that a rejected `ALLOWED` transition performs **zero** side effects (no `orders.status` write, no `settleOrderLedger` invocation, no stock restore) — this directly closes the coverage gap in §4 that let §3.1 ship undetected.
7. Add an integration test around `syncOrderFromKa` (real or fixture-driven Postgres, following the pattern already established in `ledger-credit.test.ts`) that feeds a "delivered while still `diproses`" tracking response and asserts the order **does** reach `selesai` and the ledger **does** get credited — this is the single test that would have caught §3.1 before merge, and should be the first thing added once the fix direction from directive #1 is chosen.
8. Add a test asserting `cron/tracking/route.ts`'s `advanced` counter only increments for orders whose `orders.status` row was actually observed to change (e.g. by re-reading the row post-sync in the test), closing the "summary lies" characteristic independent of the underlying state-machine fix.

### Documentation
9. Update the stale "the same path the webhook uses" phrasing already flagged as corrected in `cron/tracking/route.ts`'s own comment to also state explicitly, in one place (ideally `specs/decisions/`), that KiriminAja tracking is polling-only in production today — this fact is currently only discoverable by reading the cron route's source comment, not from any ADR.
10. Record the `ALLOWED` table's origin/intent (manual-dropdown ordering discipline) versus the tracking poller's `RANK` intent (courier-fact forward progress) as an explicit ADR once directive #1 is resolved, so a future contributor extending either table understands why the two are not — and, depending on the chosen fix, should or should not be — the same shape.
