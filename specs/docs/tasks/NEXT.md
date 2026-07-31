# NEXT — what to pick up, in order

> Standing follow-up list. **Newest state as of 2026-08-01**, after `#117`–`#125` (all merged and
> deployed; live SHA `d4162a3`).
>
> Pairs with `BACKLOG.md` (priorities), `WORKLOG.md` (session log) and the dated handoffs in this
> folder. **Legend:** size **S** (<1h) / **M** (half a day) / **L** (a day+). AC = acceptance criteria.
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
- **Cache Rules for static assets.** ⚠️ Read the table in that doc first: `/products/*.webp` and the
  other **SOURCE** images must **not** be `immutable` — a merchant replacing a photo keeps the
  filename, and we cannot purge what we told the world never changes.

**AC:** the `curl -I` checks in that doc return what it says they should.

---

## 🟠 PERFORMANCE — the measurable tail

Current: **mobile median 89** (66 → 89 this session). Desktop **not claimable** yet, see N3.

### N3. A defensible desktop number · **S**
Four runs spanned **66–92** against a single-run baseline of 84, with **TBT 0 in all four** — so the
swing is LCP/network, not the pixels, and nothing can be said yet.

```bash
for r in 1 2 3 4 5; do
  npx -y lighthouse@12 https://toko.tokophi.com/ --form-factor=desktop --screenEmulation.disabled \
    --throttling.rttMs=40 --throttling.throughputKbps=10240 --throttling.cpuSlowdownMultiplier=1 \
    --quiet --chrome-flags="--headless=new --no-sandbox" --output=json --output-path=./d$r.json
done
```
**AC:** ≥5 runs, report the **median and the range**, never a single run. If the median is still ~84,
say the work was neutral on desktop — that is a result too.

### N4. `speed-index` 7.1 s against an LCP of 1.7 s — undiagnosed · **M**
The page reaches its largest paint in under two seconds and then keeps changing for another five. Not
investigated at all yet. Start with the Lighthouse filmstrip (`--output=html`) and find which frame is
still moving.

### N5. `dom-size` 992 elements (scores **0**) · **M**
The homepage ships every carousel slide and every section. Candidates: render only slide 1 server-side
and hydrate the rest, or cut the number of sections the default homepage template seeds with.
⚠️ **`SectionRenderer` must keep switching on every type** — narrowing the palette must never delete a
merchant's published work (AGENTS.md, Store Builder).

### N6. `unused-javascript` 44 KiB · `legacy-javascript` 12 KiB · **S**
Cheapest remaining wins. Check the Vite `build.target` first — legacy transpilation for browsers we do
not support is the usual cause.

### N7. Optional: make the mobile score stable · **S** — has a real cost, decide first
The mobile score is **bimodal, not noisy**: `scroll` is one of our pixel load triggers and Lighthouse
scrolls during a run, so a run where that lands before TTI pays for all three vendor bundles
(**TBT 630 ms vs 80 ms**, ~15 points).

Removing `scroll` from the trigger list in `MarketingPixels.astro` stabilises it — **at the cost of not
tracking a reader who scrolls the whole page and never taps**. That is a real segment. Do not do this
for the score alone.

---

## 🟡 ORDER LIFECYCLE — leftovers from the `#117`/`#118` audit

### N8. Backfill `orders.ship_district_id` — **77 rows** · **M**
The guess is now *visible* (`destinationGuessed`, `#117`) but the data is still missing. Backfilling
from `ship_kelurahan_id` / `ship_postcode` would remove the guess entirely rather than merely announce
it.
**AC:** `select count(*) from orders where ship_district_id is null` drops, and every backfilled row's
district agrees with its kelurahan's parent — verified in a rolled-back transaction before committing.

### N9. The default-location expression still has **four** hand-written copies · **S**
`actions/products.ts` (×3), `actions/purchases.ts` (×2), `actions/inventory.ts`, `lib/order-status.ts`.
Only the last one carries the tenant filter (added in `#118`).

⚠️ Do not just add the filter to the other three — **extract one helper**, or the fifth copy will be
written next month. This is the same class as the LIKE-escape regex and the UUID guard, both of which
cost sibling call sites this session.

### N10. `promo` and `landing` actions still `throw` for user-facing rules · **S**
Next **masks** a thrown Error in production, so the merchant gets a digest instead of the rule they
broke. `theme.ts` and `flash.ts` are converted; these two are not.

⚠️ **This is a two-file change every time.** The caller that awaits and ignores the return will report
success over a failed save — strictly worse than the bug being fixed. `flash-editor.tsx` had exactly
this shape (`#118`).

---

## 🟢 STOREFRONT / SEO — smaller, all measured

### N11. A builder homepage with no Hero renders **zero `<h1>`** · **S**
A merchant who builds a homepage without a Hero section ships a page with no top-level heading.
`CategoryHero` was fixed the same way (always rendered, `#`ADR 0009 note in AGENTS.md); the homepage
has no equivalent floor.

### N12. Merchant UPLOADS have no width variants on the storefront · **M**
`imageSrcSet` handles `/api/uploads/*` via the admin's `?w=` route and now handles seeded `public/`
images via generated files — but a merchant's own uploaded hero goes through the **admin origin**, a
different host, with a preconnect but no CDN rule. Worth measuring on a store that actually uses
uploads before doing anything.

### N13. Sitemap `<lastmod>` is only on blog articles · **S**
Products and categories emit `<changefreq>`/`<priority>` but no `<lastmod>`, which is the field
crawlers actually use to decide what to re-fetch. `products.updated_at` exists.

---

## ✅ Closed this session — do not redo

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
