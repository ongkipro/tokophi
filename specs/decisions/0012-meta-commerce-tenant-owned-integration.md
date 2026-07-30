# ADR 0012 — Meta Commerce integration uses tenant-owned assets

**Status:** accepted  
**Date:** 2026-07-28  
**Scope:** TokoΦ merchant admin ("Seller"), storefront, backend (Next.js server actions + cron-triggered API routes — TokoΦ has **no** separate worker app; see §0), and super-admin diagnostics  
**Primary implementation mode:** AI terminal development  

> **Renumbered 0010 → 0012 on intake.** The source draft was numbered 0010, but **0010 is reserved for the courier policy** (referenced in `AGENTS.md`/`CLAUDE.md` and `packages/lib/src/couriers.ts`) and **0011 is the Google product taxonomy**. 0012 is the next free number. **Read §0 first** — it maps this ADR's generic assumptions onto TokoΦ's actual conventions, and its rules override the generic text below wherever they conflict.

---

## 0. TokoΦ repository alignment (read first — overrides the generic text below)

The body of this ADR is provider-conservative and mostly correct, but it was drafted against a generic
platform shape. These bindings map it onto TokoΦ's **actual** repo (`/home/fantastico/projects/tokophi`,
monorepo `apps/{admin,super-admin,storefront,landing}` + `packages/{ui,lib,db}`). Where a rule here
conflicts with the generic sections, **this section wins**.

- **0.1 No worker app; the queue IS a DB table drained by a cron-triggered route.** TokoΦ has no
  BullMQ/Redis/worker process. Background work follows the existing pattern:
  `apps/admin/app/api/cron/tracking/route.ts` (a secured Next.js API route hit on a schedule) drains
  rows and updates them. So **`§6`/`§18`'s "Catalog Sync Worker" / "Event Delivery Worker" / `apps/worker`
  become `apps/admin/app/api/cron/meta-*/route.ts` that select a bounded batch from `meta_sync_jobs` /
  `meta_event_deliveries` and process it per tick.** Copy the tracking route's shape exactly: `runtime =
  "nodejs"`, `dynamic = "force-dynamic"`, gated by **`CRON_SECRET`** (header `x-cron-secret` OR `?secret=`,
  **fail-closed in production** — `tracking/route.ts:63-73`), a capped `BATCH` (100) with a fairness
  `ORDER BY` so no row starves, one external call per row inside a per-item `try/catch`, forward-only and
  idempotent. Trigger it with a new `cron-meta-*` **docker-compose sidecar** (`docker-compose.coolify.yml`,
  next to `cron-tracking`'s `while true; wget …; sleep 900` loop) — **not** Vercel Cron (this repo has none).
  The `meta_sync_jobs` + `meta_event_deliveries` tables ARE the queue (status + `next_attempt_at` +
  `locked_at`/`locked_by` lease). Do **not** introduce a queue package.
  - ⚠️ **RLS does NOT protect an unwrapped cron query.** A cron drains ALL stores, but `withTenant` is
    per-store. Either loop stores and wrap each batch in `withTenant(storeId, …)`, or read on the owner
    connection with an **explicit `store_id` filter on every query** (the tracking cron reads `orders`
    cross-tenant on the owner `db` — do NOT copy that without adding explicit scoping for Meta rows).

- **0.2 Relationship to the EXISTING Google feed (ADR 0011) — this is the key architectural nuance,
  AND it forces a correction to §10.** The storefront already serves
  `apps/storefront/src/pages/feed/google.xml.ts`, a **PULL** catalog that Meta Commerce *can ingest today*
  (its own header comment says it serves "Google Merchant / Meta / TikTok"). This ADR adds a **PUSH** sync
  via the Meta Catalog API — an **upgrade** (real-time updates + exact `content_ids` for CAPI matching),
  **not** a prerequisite.
  - ⚠️ **`retailer_id` conflict:** the feed emits `<g:id>` = **`p.handle`** (single-variant) or
    **`` `${p.handle}-${i+1}` ``** (multi-variant, 1-based ordinal) — `google.xml.ts:41`, with
    `item_group_id = p.handle` (`:44`). This is the PRODUCT HANDLE, **not** the `tokophi:{store_id}:{id}`
    UUID scheme §10 mandates. If the push used §10's scheme, Meta would see the feed's items and the
    pushed items as **two different products** → a duplicated catalog.
  - **MVP DECISION (overrides §10):** the retailer-id generator MUST reproduce **exactly what the feed
    emits today** (`handle` / `handle-{ordinal}`), so the feed and the push address the same catalog
    items. This is the non-breaking choice (a merchant who already pasted the feed URL into Merchant
    Center / Meta keeps working). Accept §10's downside for MVP: the handle+ordinal id is
    position-dependent, so **renaming a handle or reordering variants re-keys the item** — document this
    ceiling (`// lazy:`), and treat "unify both feed AND push on a stable, handle-independent id" as a
    follow-up ADR (it would re-key every already-ingested catalog, so it needs its own migration + merchant
    comms). Extract ONE shared `retailerId(product, variantIndex)` helper and make **both** `google.xml.ts`
    and the push adapter call it, so they can never drift.
  - MVP MAY even skip the push entirely at first — connect Meta, keep the catalog on the existing feed URL,
    and build only CAPI events (whose `content_ids` then use the same handle scheme). Push sync (Phase 5)
    is the *target*, staged after events.

- **0.3 `ad_channels` stays; new state lives in dedicated `meta_*` tables.** `ad_channels`
  (`packages/db/src/schema.ts`, `adChannelKey` enum `meta|google|tiktok`) is analytics/marketing-dashboard
  data — keep it untouched. All connection/mapping/job/delivery/audit state goes in the new tables of `§9`.

- **0.4 Tenant isolation is non-negotiable and already has a strict pattern.** Every store-scoped table
  gets RLS (migration `0012_tenant_rls` style: `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY
  "tenant_isolation" … USING (store_id = app_current_store_id())`). Admin reads wrap in
  `withCurrentTenant(async (db) => …)`, writes in `withTenant(storeId, async (db) => …)`
  (`apps/admin/lib/tenant.ts`). **CHILD-TABLE RULE** (see AGENTS.md — this class has shipped FIVE
  cross-tenant bugs): any table with no `store_id` (none of `§9`'s should lack it — give them all
  `store_id`) or any write keyed on a foreign id MUST re-read the parent from an RLS'd table in the same
  txn and bail if empty. `npm run verify-rls -w @tokophi/db` MUST stay green. Storefront + the public
  event-collection endpoint run on the OWNER connection with an EXPLICIT `store_id` (the documented
  exception, like `/api/public/order`) — never trust a browser-supplied `store_id` for authz (`§22`).

- **0.5 RBAC: add one capability.** Add `integrations:write` to `apps/admin/lib/rbac-policy.ts` in **both**
  the `Capability` union (`:9`) **and** the `ALL_CAPABILITIES` array (`:27`) — they are two separate lists,
  and `owner` = `ALL_CAPABILITIES` so it inherits automatically. **Grant to `owner` only** (like
  `settings:write` — a Meta connection stores tenant secrets and is a store-level setting; exclude admin,
  staff, gudang). Gate every mutating Meta action with `await requireCapability("integrations:write")`
  (`lib/rbac.ts`) and every Meta control with `useCan("integrations:write")` / `<Can>`, like the other
  editors.

- **0.6 Token encryption: build a small versioned AES-256-GCM service.** There is no reusable at-rest
  encryption today (only scrypt for passwords + jose for session JWTs). Add a server-only
  `packages/lib` (or `apps/admin/lib`) helper using Node `crypto` AES-256-GCM with a **versioned key**
  (`META_TOKEN_ENCRYPTION_KEY`, `v1:` prefix on ciphertext so keys can rotate). Server-only, same
  discipline as `lib/auth.ts` (never in a client bundle, `postgres`/crypto stay `serverExternalPackages`).
  `token_ciphertext` MUST never be selected into a client component (`§9.2`).

- **0.7 Meta branding IS shown to the merchant — the opposite of KiriminAja/AutoLaris.** ADR 0004 hides
  the shipping/payment provider brands because those are *platform-managed*. Meta here is **tenant-owned**
  — the merchant connects *their own* Meta Business/Dataset/Catalog — so the Admin UI names Meta
  explicitly ("Hubungkan Meta"). This is deliberate and does not violate the white-label rule.

- **0.8 Naming & routes.** UI copy says **"Seller"**, code/dirs stay `apps/admin`. The Admin route is
  **Pengaturan → Integrasi → Meta** (`apps/admin/app/(admin)/pengaturan/integrasi/meta/…`). All UI strings
  Bahasa Indonesia; money `IDR()`; console-clean; responsive.

- **0.9 Purchase = server order state, which the repo already enforces.** `§14.4`'s "Purchase from
  trusted server state" aligns with the repo's iron rule: `/api/public/order` is the money boundary and
  re-prices everything. Emit server `Purchase` from the order row, not the browser success page. **COD
  attribution** is an open product decision (`§14.4`) — implement it as configuration, defaulting to
  "on confirmed payment for prepaid; on order-creation for COD" only after the user signs off.

- **0.10 Docs live in `specs/docs/`.** The doc-update list (`§33`) targets real files, but they are under
  `specs/docs/` (`ARCHITECTURE.md`, `DATA_MODEL.md`, `SCHEMA.md`, `TASKS.md`, `UI_INVENTORY.md`,
  `WORKLOG.md`, `DEPLOY.md`) — **not** the repo root. Also update `CHANGELOG.md` (root) and the ADR index
  in `AGENTS.md`. There is no root `ARCHITECTURE.md`/`TASKS.md`.

- **0.11 Verification commands that actually exist.** `npm run build:admin`, `npm run build:super`;
  storefront is `cd apps/storefront && npm run build` (Astro; there is no `build:storefront` root script);
  `npm run verify-rls -w @tokophi/db`, `npm run verify-migrations -w @tokophi/db`,
  `npm run verify-rls-app -w @tokophi/db`. ⚠️ **Admin `next dev` does not hydrate reliably in this
  worktree** — exercise interactive Admin flows against a **production build** (`next build` + `next
  start`), and the storefront/money paths in a **real browser** (Playwright), per the repo's testing rule.

- **0.12 Migration-number race.** Latest applied migration is **`0078_freezing_molly_hayes`** — the Meta
  schema is **`0079_…`**. Before generating: `git fetch && cat
  origin/main:packages/db/drizzle/meta/_journal.json | tail` (re-confirm 0079 is still free — other
  branches may have taken it), then `npm run verify-migrations -w @tokophi/db` after. Two branches writing
  the same number has bitten this repo.

- **0.14 `socialFacebook` is NOT a Meta credential.** `stores.socialFacebook` (`schema.ts:153`) already
  exists but is only a display *username* for the storefront's social links — do NOT conflate it with the
  new Pixel id / catalog id / access token. No Meta Pixel or Graph/Commerce API integration exists today
  (only social-handle display). The storefront Pixel (§15) needs a NEW `meta_pixel_id` surfaced on
  `StoreInfo` (`apps/storefront/src/data/store.ts`) + the `stores` query, injected in `Layout.astro`'s
  `<head>` — resolved from `Astro.locals.store`, never from the client.

- **0.13 Deploy discipline.** Coolify auto-builds on merge to `origin/main`; its `migrate` service runs
  `drizzle-kit migrate` before the apps start, so additive migrations are safe. Work on a branch → PR →
  merge → watch the 503→200 swap. Never auto-commit unrelated work; commit with explicit pathspecs.

---

## 1. Decision summary

Tokophi MUST follow a Shopify-style Meta integration model:

```text
1 Tokophi store / tenant
=
1 tenant-owned Meta Business connection
+ 1 tenant-owned Dataset / Pixel
+ 1 tenant-owned Catalog
+ 1 tenant-owned Ad Account connection when required
```

Tokophi acts as the integration and automation layer. Tokophi does not own the merchant's advertising data by default.

Tokophi is responsible for:

- Meta OAuth connection;
- asset discovery and selection;
- encrypted token storage;
- product catalog synchronization;
- storefront browser events;
- server-side Conversions API events;
- browser/server event deduplication;
- diagnostics, retries, and audit logs;
- disconnect and data-deletion flows.

The merchant remains the owner of:

- Meta Business Portfolio;
- Dataset / Pixel;
- Catalog;
- Ad Account;
- audiences and advertising history;
- permissions granted to Tokophi.

A shared Tokophi Dataset or CPAS-style architecture is explicitly **out of scope for the MVP**.

---

## 2. Context

Tokophi is a multi-tenant commerce platform. Each merchant has an isolated store, products, customers, orders, domain, and advertising account.

Using one Meta Pixel or Dataset across all tenants would create unnecessary complexity:

- cross-tenant learning signals;
- difficult asset permissions;
- possible audience and reporting leakage;
- complicated attribution;
- unclear merchant data ownership;
- higher operational and compliance risk;
- dependence on marketplace or Collaborative Ads eligibility.

Tokophi is currently a store infrastructure platform, not a centralized marketplace retailer. Therefore, tenant-owned advertising assets fit the product model better.

---

## 3. Goals

The implementation MUST allow a merchant to:

1. Connect a Meta account from Tokophi Admin.
2. Select an accessible Business Portfolio.
3. Select or connect a Dataset / Pixel.
4. Select or connect a product Catalog.
5. Optionally select an Ad Account for diagnostics and future campaign tooling.
6. Automatically synchronize Tokophi products to the selected catalog.
7. Send standard commerce events from the storefront.
8. Send the same conversion events server-side using Meta Conversions API.
9. Deduplicate browser and server events with a shared `event_id`.
10. See connection, catalog sync, and event-delivery health inside Tokophi.
11. Disconnect Meta without corrupting store data.

---

## 4. Non-goals

The first implementation MUST NOT include:

- one shared Tokophi Pixel for all tenants;
- CPAS or Collaborative Ads partner onboarding;
- automated campaign creation;
- automated budget management;
- automated audience creation;
- cross-tenant audience pooling;
- Tokophi-owned catalogs for tenant advertising;
- marketplace-style catalog sharing;
- support for Google, TikTok, or Pinterest in the same implementation;
- historical backfill of old browser events;
- storing raw customer identity data longer than operationally required.

These can be designed in later ADRs.

---

## 5. Normative rules

The following requirements are mandatory:

- Every Meta connection MUST be scoped by `store_id`.
- Every database read and write MUST respect Tokophi tenant isolation.
- A merchant MUST NOT access another merchant's Meta assets, logs, catalog items, or event payloads.
- Access tokens MUST be encrypted at rest.
- Access tokens MUST never be returned to browser clients.
- Meta API version MUST be configured through environment/configuration and MUST NOT be scattered as hardcoded strings.
- Meta secrets MUST never be written to application logs.
- `content_ids` sent in events MUST exactly match the product identifiers synchronized to the selected Meta Catalog.
- Browser and server copies of the same event MUST use the same `event_id`.
- Purchase events MUST be generated from trusted server-side order state, not solely from a browser success page.
- Disconnecting Meta MUST stop new sync and event delivery for that store.
- Failed jobs MUST be retryable and idempotent.

---

## 6. Target architecture

```text
Merchant Admin
    |
    | OAuth + asset selection
    v
Tokophi Meta Integration API
    |
    +--> Encrypted connection storage
    |
    +--> Catalog Sync Queue
    |       |
    |       v
    |    Meta Catalog API
    |
    +--> Event Delivery Queue
            |
            v
       Meta Conversions API

Storefront Browser
    |
    +--> Tenant Dataset / Pixel browser event
    |
    +--> Tokophi first-party analytics endpoint
               |
               v
          CAPI delivery worker
```

### 6.1 Components

#### Merchant Admin

Provides:

- connect/disconnect controls;
- asset selectors;
- connection status;
- catalog sync status;
- event diagnostics;
- manual resync;
- test-event workflow where supported;
- error remediation instructions.

#### Tokophi Meta Integration API

Provides server-only functions for:

- OAuth initiation and callback;
- state/nonce validation;
- token exchange;
- accessible asset discovery;
- connection persistence;
- permission validation;
- token refresh or renewal workflow where applicable;
- disconnect and revocation cleanup.

#### Catalog Sync Worker

Consumes product-change jobs and performs idempotent create/update/archive operations against the selected catalog.

#### Event Delivery Worker

Consumes normalized commerce events and sends server-side event payloads to the tenant's selected Dataset.

#### Storefront Tracking Adapter

Resolves the current store from the host, loads only that store's active Meta configuration, and emits browser events to that store's Dataset / Pixel.

---

## 7. Tenant ownership model

```text
Store A
├── Meta connection A
├── Dataset A
├── Catalog A
├── Ad Account A
└── Event and sync logs A

Store B
├── Meta connection B
├── Dataset B
├── Catalog B
├── Ad Account B
└── Event and sync logs B
```

No Meta object from Store A may be used while processing Store B.

The backend MUST validate the relationship:

```text
authenticated user
→ store membership
→ store capability
→ store Meta connection
→ selected asset
```

The UI selection alone is not sufficient authorization.

---

## 8. Connection modes

The schema SHOULD support future modes, but only one mode is active in MVP.

```text
tenant_owned       # MVP and default
platform_shared    # reserved, disabled
dual_destination   # reserved, disabled
```

The initial implementation MUST reject unsupported modes at runtime.

---

## 9. Data model changes

The existing `ad_channels` table is too shallow for production Meta integration. Keep it only if required for backward compatibility; new integration state SHOULD live in dedicated tables.

### 9.1 Enums

```text
meta_connection_status:
- disconnected
- connecting
- connected
- degraded
- expired
- revoked
- error

meta_sync_status:
- pending
- processing
- synced
- failed
- skipped
- archived

meta_job_type:
- full_catalog_sync
- product_upsert
- product_archive
- inventory_update
- connection_health_check
- event_delivery

meta_job_status:
- queued
- processing
- succeeded
- failed
- dead_letter
```

### 9.2 `meta_connections`

```text
meta_connections(
  id uuid pk,
  store_id uuid not null unique → stores.id,
  mode text not null default 'tenant_owned',
  status meta_connection_status not null,

  meta_user_id text null,
  business_id text null,
  business_name text null,
  dataset_id text null,
  dataset_name text null,
  pixel_id text null,
  catalog_id text null,
  catalog_name text null,
  ad_account_id text null,
  ad_account_name text null,

  granted_scopes jsonb not null default '[]',
  token_ciphertext text null,
  token_expires_at timestamptz null,
  last_validated_at timestamptz null,
  last_error_code text null,
  last_error_message text null,

  connected_by_user_id uuid null,
  connected_at timestamptz null,
  disconnected_at timestamptz null,
  created_at timestamptz not null,
  updated_at timestamptz not null
)
```

Rules:

- one active connection per store for MVP;
- no plaintext token column;
- no token value in JSON metadata;
- `last_error_message` MUST be sanitized;
- RLS MUST scope rows by `store_id`;
- merchant UI reads MUST exclude token ciphertext.

### 9.3 `meta_product_mappings`

```text
meta_product_mappings(
  id uuid pk,
  store_id uuid not null → stores.id,
  connection_id uuid not null → meta_connections.id,
  product_id uuid not null → products.id,
  variant_id uuid null → product_variants.id,

  retailer_id text not null,
  catalog_id text not null,
  payload_hash text null,
  sync_status meta_sync_status not null,
  last_synced_at timestamptz null,
  last_error_code text null,
  last_error_message text null,
  created_at timestamptz not null,
  updated_at timestamptz not null,

  unique(store_id, catalog_id, retailer_id)
)
```

### 9.4 `meta_event_deliveries`

```text
meta_event_deliveries(
  id uuid pk,
  store_id uuid not null → stores.id,
  connection_id uuid not null → meta_connections.id,

  event_id text not null,
  event_name text not null,
  source text not null,
  order_id uuid null → orders.id,
  session_id text null,

  payload_hash text not null,
  status meta_job_status not null,
  attempt_count int not null default 0,
  next_attempt_at timestamptz null,
  delivered_at timestamptz null,
  response_reference text null,
  last_error_code text null,
  last_error_message text null,
  created_at timestamptz not null,
  updated_at timestamptz not null,

  unique(store_id, event_id, source)
)
```

> ⚠️ **AS SHIPPED (2026-07-30) THIS IS HALF TRUE, DELIBERATELY.** `tracking_event_deliveries` has no
> `payload_hash`; it stores the commerce facts plus a `client` object — `userAgent`, `ip`, `fbp`, `fbc`,
> `gaClientId`, `ttp`, `ttclid`, `sourceUrl` — in plaintext. The send is asynchronous and the providers
> require those match keys, which no longer exist by the time the cron runs; that is why the "explicit
> retention" half of this rule was **owed, not optional**, and it now exists: 30 days, purged on the cron
> tick, unconditional on status. No email, phone or token is ever persisted. See `SCHEMA.md`.

Do not store unnecessary raw identity fields in this table. Store a normalized payload hash and operational metadata. If request payload retention is needed for debugging, use a short-lived encrypted store with explicit retention.

### 9.5 `meta_sync_jobs`

```text
meta_sync_jobs(
  id uuid pk,
  store_id uuid not null → stores.id,
  connection_id uuid not null → meta_connections.id,
  type meta_job_type not null,
  status meta_job_status not null,
  entity_type text null,
  entity_id uuid null,
  idempotency_key text not null,
  attempt_count int not null default 0,
  next_attempt_at timestamptz null,
  locked_at timestamptz null,
  locked_by text null,
  last_error_code text null,
  last_error_message text null,
  created_at timestamptz not null,
  updated_at timestamptz not null,

  unique(idempotency_key)
)
```

### 9.6 `meta_audit_logs`

```text
meta_audit_logs(
  id uuid pk,
  store_id uuid not null → stores.id,
  actor_user_id uuid null,
  action text not null,
  target_type text not null,
  target_reference text null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null
)
```

Audit metadata MUST exclude secrets and raw customer identifiers.

---

## 10. Product identity strategy

> ⚠️ **OVERRIDDEN FOR MVP by §0.2.** The existing `/feed/google.xml` already emits `<g:id>` = `handle` /
> `handle-{ordinal}`. To avoid a duplicated Meta catalog, the MVP retailer-id generator MUST reproduce the
> feed's handle-based id (via ONE shared `retailerId()` helper both call), not the UUID scheme below. The
> UUID scheme below is the *ideal* (stable across handle/variant changes) and the target of a future
> "unify feed + push on a stable id" ADR — which would re-key existing catalogs, so it is deferred.

Meta catalog product identity MUST be stable across resyncs.

Ideal retailer identifier (deferred — see §0.2):

```text
tokophi:{store_id}:{variant_id}
```

For products without variants:

```text
tokophi:{store_id}:{product_id}
```

Examples:

```text
tokophi:store_7f3:variant_901
tokophi:store_7f3:product_112
```

Rules:

- never use a simple sequential product ID without the store namespace;
- never use product title or handle as the canonical identifier;
- changing title, URL, price, or SKU MUST NOT change `retailer_id`;
- deleting a product SHOULD archive/remove it from the catalog without reusing its identifier;
- event `content_ids` MUST use these exact identifiers.

---

## 11. Catalog product normalization

Create a provider-independent normalized object before generating a Meta request.

```ts
interface CommerceCatalogItem {
  retailerId: string;
  title: string;
  description: string;
  availability: "in stock" | "out of stock" | "preorder";
  condition: "new";
  priceAmount: number;
  currency: "IDR";
  productUrl: string;
  imageUrl: string;
  additionalImageUrls: string[];
  brand?: string;
  category?: string;
  sku?: string;
  inventoryQuantity?: number;
}
```

The adapter MUST validate:

- product is published;
- product URL is public and absolute;
- image URL is public and absolute;
- price is positive;
- currency is IDR for Indonesian Tokophi stores;
- availability matches current sellable inventory rules;
- title and description are not empty;
- retailer ID is stable;
- selected catalog belongs to the active store connection.

Invalid products MUST be marked `skipped` with a merchant-readable reason. One invalid product MUST NOT abort the entire catalog sync.

---

## 12. Product sync triggers

The application MUST enqueue catalog work after committed domain mutations.

| Tokophi action | Required Meta action |
|---|---|
| Product published | Upsert product or variants |
| Product title/description changed | Upsert affected items |
| Price changed | Upsert affected items |
| Inventory changed | Inventory/availability update |
| Primary image changed | Upsert affected items |
| Product unpublished | Archive/remove affected items |
| Variant added | Create/upsert variant item |
| Variant removed | Archive/remove variant item |
| Store domain changed | Update product URLs |
| Meta catalog changed | Full catalog sync |
| Connection restored | Health check, then incremental or full sync |

The enqueue operation SHOULD occur through an outbox pattern or an equivalent transaction-safe mechanism so a successful product mutation cannot silently lose its sync event.

---

## 13. Full catalog sync behavior

A full sync MUST:

1. Lock one full-sync job per store and catalog.
2. Validate the active connection.
3. Read published sellable products for the store.
4. Normalize each product/variant.
5. Compare normalized payload hashes with `meta_product_mappings`.
6. Skip unchanged items.
7. Upsert changed and new items.
8. Archive mapped items no longer present or published.
9. Persist per-item results.
10. Produce a summary:
   - total scanned;
   - synced;
   - unchanged;
   - skipped;
   - failed;
   - archived.
11. Release the lock even on failure.

A rerun MUST be safe and idempotent.

---

## 14. Commerce event specification

### 14.1 Required MVP events

```text
PageView
ViewContent
Search
AddToCart
InitiateCheckout
Purchase
```

Optional after MVP:

```text
AddPaymentInfo
Lead
Contact
CompleteRegistration
```

### 14.2 Standard normalized event

```ts
interface CommerceEvent {
  storeId: string;
  eventId: string;
  eventName:
    | "PageView"
    | "ViewContent"
    | "Search"
    | "AddToCart"
    | "InitiateCheckout"
    | "Purchase";
  occurredAt: string;
  sourceUrl: string;
  sessionId?: string;
  customer?: {
    email?: string;
    phone?: string;
    externalId?: string;
    clientIpAddress?: string;
    clientUserAgent?: string;
    fbp?: string;
    fbc?: string;
  };
  commerce?: {
    contentIds?: string[];
    contentType?: "product" | "product_group";
    numItems?: number;
    value?: number;
    currency?: "IDR";
    orderId?: string;
    searchString?: string;
  };
}
```

This is an internal model. The Meta adapter converts it to the provider-specific request shape.

### 14.3 Event ID rules

Event IDs MUST be globally collision-resistant and deterministic for events that can be emitted twice.

Recommended patterns:

```text
PageView:           pv:{store_id}:{session_id}:{page_sequence}
ViewContent:        vc:{store_id}:{session_id}:{retailer_id}:{sequence}
AddToCart:          atc:{store_id}:{session_id}:{cart_mutation_id}
InitiateCheckout:   ic:{store_id}:{checkout_id}
Purchase:           purchase:{store_id}:{order_id}` — ⚠️ **SHIPPED AS `purchase:{order_number}`** (`packages/lib/src/tracking-ids.ts`). `orders_number_unique` is platform-wide, so the store namespace adds no collision resistance, and it would hand the tenant's primary key to three ad platforms. An identifier given to Meta cannot be un-given. `
```

For Purchase, browser and server MUST both use:

```text
purchase:{store_id}:{order_id}
```

### 14.4 Purchase source of truth

The server MUST emit Purchase only when Tokophi order/payment rules determine that the order qualifies as a purchase event.

The exact trigger MUST be explicit and configurable by payment method, for example:

- online payment: after confirmed payment;
- COD: after order creation or later fulfillment milestone, according to the product decision;
- bank transfer: after payment confirmation.

Until the COD attribution rule is approved, implementation MUST mark it as a product configuration rather than silently assuming one behavior.

---

## 15. Browser Pixel behavior

The storefront MUST:

1. Resolve `store_id` from the verified host/domain.
2. Load only the active connection for that store.
3. Render the tenant's Dataset / Pixel identifier only when status is `connected` or approved `degraded` mode.
4. Never render access tokens or app secrets.
5. Emit browser events using the normalized event builder.
6. Attach the same `event_id` used by the server event when deduplication applies.
7. Respect consent and privacy configuration before firing optional marketing tracking.
8. Fail silently for shoppers while recording a safe client diagnostic when tracking cannot load.

The storefront MUST NOT use a globally configured Tokophi Pixel as the merchant advertising Pixel.

---

## 16. Conversions API behavior

The server-side adapter MUST:

- load the Meta connection by `store_id`;
- decrypt the token only inside the server/worker process;
- verify the requested Dataset belongs to that connection;
- hash identity fields according to current Meta requirements;
- omit missing optional identity fields rather than fabricating them;
- include event time, event name, action source, and source URL where applicable;
- include `event_id` for deduplication;
- use exact catalog `content_ids`;
- retry retryable failures with bounded exponential backoff and jitter;
- stop retrying permanent permission or validation failures;
- sanitize provider error responses before persistence;
- send failed permanent jobs to a dead-letter state;
- expose remediation guidance in Admin.

Current Meta API fields, permissions, and version behavior MUST be verified against official Meta documentation during implementation. Do not rely on copied blog examples as authoritative contracts.

---

## 17. OAuth and permissions flow

### 17.1 Connect flow

```text
Merchant clicks Connect Meta
→ Tokophi creates signed state + nonce
→ redirect to Meta OAuth
→ Meta callback to Tokophi
→ validate state, nonce, store, and user
→ exchange authorization code server-side
→ fetch accessible business/assets
→ merchant selects Dataset, Catalog, optional Ad Account
→ Tokophi verifies access to every selected asset
→ encrypt token
→ save connection
→ enqueue health check and initial catalog sync
```

### 17.2 Security requirements

- OAuth state MUST bind `store_id`, initiating user, nonce, and expiry.
- State MUST be signed and single-use.
- Callback MUST reject mismatched or expired state.
- Authorization code exchange MUST occur server-side.
- Token encryption MUST use a versioned encryption key strategy.
- Token ciphertext MUST not be exposed through generic ORM serialization.
- Selected assets MUST be revalidated server-side before save.
- A user MUST have an explicit capability such as `integrations:manage`.

### 17.3 Disconnect flow

Disconnect MUST:

1. require confirmation;
2. mark the connection disconnected before asynchronous cleanup;
3. stop new catalog and event jobs;
4. cancel or skip queued jobs for that connection;
5. attempt provider revocation where supported;
6. remove encrypted token material;
7. retain non-sensitive audit history;
8. keep Tokophi product and order data untouched;
9. show whether Meta-side assets remain owned by the merchant.

---

## 18. Internal module structure

Recommended structure; adapt to the actual repository without duplicating existing conventions.

```text
packages/
├── integrations/
│   └── src/meta/
│       ├── types.ts
│       ├── client.ts
│       ├── oauth.ts
│       ├── catalog-adapter.ts
│       ├── event-adapter.ts
│       ├── errors.ts
│       ├── retry.ts
│       └── index.ts
└── db/
    └── src/schema/meta.ts

apps/admin/
├── app/(admin)/pengaturan/integrasi/meta/
│   ├── page.tsx
│   ├── callback/page.tsx
│   └── diagnostics/page.tsx
├── components/integrations/meta/
└── lib/actions/meta/

apps/storefront/
└── src/integrations/meta/
    ├── config.ts
    ├── browser-events.ts
    └── event-id.ts

# NO apps/worker in TokoΦ (§0.1). Background work = cron-triggered API routes draining DB job tables,
# following apps/admin/app/api/cron/tracking/route.ts:
apps/admin/app/(nonexistent)          # illustrative only — real paths below
apps/admin/app/api/cron/meta-catalog-sync/route.ts    # drains meta_sync_jobs (catalog work)
apps/admin/app/api/cron/meta-event-delivery/route.ts  # drains meta_event_deliveries (CAPI)
apps/admin/app/api/cron/meta-health-check/route.ts     # periodic connection revalidation
# dead-letter is a STATUS on the job rows, not a separate process.
```

TokoΦ has an established cron-route pattern (`api/cron/tracking`) — use it, do NOT create a worker app or a queue package (§0.1). The `meta_sync_jobs` / `meta_event_deliveries` tables are the queue.

---

## 19. Environment and secrets

Use placeholder names until aligned with the repository's environment conventions.

```dotenv
META_APP_ID=
META_APP_SECRET=
META_REDIRECT_URI=
META_GRAPH_API_VERSION=
META_TOKEN_ENCRYPTION_KEY=
META_WEBHOOK_VERIFY_TOKEN=
```

Rules:

- `.env.example` contains names only, never real secrets;
- production secrets live in the deployment secret manager;
- encryption key rotation MUST be possible;
- app secret MUST never enter browser bundles;
- startup validation SHOULD fail fast for missing mandatory server variables;
- logs MUST print variable names, not values.

---

## 20. Merchant Admin UX

### 20.1 Route

```text
Pengaturan
└── Integrasi
    └── Meta
```

### 20.2 Disconnected state

Show:

- what will be connected;
- that assets remain owned by the merchant;
- required prerequisites;
- `Hubungkan Meta` button;
- privacy/data-use notice link.

### 20.3 Connected state

Show:

- Business name and masked ID;
- Dataset / Pixel name and masked ID;
- Catalog name and masked ID;
- Ad Account name and masked ID if connected;
- token/permission health;
- last validation time;
- last successful catalog sync;
- product sync summary;
- recent event delivery health;
- `Sinkronkan sekarang` action;
- `Ubah aset` action;
- `Putuskan koneksi` action.

### 20.4 Degraded/error state

Show a specific remediation message, for example:

- permission removed;
- token expired;
- catalog unavailable;
- Dataset unavailable;
- product rejected;
- public image inaccessible;
- product URL inaccessible;
- rate limit or temporary provider outage.

Do not show raw provider JSON to merchants.

---

## 21. Super-admin UX

Super-admin MAY view operational health across tenants but MUST NOT see plaintext tokens or unnecessary customer data.

Recommended view:

```text
Integrations → Meta Health
```

Columns:

- store;
- connection status;
- asset presence;
- permission status;
- last catalog sync;
- failed product count;
- event success rate;
- oldest queued job;
- last provider error category.

Allowed actions:

- inspect sanitized diagnostics;
- retry failed jobs;
- trigger health check;
- disable a broken connection;
- never impersonate merchant consent for a new OAuth grant.

---

## 22. API and server actions

Exact framework routes may change, but the functional contract SHOULD include:

```text
POST /integrations/meta/connect
GET  /integrations/meta/callback
GET  /integrations/meta/assets
POST /integrations/meta/selection
POST /integrations/meta/disconnect
POST /integrations/meta/sync
GET  /integrations/meta/status
GET  /integrations/meta/diagnostics
POST /events/commerce
```

All merchant endpoints MUST derive `store_id` from the authenticated session. They MUST NOT trust a browser-supplied `store_id` as authorization.

The storefront event endpoint MAY accept a public store reference, but the server MUST resolve and validate it against the request host and signed/session context before processing.

---

## 23. Queue, retry, and idempotency

### 23.1 Idempotency keys

Recommended examples:

```text
catalog-full:{connection_id}:{catalog_version}
product-upsert:{connection_id}:{retailer_id}:{payload_hash}
product-archive:{connection_id}:{retailer_id}
event:{connection_id}:{event_id}:server
```

### 23.2 Retry policy

Classify failures:

#### Retryable

- network timeout;
- connection reset;
- provider 5xx;
- rate limiting;
- temporary dependency outage.

#### Permanent until configuration changes

- invalid asset ID;
- missing permission;
- revoked token;
- product validation failure;
- inaccessible URL/image;
- unsupported field/value.

Retryable jobs SHOULD use bounded exponential backoff with jitter. Permanent failures SHOULD stop and surface remediation. After the configured maximum attempts, jobs move to `dead_letter`.

### 23.3 Concurrency

- only one full catalog sync per connection at a time;
- product jobs may run concurrently within safe provider limits;
- preserve final-state correctness when rapid product updates occur;
- stale payload-hash jobs SHOULD be skipped if a newer job exists;
- Purchase delivery MUST remain idempotent.

---

## 24. Observability

### 24.1 Structured logs

Every integration log SHOULD include:

```text
store_id
connection_id
job_id
job_type
event_id or retailer_id
attempt
status
duration_ms
provider_error_category
```

Never log:

- access tokens;
- app secret;
- unhashed customer email/phone;
- full OAuth codes;
- full provider request bodies containing identity data.

### 24.2 Metrics

Track at minimum:

- connected stores;
- degraded connections;
- token validation success rate;
- catalog sync success rate;
- products synced/skipped/failed;
- event delivery success rate;
- event delivery latency;
- retry count;
- dead-letter job count;
- queue age;
- provider rate-limit occurrences.

### 24.3 Alerts

Alert platform operators when:

- event delivery failure rate crosses threshold;
- queue age exceeds threshold;
- many connections become revoked simultaneously;
- catalog worker stops processing;
- token decryption fails;
- one tenant produces abnormal job volume;
- provider outage affects multiple stores.

Threshold values belong in operational configuration, not hardcoded UI text.

---

## 25. Privacy, security, and retention

- Customer identity data MUST be minimized.
- Identity fields sent to Meta MUST follow current provider hashing and formatting requirements.
- Consent behavior MUST follow Tokophi's privacy configuration and applicable policy decisions.
- Debug payload retention MUST have a documented expiration period.
- Merchant disconnect MUST stop future event forwarding.
- Account/store deletion MUST include integration cleanup.
- Token access MUST be restricted to the smallest server/worker surface.
- Sensitive operations MUST create audit entries.
- Security reviews MUST include SSRF risk for product/image URLs, webhook validation, OAuth CSRF, cross-tenant access, and secret leakage.

This ADR is an engineering decision, not a legal conclusion. Privacy notices, consent language, and data-processing terms require separate review.

---

## 26. Webhooks

Webhook support SHOULD be added after the base connection works.

Potential uses:

- permission or token changes;
- asset changes;
- catalog diagnostics;
- provider status changes.

Webhook implementation MUST:

- verify provider signatures according to current official documentation;
- support challenge/verification flow where required;
- be idempotent;
- reject stale or invalid requests;
- map notifications to the correct `store_id` through trusted asset mappings;
- avoid trusting arbitrary store identifiers in the webhook body;
- log only sanitized metadata.

---

## 27. Testing strategy

### 27.1 Unit tests

Cover:

- retailer ID generation;
- event ID generation;
- product normalization;
- availability mapping;
- payload hashing;
- event normalization;
- error classification;
- retry decisions;
- token encryption/decryption;
- OAuth state signing and validation;
- tenant asset ownership guards.

### 27.2 Integration tests

Use a provider client interface and mock server/fixtures. Cover:

- successful OAuth callback processing;
- invalid/expired OAuth state;
- inaccessible selected asset;
- initial catalog sync;
- incremental product update;
- product archive;
- rate-limit retry;
- revoked token handling;
- server event delivery;
- duplicate Purchase event;
- disconnect behavior;
- dead-letter transition.

Do not call live Meta APIs from default CI.

### 27.3 RLS and tenant isolation tests

Prove that:

- Store A cannot read Store B connection;
- Store A cannot update Store B asset selection;
- Store A cannot inspect Store B sync jobs;
- Store A cannot inspect Store B event logs;
- Store A cannot trigger Store B sync;
- worker queries always include trusted store/connection scope;
- super-admin access is explicit and audited.

### 27.4 End-to-end tests

Cover merchant UI states:

- disconnected;
- connecting/callback;
- asset selection;
- connected;
- initial sync in progress;
- sync completed;
- degraded permission;
- manual resync;
- disconnect confirmation.

Use mocked Meta responses in Playwright. A separate manual sandbox checklist can verify live Meta behavior.

---

## 28. Definition of done

The feature is complete only when all conditions below pass:

### Connection

- [ ] Merchant can initiate OAuth from Tokophi Admin.
- [ ] Callback validates signed, expiring, single-use state.
- [ ] Merchant can select only assets returned by server-side discovery.
- [ ] Server revalidates selected assets before save.
- [ ] Token is encrypted and never returned to the client.
- [ ] Disconnect removes usable token material and stops new jobs.

### Catalog

- [ ] Initial full sync completes for a connected store.
- [ ] Product/variant identifiers are stable and store-namespaced.
- [ ] Product edits enqueue incremental sync.
- [ ] Inventory changes update availability.
- [ ] Unpublished/deleted products are archived or removed.
- [ ] Invalid products are skipped individually with readable reasons.
- [ ] Rerunning sync is idempotent.

### Events

- [ ] Required browser events use the tenant's Pixel/Dataset.
- [ ] Server events use the tenant's Dataset.
- [ ] Browser/server duplicates use the same `event_id`.
- [ ] Purchase is emitted from trusted order state.
- [ ] Event `content_ids` match catalog retailer IDs exactly.
- [ ] Retry and permanent-error handling are tested.

### Isolation and security

- [ ] New tables have tenant RLS where applicable.
- [ ] Cross-tenant tests pass.
- [ ] No secrets appear in logs, client payloads, or screenshots.
- [ ] OAuth CSRF/state tests pass.
- [ ] Token encryption key is production-configurable.
- [ ] Sensitive actions create audit logs.

### Quality

- [ ] Relevant app builds pass.
- [ ] Unit and integration tests pass.
- [ ] Playwright flow passes with mocked provider.
- [ ] Admin console and browser console are clean.
- [ ] `SCHEMA.md`, `DATA_MODEL.md`, `ARCHITECTURE.md`, `TASKS.md`, `UI_INVENTORY.md`, and `WORKLOG.md` are updated.
- [ ] No unreviewed live Meta credentials are committed.

---

# AI Terminal Implementation Plan

This section is the execution contract for Claude Code, Codex CLI, or another terminal coding agent.

## 29. Agent operating instructions

```text
You are implementing ADR 0012 for TokoΦ. READ §0 (repository alignment) FIRST — its bindings
override any generic assumption below (no worker app → cron routes; DB tables are the queue;
retailer_id must equal the existing Google feed's <g:id>; RLS + CHILD-TABLE rule; verify against
a production build, not `next dev`).

Primary objective:
Build a production-oriented, tenant-owned Meta Commerce integration without weakening existing multi-tenant isolation, RLS, RBAC, or app conventions.

Priority order:
1. Security and tenant isolation.
2. Correctness and idempotency.
3. Compatibility with the existing repository.
4. Test coverage.
5. UI completeness.
6. Refactoring or elegance.

Rules:
- Inspect the repository before changing files.
- Read existing AGENTS.md, CLAUDE.md, package conventions, schema, migrations, actions, data modules, and auth/RBAC helpers.
- Reuse existing queue, encryption, logging, API, UI, and test infrastructure when present.
- Do not create duplicate abstractions if an existing module can be extended.
- Do not hardcode a Meta API version across files; use configuration.
- Do not invent live Meta permissions or fields. Verify current requirements against official Meta documentation before production wiring.
- Do not put real credentials in code, fixtures, tests, screenshots, or documentation.
- Do not expose tokens to client components.
- Do not trust store_id supplied by the browser for authorization.
- Every store-scoped query must use the existing tenant context/RLS pattern.
- Keep changes in small, reviewable commits or clearly separated work units.
- After each phase: run focused tests, then relevant builds.
- Update project documentation and task status as work lands.
- If a required external Meta credential is unavailable, complete the provider interface, mock adapter, tests, UI states, and document the blocked live verification step. Do not fake successful live verification.
```

---

## 30. Execution phases

### Phase 0 — Repository reconnaissance

**Objective:** map the existing implementation before editing.

Tasks:

- [ ] Read root and app-level `AGENTS.md` / `CLAUDE.md` files.
- [ ] Inspect workspace scripts and package boundaries.
- [ ] Inspect `@tokophi/db` schema and migration conventions.
- [ ] Inspect `withTenant()` / `withCurrentTenant()` and RLS tests.
- [ ] Inspect RBAC capability definitions and Admin settings routes.
- [ ] Inspect product, variant, inventory, order, payment, and domain mutations.
- [ ] Inspect any existing job/cron/outbox infrastructure.
- [ ] Inspect logging, encryption, environment validation, and error utilities.
- [ ] Inspect storefront host-to-store resolution.
- [ ] Inspect current `ad_channels` usage.
- [ ] Produce a short implementation map in the worklog before coding.

**Acceptance criteria:**

- No duplicate queue, crypto, or integration package is introduced without documented justification.
- Planned file paths are adjusted to actual repository conventions.

---

### Phase 1 — Domain types and provider boundary

**Objective:** create a testable integration boundary without live credentials.

Tasks:

- [ ] Add normalized catalog item types.
- [ ] Add normalized commerce event types.
- [ ] Add connection and job status types.
- [ ] Add stable retailer ID generator.
- [ ] Add stable event ID generator.
- [ ] Add payload canonicalization and hashing utility.
- [ ] Define `MetaProviderClient` interface.
- [ ] Define typed provider errors and retry classification.
- [ ] Implement a mock provider client for tests and local development.
- [ ] Add unit tests for all utilities.

**Acceptance criteria:**

- Provider-independent logic has no dependency on React or route handlers.
- Unit tests cover collisions, deterministic output, and invalid inputs.
- Live Meta calls are behind one provider boundary.

---

### Phase 2 — Database schema and migrations

**Objective:** persist connection, mapping, job, delivery, and audit state.

Tasks:

- [ ] Add enums and tables from Section 9, adjusted to repository naming conventions.
- [ ] Add indexes for store/status/next-attempt queries.
- [ ] Add unique constraints for idempotency.
- [ ] Add foreign-key delete behavior explicitly.
- [ ] Add RLS policies to every store-scoped table.
- [ ] Ensure restricted app role can perform required operations.
- [ ] Add migration verification.
- [ ] Add tenant-isolation tests.
- [ ] Update `SCHEMA.md` and `DATA_MODEL.md`.

**Recommended indexes:**

```text
meta_connections(store_id, status)
meta_product_mappings(store_id, catalog_id, sync_status)
meta_sync_jobs(status, next_attempt_at)
meta_sync_jobs(store_id, connection_id, created_at)
meta_event_deliveries(status, next_attempt_at)
meta_event_deliveries(store_id, event_name, created_at)
meta_audit_logs(store_id, created_at)
```

**Acceptance criteria:**

- Migrations apply cleanly to a fresh database.
- Migrations apply cleanly to the current development database.
- RLS verification proves cross-tenant denial.
- No plaintext token field exists.

---

### Phase 3 — Encryption and configuration

**Objective:** create safe secret handling before OAuth.

Tasks:

- [ ] Add environment schema entries.
- [ ] Add versioned token encryption/decryption service.
- [ ] Ensure key material is server-only.
- [ ] Add redaction helpers for logs/errors.
- [ ] Add tests for encryption round-trip and invalid key/version.
- [ ] Add `.env.example` placeholders.
- [ ] Document production secret setup in `DEPLOY.md`.

**Acceptance criteria:**

- Token plaintext exists only transiently in server memory.
- Client serialization cannot include token ciphertext by default.
- Logs remain secret-free in success and failure tests.

---

### Phase 4 — OAuth and asset selection

**Objective:** connect a merchant-owned Meta account and select assets.

Tasks:

- [ ] Add RBAC capability `integrations:manage` or map to an existing suitable capability.
- [ ] Implement signed, expiring, single-use OAuth state.
- [ ] Implement connect action/route.
- [ ] Implement callback route.
- [ ] Implement server-side authorization-code exchange.
- [ ] Implement accessible asset discovery through provider client.
- [ ] Build asset selection UI.
- [ ] Revalidate selected assets server-side.
- [ ] Encrypt and save token/asset mapping.
- [ ] Add connection audit entries.
- [ ] Enqueue health check and initial sync.
- [ ] Implement disconnect flow.
- [ ] Add mocked integration tests and Playwright flow.

**Acceptance criteria:**

- Cross-store callback replay fails.
- Expired or reused state fails.
- Browser never receives access token.
- Unsupported connection modes are rejected.
- Disconnect immediately prevents new delivery jobs.

---

### Phase 5 — Catalog normalization and sync engine

**Objective:** synchronize store products safely and incrementally.

Tasks:

- [ ] Implement product/variant → normalized catalog item adapter.
- [ ] Resolve canonical public product URL from store domain.
- [ ] Resolve canonical public image URLs.
- [ ] Validate product eligibility.
- [ ] Implement full sync planner.
- [ ] Implement payload-hash change detection.
- [ ] Implement provider upsert/archive calls.
- [ ] Persist mappings and per-item statuses.
- [ ] Add manual full-sync action.
- [ ] Add sync summary and product-level error UI.
- [ ] Add retry and dead-letter behavior.
- [ ] Add unit and integration tests.

**Acceptance criteria:**

- Unchanged products are not resent unnecessarily.
- One bad product does not fail the full catalog.
- Product IDs remain stable after title, handle, and price changes.
- Removing a variant archives the correct catalog item.
- Full sync is idempotent.

---

### Phase 6 — Transaction-safe sync triggers

**Objective:** ensure catalog updates are not lost after product changes.

Tasks:

- [ ] Identify all product, variant, inventory, media, publish-status, and domain mutation paths.
- [ ] Add an outbox or equivalent committed-event mechanism.
- [ ] Enqueue product upsert/archive/inventory jobs after successful transactions.
- [ ] Coalesce stale rapid-update jobs using payload hash/version.
- [ ] Add tests for rollback, duplicate mutation, and rapid updates.

**Acceptance criteria:**

- A rolled-back product mutation creates no sync job.
- A committed mutation creates at least one recoverable sync intent.
- Replaying the outbox does not duplicate final provider state.

---

### Phase 7 — Storefront browser events

**Objective:** emit tenant-specific browser events.

Tasks:

- [ ] Add server-side store Meta config resolver.
- [ ] Ensure host/domain resolves to the correct `store_id`.
- [ ] Add Pixel bootstrap only for active tenant connection.
- [ ] Add normalized browser event helpers.
- [ ] Emit `PageView`.
- [ ] Emit `ViewContent` with exact retailer IDs.
- [ ] Emit `Search` where storefront search exists.
- [ ] Emit `AddToCart`.
- [ ] Emit `InitiateCheckout`.
- [ ] Emit browser `Purchase` only with trusted order reference and shared event ID.
- [ ] Integrate consent gating.
- [ ] Add browser tests for Store A versus Store B configuration.

**Acceptance criteria:**

- Store A storefront never renders Store B Pixel ID.
- No token or secret appears in HTML.
- Event IDs are deterministic where required.
- Event `content_ids` match catalog mappings.

---

### Phase 8 — Server event collection and CAPI worker

**Objective:** deliver server-side events with retries and deduplication.

Tasks:

- [ ] Add first-party commerce event collection endpoint or server action.
- [ ] Validate event/store/host/session relationship.
- [ ] Normalize user and commerce data.
- [ ] Hash identity fields in the provider adapter.
- [ ] Persist idempotent event-delivery intent.
- [ ] Implement event worker.
- [ ] Implement retry classification.
- [ ] Implement dead-letter state.
- [ ] Trigger server Purchase from trusted order/payment state.
- [ ] Define and implement COD purchase trigger configuration.
- [ ] Add diagnostics UI.
- [ ] Add duplicate Purchase tests.

**Acceptance criteria:**

- Repeated processing of the same Purchase does not create multiple provider deliveries.
- Browser and server Purchase use identical `event_id`.
- Revoked token produces degraded state and actionable error.
- Permanent failures stop retrying.

---

### Phase 9 — Admin and super-admin diagnostics

**Objective:** make failures understandable and operable.

Tasks:

- [ ] Build merchant connection status card.
- [ ] Build asset summary.
- [ ] Build catalog sync summary.
- [ ] Build recent event health summary.
- [ ] Build failed-item remediation list.
- [ ] Add manual health check.
- [ ] Add retry actions with RBAC.
- [ ] Add super-admin Meta Health screen.
- [ ] Ensure all diagnostics are sanitized.
- [ ] Update `UI_INVENTORY.md`.

**Acceptance criteria:**

- Merchant sees only their store data.
- Super-admin sees operational metadata, not plaintext secrets.
- Retry actions create audit logs.
- Raw provider payloads are not rendered.

---

### Phase 10 — Webhooks and lifecycle hardening

**Objective:** handle external permission and asset changes.

Tasks:

- [ ] Add webhook verification endpoint.
- [ ] Add signature verification.
- [ ] Add idempotent webhook processing.
- [ ] Map provider assets to connection/store securely.
- [ ] Update connection status on relevant changes.
- [ ] Add scheduled connection health checks as fallback.
- [ ] Add store/account deletion cleanup.
- [ ] Add token rotation/reconnect guidance.

**Acceptance criteria:**

- Invalid webhook signatures are rejected.
- Duplicate webhooks are harmless.
- Revoked access stops delivery and surfaces in Admin.

---

### Phase 11 — Live sandbox verification

**Objective:** verify actual provider behavior without making CI depend on Meta.

Prerequisites:

- approved Meta app configuration;
- test Business Portfolio;
- test Dataset / Pixel;
- test Catalog;
- test Ad Account if required;
- approved redirect URI;
- required permissions available to the test user.

Checklist:

- [ ] Complete real OAuth connection.
- [ ] Confirm accessible assets match expectations.
- [ ] Run initial catalog sync.
- [ ] Confirm product IDs, URLs, prices, images, and availability.
- [ ] Trigger every MVP browser event.
- [ ] Trigger every MVP server event.
- [ ] Confirm browser/server Purchase deduplication.
- [ ] Revoke permission and confirm degraded state.
- [ ] Restore/reconnect and confirm recovery.
- [ ] Disconnect and confirm event delivery stops.
- [ ] Record only sanitized evidence in `WORKLOG.md`.

**Acceptance criteria:**

- Live verification results are documented honestly.
- Any provider-specific deviations are reflected in code and this ADR.
- No credentials or personal customer data are committed.

---

## 31. Required verification commands

The agent MUST discover and use actual repository scripts. The following are patterns, not guaranteed exact commands:

```bash
npm run lint
npm run typecheck
npm run test
npm run build:admin
npm run build:super
npm run build:storefront
npm run verify-rls
npm run verify-rls-app
npm run test:e2e
```

If a command does not exist, do not invent success. Find the repository equivalent or add a justified script.

For each phase, record:

```text
- commands run;
- pass/fail result;
- material warnings;
- unresolved blockers;
- files changed.
```

---

## 32. Commit/work-unit plan

Recommended reviewable sequence:

```text
1. feat(meta): add domain types and provider interface
2. feat(db): add tenant-scoped Meta integration schema
3. feat(security): add encrypted Meta token storage
4. feat(meta): implement OAuth state and mocked connection flow
5. feat(admin): add Meta asset selection and status UI
6. feat(meta): add catalog normalization and sync jobs
7. feat(products): enqueue Meta sync from product mutations
8. feat(storefront): add tenant Pixel and browser events
9. feat(meta): add CAPI event delivery and deduplication
10. feat(admin): add Meta diagnostics and retry controls
11. feat(super-admin): add platform Meta health view
12. feat(meta): add webhook and lifecycle handling
13. test(meta): add isolation, integration, and E2E coverage
14. docs(meta): update architecture, schema, tasks, UI, deploy, worklog
```

Do not force this exact commit structure if the repository workflow differs. Preserve logical separation.

---

## 33. Required documentation updates

All targets below live under **`specs/docs/`** (not the repo root — see §0.10), and they already exist.
Also update **`CHANGELOG.md`** (root) per landed work unit and the ADR index line in **`AGENTS.md`**
(the "Docs" table). When implementation begins, update:

### `ARCHITECTURE.md`

Add:

- tenant-owned advertising assets;
- Meta integration API;
- catalog worker;
- event worker;
- storefront tenant tracking resolution;
- security boundary.

### `SCHEMA.md`

Add all Meta tables, enums, constraints, and RLS notes.

### `DATA_MODEL.md`

Add relationships among store, connection, mappings, jobs, deliveries, products, variants, and orders.

### `TASKS.md`

Add a dedicated epic using the phase checklist in this ADR.

### `UI_INVENTORY.md`

Add merchant Meta integration screens and super-admin Meta health screen.

### `DEPLOY.md`

Add environment names, secret-management rules, worker deployment, queue dependencies, and webhook URL setup.

### `WORKLOG.md`

Record implementation decisions, test commands, sandbox verification, and unresolved provider constraints.

---

## 34. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Cross-tenant asset leakage | RLS, trusted session store scope, server-side asset verification, isolation tests |
| Token leakage | Encryption, server-only modules, redacted logging, no client serialization |
| Provider API changes | Configured API version, isolated adapter, official-doc verification |
| Duplicate conversions | Shared deterministic `event_id`, idempotent delivery records |
| Lost product updates | Transactional outbox or equivalent committed-event seam |
| Sync storms | Payload hashes, coalescing, concurrency limits, rate-limit handling |
| Invalid catalog products | Per-item validation and skip reasons |
| Revoked permissions | Health checks, webhooks, degraded status, reconnect flow |
| Worker outage | Queue-age metrics, alerts, retryable jobs, dead-letter queue |
| Incorrect Purchase timing | Explicit payment/COD event policy and server-side source of truth |
| Privacy overcollection | Data minimization, short retention, sanitized diagnostics |
| Merchant lock-in | Tenant owns Business, Dataset, Catalog, Ad Account, and advertising history |

---

## 35. Future extensions

Possible follow-up ADRs:

1. Meta campaign creation from Tokophi.
2. Tokophi-managed Meta onboarding assistance.
3. Multi-catalog or multi-market support per store.
4. Dual-destination events for enterprise merchants.
5. Collaborative Ads / CPAS-style platform model if Tokophi becomes an eligible marketplace/retailer.
6. Unified provider interface for Google Merchant Center, TikTok Catalog, and Pinterest.
7. First-party analytics warehouse independent of advertising platforms.

These extensions MUST NOT weaken the tenant-owned default.

---

## 36. Final architectural statement

Tokophi's default Meta integration is:

```text
Merchant owns the advertising assets.
Tokophi automates the connection, catalog synchronization, and event delivery.
Every operation is isolated by store.
```

This gives Tokophi a Shopify-like merchant experience while preserving asset ownership, migration portability, attribution clarity, and multi-tenant security.
