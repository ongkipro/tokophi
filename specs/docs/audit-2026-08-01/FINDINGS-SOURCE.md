# TokoΦ — Audit & Work Session, 2026-08-01 · SOURCE OF TRUTH

> This file is the consolidated, verified record of a parallel audit + implementation session run
> against `origin/main` @ `86e3ec3`. It is the **input** for `REPORT.md` and the HTML report set.
>
> **Rule applied throughout, taken from this repo's own `STATUS.md`: _verify, or say you did not._**
> Every number below was produced by running something. Claims that could not be verified are marked
> UNVERIFIED and must stay marked in any document derived from this one.
>
> Corrections made *during* the session are kept visible on purpose — several agents disproved
> claims from the task list, from the repo's own docs, and from each other. Those disproofs are
> findings, not noise.

---

## 0. Method

Ten agents ran in parallel, each in its **own git worktree** branched from `origin/main`, because
`AGENTS.md` records that concurrent agents sharing one checkout have already caused an outage
(`queueSave is not defined`, which blocked the entire shipping-rate load — no rates → no COD → no
order — while typecheck, lint and build all stayed green).

Constraints imposed on every agent: no commit, no push, no PR, no merge; never `git stash` (global
in this repo, has previously written conflict markers into an unrelated file); no `npm install`
(`node_modules` was hardlinked across worktrees); the shared Postgres container was **read-only**
except inside rolled-back transactions or the separate `tokophi_test` database; distinct server
ports, PIDs killed individually.

**Nothing has been committed.** All work sits uncommitted in worktrees under
`.claude/worktrees/` for the owner to review and commit via lazygit.

---

## 1. Baseline — clean `origin/main` @ 86e3ec3, before any change

| Gate | Result |
|---|---|
| `npx vitest run` | PASS — 16 files, 145 tests · **1 file / 22 tests SKIPPED** |
| `npm run build:admin` | PASS |
| `npm run build:super` | **FAIL — environmental, not code** |
| storefront build (`astro build`) | PASS |
| landing build | PASS |
| `astro check` storefront / landing | 0 errors / 0 errors |
| `tsc --noEmit` × 7 packages | PASS 7/7 |
| `npm run lint -w @tokophi/admin` | **FAIL — 19 errors, 23 warnings** (pre-existing, in BACKLOG) |
| `npm run lint -w @tokophi/super-admin` | PASS |
| `verify-migrations` | PASS — 86 entries, last `0085` |
| `verify-rls` | PASS — RLS 51/52 |
| `check-hero-srcset.mjs` | PASS |
| `check-pixel-defer.mjs` | **FAIL** — tenant-data cause, unrelated to any change |

**`build:super` explained:** `apps/super-admin/` has no `.env.local` (admin has one, gitignored), so
Next never receives `DATABASE_URL` and page-data collection fails. Exporting the root `.env` makes it
build clean, all 13 routes emitted. Any report of "build:super is broken" is this, not a regression.

**`check-pixel-defer.mjs` explained:** it asserts all three vendor pixels load, but the seeded store
has only the `meta` channel enabled, so `gtag`/`ttq` are undefined. Fails identically on clean
`origin/main` and on all six change sets. The deferral itself is correct — 0 vendor `<script src>` in
the served HTML, 0 vendor requests without interaction, the `fbq` queue buffers, vendors load on
click.

### 1.1 The validation chain has three tools and only one is habitually run

Demonstrated three separate times this session:

- `next build` **does not run ESLint** — ESLint was the only gate that caught a backtick inside a JS
  template literal that had silently terminated a SQL string.
- ESLint and `next build` **do not typecheck test files** — `tsc --noEmit` was the only gate that
  caught a non-overlapping type assertion in a newly added test.
- `tsc`, ESLint, `astro check` and the build are **all green on live outages** — this is the repo's
  own documented history (a `ReferenceError` inside a client `<script>`; `select sum(…) for update`
  inside a SQL string, which Postgres rejects outright).

**Recommendation:** run all three plus the browser checks before any PR. Currently nothing runs
ESLint automatically, which is how it rotted to 19 errors.

---

## 2. Errors, ranked

### 🔴 BLOCKING

**E1 — Every store created from Super Admin got the owner password `tokophi123`.**
`apps/super-admin/lib/actions.ts:27,107` hashed new owners' passwords from the `DEV_PASSWORD`
constant — a string published in this repository and in `AGENTS.md`.

Failure: an operator onboards `budi@tokosaya.com`; anyone knowing that email logs in at
`app.tokophi.com` as store **owner** → every order (buyer name, WhatsApp, full delivery address),
every customer record, and via `settings:write` the bank-account and payout actions.

The same bug had already been fixed **250 lines below** in `invitePlatformAdmin` (random
`tempPassword()`, revealed once) — whose own comment asserted the other paths were already correct.
Instance patched, class missed.

**STATUS: FIXED** in `wt-sec`. `createStore` now mints a random password and returns it; the operator
sees it once via a persistent toast (a dialog was rejected because the handler `router.push`es
immediately and would unmount it; `<Toaster>` lives in the root layout and survives navigation).
Proven on `tokophi_test`, rolled back: `verify('tokophi123') = false`, `verify(minted) = true`.
A class-level test (`no-fixed-password.test.ts`) scans the action module and fails if any
`hashPassword()` call receives anything but a freshly minted value, if a minting action fails to
return it, or if any write is anchored to a frozen date — proven red (3/5) before green.

### 🟠 SERIOUS

**E2 — Login pages publish working control-plane credentials.** `apps/super-admin/app/login/page.tsx:30`
prints `admin@tokophi.id / tokophi123`; the admin login has its equivalent. The seed genuinely creates
those rows on deploy, so on `rich.tokophi.com` the control plane advertises a working credential on
its own login screen. **NOT FIXED — owner decision required** (delete the hint, or rotate the seeded
password; touches the seed and both apps).

**E3 — The abandoned-cart recovery link is never minted.** `signRecoveryToken`
(`apps/storefront/src/lib/recovery.ts:43`) has **zero callers**; none of the 6 `wa_templates` rows
contains a link placeholder or URL; `cartMessage` fills only `{nama, produk, toko}`. The merchant's
WhatsApp message therefore contains no way back, and ~50 lines of storefront code (verifier, banner,
cart restore, field pre-fill) are unreachable. Independently confirmed twice.

Meanwhile the docs claimed it worked: `REQUIREMENTS.md` SEC-13 = MET, `UI_INVENTORY.md:60` = "✅ real
DB", `CODE_MAP.md:113` = "mints/verifies", `STATUS.md:162` = "Recovery links are signed, not
guessable". **This is the exact failure mode `STATUS.md`'s own opening rule describes.**

**STATUS: NOT WIRED, DELIBERATELY — docs corrected instead.** Wiring it is not small: the signer lives
in `apps/storefront/src/lib`, which the admin cannot import (needs a move to `packages/lib`); the read
layer does not fetch the store slug; the template needs a `{{link}}` no existing row has (and the seed
is not a migration); and the restore path has **never been run in a browser**. Four docs corrected —
SEC-13 is now `VACUOUSLY MET — NO LINK IS EVER MINTED`, which separates what is true (no raw-id path
exists; the verifier is correct and store-bound) from what is not. `BACKLOG.md` P1 records the four
concrete steps and restates the security shape: signed, store-bound, 7-day jose token, **never a raw
session id**.

**E4 — Frozen seed anchors in 12 live sites, 2 of them WRITES.**
`apps/admin/lib/actions/articles.ts` wrote `publishedAt = 2026-06-30`, and because the update is a
full field replace, **re-saving a published article walked its date backwards** — mechanically
identical to the documented voucher bug that made every merchant-created voucher born already
expired. `apps/super-admin/lib/actions.ts` `createStore` stamped four columns with `2026-07-02`
while computing `trialEndsAt` from the real clock — one row, two clocks — so a store was born ~30
days old with a 3-day trial and **dropped out of `newSignups30d` permanently on day one**.

**STATUS: FIXED** in `wt-fix2` (all 12; the seed and mock anchors correctly left frozen). Proven on
`tokophi_test`: three consecutive saves under the old code held `2026-06-30`; under the new code the
true date `2026-07-20 08:30` is unchanged across three saves, and a draft's first publish stamps today.

**E5 — `desc()` in drizzle emits bare `DESC`, which is NULLS FIRST in Postgres.**
`data/order-detail.ts:306` used `desc(payments.paidAt)` while `data/orders.ts:234` used
`paid_at desc nulls last`. **Both files carried comments asserting they matched** — the detail one
reads *"Must match the LIST's definition exactly … unpaid last … One order, one answer."*

Failure: on an order with one unpaid and one paid payment, the list names the paid method and the
detail names the unpaid one — **the merchant reads two different payment methods for one order,
depending on which screen they are on.**

⚠️ **CORRECTED 2026-08-01, after this file's first draft.** Both data files' comments claim this fact
feeds `createShipment`'s courier cash-collection instruction (COD vs VA), and this document initially
repeated that. **It is false, and it was checked against the code:** `apps/admin/lib/actions/shipping.ts:512`
derives COD independently, via `exists (select 1 from payments p where p.order_id = … and p.method = 'cod')`
— an existence test that no ordering can affect. So **E5 is a display defect, not a money defect.**
Its severity is lower than first written. Note what this means though: the comments asserting the link
are themselves wrong, in the same two files whose comments already wrongly asserted the two orderings
matched — the same files have now been found to carry **two** false comments each.

Reproduced against real Postgres before the fix: `list -> cod, detail -> va, DISAGREE`.
**Latent, not live:** 827 payments, 46 with `paid_at IS NULL`, but **0 orders** currently carry both
shapes. This item was listed under "✅ Closed this session — do not redo" in `NEXT.md`; it was not
closed. **STATUS: FIXED** in `wt-order-actions` via one exported `latestPaymentFirst()` used by both
paths, with a real-Postgres test proven red then green.

Same class, lower stakes and **not fixed**: `data/articles.ts:57` sorts every draft above every
published post in the seller's Blog list.

**E6 — `tokophi_app` holds full DML on platform tables with RLS off.** `platform_cod`,
`platform_couriers`, `platform_payout`, `platform_payment_channels`, `plans` — and the `stores`
policy is `FOR ALL`, so the tenant role can UPDATE its own `comped` / `status` / `trial_ends_at`.
Latent today; **live the moment a merchant JWT drives that role**, which is exactly the stated
production architecture (PostgREST as `tokophi_app` with the `store_id` claim feeding the GUC).
**NOT FIXED — design decision required before the VPS cutover.**

### 🟡 MODERATE

**E7 — The public API tier lives inside the merchant's panel.** `/api/public/order|ongkir|promo|pay/callback`
are route files inside `apps/admin` and are excluded from its auth middleware
(`apps/admin/middleware.ts:66`). The highest-risk unauthenticated code on the platform sits inside
the app named "the merchant's panel", and **the admin container must be up for any shopper to check
out**. Not a defect in itself; it is an architectural fact absent from every existing document, with
real availability and blast-radius consequences.

**E8 — `SectionRenderer` has no `default:` arm and no exhaustiveness assertion.** A section type added
to `SectionConfigMap` and forgotten compiles and renders **nothing** on a live storefront.

**E9 — The `admin` role is derived by subtraction** (`rbac-policy.ts:68-70`). A new owner-only
capability **leaks to `admin` by default** unless explicitly added to the filter. `staff`/`gudang`
are allow-lists and immune.

**E10 — `markLabelsPrinted`'s caller ignored the honest count.** The action was fixed in #117 to
report `.returning()` rows; `massal-client.tsx:120` still toasted `printedNumbers.length`.
**STATUS: FIXED** in `wt-fix2`, and the copy now branches when the two numbers differ instead of
lying in the other direction.

**E11 — 22 money tests never run.** `apps/admin/lib/ledger-credit.test.ts` skips without
`TEST_DATABASE_URL`. The ledger — which decides when a sale becomes withdrawable — is guarded by
tests that are **off by default**. `tokophi_test` exists and is now migrated to head; nothing wires
it into the default run.

### 🟢 MINOR / HYGIENE

- **E12** — `check-pixel-defer.mjs` can never pass locally (tenant data, see §1). An alarm that always
  fires. Same family as the `verify-rls` incident this repo documents, where a verifier sat red for
  weeks and two cross-tenant leaks shipped past it.
- **E13** — Playwright browsers were **not installed on this machine at all**, so both repo browser
  checks were unrunnable as written. A check nobody can run is not a check.
- **E14** — Dead code: 3 dead tables (`stock_transfers`, `wa_messages`, `notification_templates`),
  9 dead columns, ~20 dead exports including two entirely dead modules — `packages/lib/src/payment-fees.ts`
  (which `AGENTS.md` describes as "only used for display"; it is used **nowhere**) and
  `apps/admin/lib/data/payments.ts`. Dead UI: `#area-derived` in `checkout.astro:1443` — confirmed
  absent from the rendered DOM, so `showArea()` always no-ops.
- **E15** — `apps/admin` ESLint: 19 errors / 23 warnings, pre-existing. 12 are "component created
  during render" (both sites stateless — cosmetic), 5 setState-in-effect, and **2 are false positives**
  (async server components deliberately calling `Date.now()`).

---

## 3. Work delivered, per stream

All verified by the independent cross-validator unless marked otherwise.

### 3.1 `wt-order-actions` — tenant scoping + payment ordering

- **N9:** `NEXT.md` said the default-location expression had 7 hand-written copies across 4 files.
  **There were 8.** The eighth is `apps/admin/app/api/public/order/route.ts`, which had **no
  `store_id`** and runs as the **owner with RLS off** — and `inventory_levels` is keyed
  `(variant_id, location_id)` with two independent FKs, so nothing forces a variant's inventory row
  to sit at a location of its own store.
  Extracted to `lib/default-location.ts` with `storeId` as a **required parameter** — forgetting the
  tenant is now a compile error. All 8 sites verified scoped, `tsc` clean.
  ⚠️ **Correction to `NEXT.md`'s framing:** its claim that "only the last one carries the tenant
  filter" is false — `products.ts:91` and `:135` carry it too, and the 4 join-based admin copies run
  inside `withTenant` where `locations` is RLS'd. The genuinely exposed sites were **2**:
  `order-status.ts` (reached by `ka-tracking.ts` on the owner connection) and the public order route.
  Treat N9 as a duplication task with two real security sites, not seven.
- **N10:** **stale — nothing to do.** `promo.ts` and `landing.ts` contain zero `throw` statements and
  have returned `{ ok, error }` since they were written; both callers already `toast.error`. The
  actions that genuinely still throw merchant-facing strings are `customers.ts` (×3), `crm.ts` (×3),
  `checkout.ts` (×2) and `cancelPurchaseOrder` — recorded, not touched.
- **E5** fixed (above).
- Verification: `build:admin` ✓, vitest 17 files / 150 tests ✓, `tsc` clean, ESLint clean on touched
  files, plus a **mutation check** — the tenant filter was deleted from the helper, the test went red,
  the filter was restored.

### 3.2 `wt-seo` — headings, sitemap, image bytes

- **N11:** confirmed and **worse than stated**. A builder homepage without a Hero rendered **zero**
  `<h1>`; a homepage *with* a Hero rendered **three** (the carousel emitted one per slide).
  Fixed: slide 1 keeps `<h1>`, slides 2..n become `<p>`; a Hero-less homepage gets
  `<h1 class="sr-only">` carrying **the store name from the DB**, never invented copy.
  `SectionRenderer` untouched — still switches on all 14 types, nothing published can stop rendering.
  Verified: 13 pages across 5 stores, **all `h1=1`**. Cross-validator re-verified 3→1 and 0→1.
- **N13:** confirmed, **but its stated data source does not exist**. `products.updated_at` is not in
  `schema.ts` and not in `information_schema`; `collections` has neither timestamp. Chose to emit
  `<lastmod>` only where a defensible timestamp genuinely exists — `pages.updated_at` is real and
  stamped on every save, so `/halaman/*` got one (N13 did not even ask for it). Products and
  categories deliberately get none.
  Rejected `created_at` with a reason worth keeping: a product created in March and re-priced today
  would advertise **March** — the page most needing a re-crawl marked as the stalest — and Google
  discounts `lastmod` **site-wide** once it finds it inaccurate, which would take the honest blog and
  page dates down with it. Sitemap: 55 URLs, 21 with `<lastmod>`, all `YYYY-MM-DD`, none in the
  future, every value reconciled against SQL.
- **PDP thumbnails had no `srcset` at all** (found by the measurement stream, not on any task list) —
  the `<img>` inside `<button data-thumb>` rendered a bare `src` into a 66 px box.

  | | before | after | delta |
  |---|---|---|---|
  | DPR 1 | 153 940 B | 32 198 B | **−121 742 B (−79%)** |
  | DPR 2 | 151 552 B | 42 646 B | **−108 906 B (−72%)** |
  | DPR 3 | 156 926 B | 49 436 B | **−107 490 B (−69%)** |

  The `sizes` was derived from container padding + `gap-3` + thumbnail count, **not** from the
  `max-w-[7rem]` cap: `max-w` only *caps* a `flex-1 basis-0` tile and the measured box is **66 px**,
  so `sizes="112px"` would over-claim 1.7× and cost a whole rung — worth **21 668 B** at DPR 2.
- **Width ladder** now reaches 2000 in both `catalog.ts` `WIDTHS` and the admin `?w=` allow-list
  (previously capped at 1200 with no original offered, unlike the static branch which deliberately
  appends the source). The never-upscale guard was verified by calling the route handler directly
  against fixtures **and** by removing the guard to confirm `sharp.resize({fit:"inside"})` really does
  enlarge without it. All 11 `imageSrcSet` consumers were checked for a missing `sizes` (a missing one
  defaults to `100vw` and would now pull 2000w) — none missing.
- **Left open deliberately:** `Header.astro` has three more bare `<img>` sites which render on **every
  page**. Different file, three separate `sizes` derivations. The new check **prints** them without
  failing, on the stated reasoning that a check red for work nobody in this change can land is a check
  everyone learns to ignore.

### 3.3 `wt-perf` — bundle and DOM

- **N6: closed, zero code change, and the hypothesis was wrong.** The client build target is already
  `esnext` (Astro hard-codes it; `astro.config.mjs` sets no `build` key; there is no browserslist in
  the repo). There is also **no bundle to trim** — `dist/client` contains **zero `.js` files**; all
  first-party JS is inline.
  The 44 KiB `unused-javascript` and 12 KiB `legacy-javascript` are **Meta's `fbevents.js`**:
  188.8 KB unused of 394.5 KB (47.9%), and it bundles **core-js v3.32.2**, the exact signature the
  `legacy-javascript` audit detects. A build-target change would have a measured delta of **0 bytes**.
- **N5: both candidates in `NEXT.md` were dead ends, with numbers.** Deferring carousel slides buys
  ~30 elements of a 106-element hero and costs the crawler/no-JS copy. Cutting what the default
  template seeds is **zero delta by construction** — the seed is not a migration and reaches new
  stores only.
  The real cost was `Stars.astro`: each rating drew two layers of five separate `<svg>` elements = 26
  elements, twelve times per homepage. Rewritten as one `<svg>` with five `<path>`s per layer.

  | | before | after |
  |---|---|---|
  | Homepage DOM elements | 1023 | **915** (−10.6%) |
  | `/` HTML | 213 192 B | 210 252 B (**−2 940 B**) |
  | `dist/client` | — | **0 delta** |

  Verified by **pixel A/B** over 40 rating widgets: DPR 8 and DPR 2 byte-identical; DPR 3 differed on
  8 of 40 by **1–2 pixels out of 45 288, max channel delta 5/255**, all on the fractional-fill clip
  edge. The cross-validator re-ran it and found 36/36 identical at DPR 1 and 2 — *if anything the
  original claim was pessimistic*.
  ⚠️ **One characterisation was overstated and is being corrected:** "393 of 1023 were `<svg>`+`<path>`
  and 312 of those were stars" — 393 is the whole SVG namespace, `<svg>`+`<path>` is 383, and 312 is
  the widget's *total* element count, not its SVG share (240). Reads as 79% where the truth is 61%.
  The headline numbers are exact; the wording was headed into `AGENTS.md` and has been corrected.
- Honest limit stated: 915 is under Lighthouse's 1400 median but over its 800 p10 — the audit improves
  without passing.

### 3.4 Measurement stream — production, read-only

- **N3 — the question was wrong, not the answer.** 15 desktop runs: **median 99, range 55–100, TBT = 0
  in all fifteen**. Bytes and request count **identical every run** (26 requests, 302 KB).
  Pearson r(score, network-RTT) = **−0.866**; runs ≥95 averaged 64 ms RTT, runs <95 averaged 632 ms.
  The score is a proxy for the measuring machine's link quality.
  **Refused to compare 99 against the old 84** — different machine, different day, incomparable
  populations. **Recommendation: drop desktop as a KPI or pin it to a fixed measurement host.**
- **N4 — cause found: the hero carousel's autoplay.** Speed Index scores every frame against the
  *last* frame; an autoplaying carousel guarantees the last frame differs, so the page is scored as
  never visually complete. Controlled A/B, one Chrome flag, everything else identical:

  | | SI median | Perf | LCP |
  |---|---|---|---|
  | autoplay ON | **7.96 s** | 67 / 90 / 88 | 1.81–2.09 |
  | autoplay OFF | **1.87 s** | **98 / 97 / 97** | 1.82–1.89 |

  Ruled out **with evidence**, not assumption: marketing pixels load at 10 780 ms, *after* the
  10 114 ms visual change, and the frame pair during which all three vendor bundles execute shows
  **0.00% pixel change**; CLS 0.000 across all 21 runs; font swap is 167 ms; no client islands on the
  homepage.
  **Recommendation: do nothing, record it.** The page is genuinely complete at 1.8 s. Chasing the
  number means delaying the cross-fade past the audit window — buying score with a carousel that
  feels dead on arrival. `prefers-reduced-motion` was used as an *instrument*, not a proposal.
- **N12 — the claim was wrong; a real bug sat behind it.** Uploads **do** get width variants
  (`?w=` returns genuinely different bytes: 3 578 B @200 → 61 074 B full), the route sets `immutable`
  itself and goes `cf-cache-status: HIT`, and `app.`/`toko.` share anycast IPs, one wildcard cert and
  HTTP/3 so Chrome coalesces — Lighthouse offers **zero** preconnect savings. The real finding was the
  PDP thumbnails (§3.2). A full read-only sweep of all 276 text/jsonb columns found
  `page_templates.sections` contains **zero** `/api/uploads` references — **no store currently uses an
  uploaded hero**, so the ladder gap was pre-emptive.

### 3.5 `wt-db` — N8 backfill: correctly refused

`NEXT.md` said "77 rows on production". That was the **dev** count. Production has 75 orders total and
**65** nulls, and **not one** has a `ship_postcode`. Every derivation named in the task resolves
**zero rows** there.

Two structural discoveries behind it:

1. **The id spaces cannot be joined.** `orders.ship_kelurahan_id` is an integer (KiriminAja village
   id); `kelurahan.id` is a text BPS/Kemendagri code (`34.02.13.2004`). Village → district is not
   derivable locally at all.
2. **Two migrations were lost to number collisions.** `ship_kelurahan_id` / `ship_kelurahan_name`
   exist on the shared dev DB but **in no migration and not in `schema.ts`**; slots `0034` / `0049`
   now belong to another branch. `verify-migrations` is green because the journal is self-consistent —
   which is precisely why the loss was never flagged. Consequence: **`seed:recent` cannot run against
   production** (it selects a column production does not have) and is green on dev only because of
   `push` drift.

The trap avoided: the 62 dev postcodes are **fabricated by the seed** (`POST_OF[city]` + 3 random
digits); 59 do not exist in `kelurahan` at all. Backfilling from them would have written a confident
wrong kecamatan **and silenced `destinationGuessed` (#117)** — strictly worse than NULL. Rows stay
NULL and stay flagged. Validated on synthetic fixtures inside a rolled-back transaction: unique pair →
backfilled, 3-district postcode → left NULL, already-set → not overwritten, second run → 0 rows.

### 3.6 Architecture map

`ARCHITECTURE.md` — 9 mermaid diagrams, every non-obvious claim carrying `file:line` or a SQL result.
Counted from the code and catalog, not quoted from docs. Highlights beyond §2's E7:

- **Real counts today:** `schema.ts` = **77 tables**; the container has **78** (the extra is
  `color_palettes`, present in no `schema.ts` entry and no `.sql` on this branch). **51 tables carry
  `store_id`, 50 have RLS**, sole deliberate exception `platform_activity`. `stores` is policed by
  `id` (migration 0058) and `verify-rls` structurally cannot see it.
- **The child-table class is 12, not 11** — `AGENTS.md` omits `flash_sale_items`. That class has
  produced five shipped cross-tenant bugs.
- **Impersonation, mapped end to end** (the open decision, §4): a 2-minute token buys a **7-day**
  cookie, and the minted session carries **no impersonation marker at all** — no `aud`, no operator
  id, no shortened expiry — so nothing downstream can distinguish it from the merchant's own login and
  **every action during it is attributed to the merchant**. Only the mint is audited. There is **no
  revocation** (no `jti`, no token version) and **a password reset does not kill it**. The only kill
  switch is deleting the owner's `store_users` row.
- **"Kecamatan PRICES, Kelurahan BOOKS" is only half implemented.** `orders.ship_kelurahan_id` and
  `ship_kelurahan_name` are empty in **842 of 842 rows**. `kaCreateOrder` supports
  `destination_kelurahan_id`; `createShipment` never passes it; `checkout.astro:404` says outright
  *"The order API ignores kelurahan entirely"*. Sender side likewise: `sender_kelurahan_id` empty in
  7 of 7 stores.
- **6 of 7 stores have no `sender_kecamatan_id`**, so every quote for them falls back to a fuzzy
  `resolveArea(stores.city)` match. It is flagged in the response by design — but it is the **default
  state, not the exception**.
- **Journal archaeology, by replaying all 79 historical revisions of `_journal.json`:** **88 tags ever
  recorded, 86 today.** The two lost: `0046_good_dust` (journal entry whose `.sql` was never
  committed — it broke `migrate` outright, so production never created the `kelurahan` table and
  `/api/public/ongkir` 500'd on every checkout) and `0064_store_public_email` (renumbered to `0070`
  after a two-branch collision). Both resolved; both prove **`verify-migrations` checks the journal
  against itself and is blind to an entry that was removed or renumbered.**
- **20 doc/code disagreements** tabulated. The most dangerous is not in a doc at all:
  `apps/admin/lib/tenant.ts:23-25` is a **code comment** that is wrong twice — it says "36 tables" and
  says `stores` has `relrowsecurity = false`, which migration 0058 made false. It sits in the file
  that defines the tenant boundary.

---

## 4. Decisions that are the owner's, not ours

| # | Decision | Why it cannot be taken unilaterally |
|---|---|---|
| **D1** | **Impersonation token** (`NEXT.md` N1) | Three defects compound: replayable inside its 2-minute window, travels in a **query string** (logs, `Referer`, browser history), and mints a **7-day** session outliving the operator's own. Plus §3.6: no impersonation marker, no revocation, survives a password reset. Options: single-use token · POST body instead of query string · bind the minted session's expiry to `platform_session` · all three. **Verified present, all three limbs**, at `session.ts:30`, `impersonate/route.ts:22`, `:46`. |
| **D2** | **Two Cloudflare zone settings** (N2) | Already approved 2026-08-01, procedure written in `specs/docs/CLOUDFLARE-PERF.md`, **not executed** — wrangler auth is expired and these are zone settings, not Workers. Email Obfuscation injects a render-blocking `email-decode.min.js` (measured 1 621 ms, the single largest blocker). ⚠️ The static-asset Cache Rule **must not** mark `/products/*.webp` `immutable` — a merchant replacing a photo keeps the filename. |
| **D3** | **Login pages publishing seeded credentials** (E2) | Delete the hint, or rotate the seeded password. Touches the seed and both apps. |
| **D4** | **`tokophi_app` DML on platform tables** (E6) | A design decision before the PostgREST cutover, not a patch. |
| **D5** | **Desktop PageSpeed as a KPI** (N3) | The measurement says the number tracks the tester's connection, not the build. Drop it or pin the host. |
| **D6** | **Speed Index / carousel autoplay** (N4) | Recommendation is to record it and stop tracking it. The alternative buys score with a carousel that feels dead. |
| **D7** | **Mobile score stability** (N7) | Removing `scroll` from the pixel trigger list stabilises the score at the cost of not tracking a reader who scrolls the whole page and never taps. `NEXT.md` itself says not to do this for the score alone. |
| **D8** | **Abandoned-cart demo data** | Un-anchoring `checkout.ts` is correct, and it drops the Keranjang Ditinggal screen from **796 → 6** on dev because `seed:recent` inserts no `checkout_sessions`. The fix is seeding, not code. **Do not re-anchor the app to make the demo look busy.** |
| **D9** | **`tempPassword()` entropy** | 24 bits (`randomBytes(3)`), no login rate-limit found. Unchanged by this session (`resetOwnerPassword` already used it), but widening it plus throttling is a real follow-up. |

---

## 5. Merge plan

Six change sets, all uncommitted, all branched from `86e3ec3`.

**Composition verified.** The six-way tree builds, `tsc` is clean on both Next apps, **21 files /
180 tests** pass, ESLint is unchanged in both apps, `astro check` reports 0 errors, and
`check-h1-floor` + `check-hero-srcset` pass. Storefront output is byte-identical to the four-way tree.

**Zero collisions among the original four.** Two appeared once the fix worktrees were added:

1. 🔴 **`apps/super-admin/lib/actions.ts` — `wt-sec` ∩ `wt-fix2`.** Real textual conflict, 2 hunks.
   **`wt-sec` must win both** — it is a strict functional superset for that file. The four timestamp
   edits are **byte-identical in both**, so git merges them silently; the conflict is only over the
   constants block and `hashPassword(pw)` + `BILLING.TRIAL_DAYS` vs `hashPassword(DEV_PASSWORD)` + `3 *`.
   **Negative control:** resolving it the wrong way fails `no-fixed-password.test.ts` 2/5 with
   messages naming `createStore` — but the guard only exists once `wt-sec` has landed.
2. ⚠️ **`apps/admin/lib/data/orders.ts` — `wt-order-actions` ∩ `wt-fix2`.** Merges clean and the
   merged result was verified correct — but that is luck, not design.

**Recommended order — this is a safety property, not a preference:**

```
perf → seo → sec → fix2 → db → order-actions
```

**`wt-sec` MUST precede `wt-fix2`.** Either order yields one conflict, but sec-first means fix2's
author finds the change already present and drops their hunk, with the guard already in the tree.
fix2-first means sec's author must delete a colleague's fresh comment block **while the guard arrives
in the same PR being resolved** — and a "keep both" resolution silently restores
`hashPassword(DEV_PASSWORD)`.

`AGENTS.md` has 4 writers and `NEXT.md` 4; both merge clean 3-way with 0 markers. Merges are
serialised here — each triggers a Coolify build — so merge one, watch the deploy land, then release
the next.

---

## 6. Documentation corrections made

`STATUS.md` was last edited 2026-07-31 yet claims "Refreshed 2026-07-21", and ten of its numbers are
wrong (72→78 tables, 64→86 migrations, 685→827 payments, …). **The dangerous one is line 147**: a
bold *"Every `jwtVerify` pins `algorithms` — ❌ NOT TRUE, do not believe this"* naming two files —
**both of which now pin `HS256`**. The document misleads in the opposite direction to when it was
written, warning about a hole that has been closed.

An important distinction for whoever refreshes it: some numbers are stale because **the code changed**
(fix them) and others because **the shared dev DB moved on** as other agents seeded (re-stamping those
just chases a moving target).

Corrected this session: `REQUIREMENTS.md` SEC-13, `UI_INVENTORY.md:60`, `CODE_MAP.md:113`,
`STATUS.md:162`, `NEXT.md` items N5/N6/N8/N9/N10/N11/N12/N13 and its false "closed" entry, plus
`AGENTS.md` (child-table count, default-location helper, payment ordering, three storefront
performance rules, the fixed-password instance).

---

## 7. Explicitly NOT verified

Any document derived from this file must carry these forward.

- **All production measurements** — byte figures, prod row counts, Lighthouse runs — were taken by the
  agents that ran them; the cross-validator had no prod access and could not re-check them. Nothing
  contradicts them.
- **`verify-rls` was not re-run by the architecture mapper**; the "green" result comes from the
  baseline and code-health runs.
- **No browser run** for the admin/super-admin changes (frozen dates, password reveal, toast copy) —
  `next build` + `tsc` + vitest is the extent. The repo's own rule is that money and checkout paths
  must be *exercised*; that was done for the storefront checkout (Playwright, `en-US`, 0 pageerrors,
  Rp110 000 + Rp15 700 = Rp125 700) but not for these admin screens.
- **The recovery restore path has never been run in a browser.** That is the finding, not a gap.
- **Whether the 86 migration `.sql` bodies are idempotent** — `verify-migrations` only proves the
  journal is sane, and non-idempotency is what stranded 16 migrations for everyone on 2026-07-30.
- **Whether E1 has been exploited in production.**
- **Which deploy target is actually live** — `CODE_MAP.md` (Vultr/sslip.io) and `AGENTS.md`
  (tokophi.com) contradict each other and production was not touched.
- **`accounts` tenancy** — no `store_id`, no RLS; could not be settled as platform-level or
  store-scoped, so it is excluded from the child-table count of 12.
- **The SPX free-return-leg belief** underpinning COD policy — `AGENTS.md` already marks it UNVERIFIED.
- **`KIRIMINAJA_ENV`** in production. It defaults to `sandbox`; an unset env in production silently
  talks to the sandbox.
