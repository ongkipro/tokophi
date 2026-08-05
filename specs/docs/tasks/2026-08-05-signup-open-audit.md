# Opening self-serve signup — what `SIGNUP_ENABLED=true` would actually expose

**Audited 2026-08-05 against `origin/main` @ `1bde32e`, and against the RUNNING production
containers.** The trigger was #154, which forwarded `SIGNUP_ENABLED` into the admin container for the
first time — the switch is now reachable, so the question "what happens when it is flipped" stopped
being hypothetical.

**Signup is still CLOSED, and nothing here opens it.** The value in Coolify is empty; the default in
`docker-compose.coolify.yml` is empty on purpose. This document is the list of what has to be true
before someone sets it.

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

### 2. `uniqueSlug` does not consult the storefront's RESERVED list

`apps/storefront/src/data/store.ts:87` refuses to resolve nine subdomains as a store —
`www app rich admin api cname toko storefront localhost`. `uniqueSlug` (`provision.ts:43`) knows
nothing about it. So a shop named "App" gets `slug: "app"`, and the result is a store whose storefront
is structurally unreachable, with nothing on any screen saying why — plus the platform can never use
that slug again. **S.** The list has to move somewhere both halves can read; a second copy is how the
weaker one survives a fix here.

### 3. Two check-then-insert races, both fail SAFE but both fail UGLY

`emailTaken` → insert, and `uniqueSlug`'s 25 SELECTs → insert, are each unlocked reads followed by a
write. `users.email` and `stores.slug` are both `UNIQUE` in the schema, so a concurrent duplicate is
refused by Postgres rather than duplicated — but it surfaces as an **unhandled throw**, i.e. a Next
error digest, not one of the messages this action is careful to return. Same shape as the voucher
`used_count` race, and the same fix: let the constraint be the lock and catch the violation.

### 4. No upper bound on `storeName` / `ownerName`

`storeName.length < 3` is checked; nothing checks the other end, and both columns are `text()`. Only
Next's server-action body limit bounds it. The value lands in `stores.name`, `accounts.name` and the
`platform_activity` line the control plane reads. Also: the **Google path skips even the `>= 3`
check** — `provisionStore` takes `profile.name` verbatim, and the length rules live in `register.ts`,
not at the boundary.

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

⚠️ **The HSTS half is NOT fixed** — it is a Cloudflare zone setting, not code, and it belongs with
**N2**. Until it lands, a first visit to `http://app.tokophi.com` still leaves the browser before the
301, and `Secure` only guarantees the *cookie* does not ride along.

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
