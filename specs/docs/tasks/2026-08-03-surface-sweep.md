# Surface sweep — every route on all three apps, driven in a browser

**Date:** 2026-08-03
**Branch:** `feat/seed-recent-carts` (continues the wave-3 validation session)
**Method:** enumerate routes from disk → cross-reference against the sidebar → drive each one in
Chrome, logged in, and record status, `<h1>` count, heading-level skips, console errors, and
horizontal overflow at 390 px.

**Not a read-through.** Every number below came from a page that was actually loaded.

---

## Scoreboard

| surface | routes | crawled | result |
|---|---|---|---|
| **admin** (Seller) | 54 (40 static) | 40 | **0 HTTP errors** · 3 defects found, all fixed |
| **storefront** | 28 (14 static) | 14 | **0 HTTP errors** · 1 defect found, fixed |
| **super-admin** | 10 | 0 (see below) | routing + auth gating verified |

## Routing and menu — clean, and that is a result

- **0 dead nav links.** Every `href` in `NAV_GROUPS` resolves to a `page.tsx`.
- **0 unreachable pages.** Nine routes are absent from the sidebar and all nine are reached
  deliberately — `/akun/{profil,keamanan,langganan}` from the avatar menu (as `AGENTS.md` specifies),
  and the six `*/baru` create screens from a button on their list page. **Verified by grepping for a
  link to each**, not assumed: every one is referenced from at least one component.
- **super-admin**: all 7 sidebar entries resolve; `/tiket/[id]` and `/toko/[id]` are reached from
  their lists.
- **storefront**: `/thanks` (the landing-funnel conversion page, reached from `OrderFunnel`) and
  `/404` are the only non-navigable routes, both by design.

## What the sweep found

### 🔴 `/checkout` had no `<h1>` at all — the only page on the money path without one

Its highest heading was `<h2>Ringkasan Pesanan`. `/keranjang` and `/checkout/sukses` both have one;
this page had simply been missed. **Third instance of the class** after the builder homepage (N11) and
the hero carousel (N14).

Fixed with `<h1 class="sr-only">Checkout — {store.name}</h1>`. ⚠️ **Deliberately not visible**: the
comment directly above it records that the visible "Checkout" title was removed on 2026-07-16 (the step
labels and the tab already say it, and a headline costs the first field its place above the fold on a
390 px phone). A hidden `<h1>` restores the outline without re-litigating that decision.

⚠️ **And it is in the PAGE, not `CheckoutLayout`.** The layout's other consumer,
`checkout/sukses.astro`, already renders a visible `<h1>` — a floor in the layout would have given that
page **two**, which is exactly the N14 defect. Two consumers, one already correct: fix the one that is
wrong. (This was caught while writing the fix, not after.)

### `/halaman/baru` shipped with no `<h1>` — the only admin page without one

`PageEditor` wrapped its heading in `{isEdit && …}`, so the **create** screen rendered none. The value
was already computed — `topBarTitle` returns `"Tambah halaman"` for exactly that case — so the guard was
hiding a string it had already built. `article-editor.tsx` next door renders its own unconditionally;
the two had diverged. One line.

### Two heading-level skips (h1 → h3)

`/navigasi` ("Item menu") and `/pemasaran` ("Feed Produk"). Neither page has any `<h2>`, so both jumped
a level — and a skipped level is what a screen-reader user navigates by, the same rule
`Multicolumn.astro` already spells out on the storefront. Tag changed, `className` untouched: the size
comes from `text-sm`, not the tag.

## What is NOT a defect — checked, so nobody re-chases it

- **`/api/uploads/*.webp` 404s on 6 admin pages, locally only.** `apps/admin/public/uploads/` is
  gitignored, so a fresh worktree has none of the files the shared dev DB's rows point at. **Production
  serves them fine** (spot-checked: 6/6 → 200), because `docker-compose.coolify.yml` mounts a named
  volume `tokophi-uploads:/app/apps/admin/public/uploads`. Merchant media survives a deploy.
  ⚠️ I initially read a 404 on the store logo as a production bug. It was not: **the filename I tested
  came from the DEV database**, and production has its own `stores.logo_url`. Testing one environment's
  data against another's server proves nothing.
- **`ERR_CONNECTION_REFUSED` on every storefront page, locally only** — the admin origin
  (`localhost:3000`) that serves `/api/uploads` and `/api/public/ongkir` was not running in the isolated
  scan.
- **No horizontal overflow at 390 px** on any storefront route. The one hit was `/sitemap.xml`, which is
  XML rendered in a browser — a false positive of the check, not a layout bug.
- **No `2×h1`** anywhere on either surface (N14's class stayed closed).

## super-admin — gating verified, content not crawled, and why

All 7 routes return **307 to login** unauthenticated. That is the check that matters and it passes.

The screens were **not** crawled: it needs a platform credential I do not have. The seeded operator is
`admin@tokophi.id`, and since `#133` the password is randomly minted and revealed once — **resetting it
would be a write to the shared control plane**, which is not mine to make. Left as a task rather than
done badly.

## The method, so it can be re-run

```bash
# routes on disk vs the sidebar
find apps/admin/app -name page.tsx | sed 's|.*app||;s|/page.tsx||;s|^/(admin)||'
grep -oE 'href: "[^"]+"' apps/admin/lib/nav.ts

# then drive each one logged-in and record:
#   status · h1 count · first h1 · heading-level skip · console errors · scrollWidth > clientWidth
```

⚠️ **Two traps hit while doing it, both mine, both worth avoiding:**
1. **Never rebuild `.next` under a running `next start`.** The old process keeps serving stale chunk
   references and pages start rendering *"This page couldn't load"* — which reads exactly like a real
   product bug. Kill the PID, **wait for the port to actually free** (`ss -ltn`), then start.
2. `kill` + immediate restart races: the new server hits `EADDRINUSE`, dies, and the OLD one answers
   your checks. Every "result" after that is from the build you thought you replaced.

## NEXT

- **Crawl super-admin's 7 screens** — needs an owner decision on a platform credential (see above).
- **N25** — `color_palettes` orphan; its AC involves dropping a table on the SHARED dev container,
  which needs the owner's word.
- **N5** — `dom-size` remainder (header/footer lucide icons); the only unblocked engineering item of
  size left.
- **N13** — products/categories `<lastmod>`; needs a migration.
