# Super Admin — the control plane reaches every tenant

> Moved **verbatim** from `AGENTS.md` on 2026-10-28 (Claude Code warns when `AGENTS.md` exceeds 150k chars, and it is
> loaded in full into every session). `AGENTS.md` keeps a short digest of the rules plus a pointer here; this file keeps
> the reasoning and the incident history. Words like "above"/"below"/"the next section" refer to the old single-file
> layout — follow the named file or section instead. **If this file and the code disagree, the code wins — fix this file.**


> ### 🔴 THE RULE: **the operator's RANK comes from `platform_admins`, on every request. Never from the cookie.**
> `getPlatformSession()` decoded the 7-day JWT and returned the claims verbatim — no DB read of any
> kind. Driven on 2026-08-03 against a live server, ONE cookie held constant while the row was mutated
> by SQL: an operator **demoted owner → support still minted a new platform operator**; so did one
> whose row had been **DELETED**; so did one whose **password had been rotated**. Four operator
> accounts created from one cookie that should have been dead after the first.
> The merchant side had re-read `store_users` since day one — that is why deleting a membership logs a
> merchant out. **The control plane, which reaches EVERY tenant, was the weaker of the two.**
> - The decision is `resolvePlatformSession` (`platform-session.ts`) — PURE, so it is tested; the same
>   split as `platform-rank.ts`, and for the same reason. Row gone ⇒ null. Password rotated after the
>   token was minted ⇒ null (`@tokophi/lib/session-revocation`, shared with the merchant side — ONE
>   implementation, because a copy is how the weaker half survives a fix). Role from the row.
> - **Cost:** one indexed PK lookup, once in the platform layout and once inside
>   `requirePlatformAdmin`. There is **no `react` `cache()` pattern in this repo** — the merchant's
>   `getSession()` is called far more often and is likewise uncached. Do not invent one for this.
> - ⚠️ **A dead-but-valid cookie makes the layout and the middleware redirect at each other**
>   (`ERR_TOO_MANY_REDIRECTS` — measured). Middleware runs on the edge and cannot ask the database, so
>   it sees a valid JWT and bounces `/login` back to `/`. The layout redirects to
>   **`/api/auth/signout`**, never straight to `/login`: a Server Component cannot delete a cookie and
>   a route handler can. `apps/admin` has the identical file for the identical reason.
> - **Operators can change their own password** — avatar menu → "Ubah kata sandi"
>   (`changePlatformPassword`). Gated on a SESSION, not a rank, deliberately: it acts on the caller's
>   own row, and a rank floor would stop a `support` operator rotating a leaked credential. The
>   current password is re-proved instead. Rotating revokes every other session (migration 0088) and
>   re-mints this tab's cookie with `iat` one second past the stamp.
>   **Resetting SOMEBODY ELSE's operator password still does not exist** — `NEXT.md` N47.

- 🔴 **IMPERSONATION IS A ONE-TIME EXCHANGE NOW, NOT A TOKEN — AND NOTHING REUSABLE MAY EVER GO BACK
  IN THAT URL** (Task 4.11 / SEC-10, 2026-08-21; closes `SECURITY.md` N1). "Buka Dashboard Seller"
  used to mint a session-shaped JWT and put it in the query string. It was signed, audience-pinned
  and expired in 2 minutes — and **reusable for every one of those 120 seconds**, because a JWT is
  *verified*, never *spent*. A URL is the worst carrier there is for a bearer credential: browser
  history, the next request's `Referer`, a reverse-proxy access log, a screen share, a pasted support
  ticket. There was nowhere to record that the link had been used, so replay was the design, not a bug.
  - **The handle is opaque**: 256 bits of `randomBytes`, no claims at all. The facts live in
    `impersonation_grants` (migration **0098**), which stores only `sha256(handle)` — a dump of that
    table redeems nothing.
  - **One statement is the whole security model**: `update impersonation_grants set consumed_at =
    now() where token_hash = $1 and consumed_at is null and expires_at > now() returning …`. One row
    ⇒ the exchange happened, exactly once. Zero rows ⇒ unknown, spent, or expired — and Postgres's
    row lock means two concurrent redemptions cannot both win. **Do not "simplify" that into a read
    followed by a write**; that is the same race `receivePurchaseOrder` already paid for.
  - **The grant is a permission to exchange, never a cached fact.** Membership, the merchant's role,
    the operator's row, the operator's rank and the operator's `password_changed_at` are ALL re-read
    at consume time — the control plane's standing rule, extended across the gap between minting a
    link and clicking it. ⚠️ The operator check is `role === grant.operator_role`, deliberately NOT a
    rank comparison: `platform-rank.ts` must stay ONE copy and `apps/admin` may not import it.
  - **The merchant session it mints is BOUNDED — 30 minutes, not 7 days** — and carries a signed
    `imp` (operator id + email + grant id). ⚠️ The cookie `maxAge` and the JWT `exp` are derived from
    the SAME constant (`@tokophi/lib/impersonation`); splitting them lets one outlive the other.
  - **Every gated write under impersonation names BOTH parties.** `requireCapability` — the one
    choke point every mutating admin action passes — writes a `platform_activity` row against the
    merchant's store naming the operator and the capability, and **fails closed** if it cannot. An
    operator write nobody can attribute must not happen. It records an *authorisation*, not an
    outcome, and the wording says so ("memakai izin").
  - **Exit is explicit**: `/impersonate/exit` deletes the cookie and logs the end. ⚠️ `middleware.ts`
    exempts `/impersonate` by **exact match** — a `startsWith` would exempt the exit too, and the
    exit reads the session it is about to end in order to name the operator.
  - Guards: `apps/admin/lib/impersonation.test.ts` (real Postgres: success · replay · concurrent
    replay · tamper · expiry · demotion · deletion · password rotation · membership removal · the
    30-minute bound; plus `codeOnly` claims that `jwtVerify` and `signImpersonation` stay gone) and
    `apps/admin/lib/rbac-impersonation.test.ts` (dual identity, fail-closed, no noise for a merchant's
    own session). Twelve mutations, twelve reds, recorded in `BUILD-LOG.md`.
- 🔴 **THE RANK IS NOW CHECKED AT ROUTE ENTRY TOO — ADDITIVE, NEVER INSTEAD** (Task 5.17 / SEC-9,
  2026-08-22). Every mutation had been rank-gated since 2026-07-15; no SCREEN ever was. The
  middleware proves a cookie exists (edge — it cannot ask the database) and the layout proves the
  operator row still exists; neither compared a rank. Measured on a live server with three real
  operator rows: `support` typing `/pencairan` was served the payout queue in full — every
  merchant's bank name, **account number**, holder and pending amount. The buttons refused, which is
  the boundary working; the DATA had already been read, rendered and sent.
  - **`lib/route-roles.ts` declares the floor per route group** (pure, no DB — same split as
    `platform-rank.ts`) and **`platformRouteGate(path)` is the FIRST await of every `(platform)`
    page**, above its first data read. It is NOT in the middleware and the rank is NOT in the
    cookie: the edge has no database, and rank comes from `platform_admins` on every request.
  - **The policy: the support desk and the context of ONE store are `support`; anything
    platform-wide about money or configuration is `admin`.** `/toko/[id]` stays `support` (a ticket
    about a withdrawal needs that store's own balance); `/` is `admin` because the dashboard IS MRR,
    revenue, merchant float and the latest invoices — **a summary of privileged data is privileged**,
    and drawing the line anywhere else leaks by the back door.
  - **A route floor is the LOWEST rank that can use the screen, never the highest.** `/pengaturan`
    hosts `admin`-rank actions beside `owner`-rank ones, so it is `admin`; the owner-only
    affordances keep refusing at their own gate. A floor above an action locks out the operator that
    action was written for.
  - ⚠️ **The dashboard FORWARDS (`redirect(gate.landing)`) instead of refusing, and it is the only
    page that does** — every login lands on `/`, so a `support` operator would otherwise meet a wall
    on every sign-in. ⚠️ **A denial renders with HTTP 200**: a Server Component cannot set a status
    without Next's experimental `authInterrupts`, and this surface is `noindex` with no machine
    consumers. ⚠️ **An unlisted route is `owner` — fail closed**, and `route-roles.test.ts` derives
    the page list from the DIRECTORY, so a new `page.tsx` fails the suite until it is classified and
    gated. Nine mutations, nine reds; the live per-role/per-route table is in `BUILD-LOG.md`.
- **`platformGate(min)` is the first statement of every mutating action** (33 call sites over 32 exported
  actions), and the rank is
  `support` 1 < `admin` 2 < `owner` 3. The ladder lives in `platform-rank.ts` — a PURE module, no DB
  import — because `platform-auth.ts` pulls `@tokophi/db` at module scope, which is why the rule
  guarding every super-admin mutation had no test until 2026-07-31. An unknown role scores 0: fail
  closed, so a typo'd or legacy `platform_admins.role` cannot inherit rank.
- ⚠️ **Handing over a merchant's account is OWNER-rank, whichever button reaches it.**
  `resetOwnerPassword` was correctly gated; `resetStoreUserPassword` beside it ran at `admin` and
  looked its target up by `userId` ALONE — no `store_users` join, no `storeId` filter — so a rank-2
  operator could reset ANY user row on the platform, including any store's owner, and `storeId` was
  used for nothing but the log line, so the audit trail could be pointed at the wrong store. Both
  gates now: membership in THIS store, and `owner` rank when the target is an owner.
- **Never mint a fixed password.** Invited operators used to get `DEV_PASSWORD` (`tokophi123`), never
  revealed and never forced to change — an email plus a well-known default was a working control-plane
  login. Random per invite, revealed once.
  - 🔴 **`createStore` was still on it (fixed 2026-08-01), and it is the worse half.** The
    `invitePlatformAdmin` fix left a comment claiming the other paths were already correct; they were
    not. Every store an operator onboarded got an OWNER `users` row hashed from `tokophi123`, so the
    **merchant's** email address alone was a working login at `app.tokophi.com` — every order (buyer
    name, WhatsApp, delivery address), every customer, and `settings:write` over the bank account.
    **The mint now lives in `@tokophi/lib/password`** (pure, no DB — same split as `platform-rank.ts`)
    and `apps/super-admin/lib/no-fixed-password.test.ts` fails if any `hashPassword()` in `actions.ts`
    is fed anything but a freshly minted `pw`, or if a minting action stops returning it.
  - 🔴 **ONE mint, in `packages/lib`, and it is 60 bits** (2026-08-03). There were **two**, and they had
    already drifted: super-admin minted `randomBytes(3)` = **24 bits** (16,7 M candidates) while
    `apps/admin/lib/actions/users.ts` kept a private `randomBytes(4)` = 32. **The weaker one was the one
    on the store-owner path** — a copy is exactly how the weaker number survives a fix. It is now
    12 symbols over a 32-symbol alphabet (Crockford base32: no `i`/`l`/`o`/`u`, so nothing is misread
    off a support screen) = **60 bits**; the `tokophi-` prefix is worth **0 bits** and is only a label.
    `packages/lib/src/password.test.ts` measures the **min-entropy of what the generator actually
    emits** and fails under **48 bits**, so shortening it, narrowing the alphabet or biasing the
    mapping all go red. It **scans every source file in the repo** (not a list of two, which is how a
    24-bit copy survived this very test once), and it pins `hashPassword` at one implementation too.
  - 🔴 **NO SHIPPED SCREEN MAY NAME AN ACCOUNT THAT AUTHENTICATES** (2026-08-03). Both login pages
    published one: `rich.tokophi.com/login` printed `admin@tokophi.id / tokophi123` AND pre-filled that
    address into the email field; the Seller panel did the same with the seeded owner. The seed
    genuinely creates those rows on deploy, so neither was a placeholder — they were working
    credentials, on the public internet, on the page that accepts them.
    ⚠️ **It was FOUR sites, not the two `Dev:` lines.** The `defaultValue` on each email input is the
    half that gets missed, and on the control plane it is the one that matters: it names *which account
    to attack*, and the limiter above is keyed on **IP, not account**, with **no failed login written
    anywhere**. `packages/lib/src/no-published-credentials.test.ts` scans EVERY app source (not a list
    of two — that is how the 24-bit mint survived its own guard) and strips `//` + `/* */` comments so
    the notes explaining this fix stay legal. **HTML comments are not stripped: `<!-- … -->` in an
    `.astro` file is served to the browser.**
    ✅ **The SEED is fixed too (N29, 2026-08-05).** `packages/db/src/seed.ts` mints a fresh 60-bit
    password **per account** and prints them **once** at the end of the run — that print is the only
    copy that will ever exist. `SEED_OWNER_PASSWORD=<yours>` pins them all to one string for local
    dev (and refuses a published default like `tokophi123`, which would put the defect straight back).
    `password.test.ts` no longer exempts the seed: its repo-wide sink scan now covers every tracked
    file with nothing carved out, so a fixed password anywhere goes red.
    ⚠️ **The ROWS are still unchanged, and that is not an oversight** — **the seed is not a migration**,
    so every deployment that already exists still authenticates with `tokophi123` until somebody
    rotates it. That is a PROCEDURE, not a deploy:
    `specs/docs/tasks/2026-08-03-rotate-exposed-owners.md` §② (use the UI for stores, raw SQL only for
    the operator), §③ (one password per account) and §⑤ (which order, and which account **not** to
    touch). Measured there: 7 of 8 store owners plus the operator. **Rotate the accounts that were
    measured, never the table.**
  - **A login rate-limit DOES exist — but it is a floor, not a wall, and it is keyed on IP ALONE.**
    `signIn` on both panels calls `rateLimit()` from `@tokophi/lib/cache` **before** the scrypt check
    (`login:admin:<ip>` 15/min, `login:platform:<ip>` 10/min, shipped `53dd9ee` 2026-07-16).
    ✅ **BOTH of the things this bullet used to say it does NOT do are now closed** (Task 6.3,
    2026-09-09 · N62, 2026-08-06). The counter is no longer an in-process `Map`: it is ONE ROW PER KEY
    in `rate_limit_counters` (migration **0106**), bumped by a single atomic
    `insert … on conflict do update … returning`, so it survives a redeploy and spans replicas. And
    the per-ACCOUNT half exists — `recordFailedLogin`/`failedLoginLocked` count consecutive failures
    per email (audit rows at 5/25/125…, sign-in refused at 25), and that streak is bumped into the
    same shared row, so a distributed grind can no longer reset it by waiting for a deploy.
    ⚠️ **TWO THINGS IT STILL DOES NOT DO, AND THE FIRST IS THE ONE PEOPLE ASSUME.** The decision is
    made from a process-local cache and the shared count is merged back WRITE-BEHIND, because every
    call site is `if (!rateLimit(...).ok)` and a synchronous function cannot do I/O — so the FIRST
    call for a key on a freshly started process is answered before the shared count is known (one
    request per key per replica, where it used to be a whole fresh quota), and a burst arriving inside
    one round-trip can overshoot by the number of requests in flight. Making `rateLimit` async is a
    one-word edit at each of its ~20 call sites and is the shape to move to. Second: a failed login is
    still written to no table — `recordFailedLogin` returns audit TEXT that `signIn` writes to
    `platform_activity` on a threshold, which is a witness, not a log. The mint's entropy remains the
    load-bearing half of this pair.
  - **A password the UI drops on the floor is worse than the bug** — the merchant cannot log in and
    nobody can say why. Each minting action returns `password`; the callers show it ONCE
    (`toko-client.tsx` + `pengaturan-client.tsx`: a `duration: Infinity` toast that survives the
    `router.push`; `store-detail.tsx`: the credential dialog). Same two-file rule as thrown errors.
  - 🔴 **AND THE MIRROR OF IT: never REPORT a credential you did not WRITE** (fixed 2026-08-03).
    `addStoreUser` minted `pw` unconditionally, hashed it only inside `if (!u)` — the branch that
    creates a new `users` row — and returned it either way. So adding an email that **already**
    belonged to someone here produced a "here is their new password" dialog for a string that had
    never been hashed into any row. Measured: the revealed `tokophi-…` verified against the stored
    hash as **false**. The operator reads it out, it does not work, and nothing on any screen explains
    why — the string is well-formed and the operation reported success.
    ⚠️ **Do NOT "fix" that by rehashing.** Silently resetting an existing person's password because
    someone added them to a second store locks them out of the first, with no message either. The
    action now mints INSIDE the branch that writes the hash and returns
    `password: string | null` + `outcome: "created" | "linked"`; `store-detail.tsx` shows the dialog on
    one path and says *"Akunnya sudah ada, jadi kata sandinya TIDAK berubah"* on the other. `outcome`
    is its own field on purpose — "no password" and "no password was NEEDED" read identically at a
    call site and only one of them is good news. Pinned by `apps/super-admin/lib/add-store-user.test.ts`
    (both files; proved red against three separate mutations before being trusted).
  - 🔴 **THE SELLER'S OWN INVITE HAD THE SAME HOLE FROM THE OTHER SIDE, PLUS A RACE THAT WAS THE
    COMMON CASE** (Task 5.3 / SEC-15, 2026-08-22). `inviteStoreUser` was read-then-write against
    `users.email`, and **19 of 20 concurrent double-invitations threw `users_email_unique` out of the
    server action** (measured, real Postgres) — a rejected promise the dialog never catches, so no
    toast at all, while the database had converged on one account and one membership **every time**.
    The throwing path had already minted a password. Both inserts are now
    `on conflict do nothing … returning`, and **the returned row is the only thing allowed to decide
    what is reported**: a row came back ⇒ we wrote it ⇒ the credential may be revealed; nothing came
    back ⇒ re-read the row and report what IT says. The reply is a discriminated union on `outcome`
    (`created` · `linked` · `already_invited` · `already_accepted` · `failed`) with `password`
    present on every branch — the caller used to decide "created" from `if (r.tempPassword)`, which
    is the same ambiguity one bullet up.
    ⚠️ **`store_users.accepted_at` is NOT written by the invitation.** It used to be
    `{ invitedAt: now, acceptedAt: now }` — identical to the millisecond — so the row asserted that
    somebody accepted an invitation at the instant the OWNER pressed the button, and
    `getStoreUsers` selected the column only to discard it: written falsely, read never. **`signIn`
    stamps it now**, once (`where … and accepted_at is null`), in a `try/catch` that never throws
    into the login path. The team list renders **only** the `null` case ("Belum pernah masuk"):
    pre-5.3 rows carry the invite's timestamp, so `null` proves "never signed in" while non-null
    proves nothing.
    ✅ **AND THE CONTROL PLANE'S HALF IS CLOSED TOO** (2026-08-22, the Stage 5 super-admin stream —
    it owned those files that day). `addStoreUser` no longer writes `acceptedAt` at all: the column
    has **no database default**, so NULL lands (measured), and NULL is the truth. `getStoreUsers`
    stopped deriving `acceptedDaysAgo` — nothing rendered it, and a non-null value on a pre-fix row
    is the invite's timestamp, so publishing a days-ago number would be a measurement with nothing
    behind it. ⚠️ **`createStore` / `provision.ts` KEEP the stamp for the store's own OWNER,
    deliberately** — that account is created, not invited. **Judge each site; do not sweep**; both
    directions are pinned by `apps/super-admin/lib/add-store-user.test.ts` (3 mutations, 3 reds).
    ⚠️ **A CONCURRENCY TEST THAT MERELY FIRES TWO PROMISES IS A COIN TOSS.** Both races here are
    FORCED, by a `pg_sleep(0.3)` trigger holding the first transaction open inside its `store_users`
    insert — the second caller then reliably runs its `select` against an uncommitted row and blocks
    on the unique index. And the mutation that matters (`password` assigned before the insert is
    known to have won) was **green** against the single-store race, because its loser is
    `already_invited`, whose reply is a literal `null` either way: the reachable shape is **two
    different stores** inviting one new address at once, where the loser writes a real membership and
    returns a success. `apps/admin/lib/actions/users.test.ts`, 7 tests, 8 mutations.
- **Never anchor a date to the seed.** `health.ts` measured recency from a frozen `2026-07-02`, so a
  store 34 days dormant read "5 days, ok" and a live one read **−23 hari**. `data.ts` had already been
  migrated off that anchor; the healthcheck was missed. Same rule as the discount editor.
  - `createStore` did it in a **write** (fixed 2026-08-01): `created_at`/`accepted_at` = the anchor
    while `trialEndsAt` = `Date.now()`, so a store was born ~30 days old with a 3-day trial in one
    INSERT — and store health, "0 hari lalu" and the trial countdown all disagreed from birth. The
    columns default to `now()`; don't set them. Pinned by the same test.
