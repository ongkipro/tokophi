# Session handoff — validating audit wave 3, and a queue that was stale in the expensive direction

**Date:** 2026-08-03
**Branch:** `feat/seed-recent-carts`, based on `origin/main` @ `52ef1de` (after audit wave 3, `#133`)
**Shape of this session:** an AUDIT of another agent's just-merged work, not new features.
**Gates:** `tsc` clean · `astro check` 0 errors · `npm run test:db` **29 files / 211 tests**

---

## What this session was, and why

Wave 3 (`#133`) merged two hours before this session started. Rather than open a new front beside it,
the job was: **check what it actually did, validate the claims by running them, and finish whatever it
left half-done.**

That turned out to be the right call for a reason nobody planned:

## 🔴 The finding: `NEXT.md` was stale on FOUR entries, all in the same direction

**N19, N20, N21 and N23 were all implemented in `52ef1de` — and all four were still marked open**,
three of them tagged `NEW`.

This is not a cosmetic docs problem. `NEXT.md` is what **four** other documents point a starting
session at (`AGENTS.md`'s doc table, `BACKLOG.md`, `WORKLOG.md`, every dated handoff). Stale in *this*
direction means the next session picks up finished work and rewrites it.

**It nearly cost this one.** N19 was chosen precisely because it looked like the one concrete unblocked
item nobody had done. A worktree was created, `npm install` run, `seed-recent.ts` opened to add a
`seedCheckoutSessions`… which was already there, three lines from the bottom of the same file.

⚠️ **Close the entry in the same commit as the code.** Not the same PR, the same commit — a PR that
closes four items and updates the queue for none of them is how this happened.

## What was validated, by running it

The repo's own rule is *"Do not check an item off because the code exists — check it off because you
ran it."* Nobody had run these. So:

### N19 — `seed:recent` now seeds carts · **claims hold**

| claim | result |
|---|---|
| inserts carts | **900**, filling 29 empty days |
| **idempotent** — second run does nothing | second run inserted **0** (*"tidak ada hari kosong"*) |
| both kinds of `pulih` (the metric trap) | **rescued 89** (`abandoned_at`+`recovered_at`) vs **straight-through 86** (`abandoned_at` NULL) |
| `recovered_order_id` resolves | 175 recovered rows, **0 dangling** |
| the "Anonim" tab is honest | 724 `ditinggal` in-window, **398 with a phone** |

The metric-trap split is the one worth calling out: seeding only `ditinggal` would have made the
recovery rate read 0 %, and seeding only one kind of `pulih` would have left the very distinction
`abandoned_at` exists for unexercised. Both kinds are present.

**Side effect worth knowing:** Keranjang Ditinggal now has real volume, so **N17's recovery link is
finally visible on the demo**. The two halves only became demonstrable together — N17 built the link,
N19 gave it carts to appear on.

### N20 — renderer exhaustiveness · **guard fires**

Broke it on purpose: added `'audit-fake-section'` to `SectionConfigMap` with no renderer arm.

```
SectionRenderer.astro:119 - error ts(2322):
  Type '{ type: "audit-fake-section"; props: … }' is not assignable to type 'never'
```

Exactly the AC. Reverted after. (And wave 3 was right to add
`section-renderer-exhaustive.test.ts` beside it — **`astro check` is the only thing that compiles that
file and nothing runs it**; the storefront build is transpile-only.)

### N21 — RBAC census · **guard fires**

Broke it on purpose: added an `audit:danger` capability the careless way — to `ALL_CAPABILITIES` only,
so it lands in `admin` by subtraction. The census went **red**, 2 of 4 tests failing on
`expect(actual).toEqual(declared)`. Reverted after.

### N23 — the NULLS-FIRST sort · **correct, but the class was only half closed**

Measured against the dev DB — a bare `desc` really does put the one seeded draft above all 15
published articles, and `nulls last` really does fix it.

**But see below: the storefront still had the bare copy.**

## What this session actually changed: the blog order, one definition

⚠️ **The N23 fix landed in `apps/admin/lib/data/article-order.ts` — which the storefront cannot
import** — so `apps/storefront/src/data/content.ts` kept its own bare `desc(schema.articles.publishedAt)`.

**That is the N17 shape exactly, one week later: a rule in the wrong package is a rule only one surface
can obey.** It is the same structural failure that left `signRecoveryToken` with zero callers.

Moved to **`packages/db/src/article-order.ts`** (`@tokophi/db/article-order`) — both apps already depend
on `@tokophi/db`. It imports `./schema` **directly, never the barrel**, because the barrel pulls
`client.ts`, which throws at import time without `DATABASE_URL`; that is what made the original
untestable and forced the dynamic-import workaround in its test.

⚠️ **Stated honestly in the code: on the storefront query, `nulls last` changes nothing today.** That
query filters `status='terbit'`, and `publishedAtFor()` guarantees a published row has a date. Claiming
a live bug there would be false. What the change *does* buy today is **determinism** — `title asc`
settles two posts published in the same second, which a bare `desc` leaves to the query plan, so the
blog could reorder itself between two loads of unchanged data. And it removes a correctness dependency
on an invariant held **in a different app, by one function, with nothing on this side enforcing it**.

Driven on a real build: `/blog` lists published-first, draft absent.

## An audit method worth reusing

The NULLS-FIRST sweep was mechanical, not a hunt: parse `schema.ts` for every column's nullability,
grep every `desc(schema.X.Y)` in both apps, and cross-reference.

```
31 desc() sites → 29 not-null or already handled → 2 candidates
   payments.paidAt        (order-detail.ts:306)  ← false positive: it is inside a COMMENT
   articles.publishedAt   (content.ts:88)        ← the real one
```

Two candidates from thirty-one sites, one of them real. Worth re-running after any batch of new
queries; the script is trivial and the class has now shipped **three** times (payments, admin blog,
storefront blog).

## Still open, and honestly sized

| | | |
|---|---|---|
| **N15 · N16 · N1 · N2** | blocked on the owner | N2 is still **APPROVED and still not done** — a zone setting, not code |
| **N25** | `color_palettes` orphan · **S** | ⚠️ Its AC is *"either it lands with a migration, or it is dropped from the shared container"* — **dropping a table on the shared dev DB is destructive and needs the owner's word.** Not done for that reason, not because it was missed. |
| **N5** | `dom-size` remainder · **M** | header/footer lucide icons; measure before assuming |
| **N13** | products/categories `<lastmod>` · **M** | needs a migration (`products` has `created_at` only) |
| **N8** | rewritten — **do not start** | |

## NEXT

- **N25** needs an owner decision on the shared container before anyone can close it.
- **N5** is the only unblocked engineering item of any size left.
- The queue is accurate as of this commit. **Keep it that way in the same commit as the code.**
