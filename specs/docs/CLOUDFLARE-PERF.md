# Cloudflare zone settings that cost PageSpeed points

Two of the largest remaining performance items on the storefront are **not code**. They live in the
Cloudflare zone for `tokophi.com` and cannot be changed from this repo. Both were approved by the owner
on 2026-08-01; this file is the exact procedure, so nobody has to re-derive it.

All numbers below are Lighthouse measurements against `https://toko.tokophi.com/`, mobile, 2026-07-31.

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
