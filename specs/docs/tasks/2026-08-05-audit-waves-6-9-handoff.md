# Handoff — audit waves 6–9 (2026-08-05)

**Read this before picking anything up.** Four waves landed and were verified on production today.
This file says where things stand, what is open in priority order, what is waiting on the owner, and
the traps that fired *during* this work — those cost more time than any of the bugs.

- **Production is on `0fa69b2a`** (PR #150). Waves 6–9 = PRs **#147 · #148 · #149 · #150**.
- **Migration journal head: `0089_platform_password_revokes_sessions`, stamped `1785895600000`.**
  Wave 9 added **no** migration.
- Production holds **1 store** (`batik-nusantara`), **219 orders** (a dummy set — 32 distinct phones,
  names like "feri crut"), **1 user**, **1 platform operator**, **25 products**.
- Ledger: `pending` **Rp23.424.347** · `available` **Rp21.032.562**, and pending now **equals** its own
  itemised "Dana dalam proses" list. It did not, until today.

---

## 🔴 Waiting on the owner — do not act on these without a decision

### ① `ops/tokophi-n33-product-dimensions.sql` — unexecuted, ends in `rollback`

The seed writes `1×1×1 cm` for every product, and that is **also what the BOOKING declares to the
courier**. KiriminAja bills volumetric (`w × l × h ÷ 6`) whenever it exceeds actual weight.

- Touches `products.length_cm/width_cm/height_cm` **only**, and only rows matching the exact
  `1 AND 1 AND 1` fingerprint. A merchant's typed value is untouched; **a NULL is untouched** (NULL
  means unknown, the booking's `?? 10` handles it, and inventing a size for an unseen product is the
  defect, not the fix).
- Dry-run against a scratch copy: **24 matched, 24 updated, 0 left at 1×1×1, 0 unmatched handles.**
- **Verified on production after the wave-9 deploy: still 24 rows at `1×1×1`.** `seed-products.ts`
  runs on every deploy but its skip branch is `if (exists) { skipped++; continue; }` — it writes
  nothing — so the deploy did **not** silently apply this.
- ⚠️ **Running it makes ongkir go UP** for bulky-light items — correctly. That visible change to a
  live shop is why it is not a drizzle migration: merging one would apply it unattended on the next
  Coolify build.

### ② The demo store's password

`demo@tokophi.com` still authenticates with `tokophi123` — **verified by scrypt against the stored
hash on production**, not inferred. It is the credential the owner deliberately chose for the demo
store, so this is a question, not a defect: rotate it, or keep it memorable for demos?

The seed no longer mints a fixed password for **new** stores (wave 9), and
`FIXED_PASSWORD_ALLOWED` is now an **empty set** in `packages/lib/src/password.ts`, proved red twice.
The platform operator `ongkiardiansyah@gmail.com` is **not** on `tokophi123` — measured.

---

## Open work, in the order I would take it

### 🔴 N54 — there is NO way to create a landing page
The highest-value open item, because a whole feature is unreachable rather than merely wrong.

- `promo-list-client.tsx:126` → `<Link href="/promo/html/baru" />`
- `promo/html/[id]/page.tsx:12` → `if (!isUuid(id)) notFound();`
- `promo/html/` contains **only `[id]`**. `"baru"` is not a UUID.

The feature has an editor, a storefront renderer, an owner-only `landing:html` capability and a
documented XSS posture — and no row can be made through the UI. Existing rows edit fine, which is why
it survived: the screen looks complete.
⚠️ **The `isUuid` guard is correct and must stay** (Postgres throws `22P02` on a non-UUID — a 500
where a 404 belongs). The fix is a `baru/` route, or a create action that mints a row and redirects.

### N52 — `CardTitle` is a `<div>`
**128 card "headings" are invisible to heading navigation**; the admin is a flat `h1` on nearly every
screen. One primitive, but it touches every admin screen's visual rhythm and interacts with the
`admin-h1-floor` guard wave 8 added — so it wants its own change set and a deliberate pass over the
levels (`h2` under the page `h1`, `h3` inside a card).

### N47 · N48 — the two super-admin gaps wave 7 left
N47: an operator who forgets their password still needs `psql` — there is no "reset somebody else's"
path. N48: `requirePlatformAdmin` **throws**, and no caller in `pengaturan-client.tsx` shows the
operator anything, so a refused action looks like a no-op.

### N55 · N56 — the a11y tail
N55: `return-by-courier.tsx` decides each row by bar colour alone. N56: Puck's own vendored controls
(viewport zoom, ArrayField add) have no accessible name; the array field has an override point, the
zoom does not.

### N35 — surface which KiriminAja environment a deploy is on
`KIRIMINAJA_ENV` unset resolves to **sandbox**, and a sandbox booking returns a `kaOrderId` and
`pickup_number` shaped identically to a production one. So a deploy on the wrong endpoint reads as
perfectly healthy — orders say "dibooking", resi appear on schedule, **and no courier ever collects.**

### N41 — seed drift (mostly refuted, finish the rest)
Two of its items were **refuted against production**: COD is fully alive (all three links —
`platform_cod.enabled=true`, cap Rp2.000.000, 6 provinces; `spx` enabled with 2 cod-capable services;
`store_settings.cod_enabled=true`), and the pickup origin **is** set (`sender_kecamatan_id = 6138`).
The remaining items were never checked against production. Check before claiming.

---

## Traps that fired during this work — these cost the most time

### ⚠️ Renumbering a migration is HALF the fix. Re-stamp too.
`verify-migrations` catches a duplicate `idx`. **Nothing catches a stamp that is too low.** Drizzle
applies only entries above the target's newest recorded stamp, so a lower one is **skipped while
printing "migrations applied successfully"**.

It fired on wave 7: `ka/flow-audit` landed `0088_ka_shipment_payment` at `1785895548092` while our
`0088` sat at `1785774400000`. Renumbering alone would have shipped a deploy where production had no
`platform_admins.password_changed_at`, `getPlatformSession` throws, and **every operator is locked out
of the control plane.** Confirm with `select max(created_at) from drizzle.__drizzle_migrations` on the
target, not by reading the journal.

### ⚠️ A `*` followed by `/` inside a block comment closes it — twice today, two files, two authors
Once in `test/source-code.ts` (writing a comment-splice example literally), once in a `seed.ts` JSDoc
containing the glob `apps/*/app/**`. The first **failed 18 of 50 test files at IMPORT while the 296
that still collected all passed** — a green-looking count over a broken module. `tsc` and `npm test`
catch it; nothing else does. This repo's style is long comments full of globs and code samples, so
the trap is structural here, not a slip.

### ⚠️ `seed.ts` skips a populated DB — but SEVEN other seeders run on every deploy
Verified: `npm run seed -w @tokophi/db` on a populated DB prints *"DB already has data — skipping
seed"* and exits 0, changing nothing. But the `migrate` container's command chains
`seed-templates` · `seed-journal` · `seed-taxonomy` · `seed-products` · `seed-demo-ratings` ·
`seed-areas` **after** it, and those do **not** skip.
`seed-templates` **REPLACES** the demo's page templates every deploy — deliberate, hardcoded to
`batik-nusantara`, and documented at the upsert itself. ⚠️ **Consequence for the owner: editing Batik
Nusantara's homepage in the Store Builder is reverted by the next deploy.**

### ⚠️ Agent progress messages are not commits
A stream reported "now on item 4" and had landed **zero commits** — its only work was uncommitted in
the worktree. Commit in small pieces as you go; check `git log origin/main..HEAD` before believing a
report.

---

## What was refuted this session — do not re-file these

Five claims died on contact with measurement. Four of them were claims *I* passed to a stream.

| claim | verdict |
|---|---|
| Three public routes take the tenant from the BODY (cross-tenant) | **Refuted.** Served from `app.tokophi.com` while the shopper is on `<slug>.tokophi.com`, so the `Host` carries no tenant. Moving them into the storefront would put the platform's KiriminAja/AutoLaris keys in that container. Reasoning is in `AGENTS.md`. |
| `/produk` has no `h1`, only an `h3` | **Refuted.** It renders `PageHeader` → `H1 Produk`. The real defect was the **level skip** h1 → h3. |
| The two verdicts are colour-only with no icon/sign/word | **Refuted.** Both already had them. The colour-only thing was the **judgement over missing data**. |
| `saldo-filters` dates / order-detail checkboxes are unlabelled | **Refuted by rendering.** Both already announce correctly. |
| N49: a prefilter makes the credential sweep ~400× faster | **Retracted — my own mis-measurement.** I measured with literal needles; the patterns are whitespace-tolerant regexes. Sound win is **3,7×**, which does not buy hand-rolled chunk extraction inside a security guard. |

---

## Ground rules that still bind

- **Verify against production before claiming.** Read-only:
  `ssh -i ~/.ssh/tokophi_dev root@45.77.33.112 'docker exec -i $(docker ps --format "{{.Names}}" | grep -m1 "^postgres-") psql -U tokophi -d tokophi'`
  Resolve the container **by prefix** — the hash suffix changes every deploy.
- **Never write to production without the owner's word.** Write the SQL, dry-run it in a transaction
  ending in `rollback`, show the counts.
- **Never `npm run seed` / `SEED_FORCE=1` / `npm run reset` against the shared dev DB** — they
  TRUNCATE and hand out new `store_id`s. `SEED_FORCE=1` alone now **refuses** (wave 9), naming what it
  would destroy; `SEED_DESTROY_CONFIG=1` is the second, deliberate switch.
- **Merges are serialised.** Merge, watch the deploy land, verify, then let the next one go.
- **Verify a deploy with falsifiable signals, never with build status.** Capture the BEFORE, merge,
  then re-run the same probe. Every wave here has its before/after in its PR body.
- `npm test` · `npx tsc --noEmit` (admin, super-admin, `packages/db`) · `npm run verify-migrations` ·
  `verify-rls` · `verify-ledger` · `npm run lint -w @tokophi/admin` (**33 problems is the baseline —
  do not let it rise**).

**Current gate reading at `0fa69b2a`: 54 test files / 484 tests, `astro check` 0 errors on both Astro
apps, all three DB verifiers green.**
