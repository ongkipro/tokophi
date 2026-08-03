# NEXT — what to pick up, in order

> Standing follow-up list. **Newest state as of 2026-08-01**, after `#117`–`#125` (merged and deployed)
> and **audit wave 2** (this branch, seven change sets — handoff
> [`2026-08-01-audit-wave-2.md`](./2026-08-01-audit-wave-2.md), consolidated record
> `../audit-2026-08-01/FINDINGS-SOURCE.md`, which is the **authority on every number below**).
>
> Pairs with `BACKLOG.md` (priorities), `WORKLOG.md` (session log) and the dated handoffs in this
> folder. **Legend:** size **S** (<1h) / **M** (half a day) / **L** (a day+). AC = acceptance criteria.
>
> 🔴 **THIS FILE WAS STALE ON FOUR ENTRIES, AND STALE IN THE EXPENSIVE DIRECTION** (found 2026-08-03).
> **N19 · N20 · N21 · N23 were all done in `52ef1de` (audit wave 3, `#133`) and all four were still
> marked open**, three of them tagged `NEW`. A session that trusts the queue creates a worktree and
> starts rewriting finished work — that nearly happened on N19. All four are closed below **with the
> evidence of having been RUN**, not merely read. ⚠️ **Close the entry in the same commit as the
> code.** The queue is what four different docs point sessions at; stale here costs a whole session.
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

### ✅ N15. Both login pages published working control-plane credentials — **CLOSED 2026-08-03**
Owner's decision: **delete the hint** (not rotate the seed). No seed change, no data fix.

🔴 **Verified live on production before the fix, both pages:**
`rich.tokophi.com/login` served `admin@tokophi.id` + `tokophi123`; `app.tokophi.com/login` served
`ongki@batiknusantara.id` + `tokophi123`. Not placeholders — the seed creates those rows on deploy.

⚠️ **It was FOUR sites, not two.** Besides the two `Dev: …` lines, **both email inputs carried a
`defaultValue` naming the account**. Removing only the password line would have left the page still
publishing *which account to attack* — and per `AGENTS.md` the login limiter is keyed on **IP, not on
account**, and **no failed login is written to any table**, so nothing anywhere would record that one
specific operator was being tried. All four removed; the `placeholder` shows the shape without naming
anyone.

**Guarded by `packages/lib/src/no-published-credentials.test.ts`** — a source scan over **every** app
file, not a list of two (a list of two is how the 24-bit mint survived its own guard in `#137`).
Proven red first: **4 of its 5 tests fail** against `origin/main`.
⚠️ It **strips `//` and `/* */` comments before matching**, deliberately — `super-admin/lib/actions.ts`
legitimately *names* `tokophi123` while explaining the fix, and a guard that forbids describing the bug
it guards gets deleted the first time someone needs that sentence. **HTML comments are NOT stripped**:
`<!-- … -->` in an `.astro` file is served to the browser.

**Not done, and deliberately:** the seeded password itself is unchanged, so `tokophi123` still
authenticates for anyone who already knows it. That was the owner's call — rotating it touches the seed,
and **the seed is not a migration**, so existing deployments would need a manual data fix. Filed below.

### N29. The seeded password still authenticates · **S** · NEW · owner's call
`tokophi123` is no longer *published*, but it is still the seeded credential on every deployment that
already exists. Rotating it means minting per-deploy (`@tokophi/lib/password` already exists, 60-bit)
**plus a data fix for live deployments stated in the commit body**, because nothing else will apply it.
**AC:** a fresh deploy's seeded accounts have a random password; the fix for existing ones is written
down where an operator will find it.

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

### ✅ N17. The abandoned-cart recovery link — **CLOSED 2026-08-03**, and the cause is the lesson
Handoff: [`2026-08-03-n17-recovery-link.md`](./2026-08-03-n17-recovery-link.md). Branch
`feat/cart-recovery-link`.

**Why it was never minted is worth more than the fix.** `signRecoveryToken` sat in
`apps/storefront/src/lib/recovery.ts` — a path **the admin cannot import** — and the admin is the only
surface that lists abandoned carts. So the mint had zero callers for the life of the feature while the
verify half was live, correct and store-bound. Nothing failed: the checkout just never restored, and
four docs recorded it as working. **A module in the wrong app is a feature that cannot exist.**

Shipped: the pair in `@tokophi/lib/recovery` (+ `jose` declared, not hoisting-by-luck) · a re-export so
the storefront path is unchanged · `getStorefrontHost()` (active primary domain, else `<slug>.<base>` —
must agree with the storefront's `primaryOrigin()`) · mint per phone-carrying cart on `sessionId` ·
`cartMessage` **appends** when the body has no `{{link}}`.

⚠️ **Two traps found while doing it, both recorded in `BACKLOG.md`:**
- `{{link}}` was deliberately **kept out of the seed**. The same `keranjang` body is rendered by three
  CRM screens that work from `followups` rows and cannot mint a link, and `fillTemplate` passes an
  unknown token through verbatim — seeding it would have sent the literal `{{link}}` to a customer.
- `CHECKOUT_RECOVERY_SECRET` must be set on **both** surfaces or every link fails to verify, silently.

**AC met:** admin login → real `wa.me` body → that exact link → banner, cart and typed fields restored,
in a browser. Foreign-store / tampered / junk tokens all refused.

### 🔵 N18a. `tempPassword()` was 24 bits — ✅ **DONE 2026-08-03**
The two implementations are **one shared helper**, `@tokophi/lib/password`, at **60 bits** (12 symbols ×
log2(32); the `tokophi-` prefix is 0 bits). `apps/super-admin/lib/temp-password.ts` is deleted and
`apps/admin/lib/actions/users.ts` no longer keeps a private `randomBytes(4)`.
`packages/lib/src/password.test.ts` measures the **min-entropy the generator actually emits** and fails
below **48 bits** — it went red at 23,7 bits against the old mint before it went green — and it fails if
any file grows a private mint again.

> ⚠️ **CORRECTION (2026-08-03, second pass).** `apps/super-admin/lib/temp-password.ts` was **NOT**
> deleted by that commit — the deletion was staged in the source worktree and lost in integration, so
> the 24-bit mint shipped to `main`, still `export`ed, its docblock still claiming to be *the* mint.
> Dead code (no importer), not a live login, but the next person to grep would have found it and
> believed it. Deleted now.
> **The guard could not see it**: that test iterated a hardcoded two-file list, so a private mint in
> any THIRD file was invisible to the test written to stop exactly that. It **scans every source file
> in the repo** now — declaration, hand-rolled `randomBytes` credential, or a call that does not import
> the shared module — and it was proved red against the surviving file *before* that file was deleted.
> `hashPassword` is now genuinely unified too (it was claimed, not done: five byte-identical copies —
> `apps/admin/lib/auth.ts` re-exports the shared one, `actions/security.ts` and `packages/db/src/seed.ts`
> import it), and the same scan pins it at one implementation.

### 🔴 N18b. The login door — the premise of this entry was WRONG, and it is a DECISION · **decision, not work**

> ⚠️ **"no login rate-limit was found" was false when it was written.** One exists on **both** panels
> and has since **2026-07-16** (`53dd9ee`): `apps/admin/lib/actions/auth.ts:17` `login:admin:<ip>` 15/min
> and `apps/super-admin/lib/actions/auth.ts:16` `login:platform:<ip>` 10/min, both **before** the scrypt
> check. `specs/docs/STATUS.md` row 20 said so the whole time. **Nothing was missing; something was
> unread.** The AC below ("a test that a burst of failed logins for one email is refused") would have
> been written against a limiter that does not key on email at all.

What is **actually** absent, verified at HEAD:

1. **The counter is per PROCESS** — `packages/lib/src/cache.ts:39`, a module-scope `Map`. It resets on
   every redeploy and does not span replicas. Today that is survivable *by accident*: `docker-compose.coolify.yml`
   runs exactly **one container per surface** with no `replicas` key, so the map is currently global per
   panel. It stops being true the first time anything is scaled, silently.
2. **It counts IPs, never accounts.** One named merchant can be attacked at 15/min **per source
   address**; a botnet is not slowed at all. The 60-bit mint is what makes that arithmetic safe
   (2⁵⁹ expected guesses ÷ 15/min ≈ 10¹² years per IP), which is why N18a was the half worth building.
3. **A failed login is recorded NOWHERE** — no table, no `platform_activity` row, no log line. Nobody
   can answer "is my merchant being attacked?", and no limiter can be tuned against data we do not keep.
4. **Adjacent doors are unthrottled entirely**: `registerStore`, the Google OAuth callback, and — the
   sharp one — `apps/admin/app/impersonate/route.ts`, an unauthenticated GET that exchanges a token for
   a **7-day** session. **This is why N18b cannot be decided before N1**: any scheme that wraps only
   `signIn` leaves the widest door untouched.
5. TOTP shares the *same* `login:admin:<ip>` bucket as the password — no tighter second-factor counter,
   and `verifyTotp` accepts a ±1 step (90 s) window.

**The options, with what each one breaks** (sized 2026-08-03; **not implemented — owner's call**):

| | Option | Cost | What it breaks / risks |
|---|---|---|---|
| **A** | **Do nothing more.** Keep IP-only, in-process. | 0 | Accepts (1)–(4). Defensible *only* while the mint stays ≥ 48 bits and there is one replica. **Then the honest fix is one line in `DEPLOY.md`: never scale a panel without doing B or C first.** |
| **B** | **Per-account counter in Postgres** (`login_attempts`, or a column on `users`). | S–M: one migration, one write on failure, one read before the check. | ⚠️ **A lockout is a DoS an attacker can aim at a named merchant** — knowing an email is enough to keep the shop's owner out during a sale. Mitigate by throttling (a delay) rather than locking, and never confirm to the caller *why* a login failed. Adds a DB write to an unauthenticated path — itself an amplification target, so it needs the IP gate to stay in front of it. Also the only option that makes attacks **visible**, which is arguably worth more than the throttling. |
| **C** | **Cloudflare Rate Limiting rule** at the edge on the two login paths. | S — zone config, no code. | ⚠️ **Cannot be done from this repo today**: the Cloudflare token has **no ruleset permission** (`docker-compose.coolify.yml:185`) and wrangler auth is expired (N2). Counts requests, not failures, so it must be loose enough not to bite a legitimate retry. Survives redeploys and replicas — the only option that fixes (1) properly. Does nothing for (3). |

**Recommendation (D5, the owner's):** **A now + the `DEPLOY.md` line**, then **C** when N2 unblocks the
Cloudflare token, and **B only for its logging value** — decided *after* N1, because the impersonation
door is the one that actually needs closing and B does not touch it.

**AC:** a decision recorded in `specs/decisions/`. **Not** a limiter built on the strength of this entry —
the last AC here was written against a limiter that did not exist, and it would have shipped a second one.

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

### 🔵 N5. `dom-size` — MEASURED TO THE END. **It is a DECISION now, not work** · 2026-08-03
Production homepage, Chrome at **390 px / DPR 2**, every number from a loaded page.

🔴 **This entry's own hypothesis was wrong.** It said *"the next largest repeats are the header and
footer lucide icons. Measure them before assuming."* Measured: **header 21 + footer 67 = 88 of 912
elements**, only 39 of them SVG. They are not the lever.

**Where the 912 actually are:**

| region | elements | of which SVG |
|---|---|---|
| section «Produk Terbaru» | **220** | 96 |
| section «Paling Dicari» | **107** | 48 |
| hero | 106 | 38 |
| footer | 67 | 30 |
| `nav.hidden … xl:flex` (desktop mega-menu) | **60** | 8 |
| header | 21 | 9 |

**The star rating is STILL the single biggest repeated structure** — wave 3 took it 312 → 204, and
**204 of the 335 product-card elements (61%), i.e. 22% of the whole page, are still it**. 12 widgets ×
17. ⚠️ **It is at its floor:** `Stars.astro`'s own comment refuses the one-`<svg>` version, and the
reason is good — the fill is CSS (`fill-current` + `text-brand-500`) so the rating tracks the
MERCHANT'S brand colour; a gradient would need literal colours and per-instance ids. Do not re-derive
that.

**🆕 101 elements (11%) are `display:none` at 390 px** — shipped to every phone, counted by `dom-size`,
never rendered. The biggest is the **desktop mega-menu at 60 elements**.
✅ **And its 11 links are ALL reachable elsewhere on the page** (checked: `ONLY_in_desktop_nav` = []),
so deferring it costs the crawler **no unique URL** — the SEO objection that would normally kill this
does not apply here.

**The three options, costed. Lighthouse p10 is 800; today is 912.**

| option | Δ | page total | passes p10? | what it costs |
|---|---|---|---|---|
| do nothing | — | 912 | no | — |
| render the desktop nav client-side ≥1280 px | −60 | 852 | no | a no-JS desktop reader loses the top nav (all 11 links survive elsewhere) |
| drop the rating from product CARDS (keep it on the PDP) | −204 | 708 | **yes** | a merchandising decision — ratings sell |
| both | −264 | 648 | **yes** | both of the above |

**Only the last two pass, and both are PRODUCT decisions, not engineering ones.** That is why this is
now a decision: there is no remaining change that is purely technical. **AC unchanged if someone acts
on it** — ≥5 mobile runs, median and range, element count before and after.

⚠️ **`SectionRenderer` must keep switching on every type** — narrowing the palette must never delete a
merchant's published work (`AGENTS.md`, Store Builder).

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

### ✅ N19. `seed:recent` inserts no `checkout_sessions` — **DONE in `#133`, VALIDATED 2026-08-03**
⚠️ **This entry was still marked open while the code was already on `main`.** `seedCheckoutSessions`
landed in `52ef1de` (audit wave 3) — the same commit that closed N20/N21/N23 — and NEXT.md was not
updated for any of the four. A session picking this up creates a worktree and starts writing a
function that already exists; that nearly happened here.

**Validated by RUNNING it, not by reading it** (dev DB, 2026-08-03):

| claim | result |
|---|---|
| inserts carts | **900** added, filling 29 empty days |
| **idempotent** — a second run does nothing | second run: *"tidak ada hari kosong"*, **0 inserted** |
| both kinds of `pulih` exist (the metric trap) | **rescued 89** (`abandoned_at` + `recovered_at`) vs **straight-through 86** (`abandoned_at` NULL) |
| `recovered_order_id` points at real orders | 175 recovered rows, **0 dangling** |
| the "Anonim" tab is not a lie | 724 `ditinggal` in-window, **398 with a phone** |

Keranjang Ditinggal now has real volume, so **N17's recovery link is visible on the demo** — the two
halves only became demonstrable together.

### ✅ N20. `SectionRenderer` exhaustiveness — **DONE in `#133`, VALIDATED 2026-08-03**
The `default:` arm with `const _exhaustive: never = item` is on `main`, plus
`section-renderer-exhaustive.test.ts` — which matters because **`astro check` is the only thing that
compiles that file and nothing runs it** (the storefront build is transpile-only).

**Validated by breaking it on purpose:** adding a fake `'audit-fake-section'` to `SectionConfigMap`
with no renderer arm produced exactly the AC's failure —
`Type '{ type: "audit-fake-section"; … }' is not assignable to type 'never'` at
`SectionRenderer.astro:119`. Reverted after.

### ✅ N21. `admin` derived by SUBTRACTION — **DONE in `#133`, VALIDATED 2026-08-03**
`rbac-census.test.ts` holds a `Record<Capability, "owner-only" | "admin-too">`, so a new capability
fails `tsc` (missing key) *and* `vitest` until someone classifies it. The census was chosen over an
allow-list deliberately — an allow-list swaps a silent GRANT for a silent REMOVAL, which is worse to
diagnose because `useCan` just hides the control.

**Validated by breaking it on purpose:** adding an `audit:danger` capability the careless way (to
`ALL_CAPABILITIES` only, so it lands in `admin` by subtraction) turned the census **red**, 2 of 4
tests failing on `expect(actual).toEqual(declared)`. Reverted after.

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

### ✅ N22. `Header.astro` renders bare `<img>` on EVERY page — CLOSED
Three sites, three `sizes` derivations, each from its own box and named as a constant in the file:

| site | derivation | `sizes` |
|---|---|---|
| mega-menu category thumb | `h-11 w-11 shrink-0`, no responsive variant | `44px` |
| mega-menu featured tile | panel `inset-x-6` inside `max-w-7xl` → −48; panel border + grid `p-5` → −42; `[1.7fr_1fr]` with `gap-6` → ×1/2.7; the `<a>`'s border + `p-3` → −26. The container is pinned at 1280 for every viewport the nav exists at (`xl:flex`), so it is a CONSTANT | `406px` |
| mobile drawer two-up | drawer `w-full max-w-[26rem]`, inner `px-4`, `grid-cols-2 gap-3` → `(min(100vw,416) − 44)/2` | `(min-width: 416px) 186px, calc((100vw - 44px) / 2)` |

All three measured against the built server, not read off the classes: 44 / 406 / 184 px.

**Measured, `/` cold load, unique catalog bytes over real HTTP** (the whole-page number, so it already
nets off files the product cards were fetching anyway):

| | before | after | delta |
|---|---|---|---|
| desktop 1440 DPR 1 | 133 612 B | 59 122 B | **−74 490 B (−55,8 %)** |
| desktop 1440 DPR 2 | 212 486 B | 171 982 B | **−40 504 B (−19,1 %)** |
| mobile 412 DPR 1 | 62 704 B | 45 108 B | **−17 596 B (−28,1 %)** |
| mobile 412 DPR 2 | 152 894 B | 142 152 B | **−10 742 B (−7,0 %)** |

Per element (probe-isolated, so no candidate can be satisfied out of another element's response): the
five mega-menu thumbnails went **74 490 B → 8 992 B** at both DPRs (44 px box ⇒ the 200w rung wins even
at DPR 2), and the drawer's two tiles **17 596 B → 2 470 B** at DPR 1 / **6 210 B** at DPR 2.

⚠️ **The featured tile was NOT worth it, and the number is 0 B.** At 406 px it needs 406 device px at
DPR 1 and 812 at DPR 2; the ladder for a seeded product is 200 / 400 / 600 (the source), so the browser
picks the original either way — byte-identical to the bare `<img>` it replaced. It still carries the
srcset, because on a merchant's own uploads the same markup ladders to 2000w and that tile would be
handed a 2000 px original for a 406 px box. Reported rather than assumed: `?w=` renditions could not be
measured here (the admin origin that serves them is not running in this harness).

Only ONE of the two desktop/mobile sites is ever on screen: the nav is `xl:flex` and the drawer sits
inside an `xl:hidden`, so at any viewport one of them is `display:none` — which is why the check that
guards this had to become structural rather than ratio-based (see "Runnable checks" below).

### ✅ N23. Drafts sorted above published posts — **DONE in `#133`; the STOREFRONT half closed 2026-08-03**
⚠️ **The path in this entry never existed** (`data/articles.ts:57`). The real admin fix is
`publishedFirst()` — `published_at desc nulls last, title asc` — and it works: measured against the
dev DB, a bare `desc` puts the one seeded draft above all 15 published articles; `nulls last` puts
"Kenapa Batik Tulis Lebih Mahal" back on top.

🔴 **But the class was only half closed, and the reason is N17's exactly.** The rule lived in
`apps/admin/lib/data/article-order.ts` — **which the storefront cannot import** — so
`apps/storefront/src/data/content.ts` kept its own bare `desc(publishedAt)`. A rule in the wrong
package is a rule only one surface can obey.

Moved to **`packages/db/src/article-order.ts`** (`@tokophi/db/article-order`), which both apps already
depend on; both now call `publishedFirst()`. It imports `./schema` directly, never the barrel, so it
does not drag in `client.ts` and stays testable without a `DATABASE_URL`.

⚠️ **On the storefront query `nulls last` changes nothing today** — it filters `status='terbit'`, and
`publishedAtFor()` guarantees a published row has a date. Say that plainly rather than claiming a bug
that is not there. What it DOES change today is **determinism**: `title asc` settles two posts
published in the same second, which a bare `desc` leaves to the query plan. Driven on a real build:
`/blog` lists published-first, draft absent.

### ✅ N24. `/products/*.webp` declares `800w` for a 600 px file — CLOSED
**The full audit, every source read with sharp, not sampled** (75 files):

| dir | files | real widths | was declared | verdict |
|---|---|---|---|---|
| `/hero/` | 3 | all **1920 × 1080** | `1920w` | ✅ honest |
| `/sections/` | 2 | `denim-standard` **1200 × 960**, `lookbook` **2000 × 784** | `1920w` | ❌ **both wrong** — one over-claims 60 %, the other under-claims |
| `/products/` | 70 | **56 are 800 × 800**, **14 are 600 × 600** | `800w` | ❌ over-claims 33 % on 14 |

⚠️ **The 14 are not random: they are exactly the `<handle>.webp` of every product** — the FIRST image,
the one on every card, every mega-menu thumbnail and every PDP. The `-2…-5` extras are all 800. So the
lie was on the most-rendered image in the catalogue.

All **150 generated renditions** were verified honest — every `-<N>w.webp` really is N px.

**The fix is the descriptor, not a new rendition.** Generating an `800w` from a 600 px source is an
upscale: bytes for nothing, and the generator refuses to (`if (w >= meta.width) continue`). The
declaration was the thing that was false. `gen-image-widths.mjs` now writes
`src/data/static-image-widths.ts` — every source's **real intrinsic width** plus the renditions that
**actually exist beside it** — and `staticSrcSet` reads only that. `STATIC_WIDTHS` is deleted. That also
retires the "the two ladders must stay identical" rule by making it structural: the ladder *is* the list
of files that were generated, so a rung with no file on disk can no longer be listed.

**Byte impact today: 0** — this is honesty, not a saving. The 600 px file was already the top candidate
and stays the top candidate; the PDP main photo simply stops claiming to be 800 px for a 380 px box
(`check-pdp-srcset` reported it at `800px 1.05x` and now reports `600px 0.79x` — the same file, and the
*real* ratio is the second one). What it buys is that the next `sizes` decision is made against a true
number: at 406 px the featured tile would have climbed to a "800w" candidate that is 600 px wide.

Guarded by **`apps/storefront/scripts/check-image-widths.mjs`** — sharp against disk, four claims (the
source's declared width IS its real width; every listed rung exists; every rung's real width matches its
filename; no source on disk is missing from the manifest). No browser and no server, so it cannot flake.

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

## 🟢 SURFACE SWEEP (2026-08-03) — every route driven in a browser

Full method + scoreboard: [`2026-08-03-surface-sweep.md`](./2026-08-03-surface-sweep.md).
**admin 40/40 and storefront 14/14 now clean**; four defects found, all four fixed. Routing is clean on
all three surfaces: **0 dead nav links, 0 unreachable pages** — each of the nine non-sidebar routes was
verified to be linked from somewhere, not assumed.

### ✅ N26. `/checkout` had no `<h1>` — the only money-path page without one · **CLOSED + GUARDED**
Its highest heading was `<h2>Ringkasan Pesanan`. Third instance of the N11/N14 class. Fixed with an
`sr-only` `<h1>` **in the page, not the layout** — `checkout/sukses.astro` already renders a visible
one, so a layout-level floor would have given that page **two**: the N14 defect, reintroduced by the fix
for N11's. ⚠️ Not visible on purpose — the visible title was removed 2026-07-16 deliberately.

⚠️ **The fix originally shipped with NO guard, and `check-h1-floor` did not cover it** — that script is
about the merchant-built HOMEPAGE and stages a `page_templates` row. It now also sweeps **10 static
routes**, `/checkout` and `/checkout/sukses` among them, and both are load-bearing: one asserts the
floor exists, the other asserts the fix did not overshoot into a second `<h1>`. Proven red by deleting
the `<h1>` and re-running: `FAIL /checkout has exactly 1 <h1> — h1 0`.

### ✅ N27. `/halaman/baru` had no `<h1>`; `/navigasi` + `/pemasaran` skipped h1→h3 · **CLOSED**
`PageEditor` gated its heading on `{isEdit && …}`, so only the CREATE screen lacked one — while
`topBarTitle` already computed `"Tambah halaman"` for that exact case, i.e. the guard hid a string it
had built. `article-editor.tsx` next door renders its own unconditionally; the two had diverged. The two
skips were `<h3>` on pages with no `<h2>`; tag changed, `className` untouched.

### N28. super-admin's 7 screens have never been crawled · **S** · NEW · BLOCKED ON THE OWNER
Routing and gating ARE verified — all 7 routes 307 to login unauthenticated. The screens themselves were
not driven: it needs a platform credential, and since `#133` the operator password is randomly minted
and revealed once, so obtaining one means **resetting a control-plane password on the shared DB**. Not a
decision to take unilaterally.
**AC:** the same sweep against `rich.` — status, `<h1>`, heading skips, console errors per screen.

### 🔵 Not defects — checked, so nobody re-chases them
- **`/api/uploads/*` 404s on 6 admin pages are LOCAL ONLY.** `public/uploads/` is gitignored; production
  mounts a named volume (`tokophi-uploads`) and serves all of them (6/6 → 200), so merchant media
  survives a deploy. ⚠️ A **dev-DB filename tested against the production server proves nothing** — that
  misread briefly looked like a broken store logo in production.
- **`ERR_CONNECTION_REFUSED` on storefront pages** is the admin origin not running in an isolated scan.
- **No horizontal overflow at 390 px** on any storefront route. The one hit was `/sitemap.xml` — XML in
  a browser, a false positive of the check.

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
npm run verify -w @tokophi/storefront     # ← ALL FIVE. builds if stale, starts ONE server, table + exit code
npm run verify -w @tokophi/storefront -- --no-build

node apps/storefront/scripts/gen-image-widths.mjs    # regenerate renditions + the width manifest

npm test                                             # ledger suites now run by default
npm run test:db                                      # same, but an unreachable test DB FAILS instead of skipping
npx vitest run apps/storefront/src/components/sections/h1-floor.test.ts
```

| the suite runs | what it proves |
|---|---|
| `check-image-widths` | every `w` descriptor IS the file's real width (no server, no browser — disk vs disk) |
| `check-hero-srcset` | the hero's `data-srcset` is actually promoted onto the IMG |
| `check-pdp-srcset` | no image resolves over 3× the pixels it fills, and no catalog `<img>` is bare (logo excepted) |
| `check-pixel-defer` | tracking survives the deferral, for every channel **this tenant** enabled |
| `check-h1-floor` | exactly one `<h1>` — all three template shapes **and the 10 static routes**, incl. `/checkout` (had none) and `/checkout/sukses` (must not gain a second) |

**Vitest guards worth knowing by name** (all run under `npm test` / `npm run test:db`):

| guard | what it proves |
|---|---|
| `packages/lib/src/no-published-credentials.test.ts` | no shipped screen names an account that authenticates — scans EVERY app file, strips `//` + `/* */` but **not** HTML comments |
| `packages/lib/src/password.test.ts` | the temp-password mint's measured min-entropy ≥ 48 bits, one implementation |
| `packages/lib/src/recovery.test.ts` | the recovery token round-trips, is store-bound, and never throws on junk |
| `apps/admin/lib/recovery-wired.test.ts` | **the mint has a caller** — the failure no unit test can see |
| `apps/admin/lib/cart-message.test.ts` | the link is appended when the template has no `{{link}}`; a literal `{{link}}` can never reach a customer |
| `apps/admin/lib/inventory-location.test.ts` | the default-location expression exists in exactly one place |
| `apps/admin/lib/rbac-census.test.ts` | every capability is classified owner-only / admin-too |
| `packages/db/src/article-order.test.ts` | the blog order is `published_at desc nulls last, title asc`, shared by both surfaces |

⚠️ **One invocation contract, and the old names now FAIL rather than being ignored.** To run a single
check by hand: `CHECK_BASE_URL=http://toko-demo.test:4390 node apps/storefront/scripts/<name>.mjs`
(plus `DATABASE_URL` for `check-h1-floor` and `check-pixel-defer`; it is read from the repo-root or
main-checkout `.env` if unset). `T_URL`, `H1_PORT` and `DPR` are retired — `scripts/check-env.mjs`
exits 1 if it sees one, because silently running the default while the caller believes they aimed
somewhere else is exactly how three phantom regressions got reported on 2026-08-02.

- **Both `<h1>` alarms are kept on purpose and they are not redundant.** `h1-floor.test.ts` pins the
  **premise** — that `Hero` is still the only section emitting an `<h1>`, and that the floor and the hero
  still key on the same heading text — with no DB and no browser, which is the only way to see it.
  `check-h1-floor.mjs` pins the **rendered count** against templates that live in the **database**, which
  no unit test can reach.
- ⚠️ **`check-h1-floor.mjs` writes to the shared dev DB.** It stages a `page_templates` row for a store
  that has none. It now uses a random id per run **plus a Postgres session advisory lock on a reserved
  connection** — a session lock is released when the connection dies, and a `finally` block is not. Still:
  while it runs, a real store has a homepage it never built.
- ✅ **`check-pixel-defer.mjs` no longer hard-codes three vendors** (2026-08-03). It read
  `hosts.length === 3` while `store_tracking_channels` holds exactly one row
  (`batik-nusantara | meta | t`), so it was red on clean `main`, for every change set, forever — **an
  alarm that is always red is an alarm that is off**, and this repo has already paid for that lesson
  with two cross-tenant leaks that shipped past a red `verify-rls`. It now reads the enabled channels
  for the tenant the host resolves to and asserts the claim that was always meant: each one is stubbed
  synchronously, buffers an event fired before its SDK exists, and loads on interaction — plus the
  reverse, that nothing loads for a channel that is switched off. A tenant with **no** channels exits
  `2` = **SKIP**, which the runner prints with its reason and never counts as a pass.
  - ⚠️ In the same pass: its "no vendor `<script src>` in the served HTML" claim had been measured with
    `fetch(…, {headers:{host}})`, and **undici silently drops a `host` header** — so it was counting
    scripts on the 404 "Toko tidak ditemukan" page, where there are none, for its whole life. Use
    `getAsTenant()` (node:http). `check-h1-floor` already did, and said why; the others did not.
- ✅ **`check-pdp-srcset.mjs` now FAILS on a bare catalog `<img>` instead of printing it** (N22 landed).
  The claim is STRUCTURAL, not ratio-based, on purpose: the ratio test can only judge an element the
  browser actually painted, and the mega menu (`xl:flex`) and the drawer (inside an `xl:hidden`) are
  never both on screen — one of them is always `display:none` at any given viewport while still costing
  the other half of the audience its bytes. An `<img>` with no srcset cannot be right at any width, so
  it does not need to be measured to be judged. **The store logo is the one exemption**, marked
  `data-logo` in `Header.astro` and `Footer.astro`: a merchant upload of unknown aspect ratio rendered
  `h-9 w-auto` has a CSS width that follows the file's own proportions, so a `sizes` for it would be a
  guess — and a wrong `sizes` is worse than no srcset at all. Giving it real renditions means reading
  its intrinsic size at upload time; that is a separate piece of work.

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
