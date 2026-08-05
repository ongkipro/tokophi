# KiriminAja doc sweep → status codes + the VA/COD split

**Scope.** Read all 34 captured KiriminAja doc pages by flow, write the vendor contract up, audit the
code against it, fix what is safely fixable, file the rest.
**Base commit:** `f6ecaf3` (PR #145). **Branch:** `ka/flow-audit`. **PR:** #146.
**Shipped:** `8ac7400` (N36), `97807dd` (N37).

## Done

- [x] All 34 doc pages read → **`specs/docs/KIRIMINAJA.md`** (the vendor contract; `FLOWS.md` §5 keeps
      the product flow).
- [x] **N36** — five documented status codes were unmapped (302, 310, 311, 333, 555) and 110 was
      mis-mapped. Guard: `apps/admin/lib/ka-status-codes.test.ts`, **7 red → 41 green**.
- [x] **N37** — VA and COD separated. Migration **0088** adds `ka_pickup_number`, `ka_payment_status`,
      `ka_payment_url`, `ka_shipping_cost_idr`. `apps/admin/lib/shipment-payment.ts` is the one place
      that separates the flows. Guard: `shipment-payment.test.ts` (9 tests). Browser-verified.
- [x] Gates: **vitest 323/323**, `tsc --noEmit` clean, eslint clean, `build:admin` completes.
- [x] Dev DB left honest — the two test rows restored to NULL; **0 orders carry any `ka_*` value**.

## Two non-bugs — do not re-raise

1. **There is no standalone pickup endpoint.** Creating the express order *is* the pickup request
   (`method: "request_pickup"`); pickup vs drop-off is the per-package `drop` boolean.
2. **Skipping the schedule endpoint is explicitly allowed** by the docs, so the fixed
   tomorrow-10:00-WIB schedule is a legitimate choice, not a defect.

## Traps this session hit — worth the next agent's ten seconds

- **`drizzle-kit generate` is not safe here.** It diffs against the last *snapshot*, which is **0082**
  — 0083–0086 are hand-written and left none — so it re-emits all of their changes, including
  `ADD COLUMN` without `IF NOT EXISTS` for `stores.suspended_*` and the discounts/purchase_orders
  unique constraints under **different names** than 0084 created. Drizzle runs the pending batch in
  ONE transaction, so applying it fails and rolls back everything behind it. **Hand-write the SQL,
  idempotent, no snapshot, journal entry only** — the 0083–0086 precedent.
- **A fresh worktree cannot build admin** without `apps/admin/.env.local` (gitignored). It fails on
  `/api/auth/signout` with "Failed to collect page data" — nothing to do with your change. Confirm by
  stashing and rebuilding before you go hunting.
- **A pure function's guard should not need a database.** `ka-tracking.ts` imports `schema` as a
  *value*, which initialises the DB client at import; `ka-status-codes.test.ts` dynamic-imports it
  behind a placeholder `DATABASE_URL` (postgres-js connects lazily, so no socket opens).
- **No order in the dev DB is booked** (`ka_order_id` is NULL everywhere), so the shipping card's
  `booked` branch renders on no screen. To exercise it, set the columns on one order, check, and set
  them back.

## NEXT

**N42 first, and it is not a coding task — it needs the owner.** COD settlement is not modelled: on
`selesai` a COD merchant is credited the **gross** total including ongkir as immediately-`available`
money, while KiriminAja remits **net** of the shipping cost it keeps. The merchant's balance
overstates by (ongkir + COD fee) on every delivered COD order and the platform covers the difference
from its own float. Half the prerequisite now exists (`orders.ka_shipping_cost_idr`). **The question
is whether the platform absorbs the ongkir on COD orders or nets it out of the merchant's credit** —
that changes what merchants are owed, so record the answer in `specs/decisions/` before writing any
ledger code.

Then, in rough value order:

- **N38** — label required fields. Four of five are pure plumbing (service type, postcodes, sender
  phone, item prices — all already persisted); **insurance is not stored at all** and needs a column.
  **Sorting code is blocked twice**: values come from KiriminAja support, and it rides the
  `processed_packages` webhook we do not receive. SPX needs a 2-column one and SPX is the primary
  courier + COD rail.
- **N39** — webhooks. `processed_packages` carries the AWB, which is what makes the resi appear in
  seconds instead of ≤15 min. 🔴 Blocked on the registration path (docs give the verb only). Note
  there is **no signature scheme** and no server-side retry, so it goes *beside* the poller.
- **N40** — `v6.1/request_pickup` is **marked deprecated by the vendor**. Resolve the v6.2 doc's
  self-contradiction on destination field names against the sandbox first.
- **N41** — courier holidays (`libur`) are invisible to us.

⚠️ **Still outstanding from the E2E run:** sandbox booking `5758-E2E68072665` / pickup
`XID-5544692486` could not be cancelled. **Do not repeat the booking run** — see
`2026-08-03-shipping-e2e-runbook.md`.

---

## Follow-up, same day: N42 decided and shipped

**Owner's ruling: the platform ABSORBS the courier's shipping cost on COD orders** —
[ADR 0014](../../decisions/0014-platform-absorbs-cod-shipping.md). The merchant keeps being credited
the gross order total including ongkir; we settle the courier.

- [x] ADR 0014 written — the decision, and why the gross credit is now deliberate.
- [x] `getCourierCostAbsorbed()` + "Ongkir COD yang kami tanggung" on Super Admin → Analitik.
- [x] `creditSaleForPayment`'s docblock names the ADR, because that is where the next auditor lands.
- [x] `apps/super-admin/lib/cod-shipping-cost.test.ts` — **mutation-tested**, not assumed: merging the
      two flows → `51000 ≠ 40000`; counting non-delivered parcels → `227000 ≠ 40000`.
- [x] Gates: vitest **456/456**, `build:super` exit 0. Browser-verified on the built app with real
      rows (COD Rp40.000/2, prabayar Rp11.000/1, 1 tak tercatat, 0 console errors), dev DB restored
      to **0 dirty rows**.

**No money moved.** The credit was already gross; the ADR makes that correct rather than a defect, and
the work was making the absorbed cost visible — it previously had no ledger kind, no reader, no screen.

### What is still open here

- 🟠 **Prepaid is the same shape and is NOT decided.** A prepaid order also credits the merchant gross
  while we settle the courier by VA. The card shows that number beside COD's, labelled *"mekanisme
  sama, belum diputuskan"*, so it stays visible until someone rules on it. Needs its own ADR.
- 🔴 **The figure is the shipping cost only.** No COD settlement fee is documented anywhere and
  `platform_cod.fee_pct` is read by nothing (seeded `0`), so the real cost is that **or more**.

### NEXT after this

Unchanged: **N38** label fields (insurance needs a column; sorting code blocked twice) · **N39**
webhooks (blocked on the registration path) · **N40** `v6.1` booking endpoint is vendor-deprecated ·
**N41** courier holidays · **N43** `password.test.ts` flakes 1-in-3 under a full run.
