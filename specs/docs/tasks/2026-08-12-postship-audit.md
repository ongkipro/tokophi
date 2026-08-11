# 2026-08-12 — Post-ship adversarial audit: slug rename (#261) + platform theme holder (#262)

**Branch:** `audit/postship-review` · **Base:** `fc1ff17` (origin/main) · **Status:** OPEN

## Scope

Adversarial audit of the two change-sets that shipped and are live today:

- **PR #261** (squash `54ec917`) — store slug `batik-nusantara` → `batiknusantara`: rename script
  in the deploy migrate chain, 301 redirect in `apps/storefront/src/middleware.ts`, sweep of code
  defaults/seeds.
- **PR #262** (squash `f05b903`) — platform theme holder store `tema-platform` (fixed UUID
  `a0000000-0000-4000-8000-000000000001`, suspended, reserved slug, seeded by
  `packages/db/src/seed-platform-theme.ts`), `theme-source.ts` per-slot decision-B fallback,
  `/tema` editor prefill, env `PLATFORM_DEFAULT_THEME_STORE_ID` → holder.

Owner decision in force: `batiknusantara` REMAINS the demo store (no merchant migration).

Rules: prod DB access READ-ONLY (any prod fix = SQL written here, never run). Fix only what is
proved (failing test / measured query / driven request) with the smallest diff + pinning test.

## Attack surfaces

- [ ] ① Redirect middleware: custom-domain interaction, `batik-nusantara.`-prefixed custom
      domains, sslip first-label form, scheme derivation, loops, HEAD/POST, RESERVED host set vs
      `RESERVED_SLUGS` (`tema-platform` on the storefront host path), suspended-store servability
      of the holder (live requests to `tema-platform.tokophi.id`).
- [ ] ② Prod data still embedding old slug/host in VALUES (wa_templates, menu_items, recovery
      links, page content, analytics, store_settings) — measured read-only over SSH.
- [ ] ③ Theme fallback: `needsPlatformFallback`/`withPlatformFallback` edge cases (partial slots,
      holder id === store id, env unset/garbage, empty holder rows), 15s catalog cache, RLS/tenant
      leak via `/tema` prefill (`getPlatformDefaultSections` must only ever read the holder).
- [ ] ④ Seeds: rename script + seed-platform-theme idempotency under repeated deploys and both
      orderings; fresh DB vs live DB; anything still looking up the old slug.
- [ ] ⑤ Tests: do the shipped guards pin these behaviors, or green for the wrong reason
      (mutation-proof discipline).

## Verification gate before any PR

Touched test suites + `npm run build` for affected apps (super-admin build skipped).

## Findings

### CONFIRMED-FIXED

- **F1 — `batik-nusantara` was re-registrable, and the middleware hijacks that subdomain.**
  The rename freed the string from `stores.slug` uniqueness, and `slugify("Batik Nusantara")`
  mints exactly it (pinned in `store-slug.test.ts`); neither creation path refused it
  (`uniqueSlug` in `apps/admin/lib/provision.ts` returns the base candidate when it is neither
  reserved nor taken; `createStore` only checks `isReservedSlug`). Meanwhile
  `apps/storefront/src/middleware.ts` answers `batik-nusantara.<base>` with a permanent 301 to the
  DEMO store **before resolving any tenant** (measured live: GET+HEAD
  `https://batik-nusantara.tokophi.id/produk/x?a=1&b=2` → `301` →
  `https://batiknusantara.tokophi.id/produk/x?a=1&b=2`). A merchant allocated this slug would own a
  storefront that forever serves somebody else's shop — the `slug:"app"` class with a worse outcome.
  **Fix:** `batik-nusantara` added to `RESERVED_SLUGS` (`packages/lib/src/store-slug.ts`); pinning
  test flipped in `store-slug.test.ts` (proved red against the unfixed source: 2 failed, then green
  11/11). Side effect (accepted): `batik-nusantara.tokophi.com/.cc` now fall into the SEC-6
  platform-zone fallback (demo store, like `toko.tokophi.com`) instead of 404 — the base-domain
  host still 301s first, unchanged.

### CONFIRMED-DEFERRED (exact fix recorded, not shipped — say why)

- **D1 — `seed-platform-theme.ts` "preference order" is not ordered.** `SOURCE_SLUGS` is resolved
  with `inArray(...).limit(1)` and **no ORDER BY** — when BOTH slugs exist (exactly the state
  `rename-batik-slug.ts` refuses loudly, i.e. a foreign store holds `batiknusantara`), the copy
  source is plan-dependent, and the wrong pick copies a **merchant's** templates into the platform
  holder, which the storefront then serves as every store's default. Reachability today: nil —
  measured on prod, the holder already has all 3 types (the copy step short-circuits before the
  source query), the rename is complete, and a fresh DB seeds the demo under the new slug before
  any signup can exist. Exact fix when touched next:
  ```ts
  let source;
  for (const s of SOURCE_SLUGS) {
    [source] = await db.select({ id: schema.stores.id, slug: schema.stores.slug })
      .from(schema.stores).where(eq(schema.stores.slug, s)).limit(1);
    if (source) break;
  }
  ```
  (order = the declared preference; `batik-nusantara` first is the demo store in the anomaly).
- **D2 — the 301 itself has no pinning test.** #261 shipped only constant-swaps in existing tests;
  the middleware imports `astro:middleware` (virtual module), so a vitest unit test needs an alias
  stub in shared config — deliberately not added here (config touch, other agents' territory). The
  behavior is measured live (F1 evidence) and the reservation fix removes the only path a merchant
  could be hurt by it. If the middleware is next factored, extract the old-host predicate into
  `src/data/` (pure) and pin it like `host-fallback.ts`.
- **D3 — `getStoreTemplates`'s WIRING (own-before-platform argument order) is untested.** The pure
  halves are pinned (`theme-source.test.ts`), but a swapped-arg call in
  `apps/storefront/src/data/theme.ts` would flip precedence with every pure test green. Needs a
  DB-coupled test (theme.ts reads the module-level `db`), i.e. an injectable seam — refactor, out
  of audit scope.
- **D4 — dev-only: the old-host 301 drops the PORT.** `normalizeHost` strips it, so
  `batik-nusantara.127.0.0.1.sslip.io:4327` redirects to the portless https host. Prod hosts carry
  no port; harmless in the only environment that matches the sslip form, annoying at worst. Fix if
  ever needed: build `newHost` from the raw Host header, not the normalized one.

### REFUTED (with the evidence)

- **R1 — "old slug/host left behind in prod VALUES."** Measured read-only on prod (ILIKE
  `%batik-nusantara%` over whole-row text of all 26 candidate tables incl. wa_templates,
  menu_items, page_templates, checkout_sessions, analytics_events, store_settings, blogs, menus):
  **0 rows everywhere except `invoices` (3)** — and those are `reff_id`
  `SUB-batik-nusantara-…` external payment references, matched **verbatim** by
  `pay/callback/route.ts` (`eq(schema.invoices.reffId, reff)`); the slug inside is opaque and never
  parsed. Rewriting them would break provider reconciliation. Leave them.
- **R2 — "tema-platform.tokophi.id can serve the holder's theme/catalog."** No. Measured live:
  `https://tema-platform.tokophi.id/` answers **200 with the DEMO store** (Batik Nusantara), not
  the holder — `tema-platform` is RESERVED so it never becomes a candidate slug, the suspended
  holder is additionally unservable (`getStoreBySlug` → null), and the 200 is the **pre-existing
  SEC-6 design**: any reserved label under a `PLATFORM_ZONES` zone is "nameless" and falls back to
  `STORE_SLUG` (identical to `toko.tokophi.com`). Holder name/reason also do not leak (no 503
  locked page — candidates are empty so `getLockedStoreByHost` never sees it). Self-referencing
  canonical on that host is the same pre-existing property every fallback host has; not introduced
  by these PRs.
- **R3 — "/tema prefill is a cross-tenant leak vector."** `getPlatformDefaultSections` takes no
  caller-controlled id: the store id read is `PLATFORM_DEFAULT_THEME_STORE_ID` from env (platform
  operator controlled), UUID-gated (`isUuid`), filtered `is_default` + `type`; the opened template
  itself is fetched via `getTemplate(id)` under `withCurrentTenant` (RLS), so a foreign template id
  404s before the prefill branch can run. Only holder rows are readable, matching the stated
  exception.
- **R4 — theme fallback edge cases.** Env unset/blank/garbage → OFF (pinned, incl. non-UUID);
  holder id === store id → own rows only (skip); partial slots → per-slot fill with `byId` never
  merged (pinned); empty-content holder rows filtered by `withContent` → behave as "no default".
  15s catalog cache (`cache.ts` ttl 15_000) caches the *merged* result per `catalog:<storeId>` —
  holder edits propagate within one TTL, no cross-store key sharing.
- **R5 — seed idempotency / ordering.** Measured: `rename-batik-slug.ts` + `seed-platform-theme.ts`
  each run twice against the local dev DB — both no-op on the second run (rename: "nothing to do";
  theme seed: insert-if-absent per type; local holder is legitimately missing `category` because
  the local demo has no default category template — the seed skips and stays convergent).
  Prod measured: demo store `slug=batiknusantara` (suspended f, approved t), holder
  `a0000000-…-0001` suspended+approved+comped with exactly 3 `is_default` template rows
  (homepage 9 sections, category 1, product 1). Old→new host 301 preserves path+query; POST on the
  old host is answered 403 at the Cloudflare edge before the middleware (measured), GET/HEAD 301.
  Compose chain order (migrate → seed → rename → seed-templates → seed-platform-theme → …) is the
  safe order, and `SOURCE_SLUGS` IN covers the pre-rename ordering; the only gap is D1.

NEXT: — (audit closed 2026-08-12; F1 shipped on this branch, D1–D4 are the open follow-ups).
