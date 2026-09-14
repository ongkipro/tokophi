# TokoΦ — Worklog (session log)

> Newest first. What we did + what's next, so any session can resume instantly.
> ▶ **The queue itself lives in [`tasks/NEXT.md`](./tasks/NEXT.md)** — ordered, sized, with AC.
> Pairs with `TASKS.md` (the plan) + `BACKLOG.md` (priorities). Repo: `github.com/ongkipro/tokophi` (private) — commit + push each increment.

## ▶ CURRENT STATE (2026-09-14) · **TokoΦ v1.7.0** · 83 PostgreSQL Tables · 110 Migrations (`0000` through `0109_area_coords`) · RLS 54/55 store-scoped tables (run `verify-rls`) · 175 Vitest files, **1.518/1.518 tests green** · KiriminAja booking on the full v6.2 payload, UAT sheet revision 3 filled and awaiting the owner's submission · production still `KIRIMINAJA_ENV=sandbox` (Task 8.9)

## 2026-09-14 — KiriminAja v6.2 payload in full, two vendor reviews, UAT sheet revision 3 (PR #397)

- **Scope:** KiriminAja reviewed UAT revision 1 ("endpoint v6.2, payload masih v6.1") and then revision 2 per OID. Every remark now lives in code; the sheet was re-filled twice the same day. Branch `docs/uat-mitraapi-v1`, PR #397 (now code + migration, deploys on merge).
- **Code:** migration `0109_area_coords` (village + district centroids from the Kemendagri boundaries dataset; `packages/db/scripts/build-area-coords.mjs` → the reference CSVs; `resolveAreaCoords` the one producer; `coordFields` the sink guard) · `stackedDims` in `apps/admin/lib/shipping-weight.ts` (the parcel box = Σ item volumes stacked on the largest footprint, for quote AND booking — the v6.2 validator prices the manifest, measured with 4 probe bookings) · `kaCreateOrder`: `qty` = Σ `items[].qty`, `items[].metadata`, `note`, both coordinate pairs · `createShipment`: `insurance_amount` = the quoted `insurance` fee, forced on `force_insurance` services; rate list quoted with `insurance: 1`; COD value = `orders.total_idr` (= the T&C §5 formula for an uninsured parcel).
- **Simulation:** run 3 from the allow-listed admin container, **8/8 booked** (`5758-UAT1080737`…`UAT8080746`), incl. 4 kg volumetric at the quoted price. Cancel N/A (no sandbox AWB).
- **Docs:** `KIRIMINAJA.md` (integration map + both reviews), sheet `specs/docs/uat/…2026-09-14.md` → PDF via `ops/uat-sheet-render.mjs` (9 pages), Update Log v1.7.0, `TASKS.md` 8.14 closed in full / 8.9 revision 3, `BUILD-LOG.md` two entries.
- **Verification:** verify-migrations ✓ · tsc lib/db/admin 0 · admin lint 0 · full vitest 1.518/1.518 · PR CI green (tests, astro check, typecheck, 3 builds).
- **Next:** owner submits revision 3 → provider approval → Task 8.9 cutover (`KIRIMINAJA_ENV=production` + key in Coolify, one real booking). Open: rate picker does not yet show force-insurance/fee; forced insurance fee not posted to the seller ledger; `!specs/**` for Coolify watch paths.

## 2026-08-15 — TokoΦ v1.0.0 Release Edition & Master README Overhaul

- **Scope:** Bumping all 10 monorepo package definitions to `1.0.0`, overhauling `README.md` to serve as the definitive system architecture & quickstart reference, conducting live production deployment witness checks (`ops/tokophi-probe.sh`), and codifying the mandatory AI/Collaborator task, log, and reporting protocol in `AGENTS.md` and `README.md`.
- **Version Synchronization:**
  - `package.json`: `"version": "1.0.0"`
  - `apps/admin/package.json`: `"version": "1.0.0"`
  - `apps/super-admin/package.json`: `"version": "1.0.0"`
  - `apps/storefront/package.json`: `"version": "1.0.0"`
  - `apps/landing/package.json`: `"version": "1.0.0"`
  - `packages/db/package.json`: `"version": "1.0.0"`
  - `packages/lib/package.json`: `"version": "1.0.0"`
  - `packages/ui/package.json`: `"version": "1.0.0"`
  - `packages/sections/package.json`: `"version": "1.0.0"`
  - `packages/data/package.json`: `"version": "1.0.0"`
- **Verification & Test Status:**
  - `npm test` -> **82 passed / 8 skipped without DB env (90 total Vitest files, 722 total tests)**.
  - `check:storefront` -> **0 errors, 0 warnings**.
  - `check:landing` -> **0 errors, 0 warnings**.
  - `ops/tokophi-probe.sh` -> **All 5 public surfaces 200/307, DB KiriminAja 200 with rows, SSH reachable, Root disk 16% used, Watchdog heartbeat 53s old**.






## 2026-08-03 — N15: both login pages published a working credential

Closes **N15**, files **N29**. Owner chose *delete the hint*, not *rotate the seed*.

🔴 Verified live on production first: `rich.tokophi.com/login` served `admin@tokophi.id` + `tokophi123`
(the CONTROL PLANE), `app.tokophi.com/login` the seeded owner. The seed creates those rows on deploy —
not placeholders.

⚠️ **Four sites, not two**: both email inputs also carried a `defaultValue` naming the account. Removing
only the password line leaves *which account to attack* published, and the limiter is keyed on IP with
no failed login recorded anywhere.

Guarded by `no-published-credentials.test.ts` — scans EVERY app file (not a list of two; that is how the
24-bit mint survived its own guard), strips `//`+`/* */` comments so the notes explaining the fix stay
legal, does NOT strip HTML comments. Proven red: 4/5 fail on `origin/main`.

**Not done on purpose:** the seeded password still authenticates → **N29** (needs a data fix for
existing deployments, because the seed is not a migration).

## 2026-08-03 — N5 measured to the end: it is a decision, not work · `#135` deployed + verified

`#135` (the surface sweep) is **merged, deployed and verified in production**: `/checkout` h1 count
**0 → 1** (`<h1 class="sr-only">Checkout — Batik Nusantara</h1>`), `/checkout/sukses` **stayed at 1** —
the double-h1 trap avoided. Surfaces 200/200/200.

Then N5, measured on production at 390 px / DPR 2. 🔴 **Its own hypothesis was wrong**: header + footer
are **88 of 912** elements, not the lever. The star rating is still the biggest repeat (204 = 22% of
the page even after wave 3 took it 312 → 204) and it is **at its floor** — `Stars.astro` refuses the
one-`<svg>` version so the rating keeps tracking the merchant's brand colour, which is correct.

🆕 **101 elements (11%) are `display:none` at 390 px**, led by a 60-element desktop mega-menu shipped
to every phone — and **all 11 of its links are reachable elsewhere**, so deferring it costs the crawler
no unique URL.

**Only two options reach Lighthouse's 800 p10, and both are PRODUCT decisions** (drop ratings from
product cards −204 → 708; + defer the desktop nav −264 → 648). No purely technical change is left, so
N5 is reclassified **decision, not work** — like N3/N4/N7 before it.

**NEXT:** N5, N25, N28 all need the owner. Nothing unblocked of size remains.

## 2026-08-03 — Sweep: every route on all three apps, driven in a browser

**Handoff:** [`tasks/2026-08-03-surface-sweep.md`](./tasks/2026-08-03-surface-sweep.md) · closes
**N26**, **N27**; files **N28**.

Routing clean on all three surfaces (0 dead nav links, 0 unreachable pages). Four defects found by
loading pages, all fixed: 🔴 **`/checkout` had no `<h1>`** — the only money-path page without one, third
instance of the N11/N14 class; `/halaman/baru` had none (heading gated on `{isEdit && …}` while the
title string was already computed); `/navigasi` + `/pemasaran` skipped h1→h3.

⚠️ The checkout floor went in the PAGE, not `CheckoutLayout` — the layout's other consumer already has a
visible `<h1>`, so a floor there would have given it two: N14 reintroduced by N11's fix.

Recorded as NOT defects: the `/api/uploads` 404s are local (gitignored dir; production mounts a volume
and serves 6/6), and a dev-DB filename tested against the prod server proves nothing.

super-admin gating verified (7/7 → 307); its screens need a control-plane credential to crawl → **N28**.

**NEXT:** N28 (owner) · N25 (owner) · N5 is the only unblocked engineering item of size left.

## 2026-08-03 — Session: validating wave 3, and a queue stale in the expensive direction

**Handoff:** [`tasks/2026-08-03-validating-wave-3.md`](./tasks/2026-08-03-validating-wave-3.md) ·
branch `feat/seed-recent-carts`.

An AUDIT of `#133`, not a new front. 🔴 **`NEXT.md` was stale on four entries — N19, N20, N21, N23 —
all implemented in `52ef1de`, all still open**, three tagged `NEW`. Four other docs point a starting
session at that file, so this costs a whole session; it nearly cost this one (a worktree was created
for N19 before finding `seedCheckoutSessions` already in the file). **Close the entry in the same
commit as the code.**

All four validated by RUNNING them: seed:recent inserts 900 carts and **0 on a second run**, with both
kinds of `pulih` present (rescued 89 / straight-through 86) so the metric trap is exercised; N20 and
N21 validated by deliberately breaking them and confirming red.

⚠️ Fixed what wave 3 left half-done: `publishedFirst()` lived in `apps/admin/lib/data/`, **which the
storefront cannot import**, so `content.ts` kept a bare `desc(publishedAt)` — the N17 shape again. Moved
to `packages/db/src/article-order.ts`; both apps call it. Honest note in the code that on the storefront
query it changes nothing today (the `terbit` filter + `publishedAtFor()` make it moot) — what it buys is
determinism and one less cross-app invariant.

**NEXT:** N25 needs an owner decision (its AC involves dropping a table on the SHARED dev container) ·
N5 is the only unblocked engineering item of size left.

## 2026-08-03 — Session: N17, and the reason a correct function never ran ✅ `#131` (`5aeb85e`) — merged, deployed, verified in production

**Handoff:** [`tasks/2026-08-03-n17-recovery-link.md`](./tasks/2026-08-03-n17-recovery-link.md) · branch
`feat/cart-recovery-link` · closes **N17** (P1).

`signRecoveryToken` was correct and had **zero callers in all four apps** — because it lived in
`apps/storefront/src/lib`, which the ADMIN cannot import, and the admin is the only surface that lists
abandoned carts. The merchant's WA message carried no way back to the cart; ~50 lines of storefront
restore code were live and unreachable; four docs said it shipped. **A module's location is part of its
contract.** The pair is in `@tokophi/lib/recovery` now.

Two traps the queue's own plan would have walked into: `{{link}}` must NOT go in the seed (three CRM
screens render the same body from `followups` rows, cannot mint a link, and `fillTemplate` emits an
unknown token verbatim — a literal `{{link}}` to a customer), and `cartMessage` must APPEND rather than
only substitute (the seed is not a migration, so substitution alone changes nothing for any existing
store).

Driven end to end in a browser — admin login → real `wa.me` body → that link → banner, cart and typed
fields restored — plus the three refusals. Dev DB left untouched.

**NEXT:** N18 (24-bit `tempPassword()` + no login rate-limit) · N19 (`seed:recent` inserts no
`checkout_sessions`, so a real 30-day window holds **4** carts, 1 with a phone — the entry says 7).

## 2026-08-01 — Session: every store we provisioned got the owner password `tokophi123` — audit wave 2

**Handoff:** [`tasks/2026-08-01-audit-wave-2.md`](./tasks/2026-08-01-audit-wave-2.md) ·
**Consolidated record, authority on every number:** `audit-2026-08-01/FINDINGS-SOURCE.md` ·
Ten read-only agents against `origin/main` @ `86e3ec3`, one worktree each, then seven change sets.

🔴 **`createStore` hashed every provisioned owner's password from `DEV_PASSWORD` — a string published in
this repository and in `AGENTS.md`.** Onboard `budi@tokosaya.com` and anyone who knows that email address
logs in at `app.tokophi.com` as store **owner**: every order with the buyer's name, WhatsApp and full
delivery address, every customer record, and through `settings:write` the bank account and
`requestPayout`. `AGENTS.md` already carried the rule, and `invitePlatformAdmin` **250 lines below in the
same file** had already been fixed — with a comment asserting the other paths were correct. **Instance
patched, class missed.** Random per store now, revealed once in a toast that survives the `router.push`;
proven on `tokophi_test` (`verify('tokophi123') = false`) and guarded by a class-level test that was
proven red 3-of-5 before green. ⚠️ **The code fix does not repair an account already provisioned** — the
production rotation is step ① of the handoff. And the login pages still print those seeded credentials on
screen: an owner decision, not a patch.

**Twelve frozen "today" anchors, and one of them was a WRITE.** `actions/articles.ts` stamped
`publishedAt = 2026-06-30`, and because the update is a full field replace, **re-saving a published
article walked its date backwards** — mechanically identical to the voucher bug one file over. Proven
against real Postgres: three saves held `2026-06-30` under the old code, `2026-07-20 08:30` unchanged
under the new. Ten reads too — a follow-up due today computed **+32**, so the CRM overdue filter could not
fire for it, and the whole activity feed read "0 menit lalu". `createStore`'s own anchor made a store born
**~30 days old with a 3-day trial**, dropping it out of `newSignups30d` on day one. ⚠️ **Un-anchoring
`data/checkout.ts` takes Keranjang Ditinggal from 796/340 to 6/143 on dev and that is CORRECT** — the old
window was a frozen start with no upper bound, 60 days labelled 30. The drop is a **seed gap**:
`seed:recent` inserts no `checkout_sessions`. **Extend the seed; do not re-anchor the app to make the demo
look busy.**

**`#127` fixed five default-location copies and there were six.** The sixth is `/api/public/order` — no
session, the **OWNER connection with RLS off**, and **no `store_id` at all**, so `order by is_default desc`
would prefer another store's default warehouse. Alongside it: drizzle's `desc()` emits a bare `DESC`,
which is **NULLS FIRST** in Postgres, so the orders list and the order detail named **different payment
methods for the same order** — while both files carried comments asserting they matched. Latent (827
payments, 46 unpaid, **0** orders holding both shapes) and, contrary to an earlier draft, **not a money
bug**: `createShipment` derives COD from an `exists` subquery no `ORDER BY` can affect.

**22 money tests had never run on anyone's machine.** `ledger-credit.test.ts` skips without
`TEST_DATABASE_URL`; nobody exported it and there is no CI, so the suites guarding *when a sale becomes
withdrawable* were off by default. A `globalSetup` derives `<DATABASE_URL>_test`, creates it, migrates it
and exports the variable: **16 files / 145 passed + 22 skipped → 22 files / 182 passed, 0 skipped.** The
name must end in `_test` or setup throws — do not relax that.

**And the homepage `<h1>` count was wrong in both directions.** `#127` floored the *missing* case;
`Hero.astro` emitted one `<h1>` **per slide**, so every store shipped **three**. A third defect sat
between them: the floor keys on `type === "hero"` while `heroSlides()` keeps a heading-less pictorial
slide, so that template **stood the floor down AND shipped `<h1></h1>`** — measured **2, both empty**.
Both halves ask the same question now. Plus: PDP thumbnails had no `srcset` at all — **153 940 → 30 782 B
at DPR 1 (−80,0 %)** — and the upload ladder stopped at 1200 while `saveImage` caps at 2000. `Stars.astro`
was **312 elements, 30 % of the homepage DOM**; the rewrite took it **1023 → 915** with `dist/client`
unchanged, after measurement killed *both* candidates `NEXT.md` had named.

**Two checks were caught flaky and repaired before entering the runbook** — one counted a browser cache
hit as an oversize download (5 failures in 6 against a correct build), the other wrote to the shared dev
DB at a fixed UUID. A coin-flip red check is how `verify-rls` sat red for weeks while two cross-tenant
leaks shipped past it.

**NEXT:** ① rotate any production owner still verifying against `tokophi123` — the only step that closes
the *existing* exposure. ② teach `seed:recent` to insert `checkout_sessions`. ③ the 🔴 owner decisions in
`NEXT.md`: the login-page credentials, `tokophi_app` holding full DML on the platform tables with RLS off,
and the impersonation token, now three sessions old. **N8 was rewritten — its "77 rows on production" was
the dev count; production has 65 nulls and not one `ship_postcode`, so every derivation resolves zero
rows.** N6 closed (the client target is already `esnext`, `dist/client` has zero `.js`, and the 44 KiB is
Meta's `fbevents.js`), N12 closed, N4 diagnosed (the carousel's autoplay), N3 answered and recommended for
retirement as a KPI.

## 2026-08-01 — Session: working the NEXT.md queue, and the two entries that were wrong about themselves ✅ `#127` — merged (`dd2129d`) + **deployed and verified in production**

**Deploy verified by the change itself, not by a 200.** The storefront answered 200 all the way through
a build that had not landed yet, then went 503 during the container swap and back to 200 with the new
code. The signal that actually proves it: `toko.tokophi.com/sitemap.xml` went **15 → 21 `<lastmod>`**
(the 6 `/halaman/*` entries), while `/produk/*` and `/kategori/*` stayed at **0** — which is the
deliberate half of N13. Surfaces after: `toko.` 200 · apex 200 · `app.` 307 (login) · `rich.` 307
(login). Homepage still renders 3 `<h1>`s — N14 is real, filed, and not fixed here.

**Handoff:** [`tasks/2026-08-01-next-queue-n9-n13.md`](./tasks/2026-08-01-next-queue-n9-n13.md) ·
**Follow-ups:** [`tasks/2026-08-01-followups-n5-n14.md`](./tasks/2026-08-01-followups-n5-n14.md) ·
Queue worked: **N9 N10 N11 N13**, measured: **N3 N4 N6 N7**, new: **N14**.

**A queue is only as good as its facts, and two of these were false.** N13 said
"`products.updated_at` exists" — it does not; `products` has `created_at` only and `collections` has
**no timestamp column at all**, so a product `<lastmod>` is a migration, not a sitemap edit (S → M).
N6 said "check the Vite `build.target`" — impossible, the storefront ships **zero bundled client JS**
(`dist/client/_astro/` = one CSS file, no `.js`). N10 was stale on arrival: `promo.ts`/`landing.ts`
already returned `{ ok, error }`.

🔴 **N9 was filed as a de-duplication and was actually a cross-tenant write.** "Only the last one
carries the tenant filter" undersold it: `purchases.ts` (2 copies), `inventory.ts` (1) and
`products.ts` (3) had **zero** `locations.storeId` between them. `inventory_levels` has no `store_id`
so RLS cannot reach it, and the `locations` join only *picks* a row — a `variantId` from another store
resolved to **their** shelf and the stock write landed there, silently, in both directions. One helper
now, `storeId` a required parameter (the courier-webhook path runs on the OWNER connection and has no
session), and a source scan that fails on a sixth copy — verified against the pre-change tree.

Also: `deleteLanding` toasted success over a DELETE matching zero rows (RLS filters a foreign id
without an error); a builder homepage with no Hero shipped **zero `<h1>`**, now floored with a
`sr-only` heading and exercised over HTTP against a real build + real DB; `/halaman/*` gained a real
`<lastmod>` (`pages.updated_at` is genuinely maintained), and the sitemap now carries the written
reason products and categories cannot have one.

**8 Lighthouse runs against production settled three entries and reversed one.** Desktop **median 100,
range 90–100** (n=5, TBT 0 ms throughout) — N3 answered, and the old 66–92 spread was simply run 1
being cold every time. **N6 closed**: `unused-javascript`/`legacy-javascript` pass with **0 bytes** in
all 8 runs. 🔴 **N7 reversed**: the mobile bimodality is real (TBT 0 → 395 ms) and it happens with **no
vendor pixel bundle loading at all** — the only two scripts on the page are Cloudflare's — so removing
the `scroll` trigger would cost real tracking and buy nothing. What is left is our own main thread
(`mainthread-work-breakdown` **3,4 s** vs `bootup-time` 0,5 s) over a **992-element DOM**.

**NEXT:** N5 (`dom-size`) is now the only performance item with evidence behind it, and N14 is new —
`Hero` emits one `<h1>` **per slide**, so every store's homepage currently ships **three**, confirmed
on production.

## 2026-08-01 — Session: the order pipeline's quiet lies, then PageSpeed ✅ `#117` `#118` `#119` `#120` `#122` `#123` — all merged; `#117`–`#120` deployed + verified in production, `#122`/`#123` deploying at handoff

**Handoff:** [`tasks/2026-08-01-order-pipeline-and-pagespeed.md`](./tasks/2026-08-01-order-pipeline-and-pagespeed.md) — findings, measurements, the NEXT list, and the owner decision recorded on the record.

Two halves. **Part 1** audited the order pipeline by grepping for CLAIMS and checking them against SQL.
`destinationGuessed` was described in a comment as flagging a fuzzy-matched shipping destination — the
identifier existed **nowhere in the repo**, while 77 orders carry no `ship_district_id`, so parcels were
booked to a guessed kecamatan in silence and the COD province gate resolved the province *from that
guess*. Also: `markLabelsPrinted` reported success for rows RLS had filtered out; `createOrderPayment`
would mint a live VA for a **cancelled** order (buyer pays, ledger correctly refuses to credit — money
in, no sale); the order list and the order detail had **two different definitions of "the order's
payment"**, including COD vs VA, which is the fact `createShipment` turns into a cash instruction for a
courier; and an unescaped `_` in the search box matched **all 842 orders**.

**Part 2** found a live KiriminAja quota any signed-in user could spend, and a `batal`/`retur` inventory
restore whose tenant scoping was a `locations` join that only *picked* a row and never proved whose —
on the one path that runs on the OWNER connection with RLS off.

**Part 3 was PageSpeed, and the finding reframed it: the pixels were the page.** Switching Meta +
Google + TikTok on took mobile **90 → 66** and TBT **130 ms → 770 ms**. The downloads were never the
problem (all three were already `async`) — the cost is parse+execute of three third-party bundles during
the paint. Self-hosting Inter (render-blocking **1.409 ms** across three layouts, in front of an LCP that
was **82% render delay**) and generating real image widths (**461 KiB** wasted; a 1920×1080 hero on a
412 px phone) took it to **75**. The owner then chose to load pixels on first interaction, accepting a
named cost: bounce PageViews under 10 s are no longer recorded. Revenue attribution is unaffected — it
is built from the order row on the server (ADR 0012).

⚠️ **I shipped a regression in `#119` and found it by measuring, not by re-reading:** the hero's new
`data-srcset` was promoted only onto the `<source>`, never the `<img>`, so waking a slide fell back to
the full-size original (106 KB). Fixed in `#120` and now guarded by a browser check — the class is
invisible to `tsc`, lint and `astro check`, because only `currentSrc` shows it.

**FINAL NUMBERS** (`#122` landed as `d11a96d`, SHA read off the running container): **mobile 66 → 89**
(median of 3: 92/76/89) with the same three pixels configured. ⚠️ **Desktop cannot be claimed either
way** — 4 runs span 66–92 against a single-run baseline of 84, and TBT is 0 in all of them, so the swing
is LCP/network noise and nothing can be said until ≥5 runs. The mobile score is *bimodal*, not noisy:
`scroll` is one of our pixel triggers and Lighthouse scrolls during a run, so a run where that lands
before TTI pays for all three bundles (TBT 630 ms vs 80 ms).

**NEXT:** a defensible desktop number (≥5 runs) · two **approved**
Cloudflare zone settings, procedure in `CLOUDFLARE-PERF.md`, not doable from this repo · `dom-size` 992
and a `speed-index` of 7.1 s against an LCP of 1.7 s, undiagnosed · the impersonation-token decision is
still open and still the owner's.

## 2026-08-01 — Session: the audits moved off tracking, and the money paths were worse ✅ `#105` `#107` `#112` `#114` `#115` `#116` — all merged + deployed + content-verified in production

**Handoff:** [`tasks/2026-08-01-audit-wave-money-auth-storefront.md`](./tasks/2026-08-01-audit-wave-money-auth-storefront.md) — full findings, the NEXT list, and what this session should teach the next one.

Parallel read-only auditors, one dimension each, then a second round pointed at my OWN merged diff.
That second round found two of the worst defects, which is the whole argument for doing it.

**The one that matters most: production could not confirm a single prepaid payment.** All five builders
of the AutoLaris callback URL built it bare; the endpoint fails closed on a missing token; the secret is
set on the live stack — so **every genuine callback was a 401**. `payments` stayed `menunggu` for ever,
orders never became `dibayar`, no ledger row, and platform invoices ride the same callback so
`current_period_end` stopped advancing. Uncatchable locally: with no secret set, dev accepts an
unauthenticated callback. Production confirms the fingerprint — **5 AutoLaris rows, all `menunggu`,
none ever `berhasil`** (the 56 `berhasil` are COD, which never touches the callback).

Also: stock could go **−4** from a cart naming one variant twice (the `FOR UPDATE` gate ran per LINE);
PPN was charged on the pre-discount subtotal and written into `orders.tax_idr`, the faktur's base; a
session could not be revoked at all; and six ledger tests dead since migration `0081` were hiding a real
production bug — voiding a shipment on a dispatched order silently did nothing. `astro check` had been
typechecking **none** of the storefront's 92 files since 22 Jul, and 16 migrations were unapplied on the
shared dev DB because drizzle runs a pending batch in one transaction.

**NEXT (owner first, nothing blocked by code):** ① match the 5 stuck `reff_id` + 3 old invoices in the
AutoLaris dashboard — our DB cannot tell "paid but rejected" from "never paid"; ② ask AutoLaris for a
status/inquiry endpoint (we have none — `create_payment` only) and their callback retry policy;
③ build the super-admin manual payment confirmation, through the callback's own code path — today
**one line in the entire codebase** marks an order paid, and it lives inside the webhook; ④ a
reconciliation screen for stale `menunggu`; ⑤ one real prepaid transaction as the actual proof.

## 2026-07-31 — Session: the audits reached the surfaces nobody had looked at, and both were worse than the ones that had ✅ `38958fe` `a16d7f7` `aa6cfeb` `8edef84` (+ docs) — branch `feat/fe-polish`
> Six parallel audits over two days. The pattern that matters: **every one of the worst findings was
> unreachable by clicking around the demo store.** Its data happens to avoid them.

- **"Generate resi" would have told the courier to collect cash from 67 already-paid buyers.** COD on
  a booking was a free parameter (`input.cod ? total : 0`), never derived from `payments.method`. The
  bulk loop passed `!!rate.cod` — the SERVICE's capability, `true` for every order on an SPX service
  in a COD-enabled store — over a queue that deliberately holds prepaid orders. Measured: 75 in the
  queue, 8 COD, **67 already paid**. The opposite face: the order detail's checkbox defaulted to
  `false` and was never seeded, so a real COD parcel was booked collecting **0** and the merchant was
  then credited the full sale as WITHDRAWABLE for cash nobody took. Now derived; a caller that
  disagrees is refused.
- **An `admin` operator could reset any merchant OWNER's password.** `resetOwnerPassword` was
  correctly owner-gated; the function beside it ran at `admin` and matched on `userId` alone — no
  `store_users` join, no `storeId` filter — so it reached ANY user row on the platform, and `storeId`
  was used for nothing but the log line, so the trail could be pointed at the wrong store.
- **A payment landing after a `retur` credited the full sale, immediately withdrawable**, with the
  claw-back already spent and the order terminal. Stock restored AND the money kept.
- **The order state machine allowed everything it did not explicitly refuse** — including
  `selesai → batal`, which claws back an `available` sale on a delivered COD order whose cash is in
  hand. Explicit table now; 21 transitions refused, both money-losing ones among them.
- **The homepage advertised a payment method the gateway has been measured refusing** ("QRIS &
  E-Wallet" hardcoded; all five e-wallet rows `enabled=f`), and said nothing about Virtual Account —
  5 of the 6 channels that work. Derived from the same list checkout offers now: "Transfer Bank & QRIS".
- **The Diskon dashboard's savings tile was Rp90,3jt of fiction** — its own function was commented
  "Fabricated". `sum(orders.discount_idr)` is **0**, over 0 discounted orders.
- **`SECTION_DEFAULTS["category-nav"]` shipped three of the demo's handles** — 200 on the demo, 404 on
  kopi-senja. The comment defending them ("an empty array renders an empty husk") was false. Now empty,
  falling back to the store's own live collections.
- Also: the Store Healthcheck ran on a frozen `2026-07-02` (a 34-day-dormant store read "ok", a live
  one read **−23 hari**); invited platform operators got the fixed password `tokophi123`;
  `/pesanan?bayar=xxx` was a 500; landing HTML became owner-only (`landing:html`) after the decision.

**Two things worth keeping.** The audits also stated what is CLEAN with evidence — the three partial
unique indexes that make a double-credit a DB impossibility, seven COD invariants at zero violations,
the `/pesanan` tab partition summing to `count(*)`, the super-admin money re-derived from SQL — so
those do not get re-audited. And one backlog line was **stale**: "route the two shipping status writes
through `applyOrderStatusChange`" was already done. An audit trusted the ledger over the code and paid
for it; the ledger is now reconciled.

⏳ **NEXT.** Two owner decisions are open: the impersonation token (replayable inside its 2-minute
window, rides in a query string, and mints a 7-day session that outlives the operator's own), and
`discounts.code` being unique ACROSS EVERY TENANT — the first merchant to register `GAJIAN25` blocks
all others, and the constraint doubles as an existence oracle over their codes. The dev DB's migration
ledger is still 21 entries behind its own schema, which blocks `npm run migrate` locally and is why
`/promo/*` and `/lp/*` cannot be rendered on this machine at all.

## 2026-07-30 — Session: the money paths were quoting one price and charging another; /tema had three page types and one palette ✅ committed `604285a` + this one (worktree `fe-polish`, branch `feat/fe-polish`, **NOT merged → not deployed**)
> Started as "validate the previous session". The previous session turned out to be TWO: five commits
> on a **stale local `main`** (418 ahead / 30 behind origin) whose work had already reached
> `origin/main` by another route and in a **better** form — so auditing them was auditing dead code —
> and an unfinished `feat/meta-integration` in the `promospec` worktree that **a second Claude session
> was actively writing to while this one ran** (`ps` showed two `claude.exe`; files changed 7s apart).
> Per AGENTS.md that worktree was left alone; this session took the frontend lane instead.

- **Every voucher a merchant created was born expired.** `lib/actions/discounts.ts` anchored
  `starts_at`/`ends_at` to `ADMIN_TODAY = 2026-06-30` (the seed's frame) while the clock kept moving.
  A blank period wrote an `endsAt` **29 days in the past**; the gap widened a day per day. The Diskon
  list read the same frozen clock, so an expired voucher showed "Aktif" — and since `endsInDays`
  seeds the editor's period field, opening a voucher and pressing Simpan wrote the lie back and moved
  its expiry **backwards**.
- **A scheduled flash sale never went live.** The editor saves `terjadwal`, both readers demanded
  `status='aktif'`, and **nothing ever promoted the row**. Same shape for `terjadwal` vouchers, which
  were redeemable at checkout (`applyDiscount` only rejects `nonaktif`) yet invisible on `/promo` and
  labelled "Terjadwal" in the seller list — three definitions of "usable" for one row. **New contract,
  now in AGENTS.md: `nonaktif` = OFF; the DATES are the schedule.**
- **The voucher usage limit was not race-safe** — while a comment claimed it was. `applyDiscount`
  reads `used_count` outside any txn, unlocked, and the increment was a bare `used_count + 1` with no
  re-check, so N concurrent orders on the last slot all passed. Now re-checked in the UPDATE's own
  WHERE; the loser updates 0 rows → `VoucherExhausted` → the whole order rolls back with a 409.
- **A flash sale never reached the variant rows.** The override hit the headline price only, so a
  flash product WITH options rendered the pre-sale price next to its own "-43%" badge while
  `/api/public/order` charged the sale price.
- **A sold-out product with no `product_options` kept an enabled buy button** and the item went into
  the cart. `updateVariant()` was the only code that wrote the stock line or disabled the buttons and
  it is reachable only through `#variant-picker`, which such a product never renders — **5 of the
  demo's 22 active products are that shape**. Availability is server-rendered now. A non-existent
  option combination used to keep the PREVIOUS variant, so the page said "Beige / L" and the cart
  line said "Hitam / L"; it refuses the sale instead.

### `/tema` — three page types, three jobs (was: three page types, ONE palette)
- `page_templates.type` has been `homepage | category | product` since ADR 0009, and the builder
  offered **the same eleven sections to all three** — `BuilderClient` never even received the type.
  Now `puckConfigFor(type)` narrows the palette from `SECTIONS_BY_TEMPLATE_TYPE`. **The palette is
  narrowed, never the RENDERER**: a template already holding a section no longer offered for its type
  keeps rendering, so nothing published is silently deleted.
- **A `category` template used to REPLACE the whole page** — building one cost the page its `<h1>`,
  its breadcrumb and its cover while the BreadcrumbList JSON-LD kept publishing a trail nobody could
  see. `CategoryHero` is now **always** rendered; the template is the page's BODY. (`produk/index.astro`
  already worked this way — the two sibling listing routes had simply diverged.)
- **New section `product-listing` ("Daftar Produk")** — the real catalogue: server-side sort,
  12-per-page pagination, one empty state, wrapping the same `ProductListing.astro` the hand-built
  page uses. It exists because the only product section on offer was Grid Produk — a flat slice
  capped at `limit` with no sort and no paging — so the builder's own hint steered merchants into
  **silently truncating their catalogue**. Grid Produk stays what it is: a merchandising row.
- **`category` was the one type of the three never seeded**, so the demo could not show what a
  category template even looks like while the builder happily let a merchant create one. Seeded now
  (`CATEGORY_DEFAULT`), matching what Batik Nusantara renders live.
- **Two Dawn-shaped sections added**, chosen for what an Indonesian storefront actually needs:
  **FAQ** (Dawn's "Collapsible content") — native `<details>/<summary>`, no JS, keyboard + SR
  accessible for free, and it answers the questions that decide the sale ("berapa lama kirim?",
  "bisa COD?") on the PDP tail before the shopper has to ask WhatsApp — and **Kolom Ikon** (Dawn's
  "Multicolumn"), the trust row, standalone so it works on a category page or a PDP tail where the
  hero's own `features` strip cannot reach. Both render **nothing** until the merchant adds a row,
  and both ship EMPTY: a trust badge is a promise, and seeding "Gratis Ongkir" would make every new
  store advertise a service it may not offer.
  - **Dawn's Newsletter was deliberately NOT ported.** There is no mailer in this repo, so the form
    would collect addresses nothing reads — the exact "screen with nothing behind it" failure
    STATUS.md exists to police.
- Icon keys moved to `@tokophi/sections` (`SECTION_ICON_KEYS`) so the Puck picker is derived from the
  same allow-list the renderers use; an unknown key falls back to a neutral dot on **both** sides.
- Builder UX: Publish now shows "Menyimpan…" (it never changed during the round-trip, so two clicks
  wrote twice) and Puck `permissions` refuse editing for a role without `theme:write` (it could drag
  and edit the whole page and only find out at Publish, with the work already done).
- Hero slide `defaultItemProps.ctaHref` was still `/kategori/dress` — a handle only the demo owns.
  `SECTION_DEFAULTS.hero` had been cleaned for exactly that reason and the array default was missed,
  so every slide a merchant **added** still 404'd. Now `/kategori/semua`.

**Verified, not assumed:** `tsc --noEmit` clean (admin + sections); `astro check` adds no new error
(the 8 in `Header.astro` are pre-existing); storefront builds; and driven in a real browser against
the dev DB — price renders `Rp 89.000` with the NBSP the server uses, the flash PDP shows
Rp 199.000 struck against Rp 349.000, a product flipped to 0 stock rendered "Stok habis" with both
buttons `disabled`, a category page WITH a template kept its single `<h1>` + breadcrumb + sort
control + 17 product cards, and the FAQ/Kolom Ikon pair rendered on a PDP tail with the empty
question dropped and an unknown icon key falling back to a dot. **Every DB row touched for a test was
restored** (inventory back to 22; the test category template deleted; the product template restored
byte-for-byte).

⏳ **NEXT — still open, audited but not fixed** (four parallel audits produced ~80 findings; this
session took the money paths and `/tema`). Ranked:
1. **`/tema` security:** the link picker accepts `javascript:` and it reaches four storefront
   `<a href>` render sites unsanitised; SVG upload is served `image/svg+xml` with no CSP/`nosniff` on
   the admin origin (stored XSS, and `media:write` is held by `staff` in every tenant); `saveTemplate`
   writes unvalidated client JSON, so one bad `mode` 500s the whole storefront.
2. **`/promo` money:** `OrderFunnel` totals ignore free shipping + PPN (quotes ≠ charges);
   `buildPackages` ignores the live flash price; `/thanks` prints arithmetic that does not add up.
3. **Homepage:** the trust strip advertises E-Wallet while all five e-wallet channels are
   `enabled=f`; Category-Nav defaults publish three verified 404s on every non-demo store; the
   Testimoni arrows are dead (proven in Chromium); the image-less hero renders near-black.
4. **SEO/a11y/perf:** `" — "` title separator vs the house `" - "`; canonical drops `?page`;
   3 × `<h1>` on the homepage carousel; no JSON-LD on the homepage; the LCP hero bypasses the repo's
   own `imageSrcSet()`; render-blocking Google Fonts.
5. **The `feat/meta-integration` audit** (crypto/AAD, `/pemasaran` read gate, raw PII to Google,
   CAPI token with no sender) is written up and belongs to whoever owns that branch.

## 2026-07-22 (lanjutan) — Front-end pass: sold-out badge · merchant-owned footer · icon header + ⌘K palette ✅ **PR #30 (`f43e46a`), DEPLOYED + verified live**

**Deploy verified by the artefact, then by USING it.** Storefront container `8398c2093fd2` →
`7cf333b4d6e0`; the shipped HTML carries the `<dialog>`, the `<a href="/cari">` trigger, the cart
badge `hidden` at zero, and no `href="undefined"`, while the old 208px `#site-search` is gone. But a
shipped `<dialog>` is not proof its script runs — so the palette was **driven on production**: it
opens, "dress" returns KATEGORI + PRODUK, Esc closes, Ctrl+K reopens, `/api/search` answers in 131ms
over TLS, `/cari` carries its own input, 0 overflow at 320px, 0 console errors, all four surfaces up.

Three tasks, each with its own committed file in `specs/docs/tasks/`. Full reasoning in CHANGELOG;
what a future session needs and cannot re-derive:

- **`inStock` is ONE function now** (`data/catalog.ts`), read by the card, the buy box, the schema.org
  availability and the related-row ranking. It agrees with `/api/public/order` by construction. A
  product with **no** variant rows is AVAILABLE — do not "fix" that into sold-out.
- **The footer's nav columns belong to the merchant.** Do not re-add a derived "Koleksi" column or a
  hardcoded "Belanja"/"Jurnal": that is the platform-default-leaking-into-a-tenant bug `data/nav.ts`
  keeps fixing.
- **`/cari` owns a search box now, and that is load-bearing** — the header's magnifier is an
  `<a href="/cari">`, so a JS-less visitor still has somewhere to type. Never turn it into a `<button>`.
- **No shopper account icon**, by design and by the owner's decision. The honest version is a
  "Lacak Pesanan" page keyed on order ref **+ phone** (ref alone would let anyone enumerate orders).

**Four defects only a browser could find — three of them written in this same session.** A green
build and a clean typecheck proved nothing about any of them: Esc was eaten by the search input's
native clear; the browser's own ✕ sat beside ours; the cart badge was `hidden` at zero while its
script only ever set `textContent`, so it could never appear; and the icon row overflowed 320px
because the logo is *allowed* 176px next to 142px of icons. `audit:responsive` 132/132 after the fixes.

## 2026-07-22 — Session: listing filter + pagination (audit #16 closed out), and a safety gate that had been crashing ✅ **PR #28 merged (`da1da19`), DEPLOYED + verified live**

**Deploy verified by the artefact:** storefront container `525c237eb64e` → `89ce9f047897`, then the
shipped HTML on `batik-nusantara.tokophi.id` read back — filter bar, price inputs, promo toggle,
`dropEmpties`, the `xl:w-52` header fix, and **no** `data-reveal-grid`. Filters exercised on prod:
`?kategori=dress`→2, `?promo=1`→1, `?min=100000&max=150000`→4, `?min=abc` ignored, `?page=5` clamped.

⚠️ **The wait-loop that watched for it was itself unsound the first time**, and this is the lesson to
keep: `until [ "$(docker ps -q --filter name=storefront-)" != "<old id>" ]` **passes while the
container is momentarily GONE** mid-recreate — empty is also "not the old id". It announced the swap
before anything had happened. Same family as the 2026-07-20 false green. The condition must be
**present AND different**. A check that can pass while the thing it checks has not happened is not a
check — including when we are the one who just wrote it.


Picked up after a laptop died mid-session. The first thing done was to establish that **nothing was
half-finished** — the previous session had merged PR #27 sixty minutes earlier and left a clean tree —
rather than assume a dead machine meant lost work.

**New convention, applied from this session on:** a task gets its own committed `.md` in
`specs/docs/tasks/<date>-<slug>.md` **before the first line of code**, updated as it goes, with an
explicit **NEXT** at the bottom. Session-level handoffs (BACKLOG/WORKLOG/CHANGELOG) survive because
they are committed; anything living only in a chat window does not. One file per task, never a shared
`TASK.md` — several agents work this repo at once.

**What shipped:** `?kategori=` / `?min=` / `?max=` / `?promo=` / `?page=` on the one shared
`ProductListing.astro`, so `/produk`, `/kategori/<handle>` and `/cari` all gained them at once. Full
reasoning in `CHANGELOG.md`; the parts that will otherwise be re-broken:

- **A control renders only when it can act, and a param whose control is absent is IGNORED.** The
  alternative is `?kategori=x` on a single-category page emptying the grid with no visible way back.
- **`form.submit()` does not fire the `submit` event.** The sort auto-submit path had to call the
  URL-cleaner by hand; wiring it to the event alone silently shipped `?min=&max=&sort=terbaru`.
- **No size filter** — `products.sizes` is a label list, stock is per variant. A filter that ignores
  variant stock claims sizes we may not have.

**The lesson worth more than the feature: a gate nobody watches is not a gate.**
`npm run audit:responsive` had not completed since **2026-07-15**, when the demo store got an active
primary custom domain — middleware 301s every other host to a name no dev machine resolves, so the
sweep died on its first navigation. It never reported "0 breaks"; it printed a stack trace nobody
read. Repaired (it now probes for the redirect and maps that host back to the dev port in-browser,
touching no shared DB row) — and it went red on the very first honest run: **11/132**, a 4–6px header
overflow at exactly `lg` (1024px), reproducing on `/kontak`, a page with no listing at all. Fixed.
Same shape as `verify-rls` being red for weeks: **an alarm that cannot ring is an alarm that is off.**

**Verified in a browser, not by a green build** (12 → 13–14 of 14 across a clicked page link, filter
counts reconciled against SQL, sort order correct across the page boundary, `q` preserved when
filtering search results, 0 overflow at 360px, no pagination control under 44px). The demo store has
exactly **12 active products against a 12-per-page listing**, so two drafts were temporarily activated
to make it paginate at all, then set back — a shared database must be left in the state it was found.

## 2026-07-20/21 — Session: docs reconciled, seven cross-tenant holes closed, and the whole front-end pass ✅ **10 PRs (#9–#26), ~10 verified deploys**, `main` at `036f05e`

Started as "reconcile the analysis docs against what is on GitHub" and became a correctness pass, because
the docs turned out to be wrong in ways that mattered.

**The method that made the difference — verify the ARTEFACT, not the status.** A watcher reported
"containers rebuilt + healthy" and 200s from `app.tokophi.com`; all of it was true and all of it was about
the PREVIOUS build. Every deploy since is verified by recording the container ID first and only trusting a
deploy once that ID is REPLACED — then reading the shipped HTML or the DB columns. Written up in DEPLOY.md
("How to verify a deploy ACTUALLY landed"). A false green costs exactly as much trust as a false red.

**Five 🟢 REAL rows in STATUS.md were broken when they were written**, and every one failed the same way:
the check stopped one layer short of the seam. Counting RLS'd tables cannot see un-RLS'd children. A COD
browser test that stops at the Bayar button cannot see that COD never entered the shipping queue. Auditing
impersonation's front door cannot see that the token *exchange* accepted any session JWT.

**Security — audit the CLASS, not the instances.** `e61df25` had patched the three cross-tenant call sites
it happened to find. Auditing every writer of a table with no `store_id` found **four more**, all shipped:
`media.ts` (`media:write` could delete another store's product image), `deleteDiscount` (a blind-fire
cross-tenant DELETE, harmless only because the table is empty), `createPurchaseOrder` (a client `variantId`
written as an FK — "Terima barang" would add stock to the victim's shelf), and `syncChildren`. The rule now
lives in AGENTS.md, and `verify-rls` gained check **5c** so the class cannot grow silently — its failure
path was exercised, not assumed.

**Order state / resi.** One writer for `orders.status` — and "route it through the state machine" was NOT
sufficient: the machine treats only `batal`/`retur` as terminal *on purpose* (so `selesai → retur` stays
legal for the ledger claw-back), which means it would happily execute `selesai → diproses` and un-complete
a delivered, cash-collected COD sale. The shipment refusal set is permanently wider; two tests pin it.
Also: a partial print run stamped un-labelled parcels as printed (they left the queue and silently never
shipped), one bad gateway reply killed the entire tracking sweep, and the poller could starve orders
forever. Migration 0062 adds a merchant-facing stuck-parcel flag; the poller now logs the raw KiriminAja
payload so #12 becomes answerable from one real booking.

**Front-end (the phase the owner asked for).** Product search `/cari` (the audit's biggest gap), responsive
`srcset` served by an on-demand resizer with an **allow-listed** `?w=` — the allow-list is the security
boundary, since `?w=1` ignored is still a cacheable URL, and a first pass using `Number(raw)` smuggled the
unbounded key space back in via `400.0`/`4e2`/`0400`. A 404 that recovers the sale. URL-driven sort
(shareable, back-safe; the form carries `q` so sorting `/cari` doesn't throw the search away). Social
profiles + a redesigned footer whose EMPTY state was verified first, because that is what every store shows
until a merchant fills it. Favicon accepts any raster format and becomes a real PNG — and
`withoutEnlargement` was tried and **reverted**: measured, a 64px mark filled 1.6% of the icon instead of
100%. Timezone bug: dates rendered in the runtime's zone, so Node said UTC and the browser said WIB — a
7-hour gap that also filed products under the wrong DAY in the server HTML.

**Measured, then left alone.** Core Web Vitals on prod mobile 3×: **LCP 348–552ms, CLS 0, TTFB ~150ms** —
5–7× better than the "good" bar. Nothing to optimise; chasing 552→500ms is the 0ms-impact work to skip.

**#15 closed as superseded.** The 25 stale local-`main` commits: kelurahan and the ongkir perf fix had
already landed independently; the only unique part (courier curation) is a philosophy `origin/main`
deliberately rejected. The shared checkout was left untouched — no reset, no rebase.

**Next:** the only open task is **#12**, blocked on one real production booking. See BACKLOG "NEXT UP".

## 2026-07-18 — Session: Jurnal blog gets editorial, topic-true images ✅ **DEPLOYED** `dfe1631` (PR #7) on main, verified live

- **The demo Jurnal was illustrated by product-photo crops** — `seed-journal.ts` cropped catalogue shots
  to the card's 3:2, so "Cara Mencuci Batik" showed a model in a dress and "Baju Rajut Melar?" a cardigan
  on a hanger. Reads as placeholder.
- **Replaced with 15 dedicated editorial header images** (`ace867e`), one per published article, committed
  at `apps/admin/public/journal/<handle>.webp` (900×600 WebP q82, 28–80 KB, 670 KB total): hands waxing
  batik with a canting, a batik cloth hand-washed in a basin, an office-batik flatlay, knitwear folded
  flat, a wrapped parcel. `makeImage` now sources `journal/<handle>.webp`; the rest of the pipeline is
  unchanged (3:2 crop, WebP q82, `media` row, `/api/uploads/` path → lands in Files like a merchant
  upload). Draft stays imageless (brand-tint fallback). **Content unchanged (already good).**
- **Merged + deployed.** PR #7 → main (`dfe1631`); Coolify redeploy (merge webhook). **Verified live in
  production:** `batik-nusantara.tokophi.id/blog` shows all 15 articles; the featured image resolves at
  `https://app.tokophi.com/api/uploads/jurnal-cara-mencuci-batik.webp` → **200 image/webp** (the new
  image, 64 KB); `og:image` absolute per article (+ `twitter:image`); 15 `media` rows in Files. Migrations
  0058–0061 applied on prod via the migrate step (the `migrate` service runs `seed-journal` + mounts
  `tokophi-uploads`, so images seed automatically).
- ⚠️ **Cache note (in BACKLOG):** `/api/uploads` sends `Cache-Control: immutable` but `seed-journal`
  reuses `jurnal-<handle>.webp` — a returning visitor keeps the old image for a year after any art change
  (that is why a local hard-refresh was needed to see the new art). Fine for a fresh prod seed;
  content-hash the filenames if journal art is ever expected to change again.
- **Images are AI-generated** (editorial, brand-consistent — not stock of someone else's clothes). Files
  live in git; the pipeline is the merchant's own upload path.
- 🚨 **PROD INCIDENT (fixed same session).** Post-deploy health check found the storefront **503 for ~2h**
  (admin/super-admin/landing 200). Root cause was **not** the blog change: the **VPS disk was 100% full**
  (Coolify keeps every per-deploy image — 204 images / ~129 GB), so **Postgres crash-looped** on its
  end-of-recovery checkpoint (`No space left on device` → PANIC → reinit → `database system is in recovery
  mode`), and the SSR storefront 503'd because it reads Postgres every request. **Fix:** `docker builder
  prune -af` + `docker image prune -af` → freed ~130 GB (100% → 14%); Postgres finished its checkpoint and
  came up **on its own, no restart, no data loss**. **Prevention:** added `ops/tokophi-docker-cleanup.sh`
  + a daily cron (`/etc/cron.d/tokophi-docker-cleanup`, 03:30 UTC) — see DEPLOY.md "L1b disk-cleanup
  safety-net". This is the exact L2/L3 gap the watchdog names (running-but-unhealthy, not created/exited).
- Docs: CHANGELOG (shipped in PR #7), BACKLOG NEXT-UP + follow-ups (`4473cc0`, PR #8), DEPLOY.md L1b +
  `ops/tokophi-docker-cleanup.sh` (incident), this entry.

## 2026-07-16 — Session: domain topology → storefronts on `tokophi.id`, custom domains via `cname.tokophi.cc` (CF for SaaS) ✅ **DEPLOYED** `c4fc901` `5efc44b` `5d33130` on main

**Final split (with user):** platform = `tokophi.com` (landing/`app.`/`rich.` — untouched) · storefront default = **`<slug>.tokophi.id`** · custom domains → **`cname.tokophi.cc`**.

- **Infra (applied on Cloudflare + the origin box, browser-verified):** `tokophi.id` zone active; Traefik dynamic router `ops/tokophi-stores-id.yaml` serves `<slug>.tokophi.id` (200, valid edge cert); `ops/tokophi-com-to-id-redirect.yaml` 301/308s old `<slug>.tokophi.com` → `.id` (path+query kept); Cloudflare for SaaS **enabled** on `tokophi.cc`, fallback origin `cname.tokophi.cc` active; both zones SSL `full` (NOT strict — origin cert is `*.tokophi.com`). Coolify env `STOREFRONT_BASE_DOMAIN=tokophi.id` + `CUSTOM_DOMAIN_CNAME_TARGET=cname.tokophi.cc` set via `/root/cf_env.py` (**no `~/.coolify_token` on the box** — DEPLOY.md was stale; env must go through that helper or the UI, never raw SQL). Verified live post-deploy in both containers.
- **Seller → Pengaturan → Domain** (`c4fc901` + `5efc44b`): system-locked `<slug>.tokophi.id` shown read-only; **one root + one www** per store (`domainKind`); the seller picks **Utama** and the storefront middleware **301s every other host to it** — the other of the root/www pair AND the `.tokophi.id` subdomain (GET/HEAD only, never `/api/*`; no-op while no custom domain is active); DNS records shown as **Tipe · Nama/Host · Nilai** with the Name spelled out (`@`/empty vs `www`); a **verified domain is locked** — `removeDomain` refuses and `requestDomainChange` opens a **support ticket**. `addDomain` refuses every platform zone (`tokophi.id/.com/.cc`).
- **Pickup address** (`5d33130`, migration **0051** `store_settings.sender_postcode`): the kelurahan the seller picked **was reaching nobody** — `sender_kelurahan_id` is deliberately NULL and the name was never written into the address either. `composePickupAddress()` now sends `"Jl. …, Kel. …, 60281"` to `request_pickup`. **`KaSender` has no zipcode field** (`destination_zipcode` is the buyer's, already wired) — the postcode reaches the rider only inside that address string, which is what keeps the new column from being dead.
- ⚠️ **NOT yet proven end-to-end:** the pickup-address change touches a real shipping path — build-green is not proof. It needs a real booking (create a resi, read the address KiriminAja received). User will verify. Also still open: **slice-4 provider client** (register the custom hostname via the CF API, poll cert → `active`) — until it lands, a verified domain rests at `provisioning` and no custom domain can go live.
- See `CUSTOM_DOMAIN.md`, `DEPLOY.md` §2c/2c-redirect/2d, memory `custom-domain-infra`.

## 2026-07-15 — Session: MERGED TO MAIN + DEPLOYED + store-profile editor closes the whatsapp gap ✅ `b937a93` on main, deployed, validated in production
> Everything from the day's sessions is now LIVE on tokophi.com.

- **Merged & deployed.** Fast-forward `origin main → b937a93` (push HEAD:main, working tree untouched so agent-1's hanging files stayed put), then triggered a Coolify redeploy via API. **Validated in a real browser on production** (`batik-nusantara.tokophi.com/checkout`): kecamatan search ✅, kota/provinsi auto ✅, kelurahan→kodepos ✅, the new "Kirim ke" summary ✅, ongkir ✅, **0 console errors**. og:image + per-tenant sitemap live; the dummy `6281234567890` number gone; every key page HTTP 200 (so migrations 0049/0050 applied cleanly — no 500).
- **Two production landmines defused BEFORE deploy.** (1) `_journal.json` timestamps had to be monotonic or drizzle silently SKIPS a migration → `stores.whatsapp` never created → storefront 500. Verified monotonic. (2) Migration 0049 hardcoded a demo WhatsApp backfill (`6281234500999`) — on prod (migrate runs, seed does not) that would have put a FAKE live "Hubungi via WhatsApp" button on the real storefront. Removed the backfill (`b937a93`): columns stay NULL on prod → no button (honest) until the merchant sets their own.
- **Store-profile editor — closes the gap the migration opened.** Pengaturan → Profil was COSMETIC: hardcoded `defaultValue`s (incl. a placeholder WhatsApp `+62 812 3456 7890`), no save wiring, and email/address/currency fields with no column behind them. After migration 0049 the storefront reads `stores.whatsapp` (NULL → no button), so a merchant had NO way to restore their CS button. New `StoreProfileCard` + `store-profile.ts` action: name + tagline + WhatsApp, real columns, `settings:write` + `withTenant`. Number is normalised (`0812…`/`+62…` → `62…`), and clearing it removes the storefront button (honest, not a placeholder). Fake email/address/currency fields dropped. **Proven full-circle in a browser:** set `0812 9000 1234` in admin → stored `6281290001234` → storefront WA button becomes `wa.me/6281290001234`; a store with no number shows no button.

### ▶ NEXT / still open
- **Set batik-nusantara's REAL WhatsApp on prod** — its storefront button is currently absent (whatsapp NULL after migration). The merchant sets it in Pengaturan → Profil now that the editor exists; or set the real number directly.
- **Custom domain slices 2–4** (Cloudflare-for-SaaS cert issuance, 301 primary redirect, SNI experiment) — blocked on the user (cost + a CNAME-target domain).
- **Payment callback HMAC** — blocked on AutoLaris signing spec.
- **⚠️ Agent-1's pickup-kelurahan feature** (`sender-address-card.tsx` + `shipping.ts`) — still uncommitted, NOT merged/deployed. Their work to finish.

## 2026-07-15 — Session: storefront honesty sweep + per-tenant SEO + custom-domain groundwork ✅ committed `f71452d` `778d2cd` `c91b276` `53950b3` (worktree `super-admin-overhaul`, **pushed, NOT merged to main**)
> Four parallel read-only audits (a11y · runtime · SEO · dead-UI) against the live storefront. The money path came back scrupulously honest; every lie was in the soft surfaces nobody re-audited after the DB landed.

- **The shop advertised reviews it did not have.** PDP showed "4.8 · 187 ulasan" on a catalog of 8 reviews — `products.rating_value` is seed-only, recomputed by nothing, and the seed linked reviews by NAME so every `product_id` was NULL (no product COULD show a rating). Now aggregated from `reviews` where terbit; no reviews → no stars, no `aggregateRating`. Seed links the FK (0049). 8/8 linked, PDP shows the real count.
- **Every store shipped a dead WhatsApp number.** `stores` had no whatsapp/tagline column → platform constant `6281234567890` rendered as a live "Hubungi via WhatsApp" button ~19×/page on every store; `/kontak` hardcoded one merchant's email onto every store's contact page. Migration `0049` adds nullable `stores.whatsapp`+`tagline`; null → render nothing. Proven: kopi-senja emits ZERO wa.me links.
- **5 dead controls removed** (not "implemented" — implementing would still promise what the system can't deliver): fake /akun login (swallowed passwords), /kontak form (reset() destroyed the message then said "received"), footer newsletter, checkout's bold WhatsApp-confirmation promise, ProductCard wishlist heart.
- **Silent dead checkout fixed**: `op:"search"` and `op:"kelurahan"` had no `.catch()` → any ongkir-proxy hiccup = shopper types a kecamatan, nothing happens, Bayar does nothing.
- **A11y**: all 182 contrast violations were ONE token (`--color-muted` 3.59:1 → #736669 5.09:1); cart thumbnail link had no accessible name; chat inputs placeholder-only; two `<nav>` unnamed.
- **SEO, per-tenant**: canonical + OG + Twitter + schema.org Product/Breadcrumb, all from `locals.origin` (new, from x-forwarded-proto/host — behind Cloudflare `Astro.url` emits http:// canonicals that 301). Per-request `robots.txt` + `sitemap.xml` (a static file would serve one store's URLs on every domain). ⚠️ Deleted `site: "https://batiknusantara.id"` from astro.config — one merchant's domain hardcoded into a deploy serving every merchant.
- **Store Builder defaults that lied** (packages/sections): marquee "Gratis Ongkir/COD Tersedia" (neither exists/on), banner "Diskon 30%", **two fabricated testimonials** → all now prompts or empty; empty-state guards on both renderers.
- **Store Builder / hero / mega menu / cart / responsive** from earlier in the session: hero full-bleed, `/tema` template variants consumed, mega menu dynamic from the merchant's own menu, Shopify-shaped cart, kelurahan→kodepos (78k rows, migration `0046`... note: number was `0046` for kelurahan), `audit:responsive` gate (110 checks).

### ▶ NEXT — custom domain (spec done, pickup-ready) then its admin UI
1. ✅ **Custom domain slice 1 DONE** (`65e896d`) — migration `0050` `store_domains` + RLS + `slugFromCustomDomain()` + `StoreInfo.primaryHost` + `primaryOrigin()`. Proven with `curl -H 'Host: toko-demo.test'`: active domain resolves and canonical/og:url/sitemap all move to it; pending→404; unknown host→404; subdomain unchanged; verify-rls green. Seeded a demo `store_domains` row + dev-only `astro.config` allowedHosts.
2. ✅ **Custom-domain admin UI DONE** (`8bc754d`) — Pengaturan → Domain: add + copyable CNAME/TXT + REAL TXT verification (node:dns), 7 states in Bahasa, `settings:write` + `withTenant` (RLS is the boundary), host UNIQUE rejected by Postgres, token never sent to client. Honest cert boundary: a verified domain rests at `provisioning` ("Menunggu aktivasi") — the UI never flips it to active, because a cert (Cloudflare-for-SaaS) is not built. Verified in a real browser logged in, 0 console errors. New files only — the alamat block (agent-1 territory) untouched.
3. **What remains, all BLOCKED on the user:** Cloudflare-for-SaaS setup (cost + a CNAME-target domain to buy) to issue certs and move `provisioning`→`active`; the 301 primary-host redirect (GET/HEAD only, never /api/*); and the 30-min SNI experiment (§CUSTOM_DOMAIN riskiest-thing) before trusting the origin cert path. TXT verification is DONE, not blocked.
- **Payment gateway**: functional (6 channels), but real AutoLaris HMAC callback signature is BLOCKED ON THE VENDOR; env defaults to sandbox.
- **⚠️ Agent-1 left 81 lines uncommitted** (`sender-address-card.tsx`, `lib/actions/shipping.ts`) — not mine to commit; typecheck clean.

## 2026-07-14 — Session: storefront UI/UX — the pages with no route, the menu that ignored the merchant, and a layout that broke on a phone ✅ committed `2b1b562` `3da6a8d` `b179e73` `726ef82` (worktree `super-admin-overhaul`, **NOT merged to main → not deployed**)
> Territory: storefront UI/UX + responsive (see `AGENTS.md` — another agent held admin/db/API at the same time).

- **Published content that no shopper could reach.** The DB held **6 articles + 6 pages, all `terbit`**, written in the admin's editors — **none reachable**. `/blog` was a *fake*: 4 articles hardcoded in the `.astro` file, illustrated with product photos, every card `href="#"`, never touching the DB. `/blog/[handle]` and `/halaman/[handle]` did not exist. Built: `src/data/content.ts` (per-tenant, short-TTL cached) + Medium-shaped article page (3:2 feature image, Facebook/X/Pinterest + copy-link share) + CMS pages linked from the footer. **Publication is a boundary, not a filter** — every query hard-filters `status='terbit'`, so a draft **404s** instead of leaking to a guessed handle (proven: draft article + draft page both 404; Batik Nusantara's article via `Host: kopi-senja` → 404). Deliberately NOT copied from Medium: clap/comment counters — `articles.comments` is seeded but **there is no comment system**, and a count nobody can open promises a feature that doesn't exist.
- **The nav ignored the merchant.** The header menu was a hardcoded copy of `@tokophi/data/menu`; the file itself admitted it ("Live 'edit in admin UI → storefront' still needs the backend"). That backend has existed for months — Navigasi writes `menus`/`menu_items` — and the storefront **never read it**, so a merchant reordering their menu saw nothing change. `getMainNav(storeId)` now reads the tenant's own tree (static menu kept as the fallback for freshly provisioned stores; proven by editing a label in psql and watching the storefront follow). Footer follows the merchant's `footer` menu too — **but drops items whose page is unpublished**: the seeded menu links to *FAQ*, a draft, and honouring it verbatim would have put a 404 on every page of the shop.
- **Mega menu.** Panel was centred on its own trigger → a 62rem panel anchored to a word on the far right hung off the left edge. Now anchored to the header container. Two behaviour bugs fixed with it: click-to-close did nothing (CSS `:hover` outranked the class JS removed), and the trigger→panel gap sat *outside* the hover target so moving into the panel closed it. Contents are live per-tenant catalog data (thumbnail + product count; "Segera hadir" for an empty category).
- **`/kategori/produk-terlaris` 404'd** — a real bug, not a typo: `catalog.collections` is built from a 6-handle allowlist, so a collection that **exists in the DB** could not be found. The hero's own default CTA pointed at it.
- **Checkout.** Kecamatan now drives the address — pick it and **Kota + Provinsi fill themselves** (readonly, so they cannot drift from the district id the parcel is actually booked against; `lib/data/areas.ts` already treats a typed province as *a claim, not a fact*). **Kelurahan → kodepos** added (migration `0046`, 78,764 rows — a kodepos is per-kelurahan, and 17% of kecamatan span several: Semarang Tengah alone has **11**). Required fields marked; **email + kodepos made optional** — the order route already accepted both empty, so the form was *stricter than the system behind it*. And `required` on a **readonly** input is inert (the spec bars readonly fields from constraint validation), so the form could be submitted with **no destination at all** — now enforced in the submit handler.
- **Payment + shipping UX.** Six channels rendered as one flat column of identical radios; now grouped by **family** (QRIS / Transfer Bank / E-Wallet / Retail), single-channel groups collapse to one row, and VA rows show only the bank. **Rates now sort cheapest-first and cheapest is the default** — the old code rendered API order and auto-checked `i === 0`, so on Semarang Tengah the default ongkir was **JNE Express YES Rp26.000** sitting above an **AnterAja Rp9.000**. Nobody chose that; it just came back first.
- **Cart** rebuilt Shopify-shaped: sticky summary (the checkout button never scrolls out of reach), clickable product titles, decrement-to-zero removes the line. No "spend Rp X more for free shipping" bar — **there is no free-shipping threshold in our data**.
- **Emoji → Lucide** across the storefront (0 emoji in rendered HTML, 7 pages checked). Testimoni had been building its rating out of **text `★`**; it now reuses the SVG `<Stars>`.
- **📱 Mobile: auto-zoom on every input.** iOS Safari zooms whenever a focused control's font-size is **under 16px**, and never zooms back — our fields were 14px, so **every checkout field and the chat composer** dumped the shopper into a zoomed, sideways-scrolling page mid-purchase. Fixed via **font size**, not the viewport (`user-scalable=no` disables pinch-zoom for everyone and iOS has ignored it since iOS 10). A specificity trap only measurement caught: the first rule fixed every `<input>` but left the address **textarea** and kelurahan **select** at 14px, because a bare element selector loses to `.input-field`.
- **📱 Chat panel measured 587px tall at `y = -11` on an iPhone** — its header, and with it the **close button**, sat off the top of the screen: a shopper could open the chat and not get out. The message list now gives instead of the panel growing. `dvh`, not `vh` (the URL bar shows/hides; `vh` is frozen to the largest height).
- **📐 Responsive LOCKED — `npm run audit:responsive -w @tokophi/storefront`.** Sweeps **10 routes × 11 real device widths (320→1920) = 110 combinations** and exits non-zero on any horizontal overflow — the one symptom that reliably means the layout broke, invisible in a screenshot at a single width. It caught three genuine breaks the eye missed: `flex-1` inside a `flex-col` sizes the **height** (width then fell out of `aspect-[3/4]` and overflowed); below `md` the PDP grid had **no explicit template**, so its column was an implicit `auto` track — **sized from content**, free to exceed the container (the 368px thumbnail strip pushed a 360px phone sideways); and the price row was a no-wrap flex. **110/110 green.**

⚠️ **Two agents shared this worktree during the session and work was lost twice** (`git stash -u`, then `git reset --hard origin`) — recovered once from a dangling stash commit found via `git fsck`. That is what `AGENTS.md` was written for. Follow it: no `pkill`, explicit `git add <path>`, commit with a pathspec.

## 2026-07-14 — Session: COD switched on end-to-end + the checkout was ignoring the seller's shipping picks ✅ committed `35b88a4` (worktree `super-admin-overhaul`, **NOT merged to main → not deployed**)
> COD was built (five-condition gate, `lib/cod.ts`, migration `0038`) and **never turned on**. Turning it on surfaced a broken promise in the rates endpoint.

- **The COD chain — three switches, all of which must agree.** `platform_cod.enabled = true`, cap **Rp2.000.000**, **6** allow-listed provinces (DI Yogyakarta, Jawa Tengah, Jawa Barat, DKI Jakarta, Banten, Jawa Timur) · `platform_couriers.services[].codAllowed` = **SPX only** (SPX Standard `type=1`, SPX Economy `type=3`; every other courier is `codAllowed=false` **even where KiriminAja reports `cod=true`**) · `store_settings.cod_enabled = true` for batik-nusantara (default **false**, 0038 — the merchant opts in). `apps/admin/lib/cod.ts` stays the single source of truth for "may this order be paid on delivery?", and **`/api/public/order` REJECTS a COD order that fails any condition — the UI is UX, that endpoint is the boundary.**
- **Seller UI existed all along, it was simply never switched on.** Pengaturan → **Pengiriman** → card **"Bayar di Tempat (COD)"** (*"Aktifkan COD — Tersedia lewat Shopee Express (SPX)."*), and below it **Jasa Kirim** labels every service: green **COD** badge + "Mendukung COD — aktifkan COD di atas." on the two SPX rows, "Tidak mendukung COD." on the rest. `components/admin/pengaturan/jasa-kirim-card.tsx` · `getCodEnabled`/`setCodEnabled`/`getStoreServices`/`saveStoreServices` in `lib/actions/shipping.ts`.
- **🐛 The bug that turning COD on exposed — a broken promise.** The Jasa Kirim card tells the seller *"Pilih layanan yang ditawarkan ke pembeli saat checkout"* and writes each pick to **`store_shipping_methods`**. `/api/public/ongkir` filtered on a **different column** — `store_settings.couriers`, the COURIER-level list — so **every service the seller switched OFF was still offered at checkout**. The per-service table exists precisely because a courier-level list cannot say "I ship JNE Reguler but not JNE YES"; the admin moved to it and the storefront never followed. Measured on the live endpoint (11 services picked): **14 rates, 4 of them never enabled — Jagopack, Sicepat CARGO, BIGPACK, SAP One Day. After the fix: 10**, exactly the picked set KiriminAja prices for that route. Filter is now **(platform-enabled couriers) ∩ (merchant's per-service picks)**, keyed `"<courier>:<service_type>"` (a service_type is only unique within its courier); **no rows = the merchant never opened the card → fall back to courier-level** rather than render a checkout with zero shipping options.
- **✅ VERIFIED IN A REAL BROWSER, 0 console errors:** pick a destination → **10** shipping options → only **SPX Standard (Rp17.000)** and **SPX Economy (Rp12.700)** carry the COD badge → select AnterAja and the COD payment option is **absent** → select SPX and **"COD (Bayar di Tempat)"** appears in Pembayaran. The `cod` flag on a rate is the **EFFECTIVE** one (KiriminAja capability × platform per-service allowance × this store's `cod_enabled`), never the raw courier capability.
- **🎓 Lesson: `astro check` passes clean on bugs inside a client `<script>`.** A `ReferenceError: queueSave is not defined` in `checkout.astro` blocked the **entire rate load** — no rates → no COD → **no order at all** — and typecheck, lint and build were **all green**. Only running the page in a browser caught it (fixed separately). Same family as the `requestPayout()` `FOR UPDATE` bug: **money and checkout paths must be EXERCISED, not typechecked.**
- **⏳ Still open (unchanged by this session):** the **SPX free-return claim is UNVERIFIED** and the whole SPX-only policy rests on it (*Shopee Seller Center* benefit vs. our *KiriminAja* contract, whose API has **no return field at all** — this is one email) · **`orders.courier` is NULL on ~699/700 rows**, so the **per-courier COD return rate — the metric the policy is optimising for — cannot be computed**: a bet with no scoreboard · **`platform_cod.fee_pct` is `0` and read by nothing**, and it is the lever that would open COD beyond SPX.

## 2026-07-14 — Session: abandoned-cart capture + guest vs registered customers ✅ committed `d7fc92f` + `9206220` (worktree `super-admin-overhaul`, **NOT merged to main → not deployed**)
> Indonesia leaves ~82–83% of carts against a ~70% global figure, and we were recording **zero** of them: **no cart table existed**. The single largest pool of nearly-made sales was invisible. DB now **68 tables, 46 migrations (`0000`–`0045`), RLS on 44**.

- **`0044` — `checkout_sessions`** (RLS on) + `customers.registered_at` / `password_hash` / `last_order_at`. The storefront writes the row **AS THE SHOPPER TYPES** (debounced beacons → `apps/storefront/src/pages/api/checkout-session.ts`), because **there is no "abandon" event to listen for: abandonment is the ABSENCE of an order.** A session that stops updating and never becomes one *is* the abandonment. An **opportunistic sweep** (piggybacks on storefront traffic, ≤1×/min/process) flips `aktif` → `ditinggal` after **60 min** of silence and stamps `abandoned_at`.
- **`0045` — `abandoned_at`, added BEFORE the metric was built on it.** A straight-through checkout **also** ends `pulih`, so without it a cart that sailed through and a cart genuinely **rescued** are indistinguishable afterwards: the naive `pulih/(pulih+ditinggal)` renders **19,3%** and tells a shop it rescued every ordinary sale. `rescued = abandoned_at IS NOT NULL AND recovered_at IS NOT NULL`. **A number that looks real and is wrong is worse than no number.**
- **The two rates on screen** (30-day window, `aktif` excluded from **both** sides — nobody has abandoned anything yet, the shopper is still typing): **abandon 80,0%** = `ditinggal/(ditinggal+orders)` · **recovery 11,2%** = `rescued/(rescued+ditinggal)`. Verified counts (batik-nusantara, anchored 2026-07-02): **ditinggal 792 · orders 198 · rescued 100**.
- **`/pelanggan/keranjang`** — 792 abandoned carts that until this week were **not recorded at all**. Ranked by what a merchant can act on: **has-phone first**, then basket value **decayed by age** (`subtotal / (1 + minutesAgo/1440)`) — a big cart from three weeks ago is not a better call than a fresh one. Tabs (Semua / Ada nomor WA / Belum dihubungi / Anonim) count with **true SQL totals**, not the loaded slice.
- **WhatsApp recovery** — one click opens `wa.me` with the `wa_templates` body filled server-side, and the screen says **"WA dibuka", NOT "terkirim"**: wa.me cannot tell us whether the message was sent or read, so **we do not display what we cannot observe**. Recovery links are **signed, store-bound, 7-day jose HS256 tokens** (`apps/storefront/src/lib/recovery.ts`) — never the raw session id, which in a URL is a bearer credential for a stranger's name, phone and address the moment it is forwarded, screenshotted, or leaks via `Referer`.
- **Guest is the NORMAL case.** Buying never requires an account — a registration wall in front of an Indonesian checkout is the most reliable way to lose the sale — so `customers.registered_at IS NULL` = **Tamu**, styled as neutral, with **Terdaftar** as the extra. **7 terdaftar / 17 tamu.**
- **🎭 Two fabrications removed.** (1) The CRM was **already** showing "keranjang ditinggal" follow-ups — chase *Dress Midi Motif Bunga*, chase *Gamis Syari Polos* — for carts that **existed nowhere in the database**. It was sending merchants after ghosts. The seed now derives its 3 cart follow-ups from **real `checkout_sessions` rows**; orphan cart follow-ups: **0**. (2) The Pelanggan stat card claimed **"Total Pelanggan 3.128 · +8,2% bulan ini"** — the store has **24** customers and **nothing anywhere computed a month-over-month change**.
- **✅ VERIFIED END-TO-END IN A REAL BROWSER, not just typechecked:** real Chrome UA → add to cart → type name/WA/email/address into checkout → **close the tab without submitting** → the row lands with the **true basket** (Dress Midi Motif Bunga, Rp189.000) → aged → the sweep flips it to `ditinggal` and stamps `abandoned_at` = **the moment it went quiet** → it appears on `/pelanggan/keranjang` with its WA number. **0 console errors.** Both on-screen rates re-derived from SQL and reconciled exactly. (The bot gate correctly rejected a headless UA first — `x-capture=bot` — which is why the endpoint returns a reason header.)
- **⏳ Go-live gaps (BACKLOG §P1.8, all OPEN):** **not merged to main → Coolify has shipped none of it, production still records nothing** · the sweep is opportunistic, so **a store with no visitors never ages its own carts** (VPS: cron, or derive `ditinggal` in the read layer) · the capture rate limiter is **in-process memory** (same gap as `/api/track`; multi-instance needs a Cloudflare rule) · **`CHECKOUT_RECOVERY_SECRET` must be set in prod** — it falls back to `AUTH_SECRET`, so rotating the auth secret **silently invalidates every outstanding recovery link**.

## 2026-07-13 — Session: P1.6 in parallel (signup+OAuth · Host-multi-tenant · Tema variants · chat spec) 🚧 uncommitted
> 4 disjoint tracks run in parallel in worktree `super-admin-overhaul`. All 3 builds pass (`build:admin`, `build:super`, storefront `astro build` with `DATABASE_URL` UNSET = still DB-free). **Not yet committed/deployed** — domain cutover decided mid-session, so code lands together with it.

- **Self-serve register (P1.6 #1) — DONE, verified E2E.** Public `/daftar` (middleware-allowed) → `lib/actions/register.ts` → **`apps/admin/lib/provision.ts` `provisionStore()`**: ONE txn = accounts → users (scrypt) → stores (`status:"trial"`, `trial_ends_at = now + BILLING.TRIAL_DAYS`) → store_users(owner) → locations → store_settings → store_stats → `platform_activity(kind:"signup")`; slug dedupe (`-2`, `-3`, …), email uniqueness → `signSession` cookie → redirect. Runs on the **owner** connection (no tenant exists yet — same deliberate exception as `lib/auth.ts`). Logic replicated from super-admin `createStore` (not imported; super-admin keeps its ANCHOR date, signup uses real `now()`). **Verified:** POST → 303 + session cookie, real rows in DB (`trial_ends_at` = +3d), dup-email rejected with no extra store, existing login intact.
- **Google OAuth (P1.6 #2) — code done, UNPROVEN.** Migration **`0034`** (`users.auth_provider` default `'password'`, `users.google_sub` unique). `lib/google.ts` + `/api/auth/google/{start,callback}` (jose + Google JWKS, no new deps). **Decision:** Google on `/daftar` auto-provisions a store (same txn); Google on `/login` with an unknown email is REJECTED (`?error=google_belum_daftar`) — no silent store creation. Existing password user + verified same email → `google_sub` linked, `password_hash` KEPT (scrypt path intact). **Feature-flagged:** env unset → button not rendered, routes 307 → `/login`, no crash. ⚠️ **Never run against real Google credentials** (no client ID yet) — the code-exchange + JWKS path is unexercised. Env: `GOOGLE_CLIENT_ID`/`SECRET`/`REDIRECT_URI` (`.env.example` only).
- **`Host`-header multi-tenant storefront (P1.5 remainder / ADR 0009) — DONE, verified.** The module-level `STORE`/`STORE_ID` singletons are GONE: `src/data/store.ts` `getStoreByHost()` + `src/middleware.ts` put `{store, catalog}` on `Astro.locals`; `catalog.ts` is now `getCatalog(store)` memoized per store id (`src/data/cache.ts`, TTL `STOREFRONT_CACHE_TTL_MS`, default 15s). **Resolution order:** custom domain (SEAM, no column yet) → `<slug>.$STOREFRONT_BASE_DOMAIN` → first host label (sslip box) → fallback `STORE_SLUG`. Fallback fires **only when the host names no store at all** — a host naming an unknown slug 404s rather than serving another merchant's storefront. RESERVED labels (`www/app/rich/admin/api/cname/toko/…`) never resolve as a slug (hardened this session: the base-domain rule checks RESERVED too, which matters now that the base is the APEX). **Verified:** one process, `batik-nusantara.…` → "Batik Nusantara", `kopi-senja.…` → "Kopi Senja", unknown host → clean 404 "Toko tidak ditemukan" (not 500), unknown product → 404, `astro build` DB-free.
- **Checkout branding (P1.5) — DONE.** `checkout.astro` renders the resolved store's `logo_url` (absolute-ized via `mediaUrl()`), falling back to the store-name wordmark when null; brand colour already flowed via Layout CSS vars.
- **Tema: template variants (P1.5) — DONE, verified.** **No migration needed** — `0031` already shipped `collections.template_id` + `products.template_id` (nullable FK → `page_templates.id`), both RLS'd by `0012`. `/tema` is now a **template manager** (3 tabs Beranda/Kategori/Produk: create/rename/set-default/delete + per-kategori & per-produk assignment picker + bulk apply); the Puck builder moved to `/tema/[id]` and saves per template id (`saveHomepage` → `saveTemplate`). All actions `requireCapability("theme:write")` + `withTenant`. At most one `is_default` per `(store_id, type)`, enforced app-side; deleting a template NULLs referencing `template_id` (FK never dangles). **Storefront contract:** homepage → default `type='homepage'`; category → `collections.template_id` ?? default `type='category'` ?? hand-built fallback; product → same shape. ⚠️ **The storefront does not consume category/product templates yet** — only homepage. That's the next slice.
- **Chat spec (P1.6 #4) — `specs/docs/CHAT_SPEC.md` written, nothing built.** Decisions: `support_*` (merchant⇄platform "Tiket") and the NEW shopper⇄merchant "Obrolan" stay **separate tables**, sharing only an extracted `<Thread>` UI; transport v1 = **short polling with a cursor** (3s active / 15s idle) because we have no pub/sub (SSE would still poll Postgres per connection) and Traefik+Cloudflare mangle long-lived connections; anonymous shopper = signed jose JWT in a first-party httpOnly `tokophi_chat` cookie, minted on first MESSAGE not first page load; chat API lives in the storefront's own Astro routes (first-party cookie survives merchant custom domains). Migration `0035`. 7 slices, slice 1 unblocked.
- **🔴 SECURITY GAP FOUND (pre-existing, not from this session):** `support_tickets`/`support_messages` landed in migration `0030` — **after** the RLS migration `0012` — and have **no RLS at all**; `apps/admin/lib/actions/support.ts` uses the bare **owner** `db` with a manual `storeId` filter and **no `requireCapability`**. It is the only merchant-facing data path outside `withCurrentTenant`/`withTenant` — tenant isolation for tickets rests on app code, not the DB. CHAT_SPEC slice 1 retrofits RLS (32 → 37 store-scoped tables); **treat as P0-ish, fix even if chat slips.**

## 2026-07-13 — Session (cont.): storefront consumes templates + 🔴 `support_*` RLS retrofit ✅ committed `b677a30` + follow-up
- **Storefront now renders category/product templates.** `getStoreTemplates(storeId)` = ONE query per store (memoized in the existing per-store catalog cache → zero extra round-trips per request, build stays DB-free). Resolution per the contract: `collections.template_id` → `type='category'` default → hand-built page (same for product). Empty templates (`sections.content = []`) are ignored so an assigned-but-empty template degrades to the fallback instead of rendering a blank page. Sections get a `SectionContext` (`homepage | category | product`), so a Grid Produk with no explicit `collectionHandle` scopes itself to the category being viewed (or the product's category, minus itself).
- **⚠️ Deliberate deviation — a product template replaces only the TAIL of the PDP** (the "Rekomendasi" strip), never the buy box (galeri/harga/varian/Tambah ke Keranjang) or Ulasan. Reason: none of the 8 registry sections can render price/variants/add-to-cart, so a full replace would ship **product pages with no way to buy**. Proper fix = a `product-detail` section in `@tokophi/sections` + admin Puck + an Astro renderer; then the template can own the whole page. **Follow-up.**
- **Merchant footgun found + guarded:** a `category` template with no **Grid Produk** section lists NOTHING (the template replaces the hand-built page wholesale). `/tema` now shows an amber warning on such a template. (Found because the Tema agent's leftover test template — a lone hero, `is_default`— silently emptied every category page of the demo store. Test rows purged from the local DB.)
- **🔴 `support_*` RLS retrofit — DONE (migration `0035`), the gap found while writing CHAT_SPEC is CLOSED.** `support_messages` gained `store_id` (backfilled from the parent ticket → NOT NULL + FK); RLS + the `0012` `tenant_isolation` policy enabled on `support_tickets` + `support_messages`. Admin reads moved to a new `lib/data/support.ts` under `withCurrentTenant`; `lib/actions/support.ts` rewritten to `requireCapability("support:write")` + `withTenant` (the bare owner `db` + manual `storeId` filter are gone — **the DB is the boundary now, not app code**). New cap `support:write` granted to ALL four roles (anyone in a store must be able to ask for help; the tenant boundary is RLS, not the role) + `requireCapability(cap, {allowSuspended})` so a **suspended** store can still open a ticket — otherwise it could not contact us about the billing problem that suspended it.
  - **Proof (psql, `SET ROLE tokophi_app` + `app.store_id` = store A):** store B's ticket returns **0 rows even by primary key**, store B's messages 0 rows, and `INSERT` with store B's `store_id` → `ERROR: new row violates row-level security policy`. Super-admin (owner connection) still reads across stores — verified in the real `/tiket` UI, incl. a reply to store B's ticket.
  - `verify-rls` no longer hand-maintains a table list: it derives the store-scoped set **from the catalog** (every table with a `store_id`) and FAILS if any lacks RLS. Now **36/39** green.
- **🔴 NEW GAP SURFACED by that script: `media`, `payments`, `platform_activity` have a `store_id` but NO RLS.** `media` is merchant data (product images) → real. Whitelisted as `KNOWN_EXCEPTIONS` rather than silently enabling RLS on unaudited write paths. **Tracked in BACKLOG — next security slice.**
- Also pre-existing, unfixed: `/bantuan`'s `bantuan-client.tsx` calls `Date.now()` during render → hydration mismatch (violates the determinism rule in CLAUDE.md/AGENTS.md).
- All 3 builds green (storefront `astro build` still DB-free). **Chat migration slot moved `0035` → `0036`** (CHAT_SPEC updated).

## 2026-07-13 — Session (cont.): 🚀 **DOMAIN CUTOVER DONE — `tokophi.com` IS LIVE** (+ Astro landing) ✅
> The whole point: with `Host`-multi-tenant landed, multi-tenancy could not be *proven* on `.sslip.io`. It is proven in production now.

**Live hosts (all HTTPS, all Cloudflare-proxied):**
| Host | Serves | Verified |
|---|---|---|
| `tokophi.com` + `www.` | **landing** (new Astro app, "Segera hadir") | 200 |
| `app.tokophi.com` | client admin | 200 (`/login`, `/daftar`) |
| `rich.tokophi.com` | super-admin | 200 |
| `toko.tokophi.com` | demo store (fallback `STORE_SLUG`) | 200 |
| **`<slug>.tokophi.com`** | **that merchant's storefront** | `batik-nusantara.` → "Batik Nusantara", `kopi-senja.` → "Kopi Senja", unknown slug → **404** |

- **🏆 END-TO-END PROOF:** signed up a brand-new store through the real `/daftar` form on production → immediately redirected into the admin, and **`uji-cutover.tokophi.com` served its storefront over HTTPS with ZERO deploys, ZERO DNS work, ZERO manual config**. Self-serve loop closed: *daftar → toko hidup*. (Test tenant purged afterwards; 7 stores before = 7 after; its host 404s again.)
- **TLS — the crux.** Let's Encrypt **cannot** issue a wildcard over HTTP-01, so `<slug>.tokophi.com` can never have an origin LE cert. Solution: a **Cloudflare Origin CA certificate** (`*.tokophi.com` + apex, valid to **2041**) installed as Traefik's **default certificate** (`/data/coolify/proxy/dynamic/tokophi-origin-tls.yaml`, cert in `proxy/certs/`). It is trusted **only by Cloudflare** → **every record MUST stay PROXIED (orange)**; a grey-cloud record would hand browsers a cert they reject. Upside vs. the old runbook plan (grey → LE → orange): the origin IP is **never** exposed, not even briefly.
- **⚠️ Traefik priority is load-bearing.** The wildcard router `HostRegexp(^[a-z0-9-]+\.tokophi\.com$)` also matches `app.`/`rich.`/`toko.`/`www.`, and **Traefik's default priority is the rule's LENGTH** — the regexp is longer than `Host(\`app.tokophi.com\`)`, so it would have **outranked the admin router and served the storefront on app.tokophi.com**. Fixed with `priority=1` (lowest): explicit Host routers always win, the catch-all only sees what nothing else claimed. `RESERVED` in `store.ts` is the second line of defence.
- **Hostname scheme `<slug>.tokophi.com`** (one label deep) — Cloudflare **Universal SSL covers only one wildcard level**, so this is free + proxied. `<slug>.toko.tokophi.com` would have needed paid ACM (~$10/mo) or a grey-cloud DNS-01 wildcard. **Proxied wildcard DNS turned out to be allowed on the FREE plan** (contrary to the old Enterprise-only assumption — verified by creating it).
- **Landing app (`apps/landing`)** — static Astro, port 4328, **no DB and no `depends_on: postgres`** (the front door must be servable even when everything behind it is down). "Segera hadir" + working **Masuk** / **Daftar toko** CTAs.
  - **🐛 Shipped broken once, caught by the link audit:** the CTAs rendered `href=""` in production. Cause: a bare `ARG PUBLIC_LOGIN_URL` with no `--build-arg` sets the env var to the **empty string**, not `undefined`, so the page's `?? default` fallback never fired. Local dev never hit it (the var was simply absent). Fixed in both layers (ARG defaults + `||` instead of `??`) and reproduced the exact failure before redeploying.
- **Coolify wiring (all via SSH/API, no UI):** per-service domains keep the old `.sslip.io` hosts **alongside** the new ones as a fallback; env `PUBLIC_APP_URL`/`ADMIN_URL`/`PUBLIC_ONGKIR_API`/`PUBLIC_ORDER_API` → `https://app.tokophi.com`, plus `STOREFRONT_BASE_DOMAIN=tokophi.com` + `STORE_SLUG=batik-nusantara`. Coolify stores env **Laravel-encrypted AND PHP-serialized** (`s:34:"…";`) — `scratchpad/cf_env.py` replicates the exact envelope (AES-256-CBC + HMAC over base64(iv)+base64(value)) and verifies by decrypting back.
- **Prod DB after deploy:** 36 migrations applied, `users.auth_provider`+`google_sub` present, RLS **on** for `support_tickets`+`support_messages`, **7 stores intact** — the seed's "only seed an EMPTY database" guard held, so no merchant data was wiped.
- **⏳ Left for you:** the zone's **SSL mode must be `Full (strict)`** — our API token has *SSL and Certificates: Edit* (enough to issue the Origin CA cert) but **not** *Zone Settings: Edit*, so the setting could not be read or changed programmatically. Set it in the dashboard. Also: a Coolify API token named **`claude-domain-cutover`** was created (revoke it in Coolify → Keys & Tokens whenever you like).

## 2026-07-13 — Session (cont.): SEO hygiene (noindex panels) · `www` → apex 301 · landing perfected ✅ LIVE
- **🔴 Both admin panels were CRAWLABLE.** The cutover put them on real public domains: `app.tokophi.com/login` and `rich.tokophi.com/login` were live, **200, with no robots header at all**, and `/robots.txt` **307'd to `/login`** (the auth middleware swallowed it). Fixed with **three layers per app** — none is sufficient alone:
  - `next.config.ts headers()` → `X-Robots-Tag: noindex, nofollow` on `/:path*`. Header rules match **before the filesystem**, so this is what covers `/api/*`, static assets, and non-HTML responses.
  - `middleware.ts` stamps the same header on **every return path** — a middleware **redirect short-circuits before `headers()` runs**, so an unauthenticated `/` → 307 would otherwise carry nothing. Also added `robots.txt` to the matcher's negative lookahead.
  - `app/layout.tsx` `metadata.robots` + `app/robots.ts`. The root layouts are the only files exporting `metadata`, so no route can override it.
- **⚠️ CARVE-OUT — `/api/uploads/*` stays indexable (`X-Robots-Tag: all` + `Allow:` in robots.txt).** Merchant product photos are served from the **admin** origin but embedded in the **public** storefront (`storefront/src/data/catalog.ts` rewrites `/api/uploads/*` to the admin host). A blanket noindex would have pulled **every merchant's product photography out of Google Images**. Header and robots.txt must agree here: the header alone is useless if `Disallow: /` stops the crawler fetching the file.
- **Storefront + landing deliberately untouched** — they must stay indexable. Verified live: no `noindex` header on `tokophi.com`, `toko.tokophi.com`, or `<slug>.tokophi.com`.
- **ℹ️ Cloudflare injects its own robots.txt block** ("Cloudflare Managed content" / Content Signals) **above ours**, with `User-agent: * … Allow: /`. Same user-agent + same path length as our `Disallow: /` → Google takes the least restrictive, so **our `Disallow` is effectively inert**. That is **fine, and arguably better**: `Disallow` would *prevent* Google from crawling and therefore from ever *seeing* the `noindex` (indexed URLs then linger as bare entries). Crawl-allowed + `noindex` header = the crawler fetches, reads the header, drops the URL — which is Google's own recommendation. **The protection rests on `X-Robots-Tag`, not robots.txt.** Turn the CF block off in the dashboard if a clean robots.txt is wanted.
- **`www.tokophi.com` → 301 → `tokophi.com`** (path + query preserved), via a Traefik `redirectregex` router (`priority=100`) on the landing service; `www` dropped from Coolify's landing domains. **Not** done at the Cloudflare edge — our API token has DNS + SSL scopes but **no ruleset permission**, so an edge Redirect Rule (the cheaper place) was rejected. Add *Zone → Config Rules → Edit* to the token to move it to the edge.
  - **🐛 Shipped once as `https://tokophi.com/${1}`** — a literal, unsubstituted placeholder. **Coolify hands compose labels straight to the Docker API without docker-compose's `$$` → `$` unescaping**, so `$${1}` reached Traefik verbatim. Use a single `${1}` in `docker-compose.coolify.yml` labels.
- **Landing perfected (user: "1 halaman 1 layar, adaptif").** Fits **one viewport, no scroll**, at every size — `100dvh`, never `100vh` (mobile browser chrome pushes `100vh` past the fold; this is the single most common way this requirement ships broken). Where it cannot fit it **cuts content rather than scrolling**: below 720px tall (landscape phones) the fact row + helper line drop. **Verified in production** at 6 viewports × light/dark: `scrollHeight == innerHeight` and `scrollWidth == innerWidth` in every case, 0 console errors. Copy rewritten (H1 "Seluruh toko Anda, dalam satu panel."), every claim checked against `CONCEPT.md` + `billing.ts` — no invented pricing, testimonials, metrics, or logos. `robots.txt` + auto-generated `sitemap.xml` added for the apex.

## ⏭ NEXT — remaining P1.6
> User: "perlu kita setup domain sekarang biar presisi" — the `Host`-multi-tenant storefront cannot be proven in prod without a real domain. **Scheme decided: `<slug>.tokophi.com` (one label deep)** — covered by Cloudflare **Universal SSL** (`*.tokophi.com`) so it is FREE and can stay **proxied** (origin IP hidden). The alternative `<slug>.toko.tokophi.com` is two levels deep, which Universal SSL does NOT cover (needs paid ACM ~$10/mo, or an origin LE DNS-01 wildcard with grey-cloud DNS that exposes the origin IP). Set `STOREFRONT_BASE_DOMAIN=tokophi.com` — **no code change needed**. See `DEPLOY.md` → "Going live on tokophi.com".
- Remaining P1.6: **custom domain per merchant** (`stores.custom_domain`/`store_domains` + the `slugFromCustomDomain()` seam + Cloudflare-for-SaaS CNAME `cname.tokophi.com`) · **chat** (CHAT_SPEC slice 1+) · **landing page** for the apex (not built) · Google OAuth needs real credentials · storefront must consume category/product templates · `stores` lacks `tagline`/`whatsapp` columns (still platform constants → wrong for non-demo tenants).

## ⏭ (superseded — kept for history) NEXT SESSION (2026-07-11) — onboarding + client comms track (BACKLOG P1.6)
> User set the direction 2026-07-10 (wants to rest). Turn TokoΦ from a single seeded demo into a self-serve, multi-merchant platform with a real customer-comms surface. Full detail in `BACKLOG.md` §P1.6.
1. **Self-serve register (signup)** — public "Daftar" → one-txn account+store (reuse super-admin `provisionStore`) → trial billing → auto-login. Entry from `tokophi.com` landing.
2. **Google auth (OAuth login)** — "Masuk dengan Google" on `/login` + `/daftar`; `users` gets an auth-provider column (keep scrypt path); Google client id/secret in gitignored env. Decide auto-provision-vs-invite.
3. **Custom domain for client** — merchant attaches own domain → depends on **`Host`-multi-tenant SSR** (SSR base done today) + Coolify/Traefik per-store router + LE cert; store as `stores.custom_domain`/`store_domains`.
4. **Ticketing UI/UX → customer⇄seller CHAT + merchant chat dashboard** — evolve `support_tickets`/`support_messages` into real chat: storefront chat widget (shopper→seller), merchant chat inbox/dashboard in admin, polished ticketing UX. Vision: client/merchant gets its **own unified app = dashboard + chat**. **Big — spec first** (transport poll-vs-WS/SSE, schema, anon-shopper identity), then slice.
5. **Finish "Tema" / Store Builder** (P1.5, merged but open) — template variants (per category/product), checkout branding (`stores.logo_url`), verify builder saves reflect on the **deployed** SSR storefront.
- Also queued (lower): Cloudflare edge + `tokophi.com` domain cutover (DEPLOY.md runbook ready, deferred until final) · email/WA comms for tickets+reminders · uploads → MinIO/S3 · Hetzner prod.

## 2026-07-10 — Session: storefront → SSR (zero-downtime deploys) (worktree `super-admin-overhaul`) ✅
- **Why:** the storefront was SSG built at container start (~1–2 min), so every deploy served nothing ("not found") until the build finished — the origin-side cause of deploy downtime. Analyzed HAProxy/Redis/LB earlier and ruled them out (wrong layer / premature / single box); the correct origin-side fix is SSR + health-gating.
- **Change:** `output: 'server'` + `@astrojs/node` standalone. Catalog reads Postgres at **server boot** (module-level `src/data/catalog.ts`), not at `astro build`. Dynamic routes (`produk/[handle]`, `kategori/[handle]`) dropped `getStaticPaths` → resolve per-request from `Astro.params` (real + virtual `semua`/`promo-gajian`; 404 on miss). Dockerfile builds at image time (no DB) + runs `node dist/server/entry.mjs`; `HOST=0.0.0.0`/`PORT=4327`. Compose storefront `start_period` 120s → 30s.
- **Verified locally:** `astro build` with `DATABASE_URL` unset (proves image-build is DB-free); server boots ~1s against the real DB — `/`, `/produk/blazer-wanita`, `/kategori/atasan`, `/kategori/semua` = 200; unknown handles = 404; `/_astro/*.css` = 200.
- **Live-box fix:** first deploy went `unhealthy` → Traefik 404 on `toko.45.77.33.112.sslip.io`. Cause: `@astrojs/node` binds IPv4 `0.0.0.0` only, but the container's busybox `wget localhost` resolves `::1` (IPv6) first → healthcheck fails though the server serves fine on `127.0.0.1:4327`. Fixed the storefront healthcheck to `http://127.0.0.1:4327/`. (Next.js admin/super bind dual-stack, so `localhost` was fine there; the old `serve` did too.)
- Commit `f4a27b4` + docs `09aa94f` + healthcheck fix → `main`. **Still single-tenant** (store by slug at boot); ADR 0009 `Host`-header multi-tenant builds on this SSR base (TODO). Docs synced: DEPLOY (gotcha #3 + refreshed server block + **new "Going live on tokophi.com" runbook**), CODE_MAP, ARCHITECTURE, CHANGELOG.
- **✅ VERIFIED LIVE** on the box: after the healthcheck fix, `toko.45.77.33.112.sslip.io/` = 200, `/kategori/atasan` = 200, `/produk/blazer-wanita` = 200, `/produk/nope` = 404 (SSR 404). Container `healthy`, fast start confirmed.
- **Deferred (user steer "domain nanti aja kalo sudah final"):** Cloudflare edge + real `tokophi.com` domain — the edge-side half of zero-downtime. Full step-by-step now in DEPLOY.md → **"Going live on tokophi.com"** (domain plan: `tokophi.com`=landing, `rich.`=super-admin, `app.`=client admin, `toko.`=storefront).

## 2026-07-10 — Session: super-admin store-control overhaul + Akun + PPN + fees (worktree `super-admin-overhaul`) ✅
- **Deployed live** on the Vultr box each milestone (Coolify, `main`-tracked); worktree needs `npm install` + copied `.env*` to resolve `@tokophi/*` (nested-in-repo workspaces resolve up to the parent otherwise).
- **Super-admin Pengaturan**: payment unified → grouped collapsible channels (QRIS/VA/E-Wallet/Minimarket) + 2-column rail + courier service chips; `@tokophi/lib/integration-status` (rc="00"=active) + vitest. Non-active channels locked; Sync upserts.
- **Store-control overhaul** (migr 0026/0027): single-plan cleanup (killed tiers), `storeSegment()` 4 sessions + VIP (`stores.comped`), `store_stats.ship7d_avg`, per-store audit (`platform_activity.store_id`). Toko catalog = 4 segment tabs + 1-line summaries (kiriman/hari). Store detail = full control (comp/trial/VIP/reset-pw/manage-users/suspend) + real invoices + audit + volume recommendations.
- **Client Akun section** `/akun/*` (out of Pengaturan) + functional avatar menu + subscription badge under logo + payment history + printable `/faktur/[number]`.
- **PPN 11%** on subscription (DPP + PPN; `withPpn`/`baseFromTotal`) + **payment-gateway fees** (`@tokophi/lib/payment-fees`: VA 4k / e-wallet 2,4% / QRIS 1% / retail 4k) with seller|buyer|split bearer (migr 0028); client-admin grouped payment menu + Biaya Pembayaran card.
- **KNOWN**: seed trial dates anchored to `TODAY=2026-07-02` → on later deploy dates trials lapse → super-admin **Trial tab shows 0** (fix: seed lifecycle dates relative to `Date.now()`).

## 2026-07-10 — Session (worktree `store-builder`): Self-serve Store Builder (ADR 0009) ✅ local, rebased onto the super-admin-overhaul work above
- **Pivot decided + documented:** ADR 0009 (new) reverses ADR 0003/0008's "no theme editor" stance — merchants now get a section-based drag-and-drop homepage builder; storefront moves to SSR multi-tenant (amends ADR 0008, aligns with the SSR pivot `PROD_PLAN.md` §5 already called for). PRD/ARCHITECTURE/CONCEPT/DATA_MODEL/SCHEMA docs synced.
- **Schema:** `page_templates` (type homepage|category|product, `sections` jsonb, `is_default`) + `products.template_id`/`collections.template_id` + `stores.brand_color`/`logo_url` — migrations `0031`–`0032` (renumbered post-rebase; `0026`–`0028` belong to the concurrent store-control overhaul above), RLS `tenant_isolation` extended (`0032`).
- **Mechanism:** `@measured/puck` (MIT; note — the *unscoped* npm package `puck` is unrelated, a networking lib, easy to confuse) embedded at `apps/admin/app/(admin)/tema` behind new RBAC cap `theme:write` (owner/admin only). New shared package `@tokophi/sections` is the section-shape source of truth for both the Puck config (admin) and the Astro renderer (storefront) — no drift by construction.
- **8 sections v1:** Hero (+badge/+rating text), Grid Produk (**mode: terlaris/terbaru/acak**, max 2 per page via `resolvePermissions`), Banner Promo, Testimoni (now a scroll-snap carousel), Image + Teks, Marquee, Rich Text/Pernyataan, Navigasi Kategori — modeled after a Shopify Theme Store reference (Lumin "Thrive" demo).
- **Brand colour system:** `@tokophi/lib/colors` (`generateBrandShades`) derives a full 7-step scale from one merchant-picked hex (HSL lightness ramp, same method as the color-palette skill); storefront's `Layout.astro` injects it as a `:root` CSS-var override after `global.css`, so every existing `bg-brand-*`/`text-brand-*` utility re-themes with zero markup changes. Dialog in the builder header, gated same as `theme:write`.
- **UI/UX passes:** admin chrome (`AdminChrome`) hides sidebar/topbar on `/tema` for a full-bleed builder; Puck re-themed to indigo via its own CSS-var API (not hashed-class hacking); form fields swapped to admin's own Input/Textarea/Label via `overrides.fieldTypes` (Puck's default fields felt foreign next to the rest of the admin).
- **Bugs found + fixed during verification:** `renderHeaderActions` (deprecated) was *replacing* Puck's default header actions, silently hiding Publish — moved to `overrides.headerActions` (composes via `children`). Overriding `fieldTypes` also drops Puck's built-in field label — now rendered explicitly per override. `apps/storefront/src/data/catalog.ts`'s store lookup was a bare `.limit(1)` (fine at 1 store; picks an arbitrary row now that the shared local DB has 7 seeded demo stores) — scoped to `slug = "batik-nusantara"`.
- **Verified end-to-end repeatedly** (Playwright: real login, real drag-and-drop, real Publish, `astro build`, screenshots) — not just typecheck. `page_templates` test rows were wiped mid-session by a DB reseed (shared local Postgres, not a code bug) — mechanism re-verified after.
- **Deferred (not started):** category/product template variants (multiple named templates + per-collection/per-product assignment — schema supports it, admin UI doesn't exist yet); the SSR-multi-tenant storefront pivot itself (still SSG; a merchant's save reflects on `astro build`/dev immediately, but a *deployed* storefront needs a rebuild until SSR lands — separate, larger infra project already tracked in `PROD_PLAN.md`); checkout doesn't read `stores.logo_url` yet.
- **Merge:** rebased onto the `super-admin-overhaul` work above — conflicts in `app/(admin)/layout.tsx` (kept `AdminChrome`, took their `/akun/langganan` link), `packages/db/src/schema.ts` (kept both `stores.comped*` and `stores.brandColor`/`logoUrl`), migration numbering (their `0026`–`0028` were billing/store-control; this session's schema additions were regenerated as fresh migrations after the rebase, not force-numbered to collide), `packages/lib/package.json` exports, this file. Re-verified (typecheck + `astro check` + a fresh Playwright pass) after resolving.

## 2026-07-08 — Session: Storefront variant picker + fashion variant seed ✅
- Seed: all 14 fashion products now have real **Warna × Ukuran** variants (`WARNA_BY_SLUG` × `STOREFRONT_META.sizes`; pos-0 = default). `data/catalog.ts` reads real options+variants. `produk/[handle].astro` = real variant picker (per-option button groups) → resolves variant → live price + stock indicator (disables add on 0 stock); legacy sizes fallback. Cart variant-aware (keranjang/checkout show "Varian: {combo}"). Verified E2E: Dress Midi pick Sage/L → stock 32, cart "Varian: Sage / L", console-clean; storefront builds 29 pages; verify-rls green. **Variants now end-to-end: admin → storefront → cart.**

## 2026-07-08 — Session: Real product variants ✅
- Admin variant editor is now real: up to 3 options (add/remove) → cartesian matrix with per-variant SKU/harga/stok; hydrates on edit. `lib/data/products.ts getProduct` returns options+variants; `lib/actions/products.ts` create/update **reconcile by option-combo key** (matched update-in-place keeping stock/history, new insert, removed delete only if not in `order_line_items`). Verified E2E→DB: 6 variants (Ukuran×Warna) + stock override persist; edit→9 variants, 6 originals matched (stock kept), zero dupes. Build+console clean.


**Everything runs locally on Linux** (Docker PostgreSQL 16 :5433 + Drizzle `@tokophi/db`, 54 tables, migrations 0000–0016; payments+gateway+shipping cols). Done + verified end-to-end:
- **Reads:** all 3 surfaces (super-admin 5 pages + admin 16 modules + storefront) read Postgres.
- **Writes:** all **12 admin editors** persist via `lib/actions/*` server actions (Produk/Diskon/Halaman/Blog/Kategori CRUD · order-status · Inventori-stock · Navigasi · Pelanggan · CRM follow-up · Segmen · Pembelian PO create/receive→stock/cancel).
- **Auth (local):** email/password login → jose JWT httpOnly cookie, `middleware.ts` protects the admin (owner `ongki@batiknusantara.id / tokophi123`).
- **RBAC (local):** every mutating server action gates on a capability via `lib/rbac.ts` `requireCapability()` — role→capability matrix (client-safe in `lib/rbac-policy.ts`) for owner/admin/staff/gudang (role comes from the session JWT). Actions also derive `store_id` from the session. **UI:** `PermissionsProvider`/`useCan`/`<Can>` + topbar role badge; **ALL admin editors** hide their write/delete/create controls per role (Produk, Pengaturan, Diskon, Halaman, Blog, Kategori, Pelanggan, CRM, Segmen, Pembelian, Inventori, Navigasi, Pesanan).
- **RLS (local, ENFORCING at runtime):** migration `0012_tenant_rls` = `tenant_isolation` policy (`USING`/`WITH CHECK` on `store_id = app_current_store_id()`) on all **32 store-scoped tables** + non-owner `tokophi_app` role. **The admin now runs every query through `withTenant`** (`lib/tenant.ts`): all 14 `lib/data` reads via `withCurrentTenant` (session→GUC), all 13 `lib/actions` writes via `withTenant(session.storeId)` — each txn sets `app.store_id` + `SET LOCAL ROLE tokophi_app`, so RLS enforces live (the process connects as owner, but tenant queries drop to the restricted role). Auth (pre-session `store_users` read) + super-admin (cross-tenant) + storefront (per-client build) stay owner. **Verified**: `verify-rls` + `verify-rls-app` (the real withTenant path — read/write/isolation/WITH-CHECK) + Playwright E2E (all pages render, in-app write persists, 0 errors).
- **Media (local):** product image upload → `apps/admin/public/uploads/` + `product_media`.

**RBAC UI (ALL editors done):** `lib/rbac-policy.ts` (client-safe matrix) + `PermissionsProvider`/`useCan`/`<Can>` + topbar role badge; every admin editor gates its write/delete/create controls by role (verified via Playwright across owner/staff/gudang). Server actions stay the security boundary.

**▶ RESUME HERE (next session):** **admin-client feature depth** (user's focus; VPS deferred). Next pick = **Real variants** — schema already supports it (`product_options`, `product_variants` option1/2/3 + sku/price/cost, `inventory_levels` per variant/location); the gap is admin-only: the variant table in `apps/admin/app/(admin)/produk/[id]/product-editor.tsx` is UI-only (not wired/persisted), `lib/data/products.ts` reads only the default variant (position 0), and `lib/actions/products.ts` writes a single `Default` variant. Other admin backlog: `/pesanan/[id]` + `/diskon/[id]` detail routes, Tiptap rich-text, CSV export, de-dup admin → `@tokophi/ui`. (VPS + PostgREST + MinIO/S3 remains the later infra milestone.) Detail per-entry below (newest first).

## 2026-07-08 — Session: Super-Admin functional control plane ✅
- Audit: super-admin had read-only/fake-save surfaces. Added real, gated writes (`lib/actions.ts`, all `requirePlatformAdmin()`):
  - **Provisioning** `createStore()` (+ "Tambah toko" dialog on Toko page) — one-txn tenant onboard (account+owner+store+membership+location+settings+stats, Trial), redirects to new store. Was missing.
  - **Settings persist** `saveGateways()`/`saveCouriers()` — Pengaturan toggles+Simpan now write `platform_payment_gateways`/`platform_couriers`/`platform_cod` (were fake toasts).
  - **Team** = real `platform_admins` (`getPlatformAdmins()`) + `invitePlatformAdmin()` (Undang dialog). Hardcoded TEAM removed.
  - **Billing** `setInvoiceStatus()` — Paket invoice rows → mark dibayar/menunggu/gagal.
- Verified E2E (Playwright→DB): create store persists (trial + owner); Duitku enabled=true; operator opsqa in platform_admins; INV-9006→dibayar. Console-clean; reseeded pristine (7 stores).

## 2026-07-08 — Session: Super-Admin auth + admin multi-store polish ✅
- **Platform-admin auth** (gap from prior session closed): `platform_admins` table (migration 0013, seed admin@tokophi.id/tokophi123); `lib/platform-auth.ts` (distinct `platform_session` cookie) + login + `middleware.ts` + `requirePlatformAdmin()` gating impersonation/lifecycle; layout split (server `layout.tsx` → client `platform-shell.tsx` w/ account menu + logout). Verified: 307 gate, login E2E, gated impersonation click-through.
- **Admin store identity data-driven**: `lib/data/store.ts getStoreName()` + `components/admin/store-context.tsx` (`StoreProvider`/`useStoreName`, set in layout). Replaced every "Batik Nusantara" hardcode (topbar switcher, dashboard greeting, Pengaturan profile, product-editor vendor, CRM WA fills — `crm/page` server-fetched). NaN% donut fixed (`channel-chart.tsx`). Verified impersonating Kopi Senja → Pengaturan/CRM show "Kopi Senja", 0 Batik leak; both apps build clean.
- **Live activity feed now real** (`lib/data/activity.ts getActivityFeed()`, RLS-scoped: orders/signups/reviews/low-stock per store) — last static-mock leak removed. Verified impersonating Kopi Senja → feed = its 3 orders, no Batik product leak. Admin multi-store polish complete.

## 2026-07-08 — Session: Super Admin healthcheck + impersonation ✅
- **Multi-store seed** (`packages/db/src/seed.ts` `DEMO_STORES`): +6 stores w/ engineered health spread (2 sehat / 2 perhatian / 3 bermasalah). Platform pages now show real cross-store data.
- **Healthcheck** (`apps/super-admin/lib/health.ts` + `health-types.ts`): composite verdict + score from billing/activity/stock/status signals (owner connection, cross-tenant). Wired into Toko list (column+filter+cards), store detail (panel), dashboard (rollup + perlu-perhatian).
- **Impersonation** (`lib/session.ts` mirrors admin's token contract + `lib/actions.ts impersonateStore`): "Buka panel admin" mints the admin `session` cookie for a store's owner (shared AUTH_SECRET, localhost cross-port) → admin scopes to that store via RLS. **Verified**: admin serves the impersonated owner (curl + Playwright, console-clean). Admin app unchanged.
- **Lifecycle**: `setStoreStatus`/`setStorePlan` (suspend/activate/change-plan) — super-admin's first writes. `verify-rls` green; builds clean.
- **Known gap**: super-admin has no auth → these actions are unguarded (gate before deploy).

## 2026-07-08 — Session: rebrand indostore → TokoΦ ✅
- Full rebrand (see CHANGELOG 2026-07-08): scope `@tokophi/*`, DB role `tokophi_app`, folder/repo `tokophi`, display brand **TokoΦ**, Φ favicon. Verified migrate/seed/verify-rls + 3-surface builds clean; zero residual "indostore" in repo + external docs.
- Decision: **focus shifts to the admin client** (merchant admin depth) before the VPS infra milestone.

## 2026-07-04 — Session: RBAC + local Postgres RLS ✅
**State before:** all reads + writes + local auth + local media done on local Postgres; paused at RBAC+RLS (single owner user).

**Done this session:**
- [x] **RBAC (`apps/admin/lib/rbac.ts`)** — capability model + role→capability matrix (owner=all · admin=all−settings · staff=shop ops, no product-delete/warehouse/settings · gudang=inventori+pembelian only). `can(role, cap)`, `requireCapability(cap)` (returns the session or throws `ForbiddenError`).
- [x] **Gated all 13 mutating action files** (`lib/actions/*`, auth.ts excluded): products (write/delete split), discounts, pages, articles, collections, menus (content), orders, inventory, purchases, customers, crm+segments. Each mutation calls `await requireCapability(...)`; store-scoped creates now take `store_id` from the session (removed the per-file "first store" helper).
- [x] **RLS migration `0012_tenant_rls`** — hand-authored (drizzle-kit doesn't model RLS): non-owner `tokophi_app` role + grants, `app_current_store_id()` GUC reader, and `ENABLE ROW LEVEL SECURITY` + `tenant_isolation` policy (`USING` + `WITH CHECK`) on all **32 `store_id` tables**. Registered in the drizzle journal (+ 0012 snapshot) so `npm run migrate` applies it. Applied clean.
- [x] **`withTenant(storeId, fn)`** (`packages/db/src/rls.ts`, exported) — per-txn `set_config('app.store_id', …, true)` + `SET LOCAL ROLE tokophi_app`. Ready for the VPS switch.
- [x] **`npm run verify-rls`** (`src/verify-rls.ts`) proves isolation: right tenant → 14 products, wrong tenant → 0, no-GUC → 0 (fail-closed), cross-tenant INSERT blocked by `WITH CHECK`. **All ✓.**
- **Verified:** `build:admin` clean (middleware + all routes intact), `verify-rls` all green.
- **Note:** locally the app connects as the table owner, which *bypasses* RLS by design — enforcement flips on when the VPS points `DATABASE_URL` at `tokophi_app` and queries run via `withTenant`. RBAC (app-layer) is enforced now regardless.

**Next:** RBAC UI polish (hide/disable per role + graceful ForbiddenError toast), then VPS activation. See CURRENT STATE banner.

## 2026-07-04 — Session: RLS runtime enforcement (local) ✅
**Done this session:**
- [x] **`apps/admin/lib/tenant.ts`** — `withCurrentTenant(fn)` (session→`withTenant`) + re-export `withTenant`. Makes every admin query run in a txn that sets `app.store_id` + `SET LOCAL ROLE tokophi_app`, so RLS enforces at runtime (process connects as owner; tenant queries drop to the non-owner role — the VPS/PostgREST model).
- [x] **All 14 `lib/data/*` reads** wrapped in `withCurrentTenant` (helpers threaded as `base(db: Tx)` where needed) — done via subagent, build-verified.
- [x] **All 13 `lib/actions/*` writes** wrapped in `withTenant(session.storeId, …)` (store_id from the RBAC session; single-statement → arrow, multi-statement → one atomic txn). `media.ts` keeps fs outside the txn.
- [x] **Kept owner (correctly):** `lib/auth.ts` (reads `store_users` before a session exists — else login locks out), super-admin (cross-tenant), storefront (per-client build, no session).
- [x] **`npm run verify-rls-app`** (new) exercises the REAL `withTenant` path: own-tenant read + write-and-read-back its own discount; foreign tenant sees 0 of both; WITH CHECK blocks cross-store write; cleanup. All ✓.
- [x] **Playwright E2E**: logged in as owner, every admin page renders its data (pelanggan 24, inventori 14, diskon 6, kategori 8, halaman 7, blog 6, segmen 17, crm 10, dashboard) with 0 runtime errors / 0 permission-denials; an in-app customer-note write persisted across reload — all through `tokophi_app`. `build:admin` + `build:super` + storefront all clean.
- **Next:** the VPS server itself (infra) — app side is done.

## 2026-07-04 — Session: RBAC UI rollout to ALL editors ✅
**Done this session:**
- [x] Applied the `useCan()`/`<Can>` gating (same pattern as Produk) to **every remaining admin editor**: Diskon, Halaman, Blog, Kategori (editors: Simpan/Hapus; lists: Buat/Tambah CTA + row Hapus), Pelanggan (tag/catatan save), CRM follow-up (Tandai selesai), Segmen (Buat/Edit/Hapus), Pembelian (Buat PO dialog + terima/batalkan row actions), Inventori (Simpan stok), Navigasi (Simpan menu), Pesanan (advance-status button). Each guards its handler + hides the control per capability; server actions still enforce.
- [x] **Verified via Playwright** (fresh login per role): Diskon Buat = staff✓/gudang✗ (discounts:write); Inventori Simpan + Pembelian Buat = staff✗/gudang✓ (inventory/purchases:write); owner all✓ — orthogonal cross-check of the matrix. `build:admin` compiled clean.
- **Next:** VPS activation (connect as `tokophi_app` + route through `withTenant()` so RLS enforces).

## 2026-07-04 — Session: RBAC UI (role-aware controls) ✅
**Done this session:**
- [x] **Client-safe policy split** — `lib/rbac-policy.ts` (Role/Capability/ROLE_CAPS/`can()`/`ROLE_LABEL`); `lib/rbac.ts` now imports it + keeps the server guard (`requireCapability`/`ForbiddenError`). One matrix, shared by server + UI.
- [x] **`components/admin/permissions.tsx`** — `PermissionsProvider` (role from the session, wraps the admin layout) + `useRole()`/`useCan(cap)`/`<Can capability>`. Topbar account menu shows a **role badge** (Pemilik/Admin/Staf/Gudang).
- [x] **Gated Produk (list + editor) + Pengaturan** as the reference: Produk list "Tambah Produk" + row "Arsipkan" + bulk Aktif/Draft/Hapus; editor Simpan (`products:write`) / Hapus produk (`products:delete`) / media Unggah+delete (`media:write`); Pengaturan save footers are owner-only (`settings:write`).
- [x] **Verified E2E via Playwright** (fresh login per role picks up the DB role → JWT): **owner** Simpan✓ Hapus✓; **staff** Simpan✓ Hapus✗ (no delete); **gudang** Simpan✗ Hapus✗ + no media upload. Screenshots confirm. RBAC matrix also unit-checked (11 cases green). `build:admin` clean.
- **Note:** server actions remain the security boundary (still throw `ForbiddenError`); UI gating is UX. Remaining editors follow the same `useCan` pattern — tracked as the next step.

## 2026-07-02 — Session: execute tasks (storefront built ✅)
**State before:** Monorepo (apps/admin :3000, apps/super-admin :3001, packages/ui, packages/lib), both UI-mock prototypes, clean. Pushed to private GitHub — **no further pushes until told**. Payments/shipping platform-managed (ADR 0004). Docs current (PRD v0.3, UML, TASKS, SCHEMA, BACKLOG).

**Done this session:**
- [x] Worklog created.
- [x] **E4 — Storefront (Astro) ✅** — `apps/storefront` (Astro 5 + Tailwind v4), editorial women's-fashion "Batik Nusantara": Layout/Header/Footer/ProductCard + beranda (hero + collage of real AI photos, 6 koleksi, bestseller, values band kirim/COD/QRIS, CTA), `kategori/[handle]`, `produk/[handle]` (size picker + add-to-cart localStorage + Beli via WA), `keranjang` (cart + WA checkout). **22 static pages, astro build clean, console clean.** Commit `d743f8d`.
- **3 surfaces now exist:** super-admin + merchant admin + storefront. 🎉

**Gotcha logged:** the box runs MANY other `astro dev` servers (report-petani-sejahtera, homeimprovement/"RIVA HOME", …). Our storefront's `--port 4322` was taken → Astro fell through to **:4327**. Always confirm the actual port from the dev log; pick a high free port and verify the page title before screenshotting.

**Also done this session (E1):**
- [x] **Pesanan detail page** `/pesanan/[id]` — full page (item + foto, ringkasan rekonsiliasi ke total, linimasa, sidebar pelanggan/pengiriman/pembayaran w/ Sumber). Sheet quick-view removed; rows navigate. Build+console clean.
- [x] **Diskon create+edit** — `/diskon/baru` + `/diskon/[id]` reusable DiscountEditor; list "Buat/Edit"+rows wired; create dialog removed.

**Also done (storefront + galeri + checkout, 2026-07-02):**
- [x] **5 gambar/produk** — generated 56 more AI photos (14×4) via `count:4` + `show_generations` file→jq→download (avoids 56 polls) → **70 webp** (1.6MB), 5 per product. *(Gotcha: `show_generations` big result saves to a file; jq it. Later products lag completion — re-fetch.)*
- [x] **Storefront gallery** (Shopify PDP: main + 5 thumbnails) via `productImages()`.
- [x] **Checkout flow** — `/checkout` (kontak/alamat/pengiriman/pembayaran + sticky ringkasan) → `/checkout/sukses` (clears cart). Cart CTA "Lanjut ke Checkout".
- [x] **Removed WhatsApp checkout** — product "Beli via WhatsApp" → **"Beli Sekarang"** (add+redirect /checkout); cart WA checkout removed. (Contact WA in header/footer kept as CS.)
- [x] **Admin ↔ storefront 1:1** — copied all 70 images into `apps/admin/public/products`; admin `productImages()` helper; **product editor Media shows the 5-image gallery** (same files as storefront). Same products/prices/categories/images both sides.

**Storefront UI/UX polish (2026-07-02):** collection cards use real product photos + gradient; brand-story band; newsletter; refined values/hero ("Lihat Koleksi" replaces WA); **mobile hamburger drawer nav** (fixed the missing mobile category nav); premium ProductCard (hover-zoom, wishlist, eyebrow); category page eyebrow header + sort dropdown; product page micro-polish (gallery intact). Storefront build + console clean.

**Navigasi + nav presisi (2026-07-02):** admin Navigasi = menu builder parent/child dengan **drag-and-drop reorder** (HTML5, tree-ops.ts) + aksi "Jadikan sub-menu"/"Naikkan jadi induk" (2 level). Storefront header kini **cermin presisi Menu Utama admin**: Beranda · Semua Produk · Kategori▾(6) · Promo Gajian · Blog · Kontak (dropdown desktop + accordion mobile via nav.ts). Halaman baru: /blog, /kontak, /kategori/semua, /kategori/promo-gajian (koleksi virtual). Data admin: hijab→Busana Muslim, +Loungewear. self-hosted Postgres: belum (M3). Build+console clean.

**Docs pass + auto-connect (2026-07-02):** new **@tokophi/data** package = single source of truth for nav; admin menu builder + storefront header both derive from it (auto-sync on rebuild). Declared @tokophi/data dep in admin+storefront package.json. Full docs refresh: PRD→v0.4, README, ARCHITECTURE, **new GUIDE.md**, UML (9 Mermaid diagrams), ADR 0005 (monorepo) + 0006 (shared nav), UI_INVENTORY/DATA_MODEL/SCHEMA. Known gaps flagged: storefront /halaman/[handle] + /blog/[handle] not built; /akun is a no-auth stub.

**Backend M3 — local Postgres + Drizzle + super-admin live (2026-07-03):**
- [x] **`@tokophi/db`** package (Drizzle): `src/schema.ts` = **54 tables + 32 enums** from SCHEMA.md (snake_case casing, money=`bigint` IDR), `client.ts` singleton, **versioned migrations** (`drizzle/0000..0002`), `seed.ts`, `reset.ts`. Root **`docker-compose.yml`** = PostgreSQL 16 @ :5433. ADR 0007.
- [x] **Seed** — **single-tenant MVP**: 3 plans + **one store "Batik Nusantara"** (account/owner/`store_users`/settings/`store_stats`), 6 invoices (`number`), 4 activity, platform gateways/couriers(KiriminAja)/COD. Idempotent (truncate). *(Decision: focus everything on 1 real store; multi-tenant topology = ADR 0008, target.)* super-admin metrics made honest for 1 store (cross-store deltas → 0, `newSignups30d` derived, trial note hidden when 0).
- [x] **Wire super-admin → DB**: new **server-only `lib/data.ts`** (getStores/getPlatform/getDeltas/getPlanDistribution/getStatusDistribution/getInvoices/getActivity/getMrrSeries/getPaymentGateways/getCouriers/getAggregator). `lib/mock.ts` slimmed to config (types + PLANS). Client pages split into `*-client.tsx` + server wrapper; `mrr-chart` takes `data` prop; all DB pages `dynamic="force-dynamic"`. **Verified**: `tsc` clean, `build:super` (6 ƒ dynamic), 6 screenshots from DB with 0 console errors + **perfect parity**; live-mutation test proved runtime reads.
- [x] **Screening/perfection**: `menu_items.parent_id` self-FK; 37 inferred type exports; `stores.city` + `store_stats` + `invoices.number` added so the platform view is faithful from DB; `reset` script (drops `public` **and** `drizzle` journal); apps wired (`@tokophi/db` dep + `transpilePackages` + `serverExternalPackages:["postgres"]` + `.env.local`).
- **Impl notes:** toko list now ordered by GMV desc; store-detail "ID toko" shows real uuid (was STR-2005). RLS not enabled locally (plain Postgres) — app-layer `store_id` scoping for now.
- **Docs:** ADR **0007** (Postgres+Drizzle stack) + **0008** (per-client topology); ARCHITECTURE §9–10, UML §1/§10 (+provisioning sequence), SCHEMA (implemented + deltas), PRD status/roadmap.

**admin → DB — Produk (catalog) live (2026-07-03):**
- [x] **Seed catalog** into Postgres (single-tenant): 14 products (Batik Nusantara) → each 1 default variant (price), inventory (stock), primary media (image). Deterministic from the admin mock (mulberry32, curated drafts/low-stock preserved). Schema deltas: `products.emoji` + `products.units_sold` (rollup cache), `collections.emoji` — migration `0003`.
- [x] **`apps/admin/lib/data/products.ts`** (server-only): `getProducts()` / `getProduct(id)` flatten products ⋈ variant ⋈ inventory ⋈ media → the admin `Product` shape (signatures unchanged).
- [x] **Wire Produk list + detail**: `produk/page.tsx` = server wrapper → `produk-client.tsx` (interactive); `produk/[id]` fetches `getProduct(id)` → existing `ProductEditor` (uuid route, `force-dynamic`, dropped `generateStaticParams`). **Verified**: `tsc` clean, `build:admin` (`/produk` + `/produk/[id]` ƒ dynamic), screenshots from DB — list (14 products, prices/stock/terjual/status/dates, low-stock + drafts match) + editor (5-image gallery, price/margin, category) — **0 console errors, parity**.

**admin → DB — Diskon + Pelanggan + Kategori live (2026-07-03):**
- [x] **Seed**: 24 customers (mulberry32(4242) parity), 6 discounts (startsAt/endsAt anchored → real terjadwal/aktif/kadaluarsa), 8 collections + **32 collection_products membership** (counts derived, real: Dress 3 / Terlaris 10 / Promo 8…).
- [x] **`lib/data/{discounts,customers,collections}.ts`** (server-only): `getDiscounts/getDiscount`, `getCustomers/getCustomer`, `getCollections/getCollection` → flat admin shapes. Discount status + `endsInDays` derived from dates; collection count via `count(collection_products)`.
- [x] **Wire 6 routes**: Diskon list+editor, Pelanggan list+detail, Kategori list+editor — each server-wrapper + `*-client.tsx`, detail via `getX(id)` (uuid, `force-dynamic`, dropped `generateStaticParams`). Detail/editor components take the flat entity (order-history/member-picker still read mock exports until orders seeded). **Verified**: `tsc` + `build:admin` clean (8 admin routes ƒ dynamic), screenshots from DB — 0 console errors, parity.

**admin → DB — Pesanan + orders live (2026-07-03):**
- [x] **Seed orders** (mirror buildOrders `mulberry32(555)` parity): **60 orders + 153 line-items + 60 payments**, linked to customers by name + product variants by pick-index; status dist matches (dikirim 17 / selesai 16 / diproses 15 / baru 7 / batal 5); channel enum-mapped; `placedAt` from `minutesAgo`.
- [x] **`lib/data/orders.ts`**: `getOrders`/`getOrder(number)` → flat admin `Order` (items count from `order_line_items`, channel display-mapped, `minutesAgo` from `placedAt`). Route keyed by human number (`/pesanan/INV-4819`).
- [x] **Wire Pesanan list + detail**: server-wrapper + `pesanan-client.tsx`; detail via `getOrder` (`force-dynamic`). OrderDetail still *fabricates* line-items from the flat order (reconciles to total) — real line-items are seeded for later. **Verified**: `tsc` + `build:admin` clean, screenshots — list (60, tab counts/customer/items/status/total) + detail (customer/channel/total/time from DB) — 0 console errors, parity.

**admin → DB — Halaman + Blog live (2026-07-03):**
- [x] **Seed CMS**: 7 pages (status/template/views/updatedAt), 2 blogs + 6 articles (blog channel, author, comments, publishedAt). Schema deltas: `pages.template` + `pages.views`, `articles.comments` — migration `0004`.
- [x] **`lib/data/{pages,articles}.ts`**: `getPages/getPage`, `getArticles/getArticle` → flat `CmsPage`/`BlogPost` (published from status enum, blog channel via join, days-ago from timestamps).
- [x] **Wire Halaman + Blog list + editors**: server-wrapper + `*-client.tsx`; detail via `getX(id)` (`force-dynamic`). **Verified**: `tsc` + `build:admin` clean, screenshots — Halaman (7, status/template/views) + Blog (6, tabs/blog/author/comments) — 0 console errors, parity.

**admin → DB — Inventori + CRM live (2026-07-03):**
- [x] **Inventori**: server-wrapper reuses `getProducts()` → `inventori-client.tsx` (stock stepper from real inventory). No new data.
- [x] **CRM**: seed 12 leads + 10 followups + 6 wa_templates (schema delta `followups.last_message`, migration `0005`); `lib/data/crm.ts` (`getLeads`/`getFollowups` [customer via join]/`getWaTemplates`; source display-mapped, dueDays/lastContact from timestamps, discount... status derived). Wired 4 CRM routes: overview (async server), Follow-up / Pipeline / Template (server-wrapper + `*-client.tsx`, `force-dynamic`). Pipeline `leadWaHref` moved into the component (passes `waHref` prop to `LeadCard`). **Verified**: `tsc` + `build:admin` clean, screenshots — Inventori (14 SKU), Pipeline (kanban 9 leads by stage), Follow-up (10, dueDays sort, customer join) — 0 console errors, parity.

**admin → DB — Pembelian + Segmen + Ulasan live (2026-07-03):**
- [x] **Seed**: 4 suppliers + 6 purchase_orders (+21 po_items for the count), 6 customer_segments, 8 reviews. Schema deltas: `customer_segments.growth` (real), `reviews.product_name` + `reviews.emoji` (denormalized — some demo reviews reference legacy, non-catalog products) — migration `0006`.
- [x] **`lib/data/{purchases,segments,reviews}.ts`**: `getPurchaseOrders` (supplier via join, items via `count(po_items)`, etaDays from `eta_date`), `getSegments`, `getReviews` (customer via join, product/emoji denormalized). Wired 3 pages (server-wrapper + `*-client.tsx`, `force-dynamic`). **Verified**: `tsc` + `build:admin` clean, screenshots — Pembelian (6 PO, tab counts/supplier/item/total/ETA), Segmen, Ulasan (8, rating avg, customer join) — 0 console errors, parity. **12 admin modules now DB-backed.**

**admin → DB — Navigasi live (2026-07-03):**
- [x] **Seed** menus/menu_items (recursive, parent_id + position; type NavItemType→DB enum): 2 menus (main-menu 12 items incl. Kategori→6 children, footer 5). Inlined `MAIN_MENU`/`FOOTER_MENU` from `@tokophi/data` for seed parity.
- [x] **`lib/data/menus.ts`** `getMenus()` reconstructs the `NavMenu[]` tree from flat menu_items (parent→children map, type mapped back). Wired Navigasi (server-wrapper + `navigasi-client.tsx`, `force-dynamic`; `seedMenus()`→prop clone). **Verified**: `tsc` + `build:admin` clean, screenshot — 2 menus, hierarchical 12-item builder (Kategori sub-menu + children) — 0 console errors, parity. **16 admin modules now DB-backed.**

**admin → DB — Dashboard + Analitik live (2026-07-03):**
- [x] **Seed** `analytics_daily` rollup (new table, migration `0007`): 120-day daily sales/orders/visitors series (mirror mock `buildDays`, mulberry32(20260701)).
- [x] **Refactored `lib/data/dashboard.ts` → pure functions** (take `days`/`products`/`orders`/`activities` as params — client-safe, range switcher re-derives). `lib/data/analytics.ts` `getDailyStats()`. Split Dashboard (`page.tsx` server → `dashboard-client.tsx`) + Analitik (server → `analitik-client.tsx`), both `force-dynamic`, fetching daily-stats + products + orders. Live-activity feed + online count kept from mock (decorative realtime); Analitik's funnel/region/device/ROAS breakdowns kept mock. **Verified**: `tsc` + `build:admin` clean, screenshots — Dashboard (KPIs/sales chart/top products/status from DB) + Analitik — 0 console errors, parity.

**admin → DB — Pemasaran live · ADMIN NOW 100% DB-BACKED (2026-07-03):**
- [x] **Seed**: 3 ad_channels (denorm config + aggregate + `campaigns` jsonb) + 11 per-province rows into `ad_metrics` (`channel_key` NULL = province rollup). Schema deltas (migration `0008`): `ad_channels` +name/brand/pixel_label/pixel_active/spend_idr/impressions/clicks/conversions/revenue_idr/campaigns; `ad_metrics.channel_key` nullable.
- [x] **`lib/data/marketing.ts`** (`getAdChannels`/`getProvinceStats`). Split Pemasaran (server-wrapper + `pemasaran-client.tsx`, `force-dynamic`); threaded `channels`/`provinces` through sub-tabs, `blendedTotals()` from props. **Verified**: `tsc` + `build:admin` clean, screenshot (stats/ROAS table/per-province) — 0 console errors, parity.
- ✅ **All 16 admin modules read PostgreSQL** (Produk/Diskon/Pelanggan/Kategori/Pesanan/Halaman/Blog/Inventori/CRM/Pembelian/Segmen/Ulasan/Navigasi/Dashboard/Analitik/Pemasaran). Only decorative bits stay mock (live-activity ticker; analitik funnel/region/device breakdowns).

**storefront → DB · ALL THREE SURFACES NOW READ POSTGRESQL (2026-07-03):**
- [x] **Enriched `products`** (migration `0009`): `sizes` (jsonb), `badge`, `bestseller`, `rating_value`, `rating_count`; seeded `description` + `variant.compare_at_idr` + `collections.description` (category blurbs) — from the storefront catalog values. (Admin catalog already matched storefront: same 14 handles/prices.)
- [x] **Rewrote `apps/storefront/src/data/catalog.ts`** to read `@tokophi/db` via **top-level await** (build/SSR time) — **same exports** (`STORE`/`COLLECTIONS`/`PRODUCTS`/`productRating`/`bestsellers`/`byCollection`/`findProduct`/…), so all ~12 `.astro` consumers are unchanged. `astro.config.mjs` surfaces `DATABASE_URL` onto `process.env` (`loadEnv`) + `ssr.external:["postgres"]`; `apps/storefront/.env`(+example). `@tokophi/db` added to deps.
- [x] **Verified**: `astro build` clean (29 pages, all 14 products + 6 category collections generated from DB), screenshots — home (hero/6-collection grid w/ live counts 3·3·2·3·2·1/bestsellers) + product (rating 4.8·214, price+compareAt −24%, Promo badge, sizes, gallery, review breakdown, related) — **0 console errors, parity**.
- ✅ **super-admin + all 16 admin modules + storefront all read PostgreSQL.** Reads are done end-to-end.

**Mutations — Produk create/edit/delete persist (2026-07-03):**
- [x] **`apps/admin/lib/actions/products.ts`** (`"use server"`): `createProduct`/`updateProduct`/`deleteProduct` → Drizzle insert/update on products+variant+inventory+media, `revalidatePath("/produk")`. **Delete = archive** (soft: `status='archived'`, products are referenced by historical `order_line_items`); `getProducts` now filters `ne(status,'archived')` so archived drop out of admin list + storefront.
- [x] **Wired `product-editor.tsx`**: `useRouter` + `useTransition`; Simpan → create/update, Hapus → delete (loading state "Menyimpan…", `router.push("/produk")` + `refresh`, toasts). **Verified end-to-end via UI**: CREATE (persisted + variant/inventory/media, handle slugified) → EDIT (price 157k→209k in DB) → DELETE (archived + gone from list). `tsc` + `build:admin` clean.
- **Pattern for the rest**: `lib/actions/<entity>.ts` server actions + wire the editor's save/delete + `revalidatePath`. Reseeded to clean state.

**Mutations — Diskon + Halaman + Blog persist (2026-07-03):**
- [x] **`lib/actions/{discounts,pages,articles}.ts`** (`"use server"`) — create/update/delete → Drizzle + `revalidatePath`. Diskon: status+period → `startsAt`/`endsAt` (anchored to `ADMIN_TODAY` so derived status round-trips), `type`→`kind`. Halaman: `published`→`status`, `updatedAt=now`. Blog: new articles assigned to the store's first blog (no picker), `published`→`status`+`publishedAt`. All hard-delete (no history FK). Wired each editor's Simpan/Hapus (`useRouter`+`useTransition`, added missing `toast` imports to page/article editors).
- [x] **Verified end-to-end via UI**: created a discount + page + article (all appear in their lists + DB), deleted the discount (gone from DB; fresh list load confirms). `tsc` + `build:admin` clean. Reseeded. *(Note: after a delete-redirect the list can show the row for one tick — router-cache timing; a fresh navigation is correct.)*

**Mutations — order status + Inventori stock + Kategori persist (2026-07-03):**
- [x] **`lib/actions/orders.ts`** `setOrderStatus(orderId, status)` — order-detail's primary action advances baru→diproses→dikirim→selesai (real DB write + `revalidatePath`).
- [x] **`lib/actions/inventory.ts`** `updateStock(updates[])` — Inventori stepper now tracks dirty rows + a "Simpan N perubahan" button writes all changed stock to `inventory_levels` (via each product's default variant).
- [x] **`lib/actions/collections.ts`** create/update/delete — Kategori editor persists core fields (title/handle/description/type/match/published); member/condition management deferred. Delete clears `collection_products`+`collection_conditions` first (hard delete).
- [x] **Verified end-to-end via UI**: order INV-4789 baru→diproses; celana-kulot stock 22→27; collection create + delete — all confirmed in DB. `tsc` + `build:admin` clean. Reseeded. **7 write operations now persist** (Produk/Diskon/Halaman/Blog/Kategori editors + order-status + Inventori-stock).

**Decision — prod backend = self-hosted Postgres + PostgREST on VPS, NOT Supabase (2026-07-03):**
- User: "gak pakai supabase, nanti pakai local → postgrest sql - vps". Prod target = **self-hosted PostgreSQL + PostgREST on a VPS** (RLS for `store_id`, JWT auth, self-hosted Storage MinIO/S3). Local dev is already plain Postgres, so the same Drizzle migrations carry up with no rework. **Reframed all docs** (ADR 0007 + PRD/README/AGENTS/ARCHITECTURE/UML/SCHEMA/TASKS/BACKLOG/CONCEPT/CHANGELOG + `.env.example`) from "Supabase" → "self-hosted Postgres (VPS)"; removed the `NEXT_PUBLIC_SUPABASE_*` env vars.

**Mutations — Navigasi menu + Pelanggan tags/notes persist (2026-07-03):**
- [x] **`lib/actions/menus.ts`** `saveMenu(handle, items)` — "Simpan menu" now persists the whole tree (delete all `menu_items` for that menu → re-insert recursively with `parent_id`/`position`, type mapped beranda→home etc.). Wired navigasi-client (`useRouter`+`useTransition`).
- [x] **`lib/actions/customers.ts`** `updateCustomer(id, {tags, notes})` — customer detail's tags/notes now persist (migration `0010` added `customers.tags` jsonb + `notes` text; seeded `tags=["pelanggan", <segment>]`). Added a "Simpan tag & catatan" button; `getCustomer` returns tags/notes; `Customer` type += `tags?`/`notes?`.
- [x] **Verified end-to-end via UI**: deleted "Kontak" + Simpan menu → main-menu 12→11 (Kontak gone in DB, tree intact); added tag "uji-db" + note → persisted. `tsc` + `build:admin` clean. Reseeded. **9 write operations now persist.**

**Mutations — CRM follow-up + Segmen persist (2026-07-03):**
- [x] **`lib/actions/crm.ts`** `setFollowupStatus(id, status)` — the Follow-up "Tandai selesai" now writes `followups.status='selesai'` (kept the instant local `done` Set for snappy UI).
- [x] **`lib/actions/segments.ts`** `createSegment`/`deleteSegment` — Segmen "Buat segmen" dialog (controlled inputs + open state) creates a `customer_segments` row; card "Hapus" deletes it.
- [x] **Verified end-to-end via UI**: marked a follow-up done (selesai 1→2 in DB); created "Segmen Uji DB" (in DB) + deleted it (gone). `tsc` + `build:admin` clean. Reseeded. **11 write operations now persist.**
- **Pembelian deferred**: the PO create dialog is a simplified item-*count*, not real line items — persisting it faithfully needs a proper line-item PO builder (pick products + qty) + a "Terima barang" flow that adds stock. Tracked for later.

**Mutations — Pembelian PO builder · ALL ADMIN EDITORS NOW PERSIST (2026-07-03):**
- [x] **`lib/actions/purchases.ts`** `createPurchaseOrder` (line items → `purchase_orders` + `po_items`, supplier matched by name, unique code, total from lines), `receivePurchaseOrder` (status→diterima + add each outstanding line qty to `inventory_levels`, set `received_qty`), `cancelPurchaseOrder` (delete items + PO). `getPurchaseProducts()` feeds the picker.
- [x] **Rebuilt the PO create dialog** into a real **line-item builder** (product dropdown + qty + HPP rows, live total) + wired row actions "Tandai diterima"/"Batalkan". `pembelian-client` takes `products`; `RowActions` takes `po`.
- [x] **Verified end-to-end via UI**: created PO-xxxxxx (celana-kulot ×7, total 462k, po_items row); received it → status diterima + celana-kulot stock 22→29; cancelled another PO → row+items gone. `tsc` + `build:admin` clean. Reseeded. **✅ All 12 admin editors persist writes (12 write areas).**

**Local admin auth — login + session + route protection (2026-07-03):**
- [x] **Schema** `users.password_hash` (migration `0011`); seed hashes the owner password (scrypt `salt:hash`) — **ongki@batiknusantara.id / tokophi123**, role owner.
- [x] **`lib/auth.ts`** (server-only): `verifyPassword` (scrypt), `findLogin` (users ⋈ store_users), `signSession`/`getSession` (**jose JWT** in httpOnly `session` cookie, `AUTH_SECRET`). **`lib/actions/auth.ts`** `signIn`/`signOut`. **`app/login/page.tsx`** (email+password, `useActionState`). **`middleware.ts`** (edge-safe JWT verify → redirect to `/login`; matcher excludes `_next`/static/`products/`). `(admin)/layout.tsx` is now async → reads session → Topbar shows the user + "Keluar".
- [x] **Verified end-to-end**: unauthenticated `/` + `/produk` → 307 `/login`; wrong password → inline error; correct → dashboard (user shown in topbar); logout → `/login`. `tsc` + `build:admin` clean (Middleware compiled; postgres stays out of the edge bundle). Added `AUTH_SECRET` to `.env`/`.env.local`/`.env.example`.

**Local media upload — product images → product_media (2026-07-03):**
- [x] **Seed** now loads **5 `product_media` rows/product** (base + `-2..-5`, positions 0–4) instead of 1 → 70 media rows. `getProduct` returns the real `media[]`; `Product` type += `media?`.
- [x] **`lib/actions/media.ts`** `uploadProductImage(productId, formData)` (writes the file to `apps/admin/public/uploads/`, 5MB image cap, inserts a `product_media` row at next position) + `deleteProductImage(mediaId, productId)` (removes the row + the local file). `public/uploads/` gitignored.
- [x] **Product editor Media section** rewritten to show the real `media[]` (was the derived `productImages()`), with a hidden file input + "Unggah" button (`useTransition`) and a hover **delete** per image.
- [x] **Verified end-to-end via UI** (behind login): uploaded a PNG → tile 5→6 + `product_media` row + file on disk; deleted it → 6→5 + row + file gone. `tsc` + `build:admin` clean.

**Next up (resume here):**
1. **RBAC + RLS (local)**: gate actions/routes by `store_users.role` (owner/admin/staff/gudang); then enable Postgres RLS (`store_id` from the JWT) once a request-scoped DB role/GUC is wired.
2. **(later) VPS**: self-hosted Postgres + PostgREST + Storage (MinIO/S3 for the uploads); multi-tenant + per-client storefront `STORE_SLUG`.
2. **Deploy to VPS**: stand up self-hosted Postgres + PostgREST; wire JWT Auth (login/RBAC via `store_users`) + Storage (media uploads) + enable RLS; then multi-tenant (beyond single-store seed) + per-client storefront via `STORE_SLUG`.
3. **E1 sisa / E0 de-dup / Turborepo** (unchanged).

---

## 2026-07-29 — Conversion tracking, tenant-owned pixels (ADR 0012)

**Shipped:** the merchant's own Meta/Google/TikTok pixels, end to end — Seller setup (Pemasaran →
Pelacakan), storefront browser events, and a server-side conversion queue drained by a cron sidecar.
Scope decision: the **manual-pixel path** (paste your own id + token). Meta OAuth, catalog PUSH and
webhooks stay deferred — the existing `/feed/google.xml` pull feed already serves the catalog (§0.2),
and those phases cannot be live-verified without a Meta Developer App.

### Verified (commands run, results as they actually came out)

| Check | Result |
|---|---|
| `npm run build:admin` | ✓ compiled + typecheck clean |
| `cd apps/storefront && npm run build` | ✓ |
| `npm test` | ✓ 83 passed, 22 skipped |
| `npm run verify-rls -w @tokophi/db` | ✓ 48/49 (only `platform_activity`, as designed) |
| `npm run verify-migrations -w @tokophi/db` | ✓ journal sane, 81 entries, last `0080` |
| Real browser (Playwright, prod builds, `toko-demo.test`) | ✓ no page errors; funnel fires as specified |
| Feed ↔ conversion id reconciliation | ✓ **86/86 `<g:id>` byte-identical** to the ids the conversion payload computes |
| SQL ordinal check across the whole catalog | ✓ 106/106 variants agree, 96 multi-variant, 0 duplicate positions |

Browser run, per case: PDP → `ViewContent {content_type: "product_group"}` for a multi-variant product
(before the fix it was always `"product"` — the head script could not see `#variant-picker`);
`/checkout` → `InitiateCheckout`; `/checkout/sukses` with a **COD** order → `Purchase` carrying
`eventID: purchase:PHI-…`; with a **prepaid** order → **no Purchase** (correct: that page shows an
unpaid VA); with a legacy order that predates this feature → `Purchase` without an `eventID` (fallback).

### ⚠️ NOT verified — do not read the above as "conversions confirmed"

**No live provider call has been made.** There is no real Meta pixel + CAPI token, GA4 property + MP
secret, or TikTok pixel + Events API token in this environment. Everything above is builds, unit tests,
RLS, SQL reconciliation and a browser run against stubbed vendor scripts. Three specific things must be
settled with real credentials before anyone claims this works (ADR 0012 §30 P11):

1. **Meta with `user_data` carrying only ip+user_agent** — the docs require at least one identifier and
   we now always send several, but Meta's rejection behaviour is undocumented and its troubleshooting
   page publishes no error codes. Test with `test_event_code`.
2. **TikTok's error-code ranges** — `40000–49999 = permanent` is INFERRED. TikTok's code table is a
   client-rendered page with no primary source we could read. If a rate-limit code lives in that range
   we dead-letter what we should retry.
3. **TikTok's `user.phone` field name and pre-hash normalization** — plausible and corroborated by
   third-party SDKs, never confirmed against an official page.

### Decisions worth not re-litigating

- **COD counts at order creation, prepaid at payment confirmation** (signed off by the user 2026-07-29).
  The browser therefore fires `Purchase` only for COD; `tracking.browserPurchase` from the order API is
  what tells it. **Consequence, deliberate:** a store on prepaid channels with server-side tracking OFF
  records no Purchase at all. The Seller card says so.
- **Prepaid rows are created at checkout and HELD** (`next_attempt_at` in 2126), released by the payment
  callback. Enqueuing in the callback instead would mean every prepaid conversion travels with no user
  agent, IP or Meta cookie — the callback is a machine-to-machine request; the shopper's browser is long
  gone. The release runs over every PAID callback, not only the state transition, because the transition
  happens once and a failure there would lose the conversion permanently.
- **`event_id` is `purchase:{order_number}`, with no store id.** ADR §14.3 suggests namespacing by
  store, but `orders.number` is already platform-unique, and the alternative publishes the tenant UUID
  into the shopper's browser and three ad platforms' logs. Not a hole — nothing authorizes on it — but
  an identifier handed to Meta cannot be un-handed.
- **`value` = `orders.total_idr`**, i.e. it includes ongkir and PPN. Browser and server agree, so
  nothing double-counts; but ROAS reads higher than a goods-only convention would. Deliberate.
- **A COD order that is later `batal`/`retur` is NOT retracted.** There is no compensating event. For an
  SPX-COD store with a real refusal rate this over-reports; the ceiling is known, not accidental.
- **GA4 `user_data` IS hashed server-side** (`sha256_email_address` / `sha256_phone_number`); the browser
  leg passes RAW values only to a Google **Ads** (`AW-`) tag, which is gtag's documented contract — and
  is skipped entirely for a plain `G-` GA4 tag rather than handing it PII it has no use for.
- **Phone hashing differs per provider on purpose**: Meta wants digits (`628…`), TikTok and GA4 want
  E.164 (`+628…`). One shared normalizer would silently match nothing on two of the three.

### Known gaps (tracked in TASKS.md, not hidden)

- **No consent mechanism exists anywhere in this repo.** Marketing scripts load for every visitor.
  ADR §15.7 expects consent gating; building a fake one would be worse than naming the gap.
- No super-admin cross-tenant health view.
- No reconciliation sweep: if the enqueue fails after an order commits (process death), that conversion
  is gone. It is non-fatal by design — a marketing row must never fail an order — so the trade is
  deliberate.
- Rotating `INTEGRATION_TOKEN_KEY` invalidates every stored token; the Seller re-enters it and can now
  press **"Coba kirim ulang"** to requeue the last 7 days of dead-lettered conversions.
