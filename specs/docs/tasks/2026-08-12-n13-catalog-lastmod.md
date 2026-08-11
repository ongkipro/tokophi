# Task — N13: `updated_at` on products & collections → sitemap `<lastmod>`

**Start**: 2026-08-12, base `10cda63` (origin/main), branch `feat/n13-sitemap-lastmod`,
worktree `.claude/worktrees/n13-lastmod`.

## Design — why NULLABLE, no default, no backfill

Migration **0093_catalog_updated_at** adds `updated_at timestamptz` to `products` and `collections`,
nullable with no default, deliberately:

- `default now()` would stamp migration day onto every existing row as if it had just changed — the
  exact "unreliable lastmod" the sitemap's own rule forbids (Google distrusts the whole file's
  `<lastmod>` once one field lies).
- A backfill UPDATE inside the migration would overwrite real values if the batch ever re-runs —
  and idempotent-under-rerun is this repo's standing migration rule for a reason (16 migrations
  were once silently unapplied by one non-idempotent statement).
- NULL is honest: products fall back to `created_at` (a never-edited product's creation IS its last
  modification — coalesced ONCE, in `data/catalog.ts`, as `lastModified`); collections have no
  `created_at`, so they emit `<lastmod>` only after their first edit.

⚠️ **The 0093 snapshot carries more than the 0093 SQL, on purpose.** Drizzle snapshots had not been
regenerated since ~0083 (later migrations were hand-written), so `npm run generate` produced a
catch-up diff dragging already-applied history — including a `DROP CONSTRAINT` that would fail. The
SQL was trimmed to the two `ADD COLUMN IF NOT EXISTS` lines; the snapshot was KEPT as the catch-up
(it describes the real schema, and the next `generate` now diffs from truth). Noted in the SQL
header too.

## Write paths

Every `db.update` on `products` (7 sites: `products.ts` ×4, `theme.ts` ×2, `catalog-numbering.ts`)
and `collections` (3 sites: `collections.ts`, `theme.ts` ×2) now sets `updatedAt: new Date()` — one
uniform rule, no per-site judgment about which edits "count".

Known ceiling, recorded not hidden: child-table changes (variant price edits via inventory,
`collection_products` membership, `product_media` uploads) do NOT bump the parent's `updated_at`.
The column tracks row edits; widening it to child writes is a separate decision.

## Sitemap

`/produk/<handle>` entries emit `lastmod` (always, via the coalesce); `/kategori/<handle>` entries
emit it only when set. The long "NO lastmod, NOT an oversight" comment is rewritten to record the
closure and the still-standing honesty rule.

## Checklist

- [x] Migration 0093 (idempotent, stamp `1786470181705` > dev/prod max `1786441836681`),
      `verify-migrations` green, applied to the shared dev DB (both columns confirmed)
- [x] 10 write sites bump `updatedAt`
- [x] `data/catalog.ts` exposes `lastModified`; sitemap emits it
- [x] `npm test` green · `verify-rls` ✅ · `build:admin` green · storefront verify **6/6 PASS**
- [x] Served `/sitemap.xml` eyeballed on the prod build: product entries carry honest dates
      (`kemeja-oversized` → `<lastmod>2026-07-21</lastmod>`, its created_at — NOT migration day);
      category entries carry none (all NULL today, 0 of them emit) — exactly the design
- [x] N13 closed in NEXT.md + OPEN.md in the same commit as the code
- [ ] PR (number from `gh pr create` output) → merge; production migration rides the deploy's
      `migrate` service — no manual data fix needed (nullable column, no 500 window)
