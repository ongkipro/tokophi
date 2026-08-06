# Opening self-serve signup — what `SIGNUP_ENABLED=true` would actually expose

**Audited 2026-08-05 against `origin/main` @ `1bde32e`, and against the RUNNING production
containers.** The trigger was #154, which forwarded `SIGNUP_ENABLED` into the admin container for the
first time — the switch is now reachable, so the question "what happens when it is flipped" stopped
being hypothetical.

**Signup is still CLOSED, and nothing here opens it.** The value in Coolify is empty; the default in
`docker-compose.coolify.yml` is empty on purpose. This document is the list of what has to be true
before someone sets it.


> ## 🔴 SUPERSEDED IN PART — SIGNUP IS **OPEN** SINCE 2026-08-05 EVENING
>
> Measured: `SIGNUP_ENABLED=true` in the running admin container, `/daftar` serves a real form
> (1 `<form>`, not the closed page). Every sentence below that says "signup is still shut" describes
> the state this document was WRITTEN in, not the state now.
>
> **The product decision this document asked for was taken, and it took the cheaper option this
> document costed:** #169 landed a **review queue** (migration `0090`) instead of email verification.
> A self-serve signup now creates the store `status: "suspended"`, `suspendedAt` set,
> `suspendedReason` = the pending-review text, and `approvedAt` **NULL** — that NULL *is* the queue.
> The seller panel is read-only for it, and the banner says "waiting", not "punished". Operator-created
> stores are stamped `approvedAt` and never enter the queue. Verified: production migration stamp
> `1785895700000` matches the journal, 91 migrations applied — `0090` did NOT silently skip.
>
> 🔴 **But one gap opened WITH it, and it is not in #169's scope — see `OPEN.md`: an unapproved
> store's STOREFRONT is fully public.** `getStoreBySlug` filters on nothing but the slug; the
> storefront source contains **zero** references to `suspended`/`approved_at`, and `StoreInfo` does not
> even carry `status`. So anyone may now register and immediately hold `<their-slug>.tokophi.com`
> serving a page with a name they chose, before any human looks.

---

## What was verified, not assumed

| | measured |
|---|---|
| the gate holds in production | `https://app.tokophi.com/daftar` → **200**, renders *"Pendaftaran ditutup sementara"*, **zero `<form>` elements** in the response |
| #154 actually landed | admin container image `…_admin:1bde32e0e21f…` = the merged commit; `SIGNUP_ENABLED`, `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI` and `STOREFRONT_BASE_DOMAIN` are all **present in its environment** and all **empty** |
| all four hosts healthy after the deploy | `tokophi.com` 200 · `app.` 307 · `rich.` 307 · `toko.` 200 |

### The gate itself is sound — it is checked at three layers, and the boundary is the right one

`signupOpen()` (`lib/provision.ts:75`) is a fail-closed regex over `SIGNUP_ENABLED`: absent, empty or
anything but `1|true|yes|on` ⇒ shut. It is consulted in three places:

1. `app/daftar/page.tsx:23` — renders the explanation instead of the form. **UX only.**
2. `lib/actions/register.ts:18` — answers before hashing a password or touching the DB. **Cheap
   path only.**
3. `lib/provision.ts:89`, inside `provisionStore` — **THE boundary.** Both self-serve paths funnel
   through it, so closing it here closes the form *and* the OAuth callback. Hiding the form alone
   would leave the server action and `api/auth/google/callback` happily creating stores.

The Google callback additionally short-circuits at `route.ts:78` so a closed signup lands on
`/daftar?error=ditutup` rather than the 500 that `SignupClosedError` would otherwise produce. Signing
in with Google to an **existing** store is untouched by the gate — correct: the gate is about
creating a NEW store, not about authenticating.

---

## 🔴 Fixed in this change — the signup door was not metered

`signIn` has been rate-limited since `53dd9ee` (`login:admin:<ip>`, 15/min). `registerStore` beside
it **never was**, and it is the more expensive door: a call that passes the field checks writes seven
rows in one transaction and mints a 3-day trial.

The half that is easy to miss is the **cheap** path. `registerStore` answers *"Email sudah terdaftar.
Silakan masuk."* before it writes anything. That copy is correct — a returning owner has to be told
to log in rather than stare at a failure — and it is therefore an **email-existence oracle over every
merchant on the platform**, enumerable at request speed while unmetered.

So the fix meters **before** `emailTaken` and before the scrypt hash, not merely somewhere in the
function: `signup:admin:<ip>`, 5 per 10 minutes, its own key (sharing the login bucket would let a
burst of signups lock a merchant out of logging in). Guarded by
`apps/admin/lib/signup-metered.test.ts`, which pins the ORDER as well as the presence, and which was
proved red against the real mutation — deleting the line turns three of its six tests red.

⚠️ Same known limits as every rate limit here: an in-process `Map`, so it resets on redeploy and does
not span replicas, and it counts **IPs, not accounts**. A floor, not a wall — the wall is Cloudflare
at the edge.

---

## 🟠 Decide these BEFORE flipping the switch

### 1. There is no email verification on the password path — and no mailer to build one with

`registerStore` checks the email's *shape* (`EMAIL_RE`), never that the person controls it. It then
signs a session and drops them into a live store. Three consequences, in the order they will bite:

- **Squatting.** Registering `someone@else.com` permanently blocks the real owner, who is told only
  *"Email sudah terdaftar."* There is no self-service way back — see N47, which is the same hole from
  the operator's side.
- **Spam trials.** Unlimited free 3-day stores, no card, no proof of anything. The rate limit above
  slows this; nothing caps it.
- **`platform_activity`** records *"Toko baru … mendaftar (email)"* for addresses nobody proved they
  own, and that feed is what the control plane reads.

Note the asymmetry: **the Google path is already verified** — `route.ts:34` refuses a profile whose
`emailVerified` is false. Password signup is the weaker of the two.

⚠️ There is **no mailer anywhere in this repo** (it is why `store_settings` has no email fields and
why cart recovery travels on WhatsApp). Email verification is therefore not a small change — it is a
provider, a template, a token table and a "your account is pending" state. **Options, cheapest first:**
open signup with an operator approval step instead (a store starts `status='ditangguhkan'` until an
operator lifts it — that machinery exists since `0086`); or keep signup shut and onboard by hand
through Super Admin → `createStore`, which is exactly what `signupOpen`'s own comment says the closed
state is for.

### ✅ 2–4 are DONE (2026-08-05) — and the sweep found a third slugify nobody had counted

All three shipped together; the reasoning that outlived them is below.

**The reserved list is shared, and it is consulted on the way IN.** `RESERVED_SLUGS` moved to
`@tokophi/lib/store-slug`. `uniqueSlug` now skips a reserved candidate exactly as it skips a taken
one, so "App" lands on `app-2`; super-admin's `createStore` REFUSES instead and says which slug is
the problem, because an operator typing a name by hand can simply pick another. Note `toko` is on
that list **and** is `provisionStore`'s last-resort base, so the skip is load-bearing, not decorative.

**⚠️ There were TWO slugifys and they had already drifted — then the sink found a THIRD.** Measured:
`"Café Senja"` → `cafe-senja` (self-serve, NFKD) vs `caf-senja` (operator, no NFKD). Two doors onto
one product disagreeing about a shop's permanent public address. And **neither was right**: NFKD
splits `É` into `E` + a combining acute, which is not `[a-z0-9]`, so it became a *separator* —
`Éni` → `e-ni`. Stripping U+0300–036F after decomposing is what makes NFKD do the job it was reached
for; the shared rule now yields `cafe-senja` and `toko-ibu-eni`.

The third copy is the one worth remembering: **`packages/db/src/seed.ts` writes `stores.slug`** with
its own non-NFKD version. It agrees today only because "Batik Nusantara" is pure ASCII. A guard that
swept for the *name* `slugify` would have flagged it — along with six per-store HANDLE minters
(collections, landing pages, product editors) that have no business consulting a list of reserved
subdomains, and converging those would have been a behaviour change dressed as de-duplication. So
`store-slug.test.ts` claims the **sink**: a file that writes `schema.stores … slug` must import the
shared rule. Three writers, named, and the list is derived by scanning every tracked file.

**The races are caught where the database decides them.** `uniqueViolationConstraint`
(`@tokophi/lib/pg-errors`, pure) reads a `23505` and both paths translate it into the sentence the
form already had. ⚠️ The field is **`constraint_name`**, not `constraint` — measured against the real
test database through this repo's driver; `node-postgres` spells it the other way, which is what most
examples show, and reading that field yields `undefined` for every violation. The constraint NAMES
come from the migrations, so `packages/db/src/provision-conflicts.test.ts` provokes both violations
for real: a rename lands as a red test, not as the 500 this change removes.

**The name bounds moved to the boundary**, so the Google path obeys them: the floor lived in
`registerStore` only, and the ceiling nowhere. `NAME_MAX = 60` is the storefront chat's existing
`MAX_NAME`, not a second opinion. `provisionStore` now throws `ProvisionInputError` /
`ProvisionConflictError`; `registerStore` returns them to the form, and the **Google callback**
redirects to `/daftar?error=nama_google|bentrok` — before this it had no answer at all and a short
Google display name would have been a 500 on a route whose whole job is to land someone somewhere
readable.

**Nothing existing is affected.** The seed converge is not a data change: `slugify("Batik
Nusantara")` is identical under both implementations, and production holds exactly one store —
`batik-nusantara` (measured 2026-08-05) — which is neither reserved nor spelled differently by the
new rule.

---

## 🟠 Found here, but NOT registration-specific — it is platform-wide

### The session cookie is not `Secure`, and no host sends HSTS

**Measured 2026-08-05.** Every site that writes the `session` cookie sets `httpOnly`, `sameSite:"lax"`,
`path`, `maxAge` — and **no `secure`**:

| | |
|---|---|
| `lib/actions/auth.ts:40` | login |
| `lib/actions/register.ts:48` | signup |
| `app/api/auth/google/callback/route.ts:96` | OAuth |
| `lib/actions/security.ts:45` | password change re-mint |
| `app/impersonate/route.ts:42` | impersonation |

And `curl -I` returns **no `strict-transport-security`** on `tokophi.com` or `app.tokophi.com`.
`http://app.tokophi.com/login` is a Cloudflare **301** to https — but the browser has already attached
the cookie to that plaintext request. A 7-day session token, over HTTP, on the first visit.

✅ **FIXED 2026-08-05, and it was SEVEN sites, not five.** The table above lists the merchant's five;
the sweep for the fix found the super-admin's two as well — operator login and the operator password
re-mint — i.e. the **control plane**, the one that reaches every tenant, was in the same state. All
seven now go through `@tokophi/lib/session-cookie`, and `packages/lib/src/session-cookie.test.ts`
scans every tracked source file for a session-cookie write that does not, so the eighth call site
cannot be written by copying the sixth.

✅ **The HSTS half landed the same day**, on the zone rather than in this repo:
`max-age=86400; includeSubDomains`, verified on all six hosts including a tenant subdomain. So the
first request no longer leaves the browser at all — the 301 becomes an internal redirect. `preload` is
deliberately off and `max_age` is a 24 h **ramp** with one follow-up (raise to a year after a week);
the reasoning, the rollback and the pre-flight measurements are `CLOUDFLARE-PERF.md` §4. ⚠️ It did
**not** unblock **N2** — that needs a token with *ruleset* permission; this needed *Zone Settings*.

⚠️ **And `Secure` cannot be proved by any test in this repo.** `NODE_ENV` is `test` under vitest, so
the suite exercises the FALSE branch and pins the expression by reading it; the true branch is only
observable in a real `Set-Cookie` on the deployed site. Confirm it by logging in and reading the
cookie's `Secure` column in DevTools. Note also that this does **not** log anyone out: an existing
cookie keeps whatever flags it was issued with until it is re-minted.

### Google account linking is unproven, and that is (probably) fine

`route.ts:47-49`: an existing **password** account with the same address gets `google_sub` attached
and `auth_provider` flipped to `"google"` — no proof the caller controls the password account. It is
the standard verified-email linking pattern and Google has asserted `emailVerified`, so this is
recorded rather than filed. Two facts that make it safe and should stay true: `passwordHash` is left
**intact**, and `findLogin` does **not** filter on `auth_provider` (verified `lib/auth.ts:36-55`) — so
password login still works after the flip. Break either and linking silently becomes an account
takeover of the merchant's own login.

---

## What this leaves

Flipping `SIGNUP_ENABLED=true` today gives a working, metered, fail-closed signup that **creates real
tenants for unverified email addresses**. That is the one thing on this page that is a product
decision rather than a task, and it is item 1.
