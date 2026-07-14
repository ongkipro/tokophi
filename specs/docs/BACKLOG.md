# TokoΦ — Backlog & task board

> **Reconciled against the code and the database 2026-07-14.** Items that shipped are marked and
> collapsed; items that are still open are stated **honestly**, including the ones we would rather not
> look at. Legend: `[ ]` todo · `[~]` partial · `[x]` done.
>
> Companions: [`STATUS.md`](./STATUS.md) (real vs fake) · [`REQUIREMENTS.md`](./REQUIREMENTS.md)
> (verifiable statements) · [`PRD.md`](../PRD.md).

---

## 🔴 The five that matter most

Not the biggest, not the newest — the ones where the product is currently **lying, leaking, or
unmeasurable**. Ordered.

1. **[ ] `orders.courier` is NULL on 699/700 rows.** A regular checkout books no shipment, so the
   per-courier COD return-rate report — **the instrument the entire COD policy is betting on** — cannot
   produce a per-courier number. We optimised for a metric we cannot measure. Fix: book the shipment
   (or at minimum record the selected courier) at checkout.
2. **[ ] Verify the "SPX free return" claim with KiriminAja, in writing.** The whole SPX-only COD
   policy rests on it and **it is unverified**: free returns are a *Shopee Seller Center* benefit, we
   reach SPX through *KiriminAja* (a different contract), and the KiriminAja API has **no return field
   at all** (`KaRate` = service, service_name, service_type, cost, etd, cod, group). If returns are in
   fact billed through KiriminAja, the rationale collapses and we have restricted COD to one courier
   for nothing. **This is one email.**
3. **[ ] `invitePlatformAdmin` is a privilege-escalation path.** It is `admin`-gated, takes `role`
   **unvalidated** (`role: input.role || "admin"`), and is **not audit-logged**. An `admin` operator can
   mint themselves an `owner` and thereby reach the two `owner`-only actions (impersonate, reset owner
   password). **This quietly undoes the role check that landed in `0776e99`.** It also hashes a fixed
   password (`tokophi123`).
4. **[ ] `lib/actions/billing.ts` has no capability gate.** `createSubscriptionPayment` and
   `cancelSubscriptionInvoice` raise and void **real invoices**, gated on `getSession()` alone — so a
   `gudang` user can create or cancel the store's subscription bill. Every other mutating action file
   calls `requireCapability` as its first statement.
5. **[ ] Tests for the ledger, the COD gate, and the order state machine.** There is **one test file in
   the entire repo** (`packages/lib/src/integration-status.test.ts`); vitest is wired and unused.
   `select sum(…) for update` — which Postgres rejects outright, so **every withdrawal threw** — shipped
   because `tsc` cannot see inside a SQL string. Same family, one week later: a `ReferenceError:
   queueSave is not defined` inside a client `<script>` in `checkout.astro` blocked the **entire rate
   load** (no rates → no COD → **no order at all**) while `astro check`, lint and build were **all
   green** — only a browser caught it. **Money and checkout paths must be exercised, not typechecked.**

---

## P0 — Foundation

- [x] **Backend** — local PostgreSQL 16 + Drizzle (`@tokophi/db`): **68 tables, 46 migrations
  (`0000`–`0045`), RLS on 44**. All four surfaces read; all admin editors write; local auth (jose JWT) +
  RBAC + **RLS enforcing at runtime** under the non-owner `tokophi_app` role.
- [x] **Data-layer seam on every screen** — reads via `lib/data/*`, writes via `lib/actions/*`.
- [x] **Auth + real multi-tenancy** — the tenancy boundary is the database, not application code.
- [ ] **VPS: self-hosted Postgres + PostgREST + Storage (MinIO/S3).** Media is still local disk
  (`public/uploads/`). ADR 0007 / 0008.

---

## P1 — Money, shipping, COD

### Shipped

- [x] **The ledger** (migrations `0040` + `0041`). `0040` built the book and **nothing ever wrote a
  `sale` into it** — the withdraw path worked, the release and claw-back paths worked, on entries that
  were never created; every merchant's balance read Rp0 no matter how much came in. `0041` credits it.
  Balance derived, book append-only, three partial unique indexes make double-credit a DB impossibility.
- [x] **Payouts + super-admin `/pencairan`** — request (owner-only, advisory-locked, bank snapshot),
  process, mark paid (**no ledger write** — already debited), reject (**opposing `adjustment`** computed
  from the ledger, not from `payouts.amount_idr`).
- [x] **The release rule is actually read** (`0776e99`) — `platform_payout.release_on`, default
  `selesai`. It was hardcoded while the super-admin toggle changed nothing. A knob that moves nothing is
  worse than no knob.
- [x] **`retur` order status** (`0039`) — restores inventory (exactly like `batal`; missing it would have
  quietly shrunk real stock on every refused COD parcel), fails the pending payment, claws the credit
  back with an opposing entry carrying the sale's status.
- [x] **COD enforced end-to-end** (`0038`) — five conditions, server-side in `/api/public/order`
  **before any row is written**. `max_amount_idr` and `allowed_provinces` were stored and read
  **nowhere**; they bounded nothing. Now they bound.
- [x] **COD is switched ON** (`35b88a4`) — the feature was built and never turned on. All three switches
  now agree: `platform_cod.enabled` (cap **Rp2.000.000**, **6** allow-listed provinces) ∧
  `platform_couriers.services[].codAllowed` = **SPX only** (SPX Standard `type=1` + SPX Economy
  `type=3`; every other courier is `codAllowed=false` *even where KiriminAja reports `cod=true`*) ∧
  `store_settings.cod_enabled = true` for batik-nusantara (default **false** — the merchant opts in, via
  Pengaturan → Pengiriman → "Bayar di Tempat (COD)"). **Verified in a real browser**, 0 console errors:
  the COD badge appears on the two SPX rates only, and "COD (Bayar di Tempat)" appears in Pembayaran
  only while an SPX service is selected.
- [x] **The checkout offers exactly the services the seller picked** (`35b88a4`) — `/api/public/ongkir`
  filtered on `store_settings.couriers` (the COURIER list) while the Jasa Kirim card promises *"Pilih
  layanan yang ditawarkan ke pembeli saat checkout"* and writes to **`store_shipping_methods`** (per
  service), so **every service the seller switched OFF was still offered**: **14 rates, 4 never
  enabled** (Jagopack, Sicepat CARGO, BIGPACK, SAP One Day) → **10** after the fix. Now
  **(platform-enabled couriers) ∩ (per-service picks)**, keyed `"<courier>:<service_type>"`; no rows =
  fall back to courier-level rather than a checkout with zero shipping options.
- [x] **The COD province is verified, not typed** (`f846cba`) — resolved from the KiriminAja district id
  the ongkir quote was issued for. Fail-closed if unresolvable.
- [x] **Live KiriminAja courier roster** — the hand-written roster had drifted badly (it listed TIKI and
  Pos Indonesia, which the API returns *neither* of, and gave SPX service names that do not exist).
- [x] **Shipment booking** (`request_pickup` → AWB) — and **`orders.awb` no longer stores our own order
  id** (`0b3cdda`), which had been printing an unscannable barcode on real parcels under "No. resi".
- [x] **Order address snapshot** (`0042`) — an order carries the address it was *shipped to*.
- [x] **Pesanan rebuilt as a seller centre** (`4b4775c`) — Shopee-style tabs, server-side
  search/filter/paging. The five status tabs are a **strict partition** (`0+24+23+595+43 = 685`).
- [x] **Money endpoints fail CLOSED** — pay callback and the billing cron both 401 in production when
  their secret is unset.

### Open

- [ ] **🔴 `orders.courier` NULL on 699/700** — see the top-five list.
- [ ] **🔴 Verify the SPX free-return claim** — see the top-five list.
- [ ] **COD fee (`platform_cod.fee_pct`)** — currently `0` and **read by nothing** (2 grep hits: the
  schema and the seed). This is the lever that would let COD open on **all** couriers instead of one: a
  2–3% fee charged to the buyer (normal and accepted in Indonesia; every marketplace does it) funds a
  return pool so the merchant does not eat the return leg alone. **Strictly better than
  courier-restriction if the SPX claim turns out to be false.**
- [ ] **No super-admin UI for `max_amount_idr` / `allowed_provinces` / `fee_pct`.** They are *enforced*
  (from the seed) but not editable from the panel — while the `/pengaturan` copy says "limit & area
  diatur di sini". Either build the form or fix the copy.
- [x] **The seed writes legacy string services** into `platform_couriers.services` — **fixed.** It now
  writes objects (`{type,name,group,cod,codAllowed}`), `codAllowed = cod && courier === "spx"`, so a
  fresh DB has 2 COD-allowed services and COD is exercisable without pressing "Sync dari KiriminAja".
  Extended in `540af0a`: the seed also writes `store_settings.cod_enabled = true` for Batik Nusantara
  and **11 `store_shipping_methods` rows**. Both were missing, and both mattered — a re-seed used to
  switch COD off (the column defaults to FALSE) and leave the per-service table empty, which
  `/api/public/ongkir` reads as "the seller never opened the card" and answers with the courier-level
  fallback, re-offering services the seller never picked. Verified on a forced re-seed.
- [ ] **The seed has no `retur` orders, no `cod` payments, and no `payouts`.** The three most expensive
  code paths in the product have **no demo data** and cannot be exercised by clicking around.
- [ ] **`KIRIMINAJA_ENV` defaults to `sandbox`** — an unset env in production silently books nothing.
  Make production refuse to start instead. **This is now the last thing standing between the shop and
  real tariffs:** ongkir is a genuine KiriminAja call, genuinely priced from the seller's pickup
  address, and the storefront renders exactly what the server returns (verified 8/8) — but it all
  talks to `tdev.kiriminaja.com`. Everything downstream of the price is real; the price is not.
- [ ] **Pickup address is unvalidated against the courier.** `sender_kecamatan_id` is trusted as a
  KiriminAja district id because the picker writes it — but nothing re-checks it, and a merchant with
  a stale or hand-edited id would price every order from the wrong city with no error. Cheap fix:
  verify the id resolves in `kiriminaja_areas` on save.
- [ ] Cetak label PDF (still a toast stub) · tracking webhook · parcel weight is hardcoded `qty × 500 g`.

---

## P1 — Security & integrity

- [x] **RLS on `support_*`** (`0035`), **on `payments` + `media`** (`0036`, proven on production data).
- [x] **Platform operator roles enforced** (`0776e99`) — `support` < `admin` < `owner`.
- [x] **Impersonation is `owner`-only and audited** (`571ed17`).
- [x] **Every fabricated number removed from the super-admin** (`571ed17`) — `store_stats` (a rollup that
  disagreed with the `orders` it summarised by up to **140×**), a `mulberry32` MRR chart, five of six
  delta chips hardcoded to `0`, a hardcoded `churnRate: 0`, two **disagreeing** MRR figures on one page,
  and `ship7d_avg` — a metric with **no source at all** that drove a banner recommending the operator
  **give away a Rp275rb/mo subscription**.
- [x] **Every fabricated number removed from the order detail** (`2a5ffc4`) — line items, ongkir, a
  back-solved "Penyesuaian" line, courier, resi, payment method, street address, and the barcode bars on
  the printed label.
- [x] **Pemasaran stops inventing ad performance** (`62df4a1`) — there is no Meta/Google/TikTok
  integration; the cards now say "Belum terhubung".
- [x] **The CRM stops chasing carts that never existed** (`9206220`) — "keranjang ditinggal" follow-ups
  (chase *Dress Midi Motif Bunga*, chase *Gamis Syari Polos*) were being shown for baskets that
  **existed nowhere in the database**. It was sending merchants after ghosts. The seed now derives its 3
  cart follow-ups from **real `checkout_sessions` rows**; orphan cart follow-ups: **0**. Also killed: the
  Pelanggan stat card's **"Total Pelanggan 3.128 · +8,2% bulan ini"** — the store has **24** customers,
  and nothing anywhere computed a month-over-month change.

- [ ] **🔴 `invitePlatformAdmin` escalation** — see the top-five list.
- [ ] **🔴 `billing.ts` has no capability gate** — see the top-five list.
- [ ] **Super-admin audit gaps** — `setInvoiceStatus` (**money**), `invitePlatformAdmin`,
  `setStoreUserRole`, `saveGateways`, `saveCodAllowed` (**COD risk policy**) and `createStore` all mutate
  and write **nothing** to `platform_activity`. An unlogged privileged mutation is indistinguishable from
  an attack.
- [ ] **The `support` platform role is unreachable** — **zero** actions accept it, including the ticket
  actions its own doc comment says it exists for. Either wire it or delete it.
- [ ] **Platform role checks are action-only** — the middleware and page guards check for *a* session,
  not a role, so a lower-privileged operator sees every screen and the buttons throw on click.
- [ ] **`/api/public/*` runs on the owner connection, outside RLS** — **the single largest RLS hole, on
  the most security-sensitive path in the system.** Tenant correctness at checkout rests on application
  code passing an explicit `store_id`. Options: a `store_id`-scoped read role for the public path, or an
  explicit, documented acceptance. Not a silent one.
- [ ] **`POST /api/public/pay` is dead but live** — no storefront file reads `PUBLIC_PAY_API`, yet the
  route still accepts unauthenticated requests to create real gateway bills. Delete it.
- [ ] **All rate limits are in-process** — they do not survive a restart and do not hold across replicas.
  `/api/track` in particular has no proof-of-work, signature or session check: a distributed script with
  a browser UA can inflate a store's funnel. Move to the Cloudflare edge.
- [ ] **`AUTH_SECRET` falls back to `"dev-insecure-secret-change-me"`.** Convenient in dev; must be
  impossible in production.
- [ ] **No login rate limit** on either panel.
- [ ] **`platform_activity` has a `store_id` and no RLS.** Deliberate (it is our log *about* tenants), but
  it deserves a written decision + a comment, not a silent whitelist entry.

---

## P1 — Honesty debt

- [ ] **🔴 The storefront `/blog` is four hardcoded articles.** `const articles: Article[] = [ … ]` in the
  page source. The `blogs` / `articles` tables are **never read** and there is no detail route. **The
  merchant's blog editor publishes into a void** — they write posts that no shopper will ever see.
- [ ] **Every store shares one WhatsApp number** (`DEFAULT_WHATSAPP = "6281234567890"`) and one email.
  There is no per-store column to override either.
- [ ] **`SECTION_DEFAULTS` ships fake testimonials** and a "Gratis Ongkir" marquee onto live storefronts.
  `page_templates` has 0 rows, so **every** store falls back to them. A real merchant's shop currently
  displays invented customer quotes.
- [ ] **`apps/admin/lib/mock/store.ts` still exists**, with six `mulberry32` generators, imported by ~10
  client components (almost entirely for its **types**, plus `TODAY` / `PRODUCTS` / `BLOG_CATEGORIES`).
  Extract the types, delete the generators. It is one careless import from putting invented data back on
  a screen.
- [ ] **`astro.config.mjs` hardcodes `site: "https://batiknusantara.id"`** — one demo brand baked into a
  multi-tenant app.
- [ ] **`/akun` on the storefront is a dead demo form.**
- [ ] **Stale source comments** — `lib/data/analytics.ts`, `lib/data/funnel.ts` and `schema.ts` all still
  say `analytics_events` has no writer. It has had one since `b7ae0ff`.

---

## P1 — Feature completeness

- [x] Self-serve signup (`/daftar` → one-transaction `provision.ts`).
- [x] Store Builder / "Tema" (ADR 0009) — homepage + category + product templates, brand colour,
  8 sections, SSR multi-tenant storefront, checkout branding. Hero carousel folded back into the
  **shared** Puck config (`5016bb3`) after shipping first as a fork the storefront could not render.
- [x] Real variants · CSV export · ⌘K search · RBAC UI rollout · content edit routes · order detail.
- [x] Landing page on the apex + SEO hygiene + `www` → apex 301.
- [x] **Abandoned-checkout capture** (migrations `0044` + `0045`, `d7fc92f`) — `checkout_sessions`, written
  by the storefront **as the shopper types** (debounced beacons), because **there is no "abandon" event to
  listen for: abandonment is the ABSENCE of an order**. A sweep flips `aktif` → `ditinggal` after 60 min
  of silence and stamps `abandoned_at`. `0045` exists because a straight-through checkout **also** ends
  `pulih`: without it the naive `pulih/(pulih+ditinggal)` renders a **19,3%** "recovery rate" and tells a
  shop it rescued every ordinary sale. Real rates (30-day window, `aktif` excluded from both sides):
  **abandon 80,0%**, **recovery 11,2%** (ditinggal 792 · orders 198 · rescued 100). Recovery links are
  **signed, store-bound, 7-day HS256 tokens**, never the raw session id.
- [x] **`/pelanggan/keranjang`** (`9206220`) — **792 abandoned carts that until this week were not recorded
  at all.** Ranked by what a merchant can act on: has-phone first, then basket value **decayed by age**
  (`subtotal / (1 + minutesAgo/1440)`). Tabs count with **true SQL totals**, not the loaded slice.
  WhatsApp recovery records **"WA dibuka", not "terkirim"** — wa.me cannot tell us whether the message was
  sent or read, and we do not display what we cannot observe.
- [x] **Guest vs registered customers** (`0044`) — `customers.registered_at IS NULL` = guest (7 terdaftar /
  17 tamu). Buying never requires an account, so **Tamu is the NORMAL case, not a defect**: a registration
  wall in front of an Indonesian checkout is the most reliable way to lose the sale. The UI styles Tamu as
  neutral and Terdaftar as the extra.

- [~] **Google OAuth** — code done, **UNPROVEN**. The code-exchange / JWKS path has **never been run
  against real Google credentials**. Feature-flagged, so an unset env hides the button rather than
  crashing.
- [~] **Chat (shopper ⇄ merchant)** — spec done ([`CHAT_SPEC.md`](./CHAT_SPEC.md)); **migration `0043`
  landed** (`chat_visitors`, `conversations`, `conversation_messages`, with RLS). Application code was in
  flight and uncommitted at the time of writing. Note: CHAT_SPEC targets migration `0036`, which was
  taken by the payments/media RLS migration — the real slot is `0043`.
- [ ] **Custom domain for a merchant** — `slugFromCustomDomain()` is a one-function `return null` stub and
  the host is already the cache key, so the seam is ready. Needs `stores.custom_domain`, an admin UI, and
  Cloudflare-for-SaaS or a Traefik per-domain router + cert.
- [ ] **`product-detail` section** — a product template currently replaces only the *tail* of the PDP; the
  buy box is always kept, because no registry section can render it and a full replace would ship
  unbuyable product pages.
- [ ] **De-dup `apps/admin` onto `@tokophi/ui` + `@tokophi/lib`** and delete its local `components/ui` +
  `lib/format`. Super-admin already consumes the shared packages.
- [ ] **Diskon edit route** `/diskon/[id]` (create-only dialog today).
- [ ] Tiptap rich text (textarea + a decorative toolbar today) · video slot · MinIO/S3.

---

## 🔴 P2.0 — Checkout input validation (QUEUED — "part 2", after the 3 shipping agents land)
> User's ask: lock down nama / email / WhatsApp / alamat / kecamatan / kodepos so we stop collecting junk, fake numbers and spam — and so what we push to KiriminAja is in the format it expects (`62xxx`).

**The governing principle, and the trap:** *over-validation rejects real customers, and it does so silently — the shopper just leaves.* A rule that blocks a legitimate Indonesian name, a new carrier prefix, or an address with an unusual character costs a sale and nobody ever finds out. So the rule is **normalise generously, reject narrowly, and validate on the SERVER** — the browser is UX, the API is the boundary (same lesson as the ongkir origin and the COD province: *a claim from the client is not a fact*).

- [ ] **WhatsApp — normalise, don't reject.** Real data in prod is stored as **`08124612804`** (local format, 24/24 customers) — so this is a data-normalisation job, not just a form rule.
  - Accept everything a human types: `0812…`, `812…`, `+62812…`, `62812…`, with spaces, dots or dashes. **Strip and canonicalise to `62xxx`** — that is what KiriminAja wants and what the Seller admin should display.
  - Validate **structure, not carrier**: after `62` it must start with `8`, and the whole number must be 10–13 digits. **Do NOT hardcode provider prefixes** (811/812/813/821/…): carriers add prefixes, and a hardcoded list will one day reject a real customer on a new number — a silent, permanent bug. Structure catches fakes; a prefix table catches yesterday's fakes.
  - Backfill the 24 existing `08…` customers to `62…`, and normalise on write from every path (checkout, Seller admin, CRM).
- [ ] **Email — format only, and no domain whitelist.** There is **no mailer in this repo**, so we can validate the shape but must never claim we sent anything. Validate a standard email shape; **do not restrict to gmail/yahoo** — a whitelist would reject corporate, university and self-hosted addresses (i.e. exactly the higher-value buyers). If we want to help typists, offer domain *suggestions*, never a block. Email stays **optional** (the user keeps it for future accounts + mailing list).
- [ ] **Nama** — letters, spaces, apostrophes, hyphens and dots (Indonesian names carry all of these: `Nur'aini`, `Siti Aisyah binti Abdullah`, `M. Rizky`). Reject digits and symbols. Do NOT reject diacritics.
- [ ] **Alamat lengkap** — letters **and digits** (house numbers, RT/RW are the whole point) plus ordinary punctuation. Only block obvious junk (emoji, control chars, a single repeated character). Set a sane min length so `-` is not an address.
- [ ] **Kecamatan** — do NOT validate it as free text. It is **picked from a list**, so the real rule is: **there must be a valid `dest_id`** that resolves in `kiriminaja_areas`. That is a far stronger check than any character rule, and it is the id the parcel is actually booked against.
- [ ] **Kode pos** — auto-filled from the picked kelurahan (see the checkout work in flight). Validate as 5 digits; stays typeable for the ~4% of districts with no kelurahan data.
- [ ] **Server-side enforcement in `/api/public/order`** — the UI rules are UX. The API must re-normalise and re-validate every one of these before it writes a customer or an order, and reject with a clear Bahasa error. Otherwise a script still posts whatever it likes.

## 🔴 P1.9 — Shipping weight must come from the DB, not the browser (QUEUED — blocked on the GoSend/Grab removal touching the same files)
> **The bug (found 2026-07-14 by the user: "Mampang, Jakarta Selatan → SPX Standard Rp40rb"):** `checkout.astro` prices every parcel with **`weight: totalQty * 500`** — a fabricated 500 g per item. The real column `product_variants.weight_grams` exists and the Seller's product editor has always had a required "Berat (gram)" field — it was simply **NULL on all 96 variants**, so nobody noticed the checkout never read it.
>
> Measured on the live API (Surabaya → Mampang Prapatan, SPX Standard): 3.000 g → **Rp41.100** (what the user saw) · 1.500 g → Rp27.400 · **675 g (3 items at their REAL ~225 g) → Rp13.700**. Shoppers were being quoted **3× the true postage** — a silent conversion killer for an apparel store, and nobody would ever know why the carts were abandoned.
>
> ✅ **Done already:** weights backfilled (96 variants, 150–300 g, stable per-id; prod + local), dims set to 1×1×1 (volumetric negligible → the courier bills the ACTUAL weight, correct for apparel), and `seed.ts` now seeds weight deterministically (mulberry32 — never `Math.random()`).
>
> ❌ **Still open — and this is the important half:** the checkout still sends the weight **from the browser**. Filling the data is not enough if the client is still the one doing the arithmetic. **Weight is a price input, so it must be computed server-side**, exactly like the ongkir ORIGIN (now read from the seller's pickup address, not a client-posted city) and the COD PROVINCE (now read from the KiriminAja district id, not the buyer's typed text). Same lesson, third time: **a claim from the client is not a fact.** A script posting `weight: 100` for a 5 kg parcel gets the cheap quote and the **merchant eats the difference with the courier**.

- [ ] `/api/public/ongkir` `op=rates` accepts `items: [{variantId, qty}]` and **sums `product_variants.weight_grams` itself**; `body.weight` from the client is ignored entirely (delete it, don't merely distrust it).
- [ ] Variants with a NULL weight → fall back to 500 g **and** surface a warning on the Seller's product list ("Berat belum diisi — ongkir bisa salah"). A silent fallback is the same lie in a smaller font.
- [ ] Make weight genuinely required for new products (the field already defaults to 500 — that default is itself a guess worth showing).

## 🔴 P1.8 — Healthcheck & watchdog (DESIGNED, NOT BUILT — user: "catat dulu, nanti eksekusi")
> **Why this is here:** on 2026-07-14 production went down **three times** and every deploy failed **silently for an hour** — and *every single one* was found only because someone happened to look. Nothing told us. That is the gap: not the bugs, the **absence of a witness**.
>
> **The three failure shapes seen (design against these, not against a generic "is it up?"):**
> 1. **Containers created but never started.** Coolify built `admin`/`super-admin`/`storefront`, left them in `created` (exit 0, no logs, disk fine), and moved on. The site 503'd; `landing` stayed up (it has no deps — that design held). Recovery was a plain `docker start`.
> 2. **Deploy failing while the API answers "queued".** `npm ci` refused to run (lockfile out of sync — `playwright` in `package.json`, absent from the lock), so **every** build died at `RUN npm ci` for an hour. `POST /api/v1/deploy` kept returning `deployment queued`. Coolify's own `application_deployment_queues` table said `failed` the whole time — nobody was reading it.
> 3. **A migration that never applied.** The journal referenced `0046_good_dust` whose `.sql` was never committed → `drizzle-kit migrate` died → the `kelurahan` table never existed → `/api/public/ongkir op=kelurahan` 500'd on every checkout. **And the 500 surfaced in the browser as a CORS error** (an uncaught throw returns Next's own 500, which carries no CORS headers), so the message pointed at the wrong layer for hours.
>
> **Design (3 layers — one is not enough, each catches what the others cannot):**
> - **L1 — self-healing watchdog ON the box** (cron, 1 min): any of the 4 app containers in `created`/`exited` → `docker start` it. Fixes shape #1 with no human awake. **Needs no credentials — can be built today.**
> - **L2 — external probe** (must NOT run on the box; a watchdog on a dead box is worthless): the 5 public hosts **plus one endpoint that actually touches Postgres** — a container can be `healthy` while the DB is gone, so a static page proving 200 proves nothing. Suggested: `POST /api/public/ongkir {op:"search"}` (hits `kiriminaja_areas`).
> - **L3 — deploy-failure alarm** (shape #2): read Coolify's `application_deployment_queues` for `status='failed'`. Do not trust the deploy API's response.
>
> **Blocked on ONE decision from the user: where do alerts go?** Telegram (fastest to a phone; needs a @BotFather bot token + chat id in `~/.config/ai-local/secrets.env`), or email/SMTP. Until that exists, L1 can still ship (self-heal + `/var/log/tokophi-watchdog.log`) — it just heals in silence.

- [ ] **L1 self-healing watchdog** (no credentials needed — do this first, it alone would have prevented all 3 outages today)
- [ ] **L2 external probe** incl. a DB-touching endpoint, off-box
- [ ] **L3 deploy-failure alarm** reading Coolify's queue table, not its API response
- [ ] **Alert channel** — user decision (Telegram bot token / SMTP)

## P1.7 — Domain cutover (LIVE, residual items)

- [x] DNS, Traefik wildcard router (`priority=1` — load-bearing), landing app, SEO hygiene, `www` 301.
- [x] **Verified in production:** a store signed up through the real `/daftar` got a working HTTPS
  storefront at `<slug>.tokophi.com` with **zero deploys and zero DNS work**.
- [ ] **⏳ YOU: set the zone's SSL mode to `Full (strict)`** — our API token lacks *Zone Settings: Edit*.
- [ ] **⏳ YOU:** check `site:app.tokophi.com` / `site:rich.tokophi.com` and purge anything already indexed
  via Search Console → Removals. The `noindex` header handles everything not yet indexed.
- [ ] Move the `www` redirect to the Cloudflare edge · Cloudflare cache rules.
- [ ] De-dup `noRobots()` (copy-pasted into both apps' `middleware.ts`) into `@tokophi/lib`.
- [ ] **Billing-cron URL + the AutoLaris callback URL still point at the old host** — verify the AutoLaris
  dashboard.
- [ ] Revoke the `claude-domain-cutover` Coolify token.

---

## P1.8 — Abandoned-cart capture: what go-live still needs

The feature is built and proven **locally, end-to-end, in a real browser**. None of that is true in
production yet.

- [ ] **🔴 Not deployed.** Both commits (`d7fc92f`, `9206220`) sit on `worktree-super-admin-overhaul` and
  are **not merged to main**, so Coolify has shipped none of it. **Production still runs without
  abandoned-cart capture** — every cart a real shopper leaves today is still lost, unrecorded.
- [ ] **The ageing sweep is opportunistic** — it piggybacks on storefront traffic, so **a store with no
  visitors never ages its own carts**. Acceptable now. On the VPS, decide between a cron and having the
  read layer derive `ditinggal` on the fly.
- [ ] **The capture rate limiter is in-process memory** (per SSR process) — the same known gap as
  `/api/track`. Multi-instance needs a Cloudflare rule.
- [ ] **Set `CHECKOUT_RECOVERY_SECRET` in the production env.** It falls back to `AUTH_SECRET`, which
  works — but it means **rotating the auth secret silently invalidates every outstanding recovery link**.
- [ ] **Google OAuth has still never been run against real credentials** (see *Feature completeness*
  above) — a signup blocker, not an abandoned-cart one, but it is the other thing standing between this
  branch and a merchant using it.

---

## P2 — Missing modules

- [ ] Produk: transfer stok antar-lokasi (`stock_transfers` exists, 0 rows, no UI) · pemasok CRUD.
- [ ] Pelanggan: loyalitas / poin.
- [ ] CRM: WhatsApp broadcast & automation (today: follow-up worklist + templates + pipeline).
- [~] Pemasaran: kampanye email/WA, automations (welcome, abandoned-cart). **Abandoned-cart recovery is
  now MANUAL** — the carts are captured and `/pelanggan/keranjang` opens a filled `wa.me` on one click.
  What is missing is the **automation** (send without a human, on a schedule).
- [ ] Kartu hadiah · Template notifikasi (toggles exist; the message editor does not).
- [ ] Analitik: laporan kustom + saved reports.
- [ ] **A real ad-platform integration** — or the permanent removal of `ad_channels` / `ad_metrics`. The
  tables exist and describe a product we do not have.

---

## P3 — Polish

- [ ] Loading / skeleton states.
- [ ] Full dark-mode visual QA pass.
- [ ] Accessibility audit (aria mostly present; never formally checked).
- [ ] "Rentang khusus…" custom date range.

---

*How to use: pull the top unchecked item, ship it, check it, add a `CHANGELOG.md` line, and re-verify
[`STATUS.md`](./STATUS.md). **Do not check an item off because the code exists — check it off because you
ran it.***
