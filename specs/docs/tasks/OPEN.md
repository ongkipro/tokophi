# OPEN — what is actually left, and how to pick it up on another machine

**Written 2026-08-05, every entry re-verified against `origin/main` @ `05b3068`.** Read this first.

`NEXT.md` is the long-form record — ~1.500 lines, it keeps closed items on purpose, and **it goes
stale fast**: this sweep found **eleven** entries still marked open or `NEW` that were already shipped
or refuted, one of them filed by me the same day. It has been corrected, but assume drift again by the
time you read this.

> **If this file and `NEXT.md` disagree, check the CODE. Then fix whichever is wrong.**
> And measure on `origin/main`, never on your own rebased branch — that is how a task got filed for a
> flake that the very next merge had already fixed.

▶️ **Wondering what happened on 2026-08-05?**
[`2026-08-05-session-close.md`](./2026-08-05-session-close.md) is the ledger — nine PRs, two zone
changes, the verified end state, and what each remaining item belongs to. Start there, then come back
to this file for the open list.

⚠️ **Starting fresh on THIS machine? Read
[`2026-08-05-handoff-and-unfiled-scan.md`](./2026-08-05-handoff-and-unfiled-scan.md) first.** The
working copy carries **26 dirty worktrees, ~60 local branches and a `main` that is 30 ahead / 522
behind** — five of those worktrees hold a migration journal stamped BELOW main's, which is the
"applied successfully" silent-skip. Nothing there is safe to mass-commit.

🔴 **NEW 2026-08-05 — the backups retain HOURS, not days.** All seven dumps on production are from
one day (`10:44`→`16:28`); every deploy restarts the backup container, which dumps immediately and
then `sleep 86400`, so `keep-7` evicts every older recovery point. **A data-corrupting change not
caught within ~7 deploys has no clean dump to restore from**, and the dumps sit on the box they
protect with no offsite copy. Detail + runbook → [`../SLA-DRP.md`](../SLA-DRP.md) §3.

**Security posture in one place → [`../SECURITY.md`](../SECURITY.md)** (new 2026-08-05). It is the
standing shape — boundaries, identity, isolation, transport, secrets, limits, and §10 "gaps we are
living with". Findings still belong in `AUDIT-SUMMARY.md`; do not duplicate them there.

Three detailed handoffs sit underneath this index; go to them for reasoning, not to this file:
- **[`2026-08-05-audit-waves-6-9-handoff.md`](./2026-08-05-audit-waves-6-9-handoff.md)** — the audit
  stream, and its **"do not re-file"** list.
- **[`2026-08-05-kiriminaja-doc-sweep.md`](./2026-08-05-kiriminaja-doc-sweep.md)** — the shipping /
  KiriminAja stream.
- **[`2026-08-06-alerting-gaps.md`](./2026-08-06-alerting-gaps.md)** — **apa yang gagal DIAM-DIAM dan
  siapa yang seharusnya diberi tahu.** Bukan daftar bug: semuanya "berfungsi", yang tidak ada adalah
  penerimanya. Mengelompokkan N57–N63 dan menyebut urutan pengerjaannya.
- **[`2026-08-05-signup-open-audit.md`](./2026-08-05-signup-open-audit.md)** — what
  `SIGNUP_ENABLED=true` would actually expose, now that #154 made the switch reachable. **Signup is
  still shut.**
- **[`2026-08-05-handoff-and-unfiled-scan.md`](./2026-08-05-handoff-and-unfiled-scan.md)** — the five
  PRs that shipped 2026-08-05, the repo's own verifiers re-run and green, and **four items that had
  no task behind them** (this file's deploy-time figure is one of them — it is wrong).

---

## ⚠️ `NEXT.md` has EIGHT duplicated numbers — always quote the TITLE

The doc sweep (#146) and audit wave 7 (#148) both numbered from N36. #146 landed first, so the numbers
are its; wave 7 reused them. **Nothing has been renumbered** — renaming another stream's live entries
mid-flight is how two people work the same id from opposite ends. Wave-7 headings now carry a
`(wave 7)` suffix where they were rewritten; the rest you disambiguate by title.

| id | #146 — shipping / KiriminAja | #148 — audit wave 7 |
|---|---|---|
| N36 | Five status codes unmapped ✅ | Tenant from the BODY ❌ refuted |
| N37 | `pickup_number` + VA/COD ✅ | Body-size / array caps ✅ |
| N38 | **Label missing required fields** 🟠 | Provider error text ✅ |
| N39 | **Webhooks unused** 🔴 blocked | Money tests skipped in a worktree ✅ |
| N40 | **`v6.1` is vendor-deprecated** 🟠 | `NaN` in an SVG path ✅ |
| N41 | **Courier holidays (`libur`)** 🟠 | Seed drift 🟡 3 of 5 left |
| N42 | COD settlement ✅ (ADR 0014) | `SEED_FORCE=1` destroys config ✅ |
| N43 | flake ✅ (was never real) | Defects only in a commit body ✅ |

(`N18a`/`N18b` look like a collision to a naive grep. They are not.)

---

## 🔴 Needs the owner — nobody else can start these

| | what is actually being asked |
|---|---|
| 🔴 **An UNAPPROVED store's storefront is fully public** | **NEW 2026-08-05 evening, and it is live now that `SIGNUP_ENABLED=true`.** #169 put self-serve signups in a review queue — the store is created `suspended`, `approvedAt` NULL, and the **seller panel** is correctly read-only. The **storefront was not part of that lock**: `getStoreBySlug` (`apps/storefront/src/data/store.ts`) filters on the slug and nothing else, `apps/storefront/src/` contains **zero** references to `suspended`/`approved_at`, and `StoreInfo` does not even carry `status` — so it cannot gate on one without a change. Measured: production holds 1 store, approved, so **nothing is exploited today**; this is a latent hole, not an incident. What an attacker gets: a chosen `<slug>.tokophi.com` (minus the 9 reserved) serving a page with a chosen shop name of up to 60 chars, empty catalogue (they cannot add products — the panel is locked), rate-limited to 5 signups per 10 min per IP. That is **subdomain squatting and a brand-impersonation surface on our own domain**. ⚠️ **It is a product decision, not a patch:** should an unapproved slug 404, show a neutral "belum aktif" page, or serve normally? A 404 leaks least but tells a legitimate new merchant nothing. Decide, then add `status`/`approvedAt` to `StoreInfo` and gate in ONE place — `getStoreBySlug` is the sink both host paths funnel through. |



| | what is actually being asked |
|---|---|
| **Prepaid shipping absorption** | [ADR 0014](../../decisions/0014-platform-absorbs-cod-shipping.md) settled COD: the platform absorbs it. **Prepaid runs the identical shape and is undecided** — merchant credited gross, platform settles the courier by VA. The figure is already on Super Admin → Analitik labelled *"belum diputuskan"*. Needs its own ADR. |
| **N29 — rotate the exposed accounts** | The *seed* is fixed (#150); **no existing row changed**, and `demo@tokophi.com` still authenticates with the published password. Runbook `2026-08-03-rotate-exposed-owners.md` is written and **unrun**. ⚠️ Its measurements are stale (it assumes 8 stores / 9 principals; production now holds 1 store, 1 user, 1 operator) — **re-measure first**. |
| **N2 — two Cloudflare zone settings** | Approved 2026-08-01, procedure in `CLOUDFLARE-PERF.md` §1–§2, still not executed. Zone config, no code. Blocked on a token with **ruleset** permission. ⚠️ The HSTS row below was done on the same zone with the token we DO have — that is `Zone Settings: Edit`, a different permission. **N2 is not unblocked by it.** |
| ~~No host sends HSTS~~ | ✅ **DONE 2026-08-05 — both halves, and the ramp is finished.** Cookie half was #156 (all seven writes through `@tokophi/lib/session-cookie`). HSTS is live on the zone at **`max-age=31536000; includeSubDomains`** — raised from the 24 h ramp value the same day — verified on all six hosts **including a tenant subdomain** (`batik-nusantara.tokophi.com`), the line that proves `includeSubDomains` reaches a per-merchant shop. `preload` stays OFF (one-way door). 🔴 **There is no follow-up left, and no early rollback either**: disabling it stops us SENDING the header but cannot reach a browser that already holds one — that browser refuses `http://` for up to a year from its last visit. The remaining decision is [`CLOUDFLARE-PERF.md`](../CLOUDFLARE-PERF.md) §4's last note: **settle HSTS on merchant custom hostnames BEFORE wiring Cloudflare for SaaS**, because the same year-long promise would be emitted on a domain we do not control. |
| **N1 — impersonation token** | 2-minute JWT in a **query string**, no `jti`, no single-use, and it mints a **7-day** session cookie carrying no impersonation marker. Unchanged. Needs an ADR before code. |
| **N16 — `tokophi_app` DML on platform tables** | `0012_tenant_rls.sql` still grants full DML on *all* tables; no `REVOKE` anywhere; the `stores` policy is `FOR ALL`, so a tenant can UPDATE its own `comped`/`status`. Architecture decision before the PostgREST cutover. |
| **N25 — `color_palettes` orphan** | In `SCHEMA.md`, in no migration, read by nothing. Dropping it on the shared dev container is destructive. |
| **N5 — `dom-size`** | Measured to the end; both options costed; neither taken. A decision, not work. |
| **N28 — super-admin's 7 screens** | Gating verified, **content never crawled**. Needs the owner's go-ahead to drive `rich.` |
| **Open self-serve signup?** | #154 made the switch reachable; the gate is sound, **metered** (5/10 min per IP), and the three 🟡 items are **done** (reserved slugs, both check-then-insert races, name bounds — plus a third `slugify` the sweep turned up in the seed). What is left is one product decision: signup would create real tenants for **unverified email addresses** — there is no mailer in this repo, so verification is a provider + tokens + a pending state, not a small change. Cheaper alternatives (operator approval, or keep onboarding by hand through Super Admin) are costed in [`2026-08-05-signup-open-audit.md`](./2026-08-05-signup-open-audit.md). |

## 🟢 Ready to pick up — no decision needed

Roughly highest value first. **S** ≈ under an hour, **M** ≈ half a day, **L** ≈ more.

| | | |
|---|---|---|
| 🔴 **N59** | **Tidak ada CI — `main` bisa merah dan tak ada yang tahu.** `seller-entity-links.test.ts` merah di `origin/main` @ `e6d557e` SEKARANG, ter-merge begitu saja. ⚠️ Suite butuh Postgres; biarkan DB tak terjangkau GAGAL, bukan SKIP. | **M** |
| **N60** | **Env yang tak sampai ke container tidak berbunyi apa pun** — Coolify memotret env saat deployment dimulai; sebuah nilai yang disimpan sesudahnya menghasilkan `SIGNUP_ENABLED: ''` dengan semua host sehat. Terjadi dua kali dalam seminggu. | **S** |
| **N61** | Empat skrip `verify-*` ada, tak satu pun otomatis — termasuk `verify-rls`, pagar yang pernah merah berminggu-minggu. | **S** |
| **N62** | Login gagal tidak dicatat di mana pun (nol hasil di seluruh repo); rate limit menghitung IP, bukan akun. | **S** |
| **N63** | Sidecar `cron-tracking` hanya bersuara ke `docker logs` — pernah nol selama seminggu tanpa ada yang sadar. | **S** |
| **N57** | **Nobody is told when a signup arrives.** Signup is OPEN in production and every new shop lands in the review queue, under a "1×24 jam" promise made on the merchant's own dashboard — while the only traces are pull-only (the dashboard counter, a `platform_activity` row). ⚠️ Decide the transport first (WhatsApp Cloud API vs Telegram/Slack to ourselves); `waLink()` cannot SEND. | **M** |
| **N58** | **There is no mailer at all** — measured: 0 mail dependencies, and no MX/SPF on `tokophi.id` or `tokophi.com`. Blocks email verification at signup (why the approval queue exists), merchant password reset, invoice delivery. Receiving an address is a separate, free problem (Cloudflare Email Routing). | **L** |
| ✅ **N54 — SUDAH DIKIRIM** (diverifikasi di kode 2026-08-07: `app/(admin)/promo/html/baru/page.tsx` ADA, dan komentarnya sendiri menyebut N54) | ~~**There is NO way to create a landing page — the button 404s.**~~ `promo-list-client.tsx:126` links to `/promo/html/baru`; that route only has `[id]/`, which `notFound()`s on a non-UUID. The feature has never been reachable. | **S** |
| **N38** (shipping) | Label misses required fields. **Four of five are pure plumbing** — service type, both postcodes, sender phone, item prices all already persisted. **Insurance is not stored at all** and needs a column. 🔴 Sorting code is blocked twice (values come from KiriminAja support, and it rides the webhook we do not receive) — and **SPX needs a 2-column one, SPX being the primary courier and the COD rail**. | **M** |
| ~~N33 aftermath~~ | ✅ **DONE 2026-08-05 — backfilled on PRODUCTION and dev**, 24 rows each, log: [`2026-08-05-n33-backfill-executed.md`](./2026-08-05-n33-backfill-executed.md). ⚠️ Measured: it is **price-neutral** — 35×26×7 implies 1.062 g volumetric, which rounds into the same 1 kg tier as the existing floor. The value delivered is that the BOOKING now declares a truthful parcel, so the courier's re-measure stops surcharging the merchant. | — |
| 🟠 **Parcel size ignores quantity** | **NEW, nobody had filed it.** `maxDims()` takes the largest value per axis across cart lines, so a cart of five gamis still declares ONE garment's parcel while the weight grows to 2,5 kg. Deliberate (quote and booking must agree) and therefore not a regression — but volumetric can then only ever dominate on a single bulky item. Decide: sum an axis, scale the smallest, or accept and record it in `KIRIMINAJA.md`. | **S** |
| **N44** (wave 7) | Empty states, 2 screens left: `pelanggan/segmen/segmen-client.tsx` and `crm/template/template-client.tsx` — both print a summary strip over a bare `.map`. | **S** |
| **N47 · N48** | An operator who forgets their password has **no way back in** (only self-service change exists); and a refused super-admin action **throws into a `startTransition` nobody catches**, so the operator sees nothing. | **S** |
| ✅ **N52 — SUDAH DIKIRIM** (diverifikasi 2026-08-07) | ~~`CardTitle` is a `<div>`~~ — `packages/ui/.../card.tsx` merender `h${level}`, default `h2`, dengan `level` sebagai escape hatch; salinan lokal admin (`apps/admin/components/ui`) sudah tidak ada. | — |
| **N46** (wave 7) | The credential sweep still scans `apps/` only (`no-published-credentials.test.ts:25`); 26 files under `packages/{sections,ui}` are outside it, while its sibling already scans every tracked file. | **S** |
| **N56** (N55 ✅ **SUDAH DIKIRIM**, diverifikasi 2026-08-07: `return-by-courier.tsx` kini membawa `TriangleAlert`/`ShieldCheck` + `sr-only`) | Puck's vendored ArrayField/zoom controls unnamed. | **S** |
| **N31** (shipping) | The COD fee KiriminAja charges is never read — `cod_fee`/`minimum_cod_fee`/`cod_fee_amount` come back on every rate and **0 code reads them**; `platform_cod.fee_pct` is written by the seed and read by nobody. This is also what keeps ADR 0014's cost figure incomplete. | **S** |
| **N40** (shipping) | We book on `v6.1/request_pickup`, which the vendor marks **deprecated**. ⚠️ The v6.2 doc contradicts itself on destination field names — resolve against the sandbox first; booking to the wrong village is what migration 0042 exists to prevent. `shipping_price` v6.1 is *not* deprecated. | **M** |
| **N41** (wave 7) | Seed drift: 2 of 5 refuted against production. Left, **never checked**: `store_shipping_methods`, `reviews.product_id`, `platform_payment_channels`/`platform_payout`. | **M** |
| **DB-PARITY** | **Screen local vs Vultr production database for migration/schema/RLS, commerce integrity, seed drift, backup recency, and capacity.** Read-only by default; no cleanup or migration is bundled. Full scope and acceptance criteria: [`2026-08-05-database-screening.md`](./2026-08-05-database-screening.md). | **M** |
| **N35** (shipping) | Show the active KiriminAja env on the super-admin connection card. ⚠️ The entry overstates it — the env **is** already visible on Analitik → Sistem and inside the Test-koneksi result; only the card named in the AC lacks it. | **S** |
| **N13** | Sitemap `<lastmod>`: pages/blog done. Products + categories are **blocked on a migration** — `products` and `collections` have no `updatedAt`. | **M** |

## 🔴 Blocked on something outside the repo

- **N39 (shipping) — webhooks.** `processed_packages` carries the AWB; this is what makes the resi
  appear in seconds instead of ≤15 minutes. **The registration endpoint's path is not in the captured
  docs** — get it from the KiriminAja portal or support. Everything else can be built against a
  hand-rolled POST. Note there is **no signature scheme** (bare bearer, no HMAC, no replay
  protection) and **no server-side retry**, so it goes *beside* the poller, never instead of it.
- **N41 (shipping) — courier holidays.** The schedule endpoint returns a `libur` flag; its path and
  request body are both absent from the docs. Skipping the endpoint is explicitly allowed, so decide:
  call it, or record in `KIRIMINAJA.md` that we accept booking onto a closed day.

⚠️ **Outstanding since the E2E run:** sandbox booking `5758-E2E68072665` / pickup `XID-5544692486`
could not be cancelled. **Do not repeat the booking run** — `2026-08-03-shipping-e2e-runbook.md`.

---

## Getting it running on a new machine

```bash
git clone git@github.com:ongkipro/tokophi.git && cd tokophi
git fetch origin
docker compose up -d db                  # PostgreSQL 16 → localhost:5433, container `tokophi-db`
npm install
npm run migrate -w @tokophi/db           # canonical; head is 0089
npm run dev:admin                        # :3000 Seller   ·   npm run dev:super → :3001 Super Admin
```

**Secrets are gitignored and not in the repo**: root `.env` (see `.env.example`) plus
`apps/admin/.env.local` and `apps/super-admin/.env.local`. Ask the owner — never reconstruct one from
a running container, and never paste one into a chat or a commit.

### 🔴 `main` on an existing checkout is a stale fork — **516 commits behind** `origin/main`

Measured 2026-08-05. **Never branch from local `main`, never push it.** Cut worktrees off the remote:

```bash
git fetch origin
git worktree add -b my/branch ../wt-my-branch origin/main
cd ../wt-my-branch && npm install        # ⚠️ a fresh worktree has NO node_modules
```

Skip that `npm install` and TypeScript resolves `@tokophi/db` to the *other* checkout — an error that
points nowhere near its cause.

## Traps

The audit stream's own list is in its handoff (migration re-stamping, `*/` closing a block comment,
the seven seeders that run on every deploy). These are the ones this stream hit:

- **`drizzle-kit generate` is NOT safe here.** It diffs against the last *snapshot*, which is **0082**
  — later migrations are hand-written and left none — so it re-emits all of their changes, including
  `ADD COLUMN` without `IF NOT EXISTS` and unique constraints under *different names* than the ones
  that exist. Drizzle applies the batch in **one transaction**, so it fails and rolls back everything
  behind it. **Hand-write the SQL, idempotent, journal entry only.**
- **Check the highest migration number ON THE REMOTE, not locally.** 0087 was claimed by another
  branch mid-flight; the colliding migration had to be renumbered to 0088 *and* every reference to it
  chased down. Also check `_journal.json` for a future-dated `when` — that makes drizzle silently SKIP
  later migrations while printing "migrations applied successfully".
- **A fresh worktree cannot `build:admin`** without `apps/admin/.env.local`; it fails on
  `/api/auth/signout` with "Failed to collect page data", unrelated to your change. Stash and rebuild
  to confirm before hunting.
- **The dev DB and the dev servers are shared.** Never `pkill next`; record your PID and kill only
  that. If you flip a row to test something, flip it back — and say so.
- **Playwright is global**, not a dependency: import from
  `/home/fantastico/.nvm/versions/node/v24.16.0/lib/node_modules/playwright/index.mjs`, launch with
  `{ channel: "chrome" }`.

## Gates — and what each one misses

```bash
npm test                                  # vitest + astro check ×2 — 486 tests / 55 files, green on 05b3068
cd apps/admin && npx tsc --noEmit
cd apps/admin && npx eslint <files>       # eslint must run FROM the workspace dir
npm run build:admin ; npm run build:super
```

- **`next build` does not run ESLint.**
- **ESLint and `next build` do not typecheck test files** — only `tsc --noEmit` does.
- **All of them stay green on live outages.** This repo's own history: a `ReferenceError` inside a
  client `<script>` that blocked the entire rate load, and `select sum(…) for update` inside a SQL
  string Postgres rejects outright. **For anything browser-visible, open a browser.**

## Deploying

Merge to `origin/main` → Coolify rebuilds. **9–11 minutes** from merge to all four hosts green, with
a **~1,5–2,5 min window of 503** while containers swap (admin recovers slightly before the
storefront). ⚠️ This used to read "~6 minutes / 60–90 s" and both halves were understated — measured
FOUR times on 2026-08-05: **524 s · 656 s · 558 s · 542 s**, sampled every 25 s. `DEPLOY.md`'s
"~8–9 min" was the closer of the two figures. The low number is what makes someone conclude a healthy
deploy has failed and start intervening. Watch until all four return:

```bash
for h in tokophi.com app.tokophi.com rich.tokophi.com toko.tokophi.com; do
  echo "$h $(curl -s -o /dev/null -w '%{http_code}' https://$h/)"; done
# 200 / 307 / 307 / 200 is HEALTHY — 307 on app. and rich. is the login redirect.
```

Migrations run as a one-off `migrate` service that the three apps wait on
(`service_completed_successfully`), **so if the apps came back, the migration applied**. `seed.ts` is
a no-op on a live DB (it counts `stores` and skips), so a redeploy never touches real data.
