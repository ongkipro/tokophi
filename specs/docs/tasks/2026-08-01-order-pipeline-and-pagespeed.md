# Session handoff — the order pipeline's quiet lies, then PageSpeed

**Date:** 2026-07-31 → 2026-08-01
**Branch base:** `origin/main` @ `20e2117`
**Merged + deployed:** `#117` `#118` `#119` `#120` `#122` `#123`
**Surfaces after the last deploy:** `app.` 200 · `toko.` 200 · `rich.` 307 (login) · apex 200

Two halves. The first was an audit of the order pipeline, found by **grepping for claims and checking
them against SQL**. The second was PageSpeed, measured with Lighthouse against production before and
after every change.

---

## PART 1 — Six quiet lies in the order pipeline (`#117`, `009db7a`)

None of these threw, none failed a build, and **none is reachable by clicking around the demo store** —
its data avoids every one of them. That is the recurring theme of this whole audit wave.

| Finding | What was actually happening |
|---|---|
| **`destinationGuessed` did not exist** | `createShipment`'s own comment said the city-name fallback "is flagged as a guess". It was not — the identifier appeared nowhere in the repo. **77 orders** carry no `ship_district_id`, so the branch was live and silent, and the COD province gate then resolved the province *from that guess*. `resolveArea("Surabaya")[0]` is `"Bandar Surabaya, Lampung Tengah, LAMPUNG"`. |
| **`markLabelsPrinted` reported success for rows it never touched** | `done: numbers.length` whatever the UPDATE matched. An order number belonging to another store is filtered out by RLS **with no error**, and was counted as printed. |
| **A cancelled order could still be billed** | `createOrderPayment` never read `orders.status`. Buyer pays → callback marks `berhasil` → `creditSaleForPayment` correctly skips terminal orders. **Money collected, no sale credited.** |
| **Two definitions of "the order's payment"** | List ordered by `paid_at desc nulls last`, detail by `p.id desc`. On a multi-payment order they could name different methods — including **COD vs VA**, the fact `createShipment` turns into a cash-collection instruction for a courier. |
| **The flash badge ran on the merchant's laptop clock** | `isLive` had just been moved to the server so the list could not contradict the till. The line directly below still computed "Terjadwal" from `Date.now()` **in the browser**. |
| **`_` matched all 842 orders** | Search terms went into `ILIKE '%…%'` unescaped. Never injection — all parameterised — but `%`/`_` are wildcards and the merchant is typing a search box. `SPX_123` also matched `SPX0123`. |

The LIKE bug was fixed **as a class**: the identical regex had already been hand-written twice
(`data/areas.ts`, `data/orders.ts`) and a third site (`actions/taxonomy.ts`) was missed. It is now one
shared `@tokophi/lib/like` with a test pinning **both** directions — wildcards neutralised *and*
ordinary Indonesian search terms left untouched, because over-escaping would stop real order numbers
matching.

## PART 2 — A quota anyone could spend, a restore that trusted a join (`#118`, `da72533`)

- **`getShippingRates` was gated on a session only.** Every other mutating action in
  `actions/shipping.ts` demands `orders:write`, and every call to this one is a **live KiriminAja rate
  request**. Now `orders:write`, the same gate as the `createShipment` it pairs with.
- 🔴 **The `batal`/`retur` inventory restore had no tenant boundary.** It picks one row via
  `join locations loc … order by loc.is_default desc`. `inventory_levels` has no `store_id` so RLS
  cannot scope it, and **this is the copy reachable from `ka-tracking.ts`, which runs on the OWNER
  connection with RLS off entirely**. The join only *picked* a row; it never proved whose. `storeId` was
  already a parameter of `applyOrderStatusChange` — it now uses it.
- **`/diskon/1042` was a 500** (Postgres `22P02`). `/promo/[id]` had worked this out and guarded itself
  with a **private regex**, which is exactly why the three routes beside it never got it. Now
  `lib/uuid.ts`, used by all four.
- **`actions/flash.ts` returns instead of throwing.** Next masks a thrown Error in production, so four
  merchant-actionable rules arrived as an opaque digest. ⚠️ The **editor changed in the same commit and
  had to** — it awaited the action and ignored the return, so returning instead of throwing would have
  reported *"Flash sale dibuat."* over a save that never happened.

---

## PART 3 — PageSpeed, measured

Lighthouse, `https://toko.tokophi.com/`, mobile, throttled preset. Every row is a real run.

| | perf | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|
| Baseline, **no pixels** | 90 | 2.0 s | 2.1 s | 130 ms | 0 |
| Pixels ON, old code | **66** | 2.7 s | 2.8 s | **770 ms** | 0 |
| After `#119` + `#120` | **75** | 1.6 s | 1.7 s | 690 ms | 0 |
| After `#122`, median of 3 | **89** | 1.8 s | 2.1 s | 100 ms | 0 |

⚠️ **Read the variance before quoting a number.** Lighthouse against a real CDN is noisy, and a single
run is not a result. Measured after `#122` landed (`d11a96d`, verified by SHA on the running container):

| | runs | median | range | TBT per run |
|---|---|---|---|---|
| Mobile | 92 · 76 · 89 | **89** | 76–92 | 80 ms · **630 ms** · 100 ms |
| Desktop | 71 · 66 · 90 · 92 | **80** | 66–92 | 0 ms in all four |

**Mobile is a real win: 66 → 89** against the same page with the same three pixels configured.

**Desktop cannot be claimed either way.** Its baseline (84) was a *single* run, and the post-change
range is 66–92 — the noise swamps the difference. TBT is **0 in every desktop run**, so the swing is
LCP/network, not the pixels. Do not report a desktop delta from this data; take ≥5 runs first.

🔎 **Why one mobile run showed 630 ms TBT:** `scroll` is one of our pixel load triggers, and Lighthouse
**scrolls the page during a run** (for the full-page screenshot). When that scroll lands before TTI is
computed, that run pays for all three vendor bundles and the score drops ~15 points. This is the design
working as intended — a scrolling human is an engaged human — but it means the mobile score is
*bimodal*, not noisy. If a future session wants a stable number, that is the reason, and removing
`scroll` from the trigger list is the lever (at the cost of not tracking readers who never tap).

Desktop baseline for reference: perf 84 · **a11y 100 · best-practices 100 · SEO 92**.

### The finding that reframed the whole task
**The pixels were the page.** Filling in the three ad channels cost **24 points** and 6× the TBT. The
downloads were never the problem — all three were already `async`. The cost is **parse + execute** of
three third-party bundles on the main thread during the paint.

### What shipped
1. **Inter self-hosted** (`#119`). The Google Fonts `<link>` was render-blocking for **1.409 ms** in
   *three* layouts, and the homepage LCP was **82% render delay** — the LCP element is an `<h1>`, i.e.
   text waiting on a font on a third-party origin. One variable file per subset covers 100–900; latin +
   latin-ext only; preloaded same-origin. `LandingLayout` had also been asking for weight 800 the other
   two never loaded, so a bold heading there was silently synthesised.
2. **Real image width variants** (`#119`, `#120`). `uses-responsive-images` scored **0**, wasting
   **461 KiB** — a 1920×1080 hero delivered whole to a 412 px phone. `?w=` only works for
   `/api/uploads/*`; on `public/` it is a meaningless query on the same bytes. So the widths are made
   real: `scripts/gen-image-widths.mjs`, 153 renditions, idempotent, never upscales. Mobile hero
   candidate **9.9 KB vs 66 KB**.
3. **Pixels load on first interaction** (`#122`), 10 s backstop, no `requestIdleCallback`.
4. **`/promo` added to the sitemap** (`#119`) — it renders `index,follow` and is a default nav item.
   Its `/promo/<handle>` children are `noindex,follow` ad funnels and stay out on purpose.

### ⚠️ A regression I shipped and then measured my way back out of
`#119` added `data-srcset` to the hero, but the carousel's `wake()` promoted it **only on the
`<source>` element, never on the `<img>`**. So waking a slide assigned `src` with no srcset and the
browser committed to the full 1920×1080 original — **106 KB wasted** on images not yet on screen. Fixed
in `#120`.

This class is invisible to every static check: markup right, `astro check` green, bytes wrong. **Only a
browser sees `currentSrc`.** It is now guarded by `scripts/check-hero-srcset.mjs`.

### The trade the owner made, on the record
Pixels now wait for a real interaction. **A visitor who lands and leaves inside 10 s without touching
the page is never counted as a PageView by Meta/Google/TikTok.** That is real bounce data, traded
knowingly for the TBT.

**Not** affected, and this is why the trade was acceptable: a conversion is built from the **ORDER ROW
on the server** (ADR 0012), never from the browser, and a shopper who buys has by definition
interacted. `/api/track` — our own funnel analytics — is untouched and still fires on every page view.

---

## Runnable checks this session left behind

Three, all under `apps/storefront/scripts/`. They exist because each guards a failure that is **silent
under `tsc`, lint and `astro check`**:

```bash
npx astro build --root apps/storefront
DATABASE_URL=… PORT=4373 node apps/storefront/dist/server/entry.mjs &

node apps/storefront/scripts/check-pixel-defer.mjs    # tracking survives the deferral
node apps/storefront/scripts/check-hero-srcset.mjs    # srcset is actually promoted (port 4374)
node apps/storefront/scripts/gen-image-widths.mjs     # regenerate renditions (idempotent)
```

`check-pixel-defer.mjs` needs the tenant to HAVE pixels configured, or the component renders nothing
and there is nothing to look at.

---

# NEXT — in priority order

> ▶ **This list is now maintained in [`NEXT.md`](./NEXT.md)**, which carries the whole queue (not just
> this session's leftovers) with sizes and acceptance criteria. What follows is the snapshot as of this
> handoff; if the two disagree, `NEXT.md` is newer.

### 1. ~~Confirm `#122` landed and re-measure~~ ✅ DONE
Landed as `d11a96d` (verified by reading the SHA off the running container, not by inference — an
earlier guess that a container swap *was* `#122` turned out to be `#121`'s build). Mobile median
**89** (66 → 89 with pixels on). Numbers and variance are in the table above.

**Left undone deliberately: a defensible DESKTOP number.** Four runs span 66–92, so nothing can be
said about desktop yet. Take ≥5 runs and use the median before claiming any desktop delta.

### 2. Two Cloudflare zone settings — APPROVED, procedure written, NOT done
Full steps, API equivalents and verification commands: **`specs/docs/CLOUDFLARE-PERF.md`**.
Not doable from this repo — wrangler auth is expired and these are zone settings, not Workers.
- **Email Obfuscation → Off.** Injects a **render-blocking** `email-decode.min.js`, measured
  **1.621 ms** — the single largest blocker on the page, triggered by our own `mailto:` links.
- **Cache Rules for static assets.** ⚠️ Read the table: the SOURCE images must **not** be `immutable`
  — a merchant replacing a photo keeps the filename.

### 3. Remaining PageSpeed items, cheapest first
- `dom-size` **992 elements** (scores 0). The homepage renders a lot; the carousel ships all slides.
- `unused-javascript` 44 KiB · `legacy-javascript` 12 KiB.
- `speed-index` **7.1 s** while LCP is 1.7 s — something is still painting late. Not yet diagnosed.

### 4. Order-lifecycle leftovers not closed this session
- `orders.ship_district_id IS NULL` on **77 rows** — the guess is now *visible*, but the data is still
  missing. A backfill from `ship_kelurahan_id`/postcode would remove the guess entirely.
- The default-location expression still exists in **four** hand-written copies (`products.ts` ×3,
  `purchases.ts` ×2, `inventory.ts`, `order-status.ts`). Only the last one carries the tenant filter.
- `promo`/`landing` actions still `throw` for user-facing rules; only `flash.ts` and `theme.ts` were
  converted.

### 5. Open owner decision, carried over and still open
**The impersonation token is replayable inside its 2-minute window, rides in a query string, and mints
a 7-day session that outlives the operator's `platform_session`.** Untouched — it is an account-takeover
path into any merchant and the decision is the owner's.

---

## What this session should teach the next one

- **Grep the claim before trusting the comment.** `destinationGuessed` was described in prose as
  existing. It did not. Two other comments this wave were similarly ahead of the code.
- **A private copy of a rule is why the sites beside it never get it.** `/promo/[id]`'s inline UUID
  regex, and the LIKE-escape regex written twice by hand, both cost sibling call sites.
- **Converting a throwing action to `{ok, error}` is a two-file change.** The caller that ignores the
  return will report success over a failure — worse than the bug being fixed.
- **Measure, then read the diff — not the other way round.** The srcset regression was invisible in
  review and obvious in a browser.
- **State the cost of a trade in the code, not just in the PR.** The pixel decision has its reasoning,
  its numbers and its accepted loss written at the call site, because the next person to see
  `setTimeout(once, 10000)` will otherwise "fix" it.
