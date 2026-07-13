# TokoΦ — working agreement (read before coding)

Shopify-style commerce SaaS for Indonesia. **No Themes menu, no Apps/Plugins.** **Backend live on local PostgreSQL** (Docker :5433, Drizzle): all 3 surfaces READ + all 12 admin editors WRITE the DB, plus local auth (login/session) + local media upload (see Database below). Bahasa Indonesia UI, IDR. **Prod target = self-hosted Postgres + PostgREST on a VPS (NOT Supabase), deferred.** Full spec: `~/Documents/Development/tokophi/PRD.md`.

## Monorepo (npm workspaces) — 3 surfaces
```
tokophi/
  apps/
    admin/        # merchant/store admin (@tokophi/admin) — what a shop owner uses
    super-admin/  # platform control plane (@tokophi/super-admin) — what WE use (manage all stores/plans/billing)
    storefront/   # Astro shopper site (planned, M2)
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
Local backend fully wired behind the data layer (all 3 surfaces read + all editors write; auth+RBAC+RLS; real variants). Local dev uses **plain PostgreSQL 16 in Docker** + **Drizzle** (schema mirrors `~/Documents/Development/tokophi/docs/SCHEMA.md`: **54 tables**, snake_case, money = bigint IDR). Single-tenant MVP: one store "Batik Nusantara" (ADR 0008). Auth (local, JWT) + RBAC + RLS are done locally; Storage (self-hosted MinIO/S3) comes with the VPS. **RLS** (migration 0012, extended by 0032 `page_templates` + 0035 `support_*`) is enabled on **36 of the 39 store-scoped tables** AND **enforces at runtime**: the admin runs every read (`lib/data/*` via `withCurrentTenant`) + write (`lib/actions/*` via `withTenant`) inside a txn that sets `app.store_id` + `SET LOCAL ROLE tokophi_app`, so tenant queries execute as the non-owner role with policies applied. `npm run verify-rls -w @tokophi/db` now derives the store-scoped set from the catalog (every table with a `store_id`) and FAILS if one lacks RLS — ⚠️ **3 known exceptions remain: `media`, `payments`, `platform_activity`** (`media` is merchant data → real gap, tracked in BACKLOG). Auth (`lib/auth.ts`, pre-session `store_users` read), super-admin (cross-tenant), and the storefront (`Host`-resolved read-only catalog) stay on the owner connection. On the VPS this becomes PostgREST connecting as `tokophi_app` with the JWT `store_id` claim feeding the GUC. **RBAC** (app-layer, `lib/rbac.ts`) is enforced too.
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
- **Tenant/RLS pattern (IMPORTANT for any new DB code):** admin reads wrap their body in `withCurrentTenant(async (db) => {...})` (`lib/tenant.ts` — reads the session, sets the GUC, drops to `tokophi_app`); admin writes wrap in `withTenant(session.storeId, async (db) => {...})` (session from `requireCapability`). The callback param is named `db` so query bodies read naturally; module-level query helpers take `(db: Tx)`. Do NOT use a bare module-level `db` for admin tenant data — it would run as owner and bypass RLS. Auth/super-admin/storefront are the deliberate exceptions (owner).
- **Reads pattern:** seed the entity in `packages/db/src/seed.ts` (parity with the mock's mulberry32) → add `lib/data/<entity>.ts` returning the *same flat shape*, body wrapped in `withCurrentTenant` → split the client page into a server wrapper + `*-client.tsx` (props) → point detail routes at `getX(id)`. Impedance columns added where the flat mock shape needs them (e.g. `products.emoji/units_sold`, `store_stats`, `invoices.number`).
- **RBAC pattern:** the role→capability matrix is `lib/rbac-policy.ts` (client-safe: `Role`/`Capability`/`ROLE_CAPS`/`can()`). **Server:** every mutating action calls `await requireCapability("<cap>")` (`lib/rbac.ts`) at the top — this is the security boundary (throws `ForbiddenError`) — and store-scoped creates take `store_id` from the returned session. **UI:** wrap controls the role can't use with `useCan("<cap>")`/`<Can capability="…">` (`components/admin/permissions.tsx`; role flows from the session via `PermissionsProvider` in the admin layout). **All admin editors are gated** (Produk, Diskon, Halaman, Blog, Kategori, Pelanggan, CRM, Segmen, Pembelian, Inventori, Navigasi, Pesanan, Pengaturan) — apply the same `useCan` gating to any NEW editor you add. Caps: `products:write`/`products:delete`, `discounts:write`, `content:write` (halaman/blog/kategori/navigasi), `orders:write`, `inventory:write`, `purchases:write`, `customers:write`, `crm:write`, `media:write`, `settings:write`.
- **Writes pattern (mutations):** `lib/actions/<entity>.ts` with `"use server"` → `const { storeId } = await requireCapability(...)` → `withTenant(storeId, async (db) => { …insert/update… })` → `revalidatePath(...)`; wire the editor's Simpan/Hapus with `useRouter` + `useTransition` (loading state + toast + `router.push`/`refresh`). **Delete = archive** (`status='archived'`) when the row is referenced by history (e.g. products ← `order_line_items`); else hard delete. Filter archived out of the read layer. **Done:** Produk (archive-delete), Diskon, Halaman, Blog, Kategori (hard delete), order-status advance, Inventori bulk stock save, **Navigasi** (menu save = delete+re-insert tree), **Pelanggan** (tags/notes — migration 0010 added `customers.tags`/`notes`), **CRM** (follow-up mark-done → `followups.status`), **Segmen** (create/delete), **Pembelian** (real line-item PO builder → `purchase_orders`+`po_items`; "Terima barang" adds each line's qty to `inventory_levels`; cancel = delete). **All admin editors now persist.**

## Billing & super-admin control (single plan)
- **One plan "TokoΦ"**, all features. `@tokophi/lib/billing`: 3-day trial → **Rp50rb** first month → **Rp275rb/mo** (annual Rp2.7jt). Prices are the **DPP (ex-tax)**; the merchant pays **base + PPN 11%** (`withPpn()`/`baseFromTotal()`) — invoices store the PPN-inclusive total, faktur itemizes DPP+PPN. **Do NOT reintroduce plan tiers** (Pemula/Bisnis/Skala are legacy, unused).
- **Store lifecycle segments** (`storeSegment()`): `trial → first_month → regular → vip`. **VIP = `stores.comped`** — super-admin bypasses billing (free, always active, never billed/suspended; admin `getBilling` + billing cron honor `comped`). Segments drive the super-admin Toko catalog (4 tabs).
- **Super-admin per-store control** (`apps/super-admin/lib/actions.ts`): comp 1 month, extend trial, VIP toggle, reset owner/user password (scrypt), manage store users, suspend/activate — every action audit-logged to `platform_activity` (with `store_id` + `admin` kind).
- **Client "Akun" section** `/akun/{profil,keamanan,langganan}` (NOT under Pengaturan) — tabbed layout; avatar menu links here. Langganan has payment history + printable **`/faktur/[number]`**. Sidebar shows a subscription badge under the logo.
- **Payment-gateway fees** (`@tokophi/lib/payment-fees`, white-label): VA Rp4.000, e-wallet 2,4%, QRIS 1%, retail Rp4.000; merchant picks who bears it (`store_settings.payment_fee_bearer`: seller|buyer|split). Client-admin Pembayaran = grouped channel menu (persists `store_settings.payment_channels`) + Biaya Pembayaran card.
- **Provider brands stay hidden from clients** (KiriminAja/AutoLaris) — generic labels; only super-admin sees brands (ADR 0004).

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

## Adding a screen
1. Create `app/(admin)/<route>/page.tsx` (client if interactive).
2. Add mock to `lib/mock/store.ts` + (optional) selectors in `lib/data/`.
3. Register it in `lib/nav.ts` (`NAV_GROUPS`).
4. Build + verify console clean + screenshot (Playwright renders charts correctly; `chrome --headless --virtual-time-budget` mis-sizes Recharts).

## Docs
PRD + architecture + data model + decisions live in `~/Documents/Development/tokophi/`. Changelog: `CHANGELOG.md`. `admin/AGENTS.md` = the create-next-app "Next 16 has breaking changes" note.
