# The public API (`apps/admin/app/api/public/**`)

> Moved **verbatim** from `AGENTS.md` on 2026-10-28 (Claude Code warns when `AGENTS.md` exceeds 150k chars, and it is
> loaded in full into every session). `AGENTS.md` keeps a short digest of the rules plus a pointer here; this file keeps
> the reasoning and the incident history. Words like "above"/"below"/"the next section" refer to the old single-file
> layout — follow the named file or section instead. **If this file and the code disagree, the code wins — fix this file.**


`ongkir` · `order` · `promo` · `pay/callback`. The only unauthenticated write surface in the
product, and until 2026-08-03 invisible to two repo-wide guards (a `public`-directory skip). Audited
end-to-end on 2026-08-05 by DRIVING it, not by reading it.

- 🔵 **`storeSlug` IN THE BODY IS THE TENANT SELECTOR HERE, AND IT IS CORRECT. Do not "fix" it to
  the Host header — that fix is not implementable.** This has now been filed as a cross-tenant bug
  once; the reasoning is here so it is not filed again.
  These routes are served by **`app.tokophi.com`** while the shopper is on **`<slug>.tokophi.com`**
  — that is why every one of them carries CORS headers and why three of them have a long comment
  about an uncaught throw arriving without them. **The `Host` on these requests is always the admin
  app's own hostname; it carries no tenant.** `checkout-session.ts` genuinely can take the tenant
  from the Host (ADR 0009) because it lives IN the storefront, same-origin, where `locals.store` is
  a real fact — and the comment there ("a store id sent by the client is NEVER read") is about
  **that** endpoint, not these.
  Measured 2026-08-05: with `Host: kopi-senja.tokophi.com` and `storeSlug: batik-nusantara`,
  `/api/public/promo` answers for **batik-nusantara** — six distinguishable answers over its voucher
  list. That is real, and it is **not a tenant escape**: a slug is a public subdomain, the endpoint
  is public, and the identical answers come back from that shop's own checkout page. A caller learns
  nothing they could not learn by browsing there. Moving these endpoints into the storefront to get a
  Host would put the **platform's** KiriminAja and AutoLaris keys into the storefront container,
  which is the thing `ongkir/route.ts` says in its first comment it exists to avoid.
  ⚠️ The error copy (`"Kode voucher tidak ditemukan."` vs `"…kedaluwarsa."` vs
  `"Minimum belanja Rp…"`) IS a code-probing oracle, deliberately: those sentences are what a real
  shopper holding an old flyer needs to read. Collapsing them to one message is over-validation.
- **A public route reads its body through `readPublicBody()` (`lib/public-guard.ts`), never
  `req.json()`.** `req.json()` has no size ceiling in a Route Handler — measured, a **64 MB** body
  was accepted, buffered and parsed. The cap counts the STREAM, not the `Content-Length` header
  (a chunked upload sends none), and cancels the reader instead of draining the rest.
- **`items[]` is capped at `MAX_CART_ITEMS` (100), on the RAW array.** `/api/public/order` does
  **four sequential DB round-trips per element**: measured, 10.000 items = **50.498 index scans and
  63,8 s in ONE request** that never reaches the courier API or a write. The rate limit bounds how
  OFTEN one IP calls; it never bounded how big each call is. 100 lines is ~1,2 s and ~12 KB —
  generous on purpose, because a cap that refuses a real wholesale cart is a lost sale nobody hears
  about.
- 🔴 **A PROVIDER'S OWN ERROR TEXT NEVER REACHES A SHOPPER (ADR 0004).** It did: measured live,
  `/api/public/order` answered `"kurir nosuchcourier tidak terdaftar di sistem kami"` — the
  aggregator, in the **first person**, on the merchant's checkout — and on a bad key the same field
  reads `"Unauthorized."`. The gateway's `ket` went out as `payError` (`{"rc":"401",
  "ket":"Unauthorized"}`, measured against the live PSP). Neither string happens to spell
  *KiriminAja* or *AutoLaris*, but the text is unbounded and written by someone else, so nothing kept
  the next one from doing so. `quoteShipping` now flags `fromProvider`, the two public routes
  substitute `SHIPPING_QUOTE_UNAVAILABLE` / `PAY_START_FAILED` and `console.error` the original —
  and the **seller-facing** `getShippingRates` keeps the provider's words, because the merchant is
  who acts on "sudah melewati jam cut-off". Nothing is lost on the shopper's side: a route the
  courier does not serve comes back `status:true` with an **empty rate list** (measured), so the
  error path is only ever our own side failing.
- ⚠️ **There is deliberately NO bot gate on these four**, unlike `checkout-session.ts`. That one
  fails quiet (204, nothing lost); these decide MONEY. `isBot()` treats an **empty User-Agent** as a
  bot, and a privacy browser or a stripping proxy would have its order refused with no way for
  anyone to find out — the exact failure this repo calls a bug equal to the hole it closes. Rate
  limit + caps are the floor; the wall is Cloudflare at the edge.
- 🔴 **A REUSABLE FIRST-PARTY SECRET NEVER GOES IN A URL — AND THE ONE EXCEPTION IS THE VENDOR'S, NOT
  OURS** (Task 4.13 / SEC-16, 2026-08-21). Two credentials used to ride query strings.
  - **`CRON_SECRET` is CLOSED.** All five compose sidecars sent `?secret=$CRON_SECRET`; all six gated
    routes (five `api/cron/*` + `api/health/env`) accepted it, each with its own copy of the check.
    A URL is not a private place: the credential sat in the container's `command`, in `docker
    inspect`, in `docker top`, in the host process table and in every proxy access log — for the one
    string that authorises a state-mutating sweep across **every tenant**. One gate now
    (`apps/admin/lib/cron-auth.ts`), header only, and a request carrying `?secret=` is refused **and
    logged** so a stale caller is visible instead of looking like a wrong secret. `?every=` stays —
    it is the cadence, not a credential. ⚠️ Both halves must land in the same commit; a sidecar left
    on the old shape costs one idempotent tick, which is why the refusal is logged.
  - **The PAY CALLBACK URL is closed; the callback's `?token=` DOOR IS NOT, AND MUST STAY OPEN.**
    `payCallbackUrl()` used to embed `AUTOLARIS_CALLBACK_SECRET` verbatim in every bill — the string
    that can mark ANY payment or ANY subscription invoice paid, handed to a third party and copied
    into their dashboard. It now signs the reference instead: `?cb=<reff>.<hmac>`, one parameter, and
    the route **binds** that signature to the row it resolved (`payments.reff_id` /
    `invoices.reff_id`), so a leaked URL is worth one payment rather than all of them. Unbinding it
    would turn the signature back into a bearer token with extra steps.
    ⚠️ **Do NOT "finish the job" by refusing `?token=`.** AutoLaris echoes `callback_url` and sends no
    headers of its own; refusing it 401s **every genuine payment** — `payments.status` stuck at
    `menunggu`, no order reaching `dibayar`, no ledger row, and platform invoices stop advancing
    `stores.current_period_end` until the platform suspends its own paying merchants. That outage has
    happened here once. It is closed when the VENDOR confirms a header, and the branch plus its test
    are deleted together.
  - **Exactly one identity, or nothing happens.** The callback resolves `trx_id` first, then
    `reff_id`; **zero identifiers is a 400** (it used to answer `{ok:true}`) and an ambiguous match is
    a 400 on the payment half **and** on the subscription-invoice half, which had no such guard at all.
- Guarded by **`apps/admin/lib/public-guard.test.ts`** — real `Request`s through the cap (including
  a chunked body that declares no length), plus `codeOnly()` source claims that all four routes go
  through `readPublicBody` and that neither shipping route serves the provider's string. Both source
  claims carry a **mutation self-check**: the same predicate is asserted to fire on a copy with the
  old code put back, so the guard can never be green for want of matching anything.
