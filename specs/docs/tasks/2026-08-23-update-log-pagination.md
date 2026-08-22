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
- [x] `apps/super-admin/lib/list-page.ts` — pure slice + reset predicate + page-size constant
- [x] `apps/super-admin/lib/list-page.test.ts` — the six cases, each proved red against a mutation
- [x] `update-log-client.tsx` — pagination · `<details>` disclosure · derived tiles
- [x] `npm install` fresh in this worktree (no hardlinked `node_modules`)
- [x] `npx vitest run` — report real numbers, name pre-existing failures against `8c1cb55`
- [x] `npm run lint -w @tokophi/super-admin` — baseline 0 errors / 3 warnings
- [x] `npm run build -w @tokophi/super-admin` — with the Dockerfile's env (a bare build in a worktree
      fails on a missing `DATABASE_URL` while collecting page data: pre-existing, recorded 2026-08-22
      and 2026-08-23)
- [x] Try a browser check; if no operator credential can be obtained, say **"NOT clicked in a
      browser"** plainly and name what was verified instead
- [x] `BUILD-LOG.md` entry (UTC · executor · scope id · file inventory · real numbers · mutations)
- [x] `specs/docs/TASKS.md` — one Epic 2 line beside the sibling Update Log entry
- [x] Small logical commits · push · `gh pr create --base main` · **DO NOT MERGE**

## What actually happened, that the plan did not predict

**The browser harness found a defect that lint, `tsc` and the build all passed over.** With no `href`
the anchor was focusable (`role="button"`, `tabIndex 0`) and **Enter did nothing**: `PaginationLink`
spreads its props onto the `<a>` inside Base UI's `render`, so `useButton` never receives the
`onClick` its own Enter/Space bridge would call. `apps/admin`'s copy only escapes that because
`href="#"` makes it a real link the browser activates natively. Fixed with a local `goTo()` that
handles both keys, so the anchor still emits no `href` — measured: Enter → page 3, Space → page 1,
`scrollY 2648 → 2648`, no `#` in the URL.

**Browser status, stated plainly: NOT clicked as the real screen.** `/update-log` needs an operator
login and the seeded passwords were rotated (N29); obtaining one means a credential write to the
shared dev control plane, which is an approval gate and was not crossed. What WAS driven is the real
component, bundled from source and hydrated in a real Chromium outside the repository — behaviour
yes, the route and Tailwind's stylesheet no. The full measurement table is in `BUILD-LOG.md`
`[2026-08-22 19:20 UTC]`.

## NEXT

Nothing outstanding on this branch: PR opened against `main`, **not merged**. If the review wants the
test-count tile back, it needs a real source (a build-time constant written by the test run, or a
field on `DevLogEntry`) — do not re-type a number, and do not regex one out of `verification`.
