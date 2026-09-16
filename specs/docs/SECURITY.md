# Security Architecture

**What this document owns:** trust boundaries, identity/authorization, tenant isolation, transport,
secret and key handling, encryption at rest, abuse controls — and the gaps we know about and have
chosen to live with.

**What it does NOT own.** Findings live in `AUDIT-SUMMARY.md` and `tasks/OPEN.md`; this is the
standing shape, not a worklist. Compliance applicability (UU PDP, GDPR, SOC 2) is a **separate,
unwritten document** — deferred deliberately while the product is in beta. Nothing here is a
compliance determination.

Every claim below is labelled **Observed** (measured on a running system or read from code),
**Decision** (a deliberate choice, with its reason), or **Gap** (known and unfixed). An unlabelled
sentence is a bug in this document.

Last measured **2026-08-05** against `origin/main` and production. Re-verification commands are §11.

---

## 1. The surfaces, and what each one is trusted with

| surface | host | who reaches it | what it can do |
|---|---|---|---|
| Storefront | `<slug>.tokophi.com`, `toko.` | the public | read one tenant's catalog, write `checkout_sessions` |
| Seller (admin) | `app.tokophi.com` | a merchant's staff | everything inside ONE store |
| Super Admin | `rich.tokophi.com` | us | **every tenant**, billing, impersonation |
| Public API | `app.tokophi.com/api/public/**` | the public, no session | quote shipping, place orders, redeem vouchers, receive payment callbacks |
| Landing | `tokophi.com` | the public | static, no DB |

**Observed:** the Public API is the only unauthenticated *write* surface in the product. It is served
by the admin app rather than the storefront **(Decision)** so the platform's KiriminAja and AutoLaris
credentials never enter the storefront container.

---

## 2. Identity

- **Observed.** Passwords are **scrypt**, stored `salt:hash` (`apps/admin/lib/auth.ts`). Comparison is
  `timingSafeEqual`.
- **Observed.** Sessions are **jose JWT in an httpOnly cookie**, 7 days, signed with `AUTH_SECRET`.
- **Observed.** All **seven** session-cookie writers go through `@tokophi/lib/session-cookie`:
  `httpOnly · sameSite=lax · path=/ · secure` (secure = `NODE_ENV === "production"`, verified `true`
  inside the running container). Guarded by a repo-wide sink scan that fails on a hand-written options
  object.
- **Decision.** Generated passwords are **60 bits** over a 32-symbol Crockford alphabet, one
  implementation in `@tokophi/lib/password`. `password.test.ts` measures the generator's real
  min-entropy and fails under 48 bits.
- **Observed.** A password change **revokes every other session** (`@tokophi/lib/session-revocation`,
  migrations 0087/0088) — one implementation shared by merchant and platform sides.

> ### 🔴 The operator's rank is re-read from `platform_admins` on every request. Never from the cookie.
> **Observed, driven against a live server 2026-08-03:** with the JWT held constant, an operator
> demoted to `support`, one whose row was **deleted**, and one whose password had been **rotated** all
> still minted new platform operators. The merchant side had re-read `store_users` since day one; the
> control plane — which reaches every tenant — was the weaker half. Fixed in `platform-session.ts`.

**Gap.** **No failed login is written anywhere** — no table, no audit row, no log line. Combined with
IP-keyed rate limiting (§9), a sustained attack against one named account is invisible. This is why
the mint's entropy is load-bearing rather than a nice-to-have.

---

## 3. Authorization

- **Observed.** Every mutating merchant action begins with `await requireCapability("<cap>")`
  (`apps/admin/lib/rbac.ts`). The UI's `useCan` is convenience, never the boundary.
- **Observed.** The role→capability matrix is `lib/rbac-policy.ts`. `admin` is derived by
  **subtraction** from `ALL_CAPABILITIES`, so a new owner-only capability leaks to Admin unless
  excluded explicitly. **`rbac-census.test.ts` pins the class**: a `Record<Capability, …>` that fails
  `tsc` *and* vitest until someone classifies the new capability.
- **Observed.** Super Admin has its own ladder — `support` 1 < `admin` 2 < `owner` 3
  (`platform-rank.ts`, pure, no DB import). An unknown role scores **0**: fail closed.
- **Decision.** Handing over a merchant's account is **owner-rank on every route that reaches it**.
  `resetStoreUserPassword` once ran at rank 2 and looked its target up by `userId` alone — no store
  filter — so a rank-2 operator could reset any user on the platform.

---

## 4. Tenant isolation

- **Observed, re-verified on production 2026-08-05 (`npm run verify-rls`):** RLS is enabled on
  **51 of 52** store-scoped tables. The one exception is `platform_activity` — the platform's own
  audit log, cross-tenant by design, written before a session exists.
- **Observed.** Merchant reads run inside `withCurrentTenant`, writes inside `withTenant`: a
  transaction that sets `app.store_id` and `SET LOCAL ROLE tokophi_app`, so tenant queries execute as
  a **non-owner** role with policies applied.
- **Observed (Task 4.12 / SEC-18, 2026-08-22).** `withTenant` now runs on its **own pool** (`appDb`,
  from `APP_DATABASE_URL`) wherever `DATABASE_RUNTIME_ROLE=app`, so the restriction is a property of
  the *connection* rather than of the last statement anyone ran on it — `SET LOCAL ROLE` does not
  survive a `RESET ROLE`, and says nothing about a connection that is a superuser to begin with.
  `@tokophi/db` proves the role against `pg_roles` (`current_user` **and** `session_user`: no
  superuser, no BYPASSRLS, and able to assume `tokophi_app`) **once per process, before the first
  tenant query**, and `process.exit(1)`s if it cannot. There is no owner fallback: the label used to
  resolve to `DATABASE_URL` when `APP_DATABASE_URL` was absent, which is how every app service ran as
  `rolsuper = t, rolbypassrls = t` while claiming to be restricted.
- **Decision.** Auth, Super Admin and the storefront stay on the owner connection — there is no
  session/tenant yet, the surface is deliberately cross-tenant, or the read is Host-resolved catalog.
  ⚠️ **This is now MEASURED, not merely chosen.** All 50 policies are `TO PUBLIC`, so they apply to
  any role without BYPASSRLS; with no `app.store_id` GUC, `app_current_store_id()` is NULL and every
  policed table returns nothing. On production as `tokophi_app`: `stores` **0**, `store_users` **0**,
  `products` **0** (owner sees 14 / 13 / 78) — RLS filtering, not a missing grant. Moving those
  surfaces onto the restricted role would delete the login page, 404 every shop and empty the control
  plane. Super Admin and the storefront have **zero** `withTenant` call sites and are therefore
  declared `DATABASE_RUNTIME_ROLE: owner`; admin is `app`.
- 🔴 **`FORCE ROW LEVEL SECURITY` IS NOT THE MISSING HARDENING — MEASURED ON PRODUCTION 2026-08-22, AND
  IT IS THE WRONG CHANGE FOR THIS DESIGN.** It has been carried as an open owner decision ("0 of 54
  tables are forced") since Task 4.12's preflight. It is now closed by measurement, in a rolled-back
  transaction against a scratch table so no real table was touched:

  | owner of the table | RLS | rows the OWNER sees through a `USING (false)` policy |
  |---|---|---|
  | `tokophi` (**superuser**, owns all 81 tables) | enabled | **1** — bypassed |
  | `tokophi` (**superuser**) | enabled **+ FORCED** | **1** — still bypassed |
  | a non-superuser role | enabled | 1 — owner bypass |
  | a non-superuser role | enabled **+ FORCED** | **0** — bound at last |

  Two conclusions, and they point the same way:
  1. **Today it would change nothing.** PostgreSQL lets a superuser bypass row security
     *unconditionally*; `FORCE` binds a table's OWNER, and cannot bind a superuser. Applying it to 54
     tables would produce a migration, a changelog line and the appearance of a closed gap, with
     identical behaviour — the exact shape of defect this document exists to catch (see the
     `DATABASE_RUNTIME_ROLE=app` label that was true of nothing for months).
  2. **The day the owner is demoted, it would be an outage.** Auth's pre-session read, the
     storefront's Host resolution and every Super Admin read are cross-tenant **by design** and run on
     the owner connection. Forced, they return 0 rows — the same failure measured for `tokophi_app`
     two bullets up.

  **What would actually reduce privilege** is demoting `tokophi` from `rolsuper` while leaving the
  tables *unforced*: owner-bypass keeps those three paths alive, and the connection loses superuser
  powers (server-side file access, role management, DDL beyond its own objects). ⚠️ **Prerequisite,
  measured the same day:** `tokophi` holds **no membership** in `tokophi_app` (`pg_auth_members`: 0
  rows) — `SET ROLE tokophi_app` succeeds today *only* because superuser may assume any role. Demoting
  without `GRANT tokophi_app TO tokophi` breaks anything still doing that. The only installed
  extension is `plpgsql` and `app_current_store_id()` is **not** `SECURITY DEFINER`, so neither blocks
  the demotion; the open question is whether the deploy-time `migrate`/`seed` chain needs superuser for
  any statement it runs. **Not attempted here — it is a deploy-path change, not a migration.**
- ⚠️ **`stores` is keyed by `id`, not `store_id`**, so `verify-rls` structurally could not see it.
  That blind spot leaked two merchants' data until `0058` added an id-based policy. **The `WHERE` is
  the rule; the policy is only the net.**
- 🔴 **The child-table rule.** 11–12 store-scoped tables have no `store_id` and no RLS, and
  `tokophi_app` holds full DML on them. Before any write, every id the row is keyed on must have been
  read back from an RLS-protected table **inside the same transaction**. This class has produced
  **five** shipped cross-tenant bugs.

**Gap (N16).** `0012_tenant_rls.sql` grants `tokophi_app` full DML on *all* tables and there is no
`REVOKE`; the `stores` policy is `FOR ALL`, so a tenant can UPDATE its own `comped`/`status`. Needs an
architecture decision before the PostgREST cutover.

---

## 5. Transport and edge

> ### 🔴 THIS SECTION DESCRIBED ONE ZONE. THERE ARE TWO, AND THE OTHER ONE CARRIES THE SHOPPERS.
> Corrected 2026-08-07. `tokophi.id` is a **separate** Cloudflare zone (`4ba39c04…`) and it is where
> merchant storefronts serve — `<slug>.tokophi.com` 301s to `<slug>.tokophi.id`. The platform surfaces
> go the other way: `app.tokophi.id` / `rich.tokophi.id` 301 **to `.com`**. Everything below is `.com`.
>
> | | `tokophi.com` | `tokophi.id` |
> |---|---|---|
> | HSTS | `31536000; includeSubDomains` | `31536000; includeSubDomains` ✅ 2026-08-07 |
> | `ssl` | `strict` | `strict` ✅ 2026-08-07 |
> | `min_tls_version` | 1.2 | **1.0** — open, T-4 (a compatibility call, not a pure security one) |
> | origin certificate | `*.tokophi.com` + `tokophi.com` | `*.tokophi.id` + `tokophi.id` ✅ 2026-08-07 |
>
> ⚠️ **How `.id` came to be weaker, because the shape is worth remembering.** Traefik serves ONE
> `defaultCertificate` to any host without its own — that is what gives every `<slug>` TLS, since Let's
> Encrypt cannot wildcard over HTTP-01. That default was `.com`-only, so `.id` hosts were handed a
> certificate for the wrong name, and Cloudflare accepted it purely because `.id` ran `ssl: full`, which
> does not validate the origin. `full` was **load-bearing**, not laziness: `strict` could not have worked.
> Fixed by issuing a SECOND Origin CA certificate for the `.id` names and adding it to Traefik's list —
> the default is still `.com`, so nothing that already worked depended on the change. `T-3` has the order.


- **Observed 2026-08-05.** All six DNS records are **Cloudflare-proxied**; none DNS-only, no MX. That
  is a standing requirement — the wildcard's TLS is a Cloudflare **Origin CA** cert that browsers do
  not trust directly.
- **Observed.** `ssl = strict` · `min_tls_version = 1.2` · `always_use_https = on`.
- **Observed.** **HSTS `max-age=31536000; includeSubDomains`**, `preload` **off**, verified on all six
  hosts including a tenant subdomain.
- 🔴 **Decision with a consequence that outlives the setting.** HSTS cannot be withdrawn early:
  disabling it stops us *sending* the header but does not reach a browser that already holds one,
  which refuses `http://` for this domain and every subdomain for up to a year from its last visit.
- ✅ **SETTLED 2026-08-22 (owner) — the merchant's own domain carries it too, at a year.** Custom
  hostnames are wired, and the header is emitted **at the origin** by the Traefik middleware
  `tokophi-custom-hsts` (`/data/coolify/proxy/dynamic/tokophi-custom-domains.yaml`), not by the zone:
  whether Cloudflare's zone-level HSTS reaches SaaS custom-hostname traffic is undocumented, so the
  origin header is the certain one. It walked the same ladder `.com` and `.id` did — live at `86400`
  from 2026-08-11, raised to `31536000` on 2026-08-22 after eleven quiet days, hot-reload, no deploy.
  Measured immediately after on all four hosts: `taniniaga.com` 200, `www.taniniaga.com` 301,
  `beautyinu.co` 200, `www.beautyinu.co` 301 — every one `max-age=31536000; includeSubDomains`.
  `preload` stays **off**.
  🔴 **What the merchant is now signed up to, stated plainly:** `includeSubDomains` at a year means
  every subdomain of their domain is pinned to https in any browser that has visited, including
  subdomains TokoΦ does not serve, and it survives them leaving the platform — a browser that holds
  the pin refuses `http://` there for up to a year from its last visit. Certs are Cloudflare-managed
  and auto-renew, so the pin is safe to honour while the domain is with us. **Say this to a merchant
  before attaching their domain, not after.**
  ⚠️ The middleware attaches **per router**, so every future `Host()` block must list
  `tokophi-custom-hsts` or that domain ships bare and nothing reports it.

---

## 6. Secrets and key management

- **Decision — fail closed.** `AUTH_SECRET` missing or weak in production **throws**
  (`@tokophi/lib/secret`). The throw is **lazy**, at first use rather than module load, because
  `next build` runs with `NODE_ENV=production` but without runtime env.
- **Decision (Task 8.33, 2026-09-17) — provider credentials are MANAGED FROM SUPER ADMIN and stored
  ENCRYPTED; the container env is the fallback.** KiriminAja (one key per environment) and AutoLaris
  live in `shipping_aggregator.sandbox_key_enc` / `production_key_enc` and
  `platform_payment_gateways.credentials_enc` (migration 0111), AES-256-GCM under
  `INTEGRATION_TOKEN_KEY` with the column as GCM scope (`provider:kiriminaja:<env>`,
  `provider:autolaris:key`) — a blob moved between columns does not decrypt. **Precedence: DB row >
  env var** (`@tokophi/lib/provider-config`, one resolver, cached in-process for 60 s and
  invalidated by the writers), so a deploy that never opened the card keeps reading
  `KIRIMINAJA_API_KEY` / `KIRIMINAJA_ENV` / `AUTOLARIS_API_KEY` exactly as before. The keys are
  never in the repo and never returned to a browser: the card shows `maskKey()` — the last four
  characters — and the last successful test time; `api/health/env` reports only the SOURCE
  (`db` / `env` / `none`) per key. Writing a key or flipping `active_env` is **owner rank**
  (`saveProviderCredentials`, `setProviderEnv`), audited to `platform_activity` with the operator's
  e-mail and the masked tail, and both REFUSE unless the key just passed a live test against the
  environment it is for — so a stored key is always one that worked, and the environment can only
  move onto a proven key (N35: a sandbox booking is shaped like a production one, so a switch onto
  a dead key would look healthy). Pinned by `packages/lib/src/provider-config.test.ts` and
  `apps/super-admin/lib/provider-credentials.test.ts` (five mutations, five reds).
- **Observed.** `packages/lib/src/no-published-credentials.test.ts` scans **every** app source for a
  credential printed on a shipped screen. It exists because both login pages once published a working
  account — and it was **four** sites, not the two visible `Dev:` lines: each email input's
  `defaultValue` named *which account to attack*.
- **Gap, procedural not code.** The seed now mints per-account passwords, but **the seed is not a
  migration**: deployments created earlier still hold the old credential until rotated by hand.
  Procedure: `tasks/2026-08-03-rotate-exposed-owners.md`. **Unrun** (N29).
- 🔴 **Decision (SEC-16, Task 4.13, 2026-08-21) — a reusable first-party secret never goes in a URL,
  and nothing here mints one any more.** Two credentials used to travel that way:
  - **`CRON_SECRET`** — all five compose sidecars sent `?secret=$CRON_SECRET` to the routes that
    suspend stores, raise invoices, cancel orders and restore stock across **every tenant**, and all
    six gated routes (five cron + `/api/health/env`) accepted it. It is now the `x-cron-secret`
    **header** only, in one shared gate (`apps/admin/lib/cron-auth.ts`); a request that supplies
    `?secret=` is refused **and logged**, so a caller left behind on the old shape is visible rather
    than merely 401. There was no vendor on this path — both ends are ours — so it is fully closed.
  - **`AUTOLARIS_CALLBACK_SECRET`** — `payCallbackUrl()` embedded the secret verbatim in every bill's
    `callback_url`. It now emits a **per-payment HMAC** over the `reff_id` (`?cb=<reff>.<sig>`), and
    `/api/public/pay/callback` binds that signature to the row it resolves, so a leaked callback URL
    authorises one payment instead of every payment on the platform.
- ⚠️ **Documented provider exception, the one SEC-16 allows for: the callback still ACCEPTS
  `?token=<secret>`.** AutoLaris echoes `callback_url` and attaches no headers of its own, so until
  the vendor confirms it can send `X-Callback-Token` (or its own signature — PROD_PLAN §7), refusing
  that parameter would 401 every genuine payment. It is unbound and therefore the weakest of the
  three transports; every use is logged as deprecated, and no new bill carries one. **Closing it is a
  vendor conversation, not a code change** — pinned as a knowingly-open door by
  `apps/admin/app/api/public/pay/callback/route.auth.test.ts`.

---

## 7. Encryption at rest

- **Observed.** There is **exactly one** at-rest cipher in the repo: `@tokophi/lib/crypto`
  (AES-256-GCM via `createCipheriv`; `apps/admin/lib/crypto.ts` re-exports it and carries the
  `server-only` guard), used for **CAPI tokens** in `store_tracking_channels` and, since Task 8.33,
  for the platform's own **provider keys** (§6). Both bind the ciphertext to its row/column through
  the GCM scope.
- **Decision.** Its key is derived with **scrypt**, not a bare SHA-256, because the env var is allowed
  to be a human-chosen string; scrypt makes offline GPU cracking expensive. Derived once and cached.
- **Observed, and state it plainly:** everything else — orders, customer names, phone numbers,
  delivery addresses, bank details — is **plaintext in Postgres**, protected by database access
  control and disk, not by application-layer encryption. That is the normal posture for this
  architecture; it is written down so nobody assumes otherwise.

---

## 8. The public API boundary

- **Observed.** Bodies are read through `readPublicBody()`, never `req.json()` — which has **no size
  ceiling** in a Route Handler (measured: a **64 MB** body accepted, buffered and parsed). The cap
  counts the *stream*, not `Content-Length`, because a chunked upload declares none.
- **Observed.** `items[]` is capped at **100** on the raw array. `/api/public/order` does four
  sequential DB round-trips per element: measured, 10.000 items = **50.498 index scans and 63,8 s in
  one request**.
- **Decision (ADR 0004).** A provider's own error text never reaches a shopper. It did — the
  aggregator answered *"kurir … tidak terdaftar di sistem kami"* in the first person on a merchant's
  checkout, and the gateway's `ket` went out as `payError`. The seller-facing path keeps the
  provider's words, because the merchant is who acts on them.
- **Decision.** There is deliberately **no bot gate** on these four routes. `isBot()` treats an empty
  User-Agent as a bot, and a privacy browser would have its order refused with nobody able to find
  out. Rate limit + caps are the floor; the wall is Cloudflare.
- **Decision.** `storeSlug` in the body **is** the tenant selector here and is correct — these routes
  are served by `app.` while the shopper is on `<slug>.`, so the Host carries no tenant. Filed once as
  a cross-tenant bug; it is not one.

---

## 9. Abuse controls — every limit, with its real value

**Observed** (`git grep -oE 'rateLimit\(...'`, 2026-08-05):

| key | limit | window | what it protects |
|---|---|---|---|
| `login:admin:<ip>` | 15 | 1 min | merchant login, before the scrypt check |
| `login:platform:<ip>` | 10 | 1 min | **control-plane** login |
| `signup:admin:<ip>` | 5 | 10 min | store creation **and** the email-existence oracle |
| `paycb:<ip>` | 60 | 1 min | payment callback |
| `tracking-retry:<storeId>` | 5 | 1 min | provider quota |
| `tracking-test:<storeId>:<channel>` | 10 | 1 min | provider quota |

| `order:<ip>` | 10 | 1 min | the only unauthenticated WRITE surface |
| `ongkir:<ip>` | 60 | 1 min | live courier quote (provider quota) |
| `promo:<ip>` | 30 | 1 min | voucher lookup |
| `chat:*:<ip>` / `chat:send:v:<visitor>` | see `LIMITS`, `apps/storefront/src/lib/chat.ts` | 1 min / 1 h / 10 min | shopper ⇄ merchant chat |
| `loginfail:<surface>:<email>` | audit at 5/25/125… · **sign-in refused at 25** | 15 min idle | the per-ACCOUNT brake an edge rule cannot be |

Over-limit answers **429** with `Retry-After` in whole seconds (`rateLimited()`,
`apps/admin/lib/public-guard.ts`); the two login doors return a Bahasa
`"Terlalu banyak percobaan…"` from the server action instead, since they render, not respond.

✅ **THE COUNTER IS SHARED SINCE 2026-09-09** (Task 6.3 / NF-6, migration **0106**). It used to be an
in-process `Map` that reset on every redeploy and did not span replicas, and code had been written
here assuming otherwise. It is now one row per key in `rate_limit_counters`, bumped by a single
atomic `insert … on conflict do update … returning` — the read, the window roll and the increment
under one row lock, so two replicas cannot both observe the same count. It also no longer counts
**IPs only**: `loginfail:<surface>:<email>` is keyed on the account, which is the half a Cloudflare
rule could never do (the address lives in the POST body of a server action).

⚠️ **WHAT IS STILL TRUE.** The decision is served from a process-local cache and the shared count is
merged back **write-behind**, because every call site is `if (!rateLimit(...).ok)` and a synchronous
function cannot do I/O. Consequences, measured: the first call for a key on a freshly started
process is answered before the shared count is known — **one request per key per replica, where it
used to be the whole quota, on every deploy** — and a burst inside one round-trip can overshoot by
the number of requests in flight. `login:*` and `signup:*` fail **CLOSED** when the shared counter is
known-broken (they already need the database on the next line, so this adds no outage); `order`,
`ongkir`, `promo`, `paycb` and `chat` fail **OPEN**, because refusing a real shopper for a fault of
ours is the worse bug. The list is pinned by `packages/lib/src/rate-limit.test.ts`. Cloudflare Rate
Limiting remains the right OUTER wall — it absorbs volume before it costs a round-trip — and is a
recommendation this repository cannot implement (zone configuration).

---

## 10. Known gaps we are living with

| gap | why it is acceptable today | what would change that |
|---|---|---|
| **No app-wide CSP.** Only `SVG_SANDBOX` on uploaded SVGs and `nosniff` on the uploads route. | The storefront renders no third-party HTML except `/lp/<slug>` (below). | Any user-supplied HTML on a normal page. |
| 🔴 **`/lp/<slug>` `set:html` EXECUTES.** A `<script>` in pasted landing HTML **runs**, on the shop's origin, on the page carrying the COD order form. No sanitizer, no CSP. | Gated behind `landing:html` — **owner only** — and the admin now says so truthfully instead of claiming scripts are stripped. | A staff-writable path to it, or a real sanitizer/CSP being cheap. ⚠️ **Do not "fix" with a regex stripper** — `onerror=`, `javascript:`, `<iframe srcdoc>` and SVG handlers are not `<script>`. |
| **No failed-login audit.** | Small operator set, 60-bit mints. | Any real user base. |
| **Write-behind rate limits.** The count is shared (0106) but the DECISION is served from a process-local cache one round-trip stale. | A redeploy now leaks one request per key per replica instead of a whole quota; production runs one replica per surface. | Making `rateLimit` async at its ~20 call sites, which turns the merge into a read-before-decide. |
| ✅ **N1 — CLOSED 2026-08-21 (Task 4.11 / SEC-10).** The URL carried a 2-minute session-shaped JWT: verified, never spent, so REUSABLE for its whole life from history, `Referer`, proxy logs or a pasted ticket — and the session it minted lasted 7 days with no operator marker on it. | The URL now carries a 256-bit **opaque** handle backed by `impersonation_grants` (0098), spent by one atomic `update … where consumed_at is null and expires_at > now()`. Replay/tamper/expiry all match zero rows. The session is **30 minutes** and carries the signed operator identity, which `requireCapability` writes into `platform_activity` on every gated write; `/impersonate/exit` ends it on demand. | It is closed — do not reopen it by putting any signed token back in a URL. `apps/admin/lib/impersonation.test.ts` fails if `jwtVerify` returns to the route or `signImpersonation` comes back. |
| **N16 — `tokophi_app` DML on platform tables.** | Enforced by app code today. | The PostgREST cutover. |
| **No compliance document.** | Beta; deferred deliberately. | Leaving beta, or the first real DSAR. |

---

## 11. How to re-verify this document

```bash
npm run verify-rls -w @tokophi/db          # tenant isolation, table count
npm test                                    # includes rbac-census, no-published-credentials, password entropy
git grep -oE 'rateLimit\(`[^`]+`, *[0-9]+, *[0-9_]+' -- apps/ packages/   # §9 table
for h in tokophi.com app.tokophi.com rich.tokophi.com toko.tokophi.com batiknusantara.tokophi.com; do
  curl -sI https://$h/ | grep -i strict-transport-security; done          # §5
```

Zone settings (`ssl`, `min_tls_version`, `always_use_https`, `security_header`) are read with the
Cloudflare API — procedure in `CLOUDFLARE-PERF.md` §4.

⚠️ **`verify-rls` and `verify-ledger` default to the LOCAL DEV database.** To check production, run
them where the credential already lives rather than exporting it:
`docker exec -w /app/packages/db <admin-container> /app/node_modules/.bin/tsx src/verify-ledger.ts`.
