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
> 🟣 **AUDIT WAVE 7 ADDED N36–N48** — the surfaces the first six waves never touched:
> `apps/landing`, admin empty states + zero-state arithmetic, the public API surface, seed-vs-production
> drift, date anchors in write paths, and accessibility beyond checkout. **Nothing above was renumbered.**
> The owner-facing narrative — what six waves changed, what is still open, what was deliberately NOT
> done, and the decisions waiting on him — is **[`../AUDIT-SUMMARY.md`](../AUDIT-SUMMARY.md)**.
> ⚠️ **Every wave-7 entry is labelled MEASURED or READ.** Do not upgrade a READ to a MEASURED without
> running something; three claims have already been retracted here for blurring that line.
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
version) and ~~a password reset does not kill it~~ — ✅ **a password rotation DOES kill it now**
(migration `0087` + `sessionOutlivesPassword`, 2026-08-03): the merchant changing their own password,
or an operator resetting it, ends every session for that user including a live impersonation, because
`getSession()` refuses any JWT issued at or before `users.password_changed_at`.
**That closes one limb and NONE of the three above.** The token is still replayable inside its 2-minute
window, still rides in a query string, still mints 7 days, and still carries no impersonation marker —
so a leaked URL is still a merchant's account, and the decision below is unchanged. Deliberately no
marker, no shortened expiry and no single-use was added: those are the owner's options, not a side
effect of a revocation fix. What did change is that the "only kill switch is deleting the owner's
`store_users` row" is no longer true; there are two now.

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

### N47. An operator who forgets their password has NO way back in · **S** · NEW
Opened by the branch that shipped `changePlatformPassword` (audit wave 7). That form requires the
CURRENT password — correctly, it is a self-service rotation, not a recovery. But nothing else writes
`platform_admins.password_hash` except `invitePlatformAdmin`, which only INSERTs, so an operator who
forgets theirs is locked out until somebody runs `psql`. There is no SMTP on this platform (see
`coolify-vps-dev`), so "email a reset link" is not the answer.

The shape that fits what already exists: **an owner-rank "Reset kata sandi" beside each operator in
Pengaturan → Tim Platform**, minting via `tempPassword()` and revealing once — exactly what
`resetStoreUserPassword` already does for a merchant's staff, and the rank/audit conventions are
already written. It was left out of wave 7 deliberately: that branch's job was to close three
verified defects, and a new owner-rank credential-handover action over the control plane is a
separate decision with its own escalation question (may an owner reset ANOTHER owner?).

**AC:** an owner can reset another operator's password from the UI; the new password is revealed once
and never logged; the action is audited to `platform_activity` with both emails; the target's live
sessions end (migration 0088's trigger already does this — assert it).

### N48. A refused super-admin action shows the operator NOTHING · **S** · NEW
`requirePlatformAdmin` **throws**, and none of the callers in `pengaturan-client.tsx` /
`store-detail.tsx` catch it. Measured on 2026-08-03 with a demoted operator: clicking "Undang"
produced **no toast at all** — the action correctly refused (`Tidak diizinkan — perlu peran owner,
akun ini support.` in the server log, and no row was written), but the screen said nothing and the
dialog stayed open as if the click had been ignored.

This is the *safe* direction of the failure — nothing claimed success — but it is the same class
AGENTS.md already names: converting a throwing action to `{ ok, error }` is a TWO-file change, and
Next masks a thrown `Error` in production behind a digest. An operator-actionable rule ("you are not
an owner any more") should be a returned string, not a swallowed exception.

**AC:** a rank refusal renders an Indonesian toast naming the required rank; the action and every
caller change in the same commit; one runnable check that a caller cannot ignore the result.

---

## 🔴 SHIPPING — audited against KiriminAja's own docs, 2026-08-03

Method: every endpoint our code calls, cross-referenced against the captured official docs
(`~/Documents/kiriminaja/documents`, from developer.kiriminaja.com) and probed against the LIVE
sandbox. Read-only calls only — nothing was booked.

### ✅ N30. 🔴 The QUOTE and the BOOKING priced different parcels — **FIXED 2026-08-03**
⚠️ **This entry's first version was WRONG in its reasoning.** It said dimensions were "structurally
impossible today" because `product_variants` has only `weight_grams`. **`products` has carried
`length_cm`/`width_cm`/`height_cm` all along** — the first pass looked at the wrong table. The real
defect was narrower and worse: the columns existed, **`createShipment` used them when it booked**, and
`shipping-quote.ts` did not when it quoted (`kaShippingPrice` had no dimension parameters at all).

KiriminAja applies **volumetric weight (w × l × h ÷ 6)** whenever it exceeds the actual weight.
Measured on the live sandbox — one 1.000 g order, 6138 → 2107, SPX Reguler:

| request | quote |
|---|---|
| weight only — what the shopper was charged | **Rp13.700** |
| weight + 40×30×20 cm — what the booking cost | **Rp54.800** |
| weight 4.000 g (the volumetric those dims imply) | **Rp54.800** — identical |

**Rp41.100 on one parcel, 4× the quoted price, absorbed by the merchant** on every bulky-light order.

**Fixed:** `weightForCart` **and** `weightForOrder` read the dimensions off `products` and return the
max per axis — the same rule the booking uses; `kaShippingPrice` forwards them; **they are part of the
rate cache key**, so two carts differing only in box size cannot share a quote. Guarded by
`apps/admin/lib/shipping-dimensions.test.ts` (proven red 5/5 against `origin/main`).

⚠️ **On the seeded demo this changes nothing, correctly** — all 24 products carry `1×1×1 cm`. See N33.

### N33. The seed writes `1×1×1 cm` dimensions, and the BOOKING sends them · **S** · NEW
Every seeded product declares a 1 cm cube. Harmless for the quote (0,17 g volumetric never beats the
actual weight) but it is **also what `createShipment` books with**, so the parcel is declared to the
courier as a 1 cm cube. The courier re-measures at pickup; the merchant is billed the difference.

A placeholder that is *plausible* is worse than a blank: nothing warns, and the value is wrong on
purpose. ⚠️ **The seed is not a migration** — existing stores keep whatever they were given.
**AC:** either the seed carries believable per-product dimensions, or the columns are left NULL and the
booking omits them (which is what `kaCreateOrder`'s `?? 10` fallback already handles); plus a decision
on whether the product editor should require them before a merchant can ship.

### N31. The COD fee KiriminAja charges is never read · **S** · NEW
Every `shipping_price` result carries `setting.cod_fee`, `minimum_cod_fee` and a computed
`cod_fee_amount` (measured: present on all 4 sandbox services). **Nothing in the repo reads any of
them** — `grep -rn "cod_fee"` over `apps/` + `packages/` returns nothing.

So a merchant selling COD sees the ongkir but not the COD fee that is deducted from their payout. It is
not a correctness bug (the ledger books what actually arrives) — it is a number we HAVE and do not show.
**AC:** the COD fee appears next to the COD option wherever a merchant sees the shipping cost.

### 🔵 What the audit CONFIRMED is correct (do not re-check)
- **Endpoint versions match the docs**, and they genuinely vary per endpoint:
  `v6.1/shipping_price` · `v6.1/request_pickup` · `v3/cancel_shipment` · `v2/get_address_by_name` ·
  unversioned `province` / `tracking`. Not a mistake — the docs version them separately.
- **`province` is a POST, not a GET** (a GET returns `"Method GET is not supported for this route"`).
  Live sandbox probe: **37 provinces, `status: true`** — auth and connectivity are good, and the
  response key is `datas`, not `data`.
- **The resi chain is complete and correctly joined** — see N32.

### ✅ N32. The resi chain, driven end to end — **CLOSED 2026-08-03**, and it found N34
Owner-authorised. Runbook: [`2026-08-03-shipping-e2e-runbook.md`](./2026-08-03-shipping-e2e-runbook.md).

**A real booking went through.** `request_pickup` with the schedule computed the way `createShipment`
computes it (**tomorrow 10:00 WIB**, `Asia/Jakarta`):

```
1) quote        → jne/REG23  Rp17.000
2) request_pickup → {"ok":true,"kaOrderId":"5758-E2E68072665","pickupNumber":"XID-5544692486"}
   awbPending = true          ← awb is null on every fresh booking, exactly as documented
3) tracking     → "Tracking tidak tersedia"   (no waybill yet — correct)
4) cancel       → 🔴 "Paket tidak ditemukan"  ← THIS IS N34
```

So the chain is real: the payload is accepted, `ka_order_id`/`pickup_number` come back, and
`awbPending` behaves as the code says. **The cancel is where it breaks — see N34.**

⚠️ **An earlier attempt used `now + 1h` and was refused with *"Jadwal penjemputan tidak lagi
tersedia"*.** That was the SCRIPT being wrong, not the code: `createShipment` already books tomorrow
10:00 with a comment recording the courier cut-off. Do not "fix" the schedule.

### 🔴 N34. `cancelShipment` sent the ORDER ID as the AWB — **FIXED 2026-08-03**
KiriminAja's doc is explicit: **`awb` — *"AWB Number Already Obtained, **Not Order ID**"***.
`cancelShipment` built `const ref = o.awb ?? o.kaOrderId`, and **every fresh booking has `awb: null`**
(that is why `awbPending` exists). So the fallback fired on exactly the parcel a merchant had just
created, and the API answered **"Paket tidak ditemukan"** — the shipment stayed live at the courier
while the merchant read an error that sounds like the parcel does not exist.

**That window is precisely when someone cancels**: booked by mistake, seconds ago, waybill not issued.

**Fixed:** cancel takes `o.awb` and only `o.awb`. A booking with no waybill is refused **before** the
network call, with the next step instead of a vendor string — *"Nomor resi belum terbit dari kurir…
Klik 'Lacak' untuk mengambil resi begitu terbit, lalu batalkan."* The lib comment that asserted
`AWB (= kj_order_id / resi we stored)` is corrected; that false equivalence is how the wrong
identifier would be reintroduced by someone who trusted it.

Guarded by `apps/admin/lib/cancel-shipment.test.ts` (proven red 4/4), which uses **`codeOnly` from
`test/source-code.ts`** — a hand-rolled comment stripper would have been the fifth copy of a defect
this repo has already found four times, and it fails on the very comment explaining the fix.

⚠️ **A LIVE SANDBOX BOOKING IS OUTSTANDING AND COULD NOT BE CANCELLED** — that is the bug, met in
person: `5758-E2E68072665`, pickup `XID-5544692486`, JNE REG23, pickup scheduled 2026-08-04 10:00 WIB.
No waybill was issued in ~1 minute of polling, so there was no AWB to cancel with. It is **sandbox**
(`tdev.kiriminaja.com`) and nothing will be collected, but if the owner wants it gone it must be voided
from the KiriminAja dashboard, or cancelled via the API once a waybill exists.

### N35. Surface which KiriminAja environment a deploy is on · **S** · scoped down by the owner
🔵 **Owner's ruling (2026-08-03): the API is the SAME on sandbox and production — same contract, same
shapes; the cutover is an endpoint swap and nothing else.** So this is NOT an integration-parity task
and must not be re-raised as one. Do not write a "verify the two environments behave alike" check, and
do not budget for API differences at cutover — there are none.

⚠️ **What survives, precisely BECAUSE they are identical:** a sandbox booking returns a `kaOrderId` and
a `pickup_number` shaped exactly like a production one. Measured on 2026-08-03 —
`5758-E2E68072665` / `XID-5544692486` — and nothing on any screen distinguishes it. A deploy pointed at
the wrong endpoint therefore looks completely healthy: orders read "dibooking", resi appear, and no
courier ever comes.

`KIRIMINAJA_ENV` defaults to `sandbox`, so *unset* is the wrong one.

**AC (small):** the active environment is visible where an operator already looks — the super-admin
KiriminAja connection card (`kaTestConnection` already returns `env`; it just is not shown). Nothing
more. No blocking check, no parity suite.

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

## 🚚 KIRIMINAJA DOC SWEEP (2026-08-03) — all 34 pages read by flow

Summary written to **[`specs/docs/KIRIMINAJA.md`](../KIRIMINAJA.md)** — the vendor contract, beside
`FLOWS.md` §5 which owns the product flow. Five findings below came out of comparing that summary
against the code.

⚠️ **The captured docs give HTTP verbs, not paths** — 25 of 34 pages render `**Endpoint**: POST` with
no URL. Every path we call came from our own working code. **Do not invent a path** for an endpoint we
do not yet call; that is what blocks N39 and gates N41.

🔵 **Two things the docs settle, so nobody re-raises them:** (a) there is **no standalone pickup
endpoint** — creating the express order *is* the pickup request (`method: "request_pickup"`), and
pickup vs drop-off is the per-package `drop` boolean; (b) **skipping the schedule endpoint is
explicitly allowed** ("if your company prefers a fixed daily pickup process… skip this endpoint"), so
our hardcoded tomorrow-10:00-WIB is a legitimate choice, not a defect.

### ✅ N36. Five documented status codes were unmapped — **FIXED 2026-08-03**
`outcomeFromTrackingCode` returned `null` ("fill the AWB, change nothing") for **302** pickup canceled
by seller, **310** rejected–did not order, **311** rejected–**unwilling to pay (the COD refusal)**,
**333** destroyed by courier and **555** confiscated by Customs. It also mapped **110** "pending
*direct pickup*" to `shipped` — the code falls inside the `106..200` transit range but is PRE-pickup,
and `RANK` is forward-only, so telling the merchant and the buyer a parcel was moving while it still
sat at origin was permanent.

**333 and 555 are documented FINAL states.** Unmapped, the order never left `dikirim`, so the poller
re-queued it every 15 minutes forever — and the sweep takes a bounded `BATCH` per tick, ordered
AWB-less-first, so parcels that can *never* resolve accumulate at the head of the queue and starve the
ones with work outstanding. Same family as the un-ordered `.limit()` bug the file already documents.

Now: 302 → `canceled`; 310/311 → `returned`; 333/555 → `problem` (no status change — a destroyed
parcel is neither delivered nor returned, and whether it settles as `batal` is a refund/claim decision
that is **not** ours to make here — but it raises `problem_at`/`problem_note`, so the merchant SEES
it); 110 → `booked`. `210`/`211`/`350` stay deliberately unmapped, with the reason in the code.

**Guard:** `apps/admin/lib/ka-status-codes.test.ts` transcribes the vendor's whole 38-code table plus
the invariant *no FINAL-state code may return null*. **7 red before the fix, 41 green after.**

### ✅ N37. `pickup_number` thrown away, and VA/COD conflated — **FIXED 2026-08-03** (migration 0088)
**One booking call carries two money flows running in opposite directions, and all three fields that
tell them apart were parsed and discarded for both.**

- **NON-COD** — *we* owe KiriminAja the shipping cost; `payment_method` defaults to `va`, so the
  booking answers with `payment_status` (unpaid | pending | paid) and a `qr_url`. **An unpaid booking
  never gets a waybill.** The parcel does not ship, the poller keeps finding nothing, and the order
  reads "dibooking" everywhere with nothing saying why. That silence was the defect.
- **COD** — the *buyer* pays the courier; the vendor documents that `payment_method` is **ignored**
  for COD packages and rejects the combination with code **4003**. Nothing for us to settle, so an
  "unpaid" reading there is noise, not a debt.

Migration **0088** adds `orders.ka_pickup_number` (the vendor's own **`payment_id`**),
`ka_payment_status`, `ka_payment_url` — stored **verbatim, uninterpreted** — plus
`ka_shipping_cost_idr`, the **cost side of ongkir the DB has never held** (`shipping_idr` is what the
*shopper* paid; the seller may book a cheaper service than the shopper picked, and nothing recorded
the gap). Storing the cost moves no money — it is the prerequisite `BACKLOG.md` already names, and
what N42 needs.

**`apps/admin/lib/shipment-payment.ts` is the ONE place that separates the flows**, deciding from the
order's own COD flag (`payments.method = 'cod'`), never from the vendor's fields — the docs do not
define `payment_status` for a COD package. NULL = *no reading* (every pre-0088 booking), never
*unpaid*. Surfaced on the order's shipping card as "Ongkir ke kurir", red + a **Bayar** link only
when it actually blocks; `unknown` renders nothing.

**Guard:** `apps/admin/lib/shipment-payment.test.ts` (9 tests) — COD never blocks whatever the vendor
put in `payment_status`, `pending` is in flight rather than a failure, only the VA flow may block,
and no label ever names the provider (ADR 0004).

⚠️ **Reading payment status back is still open** — the Payment endpoint's path is NOT STATED IN DOCS.
We can now *ask* (we hold the `payment_id`); we do not yet know where.

### 🔴 N42. COD settlement is not modelled — the platform pays the difference · **L** · **OWNER DECISION**
Found auditing the ledger against the VA/COD split. **This one moves real money, so it is filed, not
fixed.**

On `selesai`, `settleOrderLedger` → `creditSaleForPayment` credits `payments.amount_idr` as
immediately-`available`. For a COD order that amount is the **gross** `subtotal + ongkir + pajak −
diskon` — the whole sum the courier collected at the door (`app/api/public/order/route.ts:513,725`,
and the booking tells the courier to collect exactly the same total). KiriminAja remits **net** of
the shipping cost it keeps, and of any COD fee.

So **the merchant's `available` balance overstates by (ongkir + COD fee) on every delivered COD
order**, and the platform pays that difference out of its own float when they withdraw.

Nothing models the cost side at all: `ledger_kind` is `('sale','retur','payout','adjustment')` —
there is no cost/fee kind — and no writer anywhere represents a courier charge. `platform_cod.fee_pct`
exists in the schema and is **read by nothing** (only ever seeded to `0`). This is true for non-COD
too, where we owe the shipping cost separately; it is simply less visible because no remittance is
being netted.

**Half the prerequisite is now in place**: `orders.ka_shipping_cost_idr` (0088) records what the
courier was actually told to charge.

**The decision is yours, and it is not technical:** does the platform absorb the ongkir on COD
orders, or is it netted out of what the merchant is credited? Changing how merchants are credited
changes what they are owed — that is not a call an audit gets to make. **AC:** the answer recorded in
`specs/decisions/`, and only then a ledger kind for cost.

### N38. The label is missing required fields · **M** (one part blocked)
`03-important-notes/03-shipping-label.md` is a spec for a label *we* render — **there is no label
endpoint and no label URL in the booking response**. Against its required-field list, ours omits:
**service type**, **Insurance Information** (we do send `insurance_amount`), **postal code** on both
sender and recipient (we snapshot `orders.ship_postcode` in 0049 and never print it), **sender
phone**, item **prices**, and the **Sorting Code**.

🔴 **Sorting Code is blocked twice over:** its values must be requested from KiriminAja
(`tech@kiriminaja.com` / your PIC), and it is delivered on the `processed_packages` webhook — which we
do not receive (N39). **SPX requires a 2-column sorting code and SPX is our primary courier and the
COD rail**, so this is the highest-value blocked item on the shipping path.

Not applicable to us: the JNE `CASHLESS` prefix is a **drop-off** rule and we book pickups. Our Code
128-**B** vs the docs' "128A" is a divergence, not a defect — any Code 128 decodes to the same string.

**Audited 2026-08-03 — four of the five are pure plumbing, one is not.** ⚠️ There is **no single-label
API route**: `/api/admin/labels` is the BULK path (`lib/data/bulk-labels.ts`, one raw SQL select); the
single label is built client-side in `pesanan/[id]/order-detail.tsx` from `getOrderDetail` props. Both
paths need every change.

| field | status | where it already is |
|---|---|---|
| service type | ✅ persisted, unread by both paths | `orders.service_type` (0053); the human name comes from the lateral join `bulk-shipping.ts` already uses |
| recipient postcode | ✅ fetched by both — but glued into the address string, never its own field | `orders.ship_postcode` (**migration 0042**, not 0049) |
| sender postcode / phone | ✅ persisted, **neither label path reads `store_settings` at all** | `store_settings.sender_postcode` / `sender_phone`; `getSenderAddress()` already exists and is RLS-scoped |
| item prices | ✅ single path fetches then drops them; bulk `json_build_object` omits them | `order_line_items.price_idr` / `total_idr` |
| **insurance** | 🔴 **never persisted — needs a column** | booking-time input only (`input.insurance`), consumed once and never written back; `bulk-shipping.ts` hardcodes `insurance: false` |

So `LabelInput.senderLine` is `undefined` at **both** call sites today — the "Pengirim" box prints
the store name and nothing else.

**AC:** the unblocked fields printed and eyeballed on a real 100×150 print preview.

### N39. Webhooks exist and we use none · **L** · 🔴 **BLOCKED — registration path not in the docs**
`processed_packages` carries the **AWB** (and `sorting_code`); `shipped_packages`, `canceled_packages`,
`finished_packages`, `returned_packages` cover the rest. **This is what would make the resi appear in
seconds instead of up to 15 minutes** — the thing the owner actually asked for.

Design constraints the docs impose, none of them optional:
- **A webhook goes BESIDE the poller, never instead of it.** Both event pages name the fallback
  themselves: *"If our webhook endpoint is unavailable, use the Tracking API to pull shipment status
  directly."* KiriminAja documents **no server-side retry**, and says a slow endpoint "may result in
  missed notifications". The poller is the reconciliation path the vendor prescribes.
- **There is no signature scheme** — no HMAC, no `X-Signature`, no replay protection, no documented IP
  allowlist. Auth is a bare `Authorization: Bearer {api_key}` and the docs never say whose key it is.
  A receiver can only constant-time compare the bearer. Treat the payload as untrusted: re-fetch, or
  at minimum never let it move money on its word alone.
- **No event id**, so de-duplication keys off `order_id` + `awb` + `method`.
- **One callback URL per account**, must resolve to a valid A/AAAA record. One URL for the whole
  platform, so the receiver has to route to the right tenant itself.

**Blocked on:** the registration endpoint's path (`POST {"url": …}` — verb only in the docs). Get it
from the portal or support. Everything else can be built and tested against a hand-rolled POST.

### N40. We book on `/api/mitra/v6.1/request_pickup` — **KiriminAja marks v6.1 deprecated** · **M**
`10-deprecated-api/01-express.md` is titled "Create Order Express v6.1" and says: *"This API is
deprecated. Please use the new Create Order Express v6.2 API."* Only the **order** call is affected —
`shipping_price` v6.1 is not in the deprecated section.

Not urgent, not ignorable. What v6.2 changes: `payment_method` (`credit`) + `pin` for KA Credit,
`credit_balance_after` in the response, `package_type_id` 9 for regular packages. ⚠️ **The v6.2 doc
contradicts itself on the destination field names** — its table says `destination_province_id` /
`destination_county_id` / `destination_subdistrict_id` / `destination_village_id`, its own example
sends `destination_provinsi_id` / `destination_kabupaten_id` / `destination_kecamatan_id`. **Resolve
that against the sandbox before migrating** — booking to the wrong village is the failure mode 0042
was written to stop.

**AC:** a sandbox booking on v6.2 that returns the same three identifiers, then the version bumped in
one place. Keep the `drop` default explicit while you are in there — we never send it and its default
is NOT STATED IN DOCS.

### N43. `password.test.ts` is FLAKY under a full run — 1 in 3 · **S** · from #147, not the sweep
Measured 2026-08-05 on `ka/flow-audit` rebased onto `b5f9ded`:

```
full suite, 3 runs → 349 pass · 349 pass · 348 pass + 1 FAIL
  × the temp password is expensive to guess > is the ONLY mint in the repo — no file keeps a
    private copy   →  Test timed out in 5000ms   (the suite itself took 8613ms)
same file ALONE, 3 runs → 7 pass · 7 pass · 7 pass
```

So it is **contention, not content**: the check walks every file in the repo, and with ~40 suites
sharing the machine it crosses vitest's default 5s timeout. Nothing in the doc sweep touches that
file (`git diff --name-only origin/main...HEAD` = 0 hits); it arrived with **#147**.

Left for its author deliberately — a bare timeout bump would also hide a scan that is genuinely
getting slower, and the measurement above is the more useful half. ⚠️ **This repo has no CI**, so a
1-in-3 flake is a gate every agent will hit and learn to re-run past, which is exactly how a real red
gets waved through. Worth fixing soon: either a per-suite `testTimeout`, or share one directory walk
across the textual guards the way `test/source-code.ts` already shares the scanner.

### N41. We cannot see courier holidays (`libur`) · **S** · gated on the path
The schedule endpoint returns `{clock, until, expired, libur}` per window, `libur` = holiday. **Not
calling it is allowed** (see the 🔵 note above), so this is not a bug — but it means a fixed
tomorrow-10:00 booking can target a day the courier is closed, and we would not know. The docs do
**not** state what happens when you book a `libur: true` date, nor what "local time" resolves to, nor
what happens after the stated **16:00 request cut-off**.

**AC:** decide — either call the endpoint and skip `libur` windows, or record in `KIRIMINAJA.md` that
we accept the risk. Gated on the path (NOT STATED IN DOCS) and on the endpoint's request body, which
the docs do not document at all.

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

## 🟣 AUDIT WAVE 7 (2026-08-03) — the surfaces nobody had audited

Waves 1–6 concentrated on checkout, money, passwords, RLS, storefront performance and the super-admin.
This wave swept what was left: `apps/landing`, admin **error paths and empty states**, the **public API
surface**, **seed vs production drift**, **date anchors in write paths**, and **accessibility beyond
checkout**. Full narrative + the measured/inferred split: **[`../AUDIT-SUMMARY.md`](../AUDIT-SUMMARY.md)**
§5.

> ⚠️ **Each entry below is labelled MEASURED or READ.** MEASURED = something was run and this is its
> output. READ = the code was read line by line and the conclusion follows from it, but the thing that
> would prove it was not run. Three claims have already been retracted in this repo for blurring that
> line — do not upgrade a READ to a MEASURED without running something.

### N36. Three public routes take the TENANT from the BODY, and two are cross-store oracles · **M** · NEW
**READ** — `promo/route.ts:31-34`, `order/route.ts:192-199`, `ongkir/route.ts:81-88`. All three resolve
the store from a body field `storeSlug`; the slug is public (it is the storefront hostname).

⚠️ **The contrast is already a written rule in this repo, on the other surface.** Every storefront
endpoint resolves the tenant from the **`Host` header** and refuses to read a store id from the body —
`checkout-session.ts:13-15` and `track.ts:9-11` say so in as many words, and `search.ts:3-5` explains
why: *"a store id in a query string would let one shop's palette read another shop's catalogue."*

What that buys an anonymous caller today:
- **`/api/public/promo` is a side-effect-free voucher oracle against ANY store**, 30/min/IP, CORS `*`.
  `applyDiscount` (`lib/promo.ts:49-56`) returns **six distinguishable answers** — not found · inactive ·
  not yet valid · expired · quota exhausted · and `` `Minimum belanja Rp{N} untuk voucher ini.` ``,
  **which discloses the exact threshold**. `AGENTS.md`'s "Codes are unique PER STORE" section already
  flags the competitor-probe risk; this route is where it is reachable without a login.
- **`/api/public/order` discloses exact live stock**: `` `Stok "${prod.title}" tidak mencukupi (sisa
  ${available}).` `` (`order/route.ts:321`), one variant per request, 10/min/IP, against any slug.

⚠️ The limiter is a module-scope `Map` keyed on a **header-derived** IP (`public-guard.ts:5-8` falls back
to `x-forwarded-for`), so it resets on every redeploy — and `#147` measured **13–24 deploys a day**.

**AC:** either the error taxonomy collapses to one indistinguishable refusal for a code that is not
usable *right now*, or the preview endpoint requires the same Host-derived tenant the storefront already
has. **Do NOT simply lower the rate limit** — that changes the cost of the probe, not its existence.

### N37. No body-size or array-length cap on ANY public route · **S** · NEW
**MEASURED** — `grep` for `slice(`/`length >`/`MAX_` across `apps/admin/app/api/public/**`: the only cap
on any input is `sessionId.slice(0, 64)` (`order/route.ts:782`). `next.config.ts` sets no body limit.

`/api/public/order:151` filters `items[]` and never truncates it, then does ~4 DB round-trips **per
element** (`:257-360`) before the transaction opens; `/api/public/ongkir:108` forwards `body.items`
straight into `weightForCart`, which builds an `inArray` of that length.

⚠️ **The right answer is already in the repo:** `apps/storefront/src/pages/api/checkout-session.ts:109`
does `v.slice(0, 50)` — and that file only *records* a cart it will never charge. The endpoint that turns
the same cart into money and stock caps nothing. Same file also shows the bot gate the four admin public
routes do not have (`BOT_UA`, 40+ patterns) — **MEASURED**: `grep BOT_UA apps/admin/app/api/public/`
returns nothing.

**AC:** a named constant cap on `items[]` on both routes, refused with a merchant-safe message, plus a
body-size limit; and a one-line note saying which number was chosen and why (the storefront's 50 is the
obvious precedent).

### N38. Provider error text is returned verbatim to anonymous shoppers · **S** · NEW
**READ**, traced at every hop:

```
kiriminaja.ts:94       { ok:false, error: r.text }          ← the vendor's own message
shipping-quote.ts:176  { ok:false, error: r.error ?? … }
ongkir/route.ts:111    NextResponse.json({ ok:false, error: q.error })   → shopper
order/route.ts:474     bad(quote.error, "shipping")                      → shopper
autolaris.ts:116       { ok:false, error: r.ket ?? `Gagal (rc=${r.rc})` }
order/route.ts:859     NextResponse.json({ …, payError: pay.error })     → shopper
```

⚠️ **NOT measured:** whether a real provider error string names its brand. What is certain is that it is
the vendor's internal error taxonomy, on a shopper's screen, in a product whose rule (ADR 0004) is that
provider brands stay hidden from clients. `#143` already fixed this class for `cancelShipment` — refuse
**before** the network call and name the next step *instead of quoting the vendor*. The `throw` paths
here are already correct (fixed Bahasa strings); it is the `{ok:false}` paths that leak.

**AC:** the shopper-facing string is ours on every branch; the vendor's text goes to `console.error` only.

### N39. `npm test` silently skips the 22 money tests inside a worktree — and worktrees are the mandated workflow · **S** · NEW
**MEASURED**, in `wave7/w7-audit`:

| run | result |
|---|---|
| `npm test` | banner *"DB-COUPLED SUITES SKIPPED … No DATABASE_URL (env or root .env)"*, **36 tests skipped of 299**, **exit 0** |
| `DATABASE_URL=… npx vitest run`, same worktree, no code change | **39 files, 299 passed, 0 skipped** — `ledger-credit.test.ts` (22) among them |
| `npm run test:db` | fails correctly and names the reason |

Structural cause: `.gitignore:8` is `.env*`, so a worktree **can never** carry a root `.env`; and
`test/db-setup.ts:33` reads only `path.join(ROOT, ".env")` — its own root — and stops.

🔴 **This repo already solved it, twice, elsewhere.** `apps/storefront/scripts/check-env.mjs:84-91` reads
**both** files and its comment states the reason verbatim: *"because a worktree lives at
`<main>/.claude/worktrees/<name>` and `.env` is gitignored, so a worktree never has one — the main
checkout's."* Eleven `packages/db` scripts do the same via `dotenv -e ../../.env -e ../../../../../.env`.
**Three resolvers; the one that does not know about worktrees is the one gating the money tests.**

**MEASURED** — of **30 worktrees** on this machine, **3 have no root `.env`**, including two of the three
wave-7 worktrees created today. So the env copy usually works; when it does not, the failure is **silent
and green**, which is exactly the condition `#129` was written to end.

**AC:** `test/db-setup.ts` falls back to the main checkout's `.env` the way `check-env.mjs` does, proven
by running `npm test` in a worktree with no root `.env` and seeing 0 skipped.

### N40. A literal `NaN` in an SVG path, and formatters with no non-finite floor · **S** · NEW
**MEASURED** — the exact expression from `apps/admin/components/admin/kpi-card.tsx:10`, one data point:

```
d = "MNaN,30.0"
```

Its guard is `if (!data.length) return null` (`:7`) — that catches **empty**, not **one point**, and
`i / (data.length - 1)` is `0 / 0`. Both `<path d>` attributes ship the string `NaN`; the browser drops
the path and the sparkline vanishes.

Reachable: `/analitik` range **"Bulan Ini"** uses `inMonth(thisMonth)` (`dashboard.ts:56`, `:45`) over a
series that is dense-to-today, so **on the 1st of any month it yields exactly one `DayPoint`** →
`getSeries` returns one point (`dashboard.ts:129-132`) → all four KPI sparklines
(`analitik-client.tsx:62-64, 74-79`).

🔴 **The byte-identical function one directory over is already guarded** —
`components/admin/dashboard/money-strip.tsx:26` reads `if (data.length < 2) return null`. Two copies of
one function; the dashboard's is right and `/analitik`'s is not. **Delete one of the two rather than
fixing both.**

And **MEASURED**, running the four exported formatters in `packages/lib/src/format.ts`:

| input | `IDR` | `IDR({compact})` | `num` | `pct` | `share` |
|---|---|---|---|---|---|
| `NaN` | `RpNaN` | `RpNaN` | `NaN` | `NaN%` | `NaN%` |
| `Infinity` | `Rp∞` | **`RpInfinity M`** | `∞` | `+Infinity%` | `Infinity%` |

So ~30 hand-written divisor guards are the only thing between a merchant and `RpNaN`, and the guard above
proves that discipline has already slipped once. `pct(NaN)` even drops its sign, because `n > 0` and
`n < 0` are both false.

**AC:** the sparkline duplicate is gone; `IDR`/`num`/`pct`/`share` render a defined fallback for
non-finite input; a test that goes red on `IDR(0/0)`.

### N41. Seed drift that never reached an existing store — five data fixes, ranked · **M** · NEW
"The seed is not a migration" is already the rule. What had never been counted is **how much is left
behind**. Ranked by what it costs a live merchant:

| # | Drift | Consequence | Evidence |
|---|---|---|---|
| 1 | `platform_couriers.services` changed **dialect** on 2026-07-14 — `["REG","BEST"]` → `{type,name,group,cod,codAllowed}` | It is a **platform singleton**. A DB first seeded before that date has **no `codAllowed` at all** ⇒ the COD chain's second link fails ⇒ **COD is off platform-wide**, and `/api/public/ongkir`'s `"<courier>:<service_type>"` key can never match | **READ** — `seed.ts:1680-1685` states it. Dev container **MEASURED** on the NEW dialect; **production NOT checked** |
| 2 | `store_settings.sender_kecamatan_id` (the ongkir origin), 2026-07-14 | Every quote on that shop falls back to fuzzy-matching the registered city name and returns `originFrom: "store-city"` | **MEASURED** — **6 of 7 stores on the dev DB have it NULL** |
| 3 | `store_shipping_methods` (18 rows), 2026-07-14 | Zero rows ⇒ fallback to `store_settings.couriers`, which is **NULL on all 7** = "every courier KiriminAja returns". The shop offers Jagopack / BIGPACK / SiCepat CARGO at checkout — the hole `35b88a4` closed | **MEASURED** |
| 4 | `reviews.product_id`, 2026-07-15 | Reviews seeded earlier landed with `product_id = NULL`, so **no product carries a rating**, and **no migration backfills it** | **READ** — grep of every `packages/db/drizzle/*.sql` |
| 5 | `platform_payment_channels` (2026-07-09) · `platform_payout` (2026-07-14) | Both platform singletons. An older DB has **zero payment channels at checkout**, and the payout policy the super-admin renders does not exist in the DB | **READ** — `seed.ts:1768`, `:1761-1765` |

✅ **The control group, and it is the pattern to copy:** `payments.store_id` got `0036` with a real
`UPDATE … FROM orders`; product numbering got `0081` (columns → backfill → constraints →
`INSERT INTO store_counters SELECT … FROM stores` for **every existing store**); phone canonicalisation
got `0048`. Those three are what "an existing store needs this too" looks like when it is done.

⚠️ **N33 is the counter-example and must not be swept into this**: the seed's `1×1×1 cm` dimensions are a
change an existing store should **not** receive — NULL is safer there, because the booking declares them.

**AC:** each of the five is either applied to production with the SQL stated in the commit body, or
explicitly ruled not-needed with the reason. Check production before writing anything — see the psql
snippet in `AGENTS.md`.

### N42. `SEED_FORCE=1` destroys operator config with no restore path — including CAPI tokens · **S** · NEW
**READ** — `seed.ts:672`. The truncate keep-list is
`('__drizzle_migrations','kiriminaja_areas','kelurahan','product_taxonomy')`. All three reference tables
are present, so the `AGENTS.md` landmine is satisfied. **But the list only protects REFERENCE data.**

Destroyed and **never put back by any seed**:
- **`store_tracking_channels`** — every store's pixel ids **and its encrypted CAPI token**. The seed does
  not insert this table *at all*. ⚠️ And the single row in it is what `check-pixel-defer.mjs` reads, so a
  force-reseed silently turns that guard into **SKIP** — an alarm that stops guarding without failing.
- **`shipping_aggregator.api_key`** and **`platform_payment_gateways.credentials`** — re-seeded **NULL**
  (`seed.ts:1676-1679`).
- **`platform_admins`** — a rotated operator password goes back to `tokophi123` (`seed.ts:1557`). This
  interacts directly with **N29**.
- non-demo `page_templates`, `flash_sales` — gone.

**AC:** either those tables join the keep-list, or `SEED_FORCE=1` prints exactly what it is about to
destroy and what has no restore path, and `AGENTS.md` says so beside the existing landmine note.

### N43. Two live defects that exist only in a commit body, and nothing tracks them · **S** · ✅ DONE (wave 7)
> **RESOLVED in the same wave that filed it.** Both defects were fixed and DRIVEN, not merely tracked:
> `getPlatformSession()` now re-reads `platform_admins` per request — a demoted operator was measured
> minting a new platform account from a stale cookie BEFORE, and is refused with the DB role AFTER;
> a deleted row and a rewritten hash both bounce to `/login`. `addStoreUser` returns
> `password: string | null` + `outcome`, and the revealed string was scrypt-verified against the stored
> hash on both paths. The finding stands as written — this note records that it no longer applies.
`b5f9ded` (wave 6) named them *"both real, both one surface up"* and neither reached this file.
**MEASURED** — both verified at HEAD, and `grep` over `NEXT.md` + `BACKLOG.md` for either returns **zero**.

1. 🔴 **`getPlatformSession()` returns the JWT payload VERBATIM with no DB re-read at all** —
   `apps/super-admin/lib/platform-auth.ts:47-56`: `jwtVerify` then `return payload as PlatformSession`.
   A **demoted or deleted platform operator keeps their rank for 7 days**, and `platform_admins` has no
   revocation of any kind. That is **strictly worse than the merchant bug `0087` just closed**, where
   `getSession()` at least re-reads membership. It is also the same surface as **N1**.
2. **`addStoreUser` returns `password: pw` even when the user already existed and the hash was NOT
   written** — `apps/super-admin/lib/actions.ts:729-738`: `pw` is minted unconditionally at `:729` but
   `hashPassword(pw)` only runs inside `if (!u)`. The operator is handed a password that cannot
   authenticate, and nothing says so.

⚠️ **The finding behind the finding.** `AGENTS.md` already says *"Hand off in the repo, not in chat"*.
What is missing is the second half: **and in `NEXT.md`, in the same commit** — the rule `#134` wrote for
CLOSING an entry applies just as much to OPENING one.

**AC:** ① `getPlatformSession` re-reads `platform_admins` (rank and existence) on every call, the same
one-round-trip shape `getSession()` uses; ② `addStoreUser` returns `password` only when it wrote the hash.

### N44. Empty states: the first screen a new merchant opens is the emptiest · **S** · NEW
**READ** — grep finds no zero-length branch in any of the four:

| screen | what a merchant with no data sees |
|---|---|
| `/` → `components/admin/recent-orders.tsx:20` | a **fully-rendered table header** (Pelanggan · Invoice · Channel · Status · Total) with zero rows. Worse than blank — column headers assert there is a table to read |
| `/` → `components/admin/live-activity.tsx:23` | a card title over an entirely empty body |
| `/pelanggan/segmen` → `segmen-client.tsx:244` | a strip reading *"**0** segmen aktif"*, then a blank grid. The only way forward is the header CTA, which is `crm:write`-gated — so a **staff user sees a page that is blank below the strip** |
| `/crm/template` → `template-client.tsx:349` | the "Variabel tersedia" helper renders unconditionally — documentation for a feature the store has no instance of — then blank space. Same permission-gated CTA |

Seventeen other screens **do** have one, some very good (`pesanan-client.tsx:436` distinguishes "no
orders yet" from "no match for this filter"). There is **no shared `EmptyState` primitive** in
`packages/ui`, which is why the coverage is uneven.

Filed together with it, same screens: **`lib/data/dashboard.ts:65`** returns `0` for a zero baseline, so
a first-ever month of Rp0 → Rp5jt renders **"+0,0%" beside a green up-arrow** (`kpi-card.tsx:41,51` treats
`0` as a rise). ✅ **The honest version already exists** — `app/(admin)/keuangan/page.tsx:27-28` returns
`null` and renders *"Belum ada periode pembanding."*, with a comment saying *"both of which would be
inventions."*

**AC:** the four screens render an empty state; a zero baseline renders no delta rather than a fabricated
one; and if a shared primitive is added, the seventeen existing ones are left alone unless they are worse.

### N45. Accessibility beyond checkout — one heading skip, one screen with no `<h1>`, three unlabelled destructive buttons · **S** · NEW
**MEASURED** (grep), except where noted:

- **`/produk` skips h1 → h3.** `produk-client.tsx:402` is the **only heading tag in the whole file**
  (`<h3>` for the product name on each grid card); the `<h1>` comes from `PageHeader` and there is no
  `<h2>` anywhere. ⚠️ **This repo already wrote the rule down twice, in two other files** —
  `pemasaran/feed-card.tsx:133` and `navigasi/navigasi-client.tsx:704` both carry the comment *"h2, not
  h3 — this page's only other heading is the page `<h1>`"*. Two authors reasoned it through; the third
  instance was missed. Change the tag, leave the `className`, exactly as `#139` did.
- **`/tema/[id]` has no `<h1>` in application code at all** — `builder-client.tsx` contains **zero**
  `<h1>`/`<h2>`/`<h3>`/`PageHeader` (`grep -c` = 0). The only title is handed to `<Puck headerTitle=…>`,
  third-party. Every other admin route gives a screen-reader user a heading to land on.
- **Three destructive icon-only buttons with no accessible name**, all in one file:
  `promo/[id]/promo-editor-client.tsx:207` (delete a benefit bullet), `:230` (remove an "Ideal Untuk"
  chip), `:291` (delete a problem bullet). All three are one click, unconfirmed. `:230` is the sharpest —
  the chip's label sits in the **parent** `<span>`, outside the button, so it contributes nothing to the
  name. `collection-editor.tsx:593` does the identical job with `aria-label={\`Hapus ${p.name}\`}`.

🔵 **Checked and clean, so nobody re-chases:** no colour-only status badge anywhere in `apps/admin` (all
six order statuses and all five other badges carry text; colour is redundant encoding); all 13 `<img>`
carry `alt`; 17 of 19 icon buttons carry an `aria-label`, most of them contextual.

**AC:** `/produk` renders h1 → h2; `/tema/[id]` has an `<h1>`; the three buttons have names that say
which item they delete.

### N46. The credential sweep scans `apps/` only, while its sibling already scans the whole repo · **S** · NEW
**MEASURED** — `packages/lib/src/no-published-credentials.test.ts:25`: `const APPS = join(ROOT, "apps")`,
and `sources(APPS)` is what it walks. So **23 `.astro`/`.tsx` files under `packages/{sections,ui}` —
markup that is rendered into merchants' live storefronts — are outside it.** `packages/lib/src/password.test.ts`
next door already walks `git ls-files` over the entire repo (that widening was `#141`'s fix for exactly
this shape).

**MEASURED** — nothing is there today: a grep for `tokophi123` / `admin@tokophi` / `ongki@batiknusantara`
across `packages/sections` + `packages/ui` returns nothing. This is about the guard's **reach**, not a
live leak — the same *"never bind a guard to a list of targets"* rule the file's own comments make, one
scope up.

**AC:** the sweep's root is the repo (or `apps/` + `packages/`), proven by planting a credential in a
`packages/sections` component and watching it go red, then removing it.

### 🔵 Wave 7 — checked and CLEAN (do not re-chase)
- 🔴 **No frozen seed anchor survives in ANY application read or write path.** Four sweeps of the whole
  worktree (`2026-06-30`, `2026-07-02`, `TODAY|ADMIN_TODAY|ANCHOR`, `new Date("2026`): every hit under
  `apps/` is a **comment recording a fix that landed**, a test, or `lib/mock/store.ts` — and that mock's
  `TODAY` never reaches runtime, because **all 30 `import … from "@/lib/mock/store"` sites are
  type-only**. `createdAt` is never explicitly stamped anywhere in app code; the two `acceptedAt` stamps
  are required (`store_users.accepted_at` is `ts()`, with no `defaultNow()`). **MEASURED.**
- **All four `/api/public/**` routes ARE rate-limited** — ongkir 60/min, order 10/min, promo 30/min,
  pay/callback 60/min per IP. **MEASURED.** Wave 6's "invisible to two guards" was about the source
  sweeps, not the limiters. `pay/callback` is the one authenticated route: `timingSafeEqual` shared
  secret, fails closed in production if unset, limiter **before** the compare.
- **All three cron routes require `CRON_SECRET` and REJECT in production when it is unset.** **MEASURED.**
  (Minor: all three sidecars pass it in the **query string** — `docker-compose.coolify.yml:237,266,290` —
  although the routes also accept `x-cron-secret`, and `docker top` on a sidecar prints it expanded.)
- **`apps/landing` publishes zero credentials**, has zero forms, zero `<img>`, exactly one `<h1>` per
  page, no heading skips and no broken internal links, and **does not assert a legal entity that may not
  exist** — the four "belum lengkap" notices say the opposite, loudly. Its four served HTML comments are
  benign. What is left there is **owner work, not engineering**: the four `PUBLIC_LEGAL_*`/`PUBLIC_CONTACT_*`
  build args are **passed nowhere** (`docker-compose.coolify.yml:176-200` has no `args:` block —
  **MEASURED**), there is no ToS and no refund policy, and the apex states no price at all. Two small
  code-side leftovers: `index.astro:132` states **"COD" flatly** while `store_settings.cod_enabled`
  defaults **false** (`schema.ts:1213`) and COD is SPX-only / Rp2jt-capped / 6 provinces; and
  `docker-compose.coolify.yml:173` still describes landing as *"currently 'segera hadir'"*, the exact copy
  `#141` deleted from the page.
- **~30 division sites across admin + super-admin are correctly guarded** — every return rate, funnel
  step, AOV, conversion and channel share. The two exceptions are N40.
- **There is no `.html` report anywhere in this repo** — `find` outside `node_modules`/`.git` returns
  zero. **MEASURED.** One was not created; that is the owner's call.

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

### N49. The credential sweep lexes 455 files to check 1 of them · **S** · NEW
**MEASURED** while integrating wave 7, after this suite timed out under `npm test` and went red on a
green codebase. Profile of `packages/lib/src/no-published-credentials.test.ts`:

| step | cost |
|---|---|
| `readdirSync` walk of `apps/` | **8 ms** |
| `readFileSync` all 455 files (3,3 MB) | **24 ms** |
| lex all of it through the TypeScript scanner | **819 ms** |
| files whose RAW text contains ANY needle | **1 of 455** |

The filesystem is not the cost and `git ls-files` would buy nothing. The lexer runs so that a
credential inside a comment does not count — but a file that does not contain the string **at all**
cannot be a hit, so 454 of the 455 lexes answer a question nobody asked. Lexing only strips comments
and inserts whitespace, so whitespace-stripped LEXED ⊆ whitespace-stripped RAW: a raw prefilter can
over-select but never under-select, which is the safe direction.

⚠️ **Why this was NOT done inline.** `SECRETS` holds whitespace-tolerant REGEXES, not literals (an
`<!-- admin@tokophi.id -->` lexes to `< ! -- admin @ tokophi . id -- >`, which is why the patterns are
loose in the first place). The prefilter therefore has to re-apply each pattern against
whitespace-stripped source, and a subtly wrong one makes this guard **silently green forever** — the
precise failure mode `test/source-code.ts` exists to end, found nine times in nine guards. Do it in
its own change set and **prove it red against a mutated copy of a real credential first**.

Interim: the timeout is raised to 20 s with the profile written into the file. That is a ceiling, not
a fix — the work is still 819 ms of CPU competing with 41 other test files.

### N50. An empty store is told its sales are unchanged, not that there is nothing to compare · **S** · NEW
**MEASURED** (wave 8, rendering the seeded empty store `snack-rumahan-bu-tati`).
`apps/admin/lib/data/dashboard.ts:65` computes `delta = prev === 0 ? 0 : …`, so a store with no
history renders **"Penjualan hari ini +0,0%"** — *"no change"* — where the truth is *"there is
nothing to compare to"*. This is the same family as the incident already recorded above: a dashboard
reading "Rp0 · −100,0%" over four orders placed that morning. The standing rule is **a figure with no
source is "—", never a number**, and `Tingkat retur` immediately beside it already obeys it.

⚠️ **Deliberately not fixed in wave 8, and the reason is the size, not the difficulty**: honest
output needs `Kpi.delta: number | null` threaded through every KPI card, the money strip and the
analitik tiles — a data-layer contract change, and the wave that found it was scoped to screens.
Do it with the `NO_FIGURE` floor wave 8 already added to the formatters, not beside it.

### N51. ~40 admin form controls have no programmatic label · **S** · NEW
**MEASURED by rendering**, not grepped. Wave 8 fixed the ones it could name (`/pengaturan` switches
via the shared `ToggleRow`, the topbar's colour-only unread dot, the store-builder image picker with
no accessible name at all, three unlabelled destructive buttons on `/promo/[id]`). The rest cluster:
every list screen's search box, `lib/theme/puck-field-overrides.tsx`, `saldo-filters.tsx`'s date
pair, and `order-detail.tsx`'s bare checkboxes. A screen reader announces these as "edit text", with
no indication of what they filter or what the checkbox will do to an order.

### N52. `CardTitle` is a `<div>`, so 128 card headings are invisible to heading navigation · **S** · NEW
**MEASURED**: the admin is a **flat `h1`** on nearly every screen — every card title on every
dashboard, list and detail page is a styled `div`. A screen-reader user cannot jump between regions;
they must read linearly through the whole page. Changing the primitive is one edit but it touches
every admin screen's visual rhythm, so it wants its own change set and a pass over the levels
(`h2` under the page `h1`, `h3` inside a card). Wave 8 added `apps/admin/lib/admin-h1-floor.test.ts`,
which pins that every route REACHES an `h1` — the floor, not the structure.

### N53. Good/bad is communicated by colour alone in two places · **S** · NEW
**MEASURED**: the money strip's and the return-rate card's verdict is carried by green/red text with
no icon, sign or word. WCAG 1.4.1. The delta figures beside them already carry `+`/`−` (U+2212), so
the fix is to let the verdict borrow the same signal rather than invent one.
