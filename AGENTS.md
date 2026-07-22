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
- **The merchant's shipping selection is PER SERVICE** (`store_shipping_methods`, written by `saveStoreServices`), not per courier — a courier-level list cannot express "I ship JNE Reguler but not JNE YES". `/api/public/ongkir` filters rates by **(platform-enabled couriers) ∩ (picked services)**, keyed `"<courier>:<service_type>"`; **no rows = the merchant never opened the card → fall back to `store_settings.couriers`** rather than render a checkout with zero shipping options. It filtered on the courier column until `35b88a4` and offered services the seller had switched OFF.
- The `cod` flag on a rate is the **effective** one (KiriminAja capability × platform `codAllowed` × the store's `cod_enabled`) — never the raw courier capability.
- **`apps/admin/lib/shipping-quote.ts` is the ONE place a shipping PRICE is produced.** `/api/public/ongkir` quotes the checkout and **`/api/public/order` RE-QUOTES the order before it writes `orders.shipping_idr`** — same function, same origin, same DB weight, same platform∩store service scope. `body.shipping.cost` is **not read** (the storefront no longer sends it): the order stores the price *we* computed for the service the shopper picked (matched on `courier`+`service_type`), and a picked service that is **not in the fresh quote is REJECTED**, never silently re-couriered. Do NOT "validate the client's number against ours" — a tolerance is just a smaller hole. ⚠️ Consequence: a KiriminAja outage now fails the order. Deliberate — a parcel we cannot price is a parcel we cannot ship.
- **Item prices come from `product_variants`, not from the cart.** `items[].price` used to be summed into `orders.subtotal_idr` + the line items, so `price: 0` bought the goods for nothing. The client says WHAT is in the cart (handle + variant + qty); the server says what it costs, what it weighs, and where it ships from.

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
- **⚠️ Money and checkout paths must be EXERCISED, not typechecked.** `astro check` passes clean on bugs inside a client `<script>`: a `ReferenceError: queueSave is not defined` in `checkout.astro` blocked the **entire rate load** — no rates → no COD → **no order at all** — with typecheck, lint and build all green. Only a browser caught it. Same family as `select sum(…) for update` in `requestPayout()`, which Postgres rejects outright (every withdrawal threw) and which `tsc` could not see inside the SQL string. Drive the flow: real browser, 0 console errors, and reconcile what is on screen against SQL.

## Adding a screen
1. Create `app/(admin)/<route>/page.tsx` (client if interactive).
2. Add mock to `lib/mock/store.ts` + (optional) selectors in `lib/data/`.
3. Register it in `lib/nav.ts` (`NAV_GROUPS`).
4. Build + verify console clean + screenshot (Playwright renders charts correctly; `chrome --headless --virtual-time-budget` mis-sizes Recharts).

## Docs
PRD + architecture + data model + decisions live in `~/Documents/Development/tokophi/`. Changelog: `CHANGELOG.md`. `admin/AGENTS.md` = the create-next-app "Next 16 has breaking changes" note.
