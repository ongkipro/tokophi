# TokoΦ — working agreement (read before coding)

## 🤝 MULTIPLE AGENTS SHARE THIS WORKTREE — read this first

More than one Claude runs against this repo, this database and this machine **at the same time**. We
are building one product together, not racing. Everything below was learned by breaking it.

**The shared things you can destroy for someone else in one command:**
- **The database.** `SEED_FORCE=1 npm run seed` / `npm run reset` **TRUNCATE everything** and hand out
  new `store_id`s. Anyone mid-verification loses their data and their logged-in session, silently, with
  no error to tell them why. **Announce before you re-seed. Prefer a targeted SQL write.** If you flip
  a row to test something (e.g. `enabled=true` on a channel), **flip it back** — leave the DB honest.
- **Dev servers.** **Never `pkill -f "astro dev"` / `pkill next`** — that kills *their* server, not just
  yours. Record the PID of what you start (`echo $! > …`) and kill only that PID.
- **The git index.** Other agents leave files **staged**. A bare `git add -A` + `git commit` will
  **swallow their half-finished work into your commit**. Always `git status` first, `git add` explicit
  paths, and commit with a pathspec: `git commit -- path/to/your/file`.
- **Files someone is mid-edit on.** Check `git status` before you touch a file. If it is already
  modified and it isn't yours, **leave it and say so** — or wait. Do not "fix" your way through it.

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

**`git fetch && git log origin/main` BEFORE you start.** Local `main` was once ~90 commits behind, and a
session built a duplicate "foundation" on the stale base — conflicting column names, and a migration that
never applied. Check where you are before you build.

### ⚠️ Two landmines in `packages/db` — both silent, both cost a day
1. **`npm run seed` TRUNCATES.** The reference tables `kiriminaja_areas` and **`kelurahan` (78.764 rows)** are
   preserved by a keep-list. `kelurahan` was **missing from it**, so every reseed silently killed the
   checkout's kodepos auto-fill. **Keep it in the keep-list.**
2. **A migration whose journal `when` is in the FUTURE makes drizzle SKIP later migrations — while printing
   "migrations applied successfully".** `0048`'s `when` is a future timestamp, so a truthfully-stamped `0049`
   was skipped in silence. **Adding `0050`? Check `packages/db/drizzle/meta/_journal.json` first.**

Shopify-style commerce SaaS for Indonesia. **No Themes menu, no Apps/Plugins.** **LIVE on `tokophi.com`** — all **4** surfaces READ PostgreSQL (Docker :5433, Drizzle) and every admin editor WRITES it, plus auth (login/session) + media upload (see Database below). Bahasa Indonesia UI, IDR. **Prod target = self-hosted Postgres + PostgREST on a VPS (NOT Supabase), deferred.** Full spec: **`specs/PRD.md`** (in this repo).

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
Local backend fully wired behind the data layer (all 4 surfaces read + all editors write; auth+RBAC+RLS; real variants). Local dev uses **plain PostgreSQL 16 in Docker** + **Drizzle**. **Counted 2026-07-14: 68 tables · 50 migrations (`0000`–`0049`) · RLS on 43 of the 44 store-scoped tables.** Source of truth = `packages/db/src/schema.ts`; annotated = `specs/docs/SCHEMA.md`. *(The shared dev container reports 69/44 — an unmerged branch's `color_palettes` migration is applied to it. Count the codebase, not the container.)* snake_case, money = bigint IDR. Auth (local, JWT) + RBAC + RLS are done locally; Storage (self-hosted MinIO/S3) comes with the VPS. **RLS** (migration 0012, extended by 0032 `page_templates`, 0035 `support_*`, **0036 `payments` + `media`**) **enforces at runtime**: the admin runs every read (`lib/data/*` via `withCurrentTenant`) + write (`lib/actions/*` via `withTenant`) inside a txn that sets `app.store_id` + `SET LOCAL ROLE tokophi_app`, so tenant queries execute as the non-owner role with policies applied. `npm run verify-rls -w @tokophi/db` derives the store-scoped set from the catalog (every table with a `store_id`) and FAILS if one lacks RLS — **the sole remaining exception is `platform_activity`**, deliberately (it is our audit log *about* tenants). Auth (`lib/auth.ts`, pre-session `store_users` read), super-admin (cross-tenant), and the storefront (`Host`-resolved read-only catalog) stay on the owner connection. On the VPS this becomes PostgREST connecting as `tokophi_app` with the JWT `store_id` claim feeding the GUC. **RBAC** (app-layer, `lib/rbac.ts`) is enforced too.
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
- **Tenant/RLS pattern (IMPORTANT for any new DB code):** admin reads wrap their body in `withCurrentTenant(async (db) => {...})` (`lib/tenant.ts` — reads the session, sets the GUC, drops to `tokophi_app`); admin writes wrap in `withTenant(session.storeId, async (db) => {...})` (session from `requireCapability`). The callback param is named `db` so query bodies read naturally; module-level query helpers take `(db: Tx)`. Do NOT use a bare module-level `db` for admin tenant data — it would run as owner and bypass RLS. Auth/super-admin/storefront are the deliberate exceptions (owner).
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

> ### 🚚 THE RULE: **Kecamatan PRICES the parcel. Kelurahan BOOKS it.**
> `shipping_price` accepts `subdistrict_origin`/`subdistrict_destination` and **silently IGNORES them** — a
> nonsense village id returns identical services at identical costs. **Tariffs are kecamatan-level.**
> The **kelurahan** is what `request_pickup` books against and what a driver reads on the label.
> **Do NOT re-add village ids to the pricing call.** Full flow: `specs/docs/FLOWS.md` §5.

- **The address cascade is kecamatan → kelurahan.** Kota, provinsi and **kodepos** are all DERIVED from the
  pick (KiriminAja returns a `postal_code` per village). The shopper types 4 fields, not 9.
- ⚠️ **The local `kelurahan` table uses BPS/Kemendagri codes (`34.02.13.2004`), NOT KiriminAja ids
  (`31483`) — its ids are NOT BOOKABLE.** Only ids from `POST /api/mitra/kelurahan` can be booked. The local
  table is a name + kodepos fallback and its rows carry **`id: null` on purpose**. A null id books a parcel
  with no village (legal); a **wrong** id books it to the wrong village. **Never invent one.**
- **The order SNAPSHOTS the destination** — `orders.ship_recipient / ship_phone / ship_address /
  ship_district_id / ship_kelurahan_id / ship_kelurahan_name / ship_postcode` (migrations **0042** + **0049**) —
  and `createShipment` books with **those exact ids**. The old code re-resolved the destination from the
  free-text **city name**, which once booked a Surabaya parcel to Lampung. The legacy fallback survives for
  pre-0042 orders but now returns `destinationGuessed` + a warning toast: **a guess must never succeed quietly.**
- **ALWAYS name the couriers in the rate call.** Unfiltered, KiriminAja walks its whole roster: measured
  **5.513 ms / 18 services** vs **512 ms / 14** when the enabled couriers are named. The checkout quotes in
  **two steps** — `scope:"primary"` (the chain SPX → JNE) on first paint, `scope:"all"` only when the shopper
  opens "Lihat kurir lainnya" — both through the **same** `quoteShipping()` the order re-quotes with, so the
  two steps can never produce two prices.
- **Courier policy = `packages/lib/src/couriers.ts` (ADR 0010), not a DB toggle:**
  `SELLER_COURIER_CODES` = spx, jne, jnt, lion, sap, sicepat, idx, anteraja — **the only couriers a SELLER may
  offer** (Super Admin sees everything; **J&T Cargo + TIKI are platform-only**). Baseline = **spx, jne** (SPX is
  the primary + the COD rail; JNE is the backup) — **and it binds only their STANDARD service**: express (JNE
  YES) and economy (SPX Economy) stay the seller's choice. ⚠️ **Match on `group:"regular"`, NEVER on the name —
  JNE's *standard* service is called "JNE Express Reguler"**, so a name-based rule picks the wrong row.
  *(`BASELINE_COURIER_CODES` is still courier-level in code; the policy is service-level — see BACKLOG.)*
  ⚠️ **Availability is per PICKUP ORIGIN, not global: J&T quotes from Jakarta and Yogyakarta origins but NEVER
  from Gubeng (Surabaya). "Enabled" does not mean "the shopper will see it".**
- **COD being SPX-only is OUR policy, not a courier limit** — KiriminAja marks JNE/SiCepat/Lion/Ninja/AnterAja
  COD-capable too. Widening it is a **data change** (`codAllowed`), never `if (courier === "spx")`.

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

## Docs — they live in `specs/`, in this repo
| Doc | Read it when |
|---|---|
| **`specs/docs/FLOWS.md`** | **§5 = shipping end to end** (address cascade → quote → order snapshot → booking → label). **Before touching checkout, ongkir or a shipment.** |
| `specs/docs/CODE_MAP.md` | you need to find where a concern lives |
| `specs/docs/STATUS.md` | **before you trust a number on a screen** — 🟢 real / 🟡 seeded / 🔴 fake |
| `specs/docs/SCHEMA.md` | the DB, generated from the catalog |
| `specs/docs/BACKLOG.md` | what is actually open |
| `specs/PRD.md` · `specs/decisions/` | what the product is · **ADR 0010 = courier policy** |

Changelog: `CHANGELOG.md`. `apps/admin/AGENTS.md` = the "Next 16 has breaking changes" note.
**If a doc disagrees with the code, the code wins — and the doc is a bug. Fix it.**
