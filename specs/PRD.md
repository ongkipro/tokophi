# TokoΦ — Product Requirements Document (v0.5)

> **Rewritten 2026-07-14 against the code and the database.** Prior versions of this PRD described the
> product as it was *planned*, not as it *is*: they claimed 54 tables (there are 70), three surfaces
> (there are four), a payment fee-bearer feature (it does not exist), and an ad-platform integration
> (there is none). **Everything below is either verified or explicitly labelled aspirational.**
>
> **Owner:** Paduka Ongki / ongkipro · **Code:** `~/projects/tokophi` (monorepo)
> **Verification companions:** [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) (what must be true) ·
> [`docs/STATUS.md`](docs/STATUS.md) (what is real vs. fake) · [`docs/SCHEMA.md`](docs/SCHEMA.md) ·
> [`docs/UML.md`](docs/UML.md) · [`docs/SYSTEM_MAP.md`](docs/SYSTEM_MAP.md) ·
> [`docs/FLOWS.md`](docs/FLOWS.md) · [`docs/BACKLOG.md`](docs/BACKLOG.md)

---

## 1. What this is

A **Shopify-style commerce platform for the Indonesian market**. One multi-tenant merchant admin, one
multi-tenant SSR storefront, a platform control plane we run, and a marketing front door. Bahasa
Indonesia, IDR, tuned to how Indonesian sellers actually work: WhatsApp, COD, local couriers, QRIS and
e-wallets, payday cycles.

**Deliberately not Shopify:**

| | |
|---|---|
| ✅ **Self-serve store builder** (ADR 0009) — but **section-based, not free-form**. A curated registry (Hero, Product Grid, …), not arbitrary HTML/CSS/Liquid. | ❌ **No Themes menu.** No Liquid. No theme marketplace. |
| ✅ **Checkout is locked and uniform** across every store (branding tokens only). | ❌ **No Apps / plugins marketplace.** The feature set is curated in-core. |
| ✅ **Payments and shipping are platform-managed** — the merchant "terima matang" (ADR 0004). | ❌ **No plan tiers.** One plan, all features. |
| ✅ **The platform holds the money and pays the merchant out.** That makes us a custodian, and it is the single most consequential thing about this product. | ❌ **Provider brands are never shown** to merchants or shoppers. |

---

## 2. The four surfaces

| # | Surface | Package | Tech | Dev port | Prod host | Indexable | Multiplicity |
|---|---|---|---|---|---|:--:|---|
| 1 | **admin** | `@tokophi/admin` | Next.js (App Router, RSC + server actions) | 3000 | `app.tokophi.com` | **no** | 1 app, all merchants. **Also hosts the entire public HTTP API** and the media store |
| 2 | **super-admin** | `@tokophi/super-admin` | Next.js | 3001 | `rich.tokophi.com` | **no** | 1. Cross-tenant. Owner DB connection, deliberately outside RLS |
| 3 | **storefront** | `@tokophi/storefront` | Astro **SSR** | 4327 | `<slug>.tokophi.com` | yes | **1 deploy serves every tenant**, resolved from the `Host` header (ADR 0009) |
| 4 | **landing** | `@tokophi/landing` | Astro **static** | 4328 | `tokophi.com` | yes | 1. **Zero DB dependency, on purpose** — the front door must serve when everything behind it is down |

Five shared packages: `@tokophi/db` (Drizzle schema + `withTenant`), `@tokophi/lib` (formatters,
billing, the AutoLaris and KiriminAja clients), `@tokophi/ui` (shadcn on **Base UI**, not Radix),
`@tokophi/sections` (**types only** — the Store Builder contract, shared by the admin's editor and the
storefront's renderer so they cannot drift), `@tokophi/data` (canonical nav).

**There are only four cross-surface edges** — see [`UML.md` §2](docs/UML.md). Everything else goes
through the database. No service mesh, no queue.

---

## 3. The money model

**This is the heart of the product and the part most likely to be got wrong.** TokoΦ collects money on
the merchant's behalf and owes it back. Every design decision below exists because a specific, cheaper
alternative would have lost someone's money.

### 3.1 The ledger

`ledger_entries` is an **append-only book**. Nothing is ever edited in place; a reversal is always a
**new opposing entry**, so the book can be replayed and audited.

| Concept | Rule |
|---|---|
| **Balance** | **DERIVED, never stored.** `saldo tersedia = Σ amount_idr WHERE status='available'`; `dana dalam proses = Σ WHERE status='pending'` |
| **What is credited** | `payments.amount_idr` — **what the merchant is owed**. Never `payments.total`, which adds the gateway's admin fee. That fee is the gateway's money and never was the merchant's |
| **When a sale is booked** | When money is **COLLECTED** — a `payments` row reaching `berhasil`. Not at order creation (the shopper may never pay), not at bill creation (a VA number is not money), not at despatch |
| **Entry kinds** | `sale` · `retur` · `payout` · `adjustment`, each `pending` or `available`, `amount_idr` **signed** |

Because the ledger credits `amount_idr`, Dashboard revenue, the Pesanan list and Saldo agree **by
construction** rather than by coincidence.

Before this existed, the Saldo chip was `sum(payments)` — Rp18,9jt — presented as if all of it were
withdrawable, when two thirds was still held against unfinished orders.

### 3.2 The release rule — `selesai`, not `dikirim`

A sale lands `pending` and is released to `available` when the order reaches
`platform_payout.release_on`, **default `selesai`**.

> **Releasing at `dikirim` looks generous and is a trap.** A parcel can only be *returned* after it has
> shipped — so despatch-time release lets a merchant withdraw money for goods that come back. And on
> **COD the cash does not exist at despatch at all**: the courier collects at the door and settles days
> later. The knob exists (an operator can widen it without a deploy) and it **is actually read**; the
> default should stay where it is.

### 3.3 COD is booked at the door

With COD the platform holds **nothing** when the order is placed. The payment row is created `menunggu`
and must stay that way. The tracking poller treats KiriminAja's numeric status `200` as `delivered`;
`syncOrderFromKa` maps that outcome to `selesai` and runs the same atomic order transition used by the
merchant action. Entering `selesai` flips the pending COD payment to `berhasil`, marks the order paid,
and books the sale as `available` because the order is already complete. A merchant can still move an
order to `selesai` manually; there is no courier push webhook. Free-text tracking status never triggers
a money-moving delivery outcome. A refused parcel goes `batal` / `retur`, where the pending payment is
**failed**: cash that was never collected is never booked.

### 3.4 Payouts

A merchant requests a withdrawal; **only an `owner`** can (it requires `settings:write`). It is refused
below `platform_payout.min_payout_idr` (Rp50.000), above the available balance, or with no bank account
on file. Bank details are **snapshotted onto the payout** — editing the account later must not rewrite
where past money went.

A platform operator then `processPayout` → `markPayoutPaid` (**no ledger write**: the merchant was
already debited at request time, so re-crediting would double-count) or **`rejectPayout`**, which posts
an opposing `adjustment` computed from `Σ ledger_entries WHERE payout_id = ?` — never from
`payouts.amount_idr` — so it is exact by construction and cannot over- or under-refund.

### 3.5 What makes it safe

| Guarantee | Mechanism |
|---|---|
| A retried gateway callback cannot credit twice | `ledger_one_sale_per_payment` (partial unique index) |
| A double-clicked "Retur" cannot double-refund | `ledger_one_retur_per_order` |
| Two concurrent withdrawals cannot both pass the balance check | `pg_advisory_xact_lock(hashtext(store_id))` inside the txn |
| The money endpoints cannot be called by anyone | `/api/public/pay/callback` and `/api/cron/billing` **fail CLOSED** — 401 in production when the secret is unset |

Double-credit is a **database impossibility**, not an application hope. Gateway callbacks retry;
buttons get double-clicked.

---

## 4. COD policy — and why it is SPX-only today

COD is the payment method Indonesian shoppers ask for and the one that costs the most to get wrong: it
is the only method where physical cash moves through four parties (buyer → courier → aggregator →
platform → merchant) with days of lag, and returns that reverse the flow.

**Five conditions must all agree** before an order may be COD. They are checked **server-side in
`/api/public/order`, before any row is written** — hiding the option at checkout is UX; that endpoint
is the boundary. A script POSTing `channelCode:"cod"` gets a 403 and zero rows.

| # | Condition | Source | Today |
|---|---|---|---|
| 1 | the platform allows COD at all | `platform_cod.enabled` | **on** |
| 2 | **this merchant** wants COD | `store_settings.cod_enabled` — default **false**, opt-in | **on** for the demo store; the other six are off |
| 3 | the order total is within the cap | `platform_cod.max_amount_idr` (`0` = no cap) | **Rp2.000.000** |
| 4 | the destination province is allow-listed | `platform_cod.allowed_provinces` (empty = anywhere) | **6**: DI Yogyakarta, Jawa Tengah, Jawa Barat, DKI Jakarta, Banten, Jawa Timur |
| 5 | the **service** the shopper picked may carry it | `platform_couriers.services[].cod && .codAllowed !== false` | **SPX Standard + SPX Economy only** |

**Condition 4 does not read the typed address.** The province is resolved from the **KiriminAja district
id the ongkir quote was issued for** — the id the parcel is actually booked against. A hostile client
can type "DKI Jakarta" and ship to Papua; it cannot forge a district that prices to a different
province. If COD is requested and the district cannot be verified, the request is **refused**.

The merchant's half of the chain is one switch: Pengaturan → **Pengiriman** → "Bayar di Tempat (COD)".
Under it, the Jasa Kirim list states each service's COD status, so the seller can see *why* — the two SPX
services carry a green **COD** badge, everything else says "Tidak mendukung COD.". At checkout the `cod`
flag on a rate is the **effective** one — KiriminAja's capability **×** the platform's per-service
allowance **×** this store's switch — so the storefront can only ever advertise COD where the order API
would in fact allow it.

### Why only SPX Standard + SPX Economy

**Not because KiriminAja restricts it.** KiriminAja reports `cod = true` on **14 services across 10
couriers** — that was worth checking rather than assuming. The asymmetry that actually costs money is
**RETURNS**: a refused COD parcel is believed to ship back **free on SPX** and to be **billed to the
merchant elsewhere**.

> ⚠️ **That belief is UNVERIFIED, and the entire policy rests on it.** Free returns are a *Shopee Seller
> Center* benefit; we reach SPX through *KiriminAja*, a third-party aggregator with its own contract,
> and the KiriminAja API exposes **no return field at all**. If returns are in fact billed through
> KiriminAja, the rationale collapses and we have restricted COD to one courier for nothing.
> **Get this in writing.** ([`BACKLOG.md`](docs/BACKLOG.md))

Because of that uncertainty, the narrowing is a **per-service boolean an operator can flip**
(`codAllowed`), not `if (courier === "spx")` welded into the code. Widening is a tick box, not a deploy.
`platform_cod.fee_pct` — a COD fee charged to the buyer, which would fund a return pool and let COD open
on every courier — **exists in the schema, is seeded to 0, and nothing reads it.** It is the obvious
next lever and it is not built.

---

## 5. Order lifecycle

`baru → diproses → dikirim → selesai | batal | retur`

`retur` (migration 0039) exists because **COD's biggest cost was unmeasurable**: a refused parcel could
not be recorded at all. It restores inventory (the goods are back on the shelf, exactly like `batal`),
fails the pending payment, and claws the credit back with an opposing ledger entry.

Full transition table — including what each one does to inventory and to the ledger — is
[`UML.md` §3.1](docs/UML.md). Read it before touching `setOrderStatus`.

**Known gap:** `orders.courier` is NULL on 699 of 700 rows, because a regular checkout books no
shipment. So the per-courier return-rate report — **the number the whole COD policy is betting on** —
cannot yet produce a per-courier answer.

### 5.1 Before the order: the checkout that never became one

Indonesia abandons the great majority of its carts, and **TokoΦ recorded none of them** — there was no
cart table. `checkout_sessions` (migrations `0044` + `0045`) is that record.

**There is no "abandon" event to listen for. Abandonment is the ABSENCE of an order.** So the storefront
writes the row **as the shopper types** (debounced beacons → `apps/storefront/src/pages/api/checkout-session.ts`);
a session that stops updating and never becomes an order **is** the abandonment. A sweep flips
`aktif` → `ditinggal` after 60 minutes of silence and stamps `abandoned_at`.

| Metric | Definition | Today |
|---|---|---|
| **Abandon rate** | `ditinggal / (ditinggal + orders)` | **80,0%** |
| **Recovery rate** | `rescued / (rescued + ditinggal)`, where **`rescued = abandoned_at IS NOT NULL AND recovered_at IS NOT NULL`** | **11,2%** |

30-day window. **`aktif` is excluded from both sides** — nobody has abandoned anything yet; the shopper
is still typing.

> **Why `abandoned_at` (0045) exists.** A straight-through checkout **also** ends `pulih`. The naive
> `pulih / (pulih + ditinggal)` renders **19,3%** — it counts every ordinary sale as a save and tells a
> merchant it rescued carts it never lost. **A number that looks real and is wrong is worse than no
> number.**

**Recovery travels on WhatsApp**, so the phone is the field the whole table is paid for.
`/pelanggan/keranjang` ranks by what a merchant can act on — has-phone first, then basket value **decayed
by age** (`subtotal / (1 + minutesAgo/1440)`) — and one click opens `wa.me` with the template filled
server-side. It records **"WA dibuka", not "terkirim"**: wa.me cannot tell us whether the message was
sent or read, and **we do not display what we cannot observe.** The link back into the checkout is a
**signed, store-bound, 7-day HS256 token**, never the raw session id — which in a URL is a bearer
credential for a stranger's name, phone and address the moment it is forwarded or leaks via `Referer`.

**Buying never requires an account.** `customers.registered_at IS NULL` = **guest**, and guest is the
**normal** case, not a defect: a registration wall in front of an Indonesian checkout is the most
reliable way to lose the sale. The admin styles **Tamu as neutral** and Terdaftar as the extra.

⚠️ **Built and proven locally, end-to-end in a real browser — and NOT deployed.** Both commits sit on a
branch; production still records nothing. The ageing sweep is **opportunistic** (a store with no visitors
never ages its own carts) and the capture rate limiter is in-process. ([`BACKLOG.md`](docs/BACKLOG.md) §P1.8)

---

## 6. Subscription billing (what merchants pay us)

**One plan, all features.** 3-day trial → **Rp50.000** first month → **Rp275.000/mo** (annual
Rp2.700.000). Prices are the **DPP (ex-tax)**; the merchant pays base + **PPN 11%**. Invoices store the
PPN-inclusive total; the faktur itemises DPP + PPN.

**Store lifecycle:** `trial → first_month → regular → vip`. **VIP = `stores.comped`** — free, always
active, never billed, never suspended.

A past-due store goes **read-only** after its grace period (`requireCapability` throws
`SuspendedError`) — but `support:write` opts out, because a suspended store must still be able to
contact us about the billing problem that suspended it.

> **Do not reintroduce plan tiers.** `plans`, `plan_key` and `stores.plan` are legacy, unread, and kept
> only because dropping them is destructive.

---

## 7. Data & tenancy

**70 tables. 51 migrations (0000–0050). RLS on 45.** ([`SCHEMA.md`](docs/SCHEMA.md) — regenerated from the catalog,
not from memory.)

**The tenant boundary is RLS, not a hand-written `WHERE`.** Every admin read and write runs inside a
transaction that sets `app.store_id` and drops to the non-owner `tokophi_app` role, so the policies
actually apply. No tenant context ⇒ **zero rows**: it fails closed.

Exactly one `store_id` table has no RLS — `platform_activity`, the platform's audit log *about*
tenants, deliberately owner-only.

**Five deliberate owner-connection exceptions** (auth, `/api/public/*`, the billing cron, the storefront,
super-admin). The largest is `/api/public/*`: the shopper has no session, so there is no GUC to set, and
tenant correctness on the **checkout path** rests on application code passing an explicit `store_id`.
That is the biggest structural risk in the system and it is named, not hidden.

---

## 8. Status — what is actually built

Grounded; see [`STATUS.md`](docs/STATUS.md) for the item-by-item 🟢/🟡/🔴 inventory.

| Area | State |
|---|---|
| **Admin** — 20+ modules | 🟢 All read the DB; all editors write it. Dashboard is an **action queue**, not vanity metrics. Pesanan is a **seller centre** (Shopee-style tabs, server-side search/filter/paging, counts that partition exactly) |
| **Money** — Saldo, ledger, payouts | 🟢 Real, end-to-end. Balance derived, book append-only, payout approval in super-admin |
| **COD** | 🟢 Enforced **and switched on** end-to-end (SPX only), exercised in a real browser. ⚠️ Its central premise is unverified (§4), and the return rate it optimises for is unmeasurable (§5) |
| **Shipping** | 🟢 Live ongkir + live roster sync + shipment booking, and the checkout now offers **exactly the services the seller ticked** (`store_shipping_methods`; until `35b88a4` it read the courier-level list and offered services the seller had switched off). ⚠️ The sandbox never issues an AWB |
| **Storefront** | 🟢 SSR multi-tenant, Store Builder, real funnel events. 🟢 `/blog` reads the DB; WhatsApp is per-store (email still shared) |
| **Super-admin** | 🟢 Rebuilt on real numbers (`571ed17`). The merchant float is shown as a **liability** |
| **Analytics** | 🟡 Honest maths, demo rows. The funnel is a `GROUP BY` over `analytics_events`; those rows are still overwhelmingly seeded |
| **Ads / Pemasaran** | 🔴 **There is no Meta/Google/TikTok integration.** The cards say "Belum terhubung". Only `orders.channel` attribution is real |
| **Abandoned checkouts** (§5.1) | 🟢 Captured (`0044` + `0045`), `/pelanggan/keranjang` + one-click WA recovery, rates that distinguish a **rescue** from an ordinary sale. 🔴 **Not deployed** — production still records none of them |
| **Customers** | 🟢 Guest (`registered_at IS NULL`) vs registered, as a real column. The Pelanggan card used to claim **3.128 customers and "+8,2% bulan ini"**; there are **24**, and nothing computed the change |
| **Chat** | 🟡 Schema landed (migration 0043); app code in flight |
| **Tests** | 🔴 **One test file in the whole repo.** Nothing automatically tests the ledger, the COD gate, or the order state machine |

### Aspirational — NOT built (do not describe these as if they were)

- Meta / Google / TikTok ad integration, and any ROAS or spend figure.
- **Abandoned-cart AUTOMATION.** The carts are captured and recovery is one click — but a human makes
  that click. Nothing sends on a schedule.
- A merchant-facing **payment fee-bearer** setting. `payment-fees.ts` has **zero importers**.
- A **COD fee** (`fee_pct`).
- **Custom domains** — BUILT slices 1–3 (2026-07-15): `store_domains` table (migration 0050) + RLS, `slugFromCustomDomain()` resolver, admin UI (Pengaturan → Domain). TLS activation (slice 4) pending.
- Storefront accounts. (Storefront blog is BUILT — reads the DB.)
- Courier tracking webhooks, thermal-label PDF.
- Google OAuth **proven against real credentials**.
- MinIO/S3 media (local disk today).

---

## 9. Design language

Modern SaaS: clean, generous spacing, rounded-xl, soft shadows, restrained palette, one indigo accent,
light + dark. Font: Geist. AA accessibility, console-clean, fast on cheap Android.

**shadcn/ui here runs on Base UI (`@base-ui/react`), NOT Radix** — the #1 source of mistakes. Triggers
use `render`, not `asChild`. Do not use `Select`. A `Button` rendered as a link needs
`nativeButton={false}`. See `AGENTS.md`.

---

## 10. Open questions

1. **The SPX free-return claim.** Verify with KiriminAja in writing. The COD policy depends on it. (§4)
2. **`/api/public/*` runs outside RLS.** Do we introduce a `store_id`-scoped read role for the public
   path, or accept application-enforced tenancy on the checkout endpoint?
3. **Rate limiting is in-process.** Move to the Cloudflare edge, or accept that limits do not hold
   across replicas.
4. **`platform_activity` has a `store_id` and no RLS.** Deliberate today. Revisit if merchants ever get
   to see their own audit trail.
5. **Tests.** The ledger, the COD gate and the state machine have none. `select sum(…) for update` —
   which Postgres rejects outright, breaking *every* withdrawal — shipped because `tsc` cannot see
   inside a SQL string. What is the minimum suite that would have caught it?

---

*Living document. Every claim here is checkable — see [`REQUIREMENTS.md`](docs/REQUIREMENTS.md).
Change history: `CHANGELOG.md` + git.*
