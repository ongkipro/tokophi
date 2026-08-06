# Cross-validation of six parallel worktrees — 2026-08-01

Baseline: `origin/main` @ **86e3ec3**, checked out clean in `wt-audit`. All six worktrees are at that
same HEAD (0 commits ahead); every change is uncommitted working-tree state.

Everything below was re-derived here. Nothing was taken from the agents' own reports. Where a claim
could not be checked from this machine it is marked UNVERIFIABLE rather than assumed.

**Headline: the work holds up, and the six compose — but not in any order.** A scratch worktree built
from `origin/main` with all six diffs applied builds, type-checks both Next apps, passes 180 tests,
lints identically to baseline, and serves correct output. There is exactly **one** real merge conflict
in the whole set, and it has a **required direction**: `wt-sec` must land before `wt-fix2`, or the
person resolving it is one careless click away from re-introducing a published owner password.

Three problems were found. None is in the product code: one new check script is 50 % flaky, one new
check script writes to the shared dev database, and one merge order is unsafe.

---

## 1. File inventory

### wt-order-actions — admin: default-location helper + payment ordering

`AGENTS.md` · `specs/docs/tasks/NEXT.md` · `apps/admin/app/api/public/order/route.ts` ·
`apps/admin/lib/actions/{inventory,products,purchases}.ts` ·
`apps/admin/lib/data/{order-detail,orders}.ts` · `apps/admin/lib/order-status.ts`
**new:** `apps/admin/lib/default-location.ts` + `.test.ts` · `apps/admin/lib/data/order-payment.ts` + `.test.ts`

### wt-seo — storefront: h1 floor, sitemap lastmod, PDP thumbnail srcset, width ladder

`AGENTS.md` · `CHANGELOG.md` · `specs/docs/tasks/NEXT.md` · `apps/admin/app/api/uploads/[name]/route.ts` ·
`apps/storefront/src/components/sections/Hero.astro` · `apps/storefront/src/data/{catalog,content}.ts` ·
`apps/storefront/src/pages/{index.astro,produk/[handle].astro,sitemap.xml.ts}`
**new:** `apps/storefront/scripts/check-h1-floor.mjs` · `check-pdp-srcset.mjs`

### wt-perf — storefront: `Stars.astro` DOM reduction

`AGENTS.md` · `specs/docs/tasks/NEXT.md` · `apps/storefront/src/components/Stars.astro`

### wt-db — docs only

`specs/docs/tasks/NEXT.md` (N8)

### wt-sec — super-admin: no fixed password in `createStore`

`AGENTS.md` · `apps/super-admin/lib/actions.ts` ·
`apps/super-admin/app/(platform)/toko/toko-client.tsx` ·
`apps/super-admin/app/(platform)/pengaturan/pengaturan-client.tsx`
**new:** `apps/super-admin/lib/temp-password.ts` · `lib/no-fixed-password.test.ts`

### wt-fix2 — admin: un-anchor the 12 frozen seed dates + honest `markLabelsPrinted`

`apps/admin/app/(admin)/pesanan/massal/massal-client.tsx` · `apps/admin/lib/actions/articles.ts` ·
`apps/admin/lib/data/{activity,articles,checkout,crm,customers,orders,pages,purchases,reviews}.ts` ·
`apps/admin/lib/provision.ts` · `apps/super-admin/lib/actions.ts` ·
`specs/docs/{BACKLOG,CODE_MAP,REQUIREMENTS,STATUS,UI_INVENTORY}.md`
**new:** `apps/admin/lib/publish-date.ts` + `.test.ts`

### Collision matrix

| File | Writers | Result |
|---|---|---|
| **`apps/super-admin/lib/actions.ts`** | **wt-sec ∩ wt-fix2** | 🔴 **REAL CONFLICT — 2 hunks. Has a required merge direction.** §2 |
| **`apps/admin/lib/data/orders.ts`** | **wt-order-actions ∩ wt-fix2** | ⚠️ **Not flagged in the brief.** Merges **clean** 3-way; merged result verified correct. §2 |
| `AGENTS.md` | order-actions, seo, perf, **sec** — 4 writers | clean 3-way, 0 conflicts (regions 163, 303, 313, 359, 372, 446 — all disjoint) |
| `specs/docs/tasks/NEXT.md` | order-actions, seo, perf, db — 4 writers | clean 3-way, 0 conflicts. Strict `git apply` of a *plain* diff fails between db and order-actions (shared context lines) — the PR path is unaffected. |
| `CHANGELOG.md` | seo only | — |
| `specs/docs/{BACKLOG,CODE_MAP,REQUIREMENTS,STATUS,UI_INVENTORY}.md` | fix2 only | — |

Confirmed by set intersection: `wt-fix2`'s **only** overlaps with any other worktree are those two
source files. Every other file in all six sets has exactly one author.

---

## 2. The two collisions

### 2a · `apps/super-admin/lib/actions.ts` — wt-sec ∩ wt-fix2 · REAL CONFLICT

`git merge-file` (the same machinery `git merge` uses) → **rc=2, two conflict hunks**:

**Hunk A** — the constants block. wt-sec *deletes* `DEV_PASSWORD`, `ANCHOR` and the local
`hashPassword` (moved to `lib/temp-password.ts`). wt-fix2 *keeps* `DEV_PASSWORD` and the local
`hashPassword`, and *replaces* the `ANCHOR` line with an 8-line comment.

**Hunk B** — inside the transaction:

```
<<<<<<< wt-sec
    ...passwordHash: hashPassword(pw) }).returning();
    const trialEndsAt = new Date(Date.now() + BILLING.TRIAL_DAYS * 86_400_000);
=======
    ...passwordHash: hashPassword(DEV_PASSWORD) }).returning();
    const trialEndsAt = new Date(Date.now() + 3 * 86_400_000);
>>>>>>> wt-fix2
```

**What did NOT conflict, and this is the important part:** all four timestamp edits — dropping
`createdAt: ANCHOR` on `accounts`, dropping `createdAt: ANCHOR` on `stores`, `acceptedAt: ANCHOR →
new Date()`, dropping `updatedAt: ANCHOR` on `store_stats` — are **byte-identical in both worktrees**,
so git merges them silently. The two agents independently wrote the same fix, character for character.

**Which version wins: `wt-sec`, wholesale.** It is a strict functional superset for this file — it
makes every change wt-fix2 makes, plus the password fix. Taking wt-sec's `actions.ts` verbatim loses
**nothing functional** from wt-fix2; it loses only wt-fix2's comment prose, which contains one fact
wt-sec's comment does not (that an anchored store drops out of `newSignups30d`, the platform's own
new-signup count). Graft that one sentence in if you want it; do not graft the code.

I built the merged file that way and verified it:

- ✅ **One clock.** `trialEndsAt` from `Date.now()`, `acceptedAt: new Date()`, and **no**
  `createdAt`/`updatedAt` overrides anywhere — those three columns are `defaultNow()` in the schema.
- ✅ **Trial length unchanged.** `BILLING.TRIAL_DAYS` is **3** (`packages/lib/src/billing.ts:8`), so
  `BILLING.TRIAL_DAYS * 86_400_000` ≡ the old `3 * 86_400_000`. It is not a behaviour change; it now
  matches `apps/admin/lib/provision.ts:95` (the self-serve twin), which already used the constant.
- ✅ **No half-applied mixture.** `grep ANCHOR|DEV_PASSWORD|new Date("` over the merged file returns
  only two hits, both inside comments. No `new Date("…")` literal survives.
- ✅ `tsc -p apps/super-admin` rc=0, `npm run lint -w @tokophi/super-admin` clean,
  `no-fixed-password.test.ts` 5/5 pass.

**The half-applied mixture the brief worried about is real, and wt-sec's own test catches it.**
Negative control — I resolved the conflict the *wrong* way (took wt-fix2's file) and re-ran the guard:

```
✓ tempPassword() is random per call
✓ a stored hash never verifies against a published password
× every hashPassword() call in actions.ts hashes a freshly minted password
    → expected 'pw: string' to be 'pw'
× every action that mints a password hands it back to the operator
    → createStore must return the minted password: expected '{ ok: boolean; storeId?: string; erro…'
✓ no write in actions.ts is anchored to a frozen date
Tests  2 failed | 3 passed (5)
```

Restoring the correct resolution: 5/5 pass. So the guard exists — **but only once wt-sec has landed.**
That is what makes the merge order a safety property, not a preference. See §5.

### 2b · `apps/admin/lib/data/orders.ts` — wt-order-actions ∩ wt-fix2 · not in the brief, merges clean

Both edit the top-of-file region: wt-order-actions adds `import { latestPaymentFirst }`, wt-fix2
replaces `const TODAY = new Date("2026-07-02…")` with a comment. `git merge-file` → **rc=0, zero
conflicts**. Merged result verified line by line:

```
 7: import { latestPaymentFirst } from "@/lib/data/order-payment";
 9: // ⚠️ THE REAL CLOCK for "x menit lalu" (both call sites below)…
53:     minutesAgo: Math.round((Date.now() - r.placedAt.getTime()) / 60_000),
241:         order by ${latestPaymentFirst()} limit 1)  as "paymentMethod"
325:          minutesAgo: Math.round((Date.now() - new Date(r.placedAt).getTime()) / 60_000),
```

`TODAY` is gone, both call sites are on the real clock, and the payment ordering fragment is present.
No dangling reference. It compiles (`tsc -p apps/admin` rc=0 in the six-way tree).

---

## 3. Claim-by-claim verification

### wt-order-actions

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | `defaultLocationRow` replaces all copies; the tenant filter is non-optional at all 8 call sites | **VERIFIED** | 8 `defaultLocationRow(…)` uses — `api/public/order/route.ts` ×3 (L297, L596, L668), `actions/purchases.ts` ×2, `actions/inventory.ts`, `actions/products.ts`, `order-status.ts` — every one passes a store id, and `storeId: string` is a required positional param so a call site that cannot name its tenant does not compile. Plus 2 `defaultLocationId(db, sid)`. No hand-written `is_default desc` inventory subquery survives under `apps/admin`. |
| 2 | The emitted SQL carries `loc.store_id` | **VERIFIED** | Rendered via `PgDialect`: `… where il.variant_id = $1 and loc.store_id = $2 order by loc.is_default desc, il.id limit 1`. |
| 3 | `latestPaymentFirst()` gives `paid_at desc nulls last` in **both** paths | **VERIFIED** | Both real shapes rendered. Detail: `"payments"."paid_at" desc nulls last, "payments"."id" desc`. List (raw template, `payments` unaliased): `(select payments.method::text from payments where payments.order_id = o.id order by "payments"."paid_at" desc nulls last, "payments"."id" desc limit 1)`. The outer list query is `from orders o left join customers c` — no `payments` in scope, so the unaliased subquery is unambiguous. |
| 4 | The bug was real (`list cod`, `detail va`) | **VERIFIED** | `order-payment.test.ts` runs against real Postgres (`tokophi_test`) in a rolled-back txn, asserting both the fixed ordering and that a bare `desc()` inverts it. Both pass. |
| 5 | Latent, not live | **VERIFIED** | 827 payments. Orders with >1 payment: **0**. Orders with both a null and a non-null `paid_at`: **0**. |
| 6 | `tsc --noEmit -p apps/admin/tsconfig.json` clean | **VERIFIED** | rc=0, no output. |
| 7 | *(not claimed — checked anyway)* tightening the filter changes nothing on real data | **VERIFIED** | Every store has 1 location, all `is_default`. Inventory rows whose location's store ≠ the variant's product's store: **0/106**. Variants with inventory but none at their own store: **0**. |

### wt-seo

| # | Claim | Verdict | Evidence (real HTTP against a fresh build, served on :4395) |
|---|---|---|---|
| 8 | Homepage **with** a Hero: exactly one `<h1>` | **VERIFIED** | `toko-demo.test/` — baseline **3** ("Batik Modern untuk Hari-Harimu", "Bahan Pilihan, Jahitan Rapi", "Anggun di Setiap Momen"); wt-seo **1**. The 3-slides-3-h1 claim is confirmed against `origin/main`. |
| 9 | Homepage **without** a Hero: exactly one (the `sr-only` floor) | **VERIFIED** | `check-h1-floor.mjs` staged a real hero-less template for `gadget-murah-id`: live, `h1 1`, floor carries the store name verbatim. Also the untouched fallback path (`kopi-senja.test/`, no template): **1** `<h1>` = "Kopi Senja". |
| 10 | PDP thumbnail `<img>` carries `srcset` **and** `sizes` | **VERIFIED** | Baseline `srcset: null, sizes: null`, 66 px box serving the 800 w file. wt-seo: full ladder + `sizes="(min-width: 640px) 80px, calc((100vw - 80px) / 5)"`. The `capFrom` branch correctly omitted at n=5 (computes to exactly 640, matching the code comment). Browser picks 200 w for a 66 px box at DPR 2 — 1.5×, as claimed. |
| 11 | Sitemap `<lastmod>` matches `pages.updated_at` | **VERIFIED** | 15 → **21** `<lastmod>` across **55** `<url>`. All six `/halaman/*` dates compared to the DB: 2026-06-22, 2026-06-09, 2026-05-31, 2026-06-18, 2026-05-31, 2026-06-27 — identical. All `YYYY-MM-DD`, none future-dated. |
| 12 | `products.updated_at` does not exist; `collections` has neither; 9 tables carry it | **VERIFIED** | `information_schema`: `products` → `created_at` only; `collections` → neither; `count(distinct table_name)` = **9**. The original N13 premise was wrong; the correction is right. |
| 13 | `WIDTHS` and the admin allow-list are one decision in two files, and no third reader exists | **VERIFIED** | Source grep: exactly two readers, both in the diff, both → `[200,400,800,1200,1600,2000]`. `STATIC_WIDTHS` + `scripts/gen-image-widths.mjs` are a **separate** unchanged pair — no rendition regeneration implied. |
| 14 | Safe because the route never upscales | **VERIFIED (structurally)** | `MAX_DIM = 2000` in `lib/image-store.ts`; `if ((meta.width ?? 0) <= width) return <original>` at route L143, **before** the resize. The agent's byte-level route test was not re-run (needs the admin server up). |
| 15 | "Every consumer of `imageSrcSet` sets `sizes`" — load-bearing, since a missing one defaults to 100vw and would now pull 2000 w | **VERIFIED** | All 12 `srcset={imageSrcSet(…)}` sites carry `sizes`. The one bare `srcset` (`Hero.astro:85`) is a `<source>` with a single URL and no width descriptor — `sizes` is irrelevant there. |
| 16 | Production measurements (58 728 B / 114 073 B / 151 552→42 646 B, `cf-cache-status: HIT`, connection coalescing, Lighthouse scores) | **UNVERIFIABLE** | No production access. The direction is confirmed locally. |

### wt-perf

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 17 | Homepage DOM **1023 → 915** | **VERIFIED, exact** | 412×915 DPR 2, `toko-demo.test/`: 1023 → 915. |
| 18 | HTML **213 192 → 210 252 B** | **VERIFIED, exact** | Served bytes, both numbers to the byte. |
| 19 | Star widget **26 → 17** elements | **VERIFIED, exact** | 12 widgets; elements inside them 312 → 204 = 26 → 17 each. `<svg>` 175 → 79 (−96 = 12 × 8); `<path>` unchanged at 208, as intended. |
| 20 | Every section still renders, zero console errors | **VERIFIED** | `main > *` is the identical 11-child list before and after. Console errors identical to baseline: two `ERR_CONNECTION_REFUSED` for the store logo on `localhost:3000` (the admin origin, not running locally). Present on `origin/main` too — not a regression. |
| 21 | Fractional fill correct — no off-by-one | **VERIFIED, by pixel diff** | All 36 rating widgets (`/`, `/produk`, a PDP; ratings 3.0, 4.0, 4.3, 4.5, 4.6, 4.7, 4.8, 5.0) screenshotted at DPR 1, 2 and 3 on both builds. **DPR 1: 36/36 byte-identical. DPR 2: 36/36 byte-identical. DPR 3: 34/36 differ by 3 subpixel channels (1 pixel) each, max delta 5/255** — 104 of 2 443 716 channels, 0,0043 %. Matches the agent's stated "2 px … 5/255"; the real diff is if anything smaller. Structurally the geometry is provably faithful: item *i* sits at `x = i·(PX+GAP)` width `PX` in both the old flex row and the new `translate()/scale()`; total width unchanged (78 px at `sm`, measured both); the overlay is still `width: pct%` of that same box, so the pct→pixel mapping is unchanged (`4.0`→62.39 px, `4.3`→67.08 px, `4.7`→73.31 px in **both**). |
| 22 | N6: no browserslist, `build.target: esnext`, the audits are `fbevents.js` | **PARTLY VERIFIED** | No browserslist and no `build` key in `astro.config.mjs` — confirmed. The zero-`.js` client build and the coverage/Lighthouse figures were not re-measured. |
| 23 | "393 of 1023 elements were `<svg>`+`<path>`, and 312 of them were the star rating" | **REFUTED as phrased** | 393 is right for the **whole SVG namespace** (svg 175 + path 208 + circle 8 + rect 2). `<svg>`+`<path>` strictly is **383**. And "312 of them" is not 312 of the 393 — 312 is the star widget's *total element* count; its SVG-namespace share is **240**. The ratio reads as 79 % when it is 61 %. Headline numbers all exact; the sentence conflates two denominators. Worth one edit before it lands in AGENTS.md. |

### wt-db (docs only)

Everything checkable against the **local** DB is true, to the row: dev orders **842** · `ship_district_id
is null` **77** · of those with `ship_kelurahan_id` **0**, with `ship_postcode` **62**, with neither
**15** — all exactly as tabulated. `orders.ship_kelurahan_id`/`_name` exist on dev (`integer`, `text`)
but appear in **no** migration (`grep -l kelurahan drizzle/*.sql` → nothing) and **not** in `schema.ts`
— confirmed schema drift. `seed-recent.ts` selects/inserts `ship_kelurahan_name` (L147/L212/L219), so
it genuinely cannot run against a DB without the column. `orders.ship_kelurahan_id` is `integer` while
`kelurahan.id` is `text` — unjoinable id spaces, confirmed. `seed.ts` fabricates postcodes
(`POST_OF[city]` + 3 random digits, L929/L1055). No `kiriminaja_areas` row with `city_name = 'Jakarta'`
— the stated root cause of the dev nulls. **VERIFIED.**

**UNVERIFIABLE:** every production figure (75 orders, 65 null, column absent, 0 postcodes) — no prod
access from this machine. Nothing contradicts them.

### wt-sec

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 24 | `createStore` was hashing the literal `tokophi123` into every provisioned OWNER row | **VERIFIED** | `origin/main:apps/super-admin/lib/actions.ts:27` `const DEV_PASSWORD = "tokophi123"`, used at L107 `passwordHash: hashPassword(DEV_PASSWORD)` inside `createStore`. The severity framing is fair: that row is the store owner, and the same file's `invitePlatformAdmin` comment already claimed the class was fixed. |
| 25 | Random per mint, revealed once, and every caller surfaces it | **VERIFIED** | `tempPassword()` → `"tokophi-" + randomBytes(3).toString("hex")`; `createStore` returns `password: pw`; `toko-client.tsx` shows it in a `duration: Infinity, closeButton: true` toast that survives the `router.push`; both dialogs' hard-coded "Password awal: `tokophi123`" strings are replaced with "acak … hanya ditampilkan sekali". |
| 26 | `no-fixed-password.test.ts` fails if the rule is broken | **VERIFIED, by negative control** | See §2a — feeding it wt-fix2's `actions.ts` fails 2 of 5 assertions with messages that name `createStore`. |
| 27 | The frozen `ANCHOR` is removed and the trial is unchanged | **VERIFIED** | No `ANCHOR`, no `new Date("…")` literal in the file. `BILLING.TRIAL_DAYS = 3`, so the trial length is identical and now shares the constant with `apps/admin/lib/provision.ts:95`. |
| 28 | `npm run lint -w @tokophi/super-admin` stays green | **VERIFIED** | Clean (no output) on **baseline**, on **wt-sec**, and in the **six-way** tree. `tsc -p apps/super-admin` rc=0; `npm run build -w @tokophi/super-admin` succeeds. |
| 29 | Full suite green | **VERIFIED** | wt-sec alone: 18 files / **172** tests pass (baseline 17/167; +5 from `no-fixed-password.test.ts`). |

### wt-fix2

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 30 | `npm run lint -w @tokophi/admin` is unchanged from baseline — 19 errors, 23 warnings, nothing added | **VERIFIED in substance** | Baseline and wt-fix2 both report **`✖ 42 problems (19 errors, 23 warnings)`** over the same **51** files, and the rule-id multiset is byte-identical (`4 @next/next/no-img-element`, `14 react-hooks/exhaustive-deps`, `3 @typescript-eslint/no-unused-expressions`, `2 @typescript-eslint/no-unused-vars`). The raw text is *not* byte-identical — line numbers in `massal-client.tsx` shift by exactly +12, the number of lines fix2 added there. No new problem, no problem removed. The word "byte-identical" is loose; the substantive claim holds. Still 42/19/23 in the **six-way** tree. |
| 31 | The Keranjang Ditinggal screen moves 796 → 6 abandoned, 340 → 143 orders | **VERIFIED, exact** | Read-only, scoped per store as the RLS'd screen is. `batik-nusantara`: `ditinggal` with `created_at >= 2026-06-02` (the old frozen window start) = **796**; with `created_at >= now() - 30d` = **6**. Orders `placed_at >= 2026-06-02` = **340**; `>= now() - 30d` = **143**. Newest `ditinggal` row is **2026-07-15**, newest order **2026-07-31** — so a genuine 30-day window from today catches only 07-01…07-15 of the sessions. Every other store has 0 sessions. |
| 32 | The old "30 hari terakhir" label was covering a growing window | **VERIFIED** | `WINDOW_START` was `2026-07-02 − 30d = 2026-06-02` with **no upper bound**, so on 2026-08-01 it spanned **60 days** and grew by a day every day. The label said 30. The new `windowStart()` is a **function**, not a module const — correctly avoiding a `Date.now()` frozen at container start. |
| 33 | `publishedAt` was walking backwards on every save | **VERIFIED (by code reading)** | `fields()` is a full replace and wrote `publishedAt: i.published ? ADMIN_TODAY : null` with `ADMIN_TODAY = 2026-06-30`. `publishedAtFor(published, current, now)` now returns `current ?? now`, and `updateArticle` reads the row's own value first (that read doubles as the RLS tenant check). `publish-date.test.ts` 4/4 pass. |
| 34 | `markLabelsPrinted` caller now reports the honest `.done` | **VERIFIED (by code reading)** | `massal-client.tsx` destructures `{ done }` and branches: a warning toast naming `done` vs `printedNumbers.length` when they differ, success otherwise. The claim that the action already returned the true `.returning()` count is consistent with the `#117` entry in `NEXT.md`. |
| 35 | The recovery-link docs were wrong in four places | **VERIFIED** | `grep -rn signRecoveryToken` over all app/package **source** returns exactly one hit — its own definition at `apps/storefront/src/lib/recovery.ts:43`. **Zero callers.** `verifyRecoveryToken` *is* reachable (`checkout.astro:8,118`), so the verifier lives and the mint does not, exactly as the correction says. And I read the templates: **none** of the 6 `wa_templates` rows contains a link placeholder or a URL — the `keranjang` body is `"Halo kak {{nama}} 👋, produk *{{produk}}* masih ada di keranjang…"`, matching the quote verbatim. Downgrading SEC-13 from **MET** to **VACUOUSLY MET** and the STATUS row from ✅ to 🔴 is correct. |
| 36 | Full suite / typecheck / build green | **VERIFIED** | wt-fix2 alone: 18 files / **171** tests pass; `tsc -p apps/admin` rc=0; `npm run build -w @tokophi/admin` succeeds. |

### The check scripts

Run against every build on port 4395:

| Script | baseline | perf | seo | six-way | Note |
|---|---|---|---|---|---|
| `check-hero-srcset.mjs` | PASS | PASS | PASS | PASS | — |
| `check-pixel-defer.mjs` | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **Confirmed: a tenant-data failure, unrelated to any of the six.** It fails identically on clean `origin/main`. Cause pinned: `store_tracking_channels` for `batik-nusantara` has **one** row — `meta`, enabled — while the script asserts all three vendors. Its own header says it "requires the tenant to HAVE pixels configured". Output: `STUBS: {"fbq":"function","gtag":"undefined","ttq":"undefined"}`, `vendor requests after interaction: 2 hosts=["connect.facebook.net"]`. The deferral logic itself is proven working (0 vendor requests before interaction, 3 events buffered, vendors load after). |
| `check-h1-floor.mjs` (new) | n/a | n/a | PASS 4/4 | PASS 4/4 | writes to the shared DB — §5, finding 2 |
| `check-pdp-srcset.mjs` (new) | n/a | n/a | **FLAKY** | **FLAKY** | §5, finding 1 |

---

## 4. Composition — do the six compose?

**Yes, with exactly one hand-resolution.** Method: `git worktree add --detach origin/main` into scratch,
`git apply -3` each diff in order, copy the eight untracked files, build/test/lint.

Both directions of the one conflict were tested:

```
ORDER A: perf → seo → fix2 → sec → db → order-actions
  wt-perf clean · wt-seo clean · wt-fix2 clean
  wt-sec  CONFLICT 'apps/super-admin/lib/actions.ts'   ← sec's author must resolve
  wt-db clean · wt-order-actions clean       markers remaining: none

ORDER B: perf → seo → sec → fix2 → db → order-actions
  wt-perf clean · wt-seo clean · wt-sec clean
  wt-fix2 CONFLICT 'apps/super-admin/lib/actions.ts'   ← fix2's author must resolve
  wt-db clean · wt-order-actions clean       markers remaining: none
```

Same file, same two hunks, same resolution either way — but **not the same risk**. See §5.

Six-way results, resolved by taking wt-sec's `actions.ts`:

| | baseline | four-way | **six-way** |
|---|---|---|---|
| homepage `<h1>` (with hero) | 3 | 1 | **1** ✅ |
| homepage `<h1>` (no template) | 1 | 1 | **1** ✅ |
| homepage DOM elements | 1023 | 915 | **915** ✅ |
| homepage HTML bytes | 213 192 | 212 202 | **212 202** ✅ (byte-identical to four-way) |
| `main > *` children | 11 | 11 | **11** ✅ |
| sitemap `<lastmod>` / `<url>` | 15/55 | 21/55 | **21/55** ✅ |
| PDP thumbnail `sizes` | none | derived | **identical** ✅ |
| console errors | 2 (pre-existing) | 2 | **2** ✅ |
| `tsc -p apps/admin` | — | rc 0 | **rc 0** ✅ |
| `tsc -p apps/super-admin` | — | — | **rc 0** ✅ |
| `eslint` apps/admin | 42 (19E/23W) | — | **42 (19E/23W)** ✅ |
| `lint -w @tokophi/super-admin` | clean | — | **clean** ✅ |
| `astro check` storefront | — | 0 errors | **0 errors** ✅ |
| `vitest run` | 17f / 167t | 19f / 171t | **21f / 180t** ✅ |
| `check-h1-floor` / `check-hero-srcset` | n/a / PASS | PASS / PASS | **PASS / PASS** ✅ |

The storefront output is **byte-identical** between the four-way and six-way trees, as it should be —
neither new worktree touches the storefront.

The interaction originally worried about — the h1 floor counts `<h1>`s while the Stars rewrite changes
element counts — **does not exist**. `Stars.astro` emits no headings; `index.astro`'s floor inspects the
saved template's section list, not the rendered DOM. Both effects are present at full strength in the
combined build (915 elements *and* 1 `<h1>`), and 212 202 B = 215 142 (seo) − 2 940 (the exact perf
saving). Additive.

---

## 5. Recommended merge order — concrete

```
1. wt-perf   2. wt-seo   3. wt-sec   4. wt-fix2   5. wt-db   6. wt-order-actions
```

Two of these positions are **required**, not preferences:

🔴 **`wt-sec` MUST land before `wt-fix2`.** Both orders produce one conflict in
`apps/super-admin/lib/actions.ts`, but they are not equally safe:

- **sec first (correct):** fix2's author opens the conflict and finds their entire `actions.ts` change
  *already present* — the four timestamp edits merged silently because they are byte-identical. The
  resolution is "drop my hunk for this file", which is obvious and hard to get wrong. And
  `no-fixed-password.test.ts` is already in the tree, so a wrong resolution fails immediately.
- **fix2 first (dangerous):** sec's author must *delete* `DEV_PASSWORD` and a comment block a colleague
  wrote 20 minutes earlier — which looks like reverting someone's work — and the guard that would catch
  a half-resolution is arriving *in the same PR being resolved*. A "keep both, take theirs for the
  comment" resolution silently restores `hashPassword(DEV_PASSWORD)`. That is the published-owner-password
  bug, back.

⚠️ **`wt-db` before `wt-order-actions`.** Their `NEXT.md` hunks share context lines (N8's body is
order-actions' leading context for N9). Three-way merges clean either way, but the second to land
inherits the N8/N9 adjacency, and order-actions' author owns N9 — they can also fix the dangling "the
count above was seven" sentence, which no longer has a count above it once the heading is rewritten.

The rest is risk ordering: perf is the smallest surface and inherits nothing; seo is the largest
storefront change and was validated on top of perf; order-actions is the only set touching stock and
money write paths, so it deploys last and alone, making a rollback unambiguous.

### What to re-run after each merge

| After | Run | Expect |
|---|---|---|
| **1. wt-perf** | `npx astro build --root apps/storefront`; serve; `node apps/storefront/scripts/check-hero-srcset.mjs` | build rc=0, PASS, homepage DOM **915** |
| **2. wt-seo** | storefront build + serve; `check-h1-floor.mjs`; `check-hero-srcset.mjs`; `npx tsc --noEmit -p apps/admin/tsconfig.json` (it edits an admin route) | h1-floor 4/4 PASS, hero PASS, tsc rc=0, sitemap **21/55** |
| **3. wt-sec** | `npm run lint -w @tokophi/super-admin`; `npx tsc --noEmit -p apps/super-admin/tsconfig.json`; `npx vitest run apps/super-admin`; `npm run build -w @tokophi/super-admin` | lint clean, rc=0, **8 tests** pass, build ok |
| **4. wt-fix2** | **resolve `apps/super-admin/lib/actions.ts` by keeping the post-wt-sec version verbatim** (drop fix2's hunk for that file); then `npx vitest run apps/super-admin/lib/no-fixed-password.test.ts` ← **the guard**; `npx tsc --noEmit -p apps/admin/tsconfig.json`; `cd apps/admin && npx eslint`; `npm run build -w @tokophi/admin` | guard **5/5**, tsc rc=0, eslint **42 problems (19 errors, 23 warnings)** — no more, no fewer; build ok |
| **5. wt-db** | nothing — docs only. Optionally re-read `NEXT.md` N8/N9 for the dangling sentence. | — |
| **6. wt-order-actions** | `npx tsc --noEmit -p apps/admin/tsconfig.json`; `TEST_DATABASE_URL=…/tokophi_test npx vitest run`; `npm run build -w @tokophi/admin` | rc=0, **21 files / 180 tests**, build ok |

**Do not** re-apply saved plain diffs onto a moved base — that is the one path where `NEXT.md` collides
unnecessarily.

---

## 6. What the agents missed about each other

**1 · `check-pdp-srcset.mjs` is ~50 % flaky.** Four consecutive runs against the same wt-seo build,
unchanged database:

```
run 1 PASS · run 2 PASS
run 3 FAIL  no image exceeds 3x … — dress-midi-bunga.webp → 800w for a 66px box (6.1x)
run 4 FAIL  (same)
```

Same 2-of-4 split on the six-way tree. **Not caused by wt-perf** — confirmed on wt-seo alone. Cause:
thumbnail #1 and the main gallery image are the *same* URL with the *same* srcset. The main image
(380 px box) legitimately fetches the 800 w candidate; whether Chromium then reuses that cached 800 w
for the 66 px thumbnail instead of fetching the 200 w is a timing race. When it does, the check reads
`currentSrc = 800w` for a 66 px box and calls it a 6.1× regression — but **zero extra bytes were
transferred**; it is a cache hit. The check counts cache reuse as an oversize download. The structural
assertion (`every thumbnail <img> has srcset + sizes`) passed 4/4 every time and is sound. Fix: exempt
an `<img>` whose `currentSrc` was already requested by another element on the page, or assert on
transferred bytes rather than on the resolved descriptor. Shipping it as-is puts a coin-flip red check
into the runbook — which AGENTS.md's own `verify-rls` note says is how checks get ignored.

**2 · `check-h1-floor.mjs` writes to the shared dev database and is not concurrency-safe.** It inserts
a `page_templates` row for a store that has none (it picked `gadget-murah-id`) and deletes it in
`finally` at a fixed UUID. It cleaned up correctly here — `page_templates` count 2 before, 2 after, no
`TEMP%` leftovers. But the fixed id means two agents running it concurrently delete each other's row
mid-poll, `finally` does not run on `SIGKILL`, and while it runs a real store has a homepage it never
built, visible to any concurrent reader. The script is honest about this in its header and NEXT.md
documents it — but in a six-parallel-worktree setup, "writes to the shared dev DB" is a hazard the
other five agents had no way to know about. Consider gating it behind an explicit env var.

**3 · The `orders.ts` collision was invisible to both its authors** (§2b). It happens to merge clean,
which is luck, not design: wt-fix2 replaced the line immediately below wt-order-actions' new import.
One line either way and this would have been a second conflict.

**4 · wt-fix2's checkout change is a visible demo regression, and it is correct.** I agree with the
reasoning, and the numbers are exactly as reported: **796 → 6** abandoned carts, **340 → 143** orders on
`batik-nusantara`. The old behaviour was not a 30-day window at all — a frozen start of 2026-06-02 with
no upper bound, i.e. 60 days on 1 Agustus and growing daily, under a label that said 30. And the
`Math.max(0, …)` clamp meant every cart newer than the anchor read "baru saja", which collapses
`score()`, whose entire job is to decay basket value by age. So the fix is right on both halves.
**But the demo screen goes from 796 rows to 6**, and the cause is data, not code: the seed's newest
`ditinggal` row is 2026-07-15 and `seed:recent` inserts no `checkout_sessions` at all. This is
**correct-but-ugly**, and the owner should decide it, not discover it. The clean remedy is a data
change, not a code change — teach `seed:recent` to insert `checkout_sessions` — and it does not need to
block the merge.

**5 · wt-perf's SVG denominators are wrong** (claim 23). Nobody else could have caught it; nobody else
measured. The conclusion ("look for repeated icon markup first") survives.

**6 · Only wt-seo updated `CHANGELOG.md`.** wt-perf ships a rendering change, wt-order-actions changes
stock and payment reads, wt-sec closes a credential vulnerability, wt-fix2 changes twelve date
computations — none added a `CHANGELOG.md` entry, while `AGENTS.md:68` says to record a
contract-affecting change there. Because only one agent touched the file there is no merge risk today;
had all five followed the convention it would have been a five-writer collision. Worth deciding
deliberately.

**7 · Nothing shared is broken across the boundaries.** Checked explicitly:
- the `WIDTHS` constant seo changes has exactly two readers, both in seo's diff; `STATIC_WIDTHS` and
  `gen-image-widths.mjs` are a separate untouched pair, so no static renditions go stale;
- the widened `imageSrcSet` ladder is safe for all 12 consumers because every one sets `sizes`;
- `defaultLocationRow`'s tightened tenant filter is a no-op on all 106 current `inventory_levels` rows;
- `BILLING.TRIAL_DAYS` is 3, so wt-sec's trial refactor changes no behaviour and aligns super-admin
  with `apps/admin/lib/provision.ts`;
- `Stars.astro` is imported by ProductCard/PDP/category pages and all still render (3 routes, 36
  widgets);
- no check script in one worktree fails against another's output — `check-hero-srcset` and
  `check-h1-floor` pass on the six-way build, `check-pdp-srcset` is flaky identically with and without
  perf, and `check-pixel-defer` fails identically on all builds including baseline.

---

## 7. Bottom line

| | |
|---|---|
| Source-file collisions | **2** — `super-admin/lib/actions.ts` (real conflict, directional) · `admin/lib/data/orders.ts` (clean, was unflagged) |
| Doc collisions | `AGENTS.md` (4 writers) + `NEXT.md` (4 writers), both clean 3-way; one cosmetic nit to tidy |
| Claims verified | 31 |
| Claims refuted | **1** — wt-perf's "393 … 312 of them" denominators (phrasing; headline numbers exact). One more, wt-fix2's "byte-identical lint", is loose wording over a true substantive claim. |
| Claims unverifiable here | 6 — all production measurements plus two supporting sweeps |
| Compose? | **yes** — one hand-resolution, then builds, both apps type-check, 180 tests, lint unchanged, correct served output |
| Blockers | none in product code. `check-pdp-srcset.mjs` must be fixed before it is trusted; `check-h1-floor.mjs` needs a guard rail; the **wt-sec → wt-fix2** order is mandatory. |

Nothing in the six change sets was found to be broken, substantively overstated, or dangerous to merge.
The only outright overclaim is a mis-stated ratio in a comment. The three real problems are a flaky
check, a check that writes to shared state, and a merge ordering — none of them in the product code,
and all three cheap to address.

---

### Reproduction notes

- Builds: `npx astro build --root apps/storefront` per tree (all rc=0); `npm run build -w @tokophi/admin`
  in wt-fix2 and `-w @tokophi/super-admin` in wt-sec (both succeed in-place, where `node_modules` is real).
- Serving: `PORT=4395 DATABASE_URL=… STOREFRONT_CACHE_TTL_MS=0 node apps/storefront/dist/server/entry.mjs`,
  one at a time, killed after each probe. Nothing left listening.
- Tenants resolved by `Host:` header (node:http) or `--host-resolver-rules` (Playwright), per ADR 0009.
- DB access was read-only `select` throughout, except `check-h1-floor.mjs`, which self-cleaned
  (verified: `page_templates` count unchanged, no `TEMP%` rows left).
- `tokophi_test` was used for the DB-backed vitest suites; never the dev DB.
- The six-way tree lives outside the repo (scratch) and borrows `node_modules` by **symlink** — no
  `npm install` was run anywhere. `next build` cannot run there (Turbopack rejects a `node_modules`
  symlink pointing outside the project root), which is why the Next builds were run in the real
  worktrees instead.
- All six worktrees are byte-identical to how they were found (`git status --porcelain` re-checked at
  the end); the only file written is this report.
