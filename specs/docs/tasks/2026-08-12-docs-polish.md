# 2026-08-12 — docs-truth polish after the day's ships (docs/comments ONLY)

**Branch:** `docs/postship-polish` · **base:** `fc1ff17` (origin/main) · worktree `.claude/worktrees/docs-polish`

## Scope

Post-ship truth sweep after today's merges — no behavior changes, docs and comments only:

- PR #261 renamed the demo store's slug `batik-nusantara` → `batiknusantara` (storefront at
  `batiknusantara.tokophi.id`, old host 301s). Docs stating CURRENT fact (runnable examples, host
  lists, SQL snippets, "the demo store is…") must follow; genuinely historical prose (changelog,
  incident records, dated measurements) keeps the old slug — history is allowed to name it.
- PR #262 moved the platform default theme to a platform-owned holder (`tema-platform`,
  `a0000000-0000-4000-8000-000000000001`), decision-B per-slot fallback, `/tema` prefill.
- **OWNER DECISION 2026-08-12: `batiknusantara` REMAINS the demo store.** The "it is becoming a real
  merchant's shop" storyline (which motivated the holder's timing) is CANCELLED — no demo-data
  separation, no production payment cutover for it. The holder work stands regardless: the platform
  default must not point at ANY live store's rows. Docs/comments that state the old storyline as
  current fact get corrected to record this.
- File (do NOT execute) the time-gated HSTS raise for custom domains in `OPEN.md`.
- Re-check `STATUS.md` / `SYSTEM_MAP.md` claims today's changes invalidated.

## Plan

- [x] Handoff file (this one) committed first
- [x] Old-slug truth sweep — current-fact sites only: `GUIDE.md` SQL example, `DEPLOY.md`
      (watchdog host list, host-table example, `STORE_SLUG` env), `SECURITY.md` + `CLOUDFLARE-PERF.md`
      HSTS verify loops, `HANDOFF_TENANT_THEME_TOKENS.md` SQL, `BACKLOG.md` live-state lines,
      `STATUS.md` COD row, `SYSTEM_MAP.md` COD row, `PROMO_SPEC.md` shared-DB/local-tenant gotchas,
      `SCHEMA.md`/`FLOWS.md` local-state snapshots (new slug added beside — the numbers are dated)
- [x] Record the owner decision (demo store stays demo): `STATUS.md` note,
      `2026-08-12-platform-default-theme.md` superseding note, `2026-08-06-open-work.md` UX-1
      "decide which it is" paragraph resolved, and the code comments that said "That day came" /
      "is about to become a real merchant's shop" (`theme-source.ts`, `platform-theme.ts`,
      `seed-platform-theme.ts`) — comment-only edits, zero behavior change
- [x] File the HSTS raise in `OPEN.md` as a time-gated entry (earliest 2026-08-12 ≥17:00 WIB,
      per the 24h ramp in `2026-08-12-session-close.md`) — NOT executed here
- [x] STATUS.md `astro.config.mjs site:` claim (§3.4 #28) reconciled against the code (the file
      deliberately has NO `site:` — verified on this branch)
- [x] PR opened (do not merge)

## Deliberately left as history (old slug kept)

`CHANGELOG.md`, `WORKLOG.md`, `specs/docs/audit-2026-08-01/*`, dated task handoffs under
`specs/docs/tasks/` (except the two decision notes above), `AGENTS.md`'s two dated narrations
(check-pixel-defer red-forever story; the 2026-08-05 promo-endpoint measurement), `CUSTOM_DOMAIN.md`
(design doc, its slices are executed plans), and code comments that narrate dated measurements
(`kpi-card.tsx`, `shipping.ts`, `analytics.ts`, `articles.ts`, `cart-variant.*`,
`produk/[handle].astro`, `registry.ts`, `catalog.ts`, `check-pixel-defer.mjs`,
`api/public/order/route.ts`). `provision.ts` + `store-slug.test.ts` keep `batik-nusantara` because
`slugify("Batik Nusantara")` genuinely yields it. The rename shim itself
(`storefront/src/middleware.ts`, `rename-batik-slug.ts`, `seed-platform-theme.ts` `SOURCE_SLUGS`)
names both slugs on purpose.

## Out of scope (would change behavior — not touched)

- Nothing found that required a code change; every correction here is prose/comments.

NEXT: PR open (do not merge). After merge, nothing to deploy-verify — docs only. The HSTS raise
filed in OPEN.md is still WAITING for its ≥17:00 WIB window and an executor.
