# Task KEL-001 — First-party Plugin layer + Kelola CRM plugin; retire the in-house CRM

- **Branch / worktree:** `feat/kelola-plugin` at `~/Projects/tokophi-kelola` (from `origin/main` `68947858`, 2026-11-13)
- **Spec (read first):** `specs/docs/KELOLA_PLUGIN_SPEC.md` — Kelola API (§1–2), fit (§3), plugin layer (§4), CRM retirement (§5), acceptance (§6), owner decisions (§7)
- **Reference implementation:** AdsBookCMS (`~/Projects/adsbookcms`) — `DECISIONS.md` ADR-027 + ADR-028, `src/plugins/registry.ts`, `src/plugins/kelola/{index,sync,sync.test}.ts`, `src/pages/admin/settings/plugins/kelola.astro`, `src/pages/api/admin/plugins/*`. `git fetch` it first; port from `origin/main`.
- **Status:** `[~]` PR 1 built + verified locally on branch `feat/kelola-plugin` (not pushed, no PR yet); PR 2 waits for the owner's #418 + CRM-data decisions
- **Owner direction (2026-11-13):** current Seller CRM is cleaned out; CRM moves to Kelola (`kelolatim.com`) as a plugin, following the AdsBookCMS plugin contract.

## Defaults in force until the owner answers spec §7

1. First-party plugins, no marketplace; menu **Pengaturan → Plugin** (same as AdsBookCMS) → ADR 0019 + PRD line in the same PR.
2. Option A — one-way push; **no inbound webhook in v1**; nothing ever writes `orders.status` from a plugin.
3. COD pushed at creation; prepaid only once paid (`berhasil`) — differs from AdsBookCMS, spec §7.3.
4. The Pelanggan → Keranjang local "WA dibuka" button stays → `wa_templates` + `followups` type `keranjang` stay.
5. PR #418 `feat/hide-crm-prod` overlaps PR 2 below — owner decides (spec §7.5).
6. Old CRM tables are only hidden here; dropping them is a later, separate migration after a prod row count + export.

## Before writing code

- [ ] `git fetch && git show origin/main:packages/db/drizzle/meta/_journal.json | tail` — newest on 2026-11-13 was **`0116_mengantar_shipping`** → ours is `0117` unless main moved. Open PRs #424 (0116–0121) and #426 (0116) compete for the same numbers: re-check main's journal **right before merge**, renumber AND re-stamp.
- [ ] ADR number: `0018` is taken by PR #463 (Mengantar) → ours is **`0019`**. Before merge: `ls specs/decisions | grep -oE '^[0-9]+' | sort | uniq -d` prints nothing. Hand-written, idempotent, stamp ABOVE the newest; never `npm run generate`.
- [ ] Own database for this branch (`createdb tokophi_kelola` in the `tokophi-db` container, or a restored copy); point THIS worktree's `.env` / `apps/admin/.env.local` `DATABASE_URL` at it. **Never migrate the unmerged `0117` into the shared `tokophi` DB.**
- [ ] Read: `specs/docs/rules/{database-rls,public-api,order-ledger,migrations,testing-guards}.md`; models `apps/admin/lib/cron-auth.ts`, `apps/admin/app/api/cron/record-run.ts`, `packages/lib/src/crypto.ts` (`encryptSecret`); the `ditinggal` sweep predicate in `apps/admin/lib/data/checkout.ts`.

## Work items (merge one PR, watch the deploy land, then the next)

### PR 1 — plugin layer + Kelola plugin
- [x] ADR `specs/decisions/0019-first-party-plugins.md` (cites AdsBookCMS ADR-027/028 and what differs); edit PRD "No Apps / plugins" line; `AGENTS.md` intro line
- [x] Migration `0117`: `store_plugins`, `plugin_kelola_orders`, `plugin_kelola_leads` + RLS (spec §4.3); Drizzle schema; `verify-migrations` + `verify-rls` green. **No `orders.*` columns.**
- [x] `apps/admin/lib/plugins/registry.ts` — manifest type, `activePlugins`, activate / deactivate / uninstall (delete this store's rows), `scheduleOrderCreated` (via `after()`), `runPluginCron`; each plugin failure isolated
- [x] `lib/plugins/kelola/wire.ts` + `wire.test.ts` — verbatim port of the AdsBookCMS pure functions and their tests; header names source file + commit
- [x] `lib/plugins/kelola/sync.ts` + `sync.test.ts` (real Postgres) — ONE eligibility predicate (COD at creation, prepaid only once `berhasil`, not `batal`/`retur`, ≥ `connected_at`, ≤ 7 days), claim-before-POST statement (spec §4.4.1) + `AbortSignal.timeout(15_000)` on every POST (< 5 min lease), per-store batch 20 + backoff + stop-on-401/404 (`broken_at`), leads (opt-in, `ditinggal` + phone + `recovered_at is null`, never `aktif`), explicit `store_id` everywhere, `{token}` redacted from every log + `last_error`; dormant-path, two-store tenant, forced hook-vs-cron race (exactly one POST) and broken-store-doesn't-starve tests
- [x] Secret sealed under `INTEGRATION_TOKEN_KEY` with scope `kelola:${storeId}:v${n}` (`mengantarKeyScope` shape); `no-published-credentials` + `provider-label` tests green
- [x] `/api/public/order`: one `scheduleOrderCreated` call via `after()` AFTER `db.transaction(…)` returns (txn opens at `route.ts:855`) — nothing else in that route changes; `codeOnly` guard on its position, proved red on a mutated copy
- [x] Cron `api/cron/plugins` every 15 min (header-only `CRON_SECRET`, `recordCronRun`) + sidecar entry in `DEPLOY.md` / compose
- [x] Capability `plugins:manage` (owner-only) in `rbac-policy.ts` + excluded from `admin` + `rbac-census.test.ts` (+ an every-role sweep: NOT `integrations:write`, which `advertiser` holds)
- [x] Pengaturan → Plugin (as built: a Pengaturan SECTION, `/pengaturan?section=plugin` — no new route, so no nav entry and no page-map row) — list, Kelola settings (paste URL + secret, Tes koneksi, toggle leads, sync summary, UU PDP line), order-detail panel + Kirim ulang; nav; regenerate `PAGE_MAP.md`
- [x] `codeOnly` guard: nothing under `lib/plugins/**` writes `orders`

### PR 2 — retire CRM screens
- [ ] Remove `/crm/*` routes + nav group, redirect `/crm*` → `/pengaturan?section=plugin`; retire `crm:write` (census); keep the Keranjang `keranjang` followup path
- [ ] Docs: `STATUS.md`, `CODE_MAP.md`, `FLOWS.md`, `UI_INVENTORY.md`, `apps/docs/.../peran-tim.md`

### Later (not this task)
- Inbound Kelola webhook (spec §4.6) — only if the owner wants Kelola status shown in TokoΦ
- Drop migration for `leads` / `wa_messages` / non-`keranjang` `followups` after prod count + export

## Done when (spec §6)

- Dormant store: an order makes no outbound request and no plugin row.
- Tes koneksi distinguishes wrong secret / unknown URL / OK; a failed test activates nothing.
- A storefront COD order appears in Kelola under the same `order_number` with real ongkir + SKUs.
- Kelola unreachable during checkout → order still succeeds, equally fast; cron pushes it later (7-day window). Prepaid pushed only after `berhasil`; expired never. Hook-vs-cron race → one POST.
- Re-push → `duplikat:true`, nothing doubled. Lead with phone sent, without phone not.
- Two-store test: one store's cron pass never touches the other's rows.
- `npm run test:db`, `npm run lint -w @tokophi/admin`, `npm run build:admin` green; screens driven in a real browser (prod build, `next start`), narrow + wide, 0 console errors.
- BUILD-LOG entry + TASKS.md `[x]` + STATUS.md synced.

## Log

- 2026-11-13 — Main Session: PR 1 built (8 commits on `feat/kelola-plugin`, 497118a3…). Gates: `test:db` 227 files / 2312 tests green before the last two guards (+ plugin suites 39/39 after), lint 0 errors, `build:admin` green, browser pass on `next start` at 390/1280 with 0 console errors. Details + mutation proofs in BUILD-LOG `KEL-001`.

- 2026-11-13 — Main Session: Kelola API studied (`https://kelolatim.com/docs/api`), spec written, worktree created, `npm install` run. No code, no DB touched.
- 2026-11-13 — Main Session: folded in 2nd `tokophi-resume` review — prepaid eligible only once paid, claim-before-POST lease, `after()` strictly post-commit + guard, 7-day window from `connected_at` with `broken_at`, per-store batch, leads exclude `recovered_at`, PDP covers orders, three stated `// lazy:` ceilings.
- 2026-11-13 — Main Session: folded in review from session `tokophi-resume` — ADR → 0019, migration-number race (#424/#426), credential scope + token redaction, leads opt-in, #418 overlap, deferred-webhook public-API checklist.
- 2026-11-13 — Main Session: spec + task revised against AdsBookCMS ADR-027/028 and `src/plugins/kelola/`: dropped `orders.kelola_*`, the `plugin_deliveries` outbox and the inbound webhook (v1); adopted the registry/manifest contract, derived retry queue, `after()` hook, "Pengaturan → Plugin" naming, verbatim wire-format port. Docs only.
