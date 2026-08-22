# TokoΦ Master Build & Execution Log

**Repository:** `/home/ongki/Projects/tokophi`
**Date:** 2026-08-15
**Rule:** `AGENTS.md` Mandate — Every execution pass MUST update this log with exact changes, verification evidence, and completed task state.

---

## Log History & Execution Entries

### [2026-08-22 12:50 UTC] — Stage 5 Task 5.2 · F-C8 · Persist Or Remove Every Product Editor Control

- **Executor:** Claude (Opus 5), worktree `s5c`, branch `fix/stage5-product-editor`, off `origin/main` `a98321c`.
- **Method: MEASURED, not reasoned.** Every control on `/produk/[id]` was traced from its `React.useState` through `buildInput()` → `updateProduct`/`createProduct` → a column, and back out through `getProduct`. The predicate this pass's guard uses was then run against **the pre-fix file at `origin/main`** and printed exactly four submit-shaped controls that never reached the payload: `trackQty`, `barcode`, `chOnline`, `tags` (the other 17 it named are dialog/draft state and are classified as such).

| control | sink | verdict |
|---|---|---|
| **Saluran penjualan → Toko Online** (`chOnline`) | none — no channel column on `products`, no reader in any of the four surfaces | **REMOVED** (card and all) |
| **Tag** + chips `terlaris`/`baru`/`promo` | none — no `products.tags`; the only `tags` in the schema is `customers.tags` (CRM). The chips had no `onClick` at all | **REMOVED** |
| ↳ *checked before removing:* `conditionField` really does carry a `"tag"` member and the collection editor offers "Tag produk" — but **nothing evaluates a collection condition anywhere in this repo**, so a stored tag would still feed nothing | | recorded in the file |
| **Lacak kuantitas** (`trackQty`) | none — it hid the Kuantitas input while `stock` was saved either way | **REMOVED**; Kuantitas is always visible |
| **Produk fisik** (`physical`) | no column — and `buildInput()` read `physical && weight`, so OFF + Simpan **NULLed `weight_grams` + the three dimension columns** | **REMOVED**; weight + dimensions always shown |
| description toolbar (Tebal · Miring · Daftar · Tautan · Gambar) | none — five `<Button>`s with `aria-label` and no `onClick` over a plain `<Textarea>` | **REMOVED** |
| **Barcode** | `product_variants.barcode` **exists** and the storefront feed publishes it as `<g:gtin>` — only the wiring was missing | **WIRED**, both directions |
| SKU · Barcode · Kuantitas *while a product has variants* | `variantRowsOf()` returns the matrix rows and drops the product-level values entirely | **DISABLED** with a title naming the Varian card |
| everything else (24 fields) | a column each | kept, unchanged |

- 🔴 **"Produk fisik" was the expensive one.** It is the only control here that DESTROYED data on its way past: switching it off nulled the weight and dimensions that price every KiriminAja quote and booking (N30), then the product reopened with the switch back ON and the fabricated `"500"` default in the weight box — so the next Simpan wrote 500 g over a merchant's real figure. Nothing sells a non-physical product here: checkout always quotes ongkir and `weightForCart` falls back to 500 g, so a product marked "not physical" shipped anyway. There is no digital-goods concept to persist it into, and inventing a column for a toggle nothing reads is what this task forbids.
- 🔵 **Barcode is the opposite case and is why "remove everything dead" would have been wrong.** The column has existed since `product_variants` did and `validGtin()` in `apps/storefront/src/lib/product-feed.ts` turns it into `<g:gtin>`. Storage and a reader both existed; `buildInput()` simply dropped the value and the box opened empty on every visit. Round-tripping it needed all three links — the editor seeds from `product?.barcode`, `variantRowsOf()` carries it onto the implicit-default row, `selectProduct` reads it back — and only two of the three existed for its neighbour `sku`.
- ⚠️ **Known limit, stated rather than implied:** the variant MATRIX has no barcode column, so a product with variants cannot set one (the field is disabled and says why). Wiring per-variant barcodes is a feature, not part of this task.
- ⚠️ **A product decision left alone:** `products.badge` and `products.bestseller` DO exist and DO reach the storefront ribbon, but no editor exposes them. That is a missing feature, not a dead control, and it is not a rename of the Tag box.

- **Files Created / Modified:**
  - `apps/admin/app/(admin)/produk/[id]/product-editor.tsx`: the four removals + the toolbar, `barcode` seeded and submitted, the three per-variant fields disabled while `hasVariants`. Every removal leaves a comment saying what it was and why it went.
  - `apps/admin/lib/actions/products.ts`: `ProductInput.barcode` + `VariantInput.barcode`; both writers persist it (`createProduct` insert, `updateProduct` reconcile).
  - `apps/admin/lib/data/products.ts`: `selectProduct.barcode` (position-0 variant) + returned by `getProduct` — the "survives reload" half.
  - `apps/admin/lib/mock/store.ts`: `Product.barcode`.
  - `apps/admin/lib/product-editor-controls.test.ts` (new): the census.
- **The guard is a CENSUS, not a list of the fields that were wrong today.** `Record<stateName, "payload" | { local: reason }>` over all 45 pieces of form state: a new control fails until someone classifies it, a deleted one fails until its entry goes, and every `"payload"` entry must be READ inside `buildInput()`. It reads the file's CODE (`test/source-code.ts`), and it counts a reference only when it is not an object key and not a property access — **the first draft was vacuous precisely because `material: material` satisfies a bare `\bmaterial\b` through its KEY alone**, so `material: undefined` would have kept it green.
- **Verification Executed — six mutations on the census, each proved red before the guard was trusted:**

  | # | mutation (on a COPY, never product source) | assertion that fired |
  |---|---|---|
  | 1 | `material:` line deleted from `buildInput()` | material reaches buildInput() |
  | 2 | `material: material \|\| undefined` → `material: undefined` (key survives, value gone) | same |
  | 3 | `barcode:` line deleted — the defect this task fixed | barcode reaches buildInput() |
  | 4 | `const parsedOptions = options` → `= ([] as OptionDef[])` (the ONE indirection link cut) | options reaches buildInput() |
  | 5 | `chOnline` / `tags` / `trackQty` / `physical` re-added as state | census covers exactly the state that exists |
  | 6 | `const [material, setMaterial]` deleted, census entry left behind | same (stale side) |

  Plus one for each of the five barcode links (contract type, both writers, the select, the read-back) cut in turn.
- **Gates (exit codes read DIRECTLY, never through a pipe):**
  - `TEST_DB_REQUIRED=1 npm test` → **0 — 118 files, 931 tests passed**. 117 files / 893 tests of that total are `origin/main`'s — derived by subtracting this pass's one new file and its 38 tests, not measured on a second run, and said that way rather than presented as a baseline reading.  `astro check`: storefront 0 errors / 0 warnings / 14 hints, landing 0/0/0.
  - `npx tsc -p apps/admin --noEmit` → **0**.
  - `npm run lint -w @tokophi/admin` → **0 — 0 errors, 21 warnings**, exactly the baseline; the five removals left nothing dangling (`Bold`/`Italic`/`List`/`Link2`/`Separator` imports removed with them).
- ⚠️ **NOT clicked in a browser, and this change is browser-visible.** Said here rather than implied, exactly as #289 did for the same screen. The claims above are source/contract and schema claims; the reload round-trip is proved as a three-link source chain, not by driving the form.
- **Completed Task:** Stage 5 Task 5.2.

---

### [2026-08-21 16:10 UTC] — Audit pass · MONEY-AUDIT-1 · Four shipped defects on the money/goods paths, each proved red before it was trusted green

- **Executor:** Claude (Opus 5), worktree `uang`, branch `fix/audit-uang`.
- **Scope audited (read end to end, not skimmed):** `apps/admin/lib/actions/**`, `apps/admin/lib/data/**`, `apps/admin/app/api/public/**`, `apps/admin/app/api/cron/**`, `packages/lib/src/{billing,payment-fees,kiriminaja,tracking-ids}.ts`, `apps/storefront/src/pages/api/**`. Everything below was **measured against real PostgreSQL**, on a throwaway database created and dropped by this pass — never the shared `tokophi`.

#### ① `getBulkLabels` printed one label PER PAYMENT ROW, and half of them lied about the cash

`lib/data/bulk-labels.ts` joined `left join payments p on p.order_id = o.id` — unordered, unlimited,
against a table that routinely holds **more than one row per order** (a `gagal` VA beside the COD
that was collected; a second bill raised after the first expired — the whole of
`lib/data/order-payment.ts` exists because of that shape). The join **fans out**.

Measured, one order with a failed `va` and a collected `cod`:

```
getBulkLabels join shape → rows: 2  [{"number":"INV-LBL-1","method":"va"},{"number":"INV-LBL-1","method":"cod"}]
latestPaymentFirst (every other screen) → method: cod
```

Two thermal labels for **one AWB**, in one print job — one carrying `COD · Rp150.000` for the
courier to collect, the other `NON-COD · Sudah dibayar`. Whichever the courier scans decides whether
a COD parcel is handed over for nothing, or a buyer who has already paid is asked to pay again at
the door. It was also the **third** screen that names an order's payment method and the only one not
using `latestPaymentFirst()` — the shared ordering `data/orders.ts` and `data/order-detail.ts` were
unified on precisely so this could not happen.

**Fix:** the correlated scalar subquery the Pesanan list already uses (`payments` unaliased, ordered
by `latestPaymentFirst()`, `limit 1`). A scalar subquery cannot multiply rows, and the third screen
now gives the same answer as the other two.

#### ② `updateFlashSale` / `deleteFlashSale` reported success over a write that matched nothing

`lib/actions/flash.ts` read `owned` **specifically to prove tenancy** and then handed it to
`writeItems` alone: the parent `UPDATE … WHERE id = $1` ran unconditionally, matched **zero rows**
under RLS for an id that is gone or is another store's, and the action still returned
`{ ok: true, id }`. `flash-editor.tsx` toasts *"Flash sale disimpan."* on that and navigates away.
`deleteFlashSale` was `Promise<void>`, so **both** of its callers announced a deletion they could not
observe. Same class as `markLabelsPrinted`, and the five blind writes fixed the day before.

Measured (real Postgres, as the non-owning tenant): the shipped code answered `ok: true` for a
random UUID **and** for another store's live sale, whose row was untouched.

**Fix:** `.returning()` on both statements — the UPDATE is now both the write and the tenancy proof,
which also closes the read-then-write gap the old shape carried. Zero rows is a refusal with a
merchant-actionable sentence. `deleteFlashSale` returns `{ ok } | { ok, error }` and **both callers
read it in this commit** (the repo's two-file rule).

#### ③ A bulk run silently dropped every order past the 50th while reporting `ok: true`

`lib/actions/bulk-shipping.ts` applied `numbers.slice(0, 50)` with nothing carrying the remainder.
The list page loads up to **200** rows (`lib/data/bulk-shipping.ts` `limit 200`) and the button posts
the whole selection (`canBook.map(...)`, label "Generate resi (N)"). A seller selecting 150 orders
got *"50 pesanan dibooking"*, a green result, and **100 parcels that were never booked** — named in
`done`, in `failed` and in `awaitingResi` exactly nowhere. The file's own header forbids this in as
many words ("PARTIAL FAILURE IS THE NORMAL CASE and is reported per order, never summarised into
'berhasil'").

**Fix:** `BulkResult.skipped: string[]`, `ok` false while it is non-empty, and a warning toast in
`massal-client.tsx` naming the count and telling the seller the remainder is **still selected** so
pressing the button again continues the run (verified: `setSel` is called only by the row toggle and
the select-all box, never after a run).

#### ④ "Penghematan Pelanggan" counted vouchers on orders that were cancelled

`lib/data/discounts.ts` summed `orders.discount_idr` with a `WHERE` of exactly one predicate
(`store_id`), under a tile captioned *"nilai yang benar-benar dipotong"* — while
`applyOrderStatusChange` restores a cancelled order's stock and `settleOrderLedger` claws its sale
back in the same transaction. Measured, one Rp20.000 voucher on a completed sale beside a Rp50.000
cancellation and a Rp30.000 return: **Rp100.000 shipped vs Rp50.000** with `batal` excluded.

**Fix:** `ne(status, 'batal')` — the repo's own `NOT_CANCELLED` rule, which every other money
aggregate on a merchant screen already applies. ⚠️ **`retur` is deliberately left IN and is an
owner's call, not a bug**: the parcel was sold at the discounted price before it came back, and
`lib/data/finance.ts` answers it the other way (`SALES` excludes both). The split is named at the
function and pinned by a test, so changing it has to be deliberate.

#### ⑤ (one-liner) `cron/tracking` wrote a liveness row that could not go red

`recordCronRun("tracking", { ok: true, … })` was hard-coded while per-order failures were accumulated
in `errors` and returned in the summary. A tick in which **every** sync threw wrote a green
`cron_runs` row — over the one job whose week-long silence is why that table exists.
`order-expiry/route.ts` beside it already computes `ok: summary.errors === 0`. Now so does this one.

- **Files Created / Modified:**
  - `apps/admin/lib/data/bulk-labels.ts` — scalar subquery via `latestPaymentFirst()`; query+render split behind `bulkLabels(db, numbers)` so a test can drive the real SQL and the real renderer (the `dailyStatsRows` seam).
  - `apps/admin/lib/actions/flash.ts` — `.returning()` on the update and the delete; `deleteFlashSale` returns its outcome.
  - `apps/admin/app/(admin)/flash-sale/flash-sale-client.tsx`, `apps/admin/app/(admin)/flash-sale/[id]/flash-editor.tsx` — both delete callers read the result.
  - `apps/admin/lib/actions/bulk-shipping.ts` — `BULK_MAX`, `skipped`, honest `ok`.
  - `apps/admin/app/(admin)/pesanan/massal/massal-client.tsx` — surfaces `skipped`.
  - `apps/admin/lib/data/discounts.ts` — `discountSavingsFor(db, storeId)`, cancelled orders excluded.
  - `apps/admin/app/api/cron/tracking/route.ts` — `ok` derived from `errors`.
  - New guards: `apps/admin/lib/data/bulk-labels.test.ts` (4), `apps/admin/lib/actions/flash.test.ts` (5), `apps/admin/lib/actions/bulk-shipping.test.ts` (3), `apps/admin/lib/data/discounts.test.ts` (3).

- **Verification Executed — mutation FIRST, in every case.** Each guard was proved RED against the
  *shipped* code before it was trusted green; a test that has never failed is green for reasons
  nobody checked.

  | # | mutation (the shipped code put back) | tests that went red |
  |---|---|---|
  | ① | `left join payments p on p.order_id = o.id` + `p.method::text` | 3 of 4 |
  | ② | read-back `owned` + unconditional UPDATE; `delete` returning `true` | 3 of 5 |
  | ③ | `ok: failed.length === 0`, `skipped: []` | 2 of 3 |
  | ④ | `.where(eq(orders.storeId, storeId))` alone | 2 of 3 |

- **Gate (exit codes read directly, never through a pipe):**
  - `TEST_DB_REQUIRED=1 npm test` → **exit 0** · **113 files / 849 tests passed** (baseline on this branch's merge-base: 109 / 834) · `check:storefront` 0 errors (119 files) · `check:landing` 0 errors (29 files).
  - `npx tsc -p apps/admin --noEmit` → **exit 0**.
  - `npm run lint -w @tokophi/admin` → **exit 0** · **0 errors, 21 warnings** (today's baseline, unchanged).

- 🔴 **REPORTED, NOT FIXED — out of this pass's scope, and it is the biggest thing found.**
  **Every order from `/promo/<handle>` and `/lp/<slug>` has been rejected since 2026-08-03.**
  `apps/storefront/src/components/OrderFunnel.astro` — the component both paid-traffic funnels
  render — posts `address: { alamat, kota, provinsi }` and **no `kodepos`**
  (`grep -rl kodepos apps/storefront/src` returns only `checkout.astro`, `sukses.astro` and a test).
  `b5f9ded` made kodepos required at `/api/public/order` and added the field to `checkout.astro`
  only. Driven with the funnel's exact body against the real route handler:
  `{"ok":false,"error":"Kode pos wajib diisi.","field":"kodepos"}` — **0 orders written**. The
  funnel's `showErr("kodepos", …)` then looks up `[data-err="kodepos"]`, which does not exist on
  that page, so the shopper is shown a banner naming a field they cannot see. Build, lint and
  `astro check` are all green over it — the same shape as the `queueSave is not defined` outage.
  Not touched here: the fix is a form field in a storefront component (another territory, and
  browser-visible work), and making kodepos optional again would reverse a deliberate ruling.
  **This needs routing now.**

---
||||||| b2a659e
### [2026-08-21 09:20 UTC] — Stage 4 Task 4.13 · SEC-16 · The Credential Came Out Of The URL

- **Executor:** Claude (Opus 5), worktree `t413`, branch `sec/task-4.13-callback-cron-auth`, off `origin/main` `b2a659e`.
- **Scope:** Two reusable first-party secrets were being written into query strings. One was ours end to end and is now closed; the other belongs to a vendor's protocol and is now *unminted*, bound, documented and logged instead of pretended away. Plus exactly-one-identity on both halves of the payment callback.
- 🔵 **WHAT WAS ALREADY DONE BEFORE THIS PASS, established by reading rather than assumed.** The payments half of `pay/callback` already resolved identity exactly (`trx_id` preferred, `reff_id` fallback, no `or()`), already refused an ambiguous multi-row match with a 400, already checked the PAID amount against `payments.amount_idr`, and already failed closed in production on an unset `AUTOLARIS_CALLBACK_SECRET`. None of that was re-done. What was **not** done: zero identifiers, the invoice half, and every URL on both sides.

- 🔴 **`CRON_SECRET` was on the URL of every cron tick — CLOSED, because no vendor is involved.** All five compose sidecars called `…?secret=$CRON_SECRET&every=…`, and all six gated routes (five `api/cron/*` plus `api/health/env`) accepted it, each with its own hand-copied gate. That is the credential authorising a state-mutating sweep across **every tenant**, and a URL puts it in the container `command`, in `docker inspect`, in `docker top`, in the host process table and in every proxying access log. One gate now — `apps/admin/lib/cron-auth.ts`, header only, `timingSafeEqual`, fail-closed in production — and a request that still supplies `?secret=` is **refused AND logged**, so a caller left behind on the old shape is visible instead of looking like a wrong secret. `?every=` stays: it is the cadence the Sistem panel derives its staleness threshold from.
- 🔴 **The pay callback URL carried the whole platform secret — now it carries a PER-PAYMENT SIGNATURE.** `payCallbackUrl()` embedded `AUTOLARIS_CALLBACK_SECRET` verbatim in every bill's `callback_url` — the string that can mark **any** payment or **any** subscription invoice on the platform paid, handed to a third party and copied into their dashboard. It now signs the reference: `?cb=<reff>.<hmac-sha256, 128 bits>`, ONE parameter of comparable length to the token it replaces (deliberately: the shape the gateway is known to echo back unchanged is the shape to keep). The route then **binds** that signature to the row it resolved — `payments.reff_id` / `invoices.reff_id`, compared against the ROW, not the request body, so it holds whether the vendor echoes `trx_id`, `reff_id` or both. Without that binding a signature is a bearer token with extra steps; it has its own test and its own mutation.
- ⚠️ **THE `?token=` DOOR IS STILL OPEN AND THAT IS THE HONEST ANSWER, NOT AN UNFINISHED EDGE.** AutoLaris echoes `callback_url` and attaches no headers of its own. Refusing that parameter would 401 **every genuine payment**: `payments.status` stuck at `menunggu`, no order reaching `dibayar`, no ledger row, held conversions never released, and platform invoices no longer advancing `stores.current_period_end` until the platform suspends its own paying merchants — an outage this repo has already had once (see `CHANGELOG.md` "The payment webhook was rejecting every real payment"). **This half is vendor-blocked and is NOT claimed as closed.** What was ours is the minting side and it is closed; the door is unbound, logged as deprecated on every use, and pinned as a knowingly-open door WITH ITS REASON by `route.auth.test.ts`. It closes when the vendor confirms `X-Callback-Token` — branch and test deleted together, and the test says so.
- **Exactly one identity, on BOTH halves.** A callback naming no payment used to answer `{ok:true}` with a 200 — indistinguishable from one we acted on; it is a 400 now, and a blank/whitespace `trx_id` counts as absent (it used to fall through to `reff_id` silently, which is what made the zero-identity branch unreachable). The **subscription-invoice** half had NO ambiguity guard at all: an ambiguous `trx_id` would have settled several invoices in one UPDATE. It now gets the same 400 the payments half already had.

- **Files Created / Modified:**
  - `packages/lib/src/pay-callback.ts`: `payCallbackUrl(reffId)` (signature required by the type), `signPayCallbackRef`, `verifyPayCallbackRef` — which returns the REFERENCE, never a boolean, so a caller cannot forget to bind it. Splits on the LAST dot: a `requestKey` may contain dots, a hex signature may not.
  - `apps/admin/lib/cron-auth.ts` (new): the one gate, with the reasoning that used to be six copies.
  - `apps/admin/app/api/public/pay/callback/route.ts`: `authorizeCallback` (header · signature · legacy token · dev), `bound()`, the zero-identity 400, the invoice ambiguity 400.
  - The six gated routes + `docker-compose.coolify.yml` (five sidecars → `wget --header`).
  - All five `payCallbackUrl()` call sites now pass the reference they store on the row: `order.number`, `requestKey`, `reffId` ×3.
  - `apps/admin/lib/env-census.test.ts`: its claim was "the health route reads `process.env` only for its own gate". Moving the gate out would have made that assertion **vacuously stronger and then quietly rot**, so it is now made over BOTH files — the responder must read no environment at all, the shared gate only its two.
  - Tests: `apps/admin/app/api/public/pay/callback/route.auth.test.ts` (new), `apps/admin/lib/cron-auth.test.ts` (new), `packages/lib/src/pay-callback.test.ts` (extended).
  - Docs: `AGENTS.md`, `SECURITY.md` §6, `REQUIREMENTS.md` (SEC-16 → MET with the documented provider exception), `DEPLOY.md`, `specs/openapi/admin-api.yaml` (`cronQueryAuth` scheme and `CronSecretQuery` parameter removed), `CHANGELOG.md`, `STATUS.md`.
  - ⚠️ **A near-miss worth recording:** `apps/admin/app/api/public/pay/callback/route.test.ts` already existed (Task 4.10, #286) and this pass **overwrote it** before noticing. Restored verbatim from `HEAD` and the new tests moved to `route.auth.test.ts`; the 4.10 suite is green against the changed route, which is itself useful evidence — its real-Postgres paid → expired → paid cases still pass. The lesson: after a rebase, `git status` before trusting that a path is new.

- **Verification Executed — mutation FIRST, fourteen of them, each reverted immediately:**

  | # | mutation | test that went red |
  |---|---|---|
  | 1 | `bound()` always true | signature bound to a payment · bound to an invoice (2) |
  | 2 | zero identity answers `{ok:true}` again | names no payment · blank identifier (2) |
  | 3 | invoice ambiguity guard removed | ambiguous SUBSCRIPTION INVOICE match |
  | 4 | payment ambiguity guard removed | ambiguous payment match |
  | 5 | legacy `?token=` use stops being logged | the legacy door is logged as deprecated |
  | 6 | callback stops failing closed in production | FAILS CLOSED in production |
  | 7 | `payCallbackUrl` mints the reusable secret again | never puts the reusable secret in the URL |
  | 8 | `verifyPayCallbackRef` stops checking the signature | refuses a tampered reference/signature |
  | 9 | `cronAuthorized` accepts the query secret again | REFUSES the secret in the query string |
  | 10 | `cronAuthorized` stops failing closed in production | fails closed in production |
  | 11 | one sidecar back to `?secret=` on the URL | no compose sidecar puts CRON_SECRET on a URL |
  | 12 | one route back to reading the credential from the query | that route's source scan |
  | 13 | `health/env` reads the environment in the responder | the responder reads no environment variable |
  | 14 | the shared gate reads a third credential | the shared gate reads only its own two |

  Restored ⇒ green in every case. Both source scans and the compose scan carry their own **vacuity self-check** — the same predicate is asserted to fire on a copy with the retired shape put back — so they cannot be green for want of matching anything.

- **Measured on the wire, not asserted from the YAML.** The sidecar command was extracted from `docker-compose.coolify.yml`, `$$` expanded the way compose expands it, and ONE iteration run inside a real `alpine:3.20` against a probe server. BusyBox `wget` (v1.36.1) does support `--header`, and the server received `URL: /api/cron/billing?every=86400` with `x-cron-secret: "s3cr3t-value"` — credential in the header, **absent from the URL**, and `-qO-` still prints the response body to stdout, which is what `docker logs cron-billing` depends on.
- **Gates (exit codes read DIRECTLY, never through a pipe):**
  - `TEST_DB_REQUIRED=1 npm test` → **0 — 112 files, 870 tests passed** (baseline before this task on the same worktree: 109 files / 834 tests). `astro check`: storefront 0 errors / 0 warnings / 14 hints, landing 0/0/0.
  - `npx tsc -p apps/admin --noEmit` → **0** · `npx tsc -p apps/super-admin --noEmit` → **0** · `npx tsc -p packages/db --noEmit` → **0**.
  - `npm run lint -w @tokophi/admin` → **0 — 0 errors, 21 warnings**, exactly the baseline measured on this branch before any edit. `npm run lint -w @tokophi/super-admin` → **0 — 0 errors, 3 warnings**.
  - Own throwaway database `tokophi_t413_test`, created by `globalSetup`, dropped afterwards. The shared `tokophi` on :5433 was never written to.
- **No migration.** Nothing here needs storage: the signature is stateless HMAC over a column that already exists (`reff_id` on both `payments` and `invoices`, set by all five call sites). `0101` was reserved for this task and is deliberately **unused** — a reserved-but-empty index number is not free (`doc-counts.test.ts` asserts `head === entries - 1`), so no journal entry and no doc count moved.
- ⚠️ **Deploy note, stated because nothing else will say it.** Routes and sidecars change in ONE commit but restart in an unguaranteed order. Old-sidecar-then-new-admin costs exactly one tick, logged as *"a cron credential arrived as a QUERY PARAMETER — refused"*; every job here is idempotent and forward-only, so that is a delay, not a wrong state. The reverse order is safe outright (the old routes read the header first). If that log line persists past the deploy, a sidecar did not restart.
- **Not done here:** no browser pass — nothing in this change renders. The payment path itself cannot be exercised end to end without a live AutoLaris bill, which is exactly why the `?token=` acceptance is left alone.
- **Completed Task:** Stage 4 Task 4.13.


### [2026-08-21 08:20 UTC] — Stage 4 Task 4.11 · SEC-10 · Impersonation Is A One-Time Exchange Now, Not A JWT In A URL

- **Executor:** Claude (Opus 5), worktree `t411`, branch `feat/task-4.11-impersonation-exchange`.
- **Scope:** Replaced the reusable URL credential behind "Buka Dashboard Seller" with an opaque, single-use, server-side exchange; bounded the session it mints; carried the operator's identity into it; and made every gated merchant write name both parties. Explicit exit added.
- 🔴 **The defect, stated as what it actually was.** `signImpersonation` minted a **session-shaped JWT** and `impersonateStore` put it in the query string (`/impersonate?token=<jwt>&slug=<slug>`). Signed, audience-pinned, two minutes to live — and **reusable for every one of those 120 seconds by anyone holding the string**, because a JWT is *verified*, never *spent*. There was nowhere to record that the link had been used, so replay was not a bug in the route; it was the shape of the credential. A URL is the worst carrier there is for one: browser history, the next request's `Referer`, a reverse-proxy access log, a screen share, a pasted support ticket. The session it exchanged for then lasted **7 days** and carried **no mark that an operator was inside**, so every write the operator made was indistinguishable from the merchant's own — in `platform_activity`, on the merchant's screens, and in any later reconstruction of "who changed this?".
- **The fix is a row that can be SPENT, and the whole security model is one statement:**
  ```sql
  update impersonation_grants set consumed_at = now()
   where token_hash = $1 and consumed_at is null and expires_at > now() returning …
  ```
  One row ⇒ the exchange happened, exactly once. Zero rows ⇒ unknown handle, already spent, or expired — three causes, one fail-closed answer, and Postgres's row lock decides the concurrent case (the loser blocks, re-evaluates the predicate after the winner commits, matches nothing). The URL now carries **256 opaque bits** and nothing else; only `sha256(handle)` is stored, so a dump of the table redeems nothing.
- **The grant is a permission to exchange, never a cached fact.** Membership, the merchant's role, the operator's row, the operator's rank and the operator's `password_changed_at` are all re-read at consume time — the control plane's standing rule ("rank from `platform_admins`, on every request") extended across the gap between minting a link and clicking it. ⚠️ The operator check is `role === grant.operator_role`, deliberately **not** a rank comparison: `platform-rank.ts` must stay one copy and `apps/admin` may not import it. Equality is also strictly stricter (a promotion invalidates too, at the cost of one more click).
- **Files Created / Modified:**
  - `packages/lib/src/impersonation.ts` (new): the mint, the digest, both TTLs. ONE module because two apps must agree byte for byte — a second `sha256` would make every exchange fail closed with no error anywhere. `IMPERSONATION_SESSION_EXPIRY` is DERIVED from `IMPERSONATION_SESSION_MAX_AGE` so the cookie and the token cannot drift.
  - `packages/db/src/schema.ts` + `packages/db/drizzle/0098_impersonation_grants.sql` (new): the table. **RLS enabled with NO policy, deliberately** — control-plane rows, written by super-admin and read by the admin's *pre-session* auth path, both on the owner connection. A policy keyed on `app.store_id` would be strictly WEAKER while reading like protection.
  - `apps/super-admin/lib/actions.ts`: `impersonateStore` inserts a grant and returns `?grant=<handle>`. The `slug` no longer rides in the URL — the row knows the store, and a destination taken from a query string is a redirect the caller chooses. Its audit line now says a LINK was created, because that is what it wrote.
  - `apps/super-admin/lib/session.ts`: `signImpersonation` / `IMPERSONATION_AUD` **deleted**, with the reasoning left in their place so nobody reintroduces them.
  - `apps/admin/lib/impersonation.ts` (new): the claim, the two re-reads, the failure classification (logged, never returned — every refusal is the same redirect, so nothing becomes an oracle for guessing handles), and `logImpersonation`.
  - `apps/admin/app/impersonate/route.ts`: verifies nothing; spends a row and mints a **30-minute** session.
  - `apps/admin/app/impersonate/exit/route.ts` (new): explicit end, audited. ⚠️ `middleware.ts` exempts `/impersonate` by **exact match** and must keep doing so — a prefix would exempt the exit, which needs the session it is about to end in order to name the operator.
  - `apps/admin/lib/auth.ts`: `Session.imp` (operator id + email + grant id) inside the SIGNED payload — the cookie holder can neither forge nor strip it; `signSession` takes an `expiresIn` (default `7d`).
  - `apps/admin/lib/rbac.ts`: **the dual-identity record**, at the one choke point every mutating action passes. It records an AUTHORISATION, not an outcome ("memakai izin"), and **fails closed** — an operator write nobody can attribute must not happen.
  - `apps/admin/app/(admin)/layout.tsx` + `components/admin/admin-chrome.tsx`: the impersonation strip and its exit link. The `billingBanner` prop is now `banners` — the strip is not a bill, and a prop whose name lies is how the next one gets tucked into it too.
  - Docs: `AGENTS.md` (the rule, in the Super Admin section), `SECURITY.md` (**N1 closed**), `REQUIREMENTS.md` (SEC-10 → MET), `SCHEMA.md`, `CODE_MAP.md`, `STATUS.md` (derived counts: 81 tables · 99 migrations · head `0098` · RLS 53/54).
- **Verification Executed — mutation FIRST, in every case:**

  | # | mutation | test that went red |
  |---|---|---|
  | 1 | drop `consumed_at is null` from the claim | REPLAY **and** REPLAY under CONCURRENCY (2 tests) |
  | 2 | drop `expires_at > now()` | EXPIRY |
  | 3 | drop the operator role equality | operator DEMOTED |
  | 4 | drop the operator password revocation | operator's PASSWORD ROTATED |
  | 5 | role from the grant instead of `store_users` | merchant's ROLE is read from the row |
  | 6 | drop `imp` from the minted session | SUCCESS (dual identity) |
  | 7 | `signSession` ignores `expiresIn` | the 30-minute bound |
  | 8 | membership re-read stops bailing | MEMBERSHIP removed |
  | 9 | no audit at the gate | 3 of the 4 dual-identity tests |
  | 10 | operator named, merchant dropped | records both identities |
  | 11 | swallow the audit failure (fail OPEN) | FAILS CLOSED |
  | 12 | audit every session, impersonated or not | a merchant's OWN session writes nothing |

  Restored ⇒ green in every case. The two source claims (`jwtVerify` gone from the route, `signImpersonation` gone from super-admin) carry their own **mutation self-check** inside the test file, so they can never be green for want of matching anything.
- **Gates (exit codes read directly, never through a pipe):**
  - `TEST_DB_REQUIRED=1 npm test` → **0 — 109 files, 834 tests passed** (`astro check`: storefront 0 errors / 0 warnings / 14 hints, landing 0/0/0).
  - `npx tsc -p apps/admin --noEmit` → **0** · `npx tsc -p apps/super-admin --noEmit` → **0** · `npx tsc -p packages/db --noEmit` → **0**.
  - `npm run lint -w @tokophi/super-admin` → **0 errors** (3 warnings) · `npm run lint -w @tokophi/admin` → **0 errors** (23 warnings). ⚠️ The admin baseline is **23, not the 21 recorded earlier**: `apps/admin/lib/actions/shipment-payment-guard.test.ts` on clean `origin/main` imports `afterAll`/`beforeAll` and uses neither. Verified against `git show origin/main:` — none of the 23 is in a file this task touches.
  - `npm run verify-migrations -w @tokophi/db` → **0** — 99 entries, head `0098_impersonation_grants`, stamps increasing, idx unique **and sequential**.
  - `npm run verify-rls` (equivalent, run against the throwaway DB) → **0 — 53/54**, `platform_activity` still the only exception, so the new table is genuinely policed rather than exempted.
- **Measured, not asserted:**
  - **RLS with no policy is the strict setting:** with one grant row present, the owner connection sees **1** and `tokophi_app` **with the correct `app.store_id` GUC** sees **0**.
  - **The migration is idempotent:** every statement in `0098` re-executed against a database that already had it — no error.
  - **The whole chain applies in order from scratch:** the throwaway database was **dropped and recreated** after the rebase, so main's `0097` (stamp 1787297930663) and this `0098` (stamp **1787298476422**, 13 digits, above it) both ran in sequence. That drop was not hygiene — before it, the older database already held `0098` at a higher stamp, which is precisely the state in which drizzle **skips** `0097` while printing "migrations applied successfully".
- 🔴 **A NUMBERING DECISION THAT DEPARTS FROM THE BRIEF, WITH THE MEASUREMENT BEHIND IT.** This migration was assigned **0099**, leaving **0098** reserved for Task 4.7. Task 4.7 has since merged (**#298**) using `pg_advisory_xact_lock` and **no migration at all**, and `0097` (#297) is on `main`. Measured before renumbering: no `0098` exists in `origin/main`, in **any** remote branch (every branch's journal scanned), or in any worktree on this machine. A reserved-but-never-filled gap is not free — `doc-counts.test.ts` asserts `Number(head) === entries - 1`, so a hole at 98 leaves that guard **permanently red on `main`**, and closing it later would mean renumbering an already-applied migration. Numbered **0098**; the gap is gone and every gate is green. If 0098 turns out to be genuinely held elsewhere, moving this one back up is a rename plus one journal entry plus four doc sentences, and `verify-migrations` catches the duplicate at merge either way.
- **Not done here:** no browser pass. The screens involved are a server-rendered strip and two redirects, and the claims that matter — spend-once, replay, tamper, expiry, revocation, dual identity — are transaction boundaries a browser cannot exercise. Driving the full operator flow end to end needs both apps up and a real operator login, and is the natural first thing to do on the deploy.
- **Completed Task:** Stage 4 Task 4.11.


### [2026-08-21] — 🔴🔴 EIGHTEEN DAYS OF REJECTED ORDERS: The Ad Funnel Never Sent A Postcode

- **The outage:** every order submitted from `/promo/<handle>` and `/lp/<slug>` has been **refused since 2026-08-03**, writing nothing. `b5f9ded` made `kodepos` required at `/api/public/order` that day and patched **only** `checkout.astro`; `OrderFunnel.astro` kept posting `address: {alamat, kota, provinsi}`. These are the pages paid traffic lands on.
- **Measured, not reasoned:** `postcodeError(undefined)` → **"Kode pos wajib diisi."**, and `route.ts:362` collects it into `errs` where the first non-null becomes `bad(...)` — a 400 before any write. Confirmed by reading the funnel's own payload (`grep` over its submit block: `alamat`, `kota`, `provinsi`, and nothing else) and by running the validator on the exact value the funnel sends.
- **Worse than a refusal — a SILENT one.** The funnel's `showErr` targets `[data-err="<field>"]`, and no such element existed for `kodepos`. So the shopper filled the whole form, pressed the button, and **nothing happened, with no message anywhere**. Found by a parallel audit agent, which correctly left it alone as another territory's browser-visible change.
- **Files Created / Modified:**
  - `apps/storefront/src/components/OrderFunnel.astro`: a **Kode pos** field — `required`, **always editable**, with its own error slot; auto-filled ONLY when the district resolves to exactly one postcode (several → the shopper picks, none → the shopper types, and the hint says which); a stale-response guard so a district the shopper has left cannot leave its postcode behind; validation before submit (presence + 5 digits, our sentence, not the browser's); and the value actually included in the posted `address`.
  - ⚠️ **Never `readOnly`.** A readonly input is barred from constraint validation — `willValidate` is false and `valueMissing` never fires — so locking it once auto-filled would silently cancel `required`. That trap is already recorded for the cart checkout; it is written into this component too.
  - `apps/storefront/src/lib/order-forms-post-kodepos.test.ts` (new): the guard for the CLASS. `checkout-kodepos.test.ts` beside it guards `checkout.astro` **by name** — which is exactly the blind spot that cost eighteen days. This one **derives** the forms: any storefront source that names the order API and builds an `address` object is one, so a form added tomorrow is covered the day it is written.
- **Verification Executed:**
  - ⚠️ **The guard failed three times before it was right, and each failure was the guard being wrong, not the code.** (1) It sliced from the FIRST `address :` in `checkout.astro`, which is a TYPE declaration hundreds of lines above the payload — reporting a correct file as broken. (2) It matched `data-err="kodepos"` literally, while the scanner joins tokens with single spaces (`data - err = "kodepos"`) — the whitespace-tolerance rule `test/source-code.ts` states and the draft ignored. (3) It demanded a STATIC error slot from both files, while `checkout.astro` creates one **dynamically** from the control's `name`; both mechanisms are legitimate and the guard now accepts either. **A guard that fails correct code gets weakened by the next person in a hurry** — so it was fixed rather than loosened.
  - Self-proved: with the payload's `kodepos` stripped, the address assertion goes red.
  - `TEST_DB_REQUIRED=1 npm test` → **111 files and 844 tests passed**; `astro check` storefront **120 files, 0 errors**, landing **29 files, 0 errors**.
  - ⚠️ **Not clicked in a browser, and this is browser-visible** — the field, the cascade fill and the submit path all deserve a real click. Named rather than implied.
  - ⚠️ **HELD LOCAL, not pushed.** The owner asked for remaining work to be built locally first.
- **Completed Task:** none numbered — a production outage found by audit.

### [2026-08-21] — One Menu Handle Per Store, As A Rule Rather Than A Protocol (migration 0099)

- **Scope:** Task 4.7 (#298) closed the duplicate-handle race by allocating under `pg_advisory_xact_lock(4707, hashtext(store_id))`, and deliberately shipped **without** a schema change — the migration on the abandoned branch was out of scope, not idempotent, and would have left a gap in the journal. That debt was recorded rather than forgotten; this closes it.
- **Why the lock was not enough:** it protects exactly ONE code path. A data import, a fixture, or a future action that forgets it collides silently — and a duplicate handle is not cosmetic: the storefront resolves a menu BY handle, so the second row is a menu nobody can reach and a merchant who cannot tell which one they are editing. A lock is a protocol; an index is a rule.
- ⚠️ **MEASURED BEFORE WRITING THE MIGRATION, because a TOTAL unique index refuses to build on existing duplicates and would abort the whole pending batch on deploy.** `select store_id, handle, count(*) … having count(*) > 1` returned **zero groups on the shared dev database AND on production** (2 menu rows there). The note is in the migration itself, with the instruction that a drifted database is fixed by renaming the losers, never by weakening the index.
- **Files Created / Modified:**
  - `packages/db/drizzle/0099_menus_store_handle_unique.sql` + journal entry (idx **99**, contiguous — `doc-counts` asserts `head === entries − 1`, so a reserved gap would leave that guard permanently red).
  - `packages/db/src/schema.ts`: the index declared in drizzle, so the census classifies it `drizzle` rather than `sql-only`. Total, not partial — `handle` is NOT NULL here, so there is no null case to exempt.
  - `packages/db/src/menus-unique-handle.test.ts` (new): the constraint fires, and the scope is per STORE — the half a plain `unique(handle)` gets wrong, since every shop wants a menu called "utama" and the first one to create it must not own the word.
  - `packages/db/src/schema-indexes.test.ts`, `AGENTS.md`, `specs/docs/{SCHEMA,CODE_MAP,STATUS}.md`: census entry and the published counts, 99 → **100**, head → **0099**.
- **Verification Executed:**
  - **Mutation proof:** the index dropped from `tokophi_test` → the duplicate insert **succeeds** and the test fails with *"promise resolved instead of rejecting"*. Re-created → 2/2 green, and `pg_indexes` confirmed back to 1.
  - `TEST_DB_REQUIRED=1 npm test` → **109 files and 834 tests passed**. `tsc --noEmit -p apps/admin` → **0**. `npm run lint -w @tokophi/admin` → **0 errors, 21 warnings** (the true baseline, restored in #300).
  - ⚠️ **Not applied to the shared dev database** — it reaches there on merge, like every other migration.
- **Completed Task:** the `UNIQUE (store_id, handle)` debt recorded when Task 4.7 landed.

### [2026-08-21] — Correction: The Two New Admin Lint Warnings Were Mine, Not Another Stream's

- ⚠️ **THIS CORRECTS THE TASK 4.8 ENTRY BELOW AND ITS COMMIT MESSAGE.** Both recorded that the admin lint baseline had moved 21 → 23 warnings because of `apps/admin/app/api/cron/order-expiry/route.test.ts`, "another stream's file, already on main". That attribution was wrong. The two warnings are unused `afterAll` / `beforeAll` imports in **`apps/admin/lib/actions/shipment-payment-guard.test.ts` — a file I wrote in #293** and then rewrote into a source guard, leaving the imports behind. Removing them takes the baseline back to **21**, which is the measurement that settles it.
- **How the mistake was made, since it is a repeatable one:** the lint output was searched for the *shape* of a new warning and the first file matching it was named, without checking whether that file was in my own diff. `git diff --name-only origin/main` would have answered in one command. Naming the wrong owner is worse than naming none: it hands somebody else a defect they did not create and closes the question for the next reader.
- **It was found by a parallel agent** gating Task 4.11, which reported the baseline as 23 and named the real file. Two independent measurements disagreeing is exactly what the second one is for.
- **Files Created / Modified:** `apps/admin/lib/actions/shipment-payment-guard.test.ts` — two unused imports removed.
- **Verification Executed:** `npm run lint -w @tokophi/admin` → **0 errors, 21 warnings** (from 23). The guard's own suite → **3 passed**, so nothing it asserts depended on those imports.
- **Completed Task:** none — a correction.

### [2026-08-21] — Stage 4 Task 4.8: One Checkout Session Buys At Most Once, And The Database Says So

- **Scope:** `/api/public/order` already refused a resubmitted checkout — with a **preflight read** (`checkout_sessions.recovered_order_id` joined to `orders`) taken *before* the write transaction opens. Two submissions racing both read "no order yet", both pass, and both write. A read is advisory; only a constraint is a rule.
- **The defect, demonstrated rather than argued:** with the claim removed, two concurrent `POST`s through the real handler produced **two orders** — `PHI-298131807P8V` and `PHI-298131828UVF` — for one checkout. The shopper is billed twice and the stock is decremented twice. That is not a theoretical race: a double tap, a retried request, or a connection the browser retries on the shopper's behalf all produce it.
- **Files Created / Modified:**
  - `packages/db/drizzle/0097_orders_checkout_session.sql` (new) + journal entry: `orders.checkout_session_id` (TEXT — the storefront's `checkout_sessions.session_id` string, not that row's uuid) and **`orders_one_per_checkout_session`**, a PARTIAL unique index on `(store_id, checkout_session_id)`. Partial on purpose: the column is NULL for every order that did not come from a session, and NULLs must not collide. Idempotent (`add column if not exists`, `create unique index if not exists`).
  - `packages/db/src/schema.ts`: the column declared beside the 0042 address snapshot.
  - `apps/admin/app/api/public/order/route.ts`: the claim written **inside** the order transaction, plus a conflict replay — on `23505` for that index **and no other**, the whole transaction has rolled back (no order, no line items, no inventory decrement, no voucher redemption) and the loser is handed the **winner's** order number. That is what makes the response identity stable: both callers read the same order back, and a retry after a process restart resolves to it instead of creating a second one. `isUniqueViolation()` walks the `cause` chain and requires the constraint NAME — matching on `23505` alone would dress a genuine bug (`orders.number`, the ledger's partial indexes) up as a duplicate checkout.
  - `apps/admin/app/api/public/order/route.test.ts`: two suites — concurrent submission (one order, one decrement, one identity, exactly one `order_already_created`) and a later replay.
  - `AGENTS.md`, `specs/docs/{SCHEMA,CODE_MAP,STATUS}.md`: migration count 97 → **98**, head → **0097**.
  - `packages/db/src/schema-indexes.test.ts`: the new index classified `sql-only`, with the reason — drizzle's schema builder cannot express a PARTIAL unique index, and declaring it there would produce a different, TOTAL index that would reject every second session-less order.
- **Verification Executed:**
  - **Mutation proof first:** with `checkoutSessionId` removed from the insert, the concurrency test fails with both order numbers printed. Restored → 6/6.
  - ⚠️ **Two of this repo's own guards caught this change and were right to.** `doc-counts` demanded the four documents publish the new numbers; `schema-indexes` refused an unclassified index. Both were strengthened in #279 for exactly this, and both did their job on the first change that came after.
  - ⚠️ **`date +%s%3N` returns NANOSECONDS on this machine** (19 digits, measured again here) — the trap #279/#31 exist for. The stamp was computed in Python and asserted to be 13 digits and strictly greater than main's newest (`1787135123807`), then `verify-migrations` re-checked the whole journal.
  - `TEST_DB_REQUIRED=1 npm test` → **105 files and 802 tests passed**. `tsc --noEmit -p apps/admin` → **0**. `npm run lint -w @tokophi/admin` → **0 errors** (23 warnings — the baseline moved 21 → 23 from `api/cron/order-expiry/route.test.ts`, another stream's file, already on main).
  - ⚠️ **The migration has NOT been applied to the shared dev database**, per this file's own rule about not migrating an unmerged branch into the shared container. It was exercised against the derived `_test` database by the suite.
  - ⚠️ **Not clicked in a browser.** The path is a public API driven by the storefront; the handler itself is exercised end to end above.
- **Completed Task:** Stage 4 Task 4.8.
||||||| 0d6f1d1
### [2026-08-21] — Stage 4 Task 4.7 Persisted Navigation Menu Creation

- **Scope:** "Buat menu" now writes. The menu row and its whole initial item tree land in ONE tenant transaction, the action returns a typed accepted/rejected result, and the dialog closes only after the commit.
- **The defect, demonstrated rather than argued:** `handleCreateMenu` pushed a row into React state, picked a handle by scanning the browser's own list, and closed the dialog. **Nothing was ever sent to the server.** The menu looked created, could be selected and filled with items, and disappeared on the next load — and "Simpan menu" on it silently no-opped, because `saveMenu` looked the handle up, found nothing, and `return`ed while the screen said *"Menu disimpan"*.
- **Files Created / Modified:**
  - `apps/admin/lib/actions/menus.ts`: new `createMenu` (validate → one `withTenant` transaction → allocate handle → insert menu → insert the item tree recursively with `parent_id` + `position` → `revalidatePath` only after it commits). `saveMenu` takes one object, keeps the rename, and returns `{ ok: false, code: "not_found" }` where it used to return silently. Unexpected failures are `console.error`'d before the merchant sentence is returned — "Coba lagi" with no trace anywhere is a defect nobody can diagnose.
  - `apps/admin/app/(admin)/navigasi/navigasi-client.tsx`: both call sites READ the result (the two-file rule for a throwing action converted to `{ ok, error }`). Create keeps the dialog open on rejection with an inline `role="alert"` and the typed text, blocks a second submit while one is in flight, and takes the handle the SERVER allocated. "Buat menu" is disabled without `content:write`, like "Simpan menu" beside it.
  - `apps/admin/lib/actions/menus.test.ts` (new): five suites against real PostgreSQL under `SET LOCAL ROLE tokophi_app`.
- 🔴 **THE HANDLE IS ALLOCATED UNDER `pg_advisory_xact_lock(4707, hashtext(store_id))`.** Reading the taken handles and then inserting is check-then-insert: two transactions that read before either commits both pick the same string. Measured on real PostgreSQL with the lock removed — two concurrent creates of one title, the parent INSERT held 250 ms by a trigger — **both committed and the store was left with two menus on one handle**, after which `saveMenu`'s `limit(1)` edits an arbitrary one of them and the storefront's `main-menu` lookup is a coin toss. With the lock: `x…x` and `x…x-2`, one row each. Transaction-scoped, so COMMIT/ROLLBACK releases it with nothing to clean up; measured executable under `tokophi_app`; it serialises menu CREATION for one store and nothing else.
- ⚠️ **This deliberately does NOT add a `UNIQUE (store_id, handle)` migration**, which is where the earlier attempt at this task went. Task 4.7's own spec names three target files and no migration; 0097 was already allocated to Task 4.8 while this branch was open, and this repo refuses a gap in the sequence twice over — **measured**: `verify-migrations` fails with *"idx melompat: entri ke-97 bertag '0098_…' ber-idx 98"*, and `doc-counts.test.ts` fails 10 assertions because it derives `head === entries − 1`. A DB constraint is still the stronger invariant and is worth doing — on a contiguous number, as its own change, with the four published migration counts updated in the same commit.
- **Verification Executed:**
  - **Mutation proofs first — each claim proved RED before it was trusted:** remove the advisory lock ⇒ *"expected 1 to be 2"* (both creates commit one handle). Move the item inserts into a SECOND transaction ⇒ *"expected [ {…} ] to deeply equal []"* (the orphan menu row survives the injected child failure). Restore `saveMenu`'s silent `return` for an unknown handle ⇒ *"expected { ok: true } to deeply equal { ok: false, code: 'not_found' … }"*. Raise the depth cap to 3 ⇒ the third level is accepted. ⚠️ **One mutation stayed GREEN and is recorded because it is instructive**: swallowing the child-insert error with a `try/catch` *inside* the same transaction — PostgreSQL has already aborted the transaction, so the COMMIT rolls back anyway. That test pins the transaction BOUNDARY, not the absence of a `catch`.
  - `TEST_DB_REQUIRED=1 npm test` → `vitest run` **106 files and 805 tests passed**, `check:storefront` **0 errors (119 files)**. ⚠️ `check:landing` fails, and it fails the same way on **clean `main` in the main checkout** (measured): `Cannot find module '@astrojs/react'` — the package is declared in `apps/landing/package.json` and is not installed anywhere on this machine. Pre-existing, unrelated, and it is what makes `npm test` exit non-zero here.
  - `tsc --noEmit -p apps/admin` → **0 errors**.
  - `npm run lint -w @tokophi/admin` → **0 errors, 23 warnings**, and `eslint` over the three files this task touches → **0 problems**. The 23 are pre-existing (`no-img-element`, unused imports in `flash.ts` / `landing.ts`); none is in a file named here.
  - `npm run verify-migrations -w @tokophi/db` → green (this branch adds no migration).
- **Not done here:** no browser pass. `next build` cannot run from a git worktree on this machine — `apps/admin/node_modules` exists only in the main checkout, so Turbopack cannot resolve `next` from the app directory and fails before compiling anything. The runnable proof is the PostgreSQL suite; the client half is a small typed-result change with both call sites in one file.
- ⚠️ **Shared-database honesty:** while the abandoned migration existed, one `vitest` run migrated `tokophi_test` to it — creating `menus_store_handle_unique` and recording stamp `1787298511957`, **above** Task 4.8's `1787297930663`, which would have caused that branch's 0097 to be skipped there. Both were removed the moment they were noticed (`drop index` + `delete from drizzle.__drizzle_migrations`), confirmed by re-reading `pg_indexes` and `max(created_at)` → back to `1787297930663`. The shared **dev** database (`tokophi`) was never migrated and was only read from.
- **Completed Task:** Stage 4 Task 4.7.

### [2026-08-20] — CI Executed By Hand For The First Time: The Workflow Was Red By Construction, And The Seed Step Was A No-Op

- **Why by hand:** GitHub Actions has not run a single job since the account's billing failed. Every run since then completes in 3–4 s with the annotation *"The job was not started because recent account payments have failed or your spending limit needs to be increased."* Verified again 2026-08-20 on run `32330156109`. **That half is an owner action — Settings → Billing & plans — and nothing in this repository can substitute for it.** What CAN be done is the other half of the task: `#277` wired seven steps into this workflow that have **never once executed**.
- **So the workflow was executed step for step**, against a purpose-built throwaway database (`tokophi_ci28`, so `tokophi_ci28_test` is derived and created fresh exactly as the runner's service container would be), on the repo's own Node 24. Both databases dropped afterwards; the shared dev database was never touched.
- 🔴 **THE SEED STEP DOES NOTHING, AND EXITS 0 WHILE DOING IT.** `npm test` (the step above it) does not only migrate `tokophi_test` — several suites INSERT accounts, stores and orders through the owner connection and never roll them back. So by the time the seed runs the database is not empty, and `seed.ts` answers *"DB already has data — skipping seed"* and **exits 0**. Nothing is seeded, `store_domains` stays empty, and four steps later the storefront suite dies with *"The storefront never served a 200 for Host toko-demo.test … If that host resolves to no store, no check below could have meant anything."* **The step added in #277 to make `check-hero-srcset` green was itself a no-op — CI could not have gone green on any commit, ever.** Measured, not inferred: `select host from store_domains` returned zero rows after the step reported success.
- **Files Created / Modified:** `.github/workflows/ci.yml` — `SEED_FORCE: "1"` + `SEED_DESTROY_CONFIG: "1"` on the seed step, with the reasoning inline. ⚠️ The second variable belongs **only** here: it exists to stop somebody truncating config-bearing rows out of a SHARED database (AGENTS.md), and on a runner the database is an ephemeral service container that dies with the job. **Never copy that pair into anything that can reach the shared dev database or production.**
- **Verification Executed — the fixed order, run end to end:**

  | # | step | result |
  |---|---|---|
  | 1 | `npm ci` | 0 |
  | 2 | `verify-migrations` | 0 |
  | 3 | `npm test` | 0 — **105 files, 800 tests** |
  | 4 | seed (**forced**) | 0 — `store_domains` now carries `toko-demo.test` |
  | 5 | `seed:templates` | 0 |
  | 6 | `playwright install chromium` | 0 |
  | 7 | storefront verify | **0 — 5 PASS + 1 documented SKIP** (was: fatal) |
  | 8 | `verify-rls` | 0 — 52/53, one known exception |
  | 9 | `verify-rls-app` | 0 |
  | 10 | `tsc apps/admin` | 0 |
  | 11 | `tsc apps/super-admin` | 0 |

  ⚠️ **One deliberate deviation:** `playwright install` was run **without** `--with-deps` (that half needs `sudo`, which this machine's approval gate reserves). The four browser checks all passed regardless, so chromium's shared libraries are present here; on a bare runner image `--with-deps` remains correct and is left in the workflow.
  ⚠️ **This proof is local.** It says the workflow's STEPS are correct and green on this commit; it cannot say the runner image behaves identically. The first real run after billing is restored is still the one that settles that.
- **Completed Task:** the provable half of #28. **The billing itself remains open and is the owner's.**

### [2026-08-20] — N40 Phase 2: Booking Migrated to KiriminAja v6.2, Verified With ONE Authorised Sandbox Booking

- **Scope:** `kaCreateOrder` books on `/api/mitra/v6.2/request_pickup` now. The contract investigation (`specs/docs/tasks/2026-08-12-n40-v62-contract.md`) had mapped the REQUEST field by field against the sandbox's own Go struct and concluded "safe to migrate — one line", but deliberately left the SUCCESS response unproven, because proving it means creating a booking. **Owner authorised exactly one, 2026-08-20.**
- **The booking, and what it returned:** `ok: true`, `kj_order_id 5758-N2975e1537124`, `pickup_number EPR-1550265486`. Booked through `createShipment` — the real seller path, not the library in isolation — so the order row was written and the poller/cancel paths remain drivable.
- 🔴 **THE ONE BOOKING PAID FOR ITSELF: v6.2 answers `awb: ""`, where v6.1 answered `awb: null`.** `awb: d?.awb ?? undefined` passes an empty string straight through, so the migration would have started writing `""` into a column that had always been NULL. Nothing crashes — every reader tests truthiness — but the row would claim a waybill it does not have, `(awb is not null)` sorts it to the **back** of the tracking poller's queue (it orders un-waybilled parcels first), and any future `is not null` check would read it as issued. Normalised away. **This is exactly the class of difference no amount of doc-reading finds.**
- **Files Created / Modified:**
  - `packages/lib/src/kiriminaja.ts`: the path; `drop: false` sent explicitly (it binds as `bool` in the v6.2 struct and its default is **still** undocumented — every booking this product makes is a pickup and the "Resi terbit" flow assumes it); the empty-string `awb` normalised. `package_type_id` **stays 7** — the doc offers 9 for "regular packages" and its example sends it, but the semantics are undocumented and cannot be probed without another booking.
  - `packages/lib/src/kiriminaja-v62.test.ts` (new): the measured success body as a permanent fixture, driven through `kaCreateOrder` with `fetch` stubbed — so nobody has to book again to keep this honest. Covers the path, `drop`, the absence of `add_cost`, `package_type_id: 7`, the empty-string `awb`, a real waybill still coming through, and a v6.2-shaped HTTP-400 refusal.
  - `specs/docs/KIRIMINAJA.md`: the endpoint row flipped; the open question *"does v6.2 want `destination_province_id` or `destination_provinsi_id`"* **answered — neither, v6.1's names ARE the v6.2 names**; `package_type_id: 9` added as a new open question; both measured v6.2 behaviour differences recorded (HTTP 400 on errors — **do not add a status check** — and the empty-string `awb`).
- **Verification Executed:**
  - **Three mutations, three distinct failures:** reverting the path to v6.1, deleting `drop: false`, and restoring `?? undefined` each break their own test. Restored → 6/6.
  - `TEST_DB_REQUIRED=1 npm test` → **105 files and 800 tests passed**. `tsc --noEmit -p apps/admin/tsconfig.json` → **0**. `npm run lint -w @tokophi/admin` → **0 errors**.
  - ⚠️ **The verification harness is NOT committed.** It books for real; a file that does that must not sit in the suite where a `npm test` would fire it. The measured response is committed as a fixture instead.
  - ⚠️ **The first two attempts at this booking never reached KiriminAja** — they were refused by `createShipment`'s own payment guard. That was not the fixture: it was a production defect (drizzle rendering an interpolated column unqualified), recorded in its own entry above and fixed first.
- **Completed Task:** N40 phase 2.

### [2026-08-20] — 🔴🔴 THE REAL CAUSE: Drizzle Interpolates a Column UNQUALIFIED, So Eight Correlated Subqueries Compared a Table to Itself

- ⚠️ **THIS ENTRY CORRECTS THE ONE BELOW IT.** The previous pass attributed the refused booking to two unaliased `exists()` expressions sharing the column name `exists`. That collision is real and the aliases are still right — **but it was not the cause, and the fix did not fix it.** The booking was still refused afterwards. The mistake was declaring a cause without measuring the FIXED state: aliasing was proved to differ from raw SQL, and "therefore aliasing is the cause" was inferred rather than tested. A single **aliased** expression through drizzle still read `false`.
- **The actual defect, from `.toSQL()`:** drizzle renders an interpolated column inside a `sql` template **UNQUALIFIED**. `sql\`… where p.order_id = ${schema.orders.id}\`` emits `p.order_id = "id"`, not `p.order_id = "orders"."id"`. In a plain WHERE that is harmless — the outer table is the only scope. Inside a **correlated subquery it is not**, because the INNER scope wins and the inner table usually has a column of that name. So `p.order_id = p.id`: true for no row that has ever existed. Measured on real Postgres, same row and same transaction: unqualified `false`, `"orders"."id"` `true`.
- **Eight sites, three files, four distinct shipped consequences** — the guard below found the last one, in a file nobody had looked at:
  - `apps/admin/lib/actions/shipping.ts` (5): `isCod` and `hasSuccessfulPayment` read FALSE for every order, so `createShipment` refused a genuinely paid order with *"Pembayaran belum berhasil"*; `cancellationPending` likewise never fired.
  - `apps/admin/lib/data/order-detail.ts` (2): the line-item image subquery bound `m.product_id = m.id`, so **every line item on the order detail rendered with no image** (measured: a product that genuinely has media returned `null`); and the service-name lookup bound `pc.courier = pc.courier`, returning the **first courier's** service name instead of the order's.
  - `apps/admin/lib/data/checkout.ts` (1): `not exists (… f.phone = "phone" …)` compared `followups` to itself, so the "abandoned, not yet contacted" count collapsed to zero for the whole store the moment ANY 'keranjang' follow-up had ever been sent.
- **Files Created / Modified:** the eight sites qualified by name (`"orders"."id"`, `"products"."id"`, `"orders"."courier"`, `"checkout_sessions"."phone"`), plus `packages/db/src/correlated-subquery-scoping.test.ts` (new) — a repo-wide guard for the CLASS: **a `sql` template that carries its own FROM must not interpolate a schema column.** Blunt and derived rather than a list of eight; a template with no FROM of its own (`now() >= ${schema.flashSales.startsAt}`) is unaffected and stays legal, which the guard also asserts so it cannot be "satisfied" by deleting working code.
- ⚠️ **A backtick inside an SQL comment closes the template literal.** Two of these comments were written with `\\`id\\`` in them and broke the parse — the same family as the `*/`-inside-a-block-comment trap this repo already records. `tsc` caught it; nothing else would have.
- **Verification Executed:**
  - **The guard found the 8th site**, in `checkout.ts`, which no manual reading had reached — which is the argument for deriving the rule instead of enumerating the sites.
  - Self-proved in both directions: red on the shipped shape, green on the legitimate one.
  - **End-to-end, the decisive one:** with these fixes the N40 verification booking got past both guards and **reached KiriminAja**, which answered a real v6.2 validation error (`order_id maksimal 20 karakter`). Before them it never left the process.
  - `TEST_DB_REQUIRED=1 npm test` → **104 files and 794 tests passed**. `tsc --noEmit -p apps/admin/tsconfig.json` → **0**. `npm run lint -w @tokophi/admin` → **0 errors**.
- **Completed Task:** none numbered — a production outage of "Atur pengiriman" found while verifying N40.

### [2026-08-20] — 🔴 Two Unaliased `exists()` Expressions Were One Column — Prepaid Orders Refused a Waybill

- **How it was found:** not by a review. While building N40's authorised v6.2 verification booking, `createShipment` refused a fixture whose payment had genuinely succeeded: *"Pembayaran belum berhasil. Pengiriman tidak jadi direservasi."* The fixture was correct, so the guard was not.
- **The defect:** Postgres names an unaliased `exists (…)` expression **`exists`**. Two of them in one target list therefore come back as **one** column, and the second value is lost. `apps/admin/lib/actions/shipping.ts` had exactly that shape **twice** — `isCod` (first) and `hasSuccessfulPayment` (second) — and **two guards key off the second one** (the pre-flight at the data read, and the one inside the surcharge reservation). Measured on real Postgres, one prepaid order (`payments.method='transfer'`, `status='berhasil'`): the reservation's own query read `hasSuccessfulPayment: false`, while an **aliased** raw-SQL query over the identical row in the identical tenant transaction read `true`. Isolated further: `select exists(…), exists(…)` returns a single key, `["exists"]`. `isCod` read correctly throughout, which is exactly what made this survivable and invisible — the loss lands entirely on the SECOND expression. Introduced by `535eba9` (2026-08-12).
- **Files Created / Modified:**
  - `apps/admin/lib/actions/shipping.ts`: `.as("is_cod")` / `.as("has_successful_payment")` on both pairs. The third site, `cancellationPending`, is **alone in its target list and therefore correct today** — aliased anyway, because "correct until somebody adds a second one" is precisely what the two broken pairs were. Patch the class, not the instance.
  - `apps/admin/lib/actions/shipment-payment-guard.test.ts` (new): the Postgres premise measured rather than remembered (`select exists(…), exists(…)` → one key), plus a source guard requiring every `sql<…>\`exists (…)\`` field in that file to carry `.as(`, plus its self-proof.
- **Verification Executed:**
  - ⚠️ **THE FIRST TEST WAS GREEN FOR THE WRONG REASON, AND THAT IS WHY THE GUARD HAS THE SHAPE IT HAS.** The obvious end-to-end test — book a paid order, assert it is not refused for non-payment — passed **with both aliases deleted**. The refusing guard sits *after* a live KiriminAja rate call and an exact re-price, so a fixture short of a pickup address, a destination district, weighed line items and a rate matching to the rupiah is rejected earlier and never reaches it. The assertion matched nothing and reported success. Caught by mutating before trusting; the durable claim is the source guard, which **is** proved red.
  - **The source guard immediately found a THIRD unaliased site** the manual reading had passed over — which is the argument for deriving the rule instead of listing the sites.
  - `TEST_DB_REQUIRED=1 npm test` → **103 files and 791 tests passed**. `tsc --noEmit -p apps/admin/tsconfig.json` → **0**. `npm run lint -w @tokophi/admin` → **0 errors**.
  - ⚠️ **The end-to-end reproduction was done by hand, once, and is not committed** — it needs a live rate call, which would make the suite depend on a vendor sandbox. What is committed is the premise and the shape.
- **Completed Task:** none numbered — a production defect found in passing, fixed ahead of N40 because it blocked the verification.

### [2026-08-20] — Screening Finding J: The AutoLaris "Aktif" Badge Removed (Owner Ruling)

- **Scope:** `platform_payment_gateways.enabled` is written by `saveGateways` and read by **nothing on any payment path** — `/api/public/order` and `lib/actions/payments.ts` gate on `autolarisConfigured()` (the env key) ∧ `platform_payment_channels.enabled`. Its one consumer was an "Aktif" badge on the super-admin settings screen, driven by `autoGateway?.on`. **Owner ruling, 2026-08-20: remove the badge.** The column stays — dropping one is a destructive migration, the same standing as `store_settings.payment_channels`.
- **Why the badge was worse than nothing:** it could read **green over a PSP that cannot take a single rupiah** (env key missing, every channel disabled) and could go dark while payments kept flowing. And there is no `Switch` for `autolaris` anywhere on that screen — the flag can only ever be whatever the seed wrote — so it was a status light wired to nothing, sitting in a control plane whose whole job is to tell an operator what is really on.
- **Files Created / Modified:**
  - `apps/super-admin/app/(platform)/pengaturan/pengaturan-client.tsx`: badge gone. The **channel counter beside it is the enforced fact and stays** — removing a false signal must not quietly remove the true one next to it. A comment records what a real kill-switch would require.
  - `apps/super-admin/lib/data.ts`, `apps/super-admin/lib/actions.ts`: both sides of the column now say it is unenforced, so the next reader does not rebuild a light on it. `saveGateways`' `cod` branch is called out as the one that IS enforced, since the two sit in the same loop.
  - `apps/super-admin/lib/actions.ts` (adjacent defect, fixed while there): the provider cast was a hand-copied union `"midtrans" | "xendit" | "duitku"` that **omitted `autolaris`** — the only provider this screen renders — so the cast was silencing `tsc` over the one value that actually reaches it. Derived from `schema.gatewayProvider.enumValues` now.
  - `AGENTS.md`: the ruling recorded beside the payment-channel rules, with the condition a future kill-switch would have to meet.
  - `apps/super-admin/lib/gateway-enabled-is-not-a-gate.test.ts` (new): a source guard, because the claim is about the ABSENCE of markup — nothing to import and call, and no type checker has an opinion about a badge that is gone. Read as **CODE**, so the long comment the screen now carries (which names `autoGateway?.on` in prose) cannot keep it green.
- **Verification Executed:**
  - **Mutation proof:** putting the badge back fails *"the settings screen renders nothing off autoGateway.on"*. Restored → 3/3 green.
  - `TEST_DB_REQUIRED=1 npm test` → **102 files and 788 tests passed**. `tsc --noEmit -p apps/super-admin/tsconfig.json` → **0**. `npm run lint -w @tokophi/super-admin` → **0 errors**.
  - ⚠️ **Not clicked in a browser** — the change removes markup and the guard reads the file; named rather than implied.
- **Completed Task:** Screening finding J (owner-decided). **The screening sweep is now closed: all ten findings (A–J) are resolved.**

### [2026-08-20] — Screening Finding B: The Manual Invoice Flip Is Bookkeeping (Owner Ruling)

- **Scope:** `setInvoiceStatus` marks an invoice `dibayar` / `menunggu` / `gagal` and writes nothing else — it is not one of the three writers of `stores.current_period_end` (`api/public/pay/callback`, `compStore`, `extendTrial`). **Owner ruling, 2026-08-20: that is the intended scope.** A manual flip is a ledger correction; entitlement moves on payment events only. The alternative — running the callback's code path — was considered and rejected.
- **The defect was the BELIEF, not the behaviour.** The action's own comment asserted that an operator flipping an invoice to `dibayar` by hand *"extends a store's paid period without a payment"*, which is simply false. So the wrong idea was in the code, in the `platform_activity` line and on the operator's screen at once. The path that costs money: a webhook fails, the merchant has really transferred, the operator flips the invoice, MRR and "Gagal bayar" both move, the audit log says paid — and the merchant's panel stays read-only. The operator's next move is "Gratiskan 1 bulan", which files a **giveaway** for a month that was actually paid for, corrupting the very books this flip was meant to correct.
- **Files Created / Modified:**
  - `apps/super-admin/lib/actions.ts`: the false comment replaced by the ruling and its reasoning, including why the reverse direction is deliberately asymmetric (walking a paid invoice back to `gagal` does not claw back a granted period). Also fixed a same-class defect found while in there: the UPDATE was blind, so an invoice number matching nothing returned `ok` **and wrote an audit line for it**. `.returning()` now decides, and a miss is `{ ok: false, error: "Faktur tidak ditemukan." }` — the caller already read `refused()`. The audit line itself now names its scope.
  - `apps/super-admin/app/(platform)/paket/paket-client.tsx`: the limit is stated on **both** sides of the click — in the row menu before it, and in the toast after it, which for the paid direction also names "Gratiskan 1 bulan" as the thing that *does* grant time. A limit with no next step is a dead end, and the operator's actual goal was to unlock the merchant.
  - `AGENTS.md`: the ruling recorded beside the suspension/comp rules it sits next to, so the next reader does not file it as a bug a third time.
  - `apps/super-admin/lib/invoice-flip-is-bookkeeping.test.ts` (new): a source guard, for the same reason `add-store-user.test.ts` is one — `actions.ts` is `"use server"` and imports `@tokophi/db` at module scope, so it cannot be imported. It uses **both** readers deliberately, one per claim: `codeOnly` for "this action never touches `currentPeriodEnd`" (string contents inert, so prose mentioning the column cannot satisfy it) and `textWithoutComments` for the copy claims, whose evidence lives inside string literals and which `codeOnly` would erase.
- **Verification Executed:**
  - **Three mutations, three distinct failures** — each claim family proved red on its own: grafting the extension back in fails *"never writes the store's subscription period"*; restoring the old limitless toast fails *"the toast says it AFTER, in both directions"* **and** *"names what DOES grant time"*; removing the existence check fails *"refuses an invoice number that matched nothing"*. Restored → 7/7 green.
  - `TEST_DB_REQUIRED=1 npm test` → **101 files and 785 tests passed**. `tsc --noEmit -p apps/super-admin/tsconfig.json` → **0**. `npm run lint -w @tokophi/super-admin` → **0 errors**.
  - ⚠️ **Not clicked in a browser.** The change is copy plus one existence guard; the copy is pinned by the source guard above. Named rather than implied.
- **Completed Task:** Screening finding B (owner-decided, not a numbered Stage task).

### [2026-08-20] — Super Admin Lint Gate Restored (0 Errors)

- **Scope:** `npm run lint -w @tokophi/super-admin` was **RED on clean `origin/main`** — 2 `@typescript-eslint/no-explicit-any` errors, both in `app/(platform)/update-log/update-log-client.tsx` from commit `9d85023` (another stream). Found while gating the screening sweep; attribution was verified by reproducing it on the main checkout before fixing anything. **A lint gate that is red is a gate that is off** — this repo has already paid for that with `verify-rls`, which sat red for weeks while two cross-tenant leaks shipped past it.
- **Files Created / Modified:**
  - `apps/super-admin/lib/data/dev-logs.ts`: the surface union is now a named, exported `DevLogSurface` and `DevLogEntry.surfaces` uses it. It was inline here and `as any` on the screen, which is exactly the shape that stops a misspelled surface name from failing.
  - `apps/super-admin/app/(platform)/update-log/update-log-client.tsx`: `icon: any` → `ComponentType<{ className?: string }>`; `selectedSurface as any` → `as DevLogSurface`. The unused `DevLogEntry` import went with it.
- **Verification Executed:** `npm run lint -w @tokophi/super-admin` → **0 errors** (from 2), 3 warnings. `tsc --noEmit -p apps/super-admin/tsconfig.json` → **0**. `TEST_DB_REQUIRED=1 npm test` → **100 files and 778 tests passed**.
- **Completed Task:** none numbered — restores a gate, does not close a Stage task.

### [2026-08-20] — Screening Findings C/D/E/F: Four Controls That Did Nothing (One of Them Destructively)

- **Scope:** The other half of the same screening sweep: controls a merchant can operate that have no sink. Three were cosmetic-but-misleading; **one wrote the wrong data**.
- **Files Created / Modified:**
  - 🔴 **`apps/admin/app/(admin)/produk/[id]/product-editor.tsx` — "Ubah kategori" (finding E) is the real defect.** Both footer buttons were bare `DialogClose`, while picking from the dropdown had ALREADY called `setCategory(c)`. So "Batal" was a second "Simpan": a merchant who chose the wrong category, pressed Batal, then pressed the page's Simpan **persisted the wrong category** — and `category` genuinely goes through `buildInput()`, so this reached the database. The dialog now remembers the value it was opened with and restores it on any dismissal (Batal, Escape, outside click); the confirm button is relabelled **"Pakai"**, because it commits the pick locally the way every other field in this editor does and is not a second write. ⚠️ The keep-marker ref is deliberate rather than incidental: `components/theme/brand-color-dialog.tsx` uses exactly this idiom (`savedRef`) for exactly this shape, and matching working code beats reasoning about when Base UI fires `onOpenChange`.
  - `apps/admin/app/(admin)/produk/[id]/product-editor.tsx` — the "Alasan (opsional)" input on Perbarui stok (finding F) is **removed**. Its value was read by nothing: not `buildInput()`, not `updateStock` (which takes `{variantId, available, expected}`), and there is no reason column on the inventory path. A field that invites a merchant to explain a stock correction and then drops what they typed reads as an audit trail that does not exist.
  - `apps/admin/app/(admin)/produk/produk-client.tsx` — the "Impor" button (finding C) had no `onClick`, no `href` and no `disabled`; there is no import route, action or CSV parser anywhere in the repo. Now honestly disabled with a title, which is this repo's own existing convention for a feature that does not exist yet (`pembelian-client.tsx`, `segmen-client.tsx` both do it and say why).
  - `apps/admin/app/(admin)/produk/kategori/[id]/collection-editor.tsx` — the "Saluran penjualan → Toko Online" Switch (finding D) is **removed**. `buildInput()` never carried it, `collections` has no channel column, and nothing anywhere read the value, so switching it off and pressing Simpan reported success and came back ON. ⚠️ Task 5.2 names only the SIBLING file (`product-editor.tsx`, which has its own copy of this switch and stays 5.2's); this editor is the caller that a file-named task list would have missed.
- **Verification Executed:**
  - `tsc --noEmit -p apps/admin/tsconfig.json` → **0**. `npm run lint -w @tokophi/admin` → **0 errors, 21 warnings** — the same 21 as the baseline, so nothing was left dangling by the two removals.
  - `TEST_DB_REQUIRED=1 npm test` → **100 files and 778 tests passed**.
  - ⚠️ **NOT clicked in a browser, and this one is a browser-visible change** — the gap is named rather than implied. `tsc` caught two unterminated JSX comments during this pass, which is precisely the class of mistake a render would also have caught; what it cannot confirm is the dialog's dismissal path at runtime. The idiom is copied verbatim from a shipped, working dialog in the same app.
- **Completed Task:** Screening findings C, D, E, F (not numbered Stage tasks).

### [2026-08-20] — Screening Findings G/H/I: Five Writes That Reported Success Blind

- **Scope:** One class, five sites, found by the same screening sweep as finding A: an action writes without checking what it matched, returns `{ ok: true }` (or the count it was ASKED for), and the screen toasts success. RLS clamps a foreign or stale id to **zero rows with no error**, which is precisely what makes this invisible.
- **Files Created / Modified:**
  - `apps/admin/lib/actions/media.ts` + `apps/admin/app/(admin)/files/files-client.tsx`: `deleteMedia` already returned `{ ok: false }` for a row that is not there or not ours — **the caller dropped it**, six lines below an `uploadMedia` call that reads its result correctly. It now carries an `error` string (a `false` with nothing to say forces the caller to invent the sentence) and the caller reads it.
  - `apps/admin/lib/actions/products.ts` + real-Postgres test: `bulkSetProductStatus` / `bulkDeleteProducts` returned `count: ids.length` — the number the CLIENT asked for. The comment directly above them already said RLS clamps a forged id; it does, silently, and the count reported it as swept anyway. `.returning()` now supplies the number the Produk selection bar prints.
  - `apps/admin/lib/actions/support.ts` + `apps/admin/app/(admin)/bantuan/[id]/thread-client.tsx`: `closeTicket` wrote blind and always said `ok`, while `replyTicket` **in the same file** has always proved the ticket exists and returned "Tiket tidak ditemukan.". Half a file correct is how the other half survives.
  - `apps/super-admin/lib/actions.ts`: `setTicketStatus` and `setStoreUserRole` likewise. The second is the worst of the five — it logged *"Peran … diubah → role oleh platform"* to `platform_activity` **unconditionally**, so a membership already removed in another tab left a permanent record of a promotion that never happened, in the one log an operator consults to answer "who granted this?". Both callers already read `refused()`; they were only ever handed a success.
- **Verification Executed:**
  - **Mutation proof:** `apps/admin/lib/actions/products-bulk.test.ts` builds two products in our store and one in a stranger's, sweeps all three, and requires `count: 2`. With `ids.length` put back, **2 of 3** tests fail.
  - `TEST_DB_REQUIRED=1 npm test` → **100 files and 778 tests passed**. `tsc --noEmit` → **0** on admin AND super-admin. `npm run lint -w @tokophi/admin` → **0 errors**.
  - 🔴 **`npm run lint -w @tokophi/super-admin` is RED, and it is NOT this change.** 2 errors (`@typescript-eslint/no-explicit-any`), both in `apps/super-admin/app/(platform)/update-log/update-log-client.tsx`, from commit `9d85023` (another stream). Reproduced on a clean `origin/main` checkout before attributing it. Left for its owner rather than repaired sideways — but a lint gate that is red is a gate that is off, and this repo has already paid for that with `verify-rls`.
- **Completed Task:** Screening findings G, H, I (not numbered Stage tasks).

### [2026-08-20] — Screening Finding A: setOrderStatus Reports What It Wrote

- **Scope:** Found by a repo-wide screening pass for dead UI and false promises (the sweep that also produced findings B–J, recorded in the session report). `applyOrderStatusChange` has always returned `{applied, reason}` and both BACKGROUND callers — the KiriminAja tracking poller (`ka-tracking.ts:182`) and the order-expiry cron (`api/cron/order-expiry/route.ts:74`) — have always read it. The MERCHANT's path threw it away: `setOrderStatus` was `Promise<void>`, and its three screens toasted success unconditionally.
- **Why it is not cosmetic:** the state machine refuses silently — 0 rows, no throw. An order can reach a terminal state from the background between the page render and the click, which is exactly when `terminal-order` fires. The expensive one is the return dialog, which names a physical fact: *"Pesanan ditandai retur — stok dikembalikan."* over an UPDATE that moved no stock and failed no pending payment. The merchant reconciles the warehouse from that sentence. Same class as `markLabelsPrinted` returning `numbers.length`.
- **Files Created / Modified:**
  - `apps/admin/lib/order-status-refusal.ts` (new): the refusal union and the Indonesian sentence each one owes the merchant, as a `Record<OrderStatusRefusal, string>` so a new refusal fails `tsc` until somebody writes its message. PURE — no `@tokophi/db` import — because `order-status.ts` pulls the schema at module scope and all three callers are `"use client"`. Same split as `platform-rank.ts` from `platform-auth.ts`.
  - `apps/admin/lib/order-status.ts`: `OrderStatusChangeResult` is a discriminated union instead of `{ applied: boolean; reason?: string }`. A free-string reason cannot be exhausted or turned into a message, which is part of why the merchant-facing caller ignored it.
  - `apps/admin/lib/actions/orders.ts`: returns the result. `if (!order) return;` — indistinguishable from success at every call site, and RLS makes it the cross-tenant answer too — is now `{ applied: false, reason: "order-not-found" }`.
  - `apps/admin/app/(admin)/pesanan/pesanan-client.tsx`, `apps/admin/app/(admin)/pesanan/[id]/order-detail.tsx`: all three call sites branch on `applied`. The return dialog **stays open** on a refusal (closing it reads as "done") and refreshes either way — on a refusal the refresh is what corrects the stale row.
  - `apps/admin/lib/actions/orders.test.ts` (new): the four refusals and one applied transition driven through the real action against real PostgreSQL, plus a source guard over the two screens and a message-distinctness test.
- **Verification Executed:**
  - **Mutation proof:** with `order-not-found` reported as `{applied: true}` (the shipped shape), the not-found test fails. The caller guard counts bound calls against total calls — deliberately, since the detail screen has TWO call sites and only one was the expensive one, so "at least one is bound" would have passed on the bug — and it is proved red against a copy with `const res = await` reverted to `await`.
  - `TEST_DB_REQUIRED=1 npm test` → **99 files and 775 tests passed**. `tsc --noEmit -p apps/admin/tsconfig.json` → **0**. `npm run lint -w @tokophi/admin` → **0 errors** (21 pre-existing warnings).
  - ⚠️ **Not clicked in a browser.** The transitions are exercised through the real server action against real Postgres, and the screen change is a branch on the returned value covered by `tsc` plus the source guard — but this file's own rule is that money paths are EXERCISED, so the gap is named rather than implied.
- **Completed Task:** Screening finding A (not a numbered Stage task).

### [2026-08-20] — Stage 4 Task 4.10 Paid Subscription Callbacks Made Monotonic

- **Scope:** The invoice branch of `/api/public/pay/callback` accepted a late EXPIRED over a paid subscription invoice, and the ordinary out-of-order sequence paid → expired → paid extended the store's subscription a SECOND time. The extension itself was a read-modify-write outside any transaction.
- **The defect, and why the sibling branch was already right:** the PAYMENTS branch six lines above has enforced `ne(status, "berhasil")` since an earlier incident, with a comment recording it — money that has been received is not un-received by a webhook. The INVOICE branch's only guard was `ne(status, invStatus)`, which blocks a same-state replay and nothing else. So EXPIRED walked a `dibayar` invoice to `gagal` and nulled its `paid_at`; the next PAID then found a claimable row and ran the extension loop again. A VA lives 24 h, so out-of-order pairs are ordinary here, not exotic. One implementation of a rule and one copy of it: the copy was the weaker half again.
- **Files Created / Modified:**
  - `apps/admin/app/api/public/pay/callback/route.ts`: `ne(schema.invoices.status, "dibayar")` added to the invoice UPDATE's WHERE — `dibayar` is now terminal for a callback, mirroring the payments branch. The store extension moved inside `db.transaction` with `.for("update")` on the store row: two DIFFERENT invoices of one store paid at the same moment both read the same `current_period_end`, both add their months, and the second write erases the first — the merchant pays twice and is credited once.
  - ⚠️ The month arithmetic deliberately stays in `addMonths` rather than moving into SQL. Postgres' `+ interval '1 month'` CLAMPS (31 Jan + 1 = 28 Feb) where JS `setMonth` OVERFLOWS (→ 3 Mar). Both are defensible; silently swapping one for the other inside a race fix is not.
  - `apps/admin/app/api/public/pay/callback/route.test.ts` (new): the three Done-when transitions driven through the real handler against real PostgreSQL, plus a two-invoice outcome test and a source guard for the row lock.
- **Verification Executed:**
  - **Mutation proof, guard:** with `ne(status, "dibayar")` removed, **2 of 3** transition tests fail — paid → expired flips to `gagal` and paid → expired → paid extends twice. Restored, 3/3 green.
  - ⚠️ **The concurrency test does NOT prove the row lock, and that was measured rather than assumed.** Run three times against a copy with the un-transacted read-modify-write put back, it passed **3/3**: `Promise.all` does not reliably interleave two handlers at the one statement that matters. It is kept as an OUTCOME test (two invoices must buy two months) and says so in the file. The lock's actual guard is a `codeOnly()` source assertion with the repo's standard self-proof — asserted red against a copy with the transaction and `.for("update")` stripped, exactly as `public-guard.test.ts` does.
  - `TEST_DB_REQUIRED=1 npm test` → **98 files and 763 tests passed**; `astro check` clean on storefront (119 files) and landing (29 files).
  - `tsc --noEmit -p apps/admin/tsconfig.json` → **0 errors**. `npm run lint -w @tokophi/admin` → **0 errors** (21 pre-existing warnings, unchanged).
- **Completed Task:** Stage 4 Task 4.10.

### [2026-08-20] — Stage 5 Task 5.11 Green Admin Lint Baseline Restored

- **Scope:** `npm run lint -w @tokophi/admin` had regressed to **4 errors / 21 warnings**; all four errors were `react-hooks/set-state-in-effect`, none of them in the files Task 4.9 touched (measured while gating that task, recorded there rather than repaired sideways). The baseline was 0 errors on 2026-08-11 (DEL-2); the theme work landed after it.
- **The defect class, and why it is not cosmetic:** each site copied a prop into local state from inside an effect. React renders once with the stale value, runs the effect, then renders again — on the theme canvas that is one visible frame painted in the previous store's colour or font pairing. The official pattern for prop-following state is to adjust it DURING render behind a previous-value marker; React discards that render and repeats it before anything reaches the DOM.
- **Files Created / Modified:**
  - `apps/admin/app/(admin)/tema/[id]/builder-client.tsx`: both prop→state effects (brand colour, theme tokens) converted. The theme comparison is by VALUE (`font`/`tone`), not object identity, so a parent that rebuilds the object each render no longer forces a pointless adjustment.
  - `apps/admin/components/theme/brand-color-dialog.tsx`: the `initialColor` sync converted.
  - `apps/admin/components/theme/theme-tokens-dialog.tsx`: the `resolved` sync converted. ⚠️ The `onPreviewChange` effect beside it is deliberately LEFT an effect — it tells a system outside React about the latest state, which is exactly what effects are for; the rule forbids synchronous setState inside an effect, not effects.
- **Verification Executed:**
  - `npm run lint -w @tokophi/admin` → **0 errors** (21 pre-existing warnings unchanged; they are not part of this gate).
  - `tsc --noEmit -p apps/admin/tsconfig.json` → **0 errors**.
  - `TEST_DB_REQUIRED=1 npm test` on a fresh throwaway database → **97 files and 757 tests passed**.
  - **Browser, production build** (`next start`, not dev — dev does not hydrate here): logged in, opened `/store/batiknusantara/tema`, opened the brand-colour dialog (`#a85572`), closed it, reopened it and read the same value back — prop-following state still follows — then opened the Tampilan dialog. **0 console errors, 0 page errors.**
  - ⚠️ The shared dev DB's demo store was billing-suspended (`current_period_end` = `2026-08-04`), which 500s every admin page. It was extended for the run and **restored to exactly `2026-08-04 03:59:23.814+00`**, confirmed by the UPDATE's own `returning`.
- **Completed Task:** Stage 5 Task 5.11.

### [2026-08-19] — Stage 4 Task 4.9 Serialized Purchase-Order Receipt

- **Scope:** Replaced the receipt path's read-then-check with a compare-and-swap claim so two overlapping "Terima barang" requests can no longer book the same delivery onto the shelf twice.
- **The defect, demonstrated rather than argued:** `receivePurchaseOrder` read `status`, returned early if `diterima`, then added `qty - receivedQty` per line. Two overlapping transactions both read `receivedQty = 0` before either wrote, so both computed the full `add`; the inventory UPDATE is relative (`available + add`), so the second was not lost — it was APPLIED. Measured on real PostgreSQL with the pre-fix code: a 10-unit delivery received concurrently left `available = 20`.
- **Files Created / Modified:**
  - `apps/admin/lib/actions/purchases.ts`: `receivePurchaseOrder` now claims the row with `UPDATE … WHERE status <> 'diterima' RETURNING id` as its first statement — the loser blocks, re-evaluates the predicate after the winner commits, matches zero rows and writes nothing. The claim doubles as the RLS-verified parent read the CHILD-TABLE RULE requires before touching `purchase_order_items` / `inventory_levels` (neither carries `store_id`). The trailing status write is gone: the claim already performed it inside the same transaction.
  - `apps/admin/lib/actions/purchases.ts` (comment correction): `unreceivePurchaseOrder`'s note asserted the receive path needed no claim "because receive is naturally idempotent". That is true of a RETRY and false of a RACE, and the old belief is named rather than deleted.
  - `apps/admin/lib/actions/purchases.test.ts`: two suites against real PostgreSQL — concurrent double receipt (one transition, one increment) and sequential replay (5 + 3 stays 8).
- **Verification Executed:**
  - **Mutation proof first:** with the pre-fix action restored, the concurrency test fails `expected 20 to be 10`; the replay test passes on both versions, which is exactly the retry-vs-race distinction the old comment conflated.
  - `TEST_DB_REQUIRED=1 npm test` on a freshly migrated throwaway database → **97 files and 757 tests passed**.
  - `tsc --noEmit -p apps/admin/tsconfig.json` → **0 errors**.
  - `npm run lint -w @tokophi/admin` → **0 findings in the files this task touches**. ⚠️ The workspace itself is **not** green: 4 pre-existing errors, all `react-hooks/set-state-in-effect` in `apps/admin/app/(admin)/tema/[id]/builder-client.tsx`, plus 21 warnings. That baseline was 0 errors on 2026-08-11 (DEL-2) and has regressed since — it is Task 5.11's subject, recorded here as measured evidence rather than repaired sideways.
- **Not done here:** no browser pass. The change is a transaction boundary with no UI surface; the runnable proof is the concurrency test, and a browser cannot produce the overlap it exercises.
- **Completed Task:** Stage 4 Task 4.9.

### [2026-08-18] — Stage 4 Task 4.6 Real Product-Editor Purchase Orders

- **Scope:** Replaced the product editor's UI-only `Buat PO` success path with a tenant-scoped persisted purchase-order transaction for the selected saved product variant.
- **Files Created / Modified:**
  - `apps/admin/lib/actions/purchases.ts`: validates the Server Action payload at runtime, resolves one saved supplier and only store-owned variants, claims a stable per-attempt PO code, writes the PO header and every line in one transaction, replays accepted retries, and rejects request-key reuse with different intent.
  - `apps/admin/lib/actions/purchases.test.ts`: proves concurrent/repeated idempotency, malformed and overflowing payload rejection, foreign supplier/variant rejection, intent conflict, and injected line-insert rollback against real PostgreSQL.
  - `apps/admin/app/(admin)/produk/[id]/product-editor.tsx`: submits the selected variant, supplier, quantity, unit cost, and optional ETA through the real action; pending/error state is stable and the dialog closes only after an accepted commit.
  - `apps/admin/app/(admin)/produk/pembelian/pembelian-client.tsx`: migrates the existing purchase-page caller to the typed result and stable request-key contract, and corrects its memo dependencies.
- **Verification Executed:**
  - `TEST_DB_REQUIRED=1 vitest run` across the six integrated Stage 4 focused suites → **6 files and 14 tests passed** against isolated real PostgreSQL.
  - `tsc --noEmit -p apps/admin/tsconfig.json` → **0 errors**.
  - Focused ESLint across all four Task 4.6 source/test files → **0 errors and 0 warnings**.
  - Desktop browser flow selected `Dusty Pink / XL`, quantity `3`, and unit cost `75,000`; the store's PO count moved from **6 to 7**, and PostgreSQL contained one new `dipesan` header plus one selected-variant line totaling **225,000**.
  - A nonexistent supplier left the dialog open with supplier, quantity, and cost preserved, surfaced a specific retriable error, left the submit button enabled, and left the PO count at **7**.
  - Mobile browser proof at 390×844 rendered the 358 px dialog without horizontal overflow; the persisted error and all inputs remained readable.
  - Independent reviewer re-read the final trust-boundary, transaction, idempotency, caller, and regression-test changes and reported no remaining defect.
- **Completed Task:** Stage 4 Task 4.6.

### [2026-08-18] — Stage 4 Tasks 4.1–4.5 Integration Proof

- **Scope:** Integrated the independently reviewed Task 4.1 credential hardening, Task 4.2 public-store availability guard, Task 4.3 durable payment-request idempotency, Task 4.4 persisted receipt facts, and Task 4.5 per-variant stock update contract on `integration/stage4-p0-wave1`.
- **Task 4.3:** `createOrderPayment` now claims a store-scoped caller request key before provider I/O, persists `in_progress`/`accepted`/`failed`, rejects intent reuse, and replays the stored terminal result and local payment identity after module reload.
- **Task 4.5:** Inventory edits now submit variant id, exact intended stock, and expected prior stock; the tenant transaction conditionally updates the selected row only, and stale rows are reloaded with a visible conflict message.
- **Integrated Verification:**
  - `TEST_DB_REQUIRED=1 vitest run apps/admin/scripts/audit-responsive.test.ts apps/admin/app/api/public/order/route.test.ts apps/admin/lib/payment-request.test.ts apps/admin/lib/data/inventory.test.ts apps/admin/lib/actions/inventory.test.ts` → **5 files and 12 tests passed** against real PostgreSQL.
  - `tsc --noEmit -p apps/admin/tsconfig.json` → **0 errors**.
  - Focused ESLint across every integrated Admin source and test file → **0 errors and 0 warnings**.
  - `DATABASE_URL=... npm run migrate -w @tokophi/db` after migration `0095_payment_request_idempotency` was already applied → **rerun completed successfully**.
  - Task 4.5 browser proof at 1365×768 and 390×844 changed only the selected variant, retained the persisted sibling quantity after reload, surfaced an externally injected stale conflict, and showed no mobile horizontal overflow.
- **Branch Evidence:** `fix/task-4.1-audit-credentials`, `fix/task-4.2-store-availability`, `fix/task-4.3-payment-idempotency`, `fix/task-4.4-inventory-receipts`, and `fix/task-4.5-variant-stock` are pushed. The current `origin/main` `TASKS.md` predates the separate canonical Stage 4 planning changes, so this integration branch does not replace or duplicate that unmerged source of truth.

### [2026-08-17 16:41 UTC] — Task 4.1 Responsive-Audit Credential Removal

- **Scope:** Completed Stage 4 Task 4.1 from `docs/canonical-planning-contracts`: the Seller responsive audit no longer embeds a reusable account and exits before browser launch when either required credential is absent.
- **Files Modified:**
  - `apps/admin/scripts/audit-responsive.mjs`: reads `AUDIT_EMAIL` and `AUDIT_PASSWORD` without fallback values and fails closed when either is missing.
  - `apps/admin/scripts/audit-responsive.test.ts`: covers each missing variable and the explicit-credential login flow.
  - `apps/admin/scripts/test-stubs/audit-responsive-playwright.mjs`: deterministic Playwright boundary for the CLI regression test; it verifies the supplied environment values reach the email/password fields.
- **Verification Executed:**
  - `node_modules/.bin/vitest run apps/admin/scripts/audit-responsive.test.ts` → **1 file passed; 3 tests passed**.
  - `npm run lint -w @tokophi/admin -- scripts/audit-responsive.mjs scripts/audit-responsive.test.ts scripts/test-stubs/audit-responsive-playwright.mjs` → **passed with 0 errors and 0 warnings**.
  - `node_modules/.bin/tsc --noEmit -p apps/admin/tsconfig.json` → **passed**.
  - `env -u AUDIT_EMAIL -u AUDIT_PASSWORD node apps/admin/scripts/audit-responsive.mjs http://127.0.0.1:9` → **exit 1 with the required-variable error before Playwright launch**.
  - Focused source search of `apps/admin/scripts/audit-responsive.mjs` → **no former email/password literals remain**.
  - Real local smoke with an isolated migrated/seeded PostgreSQL database and generated credentials → **login succeeded, the script resolved `/store/batiknusantara`, and all 264 route×width checks executed**. The command then reported **24 pre-existing 320 px topbar overflows** tracked separately by Task 5.5; Task 4.1 does not alter layout.
- **Task State:** Implementation and focused local verification complete on `fix/task-4.1-audit-credentials`. The canonical Stage 4 queue exists on the separate `docs/canonical-planning-contracts` branch, so this feature branch does not duplicate or rewrite that unmerged `TASKS.md`.

### [2026-08-18] — Task 4.2 Public Order Store Availability

- **Scope:** Closed release blocker `F-T9` by applying the storefront's `suspended_at IS NULL` public-servability contract to public order creation.
- **Files Modified:**
  - `apps/admin/app/api/public/order/route.ts`: Returns the same CORS-bearing 404 for missing and blocked stores, then locks and re-checks the store before the first customer/order-side write.
  - `apps/admin/app/api/public/order/route.test.ts`: Adds real-PostgreSQL active, pending/unapproved, suspended, and suspension-race coverage with before/after snapshots of every route mutation target.
- **Verification Executed:**
  - `TEST_DB_REQUIRED=1 vitest run apps/admin/app/api/public/order/route.test.ts` → **1 file and 4 tests passed**.
  - `tsc --noEmit -p apps/admin/tsconfig.json` → **0 errors**.
  - Focused ESLint on the route and integration test → **0 errors and 0 warnings**.
- **Security Review:** Stores already blocked at resolution perform no shipping-provider call; all blocked and suspension-race attempts leave checkout sessions, customers, orders, line items, financials, payments, inventory, discounts, usages, and tracking deliveries unchanged. The transactional `FOR UPDATE` re-check closes suspension between initial resolution and mutation.
- **Completed Task:** Stage 4 Task 4.2.

### [2026-08-18] — Task 4.4 Persisted Inventory Receipt Facts

- **Scope:** Removed the fabricated fixed incoming percentage and derived product-level ordered, received, and outstanding quantities only from persisted open purchase-order lines.
- **Files Created / Modified:**
  - `apps/admin/lib/data/inventory.ts`: Aggregates `qty`, `received_qty`, and line-scoped outstanding quantities for `dipesan`/`sebagian` POs, bounded by PO, variant, and product ownership.
  - `apps/admin/lib/data/inventory.test.ts`: Adds real-PostgreSQL coverage for waiting, partial, full, absent, over-received sibling lines, ignored closed/draft POs, and both cross-store ownership directions.
  - `apps/admin/app/(admin)/produk/inventori/page.tsx`: Loads receipt facts beside the product list.
  - `apps/admin/app/(admin)/produk/inventori/inventori-client.tsx`: Renders and exports stored ordered/received/incoming facts; no inferred quantity remains.
- **Verification Executed:**
  - `TEST_DB_REQUIRED=1 vitest run apps/admin/lib/data/inventory.test.ts` → **1 file and 1 test passed**.
  - `tsc --noEmit -p apps/admin/tsconfig.json` → **0 errors**.
  - Focused ESLint on all four changed files → **0 errors and 0 warnings**.
  - Browser smoke at 1365×768 and 390×844 → receipt facts rendered on desktop, the mobile table had no horizontal overflow, and reload produced **0 console, page, or HTTP errors**.
- **Data Review:** Outstanding receipt quantity is clamped per line before summation, so an over-received line cannot hide an unreceived sibling. Cross-store PO, variant, and product associations are excluded.
- **Completed Task:** Stage 4 Task 4.4.

### [2026-08-15 13:58 UTC] — Coolify Production Monorepo Deployment & Turbopack Root Fix

- **Scope:** Resolved Coolify Docker monorepo build failures for `@tokophi/admin` and `@tokophi/super-admin`, queued deployment 447, and verified 100% production container health & probe pass.
- **Files Modified:**
  - `apps/admin/next.config.ts`: Set `turbopack: { root: path.resolve(__dirname, "../../") }`.
  - `apps/super-admin/next.config.ts`: Set `turbopack: { root: path.resolve(__dirname, "../../") }`.
  - `apps/landing/package.json`: Synced `@tokophi/ui` dependency version to `*`.
- **Verification Executed:**
  - Local Docker Build: `docker build -f apps/super-admin/Dockerfile -t tokophi-super-test .` → **Successfully built image 58fbcdb00484**.
  - Local Docker Build: `docker build -f apps/admin/Dockerfile -t tokophi-admin-test .` → **Successfully built image 51a0eb62da5b**.
  - Coolify Deployment Queue ID 447 → **Swapped & Healthy (all containers: super-admin, admin, storefront, landing, postgres)**.
  - `ops/tokophi-probe.sh` → **100% GREEN (exit 0)**:
    - `https://tokophi.com` → 200 OK
    - `https://app.tokophi.com/login` → 200 OK
    - `https://rich.tokophi.com` → 307 (Redirect to Login)
    - `https://rich.tokophi.com/update-log` → 307 (Update Log surface active and protected)
    - `https://toko.tokophi.com` → 200 OK
    - `https://batiknusantara.tokophi.id` → 200 OK
    - `POST /api/public/ongkir op=search` → 200 OK

### [2026-08-15 13:33 UTC] — Super Admin Human Development Update Log Surface Addition

- **Scope:** Created dedicated Super Admin menu surface `/update-log` for human operators (Paduka Ongki & team) to view concise development summaries, version history, bug locations, solutions, and verification proof.
- **Files Created / Modified:**
  - `apps/super-admin/lib/nav.ts`: Added `{ label: "Update Log", href: "/update-log", icon: History }` navigation link.
  - `apps/super-admin/lib/data/dev-logs.ts`: Structured data source defining development logs with categories (`major`, `minor`, `feature`, `bugfix`, `security`, `logistics_payment`), surfaces, root causes, solutions, and verification proof.
  - `apps/super-admin/app/(platform)/update-log/page.tsx`: Server page with metadata.
  - `apps/super-admin/app/(platform)/update-log/update-log-client.tsx`: Interactive client UI with KPI cards, search filtering, category pills, surface tags, and concise bug fix/solution/verification summaries.
- **Verification Executed:**
  - `DATABASE_URL=... DATABASE_RUNTIME_ROLE=app npm run build:super` -> Compiled Next.js route `/update-log` with **0 errors**.
  - `npm test` -> **90/90 Vitest files passed (722/722 tests), Storefront Astro check 0 errors, Landing Astro check 0 errors**.

### [2026-08-15 13:30 UTC] — TokoΦ v1.0.0 Release Bump, Master README Overhaul & History Synchronization

- **Scope:** Monorepo package version bump to v1.0.0, complete README overhaul, live production deployment probe validation, and AI/collaborator task & reporting protocol specification.
- **Version Alignment:** Updated `"version": "1.0.0"` across all 10 monorepo package definitions:
  - Root (`package.json`)
  - Apps: `@tokophi/admin`, `@tokophi/super-admin`, `@tokophi/storefront`, `@tokophi/landing`
  - Packages: `@tokophi/db`, `@tokophi/lib`, `@tokophi/ui`, `@tokophi/sections`, `@tokophi/data`
- **Production Verification Proof (`ops/tokophi-probe.sh`)**:
  - `https://tokophi.com` → HTTP 200 OK (Apex Landing)
  - `https://app.tokophi.com/login` → HTTP 200 OK (Seller Panel)
  - `https://rich.tokophi.com` → HTTP 307 (Super Admin Redirect)
  - `https://toko.tokophi.com` → HTTP 200 OK (Demo Storefront)
  - `https://batiknusantara.tokophi.id` → HTTP 200 OK (Merchant Storefront)
  - `POST /api/public/ongkir op=search` → HTTP 200 OK (KiriminAja subdistrict query)
  - SSH & Disk: Reachable, 16% root disk usage (136GB free), L1 heartbeat 53s old.
- **Verification Suite**:
  - `npm test` → **90/90 Vitest files passed, 722/722 tests passed (82 passed / 8 skipped without DB env), Storefront Astro Check 0 errors, Landing Astro Check 0 errors**.

### [2026-08-15 12:58 UTC] — Final Cross-Domain Audit Closure & Verification Pass

- **Scope:** Security & RLS, database schema and migrations, API contracts, and the complete DB-required regression suite.
- **Remediation closure:** **100% of the tracked 2026-08-15 findings resolved and re-verified.**
- **Database index parity:** restored exact Drizzle declarations for all six migration-defined indexes identified by the deep audit:
-   - `ledger_one_sale_per_order`;
-   - `ledger_one_retur_per_order`;
-   - `ledger_store_status_idx`;
-   - `ledger_one_sale_per_payment`;
-   - `payments_order_idx`;
-   - `tracking_event_deliveries_order_idx`.
- **API contract alignment:** promotion preview, payment callback, labels, and all cron handlers now return structured error/status bodies matching the operations currently documented in OpenAPI. Final static re-audit found **zero implementation drift across documented operations**.
- **Verification proof:**
-   - `TEST_DATABASE_URL=<isolated-test-db> TEST_DB_REQUIRED=1 npm test` → **90/90 test files passed; 722/722 tests passed; 0 failed**.
-   - Storefront Astro check, executed by the root test command → **119 files; 0 errors; 0 warnings; 14 hints**.
-   - Landing Astro check, executed by the root test command → **29 files; 0 errors; 0 warnings; 0 hints**.
-   - `npm run verify-migrations -w @tokophi/db` → **95 journal entries verified; head `0094_magical_salo`; passed**.
-   - `npm run verify-rls -w @tokophi/db` against the seeded local database → **passed**: own-tenant visibility, foreign/missing-context zero-row behavior, `WITH CHECK`, store-row isolation, and support-ticket/message isolation all verified.
-   - `npm run verify-rls-app -w @tokophi/db` against the seeded local database → **passed**: own-tenant read/write, foreign invisibility, and cleanup verified through `withTenant()`.
-   - `npx tsc --noEmit -p apps/admin/tsconfig.json` → **passed**.
-   - `npx tsc --noEmit -p packages/db/tsconfig.json` → **passed**.
- **Disclosed follow-ups:**
-   - Six live same-origin Storefront endpoints (`checkout-session`, `search`, `track`, `chat/read`, `chat/send`, `chat/poll`) remain outside the OpenAPI corpus. This does not create implementation drift against an existing operation, but complete route coverage must not be claimed yet.
-   - `packages/db/src/schema-indexes.test.ts` does not yet assert the six restored index declarations; exact parity is verified on disk but is not fully regression-pinned.

---
### [2026-08-15 12:05 UTC] — Audit Remediation & Perfection Pass (Completed)
- **Executor:** Main Session
- **Completed tasks integrated & verified:**
  1. **Task 0.1 — Secret Handling & Auth Guard Hardening (`SEC-C1` / `SEC-001`)**
     - Files: `docker-compose.coolify.yml`, `packages/lib/src/secret.ts`
     - Result: Removed default string fallback for `AUTH_SECRET` and `POSTGRES_PASSWORD` in Compose (`${AUTH_SECRET:?must be set}`). Updated `resolveAuthSecret()` to fail-closed on known insecure fallback literals (`dev-insecure-change-me`, `dev-insecure-*`).
  2. **Task 0.2 — Docker Compose Syntax Fix (`INF-C2`)**
     - Files: `docker-compose.coolify.yml`
     - Result: Escaped Traefik label `${1}` to `$${1}`. Verified `docker compose -f docker-compose.coolify.yml config -q` passes without parsing errors.
  3. **Task 1.1 — CMS Page Editor Body Preservation (`ADM-C1` / `CMS-001`)**
     - Files: `apps/admin/lib/data/pages.ts`, `apps/admin/app/(admin)/halaman/[id]/page-editor.tsx`, `apps/admin/lib/mock/store.ts`
     - Result: Included `body` column in `toPage()` query and updated `PageEditor` state initialization to preserve existing page body instead of overwriting with filler text.
  4. **Task 1.2 — PPN Tax Rate Decimal Parsing (`ADM-C2`)**
     - Files: `apps/admin/components/admin/pengaturan/pajak-card.tsx`
     - Result: Updated rate string parsing regex to preserve decimals (`[^0-9.]`), preventing values like `11.5%` from becoming `115%` -> `100%`.
  5. **Task 1.3 — Followup Client Null-Safety (`ADM-C3`)**
     - Files: `apps/admin/app/(admin)/crm/followup/followup-client.tsx`
     - Result: Added optional chaining `templates[0]?.body ?? ""` to prevent app crash when a store has 0 templates.
  6. **Task 2.1 & 2.2 — RLS Enforce & Order-Expiry Cron Scheduler (`TEN-001` / `OPS-001`)**
     - Files: `docker-compose.coolify.yml`, `packages/db/src/client.ts`
     - Result: Configured `DATABASE_RUNTIME_ROLE: app` in Compose and added fallback in db client. Scheduled `cron-order-expiry` service running every 300 seconds.
  7. **Task 2.3 — Super Admin Platform KPI SQL Aggregates (`SUPER-001`)**
     - Files: `apps/super-admin/lib/data.ts`
     - Result: Replaced 50-store array truncation in `getPlatform()` with platform-wide SQL aggregate queries.
- **Verification Proof:**
  - `npm test`: **718 tests passed across 89 test suites** (100% of DB-coupled & money suites passed against local test DB).
  - `astro check`: **0 errors** across 119 storefront files and 29 landing files.
  - `@tokophi/admin` & `@tokophi/super-admin` Next.js builds compiled and generated static routes cleanly.
  - `docker compose config`: Validated cleanly with no parsing errors.

### [2026-08-15 04:30 UTC] — Comprehensive Multi-Domain Audit & Perfection Roadmap (Completed)
- **Executor:** Main Session + Specialist Subagents (`SecurityPrivacyAuditor`, `PaymentCheckoutAuditor`, `OrderStockDispatchAuditor`, `TrackingShippingAuditor`, `TypePerfA11yAuditor`, `DocsArchitectureAuditor`)
- **Scope:** Complete repository audit across 6 batches:
  1. Security & Privacy (`AUDIT_SECURITY_PRIVACY.md`)
  2. Payment & Checkout (`AUDIT_PAYMENT_CHECKOUT.md`)
  3. Order, Stock & Dispatch (`AUDIT_ORDER_STOCK_DISPATCH.md`)
  4. Tracking & Shipping Signals (`AUDIT_TRACKING_SHIPPING.md`)
  5. Type Safety, Accessibility & Performance (`AUDIT_TYPE_A11Y_PERFORMANCE.md`)
  6. Documentation & Architecture (`AUDIT_DOCUMENTATION.md`)
- **Outputs Created:**
  - `specs/docs/AUDIT_SECURITY_PRIVACY.md`
  - `specs/docs/AUDIT_PAYMENT_CHECKOUT.md`
  - `specs/docs/AUDIT_ORDER_STOCK_DISPATCH.md`
  - `specs/docs/AUDIT_TRACKING_SHIPPING.md`
  - `specs/docs/AUDIT_TYPE_A11Y_PERFORMANCE.md`
  - `specs/docs/AUDIT_DOCUMENTATION.md`
  - `specs/docs/TOKOPHI_PERFECTION_ROADMAP.md`
  - `specs/docs/TOKOPHI_MASTER_ENGINEERING_REPORT.md`
  - `specs/docs/tasks/2026-08-15-next-execution-plan.md`
- **Verification Proof:**
  - `npm test`: 642 tests passed across 77 active test suites.
  - `astro check`: 0 errors across 119 storefront files and 29 landing files.
  - `@tokophi/admin` & `@tokophi/super-admin` Next.js builds verified.

---

### [2026-08-15 04:45 UTC] — Execution Plan & Collaborator Task Filter (Completed)
- **Executor:** Main Session
- **Actions:**
  - Filtered out Irwansyah's assigned task (`#180` / `docs/irwansyah-order-shipping-finance`: order money calculator, seller ledger net-proceeds, COD fee formula, QRIS renderer).
  - Consolidated remaining 13 actionable execution tasks into `specs/docs/tasks/2026-08-15-next-execution-plan.md`.
  - Added AI Execution History & Record-Keeping Mandate to `AGENTS.md`.
  - Initialized `BUILD-LOG.md` to track precise historical records for all AI agents.

---

### [2026-08-15 05:35 UTC] — Parallel Execution & Verification Pass (Completed)
- **Executor:** Main Session + Specialist Subagents
- **Completed tasks integrated & verified:**
  1. **Task 01 — Courier state-machine reconciliation**
     - Files: `apps/admin/lib/order-status.ts`, `apps/admin/lib/ka-tracking.ts`, `apps/admin/lib/order-status.test.ts`
     - Result: courier-confirmed `diproses -> selesai/retur` can now apply cleanly; rejected transitions return `{ applied: false, reason }`; tracking logs only successful applied changes.
     - Verification: `TEST_DATABASE_URL=postgres://tokophi:tokophi@127.0.0.1:5433/tokophi_test TEST_DB_REQUIRED=1 npx vitest run apps/admin/lib/order-status.test.ts` → passed.
  2. **Task 02 — Payment callback hardening**
     - Files: `apps/admin/app/api/public/pay/callback/route.ts`, `packages/lib/src/pay-callback.ts`, `packages/lib/src/autolaris.ts`, `packages/lib/src/pay-callback.test.ts`
     - Result: constant-time callback secret verification, exact payment amount gating for order/subscription settlement, exported `alInquirePaymentStatus(trxId)` helper, focused regression coverage.
     - Verification: `npx vitest run packages/lib/src/pay-callback.test.ts` → 7/7 passed.
  3. **Task 03 — Expired prepaid order worker**
     - Files: `apps/admin/app/api/cron/order-expiry/route.ts`, `apps/admin/app/api/cron/order-expiry/route.test.ts`, `apps/admin/app/api/cron/record-run.ts`
     - Result: fail-closed cron worker cancels >24h unpaid prepaid orders, rechecks eligibility under locked order/payment rows, and records `{ scanned, cancelled, skipped, errors }` via `recordCronRun`.
     - Verification: `npx vitest run apps/admin/app/api/cron/order-expiry/route.test.ts` → 4/4 passed.
  4. **Task 04 — DB role & RLS privileged segregation**
     - Files: `packages/db/src/client.ts`, `specs/docs/DEPLOY.md`, `docker-compose.coolify.yml`
     - Result: defaults production DB connection to unprivileged `tokophi_app` role with mandatory RLS enforcement; owner-privileged connection opt-in for migrations and super-admin.
     - Verification: `npx tsc -p packages/db/tsconfig.json --noEmit` → passed.
  5. **Task 05 — Admin/super-admin pagination**
     - Files: `apps/admin/lib/data/customers.ts`, `apps/admin/lib/data/orders.ts`, `apps/super-admin/lib/data.ts`
     - Result: added `{ limit = 50, offset = 0 }` pagination to unbounded list helpers and made results deterministic before limiting.
     - Verification: `npx tsc --noEmit -p apps/admin/tsconfig.json && npx tsc --noEmit -p apps/super-admin/tsconfig.json` → passed.
  6. **Task 06 — Drizzle schema index parity**
     - Files: `packages/db/src/schema.ts`, `packages/db/src/schema-indexes.test.ts`
     - Result: mirrored `orders_store_placed_idx`, `payments_trx_idx`, `payments_reff_idx`, `order_line_items_order_idx` into Drizzle schema.
     - Verification: `npx vitest run packages/db/src/schema-indexes.test.ts` → 3 tests passed.
  7. **Task 07 — Tracking poller fairness + timeout**
     - Files: `apps/admin/app/api/cron/tracking/route.ts`, `packages/lib/src/kiriminaja.ts`
     - Result: 8-second courier HTTP timeout, per-store round-robin polling cap, and permanent 4xx courier rejections moved to `problem`.
     - Verification: `npx vitest run packages/lib/src/kiriminaja.test.ts packages/lib/src/tracking-ids.test.ts` → 16 tests passed.
  8. **Task 08 — Google Ads conversion signal engine**
     - Files: `apps/storefront/src/components/MarketingPixels.astro`, `apps/storefront/src/components/OrderFunnel.astro`, `apps/storefront/src/data/tracking.ts`, `packages/db/src/schema.ts`, `apps/admin/lib/tracking-events.ts`, `apps/admin/lib/capi.ts`
     - Result: wired `adsSendTo` column in schema, exposed via tracking config, fired Google Ads purchase conversion with full `send_to` destination tag, forwarded `_gcl_aw/_gcl_gb/_gcl_gs` attribution cookies in checkout session, and supported server-side sGTM forwarding via `GOOGLE_SGTM_ENDPOINT`.
     - Verification: source invariant suite passed (7/7 assertions green).
  9. **Task 09 — Storefront CI verification wiring**
     - File: `.github/workflows/ci.yml`
     - Result: CI now runs `npm run verify -w @tokophi/storefront` after `npm test`.
     - Verification: workflow YAML parsed; required step asserted present.
  10. **Task 10 — Dynamic theme injector standardization**
      - Files: `apps/storefront/src/components/ThemeTokens.astro`, `apps/admin/components/theme/brand-color-dialog.tsx`, `apps/admin/components/theme/theme-tokens-dialog.tsx`, `apps/admin/app/(admin)/tema/[id]/builder-client.tsx`
      - Result: standardized CSS variables injection via `<style id="tokophi-tenant-theme">` in storefront and preview live updating on admin theme editor dialogs with state snapshot revert on cancellation.
      - Verification: `npx vitest run packages/lib/src/theme.test.ts apps/storefront/src/data/theme-source.test.ts` → 22 tests passed.
  11. **Task 11 — Shared form accessibility**
      - Files: `packages/ui/src/components/ui/input.tsx`, `packages/ui/src/components/ui/textarea.tsx`
      - Result: added `error` prop, `aria-invalid`, merged `aria-describedby`, and linked `aria-live="polite"` error region support.
      - Verification: `npx tsc --noEmit -p packages/ui/tsconfig.json` → passed.
  12. **Task 12 — Landing hydration optimization**
      - File: `apps/landing/src/components/SiteHeader.astro`
      - Result: `MobileNav` changed from `client:load` to `client:idle`.
      - Verification: `npm run check:landing` → 0 errors / 0 warnings / 0 hints.
  13. **Task 13 — OpenAPI 3.1 corpus generation**
      - Files: `specs/openapi/storefront-api.yaml`, `specs/openapi/admin-api.yaml`
      - Result: complete OpenAPI 3.1 YAML specifications for 21+ HTTP endpoints in storefront and admin APIs.
      - Verification: `redocly lint` passed with 0 errors; path coverage script verified 100% path parity across routes.
  14. **Task 14 — PRD & ADR index documentation alignment**
      - Files: `specs/PRD.md`, `specs/README.md`
      - Result: updated PRD with automated courier delivery settlement semantics and README with active ADR 0015 reference.
      - Verification: `specs/README.md` lists ADR 0015 as active and ADR 0014 as superseded.
  15. **Env Health Classification Parity**
      - File: `apps/admin/lib/env-health.ts`
      - Result: added `GOOGLE_SGTM_ENDPOINT`, `APP_DATABASE_URL`, `DATABASE_RUNTIME_ROLE` to `ENV_CHECKS`.
      - Verification: `npm test` → 81 test files passed (658 passed tests), 0 failing test files.

---

## Final Verification Summary
- **Unit Tests:** `npm test` → 81 passed, 8 skipped (db-coupled suites), 0 failed.
- **Astro Type & Template Check (Storefront):** `astro check --root apps/storefront` → 0 errors, 0 warnings.
- **Astro Type & Template Check (Landing):** `astro check --root apps/landing` → 0 errors, 0 warnings.
- **Admin App Build:** `DATABASE_RUNTIME_ROLE=owner DATABASE_URL=... npm run build:admin` → Compiled successfully, static pages generated.
- **Super-Admin App Build:** `DATABASE_RUNTIME_ROLE=owner DATABASE_URL=... npm run build:super` → Compiled successfully, static pages generated.

---

## 2026-08-16 — CI restored to green; shared dev DB caught up (Main Session, interactive Claude)

- **Scope:** `CI-VERIFY-DB` — the storefront verify step added by `d5bf796` (direct push) ran two
  steps too early, against the job-level `DATABASE_URL` = the empty, never-migrated base `tokophi`
  database. Every storefront route 500'd on `relation "store_domains" does not exist`, so main's CI
  sat red from 2026-08-15 06:20Z through all three direct pushes — the exact failure the ci.yml
  comment two blocks below it (“`_test`, not `tokophi`”) already warned about.
- **Files:** `.github/workflows/ci.yml` (verify step moved AFTER the `seed tokophi_test` step, env
  pinned to `tokophi_test`, `npx playwright install --with-deps chromium` added — four of the six
  checks drive a browser and the runner ships none), `BUILD-LOG.md`, `specs/docs/TASKS.md`.
- **Verification:**
  - Root cause isolated by reproduction, not by reading: fresh DB `tokophi_ci_repro` → migrate
    **95/95 applied, exit 0**, `store_domains` present; then the full CI test path
    (`TEST_DB_REQUIRED=1`, fresh `_test`) → **exit 0**, astro checks 0 errors. Local green + CI red
    ⇒ the delta was the verify step's database, confirmed in the step log (repeated router 500s).
  - Post-merge proof is the sha-bound CI run on this commit (watched to completion; reported in the
    session transcript — a watch attached to “the latest run” has burned this repo before).
- **Also this pass:** shared dev DB (`localhost:5433/tokophi`) was one migration behind merged main
  (`0094_magical_salo` unapplied — `order_financials` missing for every local session). Applied via
  `npm run migrate`; stamp now `1786475026516`, table present.

---

## 2026-08-19 — CI run LOCALLY for the ungated stage-4 wave; two real defects found (Main Session)

**Why:** GitHub Actions has been dead since 2026-08-15 (billing — every run aborts in 4 s, "recent
account payments have failed"). Twelve commits landed on `main` and **deployed to production**
(`d77d7a6`, containers confirmed on that sha) with **zero tests run**, including money paths
(`fix(payments): persist idempotent bill requests`, `fix(order): block checkout for unavailable
stores`, `fix(purchases)`, `feat(admin): edit stock per variant`) and migration
`0095_payment_request_idempotency`. This pass reproduced the whole CI job locally so the wave is not
merely assumed healthy.

**Scope:** `CI-LOCAL-0819` — full gate against `d77d7a6` on a throwaway DB (`tokophi_gate19`,
derived `_test`), every exit code read directly, never through a pipe.

| gate step | result |
|---|---|
| `verify-migrations` | **0** — journal healthy, 96 entries through `0095` |
| `migrate` (fresh DB) | **0** |
| `npm test` (`TEST_DB_REQUIRED=1`) | **1 → then 0** — 735/736 passed; the one red was `doc-counts` (below) |
| `seed` | **0** |
| `verify-rls` | **0** — RLS verified ✅ |
| `verify-rls-app` | **0** — app-path (`withTenant`) verified ✅ |
| `verify -w @tokophi/storefront` | **1 → then 0** — `check-hero-srcset` red (below) |
| `build:admin` · `build:super` | **0** · **0** |

**Defect 1 — stale published counts (the guard did its job).** `CODE_MAP.md` (×2 sites),
`STATUS.md`, `SCHEMA.md` and `AGENTS.md` still published 95 migrations / head `0094` after `0095`
landed. Fixed here; `doc-counts.test.ts` green 11/11 afterwards. Note for whoever tightens that
guard: it only requires the true number to appear *somewhere* in each file, so `AGENTS.md` and
`SCHEMA.md` passed while still carrying a stale sentence — only `CODE_MAP.md` went red.

**Defect 2 — MY OWN #277 wired a check that could never pass in CI.** `check-hero-srcset` failed
with `hero imgs: []`. Root cause is not the storefront: **`seed.ts` writes no `page_templates`** —
the deploy chain runs `seed-templates.ts` immediately after it (`docker-compose.coolify.yml`), and
that second script is what creates the default homepage carrying the batik hero. #277 added the
verify suite to CI after the seed step **without** it, so the check was red by construction on every
run, forever — the exact "red on clean data" failure this repo has already paid for twice. It was
invisible because billing killed Actions before any run reached it. Fixed by adding a
`seed:templates` step (same `tokophi_test` DATABASE_URL) before the suite.

**Proof of the fix, measured in that order:** seed-only → `1 of 6 checks FAILED: check-hero-srcset`;
after `npm run seed:templates` on the same database → **all 6 checks green** (`check-pixel-defer`
SKIP as designed — one tracking channel on the seeded store).

**Verdict on the wave itself: healthy.** Every product-code gate passed. The two reds were a stale
document and a CI-wiring bug of mine, neither of them in shipped behaviour.

**Also this pass:** the shared dev DB (`localhost:5433/tokophi`) was a migration behind again —
`0095` applied, stamp now `1786989252649`, `payments.request_key/request_state/request_error`
present.

⚠️ **Standing risk until billing is restored:** Coolify deploys on merge and does not consult
Actions, so every merge continues to reach production ungated. Until then, treat a local gate run
like this one as mandatory before merging code.

---

## 2026-08-19 (kedua) — Guard hardening: two guards that were green over untrue claims (Main Session)

**Scope:** `GUARD-0819` — following the local gate run above, both guards that touch "does the
document/schema match reality" were tightened. Each tightening was driven by a defect it found.

**1. `doc-counts.test.ts` — the claim is now anchored to its SENTENCE.** The old assertion was
"the true number appears somewhere in the file", so when `0095` landed, `AGENTS.md` and `SCHEMA.md`
**passed while their headline sentence still said 95 / head `0094`** — the correct number happened
to appear elsewhere (history table, older note). Only `CODE_MAP.md` went red. Added `ANCHORS`: one
regex per document naming the exact headline sentence that publishes the count, plus a derived
`HEAD` (`0096`) and a mutation self-check that pins the precise old hole — headline rolled back one
version while the right number still sits elsewhere in the file → must be RED. 18 tests green.

**2. `schema-indexes.test.ts` — hand-listed pins replaced by a CENSUS (the `rbac-census` shape).**
Four indexes were pinned by name, so index #30 could never make it red. `TASKS.md` carried a
follow-up saying "six restored index declarations are not yet pinned"; **measured from the SQL and
Drizzle it was nine, not six** — which is itself the argument for a runnable check over a sentence.
Every index any migration has ever created must now be classified `drizzle` or `sql-only: <reason>`;
a new one fails until someone classifies it, a ghost entry fails, a lie in either direction fails.

**🔴 What the census found: `order_line_items.order_id` had NO INDEX IN ANY DATABASE.** Declared in
`schema.ts`, pinned by the old test — and created by no migration. Measured on the shared dev DB and
**on production**: `pg_indexes` returned `order_line_items_pkey` and nothing else. That column is
what every order screen, the label printer and the bulk resi queue join on. The old guard read as
parity while no database had the index. Fixed by migration **`0096_order_line_items_order_idx`**
(idempotent `CREATE INDEX IF NOT EXISTS`), applied to the shared dev DB; production picks it up on
the next deploy's migrate service.

**⚠️ A trap I walked into and caught before committing:** the first stamp for `0096` came out
**19 digits** (`date +%s%3N` returned nanoseconds). That is exactly the "stamp too high silently
skips someone else's migration" hazard in AGENTS.md — and **`verify-migrations` did NOT catch it**,
because it only asserts that stamps increase. Corrected to milliseconds (`1787135123807`) before any
commit. Worth a future guard: assert every `when` is a 13-digit ms value.

**Verification (exit codes read directly, never piped):** `verify-migrations` green · fresh-DB
`npm test` with `TEST_DB_REQUIRED=1` → **96 files / 748 tests, exit 0** · both guards green
(26 tests across the two files) · docs re-synced to 97 migrations / head `0096` and re-verified by
the new anchored assertions.

---

## 2026-08-19 (ketiga) — Migration stamp SCALE guard, and the deploy 503 window measured (Main Session)

**Scope:** `GUARD-STAMP` — the follow-up filed by the previous pass, plus one measurement taken
while validating that pass in production.

**1. `verify-migrations` could not see a wrong SCALE.** It asserts stamps INCREASE, which a
nanosecond stamp does — so `0096`'s first `when` (`1787135109197478972`, from `date +%s%3N`) sailed
through. Once such a stamp is recorded in a database, every later migration written with ordinary
milliseconds is **silently skipped** while "migrations applied successfully" prints. Human eyes
caught it last time; that is not a guard.
- The predicate now lives in `packages/db/src/migration-stamp.ts` — a PURE module, the
  `platform-rank.ts` / `store-servable.ts` split, so it can be tested without executing the script's
  I/O. Window is deliberately loose (13-digit ms, 2001 → ~5138): it refuses the wrong SCALE, not a
  date somebody dislikes.
- `verify-migrations` consumes it; **`migration-stamp.test.ts` (7 tests)** pins it, including the
  exact nanosecond value that really was written here, the opposite error (10-digit seconds), both
  window boundaries, and non-integers.
- Proved red by mutating the journal, both directions, before the test existed:
  nanosecond → exit 1 naming the tag and digit count; seconds → exit 1. Journal restored byte-identical.

**2. The deploy 503 window, measured.** While verifying that `0096` reached production, all three
app surfaces answered **503 for ~15 minutes** (landing stayed 200 throughout). Breakdown from the
box: image build ~6 min, `migrate` + seed chain ~7 min, container start <1 min. Recorded in
`DEPLOY.md` beside the existing SSR note — which is true about the node process starting in seconds
and easy to misread as "deploys are seamless". They are not: a code merge costs about a quarter of
an hour of Seller + storefront downtime today. Reducing it (build first, swap after; `migrate` as a
step that does not hold the swap) is named there as its own future work, deliberately not attempted
as a side effect.

**Verification:** fresh-DB `npm test` with `TEST_DB_REQUIRED=1` → **97 files / 755 tests, exit 0** ·
`verify-migrations` green on the real journal · mutation proofs above.

---

## 2026-08-19 (keempat) — Deploy: seed chain taken off the critical path (Main Session)

**Scope:** `DEPLOY-SPLIT` — half of the measured 503 window removed at its source.

**What was wrong:** the `migrate` service ran `drizzle-kit migrate` **and** eight seed scripts, and
`admin`/`super-admin`/`storefront` all waited on it with `service_completed_successfully`. So every
deploy held all three surfaces down for the whole demo-data chain (~7 of the ~15 measured minutes) —
data that has nothing to do with serving traffic and is a no-op on an established database.

**Change (`docker-compose.coolify.yml`):** `migrate` now runs migrations only; a new `seed` service
carries the chain, depends on `migrate`, and **nothing depends on it**. App `depends_on` is
unchanged — they still wait for the schema, which is a real precondition.

**The one behaviour change, stated rather than buried:** on a FIRST deploy against an empty database
the storefront can start before the demo store row exists, so its healthcheck may report unhealthy
until the seed finishes; healthchecks retry, so it heals one interval later. On every subsequent
deploy the rows already exist.

**Verification:** `docker compose -f docker-compose.coolify.yml config` exits 0 with the env vars
supplied; the parsed graph confirms `admin`/`super-admin`/`storefront` → `migrate` only, and
`seed` → `migrate`. **The number that matters is not yet measured**: the next code deploy is what
proves the window, and it must be timed rather than assumed — DEPLOY.md says so in those words.

**Not attempted here:** the remaining ~6 minutes is Coolify tearing down the old containers before
the new image exists. That is orchestration, not this file.

---

## 2026-08-19 (kelima) — The deploy window, MEASURED: 15 minutes → 81 seconds (Main Session)

**Scope:** `DEPLOY-SPLIT` verification — the number #281 deliberately refused to claim.

**Method:** HTTP probe of `app.tokophi.com/login` every 20 s from the second of merge, recording the
first 503 and the return to 200. Not log-reading; not a single snapshot.

| deploy | 503 window | `migrate` chain |
|---|---|---|
| `#279` (index + test) | **~15 min** | migrations **+ 8 seed scripts**, all three apps waiting |
| `#281` (the split) | **81 s** — 503 began at +506 s, recovered at +587 s | migrations only; `seed` runs behind the apps |

Corroborated on the box at that moment: `migrate` `Exited (0)` 28 s earlier while `seed` had been
**up 27 s** — the demo-data chain is now genuinely behind the serving path. `landing` stayed 200
throughout both deploys. Final state: sha `4bbfd7e`, all three surfaces 200.

**🔴 I corrected my own note from a few hours earlier.** Its phase table claimed "build ~6 min with
the OLD containers already torn down". That half is **false**: during `#281`'s build all three hosts
answered **200**, and 503 only began at second 506 — at the swap. Build contributes no downtime at
all; the seed chain holding `service_completed_successfully` contributed nearly all of it. The
mistake came from one snapshot taken mid-deploy (no app containers + a just-finished build) turned
into cause-and-effect without testing it. Measuring from second zero to recovery is the whole
difference, and DEPLOY.md now says so in those words.

**What is left:** 81 s is the swap itself (stop, start, first healthcheck). Shrinking that means an
overlapping swap — new container healthy before the old one stops — which is Coolify orchestration,
not the compose file. Named there, not attempted, and the next person is told to measure first.

---

## 2026-08-20 — Deploy window, third sample (Main Session)

`#283` (Task 4.9) deployed with **no 503 observed at all**: 15 minutes of probing every 15 s, not one
sample non-200, and the containers arrived on `b6f7b1c`. Third point on the same measurement:
**~15 min (#279) → 81 s (#281) → none observed (#283)**.

Recorded in `DEPLOY.md` with the caveat that matters: the probe samples at 15 s, so a shorter window
would not be caught — the honest claim is "no 503 at 15-second resolution", not "zero downtime". The
variation between 81 s and none is itself expected: it depends on whether the new container's
healthcheck passes before the old one is released, which nothing in the current arrangement
guarantees. The doc now says in those words not to promise seamless deploys off one clean sample.
