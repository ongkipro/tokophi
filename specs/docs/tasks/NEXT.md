# NEXT — what to pick up, in order

> Standing follow-up list. **Newest state as of 2026-08-01**, after `#117`–`#125` (all merged and
> deployed; live SHA `d4162a3`).
>
> Pairs with `BACKLOG.md` (priorities), `WORKLOG.md` (session log) and the dated handoffs in this
> folder. **Legend:** size **S** (<1h) / **M** (half a day) / **L** (a day+). AC = acceptance criteria.
>
> 🔵 **N9 · N10 · N11 · N13 · N3 · N6 are closed** (session `2026-08-01`, handoff
> [`2026-08-01-next-queue-n9-n13.md`](./2026-08-01-next-queue-n9-n13.md)). **Two entries in this file
> rested on claims that turned out to be false — N13's and N6's — and N7 was reversed on evidence.**
> All three are corrected in place below; read them before trusting their sizing.
>
> ▶ **Starting work? The working brief for what is next is
> [`2026-08-01-followups-n5-n14.md`](./2026-08-01-followups-n5-n14.md)** — ① N14, then ② N5.
>
> ⚠️ Before starting anything here: `git fetch && git log origin/main -3`. Several sessions run against
> this repo at once — see the top of `AGENTS.md`.

---

## 🔴 BLOCKED ON THE OWNER — nobody else can do these

### N1. Impersonation token — an account-takeover path into any merchant · **L**
Carried over across several sessions and still open. **This is a decision, not a task.**

The super-admin impersonation token:
- is **replayable** inside its 2-minute window,
- rides in a **query string** (so it lands in logs, `Referer` headers and browser history),
- mints a **7-day session** that outlives the operator's own `platform_session`.

Any of the three alone is arguable; together they mean a leaked URL is a merchant's account.

**Options to put to the owner** (do not pick one unilaterally): single-use token (consume on redeem) ·
POST + body instead of a query string · bind the minted session's expiry to the operator's
`platform_session` · all three.

**AC:** a decision recorded in `specs/decisions/`, then implemented, then a test that the second
redemption of one token fails.

### N2. Two Cloudflare zone settings — APPROVED 2026-08-01, procedure written, NOT done · **S**
Full steps, API equivalents and verification commands: **`specs/docs/CLOUDFLARE-PERF.md`**.

Not doable from this repo: wrangler auth is expired and these are **zone settings, not Workers**.

- **Email Obfuscation → Off.** Injects a **render-blocking** `email-decode.min.js`, measured
  **1.621 ms** — the single largest blocker on the page, triggered by our own `mailto:` links.
  ✔ **Re-confirmed still ON, 2026-08-01**: the homepage serves 2 `/cdn-cgi/l/email-protection` links
  and `email-decode.min.js` loads in every run. Nothing has been changed in the zone yet.
- **Cache Rules for static assets.** ⚠️ Read the table in that doc first: `/products/*.webp` and the
  other **SOURCE** images must **not** be `immutable` — a merchant replacing a photo keeps the
  filename, and we cannot purge what we told the world never changes.

**AC:** the `curl -I` checks in that doc return what it says they should.

---

## 🟠 PERFORMANCE — the measurable tail

**Re-measured 2026-08-01 against production, same commands, 8 runs.**
**Mobile: median 92, range 82–95** (n=3) · **Desktop: median 100, range 90–100** (n=5).
Two entries below were rewritten by that data — **N6 is closed as not reproducible and N7 is
reversed**. Read them before spending anything here.

### ✅ N3. A defensible desktop number — MEASURED 2026-08-01
**5 runs · MEDIAN 100 · range 90–100 · TBT 0 ms in all five.** Command exactly as prescribed below.

| run | perf | FCP | LCP | TBT | SI | CLS |
|---|---|---|---|---|---|---|
| 1 | 90 | 1,4 s | 1,5 s | 0 ms | 1,4 s | 0,002 |
| 2 | 100 | 0,6 s | 0,7 s | 0 ms | 0,6 s | 0 |
| 3 | 100 | 0,3 s | 0,5 s | 0 ms | 0,4 s | 0 |
| 4 | 100 | 0,5 s | 0,6 s | 0 ms | 0,5 s | 0 |
| 5 | 100 | 0,7 s | 0,7 s | 0 ms | 0,5 s | 0 |

The old 66–92 spread was **run 1 in every series** — a cold origin/cache — not the pixels: TBT was 0
throughout, then and now. Report the median with the range, and note that run 1 is systematically the
slow one; a 4-run series that happens to start cold will understate this by ~10 points.
⚠️ **`speed-index` 7,1 s (N4) does NOT reproduce on desktop** — median 0,5 s here. It is a mobile
finding and must be re-measured as one.

<details><summary>the original entry, kept because the method is the point</summary>

Four runs spanned **66–92** against a single-run baseline of 84, with **TBT 0 in all four** — so the
swing is LCP/network, not the pixels, and nothing can be said yet.
</details>

```bash
for r in 1 2 3 4 5; do
  npx -y lighthouse@12 https://toko.tokophi.com/ --form-factor=desktop --screenEmulation.disabled \
    --throttling.rttMs=40 --throttling.throughputKbps=10240 --throttling.cpuSlowdownMultiplier=1 \
    --quiet --chrome-flags="--headless=new --no-sandbox" --output=json --output-path=./d$r.json
done
```
**AC:** ≥5 runs, report the **median and the range**, never a single run. If the median is still ~84,
say the work was neutral on desktop — that is a result too.

### N4. `speed-index` lags LCP — still open, but **re-measure before sizing it** · **M**
Re-measured 2026-08-01: mobile **SI median 4,1 s (range 2,7–4,3) against LCP 2,8 s** — a ~1,3 s gap,
not the 5,4 s this entry was written for. On **desktop it does not reproduce at all** (SI median
0,5 s). It is a mobile finding; treat the 7,1 s as stale.

Still worth the filmstrip (`--output=html`) to see which frame is still moving — but with TBT at 0 ms
in the good runs and a 992-element DOM, expect it to point at the same place N5 does.

### 🔺 N5. `dom-size` 992 elements (scores **0**) — now the TOP performance item · **M**
Promoted 2026-08-01. With N6 closed (no JS to trim) and N7 reversed (the pixels are not what swings
the score), this is the only remaining lever with evidence behind it: `mainthread-work-breakdown`
**3,4 s** against `bootup-time` 0,5 s means the cost is style/layout over this DOM, not script.
Still 992 elements, still scoring 0, unchanged by everything shipped in `#119`–`#125`.
The homepage ships every carousel slide and every section. Candidates: render only slide 1 server-side
and hydrate the rest, or cut the number of sections the default homepage template seeds with.
⚠️ **`SectionRenderer` must keep switching on every type** — narrowing the palette must never delete a
merchant's published work (AGENTS.md, Store Builder).

### ✅ N6. `unused-javascript` 44 KiB · `legacy-javascript` 12 KiB — NOT REPRODUCIBLE, closed 2026-08-01
**Both audits PASS with 0 bytes of savings in all 8 runs measured today** (5 desktop + 3 mobile,
production). There is nothing to fix and nothing to tune.

🔴 **The suggested cause was impossible.** "Check the Vite `build.target`" assumes a bundle:
`apps/storefront/dist/client/_astro/` contains **one CSS file and zero `.js`**. Every script on the
page is inline (14 blocks, 63,7 KB uncompressed). There is no transpiled bundle here to target.

Only **two** scripts load on the page, both Cloudflare's, neither ours:
```
 1 058 B  /cdn-cgi/scripts/…/cloudflare-static/email-decode.min.js   ← N2, still on
11 577 B  static.cloudflareinsights.com/beacon.min.js
```
The three vendor pixel bundles did **not** load in any run — the deferral (`#122`) is working.

**Reopen only with a run that reproduces it**, and say which URLs the audit named — most likely those
KiB were measured *before* `#122` deferred the pixels, i.e. they were the vendors' bundles all along.

### 🔴 N7. DO NOT DO THIS — the stated cause is not what the runs show · **decision reversed 2026-08-01**
The bimodality is real. **The explanation is not.** Three mobile runs today:

| run | perf | TBT | vendor pixel scripts loaded |
|---|---|---|---|
| 1 | 82 | **395 ms** | **0** |
| 2 | 92 | 26 ms | **0** |
| 3 | 95 | 0 ms | **0** |

The swing from 0 → 395 ms TBT happens with **no pixel bundle loading at all** — Lighthouse's scroll
does not fire them (the only scripts on the page are Cloudflare's two). So removing `scroll` from
`MarketingPixels.astro` would **pay a real tracking cost — the reader who scrolls the whole page and
never taps — and buy nothing.**

What is left to blame is our own main thread: `mainthread-work-breakdown` **3,4 s** with
`bootup-time` 0,5 s, on a **992-element DOM**. That is style/layout, not script. **N5 is the lever.**
**AC before touching the trigger list again:** a run where a vendor bundle actually appears in
`network-requests` *and* TBT moves with it.

---

## 🟡 ORDER LIFECYCLE — leftovers from the `#117`/`#118` audit

### N8. Backfill `orders.ship_district_id` — **77 rows** · **M**
The guess is now *visible* (`destinationGuessed`, `#117`) but the data is still missing. Backfilling
from `ship_kelurahan_id` / `ship_postcode` would remove the guess entirely rather than merely announce
it.
**AC:** `select count(*) from orders where ship_district_id is null` drops, and every backfilled row's
district agrees with its kelurahan's parent — verified in a rolled-back transaction before committing.

### ✅ N9. The default-location expression — DONE on `feat/next-queue`
One helper, `apps/admin/lib/inventory-location.ts`, replacing all five copies.

⚠️ **This entry undersold it.** It was not "only the last one carries the tenant filter" as a tidiness
problem — `purchases.ts` (2 copies), `inventory.ts` (1) and `products.ts` (3) had **zero**
`locations.storeId` between them, so a foreign `variantId` resolved to another store's shelf and the
stock write landed there in silence. `order-status.ts` was the only guarded copy. Guarded now by a
source scan (`inventory-location.test.ts`) that fails if the expression is written anywhere else.

### ✅ N10. `promo` / `landing` actions — DONE on `feat/next-queue`
⚠️ **This entry was already stale when it was written.** `actions/promo.ts` and `actions/landing.ts`
contain **zero `throw`s** — `savePromoPage`/`saveLanding` return `{ ok, error }` and both callers read
it. The real gap was next door: **`deleteLanding` returned `void`**, so the editor toasted "Landing
dihapus" and navigated away even when the DELETE matched nothing (a foreign id is filtered out by RLS
without an error; so is a second click on a stale tab). `.returning()` decides now, and the caller
reads it — the two-file change, in one commit.

---

## 🟢 STOREFRONT / SEO — smaller, all measured

### ✅ N11. A builder homepage with no Hero renders zero `<h1>` — DONE on `feat/next-queue`
`index.astro` renders `<h1 class="sr-only">{store.name}</h1>` when the template holds no `hero`
section — hidden, because the merchant designed that page and a visible headline we wrote would be us
editing it. Driven over HTTP against a real build + real DB, both branches (1 `<h1>` without a hero,
the hero's own with one). Premise pinned by `sections/h1-floor.test.ts`.

### N14. `Hero` emits one `<h1>` PER SLIDE — every store's homepage ships **three** · **S**
Found while measuring N11, deliberately not fixed there (the floor does not fire when a hero exists,
so it neither causes nor worsens this). The seeded 3-slide carousel publishes three `<h1>`s on the
page that matters most. AGENTS.md already names it in passing — "a second one is the a11y defect the
homepage carousel already has" — but nothing tracked it.
⚠️ The non-first slides are `inert` + `opacity-0`, **not** `hidden`, so they are still in the
accessibility tree. Whatever the fix is (one `<h1>` outside the slides, or `<h1>` on slide 1 and
`<h2>`/`<p>` on the rest), it must not break the cross-fade the current markup exists for.
**AC:** exactly one `<h1>` in the SSR response for a multi-slide hero; `h1-floor.test.ts` extended to
pin the count, not just the emitter.

### N12. Merchant UPLOADS have no width variants on the storefront · **M**
`imageSrcSet` handles `/api/uploads/*` via the admin's `?w=` route and now handles seeded `public/`
images via generated files — but a merchant's own uploaded hero goes through the **admin origin**, a
different host, with a preconnect but no CDN rule. Worth measuring on a store that actually uses
uploads before doing anything.

### 🟡 N13. Sitemap `<lastmod>` — pages DONE, products + categories BLOCKED ON A MIGRATION · **M**, not S
🔴 **`products.updated_at` DOES NOT EXIST.** This entry claimed it does. `products` carries
`created_at` only, and `collections` has **no timestamp column at all** — `data/catalog.ts`'s own
ordering comment already said so ("not even `created_at` — checked"). So the only date the sitemap
could emit for either is one that never moves after insert, and Google's response to a `<lastmod>` it
finds unreliable is to distrust the field **for the whole document** — costing blog + pages the real
signal they do have. The sitemap now records that reasoning in the file itself.

**Done on `feat/next-queue`:** `/halaman/*` carries `<lastmod>` — `pages.updated_at` exists *and* is
genuinely maintained (`actions/pages.ts` sets it from one shared `fields()` used by create and
update). Verified over HTTP: 55 URLs, 21 `<lastmod>` = 15 blog + 6 halaman.

**What is left** is a schema decision, not a sitemap edit: add `updated_at` to `products` (and
`collections`) + every write path that must touch it. ⚠️ Idempotent migration, and
`git show origin/main:packages/db/drizzle/meta/_journal.json | tail` **before** generating one.
**AC:** editing a product moves its `<lastmod>`; a product nobody has touched keeps its old one.

---

## ✅ Closed on `feat/next-queue` (2026-08-01) — not merged yet

- **N9** one helper (`lib/inventory-location.ts`) + the tenant filter the other four copies never had.
- **N10** `deleteLanding` returns `{ ok, error }`; the editor reads it. The rest of N10 was already done.
- **N11** homepage `<h1>` floor, driven over HTTP against a real build.
- **N13** `/halaman/*` `<lastmod>`; products/categories blocked on a migration, reasoning written into
  the sitemap itself.
- **N3** measured: desktop **median 100, range 90–100** over 5 runs.
- **N6** re-diagnosed — the premise was wrong, see the entry.
- New: **N14** (hero emits one `<h1>` per slide).

## ✅ Closed the session before — do not redo

- `destinationGuessed` now exists and is surfaced on both the single-order and bulk paths (`#117`).
- `markLabelsPrinted` reports rows actually written (`#117`).
- `createOrderPayment` refuses terminal orders and second live bills (`#117`, merged with the stronger
  duplicate-bill guard from `#116`).
- One definition of "the order's payment", shared by the list and the detail (`#117`).
- Flash "Terjadwal" badge derived on the server, not the merchant's laptop clock (`#117`).
- LIKE wildcards escaped — as a **class**, via `@tokophi/lib/like`, across all three sites (`#117`).
- Homepage JSON-LD (Organization + WebSite), `SearchAction` → `/cari?q=` **verified against the real
  route** (`#119`).
- `getShippingRates` gated on `orders:write` (`#118`).
- 🔴 Inventory restore scoped to the tenant explicitly — it runs on the OWNER connection where the
  `locations` join proved nothing (`#118`).
- Four routes no longer 500 on a malformed id, via one shared `isUuid` (`#118`).
- Inter self-hosted; Google Fonts was render-blocking **1.409 ms** across three layouts (`#119`).
- Real image width variants + `srcset` on the hero and five section components (`#119`, `#120`).
- `/promo` in the sitemap (`#119`).
- Marketing pixels load on first interaction (`#122`) — **owner decision, with its cost recorded**:
  bounce PageViews under 10 s are gone; revenue attribution is unaffected (ADR 0012).
- Canonical self-canonicalises `?page` (`#118`).

## 🧪 Runnable checks this work left behind

Each guards a failure that is **silent** under `tsc`, lint and `astro check`:

```bash
npx astro build --root apps/storefront
DATABASE_URL=… PORT=4373 node apps/storefront/dist/server/entry.mjs &

node apps/storefront/scripts/check-pixel-defer.mjs   # tracking survives the deferral
node apps/storefront/scripts/check-hero-srcset.mjs   # srcset actually promoted (port 4374)
node apps/storefront/scripts/gen-image-widths.mjs    # regenerate renditions (idempotent)
```

`check-pixel-defer.mjs` needs the tenant to HAVE pixels configured, or the component renders nothing
and there is nothing to look at.
