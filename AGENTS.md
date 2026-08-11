# TokoΦ — working agreement (read before coding)

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
- **Migration numbers.** Two branches open at once BOTH write `0064_*`, because each one only looked
  at its own journal. On 2026-07-22 that happened: `feat/cetak-resi-demo` landed `0064`–`0069` while
  this branch was open with its own `0064`, and the folder drizzle orders by ended up with two.
  **`git fetch && cat origin/main:packages/db/drizzle/meta/_journal.json | tail` BEFORE you generate
  one**, and **`npm run verify-migrations -w @tokophi/db`** after — it fails on a duplicate index, on
  a `when` that does not increase, and on a journal entry with no `.sql` file (or the reverse).
  Resolving the journal conflict: take **main's file whole** and append your one entry. Never
  hand-merge the list — it rewrites entries that belong to someone else.
  ⚠️ **WRITE EVERY MIGRATION IDEMPOTENT** — `add column if not exists`, `create index if not exists`,
  and `do $$ begin create type … exception when duplicate_object then null; end $$` for enums. Drizzle
  applies the whole pending batch in **ONE transaction**: a single "already exists" rolls back every
  migration behind it, and prints nothing you would notice. On 2026-07-30 that left **16 migrations
  unapplied** on the shared dev DB — `0062` aborted on a column that had arrived earlier via `push`, so
  `0063`–`0083` never ran, for everyone. Mixing `push` and `migrate` on one database is how the
  divergence starts; idempotency is what makes it survivable.
  - 🔴 **AND A STAMP THAT IS TOO HIGH SKIPS SOMEBODY ELSE'S MIGRATION, SILENTLY.** Drizzle applies only
    entries whose `when` exceeds the newest stamp already recorded in the target database — so the
    danger is not just a duplicate `idx`, it is a stamp that JUMPS. Live example, 2026-08-05: the
    shared dev DB's newest applied stamp was **1785774399036**, which came from `ka/flow-audit` — an
    **unmerged** branch, whose migration is ALSO numbered `0087` and therefore collides with main's
    `0087_password_revokes_sessions` (stamped 1785774**06**812888, i.e. lower). Wave 7's `0088` had to be
    stamped **above** the dev DB's newest (1785774400000) or the column would never arrive locally and
    `getPlatformSession` would throw → **every operator locked out of the control plane**.
    ⚠️ **The cost is paid by whoever merges SECOND.** Once wave 7 is on production, production's newest
    stamp is 1785774400000, so a later merge carrying 1785774399036 is **skipped while printing
    "migrations applied successfully"**. `verify-migrations` catches the duplicate `0087` **index**, so
    the collision cannot ship unnoticed — but renumbering to `0089` is only half the fix. **RE-STAMP as
    well as renumber**, and confirm with `select max(created_at) from drizzle.__drizzle_migrations` on
    the target, not by reading the journal.
    ⚠️ **A migration applied to the shared dev DB from an unmerged branch is the root cause here.**
    It makes every other open branch choose between "works locally" and "works on production". Prefer
    not to `migrate` a branch's own migration into the shared container until it is close to merging.

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

Shopify-style commerce SaaS for Indonesia. **No Themes menu, no Apps/Plugins.** **Backend live on local PostgreSQL** (Docker :5433, Drizzle): all 3 surfaces READ + all 12 admin editors WRITE the DB, plus local auth (login/session) + local media upload (see Database below). Bahasa Indonesia UI, IDR. **Prod target = self-hosted Postgres + PostgREST on a VPS (NOT Supabase), deferred.** Full spec: `specs/PRD.md` (in this repo).

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
**LIVE on `tokophi.com`** (2026-07-13): `tokophi.com`/`www` = landing · `app.` = admin · `rich.` = super-admin · `toko.` = demo store · **`<slug>.tokophi.com` = that merchant's storefront** (ONE storefront container serves every store — the tenant is resolved from the `Host` header, ADR 0009). ⚠️ Every `tokophi.com` DNS record must stay **Cloudflare-proxied**: the wildcard's TLS is a Cloudflare **Origin CA** cert (LE can't issue a wildcard over HTTP-01) which browsers do NOT trust directly. See `DEPLOY.md`.
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
- **admin still has its OWN local `components/ui` + `lib`** (untouched during the monorepo move). **TODO/BACKLOG:** migrate admin to consume `@tokophi/ui`/`@tokophi/lib` and delete the local copies (de-dup). Until then, edit shared components in `packages/ui`; admin-only tweaks stay in `apps/admin`.

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

### ⚠️ The money suites run by default now — keep it that way

`test/db-setup.ts` (vitest `globalSetup`) derives `<DATABASE_URL>_test`, **creates that database if it
is absent, migrates it to head** and exports `TEST_DATABASE_URL`. So `npm test` exercises the ledger
against real Postgres on any machine where `docker compose up -d db` is running.

This exists because the opposite was true and nobody noticed: the suites skipped unless a developer
exported `TEST_DATABASE_URL` by hand, so **22 tests over the ledger — the code that decides when a
sale becomes withdrawable — never ran**, in anyone's default run, with no CI to catch it. Same family
as the `verify-rls` incident below: a gate that does not run is not a gate.

- **The guard is load-bearing: the resolved name MUST end in `_test`, or setup throws.** These suites
  seed stores, orders and payments. They roll every transaction back, but pointing them at the shared
  dev database must remain impossible. Do not relax it.
- **An unreachable database still SKIPS**, so a laptop without Docker gets a green run — but it prints
  a banner naming the reason, instead of the old silent pass. `npm run test:db` turns that skip into a
  failure; use it before a PR.
- An explicit `TEST_DATABASE_URL` still wins over the derived one.

### ⚠️ A guard reads a file's CODE, never its TEXT — `test/source-code.ts`

Ten test files in this repo read source with `readFileSync`, and **all ten now go through
`test/source-code.ts`** (2026-08-03) — there is no hand-rolled comment stripper left. They read
source for an honest reason: when the bug IS the markup and the fix is the **absence** of markup, there is nothing to import and
call, and no type-checker has an opinion. What is never honest is matching the **characters**, because
a comment is text, and code inside a string is text:

```js
// case "lookbook": return <Lookbook />        ← a comment. Renders nothing.
const doc = `case "lookbook": return <Lookbook />`;  ← a string. Renders nothing.
case "lookbook": return <Lookbook />;         ← code.
```

**This defect has now been found NINE times, in nine different guards** (four in the wave that built
this module, five in the sweep after it) **— one of them introduced by the very commit that fixed it
elsewhere.** Each was patched by hand, differently, and every hand-rolled
"ignore the comments" had a different hole — a line-prefix filter that missed the checkout file
entirely, a `{/* */}`+`<!-- -->` stripper that did not know about `//`, a lexer walk that joined
`getTokenText()` and so re-injected every string's raw source, and a two-regex stripper whose `[^:]`
saved `https://` and nothing else while a `/*` inside an ordinary glob string ate the file down to the
next `*/`. So the rule is a shared module now — and **each one was proved blind against a mutated copy
of its own target BEFORE being converted, then proved red against the same mutation after**, because a
guard converted on faith can be green for the wrong reason (that mistake has been made and caught
here). Mutate a COPY and point the test at it; never edit product source another stream may own:

| use | for | it does |
|---|---|---|
| `codeOnly(src)` | **the default** — any claim about what a file executes | comments gone, every literal's contents inert |
| `textWithoutComments(src)` | only a claim about MARKUP the file can emit | comments gone, literals kept verbatim |

Both run the TypeScript **scanner** (a comment is trivia, so there is nothing to strip and nothing to
get wrong) and join tokens with single spaces — **so write assertions whitespace-tolerantly**
(`d\s*\.\s*variant`), or compare against `codeOnly("<the snippet>")`, which normalises both sides.
Not the AST: the files that need this are `.astro`, which is not a TypeScript program. `typescript`
is already a dependency, so this costs no install.

⚠️ **CHOOSE PER ASSERTION, NOT PER FILE**, and `textWithoutComments` is no longer `h1-floor`'s alone.
It is for any claim about text the file EMITS to something that then executes or renders it, and there
are three shapes here, not one: markup concatenated into a JS string and assigned to `innerHTML` (the
search palette's `<img>` exists that way and nothing else); a CREDENTIAL, which lives inside the string
literal being hunted, so `codeOnly` would inert the evidence and go permanently green
(`no-published-credentials.test.ts`); and **raw SQL inside a `sql` template**, which Postgres executes
exactly the way a browser renders markup — `codeOnly` turns `is_default desc` into `is_default·desc`,
so a pattern for a real copy could never match again (`inventory-location.test.ts` uses BOTH helpers,
one per assertion, and says why at each). Reach for `codeOnly` unless you can say why the string
contents count — then say it, in the file.
⚠️ **`<!-- … -->` is NOT a JavaScript comment and neither function removes it** — and that is correct,
because an `.astro` file's HTML comments are served to the browser (`no-published-credentials.test.ts`
depends on exactly that). Write section comments as `{/* … */}`. But note what the lexer does to one:
`<!-- admin@tokophi.id -->` comes back as `< ! -- admin @ tokophi . id -- >`, so a pattern that must
find a credential in one has to be **whitespace-tolerant**, while the same address inside a string
literal survives as a single token.

⚠️ **A DIRECTORY SKIPPED BY NAME IS THE SAME BLIND SPOT AS A HARDCODED FILE LIST** (found 2026-08-03).
Two repo sweeps skipped any directory called `public`. `apps/<app>/public` is images;
**`apps/admin/app/api/public` is the PUBLIC API** — four route files that neither
`inventory-location.test.ts` nor `no-published-credentials.test.ts` could see, ever. And the worst
instance of the class `inventory-location` hunts lived in exactly one of them: `order/route.ts` held
the sixth copy of the default-location expression, the one with no `store_id` predicate, on the one
path that runs as OWNER with RLS off. Both now skip `public` only at the app root. **Scan everything
and name your exceptions; never bind a guard to a list of targets.**

⚠️ **AND A `*` FOLLOWED BY `/` INSIDE A BLOCK COMMENT CLOSES IT — twice in one day, 2026-08-05.**
Once in `test/source-code.ts` (a comment explaining a comment-splice hole, written literally) and
once in `packages/db/src/seed.ts` (a JSDoc containing the glob `apps/*/app/**`). Both times the
comment ended early and the prose after it became code. The first failed **18 of 50 test files at
import** while the 296 tests that still collected all passed — a green-looking count over a broken
module; the second failed `tsc -p packages/db` with `Cannot find name 'app'`. This file's style is
long explanatory comments full of globs and code samples, so the trap is structural here, not a
slip. **`tsc` and `npm test` both catch it; nothing else does.** Describe the sequence in words, or
put the example in a `//` line comment.

**The sink beats the source.** `packages/lib/src/password.test.ts` scans every tracked source file for
`hashPassword(<arg>)` and fails on a literal, or on an identifier bound to a literal in the same file
— the two shapes that actually shipped (`createStore`, `invitePlatformAdmin`). A mint bound to a name
with no credential word in it (`genSecret`) is invisible to any name-based scanner but still has to
reach the sink. `packages/db/src/seed.ts` is the single named exemption (its fixed password is tracked
as N29); `apps/super-admin/lib/no-fixed-password.test.ts` keeps the stricter local claim — the argument
there must be exactly `pw`, and `pw` must come from the mint.

## Database (local Postgres — `@tokophi/db`)
Local backend fully wired behind the data layer (all 4 surfaces read + all editors write; auth+RBAC+RLS; real variants). Local dev uses **plain PostgreSQL 16 in Docker** + **Drizzle** (annotated in `specs/docs/SCHEMA.md`: **78 tables · 93 migrations `0000`–`0092`**, counted from `packages/db/src/schema.ts` and `drizzle/meta/_journal.json` on 2026-08-11, snake_case, money = bigint IDR). **MULTI-tenant** — the dev DB carries 7 stores and the whole `platformGate` control plane reaches every one of them. (ADR 0008 called it a single-tenant MVP; that stopped being true long ago and this line said otherwise for months.) Auth (local, JWT) + RBAC + RLS are done locally; Storage (self-hosted MinIO/S3) comes with the VPS. **RLS** (migration 0012, extended by 0032 `page_templates`, 0035 `support_*`, 0036 `media`+`payments`, **0058 `stores`**) is enabled on **51 of the 52 store-scoped tables** (measured 2026-08-07 by the verifier itself) AND **enforces at runtime**: the admin runs every read (`lib/data/*` via `withCurrentTenant`) + write (`lib/actions/*` via `withTenant`) inside a txn that sets `app.store_id` + `SET LOCAL ROLE tokophi_app`, so tenant queries execute as the non-owner role with policies applied. `npm run verify-rls -w @tokophi/db` derives the store-scoped set from the catalog (every table with a `store_id`) and FAILS if one lacks RLS — **51/52 as of 2026-08-07, and the ONE remaining exception is `platform_activity`** (the platform's own audit log: cross-tenant by design, written before a session exists). `media` + `payments` were retrofitted in 0036. ⚠️ **THIS PARAGRAPH HAS NOW BEEN WRONG TWICE, AND ONCE IT MOCKED ITS OWN STALE FIGURE WHILE THE STALE FIGURE SAT TEN LINES BELOW IT** (it said 45/46 while `SECURITY.md` already said 51/52, and the sentence saying "this doc claimed 36/39" shared a file with a live `36/39`). The count is DERIVED and moves with every migration: **run `npm run verify-rls -w @tokophi/db` and believe its output, not this sentence.** ⚠️ **`stores` is NOT in that count and never could be**: it is keyed by `id`, has no `store_id`, so the catalog query cannot see it — that blind spot leaked two merchants' data across tenants until `0058` put an `id`-based policy on it. Auth (`lib/auth.ts`, pre-session `store_users` read), super-admin (cross-tenant), and the storefront (`Host`-resolved read-only catalog) stay on the owner connection. On the VPS this becomes PostgREST connecting as `tokophi_app` with the JWT `store_id` claim feeding the GUC. **RBAC** (app-layer, `lib/rbac.ts`) is enforced too.
```bash
docker compose up -d db              # PostgreSQL 16 @ localhost:5433 (persisted volume)
npm run migrate -w @tokophi/db     # apply versioned migrations (canonical)
npm run seed    -w @tokophi/db     # (re)load demo data — idempotent (truncates first)
npm run studio  -w @tokophi/db     # Drizzle Studio
npm run generate -w @tokophi/db    # after editing src/schema.ts → new migration; `push` = quick dev sync
```
- Package: `packages/db` → `import { db, schema } from "@tokophi/db"` (server-only; `postgres` is `serverExternalPackages`). `npm run reset` drops `public` + `drizzle` schemas.
- `DATABASE_URL` lives in root `.env` (tooling) + each app's `.env.local` (Next). Copy from `.env.example`.
- **Wired to DB** (read via server-only `lib/data/*`, pages `dynamic="force-dynamic"`): **super-admin** (all 5) + **admin** (Produk, Diskon, Pelanggan, Kategori, Pesanan, Halaman, Blog, Inventori, CRM, Pembelian, Segmen, Ulasan, Navigasi, Dashboard, Analitik, Pemasaran — 16 modules) + **storefront** (catalog via `@tokophi/db` at build/SSR). **Reads: done end-to-end.** - **Auth (local, real):** email/password login against `users` (`password_hash` = scrypt `salt:hash`, seeded owner **ongki@batiknusantara.id**, password minted at random per seed run and printed once — N29) ⋈ `store_users` (role). Session = **jose JWT in an httpOnly `session` cookie** (`AUTH_SECRET` env). `lib/auth.ts` (verify/findLogin/signSession/getSession — server-only, Node), `lib/actions/auth.ts` (`signIn`/`signOut`), `app/login/page.tsx`, `middleware.ts` (edge-safe JWT check → redirects to `/login`; excludes `/products`). Topbar shows the session user + "Keluar". Aligns with the VPS/PostgREST **JWT** prod plan. **RBAC** (`lib/rbac.ts` `requireCapability`, role→capability matrix) gates every mutating server action; **RLS** (migration 0012, `withTenant()` + `verify-rls`) isolates the store-scoped tables by `store_id` (the count lives in the verifier's output — see above) (enforced under the `tokophi_app` role on the VPS).

**Writes: DONE across all admin editors** — Produk, Diskon, Halaman, Blog, Kategori, order-status, Inventori-stock, Navigasi, Pelanggan, CRM (follow-up), Segmen, Pembelian (PO create/receive/cancel) all persist via `lib/actions/*` server actions.
- **Media (local):** the product editor's Media section uploads real files → `apps/admin/public/uploads/` (gitignored) + a `product_media` row (`lib/actions/media.ts` `uploadProductImage`/`deleteProductImage`; 5MB image cap). `getProduct` returns the real `media[]`; the seed loads 5 media rows/product (base + `-2..-5`). Local storage now; on the VPS this becomes MinIO/S3.
- **Pelanggan & keranjang ditinggal (0044/0045):** buying **never requires an account** — `customers.registered_at IS NULL` = **Tamu (guest), the NORMAL case, not a defect**. A registration wall in front of an Indonesian checkout is the surest way to lose the sale; don't add one. Abandonment is the **absence** of an order, so there is no event to listen for: the storefront writes `checkout_sessions` **as the shopper types** (debounced beacons → `apps/storefront/src/pages/api/checkout-session.ts`; tenant from the Host header, never from the body; bot + rate gated; **fails quiet** — a broken capture must never break a working checkout), and an opportunistic sweep flips `aktif`→`ditinggal` after 60 min of silence, stamping `abandoned_at` = *the moment it went quiet*, not "now". Recovery travels on **WhatsApp, not email** — `phone` is the field this table is paid for; the admin records **"WA dibuka", never "terkirim"** (wa.me cannot tell us whether it was delivered — do not display what you cannot observe). Recovery links are signed, store-bound, 7-day jose tokens (`apps/storefront/src/lib/recovery.ts`), **never a raw session id** (that would be a bearer credential over a stranger's name/phone/address the moment the link is forwarded).
  - ⚠️ **The metric trap — read this before touching these numbers.** A straight-through checkout ALSO ends as `status='pulih'`. So the naive `pulih / (pulih + ditinggal)` renders **19,3%** where the truth is **11,2%**: it counts every ordinary sale as a rescue. That is the entire reason `abandoned_at` exists. Always `rescued = abandoned_at IS NOT NULL AND recovered_at IS NOT NULL`. And `aktif` sessions are excluded from **both** sides of every rate — the shopper is still typing; nobody has abandoned anything yet.
- **Tenant/RLS pattern (IMPORTANT for any new DB code):** admin reads wrap their body in `withCurrentTenant(async (db, storeId) => {...})` (`lib/tenant.ts` — reads the session, sets the GUC, drops to `tokophi_app`); admin writes wrap in `withTenant(session.storeId, async (db) => {...})` (session from `requireCapability`). The callback param is named `db` so query bodies read naturally; module-level query helpers take `(db: Tx)`. Do NOT use a bare module-level `db` for admin tenant data — it would run as owner and bypass RLS. Auth/super-admin/storefront are the deliberate exceptions (owner).
  - ⚠️ **`withCurrentTenant` hands you `storeId` as a 2nd arg now (2026-07-17). Use it — do not trust RLS blindly.** Callbacks that ignore it still work, so this is additive. **RLS only scopes tables that HAVE a `store_id` column. `stores` is keyed by `id`** — it had no RLS at all until `0058`, and `verify-rls` derives its coverage *from `store_id` columns*, so it structurally could not see the one table that identifies the tenant. Two shipped functions did `.from(stores).limit(1)` inside this very wrapper and got an **arbitrary store**: a merchant read a stranger's shop name, WhatsApp and subscription countdown — and because the paired write *was* correctly scoped, pressing "Simpan Perubahan" without editing anything would have renamed their own shop to the leaked one. **Any query against a table with no `store_id` MUST filter on `storeId` explicitly.** `0058` now polices `stores` too, but the WHERE is the rule and the policy is only the net.
  - 🔴 **THE CHILD-TABLE RULE (2026-07-20 — this class has now produced FIVE shipped cross-tenant bugs).**
    **Before any INSERT/UPDATE/DELETE on a table with no `store_id`, every id the row is keyed on — the
    parent id AND every FK in its values — must have been read back from an RLS-protected table inside
    the same `withTenant` txn, and the action must bail if that read returns nothing.** A join to an
    RLS'd table counts **only if a comment says it is the tenant boundary** — otherwise the next
    "simplification" removes it. The 12 store-scoped tables with no `store_id` and no RLS, on which
    `tokophi_app` holds full DML: `collection_conditions`, `collection_products`, `customer_addresses`,
    `discount_usages`, `fulfillments`, `inventory_levels`, `menu_items`, `order_line_items`,
    `product_media`, `product_options`, `purchase_order_items`, `flash_sale_items`.
    ⚠️ **This list said ELEVEN and omitted `flash_sale_items` (0076) for as long as that table has
    existed.** `verify-rls` has always counted it — it prints `12 un-RLS'd child tables, all reviewed`
    — so the RUNNABLE check and the PROSE rule disagreed, and the prose is the half people read before
    writing a child-table write. Do not hand-maintain this list against the verifier: run it.
    Why this keeps happening: the parent write **silently no-ops** under RLS for a foreign id while the
    child write lands anyway — **no error, either way**. And `verify-rls` **structurally cannot catch
    it**: it derives coverage *from `store_id` columns*, so a table without one is invisible to it.
    `e61df25` fixed the three call sites it happened to find; auditing the *class* then found four more
    (`media.ts` `product_media`, `deleteDiscount`, `createPurchaseOrder`, `syncChildren`) — all shipped,
    all fixed 2026-07-20. **Patch the class, not the instance.**
  - **`npm run verify-rls -w @tokophi/db` is GREEN (11/11) as of 2026-07-17 — keep it that way, and run it after touching data code.** It had been failing for weeks: its own fixture used the same `stores LIMIT 1` bug, picked an empty store and compared its rows against global totals. Nobody read it, so **both leaks above shipped past a verifier that was already red**. An alarm that is always on is an alarm that is off. **Nothing runs it automatically** (tracked in BACKLOG) — if it goes red now, it means something.
- **Reads pattern:** seed the entity in `packages/db/src/seed.ts` (parity with the mock's mulberry32) → add `lib/data/<entity>.ts` returning the *same flat shape*, body wrapped in `withCurrentTenant` → split the client page into a server wrapper + `*-client.tsx` (props) → point detail routes at `getX(id)`. Impedance columns added where the flat mock shape needs them (e.g. `products.emoji/units_sold`, `store_stats`, `invoices.number`).
- **RBAC pattern:** the role→capability matrix is `lib/rbac-policy.ts` (client-safe: `Role`/`Capability`/`ROLE_CAPS`/`can()`). **Server:** every mutating action calls `await requireCapability("<cap>")` (`lib/rbac.ts`) at the top — this is the security boundary (throws `ForbiddenError`) — and store-scoped creates take `store_id` from the returned session. **UI:** wrap controls the role can't use with `useCan("<cap>")`/`<Can capability="…">` (`components/admin/permissions.tsx`; role flows from the session via `PermissionsProvider` in the admin layout). **All admin editors are gated** (Produk, Diskon, Halaman, Blog, Kategori, Pelanggan, CRM, Segmen, Pembelian, Inventori, Navigasi, Pesanan, Pengaturan) — apply the same `useCan` gating to any NEW editor you add. Caps: `products:write`/`products:delete`, `discounts:write`, `content:write` (halaman/blog/kategori/navigasi), `orders:write`, `inventory:write`, `purchases:write`, `customers:write`, `crm:write`, `media:write`, `settings:write`.
- **Writes pattern (mutations):** `lib/actions/<entity>.ts` with `"use server"` → `const { storeId } = await requireCapability(...)` → `withTenant(storeId, async (db) => { …insert/update… })` → `revalidatePath(...)`; wire the editor's Simpan/Hapus with `useRouter` + `useTransition` (loading state + toast + `router.push`/`refresh`). **Delete = archive** (`status='archived'`) when the row is referenced by history (e.g. products ← `order_line_items`); else hard delete. Filter archived out of the read layer. **Done:** Produk (archive-delete), Diskon, Halaman, Blog, Kategori (hard delete), order-status advance, Inventori bulk stock save, **Navigasi** (menu save = delete+re-insert tree), **Pelanggan** (tags/notes — migration 0010 added `customers.tags`/`notes`), **CRM** (follow-up mark-done → `followups.status`), **Segmen** (create/delete), **Pembelian** (real line-item PO builder → `purchase_orders`+`po_items`; "Terima barang" adds each line's qty to `inventory_levels`; cancel = delete). **All admin editors now persist.**

## Super Admin — the control plane reaches every tenant

> ### 🔴 THE RULE: **the operator's RANK comes from `platform_admins`, on every request. Never from the cookie.**
> `getPlatformSession()` decoded the 7-day JWT and returned the claims verbatim — no DB read of any
> kind. Driven on 2026-08-03 against a live server, ONE cookie held constant while the row was mutated
> by SQL: an operator **demoted owner → support still minted a new platform operator**; so did one
> whose row had been **DELETED**; so did one whose **password had been rotated**. Four operator
> accounts created from one cookie that should have been dead after the first.
> The merchant side had re-read `store_users` since day one — that is why deleting a membership logs a
> merchant out. **The control plane, which reaches EVERY tenant, was the weaker of the two.**
> - The decision is `resolvePlatformSession` (`platform-session.ts`) — PURE, so it is tested; the same
>   split as `platform-rank.ts`, and for the same reason. Row gone ⇒ null. Password rotated after the
>   token was minted ⇒ null (`@tokophi/lib/session-revocation`, shared with the merchant side — ONE
>   implementation, because a copy is how the weaker half survives a fix). Role from the row.
> - **Cost:** one indexed PK lookup, once in the platform layout and once inside
>   `requirePlatformAdmin`. There is **no `react` `cache()` pattern in this repo** — the merchant's
>   `getSession()` is called far more often and is likewise uncached. Do not invent one for this.
> - ⚠️ **A dead-but-valid cookie makes the layout and the middleware redirect at each other**
>   (`ERR_TOO_MANY_REDIRECTS` — measured). Middleware runs on the edge and cannot ask the database, so
>   it sees a valid JWT and bounces `/login` back to `/`. The layout redirects to
>   **`/api/auth/signout`**, never straight to `/login`: a Server Component cannot delete a cookie and
>   a route handler can. `apps/admin` has the identical file for the identical reason.
> - **Operators can change their own password** — avatar menu → "Ubah kata sandi"
>   (`changePlatformPassword`). Gated on a SESSION, not a rank, deliberately: it acts on the caller's
>   own row, and a rank floor would stop a `support` operator rotating a leaked credential. The
>   current password is re-proved instead. Rotating revokes every other session (migration 0088) and
>   re-mints this tab's cookie with `iat` one second past the stamp.
>   **Resetting SOMEBODY ELSE's operator password still does not exist** — `NEXT.md` N47.

- **`platformGate(min)` is the first statement of every mutating action** (33 call sites over 32 exported
  actions), and the rank is
  `support` 1 < `admin` 2 < `owner` 3. The ladder lives in `platform-rank.ts` — a PURE module, no DB
  import — because `platform-auth.ts` pulls `@tokophi/db` at module scope, which is why the rule
  guarding every super-admin mutation had no test until 2026-07-31. An unknown role scores 0: fail
  closed, so a typo'd or legacy `platform_admins.role` cannot inherit rank.
- ⚠️ **Handing over a merchant's account is OWNER-rank, whichever button reaches it.**
  `resetOwnerPassword` was correctly gated; `resetStoreUserPassword` beside it ran at `admin` and
  looked its target up by `userId` ALONE — no `store_users` join, no `storeId` filter — so a rank-2
  operator could reset ANY user row on the platform, including any store's owner, and `storeId` was
  used for nothing but the log line, so the audit trail could be pointed at the wrong store. Both
  gates now: membership in THIS store, and `owner` rank when the target is an owner.
- **Never mint a fixed password.** Invited operators used to get `DEV_PASSWORD` (`tokophi123`), never
  revealed and never forced to change — an email plus a well-known default was a working control-plane
  login. Random per invite, revealed once.
  - 🔴 **`createStore` was still on it (fixed 2026-08-01), and it is the worse half.** The
    `invitePlatformAdmin` fix left a comment claiming the other paths were already correct; they were
    not. Every store an operator onboarded got an OWNER `users` row hashed from `tokophi123`, so the
    **merchant's** email address alone was a working login at `app.tokophi.com` — every order (buyer
    name, WhatsApp, delivery address), every customer, and `settings:write` over the bank account.
    **The mint now lives in `@tokophi/lib/password`** (pure, no DB — same split as `platform-rank.ts`)
    and `apps/super-admin/lib/no-fixed-password.test.ts` fails if any `hashPassword()` in `actions.ts`
    is fed anything but a freshly minted `pw`, or if a minting action stops returning it.
  - 🔴 **ONE mint, in `packages/lib`, and it is 60 bits** (2026-08-03). There were **two**, and they had
    already drifted: super-admin minted `randomBytes(3)` = **24 bits** (16,7 M candidates) while
    `apps/admin/lib/actions/users.ts` kept a private `randomBytes(4)` = 32. **The weaker one was the one
    on the store-owner path** — a copy is exactly how the weaker number survives a fix. It is now
    12 symbols over a 32-symbol alphabet (Crockford base32: no `i`/`l`/`o`/`u`, so nothing is misread
    off a support screen) = **60 bits**; the `tokophi-` prefix is worth **0 bits** and is only a label.
    `packages/lib/src/password.test.ts` measures the **min-entropy of what the generator actually
    emits** and fails under **48 bits**, so shortening it, narrowing the alphabet or biasing the
    mapping all go red. It **scans every source file in the repo** (not a list of two, which is how a
    24-bit copy survived this very test once), and it pins `hashPassword` at one implementation too.
  - 🔴 **NO SHIPPED SCREEN MAY NAME AN ACCOUNT THAT AUTHENTICATES** (2026-08-03). Both login pages
    published one: `rich.tokophi.com/login` printed `admin@tokophi.id / tokophi123` AND pre-filled that
    address into the email field; the Seller panel did the same with the seeded owner. The seed
    genuinely creates those rows on deploy, so neither was a placeholder — they were working
    credentials, on the public internet, on the page that accepts them.
    ⚠️ **It was FOUR sites, not the two `Dev:` lines.** The `defaultValue` on each email input is the
    half that gets missed, and on the control plane it is the one that matters: it names *which account
    to attack*, and the limiter above is keyed on **IP, not account**, with **no failed login written
    anywhere**. `packages/lib/src/no-published-credentials.test.ts` scans EVERY app source (not a list
    of two — that is how the 24-bit mint survived its own guard) and strips `//` + `/* */` comments so
    the notes explaining this fix stay legal. **HTML comments are not stripped: `<!-- … -->` in an
    `.astro` file is served to the browser.**
    ✅ **The SEED is fixed too (N29, 2026-08-05).** `packages/db/src/seed.ts` mints a fresh 60-bit
    password **per account** and prints them **once** at the end of the run — that print is the only
    copy that will ever exist. `SEED_OWNER_PASSWORD=<yours>` pins them all to one string for local
    dev (and refuses a published default like `tokophi123`, which would put the defect straight back).
    `password.test.ts` no longer exempts the seed: its repo-wide sink scan now covers every tracked
    file with nothing carved out, so a fixed password anywhere goes red.
    ⚠️ **The ROWS are still unchanged, and that is not an oversight** — **the seed is not a migration**,
    so every deployment that already exists still authenticates with `tokophi123` until somebody
    rotates it. That is a PROCEDURE, not a deploy:
    `specs/docs/tasks/2026-08-03-rotate-exposed-owners.md` §② (use the UI for stores, raw SQL only for
    the operator), §③ (one password per account) and §⑤ (which order, and which account **not** to
    touch). Measured there: 7 of 8 store owners plus the operator. **Rotate the accounts that were
    measured, never the table.**
  - **A login rate-limit DOES exist — but it is a floor, not a wall, and it is keyed on IP ALONE.**
    `signIn` on both panels calls `rateLimit()` from `@tokophi/lib/cache` **before** the scrypt check
    (`login:admin:<ip>` 15/min, `login:platform:<ip>` 10/min, shipped `53dd9ee` 2026-07-16). ⚠️ Two
    things it does NOT do, and code has been written here on the assumption that it does: the counter
    is an **in-process `Map`**, so it resets on every redeploy and would not span replicas; and it
    counts **IPs, not accounts**, so one specific merchant can be attacked at 15/min *per source
    address* with nothing anywhere recording that it is happening — **no failed login is written to any
    table or audit log.** That is why the mint's entropy is the load-bearing half of this pair.
  - **A password the UI drops on the floor is worse than the bug** — the merchant cannot log in and
    nobody can say why. Each minting action returns `password`; the callers show it ONCE
    (`toko-client.tsx` + `pengaturan-client.tsx`: a `duration: Infinity` toast that survives the
    `router.push`; `store-detail.tsx`: the credential dialog). Same two-file rule as thrown errors.
  - 🔴 **AND THE MIRROR OF IT: never REPORT a credential you did not WRITE** (fixed 2026-08-03).
    `addStoreUser` minted `pw` unconditionally, hashed it only inside `if (!u)` — the branch that
    creates a new `users` row — and returned it either way. So adding an email that **already**
    belonged to someone here produced a "here is their new password" dialog for a string that had
    never been hashed into any row. Measured: the revealed `tokophi-…` verified against the stored
    hash as **false**. The operator reads it out, it does not work, and nothing on any screen explains
    why — the string is well-formed and the operation reported success.
    ⚠️ **Do NOT "fix" that by rehashing.** Silently resetting an existing person's password because
    someone added them to a second store locks them out of the first, with no message either. The
    action now mints INSIDE the branch that writes the hash and returns
    `password: string | null` + `outcome: "created" | "linked"`; `store-detail.tsx` shows the dialog on
    one path and says *"Akunnya sudah ada, jadi kata sandinya TIDAK berubah"* on the other. `outcome`
    is its own field on purpose — "no password" and "no password was NEEDED" read identically at a
    call site and only one of them is good news. Pinned by `apps/super-admin/lib/add-store-user.test.ts`
    (both files; proved red against three separate mutations before being trusted).
- **Never anchor a date to the seed.** `health.ts` measured recency from a frozen `2026-07-02`, so a
  store 34 days dormant read "5 days, ok" and a live one read **−23 hari**. `data.ts` had already been
  migrated off that anchor; the healthcheck was missed. Same rule as the discount editor.
  - `createStore` did it in a **write** (fixed 2026-08-01): `created_at`/`accepted_at` = the anchor
    while `trialEndsAt` = `Date.now()`, so a store was born ~30 days old with a 3-day trial in one
    INSERT — and store health, "0 hari lalu" and the trial countdown all disagreed from birth. The
    columns default to `now()`; don't set them. Pinned by the same test.

## Billing & super-admin control (single plan)
- **One plan "TokoΦ"**, all features. `@tokophi/lib/billing`: 3-day trial → **Rp50rb** first month → **Rp275rb/mo** (annual Rp2.7jt). Prices are the **DPP (ex-tax)**; the merchant pays **base + PPN 11%** (`withPpn()`/`baseFromTotal()`) — invoices store the PPN-inclusive total, faktur itemizes DPP+PPN. **Do NOT reintroduce plan tiers** (Pemula/Bisnis/Skala are legacy, unused).
- **Store lifecycle segments** (`storeSegment()`): `trial → first_month → regular → vip`. **VIP = `stores.comped`** — super-admin bypasses billing (free, always active, never billed; admin `getBilling` + billing cron honor `comped`). Segments drive the super-admin Toko catalog (4 tabs). ⚠️ **VIP is a BILLING bypass, not an abuse shield** — an operator suspension outranks it (below).
- 🔴 **AN OPERATOR SUSPENSION IS A SEPARATE FACT FROM BILLING — `stores.suspended_at` (0086).** The Suspend button did nothing for months and said it had worked: `setStoreStatus` wrote `stores.status` + an audit row reading *"Toko ditangguhkan oleh platform"*, but the lockout is decided by `computeBilling()`, which read only `comped`/`currentPeriodEnd`/`trialEndsAt` and **never `stores.status`**. The suspended merchant kept a fully writable panel (measured: a real product save persisted), and the nightly billing cron rewrote the column back within 24 h. **There was no working way to suspend a store.**
  - The two must **coexist**, which is why one column could not carry both: a store suspended for **abuse** that then pays must stay suspended; a store suspended for **non-payment** must reactivate on payment with no operator involved. `computeBilling` now returns **`status`** (effective — billing with the operator override on top), **`billingStatus`** (the subscription alone) and **`operatorSuspended`**.
  - **`billingStatus` is what the MONEY reads.** The cron's renewal-invoice branch and `getRiskQueue`'s lifecycle reasons both use it — keying them on the effective status would bill a paid-up store a month early for a lock that has nothing to do with money, and park every deliberately-locked store at severity 100 on the operator's worklist forever.
  - **`StoreBillingRow.suspendedAt` is REQUIRED, not optional, on purpose**: a read path that forgets to `select` it silently unsuspends every store, and there is no runtime symptom. `tsc` is the guard — it found a 4th read site (`getRiskQueue`) that a manual grep had missed.
  - **Never derive "did WE suspend this?" from the status badge.** `store.status === "ditangguhkan"` is *also* what an unpaid store reads past its grace period; deriving the button from it is what made "Aktifkan" flip a column, refresh, and come back reading "Aktifkan" again. Use `operatorSuspended`.
  - **Lifting restores the BILLING state and nothing more.** A store that was also overdue stays read-only, and both the toast and the audit line say so rather than announcing a reactivation that did not happen. Granting time is what "Gratiskan 1 bulan" is for.
  - **The audit entry reports an OUTCOME.** `suspendStore`/`liftSuspension` re-read the row through `.returning()`, recompute the effective state, and log *that* + the operator's email; a store id matching nothing logs nothing. Same rule as `markLabelsPrinted` — report what you WROTE. `compStore`/`extendTrial`/`setStoreComped` no longer assert `status: "active"` either; `syncStoredStatus()` derives it.
  - Pinned by `packages/lib/src/billing.test.ts` → *"operator suspension survives computeBilling"*.
- **Super-admin per-store control** (`apps/super-admin/lib/actions.ts`): comp 1 month, extend trial, VIP toggle, reset owner/user password (scrypt), manage store users, `suspendStore`/`liftSuspension` — every action audit-logged to `platform_activity` (with `store_id` + `admin` kind). **A suspension REQUIRES a reason** (≥5 chars): the merchant is shown it, and one nobody wrote down cannot be reviewed, appealed or lifted with confidence. The store-list row menu therefore only offers *lift* inline — "Tangguhkan…" links to the detail, where the reason can actually be collected.
- **`pct()` is a DELTA formatter; `share()` is the one for a part of a whole** (`@tokophi/lib/format`). The super-admin "Status Toko" card fed `count/total*100` to `pct()`, so the control plane read *"Ditangguhkan 5 **+83,3%**"* — a plus sign implying suspensions were climbing when nothing had moved. Two comments in `format.ts` already told callers to "format locally"; two obeyed by hand (`return-summary.tsx`, `keranjang-client.tsx`) and the third borrowed the delta formatter. A rule re-obeyed by hand at every call site is how the third one happened. ⚠️ **That card's slices must SUM TO EVERY STORE** — VIP was missing from `getStatusDistribution`, so it totalled 6 while the KPI beside it read "Toko aktif 2 / 7" and every share was against the short denominator. It has its own key type (`StatusSlice`, with `vip`), not `StoreStatus`.
- **Client "Akun" section** `/akun/{profil,keamanan,langganan}` (NOT under Pengaturan) — tabbed layout; avatar menu links here. Langganan has payment history + printable **`/faktur/[number]`**. Sidebar shows a subscription badge under the logo.
- **Payment channels are a PLATFORM decision** (ADR 0004) — super-admin owns `platform_payment_channels`; the storefront checkout reads *those*. The client-admin **"Pembayaran" tab was REMOVED (2026-07-13)**: it let a merchant pick channels + a fee bearer, but **nothing ever read either value** — the storefront read the platform list and no pricing code touched the bearer, so the UI silently lied. ⚠️ **`store_settings.payment_channels` / `payment_fee_bearer` are dead columns** (kept, not dropped — dropping is a destructive migration and super-admin may want per-store overrides later). **A merchant-facing fee-bearer feature does NOT exist**: `@tokophi/lib/payment-fees` (VA Rp4.000, e-wallet 2,4%, QRIS 1%, retail Rp4.000) is only used for *display*. If it is ever wanted, it must be **built into checkout pricing** — not merely stored.
- **Provider brands stay hidden from clients** (KiriminAja/AutoLaris) — generic labels; only super-admin sees brands (ADR 0004).

## Shipping & COD (read before touching checkout)
- **Ongkir is priced FROM the seller's pickup address** (`store_settings.sender_kecamatan_id`, set in Pengaturan → Alamat). That column **is** a KiriminAja district id — the same currency as the shopper's `destinationId` — so there is nothing to resolve and nothing to guess. It used to be `resolveArea(body.originCity || "Yogyakarta")`: a **city name posted by the shopper's browser**, fuzzy-matched, with a hard-coded fallback. Two bugs in one line — the seller's real warehouse was ignored (a Surabaya merchant quoted Yogyakarta rates on every order), and **an untrusted client string decided a price**. `body.originCity` is now ignored. **Never let the client choose the origin.** If no pickup address is set we fall back to the store's *registered* city (still the shop's data, never the shopper's) and say so in the response (`originFrom: "store-city"`) — a quote built on a fuzzy match is a guess and must be visible as one.
- ⚠️ **Rates are REAL KiriminAja API calls, but `KIRIMINAJA_ENV` defaults to `sandbox`**
  (`tdev.kiriminaja.com`). **The API is the SAME on both** — owner's ruling, 2026-08-03: same contract,
  same response shapes, so the cutover is an endpoint swap and nothing else. Do not treat it as an
  integration risk, do not write a parity check, and do not budget for API differences at cutover.
  ⚠️ **And that is exactly why a wrong setting is INVISIBLE.** A sandbox booking returns a `kaOrderId`
  and `pickup_number` shaped identically to a production one (measured: `5758-E2E68072665` /
  `XID-5544692486`), so a deploy on the wrong endpoint reads as perfectly healthy — orders say
  "dibooking", resi appear on schedule, and no courier ever collects. `unset` resolves to **sandbox**,
  so the failure mode is the default. Surfacing the active env is `NEXT.md` N35.

- **COD is ON and it is a CHAIN of three agreements** — break any link and COD silently disappears: `platform_cod.enabled` (+ cap **Rp2.000.000**, **6** allow-listed provinces: DI Yogyakarta, Jawa Tengah, Jawa Barat, DKI Jakarta, Banten, Jawa Timur) ∧ `platform_couriers.services[].codAllowed` = **SPX only** (SPX Standard `type=1`, SPX Economy `type=3` — every other courier is `codAllowed=false` **even where KiriminAja reports `cod=true`**, because a refused parcel is *believed* to return free on SPX; ⚠️ **that belief is UNVERIFIED**) ∧ `store_settings.cod_enabled` (**default false**, migration 0038 — the merchant opts in at Pengaturan → Pengiriman → "Bayar di Tempat (COD)").
- **`apps/admin/lib/cod.ts` is the ONE place that answers "may this order be paid on delivery?"** (five conditions). `/api/public/order` **rejects** a COD order that fails any of them — hiding the option in the storefront is UX; **that endpoint is the boundary**. Never re-implement the check elsewhere, and never `if (courier === "spx")`: widening COD must stay a data change (`codAllowed`), not a deploy.
  - ⚠️ **A COD-enabled store whose current selection doesn't qualify now sees a REASON, not a blank** (`checkout.astro` `#cod-hint`, written by `syncCod`). This deliberately reverses the old "hide silently, no excuse" rule: the silent hide made "COD on but invisible" look like a bug to the merchant testing it. It is a one-line explanation of the single unmet condition (non-SPX courier / SPX doesn't serve the route / province off the allow-list / over the cap) — **not** a clickable greyed-out COD row (that would be a payment we'd reject, dressed as a choice). Still UX; the endpoint is still the boundary.
- **The merchant's shipping selection is PER SERVICE** (`store_shipping_methods`, written by `saveStoreServices`), not per courier — a courier-level list cannot express "I ship JNE Reguler but not JNE YES". `/api/public/ongkir` filters rates by **(platform-enabled couriers) ∩ (picked services)**, keyed `"<courier>:<service_type>"`; **no rows = the merchant never opened the card → fall back to `store_settings.couriers`** rather than render a checkout with zero shipping options. It filtered on the courier column until `35b88a4` and offered services the seller had switched OFF.
- The `cod` flag on a rate is the **effective** one (KiriminAja capability × platform `codAllowed` × the store's `cod_enabled`) — never the raw courier capability.
- 🔴 **THE QUOTE AND THE BOOKING MUST DESCRIBE THE SAME BOX** (fixed 2026-08-03, N30).
  KiriminAja applies **volumetric weight (w × l × h ÷ 6)** whenever it exceeds the actual weight.
  `createShipment` has ALWAYS sent `length/width/height` when it books (`packageRows` → max per axis);
  the QUOTE sent weight alone, so the two priced different parcels and the merchant absorbed the gap.
  Measured live, one 1.000 g order, 6138 → 2107, SPX Reguler: **weight only Rp13.700 · weight +
  40×30×20 cm Rp54.800 · weight 4.000 g Rp54.800** — the dimensional figure and the volumetric one
  agree to the rupiah. **Rp41.100 on one parcel, 4× the quoted price.**
  ⚠️ **The dimensions live on `products`, NOT on `product_variants`** (which carries only
  `weight_grams`). An earlier audit checked the variant, found nothing, and wrongly concluded the
  columns did not exist — they have been there all along. `weightForCart` **and** `weightForOrder` now
  read them and return the max per axis; `kaShippingPrice` forwards them; **they are part of the rate
  cache key**, because two carts differing only in box size must not share a quote. Guarded by
  `apps/admin/lib/shipping-dimensions.test.ts`.
  ⚠️ **The seed writes `1×1×1 cm` for every product** — 0,17 g volumetric, so it never binds on the
  quote, but it is *also* what the BOOKING declares to the courier. Filed as N33.

- **`province` is a POST with a `{}` body, not a GET** — a GET returns
  `"Method GET is not supported for this route"`, and the payload key is **`datas`**, not `data`.
  Endpoint versions genuinely differ per route (`v6.1` price/pickup · `v3` cancel · `v2`
  get_address_by_name · unversioned province/tracking); that is the docs' own scheme, not drift.
- **THE SELLER'S SHIPPING FLOW, end to end — four steps, and step 3 is AUTOMATIC:**

  | # | step | what happens | where |
  |---|---|---|---|
  | 1 | **Proses** | `baru → diproses` via `applyOrderStatusChange` (the only writer of `orders.status`) | order detail · `/pesanan` |
  | 2 | **Atur pengiriman** | `createShipment` / `bulkGenerateResi` books with **the service the SHOPPER paid for** (`orders.courier` + `service_type`) — there is deliberately NO rate picker here | order detail · `/pesanan/massal` |
  | 3 | **Resi terbit** | booking returns `awb: null` (`awbPending`); **`cron-tracking` fills `orders.awb` on its own, every 15 min**, batch 100, for orders with a `ka_order_id` in `diproses`/`dikirim` | `api/cron/tracking` |
  | 4 | **Cetak label** | `/api/admin/labels`, then `markLabelsPrinted` stamps `label_printed_at` — the "sudah/belum dicetak" filter | `/pesanan/massal` |

  ⚠️ **Step 3 is the one that gets described wrongly.** The waybill is issued when a courier ACCEPTS
  the pickup, not when we book — so `awb: null` is the normal post-booking state, not a failure. The
  poller is what makes it appear; **"Ambil resi" / "Lacak" are shortcuts for a merchant who does not
  want to wait, not the mechanism.** The UI used to say *"klik 'Ambil resi' lagi nanti"*, which
  described the automatic feature as manual and left sellers watching a queue.
  ⚠️ **A label cannot be printed before step 3.** `createShipment` writes `awb` ONLY from
  `details[0].awb` — never the booking ref — so an unprinted label is never a fake resi.
  ⚠️ **`cron-tracking` is a SEPARATE sidecar** (`sleep 900`) from the daily `cron` loop, and its own
  compose comment records that `awbFilled` sat at 0 for a week when it was not running. If resi stop
  appearing on their own, check that container before touching code.
- 🔴 **CANCEL TAKES THE AWB, AND ONLY THE AWB** (fixed 2026-08-03, N34). The vendor doc says it in as
  many words — *"awb: AWB Number Already Obtained, **Not Order ID**"*. `cancelShipment` built
  `o.awb ?? o.kaOrderId`, and **every fresh booking has `awb: null`** (that is what `awbPending`
  means), so the fallback fired on exactly the parcel a merchant had just created and KiriminAja
  answered **"Paket tidak ditemukan"** — the shipment stayed live at the courier while the merchant
  read an error that sounds like it never existed. That window — booked by mistake, seconds ago — is
  precisely when someone cancels. A booking with no waybill is now refused BEFORE the call, naming the
  next step ("Klik 'Lacak'…") rather than quoting the vendor.
  ⚠️ **Cancellation is only possible before the courier collects, and a non-COD void is QUEUED up to
  48 h** — `status: true` means "accepted for cancellation", not "cancelled".
- **A booking returns `awb: null`; the waybill lands later.** Verified live 2026-08-03:
  `request_pickup` → `{ok:true, kaOrderId:"5758-…", pickupNumber:"XID-…"}` with no AWB, and
  `tracking` answering *"Tracking tidak tersedia"* until one exists. `cron/tracking` is what fills it
  (`awbFilled`), and it must never store the booking ref as the waybill — `createShipment` writes
  `awb` **only** from `details[0].awb` for that reason.
  ⚠️ **The pickup schedule is TOMORROW 10:00 WIB, computed in `Asia/Jakarta`, and that is deliberate**
  — couriers enforce a daily cut-off. A test that books `now + 1h` is correctly refused with
  *"Jadwal penjemputan tidak lagi tersedia"*; the script is wrong, not the code.
- **`apps/admin/lib/shipping-quote.ts` is the ONE place a shipping PRICE is produced.** `/api/public/ongkir` quotes the checkout and **`/api/public/order` RE-QUOTES the order before it writes `orders.shipping_idr`** — same function, same origin, same DB weight, same platform∩store service scope. `body.shipping.cost` is **not read** (the storefront no longer sends it): the order stores the price *we* computed for the service the shopper picked (matched on `courier`+`service_type`), and a picked service that is **not in the fresh quote is REJECTED**, never silently re-couriered. Do NOT "validate the client's number against ours" — a tolerance is just a smaller hole. ⚠️ Consequence: a KiriminAja outage now fails the order. Deliberate — a parcel we cannot price is a parcel we cannot ship.
- **Item prices come from `product_variants`, not from the cart.** `items[].price` used to be summed into `orders.subtotal_idr` + the line items, so `price: 0` bought the goods for nothing. The client says WHAT is in the cart (handle + variant + qty); the server says what it costs, what it weighs, and where it ships from.

## Promo, voucher & flash sale (read before touching a discount)

> ### 🏷️ THE RULE: **`nonaktif` means OFF. The DATES are the schedule.**
> Every reader filters `status <> 'nonaktif'` **plus** the `starts_at`/`ends_at` window — never
> `status = 'aktif'`. That means all THREE: the storefront's pricing read, the admin's pricing read,
> **and the seller's Flash Sale list badge** (`lib/data/flash.ts` `isLive`), which was missed on the
> first pass and so labelled a live sale "Berakhir" while the till was already discounting it. Requiring `aktif` is what made a `terjadwal` flash sale **never go live**
> (the editor saved `terjadwal`, both readers demanded `aktif`, and **nothing ever promoted the
> row**), and what let a `terjadwal` voucher be redeemable at checkout while invisible on `/promo`
> and labelled "Terjadwal" in the seller list — **three definitions of "usable" for one row**.

- **Never anchor a WRITE to a fixed date.** `lib/actions/discounts.ts` held
  `ADMIN_TODAY = 2026-06-30` (the seed's frame) and computed `starts_at`/`ends_at` from it, so on
  2026-07-29 **every voucher a merchant created was born already expired** — and because
  `endsInDays` seeds the editor's period field, opening a voucher and pressing Simpan wrote the lie
  back and moved its expiry **backwards**. The gap widened by a day, every day. The seed may be
  anchored; the app is not. Same rule for `lib/data/discounts.ts`, which derives the display status.
- **A blank period means NO end date** (`ends_at: NULL`), which is what the editor has always
  promised ("Kosongkan untuk diskon tanpa batas waktu") and what `applyDiscount` already handles.
  `Math.max(1, period)` turned that promise into a voucher that died the next day.
  ⚠️ **`endsInDays` is `number | null`, and `null` is NOT `0`.** Zero means "ends today"; collapsing
  the two made a never-expiring voucher render as "Berakhir hari ini" — and, because that value seeds
  the editor's period field, pressing Simpan on an ALREADY-EXPIRED voucher wrote `ends_at: NULL` and
  **resurrected it permanently**.
- **`nonaktif` is SURFACED, never derived away.** The display status used to be computed from the
  dates alone, so a switched-off voucher read as "kadaluarsa" and the editor wrote `aktif` back over
  it on the next save. The DB's own OFF switch wins over any date arithmetic.
- **An edit changes the discount, not its schedule.** `updateDiscount` keeps the row's existing
  `starts_at`. It used to mint a fresh anchor on every save, which walked `ends_at` one day earlier
  per Simpan and rescheduled a promo set for next month to two days from now — with no field on
  screen saying so, because the editor has no start-date input.
- **The usage limit is enforced in the UPDATE's own WHERE, inside the order txn** — never by the
  pre-check alone. `applyDiscount` reads `used_count` **outside any transaction, unlocked**, so it
  is advisory: N concurrent orders on the last slot all pass it. The conditional
  `UPDATE … WHERE used_count < usage_limit` is the lock; 0 rows updated ⇒ `VoucherExhausted` ⇒ the
  whole order rolls back with a 409 the shopper can act on. (A comment here claimed this was already
  race-safe for weeks while the increment was a bare `used_count + 1`.)
- **The badge's clock must be the PRICE's clock.** `isLive` was moved to the server and then the very
  next line computed "Terjadwal" from `Date.now()` **in the browser** — the merchant's own laptop
  clock deciding a label about a price this server sets. `isUpcoming` is now derived in
  `lib/data/flash.ts` on the same `now` as `isLive`, so the two cannot contradict each other.
- **A flash sale must reach the VARIANT rows, not just the headline price.** `data/catalog.ts`
  applies `Math.min(v.price, flash.price)` per variant, because the PDP's picker rewrites the price
  from `variants[]` on load — so a flash product WITH options rendered the **pre-sale** price next
  to its own "-43%" badge while `/api/public/order` charged the sale price.
- **Not implemented, do not pretend otherwise:** per-customer usage limit (no column —
  `discount_usages` has no `customer_id`, so it is not even derivable), product/collection
  eligibility, and voucher stacking. `min_purchase_idr` **is** enforced server-side but has no
  field in the editor.

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

Measured with Lighthouse against production, 2026-07-31. Numbers, not intuition.

> ### 🧪 RUN THEM AS A SUITE: **`npm run verify -w @tokophi/storefront`** (from the repo root)
> Builds if the build is stale, starts ONE storefront, runs **all six** `check-*.mjs` in
> `apps/storefront/scripts/` against it, prints a pass/fail table and exits non-zero if anything is
> red. It kills **only the process group it spawned** — never `pkill`, so another agent's server on
> another port is untouched — and a port that is already taken fails in one second with the port
> number in the message instead of hanging.
> - **There is ONE invocation contract now** (`scripts/check-env.mjs`): `CHECK_BASE_URL` (an origin —
>   the hostname selects the tenant, ADR 0009) and `DATABASE_URL` from the environment. The old
>   `T_URL` / `H1_PORT` / `DPR` are **retired and fail loudly** rather than being ignored. They had
>   two different meanings of `T_URL` and four default ports between them, and on 2026-08-02 a reviewer
>   started one server, pointed three checks at it and reported **three regressions that did not
>   exist**. A check that is hard to run correctly gets run wrongly — same family as `verify-rls`.
>   ⚠️ **This sentence was FALSE for `check-search-srcset` until 2026-08-03**, and false in the way
>   that matters: the loud failure lives in `check-env.mjs`, so a script that never imports it cannot
>   fail loudly. That check shipped in the same wave that converged the others, was left out of the
>   runner's `CHECKS` array, and kept its own `T_URL`/`DPR` on a sixth default port (4411) — so
>   `npm run verify` ran five of six and the search-palette fix had a guard nobody ran. Both halves are
>   now pinned by **`apps/storefront/scripts/checks-registered.test.ts`**, which derives the expected
>   list from the DIRECTORY: a new `check-*.mjs` that is not in `CHECKS`, or a server-needing check
>   that does not import `check-env.mjs`, or any check reading a retired variable, fails `npm test`.
>   *(`audit-responsive.mjs` and `gen-image-widths.mjs` are deliberately outside the suite and are not
>   `check-*`: the first sweeps a **dev** server for horizontal overflow at many widths via
>   `npm run audit:responsive`, the second is a build-time generator.)*
> - **Three results, not two: PASS / FAIL / SKIP.** SKIP (exit code 2) means the check does not APPLY
>   to the data it was pointed at. It is printed with its reason on every run and never counted as a
>   pass — see `check-pixel-defer` below.
> - ⚠️ **`fetch` CANNOT send a `Host` header** — undici derives it from the URL and silently drops
>   yours, so `fetch("http://127.0.0.1:4390/", {headers:{host:"toko-demo.test"}})` is answered by the
>   404 page. Use `getAsTenant()` (node:http). `check-pixel-defer` had been asserting "no vendor
>   `<script src>` in the served HTML" against that 404 for its whole life — the loudest claim in the
>   file was vacuous. Found and fixed 2026-08-03.

- 🔴 **MARKETING PIXELS ARE THE DOMINANT COST, AND THEY ARE DEFERRED.** Turning Meta + Google + TikTok
  on took mobile from **90 → 66** and Total Blocking Time from **130 ms → 770 ms**. The downloads were
  never the problem — all three were already `async`. The cost is PARSE + EXECUTE of three third-party
  bundles on the main thread while the browser is trying to paint.
  `MarketingPixels.astro` injects the vendor `<script>`s only on **FIRST INTERACTION**, with a 10 s
  backstop and deliberately **no `requestIdleCallback`** (owner decision 2026-08-01: with `rIC` the
  browser went idle at ~2 s and all three bundles still executed inside Lighthouse's TBT window —
  mobile stuck at 75, TBT 690 ms, 600 ms of it third-party). Every stub, queue and `init` stays
  SYNCHRONOUS.
  ⚠️ **THE COST WAS ACCEPTED KNOWINGLY:** a visitor who lands and leaves inside 10 s without touching
  the page is never counted as a PageView by Meta/Google/TikTok. Revenue attribution is NOT affected —
  a conversion is built from the ORDER ROW on the server (ADR 0012) and a shopper who buys has by
  definition interacted — and `/api/track` still fires on every page view. Revisit with a measurement,
  not an opinion. That is what makes it lossless:
  `fbq.queue`, `dataLayer` and `ttq`'s method array are the vendors' own documented buffers, so a call
  made before the SDK arrives is replayed in order. **Do not "simplify" a stub back into its vendor
  snippet** — the stock snippet injects the script as its last line, which silently undoes this.
  Guarded by `apps/storefront/scripts/check-pixel-defer.mjs` (a BROWSER check: build, lint and
  `astro check` all stay green while events are being dropped).
  ⚠️ **It asserts the channels THIS TENANT enabled, read from `store_tracking_channels` — never a
  hard-coded three.** It used to demand `hosts.length === 3` while the seeded store has exactly one
  channel (`batik-nusantara | meta`), so it was red on clean `main`, for every change set, forever —
  and this repo has already paid for that once: `verify-rls` sat red for weeks, everyone learned to
  scroll past it, and two cross-tenant leaks shipped past a verifier that was already failing. The
  claim that was always meant — *every channel the merchant switched on is stubbed synchronously,
  buffers, and loads on interaction, and nothing loads for a channel that is off* — is true on the
  seeded data and stays true on a tenant with all three. A tenant with none is SKIP, not PASS.
- **Inter is SELF-HOSTED** (`public/fonts/`, `@font-face` in `styles/global.css`). The Google Fonts
  `<link>` was render-blocking for **1.409 ms** in three layouts, in front of an LCP that was **82%
  render delay** — the LCP element is an `<h1>`, i.e. text waiting on a font on a third-party origin.
  latin + latin-ext only, one variable file per subset covering 100–900.
- **Static images have REAL width variants**, generated by `scripts/gen-image-widths.mjs` and emitted
  by `imageSrcSet` (`data/catalog.ts`). `?w=` only works for `/api/uploads/*` (the admin serves those);
  for `public/` it is a meaningless query on the same bytes, which is worse than no srcset.
  ⚠️ **EVERY `w` DESCRIPTOR IS READ OFF THE FILE, NEVER ASSERTED BY HAND.** The generator writes
  `src/data/static-image-widths.ts` — each source's real intrinsic width plus the renditions that
  actually exist beside it — and `staticSrcSet` reads only that. It replaced two hand-kept constants
  that were both wrong, and a descriptor is the one field in a candidate the browser cannot verify:
  `/products/` was labelled `800w` while **14 of its 70 sources are 600 × 600** (over-claim 33%, on the
  FIRST image of every product), and `/sections/` was labelled `1920w` for a **1200 px** file
  (over-claim 60%) and a **2000 px** one (under-claim); only `/hero/` was honest. The per-file ladder
  also makes the old "`STATIC_WIDTHS` and `PLAN` must stay identical" rule structural — a rung with no
  file on disk is a 404 the browser may pick as its best candidate, and now the ladder *is* the list of
  files that were generated. An image missing from the manifest gets **no** srcset, which is the safe
  failure: no claim beats a wrong one. Guarded by `scripts/check-image-widths.mjs`, which reads the
  real dimensions off disk with sharp (no browser, no server — it cannot flake).
- ⚠️ **A `data-srcset` must be promoted onto the IMG, not only onto its `<source>`.** The hero
  carousel wakes slides 2..n by assigning `src`; if the img's own srcset is not set FIRST, the browser
  has already committed to the single `src` URL — the full-size original. Invisible to every static
  check (markup right, build green, bytes wrong); only `currentSrc` in a browser shows it. Guarded by
  `scripts/check-hero-srcset.mjs`.
- **`sizes` is derived from the component's OWN layout and named as a constant.** The browser trusts
  `sizes` completely when choosing a candidate, so a wrong one is worse than no srcset at all.
  ⚠️ **A `max-w-*` is only a `sizes` if you can name the viewport at which it starts binding.** On the
  PDP thumbnail rail it caps a `flex-1 basis-0` share, so declaring the cap over-claimed by 1,7× and
  cost a whole rung (17 468 B). In the mobile drawer the same class on a `w-full` element pinned to the
  viewport binds exactly, so `(min-width: 416px) 186px` is arithmetic, not a guess. `Header.astro`
  carries all three of its derivations as constants with the arithmetic written out.
- ⚠️ **MARKUP BUILT IN A JS STRING IS INVISIBLE TO BOTH KINDS OF CHECK.** The search palette's rows
  are concatenated into `innerHTML` (`SearchPalette.astro`), so its thumbnail `<img>` exists in no
  `.astro` template, in no built HTML file, and on no page nobody has pressed ⌘K on — the static
  sweeps and `check-pdp-srcset.mjs` alike walk right past it. It was the LAST bare `<img>` after
  `#133`: six full-size originals, **91 178 B**, for six **42 × 56 px** boxes (7,14× oversize at
  DPR 2). Fixed at **9 956 B** (−89%), and for a MERCHANT UPLOAD the same row now asks for `?w=200`
  instead of a ≤2000px original — the case that is far larger in production than on the seeded demo.
  ⚠️ **The srcset is built on the SERVER (`api/search.ts` returns `srcset` per row), not in the
  browser.** `imageSrcSet` reads `STATIC_IMAGE_WIDTHS`, a 5,2 KB generated manifest of all 75 static
  sources; shipping that to every visitor of every page to serve six rows behind an interaction would
  be a regression wearing a fix's clothes. The JSON grew **938 → 1 700 B** (**+448 → +762 B**, 352 →
  448 B gzipped) — **+762 B of JSON to save 81 222 B of images, ~107:1** — and there is ONE
  implementation of "which renditions exist". `sizes="42px"` is arithmetic, not a cap: the box is
  `w-[2.625rem]` and `shrink-0`, so it is 42 px at every viewport with no breakpoint to name.
  Guarded by `scripts/check-search-srcset.mjs`, which OPENS the palette (⌘K), waits for `/api/search`,
  and re-resolves each row's candidates through the isolated probe — the homepage behind it renders
  the same products, so `currentSrc` alone would sometimes report the grid's wider file. It is a
  sibling of the PDP check rather than a few lines inside it: the palette is on every route, and
  opening it pins `document.body` and covers the page, which is exactly the kind of perturbation that
  cost that file its determinism once already.
- ⚠️ **Astro middleware CANNOT set headers on `public/` assets** — the Node adapter's `sirv` handler
  serves them before middleware runs. Verified against a real build and reverted; long cache TTL is a
  Cloudflare Cache Rule (BACKLOG), not code. Do not re-write that middleware.
- **`robots-txt` scoring 0 is the AUDIT being wrong, not the file** — see the long note in
  `pages/robots.txt.ts`. Chasing it means switching off Cloudflare Managed robots.txt, which deletes an
  AI-training opt-out asserted as a right under EU Directive 2019/790.
- ⚠️ **Cloudflare Email Obfuscation injects `email-decode.min.js` as a RENDER-BLOCKING script** —
  measured **1.621 ms**, the single largest blocker on the page. It is triggered by our own `mailto:`
  links, and it is a zone setting, not code. Procedure + verification: **`specs/docs/CLOUDFLARE-PERF.md`**
  (also covers the static-asset Cache Rules, and why Managed robots.txt is left on deliberately).
- ⚠️ **`unused-javascript` and `legacy-javascript` are `fbevents.js`. There is no bundle of ours to
  fix, and the build target is NOT the cause** (measured 2026-08-01, closing N6). Astro hard-codes
  `build.target: "esnext"` for the client build (`core/build/static-build.js`), `astro.config.mjs`
  sets no `build` key, and there is **no browserslist anywhere in the repo** — nothing is being
  transpiled down. The client build emits **zero `.js` files**: every first-party script is inlined
  in the HTML (12 inline scripts, 62 KiB, of which 3 are esbuild-minified module bundles and 9 are
  `is:inline` and therefore verbatim). Coverage on the homepage with **no** interaction: 37,8 KiB
  unused, all of it ours, every item **under Lighthouse's 20 KiB per-resource floor** — which is why
  a local Lighthouse run scores both audits **1, with no items**. After one click:
  `connect.facebook.net/en_US/fbevents.js` arrives at **394,5 KiB with 188,8 KiB unused (47,9%)**,
  which at its transfer size is the reported **~44 KiB**; it also bundles **core-js 3.32.2**, which
  is exactly what `legacy-javascript` detects. Both audits therefore only appear in the runs where
  Lighthouse's scroll trips the first-interaction loader. **Do not raise/lower a build target for
  this, and do not undo the deferral (`#122`) to make an audit tidier.**
- **DOM size is dominated by ICONS, not by sections or carousel slides** (measured 2026-08-01, N5).
  On the homepage **393 of 1023 elements were in the SVG namespace** — 383 of those `<svg>` or
  `<path>`, the remaining 10 `<circle>`/`<rect>` inside lucide icons — and the **star rating owned
  240 of the 393 (61%)**.
  ⚠️ **Two different counts live here and conflating them overstates the case.** The star WIDGET was
  **312 elements**, which is 30% of the whole page, but only **240** of them were SVG; the other 72
  are its four wrapper divs and two spans, twelve times over. "312 of the 393" would read as 79% and
  is wrong. `Stars.astro` drew each rating as 2 layers × 5 `<svg><path>`, i.e. 26 elements, 12 times
  per page. One `<svg>` per layer with five `<path>`s is the same pixels for 17: **1023 → 915**
  (−108 = 12 × 9, of which 96 are SVG). Re-derived independently 2026-08-01 by building both versions
  of `Stars.astro` and counting in the browser (`namespaceURI === "http://www.w3.org/2000/svg"`, and
  `[role="img"][aria-label^="Rating"]` for the widget) — both totals reproduced exactly.
  The hero carousel is only **106 elements in total**, so deferring slides 2..n could not have paid
  for the crawler/no-JS risk; and cutting the DEFAULT TEMPLATE's sections changes nothing for any
  store that already exists (**the seed is not a migration**, see above) — it could not have moved the
  measured number at all. Look for repeated icon markup first.

## Dashboard & Analitik numbers — one source, one day, no rollup

> ### 📊 THE RULE: **`analytics_daily` IS RETIRED. Money on a screen is derived from `orders`, live.**
> Its only writer in the whole repo was the seed, so six of seven stores had **zero rows** (an empty
> dashboard over real orders) and the seventh **froze** on the day the seed ran: "Penjualan hari ini
> Rp0 · −100,0%" directly above four orders placed that morning. The table is kept but **unread and
> unwritten** — do not point anything at it, and do not restore the seed insert.

- **`getDailyStats()` (`lib/data/analytics.ts`) is the ONE producer of the daily series.** Revenue is
  `sum(total_idr - tax_idr)` over non-cancelled orders — the same expression `getChannelSalesDaily`,
  `getRegionSales` and `getOrderStats` use, so the chart total equals the Sumber Penjualan total.
- **The series must stay DENSE and end on TODAY.** `resolve()` slices it positionally
  (`all.slice(n - 7, n)`, `all[n-1]` = "Hari ini"), so a bare `GROUP BY` would silently turn
  "7 hari terakhir" into "the last 7 days that sold something". `generate_series` LEFT JOIN the
  aggregates is what makes the range switcher mean what it says.
- ⚠️ **`lib/data/day-bucket.ts` is the ONE definition of a day, and it is WIB.** Every day-bucketed
  query (daily, hourly, channels, product sales, funnel, devices) goes through `dayKey()`, because
  `dashboard.ts` matches their date keys against each other with `Set.has` — a query bucketing in a
  different zone does not error, it just **stops reconciling**. The container's `TimeZone` is UTC, so
  before this "hari ini" began at 07:00 WIB and every merchant's evening fell into "kemarin".
  Known limit: WIB is assumed for every store (`stores` has no timezone column).
- **A figure with no source is "—", never a number.** `visitors`/Konversi/funnel/device split come
  from `analytics_events` (the storefront tracker) and render an honest empty state for a store that
  has none. That is the standing rule that keeps producing bugs when broken — see the ad dashboard
  with no integration behind it.
- 🔴 **AND THE SAME RULE APPLIES TO THE DELTA: `Kpi.delta` / `MoneyTile.delta` are `number | null`.**
  `null` = **there was no previous period to divide by**, and it renders through the shared
  `NO_FIGURE` floor (`pct(null)` → "—"), never a digit. It used to be `prev === 0 ? 0`, so the empty
  seeded store (`snack-rumahan-bu-tati`) was told **"Penjualan hari ini +0,0% vs kemarin"** — a
  measurement of *"unchanged"* on a shop that has never sold anything. Measured in a browser
  2026-08-05 on all three money tiles and all four `/analitik` KPIs.
  ⚠️ **THE BOUNDARY IS THE DENOMINATOR, NOT THE NUMERATOR.** A store that genuinely sold Rp0 today
  after selling yesterday has a **real −100%** and it must stay a number — an em dash there is the
  same lie pointing the other way. Only `prev === 0` is the dash. Both sides are pinned by
  `apps/admin/lib/data/kpi-delta.test.ts` (proved red against both mutations before being trusted).
  ⚠️ **`null >= 0` is `true` in JavaScript**, so every `up = delta >= 0` is a live trap: it paints an
  emerald ↗ over an em dash. `kpi-card.tsx` / `money-strip.tsx` / `sparkline.tsx` take
  `boolean | null` and go **neutral** in that state.
- **NO GOOD/BAD VERDICT MAY BE CARRIED BY COLOUR ALONE (WCAG 1.4.1).** The two on the dashboard are
  the sales delta and the return rate; both badges carry a glyph plus a word (`sr-only` for the
  delta's "naik"/"turun"), and both have a **third, neutral state** for "nothing to judge". The
  return tile's `shipped === 0` used to fall into the `!bad` arm and wear the same **emerald** pill a
  genuinely clean rate wears — a healthy verdict on a store that had never posted a parcel.
  ✅ **CLOSED (N55, verified in code 2026-08-07):** `return-by-courier.tsx` no longer decides by colour
  alone — it renders `TriangleAlert`/`ShieldCheck` with `aria-hidden` plus an `sr-only` word, and its
  own header comment names N55. The bar colour stays as it was; it is now the third signal, not the
  only one. ⚠️ This line said "Still open" for as long as the fix has existed, and `NEXT.md`/`OPEN.md`
  said so too — three places asserting a defect that was already gone. **A closed task must be closed
  everywhere it is named, or the next reader re-fixes it.**
- **Runnable check: `apps/admin/lib/data/daily-stats.test.ts`.** Its Postgres half runs the real
  exported query under `SET LOCAL ROLE tokophi_app`. `vitest.config.ts` aliases `@/` → `apps/admin/`;
  without it no suite can import `lib/data/*` at all.

## Order lifecycle — COD, the ledger, and the one legal set of transitions

> ### 📦 THE RULE: **COD is a FACT ABOUT THE ORDER (`payments.method`), never a parameter.**
> `createShipment` derives it and REFUSES a caller that disagrees. `input.cod` is a claim we check,
> not an instruction we obey. It used to be `input.cod ? total : 0`, and both callers were wrong in
> opposite directions: the bulk loop passed `!!rate.cod` — the SERVICE's capability, true for every
> order on an SPX service in a COD-enabled store — over a queue that deliberately holds PREPAID
> orders (measured: 75 orders, 8 COD, **67 already paid**), so one click told the courier to collect
> cash again from 67 buyers; and the order detail's checkbox defaulted to `false` and was never
> seeded, so a real COD parcel was booked collecting **0** and the merchant was then credited the
> full sale as WITHDRAWABLE for cash nobody took.

- **`orders.status` has ONE writer: `applyOrderStatusChange`.** Both shipping status writes go through
  it (there is no raw `set({ status })` left in `shipping.ts`). It holds three guards, and all three
  are load-bearing: same-status is a no-op, `batal`/`retur` are terminal, and an explicit `ALLOWED`
  table names the only legal moves. The table exists because the first two permit everything they do
  not refuse — which allowed `selesai → batal` (restores stock **and** claws back an `available` sale
  on a delivered COD order whose cash is in hand) and `selesai → dikirim` (un-completes a settled
  order). `setOrderStatus` is a server action taking `status` straight from the client, so the UI
  hiding a button is not the boundary. `selesai → retur` stays legal: a delivered parcel can still
  come back, and that path reverses the sale correctly.
- **`creditSaleForPayment` excludes `batal` AND `retur`.** Dropping `retur` is how a payment landing
  after a return credited the full sale as immediately withdrawable: the claw-back had already run
  and found nothing to reverse, the order is terminal so nothing re-runs it, and `pay/callback`
  transitions on "status differs" — so a `gagal` payment on a still-live VA can reach `berhasil` long
  after the return. Stock restored **and** the merchant keeps the money.
- **A double-credit is a DB impossibility, not a code convention** — three partial unique indexes
  (`ledger_one_sale_per_payment`, `ledger_one_sale_per_order`, `ledger_one_retur_per_order`) plus
  `on conflict do nothing` on every writer. The balance is DERIVED (`Σ amount_idr` by status); there
  is no stored-balance column and there must not be.
- **⚠️ NOTHING THAT SUMS THE BALANCE MAY JOIN `orders`, and a `payout` entry is why.** Its `order_id`
  is NULL by design — it belongs to a withdrawal, not an order — so an inner join silently drops every
  payout and the available balance jumps by everything already paid out (measured on production:
  Rp21.043.271 → **Rp43.733.271**, handing back Rp23,5jt). By the same token `not exists (select 1 from
  orders where id = l.order_id)` is TRUE for a NULL, so the obvious orphan query reports every
  withdrawal as corruption. **Count `order_id IS NULL` separately, always.**
- **`npm run verify-ledger -w @tokophi/db`** (**safe against production — but NOT read-only, see below**) reports children of
  `orders` with a missing parent and what they are worth in each store's balance. It exists because
  production carried **48 such rows** — 10 `payments`, 30 `order_line_items`, 8 `ledger_entries`, all
  from ten `INV-47xx` orders that no longer exist — putting **Rp810.000 into `available`**, i.e.
  withdrawable via `requestPayout`, and Rp2.302.000 into `pending`, where `/saldo` printed a held total
  its own itemised list (`getPendingFunds`, which *does* join `orders`) could not account for.
  The three FKs are present and VALIDATED and Postgres refuses a dangling insert today, so **no
  application path can make these**; only a load with referential triggers off (`pg_restore
  --data-only --disable-triggers`, `session_replication_role = 'replica'`). Cleanup SQL —
  transactional, guarded, ending in `rollback` — is `ops/tokophi-orphan-cleanup.sql`; it is
  deliberately **not** a drizzle migration, because merging one would delete production rows
  unattended on the next Coolify build. Both traps are pinned by `packages/db/src/verify-ledger.test.ts`.
  ⚠️ **"Read-only" was WRONG, and the word matters.** `refusesDanglingInsert` INSERTs an account, a
  store and a deliberately-dangling `ledger_entries` row — deliberately, because `convalidated` only
  says the constraint was checked ONCE and the question is whether the trigger fires TODAY (that gap
  is exactly what a `--disable-triggers` restore leaves behind). Both exit paths throw (`23503`, or an
  explicit "THE FOREIGN KEY DID NOT FIRE"), so `sql.begin()` always rolls back and nothing commits —
  it is genuinely safe. But it opens a WRITE transaction, and an audit of "what touches production"
  that trusted the old phrase would have filtered it straight out.
  ✅ **Run against PRODUCTION 2026-08-05** — the first time since the cleanup. All **7** child tables
  0 orphans, every FK VALIDATED, the dangling insert refused today, `available` **Rp21.032.562** and
  `pending` **Rp23.424.347** both fully backed by orders. The 48 orphan rows are gone.
  **The rollback was CONFIRMED, not assumed**: `select count(*) from stores where slug like
  'fk-probe-%'` afterwards → **0**.
  ⚠️ Run it where the credential already lives, so it never lands in a shell history or a transcript —
  the admin container carries both `DATABASE_URL` and the monorepo source:
  `docker exec -w /app/packages/db $(docker ps --format '{{.Names}}' | grep -m1 '^admin-') /app/node_modules/.bin/tsx src/verify-ledger.ts`
- **A GUESS MUST NEVER SUCCEED QUIETLY, and "we flag it" is a claim to grep before trusting.** The
  comment above `createShipment`'s destination fallback said the guess "is flagged as a guess" while
  `destinationGuessed` existed **nowhere in the repo** — 77 orders carry no `ship_district_id`, so the
  branch was live and silent. It now returns the district it actually MATCHED (not the city it
  searched: "Surabaya" → "Bandar Surabaya, Lampung Tengah, LAMPUNG" is only visible if you print the
  match), the detail screen warns for 20s, and `BulkResult.guessedDestination` carries one entry per
  order — a bulk run is exactly where three guesses vanish behind "50 pesanan dibooking".
- **Report what you WROTE, never what you were asked to write.** `markLabelsPrinted` returned
  `done: numbers.length` regardless of what the UPDATE matched, so a number belonging to another store
  (RLS filters it out, no error) counted as printed. `.returning()` is the only honest source.
- **A terminal order must never grow a live bill.** `createOrderPayment` had no `status` check, so a
  cancelled order could be given a real VA: the buyer pays, the callback marks it `berhasil`, and
  `creditSaleForPayment` then correctly skips `batal`/`retur` — money collected, no sale credited.
  Refusing at creation is the only place this stops, because the callback is right to skip it. It also
  refuses a SECOND bill while one is still `menunggu`.
- **ONE definition of "the order's payment", used by every screen** — `paid_at desc nulls last, id
  desc`, in both `data/orders.ts` and `data/order-detail.ts`. They used to order differently, so an
  order with more than one payment row could read COD on one screen and VA on the other — and COD is
  the fact `createShipment` turns into a cash-collection instruction for a courier.
- **A `"use server"` action that spends a PROVIDER's quota needs a capability, not a session.**
  `getShippingRates` was the only door in `actions/shipping.ts` any signed-in store user could open,
  and every call is a live KiriminAja rate request. It now takes `orders:write`, the same gate as the
  `createShipment` it pairs with.
- **Converting a throwing action to `{ ok, error }` is a TWO-file change.** Next masks a thrown Error
  in production, so merchant-actionable rules must be returned — but a caller that awaits and ignores
  the result will then report success over a save that never happened, which is worse than the digest.
  Change the action and its callers in the same commit. (`actions/flash.ts` + `flash-editor.tsx`,
  2026-07-31; `theme.ts` earlier.)
- **`isUuid` (`lib/uuid.ts`) before any `eq(table.id, segment)`.** Postgres THROWS `22P02` on a
  non-UUID string — a 500 where a 404 belongs — and `/produk/…` takes the catalog NUMBER, so merchants
  really do try `/diskon/1042`. One route guarded itself with a private regex; the three beside it did
  not, which is what a private copy always costs.
- **User-typed search strings are ESCAPED before they enter a LIKE pattern** (`@tokophi/lib/like`).
  Not injection — everything is parameterised — but `%` and `_` are wildcards and the merchant is
  typing a search box: measured, an unescaped `_` matched **all 842 orders**. It is one shared helper
  because the same regex had already been written twice by hand and a third site was missed.
- **Validate every URL parameter that reaches an enum cast.** `/pesanan?bayar=<anything>` was a 500
  (`invalid input value for enum payment_method`) because `bayar` was passed straight through while
  `tab` and `field` beside it were checked.

## Landing HTML (`/lp/<slug>`) — raw markup, OWNER-ONLY

- ⚠️ **`set:html` EXECUTES.** The pasted HTML is emitted into the SSR response **body**, so the
  browser's HTML **parser** handles it — not `innerHTML`. A `<script>` tag in it **runs**, on the
  shop's own origin, on the page carrying the COD order form (name, WhatsApp, full address). There is
  no sanitizer on this path and no CSP on the storefront. The admin used to tell the merchant the
  opposite ("Tag &lt;script&gt; tidak dijalankan (keamanan)"), and the storefront comment it came from
  said the same. Both now say the truth.
- **Changing that HTML needs `landing:html` — owner only.** Everything ELSE on the screen (title,
  slug, product, countdown, funnel fields) still needs only `content:write`: the escalation is on the
  executable markup, not on the feature, so staff keep managing landings. Enforced in
  `actions/landing.ts` **only when the html differs from the stored row**, and gated in the editor so
  a staff user sees why before typing rather than after pressing Simpan.
- ⚠️ **Do NOT "fix" this with a regex sanitizer.** `<script>` is the obvious vector; `onerror=`,
  `javascript:` in an `href`, `<iframe srcdoc>` and SVG event handlers are not. A partial strip would
  restore exactly the false confidence that caption was already providing. A real sanitizer (or a CSP)
  is a separate, deliberate piece of work.
- `admin` is derived by SUBTRACTION (`ALL_CAPABILITIES.filter(...)`), so a new owner-only capability
  must be excluded there **explicitly** or it leaks to admin by default. `apps/admin/lib/rbac-landing.test.ts`
  pins that one capability; **`apps/admin/lib/rbac-census.test.ts` pins the CLASS** — a
  `Record<Capability, "owner-only" | "admin-too">` naming who is meant to hold each one, so a new
  capability fails `tsc` (the mapped type is missing a key) *and* `vitest` until someone classifies it.
  ⚠️ **`admin` was deliberately NOT converted to an allow-list.** That swaps a silent grant for a
  silent REMOVAL, which is worse to diagnose: `useCan` hides the control, so the admin gets no error —
  the button is simply not there. The census pins both directions instead; editing an entry in it is
  how you record a change of mind, and it grants/revokes for every store's Admin user in production.

## Codes are unique PER STORE, and the scope filter is load-bearing

`discounts.code` and `purchase_orders.code` are `UNIQUE (store_id, code)` since migration **0084**.
They used to be `UNIQUE (code)` — platform-wide — which on a multi-tenant product means the first
merchant to use a string owns it forever:

- **Vouchers**: Indonesian promo codes collide constantly (`GAJIAN`, `DISKON10`, `GRATISONGKIR`). One
  shop registering `GAJIAN25` blocked every other shop, and the rejection told the second merchant the
  code was taken — a working way to probe a competitor's codes.
- **Purchase orders**: worse, because the code is generated. `PO-${Date.now().toString().slice(-6)}`
  repeats every 10⁶ ms ≈ **16.7 minutes**, so two POs anywhere on the platform at the same point in
  that cycle collided and the second one simply failed to save. The generator is wider now, but the
  per-store scope is what makes a collision a local problem instead of a cross-tenant one.

⚠️ **`applyDiscount`'s `store_id` filter is now the ONLY thing stopping one store redeeming another's
code.** It used to be a second lock on a door only one key fitted; since 0084 it is the lock. Do not
"simplify" it away. `packages/db/src/per-store-codes.test.ts` pins both the composite unique and the
absence of a column-level `.unique()` — the edit that would silently restore the old behaviour
type-checks and passes everything else.

## Store Builder / Tema — three page types, three different jobs

`page_templates.type` is `homepage | category | product` and they are **not interchangeable**:

| Type | What the template IS | Rendered by |
|---|---|---|
| `homepage` | the whole page | `index.astro` |
| `category` | the **body** under the category's own header | `kategori/[handle].astro` |
| `product` | the **PDP tail** only (gallery, buy box, reviews, description untouched) | `produk/[handle].astro` |

- ⚠️ **`CategoryHero` is ALWAYS rendered — a template never replaces it.** It used to: building a
  category template cost the page its `<h1>`, its breadcrumb and its cover, while the BreadcrumbList
  JSON-LD kept publishing a trail nobody could see. (`produk/index.astro` already worked correctly;
  the two sibling listing routes had simply diverged.)
- **`product-listing` ("Daftar Produk") is the catalogue; `product-grid` ("Grid Produk") is a
  merchandising row.** Daftar Produk wraps the same `ProductListing.astro` the hand-built page uses
  — server-side sort, 12-per-page pagination, one empty state. Grid Produk is a flat slice capped at
  `limit` with neither. The builder used to offer only Grid Produk on a category template, so its
  own hint ("tambahkan Grid Produk") steered merchants into **silently truncating their catalogue
  and losing sort + paging**.
- **The palette is per type** — `SECTIONS_BY_TEMPLATE_TYPE` in `@tokophi/sections`, applied by
  `puckConfigFor(type)`. No `hero` on a category (CategoryHero owns the `<h1>`; a second one is the
  a11y defect the homepage carousel already has) and none on a product (the product name is the
  `<h1>`); no navigation furniture under a buy box.
- **Narrow the PALETTE, never the RENDERER.** `SectionRenderer` still switches on every type, so a
  template saved earlier holding a section no longer offered for its type keeps rendering. Removing
  it from the sidebar stops merchants adding more; it must never silently delete published work.
- ⚠️ **The renderer's `default:` arm is a GUARD, not a branch to tidy away.** 14 `case`s and no
  fallthrough meant a type added to `SectionConfigMap` and forgotten **compiled and rendered nothing**
  — part of a merchant's published page gone, no error, no failed build. The admin half never had this
  problem (`Config<SectionConfigMap>` in `puck-config.tsx` is an exhaustive mapped type, so the
  BUILDER refused the new section while the RENDERER stayed silent). `const _exhaustive: never = item`
  closes it. **`astro check` is the only thing that compiles that file, and it is WIRED NOW** —
  `npm test` is `vitest run && npm run check:storefront` (+14 s). For a long time nothing ran it (the
  storefront's build is a bare `astro build`, transpile-only), so that guard was decoration.
  ⚠️ **Both halves are load-bearing and they catch different things.** `astro check` catches a wrong
  **prop**; `section-renderer-exhaustive.test.ts` catches a missing or misrouted **arm** — and it reads
  the file's CODE, not its text (see the rule below): commenting out `case "lookbook":` left the text
  in place and kept all four tests green while the renderer dropped that section on a live storefront.
  The same was true of the `_exhaustive: never` assertion itself.
- A type that genuinely is unknown at runtime (an older saved template, a rolled-back deploy) gets a
  `console.warn` on the server — this is SSR, so it lands in the container log — plus a visible panel
  **in DEV only**. Not in production on purpose: a shopper must not be shown our internal error on a
  merchant's live shop. Silence toward the shopper, never silence toward us.

## Checkout input — normalise generously, reject narrowly (`@tokophi/lib/validate`)
**The API is the boundary, the form is UX.** `/api/public/order` re-normalises and re-validates every field before it writes a customer or an order; the copies of these rules in `checkout.astro` exist only so the shopper sees the error early. **Over-validation is itself a bug**: a rule that rejects a legitimate Indonesian name, a new carrier prefix or an unusual address costs a sale and nobody ever finds out — the shopper just leaves.
- **Phone = canonical `62xxx`** (`normalizePhone`). Accept `0812…`/`812…`/`+62 812-…`/`62 812…` with any separators. Validate **structure, not carrier**: after `62` it starts with `8`, national part 9–12 digits. **NEVER hard-code operator prefixes** (811/812/…) — carriers add prefixes and the list would one day refuse a real customer, silently and permanently. Normalise on write from EVERY path (order API, `checkout-session`, chat, seller pickup phone); migration `0048` backfilled the existing rows. `waLink()` normalises too (`wa.me/08…` does not open a chat).
- **Email = shape only, optional, NO domain whitelist** (no mailer exists here; a gmail/yahoo allow-list would reject corporate/university/self-hosted buyers — the higher-value ones).
- **Nama** = letters incl. diacritics + space `.` `'` `-` (`Nur'aini`, `M. Rizky`); digits/symbols refused. **Alamat** = letters AND digits (RT/RW is the point) + punctuation; only junk refused (emoji, control chars, one repeated char, <10 chars).
- 🔴 **Kode pos is REQUIRED (2026-08-03) — and "required" means THE SHOPPER MUST SUPPLY IT, never "the system must have derived it".** It is printed on the parcel. The checkout auto-fills it wherever the cascade can answer honestly (a district with one postcode → filled on the district pick; several → filled on the kelurahan pick) and the field is **ALWAYS EDITABLE**, because ~4% of KiriminAja's districts have no kelurahan data and the lookup can fail — a rule that only accepted a *derived* code would strand exactly those shoppers on a field they cannot fill. PRESENCE + **5 digits**, and deliberately **NOT** "must exist in our `kelurahan` snapshot": postcodes get added and redrawn, and refusing a real new one costs the sale silently.
  - ⚠️ **`readOnly` SILENTLY CANCELS `required`.** A readonly input is *barred from constraint validation* — `willValidate` is false and `valueMissing` never fires. The field used to be locked whenever the value was derived, so adding `required` alone would have been a **no-op on exactly the two branches that auto-fill** (measured in a browser: `required` + `readOnly` → `willValidate: false`, and Bayar went straight through with an empty kodepos). The same trap already applied to Kota/Provinsi, which is why the kecamatan is checked in JS. **Never re-lock the field.**
  - ⚠️ **A programmatic `el.value = …` fires NEITHER `input` NOR `change`**, so it does not clear the custom validity a failed submit left behind — and `setCustomValidity(msg)` keeps a control invalid until the string is cleared. A shopper who pressed Bayar with an empty kodepos and then picked a kelurahan that filled it FOR them would be refused **forever** by a field that is now correct. **`setKodepos()` is the ONE writer** and it calls `clearValidity("kodepos")`; `apps/storefront/src/lib/checkout-kodepos.test.ts` fails if a second writer appears, if `required` or the `MISSING` entry goes, or if `readOnly` comes back.
  - **`loadKelurahan()` drops a response whose district the shopper has left** (same `destAtCall` guard `loadRates()` has always had). It had none: measured, two districts picked in quick succession left district A's postcode **55764** on an order shipping to district B (Sewon, 552), read back by the "Kirim ke" card as if it belonged there. A recovered checkout's saved kodepos is now restored **inside** that lookup too — it used to be re-applied from a `setTimeout(…, 600)` racing it, so any slower lookup wiped it (measured: 2 s → field emptied), which under a required rule is a returning shopper who cannot submit.
- **Kecamatan is NOT character-validated** — it is picked from a list, so the only real rule is "the `dest_id` resolves in `kiriminaja_areas`" (`areaById`). **Kota + Provinsi are DERIVED from it**; the typed values are ignored everywhere (they were the COD hole).
- ⚠️ **`<form novalidate>` on `checkout.astro` is LOAD-BEARING — it is what makes the checkout speak Indonesian. Do not remove it.** The browser runs its own constraint check **before** the `submit` event: finding an empty `required` field it blocks the submit and shows **its own bubble, in the BROWSER's language, not the page's `lang="id"`**. An Indonesian shopper on an English phone got *"Please fill out this field."* / *"Please select one of these options."* — the only strings on the page we did not write — **and the submit handler never ran, so every Indonesian message it already carried (`"Nama lengkap wajib diisi."`) was unreachable dead code.** `novalidate` disables only the automatic pre-submit gate; `checkValidity()`/`reportValidity()` still work when *we* call them. Our market is Indonesia: **every message a shopper can see must be ours.**
  - `labelMissing()` stamps an Indonesian sentence on **every** `valueMissing` control (map `MISSING`, keyed by `name`) **before** anything reports — the submit handler bails at the first bad field, so labelling lazily leaves the rest holding English: invisible today, one stray `reportValidity()` from being shown. **Add a `name` to `MISSING` when you add a required control.**
  - ⚠️ `setCustomValidity(msg)` keeps a control **invalid until the string is cleared** — the `change`/`input` handlers call `clearValidity(name)`. Forget that and a field the shopper has already fixed refuses to submit forever.
  - **Test on an `en-US` browser** (Playwright `locale: "en-US"`). On an id-ID browser the page looks perfect and the bug is invisible — which is exactly how it shipped.
- ⚠️ **NEVER call `reportValidity()` on blur — it FOCUSES the control, and that trapped shoppers in a field they had already left.** Shipped and measured 2026-07-17: a shopper typed `siti@gmail` (an ordinary typo — no `.com`), clicked the **Alamat** box and typed their address. `reportValidity()` on email's blur yanked focus back, so the result was **`alamat=""` and `email="siti@gmailJl. Melati No. 12 RT 03 RW 05"`** — their address went into the email field. **Tab was trapped too**, and **`email` is OPTIONAL**: a field nobody has to fill was holding the whole checkout hostage. The blur path now calls `showFieldError()`, which writes an **inline `<p data-err="<name>">` + `aria-invalid`** and never touches focus.
  - **Stealing focus is correct on submit** — they pressed Bayar, so taking them to the blocking field is the help they asked for. It is never correct because they merely moved on.
  - **Empty is not yet a mistake**: blur only shows a message if they actually typed something. Do not "improve" this into nagging on tab-past.
  - A test that only calls `page.fill()` **cannot see this** — `fill()` sets the value directly. Drive it like a human: `.click()` then `keyboard.type()`, then assert **which field the text landed in**.
- ✅ **Over-validation is a bug, and it is now guarded by an executable sweep** (2026-07-17, 40+ cases, all green, run in a real browser): 13 real Indonesian names pass (`Nur'aini`, `M. Rizky`, `I Gusti Ngurah Rai`, `Abdul Ghofur Al-Rasyid`, `Aisyah Zahra’`, `Anne-Marie Tobing`); phone prefixes **0838 / 0881 / 0895 / 0851** pass and normalise to `62…` (a hard-coded operator list would refuse these — **never add one**); university/self-hosted/plus-addressed emails pass; RT/RW addresses with `Blok C2/14` and `RT.001/RW.009` pass. If you tighten a rule, re-run that shape of test — a rule that refuses a real customer costs a sale and nobody ever finds out.

## The public API (`apps/admin/app/api/public/**`) — four routes, no session, no Host

`ongkir` · `order` · `promo` · `pay/callback`. The only unauthenticated write surface in the
product, and until 2026-08-03 invisible to two repo-wide guards (a `public`-directory skip). Audited
end-to-end on 2026-08-05 by DRIVING it, not by reading it.

- 🔵 **`storeSlug` IN THE BODY IS THE TENANT SELECTOR HERE, AND IT IS CORRECT. Do not "fix" it to
  the Host header — that fix is not implementable.** This has now been filed as a cross-tenant bug
  once; the reasoning is here so it is not filed again.
  These routes are served by **`app.tokophi.com`** while the shopper is on **`<slug>.tokophi.com`**
  — that is why every one of them carries CORS headers and why three of them have a long comment
  about an uncaught throw arriving without them. **The `Host` on these requests is always the admin
  app's own hostname; it carries no tenant.** `checkout-session.ts` genuinely can take the tenant
  from the Host (ADR 0009) because it lives IN the storefront, same-origin, where `locals.store` is
  a real fact — and the comment there ("a store id sent by the client is NEVER read") is about
  **that** endpoint, not these.
  Measured 2026-08-05: with `Host: kopi-senja.tokophi.com` and `storeSlug: batik-nusantara`,
  `/api/public/promo` answers for **batik-nusantara** — six distinguishable answers over its voucher
  list. That is real, and it is **not a tenant escape**: a slug is a public subdomain, the endpoint
  is public, and the identical answers come back from that shop's own checkout page. A caller learns
  nothing they could not learn by browsing there. Moving these endpoints into the storefront to get a
  Host would put the **platform's** KiriminAja and AutoLaris keys into the storefront container,
  which is the thing `ongkir/route.ts` says in its first comment it exists to avoid.
  ⚠️ The error copy (`"Kode voucher tidak ditemukan."` vs `"…kedaluwarsa."` vs
  `"Minimum belanja Rp…"`) IS a code-probing oracle, deliberately: those sentences are what a real
  shopper holding an old flyer needs to read. Collapsing them to one message is over-validation.
- **A public route reads its body through `readPublicBody()` (`lib/public-guard.ts`), never
  `req.json()`.** `req.json()` has no size ceiling in a Route Handler — measured, a **64 MB** body
  was accepted, buffered and parsed. The cap counts the STREAM, not the `Content-Length` header
  (a chunked upload sends none), and cancels the reader instead of draining the rest.
- **`items[]` is capped at `MAX_CART_ITEMS` (100), on the RAW array.** `/api/public/order` does
  **four sequential DB round-trips per element**: measured, 10.000 items = **50.498 index scans and
  63,8 s in ONE request** that never reaches the courier API or a write. The rate limit bounds how
  OFTEN one IP calls; it never bounded how big each call is. 100 lines is ~1,2 s and ~12 KB —
  generous on purpose, because a cap that refuses a real wholesale cart is a lost sale nobody hears
  about.
- 🔴 **A PROVIDER'S OWN ERROR TEXT NEVER REACHES A SHOPPER (ADR 0004).** It did: measured live,
  `/api/public/order` answered `"kurir nosuchcourier tidak terdaftar di sistem kami"` — the
  aggregator, in the **first person**, on the merchant's checkout — and on a bad key the same field
  reads `"Unauthorized."`. The gateway's `ket` went out as `payError` (`{"rc":"401",
  "ket":"Unauthorized"}`, measured against the live PSP). Neither string happens to spell
  *KiriminAja* or *AutoLaris*, but the text is unbounded and written by someone else, so nothing kept
  the next one from doing so. `quoteShipping` now flags `fromProvider`, the two public routes
  substitute `SHIPPING_QUOTE_UNAVAILABLE` / `PAY_START_FAILED` and `console.error` the original —
  and the **seller-facing** `getShippingRates` keeps the provider's words, because the merchant is
  who acts on "sudah melewati jam cut-off". Nothing is lost on the shopper's side: a route the
  courier does not serve comes back `status:true` with an **empty rate list** (measured), so the
  error path is only ever our own side failing.
- ⚠️ **There is deliberately NO bot gate on these four**, unlike `checkout-session.ts`. That one
  fails quiet (204, nothing lost); these decide MONEY. `isBot()` treats an **empty User-Agent** as a
  bot, and a privacy browser or a stripping proxy would have its order refused with no way for
  anyone to find out — the exact failure this repo calls a bug equal to the hole it closes. Rate
  limit + caps are the floor; the wall is Cloudflare at the edge.
- Guarded by **`apps/admin/lib/public-guard.test.ts`** — real `Request`s through the cap (including
  a chunked body that declares no length), plus `codeOnly()` source claims that all four routes go
  through `readPublicBody` and that neither shipping route serves the provider's string. Both source
  claims carry a **mutation self-check**: the same predicate is asserted to fire on a copy with the
  old code put back, so the guard can never be green for want of matching anything.

## Structure (apps/admin/)
- `app/(admin)/` — route group. `page.tsx` = Dashboard (`/`). Sections: pesanan, produk, pelanggan, diskon, analitik, halaman(+baru), blog(+baru), navigasi, pengaturan.
- `components/admin/` — shell (sidebar, topbar, nav-links, brand) + shared bits (page-header, order-status, kpi-card, *-chart, …) + per-screen subfolders.
- `components/ui/` — shadcn/ui primitives (**on Base UI**).
- `lib/mock/store.ts` — deterministic seeded fixtures, anchored `TODAY=2026-06-30`. **Single source of demo data.**
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
2. Add mock to `lib/mock/store.ts` + (optional) selectors in `lib/data/`.
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
- **`value` is not one number.** Meta/TikTok take the all-in total; GA4 takes goods only
  (subtotal − discount) with `shipping` and `tax` as their own parameters. Compute goods the same way on
  both sides or GA4 gets two revenues for one `transaction_id`.
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
| `specs/docs/FLOWS.md` | end-to-end flows. **§5 shipping · §8 ad click → order → conversion.** Read before touching checkout, ongkir, a shipment or a pixel |
| **`specs/docs/SECURITY.md`** | **trust boundaries, identity/RBAC, tenant isolation, transport, secrets, encryption at rest, every rate limit with its real value — and the gaps we knowingly live with.** Read before touching auth, RLS, the public API or a zone setting. It owns the standing SHAPE; `AUDIT-SUMMARY.md` owns findings |
| **`specs/docs/SLA-DRP.md`** | **availability & disaster recovery — SLI/SLO/SLA, RTO/RPO, single points of failure, the recovery runbook, the exercise plan.** ⚠️ Read §3 before trusting the backups: retention was **5 h 44 min** where "daily, keep-7" implied seven days (every deploy restarted the container, and `keep-7` counted FILES). Fixed in #171 — but the window **rebuilds over 14 days**, it is not 14 days today. There is still **no offsite copy** |
| `specs/docs/CODE_MAP.md` | you need to find where a concern lives |
| `specs/docs/STATUS.md` | **before you trust a number on a screen** — 🟢 real / 🟡 seeded / 🔴 fake |
| `specs/docs/SCHEMA.md` | the DB, annotated from the catalog |
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
