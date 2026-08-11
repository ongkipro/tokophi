# Cloudflare zone settings — the things that are NOT code

Some of what this product does is decided in the Cloudflare zone for `tokophi.com`, not in this repo.
This file is the exact procedure for each, so nobody has to re-derive it.

**Zone id `d31e0f9f9c3df05d38ba9c5a7d98854e`.** Every record in it is **proxied** — measured
2026-08-05, all six (`tokophi.com`, `www`, `app`, `rich`, `toko`, and the `*` wildcard). That is a
standing requirement (`DEPLOY.md`: the wildcard's TLS is a Cloudflare **Origin CA** cert, which
browsers do not trust directly), and §4 below now depends on it as well.

§1 and §2 are performance, approved by the owner 2026-08-01, and their numbers are Lighthouse against
`https://toko.tokophi.com/`, mobile, 2026-07-31 — **both are still open.** §3 records a setting that is
left on deliberately. **§4 is security, and it is DONE.**

---

## 1. Email Obfuscation — a **render-blocking** script, 1.621 ms

### What is happening
Cloudflare rewrites `mailto:` links into `/cdn-cgi/l/email-protection#<hex>` and injects
`/cdn-cgi/scripts/…/email-decode.min.js` to decode them at runtime. That script is **render-blocking**
and, measured, it is the **single largest blocker on the page** — larger than the Google Fonts
stylesheet was before it was self-hosted.

Our own footer/contact `mailto:` links are what trigger it.

### The trade
Turning it off means the shop's email address is once again plain text in the HTML, so address-harvesting
bots can read it. That is the entire feature. For a merchant storefront whose contact address is
published on purpose, 1.6 seconds of blocked rendering on every page is the more expensive side.

### Dashboard
`dash.cloudflare.com` → zone **tokophi.com** → **Scrape Shield** → **Email Address Obfuscation** → Off.

### API (equivalent)
Needs a token with **Zone → Zone Settings → Edit** on this zone.

```bash
ZONE=<zone-id>            # Overview tab, right-hand column
TOKEN=<api-token>
curl -sX PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE/settings/email_obfuscation" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data '{"value":"off"}' | python3 -m json.tool
```

### Verify it actually landed
```bash
# Expect ZERO matches for both.
curl -s https://toko.tokophi.com/ | grep -c 'cdn-cgi/l/email-protection'
curl -s https://toko.tokophi.com/ | grep -c 'email-decode.min.js'
```

---

## 2. Cache Rule for static assets — `uses-long-cache-ttl`, 19 resources

### What is happening
The Astro Node adapter serves everything under `public/` with `Cache-Control: public, max-age=0`, and
Cloudflare papers over it with a 4-hour default. Four hours on a font file that will never change
again, and on every product photo, on every navigation.

⚠️ **This CANNOT be fixed in Astro middleware.** The adapter's `sirv` handler serves `public/` *before*
middleware runs. That fix was written, tested against a real build, measured as having **no effect**,
and reverted (2026-07-31). Do not try it again.

### What may be immutable, and what must NOT be

| Path | Cache | Why |
|---|---|---|
| `/_astro/*` | `max-age=31536000, immutable` | Vite content-hashes these. A new build is a new filename. |
| `/fonts/*` | `max-age=31536000, immutable` | A specific version of Inter. A different font would be a different file. |
| `*-<N>w.webp` | `max-age=31536000, immutable` | Generated renditions. `gen-image-widths.mjs` writes a NEW name for a new width. |
| `/products/*.webp`, `/hero/*.webp`, `/sections/*.webp` (the **sources**) | ~1 day, revalidate | 🔴 **Never immutable.** A merchant replacing a photo keeps the filename, and `immutable` would strand the old bytes in caches we cannot purge. |
| everything else (HTML, `/api/*`) | untouched | These are per-tenant and per-shopper. |

### Dashboard
Zone **tokophi.com** → **Caching** → **Cache Rules** → *Create rule*.

**Rule 1 — "Immutable build assets"**

Expression (Edit expression → paste):

```
(starts_with(http.request.uri.path, "/_astro/"))
or (starts_with(http.request.uri.path, "/fonts/"))
or (http.request.uri.path matches "-[0-9]+w\\.(webp|avif|png|jpg)$")
```

Then: *Cache eligibility* → **Eligible for cache**; *Edge TTL* → **Ignore cache-control header and use
this TTL** → `1 year`; *Browser TTL* → **Override origin** → `1 year`.

**Rule 2 — "Source images"** (place it *after* rule 1)

```
(http.request.uri.path matches "^/(products|hero|sections)/.*\\.(webp|avif|png|jpg)$")
```

*Edge TTL* → `1 day`; *Browser TTL* → **Override origin** → `1 day`.

### Verify
```bash
# immutable
curl -sI https://toko.tokophi.com/fonts/inter-latin.woff2 | grep -i 'cache-control\|cf-cache-status'
curl -sI https://toko.tokophi.com/hero/hero-1-640w.webp   | grep -i 'cache-control\|cf-cache-status'
# NOT immutable — this one must stay revalidatable
curl -sI https://toko.tokophi.com/products/dress-batik.webp | grep -i 'cache-control'
```

The first two should report a year and no `immutable` on the third. `cf-cache-status: HIT` on a second
request confirms the rule is being applied rather than merely configured.

---

## 3. Managed robots.txt — deliberately LEFT ON

Lighthouse scores `robots-txt` **0** ("Unknown directive" at `Content-Signal:`), which is what keeps the
SEO category at 92 instead of 100.

**Do not chase it.** The audit is behind Google's own spec — "rules other than `allow`, `disallow` and
`user-agent` are ignored by the robots.txt parser", and `Sitemap:` is itself such an extension. Turning
Managed robots.txt off would delete an AI-training opt-out that the injected text asserts as an **express
reservation of rights under Article 4 of EU Directive 2019/790**. Eight points on a linter is not worth
that. The full reasoning lives in `apps/storefront/src/pages/robots.txt.ts`.

---

## 4. HSTS — ✅ **ENABLED 2026-08-05, at one year since the same day**

### What it fixes

The session cookie is `Secure` since #156, so it no longer rides a cleartext request. HSTS closes the
other half: **the request itself**. `always_use_https` was already on, so `http://app.tokophi.com/`
answered `301` — but a 301 is an answer, which means the browser had already *sent* the request in the
clear. Anything in it (path, `Referer`, any non-`Secure` cookie) was on the wire, and an on-path
attacker can answer that first request instead of Cloudflare. HSTS makes the browser refuse to send it
at all: after one HTTPS visit, `http://` becomes an internal redirect the network never sees.

### What was measured before touching anything

| setting | value |
|---|---|
| `security_header` | `enabled: false`, everything zeroed |
| `always_use_https` | **on** (this is why the hole *looked* closed) |
| `ssl` | **strict** |
| `min_tls_version` | 1.2 |
| DNS | 6 records, **all proxied**, none DNS-only, no MX |

Those last two lines are the ones that make `includeSubDomains` safe: there is no name under
`tokophi.com` that is served by anything other than Cloudflare over HTTPS, so there is nothing for the
flag to break.

### The settings, and why each one is what it is

```jsonc
{ "enabled": true, "max_age": 31536000, "include_subdomains": true, "preload": false, "nosniff": false }
```

- **`include_subdomains: true` is the whole point, not a bonus.** The header on the apex protects the
  apex. `app.` and `rich.` get their own header from Cloudflare once visited — but a subdomain nobody
  has visited yet gets nothing, and this product mints a **new subdomain per merchant**
  (`<slug>.tokophi.com`). Without the flag, every new shop's first visit is unprotected forever.
- 🔴 **`preload: false`, deliberately.** Preloading submits the domain to a list compiled into
  browsers; removal takes **months** and is not ours to schedule. It is a one-way door and it is not
  needed for anything above. Do not switch it on to "finish the job".
- **`max_age: 31536000` (one year) — the ramp is DONE.** It went live at `86400` and was raised the
  same day, on the owner's call. The 24 h step existed so that a subdomain needing plain HTTP would
  cost a day rather than a year; the pre-flight measurements say no such subdomain can exist here, and
  they were **re-checked immediately before the raise** — still 6 records, still all proxied, still no
  MX, still no DNS-only entry. What the shorter window bought was calendar time to be surprised, and
  that was traded away knowingly. ⚠️ It is the ONE parameter that makes §"if custom hostnames get
  wired" below sharper, so read that before wiring them.
- **`nosniff: false` — left alone on purpose.** Cloudflare bundles `X-Content-Type-Options` into this
  same object. It is a good header and probably wants switching on, but it is a *different* header
  than the one being installed here, so it is its own decision, not a rider on this one.

### API

Needs a token with **Zone → Zone Settings → Edit**. `CLOUDFLARE_API_TOKEN` in the shell environment
had it (the ruleset permission §2 is blocked on is a different one — §2 stays open).

```bash
Z=d31e0f9f9c3df05d38ba9c5a7d98854e
curl -sX PATCH "https://api.cloudflare.com/client/v4/zones/$Z/settings/security_header" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  --data '{"value":{"strict_transport_security":{"enabled":true,"max_age":31536000,"include_subdomains":true,"preload":false,"nosniff":false}}}'
```

### Dashboard (equivalent)

Zone **tokophi.com** → **SSL/TLS** → **Edge Certificates** → **HTTP Strict Transport Security (HSTS)**.

### Verify — on a TENANT subdomain, not only the apex

```bash
for h in tokophi.com www.tokophi.com app.tokophi.com rich.tokophi.com \
         toko.tokophi.com batiknusantara.tokophi.com; do
  printf '%-32s %s\n' "$h" "$(curl -sI https://$h/ | grep -i '^strict-transport-security:' | tr -d '\r')"
done
```

Measured 2026-08-05, all six: `max-age=31536000; includeSubDomains` (and `86400` before the raise).
**Check the wildcard one** — it is the only line that proves `include_subdomains` reaches a
per-merchant shop, which is the case the flag was turned on for.

### 🔴 The rollback, and why it is now a YEAR long

To back it out, PATCH `"enabled": false`. **That stops Cloudflare SENDING the header. It does NOT
reach a browser that already holds one** — that browser keeps refusing `http://` for this domain and
every subdomain until ITS copy expires, which is now **up to a year from its last visit**. There is no
API call, no purge and no support ticket that shortens someone else's stored policy.

So the honest statement of the current position: **`tokophi.com` and everything under it are committed
to HTTPS-only in every browser that has visited, for a year at a time, and that commitment cannot be
withdrawn early.** Everything above says that is correct and safe here — the zone is Cloudflare-proxied
end to end and could not serve plain HTTP if it wanted to. It is written this plainly because the
consequence outlives whoever reads it next.

### ⚠️ If Cloudflare for SaaS custom hostnames ever get wired

`CUSTOM_DOMAIN_CNAME_TARGET` is a seam today (`storefront/src/data/store.ts` — no column, not wired).
When a merchant's own domain is served through this zone, **this header will be emitted on their
domain too**, `includeSubDomains` included — i.e. we would be making a durable promise about
subdomains of a domain we do not control. 🔴 **At `max_age: 31536000` that promise is a YEAR**, and a
merchant who later points `mail.` or a legacy `http://`-only host under their own domain has no way to
undo it and no reason to expect us to have made it. This is now the largest open consequence of the
setting. Decide it before wiring custom hostnames — a per-hostname HSTS override, or a shorter
`max_age`, are both things Cloudflare for SaaS can express. It is not decided here.
