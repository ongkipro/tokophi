# Handoff — start here for the theme work (T-9, T-10)

Written cold, for a session that has none of the context. Everything below was measured, not recalled.
**Read `2026-08-06-open-work.md` for the full task text; this file is the orientation around it.**

## The two tasks, and why they are separate

- **T-9 / UX-1** — every tenant renders ONE platform default theme, not a copy of it.
- **T-10 / UX-2** — product imagery locked to 1:1 on the card and the product page.

**Do not bundle them.** They share a subject and nothing else: T-9 changes where a theme is *read
from*, T-10 changes what a section *renders*. Bundled, a rollback of one drags the other.

## The decision that is already made — do not re-open it

The owner chose **B: one platform default read at render**, over **A: copy the rows into each store**.

A satisfies the request *on the day it runs*, then drifts — the next theme improvement has to be
re-copied to every store, and a store created afterwards gets nothing. That is the
**"the seed is not a migration"** trap this repo has already paid for twice. B is the only reading
that keeps the promise the request actually made: *"live maupun yang mendaftar nanti."*

🔴 **So: do NOT implement T-9 by writing rows into `page_templates` per store.** The moment the
default exists as N copies the requirement is false again, and nobody notices for weeks.

## The trap in T-10 that a careless test will sail past

Templates already saved carry **`imageRatio: "3:4"` inside their JSON**. Changing the default does
nothing for them. "Lock" means **the renderer ignores the stored value** — and the test must run
against a store whose saved template still says `"3:4"`, or it passes over the bug.
`batik-nusantara`'s 3735-byte homepage is one of those rows.

The six places that decide the ratio today (line numbers as of `f6fcb79`):

| site | today |
|---|---|
| `packages/sections/src/registry.ts:122` | type `imageRatio?: "1:1" \| "3:4" \| "4:5"` |
| `packages/sections/src/registry.ts:458` | default `"3:4"` |
| `apps/admin/lib/theme/puck-config.tsx:242-244` | **the three-option dropdown shown to the merchant** |
| `apps/storefront/src/components/ProductCard.astro:63` | prop default `ratio = "3:4"` |
| `apps/storefront/src/components/sections/ProductGrid.astro:50` | passes `imageRatio` through |
| `apps/storefront/src/pages/produk/[handle].astro:316,345` | PDP gallery hardcoded `aspect-[3/4]` |

## The ground truth you are working over

Measured 2026-08-06/07 on production:

| store | template | note |
|---|---|---|
| `batik-nusantara` | homepage 3735 B · category 91 B · product 175 B | the reference setup |
| `valoish-store` | homepage 1027 B | real work — **under B it keeps its own theme, so leave it alone** |
| `permata-store` | homepage 27 B | empty shell |
| `zanobyshop` · `beautyinyu` · `difa-pack` | none | 3 of 6 stores have no template at all |

Backup of every `page_templates` row, verified to contain all five:
`/root/theme-backup/page_templates-20260807-030625.json` (12 808 B).

## Before you trust any deploy

🔴 **Four green hosts are NOT proof a merge shipped.** On 2026-08-06 a Coolify queue row wedged
`in_progress`; the queue is serial, so two merges built nothing while every health signal stayed
green. Root cause is written up in DEL-3; the alarm is live:

```bash
ssh -i ~/.ssh/tokophi_dev root@45.77.33.112 /usr/local/bin/tokophi-deploy-currency
# running=<sha>  last_queue=[<sha> finished <ts>]  queued=0   → exit 0
```

Watch for **`containers == origin/main`**, never for your own merge sha — with other agents merging
concurrently the containers skip straight past your commit, and a sha-specific watch reports a failure
that never happened. (That mistake was made, and cost 30 minutes of chasing.)

## Two habits this stream keeps paying for

- **Read the script before pointing a tool at production.** `verify-ledger` is documented "read-only"
  and writes three rows inside an always-aborting transaction.
- **A guard never seen red is green for reasons nobody has checked.** Prove every new guard against a
  real mutation — and check the mutation actually applied. One here failed silently (double quotes are
  identifiers in SQL, not strings) and was nearly shipped as passing.

## Still open beyond the theme work

`OPEN.md` is the index. The ones with teeth: **`tokophi.id` apex returns 503** (DOM-1) · **an
unapproved store's storefront is public** (SEC-1, latent — the review queue is empty today) · **backups
have no offsite copy** (DR-1) · **`.id` TLS floor is still 1.0** (T-4, a compatibility call).
