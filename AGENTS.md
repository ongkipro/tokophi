# TokoΦ — working agreement (read before coding)

## 🤖 AI, AGENT & COLLABORATOR AUTO-EXECUTION, TASK & REPORTING PROTOCOL

Every AI model (OMP, Claude, Codex, Pi, Antigravity, sub-agents) and human collaborator operating on this repository MUST strictly follow this mandatory 4-step task management, reporting, and execution log protocol:

1. **Auto-Task Tracking (`specs/docs/TASKS.md`)**:
   - Check `specs/docs/TASKS.md` before starting any work item.
   - If working on a new task or sub-item, explicitly record or pick it in `specs/docs/TASKS.md`.
   - Maintain real-time state flags (`[ ]` todo → `[~]` in progress → `[x]` done).
   - **Rule:** Never yield or complete work without marking its task entry `[x]` done in `TASKS.md`.

2. **Execution Logging & History (`BUILD-LOG.md`)**:
   - Every finished task, bug fix, feature implementation, or audit pass MUST append a structured log entry to `BUILD-LOG.md`.
   - **Log Entry Standard**:
     - Timestamp in UTC (`YYYY-MM-DD HH:MM UTC`)
     - Executor identity (e.g. `Main Session`, `SecurityRLSAuditor`, `Collaborator`)
     - Task / Scope ID (`SEC-C1`, `INF-C2`, `ADM-001`, `PAY-001`, etc.)
     - Modified file inventory
     - Concrete verification proof (`npm test` numbers, `check:storefront`, `check:landing`, `ops/tokophi-probe.sh` output)

3. **Status Synchronization (`specs/docs/STATUS.md`)**:
   - Update `specs/docs/STATUS.md` timestamp and verifiable system health metrics (passing test count, Astro check status, migration counts) whenever changes alter platform state or API contracts.

4. **Master Engineering Report & Task Specs (`specs/docs/`)**:
   - For major features, multi-domain audits, or architectural decisions, maintain `specs/docs/TOKOPHI_MASTER_ENGINEERING_REPORT.md` and task specifications under `specs/docs/tasks/` so incoming agents and collaborators inherit complete context and history.

## 🤝 MULTIPLE AGENTS SHARE THIS WORKTREE — read this first

More than one Claude runs against this repo, this database and this machine **at the same time**. We
are building one product together, not racing. Everything below was learned by breaking it.

**The shared things you can destroy for someone else in one command:**
- **The database.** `SEED_FORCE=1 npm run seed` / `npm run reset` **TRUNCATE everything** and hand out
  new `store_id`s. Anyone mid-verification loses their data and their logged-in session, silently, with
  no error to tell them why. **Announce before you re-seed. Prefer a targeted SQL write.** If you flip
  a row to test something (e.g. `enabled=true` on a channel), **flip it back** — leave the DB honest.
  - 💡 **The demo looks dead? Do NOT re-seed — run `npm run seed:recent -w @tokophi/db`.** The main seed
    anchors every date to `TODAY = 2026-06-30` while the clock keeps moving, so the charts rot a day per
    day (by 17 Juli the "7 hari" tab was legitimately empty and "−42% vs 30 hari sebelumnya" was measuring
    the seed running out, not a trend). `seed:recent` only INSERTS, touches one store, and is idempotent
    — it fills only days with zero orders, so a second run does nothing. Re-running it is free; truncating
    the shared DB costs someone else their afternoon.
  - ⚠️ **The same rot hits WRITES, not only charts (found 2026-09-08, Task 8.13).** `stores.current_period_end`
    is seeded at a fixed date; once the wall clock passes it, `computeBilling()` returns `readOnly` and EVERY
    admin save fails with `SuspendedError` — surfacing as "Gagal menyimpan produk" on a store nobody suspended.
    Two browser agents had to move that one column forward and put it back to test anything that writes. **`npm run seed:recent -w @tokophi/db` now fixes it** (Task 8.13, 2026-09-09): its first step moves a
    LAPSED `current_period_end` to `now() + 30 days` for the anchor store only, idempotently, and prints what it did.
    Do not hand-edit `stores` for this any more.
  - 🛑 **`SEED_FORCE=1` now REFUSES** when the database holds rows nothing writes back — orders,
    customers, ledger entries, media, Store Builder templates, flash sales, the platform operator
    logins, the aggregator API key, the gateway credentials, and **the encrypted CAPI tokens in
    `store_tracking_channels`, which the seed does not write at all** (N42). It prints the count per
    table and stops. Re-run with **`SEED_DESTROY_CONFIG=1`** as well if you truly mean it — a second
    variable, because `SEED_FORCE=1` is a flag people copy out of a doc.
    ⚠️ **Do not "fix" this by lengthening the truncate keep-list.** Measured: with
    `store_tracking_channels`, `page_templates` and `flash_sales` on the list, Postgres still prints
    `truncate cascades to table "…"` for all three and empties them — `cascade` follows their
    `store_id` FK into the truncated set. A keep-list entry for a store-scoped table is a no-op that
    READS like protection. `packages/db/src/seed-guard.ts` + `seed-guard.test.ts` hold the details.
- **Dev servers.** **Never `pkill -f "astro dev"` / `pkill next`** — that kills *their* server, not just
  yours. Record the PID of what you start (`echo $! > …`) and kill only that PID.
- **The git index.** Other agents leave files **staged**. A bare `git add -A` + `git commit` will
  **swallow their half-finished work into your commit**. Always `git status` first, `git add` explicit
  paths, and commit with a pathspec: `git commit -- path/to/your/file`.
- **Files someone is mid-edit on.** Check `git status` before you touch a file. If it is already
  modified and it isn't yours, **leave it and say so** — or wait. Do not "fix" your way through it.
- **Migration numbers.** Two open branches both write the next number. `git fetch && cat origin/main:packages/db/drizzle/meta/_journal.json | tail` BEFORE you add one; `npm run verify-migrations -w @tokophi/db` after. Journal conflict: take **main's file whole** and append your one entry. Write every migration **IDEMPOTENT** (`add column if not exists`, `create index if not exists`, `do $$ … exception when duplicate_object` for enums): drizzle applies the pending batch in ONE transaction, so one "already exists" silently rolls back every migration behind it. A `when` stamp that is too HIGH silently skips someone else's migration — **RE-STAMP as well as renumber**, and confirm with `select max(created_at) from drizzle.__drizzle_migrations` on the target. Never `migrate` an unmerged branch's migration into the shared dev DB. → `specs/docs/rules/migrations.md`

- **PR numbers.** `gh pr create` prints the number; **use that one**. Guessing "the next number" is
  how you run `gh pr merge` against a PR that is not yours. It happened on 2026-07-22 and only failed
  because that PR had already been merged.
- **Merges are serialised, not parallel.** Two branches merged close together both trigger a Coolify
  build and the later one wins; and the second author inherits a conflict they did not create. Merge,
  watch the deploy land, then let the next one go.
- **The stash. `git stash` is GLOBAL — never use it here.** The stash stack belongs to the repository,
  not to you, and other agents park work-in-progress in it. `git status` shows you a dirty file; nothing
  shows you that `stash@{0}` is someone else's unfinished afternoon. On 2026-07-17 a `stash push` + `pop`
  (two explicit paths, nothing exotic) collided with another agent's stash and wrote **conflict markers
  into `produk/[handle].astro` — a file that was never named**. Recovered with `git checkout HEAD -- <file>`
  and their stash left untouched, but only because it happened to be clean at HEAD. **To compare against
  an older version, use `git show <ref>:<path> > /tmp/…`** — never move the working tree out from under
  someone.

- **AI Execution History & Record-Keeping Mandate.** Any AI agent executing tasks on this repository MUST log completed tasks, decisions, test results, and file changes in `BUILD-LOG.md` (and `specs/docs/tasks/`) after every execution pass. Never complete a task without leaving a precise, traceable record of what was done, verified, and updated.
- **Symlinks that leave your worktree.** `~/Documents/Development/tokophi` → `<repo>/specs` **in the
  MAIN checkout, on branch `main`**. Editing "the docs" through that path writes into main's working
  tree, not your branch — your commit will not contain it and main will be left dirty for whoever
  looks next. (`CLAUDE.md → AGENTS.md` is a *local* symlink and is fine — edit `AGENTS.md`.)

**Rough territories** (not walls — but cross them deliberately, not by accident): storefront UI/UX &
responsive · admin + super-admin screens · public API routes (`apps/admin/app/api/public/**`) ·
`packages/db` schema/seed/migrations · docs. Two agents editing `checkout.astro` at once is how the
`queueSave is not defined` outage happened: a rename landed in one half of the file and the call sites
in the other half were left behind, and it blocked **the entire rate load — no rates → no COD → no
order at all** while `astro check`, lint and build all stayed green.

**Hand off in the repo, not in chat.** A fact only you know is a fact the next agent will re-break.
Put it in `CHANGELOG.md` / `STATUS.md` / here. If your change alters a contract another surface reads
(a data-layer signature, a payment/shipping flag, a DB column), **say so in the commit body** — that is
the message the other agent will actually see.

Shopify-style commerce SaaS for Indonesia. **No Themes marketplace, no Apps/Plugins** (the Seller **Tema** menu is the Store Builder for the store's own templates). **Backend live on local PostgreSQL** (Docker :5433, Drizzle): all 3 surfaces READ + all 12 admin editors WRITE the DB, plus local auth (login/session) + local media upload (see Database below). Bahasa Indonesia UI, IDR. **Prod target = self-hosted Postgres + PostgREST on a VPS (NOT Supabase), deferred.** Full spec: `specs/PRD.md` (in this repo).

## 📛 Naming — say "Seller", never "admin panel"
There are TWO admin surfaces and calling them both "admin" is what has repeatedly confused agents *and* users. The **UI copy** now says:

| Code (never rename) | What it is | **User-visible name (UI + docs)** |
|---|---|---|
| `apps/admin` (`@tokophi/admin`, `app.tokophi.com`) | the **merchant's** panel — what a shop owner uses to run their store | **Seller** → "Dashboard Seller", "Halaman Seller", "Akun Seller" |
| `apps/super-admin` (`@tokophi/super-admin`, `rich.tokophi.com`) | **our** platform control plane — manage all stores/plans/billing | **Super Admin** |

- Write **"Seller"** in every merchant-facing string (title, heading, toast, email) and in docs. The super-admin's impersonation button is **"Buka Dashboard Seller"**.
- ⚠️ **Copy + docs only.** Directories (`apps/admin`), packages (`@tokophi/admin`), routes (`/pengaturan`, …), env vars (`ADMIN_URL`), DB columns, RBAC capabilities and code identifiers (`AdminChrome`, `(admin)` route group) **keep the "admin" name** — renaming them is a large, risky refactor with zero user benefit.
- The **store-user role** `admin` (Owner / Admin / Staf, in `store_users.role`) is a *role inside a seller's store*, NOT the surface. It stays "Admin".

## Monorepo (npm workspaces) — 4 surfaces
**LIVE on `tokophi.com`** (2026-07-13): `tokophi.com`/`www` = landing · `app.` = admin · `rich.` = super-admin · `toko.` = demo store · **`<slug>.tokophi.id` = that merchant's storefront** (`<slug>.tokophi.com` answers 301 → `.tokophi.id`, measured 2026-10-12) (ONE storefront container serves every store — the tenant is resolved from the `Host` header, ADR 0009). ⚠️ Every `tokophi.com` DNS record must stay **Cloudflare-proxied**: the wildcard's TLS is a Cloudflare **Origin CA** cert (LE can't issue a wildcard over HTTP-01) which browsers do NOT trust directly. See `DEPLOY.md`.
```
tokophi/
  apps/
    admin/        # "Seller" — the merchant's panel (@tokophi/admin) — what a shop owner uses (UI says "Dashboard Seller")
    super-admin/  # "Super Admin" — platform control plane (@tokophi/super-admin) — what WE use (manage all stores/plans/billing)
    storefront/   # Astro SSR shopper site — multi-tenant by Host header
    landing/      # @tokophi/landing — static Astro front door for the apex (no DB on purpose)
  packages/
    ui/           # @tokophi/ui — shared shadcn/Base UI components + cn + Tailwind v4 tokens (styles.css)
    lib/          # @tokophi/lib — shared formatters (IDR/num/…)
```
- **super-admin** imports shared code via `@tokophi/ui/<component>` + `@tokophi/lib/format`; Tailwind picks up the shared components via `@source` in its `globals.css`.
- **admin's local `components/ui` was deleted on 2026-07-14 (`b14bdc9`)** — 108 admin files import `@tokophi/ui` and none import `@/components/ui` (re-verified 2026-09-08). Edit shared components in `packages/ui`; `apps/admin/lib` is still app-local by design (tenant/RBAC/data code, not a copy of `@tokophi/lib`).

## Run
```bash
# from repo root (workspaces):
npm run dev:admin   # apps/admin        → http://localhost:3000
npm run dev:super   # apps/super-admin  → http://localhost:3001
# or per app:  cd apps/admin && npm run dev
npm run build:admin ; npm run build:super   # typecheck + lint + static build

npm test        # vitest — INCLUDES the DB-coupled money suites (see below)
npm run test:db # same, but a missing/unreachable test DB FAILS instead of skipping
```

### Tests — the rules that keep the suite honest
- `npm test` runs the DB-coupled money suites against `<DATABASE_URL>_test` (`test/db-setup.ts` creates and migrates it). The resolved name MUST end in `_test` or setup throws — never relax that. An unreachable DB SKIPS with a banner; **`npm run test:db` turns the skip into a failure — run it before a PR.**
- A guard that reads source reads its **CODE, never its TEXT**: use `test/source-code.ts` — `codeOnly()` by default, `textWithoutComments()` only for claims about emitted markup, credentials or raw SQL (choose per assertion, say why in the file). Write assertions whitespace-tolerantly. **Prove every new guard red against a mutated COPY of its target before trusting it.** `<!-- -->` is not stripped (it is served to browsers). Never skip a directory by name and never bind a guard to a hardcoded file list — scan everything, name the exceptions.
- A `*` followed by `/` inside a block comment closes it (this repo's long comments full of globs hit it twice) — describe the glob in words or use `//` lines.
- The sink beats the source: `packages/lib/src/password.test.ts` fails any `hashPassword(<arg>)` whose argument is not freshly minted.

**Full rules + incident history → `specs/docs/rules/testing-guards.md`** — read it before writing or changing a test that reads source, or when a guard goes unexpectedly green.

## Database (local Postgres — `@tokophi/db`)

> 🔵 **Since 2026-10-11 the local dev DB is a 1:1 COPY OF PRODUCTION, not the seed** (owner decision:
> development must match what GitHub `main` deploys). It holds all 17 stores incl. the demo store
> `batiknusantara` (`toko.tokophi.com`) and real merchant/customer rows; `apps/admin/public/uploads`
> mirrors the production uploads volume. Local env carries `DATABASE_URL` only — no provider keys —
> so nothing local can reach KiriminAja/AutoLaris/real buyers. Rules that keep it precise:
> 1. **Re-sync before starting work and after every deploy:** `tokophi-sync-prod` (owner workstation,
>    `~/.local/bin`). It refuses while a dev server is connected, backs up the local DB + uploads to
>    `/data/backups/tokophi-local/` (HDD), restores a fresh production `pg_dump` into `tokophi_sync`,
>    compares every table's row count against production, then swaps it in. The previous DB is kept as
>    `tokophi_pre_sync_<timestamp>` — never dropped. Production is only read.
> 2. **Do NOT run `npm run seed` / `SEED_FORCE=1` / `npm run reset` against `tokophi`.** They truncate the
>    production copy and replace it with fixture data; local stops matching what deploys. Tests are
>    unaffected — they use their own `<DATABASE_URL>_test` databases.
> 3. **Never apply an unmerged branch's migration to `tokophi`.** Test a new migration on a separate
>    database (e.g. `createdb tokophi_<branch>` and point that worktree's `DATABASE_URL` at it). Once it is
>    merged AND deployed, `tokophi-sync-prod` brings the schema back in line. Migration count must stay
>    equal across repo journal, local and production.
> Treat the data as production data: no dumps into the repo, chat or tickets.

Local backend fully wired behind the data layer (all 4 surfaces read, all admin editors write; local auth + RBAC + RLS). Plain **PostgreSQL 16 in Docker** + **Drizzle** (annotated in `specs/docs/SCHEMA.md`: **84 tables · 116 migrations `0000`–`0115`**, snake_case, money = bigint IDR). **MULTI-tenant** — the `platformGate` control plane reaches every store. **RLS** covers every store-scoped table except `platform_activity` and enforces at runtime (admin reads/writes run inside a txn that sets `app.store_id` + `SET LOCAL ROLE tokophi_app`). The coverage count is DERIVED: **run `npm run verify-rls -w @tokophi/db` and believe its output, not any sentence** (it must stay green; nothing runs it automatically). `stores` is keyed by `id`, has no `store_id`, so the verifier cannot see it — policy `0058` is keyed on `id`. Storage (MinIO/S3) and PostgREST come with the VPS.
```bash
docker compose up -d db              # PostgreSQL 16 @ localhost:5433 (persisted volume)
npm run migrate -w @tokophi/db     # apply versioned migrations (canonical)
npm run seed    -w @tokophi/db     # (re)load demo data — idempotent (truncates first)
npm run studio  -w @tokophi/db     # Drizzle Studio
npm run generate -w @tokophi/db    # ⚠️ READ THE WARNING BELOW BEFORE USING THIS; `push` = quick dev sync
```
- 🔴 **MIGRATIONS HERE ARE WRITTEN BY HAND — never `npm run generate`.** The drizzle meta snapshots stop at `0095`, so `generate` diffs against a stale snapshot, replays shipped work and emits statements with no `IF NOT EXISTS` form (`ALTER TYPE … ADD VALUE`) that abort the whole pending batch while printing "migrations applied successfully". Copy a recent hand-written migration (`0107`, `0108`): idempotent statements, a `comment on column`, a header comment with the reasoning; append the journal entry yourself with a stamp ABOVE the newest; run `npm run verify-migrations -w @tokophi/db`. → `specs/docs/rules/migrations.md`
- Package `packages/db` → `import { db, schema } from "@tokophi/db"` (server-only). `DATABASE_URL` lives in root `.env` + each app's `.env.local` (copy `.env.example`).
- 🔴 **Two pools.** `db` is the OWNER handle; `withTenant()` is the only caller of `appDb` (restricted role, `APP_DATABASE_URL`) — never import `appDb` elsewhere. `DATABASE_RUNTIME_ROLE=app` without `APP_DATABASE_URL` refuses to start. **You cannot fix an owner path by moving it to the restricted pool**: with no tenant GUC every policy returns 0 rows. Auth's pre-session read, `api/public/**`, cron, provisioning, super-admin and the storefront stay on the owner connection because they have no tenant to scope by — give a path a tenant context first, or leave it.
- **Tenant/RLS pattern.** Admin reads: `withCurrentTenant(async (db, storeId) => …)` (`lib/tenant.ts`). Admin writes: `withTenant(session.storeId, async (db) => …)` with the session from `requireCapability`. Never a bare module-level `db` for admin tenant data. **Any query on a table with no `store_id` (e.g. `stores`, keyed by `id`) MUST filter on `storeId` explicitly** — the WHERE is the rule, RLS is only the net.
- 🔴 **Child-table rule** (five shipped cross-tenant bugs came from it). Before any INSERT/UPDATE/DELETE on a table with NO `store_id` (`verify-rls` prints the current list — `order_line_items`, `product_media`, `menu_items`, `collection_products`, `purchase_order_items`, `flash_sale_items`, …), every id the row is keyed on — the parent AND every FK in its values — must have been read back from an RLS-protected table inside the same `withTenant` txn, and the action must bail if that read returns nothing. The parent write silently no-ops under RLS for a foreign id while the child write lands anyway; `verify-rls` structurally cannot catch it.
- **RBAC.** Every mutating server action starts with `await requireCapability("<cap>")` (`lib/rbac.ts`) — the security boundary; the role→capability matrix is `lib/rbac-policy.ts`; gate UI with `useCan`/`<Can>`; a new capability must be classified in `rbac-census.test.ts`.
- **Reads/writes pattern.** Reads: `lib/data/<entity>.ts` returning a flat shape inside `withCurrentTenant`, pages `force-dynamic`. Writes: `lib/actions/<entity>.ts` (`"use server"`) → `requireCapability` → `withTenant` → `revalidatePath`; UI wires `useRouter` + `useTransition` + toast. **Delete = archive** (`status='archived'`) when history references the row.
- **Buying never requires an account**: `customers.registered_at IS NULL` = Tamu, the NORMAL case. Abandoned-cart recovery travels on WhatsApp ("WA dibuka", never "terkirim"); the rescue metric is `abandoned_at IS NOT NULL AND recovered_at IS NOT NULL`, and `aktif` sessions are excluded from both sides of every rate.
- Media is local (`apps/admin/public/uploads`, gitignored, 2 MB image cap, `lib/image-store.ts` `MAX_BYTES`) until MinIO/S3 on the VPS.

**Full rules + incident history → `specs/docs/rules/database-rls.md`** — read it before writing any DB read/write, a migration-adjacent change, or touching a pool/RLS policy.

## Super Admin — the control plane reaches every tenant

- 🔴 **The operator's RANK comes from `platform_admins` on every request — never from the cookie** (`resolvePlatformSession`, pure and tested). A dead-but-valid cookie redirects to `/api/auth/signout`, never straight to `/login` (redirect loop). Operators can change their own password; resetting someone else's does not exist.
- **`platformGate(min)` is the FIRST statement of every mutating action**; ranks `support` 1 < `admin` 2 < `owner` 3 live in the pure `platform-rank.ts` (unknown role = 0, fail closed). **`platformRouteGate(path)` is the FIRST await of every `(platform)` page**; floors are in `lib/route-roles.ts`, an unlisted route is `owner`, and a new `page.tsx` fails the suite until classified. Route gates are additive, never instead of action gates. The floor is the LOWEST rank that can use the screen.
- Handing over a merchant's account is **OWNER-rank** whichever button reaches it; look targets up through `store_users` for THIS store.
- 🔴 **Impersonation is a one-time exchange, not a token.** Opaque 256-bit handle, only `sha256` stored (`impersonation_grants`), redeemed by ONE `update … where consumed_at is null and expires_at > now() returning` — never a read-then-write. Nothing reusable may ever go in a URL. Membership, role and operator row are re-read at consume time; the merchant session is bounded (30 min, cookie `maxAge` and JWT `exp` from the same constant); every gated write under impersonation names BOTH parties in `platform_activity` and fails closed. `middleware.ts` exempts `/impersonate` by EXACT match — the exit route (`/impersonate/exit`) must NOT be exempt, because it reads the session it is about to end.
- **Never mint a fixed password.** One mint, `@tokophi/lib/password` (60 bits), revealed once. Never REPORT a credential you did not WRITE (`outcome: created|linked…`, `password: string | null`); `store_users.accepted_at` is stamped by sign-in only (provisioning stamps the store's own owner, deliberately).
- **No shipped screen may name an account that authenticates** (no `Dev:` lines, no email `defaultValue`). Login rate limit is a floor (IP + per-account failure streak, rows in `rate_limit_counters`), not a wall.
- Never anchor a date to the seed; `createStore` lets `created_at` default to `now()`.

**Full rules + incident history → `specs/docs/rules/super-admin.md`** — read it before touching super-admin actions, platform auth/rank, impersonation, or operator/merchant credentials.

## Billing & super-admin control (single plan)

- **One plan "TokoΦ"** (3-day trial → Rp50rb first month → Rp275rb/mo, annual Rp2.7jt); no tiers. Prices are DPP (ex-tax); PPN 11% is the GLOBAL toggle `platform_finance.subscription_ppn_enabled` (default OFF). Every invoice creator charges via `subscriptionCharge(base, ppnEnabled)` and stores BOTH `amount_idr` + `tax_idr`. Money map: `specs/docs/FINANCE.md`.
- Segments `trial → first_month → regular → vip`; **VIP = `stores.comped`**, a BILLING bypass, not an abuse shield.
- 🔴 **An operator suspension is a separate fact** (`stores.suspended_at`, 0086). `computeBilling` returns `status` (effective), **`billingStatus` (what the MONEY reads)** and `operatorSuspended`; never derive "did WE suspend this?" from the badge. `StoreBillingRow.suspendedAt` is required on purpose. A suspension REQUIRES a reason (≥5 chars); lifting restores billing state only. Audit lines report the OUTCOME re-read via `.returning()`.
- 🔵 **Marking an invoice paid by hand is bookkeeping and does NOT move `current_period_end`** (owner ruling 2026-08-20). The only writers are `api/public/pay/callback`, `compStore`, `extendTrial`. Entitlement moves on payment events.
- 🔴 **A payout completes by compare-and-swap** (`payout-transition.ts`: `diproses → selesai`, one statement decides and writes); nothing is posted to the ledger on completion.
- Payment channels are a PLATFORM decision (ADR 0004); `platform_payment_gateways.enabled` is a record, not a switch; provider brands (KiriminAja/AutoLaris) stay hidden from clients. `pct()` is a DELTA formatter — use `share()` for part-of-whole.
- Every super-admin per-store action is audit-logged to `platform_activity`. Client "Akun" lives at `/akun/{profil,keamanan,langganan}`; printable `/faktur/[number]`.

**Full rules + incident history → `specs/docs/rules/billing.md`** — read it before touching billing, suspension, invoices, payouts, payment channels or the Akun screens.

## Shipping & COD (read before touching checkout)

- **Ongkir is priced FROM the seller's pickup address** (`store_settings.sender_kecamatan_id`, a KiriminAja district id); never let the client choose the origin (`body.originCity` is ignored). **`apps/admin/lib/shipping-quote.ts` is the ONE place a shipping price is produced**; `/api/public/order` RE-QUOTES, `body.shipping.cost` is not read, and a picked service absent from the fresh quote is rejected. Item prices come from `product_variants`, never the cart.
- ⚠️ `KIRIMINAJA_ENV` unset = **sandbox**, and sandbox bookings look identical to production ones — a wrong setting is invisible.
- **COD is a CHAIN of three agreements** — `platform_cod.enabled` (cap Rp2.000.000, 6 allow-listed provinces) ∧ `platform_couriers.services[].codAllowed` (SPX only) ∧ `store_settings.cod_enabled` (default false). **`apps/admin/lib/cod.ts` is the ONE place that answers**; `/api/public/order` is the boundary; never `if (courier === "spx")`. The rate's `cod` flag is the effective one.
- The merchant's selection is per SERVICE (`store_shipping_methods`); `/api/public/ongkir` = platform-enabled couriers ∩ picked services.
- 🔴 **Quote and booking must describe the same box**: weight + dimensions (from `products`, max per axis) in the quote and the cache key. Never hard-code a volumetric divisor.
- **Seller flow**: Proses → Atur pengiriman (`bulkGenerateResi`, the service the shopper paid for; the single-order "Cek Ongkir" screen deliberately lets the seller pick any service with a ledger-reconciled debit) → **Resi terbit is AUTOMATIC** (`cron-tracking` sidecar fills `orders.awb`; booking returns `awb: null`, never store the booking ref as a waybill) → Cetak label. Pickup is tomorrow 10:00 WIB.
- 🔴 **Cancel takes the AWB, and only the AWB**; a booking with no waybill is refused before the call. `province` is a POST with `{}`.

**Full rules + incident history → `specs/docs/rules/shipping-cod.md`** — read it before touching checkout, ongkir, COD, a shipment, cancel, or the courier integration.

## Promo, voucher & flash sale (read before touching a discount)

- 🏷️ **`nonaktif` means OFF; the DATES are the schedule.** Every reader filters `status <> 'nonaktif'` plus the `starts_at`/`ends_at` window — storefront pricing, admin pricing AND the seller's Flash Sale `isLive`/`isUpcoming` (server clock, same `now` as the price).
- Never anchor a WRITE to a fixed date. A blank period = `ends_at NULL` (`endsInDays` is `number | null`, and `null` ≠ `0`). An edit keeps the row's `starts_at`. `nonaktif` is surfaced, never derived away.
- The usage limit is enforced in the UPDATE's own WHERE inside the order txn (`… where used_count < usage_limit`), never by the pre-check alone.
- A flash sale must reach the VARIANT rows (`Math.min(v.price, flash.price)` in `data/catalog.ts`).
- Not implemented: per-customer limits, product/collection eligibility, stacking; `min_purchase_idr` is enforced server-side but has no editor field.
- **Codes are unique PER STORE** (`UNIQUE (store_id, code)` since 0084) — and `applyDiscount`'s `store_id` filter is now the ONLY thing stopping cross-store redemption; never simplify it away (`per-store-codes.test.ts`).

**Full rules + incident history → `specs/docs/rules/promo-vouchers.md`** — read it before touching a discount, voucher, flash sale or a code-uniqueness constraint.

## ⚠️ THE SEED IS NOT A MIGRATION — changing it does NOT change an existing store

`npx tsx src/seed.ts` runs on every deploy, but it does **not** overwrite data a store already has.
So a change to `packages/db/src/seed.ts` reaches **new** stores only. Production keeps whatever the
seed wrote the first time.

This cost a live regression on 2026-07-30. The seed's nav item was relabelled to "Promo" → `/promo`
and the storefront's now-duplicate promo shortcut was deleted in the same change. On the dev DB both
halves agreed. On **production** the menu row was older — "Promo Gajian" → `/kategori/promo-gajian` —
so the deploy removed the only link to `/promo` that production had, and the hub went unreachable
from the shop. Fixed with a one-row `UPDATE` against the prod DB.

**Before shipping a seed change, ask: does an existing store need this too?** If yes, it needs a
migration or an explicit data fix — and the fix must be stated in the commit body, because nothing
else will apply it. Check the difference first:

```bash
ssh -i ~/.ssh/tokophi_dev root@45.77.33.112 \
  'docker exec -i $(docker ps --format "{{.Names}}" | grep -m1 "^postgres-") psql -U tokophi -d tokophi' <<'SQL'
select mi.label, mi.target from menu_items mi
  join menus m on m.id = mi.menu_id join stores s on s.id = m.store_id
 where s.slug = 'batiknusantara';
SQL
```

⚠️ Resolve the postgres container by PREFIX, never by its full name — the hash suffix changes on
every deploy, and a hardcoded one fails with "No such container" the moment anything ships.

## Storefront performance — what is on the critical path, and what must never go back on it

- 🧪 **Run the suite: `npm run verify -w @tokophi/storefront`** (builds, starts ONE server, runs every `check-*.mjs`; PASS/FAIL/SKIP; kills only its own process group — never `pkill`). One invocation contract: `CHECK_BASE_URL` + `DATABASE_URL` (retired `T_URL`/`H1_PORT`/`DPR` fail loudly). A new `check-*.mjs` must be registered (`checks-registered.test.ts`). `fetch` cannot send a `Host` header — use `getAsTenant()`.
- 🔴 **Marketing pixels are the dominant cost and are DEFERRED to first interaction** (10 s backstop, deliberately no `requestIdleCallback`); every stub/queue/`init` stays synchronous. Never "simplify" a stub back into the vendor snippet. Accepted cost: a visit that never interacts is not a PageView (attribution is built server-side from the order row).
- Inter is self-hosted. Static images have REAL width variants read off disk (`static-image-widths.ts` via `gen-image-widths.mjs`); never hand-assert a `w` descriptor; `sizes` is derived from the component's own layout and named as a constant. A `data-srcset` must be promoted onto the IMG. Markup built in JS strings (search palette) is invisible to static checks — its srcset is built server-side.
- Astro middleware cannot set headers on `public/` assets; the `robots-txt` audit score 0, `unused-javascript` and `legacy-javascript` are not ours to fix (Cloudflare managed robots, `fbevents.js`); Cloudflare Email Obfuscation is a zone setting (`CLOUDFLARE-PERF.md`). **Do NOT switch off Cloudflare Managed robots.txt to chase that score** (it deletes an AI-training opt-out asserted under EU Directive 2019/790), and **do NOT change the build target or undo the pixel deferral to tidy those two audits** (Astro already builds `esnext`; nothing of ours is transpiled). DOM size is dominated by icons — look at repeated icon markup first.

**Full rules + incident history → `specs/docs/rules/storefront-perf.md`** — read it before changing images, fonts, pixels, scripts or layouts on the storefront, or when a Lighthouse number moves.

## Dashboard & Analitik numbers — one source, one day, no rollup

- 📊 **`analytics_daily` is RETIRED** (unread, unwritten). Money on a screen is derived from `orders`, live; `getDailyStats()` (`lib/data/analytics.ts`) is the ONE producer, revenue = `sum(total_idr - tax_idr)` over non-cancelled orders. The series must stay DENSE and end on TODAY (`generate_series` LEFT JOIN).
- **`lib/data/day-bucket.ts` `dayKey()` is the ONE definition of a day, and it is WIB**; every day-bucketed query goes through it or the sets stop reconciling.
- A figure with no source is "—", never a number — and so is a delta with no previous period: `Kpi.delta` / `MoneyTile.delta` are `number | null`, `null` only when `prev === 0` (a real Rp0 after sales is −100%); `null >= 0` is `true` in JS, so `up` must be `boolean | null`.
- No good/bad verdict by colour alone (glyph + word, plus a neutral state). Check: `apps/admin/lib/data/daily-stats.test.ts`, `kpi-delta.test.ts`.

**Full rules + incident history → `specs/docs/rules/dashboard-analytics.md`** — read it before touching a dashboard/analytics number, KPI or delta.

## Order lifecycle — COD, the ledger, and the one legal set of transitions

- 📦 **COD is a FACT ABOUT THE ORDER (`payments.method`), never a parameter**: `createShipment` derives it and refuses a caller that disagrees.
- **`orders.status` has ONE writer, `applyOrderStatusChange`** (same-status no-op; `batal`/`retur` terminal; an explicit `ALLOWED` table — `selesai → retur` stays legal on purpose, `selesai → batal`/`dikirim` do not). `setOrderStatus` takes status from the client, so hiding a button is not the boundary.
- `creditSaleForPayment` excludes `batal` AND `retur`. A double-credit is a DB impossibility (three partial unique indexes + `on conflict do nothing`); the balance is DERIVED (`Σ amount_idr` by status) — never a stored column. **Nothing that sums the balance may join `orders`** (a `payout` entry's `order_id` is NULL by design).
- `npm run verify-ledger -w @tokophi/db` is safe against production but NOT read-only (its probe opens a write txn that always rolls back).
- A guess must never succeed quietly (return the district actually MATCHED); report what you WROTE (`.returning()`), never what you were asked to write; a terminal order never grows a live bill; ONE definition of "the order's payment" (`paid_at desc nulls last, id desc`); a provider-quota `"use server"` action needs a capability, not a session; converting a throwing action to `{ ok, error }` is a TWO-file change.
- `isUuid` (`lib/uuid.ts`) before any `eq(table.id, segment)`; escape LIKE input (`@tokophi/lib/like`); validate every URL param that reaches an enum cast.

**Full rules + incident history → `specs/docs/rules/order-ledger.md`** — read it before touching order status, payments, the ledger, a payout, or a `"use server"` action's error shape.

## Landing HTML (`/lp/<slug>`) — raw markup, OWNER-ONLY

- ⚠️ **`set:html` EXECUTES** — a `<script>` in the pasted HTML runs on the shop's origin, on the page carrying the COD form; there is no sanitizer and no CSP. Changing that HTML needs **`landing:html` (owner only)**, enforced only when the html differs from the stored row. **Do NOT "fix" it with a regex sanitizer.**
- `admin` is derived by SUBTRACTION, so a new owner-only capability must be excluded explicitly; `rbac-census.test.ts` pins the whole class (editing it is how you record a change of mind).

**Full rules + incident history → `specs/docs/rules/store-builder-landing.md`** — read it before touching landing pages or adding a capability.

## Store Builder / Tema — three page types, three different jobs

- `page_templates.type` is `homepage` (whole page) · `category` (the BODY under the category's own header) · `product` (the PDP tail only). **`CategoryHero` is ALWAYS rendered** — a template never replaces it. `product-listing` ("Daftar Produk") is the catalogue; `product-grid` is a capped merchandising row.
- The palette is per type (`SECTIONS_BY_TEMPLATE_TYPE`, `puckConfigFor(type)`): **narrow the PALETTE, never the RENDERER** — saved templates keep rendering. The renderer's `default:` arm (`const _exhaustive: never = item`) is a guard; `astro check` (wired into `npm test`) and `section-renderer-exhaustive.test.ts` catch different things. An unknown runtime type → `console.warn` on the server + a visible panel in DEV only.

**Full rules + incident history → `specs/docs/rules/store-builder-landing.md`** — read it before touching templates, sections or the renderer.

## Checkout input — normalise generously, reject narrowly (`@tokophi/lib/validate`)

**The API is the boundary, the form is UX** — `/api/public/order` re-normalises and re-validates; **over-validation is itself a bug** (a rule that refuses a real customer costs a sale nobody ever sees).
- Phone = canonical `62xxx` (`normalizePhone`), validate structure not carrier — **never hard-code operator prefixes**. Email = shape only, optional, no domain whitelist. Nama = letters incl. diacritics + `space . ' -`. Alamat = letters AND digits, only junk refused. Kecamatan is picked from a list (`areaById`); Kota/Provinsi are DERIVED from it.
- 🔴 **Kode pos is REQUIRED and shopper-supplied** (5 digits, auto-filled where honest, ALWAYS editable, never "must exist in our snapshot"). `readOnly` silently cancels `required`; **`setKodepos()` is the ONE writer** (it clears custom validity); `loadKelurahan()` drops a stale response.
- ⚠️ **`<form novalidate>` on `checkout.astro` is load-bearing** — it is what makes every message Indonesian. `labelMissing()` stamps a sentence on every `valueMissing` control (map `MISSING`, keyed by `name` — add yours); `setCustomValidity` stays invalid until cleared.
- **Never call `reportValidity()` on blur** (it steals focus; shipped bug) — use `showFieldError()`. Test on an `en-US` browser and drive fields like a human (`.click()` + `keyboard.type()`).

**Full rules + incident history → `specs/docs/rules/checkout-validation.md`** — read it before touching `checkout.astro`, `@tokophi/lib/validate` or any checkout field.

## The public API (`apps/admin/app/api/public/**`) — four routes, no session, no Host

`ongkir` · `order` · `promo` · `pay/callback` — the only unauthenticated write surface.
- 🔵 **`storeSlug` IN THE BODY IS THE TENANT SELECTOR HERE, AND IT IS CORRECT** — these routes are served by `app.tokophi.com` while the shopper is on `<slug>.tokophi.com`, so the Host carries no tenant. Do NOT "fix" it to the Host header. The voucher error copy being a code-probing oracle is deliberate.
- Read bodies through **`readPublicBody()`** (`lib/public-guard.ts`), never `req.json()`; `items[]` is capped (`MAX_CART_ITEMS` 100) on the RAW array.
- 🔴 **A provider's own error text never reaches a shopper** (ADR 0004) — substitute `SHIPPING_QUOTE_UNAVAILABLE` / `PAY_START_FAILED` and `console.error` the original; seller-facing actions keep the provider's words.
- There is deliberately **NO bot gate** on these four (they decide money; an empty User-Agent must not refuse an order). Rate limit + caps are the floor; the wall is Cloudflare.
- 🔴 **No reusable first-party secret in a URL.** `CRON_SECRET` is header-only (`lib/cron-auth.ts`, a `?secret=` request is refused AND logged). The pay callback URL carries a signed `?cb=<reff>.<hmac>` bound to the row it resolves. **Do NOT refuse the callback's `?token=` door** until the vendor confirms a header — that 401s every genuine payment. Exactly one identity (`trx_id` then `reff_id`), zero is a 400.
- Guard: `apps/admin/lib/public-guard.test.ts`.

**Full rules + incident history → `specs/docs/rules/public-api.md`** — read it before touching any `api/public/**` route, a cron route, or the pay callback.

## Structure (apps/admin/)
- `app/(admin)/` — route group. `page.tsx` = Dashboard (`/`). Sections: pesanan, produk, pelanggan, diskon, analitik, halaman(+baru), blog(+baru), navigasi, pengaturan.
- `components/admin/` — shell (sidebar, topbar, nav-links, brand) + shared bits (page-header, order-status, kpi-card, *-chart, …) + per-screen subfolders.
- `components/ui/` — shadcn/ui primitives (**on Base UI**).
- `lib/types/domain.ts` — the admin's domain VIEW types (`Product`, `Order`, … carry `minutesAgo`/joined names, not row shapes); the unions that equal a DB enum are DERIVED from `@tokophi/db` via a type-only import. `lib/mock/store.ts` was deleted 2026-09-09 (Task 6.7): all 51 importers had been `import type` for months, and `apps/admin/lib/no-runtime-mock.test.ts` fails on any VALUE import from a `mock/` path.
- `lib/data/` — thin data layer over the mock (`getSummary/getSeries/...`). **Swap these bodies for API later; keep signatures.**
- `lib/format.ts` — `IDR()`, `num()`, `pct()`, `timeAgo()` (id-ID). `lib/nav.ts` — grouped `NAV_GROUPS`.

## ⚠️ shadcn/ui here runs on **Base UI (`@base-ui/react`), NOT Radix** — the #1 source of mistakes:
- **Triggers use the `render` prop, NOT `asChild`:** `<DropdownMenuTrigger render={<Button>…</Button>} />` (same for Sheet/Dialog/Tooltip).
- **Do NOT use the `Select` component** (Base UI API differs) — use `DropdownMenu`, `Tabs`, or buttons for pickers/filters.
- **`Button` rendered AS a Link/anchor needs `nativeButton={false}`:** `<Button nativeButton={false} render={<Link href=… />}>` — otherwise Base UI logs a console.error ("expected a native <button>") shown as "1 Issue" in the dev overlay.
- `DropdownMenuItem` supports `onClick`; can also be `render={<Link/>}`.
- Base UI event props: `onValueChange` (Tabs/Select), `onCheckedChange` (Switch/Checkbox).
- **Base UI `Menu.GroupLabel` needs a `<Menu.Group>` parent** or it throws "MenuGroupContext is missing" when the menu opens. `DropdownMenuLabel` was patched to a plain `<div>` (works standalone) — keep it that way. The sidebar nav (`nav-links.tsx`) has **expandable submenus** (Produk/Pelanggan) via `NavItem.children` in `lib/nav.ts`.

## Conventions
- **Determinism:** never use `Date.now()`/`Math.random()` in render paths for data — all mock data is seeded + anchored to `TODAY` so SSR===client (no hydration mismatch). Client-only jitter (e.g. live ticker) must start from the SSR value inside `useEffect`.
- Add `"use client"` to any screen with state/handlers. Use `next/link` for navigation.
- **Money is always IDR** via `IDR()`; numbers via `num()`; tabular figures use `tabular-nums`.
- Reuse `PageHeader`, `OrderStatusBadge`, chart components, and the `lib/data` selectors — don't re-fetch/re-derive ad hoc.
- **Product images:** products have `p.image` (`/products/<slug>.webp`, AI-generated fashion photos in `public/products/`) + `p.emoji`. Render via `<ProductThumb src={p.image} emoji={p.emoji} alt={p.name} className="<size>" />` (image + emoji fallback) — don't hardcode emoji tiles. Demo niche is women's fashion.
- **Toasts:** use `import { toast } from "sonner"` for save/delete feedback (`toast.success(...)`). `<Toaster>` is mounted in `app/(admin)/layout.tsx`.
- **Storefront slugs are Indonesian:** `/produk/`, `/kategori/`, `/blog/`, `/halaman/` (not `/products//collections/…`).
- Design: modern SaaS, `text-muted-foreground` for secondary text, indigo `--primary` accent, rounded-xl, soft shadows, responsive, AA. Keep it **console-clean**.
- After changes: `npm run build` must pass, and the dev-overlay must show **0 issues** (check the browser console).
- ⚠️ **`next build` does NOT run ESLint.** `npm run lint -w @tokophi/admin` is a separate gate that
  nothing runs — no CI, no build step, no doc asked for it — so it rotted quietly to **28 errors** by
  2026-07-31. Most were React Compiler rules that matter: a component defined inside another component
  remounts its whole subtree on every parent render (state lost, inputs losing focus mid-typing), and
  `Date.now()` in a CLIENT render path is the SSR-vs-client hydration mismatch this file forbids two
  bullets up. Run it before you open a PR; the open ones are itemised in `specs/docs/BACKLOG.md`.
- **⚠️ Money and checkout paths must be EXERCISED, not typechecked.** `astro check` passes clean on bugs inside a client `<script>`: a `ReferenceError: queueSave is not defined` in `checkout.astro` blocked the **entire rate load** — no rates → no COD → **no order at all** — with typecheck, lint and build all green. Only a browser caught it. Same family as `select sum(…) for update` in `requestPayout()`, which Postgres rejects outright (every withdrawal threw) and which `tsc` could not see inside the SQL string. Drive the flow: real browser, 0 console errors, and reconcile what is on screen against SQL.

## Adding a screen
1. Create `app/(admin)/<route>/page.tsx` (client if interactive).
2. Add the read to `lib/data/<entity>.ts` (inside `withCurrentTenant`) and its view type to `lib/types/domain.ts`.
3. Register it in `lib/nav.ts` (`NAV_GROUPS`).
4. Build + verify console clean + screenshot (Playwright renders charts correctly; `chrome --headless --virtual-time-budget` mis-sizes Recharts).

## Conversion tracking, attribution & catalog feeds (read before touching a pixel or a feed)

- **`packages/lib/src/tracking-ids.ts` is the ONE definition of a catalog id.** The feeds' `<g:id>`, the
  storefront pixel's `content_ids` and the CAPI payload all call `retailerId()` with
  `stores.catalog_id_scheme` as a **parameter, never an `if` at a call site**. Both halves must flip in
  the same instant for a store: a mismatch does not degrade matching, it **zeroes** it (ADR 0013 §5).
- **A conversion is built from the ORDER ROW, never from the request that created it**
  (`lib/tracking-events.ts` → `purchaseFacts`). A success page is not proof that a sale happened.
- **Browser and server Purchase share `event_id = purchase:{order_number}`.** Change either half's event
  NAME or id and every sale counts twice — Meta de-duplicates on `event_id`, TikTok on
  `(event_source_id, event, event_id)`.
- **`value` = GOODS ONLY on all three platforms** (owner ruling 2026-08-24: "real value barang yang dibeli" — no ongkir, no admin fee). GA4 additionally carries `shipping` and `tax` as their own parameters. Compute goods the same way on both sides (subtotal − discount) or one purchase reports two revenues; `purchaseFacts.value` (the all-in total) is kept as the audit figure but is no longer any platform's `value`.
- **`fbclid` is NOT proof of an ad.** Meta appends it to every outbound link it serves, organic included;
  only `gclid` and `ttclid` are paid-only. `orders.channel` therefore reads `utm_medium` first and books
  a bare `_fbc` as `other`. `_fbp`/`_ttp` are attribution for NOTHING — they are set on any visit.
- **Prepaid ≠ converted.** `/checkout/sukses` displays an UNPAID VA/QR. COD converts there; prepaid is
  enqueued HELD and released by the payment callback. The SERVER decides per order, via
  `tracking.browserPurchase` — never the page.
- **Every layout a shopper can convert under must render `MarketingPixels`.** `CheckoutLayout` was missed
  once and `LandingLayout` twice; the second time the entire paid-traffic funnel recorded nothing while
  build, lint and `astro check` stayed green.
- Say **"dari pesanan toko Anda"**, never "menurut Meta": this is our own last-click model and will not
  match Ads Manager.

## Docs — they live in `specs/`, in this repo

| Doc | Read it when |
|---|---|
| **`specs/docs/rules/README.md`** | **you are about to touch an area whose section above ends in a `→ specs/docs/rules/…` pointer** — that is where the full rules and the incident history moved when this file hit Claude Code's 150k-char limit. Add new incident detail THERE and keep only the one-line rule here |
| `specs/docs/FLOWS.md` | end-to-end flows. **§5 shipping · §8 ad click → order → conversion.** Read before touching checkout, ongkir, a shipment or a pixel |
| **`specs/docs/SECURITY.md`** | **trust boundaries, identity/RBAC, tenant isolation, transport, secrets, encryption at rest, every rate limit with its real value — and the gaps we knowingly live with.** Read before touching auth, RLS, the public API or a zone setting. It owns the standing SHAPE; `AUDIT-SUMMARY.md` owns findings |
| **`specs/docs/SLA-DRP.md`** | **availability & disaster recovery — SLI/SLO/SLA, RTO/RPO, single points of failure, the recovery runbook, the exercise plan.** ⚠️ Read §3 before trusting the backups: retention was **5 h 44 min** where "daily, keep-7" implied seven days (every deploy restarted the container, and `keep-7` counted FILES). Fixed in #171 — but the window **rebuilds over 14 days**, it is not 14 days today. Offsite copy to R2 is **live since 2026-10-10** and a restore from it was proven (Task 8.4) |
| **`specs/docs/PAGE_MAP.md`** | **you need to find a SCREEN or ROUTE** — every URL of all four surfaces → its file, the `lib/data`/`lib/actions` modules it imports, its gate, the tests that name it. **Generated** (`node scripts/gen-page-map.mjs`); `test/page-map-fresh.test.ts` goes red when a page is added without regenerating. Findings from the sweep that built it: `specs/docs/tasks/2026-09-04-page-map-report.md` |
| `specs/docs/CODE_MAP.md` | you need to find where a concern lives |
| `specs/docs/STATUS.md` | **before you trust a number on a screen** — 🟢 real / 🟡 seeded / 🔴 fake |
| `specs/docs/SCHEMA.md` | the DB, annotated from the catalog |
| **`specs/docs/FINANCE.md`** | **the one map of money** — subscription PPN toggle, order fee schedule + bases, seller entitlement, ledger credit. Read before touching any fee, tax, or billing number |
| **`specs/docs/tasks/NEXT.md`** | **what to pick up next — ordered, sized, with acceptance criteria** |
| **`specs/docs/tasks/OPEN.md`** | **you are starting a session, or on a new machine** — the re-verified short list of open work, the setup, and the traps. `NEXT.md` is the long record and **goes stale** (a 2026-08-05 sweep found 11 entries marked open that had already shipped); this is the index into it. ⚠️ It also carries the disambiguation table for **N36–N43, which each appear TWICE** — quote task titles, never bare numbers. |
| `specs/docs/BACKLOG.md` | what is actually open |
| `specs/docs/DEPLOY.md` | ops, env, the cron sidecars, how to verify a deploy really landed |
| `specs/PRD.md` · `specs/decisions/` | what the product is · **0012 conversion tracking · 0013 catalog ids**. ⚠️ **There is no ADR 0010** — a courier-policy ADR was held for that number and never written, on purpose (the curation it would have recorded was reversed; the live KiriminAja API is the roster). Courier policy = `packages/lib/src/couriers.ts` + "Shipping & COD" above; the reversal is `specs/docs/BACKLOG.md` → "RESOLVED 2026-07-21" |

Changelog: `CHANGELOG.md`. `apps/admin/AGENTS.md` = the "Next 16 has breaking changes" note.

⚠️ **Do NOT reach the docs through `~/Documents/Development/tokophi`** — that symlink points at
`<repo>/specs` in the MAIN checkout, on branch `main`. Editing through it writes into someone else's
working tree, and your commit will not contain it.

**If a doc disagrees with the code, the code wins — and the doc is a bug. Fix it.**
