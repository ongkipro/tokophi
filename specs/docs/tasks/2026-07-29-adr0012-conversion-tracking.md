# ADR 0012 — conversion tracking (manual-pixel path) · handoff

**Branch:** `feat/meta-integration` (worktree `.claude/worktrees/promospec`)
**Base at start:** `origin/main` @ `c5cdd19` · branch head at start of this session: `0af692d`
**Scope decision (user, 2026-07-29):** ship the **manual-pixel path** (merchant pastes their own
Pixel/Tag ID + server token — no Meta Developer App). OAuth / catalog PUSH / webhooks stay deferred.
**COD attribution (user, 2026-07-29):** COD = Purchase **at order creation** (thanks page); prepaid =
Purchase when the gateway callback confirms payment.

## Done

- [x] `packages/lib/src/tracking-ids.ts` — `retailerId()` + `purchaseEventId()`, the ids shared by the
      feed, the pixel and the server event. Unit-tested. `google.xml.ts` refactored to call it, so the
      feed's `<g:id>` and the conversions can never drift.
- [x] `0080_tracking_event_deliveries.sql` — the delivery QUEUE + `tracking_delivery_status` enum,
      `unique(store_id, channel, event_id)`, due/store indexes, RLS. (`0079` = the config table, done
      in the previous session.)
- [x] `apps/admin/lib/capi.ts` + `capi-sanitize.ts` — the ONE provider boundary (Meta CAPI, GA4 MP,
      TikTok Events API), retry classification, secret redaction (tested).
- [x] `apps/admin/lib/tracking-events.ts` — `purchaseFacts()` / `enqueuePurchase()`, owner connection
      with explicit `store_id` on every query.
- [x] Enqueue wired into `/api/public/order` (COD) and `/api/public/pay/callback` (prepaid).
- [x] `apps/admin/app/api/cron/tracking-events/route.ts` + `cron-tracking-events` sidecar in
      `docker-compose.coolify.yml` (60 s).
- [x] Storefront: `MarketingPixels.astro` uses the server-issued `event_id` + `content_ids`;
      ViewContent/AddToCart report `product_group` for multi-variant products instead of inventing a
      variant id. `checkout.astro` carries `res.tracking` into `lastOrder`.
- [x] Seller diagnostics: 7-day delivery health per channel on Pemasaran → Pelacakan; test-event code
      field for Meta/TikTok.
- [x] Docs: `SCHEMA.md`, `DATA_MODEL.md`, `ARCHITECTURE.md` §11, `UI_INVENTORY.md`, `DEPLOY.md`,
      `TASKS.md`, `CHANGELOG.md`.

## Verified

`npm run build:admin` ✓ · `cd apps/storefront && npm run build` ✓ · `npm test` ✓ (78 passed) ·
`npm run verify-rls -w @tokophi/db` ✓ (48/49) · `npm run verify-migrations -w @tokophi/db` ✓.

⚠️ `npm run migrate` FAILS on the shared dev DB — pre-existing drift (`orders.problem_at already
exists`), not caused by this branch. `0080` was applied to the dev DB manually and idempotently.
Production applies the chain cleanly.

⚠️ **No live provider call has been made.** No real Meta/GA4/TikTok credentials exist. Everything is
verified by build, unit tests, RLS and review only — do not report it as "conversions confirmed".

## NEXT

1. Live verification with a real pixel + token per channel (ADR 0012 §30 P11) — then record the result
   honestly in `WORKLOG.md`.
2. Super-admin cross-tenant delivery health (P9b).
3. Consent gating — the repo has **no** consent mechanism at all; ADR §15.7 expects one. Needs its own
   decision, not a `localStorage` flag nobody sets.
4. Only if a Meta Developer App is provisioned: P4 OAuth → P5/P6 catalog push → P10 webhooks.
