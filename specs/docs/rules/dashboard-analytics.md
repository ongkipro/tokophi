# Dashboard & Analitik numbers — one source, one day, no rollup

> Moved **verbatim** from `AGENTS.md` on 2026-10-28 (Claude Code warns when `AGENTS.md` exceeds 150k chars, and it is
> loaded in full into every session). `AGENTS.md` keeps a short digest of the rules plus a pointer here; this file keeps
> the reasoning and the incident history. Words like "above"/"below"/"the next section" refer to the old single-file
> layout — follow the named file or section instead. **If this file and the code disagree, the code wins — fix this file.**


> ### 📊 THE RULE: **`analytics_daily` IS RETIRED. Money on a screen is derived from `orders`, live.**
> Its only writer in the whole repo was the seed, so six of seven stores had **zero rows** (an empty
> dashboard over real orders) and the seventh **froze** on the day the seed ran: "Penjualan hari ini
> Rp0 · −100,0%" directly above four orders placed that morning. The table is kept but **unread and
> unwritten** — do not point anything at it, and do not restore the seed insert.

- **`getDailyStats()` (`lib/data/analytics.ts`) is the ONE producer of the daily series.** Revenue is
  `sum(total_idr - tax_idr)` over non-cancelled orders — the same expression `getChannelSalesDaily`,
  `getRegionSales` and `getOrderStats` use, so the chart total equals the Sumber Penjualan total.
- **The series must stay DENSE and end on TODAY.** `resolve()` slices it positionally
  (`all.slice(n - 7, n)`, `all[n-1]` = "Hari ini"), so a bare `GROUP BY` would silently turn
  "7 hari terakhir" into "the last 7 days that sold something". `generate_series` LEFT JOIN the
  aggregates is what makes the range switcher mean what it says.
- ⚠️ **`lib/data/day-bucket.ts` is the ONE definition of a day, and it is WIB.** Every day-bucketed
  query (daily, hourly, channels, product sales, funnel, devices) goes through `dayKey()`, because
  `dashboard.ts` matches their date keys against each other with `Set.has` — a query bucketing in a
  different zone does not error, it just **stops reconciling**. The container's `TimeZone` is UTC, so
  before this "hari ini" began at 07:00 WIB and every merchant's evening fell into "kemarin".
  Known limit: WIB is assumed for every store (`stores` has no timezone column).
- **A figure with no source is "—", never a number.** `visitors`/Konversi/funnel/device split come
  from `analytics_events` (the storefront tracker) and render an honest empty state for a store that
  has none. That is the standing rule that keeps producing bugs when broken — see the ad dashboard
  with no integration behind it.
- 🔴 **AND THE SAME RULE APPLIES TO THE DELTA: `Kpi.delta` / `MoneyTile.delta` are `number | null`.**
  `null` = **there was no previous period to divide by**, and it renders through the shared
  `NO_FIGURE` floor (`pct(null)` → "—"), never a digit. It used to be `prev === 0 ? 0`, so the empty
  seeded store (`snack-rumahan-bu-tati`) was told **"Penjualan hari ini +0,0% vs kemarin"** — a
  measurement of *"unchanged"* on a shop that has never sold anything. Measured in a browser
  2026-08-05 on all three money tiles and all four `/analitik` KPIs.
  ⚠️ **THE BOUNDARY IS THE DENOMINATOR, NOT THE NUMERATOR.** A store that genuinely sold Rp0 today
  after selling yesterday has a **real −100%** and it must stay a number — an em dash there is the
  same lie pointing the other way. Only `prev === 0` is the dash. Both sides are pinned by
  `apps/admin/lib/data/kpi-delta.test.ts` (proved red against both mutations before being trusted).
  ⚠️ **`null >= 0` is `true` in JavaScript**, so every `up = delta >= 0` is a live trap: it paints an
  emerald ↗ over an em dash. `kpi-card.tsx` / `money-strip.tsx` / `sparkline.tsx` take
  `boolean | null` and go **neutral** in that state.
- **NO GOOD/BAD VERDICT MAY BE CARRIED BY COLOUR ALONE (WCAG 1.4.1).** The two on the dashboard are
  the sales delta and the return rate; both badges carry a glyph plus a word (`sr-only` for the
  delta's "naik"/"turun"), and both have a **third, neutral state** for "nothing to judge". The
  return tile's `shipped === 0` used to fall into the `!bad` arm and wear the same **emerald** pill a
  genuinely clean rate wears — a healthy verdict on a store that had never posted a parcel.
  ✅ **CLOSED (N55, verified in code 2026-08-07):** `return-by-courier.tsx` no longer decides by colour
  alone — it renders `TriangleAlert`/`ShieldCheck` with `aria-hidden` plus an `sr-only` word, and its
  own header comment names N55. The bar colour stays as it was; it is now the third signal, not the
  only one. ⚠️ This line said "Still open" for as long as the fix has existed, and `NEXT.md`/`OPEN.md`
  said so too — three places asserting a defect that was already gone. **A closed task must be closed
  everywhere it is named, or the next reader re-fixes it.**
- **Runnable check: `apps/admin/lib/data/daily-stats.test.ts`.** Its Postgres half runs the real
  exported query under `SET LOCAL ROLE tokophi_app`. `vitest.config.ts` aliases `@/` → `apps/admin/`;
  without it no suite can import `lib/data/*` at all.
