# Session close — 2026-08-12 (slug rename · platform theme holder · post-ship audit)

Session opened at `d076cb1`, closed with the fleet verified healthy on `a507c08`. Six PRs shipped,
one production incident handled with a permanent fix, two owner decisions recorded. A peer session
(`fantastico-a0`) worked the repo concurrently (#264, #267–#269, #271–#273) — zero collisions; its
territory (N40 v6.2, tenant-theme-tokens) was deliberately left alone.

## Shipped, in merge order

| PR | what | the part worth remembering |
|---|---|---|
| #261 | Slug rename `batik-nusantara` → `batiknusantara` (data-only) | The slug IS the hostname (ADR 0009). Idempotent rename script in the migrate chain (runs AFTER `seed.ts`, BEFORE demo seeds — they look the store up by slug); 301 in storefront middleware for both host forms, path+query preserved; sweep of every code default incl. `ops/tokophi-probe.sh` (old host would probe 301 = red forever). Applied to prod AND the shared dev DB (announced, targeted UPDATE). |
| #262 | Platform theme holder + decision-B fallback + /tema prefill | Holder store `tema-platform`, fixed uuid `a0000000-0000-4000-8000-000000000001`, suspended+approved+comped, reserved slug. `PLATFORM_DEFAULT_THEME_STORE_ID` now names the holder, never a live store. Semantics changed from unconditional override to **per-slot fallback** (own content wins; `byId` never crosses tenants); non-UUID env reads as OFF instead of 22P02-500ing every page. `/tema` prefills an empty canvas from the holder (copy-on-first-edit — the recorded decision rejected row-copies). |
| #263 | N41 (wave 7) seed-drift + DB-PARITY, measured on production | Read-only. Verdicts: items 1/2/5 refuted; #3 `store_shipping_methods` demo drift (old epoch, `spx:3` missing); #4 8 reviews with NULL `product_id`. Prod schema = the code; all catalog diffs were dev-side debris. Reusable screen: `ops/tokophi-db-parity-screen.sql`. |
| #265 | Docs truth polish | Old-slug sweep across current-fact sites (history left alone); **owner decision recorded: `batiknusantara` REMAINS the demo store** (the "toko riil" direction is cancelled — theme-source's "That day came" corrected); HSTS raise filed in OPEN.md as time-gated (≥17:00 WIB), not executed. |
| #266 | Post-ship audit finding F1 fixed | **The rename freed the string `batik-nusantara`** — `slugify("Batik Nusantara")` mints exactly it, and the middleware 301s that host label BEFORE tenant resolution, so a new merchant could register a subdomain that forever serves the demo store. One `RESERVED_SLUGS` entry + the pinning test flipped (the old test pinned the defective behaviour). R-verdicts with evidence: no old-slug data left in prod values (the 3 `invoices.reff_id` `SUB-batik-nusantara-…` are external payment refs, matched verbatim by the callback — never rewrite them). |
| #270 | Deferred audit fixes D1 + D4 | D1: holder-seed source lookup is now sequential per slug (`inArray().limit(1)` had NO order — in the only reachable both-slugs state the demo holds the OLD slug, so old-first is the correct preference; new-first would copy a foreign merchant's templates). D4: the 301 keeps the port (dev/sslip only; prod byte-identical). D2 (behavioural 301 pin, needs an `astro:middleware` stub in shared config) and D3 (getStoreTemplates wiring seam) stay deferred in `2026-08-12-deferred-d1-d4.md`. |

## ⚠️ Incident: storefront 503, ~9 minutes, during the #261 deploy

- **Mechanism:** the container healthcheck hits `http://127.0.0.1:4327/` — a host that names no
  store, so it resolves via the `STORE_SLUG` fallback. Coolify still injected the OLD slug
  (an explicit env var overrides the compose default), the renamed DB no longer had it → 404 →
  unhealthy → Traefik withheld **every** storefront host, not just the fallback ones.
- **Recovery:** hotfix on the materialized files (`/data/coolify/applications/<uuid>/` — env values
  are written LITERALLY into that yaml, editing `.env` alone does nothing) + `docker compose up -d
  storefront`.
- **Permanent fix, no UI:** Coolify env values are encrypted in its DB but writable through its own
  ORM — `docker exec coolify php artisan tinker`, `EnvironmentVariable::find(id)` / `replicate()`.
  `STORE_SLUG=batiknusantara` updated, `PLATFORM_DEFAULT_THEME_STORE_ID` created; both proven to
  materialize correctly through the next real deploys.
- **Rule for next time: a slug rename and its `STORE_SLUG` env are ONE change** — the env must move
  before (or with) the deploy that renames the row, because the healthcheck couples container
  health to that lookup.
- Also: a deploy monitor greping `healthy` counts `unhealthy` too (substring) — one false green was
  reported before the pattern was fixed to `(healthy)`.

## Data-fixes & the courier question — resolved by the peer, verified here

The N41 remediations (insert missing `store_shipping_methods` incl. `spx:3`; backfill the 8
review `product_id`s) were executed by the peer session and recorded in its #267 — this session's
guarded transaction confirmed both as no-ops (20 rows incl. `spx:3`; 0 NULL reviews). The
idx/jtcargo-vs-seed delta was settled by #268: **operator enablement is authoritative and the seed
now follows it**.

## Open at close

- **HSTS ramp** — time-gated ≥ 2026-08-12 17:00 WIB, filed in `OPEN.md` (#265). One-way door.
- **D2 / D3** — deferred with exact notes in `2026-08-12-deferred-d1-d4.md`.
- **N40 v6.2** — the peer's stream; hands off.

## Verified end state (~03:4x WIB)

Fleet 4/4 healthy on `a507c08`, confirmed twice, then by content: `batiknusantara.tokophi.id` 200,
old host 301 with path+query intact, `toko.tokophi.id` 200 (fallback env proven through a full
deploy), `app.tokophi.com/login` 200. Holder present on prod with its 3 template rows.
