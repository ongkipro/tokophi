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

Shopify-style commerce SaaS for Indonesia. **No Themes menu, no Apps/Plugins.** **Backend live on local PostgreSQL** (Docker :5433, Drizzle): all 3 surfaces READ + all 12 admin editors WRITE the DB, plus local auth (login/session) + local media upload (see Database below). Bahasa Indonesia UI, IDR. **Prod target = self-hosted Postgres + PostgREST on a VPS (NOT Supabase), deferred.** Full spec: `~/Documents/Development/tokophi/PRD.md`.

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
```

## Database (local Postgres — `@tokophi/db`)
Local backend fully wired behind the data layer (all 3 surfaces read + all editors write; auth+RBAC+RLS; real variants). Local dev uses **plain PostgreSQL 16 in Docker** + **Drizzle** (schema mirrors `~/Documents/Development/tokophi/docs/SCHEMA.md`: **54 tables**, snake_case, money = bigint IDR). Single-tenant MVP: one store "Batik Nusantara" (ADR 0008). Auth (local, JWT) + RBAC + RLS are done locally; Storage (self-hosted MinIO/S3) comes with the VPS. **RLS** (migration 0012, extended by 0032 `page_templates`, 0035 `support_*`, 0036 `media`+`payments`, **0058 `stores`**) is enabled on **45 of the 46 store-scoped tables** AND **enforces at runtime**: the admin runs every read (`lib/data/*` via `withCurrentTenant`) + write (`lib/actions/*` via `withTenant`) inside a txn that sets `app.store_id` + `SET LOCAL ROLE tokophi_app`, so tenant queries execute as the non-owner role with policies applied. `npm run verify-rls -w @tokophi/db` derives the store-scoped set from the catalog (every table with a `store_id`) and FAILS if one lacks RLS — **45/46 as of 2026-07-17, and the ONE remaining exception is `platform_activity`** (the platform's own audit log: cross-tenant by design, written before a session exists). `media` + `payments` were retrofitted in 0036; **this doc claimed 36/39 with 3 exceptions long after that was false** — check `npm run verify-rls`, not this sentence. ⚠️ **`stores` is NOT in that count and never could be**: it is keyed by `id`, has no `store_id`, so the catalog query cannot see it — that blind spot leaked two merchants' data across tenants until `0058` put an `id`-based policy on it. Auth (`lib/auth.ts`, pre-session `store_users` read), super-admin (cross-tenant), and the storefront (`Host`-resolved read-only catalog) stay on the owner connection. On the VPS this becomes PostgREST connecting as `tokophi_app` with the JWT `store_id` claim feeding the GUC. **RBAC** (app-layer, `lib/rbac.ts`) is enforced too.
```bash
docker compose up -d db              # PostgreSQL 16 @ localhost:5433 (persisted volume)
npm run migrate -w @tokophi/db     # apply versioned migrations (canonical)
npm run seed    -w @tokophi/db     # (re)load demo data — idempotent (truncates first)
npm run studio  -w @tokophi/db     # Drizzle Studio
npm run generate -w @tokophi/db    # after editing src/schema.ts → new migration; `push` = quick dev sync
```
- Package: `packages/db` → `import { db, schema } from "@tokophi/db"` (server-only; `postgres` is `serverExternalPackages`). `npm run reset` drops `public` + `drizzle` schemas.
- `DATABASE_URL` lives in root `.env` (tooling) + each app's `.env.local` (Next). Copy from `.env.example`.
- **Wired to DB** (read via server-only `lib/data/*`, pages `dynamic="force-dynamic"`): **super-admin** (all 5) + **admin** (Produk, Diskon, Pelanggan, Kategori, Pesanan, Halaman, Blog, Inventori, CRM, Pembelian, Segmen, Ulasan, Navigasi, Dashboard, Analitik, Pemasaran — 16 modules) + **storefront** (catalog via `@tokophi/db` at build/SSR). **Reads: done end-to-end.** - **Auth (local, real):** email/password login against `users` (`password_hash` = scrypt `salt:hash`, seeded owner **ongki@batiknusantara.id / tokophi123**) ⋈ `store_users` (role). Session = **jose JWT in an httpOnly `session` cookie** (`AUTH_SECRET` env). `lib/auth.ts` (verify/findLogin/signSession/getSession — server-only, Node), `lib/actions/auth.ts` (`signIn`/`signOut`), `app/login/page.tsx`, `middleware.ts` (edge-safe JWT check → redirects to `/login`; excludes `/products`). Topbar shows the session user + "Keluar". Aligns with the VPS/PostgREST **JWT** prod plan. **RBAC** (`lib/rbac.ts` `requireCapability`, role→capability matrix) gates every mutating server action; **RLS** (migration 0012, `withTenant()` + `verify-rls`) isolates the store-scoped tables by `store_id` (36/39 — see above) (enforced under the `tokophi_app` role on the VPS).

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
    "simplification" removes it. The 11 store-scoped tables with no `store_id` and no RLS, on which
    `tokophi_app` holds full DML: `collection_conditions`, `collection_products`, `customer_addresses`,
    `discount_usages`, `fulfillments`, `inventory_levels`, `menu_items`, `order_line_items`,
    `product_media`, `product_options`, `purchase_order_items`.
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

- **`requirePlatformAdmin(min)` is the first statement of all 27 mutating actions**, and the rank is
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
- **Never anchor a date to the seed.** `health.ts` measured recency from a frozen `2026-07-02`, so a
  store 34 days dormant read "5 days, ok" and a live one read **−23 hari**. `data.ts` had already been
  migrated off that anchor; the healthcheck was missed. Same rule as the discount editor.

## Billing & super-admin control (single plan)
- **One plan "TokoΦ"**, all features. `@tokophi/lib/billing`: 3-day trial → **Rp50rb** first month → **Rp275rb/mo** (annual Rp2.7jt). Prices are the **DPP (ex-tax)**; the merchant pays **base + PPN 11%** (`withPpn()`/`baseFromTotal()`) — invoices store the PPN-inclusive total, faktur itemizes DPP+PPN. **Do NOT reintroduce plan tiers** (Pemula/Bisnis/Skala are legacy, unused).
- **Store lifecycle segments** (`storeSegment()`): `trial → first_month → regular → vip`. **VIP = `stores.comped`** — super-admin bypasses billing (free, always active, never billed/suspended; admin `getBilling` + billing cron honor `comped`). Segments drive the super-admin Toko catalog (4 tabs).
- **Super-admin per-store control** (`apps/super-admin/lib/actions.ts`): comp 1 month, extend trial, VIP toggle, reset owner/user password (scrypt), manage store users, suspend/activate — every action audit-logged to `platform_activity` (with `store_id` + `admin` kind).
- **Client "Akun" section** `/akun/{profil,keamanan,langganan}` (NOT under Pengaturan) — tabbed layout; avatar menu links here. Langganan has payment history + printable **`/faktur/[number]`**. Sidebar shows a subscription badge under the logo.
- **Payment channels are a PLATFORM decision** (ADR 0004) — super-admin owns `platform_payment_channels`; the storefront checkout reads *those*. The client-admin **"Pembayaran" tab was REMOVED (2026-07-13)**: it let a merchant pick channels + a fee bearer, but **nothing ever read either value** — the storefront read the platform list and no pricing code touched the bearer, so the UI silently lied. ⚠️ **`store_settings.payment_channels` / `payment_fee_bearer` are dead columns** (kept, not dropped — dropping is a destructive migration and super-admin may want per-store overrides later). **A merchant-facing fee-bearer feature does NOT exist**: `@tokophi/lib/payment-fees` (VA Rp4.000, e-wallet 2,4%, QRIS 1%, retail Rp4.000) is only used for *display*. If it is ever wanted, it must be **built into checkout pricing** — not merely stored.
- **Provider brands stay hidden from clients** (KiriminAja/AutoLaris) — generic labels; only super-admin sees brands (ADR 0004).

## Shipping & COD (read before touching checkout)
- **Ongkir is priced FROM the seller's pickup address** (`store_settings.sender_kecamatan_id`, set in Pengaturan → Alamat). That column **is** a KiriminAja district id — the same currency as the shopper's `destinationId` — so there is nothing to resolve and nothing to guess. It used to be `resolveArea(body.originCity || "Yogyakarta")`: a **city name posted by the shopper's browser**, fuzzy-matched, with a hard-coded fallback. Two bugs in one line — the seller's real warehouse was ignored (a Surabaya merchant quoted Yogyakarta rates on every order), and **an untrusted client string decided a price**. `body.originCity` is now ignored. **Never let the client choose the origin.** If no pickup address is set we fall back to the store's *registered* city (still the shop's data, never the shopper's) and say so in the response (`originFrom: "store-city"`) — a quote built on a fuzzy match is a guess and must be visible as one.
- ⚠️ **Rates are REAL KiriminAja API calls, but `KIRIMINAJA_ENV` defaults to `sandbox`** (`tdev.kiriminaja.com`). The numbers are genuine API responses and genuinely origin-driven — they are **not production tariffs**. Setting `KIRIMINAJA_ENV=production` is the last step between the demo and real money; an unset env in production silently talks to sandbox.
- **COD is ON and it is a CHAIN of three agreements** — break any link and COD silently disappears: `platform_cod.enabled` (+ cap **Rp2.000.000**, **6** allow-listed provinces: DI Yogyakarta, Jawa Tengah, Jawa Barat, DKI Jakarta, Banten, Jawa Timur) ∧ `platform_couriers.services[].codAllowed` = **SPX only** (SPX Standard `type=1`, SPX Economy `type=3` — every other courier is `codAllowed=false` **even where KiriminAja reports `cod=true`**, because a refused parcel is *believed* to return free on SPX; ⚠️ **that belief is UNVERIFIED**) ∧ `store_settings.cod_enabled` (**default false**, migration 0038 — the merchant opts in at Pengaturan → Pengiriman → "Bayar di Tempat (COD)").
- **`apps/admin/lib/cod.ts` is the ONE place that answers "may this order be paid on delivery?"** (five conditions). `/api/public/order` **rejects** a COD order that fails any of them — hiding the option in the storefront is UX; **that endpoint is the boundary**. Never re-implement the check elsewhere, and never `if (courier === "spx")`: widening COD must stay a data change (`codAllowed`), not a deploy.
  - ⚠️ **A COD-enabled store whose current selection doesn't qualify now sees a REASON, not a blank** (`checkout.astro` `#cod-hint`, written by `syncCod`). This deliberately reverses the old "hide silently, no excuse" rule: the silent hide made "COD on but invisible" look like a bug to the merchant testing it. It is a one-line explanation of the single unmet condition (non-SPX courier / SPX doesn't serve the route / province off the allow-list / over the cap) — **not** a clickable greyed-out COD row (that would be a payment we'd reject, dressed as a choice). Still UX; the endpoint is still the boundary.
- **The merchant's shipping selection is PER SERVICE** (`store_shipping_methods`, written by `saveStoreServices`), not per courier — a courier-level list cannot express "I ship JNE Reguler but not JNE YES". `/api/public/ongkir` filters rates by **(platform-enabled couriers) ∩ (picked services)**, keyed `"<courier>:<service_type>"`; **no rows = the merchant never opened the card → fall back to `store_settings.couriers`** rather than render a checkout with zero shipping options. It filtered on the courier column until `35b88a4` and offered services the seller had switched OFF.
- The `cod` flag on a rate is the **effective** one (KiriminAja capability × platform `codAllowed` × the store's `cod_enabled`) — never the raw courier capability.
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
 where s.slug = 'batik-nusantara';
SQL
```

⚠️ Resolve the postgres container by PREFIX, never by its full name — the hash suffix changes on
every deploy, and a hardcoded one fails with "No such container" the moment anything ships.

## Storefront performance — what is on the critical path, and what must never go back on it

Measured with Lighthouse against production, 2026-07-31. Numbers, not intuition.

- 🔴 **MARKETING PIXELS ARE THE DOMINANT COST, AND THEY ARE DEFERRED.** Turning Meta + Google + TikTok
  on took mobile from **90 → 66** and Total Blocking Time from **130 ms → 770 ms**. The downloads were
  never the problem — all three were already `async`. The cost is PARSE + EXECUTE of three third-party
  bundles on the main thread while the browser is trying to paint.
  `MarketingPixels.astro` now injects the vendor `<script>`s only at **idle-or-first-interaction**
  (`later()`), while every stub, queue and `init` stays SYNCHRONOUS. That is what makes it lossless:
  `fbq.queue`, `dataLayer` and `ttq`'s method array are the vendors' own documented buffers, so a call
  made before the SDK arrives is replayed in order. **Do not "simplify" a stub back into its vendor
  snippet** — the stock snippet injects the script as its last line, which silently undoes this.
  Guarded by `apps/storefront/scripts/check-pixel-defer.mjs` (a BROWSER check: build, lint and
  `astro check` all stay green while events are being dropped).
- **Inter is SELF-HOSTED** (`public/fonts/`, `@font-face` in `styles/global.css`). The Google Fonts
  `<link>` was render-blocking for **1.409 ms** in three layouts, in front of an LCP that was **82%
  render delay** — the LCP element is an `<h1>`, i.e. text waiting on a font on a third-party origin.
  latin + latin-ext only, one variable file per subset covering 100–900.
- **Static images have REAL width variants**, generated by `scripts/gen-image-widths.mjs` and emitted
  by `imageSrcSet` (`data/catalog.ts`). `?w=` only works for `/api/uploads/*` (the admin serves those);
  for `public/` it is a meaningless query on the same bytes, which is worse than no srcset. ⚠️ The
  ladders in `STATIC_WIDTHS` and the script's `PLAN` **must stay identical** — a width listed with no
  file on disk is a 404 the browser may pick as its best candidate.
- ⚠️ **Astro middleware CANNOT set headers on `public/` assets** — the Node adapter's `sirv` handler
  serves them before middleware runs. Verified against a real build and reverted; long cache TTL is a
  Cloudflare Cache Rule (BACKLOG), not code. Do not re-write that middleware.
- **`robots-txt` scoring 0 is the AUDIT being wrong, not the file** — see the long note in
  `pages/robots.txt.ts`. Chasing it means switching off Cloudflare Managed robots.txt, which deletes an
  AI-training opt-out asserted as a right under EU Directive 2019/790.
- ⚠️ **Cloudflare Email Obfuscation injects `email-decode.min.js` as a RENDER-BLOCKING script** —
  measured **1.621 ms**, the single largest blocker on the page. It is triggered by our own `mailto:`
  links, and it is a zone setting, not code.

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
  pins this.

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

## Checkout input — normalise generously, reject narrowly (`@tokophi/lib/validate`)
**The API is the boundary, the form is UX.** `/api/public/order` re-normalises and re-validates every field before it writes a customer or an order; the copies of these rules in `checkout.astro` exist only so the shopper sees the error early. **Over-validation is itself a bug**: a rule that rejects a legitimate Indonesian name, a new carrier prefix or an unusual address costs a sale and nobody ever finds out — the shopper just leaves.
- **Phone = canonical `62xxx`** (`normalizePhone`). Accept `0812…`/`812…`/`+62 812-…`/`62 812…` with any separators. Validate **structure, not carrier**: after `62` it starts with `8`, national part 9–12 digits. **NEVER hard-code operator prefixes** (811/812/…) — carriers add prefixes and the list would one day refuse a real customer, silently and permanently. Normalise on write from EVERY path (order API, `checkout-session`, chat, seller pickup phone); migration `0048` backfilled the existing rows. `waLink()` normalises too (`wa.me/08…` does not open a chat).
- **Email = shape only, optional, NO domain whitelist** (no mailer exists here; a gmail/yahoo allow-list would reject corporate/university/self-hosted buyers — the higher-value ones).
- **Nama** = letters incl. diacritics + space `.` `'` `-` (`Nur'aini`, `M. Rizky`); digits/symbols refused. **Alamat** = letters AND digits (RT/RW is the point) + punctuation; only junk refused (emoji, control chars, one repeated char, <10 chars). **Kode pos** = 5 digits, optional.
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
| `specs/docs/CODE_MAP.md` | you need to find where a concern lives |
| `specs/docs/STATUS.md` | **before you trust a number on a screen** — 🟢 real / 🟡 seeded / 🔴 fake |
| `specs/docs/SCHEMA.md` | the DB, annotated from the catalog |
| `specs/docs/BACKLOG.md` | what is actually open |
| `specs/docs/DEPLOY.md` | ops, env, the cron sidecars, how to verify a deploy really landed |
| `specs/PRD.md` · `specs/decisions/` | what the product is · ADR 0010 couriers · **0012 conversion tracking · 0013 catalog ids** |

Changelog: `CHANGELOG.md`. `apps/admin/AGENTS.md` = the "Next 16 has breaking changes" note.

⚠️ **Do NOT reach the docs through `~/Documents/Development/tokophi`** — that symlink points at
`<repo>/specs` in the MAIN checkout, on branch `main`. Editing through it writes into someone else's
working tree, and your commit will not contain it.

**If a doc disagrees with the code, the code wins — and the doc is a bug. Fix it.**
