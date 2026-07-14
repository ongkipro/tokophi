# TokoΦ — Custom Domain (CNAME) & Primary Domain Spec

> Spec for BACKLOG **"Custom domain for a merchant"** — this document **supersedes** that three-line
> item (`BACKLOG.md` §"P1.6 residual", lines ~244-246); the backlog entry should be reduced to a link
> here.
> Decision-first. Companions: [`DEPLOY.md`](DEPLOY.md) (the box + the TLS story we actually run),
> [`ARCHITECTURE.md`](ARCHITECTURE.md), [`SCHEMA.md`](SCHEMA.md), ADR 0009 (one storefront, tenant from
> `Host`).
> Status: **SPEC — nothing here exists.** No column, no table, no admin route, no Cloudflare
> integration, no sitemap. The only thing that exists is the **seam**:
> `slugFromCustomDomain()` in `apps/storefront/src/data/store.ts` is a one-function `return null`, and
> `RESERVED` there already reserves the label `cname`. Written 2026-07-15.

---

## 0. What exists today (grounded, not assumed)

| Thing | Reality | File |
|---|---|---|
| Tenant resolution | `Host` → slug → store, cached per host (TTL `STOREFRONT_CACHE_TTL_MS`, default 15s) | `apps/storefront/src/data/store.ts` |
| Custom-domain lookup | **Stub.** `async function slugFromCustomDomain(_host) { return null }` — first in the resolution order, so wiring it is a body swap | same, lines 74-81 |
| `RESERVED` | `www app rich admin api cname toko storefront localhost` — **`cname` is already reserved**, i.e. `cname.tokophi.com` can never be a merchant slug | same, line 32 |
| Per-request origin | `locals.origin` = scheme + **the host the shopper landed on** (from `x-forwarded-proto` / `x-forwarded-host`) | `apps/storefront/src/middleware.ts` lines 48-60 |
| Canonical / OG | `canonical = new URL(Astro.url.pathname, origin)`, `og:url = canonical`, `og:image` absolutised against `origin` | `apps/storefront/src/layouts/Layout.astro` lines 43-84 |
| Sitemap / robots | **Do not exist.** `astro.config.mjs` deliberately has **no `site:`** (a hardcoded origin in a one-deploy-many-tenants app is a platform-wide SEO self-destruct) | `apps/storefront/astro.config.mjs` lines 25-27 |
| `stores` table | `id, account_id, name, slug, city, currency, timezone, plan, status, trial_ends_at, current_period_end, first_invoice_paid, comped*, logo_url, brand_color, created_at` — **no domain column of any kind** | `packages/db/src/schema.ts` lines 74-103 |
| Migration head | **`0048_phone_canonical_62.sql`** | `packages/db/drizzle/` |
| TLS for `*.tokophi.com` | Cloudflare **Origin CA** cert, served as Traefik's **default certificate**; trusted **only by Cloudflare** → every record must stay **proxied**; zone SSL = **Full (strict)** | `DEPLOY.md` §"LIVE", gotcha 1 |
| Storefront Traefik router | `Host(toko.tokophi.com) \|\| HostRegexp(^[a-z0-9-]+\.tokophi\.com$)` at **`priority=1`** (low, on purpose — the regexp would otherwise hijack `app.`/`rich.`) | `DEPLOY.md` step 2b + gotcha 2 |
| Admin UI for domains | **Nothing.** `/pengaturan` is one page of cards (Profil Toko, Jasa Kirim, Rekening, …); there is no domain card, no route, no action, no capability | `apps/admin/app/(admin)/pengaturan/page.tsx` |

**The consequence of the Origin CA cert is the whole difficulty of this spec.** A merchant's
`toko-pelanggan.com` is not in our zone. Nothing we hold can produce a browser-trusted certificate for
it, and Let's Encrypt cannot reach our origin over HTTP-01 through the Cloudflare proxy in front of it.
§3 is where that is resolved; everything else is comparatively easy.

---

## 1. Data model

### DECISION 1 — a `store_domains` table, **not** `stores.custom_domain`

A single `text` column on `stores` cannot hold:

- **two hosts** (`toko.com` *and* `www.toko.com` — the merchant will attach both, and one must win);
- **state** (`pending → verifying → active → error`) — a domain is a *process*, not a value;
- a **verification token**, a **provider id** (the Cloudflare custom-hostname id), a **cert status**, a
  **last error**, a **last checked at**;
- the **primary** flag (§2), which is the SEO decision this whole spec exists for.

Stuffing that into `stores` means either five more nullable columns on the hottest table in the schema
(read on every storefront request) or a jsonb blob with no uniqueness guarantee. The uniqueness
guarantee is the security invariant: **one host maps to exactly one store, enforced by the database**,
not by application code. That is a `UNIQUE` index on a row, so the row has to exist.

**Migration `0049_store_domains.sql`** (head is `0048`; `0043` is chat, `0044-0048` are
customers/checkout/courier/phone — verified in `packages/db/drizzle/`). Table count `SCHEMA.md`
+1.

```sql
CREATE TYPE store_domain_status AS ENUM ('pending','verifying','provisioning','active','error','disabled');

CREATE TABLE store_domains (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id           uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  host               text NOT NULL,                       -- normalised: lowercase, no scheme, no port, no trailing dot
  status             store_domain_status NOT NULL DEFAULT 'pending',
  is_primary         boolean NOT NULL DEFAULT false,      -- see §2. At most ONE per store.
  verification_token text NOT NULL,                       -- 32 hex, generated on insert
  verified_at        timestamptz,                         -- when OUR txt check passed
  provider_id        text,                                -- Cloudflare custom-hostname id (opaque to us)
  cert_status        text,                                -- mirror of the provider's ssl status ('pending_validation','active',…)
  last_error         text,                                -- surfaced verbatim in the admin UI
  last_checked_at    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX store_domains_host_key      ON store_domains (host);          -- ← the invariant
CREATE INDEX        store_domains_store_idx     ON store_domains (store_id);
CREATE UNIQUE INDEX store_domains_one_primary   ON store_domains (store_id) WHERE is_primary;  -- partial unique
```

**`store_domains` holds ONLY custom hosts.** `<slug>.tokophi.com` is **not** a row — it is *derived*
(`slug` + `STOREFRONT_BASE_DOMAIN`). Storing it would duplicate the truth, break the moment
`STOREFRONT_BASE_DOMAIN` differs (local dev, sslip.io fallback still routed per `DEPLOY.md`), and
create a second place where a store's identity can drift from its slug.

**RLS is mandatory, and `verify-rls` will force it.** The script "derives the store-scoped set from the
catalog (every table with a `store_id`) and FAILS if one lacks RLS" (`AGENTS.md`). So the migration
ships the standard `tenant_isolation` policy (`store_id = app_current_store_id()`) in the same file —
otherwise the next `npm run verify-rls -w @tokophi/db` goes red and the reason will look mysterious.

**Two deliberate exceptions to RLS, both already precedented:**
- The **storefront** resolves the host on the *owner* connection (it has no session, hence no GUC) —
  exactly as `getStoreByHost()` does today.
- **super-admin** reads across tenants on the owner connection (as it does everywhere).
Admin reads/writes go through `withCurrentTenant` / `withTenant` like every other editor.

---

## 2. PRIMARY DOMAIN — the SEO core

Every store is **always** reachable at `<slug>.tokophi.com` (that is the Traefik wildcard router; we do
not take it away). Attach `toko.com` and the *same catalogue* answers on two hosts. If both are
indexable, Google sees a complete duplicate of every product, category, blog post and page. Link equity
splits, `og:url` disagrees with the URL in the address bar, shoppers bookmark and share whichever one
they landed on, and neither host ranks.

### DECISION 2 — exactly one **primary host** per store, and every other host **301**s to it

- **Primary = the `store_domains` row with `is_primary = true`, if there is one.**
- **Otherwise the primary is `<slug>.tokophi.com`.** Until a merchant sets a custom domain, **the
  subdomain IS the primary.** No exceptions, no config, no env — this is the default and it is stated
  here so nobody re-litigates it.
- A row can only be made primary when its `status = 'active'` (verified **and** cert live). Promoting a
  half-provisioned domain would 301 the store's entire traffic into a TLS error.

### DECISION 2a — **301, not `rel=canonical`**

`rel=canonical` is a **hint**. Google is free to ignore it, and it does nothing about the other three
problems: the duplicate host is still crawled (crawl budget), still shareable, still bookmarkable, and
still splits analytics/ads/cookies. A 301 is a directive: it consolidates the signal, it is what
Shopify does with non-primary domains, and it costs us one branch in a middleware that **already
resolves the store and the host**.

We keep `rel=canonical` too (it is already emitted in `Layout.astro`) — but as a *belt*, not the
mechanism. Its value becomes: it always points at the **primary origin**, so even a page served on a
non-primary host in some path we did not anticipate names the right URL.

### DECISION 2b — `locals.origin` becomes the **primary** origin, not the request origin

Today (`middleware.ts` lines 48-60) `locals.origin` = whatever host the shopper landed on. That was
right when the subdomain was the only host. With a primary it is wrong: canonicals, `og:url`, `og:image`
and (once it exists) the sitemap must all name **one** origin per store.

```
// middleware.ts, after the store is resolved
const primaryHost = store.primaryHost;                      // custom primary, else `${slug}.${STOREFRONT_BASE_DOMAIN}`
locals.origin     = `${scheme}://${primaryHost}`;           // canonical / og:url / sitemap
```

Local dev has no base domain and no custom domain → `primaryHost` falls back to the request host, so
`localhost:4327` keeps working exactly as it does now.

### DECISION 2c — the redirect rule, precisely (this is where the bug would be)

```
if (requestHost !== primaryHost)
   && (method is GET or HEAD)
   && (pathname does not start with /api/)
   → 301 to `${scheme}://${primaryHost}${pathname}${search}`
```

Two carve-outs, both load-bearing:

1. **GET/HEAD only.** A 301 on a `POST` is converted by browsers into a `GET` and the body is dropped.
   The storefront **posts** to its own API (`/api/checkout-session` debounced beacons, `/api/chat/*`) —
   redirecting those would silently destroy abandoned-cart capture and chat, and the failure would look
   like "the beacon fires and nothing lands", which is exactly the kind of quiet lie `AGENTS.md` says
   the checkout capture must never introduce.
2. **`/api/*` is never redirected**, for the same reason plus one more: a stale page still open on the
   old host keeps working.

Everything else — every product, category, blog, page, the home page — 301s. This means: **after a
merchant activates a custom domain, `<slug>.tokophi.com` stops serving HTML and becomes a redirector.**
That is intentional and must be said in the UI (§5).

### DECISION 2d — `www` vs apex is the *same* machinery

The merchant attaches both `toko.com` and `www.toko.com`. Both become `store_domains` rows, both go
through verification and cert issuance, **one** carries `is_primary`. The other 301s by DECISION 2c.
There is no separate "www redirect" feature — building one would be a second mechanism doing the same
job.

### DECISION 2e — robots + sitemap follow the primary

The storefront has **no `robots.txt` and no sitemap** today. When they land (slice 5):
- `sitemap.xml` is generated **per request** from `locals.origin` (= primary). It must never use
  `Astro.site` — `astro.config.mjs` has no `site:` **on purpose** and adding one would emit one
  merchant's domain in every other merchant's sitemap.
- `robots.txt` on a **non-primary** host serves `Disallow: /` (a crawler that ignores the 301 — or a
  crawler that hits the host before the redirect ships — is told plainly), and on the primary serves
  `Allow` + the sitemap URL.

---

## 3. DNS + TLS — the hard part

The merchant creates `CNAME www.toko.com → cname.tokophi.com`. Then **what issues the certificate for
`www.toko.com`?** We cannot: it is not our zone, and our only wildcard cert is a Cloudflare **Origin CA**
cert for `*.tokophi.com` which no browser trusts.

### The two honest options

**Option A — Cloudflare for SaaS (Custom Hostnames).**
Cloudflare terminates TLS for the merchant's hostname **at its edge**, then forwards to a *fallback
origin* in our zone (`cname.tokophi.com` → our Traefik). We register each merchant hostname with
Cloudflare via API; Cloudflare performs its own DCV and issues + auto-renews the certificate. We write
no ACME code, store no certificates, and the custom hostnames inherit Cloudflare's DDoS/WAF/cache like
the rest of the zone.
- We build: a small provider client (create / poll / delete a custom hostname), `provider_id` +
  `cert_status` persistence, a poller, and the admin UI. That is it.
- We pay: a per-custom-hostname fee. **I have NOT verified the current price or which plan tier it
  requires.** Do not budget on my memory of it — open the Cloudflare for SaaS pricing page before
  committing (§7 Q2).
- We depend: on Cloudflare, at the edge, for merchant traffic. Given that the *entire platform* already
  depends on Cloudflare proxying (`DEPLOY.md` gotcha 1 — grey-clouding any record breaks TLS), this
  adds no new single point of failure.

**Option B — Traefik + Let's Encrypt on demand (HTTP-01 / TLS-ALPN).**
This is the one that *sounds* free and is not. What breaks, in order of severity:

1. **The merchant's CNAME lands on Cloudflare's proxy IPs, not ours.** `cname.tokophi.com` is a
   **proxied** record (it must be — see gotcha 1). Cloudflare will refuse to serve a hostname it has no
   configuration for; an arbitrary domain CNAME'd into a proxied zone that has not enabled
   Cloudflare-for-SaaS gets an error page, not our origin. So Option B **cannot use a proxied CNAME
   target at all**. It requires a **grey-clouded** (DNS-only) target — e.g. `edge.tokophi.com` → our
   raw IP.
2. **Which publishes our origin IP** (45.77.33.112 today), removing Cloudflare's DDoS shield and its
   WAF for exactly the traffic a merchant cares about, and making the box directly attackable. That is
   a real, permanent cost paid to avoid a per-hostname fee.
3. **The Origin CA default cert becomes a footgun.** Traefik's *default* certificate is the Origin CA
   wildcard. Any TLS handshake for a host with no matching router+cert gets served that cert →
   browser trust error, not a clean 404. Every custom hostname must therefore have a *real* cert
   before it is reachable at all.
4. **Certificate storage across redeploys.** Traefik's `acme.json` lives on a Coolify volume. It
   survives redeploys today, but nothing in the repo *tests* that, and losing it re-orders every
   merchant certificate at once — straight into LE's rate limits.
5. **Rate limits.** LE's per-registered-domain limit is not the binding one (each merchant domain is its
   own registered domain); the binding ones are the account-level new-order and failed-validation
   limits, which a retry loop over N misconfigured merchant domains will hit. We would have to build
   backoff, a failure quarantine, and a cert-state machine — i.e. rebuild the thing Option A sells.
6. **Traefik dynamic routers per domain.** Coolify's Domains field takes explicit hostnames; adding a
   router per merchant means writing a dynamic-config file (or labels) at runtime from the app, plus a
   catch-all fallback. Doable, but it is now *two* stateful systems (DB + Traefik file provider) that
   can disagree.

### DECISION 3 — **Cloudflare for SaaS.** Custom Hostnames, fallback origin `cname.tokophi.com`.

The trade-off, stated plainly: **we pay a recurring per-hostname fee and deepen our Cloudflare
dependency, in exchange for not owning certificate lifecycle for domains we do not control, and for not
exposing the origin IP.** Option B's "free" is paid in origin exposure (a security regression), an
ACME state machine, and a class of outage — an expired merchant cert — whose blast radius is a
merchant's whole storefront and whose debugging surface is a volume file. That is the wrong thing to be
cheap about.

### What must be true for it to work behind the setup in `DEPLOY.md`

1. **`cname.tokophi.com`** — a **proxied** record in the `tokophi.com` zone pointing at the origin
   (45.77.33.112). It is the fallback origin *and* the CNAME target we publish to merchants. The label
   `cname` is **already in `RESERVED`** (`store.ts` line 32), so it can never be read as a store slug.
2. **A Traefik catch-all router → storefront.** The existing storefront rule is
   ``Host(`toko.tokophi.com`) || HostRegexp(`^[a-z0-9-]+\.tokophi\.com$`)`` at `priority=1`.
   `toko-pelanggan.com` matches **neither**. Custom-domain traffic needs a router whose rule matches
   *any* host — and it must be the **lowest-priority** router in the whole proxy, below `app.` / `rich.`
   / the storefront wildcard. Given gotcha 2 (Traefik's default priority is *rule length*, which is why
   the wildcard is pinned to 1), the catch-all must be pinned **below 1** or the wildcard raised — pick
   explicit numbers for **every** storefront-related router in one pass and write them down, because
   getting this wrong hijacks `app.tokophi.com` again.
3. **The original `Host` header must survive to the origin.** Cloudflare forwards the request's
   `Host` (the merchant hostname) to the fallback origin; Traefik must not rewrite it, and
   `getStoreByHost()` reads it. This is the same requirement `DEPLOY.md` step 2b already states for the
   wildcard.
4. **⚠️ THE ONE UNVERIFIED THING — the origin leg under Full (strict).** Zone SSL is **Full (strict)**
   (gotcha 1), which validates the origin's certificate. Our origin presents the Origin CA cert for
   `*.tokophi.com`. Whether that validates depends on **which SNI/Host Cloudflare presents to the origin
   for a custom hostname** — if it presents `toko-pelanggan.com`, our cert does not cover it and strict
   validation fails. Cloudflare for SaaS has per-hostname origin controls (a custom origin server, and —
   I believe — a custom origin SNI), but **I did not verify their exact names, availability on our plan,
   or API shape, and I am not going to guess them.** This is settled by a 30-minute experiment, not by a
   design meeting: attach one throwaway domain, watch the Traefik access log for the SNI/Host that
   arrives, and read the CF error if it fails. **Slice 4 does not start until that experiment has run.**
   If the answer turns out to be "SNI = the custom hostname and we cannot override it", the fallback is
   ugly and must be a conscious choice (§7 Q6): run the SaaS path with a relaxed origin-validation mode,
   which weakens origin authentication for that traffic.

### Apex domains cannot take a CNAME

`toko.com` (apex) cannot hold a `CNAME` — RFC-wise it would collide with the zone's own `SOA`/`NS`.
Registrars solve this with `ALIAS` / `ANAME` / CNAME-flattening; **many Indonesian registrars do not
offer it**. Our order of answers, and the UI says exactly this:

1. **Preferred — move the domain's nameservers to Cloudflare (free plan).** Cloudflare flattens a CNAME
   at the apex automatically. Every Indonesian registrar we care about (Niagahoster, Rumahweb,
   Domainesia, IDwebhost) allows changing nameservers. This is also what Shopify/Vercel tell people.
2. **Fallback — make `www.toko.com` the primary** and use the registrar's own **domain forwarding /
   web redirect** on the apex (almost all of them have it) to send `toko.com → www.toko.com`. The
   merchant's brand still reads `toko.com` in ads; the canonical is `www.`.
3. **Not offered: an `A` record to our IP.** It exposes the origin, bypasses the Cloudflare edge that is
   the entire point of DECISION 3, and pins the merchant to an IP we intend to change (Vultr → Hetzner
   is already planned, `DEPLOY.md`). If Cloudflare for SaaS turns out to offer anycast IPs for apex
   custom hostnames on our plan, revisit — **unverified, do not assume**.

---

## 4. Verification

### DECISION 4 — a **TXT record** we check ourselves, **before** we create the custom hostname

```
Record : TXT
Name   : _tokophi-verify.toko.com        (and _tokophi-verify.www.toko.com for the www row)
Value  : tokophi-verify=<verification_token>
```

Checked server-side with Node's `dns/promises.resolveTxt()` against a public resolver, from the
container, on demand ("Verifikasi sekarang" in the UI) **and** on a poller for the first 72 hours.
Never from the browser. On success: `verified_at = now()`, `status: pending → provisioning`, and
**only then** do we call Cloudflare to create the custom hostname.

**Why TXT and not a token at a well-known path.** The HTTP path has a chicken-and-egg problem that
actually matters: to serve `/.well-known/tokophi-verify/<token>` on `toko.com`, the merchant's DNS must
**already point at us** — which means we are already answering on a domain we have not verified. The
window in which we serve an unverified domain is precisely the window the attack in the next paragraph
lives in. TXT proves control of **DNS**, which is exactly the capability required to point a CNAME at
us — the right proof for the right right.

**This is separate from the CA's own DCV.** Cloudflare must *also* validate control to issue the
certificate (it will ask for its own record or use the CNAME itself). Do not collapse the two: the CA's
DCV proves control **to the CA**; our TXT proves control **to us**, and it gates whether we register the
hostname at all. Two records to copy is a small price; the UI shows them together (§5).

**The failure mode if we skip it** (state it in the PR that ships this, because it is the reason the
slice exists): anyone in the world can point `bank-example.com` — or a bank's lookalike, or a
competitor's domain, or any domain in a phishing kit — at `cname.tokophi.com`, and we will happily serve
a working, TLS-valid online shop on it. We become an open host for arbitrary hostnames: our
infrastructure serves the phish, our name appears in the CT logs for it, the abuse report and the
takedown land on **us**, and Cloudflare (whose edge is issuing those certs) has every reason to
terminate our account. Second, smaller, still bad: because `store_domains.host` is `UNIQUE`, whoever
adds a domain **first** owns it in our system — an unverified add is a squat that locks the real owner
out.

**Additional guards, cheap, ship with slice 3:**
- Refuse hosts under `tokophi.com` (nobody attaches `evil.tokophi.com` as a "custom" domain).
- Refuse a host that is already an `active` row for another store (the `UNIQUE` index does this, but a
  friendly error beats a 500).
- Cap the number of domains per store (proposed: **2** — apex + www; §7 Q5).
- Every add / verify / promote / delete is audit-logged to `platform_activity` with `store_id`, the same
  way super-admin actions already are.

---

## 5. Admin UI (seller dashboard) — **does not exist today, at all**

There is no domain UI, no route, no server action, no capability, no component. `/pengaturan` is a
single page of cards (`apps/admin/app/(admin)/pengaturan/page.tsx`).

### DECISION 5 — a dedicated route `/pengaturan/domain`, linked from a card on `/pengaturan`

Not another card *inside* the settings page: this is a stateful, polling, multi-step flow with copyable
DNS records and error states. It needs its own screen. The nav (`lib/nav.ts`) gains **nothing** — one
entry point, from Pengaturan, exactly like the store's other sub-flows.

**Capability: reuse `settings:write`** (owner + admin). A new `domain:write` cap buys nothing — anyone
who can edit the store's settings can already do more damage than moving its domain. Gate the controls
with `<Can capability="settings:write">` per the RBAC pattern in `AGENTS.md`.

### The states a merchant sees (Bahasa Indonesia)

| Status (DB) | Badge | What the screen shows |
|---|---|---|
| *(no rows)* | **Belum diatur** | Explainer + `<slug>.tokophi.com` shown as the current address + "Hubungkan domain" form |
| `pending` | **Menunggu DNS** | The two records to copy + "Verifikasi sekarang" + "Perubahan DNS bisa memakan waktu hingga 24 jam." |
| `verifying` | **Memeriksa…** | Spinner; poller running |
| `provisioning` | **Menyiapkan sertifikat SSL** | "Domain terverifikasi. Sertifikat keamanan sedang diterbitkan — biasanya selesai dalam beberapa menit." |
| `active` (not primary) | **Aktif** | "Mengalihkan ke domain utama" + "Jadikan domain utama" button |
| `active` + `is_primary` | **Domain utama** | Green. "Semua pengunjung diarahkan ke sini." |
| `error` | **Gagal** | `last_error` verbatim + the most likely cause + "Coba lagi" |
| `disabled` | **Nonaktif** | "Aktifkan kembali" / "Hapus" |

### The records the merchant copies

```
1) Arahkan domain (CNAME)
   Tipe: CNAME   Nama: www   Nilai: cname.tokophi.com   Proxy/Cloud: NONAKTIF (DNS only)

2) Bukti kepemilikan (TXT)
   Tipe: TXT     Nama: _tokophi-verify.www   Nilai: tokophi-verify=a1b2c3…
```

Each with a one-click copy button. Below them, the apex note (§3):

> **Domain tanpa `www` (mis. `toko.com`)?** Sebagian besar registrar tidak mengizinkan CNAME di domain
> utama. Dua cara: **(a)** pindahkan nameserver domain Anda ke Cloudflare (gratis) — CNAME di domain
> utama otomatis didukung; atau **(b)** gunakan `www.toko.com` sebagai domain utama dan aktifkan
> *domain forwarding* di registrar Anda dari `toko.com` ke `www.toko.com`.

And the consequence of promotion, stated before they click it, not after:

> Setelah domain ini menjadi **domain utama**, alamat `batik-nusantara.tokophi.com` akan otomatis
> dialihkan (301) ke domain baru. Alamat lama tetap berfungsi — pengunjung dan tautan lama tidak akan
> rusak.

**Copy discipline:** the merchant never sees "Cloudflare", "Traefik", "Let's Encrypt", "SNI", or
"certificate authority" — ADR 0004's rule (provider brands stay hidden from clients) applies here as
much as it does to couriers and payment gateways. They see "sertifikat keamanan (SSL)" and "penyedia
DNS Anda". Errors are translated: a CF cert-validation failure surfaces as "Sertifikat gagal
diterbitkan — pastikan record CNAME sudah benar dan proxy (awan oranye) dimatikan.", with the raw
`last_error` available behind a "Detail teknis" disclosure for support.

**Super-admin** gets a read-mostly list of every custom domain across stores (status, cert status, last
error) + force-remove, on the existing platform-control pattern (`apps/super-admin/lib/actions.ts`),
audit-logged to `platform_activity`. Small, but without it we debug merchant domains by SQL.

---

## 6. Rollout slices

Ordered, independently shippable, each verifiable **without** the next. Sizes: S ≈ half day, M ≈ 1 day,
L ≈ 2 days.

| # | Slice | Deliverable | Verify | Size |
|---|---|---|---|---|
| **1** | **Schema + the resolution seam** | Migration `0049_store_domains.sql` (enum, table, 3 indexes, RLS `tenant_isolation`); `packages/db/src/schema.ts`; one seeded row for the demo store; `slugFromCustomDomain()` in `apps/storefront/src/data/store.ts` queries `store_domains WHERE host = $1 AND status = 'active'` (host is **already** the cache key — no cache change); `StoreInfo` gains `primaryHost`; `SCHEMA.md` + `DATA_MODEL.md` table count. | `INSERT` a row, then `curl -H 'Host: toko-demo.test' localhost:4327` → the demo store renders. `npm run verify-rls -w @tokophi/db` stays green. **No DNS, no Cloudflare, no UI.** | **M** |
| **2** | **Primary host + 301 + canonical** | `middleware.ts`: `locals.origin` = **primary** origin (DECISION 2b); 301 non-primary → primary for GET/HEAD, skipping `/api/*` (DECISION 2c). `Layout.astro` needs no change (it already builds from `origin`). | `curl -I -H 'Host: batik-nusantara.tokophi.com'` with a primary custom domain set → `301` to it; `curl -X POST .../api/checkout-session` on the old host → still `200`; view-source on the primary → `canonical` + `og:url` both name the primary. | **S** |
| **3** | **Verification + admin UI** | `store_domains` server actions (`lib/actions/domain.ts`: add / verify / promote / delete, `requireCapability("settings:write")`, `withTenant`); TXT check via `dns/promises`; `/pengaturan/domain` route + client screen with all seven states; card on `/pengaturan`; `platform_activity` audit. **Still no cert** — a verified domain sits at `provisioning` and is not yet served. | Add a domain in the UI, publish the TXT on a real test domain, click "Verifikasi sekarang" → `verified_at` set. Wrong token → clean error, no state change. | **M** |
| **4** | **Cloudflare for SaaS** ⚠️ | *Precondition: the §3.4 SNI experiment has been run and its answer written into `DEPLOY.md`.* `cname.tokophi.com` proxied record; Traefik catch-all router at an explicit lowest priority (re-number **all** storefront routers in one pass); provider client (create / poll / delete custom hostname) behind `CF_SAAS_*` env, feature-flagged off when unset; `provider_id` + `cert_status` persistence; poller flips `provisioning → active`. | A real throwaway domain, CNAME'd, resolves over **https** to the store with a browser-trusted cert; `app.tokophi.com` and `rich.tokophi.com` still resolve to the right apps (the priority regression check). | **L** |
| **5** | **Sitemap + robots, primary-aware** | `src/pages/sitemap.xml.ts` + `robots.txt.ts`, both built from `locals.origin`; non-primary robots = `Disallow: /`. Still **no `site:`** in `astro.config.mjs`. | Two stores, two sitemaps, zero cross-contamination of hosts. | **S** |
| **6** | **Super-admin oversight + polish** | Cross-store domain list + force-remove + cert status in super-admin; error-copy translation table; per-store domain cap; apex-help content. | — | **S/M** |

**Slice 1 is pickup-ready.** It needs no Cloudflare decision, no cost approval, no DNS change, and no
answer to any open question below. It is a migration, a schema entry, a stub body swap, and a
`StoreInfo` field — and it makes slices 2, 3 and 5 possible independently of the one slice (4) that has
a real unknown in it.

---

## 7. Open questions (for the user)

1. **CNAME target: `cname.tokophi.com`, or a separate brand domain?**
   Recommendation: **`cname.tokophi.com`** — the label is already `RESERVED` in code (`store.ts` line
   32), it costs nothing, and it is what `DEPLOY.md` already gestures at ("Custom merchant domains → CF
   for SaaS → `cname.tokophi.com`", line 109). The argument *against*: the merchant's DNS panel then
   shows our brand forever, and a future white-label posture (or selling the platform) would want a
   neutral target. Buying a second domain later means asking every existing merchant to re-point DNS —
   this is the kind of choice that is cheap now and expensive in two years. **Decide now.**
2. **Cloudflare for SaaS cost.** Which plan tier does it require, and what is the current
   per-custom-hostname price? **I did not verify this and will not guess it.** Then: is it absorbed into
   the Rp275rb/mo plan (one plan, all features — `AGENTS.md`), or is a custom domain an add-on? At a
   plausible ~$0.10–$2 per hostname per month, absorbing it is trivially fine at low volume and worth a
   second look at a thousand stores.
3. **May the merchant's own domain already be on Cloudflare (proxied)?** If they orange-cloud the CNAME
   on *their* side we get a double proxy and a support mess. The UI copy above says "Proxy: NONAKTIF";
   do we enforce it (detect and refuse) or just document it?
4. **Email / MX.** We never touch their MX — but merchants **will** ask "does my email still work?".
   Wanted: one line of copy on the domain screen (recommendation: yes, add it — "Email di domain Anda
   tidak terpengaruh").
5. **How many custom domains per store?** Proposed cap: **2** (apex + www). Somebody will want a
   campaign domain.
6. **The strict-TLS fallback (§3.4).** If Cloudflare turns out to present the *custom hostname* as SNI to
   our origin and we cannot override it: is it acceptable to run the custom-domain path with relaxed
   origin validation (weakening origin authentication for that traffic), or do we hold the feature until
   there is a clean answer? My view: hold, and spend the 30 minutes on the experiment first.
7. **What happens to a custom domain when a store is suspended for non-payment?** Today a suspended
   store goes read-only in the admin. Does its custom domain keep serving the shop, serve a "toko
   sedang tidak aktif" page, or stop resolving? (Comped/VIP stores are never suspended — `stores.comped`.)
8. **Does the subdomain stay alive forever as a redirector?** Proposed yes, permanently — old links,
   old QR codes, old ads. Confirm nobody wants it reclaimed.
