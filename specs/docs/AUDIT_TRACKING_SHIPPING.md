# AUDIT — Batch 4: Tracking & Shipping Signals

> **Scope:** courier tracking poller, courier webhook posture, the server-side conversion outbox
> (Meta CAPI / TikTok Events API / GA4 Measurement Protocol), the browser pixel layer, event
> de-duplication, attribution capture, and notification dispatch.
> **Method:** static, evidence-based audit of the repository at `/home/ongki/Projects/tokophi`.
> **Constraint honoured:** no application code was edited, no formatter/linter/build/test command was
> run. Every claim below cites a path and a line range that was read.
> **Companion docs:** `specs/docs/KIRIMINAJA.md` (vendor contract), `specs/docs/SCHEMA.md`,
> `specs/docs/SECURITY.md`, ADR 0012 (conversion signals), ADR 0013 (catalog ids).

---

## 1. Executive Summary & Domain Scope

### 1.1 What this batch owns

Two asynchronous pipelines meet in this batch, and they are the only two places in TokoΦ where an
external system is allowed to change money-bearing state without a human clicking anything:

| Pipeline | Trigger | Entry point | State it moves |
|---|---|---|---|
| **Shipping tracking** | 15-minute sidecar | `apps/admin/app/api/cron/tracking/route.ts` | `orders.awb`, `orders.status`, `orders.problem_at/problem_note`, and — through `applyOrderStatusChange` — inventory, payments and the ledger |
| **Conversion outbox** | 60-second sidecar | `apps/admin/app/api/cron/tracking-events/route.ts` | `tracking_event_deliveries` rows, and the merchant's ad-platform reporting |

A third surface, the **browser pixel layer**
(`apps/storefront/src/components/MarketingPixels.astro`), is the client half of the second pipeline
and shares one contract with it: the `event_id` string.

A fourth surface named in the assignment — **WhatsApp notification dispatch** — is audited in §2.8.
The finding there is structural: **no dispatcher exists.**

### 1.2 Overall verdict

The two pipelines are, on the evidence, **unusually well-engineered for their class**. Both are
forward-only, both are bounded per tick, both record a liveness row with counters (not just a
timestamp), both survive a mid-tick crash, and both carry deliberate, documented refusals to guess
(`outcomeFromTrackingCode` returns `null` rather than inventing a state; `sendMetaPurchase` returns
`no_identity` rather than fabricating a match key). The queue's idempotency is enforced by a database
constraint (`unique(store_id, channel, event_id)`), not by application luck, and the claim is a single
`UPDATE … FOR UPDATE SKIP LOCKED … RETURNING` statement — the correct primitive.

The defects that remain are therefore **not** "the code is wrong"; they are **boundary, capacity,
coverage and disclosure** defects. Ranked:

| ID | Severity | Finding | Primary evidence |
|---|---|---|---|
| **TS-01** | High | No courier webhook. Polling is the only path an AWB can reach the system; the vendor's own `processed_packages` event is unused | `cron/tracking/route.ts:5-20`, `specs/docs/KIRIMINAJA.md:121-152` |
| **TS-02** | High | The shipping sweep is one **global, unpartitioned** batch of 100. One high-volume store can consume the whole tick; permanently-unresolvable orders hold slots forever | `cron/tracking/route.ts:31,96-106` |
| **TS-03** | High | The cron secret travels **in the URL query string** from every sidecar | `docker-compose.coolify.yml:318,344`, `cron/tracking/route.ts:66-78` |
| **TS-04** | High | **Prepaid orders never produce a Google Ads conversion.** The Ads tag is browser-only and the browser Purchase is gated off for prepaid | `MarketingPixels.astro:455-470,584-586`, `api/public/order/route.ts:1141-1145`, absence of `adsSendTo` in `lib/capi.ts` |
| **TS-05** | High | **No WhatsApp notification dispatch exists.** `wa_messages` is written by nothing; follow-up "delivery" is a `wa.me` deep link | `packages/db/src/schema.ts:1183-1191` (only occurrence), `lib/actions/checkout.ts:18-52` |
| **TS-06** | Medium-High | `kaTrack` has **no request timeout**. One hung courier connection stalls an entire 100-order sweep | `packages/lib/src/kiriminaja.ts:25-48` vs `lib/capi.ts:23,119-135` |
| **TS-07** | Medium-High | The merchant's manual **"Lacak" button does not advance order state** — it writes the AWB and discards the courier status | `lib/actions/shipping.ts:1216-1270` |
| **TS-08** | Medium | The release sweep reaches back **7 days**, which is exactly Meta's event window — a conversion released at the boundary is guaranteed to dead-letter | `cron/tracking-events/route.ts:120-131,183-190` |
| **TS-09** | Medium | Courier **proof-of-delivery free text is logged**. Indonesian POD strings routinely carry the receiver's name | `cron/tracking/route.ts:158-175` |
| **TS-10** | Medium | `gclid`/`gbraid` is captured at checkout, used for `orders.channel`, then **dropped** before the server event — no offline-conversion path exists | `lib/tracking-events.ts:32-67`, `lib/ad-channel.ts:60-70` |
| **TS-11** | Medium | The browser Purchase key falls back to `order.createdAt` when the order number is absent, which desynchronises GA4's `transaction_id` from the server's | `MarketingPixels.astro:590,626` |
| **TS-12** | Medium | `ttclid` + UTM capture logic is **duplicated** in two storefront files with no shared module | `checkout.astro:2579-2630`, `OrderFunnel.astro:258-505` |
| **TS-13** | Medium | The retention purge filters on `created_at` with **no supporting index** | `cron/tracking-events/route.ts:183-190`, `schema.ts:1490-1498` |
| **TS-14** | Low-Med | PII retention is enforced **only** by the cron. If the drain container dies, retention silently extends while nothing reports it as a privacy event | `cron/tracking-events/route.ts:176-198` |
| **TS-15** | Low | `not_configured` burns the retry budget in ~6 h; a longer credential rotation dead-letters live conversions | `cron/tracking-events/route.ts:29-38,290-305` |
| **TS-16** | Low | The merchant health panel is 7-day windowed while rows are retained 30 days — older dead-letters are invisible but not deleted | `lib/data/tracking.ts:146-200` |
| **TS-17** | Low | The shipping poller has **no claim/lease**; two overlapping ticks re-poll the same orders (idempotent, but doubles vendor API load) | `cron/tracking/route.ts:96-106` |
| **TS-18** | Info | Codes `210`/`211`/`350` are deliberately unmapped; those orders are polled indefinitely by design. Interacts with TS-02 | `lib/ka-status-codes.test.ts:68-73` |

### 1.3 What is explicitly *not* in this batch

Order status semantics beyond the courier's own transitions, stock reservation, ledger credit and COD
settlement are Batch 3 (`OrderStockDispatchAuditor`); payment callbacks are Batch 2
(`PaymentCheckoutAuditor`). Where this audit touches them it does so only at the seam —
`applyOrderStatusChange` as called from `syncOrderFromKa`, and `releasePurchase` as called from the
gateway callback.

---

## 2. Current Implementation Analysis & Code Evidence

### 2.1 Shipping tracking: the pull-only pipeline

**The sweep.** `apps/admin/app/api/cron/tracking/route.ts` is a `nodejs`, `force-dynamic` route
(`:24-25`) driven by the `cron-tracking` sidecar every 900 s
(`docker-compose.coolify.yml:298-318`).

Authentication fails closed in production and is permissive only outside it:

```ts
// cron/tracking/route.ts:66-78
const secret = process.env.CRON_SECRET;
const provided = req.headers.get("x-cron-secret") ?? req.nextUrl.searchParams.get("secret");
if (!secret) {
  if (process.env.NODE_ENV === "production") { /* 401 */ }
} else if (provided !== secret) { /* 401 */ }
```

When KiriminAja is unconfigured the route answers **HTTP 200 with `{ok:false}`** and records a
*failed* run, so the sidecar's `wget` succeeds while the operator panel turns red — a deliberate
separation of transport success from business success (`cron/tracking/route.ts:80-95`; the
corresponding assertion is `apps/super-admin/app/(platform)/analitik/cron-liveness.test.ts`, "`ok:false` is red even when it called on time").

**The selection.** One statement, no per-store partition:

```ts
// cron/tracking/route.ts:101-106
const orders = await db
  .select({ number, kaOrderId, awb })
  .from(schema.orders)
  .where(and(isNotNull(schema.orders.kaOrderId), inArray(schema.orders.status, ["diproses", "dikirim"])))
  .orderBy(sql`${schema.orders.awb} is not null`, asc(schema.orders.placedAt))
  .limit(BATCH); // BATCH = 100  (:31)
```

The `ORDER BY` is documented as load-bearing: waybill-less orders first (`false` sorts before `true`
in Postgres ascending order), then oldest. The file's own comment records the regression this fixed —
a bare `.limit(100)` with no ordering, under which Postgres may return the same arbitrary rows every
tick.

**Per-order isolation.** The vendor call sits *inside* the `try`, and the file records exactly why:

```ts
// cron/tracking/route.ts:113-127
try { r = await kaTrack(ref); }
catch (err) { errors.push(o.number); continue; }   // "One bad reply must cost one order, never the sweep."
```

**The mapping.** `apps/admin/lib/ka-tracking.ts` is the single translator from courier code to order
state. `outcomeFromTrackingCode` (`:35-73`) accepts a number *or* a string, collapses 38 documented
codes into six outcomes, and returns `null` for anything it does not recognise. Free text may only
ever carry an order forward to `shipped`; it can never produce a money-moving outcome — a rule pinned
by test (§4).

**The state machine.** `syncOrderFromKa` runs inside a transaction, and monotonicity is enforced by
an explicit rank:

```ts
// lib/ka-tracking.ts (RANK + guard)
const RANK: Record<OrderStatus, number> = { baru: 0, diproses: 1, dikirim: 2, selesai: 3, retur: 4, batal: 4 };
if (target && RANK[target] > RANK[cur]) { await applyOrderStatusChange(tx, { … }); }
```

A replayed tracking pull therefore cannot drag a `selesai` order back to `dikirim`, cannot re-book
stock and cannot re-open a settled ledger entry. The `problem` outcome is a **flag**, not a status
change (`orders.problem_at` / `problem_note`), and it is cleared when the parcel moves again.

### 2.2 The courier transport, and its one asymmetry

`packages/lib/src/kiriminaja.ts:25-48` wraps every vendor call. It reads the body as text and only
then parses, so an HTML `502` becomes a named `KaTransportError` carrying path, status and a 200-char
snippet instead of an unattributable `Unexpected token <`. A JSON body is deliberately returned even
on 4xx/5xx, because the vendor signals business failures as `{status:false, text:"…"}`.

**What it does not have is a timeout.** Compare the two transports in this batch:

```ts
// packages/lib/src/kiriminaja.ts:25-31 — no AbortController, no signal
const res = await fetch(`${BASE}${path}`, { method, headers: { … }, body: …, cache: "no-store" });

// apps/admin/lib/capi.ts:23,119-135 — hard 10 s ceiling
const TIMEOUT_MS = 10_000;
const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
```

The conversion sender reasons explicitly that "a hanging provider must not hold a cron tick open".
The shipping poller — which makes **100 sequential calls per tick** — has no such ceiling. This is
TS-06.

### 2.3 The conversion outbox

**The table is the queue.** `packages/db/src/schema.ts:1436-1500` defines
`tracking_event_deliveries` with three constraints that carry the whole design:

```ts
unique().on(t.storeId, t.channel, t.eventId),                        // idempotency
index("tracking_event_deliveries_due_idx").on(t.status, t.nextAttemptAt),  // the claim
index("tracking_event_deliveries_store_idx").on(t.storeId, t.createdAt),   // the health panel
```

The row holds commerce facts only — `value/goods/shipping/tax/lineItems/currency/contentIds/numItems/
orderNumber/occurredAt` plus a `client` block of match keys. **No email, no phone, no token** is ever
persisted; identity is re-read fresh at send time and hashed inside the sender
(`cron/tracking-events/route.ts:307-330`).

**Enqueue is on the checkout hot path, and pays for itself.** `enqueuePurchase`
(`lib/tracking-events.ts:206-305`) queries the store's channels *first* so a store with no tracking
configured pays nothing, then builds facts (four queries), then inserts with
`onConflictDoNothing` on the unique triple. A double checkout submit or a retried gateway callback
cannot produce a second conversion.

**Prepaid orders are queued held, not queued late:**

```ts
// lib/tracking-events.ts — HOLD_UNTIL
const HOLD_UNTIL = new Date("2126-01-01T00:00:00Z");
nextAttemptAt: opts?.hold ? HOLD_UNTIL : new Date(),
```

The reasoning recorded in-file is correct and non-obvious: checkout is *the only moment the shopper's
browser context exists*, so a prepaid conversion is built there and parked, rather than being built
in the payment callback without a user agent, IP or Meta cookies — Meta documents the user agent as
required for website events.

**Release is idempotent and un-gated on "did anything change".** `releasePurchase`
(`lib/tracking-events.ts:308-338`) moves only rows that are still `queued` **and** still parked, then
calls `enqueuePurchase` again unconditionally so a channel switched on between checkout and payment
still gets its row.

**The drain reconciles before it claims.** `cron/tracking-events/route.ts:100-175` runs two sweeps
that exist because both of the ways a real sale can silently produce no conversion are un-self-healing:

1. **Release sweep** — held rows whose order is already `dibayar` (a lost or 401'd gateway callback).
2. **Backfill sweep** — paid or COD orders **younger than 3 days** with no delivery row at all (a
   transient failure of the inline enqueue), excluding `batal`/`retur` and refunds, and only for
   stores that actually have a usable channel. Each backfill is wrapped **per order**, so one
   deterministically-throwing order cannot block the other nineteen.

**The claim is one statement, and must stay one:**

```sql
-- cron/tracking-events/route.ts:200-242
UPDATE tracking_event_deliveries SET status='processing', attempt_count = attempt_count + 1
 WHERE id IN (
   SELECT d.id FROM tracking_event_deliveries d
    WHERE (d.status IN ('queued','failed') AND d.next_attempt_at <= $now)
       OR (d.status = 'processing'        AND d.updated_at     <= $stale)
    ORDER BY d.next_attempt_at ASC LIMIT 50 FOR UPDATE SKIP LOCKED)
RETURNING …
```

`BATCH = 50`, `STALE_MS = 30 min`, `MAX_ATTEMPTS = 6`, backoff `attempt² × 60 s` capped at 6 h with
≤30 s jitter (`:29-38`). Two properties are worth naming because both were regressions once:
`attempt_count` is incremented **by the claim** (counting the attempt, not the outcome, is what makes
`MAX_ATTEMPTS` reachable for a row whose tick is killed mid-send), and `finish()` **never throws**
(`:414-445`) — leaving a row `processing` for `STALE_MS` is the safe failure; losing the other 49 rows
of the batch is not.

An **idle tick is still recorded** (`:245-252`), so a quiet day is distinguishable from a dead
container — the exact confusion that let `awbFilled` sit at 0 for a week on the shipping side.

### 2.4 The three provider senders

`apps/admin/lib/capi.ts` is the one boundary where provider-specific shapes live. Its normalisation
rules are correct in the two places that fail silently rather than loudly:

- **Email** (`:82-101`): Meta wants trim+lowercase; Google additionally strips dots before `@` for
  `gmail.com`/`googlemail.com`. In this market that dot rule is the difference between matching and
  not matching most buyers, and skipping it returns `200 OK` with nothing to see.
- **Phone** (`:103-117`): Meta wants bare digits (`628…`), TikTok and GA4 want E.164 **with** the `+`.
  The caller chooses; the file states plainly that "one shared normalizer would be a bug wearing a
  helper's hat". The browser half computes **three** digests for the same reason
  (`MarketingPixels.astro:634-640`).

`sendMetaPurchase` (`:141-200`) refuses to fabricate identity:

```ts
if (Object.keys(user_data).length === 0)
  return { ok: false, retryable: false, errorCode: "no_identity", errorMessage: "…" };
```

and it always sends hashed phone/email on the server path regardless of the merchant's "advanced
matching" switch — with the correct justification recorded in-file: that switch governs the *browser*
pixel, and gating the server event on a default-OFF toggle meant the out-of-the-box configuration
400'd every Purchase into `dead_letter`.

Redaction and retry classification live in the **pure** half, `apps/admin/lib/capi-sanitize.ts`, so
they are testable without a network or a database (§4). `classify` treats `2xx` as success (including
GA4's 204-for-everything), `429` and `5xx` as retryable, everything else as permanent.
`tiktokVerdict` (`capi.ts:480-508`) replaces `classify` when a body code is present and re-adds
`|| status === 429 || status >= 500` — the file names this as a loss it already suffered once.

### 2.5 The browser pixel layer

`apps/storefront/src/components/MarketingPixels.astro` renders only when the merchant has enabled at
least one channel. Three properties matter to this audit:

**Deferred vendor loading with synchronous stubs.** The measurement is recorded in-file
(`:250-262`): switching three pixels on took Lighthouse mobile from **90 to 66** and TBT from **130 ms
to 770 ms** — not because of downloads (all three were already `async`) but because of parse+execute
on the main thread. Only the vendor `<script>` is deferred by `later()`; every stub, queue and `init`
still runs synchronously so ordering and the event queue are preserved (`:300-330`).

**The de-dup key is passed through, never derived.**

```js
// MarketingPixels.astro:388-427
if (META) { var opts = data.eventId ? { eventID: data.eventId } : undefined; … }
if (TIKTOK) { if (data.eventId) window.ttq.track(name, props, { event_id: data.eventId }); }
if (GOOGLE) { … window.gtag("event", "purchase", { transaction_id: data.orderId, … }); }
```

**The Purchase gate is server-authoritative.** The success page fires only when the *server* said so:

```js
// MarketingPixels.astro:584-596
if (order && !(order.tracking && order.tracking.browserPurchase === true)) order = null;
…
if (key && seen.indexOf(key) === -1) { seen.push(key); localStorage.setItem("tphi:px:purchased", …); }
```

and `browserPurchase` is `isCod` (`apps/admin/app/api/public/order/route.ts:1141-1145`). A prepaid
order therefore fires **no** browser Purchase — which is correct for revenue honesty (an unpaid VA
screen is not a sale) and is the direct cause of TS-04. Both conversion pages are covered
(`/checkout/sukses` for the storefront checkout, `/thanks` for the ad funnel), and the local
`tphi:px:purchased` list (last 20 keys) prevents a refresh from double-firing.

**Value decomposition is byte-identical to the server's.** The browser computes
`goods = max(0, subtotal − discount)` (`:614`), which the file notes must match
`facts.goods` in `lib/tracking-events.ts` exactly — a voucher previously made the gtag purchase and
the Measurement Protocol purchase report two different values for one `transaction_id`.

### 2.6 The de-duplication contract, end to end

| Provider | Browser field | Server field | Key |
|---|---|---|---|
| Meta | `fbq(…, {eventID})` | `data[0].event_id` | `purchase:{orderNumber}` |
| TikTok | `ttq.track(…, {event_id})` | `event_id` | `purchase:{orderNumber}` |
| GA4 | `gtag('event','purchase',{transaction_id})` | `transaction_id` | `{orderNumber}` |

The key is minted once, by a shared pure helper:

```ts
// packages/lib/src/tracking-ids.ts
purchaseEventId("PHI-123456789ABC") === "purchase:PHI-123456789ABC"
```

and is guarded by test for determinism, for carrying **no tenant identifier** (the order number is
already platform-unique), and for distinguishing two orders (`tracking-ids.test.ts:64-76`). The same
file owns `retailerId`/`itemGroupId`, so `content_ids` on a conversion and `<g:id>` in the product
feeds are the same strings by construction — ADR 0013. The script never derives an id: it uses what
the page rendered (`data-catalog-id`) or what the order API returned
(`api/public/order/route.ts:1123-1145`).

**Uncovered corner.** The browser's key is
`String(order.number || order.createdAt || "")` (`MarketingPixels.astro:590`), and that same `key`
becomes `data.orderId`, i.e. GA4's `transaction_id` (`:626`). If `order.number` were ever absent from
the persisted `lastOrder` blob, the browser would report a timestamp where the server reports
`PHI-…`, and GA4 would count the sale twice. Meta and TikTok are unaffected (they key on
`tr.eventId`, which is `null` in that case, suppressing de-dup rather than corrupting it). This is
TS-11.

### 2.7 Attribution capture and `orders.channel`

`apps/admin/lib/ad-channel.ts` is the most carefully-reasoned file in this batch. Its ordering is:
merchant UTM tagging → paid-only click ids (`gclid`/`gbraid`/`gs`, `ttclid`) → `_fbc` **as `other`,
never `meta_ads`**, because Meta appends `fbclid` to every outbound link it serves including organic
posts and bio links. A 30-day window is applied to the timestamped ids so a single May click cannot
relabel every organic order until August.

The storefront captures the volatile half on the landing page, because it is gone by checkout:
`ttclid` into `localStorage` under `tphi:ttclid` with a 28-day check
(`MarketingPixels.astro:484-488`), and UTM under a 30-day window (`:490-506`).

**The capture is then split two ways at checkout:**

```ts
// apps/admin/lib/tracking-events.ts:45-67
clientContextFromRequest(req, ip, cookies: { fbp, fbc, ga, gcl, ttp, ttclid })
  → { userAgent, ip, fbp, fbc, gaClientId, ttp, ttclid, sourceUrl }   // ← no `gcl`
```

`gcl` is accepted, used by `adChannel` for `orders.channel`
(`api/public/order/route.ts:914`) — and **dropped** from `ClientContext`. Nothing downstream can ever
see a `gclid`. Combined with the absence of any `adsSendTo` reference in `lib/capi.ts`,
`lib/tracking-events.ts` or `cron/tracking-events/route.ts` (verified by search: no matches), this is
the mechanical proof of TS-04 and TS-10: **there is no server-side path to Google Ads at all.**

`clientContextFromRequest` is also the place where a hostile client is bounded: every value is
`slice(0, 256)` (`sourceUrl` 512), and `ip` is nulled when `clientIp()` returned the literal
`"unknown"`, because Meta validates `client_ip_address` and a placeholder would risk a permanent 400
on every conversion.

### 2.8 Notification dispatch — the structural gap

The assignment names a "WA notification queue". **It does not exist.** The evidence is an absence,
so it is stated precisely:

- `wa_messages` is declared at `packages/db/src/schema.ts:1183-1191` (`store_id`, `followup_id`,
  `lead_id`, `phone`, `body`, `sent_at`). A repository-wide search for `waMessages` returns **exactly
  one hit: that declaration.** No reader, no writer, not even the seed.
- `notification_templates` (`schema.ts:1789+`) is likewise declared and unreferenced by application
  code.
- `wa_templates` **is** used, but only as merchant-authored text managed through CRUD actions
  (`lib/actions/crm.ts:60-95`). Nothing sends them.
- The only "dispatch" in the product is a **deep link**. `recordCartContact`
  (`lib/actions/checkout.ts:18-52`) writes a `followups` row after the merchant opens WhatsApp, and
  the code is explicit that this is not a delivery:

```ts
status: "menunggu", // NOT "terkirim" - we cannot observe delivery.
sentAt: now,        // = kontak dibuka
```

That honesty is correct and should be preserved. What follows from it, however, is that **no
lifecycle notification reaches the buyer at all** — not "resi terbit", not "paket dikirim", not
"paket sampai", despite the poller knowing all three moments. The shipping pipeline's entire output
is merchant-facing screen state.

---

## 3. Edge Case, Regression & Vulnerability Assessment

### TS-01 — No courier webhook (High)

**Evidence.** `cron/tracking/route.ts:5-20` carries an in-file warning that the comment once claimed
a webhook path existed and none does. `specs/docs/KIRIMINAJA.md:121-152` documents the vendor side:
registration is `POST {"url": "…"}` to a **path not stated in the vendor docs** (the actual blocker),
one callback URL per account, and events including `processed_packages` (fires exactly when the AWB
is created) and `finished_packages`.

**Impact.** Waybill latency is up to 15 minutes plus queue position. `sorting_code` — required for
SPX labels — is only delivered on `processed_packages` (`KIRIMINAJA.md:111-112`), so it is currently
unobtainable without a support request.

**The security constraint that must survive any fix.** The vendor documents **no signature, no HMAC
and no IP allowlist**, while `finished_packages` is the event that would collect COD cash and credit
the ledger. Any webhook adopted here must therefore be treated as an **untrusted hint that triggers a
verification pull**, never as an authority — which is exactly what the route's own header already
prescribes, and what `KIRIMINAJA.md:148-152` records the vendor itself prescribing ("use the Tracking
API to pull shipment status directly"). **A webhook is added beside the poller, never instead of it.**

### TS-02 — Global batch, no tenant fairness, and slot-holding orders (High)

**Evidence.** `cron/tracking/route.ts:31,96-106`. One `SELECT`, `LIMIT 100`, ordered by
`awb is not null, placed_at ASC`, with no partition by `store_id`.

**Failure modes, compounding:**

1. **Tenant starvation.** A single store with 100+ in-flight shipments occupies the entire tick.
   Every other merchant on the platform stops receiving waybills. There is no per-store cap.
2. **Slot-holding by design.** Codes `210`, `211` and `350` map to `null` deliberately
   (`ka-status-codes.test.ts:68-73`) — an SOP violation, its resolution, and a *requested* pickup
   cancellation. An order sitting on one of those keeps `diproses`/`dikirim` forever, is oldest, and
   therefore sorts to the **front** of the batch on every tick, permanently. TS-18.
3. **The ordering partially inverts under load.** Because AWB-less rows sort first and then oldest
   first, a large cohort of stuck old parcels can crowd out the newly-booked ones the merchant is
   actually watching.

**Capacity arithmetic.** 100 orders / 900 s = 400 polls/hour platform-wide. A platform with 500
concurrent in-flight shipments cannot poll each one even once per hour, and the shortfall is
distributed by age, not by need.

### TS-03 — Cron secret in the URL query string (High)

**Evidence.**

```yaml
# docker-compose.coolify.yml:318
command: ["sh","-c","… wget -qO- \"http://admin:3000/api/cron/tracking?secret=$$CRON_SECRET&every=$$CRON_INTERVAL_SEC\" …"]
# :344 — identical shape for cron/tracking-events; :280 billing; :361 domains
```

The route accepts either transport (`cron/tracking/route.ts:67`): header `x-cron-secret` **or**
`searchParams.get("secret")`.

**Impact.** Query strings are the single most commonly-logged part of a request. They land in
reverse-proxy access logs, framework request logs, error-tracking breadcrumbs and any future
`console` of the request URL — none of which are treated as secret stores. The traffic is
container-internal today, which lowers exposure but does not remove it: the value is
`CRON_SECRET`, the same credential that authorises a state-mutating sweep across **every tenant**.

**Note.** `?every=` must stay — it is read by `cronIntervalSec()` and is what keeps the liveness
threshold from drifting from the sidecar's real `sleep`. Only `secret=` moves to a header.

### TS-04 — Prepaid orders produce no Google Ads conversion (High)

**The chain, each link evidenced:**

1. The Google Ads conversion exists **only** in the browser:
   `window.gtag("event","conversion",{ send_to: GOOGLE.adsSendTo, … })`
   (`MarketingPixels.astro:455-470`).
2. The browser Purchase is gated on `order.tracking.browserPurchase === true`
   (`MarketingPixels.astro:584-586`).
3. `browserPurchase` is `isCod` (`api/public/order/route.ts:1141-1145`).
4. The server-side Google sender is **GA4 Measurement Protocol only**
   (`cron/tracking-events/route.ts:360-372` → `sendGa4Purchase`), and `adsSendTo` appears **nowhere**
   in `lib/capi.ts`, `lib/tracking-events.ts` or the cron route (verified by search).

**Therefore:** for every prepaid (VA / QRIS / e-wallet) order, Google Ads receives **no conversion by
any path**. Meta and TikTok are unaffected — their server senders carry the sale. GA4 receives the
Measurement Protocol purchase, so a merchant who has linked GA4 to Google Ads *and* imported the GA4
conversion will see it there; a merchant who followed the product's own UI (which asks for
`AW-…/label` and nothing else) will not.

**Severity rationale.** This silently under-reports paid revenue on the one channel whose bidding is
most sensitive to conversion volume, and the merchant's health panel shows green throughout — the
GA4 row succeeds.

### TS-05 — No notification dispatch; two dead tables (High)

See §2.8 for the evidence. Two distinct problems live here:

- **Product gap.** The system knows the exact instant a waybill is issued and the exact instant a
  parcel is delivered, and tells the buyer neither. In this market that is the single most-requested
  post-purchase message.
- **Schema drift / latent privacy surface.** `wa_messages` has columns for `phone` and `body` —
  personal data — with no writer, no reader, and therefore no retention policy and no place in any
  privacy document. `apps/landing/src/pages/privasi.astro:15-18` enumerates what the product
  collects and correctly does not mention it, which is only true because the table is empty.

### TS-06 — No timeout on the courier call (Medium-High)

**Evidence.** `packages/lib/src/kiriminaja.ts:25-31` (no `signal`) against `lib/capi.ts:23,119-135`
(`TIMEOUT_MS = 10_000`).

**Failure mode.** Node's `fetch` has no default timeout. One connection that opens and never answers
holds the sweep indefinitely. Because the shipping poller has no claim/lease (TS-17), the next
sidecar tick starts anyway and re-polls the same rows. The state machine is forward-only so nothing
is corrupted — but `recordCronRun` is never reached by the stalled tick, so after 30 minutes the
operator panel goes red for a job that is technically still "running", and vendor API load doubles
for as long as it lasts.

### TS-07 — The manual "Lacak" button does not advance state (Medium-High)

**Evidence.** `apps/admin/lib/actions/shipping.ts:1216-1270`. `trackShipment` calls `kaTrack`, and
then:

```ts
const realAwb = [data.awb, data.waybill].find((x) => !!x && x !== ref) ?? null;
if (realAwb) await withTenant(storeId, (db) => db.update(schema.orders).set({ awb: realAwb }) …);
```

It returns `data.status` and the history to the screen and **never calls `outcomeFromTrackingCode` or
`syncOrderFromKa`.**

**Impact.** A merchant who clicks "Lacak" on a parcel the courier has already delivered sees
"delivered" in the modal while the order stays `dikirim` on every other screen — and, for COD, the
ledger stays uncredited — until the next cron tick happens to reach that order (which, under TS-02,
may be a long time). This is a direct contradiction of `lib/ka-tracking.ts`'s stated purpose: to be
"the ONE place that turns what the courier says into what the order is".

### TS-08 — The 7-day release window collides with Meta's event window (Medium)

**Evidence.** Release sweep: `o.placed_at > now() - interval '7 days'`
(`cron/tracking-events/route.ts:120-131`). Event time: `occurredAt = order.placedAt`
(`lib/tracking-events.ts:195-200`), converted to `event_time` at send
(`cron/tracking-events/route.ts:336`). The retention comment in the same file states the constraint
plainly: "Meta 7 days, GA4 72 h".

**Failure mode.** A held prepaid conversion released on day 6.9 is sent with an `event_time` 6.9 days
old. Retries push it past 7 days, where Meta rejects it — permanently, consuming attempts and landing
in `dead_letter` with an error the merchant cannot act on. GA4's 72-hour ceiling is breached far
earlier: **any** release after 3 days is a GA4 event that will be accepted with a 204 and silently
discarded.

### TS-09 — Courier free text is logged (Medium)

**Evidence.** `cron/tracking/route.ts:158-175`:

```ts
logRaw({ order, ref, sentAs, ok: true, status, statusType, awb: short(data.awb), …
         text: short(data.text), statusText: short(data.status_text) });
```

The file's own PII rule is stated one screen above: "Tracking responses carry the recipient's name,
phone and full address; a log line is copied into tickets, chats and screenshots… key names are safe
precisely because they are not data." The discipline is otherwise exemplary — `keys` names fields
without printing them.

**The gap.** `text` / `status_text` **are** values, and Indonesian courier POD strings are routinely
of the form `Terkirim - diterima oleh <NAMA>` or `… (YBS)`. `short()` truncates at 120 characters,
which preserves a name at the front of the string. The justification given ("text messages are safe,
addresses are not") does not hold for proof-of-delivery text.

**Mitigating context.** This is a container log, not a user-visible surface, and the field genuinely
is the evidence that would settle the open vendor question "is 200 delivered or picked up?"
(`KIRIMINAJA.md:201-206`). The fix is scoping, not deletion — see §5.

### TS-10 — `gclid` captured, then dropped (Medium)

See §2.7. The storefront reads `_gcl_aw`, `_gcl_gb` and `_gcl_gs`
(`checkout.astro:2623-2628`, `OrderFunnel.astro:499-505`) with correct reasoning about iOS fallbacks,
and `ClientContext` then discards it. The value is real and correctly obtained; the pipeline simply
has no consumer. It is the missing input for the offline-conversion path that TS-04 needs.

### TS-11 — GA4 `transaction_id` fallback (Medium)

See §2.6. Low probability, silent, and double-counts revenue when it fires.

### TS-12 — Duplicated storefront capture logic (Medium)

`ttclid()` with its 28-day check and the `trackingCookies` object literal exist twice, verbatim:
`checkout.astro:2579-2630` and `OrderFunnel.astro:258-505`. The `/thanks` funnel omission in
`MarketingPixels.astro` — recorded in-file as "the one flow a merchant PAYS for recorded no browser
Purchase at all" — is precisely the class of bug two copies produce.

### TS-13 — Unindexed retention scan (Medium)

```sql
-- cron/tracking-events/route.ts:183-190, every 60 s
DELETE FROM tracking_event_deliveries WHERE ctid IN (
  SELECT ctid FROM tracking_event_deliveries WHERE created_at < now() - interval '30 days' LIMIT 500)
```

The only indexes are `(status, next_attempt_at)` and `(store_id, created_at)`
(`schema.ts:1490-1498`). Neither serves a bare `created_at` predicate, so this is a sequential scan
every minute forever. The `LIMIT 500` bounds the *delete*, not the *scan*. On a healthy table this is
cheap; it grows linearly with retained rows and runs 1,440 times a day.

### TS-14 — Retention depends on a cron nobody watches as a privacy control (Low-Medium)

The 30-day purge is the **only** enforcement of the delivery table's retention policy, and it lives
inside the same tick that does the sending. It is correctly wrapped so a purge failure costs nothing
(`:191-197`) — but the corollary is that a purge that fails every tick for a month is invisible: the
run summary reports `{claimed, sent, failed, dead, released, backfilled}` and **no purge counter**.
Retention would silently extend while the panel stays green.

### TS-15 / TS-16 / TS-17 — Lower-severity items

- **TS-15.** `not_configured` retries hourly and counts toward `MAX_ATTEMPTS = 6`
  (`cron/tracking-events/route.ts:290-305`), i.e. a ~6-hour grace window across an
  `INTEGRATION_TOKEN_KEY` rotation. Beyond that, live conversions dead-letter. Remediation exists and
  is merchant-operable (`lib/actions/tracking.ts` → `retryTrackingDeliveries`), so this is a
  documentation and alerting issue rather than a data-loss one.
- **TS-16.** `getTrackingHealth` windows on `created_at >= now() - 7 days`
  (`lib/data/tracking.ts:146-160`) while rows live 30 days. Its handling of held rows is *correct and
  subtle* — held prepaid rows are excluded from `queued` and surfaced separately as
  `holdingForPayment`, with the `dead_letter` exclusion explicitly scoped so a bare future-date filter
  cannot hide failures. The residual gap is only the 7-vs-30-day mismatch.
- **TS-17.** The shipping poller has no `SKIP LOCKED` claim, unlike the conversion drain. Overlapping
  ticks are safe (forward-only state machine, `ON CONFLICT`-free path) but wasteful.

### 3.1 Cross-tenant safety — reviewed, and sound

Both crons run on the **owner** connection where RLS does not apply, which is unavoidable for a
scheduled sweep. The compensating discipline is explicit and consistent:

- Every `store_tracking_channels` read carries `eq(storeId, …)` (`cron/tracking-events:270-276`).
- Every identity read carries both the row id **and** `eq(storeId, …)` (`:307-330`).
- `purchaseFacts` proves order ownership with a store-scoped query, then reads the child table by
  `orderId` only — and says so, so the proof is not "simplified" away later
  (`lib/tracking-events.ts:108-125`).
- The variant→catalog-id join is store-scoped, so a stray variant id yields *no* id rather than
  leaking another tenant's product handle into this store's conversion (`:150-158`).
- The raw release sweep joins on `d.store_id = o.store_id` (`cron/tracking-events:122-131`).

Merchant-facing reads use the tenant connection: `getTrackingHealth` runs under
`withCurrentTenant` (`lib/data/tracking.ts:146`), and `trackShipment` under `withTenant`
(`lib/actions/shipping.ts:1217`). Secrets are scoped per store and channel via
`secretScope(storeId, channel)` (`cron/tracking-events:280`), so one store's ciphertext cannot be
decrypted in another store's context. **No cross-tenant defect was found in this batch.**

---

## 4. Test Suite Coverage & Regression Matrix

### 4.1 What is covered today

Six test files bear directly on this batch. All six are **pure** — no database, no network — which is
why they can pin behaviour that the crons themselves cannot afford to assert at runtime.

| Test file | Unit under test | What it actually pins |
|---|---|---|
| `apps/admin/lib/ka-status-codes.test.ts` | `outcomeFromTrackingCode` | The full transcribed KiriminAja status table, code by code, with the outcome intended for each. Also: every FINAL-state code (`200,300,333,400,500,555,703,704`) maps to something the merchant can see — *"what must NEVER happen is a final state returning null"*; free text can never produce a money-moving outcome (`delivered/returned/canceled/problem`) from strings like `"selesai"`, `"batal"`, `"hilang"`; unknown codes (`0, 99, 999, 1234`) and junk (`null, undefined, "", " "`) return `null`; the string and number spellings of the same code agree, because the poller's `data.status` arrives as either. It also documents `210/211/350` as *deliberately* unmapped |
| `apps/super-admin/app/(platform)/analitik/cron-liveness.test.ts` | `staleAfterMs`, `cronVerdict`, `summarize` | The alarm that says the resi poller is dead. Overdue is **two of the sidecar's own intervals** (900 s ⇒ 30 min), never a constant typed in the panel; a never-reported job is NEUTRAL, not green; a run with no reported interval is NEUTRAL, because *"a threshold we cannot derive is not one we may invent"*; **`ok:false` is red even when the timing is perfect** — the exact shape `cron/tracking` returns when KiriminAja is unconfigured; silence outranks a failed run; counters render **zeroes included** (`dipindai 40 · resi terisi 0`); and every sidecar in `docker-compose.coolify.yml` has a row on the card |
| `apps/admin/lib/capi-sanitize.test.ts` | `sanitize`, `classify` | A Meta `access_token`, a GA4 `api_secret` and a TikTok `Access-Token` header echo are all redacted out of an error body; the diagnostic text survives redaction; the message is bounded to 400 chars; a non-string body does not throw into the cron. For `classify`: any 2xx including GA4's 204-for-everything is success; `429`/`503` retryable; TikTok's real `40104` ("access_token is empty") and `401` are permanent — *"they will be just as wrong next time"*; and the error message carries the **sanitized** body |
| `packages/lib/src/tracking-ids.test.ts` | `purchaseEventId`, `retailerId`, `itemGroupId` | `purchaseEventId("PHI-123456789ABC") === "purchase:PHI-123456789ABC"` — *"the browser and the server derive the identical string"*; it carries no tenant UUID; two orders differ. Plus the ADR 0013 id-stability suite that keeps `content_ids` and `<g:id>` identical across handle renames and variant deletions |
| `apps/admin/lib/ad-channel.test.ts` | `adChannel` | `fbclid` is not proof of an ad (a bare `_fbc` books `other`, never `meta_ads`); an organic UTM cannot promote it; `gclid`/`gbraid`/`gs`/`ttclid` stand alone; the 30-day window (29 d in, 31 d out) for both `_gcl_aw` and `_fbc`; precedence (paid tagging beats every cookie; an unmodelled paid network is `other`, never `organic`); `_fbp`/`_ttp` are ignored because they are set on any visit |
| `packages/lib/src/kiriminaja.test.ts` | `kaCodFee` **only** | COD-fee parsing from the vendor's `setting` block: fraction→percent without float drift, numeric strings, all-null when absent, *"never turns an empty or junk value into Rp0"*, and a genuine zero survives |

Adjacent shipping guards exist but were not opened in this audit and belong to Batch 3:
`apps/admin/lib/cancel-shipment.test.ts`, `shipment-payment.test.ts`, `shipping-dimensions.test.ts`.

**The shape of the coverage is worth naming, because it is a deliberate and correct choice:** every
test above targets a *pure decision function* that was extracted from an impure pipeline precisely so
it could be tested — `outcomeFromTrackingCode` out of the poller, `sanitize`/`classify` out of the
senders, `cronVerdict` out of the panel, `adChannel` out of the order API. The extraction is the
testability strategy, and it works.

### 4.2 The regression matrix — uncovered behaviour, ranked by blast radius

Each row names a behaviour the system depends on, the file that implements it, what breaks silently
if a future edit removes it, and the smallest guard that would catch that edit. **Rows marked `pure`
need no database.**

| # | Behaviour | Implementation | Silent failure if broken | Guard |
|---|---|---|---|---|
| R-01 | **Monotonic order state.** `RANK[target] > RANK[cur]` is the only thing stopping a replayed poll from re-booking stock or re-opening a settled ledger entry | `lib/ka-tracking.ts` | Duplicate stock movements; COD credited twice | `pure` — export the rank comparison and assert `selesai` never accepts `dikirim`, and that `retur`/`batal` are terminal |
| R-02 | **AWB echo rejection.** `[data.awb, data.waybill].find(x => x && x !== ref)` — the vendor echoes the booking reference into the AWB field | `cron/tracking/route.ts:140`, `lib/actions/shipping.ts:1256` | `orders.awb` filled with our own `ka_order_id`; every label printed with a non-waybill | `pure` — lift to a shared helper (it is duplicated) and assert echo, real AWB, both-null |
| R-03 | **Sweep fairness ordering.** AWB-less first, then oldest | `cron/tracking/route.ts:101-106` | Silent starvation past 100 in-flight orders — the exact regression the file documents | DB test, or assert the generated SQL contains the ORDER BY |
| R-04 | **Single-statement claim.** `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING` | `cron/tracking-events/route.ts:200-242` | Two overlapping ticks send the same Purchase — double-counted revenue in the merchant's ad reporting | DB test: two concurrent claims must return disjoint id sets |
| R-05 | **`attempt_count` incremented by the claim, not by the verdict** | same | A tick killed mid-send resets the budget; a poison row retries forever | DB test |
| R-06 | **Dead-letter parking.** `nextAttemptAt = now + 365 d` on `dead_letter` | `cron/tracking-events/route.ts:414-445` | A status-filter-only regression re-picks dead rows every tick | `pure` — extract the verdict→row-patch mapping |
| R-07 | **Backoff shape.** `attempt² × 60 s`, capped 6 h, ≤30 s jitter | `:35-38` | A linear or uncapped backoff hammers a down provider | `pure` — monotonic, capped, jitter-bounded |
| R-08 | **Idempotency.** `unique(store_id, channel, event_id)` + `onConflictDoNothing` | `schema.ts:1490`, `lib/tracking-events.ts` | Double checkout submit or retried callback ⇒ two conversions | DB test: insert twice, expect one row |
| R-09 | **Prepaid hold + release.** `HOLD_UNTIL = 2126`; release moves only rows still `queued` **and** still parked | `lib/tracking-events.ts:308-338` | Either an unpaid VA reports as revenue, or a paid order never reports | DB test |
| R-10 | **`capiEnabled = false` stops delivery.** A merchant who switched CAPI off must stop receiving sends (§17.3) | `cron/tracking-events/route.ts:270-284` | Conversions keep flowing after the merchant revoked consent — a **privacy** failure, not a bug | `pure` — extract `config()`'s null decision |
| R-11 | **`no_identity` refusal** — never send a Purchase with an empty `user_data` | `lib/capi.ts:141-200` | Meta 400s every conversion into `dead_letter`; or worse, a fabricated match key | `pure` |
| R-12 | **Provider hashing divergence.** Google's gmail dot rule; Meta bare digits vs TikTok/GA4 E.164 `+` | `lib/capi.ts:82-117` | ~200 OK with **zero** matches — the single most expensive silent failure in this batch | `pure` — the highest-value missing test here |
| R-13 | **Browser Purchase gate.** `browserPurchase === true` required; `tphi:px:purchased` de-dupe | `MarketingPixels.astro:584-596` | Unpaid VA screens reported as revenue; or a refresh double-firing | `pure` — extract the gate; the storefront already tests Astro inline scripts (`apps/storefront/src/lib/astro-frontmatter-script.test.ts`) |
| R-14 | **`goods` parity.** Browser `max(0, subtotal − discount)` must equal server `facts.goods` | `MarketingPixels.astro:614` vs `lib/tracking-events.ts` | One `transaction_id`, two values — the voucher regression the file records | `pure` — one shared fixture asserted on both sides |
| R-15 | **`ClientContext` bounds.** 256-char values, 512 for `sourceUrl`, `ip !== "unknown"` | `lib/tracking-events.ts:45-67` | Row inflation from a hostile client; or a permanent Meta 400 from a placeholder IP | `pure` |
| R-16 | **`ga4ClientId` extraction** from `GA1.1.<id>.<ts>` | `cron/tracking-events/route.ts:60-70` | GA4 mints a new user per order; traffic source lands on `(not set)` | `pure` |
| R-17 | **`tiktokVerdict` precedence** — body code wins, but `429`/`5xx` stay retryable | `lib/capi.ts:480-508` | Throttling becomes a dead-letter; the loss the file says it already suffered once | `pure` |
| R-18 | **Retention purge** deletes only rows older than 30 days | `cron/tracking-events/route.ts:183-190` | Either PII kept forever, or live conversions deleted | DB test |
| R-19 | **KA transport error shaping.** HTML 502 ⇒ `KaTransportError` with path/status/snippet, not `Unexpected token <` | `packages/lib/src/kiriminaja.ts:25-48` | Unattributable errors during an outage — and `kiriminaja.test.ts` currently tests **only** `kaCodFee` | `pure` — stub `fetch` |
| R-20 | **Cross-tenant scoping in owner-connection queries** — every read in both crons carries `store_id` | `cron/tracking-events/route.ts:270-330` | A tenant boundary crossed in a job that runs where RLS does not apply | Static guard in the spirit of `rbac-census.test.ts`: assert no `from(storeTrackingChannels)` without a `storeId` predicate |

### 4.3 Regression watch list — defects this code has already suffered

These are recorded **in the source itself** as fixed regressions. They are listed here because each one
is a mutation a future refactor can silently reintroduce, and only R-03, R-05 and R-17 above would
catch any of them today:

1. Sweep with a bare `.limit(100)` and **no `ORDER BY`** ⇒ permanent starvation past 100 in-flight orders.
2. `ka()` doing a bare `res.json()` with no status check ⇒ one HTML error page killed the whole tick.
3. `attempt_count` written only on the way out ⇒ poison rows retried forever.
4. Server events gated on the merchant's `advancedMatching` toggle ⇒ default-OFF configuration 400'd every Purchase.
5. Google Ads conversion gated on `adsSendTo` alone ⇒ silently broke merchants with a legacy `AW-` in the pixel field.
6. `/thanks` omitted from the conversion pages ⇒ the one flow a merchant **pays for** recorded no browser Purchase.
7. Voucher discount applied on one side only ⇒ browser and server reported different values for one `transaction_id`.
8. `storefrontUrl()` awaited for **every** row ⇒ one extra query per delivery for a value almost none use.
9. `wget -qO- … >/dev/null 2>&1` ⇒ threw away the only numbers the endpoint produces.
10. `classify()` bypassed when a TikTok body code was present ⇒ lost `429` handling.
11. `awbFilled` at 0 for a week while "the cron ran" stayed true ⇒ the reason `recordCronRun` stores counters, not a timestamp.
12. `210`/`211`/`350` (and, earlier, `333`/`555`) unmapped ⇒ orders re-queued every 15 minutes forever at the head of the batch.

---

## 5. Actionable Engineering Perfection Directives

Ordered by priority. **P0** = correctness, money or privacy; **P1** = capacity, coverage, disclosure;
**P2** = hygiene. Each directive names the file it lands in.

### 5.1 P0 — Security

**S-1 — Move `CRON_SECRET` out of the URL (TS-03).**
Change all four sidecar commands in `docker-compose.coolify.yml` (`:280,318,344,361`) from
`?secret=$$CRON_SECRET` to `wget --header="x-cron-secret: $$CRON_SECRET"`. Keep `?every=` —
`cronIntervalSec()` needs it and it is not a secret. Then **remove** the
`searchParams.get("secret")` fallback from all four routes so the query transport cannot come back.
Because `cron-liveness.test.ts` already asserts "every sidecar in `docker-compose.coolify.yml` has a
row on the card", extend that same file-reading guard to assert **no sidecar command contains
`secret=`**. That converts a review comment into a permanent gate.

**S-2 — Stop logging courier free text verbatim (TS-09).**
In `cron/tracking/route.ts:158-175`, replace `text: short(data.text)` and
`statusText: short(data.status_text)` with a redacted projection: keep length and a
character-class fingerprint by default, and emit the raw string **only** when an explicit
`KA_TRACE_RAW=1` env flag is set for a bounded debugging window. The stated need — settling
"200 = delivered or picked up?" — is a one-off investigation, not a standing log requirement.
Apply the identical change to the `TrackResult.history[].desc` path in
`lib/actions/shipping.ts:1261-1265` if that text is ever logged.

**S-3 — Decide `wa_messages` and `notification_templates` (TS-05, privacy half).**
Either implement the dispatcher (see B-4) or **drop both tables**. A `phone`/`body` column pair with
no writer, no retention policy and no mention in `apps/landing/src/pages/privasi.astro` is a privacy
surface waiting for its first `INSERT`. Whichever is chosen, record it in `specs/docs/SCHEMA.md` in
the same commit.

### 5.2 P0 — Backend correctness

**B-1 — Give the courier call a timeout (TS-06).**
Add the `AbortController` + `TIMEOUT_MS` pattern already proven in `lib/capi.ts:119-135` to
`packages/lib/src/kiriminaja.ts:25-48`. Suggested ceiling: 10 s per call, matching the sender. With
100 sequential calls per tick, the worst case becomes bounded (≈17 min) instead of unbounded, and
`recordCronRun` is always reached.

**B-2 — Make the manual "Lacak" advance state (TS-07).**
`lib/actions/shipping.ts:1216-1274` already has `data.status` in hand. Call
`outcomeFromTrackingCode(data.status)` and, when non-null, `syncOrderFromKa(orderNumber, outcome,
realAwb, problemNote)` — the same three lines the cron runs. `syncOrderFromKa` is forward-only and
idempotent, so this is safe by construction and needs no new invariant. This directive also **deletes
duplicated logic**: the AWB-echo rejection (R-02) becomes one call instead of two copies.

**B-3 — Close the Google Ads prepaid gap (TS-04 + TS-10).**
Two options; pick one and write it into ADR 0012:
- *(a) Offline Conversion Import.* Persist `gclid`/`gbraid`/`wbraid` — the value is **already
  captured** at `api/public/order/route.ts:914` and merely dropped by `clientContextFromRequest`
  (`lib/tracking-events.ts:45-67`). Add `gclid` to `ClientContext` and to the delivery row's `client`
  block, then add a fourth sender that uploads the conversion via the Google Ads API. This is the
  only path that reports a prepaid sale to Ads with correct attribution.
- *(b) Documented GA4 import.* Keep the current architecture and state explicitly, in the merchant UI
  beside the `AW-…/label` field, that prepaid conversions reach Google **only** through a GA4→Ads
  conversion import, with the linking steps. Cheaper, and honest.

What is **not** acceptable is the status quo, where the UI asks for an Ads conversion destination and
silently reports only COD sales to it.

**B-4 — Ship or delete notification dispatch (TS-05, product half).**
The poller already knows the two moments worth sending: `awbFilled` and the `dikirim`→`selesai`
transition in `syncOrderFromKa`. If dispatch is adopted, model it on the outbox that already works in
this repo — `tracking_event_deliveries` — rather than inventing a second pattern: a row per message,
`unique(store_id, order_id, kind)` for idempotency, `status/attempt_count/next_attempt_at` with the
same backoff, claimed by a `SKIP LOCKED` statement, drained by a sidecar, and purged on the same
30-day clock. Reuse `notification_templates` for the body. **Do not** claim delivery the product
cannot observe — preserve the honesty rule already stated in `lib/actions/checkout.ts:44-48`.

**B-5 — Fix the event-window boundary (TS-08).**
In `cron/tracking-events/route.ts:120-131`, narrow the release sweep from 7 days to **72 hours** so a
released conversion is inside GA4's window as well as Meta's, and mark anything older than the
provider window as `dead_letter` with an explicit `expired_event_window` code at claim time rather
than spending six attempts discovering it. Surface that code distinctly in the health panel — it is
the one dead-letter reason a merchant genuinely cannot fix by retrying.

### 5.3 P1 — Capacity & scheduling

**C-1 — Partition the shipping sweep by store (TS-02).**
Replace the flat `LIMIT 100` in `cron/tracking/route.ts:101-106` with a windowed selection —
`ROW_NUMBER() OVER (PARTITION BY store_id ORDER BY awb IS NOT NULL, placed_at)` with a per-store cap
— so no single merchant can consume the platform's entire poll budget. Keep the existing global cap
as the outer bound.

**C-2 — Back off unresolvable parcels (TS-02 / TS-18).**
Orders whose last `n` polls produced `outcome === null` (the deliberate `210/211/350` set) should be
polled on a decaying schedule, not every tick. The minimal version needs no schema change: exclude
from the sweep any order with `problem_at` older than N hours on alternating ticks. The complete
version adds `orders.last_polled_at` and orders by it.

**C-3 — Add a claim to the shipping poller (TS-17).**
Apply the `SKIP LOCKED` pattern the conversion drain already proves. Optional if B-1 lands, since a
bounded tick largely removes the overlap window — but it is the cheaper guarantee.

### 5.4 P1 — Database

**D-1 — Index the retention scan (TS-13).**
Add `index("tracking_event_deliveries_created_idx").on(t.createdAt)` in
`packages/db/src/schema.ts:1490-1498`, or — cheaper — change the purge predicate to lead with
`store_id` only if a per-store purge is acceptable. The current bare `created_at` filter cannot use
either existing index and runs 1,440 times a day.

**D-2 — Report the purge (TS-14).**
Have the purge return its row count and include `purged` in the run summary written by
`recordCronRun` at `cron/tracking-events/route.ts:403-406`. `summarize()` in `cron-liveness.ts`
already renders whatever counters a run reports, and its test already asserts that zeroes are shown —
so a purge that has been failing for a month becomes visible on the operator panel for the cost of
one field.

**D-3 — Align the health window with retention (TS-16).**
Either widen `getTrackingHealth`'s 7-day window (`lib/data/tracking.ts:146-160`) to 30 days for
**dead-letters only**, or narrow retention to 7 days. The current mismatch keeps personal data for 30
days while showing the merchant nothing about it after 7.

### 5.5 P1 — Frontend

**F-1 — Extract the storefront tracking-capture module (TS-12).**
`ttclid()` with its 28-day check and the `trackingCookies` literal are duplicated verbatim in
`checkout.astro:2579-2630` and `OrderFunnel.astro:258-505`. Move both to a single module under
`apps/storefront/src/lib/` and import it in both places. The `/thanks` omission in
`MarketingPixels.astro` is the precedent for what two copies eventually cost.

**F-2 — Remove the `createdAt` fallback from the purchase key (TS-11).**
In `MarketingPixels.astro:590`, `String(order.number || order.createdAt || "")` should be
`String(order.number || "")`, with the whole block skipped when it is empty. A missing order number
means "do not report this sale", not "report it under a timestamp" — the same refusal-to-guess rule
the rest of this batch follows. Firing nothing is recoverable by the outbox; a mismatched
`transaction_id` double-counts revenue permanently.

**F-3 — Surface the dead-letter reason a merchant can act on.**
The health panel already separates `holdingForPayment` from `queued`. Extend it to name the top
`last_error_code` per channel, so `not_configured` (rotate the token) reads differently from
`no_identity` (nothing to fix) and `expired_event_window` (too late, ignore).

### 5.6 P1 — Test coverage

Add the `pure` guards from §4.2 in this order — highest value first, no database required for any of
them: **R-12** (provider hashing divergence), **R-01** (monotonic state), **R-11** (`no_identity`),
**R-14** (`goods` parity), **R-10** (`capiEnabled=false` stops delivery), **R-02** (AWB echo, after
B-2 merges the two copies), **R-07** (backoff shape), **R-16** (`ga4ClientId`), **R-19** (KA transport
error shaping). Then the DB-backed set: **R-04**, **R-05**, **R-08**, **R-09**, **R-18**.

R-12 deserves its place at the top: it is the only failure in this batch that returns `200 OK` from
every provider while matching **nothing**, and no counter anywhere in the product would move.

### 5.7 P2 — Performance & hygiene

- **P-1.** `cron/tracking` runs 100 sequential awaits. With B-1's timeout in place, a bounded
  concurrency of 4–6 would cut tick duration ~5×. Keep it bounded — the vendor is rate-sensitive and
  the current serialisation is also crude rate limiting.
- **P-2.** `cron/tracking-events` already caches channel config and storefront origin per tick and
  fetches the origin lazily. The remaining per-row cost is the identity read (`:307-330`); batching
  it by `store_id` across the claimed set would remove up to 50 round trips per tick.
- **P-3.** Extract the three-way "which pixel is enabled" resolution shared by
  `apps/storefront/src/data/tracking.ts` and `apps/admin/lib/data/tracking.ts` — the latter's own
  header notes the drift risk that the shared `retailerId()` helper exists to prevent.
- **P-4.** `MarketingPixels.astro` is 664 lines of inline script in one Astro file. The deferred-load
  measurement in it is genuinely valuable and must not be lost, but the funnel dispatch, the purchase
  gate and the advanced-matching block are three independently testable units (see R-13, R-14).

---

## Appendix A — Files audited

| Path | Role |
|---|---|
| `apps/admin/app/api/cron/tracking/route.ts` | Courier tracking poller (15 min) |
| `apps/admin/app/api/cron/tracking-events/route.ts` | Conversion delivery worker (60 s) |
| `apps/admin/app/api/cron/record-run.ts` | `cron_runs` liveness writer |
| `apps/admin/lib/ka-tracking.ts` | Courier status → order state (single translator) |
| `apps/admin/lib/capi.ts` | Meta CAPI / TikTok Events API / GA4 MP senders |
| `apps/admin/lib/capi-sanitize.ts` | Redaction + retry classification (pure) |
| `apps/admin/lib/tracking-events.ts` | `ClientContext`, `purchaseFacts`, enqueue / hold / release |
| `apps/admin/lib/ad-channel.ts` | Paid-vs-organic attribution for `orders.channel` |
| `apps/admin/lib/data/tracking.ts` | Merchant health panel data |
| `apps/admin/lib/actions/tracking.ts` | Channel config, connection test, retry |
| `apps/admin/lib/actions/shipping.ts` | Booking, cancel, manual `trackShipment` |
| `apps/admin/lib/actions/checkout.ts`, `lib/actions/crm.ts` | Follow-up + WA template surfaces |
| `apps/admin/app/api/public/order/route.ts` | Checkout entry: enqueue + browser tracking payload |
| `apps/storefront/src/components/MarketingPixels.astro` | Browser pixel layer |
| `apps/storefront/src/pages/checkout.astro`, `.../OrderFunnel.astro` | Click-id / UTM capture |
| `packages/lib/src/kiriminaja.ts`, `tracking-ids.ts` | Vendor transport; shared id helpers |
| `packages/db/src/schema.ts` | `store_tracking_channels`, `tracking_event_deliveries`, `wa_messages` |
| `docker-compose.coolify.yml` | Sidecar schedules and secrets |
| `specs/docs/KIRIMINAJA.md` | Vendor contract, webhook documentation |

## Appendix B — Verification status of this audit

Every finding above was derived by reading the cited files. No application code was modified, and no
formatter, linter, build or test command was executed, per the audit constraints. Claims about
**absence** — no webhook route, no `adsSendTo` on any server path, no `waMessages` reader or writer,
no timeout in `kiriminaja.ts` — were each established by repository-wide search rather than by
inference, and the searches are reproducible from the identifiers named in the relevant section.

Two items were **corrected during the audit** after re-verification against the repository, and are
recorded here so the method is auditable: `cron-liveness.test.ts` was confirmed to live under
`apps/super-admin/app/(platform)/analitik/` (not under `apps/admin/lib/`), and `trackShipment`'s
omission of `syncOrderFromKa` (TS-07) was confirmed by direct symbol search in
`apps/admin/lib/actions/shipping.ts` before the finding was written.
