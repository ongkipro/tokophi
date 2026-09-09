# TokoΦ — Audit Remediation & System Perfection Tasks

> Traceable task backlog for resolving audit findings from Claude, Codex, and OMP.
> Each task traces to a verified finding, names exact files, and carries a runnable "Done when" check.

> **Historical intake status (Stages 0–3):** Tasks 0.1, 0.2, 1.2, 1.3, 2.2, and 2.3 are verified in the current source. Task 1.1 remains open as Task 5.16. Task 2.1 changed labels but did not prove a restricted runtime and is superseded by Task 4.12. Task 3.1 is superseded by Task 4.13. Stages 4–8 are the only active execution queue.
>
> **Queue status (re-verified against code, tests and `BUILD-LOG.md` on 2026-09-08):** Stage 4 — **13/13 done**. Stage 5 — 8 done (5.2, 5.3, 5.5, 5.9, 5.10, 5.11, 5.16, 5.17), **9 open** (5.1, 5.4, 5.6, 5.7, 5.12, 5.13, 5.14, 5.15, 5.18), **3 blocked on the owner/provider** (5.8, 5.19, 5.20), plus 5.21–5.26 added from the 2026-09-04 page-map sweep. Stage 6 — 4 done (6.2, 6.5, 6.9, 6.10), **6 open** (6.1, 6.3, 6.4, 6.6, 6.7, 6.8), plus 6.11–6.13 added from the sweep. Stage 7 — **never run**; steps 2, 3 and 5 name commands that do not exist yet. Stage 8 (new) — operations & hygiene, seeded by the 2026-09-07 production outage. Every `- **Status:**` line below names the evidence it was set from; a task with no such line has not been verified.

## Stage 0: Security & Infra Blockers

### Task 0.1: Remove Published Insecure Secrets & Harden `resolveAuthSecret()`
- **Tracing:** `SEC-C1` / `SEC-001`
- **Target Files:** `docker-compose.coolify.yml`, `packages/lib/src/secret.ts`
- **Change:**
  1. Update `docker-compose.coolify.yml` to remove default string `${AUTH_SECRET:-dev-insecure-change-me}` and `${POSTGRES_PASSWORD:-tokophi}`, replacing with required variable expansion `${AUTH_SECRET:?AUTH_SECRET must be set}` and `${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}`.
  2. Update `packages/lib/src/secret.ts` to reject known insecure fallback literals (`dev-insecure-change-me`, `dev-insecure-*`, `dev-insecure-secret-change-me`) even if length >= 16.
- **Done when:** `vitest run packages/lib/src/secret.test.ts` passes and `resolveAuthSecret("dev-insecure-change-me")` throws in production runtime.

### Task 0.2: Fix Traefik Docker Compose Syntax
- **Tracing:** `INF-C2`
- **Target Files:** `docker-compose.coolify.yml`
- **Change:** Fix `${1}` invalid interpolation syntax in `docker-compose.coolify.yml` Traefik label definitions.
- **Done when:** `docker compose -f docker-compose.coolify.yml config -q` runs cleanly without syntax parsing errors.

---

## Stage 1: Merchant Data Loss & Admin UI Fixes

### Task 1.1: Fix CMS Page Body Loading & Preservation
- **Tracing:** `ADM-C1` / `CMS-001`
- **Target Files:** `apps/admin/lib/data/pages.ts`, `apps/admin/app/(admin)/halaman/[id]/page-editor.tsx`
- **Change:**
  1. Include `body` column in `toPage()` and `getPage()` in `apps/admin/lib/data/pages.ts`.
  2. Update `page-editor.tsx` to load and preserve `page.body` instead of overwriting with `seedBody(page.title)`.
- **Done when:** Opening an existing page in page editor displays its real `body`, and saving updates `body` without generating filler text.

### Task 1.2: Fix Decimal Tax Rate Input Parsing
- **Tracing:** `ADM-C2`
- **Target Files:** `apps/admin/app/(admin)/pengaturan/pajak-card.tsx`
- **Change:** Fix string replacement logic in `pajak-card.tsx` so decimal numbers (e.g. `11.5`) parse correctly to `11.5` instead of stripping the period (`115` -> `100%`).
- **Done when:** Inputting `11.5` sets `rate` to `11.5` and saves correctly.

### Task 1.3: Add Safe Navigation for Empty Follow-up Templates
- **Tracing:** `ADM-C3`
- **Target Files:** `apps/admin/app/(admin)/crm/followup/followup-client.tsx`
- **Change:** Replace direct dereference `templates[0].body` with safe optional chaining `templates[0]?.body ?? ""`.
- **Done when:** Loading the Followup client screen with 0 templates renders without crashing.

---

## Stage 2: Multi-Tenant RLS & Operations

### Task 2.1: Enforce Restricted DB Role (`tokophi_app`) in Compose
- **Tracing:** `INF-H3` / `TEN-001`
- **Target Files:** `docker-compose.coolify.yml`
- **Change:** Set `DATABASE_RUNTIME_ROLE: app` for `admin`, `super-admin`, and `storefront` services in `docker-compose.coolify.yml`.
- **Done when:** Production Compose configuration executes app services under `tokophi_app` role with PostgreSQL RLS active.

### Task 2.2: Schedule Order Expiry Cron Worker
- **Tracing:** `ORD-H1` / `OPS-001`
- **Target Files:** `docker-compose.coolify.yml`
- **Change:** Add `order-expiry-cron` runner service in `docker-compose.coolify.yml` calling `/api/cron/order-expiry`.
- **Done when:** `docker compose config` includes `order-expiry` cron service with `CRON_SECRET` authentication.

### Task 2.3: Fix 50-Store Truncation in Super Admin KPIs
- **Tracing:** `SUPER-001`
- **Target Files:** `apps/super-admin/lib/data.ts`
- **Change:** Add dedicated SQL aggregate queries for total stores, platform GMV, and active signups instead of slicing `getStores()` default 50 rows.
- **Done when:** `getPlatformStats()` computes aggregates across the entire `stores` table regardless of row count.

---

## Stage 3: Payment Verification & Final Validation

### Task 3.1: Harden Payment Callback & Identity Matching
- **Tracing:** `PAY-001` / `PAY-H1` / `SEC-M5`
- **Target Files:** `apps/admin/app/api/public/pay/callback/route.ts`, `packages/lib/src/pay-callback.ts`
- **Change:** Enforce exact single-payment resolution by `trx_id` / `payment_id` and accept `x-callback-token` header authentication.
- **Done when:** `npm test` passes `pay-callback.test.ts` and payment callback rejects ambiguous multi-row matches.

---

## 2026-08-16 Pre-Release Audit Queue

**Status:** Accepted for implementation; no remediation code has been changed in this planning pass.

**Source of truth:** [`specs/docs/REQUIREMENTS.md`](specs/docs/REQUIREMENTS.md) defines the accepted contract. [`specs/docs/AUDIT-SUMMARY.md`](specs/docs/AUDIT-SUMMARY.md) records the evidence. This file owns implementation order and acceptance checks.

**Release rule:** TokoΦ remains blocked from unrestricted production release until every Stage 4 task and the Stage 7 release gate pass. Stage 5 and Stage 6 items may be explicitly deferred only by an owner decision recorded in the repository; silence is not deferral.

## Stage 4: P0 Release Blockers

### Task 4.1: Remove the Reusable Responsive-Audit Credential
- **Requirement:** `NF-10`
- **Target Files:** `apps/admin/scripts/audit-responsive.mjs`, its focused script test or invocation check.
- **Change:** Remove the embedded default email/password. Require explicit test credentials through environment variables and fail before opening a browser when either value is absent.
- **Done when:** Running the audit without credentials exits non-zero without attempting login; a focused check confirms no reusable credential literal remains in the script; the audit still authenticates when explicit local test credentials are supplied.

- **Status:** `[x]` **DONE** (BUILD-LOG 2026-08-17 — credential removed, env-required, smoke-run 264 route×width checks; integrated in stage4-p0-wave1)
### Task 4.2: Enforce Store Availability in Public Order Creation
- **Requirement:** `F-T9`
- **Related requirement:** `F-P4`
- **Target Files:** `apps/admin/app/api/public/order/route.ts`, focused public-order integration tests.
- **Change:** Resolve the store through the same public-servability contract used by the storefront and reject `pending`, `suspended`, or otherwise blocked stores before cart, inventory, customer, order, payment, or checkout-session writes.
- **Done when:** Integration tests submit the same valid payload to active and blocked stores; active succeeds, each blocked state returns the accepted 404/403 contract, and blocked attempts leave every affected table unchanged.

- **Status:** `[x]` **DONE** (BUILD-LOG — public-order availability guard; integrated in stage4-p0-wave1)
### Task 4.3: Make Payment Request Creation Idempotent
- **Requirement:** `F-M13`
- **Target Files:** `apps/admin/lib/actions/payments.ts`, `packages/db/src/schema.ts`, one new numbered migration, payment request tests.
- **Change:** Introduce one stable idempotency key per order/payment intent, enforce uniqueness in PostgreSQL, and replay the accepted result instead of creating another provider charge. Do not rely on check-then-insert.
- **Done when:** A concurrent two-request test observes one provider call, one active payment row, and the same accepted payment identity from both callers; retry after a process restart remains deterministic.

- **Status:** `[x]` **DONE** (BUILD-LOG — store-scoped request key claimed before provider I/O, terminal result replayed; integrated in stage4-p0-wave1)
### Task 4.4: Replace Fabricated Incoming Inventory with Receipt Facts
- **Requirement:** `F-C6`
- **Related requirements:** `SEC-6`, `F-C2`
- **Target Files:** `apps/admin/lib/data/inventory.ts`, focused inventory data tests.
- **Change:** Derive incoming quantities from persisted purchase-order receipt state. If the schema does not contain a receipt fact, show pending/unknown rather than deriving a percentage from ordered quantity.
- **Done when:** Fixtures for unreceived, partially received, and fully received purchase orders return only stored quantities; no constant percentage or inferred receipt quantity remains in the data path.

- **Status:** `[x]` **DONE** (BUILD-LOG — receipt facts persisted; integrated in stage4-p0-wave1)
### Task 4.5: Fix Multi-Variant Quick Stock Updates
- **Requirement:** `F-C7`
- **Target Files:** `apps/admin/app/(admin)/produk/inventori/inventori-client.tsx`, `apps/admin/lib/actions/inventory.ts`, focused inventory action tests.
- **Change:** Send the selected variant id, exact intended quantity, and expected prior value for each edit. Reject stale updates and report which row must be reloaded.
- **Done when:** A two-variant test edits one variant without changing the other; stale expected stock is rejected; the browser flow reloads and displays the persisted per-variant quantities.

- **Status:** `[x]` **DONE** (BUILD-LOG — per-variant conditional update on expected prior stock, stale rows reloaded with visible conflict; integrated in stage4-p0-wave1)
### Task 4.6: Make `Buat PO` Create a Real Purchase Order
- **Requirement:** `F-C10`
- **Target Files:** `apps/admin/app/(admin)/produk/[id]/product-editor.tsx`, `apps/admin/lib/actions/purchases.ts`, focused purchase-order tests.
- **Change:** Connect the product-editor dialog to the existing purchase-order action with validated supplier, variant, quantity, and cost data. Keep the dialog open on failure and remove any success behavior that only closes the UI.
- **Done when:** The browser flow creates exactly one purchase order and line item for the selected variant; save failure remains visible with no row written; a repeat submission cannot duplicate the accepted request.

- **Status:** `[x]` **DONE** (BUILD-LOG "Completed Task: Stage 4 Task 4.6")
### Task 4.7: Persist Navigation Menu Creation
- **Requirement:** `F-P7`
- **Target Files:** `apps/admin/app/(admin)/navigasi/navigasi-client.tsx`, `apps/admin/lib/actions/menus.ts`, focused navigation tests.
- **Change:** Make create-menu insert the menu and initial items in one tenant transaction. Return a typed accepted/error result and show success only after the transaction commits.
- **Done when:** Create, reload, edit, and delete work against persisted rows; injected item-insert failure rolls back the menu; no success toast appears on rejection.

- **Status:** `[x]` **DONE** (BUILD-LOG "Completed Task: Stage 4 Task 4.7"; the UNIQUE (store_id, handle) debt it recorded was later closed too)
### Task 4.8: Make Checkout Order Creation Transactionally Idempotent
- **Requirement:** `F-O8`
- **Target Files:** `apps/admin/app/api/public/order/route.ts`, `packages/db/src/schema.ts`, one assigned migration, concurrent public-order tests.
- **Change:** Claim `(store_id, checkout_session_id)` inside the order transaction with a database uniqueness contract. Replay the accepted order for the same session; never rely on the current preflight read.
- **Done when:** Two concurrent valid submissions produce one order, one inventory decrement, and one stable response identity; retry after process restart is deterministic.

- **Status:** `[x]` **DONE** (BUILD-LOG "Completed Task: Stage 4 Task 4.8")
### Task 4.9: Serialize Purchase-Order Receipt
- **Requirement:** `F-C11`
- **Target Files:** `apps/admin/lib/actions/purchases.ts`, purchase receipt tests, schema/migration only if an accepted state constraint is missing.
- **Change:** Lock or conditionally transition the purchase order and update inventory in the same transaction. A second receipt attempt must observe the committed terminal state and perform no increment.
- **Done when:** A concurrent two-request DB test records one receipt transition and one inventory increment; replay returns the accepted terminal result without mutation.

- **Status:** `[x]` **DONE** (BUILD-LOG 2026-08-19 — serialized PO receipt, concurrency test)
### Task 4.10: Make Paid Subscription Callbacks Monotonic
- **Requirement:** `F-M14`
- **Target Files:** `apps/admin/app/api/public/pay/callback/route.ts`, subscription billing actions/helpers, callback tests.
- **Change:** Lock the invoice, make paid terminal for callbacks, and extend entitlement once only. Reject or safely ignore stale non-paid events after payment.
- **Done when:** Tests for paid → expired, paid → paid, and paid → expired → paid preserve paid status and extend the period exactly once.

- **Status:** `[x]` **DONE** (BUILD-LOG "Completed Task: Stage 4 Task 4.10")
### Task 4.11: Replace URL Impersonation JWTs with One-Time Exchanges
- **Requirement:** `SEC-10`
- **Target Files:** `apps/super-admin/lib/actions.ts`, `apps/admin/app/impersonate/route.ts`, session/auth types, one assigned migration/storage primitive if needed, impersonation tests.
- **Change:** Mint a short-lived opaque one-time exchange, consume it atomically server-side, preserve signed operator context in a bounded merchant session, and provide explicit exit. Never place reusable bearer material in a URL.
- **Done when:** One exchange succeeds once; replay, tamper, and expiry fail closed; a downstream merchant write identifies both operator and merchant; exit removes operator context.

- **Status:** `[x]` **DONE 2026-08-21** (SEC-10 — one-time impersonation exchange, migration 0098; twelve mutations twelve reds; also recorded in AGENTS.md)
### Task 4.12: Prove Restricted Database Identity or Fail Closed
- **Requirement:** `SEC-18`
- **Target Files:** `packages/db/src/client.ts`, `docker-compose.coolify.yml`, per-surface startup/runtime probes, restricted-role tests.
- **Change:** Remove owner-URL fallback from app-role mode. Require explicit restricted credentials and verify effective `session_user/current_user` lacks superuser and BYPASSRLS before serving traffic. Do not print connection strings.
- **Done when:** Admin, Super Admin, and Storefront refuse mislabeled owner credentials; accepted app credentials report the restricted role; cross-tenant probes remain blocked.
- **Status:** `[x]` **DONE 2026-08-22** — 🔴 **DEPLOYMENT PRECONDITION: `APP_DATABASE_URL` must be set in Coolify on the `admin` service (pointing at the restricted role `tokophi_app`) BEFORE this merges.** `${APP_DATABASE_URL:?…}` fails the deploy at compose-parse time without it — the whole stack, not just admin. `tokophi_app` was given `LOGIN` + a password by the owner on 2026-08-22 (`rolcanlogin = t`, `rolsuper = f`, `rolbypassrls = f`, verified).
  Shipped: **two pools**. `db` stays the OWNER handle for the enumerated paths that have no tenant to scope by (auth's pre-session read, `api/public/**`, cron, `provision.ts`, super-admin, storefront); new **`appDb`** is the RESTRICTED pool and `withTenant()` is its only caller, so all 79 merchant files run on a connection with no superuser and no BYPASSRLS to `RESET ROLE` back to. The `?? ownerUrl` fallback is gone: app-role mode with no `APP_DATABASE_URL` refuses to start, and the connected role is proved against `pg_roles` (`current_user` **and** `session_user`) once per process before the first tenant query. No connection string reaches any log or error.
  ⚠️ **The preflight's runbook was wrong and is superseded** — pointing all three services at `tokophi_app` is an outage, not a hardening step: all 50 policies are `TO PUBLIC` and, measured on production with no tenant GUC, `stores`/`store_users`/`products` return **0 / 0 / 0**. super-admin and storefront have **zero** `withTenant` call sites, so both are now labelled `owner` (what they have silently been). Evidence, mutation matrix and the live app-role run: `BUILD-LOG.md` [2026-08-22 15:35 UTC] + `specs/docs/tasks/2026-08-22-task-4.12-restricted-db-identity.md`.
  Still open, deliberately: `FORCE ROW LEVEL SECURITY` (0 tables — owner decision, preflight §3) and giving the cross-tenant readers a tenant context so they could move off the owner pool.

### Task 4.13: Harden First-Party Callback and Cron Authentication
- **Requirement:** `SEC-16`
- **Target Files:** `apps/admin/app/api/public/pay/callback/route.ts`, admin cron routes, `packages/lib/src/pay-callback.ts`, every caller, endpoint tests.
- **Change:** Resolve exactly one payment identity, reject ambiguous matches, and accept reusable first-party credentials only through headers or verified signatures. Remove secret-bearing query parameters from generated callback and cron URLs.
- **Done when:** Callback tests reject zero/ambiguous identities and query-only credentials; header/signature paths pass; source and log scans contain no first-party reusable secret in URLs.
- **Status:** `[x]` **DONE 2026-08-21** (SEC-16 — header-only CRON_SECRET gate + per-payment signed callback binding; also recorded in AGENTS.md)

## Stage 5: P1 High-Priority Remediation

### Task 5.1: Reconcile Remote and Local Shipment Cancellation
- **Requirement:** `F-S12`
- **Target Files:** `apps/admin/lib/actions/shipping.ts`, shipping cancellation tests, schema/migration only if a durable reconciliation state is absent.
- **Change:** Separate courier acceptance from local reconciliation. Persist a retryable reconciliation state when the courier cancels successfully but local order/shipment/ledger updates fail.
- **Done when:** Fault injection after remote success produces a durable non-success state; a retry converges without issuing a second effective cancellation or double-reversing ledger/inventory state.
- **Status:** `[x]` **DONE 2026-09-09** (BUILD-LOG "Task 5.1"). Intent (`shipment_bookings.status='cancellation_requested'`) is written BEFORE `kaCancelShipment` under the booking lock; the vendor's answer is recorded after through a best-effort helper, so a DB failure after a vendor accept loses a note, never the fact. The reconciler is the existing 15-min poller: `syncOrderFromKa` reads the pending booking back and applies the PURE decision in `apps/admin/lib/cancel-reconcile.ts` — 300/302 ⇒ booking `voided`, provider ids cleared, `dikirim→diproses` (re-bookable, never `batal`); parcel moved ⇒ booking back to `accepted`; vendor "not found" ⇒ order problem flag; down/350/booked ⇒ wait. Ledger is never touched by the reconciler (a void is not a refund). Tests: `cancel-reconcile.test.ts` (21: decision table + source claims + 6 on real Postgres), `cancel-shipment.test.ts` (9). **Known ceiling:** no `cancellation_requested_at` column, so no age-based give-up — a parcel that never moves and whose void the courier never confirms stays pending until a human looks (a migration would close it; deliberately not written here). Legacy orders with no `shipment_bookings` row cannot carry the intent and keep the old poller behaviour.

### Task 5.2: Persist or Remove Every Product Editor Control
- **Requirement:** `F-C8`
- **Target Files:** `apps/admin/app/(admin)/produk/[id]/product-editor.tsx`, `apps/admin/lib/actions/products.ts`, `packages/db/src/schema.ts` only where accepted fields already have storage.
- **Change:** Wire sales-channel and tag controls through the existing product update contract and round-trip them, or remove controls that have no accepted product behavior. Do not add speculative schema for display-only toggles.
- **Done when:** Every retained control changes a persisted field and survives reload; a focused source/contract test proves no rendered submit field is omitted from the update payload.

- **Status:** `[x]` **DONE** (BUILD-LOG "Completed Task: Stage 5 Task 5.2")
### Task 5.3: Make Store-User Invitations Retriable and Truthful
- **Requirement:** `SEC-15`
- **Target Files:** `apps/admin/lib/actions/users.ts`, `apps/admin/components/admin/pengaturan/pengguna-card.tsx`, invitation integration tests.
- **Change:** Make the database row authoritative, handle uniqueness races deterministically, and distinguish created, already invited, accepted, and failed states. Never show accepted/success solely because an email operation succeeded.
- **Done when:** Tests cover duplicate retry, concurrent invite, database failure after mail success, and an already accepted user; each UI message matches durable state and no duplicate membership is created.

- **Status:** `[x]` **DONE 2026-08-22** (SEC-15 — invites retriable + truthful, forced-race tests; CHANGELOG entry + AGENTS.md)
### Task 5.4: Distinguish Checkout Search Failure from No Results
- **Requirement:** `F-F10`
- **Target Files:** `apps/storefront/src/pages/checkout.astro`, district-search endpoint tests or browser fixtures.
- **Change:** Represent idle, loading, results, empty, and error as distinct states. Preserve typed input and offer retry after timeout/5xx; use “not found” only for a successful empty response.
- **Done when:** Browser verification covers successful selection, empty result, timeout/5xx, retry recovery, keyboard navigation, and screen-reader status messaging without losing the shopper's input.
- **Status:** `[x]` **DONE 2026-09-08** — `checkout.astro`: five explicit states (loading "Mencari…", results, empty `Kecamatan "<q>" tidak ditemukan…`, failure incl. `ok:false`/non-JSON, 10 s `AbortController` timeout) + stale-response guard (`qAtCall`/`searchSeq`, both success and failure branches). Guard `apps/storefront/src/lib/checkout-search-states.test.ts` (4 tests, 6 mutations → 6 reds). Driven in Chromium on a built server with route fixtures: `zzqx` → not-found row · `sewon` → option, pick → `dest_id=552` · 500 / `ok:false` → failure row · 12 s hang → "Mencari…" then failure at ~10.5 s, input kept · stale race (`aaa` slow, `bbb` fast) never repaints · Tab+Enter picks. `astro check` 0 errors. Not added: an `aria-live` result count (follow-up).

### Task 5.5: Remove the Shared 320 px Seller Topbar Overflow
- **Requirement:** `F-F11`
- **Related requirement:** `NF-7`
- **Target Files:** `apps/admin/components/admin/topbar.tsx`, the existing responsive audit script.
- **Change:** Fix the shared topbar layout at the component boundary; preserve store identity, balance access, menu access, focus order, and touch targets.
- **Done when:** The responsive audit reports zero horizontal overflow at 320 px on all 15 seller routes, and browser verification confirms keyboard/touch access to every topbar control.
- **Status:** `[x]` **DONE 2026-08-24** — audit `24/264 broken` (every seller route @320px, 38px, right topbar cluster) → **`OK — 264 route×width combinations, no horizontal overflow`**, measured against the wide-balance seeded store (batiknusantara, Rp214jt — a Rp0 store passes vacuously); browser pass at 320px confirmed all 7 topbar controls clickable + Tab-reachable in order, 40px hit zones via `::after`; 768/1280 unchanged. See `BUILD-LOG.md` 2026-08-24 and `specs/docs/tasks/2026-08-24-task-5.5-topbar-320.md`.

### Task 5.6: Make Product Editor Navigation Guards State-Aware
- **Requirement:** `F-C9`
- **Target Files:** `apps/admin/app/(admin)/produk/[id]/product-editor.tsx`, focused browser tests.
- **Change:** Derive dirty state from persisted form fields, install guards only while dirty, clear them after accepted save, and retain them after failed save.
- **Done when:** Browser tests cover untouched navigation, dirty navigation, cancel/continue choices, successful save then navigation, and failed save; only the dirty cases warn.
- **Status:** `[x]` **DONE 2026-09-08 — full browser acceptance matrix driven and PASSED** (`specs/docs/tasks/2026-09-08-browser-verification.md`): clean → all three controls navigate with 0 dialogs; dirty → all three prompt, Cancel keeps the edit, OK leaves; `close({runBeforeUnload:true})` fires a real `beforeunload`; a successful save clears the guard; a forced 500 on the action POST keeps it up. Confirmed ceiling: a SIDEBAR link while dirty gets no prompt (different URL space, `/store/<slug>/…`). — `product-editor.tsx:523-545` derives `dirty` by comparing `JSON.stringify(buildInput())` against `savedSnapshot` (seeded at mount, reset only on an ACCEPTED save, before `router.push`); native `beforeunload` while dirty (same shape as `tema/[id]/builder-client.tsx:40-46`); `confirmLeave` on the three `/produk` back links. Guard `product-editor-unsaved.test.ts` (5 mutations → 5 reds); census `product-editor-controls.test.ts` classifies `savedSnapshot` as local. Ceiling: sidebar/topbar navigation is not intercepted (no app-wide route guard exists) — measured, not assumed.

### Task 5.7: Add the Full Commerce Lifecycle Integration Test
- **Requirement:** `NF-9`
- **Target Files:** existing DB-coupled test harness plus one lifecycle integration test near the public-order/payment domain.
- **Change:** Exercise cart/order creation, stock decrement, one successful payment callback, duplicate callback replay, order transition, ledger credit/release, cancellation/return restoration, and tenant isolation using real PostgreSQL transactions.
- **Done when:** The test fails on duplicate credit, stock drift, cross-tenant access, or wrong order/payment transition; `npm run test:db` runs it without skips and remains deterministic in the full suite.
- **Status:** `[x]` **DONE 2026-09-08** — `apps/admin/lib/commerce-lifecycle.test.ts` (rewritten from the unmerged `c61c89c` candidate, which was green by coincidence: it never checked the gateway fee). REAL against migrated Postgres: `POST /api/public/order` (stale cart price → 409 `repriced`, 0 rows) → `payments`/`order_financials` reconcile to `paymentFee("va", …, "VABCA")` = 6.500 → `pay/callback` (wrong amount ignored; PAID replay idempotent; EXPIRED after PAID does not regress) → `creditSaleForPayment` credits GOODS only (200.000, pending) → under `set local role tokophi_app` + GUC: `baru→diproses→dikirim` (still pending) `→selesai` (available) → `requestPayout` 150.000 (`payout` row with `order_id NULL`, over-draw refused) → `selesai→retur` (stock +2, `retur` −200.000, Σ −150.000 exposure) → terminal; `selesai→dikirim/batal` refused. Test 2: RLS as store B sees 0 of A's rows and cannot update them. STUBBED at the network edge only: `quoteShipping`, `areaById`, `alCreatePayment` (same `vi.mock` pattern as `route.test.ts`). 2 tests, 3× stable; 4 product mutations → 4 reds; `afterAll` cleanup (the candidate leaked 35 stores per run). Full `TEST_DB_REQUIRED=1` suite 1183/1184 (page-map staleness only).

### Task 5.8: Decide the TokoΦ Account Release Scope
- **Requirement:** `F-K11`
- **Related requirements:** `F-K12`, `F-K13`
- **Target Files:** `specs/docs/TOKOPHI_ACCOUNT_SPEC.md`, `specs/PRD.md`, release/readiness docs that currently claim or omit the account surface.
- **Change:** Record one explicit owner decision: integrate the accepted account architecture into the production release, or defer the account and remove it from production release claims. Do not treat the standalone localStorage prototype as production evidence.
- **Done when:** One decision is recorded with owner, rationale, release impact, and acceptance boundary; every canonical product/release document agrees; implementation tasks are added only if integration is chosen.
- **Status:** `[ ]` **BLOCKED — on an owner decision** (verified 2026-09-08). No decision is recorded anywhere; the 2026-09-03 resume checklist lists it under *"keputusan lama yang masih menggantung"*. Worse, the documents this task names as targets do not exist on disk: `find specs -iname '*account*'` returns only `tasks/2026-08-12-n62-account-throttle.md`; `specs/openapi/` holds only `admin-api.yaml` + `storefront-api.yaml`; `specs/decisions/` ends at `0015`. Yet `REQUIREMENTS.md` F-K11 links `TOKOPHI_ACCOUNT_SPEC.md` + ADR `0016-global-buyer-account.md`, and `specs/README.md` links `TOKOPHI_ACCOUNT_SPEC.md`, `openapi/account.yaml`, `openapi/headless.yaml` — four dangling links in canonical documents (also counts against Task 5.14). Whichever way the owner rules, the record has to be created, not amended.

### Task 5.9: Make Multi-Store Selection Explicit and Deterministic
- **Requirement:** `F-T10`
- **Target Files:** `apps/admin/lib/auth.ts`, session/store-context actions, `apps/admin/components/admin/topbar.tsx`, auth and browser tests.
- **Change:** Replace unordered first-membership selection with an explicit authorized store context, persist the choice safely, and populate the switcher from every live membership.
- **Done when:** Two-membership tests select deterministically, switching changes tenant context, revocation invalidates the old choice, and no-membership login fails clearly.
- **Status:** `[x]` **DONE 2026-08-24** — selection contract (earliest `invited_at`, tie-break store id) in `apps/admin/lib/store-selection.ts`; `switchStore` re-mints the session after a `store_users` proof; topbar switcher lists every live membership; `store-selection.test.ts` 11 tests vs real PostgreSQL (mutation proved 3 reds); driven in a production build (login → deterministic store, switch, SQL revocation → clean signout, no 5xx). See `BUILD-LOG.md` 2026-08-24.

### Task 5.10: Enforce Payout State Transitions in the Mutation
- **Requirement:** `F-M15`
- **Target Files:** `apps/super-admin/lib/actions.ts`, payout action tests.
- **Change:** Lock the payout and require `status='diproses'` in the paid transition. Return a typed conflict for every other source state while preserving ledger entries.
- **Done when:** Tests attempt each payout status; only `diproses → selesai` succeeds, repeated completion is idempotent/non-mutating, and no ledger amount changes.
- **Status:** `[x]` **DONE 2026-08-22** — guard moved into the UPDATE's own WHERE (`payout-transition.ts`); typed conflicts; `apps/super-admin/lib/payout-transition.test.ts` drives all four source statuses against real PostgreSQL (6 mutations, 6 reds). See `BUILD-LOG.md` 2026-08-22.

### Task 5.11: Restore and Gate a Green Lint Baseline
- **Requirement:** `NF-13`
- **Target Files:** the six reported lint offenders, root `package.json`, `.github/workflows/ci.yml`.
- **Change:** Fix source-level lint errors without weakening rules, add one root command covering Admin and Super Admin, and run it in CI.
- **Done when:** The root lint command exits zero locally and is a required CI step; no ignore or rule-disable is added solely to hide the baseline.

- **Status:** `[x]` **DONE 2026-08-20** (`a414e4e` — admin lint 0 errors; ⚠️ its adjust-during-render refactor was later NOT the builder-crash culprit — see BUILD-LOG 2026-08-23 14:05, bisected to `d5bf796`)
### Task 5.12: Build Every Deployable Surface in CI
- **Requirement:** `NF-14`
- **Target Files:** root `package.json`, `.github/workflows/ci.yml`, existing workspace build configuration.
- **Change:** Add explicit production-native builds for Admin, Super Admin, Storefront, and Landing after checks/tests, reusing workspace scripts rather than introducing a build wrapper.
- **Done when:** CI configuration proves all four build commands are required; a clean local run builds each surface successfully with documented environment boundaries.
- **Status:** `[x]` **DONE 2026-09-08 — first hosted run observed green on PR #382 (build · admin / landing / super-admin all pass)** — `.github/workflows/ci.yml`: new `build` job, `needs: test`, matrix `admin | super-admin | landing`, `fail-fast: false`, 15 min timeout, `node_modules` + `.next/cache` caches keyed on the lockfile, Dockerfile-parity env (`DATABASE_RUNTIME_ROLE=owner`, dummy `DATABASE_URL`, `NEXT_TELEMETRY_DISABLED=1`, no postgres service). Storefront not repeated (`verify` already builds it). `actionlint` OK. Clean-`npm ci` local parity: landing 12,6 s · admin 52,1 s · super-admin 20,8 s, all exit 0. Estimated +6–12 billed minutes/run (repo is private → metered). First hosted run: PR #382, all three matrix legs pass. Finding: Next 16 `next build` DOES typecheck — the old comment in the `test` job is stale.

### Task 5.13: Make HTTP Contract Coverage Reproducible
- **Requirement:** `NF-15`
- **Target Files:** `specs/openapi/admin-api.yaml`, `specs/openapi/storefront-api.yaml`, `specs/openapi/account.yaml`, `specs/openapi/headless.yaml`, route inventory/validation scripts, root `package.json`, CI.
- **Change:** Inventory every HTTP route, classify internal exclusions explicitly, document accepted public operations in the owning contract, and pin syntax/coverage/breaking-change validation in the repository.
- **Done when:** `npm run verify:openapi` exits zero from a clean install, undocumented non-excluded routes fail the gate, and all owned OpenAPI files validate without relying on an ambient global tool.
- **Status:** `[x]` **DONE 2026-09-09** — `scripts/verify-openapi.mjs` (`npm run verify:openapi`): every documented operation must exist on disk (routes read from the generated `page-map.json`), every PUBLIC route on disk must be documented or listed in `x-tokophi-route-exemptions` INSIDE the spec with a ≥20-char reason (the script stores no route names), `$ref`s resolve, `operationId` unique, stale exemptions red. Drift found: 30/38 public route×methods undocumented → `POST /api/public/kiriminaja/webhook` documented from its `route.ts`; pay/callback's `?cb=<reff>.<hmac>` (Task 4.13) added, `?token=` marked legacy; 17 reasoned exemptions (same-origin beacons, feeds, robots/sitemap, auth redirects, uploads, `/impersonate`). RED-proved in `test/release-guards.test.ts` (fake op, fake public route, dangling `$ref`, reasonless exemption).

### Task 5.14: Establish One Canonical Documentation Authority Map
- **Requirement:** `NF-16`
- **Target Files:** `specs/README.md`, canonical product/architecture/security/API/operations/release documents, historical audit headers.
- **Change:** Name one owner document per concern, demote audits to dated evidence, remove conflicting “canonical/current/production-ready” claims, repair stale links, and keep repository documents as the only source of current status.
- **Done when:** An ownership-map check finds one authority per concern; all canonical links resolve; historical reports cannot be read as current certification.
- **Status:** `[x]` **DONE 2026-09-09** — `scripts/verify-doc-authority.mjs` (`npm run verify:doc-authority`): every link in `specs/README.md`, `OPEN.md`, the five root records and `AGENTS.md`'s docs table resolves; the authority table has one owner per concern; **exactly one execution queue** (root `TASKS.md`; every other `TASKS.md` via `git ls-files` must be declared a ledger and not claim to be a queue). Drift: 14 dead links (`TOKOPHI_ACCOUNT_SPEC`, `openapi/account.yaml`, ADR 0016, `PRIVACY-COMPLIANCE` exist only on unmerged `feature/buyer-account-local` `8dc12d7`; `HEADLESS_STOREFRONT_SPEC`, `openapi/headless.yaml`, `docs/OBSERVABILITY.md` never existed anywhere) → honest stubs marked **NOT WRITTEN — Task 5.8 owner decision** with pointers to the drafts, no invented content; `specs/docs/TASKS.md` declared "historical epic ledger (evidence only — not a queue)". RED-proved (dead link; ledger row removed).

### Task 5.15: Repair Active Requirement-to-Evidence Traceability
- **Requirement:** `NF-17`
- **Target Files:** `specs/docs/REQUIREMENTS.md`, `TASKS.md`, active status/evidence documents, `scripts/check-traceability.py` (new), root `package.json`.
- **Change:** Add the smallest repository-owned checker for authoritative active contracts, fix malformed tables and invalid IDs there, and map every active task to one primary requirement and runnable acceptance check. Preserve historical IDs as history, not active obligations.
- **Done when:** `npm run verify:traceability` exits zero; every Stage 4–6 task resolves to one requirement; no active requirement is silently orphaned or falsely marked verified.
- **Status:** `[x]` **DONE 2026-09-09** — `scripts/verify-traceability.mjs` (`npm run verify:traceability`): every MET row in `REQUIREMENTS.md` names ≥1 evidence that EXISTS (path/basename/glob/`migration NNNN`/`npm run X`/BUILD-LOG date), any dead path anywhere is red, every active task's `Requirement:`/`Tracing:` id resolves, orphans reported both ways. Drift: 32 MET rows had no file evidence → `— evidence:` added from grep (statuses untouched); SEC-6 pointed at the deleted `lib/mock/store.ts` → corrected; F-P9 (8.7) and SEC-19 (8.8) transcribed as NOT MET rows. Informational orphans left: Tasks 6.10/8.12/8.13 carry no requirement id; SEC-6, F-C2, F-S10, F-F5, F-P4, F-K12, F-K13, NF-7 have no active task. RED-proved (dead path; MET without evidence; task with `NF-999`).

### Task 5.16: Preserve Persisted CMS Page Bodies
- **Requirement:** `F-F12`
- **Target Files:** `apps/admin/lib/data/pages.ts`, `apps/admin/app/(admin)/halaman/[id]/page-editor.tsx`, focused page data/action and browser tests.
- **Change:** Initialize the editor from `page.body`, preserve an intentionally empty body, and remove runtime title-derived filler from the edit path.
- **Done when:** Populated and empty pages open, save, and reload without replacement text or data loss.

- **Status:** `[x]` **DONE** (BUILD-LOG "Completed Task: Stage 5 Task 5.16" — persisted CMS page bodies preserved; supersedes Task 1.1)
### Task 5.17: Enforce Platform Roles at Route Entry
- **Requirement:** `SEC-9`
- **Target Files:** `apps/super-admin/middleware.ts`, `apps/super-admin/lib/platform-auth.ts`, protected route layouts/pages, focused authorization tests.
- **Change:** Declare the minimum platform role for each protected route group and enforce it before the page loads privileged data. Keep action-level authorization as the final mutation boundary; route checks are additive, not a replacement.
- **Done when:** Direct requests from `support`, `admin`, and `owner` sessions exercise every protected route class; under-privileged sessions receive the accepted denial without privileged data loading, and all action-level guards remain green.
- **Status:** `[x]` **DONE 2026-08-22** — `lib/route-roles.ts` declares the floor per route group; `platformRouteGate(path)` runs above every page's first read. Measured live with three real operator rows across all eight route classes (9 mutations, 9 reds). Action gates untouched. See `BUILD-LOG.md` 2026-08-22.

### Task 5.18: Make Per-Courier Return Analytics Honest
- **Requirement:** `F-S8`
- **Target Files:** `apps/admin/app/api/public/order/route.ts`, `apps/super-admin/lib/data.ts`, `apps/super-admin/app/(platform)/analitik/page.tsx`, focused analytics/query tests.
- **Change:** Preserve the server-verified courier and service snapshots already written by new checkout orders. Compute per-courier delivery/return rates only from rows with known courier identity, expose known-versus-legacy-unknown coverage, and never fold unknown historical rows into a named courier or a misleading denominator.
- **Done when:** Fixtures containing current orders and legacy `courier IS NULL` rows show correct per-courier numerators/denominators plus an explicit unknown coverage count; the report cannot present unknown history as zero returns or as “Tidak diketahui” performance.
- **Status:** `[x]` **DONE 2026-09-08** — `lib/data/returns.ts` groups on `nullif(o.courier,'')`, returns `{ byCourier, unattributed }`; the NULL group is never a row and its returns are discarded. `dashboard.ts` `ReturnSummary.unattributed`; `return-by-courier.tsx` + Pesanan → Pengembalian (`return-summary.tsx`, dead `"Tidak diketahui"` caveat deleted) both render ONE `unattributedNote(n)` sentence. Real-Postgres guard `lib/data/returns.test.ts` (2 tests under `tokophi_app`; the old `coalesce(...'Tidak diketahui')` put back → red) + `return-summary.test.ts` (3). Super-admin has no per-courier report to fix (audit).

### Task 5.19: Resolve COD Return Economics and Reserve Policy
- **Requirement:** `F-S9`
- **Related requirement:** `F-S10`
- **Target Files:** one new numbered decision record under `specs/decisions/`, `apps/super-admin/app/(platform)/pengaturan/pengaturan-client.tsx`, `apps/super-admin/lib/data.ts`, `packages/db/src/schema.ts`, COD policy tests and canonical product/release docs.
- **Change:** Obtain written KiriminAja/SPX return-cost terms and record the owner decision. Until evidence exists, keep COD policy restrictive and remove unsupported “free return” claims. Do not activate or charge the unused `platform_cod.fee_pct`; if a platform reserve fee is approved, define payer, taxable base, VAT, refund/return treatment, ledger ownership, and immutable order snapshot, then add the resulting implementation tasks before changing checkout totals.
- **Done when:** The decision record cites the provider evidence or states it is unavailable; UI, schema status, policy code, and release claims agree; COD cannot widen because of an unverified premise; no fee is charged without the complete accepted money contract and its own executable tasks.
- **Status:** `[ ]` **BLOCKED — on written KiriminAja/SPX return terms (owner/provider)**. Honest-label half DONE 2026-08-31 (BUILD-LOG 17:32 UTC, PR #376): the super-admin Pengiriman note now says *"diyakini gratis di SPX … belum diverifikasi tertulis"* (`pengaturan-client.tsx`) and `platform_cod.fee_pct` is marked a dead column in `schema.ts`. Still missing: the decision record (`specs/decisions/` ends at `0015`), the provider evidence, and any fee contract. Do not activate `fee_pct` before both exist.

### Task 5.20: Verify the Real Google OAuth Contract
- **Requirement:** `F-T6`
- **Target Files:** `apps/admin/app/api/auth/google/start/route.ts`, `apps/admin/app/api/auth/google/callback/route.ts`, auth/session tests, canonical operations/readiness docs.
- **Change:** With owner-provided test OAuth credentials supplied only through the environment, exercise start, state validation, callback, existing-user login, new-user policy, provider denial, replay, and disabled-feature behavior. Fix only contract failures proven by the smoke test; never copy credentials into fixtures, logs, or documents.
- **Done when:** A real test-account browser run completes the accepted login/session flow; invalid state, replay, denial, and disabled configuration fail safely; operations docs name required configuration and evidence boundaries without exposing credentials.
- **Status:** `[ ]` **BLOCKED — on owner-provided test OAuth credentials** (verified 2026-09-08). Both routes exist (`apps/admin/app/api/auth/google/{start,callback}/route.ts`), `DEPLOY.md:566` documents `GOOGLE_CLIENT_ID` empty = button hidden, and no test file names `google`. `REQUIREMENTS.md` F-T6 still reads **UNVERIFIED — never run against real Google credentials**; the 2026-09-03 resume checklist lists the credentials as pending owner input.

### Task 5.21: Derive the Store Avatar Initials from the Store Name
- **Requirement:** `F-T1` (tenant correctness of every rendered store fact)
- **Tracing:** page-map report AD-3 🔴 (`specs/docs/tasks/2026-09-04-page-map-report.md`)
- **Target Files:** `apps/admin/app/(admin)/pengaturan/page.tsx`, one focused source test beside it.
- **Change:**
  1. Replace the literal `BN` inside `<AvatarFallback>` (`page.tsx:167-169`) with initials derived from the `storeName` the same component already reads via `useStoreName()` at :173 — first letter of the first two words, upper-cased, with a safe fallback for an empty name.
  2. Add a `codeOnly()` source test that fails if a literal two-letter string returns to that fallback, and a unit test for the derivation (one word, two words, empty).
- **Done when:** Every tenant's Pengaturan renders its own initials (driven for two seeded stores in a browser); the source test is red against the old literal; `tsc` and lint stay green.
- **Status:** `[x]` **DONE 2026-09-08** — `pengaturan/page.tsx:168` `BN` → `initials(storeName)` via new `components/admin/initials.ts` (+5-case test); `blog/author-cell.tsx` and `topbar.tsx` de-duplicated onto it; topbar avatar-menu fallbacks that named the seeded owner (`"Ongki Pratama"`, `owner@tokophi.id`, `OP`) removed ("no shipped screen names an account that authenticates"). 571 admin tests + credential scanner green. Left: three private `initials()` copies in `pesanan/[id]`, `pelanggan/`, `crm/followup/`.

### Task 5.22: Build Catalog Feed Origins from `locals.origin`, Not the Raw `Host`
- **Requirement:** `F-F3` / ADR 0009 (tenant + canonical origin resolved by the middleware, once)
- **Tracing:** page-map report SF-1 🔴
- **Target Files:** `apps/storefront/src/pages/feed/google.xml.ts`, `apps/storefront/src/pages/feed/tiktok.xml.ts`, `apps/storefront/src/lib/product-feed.test.ts`.
- **Change:**
  1. Both feeds currently do `const host = request.headers.get("host"); const store = await getStoreByHost(host); const origin = \`https://${host}\`` (google :14-17, tiktok :15-18). Read `{ store, catalog, origin }` from `locals` exactly as `sitemap.xml.ts:24` does — the middleware already set `locals.origin = primaryOrigin(store, …)` honouring `x-forwarded-*` and the store's primary custom domain.
  2. Delete the second `getStoreByHost` resolution; one tenant resolution per request.
  3. Extend `product-feed.test.ts` with a `codeOnly()` claim that neither feed file reads `headers.get("host")` or builds a `https://${…}` origin, proved red against the current file first.
- **Done when:** With a store that has a primary custom domain, `/feed/google.xml` and `/feed/tiktok.xml` fetched over `<slug>.tokophi.com` emit `<link>`/`<g:link>` on the custom domain (same origin the sitemap and canonicals use); locally the feed no longer emits `https://localhost:43xx`; the source test is green and was red before.
- **Status:** `[x]` **DONE 2026-09-08** — both feeds now `const { store, catalog, origin } = locals` like `sitemap.xml.ts`; `getStoreByHost`/`getCatalog` imports dropped. New `apps/storefront/scripts/check-feed-origin.mjs` registered in `run-checks.mjs` `CHECKS`: feed `<link>`/`g:link` must equal the sitemap origin under differing `x-forwarded-host/proto`. Measured on a built server (`Host: kopi-senja.test`, `x-forwarded-host: toko-kopi.example.test`): before `https://kopi-senja.test`, after `http://toko-kopi.example.test` = sitemap. The check run against the pre-fix build → 2 FAIL, exit 1.

### Task 5.23: One Shared `isUuid` Guard on Every `[id]` Page of Both Panels
- **Requirement:** `NF-5` (a 4xx where a 4xx belongs; no 500 from a URL segment)
- **Tracing:** page-map report SA-3 + AD-1 🟠; AGENTS.md *"`isUuid` before any `eq(table.id, segment)`"*
- **Target Files:** `packages/lib/src/uuid.ts` (new, moved from `apps/admin/lib/uuid.ts`), `apps/admin/lib/uuid.ts` (re-export or delete + update importers), `apps/super-admin/app/(platform)/toko/[id]/page.tsx`, `apps/super-admin/app/(platform)/tiket/[id]/page.tsx`, `apps/admin/app/(admin)/{bantuan,blog,halaman,pelanggan,tema}/[id]/page.tsx`, `apps/admin/app/(admin)/produk/kategori/[id]/page.tsx`, one new test that derives the `[id]` page list from the directory.
- **Change:**
  1. Move `isUuid` into `@tokophi/lib` (pure, no DB — the same split as `platform-rank.ts`); `apps/super-admin/lib/activity-log.ts` already needs it and cannot import from `apps/admin`.
  2. Guard the eight unguarded pages with `if (!isUuid(params.id)) notFound()` BEFORE the first read — `toko/[id]` fires eleven reads in a `Promise.all` before it checks `if (!store)`. `/pesanan/[id]` (keyed on `orders.number`) and `/produk/[id]` (own number/UUID regex) are the documented exemptions.
  3. Add `test/id-pages-guarded.test.ts` that walks both `app/` trees for `[id]/page.tsx`, reads each with `codeOnly()`, and fails on any page that reaches `eq(` without `isUuid(` — with an explicit allow-list for the two exemptions, so the ninth page cannot ship unguarded.
- **Done when:** `/toko/abc`, `/tiket/1`, `/blog/1`, `/pelanggan/x` (etc.) answer 404, not 500 (`22P02`), driven against a dev server; the directory-derived test is green and is red when any one guard is removed.
- **Status:** `[x]` **DONE 2026-09-08** — ONE implementation `packages/lib/src/uuid.ts` (`@tokophi/lib/uuid` export; `apps/admin/lib/uuid.ts` re-exports); `if (!isUuid(id)) notFound()` above the first data read on all eight pages (six admin, two super-admin — after `platformRouteGate`). Guards: `packages/lib/src/uuid.test.ts` + `apps/admin/lib/uuid-guard.test.ts` (12 pages read as CODE, ordering asserted, mutation self-check on a copy; guard deleted from `blog/[id]` → red).

### Task 5.24: Run the Media Library Reads Under the Tenant Wrapper
- **Requirement:** `F-T1` / `SEC-1` (every admin tenant read executes under RLS as `tokophi_app`)
- **Tracing:** page-map report AD-2 🟠; AGENTS.md *"Do NOT use a bare module-level `db` for admin tenant data"*
- **Target Files:** `apps/admin/lib/actions/media.ts` (`getMedia` :77-81, `getMediaPage` :88-105), a focused test.
- **Change:**
  1. Wrap both reads in `withCurrentTenant(async (db, storeId) => …)` and filter on the `storeId` it hands back, matching the three writers in the same file that already use `withTenant`.
  2. Add a `codeOnly()` claim that `media.ts` has no `db.select` outside a `withTenant`/`withCurrentTenant` callback, proved red first.
- **Done when:** `/files` and the Store Builder image picker still list this store's media; on `DATABASE_RUNTIME_ROLE=app` the two reads execute as `tokophi_app` (visible in `verify-rls-app` or a `current_user` probe); the source test is green.
- **Status:** `[x]` **DONE 2026-09-08** — `getMedia`/`getMediaPage` run inside `withCurrentTenant(async (db, storeId) => …)`; `storeId` WHERE kept; unused `getSession` import removed; writers untouched.

### Task 5.25: Rate-Limit `api/chat/read`
- **Requirement:** `NF-6` (every public write path carries a quota)
- **Tracing:** page-map report SF-2 🟠; `page-map.json` — the only chat endpoint with an empty gate column
- **Target Files:** `apps/storefront/src/pages/api/chat/read.ts`, `apps/storefront/src/lib/chat.ts` (`LIMITS`).
- **Change:** Add the same per-IP `rateLimit` gate `poll.ts:24` uses (`chat:read:ip:<ip>`, a `LIMITS.readPerIpMin` entry beside `pollPerIpMin`) before the conversation is resolved and the two-UPDATE transaction runs. 429 shape identical to `poll`.
- **Done when:** `read.ts` shows `rate-limit` in the regenerated `PAGE_MAP.md` gate column (`node scripts/gen-page-map.mjs --check` clean); a loop past the quota receives 429 with no DB write; `poll`/`send` limits unchanged.
- **Status:** `[x]` **DONE 2026-09-08** — `LIMITS.readPerIpMin = 30/min` in `src/lib/chat.ts`; `api/chat/read.ts` gates like `poll.ts` (429 `{ok:true}`, the client is fire-and-forget). Measured: 33 POSTs from one IP → 30×200 then 429 from the 31st.

### Task 5.26: Publish the BlogPosting Logo Through `mediaUrl`
- **Requirement:** `F-F4` (structured data must resolve)
- **Tracing:** page-map report SF-3 🟠
- **Target Files:** `apps/storefront/src/pages/blog/[handle].astro` (:84).
- **Change:** Replace `abs(store.logoUrl)` in the BlogPosting JSON-LD with `mediaUrl(store.logoUrl)` — `store.logoUrl` is `/api/uploads/<name>`, served by the ADMIN app, so the absolute storefront URL 404s. `Layout.astro:85` and `index.astro:119` already do this and document why.
- **Done when:** The rendered JSON-LD `logo.url` on a blog post fetches 200; a `textWithoutComments` claim on the file fails if `abs(store.logoUrl` returns.
- **Status:** `[x]` **DONE 2026-09-08** — `blog/[handle].astro` JSON-LD `logo: abs(mediaUrl(store.logoUrl))`; served page shows the admin/media origin instead of a storefront-origin 404.

## Stage 6: P2 Hardening

### Task 6.1: Separate Offline Checks from Release Evidence
- **Requirement:** `NF-18`
- **Target Files:** root `package.json`, DB test setup/output, `specs/docs/DEVELOPMENT_READINESS.md`, release gate documentation.
- **Change:** Give offline and DB-required suites distinct commands and labels; make the release command require the dedicated test database and fail on skipped DB-coupled suites. Remove stale claims that a build runs lint when it does not.
- **Done when:** The offline command reports its boundary, the release command cannot pass without all DB suites, and canonical readiness docs name the exact commands without equating the two.
- **Status:** `[x]` **DONE 2026-09-08** — root `package.json` `test:release` = `verify-migrations && test:db && verify-rls && verify-rls-app && storefront verify` (composition only); `test` prints its offline boundary. `specs/docs/DEVELOPMENT_READINESS.md` §7 documents both commands. First run on the half-edited tree: exit 1 in 45 s from three transient reds (page map stale, census, in-flight checkout test) — `verify-migrations` and `test:db` (no skips) passed; `verify-rls`/`verify-rls-app` exit 0 run separately. Re-run green at integration (see BUILD-LOG).

### Task 6.2: Add Direct Tenant Isolation for `inventory_levels`
- **Requirement:** `F-T8`
- **Related requirements:** `SEC-1`, `F-T1`
- **Target Files:** `packages/db/src/schema.ts`, one new numbered migration, `packages/db/src/verify-rls.ts`, `packages/db/src/verify-rls-app.ts`.
- **Change:** Enforce direct-ID store isolation through an accepted RLS policy derived from the variant/product ownership chain, without adding a denormalized `store_id` unless the policy cannot be made safe and performant otherwise.
- **Done when:** Restricted-role tests prove cross-store select/update/delete by known row id returns or affects zero rows; same-store operations still pass; migration and Drizzle schema remain in parity.
- **Status:** `[x]` **DONE 2026-08-23** — migration **0100**, no denormalized `store_id`: the policy derives ownership through `variant_id → product_variants.store_id`. ⚠️ `USING` checks the variant; `WITH CHECK` checks the variant **and** the location — without that asymmetry a tenant could write its own variant against **another store's location**, a row that reads as ours and corrupts their stock picture. `schema.ts` untouched (drizzle does not model policies, so parity holds); `inventory_levels` removed from `verify-rls.ts` `REVIEWED_CHILD_TABLES` — it is no longer un-RLS'd. 6 restricted-role tests, **4 policy mutations / 4 reds**; repo 126 files / 1041 tests green. See `specs/docs/tasks/2026-08-23-inventory-levels-tenant-isolation.md`.

### Task 6.3: Move Public Rate Limits to Shared Production Enforcement
- **Requirement:** `NF-6`
- **Related requirement:** `F-F5`
- **Target Files:** `apps/admin/lib/public-guard.ts`, `apps/storefront/src/pages/api/track.ts`, production edge configuration and focused multi-instance tests.
- **Change:** Enforce the existing endpoint quotas in a shared production boundary that survives process restart and scales across replicas. Keep local development deterministic without silently weakening production.
- **Done when:** A multi-instance test cannot exceed the configured quota by alternating instances; restart does not reset the production counter; endpoint-specific limits and 429 responses remain documented and verified.
- **Status:** `[x]` **DONE 2026-09-09** — store is **Postgres**, migration **0106_rate_limit_counters** (stamp `1787545171751`, above both the journal's `0105` and the dev DB's newest applied). One row per key, bumped by a single atomic `insert … on conflict do update … returning`; no `store_id` (no tenant to scope to) and **RLS enabled with no policy**, the same setting as `impersonation_grants` — owner connection only, and it keeps the table out of `verify-rls` check 6. Cloudflare was rejected as the *implementation*: it is zone configuration this repo cannot create, and **the edge cannot see an ACCOUNT** — the per-account brake keys on an email inside a server action's POST body. It stays the recommended outer wall.
  New `packages/lib/src/rate-limit.ts` (pure: `decide`/`bump`/`mergeShared`/`onBackendFailure`, no `server-only`, no DB — which is what lets the storefront reach it) + `rate-limit-store.ts` (the statement, health, write-behind). `apps/storefront/src/lib/chat.ts`'s **second hand-rolled copy is gone**, delegating to the same two modules.
  ⚠️ **`rateLimit()` keeps its synchronous signature, so no call site changed** — a sync function cannot do I/O, so the shared count is applied **write-behind** and merged back as `max(local, shared)`. Cost, stated in the code and in `SECURITY.md` §9: the first call for a key on a fresh process is answered before the shared count is known (**one request per key per replica, where it used to be a whole fresh quota on every deploy**), and a burst inside one round-trip can overshoot. Making `rateLimit` async at its ~20 call sites is the follow-on.
  **Fail mode per bucket:** `login:*` / `signup:*` **CLOSED** (both already read `users` on the next line, so a database that cannot serve the counter cannot serve the sign-in — no new outage, and it removes a silent downgrade to per-replica counting); `order` / `ongkir` / `promo` / `paycb` / `chat` / `tracking-*` / unknown **OPEN** (refusing a real shopper for a fault of ours is the worse bug; a refused pay callback strands a paid order at `menunggu`). Strict only after one successful bump in the process, so a machine with no database is the old limiter and nothing worse.
  Per-ACCOUNT counter: `recordFailedLogin`/`failedLoginLocked` already existed (N62) but were per-process; the streak is now bumped into the same shared row (`loginfail:<surface>:<email>`) and `clearFailedLogins` deletes it, so a lock survives a deploy and a successful sign-in does not leave a stale count behind to re-arm it.
  Tests: `rate-limit.test.ts` (36, pure table incl. the strict list pinned both ways) + `rate-limit-store.test.ts` (9, real Postgres, every transaction rolled back, backend INJECTED so it never touches the shared dev DB; two module-graph "replicas" alternating share one quota (4 served on a limit of 3, not 6), a restart is refused on its second call, the window rolls in the row, 20 concurrent bumps count 20). **8 mutations / 8 reds** (revert to the Map ⇒ 4 red; drop the loginfail bump ⇒ 1; drop the clear ⇒ 1; `mergeShared` ignoring an older shared window ⇒ 2). Verify: `vitest packages/lib packages/db` 44 files/376 green · full repo 1368/1369 (the one red is `page-map-fresh`, stale from OTHER agents' new test files — regenerating would sweep their work into this diff) · `tsc` lib/db/admin/super-admin 0 · `check:storefront` 0 · `astro build` green (proves Rollup resolves the new cross-package imports, the exact wall that created the second copy) · `verify-migrations` green. Docs re-derived: `SECURITY.md` §9 + §10, `AGENTS.md`, `SCHEMA.md`, `CODE_MAP.md`, `STATUS.md`, index census.

### Task 6.4: Remove Unused Direct Dependencies
- **Requirement:** `NF-19`
- **Target Files:** workspace `package.json` files, root lockfile, import audit.
- **Change:** Confirm each reported dependency against runtime, build, test, and config imports; remove only unreferenced direct dependencies and regenerate the authoritative lockfile.
- **Done when:** Dependency audit is clean and all four production builds plus focused tests pass from a clean install; no dependency is removed solely from a heuristic report.
- **Status:** `[x]` **DONE 2026-09-09** — 7 workspaces audited (grep for every import form + config/script/peer use, then a raw re-grep per candidate). **15 entries removed across 3 manifests**: admin `@tiptap/*` ×4 (only importer is `packages/ui`, which declares them), admin + super-admin `@base-ui/react`/`class-variance-authority`/`clsx`/`tailwind-merge` (both apps are 100% on `@tokophi/ui`, which declares them), admin + super-admin `date-fns` (0 importers repo-wide), storefront `@tokophi/data` (only in two comments saying it was removed). Kept-with-reason table in BUILD-LOG (shadcn/tailwind/eslint/types/peers/`sharp`/`playwright`/`dotenv-cli`/`tsx`). Root: nothing to remove (`typescript` declared in 5 places with differing ranges — consolidation candidate, filed under 6.8's follow-up). Lockfile regenerated `--package-lock-only` (−25 lines; only `date-fns` leaves the tree). tsc 0 ×4, `check:storefront` 0, landing build 0. The four clean-install builds are proven by the CI `build` matrix on the PR (Task 5.12), not locally.

### Task 6.5: Sanitize or Reject Active SVG Uploads
- **Requirement:** `SEC-17`
- **Target Files:** `apps/admin/lib/actions/media.ts`, focused upload tests.
- **Change:** Validate actual content, then either sanitize SVG against a strict allowlist or reject SVG while keeping supported raster formats. Do not trust filename extension or client MIME.
- **Done when:** Tests reject or neutralize scripts, event handlers, `foreignObject`, remote references, and MIME/extension mismatch; valid supported images still upload and render.
- **Status:** `[x]` **DONE 2026-08-23** — REJECTS, does not sanitise (a partial strip ships a file believed clean — same ruling as `set:html`). `lib/image-content.ts` is pure: `sniffImageKind` reads magic bytes + an SVG root surviving BOM/prolog/DOCTYPE/comments, `activeSvgConstruct` names the offender. ⚠️ The gate went into **`lib/image-store.ts`**, not the `lib/actions/media.ts` this entry names: `saveImage` has two importers and the other one is the store LOGO (`actions/store-profile.ts`) — gating the named file would have left that path open. 16 tests; full repo 126 files / 1041 tests green. The CSP on `api/uploads/[name]` remains the execution boundary — two layers, keep both. See `specs/docs/tasks/2026-08-23-svg-upload-content-gate.md`.

### Task 6.6: Split the Two Oversized Release-Critical Modules
- **Requirement:** `NF-12`
- **Target Files:** `apps/storefront/src/pages/checkout.astro`, `apps/admin/app/(admin)/produk/[id]/product-editor.tsx`, existing package scripts/CI.
- **Change:** After functional fixes land, extract only cohesive state/behavior already present into stack-native modules/components; add an enforceable size budget for these entry files. Do not introduce generic frameworks or one-implementation abstractions.
- **Done when:** Both entry files are below the accepted threshold, their existing browser contracts remain green, and the size guard fails when either file regresses above the configured limit.
- **Status:** `[~]` **GUARD DONE 2026-09-09; the split itself deliberately NOT done** — `scripts/verify-source-size.mjs` (`npm run verify:source-size`) pins `checkout.astro` ≤ 2864 and `product-editor.tsx` ≤ 1582 (today's `wc -l`; lowering is always allowed, raising must ship with a reason in the same commit; upgrade path in the header). Splitting a 2.8k-line checkout that carries the money path is its own reviewed refactor, not a sweep item. RED-proved (11-line file vs ceiling 10).

### Task 6.7: Remove Runtime Mock Fixtures from Production Type Paths
- **Requirement:** `NF-20`
- **Target Files:** `apps/admin/lib/mock/store.ts`, all 51 current type-only consumers, `apps/admin/lib/types/domain.ts` (new).
- **Change:** Move only consumed types into the admin's canonical domain-type module, migrate every importer, then delete the unreferenced generated runtime fixture source.
- **Done when:** Production source and bundles contain no mock fixture generator, all 51 former consumers typecheck, and no duplicate domain type remains in another module.
- **Status:** `[x]` **DONE 2026-09-09** — all 51 importers of `lib/mock/store.ts` were `import type` (48 production, 3 tests), 0 runtime fixture users, so the debt was the module's existence. New `apps/admin/lib/types/domain.ts`: 7 unions DERIVED from `@tokophi/db` enums via a type-only import (`OrderStatus`, `POStatus`, `Segment`, `ReviewStatus`, `LeadStage`, `FollowupType`, `FollowupStatus`), the rest moved verbatim because they are VIEW shapes (`minutesAgo`, joined names) or a vocabulary that differs from the column (`DiscountType`, `NavItemType`, `LeadSource` — each annotated). `lib/mock/` deleted; guard `apps/admin/lib/no-runtime-mock.test.ts` (15 tests, directory-walked, 7 red shapes / 6 green shapes, proved red on a resurrected copy). Follow-on closed in the same sweep: `@tokophi/data` had ZERO code importers repo-wide → removed from admin `package.json` + `transpilePackages`, `packages/data` deleted, lockfile −34 lines, `CODE_MAP`/`SYSTEM_MAP`/`AGENTS.md` updated. tsc admin 0, eslint 0, 74 files / 653 admin tests green.

### Task 6.8: Standardize Package Manager and Lockfiles
- **Requirement:** `NF-21`
- **Target Files:** root/workspace package manifests, lockfiles, CI and contributor commands.
- **Change:** Choose the repository's established package manager, declare it once, remove conflicting nested/alternate lockfiles after verifying they are not independent projects, and align CI/install commands.
- **Done when:** A clean install uses one authoritative lockfile with no mutation, every workspace check/build runs through the declared manager, and CI rejects lockfile drift.
- **Status:** `[x]` **DONE 2026-09-08** — package manager is npm by evidence (four Dockerfiles `npm ci`, `ci.yml:96`); `"packageManager": "npm@11.17.0"` added; deleted root `pnpm-lock.yaml` (one importer: typescript+vitest), `packages/lib/pnpm-lock.yaml` (jose only), `apps/admin/package-lock.json` (pre-monorepo `name: admin`, the source of Next's "multiple lockfiles" warning). `npm ci --dry-run` exit 0. Not added: a CI step refusing a re-appearing non-npm lockfile (`test ! -e pnpm-lock.yaml`) — one line for the next `ci.yml` change.

### Task 6.9: Persist Per-Store Public Contact Email
- **Requirement:** `F-F7`
- **Target Files:** `packages/db/src/schema.ts`, one new numbered migration, `apps/admin/lib/actions/profile.ts`, `apps/admin/components/admin/pengaturan/store-profile-card.tsx`, `apps/storefront/src/pages/kontak.astro`, focused tenant/action and browser tests.
- **Change:** Add one nullable, validated public contact email owned by the store profile; round-trip it through the existing tenant-scoped profile action and render it only for that store. Remove any shared email fallback; an unset email is an honest empty state.
- **Done when:** Two-store tests persist and render different emails without cross-tenant access; invalid addresses are rejected; clearing the field survives reload and does not expose a shared placeholder.
- **Status:** `[x]` **DONE 2026-08-24** — ⚠️ **Most of F-F7 predated this task**: `stores.email` landed in migration **0070** (nullable, idempotent) with shape-only validation (`emailError`, `@tokophi/lib/validate`), the tenant-scoped round-trip in **`apps/admin/lib/actions/store-profile.ts`** (NOT `lib/actions/profile.ts`, which is the USER profile), the Pengaturan card field, and the footer render. **The assigned migration number 0101 is deliberately UNUSED** — re-adding a column 0070 already owns would be a split source of truth; journal head stays 0100 and there is nothing to apply at merge. What this task delivered: `kontak.astro` now renders THIS store's email conditionally (its comment still claimed the column did not exist, and the page rendered no email even when set) + `apps/admin/lib/actions/store-profile.test.ts` (real Postgres: two-store isolation, 0058 raw-read invisibility, invalid rejected, clear → NULL survives reload) + `apps/storefront/src/lib/kontak-email.test.ts` (no email-shaped literal in emitted text, conditional render, mutation self-checks). Verified: vitest 129 files / 1074 tests, `astro check` 0 errors / 14 hints, tsc admin+db 0, served HTML per tenant (email set → rendered; unset → 200 with zero email markup). See `specs/docs/tasks/2026-08-24-task-6.9-store-email.md`.

### Task 6.10: Generated Page Map for All Four Surfaces
- **Requirement:** documentation integrity (`CODE_MAP.md` said "39 routes" over a directory holding 55; `SYSTEM_MAP.md` still described the impersonation JWT replaced by Task 4.11).
- **Target Files:** `scripts/gen-page-map.mjs` (new), `specs/docs/PAGE_MAP.md` + `specs/docs/page-map.json` (generated), `test/page-map-fresh.test.ts` (new), `specs/docs/tasks/2026-09-04-page-map-report.md` (findings), pointers in `AGENTS.md`, `specs/README.md`, `CODE_MAP.md`, `SYSTEM_MAP.md`.
- **Change:** Derive the route inventory of Seller, Super Admin, Storefront and Landing from the tree — URL → file, client components, `lib/data`/`lib/actions` imports, declared gate, tests naming the route — reading CODE not text (`codeOnly`), and pin the committed copy fresh by a test. Sweep every route while building it and record findings with severity in the report.
- **Done when:** `node scripts/gen-page-map.mjs --check` is clean; a new `page.tsx`/`.astro` fails `npm test` until regenerated; the report's findings are re-read at the cited line.
- **Status:** `[x]` **DONE 2026-09-04** — 129 routes mapped (56+3+18 admin · 11+2+1 super-admin · 18+10 storefront · 9+1 landing). Report: 5 SA, 4 LP, 8 AD, 12 SF, 4 RH, 2 G findings — **2 🔴** (AD-3 hard-coded `BN` initials on every tenant's Pengaturan; SF-1 feeds build origin from raw `Host`, not `locals.origin`) and the rest 🟠/🟡/⚪; fix order in report §7. Fixing them is **not** this task. See BUILD-LOG 2026-09-04.

### Task 6.11: Convert the 66 Served HTML Comments in the Storefront to JSX Comments
- **Requirement:** `NF-4` (no internal history, paths or measurements in a shopper's view-source)
- **Tracing:** page-map report SF-5 🟡; AGENTS.md *"`<!-- … -->` in an `.astro` file is served to the browser"*; memory `ai-footprint-scope`
- **Target Files:** 12 storefront files — `produk/[handle].astro` (12), `checkout.astro` (9), `blog/[handle].astro` (8), `keranjang.astro` (7), `layouts/CheckoutLayout.astro` (7), `index.astro` (6), `layouts/Layout.astro` (6), `checkout/sukses.astro` (5), `kontak.astro` (2), `kategori/[handle].astro` (2), `blog/index.astro` (1), `promo/index.astro` (1); one new source test.
- **Change:**
  1. Convert each `<!-- … -->` in template position to `{/* … */}`. The ONE that must stay HTML — `CheckoutLayout.astro:127-132`, which explains the JSX-comment trap — gets a sentence saying so.
  2. Add a test that counts `<!--` across `apps/storefront/src/**/*.astro` with `textWithoutComments` (HTML comments survive it by design) and pins the count at the allow-listed one, so a new served comment fails `npm test`.
- **Done when:** A production build's HTML for the homepage, a PDP, the cart, the checkout, `/checkout/sukses`, a blog post and `/kontak` contains zero `<!--` other than the allow-listed one; the count test is green; `astro check` 0 errors. Own PR — mechanical and large.
- **Status:** `[x]` **DONE 2026-09-08** — 66 → 1 in the 12 files (1 kept on purpose in `CheckoutLayout.astro:127` with a line saying so; 2 became plain `/* */` in JS-expression context) plus 16 in six components (`Header`, `Chat`, `sections/Hero`, `RevealGrid`, `ProductCard` ×32 per page, `OrderFunnel`) → 0. Served HTML (built server, tenant Host): `/` 32→0 · `/produk/celana-kulot` 29→0 · `/keranjang` 26→0 · `/blog` 18→0 · `/promo` 27→0 · `/checkout` 16→1. `astro check` 0 errors, 116 storefront tests green.

### Task 6.12: Give the Remaining Bare `<img>`s a Real `srcset`
- **Requirement:** `NF-1` (storefront performance budget — see AGENTS.md "Storefront performance")
- **Tracing:** page-map report SF-8 🟡
- **Target Files:** `index.astro:251`, `kategori/index.astro:60`, `blog/[handle].astro:192,272`, `promo/index.astro:61`, `thanks.astro:103`, `keranjang.astro:235`, `checkout.astro:1170`, `checkout/sukses.astro:121`; `src/data/catalog.ts` (`imageSrcSet`); possibly `SearchPalette`-style server-side srcset for cart thumbs from `localStorage.cart.image`.
- **Change:**
  1. MEASURE first (the rule this section of AGENTS.md was written under): bytes served vs. box size per site at DPR 2, on the seeded store and on a merchant-upload store.
  2. Category tiles, promo tiles, blog images: use `imageSrcSet` + a `sizes` derived from the component's own layout, named as a constant with the arithmetic written out.
  3. Cart/checkout/sukses thumbs come from `localStorage.cart.image`; follow the search-palette pattern (ladder built server-side, shipped with the cart line) rather than shipping the 5 KB width manifest to the browser.
- **Done when:** Each site's `currentSrc` at 320/768/1280 px is the rung for its box (browser check, not markup); the byte delta is recorded in `BUILD-LOG.md`; no `w` descriptor is asserted by hand (`check-image-widths.mjs` stays green).
- **Status:** `[x]` **DONE 2026-09-09 — measured first, then fixed, then re-measured.** Worst offenders at DPR 2: `/thanks` 80 px thumb pulling a 600w original (**3,85×**, 14 252 → **1 416 B, −90%**), `/checkout` mobile bar 36 px box on a full upload (**8,33×**), `/checkout/sukses` 56 px (**5,36×**), `/kategori` tiles 1,65× (14 252 → 4 200 B). Merchant uploads now ride the `?w=` ladder (`/keranjang`, `/checkout`, `/sukses`: 77 772 → **8 692 B per row** measured against the real production files); `/blog/[handle]` feature + "Baca juga" → `?w=800` at 412 px (77 772 → 58 536 B). Every `sizes` is a named constant with its arithmetic written out (`TILE_SIZES`, `FEATURE_SIZES`, `RELATED_SIZES`, `BANNER_SIZES`, `THUMB_SIZES`, `BAR_THUMB_SIZES`). Cart thumbs come from `localStorage`, so there is no server round-trip to hand them a srcset (the search-palette pattern does not apply): `UPLOAD_WIDTHS` is exported ONCE from `catalog.ts` and injected via `define:vars`, so no width is re-typed; static seed images stay bare deliberately — shipping the 5 KB `static-image-widths.ts` manifest to every visitor for a few thumbnails is the regression `check-search-srcset` exists to prevent, and it affects the demo store only. `#summary2-thumb` sets `srcset` BEFORE `src` (the hero-carousel trap). New `scripts/check-page-srcset.mjs` registered in `CHECKS`, 8 routes × 3 viewports, 4 mutations — 3 red, and the 4th (a `100vw` over-claim on small seed images) reported HONESTLY as beyond the ratio arm's reach. `check:storefront` 0 · `verify` **8/8 PASS** · `checks-registered` 4/4.

### Task 6.13: Close the Remaining 🟡 Page-Map Hygiene Findings
- **Requirement:** documentation/code hygiene (`NF-4`, `NF-16`)
- **Tracing:** page-map report SF-4, SF-6, SF-7, SF-9, SF-10, SF-11, AD-4, AD-6, LP-1, LP-2, LP-3 (all 🟡/⚪ and still open on 2026-09-08)
- **Target Files:** `apps/storefront/src/pages/{kontak,keranjang,thanks,checkout,lp/[slug]}.astro`, `src/layouts/{LandingLayout,CheckoutLayout}.astro`, `apps/admin/lib/data/{checkout,collections,payments,theme}.ts`, `apps/admin/lib/actions/taxonomy.ts`, `apps/landing/Dockerfile`, `apps/landing/src/layouts/Base.astro`.
- **Change:**
  1. **SF-4** — drop the hard-coded *"Jam Operasional Senin–Jumat 09.00–17.00 WIB"* (`kontak.astro:66-68`) or add a store setting; derive the cart trust line (`keranjang.astro:133` *"transfer bank & QRIS"*) from `enabledPaymentChannels()` as `index.astro:22-43` does; remove the static **ADMIN ONLINE** pill and the English *"Safe Checkout · Quality Guaranteed"* from `thanks.astro:62,217`.
  2. **SF-9** — `lp/[slug].astro`: add `<h1 class="sr-only">{landing.title}</h1>` the way `index.astro:160-193` does for builder homepages.
  3. **SF-6** — delete the dead `ORIGIN_CITY` (`checkout.astro:31,982,1604`); **SF-10** — `LandingLayout.astro:26-31` imports `clamp` from `lib/text` instead of re-implementing it; **SF-11** — move the `TODO` at `CheckoutLayout.astro:110` out of the shipped `<style>`; **SF-7** — move the `checkout_sessions` recovery read from `checkout.astro:156-160` into `src/data/` so no page imports `@tokophi/db`.
  4. **AD-4** — delete the five dead exports (`getAbandonedCart`, `getCollection`, `getOrderPayment`, `getTemplatesByType`, `getDefaultHomepage`); **AD-6** — add a `getSession()` bail to `searchTaxonomy`.
  5. **LP-1** — add `PUBLIC_DEMO_URL` as a Dockerfile `ARG`; **LP-2** — convert the one HTML comment in `Base.astro:53`; **LP-3** — fix or delete the dangling *"naming rule in AGENTS.md"* reference at `Base.astro:7`.
- **Done when:** Each item is closed in the report (`specs/docs/tasks/2026-09-04-page-map-report.md`) with the date; `npm test`, `check:storefront`, `check:landing` green; `node scripts/gen-page-map.mjs --check` clean (AD-4 changes the module index).
- **Status:** `[x]` **DONE — 11 of 11 closed 2026-09-09** — SF-4 kontak (hard-coded "Jam Operasional" removed; no store setting exists), SF-9 (`lp/[slug]` sr-only `<h1>`), SF-10 (`LandingLayout` private `clamp` → `lib/text`), SF-11 (shipped `TODO:` reworded), AD-4 (`getAbandonedCart`/`getCollection`/`getTemplatesByType`/`getDefaultHomepage` deleted, `lib/data/payments.ts` deleted whole — zero importers incl. tests), AD-6 (`searchTaxonomy` session bail before the query, + test), LP-1 (`PUBLIC_DEMO_URL` ARG default), LP-2 (last landing HTML comment → JSX, + directory-walking guard), LP-3 (title rule stated in place). Checks: admin tsc 0 · `check:storefront` 0 · `check:landing` 0 · eslint 0 · 15 tests green. **Follow-up landed 2026-09-09 — 11 of 11 closed.** SF-4 `keranjang` (trust line derived from `enabledPaymentChannels()`; no live channel ⇒ no channel named) · SF-4 `thanks` (static ADMIN ONLINE pill and the English *Safe Checkout · Quality Guaranteed* removed) · SF-6 (`ORIGIN_CITY` const + `define:vars` entry + stale comment deleted) · SF-7 (`src/data/checkout.ts` `getRecoveredCheckout`, with `verifyRecoveryToken` moved inside it so verify+read stay one operation; `checkout.astro` repointed in the same change, so no page imports `@tokophi/db`). New guard `apps/storefront/src/lib/page-map-hygiene.test.ts` — 13 tests, each proved RED against an on-disk mutation of its own target. Checks: `check:storefront` 0 errors · 131 storefront tests green · `npm run verify -w @tokophi/storefront` **8/8 PASS** · `gen-page-map.mjs` regenerated (new `src/data/checkout.ts` module). ⚠️ Carried: `KIND_LABEL` now exists twice (`keranjang.astro` + `index.astro`) — `index.astro` was outside the change surface.

## Parallel Execution Contract

Development starts from a fresh worktree based on the collaboration baseline. Independent lanes launch together; tasks sharing a release-critical file stay in one lane to prevent contradictory contracts.

| Wave | Parallel lane | Tasks | Dependency |
|---|---|---|---|
| 1 | A | 4.1 | None |
| 1 | B | 4.2 → 4.8 | Same public-order transaction; sequential |
| 1 | C | 4.3 → 4.10 → 4.13 | Same payment callback/identity surface; sequential |
| 1 | D | 4.4 | None |
| 1 | E | 4.5 → 4.6 → 4.9 | Same product/inventory/PO contract; sequential |
| 1 | F | 4.7 | None |
| 1 | G | 4.11 | None |
| 1 | H | 4.12 | None |
| 2 | A | 5.1 | Wave 1 DB baseline merged |
| 2 | B | 5.2 → 5.6 | Same product editor; sequential |
| 2 | C | 5.3 | None |
| 2 | D | 5.4 | None |
| 2 | E | 5.5 | None |
| 2 | F | 5.7 | Wave 1 accepted contracts merged |
| 2 | G | 5.8 | Product decision; independent of code lanes |
| 2 | H | 5.9 | Task 4.11 session contract merged |
| 2 | I | 5.10 | None |
| 2 | J | 5.11 → 5.12 | Same CI workflow; sequential |
| 2 | K | 5.13 | None |
| 2 | L | 5.14 → 5.15 | Authority map before traceability repair |
| 2 | M | 5.16 | None |
| 2 | N | 5.17 | None |
| 2 | O | 5.18 | None |
| 2 | P | 5.19 | Owner/provider evidence; independent of code lanes |
| 2 | Q | 5.20 | Owner-provided test OAuth client; secrets stay out of repository evidence |
| 3 | A | 6.1 | Tasks 5.11–5.15 merged |
| 3 | B | 6.2 → 6.9 | Migration coordinator assigns both numbers; sequential |
| 3 | C | 6.3 | None |
| 3 | D | 6.4 → 6.8 | Same manifests and lockfile; sequential |
| 3 | E | 6.5 | None |
| 3 | F | 6.6 | All checkout/product-editor functional changes merged |
| 3 | G | 6.7 | Task 6.4 import audit complete |
| 4 | A | 5.21 → 5.26 → 6.13 | Trivial sweep items; one PR |
| 4 | B | 5.23 | `@tokophi/lib` helper first, then both panels |
| 4 | C | 5.22 | Before custom domains go live |
| 4 | D | 5.24 | None |
| 4 | E | 5.25 | None |
| 4 | F | 6.11 | Own PR (mechanical, 12 files) |
| 4 | G | 6.12 | Measure first |
| 4 | H | 8.1 → 8.2 | Owner accounts (monitor, Vultr) |
| 4 | I | 8.3 | None |
| 4 | J | 8.4 | Owner supplies R2 variables |
| 4 | K | 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11 | Owner decisions / credentials; independent of code lanes |

### Cross-Lane Contracts

1. **Database migrations:** one coordinator assigns migration numbers before Wave 1 starts; lanes never invent competing numbers.
2. **Public order availability:** Task 4.2 owns the servability result contract; every later public endpoint reuses it rather than defining another status matrix.
3. **Payment identity:** Task 4.3 owns provider-request idempotency; Tasks 4.10 and 4.13 consume that identity for monotonic subscription state and exact authenticated callback resolution.
4. **Inventory:** Task 4.5 owns mutation payload semantics; Task 6.2 changes database isolation only.
5. **Product editor:** one lane owns Tasks 4.6, 5.2, and 5.6 in that order; Task 6.6 refactors only after behavior is verified.
6. **Checkout:** Task 5.4 fixes behavior before Task 6.6 moves code; the refactor must preserve the browser fixtures.
7. **Validation:** lanes run focused checks only. The integration owner runs the full repository gates once after all accepted changes are integrated.
8. **COD economics:** Task 5.19 records the provider evidence and owner decision before any implementation may widen COD or charge a reserve fee.

## Stage 7: Release Gate

After Stages 4–6 are integrated:

1. Run `npm run lint`.
2. Run `npm test` for the explicit offline suite, then `npm run test:release` against the dedicated test database with zero skipped DB suites.
3. Run `npm run build:all` for Admin, Super Admin, Storefront, and Landing.
4. Run seller-admin and storefront browser matrices at desktop and 320 px, including keyboard paths and the affected error states.
5. Run RLS, migration, secret, source-size, OpenAPI coverage, documentation-authority, and traceability guards.
6. Re-run every Stage 4/P0 reproduction and record before/after evidence in `specs/docs/AUDIT-SUMMARY.md`.
7. Update requirement statuses only from executable evidence; then update `specs/docs/tasks/OPEN.md` and release readiness. No Stage 5/6 deferral is valid without a named owner decision recorded in the repository.

- **Status:** `[~]` **RUNNABLE since 2026-09-09; steps 1/2/3/5 executed on `feat/sweep-0909` (see BUILD-LOG), steps 4 and 6 still manual** — step 1 `npm run lint` (root, admin + super-admin) · step 2 `npm test` + `npm run test:release` (Task 6.1) · step 3 `npm run build:all` (Task 5.12) · step 5 `npm run verify:guards` = source-size + openapi + doc-authority + traceability + `verify-migrations` + `verify-rls` (Tasks 6.6/5.13/5.14/5.15; the secret guard is `password.test.ts` + `no-published-credentials.test.ts` inside step 2). Step 4 (seller + storefront browser matrices at desktop and 320 px) is covered only by the drives recorded in `specs/docs/tasks/2026-09-08-browser-verification.md`, the storefront `verify` suite and `audit:responsive` — not a full matrix. Step 6 (re-run every Stage 4/P0 reproduction into `AUDIT-SUMMARY.md`) has NOT been run.

## Stage 8: Operations & Hygiene

Seeded by the **2026-09-07 production incident**: the single Vultr VPS `volumdev` (45.77.33.112) was SUSPENDED for billing from Fri 2026-09-04 20:27 WIB to Mon 2026-09-07 18:47 WIB (~70 h). Every host answered Cloudflare 522, the backup and cron sidecars stopped, and **nobody was alerted** — the outage was found from a merchant's "cannot search kecamatan" report. After resume, KiriminAja sandbox answers `401 "Your IP address 45.77.33.112 were not allowed to access this API"` on the rates call, so no ongkir → no COD → **no order can be placed**, while district search works (local tables). Full record: `BUILD-LOG.md` 2026-09-07 11:53 UTC. These are facts as received; this file does not re-verify them.

### Task 8.1: External Uptime Monitoring and Alerting for the Four Hosts
- **Requirement:** `NF-8` (availability is observed from outside the box — `SLA-DRP.md` SLI/SLO)
- **Tracing:** 2026-09-07 incident (70 h dark, no alert); `specs/docs/tasks/2026-08-06-alerting-gaps.md` ⓕ *"Tidak ada pemantauan uptime dari luar"* (open since 2026-08-06)
- **Target Files:** `specs/docs/SLA-DRP.md` (§ monitoring), `specs/docs/DEPLOY.md` (runbook link), `specs/docs/OBSERVABILITY.md`; no application code.
- **Change:**
  1. Stand up an external monitor **not on the VPS** for `tokophi.com`, `app.tokophi.com`, `rich.tokophi.com`, `toko.tokophi.com` — Cloudflare Health Checks is already in front and needs no new infrastructure (ⓕ's own suggestion); a free third-party pinger is the alternative. Check interval ≤ 5 min; a check on `/api/health` for the admin (it already exists) rather than `/` where one is available.
  2. Alert to a channel the owner actually reads (WhatsApp/Telegram/email — owner picks), after ≥ 2 consecutive failures so the normal 7–8 s deploy swap (measured 2026-08-28) does not page anyone.
  3. Record the monitor, its owner login location (never the credential), the alert route, and the expected deploy-window noise in `SLA-DRP.md`; close ⓕ in the alerting-gaps doc.
- **Done when:** Stopping the storefront container for 10 minutes produces an alert on the recorded channel within 15 minutes and a recovery notice afterwards; a normal deploy produces none; `SLA-DRP.md` names the monitor and the alert route.
- **Status:** `[ ]` **OPEN — needs the owner's monitor/notification account** (added 2026-09-08). Nothing external watches the hosts today: `grep -rn -i 'uptime' specs/docs/SLA-DRP.md` → 0 hits beyond ⓕ's statement of absence.

### Task 8.2: Vultr Balance Guard — Auto-Top-Up or Low-Balance Alert Procedure
- **Requirement:** `NF-8` (a billing lapse must not be a silent outage)
- **Tracing:** 2026-09-07 incident — balance $9.35 vs $10.36 pending; promo credit expired 2026-08-20; the 2026-09-01 invoice was not covered; last real payment 2026-07-09.
- **Target Files:** `specs/docs/SLA-DRP.md` (§ single points of failure — add "the hosting account's balance"), `specs/docs/DEPLOY.md` (ops runbook: `vultr-cli instance list` is the first check when every host is 522 — see memory `prod-outage-check-vps-first`).
- **Change:**
  1. Owner enables Vultr auto-top-up (or a saved card with automatic invoice payment) so a monthly invoice cannot suspend the box; if that is refused, set the Vultr low-balance email alert and mirror it into the 8.1 alert channel.
  2. Write the procedure — balance check cadence, who receives the billing email, how a suspension is detected (`vultr-cli instance list` → `suspended`) and how resume works (automatic on payment; no manual start) — into `DEPLOY.md`, and add the account balance to `SLA-DRP.md`'s SPOF list beside the single VPS.
- **Done when:** `SLA-DRP.md` lists the billing lapse as a named failure mode with its detection + recovery time; the owner confirms auto-top-up or a low-balance alert is live (confirmation recorded in `BUILD-LOG.md`, never the card/account details).
- **Status:** `[ ]` **BLOCKED — owner action on the Vultr account** (added 2026-09-08). `grep -rn -i 'top-up\|balance' specs/docs/SLA-DRP.md specs/docs/DEPLOY.md` → 0: the failure mode is undocumented.

### Task 8.3: Surface KiriminAja Environment AND Connection Health on Super Admin → Pengaturan
- **Requirement:** `F-S1` (an operator can see whether shipping quotes can be produced at all)
- **Tracing:** 2026-09-07 incident (IP allow-list lapsed; `/api/public/ongkir` `op:"rates"` → `SHIPPING_QUOTE_UNAVAILABLE`; only the container log said `[ongkir] courier API refused the quote: Unauthorized.`); `NEXT.md` N35 (env visibility — its AC is **already met**, see Status).
- **Target Files:** `apps/super-admin/lib/data.ts` (`getSystemStatus` :388-424, `kaEnvName`), `apps/super-admin/app/(platform)/pengaturan/pengaturan-client.tsx` (:396-412), `apps/super-admin/app/(platform)/page.tsx` or the status card that renders `SystemStatus`, `packages/lib/src/kiriminaja.ts` (`kaTestConnection` :312), `apps/admin/app/api/cron/tracking/route.ts` or `cron_runs` (0091) as the liveness carrier.
- **Change:**
  1. **Health, not just configuration.** `SystemStatus.kiriminaja` is `kiriminajaConfigured()` = "the env key is non-empty" — it read green for the whole outage and reads green now, while every quote is refused. Add a real signal: the most recent outcome of an actual KiriminAja call (the `cron-tracking` sidecar already hits the API every 15 min — record its last HTTP status/`message` in `cron_runs.result` or a sibling column) and/or a cheap scheduled `kaTestConnection` (`province`, costs nothing). Render it on the same card as the env badge with the timestamp of the last successful call; an auth refusal (`401`, the allow-list message) must be named as such, not "Tidak terhubung".
  2. Keep the env badge (N35) and the manual "Test koneksi" button; make the button's result print the provider's `message` verbatim to the OPERATOR (ADR 0004 hides provider text from shoppers, not from us) — the allow-list sentence names the IP that needs re-adding.
  3. Document in `DEPLOY.md`: the sandbox IP allow-list is a KiriminAja-dashboard fact, it lapses, and the symptom is "district search works, rates fail".
- **Done when:** With the allow-list refusing, Super Admin → Pengaturan shows a red KiriminAja health state naming the auth refusal and the last-OK timestamp without anyone opening a container log; with it restored the state goes green within one cron interval; `getSystemStatus` no longer reports `kiriminaja: true` from key presence alone (a test pins the field's source).
- **Status:** `[x]` **DONE 2026-09-08** — `kaTestConnection()` returns facts (`configured`, `httpStatus`, `provinces`, vendor `text` verbatim) instead of a flattened verdict; pure `apps/super-admin/lib/ka-probe.ts` `classifyKaProbe` → `ok | refused | unreachable | unconfigured` (+6 tests incl. the exact 2026-09-07 allow-list sentence); `getKiriminajaProbe()` in `data.ts` = `cached("ka:probe", 5 min)` racing a 4 s timer, failures cached too; `SystemStatus.kiriminaja` is now `kiriminajaProbe.state === "ok"` (codeOnly guard + mutation self-check). Pengaturan renders `<KaProbeBadge>` (glyph + word + `HH.MM WIB`, refusal sentence under the banner); Analitik Sistem tile prints `word · detail`. Manual "Test koneksi" bypasses the cache. Ceiling: a 5-minute per-replica cache, not a cron carrier.

### Task 8.4: Credential the Offsite Backup and Prove One Restore
- **Requirement:** `NF-8` / `SLA-DRP.md` §3 (RPO survives loss of the VPS)
- **Tracing:** BUILD-LOG 2026-09-02 05:30 UTC (*"backup OFFSITE ke R2: mekanismenya ada … menunggu satu kredensial"*), 2026-09-03 checkpoint (`offsite-UNCONFIGURED` + unhealthy in production), 2026-09-07 incident (last local dump 2026-09-04 11:50 UTC; the box that holds every backup was the box that was suspended).
- **Target Files:** Coolify environment for the `backup-offsite` service (`docker-compose.coolify.yml:584-…`), `specs/docs/SLA-DRP.md` §3, `specs/docs/DEPLOY.md` (restore runbook at :719-745 already written), `BUILD-LOG.md`.
- **Change:**
  1. Owner mints an **account-scoped** Cloudflare API token with R2 Object Read & Write (both existing tokens are zone-scoped — measured 2026-09-02), creates a PRIVATE bucket, sets `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` in Coolify, restarts the service.
  2. Verify `offsite-ok` in the sidecar log and `healthy` on its healthcheck; confirm objects exist in the bucket.
  3. Run the `DEPLOY.md` restore runbook once: pull the newest dump from R2, `pg_restore` into a throwaway database, count rows, drop it. Record counts and duration in `BUILD-LOG.md`; move `SLA-DRP.md` §3 from 🟡 to 🟢 only after the restore, because *"mengunggah belum jadi backup sampai satu dump pernah dipulihkan"*.
- **Done when:** The sidecar is `healthy` with `offsite-ok` in production; a dump restored from R2 (not from the volume) produces a database with the expected row counts; `SLA-DRP.md` §3 records the restore date and the measured RPO.
- **Status:** `[ ]` **BLOCKED — on the four R2 variables (owner)** (verified 2026-09-08). The mechanism is shipped and live: `docker-compose.coolify.yml:584` `backup-offsite` (rclone 1.68, read-only mount, `copy` not `sync`, remote-only 30-day retention), proven against MinIO on 2026-09-02 and deployed in #378 (deploy 528). It is **not credentialed**: BUILD-LOG 2026-09-03 confirms production logs `offsite-UNCONFIGURED` and the healthcheck is failing by design; the 2026-09-03 resume checklist has it as owner item #1. **No restore has ever been exercised.**

### Task 8.5: Prune the 36 Agent Worktrees (42 GB) — Owner-Gated
- **Requirement:** repository hygiene (`NF-16`)
- **Tracing:** page-map report RH-1 🟡
- **Target Files:** `.claude/worktrees/*` on this machine (not tracked); `git worktree list`.
- **Change:**
  1. Owner reviews the list. The 13 whose tips are ancestors of `main` (`a11y-ulang`, `agent-a09c67b4ca2f6ee51`, `agent-a2442ee7ff4764157`, `cat2`, `fin`, `kontras`, `mt`, `primitif`, `struktur`, `tema-token`, `w2a`, `w2b`, `w2c`) are safe to `git worktree remove`; the other 23 have unmerged tips and uncommitted files and are **each someone's afternoon until proven otherwise** — `feat/stage5-lifecycle` (Task 5.7's candidate) is among the unmerged branches.
  2. Remove only what the owner names; never `rm -rf` the directory wholesale (destructive gate in `~/.claude/CLAUDE.md`).
- **Done when:** `git worktree list` shows only live work; `du -sh .claude/worktrees` recorded before/after in `BUILD-LOG.md`; no unmerged branch was deleted without its owner's say-so.
- **Status:** `[ ]` **BLOCKED — owner decision (destructive)** (re-measured 2026-09-08: `git worktree list` → 37 entries incl. main; `du -sh .claude/worktrees` → 42G). RH-4's `vitest` exclude already stops them from polluting `npm test`, so this is disk and confusion, not correctness.

### Task 8.6: Commit or Delete the Untracked Root Delivery Scaffolds
- **Requirement:** `NF-16` (one authority per concern)
- **Tracing:** page-map report RH-2 🟡
- **Target Files:** root `STATUS.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `OBSERVABILITY.md`, `RELEASE.md`, `.delivery/` (all `??` in `git status`).
- **Change:**
  1. Another agent is filling these from the delivery-ledger contract at the time of writing (2026-09-08) — do not edit them in parallel.
  2. When that pass ends, the owner decides: **commit** them (then `specs/README.md`'s authority map must name which of root `STATUS.md` / `specs/docs/STATUS.md`, root `ARCHITECTURE.md` / `specs/docs/ARCHITECTURE.md`, root `DECISIONS.md` / `specs/decisions/` owns what — a second `STATUS.md` beside the real one is the split source of truth Task 5.14 exists to prevent), or **delete** them.
- **Done when:** `git status` shows none of the six as untracked; if kept, `specs/README.md` maps each root file to its concern and no placeholder text (*"State: PLANNED"*, *"Database `none`"*) contradicts `TASKS.md`/`BUILD-LOG.md`; Task 5.14's link check (when it exists) passes over them.
- **Status:** `[x]` **DONE 2026-09-08** — the five root files were filled from disk as THIN pointers (`State: SMOKE_TESTING` because production ordering is blocked; ADR index; the real probes; release `4b0f4c8-pr381` then `4212631`) and committed in `4a9967a`; `.delivery/` is now in `.gitignore` (`ef20d7c`) because the ledger is its canonical writer (`~/dotfiles/docs/task-change-boundary.md`); `delivery-ledger checkpoint` cleared the PLANNED/SMOKE_TESTING drift → `VERIFIED`. RH-2 closed.

### Task 8.7: Move Promo-AI off the `claude` CLI Spawn (Dead in Production)
- **Requirement:** `F-P9` (a shipped merchant feature works in the production container)
- **Tracing:** BUILD-LOG 2026-08-31 / 2026-09-03 resume checklist — *"Promo-AI mati di produksi (spawn `claude` CLI; container tak punya)"*
- **Target Files:** `apps/admin/lib/promo-ai.ts` (`runClaude` :54 spawns the CLI), its caller, `docker-compose.coolify.yml` (new `ANTHROPIC_API_KEY` env), `specs/docs/DEPLOY.md` (env table).
- **Change:** Replace the CLI spawn with a `fetch` to the Claude Messages API (load skill `claude-api` before writing it — model id, pricing, parameters); key from the environment only; the feature stays hidden/disabled when the key is absent (same pattern as `GOOGLE_CLIENT_ID`); keep the existing prompt builder and output parsing.
- **Done when:** In the production container (no `claude` binary) the promo generator returns a result; with the key unset the UI shows the feature disabled instead of a failed spawn; no key appears in any log; a unit test pins that `promo-ai.ts` no longer imports `child_process`.
- **Status:** `[x]` **DONE 2026-09-09 (code); the feature stays OFF in production until the owner sets `ANTHROPIC_API_KEY`, which is the honest state, not a leftover)** — `runClaude`/`execFile`/`node:child_process` are gone from `apps/admin/lib/promo-ai.ts`; it is a plain `fetch` to the Anthropic Messages API (`claude-opus-5`, `output_config.effort: low`, 120 s abort, no SDK dependency added for one POST). `promoAiEnabled()` is the one gate: the editor page passes the BOOLEAN (never the key) to the client, the card renders the button **disabled** with `"Generate AI belum aktif — kunci API belum dipasang di server. Hubungi admin TokoΦ."`, and `generatePromoContent` refuses with `{ ok:false, error }` **before** the product read — a hidden button is never the boundary. Provider error text never reaches the merchant (ADR 0004): status + body go to `console.error`, the merchant gets ours; `stop_reason: "refusal"` handled before reading content. `ANTHROPIC_API_KEY` classified **optional** in `env-health.ts` (empty = feature off, the `GOOGLE_CLIENT_ID` posture) and forwarded `${ANTHROPIC_API_KEY:-}` into `admin` only in `docker-compose.coolify.yml`; `DEPLOY.md` records it. Guard `apps/admin/lib/promo-ai.test.ts` (7 tests): a repo-wide `codeOnly` sweep of `apps/admin` + `apps/super-admin` + `apps/storefront/src` (289 files, exceptions named, floor asserted) proving no `child_process`/`execFile`/`spawn` on any request path, **proved RED by re-inserting the import into `promo-ai.ts`**, plus a predicate self-check and the disabled-state claims. tsc 0, eslint 0. ⚠️ Not verified against the live API from this session — no key here; `.env.example` / `.env.coolify.example` were not touched (permission-blocked in this session, and not in the task's Target Files) so **the key must be added to both when the owner sets it**. ⚠️ **Owner steps left:** add `ANTHROPIC_API_KEY` in Coolify (a COST decision — every press is billed Opus-tier output), and add the key to `.env.example` + `.env.coolify.example` (both are behind this session's secrets gate, which blocks every `.env*` path including the templates — same trap `DEPLOY.md` records for `INTEGRATION_TOKEN_KEY`). Also open, filed not fixed: no per-store rate limit on Generate and no usage attribution, so spend cannot be traced to a store.

### Task 8.8: Close the Publicly Reachable Coolify Panel and the Origin-by-IP Bypass
- **Requirement:** `SEC-19` (the control plane's own control plane is not on the public internet)
- **Tracing:** BUILD-LOG 2026-08-31 audit ①/② — Coolify `:8000` (+6001/6002/8080) answered 200 from the public internet; origin `:443` reachable directly by IP so Cloudflare (WAF, the only rate-limit wall per AGENTS.md) is bypassable; the IP is in a public repo.
- **Target Files:** VPS firewall / Vultr firewall group; `specs/docs/SECURITY.md` (transport section), `specs/docs/DEPLOY.md`.
- **Change:**
  1. Owner chooses for the Coolify ports: allow-list the owner's IP(s) OR close them entirely and reach the panel over an SSH tunnel (the resume checklist lists both; the earlier "restrict 80/443 to Cloudflare ranges" idea was WITHDRAWN because it breaks ACME HTTP-01 and non-Cloudflare custom domains — do not re-propose it).
  2. For the origin bypass, record the accepted residual risk in `SECURITY.md` if 80/443 must stay open for ACME, with the mitigation (Cloudflare Origin CA + Authenticated Origin Pulls if/when custom domains allow it).
- **Done when:** `curl -m 5 http://45.77.33.112:8000` from outside the allow-list times out or is refused; `SECURITY.md` records the port policy and the origin-bypass decision with a date.
- **Status:** `[ ]` **BLOCKED — owner decision (allow-list vs. tunnel)** (added 2026-09-08 from BUILD-LOG 2026-08-31; not re-probed — no production access from this session).

### Task 8.9: KiriminAja Production Cutover — Send the UAT Sheet, Then Flip `KIRIMINAJA_ENV`
- **Requirement:** `F-S1` (a booked parcel is actually collected)
- **Tracing:** BUILD-LOG 2026-08-31 audit ③ (`KIRIMINAJA_ENV=sandbox` in production — bookings look healthy, no courier ever comes); resume checklist owner item #2; AGENTS.md "Shipping & COD" (*"a wrong setting is INVISIBLE"*).
- **Target Files:** owner: the UAT document (`~/Downloads/UAT Mas Ongkie X Kiriminaja - FINAL.*`, outside the repo); then Coolify env `KIRIMINAJA_ENV=production` + production key; `specs/docs/DEPLOY.md`.
- **Change:** Owner submits the UAT sheet to KiriminAja and obtains production access; on approval set the production key + env in Coolify, redeploy, and confirm via Super Admin → Pengaturan (the env badge from N35 / Task 8.3 reads `production`) and one real booking that a courier collects. Also re-request the IP allow-list for the PRODUCTION endpoint — the sandbox lapse of 2026-09-07 shows it is per-environment and can expire.
- **Done when:** Production shows `production` on the KiriminAja card; one real order is booked, collected and tracked end to end; `DEPLOY.md` records the cutover date.
- **Status:** `[ ]` **BLOCKED — owner sends the UAT sheet; provider approves** (added 2026-09-08; the sheet is reported ready since 2026-09-03).

### Task 8.10: Re-Probe OVO in the Daytime Window Before Re-Enabling It
- **Requirement:** `F-M2` (only channels the PSP can actually complete are offered)
- **Tracing:** BUILD-LOG 2026-08-31 AKSI ① — OVO disabled in production (`platform_payment_channels.enabled=false`) after `create_payment` returned `rc=68 EXT TIMEOUT` ×2 at ~00:30 WIB while QRIS returned `rc=11 BILLER DISRUPTION` (PSP maintenance indicator); resume checklist engineering item #1.
- **Target Files:** none in code — a live probe from the admin container using the valid `alProbeChannels` payload shape with a WIB `expired` stamp (see PR #375); `platform_payment_channels` row; `BUILD-LOG.md`.
- **Change:** Probe OVO during business hours WIB; if `create_payment` succeeds, re-enable the channel from Super Admin → Pengaturan (audit line lands via `savePaymentChannels`, SA-4); if it still times out, leave it off and record the result. ⚠️ A probe creates a real bill — use the minimum amount and cancel/let it expire; never run the AutoLaris "Tes koneksi" casually (Rp10.000 QRIS each).
- **Done when:** `BUILD-LOG.md` records the daytime probe's `rc` and the resulting channel state; the storefront's payment picker matches `enabledPaymentChannels()`.
- **Status:** `[ ]` **OPEN — needs production access for the probe** (added 2026-09-08; not re-probed from this session).

### Task 8.11: Record the Zero-Downtime Structural Decision
- **Requirement:** `NF-8` (deploy window is a documented, chosen number)
- **Tracing:** BUILD-LOG 2026-08-28 ZERO-DOWNTIME ⑤/FINAL — window measured **81–115 s → 7–8 s** (−93%); reaching ~0 s is one of three structural options the owner must choose (drop Traefik health-gating + global retry · split surfaces into Coolify Dockerfile-type apps with true rolling updates · manual blue-green with two replicas); resume checklist owner item #4.
- **Target Files:** one new `specs/decisions/00NN-deploy-window.md`, `specs/docs/DEPLOY.md`, `specs/docs/SLA-DRP.md` (the deploy window is part of the availability budget).
- **Change:** Owner picks one option or explicitly accepts 7–8 s as the floor; record it as an ADR with the measured numbers and the trade each option carries (already written out in BUILD-LOG 2026-08-28 ④/⑤); Task 8.1's alert threshold must be set above whatever window is chosen.
- **Done when:** The ADR exists and `DEPLOY.md` states the expected deploy window as a number with its source.
- **Status:** `[x]` **DONE 2026-09-09 (record written; the two absolute-zero levers stay undecided by design)** — `specs/decisions/0017-zero-downtime-deploy.md` (0016 is reserved for the buyer-account decision, Task 5.8): context = the TWO different 503 causes with their measurements (seed chain on the critical path: 15 min → 81 s, 2026-08-19; Coolify full-stack teardown + serial `depends_on: migrate` + Traefik retry that cannot bridge an empty pool: 81–115 s → 7,0–8,3 s, 2026-08-28), decision = the three structural changes actually taken with their commits, consequences incl. the ~10 s pre-migration schema window, evidence table by deploy id, §5 the residual and the three ~0 s options NOT decided (all outside the repo). Named the false claim in the history ("build with containers already down", refuted on `#281`). `DEPLOY.md` deploy-window section now carries the 2026-08-28 numbers + both off-repo levers; `SLA-DRP.md` §4 gained the routine-deploy RTO row (≈ 5,3 min/month); `DECISIONS.md` index + next-free-number corrected.

### Task 8.14: Send the Fields `v6.2/request_pickup` Documents as Required
- **Tracing:** vendor OpenAPI 3.1 `info.version 6.2.0`, read 2026-09-09 (`specs/docs/KIRIMINAJA.md`)
- **Target Files:** `packages/lib/src/kiriminaja.ts`, `apps/admin/lib/actions/shipping.ts`, `packages/db/src/schema.ts` (coordinates), `apps/admin/app/(admin)/pengaturan/**`
- **Change:**
  1. The spec marks these REQUIRED and `kaCreateOrder` omits them or sends them conditionally: sender `zipcode`, `latitude`, `longitude`, `kelurahan_id`; per package `destination_zipcode`, `destination_kelurahan_id`, `destination_latitude`, `destination_longitude`, `items`. Sandbox bookings succeed anyway (measured 2026-08-20), so the server is lenient TODAY — a grace period, not a contract.
  2. Send what we HAVE unconditionally: the kelurahan ids and both zipcodes already exist on the order and on `store_settings` (the shopper's kodepos has been required since 2026-08-03), and `items` can be built from `order_line_items`.
  3. ⚠️ **The coordinates are a data-model change, not a client edit** — `op === "instant"` was removed and its own note records it was the only consumer of shopper/store coordinates, so nothing geocodes anything today. Decide: geocode the seller's pickup address once at Pengaturan → Alamat and the shopper's district centroid at order time, or ask the vendor whether they are truly required for a `drop: false` pickup. **Never send zeroes** — a courier would route on them.
- **Done when:** a booking sends every documented-required field it can honestly produce; the remaining gaps are named in `KIRIMINAJA.md` with the vendor's answer; `kiriminaja-v62.test.ts` pins the payload shape.
- **Status:** `[x]` **DONE 2026-09-09 for everything we can honestly fill.** Now sent unconditionally: sender `zipcode` (`store_settings.sender_postcode`, falling back to the district's sole postcode), `destination_zipcode` (`orders.ship_postcode`), and `packages[].items` — one entry per `order_line_items` row, `price` PER UNIT per the schema, never a synthetic line. **Coordinates confirmed unfillable column by column** (`sender_lat`/`sender_lng` are dead columns, `orders` has none, no centroid in `kiriminaja_areas`/`kelurahan`) — omitted, never zeroed, and the absence is asserted WITH its reason. 🔴 **The kelurahan ids are a trap, not an oversight** — ours are Kemendagri codes joined to KA districts by NAME, so sending them would be a WRONG id; split out as **Task 8.17**. Read-only live probe: `shipping_price` 200 with 22 services, and the same quote plus the new fields returns a byte-identical cost list, so extra keys are tolerated and no price moves. `kiriminaja-v62.test.ts` 7 → 12 tests, 7 mutations → 7 reds; new `shipping-manifest.test.ts` (5) pins the caller half with per-claim mutation self-checks. ⚠️ `request_pickup` was NOT called — the booking validator's acceptance of these fields is still unproven and needs one authorised sandbox pickup.

### Task 8.18: Read Channels and Account Fees from `list_payment`, Not by Creating Bills
- **Tracing:** vendor reference `ongkipro/autolaris` (`GET /api/h2h/list_payment`); skill `autolaris-h2h` rule 2
- **Target Files:** `packages/lib/src/autolaris.ts`, `apps/super-admin/lib/actions.ts`, `apps/super-admin/app/(platform)/pengaturan/**`
- **Change:**
  1. `alProbeChannels()` loops a hardcoded `AUTOLARIS_KNOWN_CHANNELS` and issues **one real `POST /api/h2h/create_payment` per channel** to discover which are enabled — its own comment admits *"EXPENSIVE — creates sandbox bills"*. That leaves abandoned transactions in the provider account to learn something one GET returns.
  2. The documented endpoint is `GET /api/h2h/list_payment` — *"Channel aktif dan konfigurasi fee akun"* — and the skill's rule 2 forbids hardcoding a global channel list.
  3. Keep the local list as a LABEL lookup only; the authoritative enabled set comes from the API.
- **Done when:** the super-admin channel probe creates no transactions, and a guard fails if `create_payment` reappears on that path.
- **Status:** `[x]` **DONE 2026-09-09** — `alListPayment()` reads `GET /api/h2h/list_payment`; the 16× `create_payment` probe loop is GONE and `AUTOLARIS_KNOWN_CHANNELS` is a label/kind lookup only. Live read-only call returned 8 channels with exactly four fields each (`channel_code`, `name`, `admin`, `tipe_admin`) — **there is no `active`/`enabled` field, so absence from `data` is the only "not available" signal** and none was invented. ⚠️ **The old probe's answer was WRONG, not merely expensive**: `list_payment` reports **OVO available** while the rc-probe had left `platform_payment_channels.OVO` at `active=false` on production. `syncPaymentChannels` bails without writing on a failed read (an empty list would take checkout's payment options offline) and skips codes with no `kind`. Guard: `codeOnly` claim that the probe path creates nothing, proved RED by restoring the loop. 34 tests.

### Task 8.19: Move Payment Reconciliation to the Documented `advice` Endpoint — Carefully
- **Tracing:** vendor reference `ongkipro/autolaris` (`POST /api/h2h/advice`); skill `autolaris-h2h` rules 7 and 8
- **Target Files:** `packages/lib/src/autolaris.ts`, the callers of `alInquirePaymentStatus`
- **Change:**
  1. We reconcile through **`/api/h2h/inquiry_payment`**, which is **not among the eight documented endpoints**; the documented one is `POST /api/h2h/advice` keyed on the provider `transaction_id`.
  2. 🔴 **This is a money path and a naive swap is dangerous.** The vendor has NOT published a complete settlement mapping, and the guide states plainly that `02/PENDING` stays pending while `SUCCESS`/`BERHASIL` are too generic and `DELIVERED` is a SHIPPING status — none of the three may be read as paid. A wrong "paid" runs `creditSaleForPayment` and credits a seller's withdrawable balance for money that never arrived.
  3. Therefore: the paid decision must be a PURE function defaulting to **`unknown`, never paid**, with an explicit settlement list; and the migration must be justified by measurement — call `advice` and `inquiry_payment` on the SAME real `transaction_id` (both are reads) and compare the vocabularies.
  4. ⚠️ **If Advice carries a weaker settlement signal than what we have, do NOT remove `inquiry_payment`.** Moving to an official endpoint that says less is a regression; keep it as the decision source, use Advice alongside, and record that full migration waits on provider confirmation.
- **Done when:** the comparison is recorded with both raw answers, the decision function is table-tested with `SUCCESS`/`BERHASIL`/`DELIVERED` proved non-paid, and the chosen source is justified by that evidence.
- **Status:** `[~]` **INVESTIGATED 2026-09-09 — migration deliberately NOT performed, and the reason is evidence.** Two findings overturn the premise. (1) **`alInquirePaymentStatus` has ZERO callers in `apps/`** — settlement is decided solely by `api/public/pay/callback` (`status === "PAID"`); no cron reconciles payments, so there was no reconciliation path to migrate. Worse, `/api/h2h/inquiry_payment` **does not exist on our account**: it answers `404 not found` for the very ids Advice answers for, and its test has always been green because it stubs `fetch` — a test over a path the provider never served. (2) **Advice gives no decisive paid signal**: four real transactions all returned `rc=02 ket="FAILED"` for bills our DB holds as live, while the vendor's own sample for that rc reads `"PENDING"`; no PAID answer is observable at all (every `berhasil` payment is COD/seeded with no `trx_id`). Shipped instead: `alAdvice()` + a pure `classifyAdvice()` whose `ADVICE_SETTLED` list is **deliberately EMPTY** — `SUCCESS`/`BERHASIL`/`DELIVERED`/`PAID`/`LUNAS`/`SETTLED` all map to `unknown`, default `unknown`, never `paid`; adding a confirmed word later is a one-line data change. `alInquirePaymentStatus` kept but annotated with the 404 evidence and marked not-a-settlement-source. 22 tests; RED-proved by seeding the settled list. **Left:** ask the provider which status means settled (go-live question), then fill that list.

### Task 8.17: Get REAL KiriminAja Subdistrict Ids — Ours Are Kemendagri Codes
- **Tracing:** found 2026-09-09 while doing Task 8.14; vendor `POST /api/mitra/kelurahan`, `GET /api/mitra/v6.1/addresses`
- **Target Files:** `packages/db/src/schema.ts` (a column for the KA id), `packages/db/scripts/build-kelurahan.mjs`, `packages/lib/src/kiriminaja.ts`, `apps/admin/lib/data/areas.ts`, `apps/storefront/src/pages/checkout.astro`, `apps/admin/app/(admin)/pengaturan/**`
- **Change:**
  1. `kelurahan.id` is a **Kemendagri** village code joined to KiriminAja districts BY NAME — not a KA subdistrict id. `v6.2/request_pickup` marks `kelurahan_id` and `destination_kelurahan_id` REQUIRED, and passing ours would send a wrong id, which is worse than omitting one. Today they are correctly omitted (`store_settings.sender_kelurahan_id` is NULL for every store; `orders` carries no kelurahan).
  2. Add `kaKelurahanId` alongside the Kemendagri code — do NOT overwrite it; the postcode derivation depends on the existing dataset and the two id spaces must stay distinguishable.
  3. Populate it from the vendor: `POST /api/mitra/kelurahan` takes `kecamatan_id` and returns that district's subdistricts. Match by name the way the existing script does, and **record the unmatched rate** — ~4% of districts already have no kelurahan data, so a silent partial match must not look like success.
  4. Only then send both id fields, and only where the KA id is actually known.
- **Done when:** a booking carries real KA subdistrict ids for the districts where they resolve, the unmatched rate is measured and recorded, and a guard fails if a Kemendagri code is ever passed to a `*_kelurahan_id` field.
- **Status:** `[ ]` **OPEN** (found 2026-09-09; nothing is broken today because the fields are omitted rather than wrong).

### Task 8.15: Register the Webhook with `set_callback` — the Missing Half of N39
- **Tracing:** N39; vendor OpenAPI `POST /api/mitra/set_callback`
- **Target Files:** `packages/lib/src/kiriminaja.ts`, `apps/super-admin/lib/actions.ts`, `apps/super-admin/app/(platform)/pengaturan/**`
- **Change:**
  1. The receiver `apps/admin/app/api/public/kiriminaja/webhook` shipped 2026-08-24, but nothing in this repo has ever REGISTERED its URL with the vendor and no log records a manual registration — so the poller is doing all the work and the webhook may never have fired.
  2. Add `kaSetCallback(url)` and an OWNER-rank Super Admin action that calls it, showing the URL it registered and the vendor's answer.
  3. ⚠️ **The spec says ONE callback URL per account and a new registration REPLACES the previous one**, and asks to be notified before a change. So this button can silently take the webhook away from whatever is registered now: read the current value first if the vendor exposes it, log the old and new URL to `platform_activity`, and put the warning in the confirm dialog.
- **Done when:** the registered URL is visible in Super Admin, changing it is audited, and one real vendor callback is observed hitting the receiver.
- **Status:** `[~]` **HALF DONE 2026-09-09 — the URL is registered by the owner; the AUTH CONTRACT is now the open half.** `https://app.tokophi.com/api/public/kiriminaja/webhook` was registered on the vendor side (owner action, alongside the new sandbox key). 🔴 **Newly found risk, from the spec:** the vendor declares `expressShipmentEvent` with **`security: null`** — no authentication documented on the callback — while our receiver requires `Authorization: Bearer <KIRIMINAJA_API_KEY>` and FAILS CLOSED. If the vendor sends no header, every real shipment event is refused and nothing says so. Production logs over 24 h hold exactly ONE rejection, at 08:59:38 UTC, and it is **my own unauthenticated probe**, not a vendor call — no genuine callback has arrived yet (none can until a shipment event occurs). Mitigation shipped in the same sweep: the rejection log now records the SHAPE of what was presented (header present? scheme? credential length? length match? caller IP? which vendor-ish headers by name) and never a value, so the FIRST real rejection tells us exactly what KiriminAja authenticates with. **Left:** observe one genuine callback, then either confirm the bearer or adapt to whatever the vendor actually sends — and do NOT accept unsigned writes, because this endpoint mutates `orders.awb` and status. Also still open from the spec: one URL per account, a new registration REPLACES the previous one, so the eventual in-app button needs the audit line and warning this task already describes.

### Task 8.16: Use `pin/validate` + `credit/balance` So a Failed Booking Says Why
- **Tracing:** vendor OpenAPI `GET /api/mitra/v6.2/credit/balance`, `POST /api/mitra/v6.2/pin/validate`
- **Target Files:** `packages/lib/src/kiriminaja.ts`, `apps/admin/lib/actions/shipping.ts`, `apps/super-admin` (balance surface)
- **Change:** the spec pairs both with pickup — validate the PIN and confirm the balance covers the shipping cost before booking, and `request_pickup` accepts optional `pin`/`payment_method`. We send neither, so a booking refused for an empty aggregator balance is indistinguishable from any other refusal, on a screen that tells the merchant to try again. Surface the platform balance in Super Admin beside the KiriminAja probe (Task 8.3), and name insufficient balance as its own error at the booking path.
- **Done when:** an insufficient-balance refusal is reported as such to the operator, and the balance is visible before it runs out.
- **Status:** `[ ]` **OPEN** (found 2026-09-09). 🔴 **HAZARD, read before implementing:** the vendor's prose says the PIN is six digits with a documented **maximum of THREE attempts**, and validation responses carry `attempt`, `max_attempt` and `lock_until`. A naive retry loop would **lock the platform account**, stopping every merchant's bookings at once. Any implementation must read `attempt`/`lock_until` and stop — never retry blindly. KA Credit deducts the shipping cost automatically after a successful pickup; Term-of-Payment accounts use neither KA Credit nor the PIN. The account in use does have a PIN (visible on the dashboard beside the key).

### Task 8.12: Remove the `shipping_aggregator.enabled` Status Light, or Enforce It
- **Tracing:** browser verification 2026-09-08 (observation beside Task 8.3)
- **Target Files:** `apps/super-admin/app/(platform)/pengaturan/pengaturan-client.tsx`, `packages/db/src/seed.ts`
- **Change:**
  1. Establish by grep that `shipping_aggregator.enabled` is read in exactly two places — that card and the seed — and by NOTHING on the shipping path (`apps/admin/lib/shipping-quote.ts`, `api/public/ongkir`, `lib/actions/shipping.ts`).
  2. Apply the standing ruling for this exact shape: `platform_payment_gateways.enabled` was ruled "a record, not a switch" (owner, 2026-08-20) and its badge was REMOVED ~100 lines above in this same file while the column was kept. Remove the `Aktif` chip the same way, keep the column.
  3. If a real aggregator kill-switch is wanted instead, it must be ENFORCED at the quote path FIRST (the way `platform_cod.enabled` is) and only then surfaced — that is a different, larger task.
- **Done when:** no chip on the Kurir card claims a state nothing enforces; a guard in the shape of `apps/super-admin/lib/gateway-enabled-is-not-a-gate.test.ts` fails if it is put back.
- **Status:** `[x]` **DONE 2026-09-09** — grep proved `shipping_aggregator.enabled` is read by `getAggregator()` (the card) and written by the seed, and by NOTHING on the shipping path (every `.enabled` there is `platform_couriers`, `store_shipping_methods` or `platform_cod`). The green `Aktif` chip is removed the way the gateway badge was (comment in place naming the three real gates); `getAggregator()` no longer returns the field; column kept. Guard `apps/super-admin/lib/aggregator-enabled-is-not-a-gate.test.ts` (4 tests, mutation self-check on the old JSX). super-admin 16 files / 130 tests, tsc 0, eslint 0.

### Task 8.13: Stop the Seed's Billing Anchor from Blocking Every Local Write
- **Tracing:** browser verification 2026-09-08 (blocker hit by two agents)
- **Target Files:** `packages/db/src/seed.ts`, `packages/db/src/seed-recent.ts`, `AGENTS.md`
- **Change:**
  1. `stores.current_period_end` is seeded at a fixed date (`2026-08-04` on `batiknusantara`), so once the wall clock passes it `computeBilling()` returns `readOnly` and EVERY admin write fails with `SuspendedError`, surfacing as "Gagal menyimpan produk". `npm run seed:recent` does not touch it.
  2. Extend `seed:recent` (INSERT/UPDATE-only, idempotent, one store — the same contract it already has) to push `current_period_end` to a future date, or seed it relative to `now()` in the first place.
  3. `AGENTS.md`'s seed-rot note covers CHARTS only ("the demo looks dead"); add the write path, because the symptom there is a save that fails with a message about suspension on a store nobody suspended.
- **Done when:** on a machine whose clock is past the anchor, `npm run seed:recent -w @tokophi/db` is enough to make an admin save succeed; no agent has to hand-edit `stores` to drive a write path.
- **Status:** `[x]` **DONE 2026-09-09** — finding first: `seed.ts` was ALREADY relative (`fromNow(20)` on `batiknusantara`, `baa70c6`); the `2026-08-04` on the dev DB was "seeded 2026-07-15 + 20 days" rot, so the main seed is untouched and every deliberately overdue/trial/VIP store keeps its shape. `seed-recent.ts` gained `seedBillingPeriod(exec, storeId)` — ONE idempotent UPDATE `set current_period_end = now() + 30 days where id = $1 and current_period_end < now()` — run first by `main()`, plus an `import.meta.url` entrypoint guard so importing the module cannot run the top-up. `packages/db/src/seed-recent-billing.test.ts` (6 real-Postgres tests, verdict from `computeBilling()` itself; 3 mutations → 3 reds). Dev DB: `batiknusantara` `2026-08-04` → `2026-10-09` after one `seed:recent`; second run "masih aktif — tidak disentuh"; the other 7 stores byte-identical. No migration needed (`verify-migrations` ✓). AGENTS.md note added by the parent.
