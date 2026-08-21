# TokoΦ — SCHEMA

> **Generated from the live catalog on 2026-07-14**, not from `schema.ts` and not from memory:
> `docker exec tokophi-db psql -U tokophi -d tokophi` → `pg_class` / `pg_attribute` / `pg_constraint` /
> `pg_enum`, plus `packages/db/drizzle/meta/_journal.json` for the migration list.
> Prior versions of this file claimed **57 tables** and **RLS on 32**. Both were wrong.
>
> Source of truth for the *shape*: `packages/db/src/schema.ts` (Drizzle).
> Source of truth for *what is deployed*: the migration journal.
> This file is the annotated reference over both. **Where they disagree, the catalog wins.**

---

## 1. Headline numbers (verified)

> ⚠️ **Diukur ulang 2026-08-07, dan berkas ini sudah salah DUA kali sebelumnya** — pembukanya sendiri
> mengakui "prior versions claimed 57 tables and RLS on 32. Both were wrong", lalu tetap menerbitkan
> 68/44/46 sampai hari ini. Angka-angka ini DITURUNKAN: hitung dari `packages/db/src/schema.ts` dan
> `drizzle/meta/_journal.json`, atau jalankan `npm run verify-rls`. **Jangan hitung dari container dev
> bersama** — ia memuat `color_palettes` dari PR #2 yang belum di-merge dan belum memuat `cron_runs`,
> jadi totalnya bisa cocok untuk kumpulan tabel yang berbeda.

| Fact | Value | How it was checked |
|---|---|---|
| Tables (`pgTable(` in `schema.ts`) | **81** | `grep -c 'pgTable(' packages/db/src/schema.ts` — dihitung dari KODE, bukan dari container |
| Tabel ber-`store_id` | **54** | keluaran `npm run verify-rls -w @tokophi/db` |
| Di antaranya ber-RLS | **53** | keluaran verifikator yang sama |
| `store_id` tanpa RLS | **1** — `platform_activity` | disengaja: log audit platform, lintas tenant |
| Tabel anak tanpa `store_id` & tanpa RLS | **12**, semuanya sudah ditinjau | verifikator mencetak daftarnya; `AGENTS.md` memuat aturannya |
| Migrasi | **99** (`0000` … `0098`) | `_journal.json` + jumlah berkas `.sql`, keduanya cocok — `0095_payment_request_idempotency` mengunci permintaan tagihan agar idempoten; `0096_order_line_items_order_idx` memasang index yang selama ini hilang di setiap database; `0097_orders_checkout_session` membuat satu checkout hanya bisa membeli sekali; `0098_impersonation_grants` menambah pertukaran sekali-pakai untuk impersonasi (RLS aktif TANPA policy — baris control-plane, hanya jalur owner) |
| DB roles | `tokophi` (owner, bypasses RLS) · `tokophi_app` (non-owner, policies enforce) | `pg_roles` |
| Enums | **46** | `grep -c 'pgEnum(' packages/db/src/schema.ts` |
| Money representation | `bigint`, whole rupiah, column suffix `_idr` | catalog |
| Naming | snake_case; PKs are `uuid default gen_random_uuid()` | catalog |

*(Re-verified 2026-07-14 after **0044** / **0045** — `checkout_sessions` is the 68th table and the 44th
with RLS. The counts moved; the shape of the boundary did not.)*

**44 − 1 = 43.** Every store-scoped table except `platform_activity` is held by the *database*, not by
application code. `platform_activity` is the platform's audit log *about* tenants; a tenant must never
read or write it, so it is deliberately owner-only.

> ⚠️ **Migration `0043_chat` landed while this document was being written** — a peer agent is building
> the chat feature from [`CHAT_SPEC.md`](./CHAT_SPEC.md). Its three tables (`chat_visitors`,
> `conversations`, `conversation_messages`) **are in the database and in the journal**, with RLS, and
> are included below. The application code that reads and writes them was **uncommitted at the time of
> writing**. Treat chat as **schema-real, app-unverified**.

---

## 2. The tenant boundary

Every one of the 44 RLS tables carries the identical policy:

```sql
USING      (store_id = app_current_store_id())
WITH CHECK (store_id = app_current_store_id())
```

```sql
-- migration 0012 — the whole mechanism
create function app_current_store_id() returns uuid language sql stable as $$
  select nullif(current_setting('app.store_id', true), '')::uuid
$$;
```

`packages/db/src/rls.ts#withTenant()` opens a transaction, sets the GUC, and **drops to the non-owner
role** so the policies actually apply. Without the role switch RLS would be written and enabled and
still enforce nothing, because the owner bypasses it:

```ts
export async function withTenant<T>(storeId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.store_id', ${storeId}, true)`);
    await tx.execute(sql`set local role tokophi_app`);
    return fn(tx as unknown as typeof db);
  });
}
```

Unset GUC → `app_current_store_id()` returns NULL → `store_id = NULL` is never true → **zero rows.
It fails closed.** (See `REQUIREMENTS.md` SEC-1.)

**The five deliberate owner-connection exceptions.** Know all of them; they are where tenancy rests on
code rather than on the database:

| Caller | Why it bypasses RLS |
|---|---|
| `apps/admin/lib/auth.ts` | reads `store_users` *before a session exists* — under RLS it would lock everyone out |
| `apps/admin/app/api/public/*` | the shopper has no session, so there is no GUC to set. **The largest RLS hole in the system**: tenant correctness on the checkout path rests on application code passing an explicit `store_id` |
| `apps/admin/app/api/cron/billing` | walks every store by design |
| `apps/storefront` | resolves the tenant from the `Host` header, then reads that store's catalog. **Not read-only any more:** `/api/track` writes `analytics_events` and `/api/checkout-session` writes `checkout_sessions` — both with a **Host-derived** `store_id`. The body has no place to name a store, and would be ignored if it did |
| `apps/super-admin` | cross-tenant by definition. `withTenant` is **never called** anywhere in it (grepped: zero hits) |

---

## 3. Table inventory (all 80)

Row counts are `pg_stat_user_tables.n_live_tup` on the **local demo seed**; they say nothing about
production. A `0` in a table the product claims to depend on is a finding, not a footnote — the ones
that matter are called out in [`STATUS.md`](./STATUS.md).

### 3.1 Identity & tenancy

| Table | Cols | Rows | `store_id` | RLS | Notes |
|---|---:|---:|:--:|:--:|---|
| `accounts` | 4 | 7 | — | — | billing account; owns 1..n stores |
| `users` | 9 | 7 | — | — | `password_hash` = scrypt `salt:hash` |
| `stores` | 18 | 7 | — | — | **the tenant.** `comped` = VIP (never billed, never suspended) |
| `store_users` | 6 | 7 | yes | **YES** | membership + `role` ∈ owner/admin/staff/gudang |
| `store_settings` | 19 | 7 | yes | **YES** | 1:1. Sender address, `couriers[]`, `cod_enabled`, bank details |
| `store_stats` | 6 | 7 | yes | **YES** | 🔴 a rollup that **disagreed with the `orders` it summarised** (one store: rollup Rp42,6jt/210 orders, reality Rp450rb/3). **No longer read by anything** (`571ed17`) |
| `locations` | 5 | 7 | yes | **YES** | stock lives at a location |
| `domains` | 4 | 0 | yes | **YES** | 🔴 **empty and unread** — custom-domain resolution is a `return null` stub |
| `plans` | 6 | 3 | — | — | 🔴 **LEGACY** (Pemula/Bisnis/Skala). Pricing lives in `@tokophi/lib/billing` |

⚠️ `stores.plan` is still the `plan_key` enum defaulting to `'pemula'` even though the product has
**one plan**. Vestigial: the billing engine never consults it.

### 3.2 Catalog

| Table | Cols | Rows | `store_id` | RLS |
|---|---:|---:|:--:|:--:|
| `products` | 23 | 14 | yes | **YES** |
| `product_variants` | 14 | 96 | yes | **YES** |
| `product_options` | 4 | 28 | — | — |
| `product_media` | 5 | 70 | — | — |
| `inventory_levels` | 6 | 96 | — | — |
| `collections` | 15 | 8 | yes | **YES** |
| `collection_products` | 3 | 32 | — | — |
| `collection_conditions` | 5 | 0 | — | — |
| `media` | 9 | 0 | yes | **YES** |
| `color_palettes` | 9 | 0 | yes | **YES** |

`inventory_levels.available` is the **only** stock number in the system. Everything that moves stock —
checkout, cancel, retur, PO receive, the Inventori editor — writes here. See [`UML.md`](./UML.md) §3.

The four tables with **no `store_id`** (`product_media`, `product_options`, `inventory_levels`,
`collection_products`) therefore have **no RLS**: they are reachable only through a parent that does.
That is a deliberate shape, but it means a query that joins to them from the *wrong* parent is not
stopped by the database. Do not write one.

### 3.3 Orders & money

| Table | Cols | Rows | `store_id` | RLS |
|---|---:|---:|:--:|:--:|
| `orders` | 25 | 700 | yes | **YES** |
| `order_line_items` | 7 | 1767 | — | — |
| `payments` | 17 | 685 | yes | **YES** |
| `fulfillments` | 6 | 0 | — | — |
| `ledger_entries` | 11 | 642 | yes | **YES** |
| `payouts` | 10 | 0 | yes | **YES** |
| `invoices` | 18 | 16 | yes | **YES** |

`fulfillments` is **empty and unread**. There is no shipments table: shipment state lives on
`orders.awb` / `.courier` / `.ka_order_id`.

#### `orders` (25 columns)

| Column | Type | Note |
|---|---|---|
| `id` | uuid PK | |
| `store_id` | uuid NOT NULL | tenant key |
| `number` | text NOT NULL | `WEB-xxxxxxxxx` from the storefront; `INV-xxxx` in the seed |
| `customer_id` | uuid | |
| `status` | `order_status` | `baru \| diproses \| dikirim \| selesai \| batal \| retur` — `retur` added by **0039** |
| `financial_status` | `financial_status` | `pending \| dibayar \| refund_sebagian \| refund` |
| `channel` | `order_channel` | attribution only. **There is no ad integration** |
| `subtotal_idr` `discount_idr` `shipping_idr` `tax_idr` `total_idr` | bigint | |
| `city` `province` | text | **buyer-typed free text.** Never gate money on these — see §6 |
| `placed_at` | timestamptz | |
| `awb` | text | 🔴 **NULL on 700/700 local rows.** Written only from a waybill KiriminAja actually returned |
| `courier` | text | 🔴 **NULL on 699/700.** A regular checkout books no shipment |
| `ka_order_id` | text | KiriminAja *booking* reference — **not** a waybill |
| `returned_at` `return_reason` | timestamptz / text | **0039** |
| `ship_recipient` `ship_phone` `ship_address` `ship_postcode` `ship_district_id` | **0042** | the address **snapshot** |

**`awb` vs `ka_order_id` is load-bearing** (fixed in `0b3cdda`). The code used to write
`awb = r.awb ?? r.kaOrderId`, which stamped **our own order id** onto the shipping label under
"No. resi" — an unscannable barcode on a real parcel. `awb` now stays NULL until the courier issues a
real one, and the **KiriminAja sandbox never issues one**, so `awbPending: true` is the normal state
in dev.

**Why `ship_*` is a snapshot and not a lookup** (0042): `customer_addresses` belongs to the *customer*
and changes. Without the snapshot, a buyer who moves house silently moves every past order with them —
reprint an old label and the parcel goes to the wrong door. **The address belongs to the transaction,
not the person.**

#### `payments` (17 columns) — the fee distinction that keeps three screens agreeing

| Column | Meaning |
|---|---|
| `amount_idr` | **what the merchant is owed.** This is what the ledger credits |
| `admin_fee` | the gateway's cut |
| `total` | `amount_idr + admin_fee` — what the shopper pays. **Never the merchant's money** |
| `method` | `transfer \| qris \| ovo \| gopay \| dana \| va \| cod` |
| `status` | `menunggu \| berhasil \| gagal` |
| `provider` | `autolaris` \| `cod` |
| `reff_id` | `= orders.number` |
| `store_id` | NOT NULL since **0036** |

`store_id` was **nullable and NULL on every seeded row** (only production code ever set it). A nullable
tenant key matches no policy, so enabling RLS naively would have made every payment vanish from the
app. Migration 0036 backfills from the parent order, sets NOT NULL + FK, and *only then* enables RLS.

Crediting `amount_idr` (not `total`) is why Dashboard revenue, the Pesanan list and Saldo agree **by
construction** rather than by coincidence.

#### `ledger_entries` (11 columns) — the book

| Column | Meaning |
|---|---|
| `kind` | `sale \| retur \| payout \| adjustment` |
| `status` | `pending \| available` |
| `amount_idr` | **SIGNED.** Negative = money out |
| `order_id` `payment_id` `payout_id` | what the entry is about. `payment_id` added by **0041** |
| `available_at` | when it became withdrawable |

Three **partial unique indexes** make double-credit a database impossibility rather than an
application hope:

| Index | Prevents |
|---|---|
| `ledger_one_sale_per_payment` (0041) | a **retried gateway callback** crediting twice |
| `ledger_one_sale_per_order` (0040) | two payments on one order both booking a sale |
| `ledger_one_retur_per_order` (0040) | a **double-clicked "Retur"** double-refunding |

Plus `ledger_store_status_idx` for the balance query.

**The balance is DERIVED, never stored:**

```sql
saldo tersedia    = Σ amount_idr WHERE store_id = ? AND status = 'available'
dana dalam proses = Σ amount_idr WHERE store_id = ? AND status = 'pending'
```

Live local state (2026-07-14, post-reseed): **642 entries, all `sale`** — 595 `available`
(Rp209.374.000) + 47 `pending` (Rp18.436.000). **`payouts` is 0 rows**: the seed creates no
withdrawals, so the payout / adjustment paths have **no demo data and cannot be exercised by clicking
around**. Exercise them by hand.

#### `payouts` (10 columns)

`status`: `menunggu → diproses → selesai | gagal`. `bank_name` / `bank_account` / `bank_holder` are a
**snapshot taken at request time** — editing the bank account later must not rewrite where past money
went. `note` carries the rejection reason.

### 3.4 Customers & CRM

| Table | Cols | Rows | `store_id` | RLS |
|---|---:|---:|:--:|:--:|
| `customers` | 16 | 24 | yes | **YES** |
| `customer_addresses` | 9 | 24 | — | — |
| `customer_segments` | 7 | 6 | yes | **YES** |
| **`checkout_sessions`** | **22** | **994** | yes | **YES** |
| `reviews` | 10 | 8 | yes | **YES** |
| `leads` | 9 | 12 | yes | **YES** |
| `followups` | 10 | 10 | yes | **YES** |
| `wa_templates` | 5 | 6 | yes | **YES** |
| `wa_messages` | 7 | 0 | yes | **YES** |
| `notification_templates` | 6 | 0 | yes | **YES** |

`customer_addresses` had a schema and **zero rows** until `e81cfb8` — which is precisely why the order
detail page invented street addresses (`Jl. Merdeka No. {hash % 90}`). It now seeds 24.
`wa_messages` + `notification_templates` are **empty and unread**: WhatsApp is a `wa.me` deep link, not
an API integration.

#### `customers` — guest vs registered (**0044**)

| Column | Type | Meaning |
|---|---|---|
| `registered_at` | timestamptz | **NULL = guest.** Buying **never** requires an account — a registration wall in front of an Indonesian checkout is the most reliable way to lose the sale. Guest is the *normal* case, not a defect, and the UI's `Tamu` badge is deliberately neutral (`components/admin/pelanggan/account-badge.tsx`) |
| `password_hash` | text | scrypt `salt:hash`, same shape as `users`. 🔴 **No reader today** — there is no shopper login; the column is provisioned, not wired |
| `last_order_at` | timestamptz | backfilled by 0044 from `max(orders.placed_at)`. Nothing else was inferred: **every pre-existing customer stayed a guest**, because none of them ever had an account to register with. Marking them "registered" would have been inventing a fact |

Local seed: **7 registered · 17 guest**. The identity that actually does the work is the **phone**:
Indonesian shoppers hand over a WhatsApp number far more readily than an email, and WhatsApp is the
channel every follow-up travels on.

#### `checkout_sessions` (22 columns, **0044** + **0045**) — the abandoned checkout

Indonesia abandons **82–83%** of carts against a ~70% global figure (market research, not our
measurement), and we recorded **none** of them. Worse, the CRM was already showing `keranjang`
follow-ups with a WhatsApp template ready to send — and **there was no cart behind any of them**.

| Column | Type | Note |
|---|---|---|
| `id` | uuid PK | |
| `store_id` | uuid NOT NULL | tenant key, RLS. Always **Host-derived** — never from the request body |
| `session_id` | text NOT NULL | the **same** id the funnel beacons carry (`Analytics.astro`, `sessionStorage` `tphi:sid`) — so a cart joins to its own journey |
| `customer_id` | uuid | set when the session becomes an order (the guest finally has a customer row) |
| `name` `phone` `email` | text | **`phone` is the field this table is paid for.** Recovery travels on WhatsApp |
| `address` `city` `province` `postcode` `district_id` | text / int | what they had typed when they stopped |
| `items` | jsonb | array of `{handle,name,variant,qty,price}` — a **snapshot** at the price the shopper actually saw, not today's price |
| `subtotal_idr` `shipping_idr` | bigint | |
| `step` | `checkout_step` | `keranjang \| kontak \| alamat \| pengiriman \| pembayaran` — the **furthest** step reached, never the current one |
| `status` | `checkout_status` | `aktif \| ditinggal \| pulih \| kedaluwarsa` |
| `abandoned_at` | timestamptz | **0045.** When it was judged abandoned — see below |
| `recovered_order_id` `recovered_at` | uuid / timestamptz | stamped by `/api/public/order` when *this* session becomes *that* order |
| `created_at` `updated_at` | timestamptz | `updated_at` **is** the moment it went quiet: the last time anyone touched it |

| Index | Why |
|---|---|
| `checkout_sessions_store_session_uq` UNIQUE `(store_id, session_id)` | the row is written **as the shopper types**; typing must UPDATE one row, not leave a trail of half-filled duplicates |
| `checkout_sessions_store_status_idx` `(store_id, status, updated_at)` | the query the merchant actually runs ("what was abandoned, newest first") **and** the ageing sweep |

**There is no "abandon" event to listen for.** Abandonment is the *absence* of an order, so nothing
fires. The row is therefore captured **progressively** (`apps/storefront/src/pages/api/checkout-session.ts`
— the only writer from the shop) and judged later by what never happened to it. A session goes
`aktif → ditinggal` after **60 minutes** of silence, via an opportunistic sweep in that same endpoint
(max once a minute per SSR process). **No cron.**

**Why `abandoned_at` exists at all (0045) — it is a correctness control, not a convenience.** A
checkout that sailed **straight through** also ends as `status='pulih'`. Without a column that says
*this one first went quiet*, the two are indistinguishable after the fact, and the obvious formula
`pulih / (pulih + ditinggal)` reports **19,3%** on the local data where the honest one reports
**11,2%** — it would tell a shop it "rescued" every ordinary sale it ever made.

```sql
rescued       = abandoned_at IS NOT NULL AND recovered_at IS NOT NULL   -- a save
straight-thru = abandoned_at IS NULL     AND recovered_at IS NOT NULL   -- an ordinary sale, NOT a save
abandonRate   = ditinggal / (ditinggal + orders)
recoveryRate  = rescued   / (rescued + ditinggal)
```

Live local state (store `batik-nusantara` — slug since renamed to `batiknusantara`; 30-day window anchored at `CHECKOUT_TODAY=2026-07-02`):
**792 `ditinggal` · 198 orders · 100 rescued · 90 straight-through** → abandonRate **80,0%**,
recoveryRate **11,2%**. `aktif` sessions are excluded from **both** sides of both ratios: the shopper
is still typing, and nobody has abandoned anything yet.

### 3.5 Purchasing & stock

| Table | Cols | Rows | `store_id` | RLS |
|---|---:|---:|:--:|:--:|
| `suppliers` | 6 | 4 | yes | **YES** |
| `purchase_orders` | 9 | 6 | yes | **YES** |
| `purchase_order_items` | 6 | 21 | — | — |
| `stock_transfers` | 6 | 0 | yes | **YES** |

`stock_transfers` is **empty and has no UI**.

### 3.6 Content & storefront

| Table | Cols | Rows | `store_id` | RLS |
|---|---:|---:|:--:|:--:|
| `pages` | 9 | 7 | yes | **YES** |
| `blogs` | 4 | 2 | yes | **YES** |
| `articles` | 14 | 6 | yes | **YES** |
| `menus` | 4 | 2 | yes | **YES** |
| `menu_items` | 7 | 17 | — | — |
| `page_templates` | 8 | 0 | yes | **YES** |

🔴 `blogs` + `articles` have rows and the admin has a full editor — but **the storefront `/blog` route
renders four hardcoded articles from a source literal and never reads either table.** The merchant's
blog editor publishes into a void.

`page_templates` is the Store Builder (ADR 0009): `type` ∈ `homepage | category | product`, `sections`
= the JSON the Puck editor writes and the Astro `SectionRenderer` reads. The contract lives in
`@tokophi/sections` (**types only, zero runtime**) so the editor and the renderer cannot drift.
**0 rows locally** — every storefront currently falls back to `SECTION_DEFAULTS`, which ships **fake
testimonials** and a "Gratis Ongkir" marquee onto a live shop.

### 3.7 Marketing & analytics

| Table | Cols | Rows | `store_id` | RLS |
|---|---:|---:|:--:|:--:|
| `discounts` | 11 | 6 | yes | **YES** |
| `discount_usages` | 4 | 0 | — | — |
| `ad_channels` | 16 | 3 | yes | **YES** |
| `ad_metrics` | 11 | 11 | yes | **YES** |
| `analytics_daily` | 6 | 122 | yes | **YES** |
| `analytics_events` | 6 | 47804 | yes | **YES** |
| `store_tracking_channels` | 11 | 0 | yes | **YES** |
| `tracking_event_deliveries` | 15 | 0 | yes | **YES** |

🔴 `ad_channels` / `ad_metrics` are still **demo/label data** — spend, impressions, ROAS and campaign
lists were deleted (`62df4a1`) because a merchant could have raised a real ad budget against a return
that never happened. Do NOT read them as live numbers.

🟢 **`store_tracking_channels` + `tracking_event_deliveries` (0079/0080, ADR 0012) ARE live** — this is
the real conversion tracking, and it is deliberately SEPARATE from `ad_channels` above.

**Catalog identity (0081, ADR 0013).** `products.number` is a per-store, allocate-once number and
`product_variants.seq` its per-product counterpart; together they form the catalog id
(`{number}-{seq}`) that `/feed/google.xml`, `/feed/tiktok.xml` and every conversion `content_ids` use.
`products.variant_seq_next` is a high-water mark that NEVER decreases — reissuing a deleted variant's
number would re-point a live Meta/Google catalog item at a different SKU. `store_counters` holds the
allocation counter (its own table, not a column on `stores`, so a product create does not row-lock the
row billing and settings also write). `stores.catalog_id_scheme` decides which id a store publishes:
existing stores stay on the legacy `handle` scheme because switching re-keys an already-ingested
catalog, which no provider can undo.

`store_tracking_channels` — the merchant's own pixel config, one row per (store, channel):

| Column | Meaning |
|---|---|
| `channel` | `meta` · `google` · `tiktok` (`ad_channel_key`) |
| `enabled` | browser pixel on — the storefront renders it |
| `pixel_id` | Meta Pixel ID · GA4 Measurement ID · TikTok Pixel ID. **PUBLIC** (ships in storefront JS), so plaintext |
| `capi_enabled` | server-side conversions on (Conversions API / Measurement Protocol / Events API) |
| `capi_token_ciphertext` | **SECRET** — AES-256-GCM, `v1:iv:tag:ct`, key `INTEGRATION_TOKEN_KEY` (`apps/admin/lib/crypto.ts`). Never selected into a client component; the UI only learns `capiConfigured: boolean` |
| `advanced_matching` | opt-in: hash + send buyer email/phone with events |
| `test_event_code` | Meta/TikTok test-events code, blank when live. **Not a sandbox** — Meta documents that events carrying it still flow into Events Manager and are used for targeting |
| `ads_send_to` | **Google Ads** conversion destination (`AW-123456789/AbC-D_efGh`), migration 0082. Separate from `pixel_id`, which for this channel is the GA4 `G-…` tag: a GA4 event records nothing in Google Ads, so a merchant running both needs both fields |

`tracking_event_deliveries` — **the queue itself** (there is no worker process; ADR 0012 §0.1). Written
by `apps/admin/lib/tracking-events.ts` after a committed order, drained by
`apps/admin/app/api/cron/tracking-events/route.ts` (docker sidecar `cron-tracking-events`, every 60s).

| Column | Meaning |
|---|---|
| `event_id` | `purchase:{order_number}` — the SAME string the browser pixel sends as `eventID`. This is the de-duplication (ADR 0012 §14.3). No store id: `orders.number` is already platform-unique, and the tenant key does not belong in three ad platforms' logs |
| `status` | `queued` → `processing` → `succeeded` \| `failed` (retry) \| `dead_letter` (`tracking_delivery_status`) |
| `attempt_count` / `next_attempt_at` | attempt² minutes + jitter, 6 attempts, then `dead_letter`. `attempt_count` is incremented BY THE CLAIM, not by the outcome — a tick killed mid-send must still consume an attempt or a poison row loops forever. A **prepaid** order's row is parked at `2126-01-01` (held) until the payment callback releases it |
| `payload` | commerce facts — `value` (total), `goods` (ex-ongkir, ex-PPN: GA4 defines its `value` on this), `shipping`, `tax`, `lineItems[]` (id, price, qty), `currency`, `contentIds`, `numItems`, `orderNumber`, `occurredAt` — **plus a `client` object of MATCH KEYS**: `userAgent`, `ip`, `fbp`, `fbc`, `gaClientId`, `ttp`, `ttclid`. ⚠️ That IS personal-ish data (a device string and an IP), stored only because the send is asynchronous — by the time the cron runs, the shopper's request is gone. **No email, phone or token**: identity is fetched fresh at send time, hashed inside the sender, never persisted (§9.4/§25). This row previously said "commerce facts ONLY … no PII", which was not true |
| *(retention)* | **30 days, purged on the cron tick** (`delete … where created_at < now() - interval '30 days'`, 500 rows max per tick). Unconditional on status: a held row for a VA that was never paid, and a dead-lettered row parked a year out, carry the same match keys and describe a sale a month gone. Every provider's own event window is shorter (Meta 7 days, GA4 72 h), so nothing purgeable was ever still deliverable. Before 2026-07-31 nothing deleted from this table at all |
| `last_error_message` | provider error, already stripped of anything token-shaped (`lib/capi-sanitize.ts`) — a merchant reads this on screen |

`unique(store_id, channel, event_id)` is what makes the enqueue idempotent: a repeated payment
callback, a double checkout submit, or a re-run cannot create a second conversion.

`analytics_events` (**0037**) — the one table the funnel is counted from:

| Column | Values |
|---|---|
| `type` | `visit` · `product_view` · `add_to_cart` · `checkout_start` · `purchase` |
| `device` | `ponsel` · `desktop` · `tablet` |
| `session_id` | opaque, client-generated |

Written by **exactly one place**: `apps/storefront/src/pages/api/track.ts`. Local rows: 47.804 across
the 5 types — **still overwhelmingly seeded**.

### 3.8 Support & chat

| Table | Cols | Rows | `store_id` | RLS |
|---|---:|---:|:--:|:--:|
| `support_tickets` | 6 | 2 | yes | **YES** |
| `support_messages` | 6 | 3 | yes | **YES** |
| `chat_visitors` | 11 | 3 | yes | **YES** |
| `conversations` | 14 | 4 | yes | **YES** |
| `conversation_messages` | 8 | 9 | yes | **YES** |

Two different things, deliberately two different table sets (CHAT_SPEC Decision 1):

- `support_*` = **merchant ⇄ platform** (`/bantuan`, super-admin `/tiket`). RLS retrofitted by **0035**.
- `chat_*` / `conversation*` = **shopper ⇄ merchant** — migration **0043**, landing now.
  `conversation_messages.store_id` is denormalised on purpose so the RLS policy is the same one-liner
  as everywhere else. `chat_visitors.ip_hash` = `sha256(ip + AUTH_SECRET)` — never the raw IP.

### 3.9 Platform (control plane)

| Table | Cols | Rows | `store_id` | RLS |
|---|---:|---:|:--:|:--:|
| `platform_admins` | 6 | 1 | — | — |
| `platform_activity` | 5 | 4 | **yes** | **— (deliberate)** |
| `impersonation_grants` (0098) | 10 | 0 | **yes** | **yes — dan TANPA policy, disengaja** |
| `platform_cod` | 5 | 1 | — | — |
| `platform_couriers` | 4 | 12 | — | — |
| `platform_payment_channels` | 6 | 15 | — | — |
| `platform_payment_gateways` | 5 | 1 | — | — |
| `platform_payout` | 4 | 1 | — | — |
| `shipping_aggregator` | 4 | 1 | — | — |
| `store_payment_methods` | 4 | 0 | yes | **YES** |
| `store_shipping_methods` | 5 | 11 | yes | **YES** |
| `kiriminaja_areas` | 7 | 7030 | — | — |

| Table | What it holds |
|---|---|
| `impersonation_grants` | Pertukaran **sekali pakai** untuk "Buka Dashboard Seller" (0098). Menyimpan `sha256(handle)` — bukan handle-nya. Dihabiskan oleh SATU `update … set consumed_at = now() where token_hash = $1 and consumed_at is null and expires_at > now()`: replay, tamper, dan kedaluwarsa sama-sama mencocokkan **nol baris**. RLS **aktif tanpa policy** — ini baris control-plane, ditulis super-admin dan dibaca jalur auth admin *sebelum* ada sesi, keduanya lewat koneksi owner; `tokophi_app` melihat 0 baris (diukur). Policy ber-`app.store_id` justru lebih LEMAH dan tampak seperti perlindungan |
| `platform_cod` | `enabled`, `max_amount_idr` (seeded Rp2.000.000), `allowed_provinces` (jsonb, seeded 6), `fee_pct` 🔴 **unread** |
| `platform_couriers` | `courier`, `services` (jsonb), `enabled`. 12 rows: `anteraja jne jnt lion ninja sap sicepat spx` enabled · `idx jtcargo pos tiki` disabled |
| `platform_payout` | single row: `release_on` (`'selesai'`), `min_payout_idr` (50.000), `auto_approve` 🔴 **unread** |
| `kiriminaja_areas` | 7.030 districts — the lookup that makes `provinceForDistrict(destId)` possible |

`store_shipping_methods` (`store_id`, `courier`, `service`, `enabled`) is the merchant's **per-service**
shipping selection — what the Jasa Kirim card in Pengaturan writes, and what `/api/public/ongkir` filters
the live rates by, keyed `"<courier>:<service_type>"`. It exists because `store_settings.couriers` (a
courier-level `text[]`) **cannot express "I ship JNE Reguler but not JNE YES"**. ⚠️ Until `35b88a4` the
public rates endpoint read the courier list and **ignored this table**, so every service a seller had
switched off was still offered at checkout. `store_settings.couriers` survives as the **fallback** for a
store with no rows here (a merchant who never opened the card must not get a checkout with zero shipping
options). `store_payment_methods` remains **empty and unread**.

✅ **`platform_couriers.services` holds the `{type,name,group,cod,codAllowed}` objects** that
`getCodPolicy()` expects — the seed used to write plain strings (`["Reguler","Same Day"]`), which
`getCodPolicy()` skips, so a freshly seeded DB had **zero** COD-allowed services and COD could not be
exercised at all until someone pressed "Sync dari KiriminAja". Fixed: the seed now writes objects with
`codAllowed = cod && courier === "spx"` (the platform policy), giving a fresh DB 2 COD-allowed services
— SPX Standard (`type=1`) and SPX Economy (`type=3`). `540af0a` completed the picture: the seed also
writes `store_settings.cod_enabled = true` for Batik Nusantara and 11 `store_shipping_methods` rows, so
**COD is exercisable end-to-end on a fresh clone with no API key and no clicking.**

---

## 4. Enums (45)

| Enum | Values |
|---|---|
| `order_status` | `baru` `diproses` `dikirim` `selesai` `batal` `retur` |
| `checkout_status` | `aktif` `ditinggal` `pulih` `kedaluwarsa` — **0044** |
| `checkout_step` | `keranjang` `kontak` `alamat` `pengiriman` `pembayaran` — **0044**, ordered; `step` only moves forward |
| `financial_status` | `pending` `dibayar` `refund_sebagian` `refund` |
| `order_channel` | `meta_ads` `google_ads` `tiktok_ads` `organic` `other` |
| `payment_method` | `transfer` `qris` `ovo` `gopay` `dana` `va` `cod` |
| `payment_status` | `menunggu` `berhasil` `gagal` |
| `ledger_kind` | `sale` `retur` `payout` `adjustment` |
| `ledger_status` | `pending` `available` |
| `payout_status` | `menunggu` `diproses` `selesai` `gagal` |
| `store_status` | `trial` `active` `past_due` `suspended` |
| `store_user_role` | `owner` `admin` `staff` `gudang` |
| `invoice_status` | `dibayar` `menunggu` `gagal` |
| `product_status` | `active` `draft` `archived` |
| `content_status` | `terbit` `draft` |
| `customer_segment` | `baru` `reguler` `loyal` `vip` |
| `discount_kind` | `persen` `nominal` `gratis_ongkir` |
| `discount_status` | `aktif` `terjadwal` `nonaktif` |
| `collection_type` | `manual` `otomatis` |
| `collection_match` | `all` `any` |
| `condition_field` | `tag` `title` `type` `price` `stock` `category` |
| `condition_operator` | `eq` `neq` `gt` `lt` `contains` |
| `po_status` | `draft` `dipesan` `sebagian` `diterima` |
| `transfer_status` | `draft` `dikirim` `diterima` `batal` |
| `lead_source` | `whatsapp` `instagram` `tiktok` `referral` `marketplace` |
| `lead_stage` | `baru` `dihubungi` `nego` `closing` `menang` `kalah` |
| `followup_type` | `keranjang` `pembayaran` `konfirmasi` `pascabeli` `repeat` `ulasan` |
| `followup_status` | `menunggu` `terkirim` `dibalas` `selesai` |
| `page_template_type` | `homepage` `category` `product` |
| `menu_item_type` | `home` `collection` `product` `page` `blog` `url` `catalog` |
| `review_status` | `terbit` `menunggu` |
| `ticket_status` | `open` `answered` `closed` |
| `conversation_status` | `open` `snoozed` `closed` |
| `chat_visitor_status` | `active` `blocked` |
| `message_sender` | `customer` `merchant` `system` |
| `platform_activity_kind` | `signup` `upgrade` `payment` `churn` `support` `admin` |
| `notification_channel` | `email` `wa` |
| `fulfillment_status` | `menunggu` `diproses` `dikirim` `terkirim` `batal` |
| `ad_channel_key` | `meta` `google` `tiktok` |
| `plan_key` | `pemula` `bisnis` `skala` — 🔴 **LEGACY** |
| `gateway_provider` | `midtrans` `xendit` `duitku` `autolaris` — only **autolaris** is real |
| `aggregator_provider` | `biteship` `rajaongkir` `shipper` `kiriminaja` — only **kiriminaja** is real |

---

## 5. Migration journal (46 — `0000` → `0045`)

From `packages/db/drizzle/meta/_journal.json`. Drizzle's auto-generated names are noise; the ones that
carry meaning were named by hand.

| # | Tag | What it does |
|---|---|---|
| 0000–0011 | *(auto-named)* | initial schema build-out |
| **0012** | `tenant_rls` | **the tenant boundary** — `app_current_store_id()`, the `tokophi_app` role, `tenant_isolation` policies |
| 0013–0031 | *(auto-named)* | feature columns: `platform_admins` (0013), real variants, media, brand colour, sender address, billing fields, `customers.tags/notes`, `support_*` (0030), `kiriminaja_areas` … |
| **0032** | `page_templates_rls` | Store Builder templates (ADR 0009) under RLS |
| 0033–0034 | *(auto-named)* | Tema / named template variants |
| **0035** | `support_rls` | RLS retrofit for `support_tickets` / `support_messages` |
| **0036** | `payments_media_rls` | RLS on `payments` + `media`. Backfills `payments.store_id`, sets NOT NULL + FK, **then** enables RLS |
| **0037** | `analytics_events_device` | `analytics_events.device` + `(store_id, ts)` index → the funnel becomes a **count** |
| **0038** | `cod_toggle` | `store_settings.cod_enabled` (default **false**) |
| **0039** | `order_retur` | `order_status += 'retur'`, `orders.returned_at`, `orders.return_reason` |
| **0040** | `ledger_payouts` | `ledger_entries`, `payouts`, `platform_payout` + RLS + the sale/retur unique indexes |
| **0041** | `ledger_credit_sale` | `ledger_entries.payment_id` + `ledger_one_sale_per_payment` + an **idempotent backfill** of every already-collected payment |
| **0042** | `order_address_snapshot` | `orders.ship_*` — the address the parcel was actually sent to |
| **0043** | `chat` | `chat_visitors`, `conversations`, `conversation_messages` + RLS — **in flight** |
| **0044** | `customers_and_abandoned_checkout` | `customers.registered_at` (**NULL = guest**) / `password_hash` / `last_order_at` (backfilled from `orders`) + the new **`checkout_sessions`** table, its two indexes and its RLS policy |
| **0045** | `checkout_abandoned_at` | `checkout_sessions.abandoned_at` + a backfill of every existing `ditinggal` row from `coalesce(updated_at, created_at)`. **Without this column a "recovery rate" is a lie** — see §3.4 |
| **0079** | `store_tracking_channels` | per-store Meta/Google/TikTok pixel + CAPI config, `unique(store_id, channel)` + RLS (ADR 0012) |
| **0080** | `tracking_event_deliveries` | the server-side conversion QUEUE + `tracking_delivery_status` enum, `unique(store_id, channel, event_id)`, due/store indexes + RLS (ADR 0012) |
| **0082** | `google_ads_send_to` | `store_tracking_channels.ads_send_to` — the Google Ads conversion destination, so GA4 and Google Ads can both be configured (ADR 0012) |
| **0081** | `product_numbering` | `products.number` (per-store, `unique(store_id,number)`) + `products.variant_seq_next` + `product_variants.seq` (`unique(product_id,seq)`) + `store_counters` (RLS) + `stores.catalog_id_scheme`; deterministic one-shot backfill (ADR 0013) |

```bash
docker compose up -d db            # PostgreSQL 16 @ localhost:5433
npm run migrate  -w @tokophi/db    # apply (canonical)
npm run generate -w @tokophi/db    # after editing src/schema.ts
npm run seed     -w @tokophi/db    # idempotent — TRUNCATES first
npm run reset    -w @tokophi/db    # drop public + drizzle schemas
npm run verify-rls -w @tokophi/db  # prove isolation under tokophi_app
```

⚠️ **The seed truncates every table.** Anything it does not re-insert is silently empty afterwards.
That is exactly how `platform_payout` became a policy table with **zero rows** while the super-admin
screen displayed a policy that did not exist in the database — and how a silent crash mid-seed
(`ab68abe`) left every table after the crash point empty while the seed reported success.

---

## 6. Two schema facts that are security controls

**1. `orders.province` / `orders.city` are buyer-typed free text. They must never gate money.**
The COD province check resolves the province from `orders.ship_district_id` → `kiriminaja_areas` →
`provinceForDistrict()`, because the district id is what the parcel is *actually booked against* and
cannot disagree with where the package goes. A hostile client can type "DKI Jakarta" and ship to Papua;
it cannot forge a district id that prices to a different province.

**2. `platform_cod.fee_pct` exists, is seeded to `0`, and NOTHING READS IT.** Two grep hits in the
entire repo: the schema definition and the seed. **There is no COD fee.** It is a column, not a feature.

---

## 7. Known dead schema (kept because dropping is destructive)

| Object | Why it is dead |
|---|---|
| `store_settings.payment_fee_bearer` | **the fee-bearer feature does not exist.** `packages/lib/src/payment-fees.ts` has **zero importers** anywhere in the repo. The tab that wrote it was removed |
| `store_settings.payment_channels` | same tab. The storefront reads the *platform's* channel list (ADR 0004) |
| `store_stats` | a rollup that contradicted `orders`. No longer read |
| `plans`, `plan_key`, `stores.plan` | legacy 3-tier pricing. The product has **one** plan |
| `fulfillments` | never written, never read |
| `store_payment_methods` | superseded by the platform channel list (ADR 0004). *(`store_shipping_methods` is **not** dead — it is the per-service shipping selection the checkout filters on; see §3.)* |
| `domains` | custom-domain resolution is a `return null` stub |
| `wa_messages`, `notification_templates` | WhatsApp is a `wa.me` deep link, not an API |
| `platform_cod.fee_pct`, `platform_payout.auto_approve` | stored, never read |
| `customers.password_hash` | provisioned by 0044 for a shopper login that **does not exist yet** — storefront `/akun` is still a demo form. Nothing writes it and nothing reads it |
| `discount_usages`, `collection_conditions`, `stock_transfers`, `color_palettes`, `media`, `page_templates` | 0 rows locally — schema exists, demo data does not |

**Rule:** anything in this table that is *also displayed in a UI* is a lie waiting to happen. None
currently is. Keep it that way.
