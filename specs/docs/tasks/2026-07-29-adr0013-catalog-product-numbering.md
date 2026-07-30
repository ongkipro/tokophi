# ADR 0013 — stable catalog product ids + feed/credential hardening · handoff

**Branch:** `feat/catalog-product-numbering` (worktree `.claude/worktrees/promospec`)
**Base:** `origin/main` @ `6e2e565` (the ADR 0012 conversion-tracking merge)
**Ask:** audit + perfect tracking / auth / catalog for Meta, Google, TikTok; make sure every tenant's
products have a system-generated id.

## Done

- [x] **ADR 0013** (`specs/decisions/0013-stable-catalog-product-ids.md`) — the decision and why the
      alternatives lose.
- [x] **Migration 0081** — `products.number` (per store, allocate-once), `products.variant_seq_next`
      (high-water mark), `product_variants.seq`, `store_counters` (RLS), `stores.catalog_id_scheme`.
      Deterministic, one-shot, `IS NULL`-fenced backfill.
- [x] **Allocation** (`apps/admin/lib/catalog-numbering.ts`) — one statement per number, race-free; the
      variant allocation doubles as the CHILD-TABLE parent check.
- [x] All product/variant creation paths wired (create, update, **duplicate — `number` must stay in the
      `omit` list**, both seeds, and `store_counters` re-seeded above the seeded numbers).
- [x] **`retailerId(scheme, product, variant)`** — one helper, per-store scheme, called by both feeds,
      the PDP, and the conversion payload.
- [x] **One feed builder, two endpoints**: `/feed/google.xml` (Google + Meta), `/feed/tiktok.xml`
      (`g:sku_id`, 3-level category). Fixed: XML control chars (whole-feed rejection), flash-sale price
      mismatch, `availability` enum, photo-less items, `sale_price`, `identifier_exists`,
      `product_type`, extra images, plain-text description caps, `brand` from `vendor`.
- [x] **Credentials**: "Uji koneksi" probes per provider, "Hapus token", `capiConfigured` = decryptable,
      audit entries, rate limits, TikTok rate-limit codes no longer dead-lettered, GA4 >72 h events sent
      instead of dropped, owner-only READ on the Pelacakan tab.
- [x] Product number shown on the Produk list; one-way scheme switch in Katalog Iklan with a warning.
- [x] `crypto.test.ts` (AAD binding + KDF), `tracking-ids.test.ts` rewritten around the edits that used
      to re-key a catalog. `vitest.config.ts` + `test/stubs/server-only.ts` so server-only modules are
      testable.

## Verified

`build:admin` ✓ · storefront build ✓ · `astro check` (only pre-existing `Header.astro` errors) ✓ ·
`npm test` ✓ 92 passed · `verify-rls` ✓ · `verify-migrations` ✓ 82 entries.

Against the real DB + a running storefront: 0081 applied and backfilled (24 products → #1001…, 106
variants → seq 1..n, counters seeded past the max); `/feed/google.xml` = 86 items; both schemes produce
the expected ids (`kemeja-oversized-1` vs `1001-1`, group `1001`); TikTok feed emits `g:id` + `g:sku_id`;
`sale_price` matches the PDP's live price exactly (249000 list / 189000 sale, PDP charges 189000).

⚠️ The demo store was flipped to `number` to verify and **flipped back to `handle`** — the DB is as it
was found.

## NEXT

1. Two parallel audits were running when this was written — read their findings before merging.
2. Live verification with real Merchant Center / Commerce Manager / TikTok catalogs is still the only
   way to prove the feed is accepted. Nothing here has been ingested by a provider.
3. Consent gating still does not exist anywhere in this repo (ADR 0012 §15.7).
4. Catalog PUSH (Meta Catalog API) and OAuth remain deferred — they need a Meta Developer App.

---

## Follow-up landed 2026-07-30 (branch `feat/admin-product-number`)

- [x] `INTEGRATION_TOKEN_KEY` **set in Coolify and live in production** (64 hex). ⚠️ Coolify stores the
      compose **already substituted**: setting the env var is not enough, the application must be
      re-parsed (`$app->parse()`) or the container still gets `''`. The first redeploy "succeeded" with
      the key still missing — `printenv` inside the container is the only honest check.
- [x] Admin product URL is the catalog number (`/produk/1042`), UUID bookmarks redirect once, junk and
      out-of-range numbers 404 (an `integer` overflow is 22003, a different error class from 22P02).
      `/promo/[id]` got the same guard.
- [x] Events report the EXACT selected variant, not the group. Meta forbids `product_group` on
      AddToCart/Purchase; Google has no group concept; and our picker pre-selects a variant, so the
      "hasn't chosen yet" premise was false. Verified in a browser: `1001-1` → `1001-4` → `1001-6`.
- [x] **TikTok purchase event renamed `CompletePayment` → `Purchase`** in BOTH halves atomically — their
      dedup key includes the event name.
- [x] **Google Ads made real**: `ads_send_to` (migration 0082) + `gtag('event','conversion',{send_to})`
      + `items[].id` / `google_business_vertical`. GA4 and Google Ads now run side by side.
- [x] Quantity/value precision: per-item quantity no longer the order total; InitiateCheckout carries the
      cart's real units and total; flash-sale price capped like the order endpoint.

### NEXT
1. `ttclid` / `_ttp` are never captured — TikTok's click id is its strongest match key, the same role
   `fbc`/`fbp` play for Meta. Same plumbing as the Meta cookies already use.
2. Meta `contents[]` (per-item id + quantity + price) for value-based catalog optimisation.
3. Check whether PPN belongs in the feed's `<g:price>` — Google requires tax-inclusive prices outside
   US/CA, and PPN is added at checkout.
4. Consent gating still does not exist anywhere in this repo.
