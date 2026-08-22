# 2026-08-23 — Update Log: pagination, a collapsed detail, and KPI tiles that cannot rot

**Worktree:** `.claude/worktrees/ulpage` · **Branch:** `feat/update-log-pagination` · **Base:** `origin/main` `8c1cb55`
**Scope id:** `ADM-UPDATELOG-2` · **Executor:** Claude (Opus 5). Owner-approved UI work on
`apps/super-admin/app/(platform)/update-log/`.

## Why

The screen renders all **14** `DEV_LOGS` entries at once, each as four dense paragraphs
(`summary` · `problem` · `solution` · `verification`) — ~56 paragraphs in one scroll. And its header
KPI tiles are **hand-typed**: `Current Engine: v1.0.0 Stable`, `722 Tes Hijau`, `53 Tabel Gated`,
`100% Passed`. The newest entry on the same screen says **v1.1.0** with **1009 tests**, so the page
contradicts itself in two places a reader can see at the same time.

Three changes, one pass. The data file (`apps/super-admin/lib/data/dev-logs.ts`) is **not touched**.

## The three changes

### ① Pagination — 5 per page, reusing `@tokophi/ui/pagination`

Super Admin has never imported that component; this is its first consumer.
`apps/admin/components/admin/list-pagination.tsx` owns `ADMIN_LIST_PAGE_SIZE = 10` and **must not be
imported across apps**, so super-admin gets its own named constant.

- ⚠️ **`PaginationLink` renders an `<a>`.** No `href` is emitted at all — not even `"#"`. Base UI's
  `Button` is already passed `nativeButton={false}`, so for a non-`<button>` element it applies
  `role="button"`, `tabIndex={0}` and Enter/Space → click (`internals/use-button/useButton.js`). An
  `href="#"` would need a `preventDefault()` on every path to stop the scroll jump; no `href` cannot
  jump at all, and the keyboard affordance is the component's own, not ours.
- ⚠️ **The page index resets to 1 when a filter changes, DURING RENDER.** Copied from
  `apps/admin/app/(admin)/blog/blog-client.tsx` (~117–129) and cited in a comment: the `useEffect`
  version paints one frame of the old page under the new filter and trips
  `react-hooks/set-state-in-effect`.

### ② Collapse problem / solution / verification behind native `<details>`

Always visible: version · date · title · category badge · surfaces · **summary**.
Native `<details>`/`<summary>` — no new dependency, keyboard- and screen-reader-accessible with no
work of ours, and the lazy-senior ladder puts a native platform feature above a component.

### ③ The KPI tiles become DERIVED

A derived figure cannot rot. `AGENTS.md`: *"A figure with no source is '—', never a number."*

| tile (before) | after |
|---|---|
| header badge `Current Engine: v1.0.0 Stable` | `DEV_LOGS[0].version` |
| `Total Dev Logs — 14 Catatan` | unchanged (already `DEV_LOGS.length`) |
| `Status Verifikasi — 100% Passed` | **Rilis Terbaru** — `DEV_LOGS[0].version` |
| `Keamanan & RLS — 53 Tabel Gated` | **Catatan Terbaru** — `DEV_LOGS[0].date` |
| `Vitest Suite — 722 Tes Hijau` | **Catatan Keamanan** — count of `category === "security"` |

The live test count is **dropped, not re-typed and not regexed out of prose**. The decision and its
reason are a comment in the file.

## Guards

The paging DECISION goes in a pure module — `apps/super-admin/lib/list-page.ts`, no React, no DB —
the same split as `platform-rank.ts` / `route-roles.ts`. `apps/super-admin/lib/list-page.test.ts`
covers: empty list · exact multiple of the page size · last partial page · a page index beyond the
end (clamps, never blanks) · a page index below 1 · the filter-change reset predicate. **Every
assertion is proved red against a mutation before being trusted**, and the mutation matrix goes into
`BUILD-LOG.md`.

## Plan

- [x] Read `AGENTS.md` (4-step protocol · multi-agent rules · Base UI ≠ Radix · Conventions)
- [x] Read `pagination.tsx`, `blog-client.tsx`, `list-pagination.tsx`, `platform-rank.ts` + its test
- [x] Commit this handoff **BEFORE** any code
- [ ] `apps/super-admin/lib/list-page.ts` — pure slice + reset predicate + page-size constant
- [ ] `apps/super-admin/lib/list-page.test.ts` — the six cases, each proved red against a mutation
- [ ] `update-log-client.tsx` — pagination · `<details>` disclosure · derived tiles
- [ ] `npm install` fresh in this worktree (no hardlinked `node_modules`)
- [ ] `npx vitest run` — report real numbers, name pre-existing failures against `8c1cb55`
- [ ] `npm run lint -w @tokophi/super-admin` — baseline 0 errors / 3 warnings
- [ ] `npm run build -w @tokophi/super-admin` — with the Dockerfile's env (a bare build in a worktree
      fails on a missing `DATABASE_URL` while collecting page data: pre-existing, recorded 2026-08-22
      and 2026-08-23)
- [ ] Try a browser check; if no operator credential can be obtained, say **"NOT clicked in a
      browser"** plainly and name what was verified instead
- [ ] `BUILD-LOG.md` entry (UTC · executor · scope id · file inventory · real numbers · mutations)
- [ ] `specs/docs/TASKS.md` — one Epic 2 line beside the sibling Update Log entry
- [ ] Small logical commits · push · `gh pr create --base main` · **DO NOT MERGE**

## NEXT

Resume at the first unticked box above. Nothing here writes to the database, so the shared dev
container is untouched and a half-finished run costs nobody else anything.
