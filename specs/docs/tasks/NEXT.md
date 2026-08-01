# NEXT — what to pick up, in order

> Standing follow-up list. **Newest state as of 2026-08-01**, after `#117`–`#125` (merged and deployed)
> and **audit wave 2** (this branch, seven change sets — handoff
> [`2026-08-01-audit-wave-2.md`](./2026-08-01-audit-wave-2.md), consolidated record
> `../audit-2026-08-01/FINDINGS-SOURCE.md`, which is the **authority on every number below**).
>
> Pairs with `BACKLOG.md` (priorities), `WORKLOG.md` (session log) and the dated handoffs in this
> folder. **Legend:** size **S** (<1h) / **M** (half a day) / **L** (a day+). AC = acceptance criteria.
>
> 🔵 **Closed by audit wave 2: N5 (in part) · N9 · N11 · N12 · N14 · N6 · N4 · N3.** 🔴 **N8 was
> REWRITTEN — its premise was disproved.** N7 stays reversed. **Eleven items were ADDED** from the audit;
> they are new, not carried over, and nothing else in the repo tracks them.
>
> ⚠️ **Three entries in this file have now been found to rest on claims that were false** — N13's, N6's
> and N8's. Read an entry before trusting its sizing. That is the pattern, not the exception.
>
> ▶ **Starting work? The working brief is
> [`2026-08-01-followups-n5-n14.md`](./2026-08-01-followups-n5-n14.md)** — **N14 is CLOSED**, so ② N5
> (`dom-size`) is the head of it, and part of N5 has landed too.
>
> ⚠️ Before starting anything here: `git fetch && git log origin/main -3`. Several sessions run against
> this repo at once — see the top of `AGENTS.md`.

---

## 🔴 BLOCKED ON THE OWNER — nobody else can do these

### N1. Impersonation token — an account-takeover path into any merchant · **L**
Carried over across several sessions and still open. **This is a decision, not a task.**

The super-admin impersonation token:
- is **replayable** inside its 2-minute window (`session.ts:30`),
- rides in a **query string** (so it lands in logs, `Referer` headers and browser history)
  (`impersonate/route.ts:22`),
- mints a **7-day session** that outlives the operator's own `platform_session` (`:46`).

All three limbs re-verified present, 2026-08-01. Any one alone is arguable; together they mean a leaked
URL is a merchant's account.

⚠️ **Mapped end to end this session, and it is worse than the three limbs suggest.** The minted session
carries **no impersonation marker at all** — no `aud`, no operator id, no shortened expiry — so nothing
downstream can distinguish it from the merchant's own login, and **every action taken during it is
attributed to the merchant**. Only the mint is audited. There is **no revocation** (no `jti`, no token
version) and **a password reset does not kill it**. The only kill switch is deleting the owner's
`store_users` row.

**Options to put to the owner** (do not pick one unilaterally): single-use token (consume on redeem) ·
POST + body instead of a query string · bind the minted session's expiry to the operator's
`platform_session` · mark the session as impersonated · all of them.

**AC:** a decision recorded in `specs/decisions/`, then implemented, then a test that the second
redemption of one token fails.

### N2. Two Cloudflare zone settings — APPROVED 2026-08-01, procedure written, NOT done · **S**
Full steps, API equivalents and verification commands: **`specs/docs/CLOUDFLARE-PERF.md`**.

Not doable from this repo: wrangler auth is expired and these are **zone settings, not Workers**.

- **Email Obfuscation → Off.** Injects a **render-blocking** `email-decode.min.js`, measured
  **1 621 ms** — the single largest blocker on the page, triggered by our own `mailto:` links.
  ✔ **Re-confirmed still ON, 2026-08-01**: the homepage serves 2 `/cdn-cgi/l/email-protection` links
  and `email-decode.min.js` loads in every run. Nothing has been changed in the zone yet.
- **Cache Rules for static assets.** ⚠️ Read the table in that doc first: `/products/*.webp` and the
  other **SOURCE** images must **not** be `immutable` — a merchant replacing a photo keeps the
  filename, and we cannot purge what we told the world never changes.

**AC:** the `curl -I` checks in that doc return what it says they should.

### N15. Both login pages publish working control-plane credentials · **S** · NEW
`apps/super-admin/app/login/page.tsx:30` prints `admin@tokophi.id / tokophi123`; the admin login has its
equivalent. **The seed genuinely creates those rows on deploy**, so on `rich.tokophi.com` the control
plane advertises a working credential on its own login screen.

This is the visible half of the defect audit wave 2 fixed in `createStore` (see the handoff, ②). The code
fix stopped *new* stores getting a published password; it did nothing about the account the seed creates
and the login page names.

**Why it is the owner's:** the two options are not equivalent. **Delete the hint** and the demo login
becomes undiscoverable for anyone onboarding; **rotate the seeded password** and it touches the seed —
and ⚠️ **the seed is not a migration**, so an existing deployment keeps the old one until someone applies
a data fix. It touches both apps either way.

**AC:** no deployed login screen names a password that authenticates; if the seeded password is rotated,
the data fix for existing deployments is stated in the commit body, because nothing else will apply it.

### N16. `tokophi_app` holds full DML on the platform tables, with RLS off · **M** · NEW
`platform_cod`, `platform_couriers`, `platform_payout`, `platform_payment_channels` and `plans` are
writable by the tenant role with no policy on them — and the `stores` policy is `FOR ALL`, so the tenant
role can UPDATE its own `comped` / `status` / `trial_ends_at`. A merchant could comp themselves.

Latent today, because nothing drives that role from a merchant's own credentials. **It goes live the
moment a merchant JWT does** — which is exactly the stated production architecture: PostgREST connecting
as `tokophi_app` with the `store_id` claim feeding the GUC.

**Why it is the owner's:** it is a design decision **before the VPS cutover**, not a patch. Either the
platform tables move to a role the tenant cannot reach, or their grants are narrowed to `SELECT`, or the
cutover keeps writes behind the Next apps. Picking one changes what PostgREST is allowed to be.

**AC:** the decision recorded in `specs/decisions/`, then a `verify-rls`-style check that fails if
`tokophi_app` holds INSERT/UPDATE/DELETE on a `platform_*` table or on `stores`.

---

## 🟠 SECURITY & DATA INTEGRITY — open, not blocked

### N17. The abandoned-cart recovery link is NEVER minted — P1 · **L** · NEW
`signRecoveryToken` (`apps/storefront/src/lib/recovery.ts:43`) has **zero callers** in all four apps;
none of the 6 `wa_templates` rows contains a link placeholder or a URL; `cartMessage` fills only
`{nama, produk, toko}`. **The merchant's WhatsApp message therefore contains no way back**, and ~50 lines
of storefront code — the verifier, the "Selamat datang kembali" banner, the basket restore, the field
pre-fill — are unreachable. Independently confirmed twice.

The docs claimed it worked: `REQUIREMENTS.md` SEC-13 = MET, `UI_INVENTORY.md:60` = "✅ real DB",
`CODE_MAP.md:113` = "mints/verifies", `STATUS.md:162` = "Recovery links are signed, not guessable".
**All four are corrected**; SEC-13 now reads `VACUOUSLY MET — NO LINK IS EVER MINTED`.

**Four steps, and this is why it is not a drive-by** (full text in `BACKLOG.md`):

1. `signRecoveryToken` lives in `apps/storefront/src/lib`, which the admin cannot import. Move the pair
   to `packages/lib/src/recovery.ts` and re-export from the storefront (`@tokophi/lib/secret` is already
   shared, so the module gains no new deps).
2. `getAbandonedCarts` must mint per cart and build
   `https://${systemDomainFor(store.slug)}/checkout?r=…`. It needs the store **slug**, which the read
   layer does not fetch today (`getStoreName` returns only the name).
3. The template needs a `{{link}}`. ⚠️ **The seed is not a migration** — no existing store's row has one,
   so either `cartMessage` appends the URL when the body lacks `{{link}}` (smallest, works for every
   store today) **or** it takes a data fix. The template editor's variable chips + preview need `link`
   too, or merchants get a literal `{{link}}`.
4. **The restore path has never been run in a browser.** Drive it end to end — mint → open → assert the
   basket and the typed fields come back — before any of this is claimed done.

⚠️ **When it is wired, the mint MUST keep this shape: a signed, store-bound, 7-day jose token — NEVER a
raw session id.** A raw id in a URL is a bearer credential over a stranger's name, phone and address the
moment the link is forwarded, screenshotted or leaks via `Referer` — and those ids are already echoed in
every `/api/track` beacon.

**AC:** a real WhatsApp message body containing a working link, and the restore driven in a browser.

### N18. `tempPassword()` is 24 bits, and no login rate-limit was found · **M** · NEW
`randomBytes(3)` in super-admin (`"tokophi-" + 3 bytes hex`) against `randomBytes(4)` = 32 bits in the
admin's own copy. Unchanged by audit wave 2 — `resetOwnerPassword` already used it — but **that function
is now on the path that hands a merchant their first credential**, which raises what it is worth.

24 bits is 16.7 M candidates. That is only a real attack with an unthrottled login, and **no login
rate-limit was found**. Widen the mint *and* throttle the door; either alone is half the fix.

**AC:** the two `tempPassword()` implementations are one shared helper at ≥ 32 bits, and a test that a
burst of failed logins for one email is refused.

---

## 🟠 PERFORMANCE — what the measurements actually said

**Re-measured 2026-08-01 against production. Three of the five entries here were rewritten or closed by
the data, and one was reversed.** Read them before spending anything.

### 🔵 N3. Desktop PageSpeed — MEASURED, and the QUESTION was wrong · **decision, not work**
**15 desktop runs: median 99, range 55–100, TBT = 0 ms in ALL FIFTEEN.** Bytes and request count were
**identical every run** (26 requests, 302 KB) — the page did not change between runs; only the link did.

**Pearson r(score, network-RTT) = −0,866.** Runs scoring ≥95 averaged **64 ms** RTT; runs below 95
averaged **632 ms**. **The desktop score is a proxy for the measuring machine's connection quality, not
for the build.**

⚠️ **The 99 was deliberately NOT compared against the old 84** — different machine, different day,
incomparable populations. A single number from this metric means nothing whichever way it lands.

**Recommendation (D5, the owner's): drop desktop as a KPI, or pin it to a fixed measurement host.**
Reporting a median over ≥5 runs is the floor if it is kept at all — and note that run 1 is
systematically the cold one, so a 4-run series that starts cold understates by ~10 points.

<details><summary>the earlier entries, kept because the method is the point</summary>

Four runs spanned **66–92** against a single-run baseline of 84, with TBT 0 in all four. Then five runs
gave median 100, range 90–100. Then fifteen gave median 99, range 55–100 — and the correlation that
explains all three.
</details>

### 🔵 N4. `speed-index` 7,1 s — CAUSE FOUND: the hero carousel's autoplay · **decision, not work**
Speed Index scores every frame against the **last** frame. An autoplaying carousel guarantees the last
frame differs from the ones before it, so **the page is scored as never visually complete**. Controlled
A/B, one Chrome flag, everything else identical:

| | SI median | Perf | LCP |
|---|---|---|---|
| autoplay ON | **7,96 s** | 67 / 90 / 88 | 1,81–2,09 |
| autoplay OFF | **1,87 s** | **98 / 97 / 97** | 1,82–1,89 |

**LCP is unchanged.** Everything else was ruled out with evidence, not assumption: the marketing pixels
load at 10 780 ms, *after* the 10 114 ms visual change, and the frame pair during which all three vendor
bundles execute shows **0,00 % pixel change**; CLS is 0,000 across all 21 runs; font swap is 167 ms;
there are no client islands on the homepage.

**Recommendation (D6, the owner's): do nothing, record it.** The page is genuinely complete at 1,8 s.
Chasing the number means delaying the cross-fade past the audit window — buying score with a carousel
that feels dead on arrival. ⚠️ `prefers-reduced-motion` was used as an **instrument** here, not as a
proposal.

### 🔺 N5. `dom-size` — the stars landed; **the two candidates this entry named are dead** · **M**
**Partly closed 2026-08-01.** `Stars.astro` drew each rating as two layers of five separate `<svg>`
elements — 26 elements, twelve times per homepage: **312 elements, 30 % of the page**. One `<svg>` with
five `<path>`s per layer is 17.

```
homepage DOM   1023 -> 915   (-10,6%)
/ HTML         213 192 -> 210 252 B
dist/client    0 delta
```

Verified by pixel A/B over 40 rating widgets — byte-identical at DPR 8 and DPR 2; at DPR 3, 8 of 40
differ by 1–2 pixels out of 45 288, max channel delta 5/255, on the fractional-fill clip edge.

🔴 **BOTH candidates this entry used to name were measured and KILLED. Do not re-derive them:**
- *render only slide 1 server-side and hydrate the rest* — buys ~30 elements of a 106-element hero, and
  costs the crawler and the no-JS reader the copy;
- *cut how many sections the default homepage template seeds with* — **zero delta by construction**. The
  seed is not a migration, so it reaches new stores only and production keeps what it was given.

**What is left:** 915 is under Lighthouse's 1400 median and **still over its 800 p10** — the audit
improves without passing. The next largest repeats are the **header and footer lucide icons**. Measure
them before assuming.

⚠️ **`SectionRenderer` must keep switching on every type** — narrowing the palette must never delete a
merchant's published work (`AGENTS.md`, Store Builder). Narrow the palette, never the renderer.

**AC:** ≥5 mobile runs, report **median and range**; state the element count before and after; and
confirm no merchant-visible section stopped rendering (build a template holding one of each type and diff
the rendered output).

### ✅ N6. `unused-javascript` 44 KiB · `legacy-javascript` 12 KiB — CLOSED, zero code change
Closed twice over, and the second pass found *what those bytes actually are*.

**The suggested cause was impossible.** The client build target is **already `esnext`** — Astro hard-codes
it, `astro.config.mjs` sets no `build` key, and there is **no browserslist in the repo**. A build-target
change would have a measured delta of **0 bytes**.

**There is also no bundle to trim.** `dist/client` contains **zero `.js` files**; every script on the page
is inline.

**The 44 KiB and 12 KiB are Meta's `fbevents.js`** — **188,8 KB unused of 394,5 KB (47,9 %)**, and it
bundles **core-js v3.32.2**, which is the exact signature the `legacy-javascript` audit detects. They are
not ours, they are not transpilation, and they were most likely measured before `#122` deferred the
pixels.

**Reopen only with a run that reproduces it, and say which URLs the audit named.**

### 🔴 N7. DO NOT DO THIS — the stated cause is not what the runs show · **reversed 2026-08-01**
The bimodality is real. **The explanation is not.** Three mobile runs:

| run | perf | TBT | vendor pixel scripts loaded |
|---|---|---|---|
| 1 | 82 | **395 ms** | **0** |
| 2 | 92 | 26 ms | **0** |
| 3 | 95 | 0 ms | **0** |

The swing from 0 → 395 ms TBT happens with **no pixel bundle loading at all** — Lighthouse's scroll does
not fire them (the only scripts on the page are Cloudflare's two). So removing `scroll` from
`MarketingPixels.astro` would **pay a real tracking cost — the reader who scrolls the whole page and
never taps — and buy nothing.**

What is left to blame is our own main thread: `mainthread-work-breakdown` **3,4 s** with `bootup-time`
0,5 s. **N5 is the lever.**
**AC before touching the trigger list again:** a run where a vendor bundle actually appears in
`network-requests` *and* TBT moves with it.

---

## 🟡 ORDER LIFECYCLE & DATA

### 🔴 N8. Backfill `orders.ship_district_id` — **REWRITTEN. The premise was false; do not start it** · **L**
This entry said "**77 rows on production**". **That was the DEV count.** Production has **75 orders in
total** and **65** nulls, and **not one of them has a `ship_postcode`**. Every derivation this task named
resolves **zero rows** there. It was refused, correctly, and the refusal is the finding.

Two structural discoveries sit behind it, and both outlive the backfill:

1. **The id spaces cannot be joined.** `orders.ship_kelurahan_id` is an **integer** (a KiriminAja village
   id); `kelurahan.id` is a **text BPS/Kemendagri code** (`34.02.13.2004`). Village → district is not
   derivable locally at all. This is the same trap `AGENTS.md` already records for booking, in a second
   place.
2. **Two migrations were lost to number collisions.** `ship_kelurahan_id` / `ship_kelurahan_name` exist on
   the shared dev DB but **in no migration and not in `schema.ts`**; slots `0034` / `0049` now belong to
   another branch. `verify-migrations` is green because **the journal is self-consistent** — which is
   precisely why the loss was never flagged. ⚠️ **Consequence: `seed:recent` CANNOT RUN against
   production** — it selects a column production does not have — and it is green on dev only because of
   `push` drift.

⚠️ **The trap that was avoided, and it is the reason not to "just do it anyway":** the **62 dev postcodes
are fabricated by the seed** (`POST_OF[city]` + 3 random digits) and **59 do not exist in `kelurahan` at
all**. Backfilling from them would have written a confident wrong kecamatan **and silenced
`destinationGuessed` (`#117`)** — strictly worse than NULL. Rows stay NULL and stay flagged.

The derivation logic itself was validated on synthetic fixtures inside a rolled-back transaction: unique
pair → backfilled, 3-district postcode → left NULL, already-set → not overwritten, second run → 0 rows.
**The code works. There is nothing for it to work on.**

**Before this is reopened, all three must be true:** production actually carries `ship_postcode` or a
joinable village id; the schema drift in ①/② is resolved so `seed:recent` and the migration journal agree
with production; and the source of the postcodes is real shopper input, not the seed.
**AC (unchanged in shape):** `select count(*) from orders where ship_district_id is null` drops, every
backfilled row's district agrees with its kelurahan's parent, and `destinationGuessed` still fires for
every row that was not backfilled.

### N19. `seed:recent` inserts no `checkout_sessions` — the demo's Keranjang Ditinggal is now honest and empty · **M** · NEW
Un-anchoring `data/checkout.ts` (audit wave 2, ③) moved `WINDOW_START` as well as the ages, and Keranjang
Ditinggal went from **796/340 to 6/143** on dev. **Both halves are correct** — the old window was a frozen
`2026-06-02` start with **no upper bound**, 60 days on 1 Agustus and growing, labelled "30 hari".

The drop is a **data gap**: the seed's newest `ditinggal` row is `2026-07-15` and `seed:recent` refreshes
orders/flash/ledger but inserts **no `checkout_sessions` at all**.

🔴 **Do NOT re-anchor the app to make the demo look busy.** The fix is seeding.

**AC:** `seed:recent` inserts `checkout_sessions` — insert-only and idempotent, like the rest of that
script — and a second run does nothing. ⚠️ Fix N8's ② first or check it: `seed:recent` currently cannot
run against production at all.

### N20. `SectionRenderer` has no `default:` arm and no exhaustiveness assertion · **S** · NEW
14 `case` arms, no fallthrough. **A section type added to `SectionConfigMap` and forgotten compiles, and
renders nothing on a live storefront** — no error, no build failure, no migration to point at. Part of a
merchant's published page simply disappears.

⚠️ The fix is a `default:` arm and/or `const _exhaustive: never = item` — **not** removing branches.
Narrow the palette, never the renderer.

**AC:** adding a type to `SectionConfigMap` without a renderer arm fails `tsc`; an unknown type arriving
from an older saved template renders a visible dev-only warning rather than nothing.

### N21. The `admin` role is derived by SUBTRACTION, so new owner-only caps leak to it · **S** · NEW
`rbac-policy.ts:68-70` builds `admin` as `ALL_CAPABILITIES.filter(...)`. **A new owner-only capability
leaks to `admin` by default** unless someone remembers to add it to the filter. `staff` and `gudang` are
allow-lists and are immune by construction.

`apps/admin/lib/rbac-landing.test.ts` pins this for `landing:html` — the one capability that has already
been through it. Nothing pins the **class**.

**AC:** a test that enumerates the owner-only capabilities from one declared list and fails if `admin`
holds any of them — so adding the eleventh owner-only cap goes red, not silent.

---

## 🟢 STOREFRONT / SEO / HYGIENE — all small, all measured

### 🟡 N13. Sitemap `<lastmod>` — pages DONE, products + categories BLOCKED ON A MIGRATION · **M**, not S
🔴 **`products.updated_at` DOES NOT EXIST.** This entry claimed it does. `products` carries `created_at`
only, and `collections` has **no timestamp column at all** — `data/catalog.ts`'s own ordering comment
already said so ("not even `created_at` — checked"). So the only date the sitemap could emit for either
is one that never moves after insert, and Google's response to a `<lastmod>` it finds unreliable is to
distrust the field **for the whole document** — costing blog + pages the real signal they do have. The
sitemap now records that reasoning in the file itself.

**Done on `feat/next-queue`:** `/halaman/*` carries `<lastmod>` — `pages.updated_at` exists *and* is
genuinely maintained (`actions/pages.ts` sets it from one shared `fields()` used by create and update).
Verified over HTTP: 55 URLs, 21 `<lastmod>` = 15 blog + 6 halaman.

**What is left** is a schema decision, not a sitemap edit: add `updated_at` to `products` (and
`collections`) + every write path that must touch it. ⚠️ Idempotent migration, and
`git show origin/main:packages/db/drizzle/meta/_journal.json | tail` **before** generating one — and see
N8 ②, because the journal has already lost two entries to exactly this.
**AC:** editing a product moves its `<lastmod>`; a product nobody has touched keeps its old one.

### N22. `Header.astro` renders bare `<img>` on EVERY page · **S** · NEW
Left open deliberately by the change that fixed the PDP thumbnails, and the reasoning is worth adopting
as policy: it is a different file with separate `sizes` derivations, and *a check red for work nobody in
that change can land is a check everyone learns to ignore.*

So `check-pdp-srcset.mjs` **prints** them without failing — **10 catalog images with no `srcset`**, on
every page of the shop.

⚠️ Each `sizes` must be derived from **that component's own layout** and named as a constant. A wrong
`sizes` is worse than no `srcset` at all: the browser trusts it completely when picking a candidate. See
the PDP derivation in `produk/[handle].astro` for the shape — and the `max-w` trap it documents, which
was worth 17 468 B for one word.

**AC:** the check FAILS on a bare `<img>` in `Header.astro` instead of printing it; measured bytes before
and after, at DPR 1 and 2.

### N23. `data/articles.ts:57` sorts every draft above every published post · **S** · NEW
The surviving half of the NULLS-FIRST class that audit wave 2 fixed in the payment ordering:
`desc(publishedAt)` emits a bare `DESC`, which is **NULLS FIRST** in Postgres, and a draft has no
`published_at`. So the seller's Blog list buries their published work under every draft they have ever
started.

One line — `publishedAt desc nulls last` — and it is the same mistake, in the same shape, one screen over.

**AC:** a store with drafts and published posts lists the published ones first; a test that pins the
ordering, since this is the second time the class has shipped.

### N24. `/products/*.webp` declares `800w` for a 600 px file · **S** · NEW
`staticSrcSet` (`apps/storefront/src/data/catalog.ts`) appends the original as the top candidate —
deliberately, because the generated ladder stops below the source width and without it a wide screen
would be served the largest *generated* file. But for `/products/` it labels that original **`800w`**,
and the sources are **600 × 600** (verified on disk this session, e.g.
`public/products/blazer-wanita.webp`).

The srcset therefore **over-claims by 33 %**. A browser that trusts the descriptor will pick the original
believing it is 800 px wide — it is not a broken image (the file exists), it is a lie in the one field the
candidate algorithm has no way to check. The `/hero/` and `/sections/` branches label theirs `1920w`;
whether those are honest was **not checked** and should be, in the same pass.

**AC:** every descriptor in a generated `srcset` matches the file's real intrinsic width; a check that
reads the actual dimensions off disk rather than trusting the constant.

### N25. `color_palettes` is an orphan table, and the journal has lost two entries before · **S** · NEW
Two facts, one lesson: **`verify-migrations` checks the journal against itself and the files beside it,
so it is structurally blind to an entry that was removed, renumbered or never written.**

- **`color_palettes` exists in the shared dev container and in no `schema.ts` entry and no `.sql` file on
  this branch** — it arrived from an unmerged sibling branch. It is why the container reports **78** tables
  where `schema.ts` has **77**, and why `verify-rls` reads 51/52 rather than 50/51. ⚠️ **Count the
  codebase, not the container** — and the container also holds **92** rows in
  `drizzle.__drizzle_migrations` against this branch's **86** journal entries, for the same reason.
- **Replaying all 79 historical revisions of `_journal.json` yields 88 tags ever recorded against 86
  today.** The two that are gone: **`0046_good_dust`**, a journal entry whose `.sql` was never committed —
  it broke `migrate` outright, so **production never created the `kelurahan` table and
  `/api/public/ongkir` 500'd on every checkout**; and **`0064_store_public_email`**, renumbered to `0070`
  after a two-branch collision. Both are resolved. Both were invisible to the verifier.

**AC:** either `color_palettes` lands with a migration and a `schema.ts` entry, or it is dropped from the
shared container and the discrepancy stops being folded into every count anyone quotes. Separately, a
check that the journal's tag set is a superset of what any earlier revision recorded would have caught
both losses.

---

## ✅ Closed by audit wave 2 (2026-08-01) — do not redo

- **N9** the **sixth** default-location copy: `/api/public/order` had **no `store_id` at all**, on the
  OWNER connection with RLS off. All eight sites now route through `lib/inventory-location.ts`.
  ⚠️ And this entry's old framing was wrong twice over — see the handoff, ④.
- **N11 / N14** the homepage `<h1>` count, wrong in **both** directions plus a third case between them.
  See N14's entry below; closed and guarded on both sides.
- **N12** merchant uploads — **the claim was wrong and a real bug sat behind it.** Uploads *do* get width
  variants (`?w=` returns genuinely different bytes: 3 578 B @200 → 61 074 B full), the route sets
  `immutable` itself and goes `cf-cache-status: HIT`, and `app.`/`toko.` share anycast IPs, one wildcard
  cert and HTTP/3 so Chrome coalesces — Lighthouse offers **zero** preconnect savings. The real finding
  was the **PDP thumbnails** (−80,0 % at DPR 1). A read-only sweep of all 276 text/jsonb columns found
  `page_templates.sections` contains **zero** `/api/uploads` references, so **no store currently uses an
  uploaded hero** and the ladder gap was pre-emptive.
- **N5** in part — `Stars.astro`, 1023 → 915 elements. The rest of the entry stands, above.
- **N6** closed with its evidence (already `esnext`, zero `.js`, the bytes are Meta's).
- **N3** answered and recommended for retirement as a KPI · **N4** cause found (carousel autoplay).
- The ledger suites now run by default: **16 files / 145 passed + 22 skipped → 22 files / 182 passed**.
- Twelve frozen "today" anchors, one of them a write that walked article dates backwards.
- 🔴 `createStore` no longer hashes a published constant into every provisioned owner's password.

### 🔵 N14. `Hero` emitted one `<h1>` PER SLIDE — **CLOSED**, and it was three defects, not one · **S**
Shape chosen: **exactly one slide renders as `<h1>`, the rest are a `<p>` in the identical class list** —
the per-slide copy survives (which is half of what a carousel is for) and the cross-fade is untouched,
because nothing is unmounted and nothing in the script selects `h1` (it drives `[data-hero-copy]`).
Measured over HTTP against a real build and the real DB: the seeded 3-slide homepage went `h1 3` → `h1 1`.

⚠️ **A THIRD case turned up while closing it, and it was live at the same time.** The floor N11 shipped
keys on `s.type === "hero"`, but `heroSlides()` deliberately keeps a slide with an `imageUrl` and **no
heading** — a pictorial hero. On that template the floor stood down AND the hero rendered `<h1></h1>`:
measured `h1 2`, both empty. So the two halves now ask the **same** question, "is there a slide whose
heading is non-blank" (`heroSlides()` in `index.astro`, `HEADING_INDEX` in `Hero.astro`). ⚠️ **CONTRACT:
change one and they silently disagree** — zero `<h1>` on a pictorial hero, or two on an ordinary one,
with build, lint and `astro check` green either way. Guarded on both sides —
`sections/h1-floor.test.ts` pins that both halves still key on the heading text,
`scripts/check-h1-floor.mjs` stages a hero-less AND a heading-less template and counts the rendered
`<h1>`s. See the Store Builder section of `AGENTS.md`.

## ✅ Closed on `feat/next-queue` (`#127`)

- **N9** one helper (`lib/inventory-location.ts`) + the tenant filter four copies never had — **finished**
  by audit wave 2, which found the fifth file it had missed.
- **N10** `deleteLanding` returns `{ ok, error }`; the editor reads it. The rest of N10 was already done.
- **N11** homepage `<h1>` floor, driven over HTTP against a real build — **and see N14 for the case its
  predicate could not see.**
- **N13** `/halaman/*` `<lastmod>`; products/categories blocked on a migration, reasoning written into
  the sitemap itself.
- **N3** measured: desktop **median 100, range 90–100** over 5 runs — superseded by the 15-run set above.
- **N6** re-diagnosed — the premise was wrong.
- New at the time: **N14**.

## ✅ Closed the session before — do not redo

- `destinationGuessed` now exists and is surfaced on both the single-order and bulk paths (`#117`).
- `markLabelsPrinted` reports rows actually written (`#117`) — ⚠️ **its CALLER was still lying** and was
  fixed by audit wave 2. Fixing an action is not fixing the screen that reads it.
- `createOrderPayment` refuses terminal orders and second live bills (`#117`, merged with the stronger
  duplicate-bill guard from `#116`).
- 🔴 ~~One definition of "the order's payment", shared by the list and the detail (`#117`).~~
  **THIS WAS NOT CLOSED.** Both files carried comments asserting they matched while `desc()` emitted
  NULLS FIRST on one side and `nulls last` on the other. Genuinely closed by audit wave 2, via one
  exported `latestPaymentFirst()` and a real-Postgres test. **Left struck through on purpose** — a
  false entry in a "do not redo" list is worse than no entry.
- Flash "Terjadwal" badge derived on the server, not the merchant's laptop clock (`#117`).
- LIKE wildcards escaped — as a **class**, via `@tokophi/lib/like`, across all three sites (`#117`).
- Homepage JSON-LD (Organization + WebSite), `SearchAction` → `/cari?q=` **verified against the real
  route** (`#119`).
- `getShippingRates` gated on `orders:write` (`#118`).
- 🔴 Inventory restore scoped to the tenant explicitly — it runs on the OWNER connection where the
  `locations` join proved nothing (`#118`).
- Four routes no longer 500 on a malformed id, via one shared `isUuid` (`#118`).
- Inter self-hosted; Google Fonts was render-blocking **1 409 ms** across three layouts (`#119`).
- Real image width variants + `srcset` on the hero and five section components (`#119`, `#120`).
- `/promo` in the sitemap (`#119`).
- Marketing pixels load on first interaction (`#122`) — **owner decision, with its cost recorded**:
  bounce PageViews under 10 s are gone; revenue attribution is unaffected (ADR 0012).
- Canonical self-canonicalises `?page` (`#118`).

## 🧪 Runnable checks this work left behind

Each guards a failure that is **silent** under `tsc`, lint and `astro check`:

```bash
npx astro build --root apps/storefront
DATABASE_URL=… PORT=4373 node apps/storefront/dist/server/entry.mjs &

node apps/storefront/scripts/check-pixel-defer.mjs   # tracking survives the deferral
node apps/storefront/scripts/check-hero-srcset.mjs   # srcset actually promoted (port 4374)
node apps/storefront/scripts/check-h1-floor.mjs      # exactly one <h1>, all three template shapes
node apps/storefront/scripts/check-pdp-srcset.mjs    # no image resolves over 3x the pixels it fills
node apps/storefront/scripts/gen-image-widths.mjs    # regenerate renditions (idempotent)

npm test                                             # ledger suites now run by default
npm run test:db                                      # same, but an unreachable test DB FAILS instead of skipping
npx vitest run apps/storefront/src/components/sections/h1-floor.test.ts
```

- **Both `<h1>` alarms are kept on purpose and they are not redundant.** `h1-floor.test.ts` pins the
  **premise** — that `Hero` is still the only section emitting an `<h1>`, and that the floor and the hero
  still key on the same heading text — with no DB and no browser, which is the only way to see it.
  `check-h1-floor.mjs` pins the **rendered count** against templates that live in the **database**, which
  no unit test can reach.
- ⚠️ **`check-h1-floor.mjs` writes to the shared dev DB.** It stages a `page_templates` row for a store
  that has none. It now uses a random id per run **plus a Postgres session advisory lock on a reserved
  connection** — a session lock is released when the connection dies, and a `finally` block is not. Still:
  while it runs, a real store has a homepage it never built.
- ⚠️ **`check-pixel-defer.mjs` cannot pass on the seeded data, and that is TENANT DATA, not code.**
  `store_tracking_channels` holds exactly one row (`batik-nusantara | meta | t`), so its
  `hosts.length === 3` can never hold. Everything the one seeded channel *can* prove passes. Either
  configure all three channels on the tenant you point it at, or make it assert only the channels the
  tenant has enabled — **an alarm that is always red is an alarm that is off**, and this repo has already
  paid for that lesson with two cross-tenant leaks that shipped past a red `verify-rls`.
- ⚠️ **`check-pdp-srcset.mjs` PRINTS `Header.astro`'s 10 bare catalog images without failing** (N22).
  That is deliberate, and it should stop being true once N22 lands.

## 🔬 Two gates that only fire if you run them

Demonstrated three separate times during audit wave 2, and it is the most reusable thing that session
produced:

- **`next build` does not run ESLint.** ESLint was the only gate that caught a backtick inside a JS
  template literal that had silently terminated a SQL string.
- **ESLint and `next build` do not typecheck test files.** `tsc --noEmit` was the only gate that caught a
  non-overlapping type assertion in a newly added test.
- **All of them are green on live outages** — this repo's own history: a `ReferenceError` inside a client
  `<script>` that blocked the entire rate load, and `select sum(…) for update` inside a SQL string that
  Postgres rejects outright.

Run all three plus the browser checks before any PR. **Nothing runs ESLint automatically**, which is how
it rotted to 19 errors / 23 warnings in `apps/admin` (pre-existing, itemised in `BACKLOG.md`).
