# Storefront performance — the critical path

> Moved **verbatim** from `AGENTS.md` on 2026-10-28 (Claude Code warns when `AGENTS.md` exceeds 150k chars, and it is
> loaded in full into every session). `AGENTS.md` keeps a short digest of the rules plus a pointer here; this file keeps
> the reasoning and the incident history. Words like "above"/"below"/"the next section" refer to the old single-file
> layout — follow the named file or section instead. **If this file and the code disagree, the code wins — fix this file.**


Measured with Lighthouse against production, 2026-07-31. Numbers, not intuition.

> ### 🧪 RUN THEM AS A SUITE: **`npm run verify -w @tokophi/storefront`** (from the repo root)
> Builds if the build is stale, starts ONE storefront, runs **all six** `check-*.mjs` in
> `apps/storefront/scripts/` against it, prints a pass/fail table and exits non-zero if anything is
> red. It kills **only the process group it spawned** — never `pkill`, so another agent's server on
> another port is untouched — and a port that is already taken fails in one second with the port
> number in the message instead of hanging.
> - **There is ONE invocation contract now** (`scripts/check-env.mjs`): `CHECK_BASE_URL` (an origin —
>   the hostname selects the tenant, ADR 0009) and `DATABASE_URL` from the environment. The old
>   `T_URL` / `H1_PORT` / `DPR` are **retired and fail loudly** rather than being ignored. They had
>   two different meanings of `T_URL` and four default ports between them, and on 2026-08-02 a reviewer
>   started one server, pointed three checks at it and reported **three regressions that did not
>   exist**. A check that is hard to run correctly gets run wrongly — same family as `verify-rls`.
>   ⚠️ **This sentence was FALSE for `check-search-srcset` until 2026-08-03**, and false in the way
>   that matters: the loud failure lives in `check-env.mjs`, so a script that never imports it cannot
>   fail loudly. That check shipped in the same wave that converged the others, was left out of the
>   runner's `CHECKS` array, and kept its own `T_URL`/`DPR` on a sixth default port (4411) — so
>   `npm run verify` ran five of six and the search-palette fix had a guard nobody ran. Both halves are
>   now pinned by **`apps/storefront/scripts/checks-registered.test.ts`**, which derives the expected
>   list from the DIRECTORY: a new `check-*.mjs` that is not in `CHECKS`, or a server-needing check
>   that does not import `check-env.mjs`, or any check reading a retired variable, fails `npm test`.
>   *(`audit-responsive.mjs` and `gen-image-widths.mjs` are deliberately outside the suite and are not
>   `check-*`: the first sweeps a **dev** server for horizontal overflow at many widths via
>   `npm run audit:responsive`, the second is a build-time generator.)*
> - **Three results, not two: PASS / FAIL / SKIP.** SKIP (exit code 2) means the check does not APPLY
>   to the data it was pointed at. It is printed with its reason on every run and never counted as a
>   pass — see `check-pixel-defer` below.
> - ⚠️ **`fetch` CANNOT send a `Host` header** — undici derives it from the URL and silently drops
>   yours, so `fetch("http://127.0.0.1:4390/", {headers:{host:"toko-demo.test"}})` is answered by the
>   404 page. Use `getAsTenant()` (node:http). `check-pixel-defer` had been asserting "no vendor
>   `<script src>` in the served HTML" against that 404 for its whole life — the loudest claim in the
>   file was vacuous. Found and fixed 2026-08-03.

- 🔴 **MARKETING PIXELS ARE THE DOMINANT COST, AND THEY ARE DEFERRED.** Turning Meta + Google + TikTok
  on took mobile from **90 → 66** and Total Blocking Time from **130 ms → 770 ms**. The downloads were
  never the problem — all three were already `async`. The cost is PARSE + EXECUTE of three third-party
  bundles on the main thread while the browser is trying to paint.
  `MarketingPixels.astro` injects the vendor `<script>`s only on **FIRST INTERACTION**, with a 10 s
  backstop and deliberately **no `requestIdleCallback`** (owner decision 2026-08-01: with `rIC` the
  browser went idle at ~2 s and all three bundles still executed inside Lighthouse's TBT window —
  mobile stuck at 75, TBT 690 ms, 600 ms of it third-party). Every stub, queue and `init` stays
  SYNCHRONOUS.
  ⚠️ **THE COST WAS ACCEPTED KNOWINGLY:** a visitor who lands and leaves inside 10 s without touching
  the page is never counted as a PageView by Meta/Google/TikTok. Revenue attribution is NOT affected —
  a conversion is built from the ORDER ROW on the server (ADR 0012) and a shopper who buys has by
  definition interacted — and `/api/track` still fires on every page view. Revisit with a measurement,
  not an opinion. That is what makes it lossless:
  `fbq.queue`, `dataLayer` and `ttq`'s method array are the vendors' own documented buffers, so a call
  made before the SDK arrives is replayed in order. **Do not "simplify" a stub back into its vendor
  snippet** — the stock snippet injects the script as its last line, which silently undoes this.
  Guarded by `apps/storefront/scripts/check-pixel-defer.mjs` (a BROWSER check: build, lint and
  `astro check` all stay green while events are being dropped).
  ⚠️ **It asserts the channels THIS TENANT enabled, read from `store_tracking_channels` — never a
  hard-coded three.** It used to demand `hosts.length === 3` while the seeded store has exactly one
  channel (`batik-nusantara | meta`), so it was red on clean `main`, for every change set, forever —
  and this repo has already paid for that once: `verify-rls` sat red for weeks, everyone learned to
  scroll past it, and two cross-tenant leaks shipped past a verifier that was already failing. The
  claim that was always meant — *every channel the merchant switched on is stubbed synchronously,
  buffers, and loads on interaction, and nothing loads for a channel that is off* — is true on the
  seeded data and stays true on a tenant with all three. A tenant with none is SKIP, not PASS.
- **Inter is SELF-HOSTED** (`public/fonts/`, `@font-face` in `styles/global.css`). The Google Fonts
  `<link>` was render-blocking for **1.409 ms** in three layouts, in front of an LCP that was **82%
  render delay** — the LCP element is an `<h1>`, i.e. text waiting on a font on a third-party origin.
  latin + latin-ext only, one variable file per subset covering 100–900.
- **Static images have REAL width variants**, generated by `scripts/gen-image-widths.mjs` and emitted
  by `imageSrcSet` (`data/catalog.ts`). `?w=` only works for `/api/uploads/*` (the admin serves those);
  for `public/` it is a meaningless query on the same bytes, which is worse than no srcset.
  ⚠️ **EVERY `w` DESCRIPTOR IS READ OFF THE FILE, NEVER ASSERTED BY HAND.** The generator writes
  `src/data/static-image-widths.ts` — each source's real intrinsic width plus the renditions that
  actually exist beside it — and `staticSrcSet` reads only that. It replaced two hand-kept constants
  that were both wrong, and a descriptor is the one field in a candidate the browser cannot verify:
  `/products/` was labelled `800w` while **14 of its 70 sources are 600 × 600** (over-claim 33%, on the
  FIRST image of every product), and `/sections/` was labelled `1920w` for a **1200 px** file
  (over-claim 60%) and a **2000 px** one (under-claim); only `/hero/` was honest. The per-file ladder
  also makes the old "`STATIC_WIDTHS` and `PLAN` must stay identical" rule structural — a rung with no
  file on disk is a 404 the browser may pick as its best candidate, and now the ladder *is* the list of
  files that were generated. An image missing from the manifest gets **no** srcset, which is the safe
  failure: no claim beats a wrong one. Guarded by `scripts/check-image-widths.mjs`, which reads the
  real dimensions off disk with sharp (no browser, no server — it cannot flake).
- ⚠️ **A `data-srcset` must be promoted onto the IMG, not only onto its `<source>`.** The hero
  carousel wakes slides 2..n by assigning `src`; if the img's own srcset is not set FIRST, the browser
  has already committed to the single `src` URL — the full-size original. Invisible to every static
  check (markup right, build green, bytes wrong); only `currentSrc` in a browser shows it. Guarded by
  `scripts/check-hero-srcset.mjs`.
- **`sizes` is derived from the component's OWN layout and named as a constant.** The browser trusts
  `sizes` completely when choosing a candidate, so a wrong one is worse than no srcset at all.
  ⚠️ **A `max-w-*` is only a `sizes` if you can name the viewport at which it starts binding.** On the
  PDP thumbnail rail it caps a `flex-1 basis-0` share, so declaring the cap over-claimed by 1,7× and
  cost a whole rung (17 468 B). In the mobile drawer the same class on a `w-full` element pinned to the
  viewport binds exactly, so `(min-width: 416px) 186px` is arithmetic, not a guess. `Header.astro`
  carries all three of its derivations as constants with the arithmetic written out.
- ⚠️ **MARKUP BUILT IN A JS STRING IS INVISIBLE TO BOTH KINDS OF CHECK.** The search palette's rows
  are concatenated into `innerHTML` (`SearchPalette.astro`), so its thumbnail `<img>` exists in no
  `.astro` template, in no built HTML file, and on no page nobody has pressed ⌘K on — the static
  sweeps and `check-pdp-srcset.mjs` alike walk right past it. It was the LAST bare `<img>` after
  `#133`: six full-size originals, **91 178 B**, for six **42 × 56 px** boxes (7,14× oversize at
  DPR 2). Fixed at **9 956 B** (−89%), and for a MERCHANT UPLOAD the same row now asks for `?w=200`
  instead of a ≤2000px original — the case that is far larger in production than on the seeded demo.
  ⚠️ **The srcset is built on the SERVER (`api/search.ts` returns `srcset` per row), not in the
  browser.** `imageSrcSet` reads `STATIC_IMAGE_WIDTHS`, a 5,2 KB generated manifest of all 75 static
  sources; shipping that to every visitor of every page to serve six rows behind an interaction would
  be a regression wearing a fix's clothes. The JSON grew **938 → 1 700 B** (**+448 → +762 B**, 352 →
  448 B gzipped) — **+762 B of JSON to save 81 222 B of images, ~107:1** — and there is ONE
  implementation of "which renditions exist". `sizes="42px"` is arithmetic, not a cap: the box is
  `w-[2.625rem]` and `shrink-0`, so it is 42 px at every viewport with no breakpoint to name.
  Guarded by `scripts/check-search-srcset.mjs`, which OPENS the palette (⌘K), waits for `/api/search`,
  and re-resolves each row's candidates through the isolated probe — the homepage behind it renders
  the same products, so `currentSrc` alone would sometimes report the grid's wider file. It is a
  sibling of the PDP check rather than a few lines inside it: the palette is on every route, and
  opening it pins `document.body` and covers the page, which is exactly the kind of perturbation that
  cost that file its determinism once already.
- ⚠️ **Astro middleware CANNOT set headers on `public/` assets** — the Node adapter's `sirv` handler
  serves them before middleware runs. Verified against a real build and reverted; long cache TTL is a
  Cloudflare Cache Rule (BACKLOG), not code. Do not re-write that middleware.
- **`robots-txt` scoring 0 is the AUDIT being wrong, not the file** — see the long note in
  `pages/robots.txt.ts`. Chasing it means switching off Cloudflare Managed robots.txt, which deletes an
  AI-training opt-out asserted as a right under EU Directive 2019/790.
- ⚠️ **Cloudflare Email Obfuscation injects `email-decode.min.js` as a RENDER-BLOCKING script** —
  measured **1.621 ms**, the single largest blocker on the page. It is triggered by our own `mailto:`
  links, and it is a zone setting, not code. Procedure + verification: **`specs/docs/CLOUDFLARE-PERF.md`**
  (also covers the static-asset Cache Rules, and why Managed robots.txt is left on deliberately).
- ⚠️ **`unused-javascript` and `legacy-javascript` are `fbevents.js`. There is no bundle of ours to
  fix, and the build target is NOT the cause** (measured 2026-08-01, closing N6). Astro hard-codes
  `build.target: "esnext"` for the client build (`core/build/static-build.js`), `astro.config.mjs`
  sets no `build` key, and there is **no browserslist anywhere in the repo** — nothing is being
  transpiled down. The client build emits **zero `.js` files**: every first-party script is inlined
  in the HTML (12 inline scripts, 62 KiB, of which 3 are esbuild-minified module bundles and 9 are
  `is:inline` and therefore verbatim). Coverage on the homepage with **no** interaction: 37,8 KiB
  unused, all of it ours, every item **under Lighthouse's 20 KiB per-resource floor** — which is why
  a local Lighthouse run scores both audits **1, with no items**. After one click:
  `connect.facebook.net/en_US/fbevents.js` arrives at **394,5 KiB with 188,8 KiB unused (47,9%)**,
  which at its transfer size is the reported **~44 KiB**; it also bundles **core-js 3.32.2**, which
  is exactly what `legacy-javascript` detects. Both audits therefore only appear in the runs where
  Lighthouse's scroll trips the first-interaction loader. **Do not raise/lower a build target for
  this, and do not undo the deferral (`#122`) to make an audit tidier.**
- **DOM size is dominated by ICONS, not by sections or carousel slides** (measured 2026-08-01, N5).
  On the homepage **393 of 1023 elements were in the SVG namespace** — 383 of those `<svg>` or
  `<path>`, the remaining 10 `<circle>`/`<rect>` inside lucide icons — and the **star rating owned
  240 of the 393 (61%)**.
  ⚠️ **Two different counts live here and conflating them overstates the case.** The star WIDGET was
  **312 elements**, which is 30% of the whole page, but only **240** of them were SVG; the other 72
  are its four wrapper divs and two spans, twelve times over. "312 of the 393" would read as 79% and
  is wrong. `Stars.astro` drew each rating as 2 layers × 5 `<svg><path>`, i.e. 26 elements, 12 times
  per page. One `<svg>` per layer with five `<path>`s is the same pixels for 17: **1023 → 915**
  (−108 = 12 × 9, of which 96 are SVG). Re-derived independently 2026-08-01 by building both versions
  of `Stars.astro` and counting in the browser (`namespaceURI === "http://www.w3.org/2000/svg"`, and
  `[role="img"][aria-label^="Rating"]` for the widget) — both totals reproduced exactly.
  The hero carousel is only **106 elements in total**, so deferring slides 2..n could not have paid
  for the crawler/no-JS risk; and cutting the DEFAULT TEMPLATE's sections changes nothing for any
  store that already exists (**the seed is not a migration**, see above) — it could not have moved the
  measured number at all. Look for repeated icon markup first.
