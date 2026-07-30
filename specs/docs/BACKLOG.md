# TokoΦ — Backlog & task board

> **Reconciled against the code and the database 2026-07-14.** Items that shipped are marked and
> collapsed; items that are still open are stated **honestly**, including the ones we would rather not
> look at. Legend: `[ ]` todo · `[~]` partial · `[x]` done.
>
> Companions: [`STATUS.md`](./STATUS.md) (real vs fake) · [`REQUIREMENTS.md`](./REQUIREMENTS.md)
> (verifiable statements) · [`PRD.md`](../PRD.md).

---

## ▶ NEXT UP — handoff 2026-07-21 (session end)

**Nothing is half-finished. Working tree clean, branch synced, `main` at `036f05e` (PR #26).**
Ten PRs merged this session (#9–#26) across **~10 production deploys, every one verified** by comparing
the container ID *and then reading the shipped HTML / DB columns* — never by a 200 alone. That method
exists because a health-only check fooled us once: it reported "rebuilt + healthy" while showing the
PREVIOUS build (DEPLOY.md, "How to verify a deploy ACTUALLY landed").

**What landed:** seven cross-tenant holes (four found by auditing the *class*, not patching instances —
`media.ts`, `deleteDiscount`, `createPurchaseOrder`, `syncChildren`), one writer for `orders.status`,
resi-chain hardening + raw-payload capture, and the whole front-end pass — product search (`/cari`),
responsive `srcset` with an allow-listed on-demand resizer, a sale-recovering 404, URL-driven sort,
social profiles + redesigned footer, favicon accepting any format, and a11y (skip link, reduced-motion,
44px targets). Core Web Vitals measured on prod mobile 3×: **LCP 348–552ms, CLS 0** — nothing left to
optimise there, so don't.

**THE ONLY OPEN TASK IS BLOCKED ON THE OWNER — GitHub #12.** Two resi questions that code and docs
cannot answer, only one real production booking can:
1. **Are we tracking with the wrong id?** Booking registers `TOKOPHI-<ref>`; `kaTrack` queries with
   `kj_order_id` under key `order_id`, while KiriminAja's doc calls that field `order_id string(max:20)`
   — and `TOKOPHI-<ref>` can exceed 20.
2. **Does status `200` mean delivered?** Their webhook doc says 200 = picked up / 300 = delivered; their
   tracking doc says 200 = Delivered. We map 200 → delivered, which on the webhook scale **collects COD
   cash and credits the ledger for a parcel still in transit.** The vendor's own docs disagree — only a
   captured payload settles it.
   Everything needed is already in place: the poller logs the raw payload
   (`docker logs cron-tracking | grep ka-raw`, `0746806`), including the two previously-silent cases.
   ⚠️ **Do not flip `KIRIMINAJA_ENV=production` by accident — it is the last step before real money.**

**Other owner decisions, each a GitHub issue:** #13 alert channel (the L2 probe is built and green but
cannot page anyone), #14 image picker, #16 the rest of the front-end audit (filter/pagination are
*projects*, not polish), #21 image-CDN TTL (⚠️ hash the filenames BEFORE lengthening the TTL, or a
changed photo sticks for a year).

**#15 is CLOSED as superseded** — see the resolved section below. Do not push or rebase the 25 stale
local-`main` commits.

---

<details>
<summary>Previous handoff — 2026-07-18 (blog featured images, PR #7)</summary>

**PR #7 is MERGED to `main` (`dfe1631`) and DEPLOYING.** It carries the blog featured-image feature
(`8c56003`, incl. the body-deleting-save fix, STATUS §0) AND **15 editorial Jurnal images** (`ace867e`):
`seed-journal.ts` no longer crops catalogue photos — each published article now has a topic-true header
committed at `apps/admin/public/journal/<handle>.webp` (900×600 WebP q82; "Cara Mencuci Batik" used to
show a model in a dress). The `migrate` service runs `seed-journal` + mounts `tokophi-uploads`, so the
images seed to production automatically (Merge = deploy). Verified locally: 15 `media` rows (Files),
`og:image` absolute per article (+ `twitter:image`), `/blog` renders all 15, admin+super-admin+storefront
builds green.

- [x] **Confirm the production deploy landed** — **DONE, verified live** and recorded in `WORKLOG.md`
      (`1810d8f`): 15 editorial images on `https://batik-nusantara.tokophi.id/blog`,
      `/api/uploads/jurnal-*.webp` → 200 `image/webp`, absolute `og:image`, 15 `media` rows, migrations
      0058–0061 applied on prod, no `/api/uploads` 404s.
- [ ] **Journal images do not cache-bust on re-seed.** `/api/uploads` sends `Cache-Control: immutable`
      (correct for unique upload names). But `seed-journal` reuses `jurnal-<handle>.webp`, so a returning
      visitor keeps the OLD image for a year after any art change. If journal art is ever expected to
      change again, give the files a content hash in the name (like real uploads) so the URL changes with
      the bytes. Not urgent — production seeds fresh, so first-time visitors are fine.
- [ ] **Product images into Files — DECISION NEEDED, this is the open question.**
      `media` holds the 15 journal images and **zero product images**; the 70 catalogue photos live as
      static `/products/*.webp` in both apps' `public/`. Two ways, and they are not equivalent:
      1. **Move them properly** — run each through `saveImage` into `uploads/`, insert `media` rows,
         then **repoint `products.image` + `product_media.url`** (70 products × up to 5 media each).
         Clean and consistent: Files then really is the store's library. Risk: it rewrites catalogue
         data, and the storefront's `mediaUrl()`/`catalog.ts:434` has a sibling-image rule that keys
         off `/api/uploads/` vs relative paths — read it before touching this.
      2. **Register only** — insert `media` rows pointing at `/products/*.webp`. Cheap, non-destructive,
         shows up in Files. ⚠️ But **Delete in Files would then remove the row and NOT the file**:
         `deleteImageFile` is regex-guarded to `/api/uploads/<name>` on purpose (a DB column is still
         input; `../../` must never reach `fs.unlink`). That is safe but it is a **half-working
         control**, i.e. the exact thing this repo keeps getting burned by. If you pick this, the
         Delete button must say so or be hidden for those rows.
- [ ] **`/tema` polish** — explicitly deferred by the owner. Also: the Puck canvas rendered **blank**
      in a headless screenshot while the Outline listed every section. Blank for sections nobody
      touched too, so **not** a regression from the Jurnal section — but unverified either way. Reproduce
      with a real browser before believing it. (The `puck.css` global leak below is a separate, known thing.)
- [ ] **A merchant cannot pick an existing image from Files** — the Blog editor and the product editor
      both upload a NEW file every time. There is no picker. So the library fills up with duplicates of
      the same photo, and "reuse the image I already uploaded" is impossible. The library exists; the
      picker does not.
- [ ] **`seed.ts` still seeds 6 articles that `seed-journal.ts` immediately deletes.** Harmless because
      the deploy chain orders them, but it is two seeds owning one table. Remove the `ARTICLES` block
      from `seed.ts` and let `seed-journal` own the journal outright, the way `seed-templates` owns the
      homepage.

**Environment note, not a bug:** the local `next dev` admin does **not hydrate** — `/files` renders but
every button is dead (Turbopack HMR websocket fails). The same page hydrates correctly on live and on a
local `next build && next start`. **Do not diagnose admin interactivity from `next dev`** — it will tell
you a working feature is broken. Verified 2026-07-17 by testing the same page three ways.

</details>

---

## 🖼️ IMAGE UPLOADS — audited 2026-07-20, every control checked in code and in a browser

The assumption going in was "drag works, add click". **The truth was the opposite**: click worked almost
everywhere, drag existed on exactly ONE surface (Files), and two controls were dead while promising both.
Fixed this pass: `8efe404` (Kategori uploader was a dead button promising click AND drag; `image_url`
existed in the schema and was never read or written; storefront now renders the cover), `376c908` (dead
new-product tiles, a video card advertising 50 MB with no pipeline behind it, drag + true multi-file
upload), `132e1d1` (favicon offered ICO, which sharp cannot decode), `fe46df0` (WebP shrink-if-smaller,
Files busy state).

**Settled, do not re-litigate:** the ORIGINAL upload is never written to disk — conversion happens in
memory and only the `.webp` (or passthrough `.svg`) is written. There is no original to delete. SVG is
deliberately not converted (rasterising a vector makes it bigger *and* blurry). 2 MB is the server cap
(`MAX_BYTES`), and every visible hint now derives from or matches it.

- [ ] **A merchant still cannot PICK an image they already uploaded.** Every editor uploads a NEW file
      every time — the library fills with duplicates of the same photo and "reuse the one I uploaded" is
      impossible. The library exists (`/files`); the picker does not. This is the single biggest remaining
      gap in the image story and it affects produk, kategori and blog equally.
- [ ] **Puck / Tema image fields are raw text inputs** (`lib/theme/puck-config.tsx`) — the merchant hand-types
      `/hero/hero-1.webp` with no picker and no bridge to Files. Same missing picker, worse surface.
- [ ] **Drag-and-drop is still absent on blog, logo and favicon.** Click works on all three and no copy
      promises drag, so nothing lies — but Files and now produk/kategori have it, and the inconsistency is
      the kind a merchant reads as "broken here".
- [ ] **`getBulkLabels`-style honesty for uploads:** the product editor's failure toast is generic
      ("Gagal mengunggah gambar (maks 2MB, format gambar)") regardless of the real cause. The server knows
      which rule was broken; the merchant is told to guess.
- [ ] **GIF is accepted but silently flattened to one frame** by sharp. Deliberately left off the visible
      format list rather than advertised with a caveat — decide whether to reject it outright instead, so
      an animated GIF does not become a still without explanation.

---

## 🔴 RESI (AWB) CHAIN — scanned end-to-end 2026-07-20, against KiriminAja's own published docs

Booking is solid and honest (`awb: null` is never back-filled with a booking ref). **Everything
downstream of it rests on a `/api/mitra/tracking` response shape nobody has ever seen succeed**, because
`KIRIMINAJA_ENV` defaults to `sandbox` in both compose files and every `.env.example`, and sandbox never
issues an AWB. `awbFilled` has never been observed non-zero. Fixed this pass: `8cc7080` (partial print
runs marked un-labelled parcels printed; AWB-less orders vanished from the only screen that could fix
them) and `3eefe02` (one bad gateway reply killed the whole sweep; poller starvation; summary to
`/dev/null`; three comments describing things that do not exist).

- [ ] **🔎 FIRST THING TO TEST IN PRODUCTION — we may be tracking with the wrong id.** `request_pickup`
      registers our own `order_id` as `` `${KA_ORDER_PREFIX}-${orderRef}` `` (default prefix `TOKOPHI`),
      but `kaTrack` queries `/api/mitra/tracking` with the **`kj_order_id`** KiriminAja returned, passed
      under the key `order_id`. Their tracking doc documents that field as `order_id string(max:20)` —
      and `TOKOPHI-<ref>` can exceed 20 chars. Nothing in the repo has ever confirmed which id that
      endpoint wants. **This is the cheapest available explanation for why the AWB has never landed**,
      and it costs one real booking to settle. Try both ids and record the raw response.
- [ ] **🔴 THE STATUS CODE SCALES DISAGREE — and this one moves money.** KiriminAja's **webhook** doc
      says `105` AWB created · `200` **shipped/picked up** · `300` **delivered** · `400` returned · `500`
      problem · `900` canceled. Their **tracking** doc says `200` = **Delivered**. The same number means
      different things depending on the source. Our `outcomeFromTrackingCode` maps `200` → delivered. If
      the tracking endpoint ever answers on the webhook scale, a parcel that was merely **picked up**
      would be read as delivered — which **collects the COD cash and credits the ledger for a parcel
      still in transit.** The BACKLOG already admitted this table was "read off the docs, never
      observed"; the point now is that **reading the docs more carefully cannot save us, because the
      vendor's own docs are inconsistent.** Only a captured real payload settles it. Log the raw
      `status` of every pull for a week before trusting any money-moving transition.
- [ ] **Adopt the webhook — but never as an authority.** KiriminAja documents `processed_packages`,
      which fires exactly when the AWB is created: the right mechanism for an asynchronous waybill, and
      it would remove the polling window entirely. ⚠️ **Their setup doc specifies NO signature, NO HMAC
      and NO IP allowlist, and their official PHP SDK ships no verification helper.** One callback URL
      per account. In this system a `finished_packages` event **collects COD cash and credits the
      ledger** — so an unsigned public endpoint would let anyone who learns the URL mint money in our
      books. The only safe shape: treat the callback as an **untrusted hint that triggers a verified
      pull** of the tracking endpoint, and move money only on what our own pull returns. (Ask them in
      writing whether a signing secret exists — the docs may simply be incomplete.)
- [ ] **A stuck parcel still never reaches the merchant.** `outcome === "problem"` increments a counter
      and `console.warn`s. There is no `orders` column, no badge, no screen. `3eefe02` at least made the
      run summary land in `docker logs cron-tracking` instead of `/dev/null`, but a log nobody reads is
      not a notification.
- [ ] **The poller has no retry, no backoff and no give-up.** A failed pull waits 15 minutes for the
      next tick. An order booked six weeks ago with no AWB is polled forever with the same priority as
      one booked this morning (it is now at least polled *first* — `3eefe02` — but nothing ages it out
      or escalates it). No attempt counter, no first-booked timestamp, no alert.
- [ ] **No pacing, no 429 handling.** `BATCH = 100` bounds a sweep; the loop still fires up to 100
      requests back-to-back and `ka()` does not inspect HTTP status for rate-limit responses.
- [ ] **`skipped` cannot distinguish "no resi yet" from "AWB we could not encode".** `getBulkLabels`
      returns bare order numbers for both, plus for numbers that resolved to no row at all (RLS-scoped
      away). The toast therefore says "resi belum terbit", which is true for the common case and a small
      lie for the rare one. Fix by returning `{number, reason}` objects.
- [ ] **The shopper has no tracking surface at all.** `grep -r 'awb\|resi' apps/storefront/src` returns
      nothing. The buyer cannot see a waybill anywhere, so "resi" exists only for the merchant.
- [ ] **In sandbox a booked shipment can never be cancelled** (verified, not inferred):
      `cancel_shipment` answers `{"status":false,"text":"Paket tidak ditemukan"}` for a booking
      reference — it wants a courier AWB, which sandbox never issues.

---

## 🔴 LEFT OPEN BY THE 2026-07-18 DEEP AUDIT — found 2026-07-20 reconciling the docs against the commits

The audit fixed 10 real bugs. Reconciling STATUS.md against the actual diffs turned up what it did **not**
close. Two of these are the same defect as a fix that shipped, in a file the audit never opened — which is
the point: **hand-fixing the instances you found is not a strategy.**

- [x] **🔴 `lib/actions/media.ts` cross-tenant hole — FIXED `e9656fd`.** `product_media` has no `store_id`
      and `relrowsecurity = f` (verified in `pg_class`), and `deleteProductImage` never joined `products`,
      so `media:write` could delete another store's product image. Both writers now read the parent under
      RLS first; `saveImage` moved inside the guard so a rejected upload leaves no orphan file either.
- [x] **Enumerate every remaining writer of a table with no `store_id` — DONE 2026-07-20, and it found
      three MORE live holes** (all fixed in `30a3c71`): `deleteDiscount` (blind-fire cross-tenant delete of
      another store's `discount_usages` — capped only because the table is empty today),
      `createPurchaseOrder` (client `variantId` written as an FK; "Terima barang" would then add stock to
      the victim's shelf), `syncChildren` (foreign `productId` into `collection_products`, safe only by an
      accident two files away in the storefront's owner-connection read). **The rule is now in AGENTS.md**,
      with the full 11-table list. `e61df25` patched the instances it found; the class had seven.
- [x] **`jwtVerify` algorithm pins — FIXED `cae0deb`** on `apps/super-admin/middleware.ts:24` and
      `apps/storefront/src/lib/chat.ts:63`. `apps/admin/lib/google.ts` is left unpinned deliberately
      (remote JWKS, asymmetric, issuer+audience constrained — pinning RS256 would turn a Google key
      rotation into a silent total login outage).
- [x] **`shipping.ts` raw `orders.status` writes — HOLE CLOSED `d07aa1e`, DOOR STILL THERE.**
      `cancelShipment` and `createShipment` now refuse on `selesai`/`batal`/`retur`, and the cancel path
      re-reads the status under `FOR UPDATE` after the KiriminAja round-trip (the poller writes the same
      row while we are on the network). If the order went terminal meanwhile, the shipment fields are still
      cleared — the booking IS void at the courier — but `status` is left alone.
- [x] **Route the two shipping status writes through `applyOrderStatusChange` — DONE, and this line was
      STALE.** Verified 2026-07-31: both call sites in `shipping.ts` go through the state machine and
      there is no raw `set({ status })` left in the file. Caught by an audit that trusted the backlog
      over the code — a ledger that lies about what is done costs a re-audit.
- [x] **`ka-tracking.ts` read `orders.status` with no `FOR UPDATE` — FIXED `dde9c09`.** The read now lives
      inside the transaction with `FOR UPDATE`, matching `setOrderStatus`. The cron does its KiriminAja
      pull *before* calling `syncOrderFromKa`, so no lock is held across the wire — now documented on the
      function, because that ordering became load-bearing. Same commit fixed `createShipment`, whose
      terminal guard ran against a **pre-network** read: the poller could advance the order to
      `selesai`/`retur` mid-flight and the write walked it back to `diproses`.
- [x] **Two stock writers were location-blind — FIXED `b37e762`.** `receivePurchaseOrder` and
      `updateProduct`'s `setInventory` now join `locations` and order by `(is_default desc, id asc)`,
      matching `bc2ebfd`. The `loc` lookups in `createProduct`/`updateProduct` got the same treatment —
      fixing only the update path would have left the CREATE path seeding rows into an arbitrary warehouse.
      ⚠️ **That `locations` join is now also the tenant boundary** for the un-RLS'd `inventory_levels`, and
      is commented as such: a later "simplification" back to `where variant_id = …` reopens a cross-tenant
      stock write.
- [x] **`api/public/order/route.ts` checked stock across ALL locations and decremented ONE — FIXED
      `80fb83b`.** The `sum(available)` pre-check and the `FOR UPDATE` re-read both aggregated every
      location while the decrement (`b1f3603`) targeted the default row: under multi-location a variant
      with 0 at the default and 5 at warehouse B passed the check and drove the default row **negative**
      while B's units were never consumed — **and the totals still reconciled, which is exactly why it
      would have been slow to notice.** All three sites now share one `defaultLocationRow(variantId)`
      expression, lifted verbatim from `b1f3603`. Behaviour identical on single-location data; both
      empty-inventory edge cases checked rather than assumed.
- [x] **`receivePurchaseOrder` was a read-then-write with no `FOR UPDATE` — FIXED `80fb83b`.** It read
      `inv.available` and wrote back a computed absolute, so a sale between the read and the write was
      silently overwritten (the last-write-wins class `bc2ebfd` closed in the bulk editor). Now a relative
      SQL write (`available + $add`), evaluated under the UPDATE's own row lock — no `FOR UPDATE` needed.
- [ ] **Cancelling a received PO is refused, and there is no undo path at all.** `b1f3603` correctly stopped
      the silent corruption, but the "undo = a separate stock adjustment" it points at **does not exist in
      the UI**. A merchant who receives a PO by mistake is now stuck with the phantom stock *and* the record
      — a silent corruption traded for a dead end.
- [ ] **Back-fill the ledger for orders cancelled after payment BEFORE `9772246`.** The `batal` reversal
      fires going forward; every prepaid order already cancelled in production still carries a withdrawable
      `sale` credit for a refunded order. Count them (`status='batal'` ∧ a `berhasil` payment ∧ no reversal)
      and decide: reverse, or accept and document. The one-reversal-per-order index makes a back-fill safe
      to re-run.
- [ ] **Audit the remaining `financial_status = 'dibayar'` gates for the COD carve-out.** `5f61034` taught
      Perlu Dikirim, the tab counts and bulk shipping that a COD order ships while `pending`. Any **other**
      screen still gating on `= 'dibayar'` (dashboard cards, Keuangan, exports, the ledger release rule) now
      disagrees with the shipping queue about the same order. Also: `bulk-shipping.ts` **duplicates** the COD
      predicate as an inline literal instead of importing `IS_COD` — the two will drift.
- [ ] **Browser-exercise the COD + AutoLaris checkout happy paths before prod.** `521861d` moved the payment
      insert **inside** the order transaction — the most important money change of the audit — and its own
      commit message asks for this. It has only been typechecked, which this repo's rules say is not verified.
- [ ] **Session-token audience rollout** (deferred in `cb17372`). `/impersonate` is pinned to
      `aud: tokophi:impersonate`, but the long-lived admin + platform SESSION tokens still carry no audience,
      so they remain mutually substitutable at any verifier that doesn't check `aud`. Correct hardening —
      but it invalidates every outstanding cookie, so it needs a window and a "you will be logged out" note.
      ⚠️ The `aud` literal is **hand-copied across two apps** with no shared import.
- [ ] **Merchant-facing `problem`-parcel flag** (deferred in `ee8a458`). The poller logs and counts them;
      nothing reaches the seller. Needs an `orders` column and a place on the order detail — until then a
      stuck parcel is a line in a container log nobody reads.
- [ ] **Confirm every caller sends `storeSlug`.** `7cc1ecc` made a missing slug fatal (correctly — it used to
      default to the demo store). But that converts a silent mis-attribution into a **dead checkout** if any
      caller omits it: checkout, the abandoned-cart beacons, recovery links, any dev/preview build where
      `STORE_SLUG` is unset.
- [ ] **The optimistic bulk-stock skip path is unexercised** (`bc2ebfd`). No concurrent sale has raced a save.
      Reproduce deliberately (open the editor, order in another tab, save) before trusting the merchant sees
      a warning rather than a silent no-op. Note `expected` is typed **optional** — any future caller that
      omits it silently reverts to last-write-wins.

---

## ✅ RESOLVED 2026-07-21 — the local-`main` divergence (25 commits) is SUPERSEDED, do not resurrect it

The checkout at `/home/fantastico/projects/tokophi` (branch `main`) sat **25 commits ahead / 211 behind**
`origin/main`, unpushed, and was flagged (GitHub #15) as "two versions of truth about couriers coexist."
Investigated read-only 2026-07-21; the ambiguity is not real, and the 25 commits are entirely superseded:

- **Kelurahan-precise shipping** (its main value — ~10 of the commits): **already on `origin/main`** — 58
  files reference `kelurahan`, migration `0049` is present, `kelurahan_id` in 45 files. It landed
  independently. Dead as salvage.
- **The ongkir perf fix** (5.5s → 0.6s): landed on `origin/main` as **`231e4e7`** ("quote SPX+JNE first").
  Dead as salvage.
- **The courier CURATION** (`BASELINE_SERVICES` lock + per-origin coverage probe + "TIKI exists"): the
  only genuinely-unique part — `git grep BASELINE_SERVICES origin/main` = **0 files**. But it is a
  DIFFERENT PHILOSOPHY that `origin/main` deliberately did not take: `origin/main` treats **the live
  KiriminAja API as the roster** (whatever it returns for the route), and its own docs say TIKI/Pos are
  fiction the API does not return. `origin/main` is self-consistent — it makes NO `BASELINE_SERVICES`
  claim. The "two truths" only ever existed inside the stale, unpushed local-`main`.

**Resolution:** abandon the local-`main` divergence. **Do NOT push or rebase those 25 commits** — nothing
of value is unique to them, and the one thing that is (curation) would REVERSE a shipped direction. The
local-`main` checkout is shared by other agents, so it was left untouched (no reset, no rebase — the
stash and working tree there are not ours to move; AGENTS.md). If the seller-facing courier curation
(SPX+JNE baseline + a coverage probe) is wanted as a FUTURE feature, re-derive it cleanly against current
`origin/main` — that is a product decision to reverse "the live API is the roster", not a mechanical merge.

---

## 🔴 LIVE runs `KIRIMINAJA_ENV=sandbox` — the courier list on tokophi.com is FICTION (2026-07-17)

**Status:** `[ ]` open · **owner decision, not a code change** · found while investigating "JNE is enabled
but does not show in checkout".

**The report:** on live `app.tokophi.com`, Batik Nusantara enabled **10 services** and JNE would not
appear at checkout for **Sukodono, Sidoarjo**. Suspicion was that we filter it out.

**We do not.** Verified end-to-end against the live box, not reasoned about:
- `store_shipping_methods` on live has `jne:REG23 enabled=t` — the seller's pick is correct.
- `platform_couriers` has `jne enabled=t` — the platform allows it.
- Calling KiriminAja **from inside the live admin container** for origin `6138` (Gubeng, Surabaya —
  the real pickup address) → dest `5642` (Sukodono, Sidoarjo) returns **18 services and NOT ONE `jne`
  among them.** No `jnt` either; the J&T on that route is `jtcargo:REG`, a different courier, and it
  **does** show at Rp45.000.
- The live checkout offers **8 services** = exactly (10 enabled ∩ what the route returns). The
  platform ∩ store filter is behaving correctly. **There is no bug to fix here.**

**The actual cause:** `KIRIMINAJA_ENV=sandbox` in the live admin container (confirmed by reading the
env). **Sandbox coverage is arbitrary, not real** — the same sandbox key returns `jne:REG23` happily
for a *Yogyakarta* origin and nothing for *Surabaya*. JNE obviously serves Surabaya→Sidoarjo in the
real world. So **every rate on tokophi.com today is fiction**, and no amount of filter work will make
JNE appear.

**The task:**
- [ ] Set `KIRIMINAJA_ENV=production` in Coolify (app `l7r4qaqcml4zigw1dc7iptun`), then redeploy.
- [ ] **Before flipping it**, confirm: the KiriminAja **production API key** is issued and active, and
      the **order prefix is registered in the production dashboard** (`KIRIMINAJA_ORDER_PREFIX`;
      sandbox prefix `5758` is proven, production is NOT — `request_pickup` 400s on an unregistered
      prefix, and that failure lands on a shopper mid-checkout).
- [ ] Re-verify the courier roster per route after the flip. **`platform_couriers[].codAllowed` was
      decided against SANDBOX capabilities** — production may report different `cod` flags, and COD is
      money we hand to a courier. See the COD chain in AGENTS.md.
- [ ] Re-check `service_type` codes. The merchant's picks are stored as `"<courier>:<service_type>"`;
      if production names a service differently from sandbox, a seller's saved row silently stops
      matching and the service vanishes from checkout — the exact symptom reported above, but real.

⚠️ **This is the last step between the demo and real money.** An unset env in production silently
talks to sandbox — quiet, plausible, and wrong. Flipping it makes rates real AND makes bookings real.

---

## 🚚 Shipping: Proses → auto-book → courier-driven status — DECIDED, PART-BUILT (2026-07-16)

> **Decided with the user 2026-07-16. The DATA foundation is shipped; the flow is not built.**
> Read this before touching the order state machine or the booking UI.

**Where it stands — UPDATED 2026-07-16 after the chain ran end-to-end for the first time.**

✅ **BOOKING WORKS. Proven, not assumed** (sandbox `request_pickup`, real order data):
```
status: true · pickup_number: XID-4775140108 · service SPX / type 1 · awb: null
```
Three things that were only ever *comments in the code* are now measured facts:
- **`composePickupAddress` is accepted by KiriminAja** — `"Jl. Raya Gubeng No. 42, Kel. Gubeng, 60281"` went through. The kelurahan+kodepos work (0051) was build-green but unproven; it is proven now.
- **`awb` comes back `null`** — the waybill does **not** exist until a courier accepts the pickup. This is why the UI must say *"resi menyusul"* and poll; a spinner "until the resi appears" would hang on a **successful** booking. Decision 2 is validated by reality, not taste.
- **`service_type` (0053) immediately paid off** — SPX Standard was selected exactly, no coin flip.

The seller's UI flow works too: **Cek Ongkir → pick → Buat** produced 2 booked orders (`ka_order_id` set). The reason production had 0 AWBs was never a bug — **that flow had simply never been run**. "Proses pesanan" does not book (it only sets status), which is the whole point of decision 1.

⚠️ **CORRECTION, recorded so nobody re-derives the wrong lesson:** a first probe failed with *"Prefix packages.0.order_id tidak sesuai dengan yang anda daftarkan"* and was mis-diagnosed as the root cause of the 0 AWBs. It was not. Production's `KIRIMINAJA_ORDER_PREFIX` was **always correct (`5758`)**; the probe had hardcoded the code's default (`TOKOPHI`) and then diagnosed its own error. The registered prefix is **`5758`** — if `request_pickup` ever 400s on the prefix again, that is the value.

🐛 **A bug that could only surface after the first successful booking** (fixed + migration `0054`): `createShipment` wrote `courier: input.serviceName`, so booking replaced the code (`spx`) with a display name (`"SPX Standard"`). `orders.courier` is a **join key** — to `platform_couriers` (`codAllowed` for the COD policy, and `group` for the 1 day/reguler/ekonomi/cargo filter) and to the per-courier COD return report — so every booked order silently dropped out of all of them, and one row ended up incoherent (courier `"SAP Satria Reg"` carrying JNE's `REG23`). **The lesson worth keeping: this was invisible until a booking succeeded, because a booked order is the one you stop looking at.**

- 14 production orders still claim `status='dikirim'` **with no AWB and no courier**. Demo seed, but the demo lies about shipping.
- ⚠️ **`KIRIMINAJA_ENV=sandbox` in production.** The user's call is to treat sandbox as real while building (the API is identical; going live is one env flip). **The one thing that must not be forgotten at launch:** a sandbox AWB is *not* a real waybill, so a seller would print a fake resi and stick it on a real parcel. Flip `KIRIMINAJA_ENV=production` before any real seller ships.

### ✅ BUILT 2026-07-16 — Pengiriman Massal (`/pesanan/massal`)

**How it works** (three verbs, in the order physics forces — see the honesty note below):
1. **Generate resi** → `bulkGenerateResi` re-quotes each order and books it with the service **the shopper paid for** (`orders.courier` + `service_type`, both now recorded). No rate picker: the order already knows. A service no longer quoted is **rejected**, never silently swapped — re-couriering someone's parcel behind their back is the same lie as re-pricing it.
2. **Ambil resi** → `bulkFetchResi` polls KiriminAja; `trackShipment` persists the waybill when the courier issues it.
3. **Cetak resi** → `POST /api/admin/labels` → `getBulkLabels` renders **one document of 100×150mm thermal labels** (`buildLabelHtml` per order, each with its own `@page`) → one print dialog → `markLabelsPrinted` stamps `label_printed_at`.

**Filters (all live, verified against real data):** service group **1 Hari / Reguler / Ekonomi / Cargo / Next Day** (via `platform_couriers.services[].group` ⋈ `orders.service_type` — impossible before 0053), **jasa kirim**, **status cetak** (sudah/belum, via 0055), **isi** (bijian = 1 item / bundling = >1).

**Nav:** the old **"Perlu Dikirim"** sub-item was **removed** — it was a saved link to `?tab=perlu_dikirim`, the same view the list already has a tab for and the parent row now points at (it is what the badge counts). Three doors onto one room. **Pengiriman Massal** takes its place.

**Deliberate choices, so nobody "fixes" them back:**
- **Sequential, not parallel** — each item is a live call that books a REAL pickup. 50 at once risks rate-limiting mid-run and an unknowable half-state, and a duplicate pickup is not a retry, it is a second parcel.
- **Partial failure is reported per order**, never summarised into "berhasil". 8 booked / 2 failed must read as exactly that — the seller has to know *which* two.
- **Orchestration only** — it calls `createShipment`/`trackShipment`, it does not re-implement them. A second copy of the booking logic is how the seller's list and the courier's parcel end up disagreeing (exactly what `composePickupAddress` did when it existed twice).
- **"Ditandai dicetak", never "berhasil dicetak"** — we render the label; we cannot observe the printer. Same rule as the CRM's "WA dibuka".
- `getBulkShipping` uses **LEFT JOINs**: an order whose courier no longer resolves must still be LISTED. Dropping it silently from the packing queue is how a parcel goes unsent.

### ▶ STILL TO PERFECT — tasks for this workflow

1. **[x] Tracking poller + `orders.awb` fill — BUILT `db10557` (by `Admin@Admins-Mac-mini`), SCHEDULED 2026-07-17.**
   `lib/ka-tracking.ts` (`syncOrderFromKa`: forward-only via a status RANK, reuses `applyOrderStatusChange`
   so inventory/ledger/COD move exactly as on a manual change, never overwrites a real AWB with our own
   booking ref) + `app/api/cron/tracking/route.ts` (batch 100, fails closed without `CRON_SECRET`).
   **It shipped with nothing scheduling it** — added the `cron-tracking` sidecar (15 min, its own
   container; the existing `cron` sleeps 86400s and an AWB the shopper is waiting on cannot be a day
   late). Reviewed: `orders.number` is UNIQUE **globally** (`orders_number_unique`), so the poller's
   `where number = …` cannot reach another tenant's order — checked, because that is exactly the class
   of bug 0058 was written for.
   - [ ] **Not yet exercised end-to-end.** No AWB has ever landed, so `awbFilled` has never been
         anything but 0 — and `KIRIMINAJA_ENV` still defaults to **sandbox**, so it is tracking sandbox
         parcels. The mapping in `outcomeFromTrackingCode` (100–105 booked · 106+ shipped · 200
         delivered · 300 canceled · 301/40x returned · 500/7xx/9xx problem) is **read off the docs, not
         observed** — verify against a real pull before trusting a status transition that moves money.
   - [x] **Unknown code + AWB present ⇒ forced `"shipped"`** — **CLOSED `ee8a458`**, and it went further
         than this item asked. It was not merely an untidy assumption: a **delivered** parcel reporting an
         off-map code pinned at `dikirim` **forever → COD never collected, merchant never credited**. The
         forced advance is gone entirely (unmapped → `null`: fill the AWB, change nothing), not replaced
         with a log line. `problem` parcels are logged + counted.
   - [ ] **The mapping now also accepts TEXT, and that branch is a guess.** `ee8a458` added
         Indonesian/English regexes because KiriminAja's `status` "has been observed" as text — **no real
         payload was ever captured**. Text is deliberately capped at `shipped`/`booked` and can never yield
         delivered/returned/canceled (a text-inferred `selesai` would collect COD cash and credit the ledger
         on a guess). Log the raw `status` of every pull for a week, then rewrite the map from what arrives.
2. **[x] Status follows the courier (decision 3) — CLOSED `ee8a458`.** `createShipment` books at `diproses`;
   the poller advances to `dikirim` on pickup. `cancelShipment` also stopped leaving a permanent "shipped
   with no shipment" (it nulled `kaOrderId` but left `status:'dikirim'`, which the poller could never move).
   ⚠️ **The other half of decision 3 — the timeline built from KiriminAja tracking events — is NOT done**
   (see `:181`). And both writes are **raw `db.update` on `orders.status`, bypassing the state machine** —
   `cancelShipment` has no status precondition, so it can walk a `selesai` order backward to `diproses`,
   straight through the terminal guard `9772246` added. New item below.
3. **[ ] Auto-book on "Proses pesanan" (decisions 1 + 5).** One button: confirm → book the service the shopper paid for (`courier`+`service_type`, both now recorded) → honest result (resi, or "dibooking, resi menyusul"). Old orders backfilled by 0053 can auto-book too.
4. **[x] `orders.label_printed_at` + printed/not-printed filter — ALREADY EXISTS.** This item said "does not
   exist" long after it shipped: `schema.ts:500 labelPrintedAt`, migration `0055_label_printed_at.sql`, and
   `bulk-shipping.ts:67-68,116` filter and count on it. This section's own prose at `:140` already cited
   "status cetak (sudah/belum, via 0055)" — **the section contradicted itself and nobody read it twice.**
   Cancelling after printing stays possible, as decided.
5. **[ ] Courier change by the seller** — except COD (SPX-locked). Seller pays the difference; do **not** rewrite the buyer's `shipping_idr`.
6. **[~] Pengiriman Massal — BUILT, not yet exercised.** The page, filters, bulk book/fetch/print and the thermal document all work and render (verified at 1400px, 0 page errors, filters showing real counts). **But not one label has been printed yet**, because production has **0 AWBs** — so `Cetak resi` has had nothing to print. Until (1) lands and a waybill actually arrives, this is proven to *compile and render*, not proven to *ship a parcel*. Do not call it done.
7. **[ ] Exercise the bulk path end-to-end**: select 2 orders → Generate resi → Ambil resi until a waybill lands → Cetak → confirm the thermal document is 100×150mm per label and `label_printed_at` stamps. This is the only thing that turns (6) from "renders" into "works".
8. **[ ] Print-run honesty**: `getBulkLabels` returns `skipped[]` (orders with no printable AWB) and the API passes it through, but the UI currently ignores it. An order silently missing from a print run is a parcel that silently does not ship — surface it.

**Decisions (user, 2026-07-16):**
1. **"Proses pesanan" auto-books.** One button: confirm → book the service the **shopper already paid for** → show the resi. No asking the seller which service — the order knows.
2. **The resi is NOT synchronous, and the UI must not pretend it is.** KiriminAja returns `awb: null` until a courier *accepts the pickup* (already documented at `order-detail.tsx:220`, and the existing manual flow already says so honestly). A spinner "until the resi appears" would hang on something we do not control. Correct: book → *"Dibooking. Resi menyusul setelah kurir menerima."* → poll (`trackShipment` exists) → resi lands → `Cetak resi` enables.
3. **Status follows the COURIER, not the seller's clicks** — the user's framing, and it is the better one. Booking → `diproses` (booked, awaiting pickup); the parcel becomes `dikirim` when the courier actually accepts — *which is the same moment the AWB appears*. Then the timeline/history is built from **KiriminAja tracking events**, not hand-set states. ⚠️ This **changed the order state machine** — **done in `ee8a458` (2026-07-18)**: `createShipment` used to jump straight to `dikirim` on booking, making the timeline claim "in transit" while the parcel sat on the seller's shelf. It now books at `diproses`. *(Kept in past tense on purpose: as written, this paragraph would send the next reader to "fix" already-correct code.)* The tracking-event timeline is still to build.
4. **The seller may change the courier** in the order detail — **except COD, which is locked to SPX** (`lib/cod.ts`: SPX is the only courier with `codAllowed`; production already agrees, all 4 COD orders are spx). **A unilateral courier change is the SELLER's cost:** the buyer paid `orders.shipping_idr` for the service they picked; if the seller moves to a pricier courier the difference is the seller's, and the buyer's number must not be rewritten.
5. **Proses *is* "cetak resi"** — one action, not two. The marketplace shape the user wants: **print status per order (`sudah dicetak` / `belum dicetak`) + a filter on it**, exactly like Shopee/Tokopedia. **Cancelling stays possible from the order detail even AFTER the label is printed** — a printed label is paper, not a commitment; `cancelShipment` already exists.
   ⚠️ **`orders.label_printed_at` does not exist** — there is no print state anywhere in the schema today (grep found only comments about printing). It needs a column before the status or its filter can be anything but invented. It is also the honest anchor for **Pengiriman Massal**'s "sudah/belum dicetak" filter.
   ⚠️ Note the ordering trap: printing requires a **real AWB** (`buildLabelHtml` refuses without one — deliberately), and the AWB is not synchronous (decision 2). So "Proses = cetak resi" cannot literally print on click for every order: it books, and the label becomes printable when the courier issues the waybill. The UI must say that rather than show a print button that silently does nothing.

**Shipped foundation (migration `0053`):** `orders.service_type` — `courier` alone was ambiguous (SPX Standard type `1` = `regular` vs SPX Economy type `3` = `economy`: different products, different prices), so auto-booking would have been a coin flip on the buyer's money. Checkout now records `rate.type` beside `rate.code`. This is also the join key to `platform_couriers.services[].group`, i.e. **the `1 day / reguler / ekonomi / cargo` filter the user wants for Pengiriman Massal is now buildable** — it was not before.

**Still to build:** the auto-book button (2 + 3), the tracking poller + history, the courier-change control (4), and only then **Pengiriman Massal / bulk label print** — which has nothing to print until a booking succeeds. See also the `Pengiriman Massal` + returns-IA notes: those menus were deliberately left out of `lib/nav.ts` because *"a nav row that opens onto nothing is worse than a nav row that isn't there"*, and that still holds.

---

## 💰 Keuangan — UI BUILT, SYSTEM NOT (2026-07-16)

> User: *"isi tampilan dulu, sistem nanti — namun secara ui/ux kamu udah susun dan bangun isinya."*
> The screens are real and every number on them is a real query. What is **absent** is the machinery
> that would make those numbers move. Read this before "fixing" a zero on these pages.

**Built** (`6b8f6c3`): `/keuangan` (Ringkasan), `/keuangan/penghasilan` (7/30/90 via URL),
`lib/data/finance.ts`. `getBalance()` is reused, never re-derived — one place sums the ledger.
The menu deliberately points at **four different pages, not four tabs onto `/saldo`**.

**⚠️ The zeros on these pages are HONEST — verified against SQL 2026-07-16.** Do not "fix" them:
- `ledger_entries` holds **only** `pending` (47 rows / 18.436.000) and `available` (209.374.000).
  There is **no withdrawal row and no return row in existence** → `Sudah ditarik` / `Ditarik kembali`
  are genuinely Rp 0.
- `orders.shipping_idr = 0` for **every seeded order** (96/96) → `Ongkir dibayar pembeli` is Rp 0.
  The seed never populated it; real checkout orders do (PHI-202951778F2Y carries Rp 7.000).
- If you want these pages to *demo* well, fix the **seed** — not the page. A finance screen that
  invents a figure is worse than one that doesn't exist, because the merchant will believe it.

### 🔴 RLS has a blind spot: `stores` — and `verify-rls` cannot see it (2026-07-17)

**FIXED, but the CLASS is still open — read before writing any query against `stores`.**

RLS scopes the 36 tables that have a `store_id` column. **`stores` is keyed by `id`, has no
`store_id`, and `relrowsecurity = false`.** `verify-rls` derives the store-scoped set from the catalog
*by looking for a `store_id` column* — so **the one table that identifies the tenant is invisible to
the guard meant to protect tenants.**

Two shipped functions trusted RLS to scope it and silently leaked across tenants (`getStoreProfile`,
`getBilling` — both `.from(schema.stores).limit(1)` with no WHERE, returning an arbitrary row).
`withCurrentTenant` now hands the callback its `storeId`, and both filter explicitly.

**✅ CLOSED 2026-07-17 — the database enforces it now, and the guard can see it.**
- **`0058` puts RLS on `stores`** with an `id = app_current_store_id()` policy (every other table keys
  on `store_id`; here `id` IS the tenant key). Measured: `tokophi_app` + GUC → **1 store**; no GUC →
  **0** (fails closed); **owner → all 7**, which is what keeps `provision` (slug uniqueness — two shops
  would otherwise collide on one subdomain) and the billing cron working. Safe because **no table here
  uses FORCE ROW LEVEL SECURITY**, so the owner always bypasses — asserted in `verify-rls`, not assumed.
  A 13th author writing `.limit(1)` with no WHERE now gets their own store anyway.
- **`verify-rls` asserts `stores` explicitly** (RLS on · tenant sees exactly its own row · no GUC → 0 ·
  owner still sees all). Check 5 derives its list from `store_id` columns and structurally cannot see
  this table, so it is checked by hand.
- **Audited all 13 `.from(schema.stores)` call sites** — the other 11 filter correctly
  (`billing.ts:79`, `profile.ts:18`, `theme.ts:144`, `shipping.ts:94`, `store.ts:10/18`,
  `provision.ts:47`, ongkir/order/pay-callback by slug or id, cron/billing intentionally all-store).

**🔴 AND THE VERIFIER ITSELF HAD THE SAME BUG — fixed, but read the lesson.**
`verify-rls`'s own fixture was `SELECT id, name FROM stores LIMIT 1`. Once the seed grew past one
store it started picking **kopi-senja (0 products)** and comparing an EMPTY store's rows against the
GLOBAL totals — so `RLS VERIFY FAILED` was permanent background noise, and **both cross-tenant leaks
shipped past a verifier that was already red**. An alarm that is always on is an alarm that is off.
The fixture now picks the store that actually has data (most products, tie-broken by slug —
deterministic) and takes ground truth `WHERE store_id = store.id`. **11/11 green.** If you see this go
red, it means something.

- [ ] **Nothing runs `verify-rls` automatically.** It is a manual `npm run verify-rls -w @tokophi/db`,
      which is exactly how it stayed red for weeks unnoticed. It belongs in CI, or at minimum in the
      pre-deploy checklist.

### 🎨 Tema / Puck — one fixed, one real-but-dormant (2026-07-17)

**FIXED — full-bleed matched by PREFIX, so `/tema` ate itself.** `admin-chrome.tsx` had
`FULL_BLEED_PREFIXES = ["/tema"]` + `startsWith`, and `"/tema".startsWith("/tema")` is true: the
template LIST lost sidebar + topbar + billing banner and the seller was stranded with no navigation.
Now `/^\/tema\/[^/]+$/` — the builder only. **If you add a full-bleed route, add a regex, never a
prefix: a prefix always swallows its own index page.**

- [ ] **`puck.css` leaks globally and is never released — REAL, currently harmless, do not forget.**
      `builder-client.tsx` does `import "@measured/puck/puck.css"`. In the App Router a CSS import in
      a client component is global; measured in a real browser, `/tema` loads **2 stylesheets, and 3
      after visiting the builder** — Puck's sheet stays attached after you navigate away, for the rest
      of the session. It does **not** currently break anything (it was my first suspect for the bug
      above and was innocent — `/tema` was broken before any Puck CSS was on the page). It is a loaded
      gun: the day Puck's global resets collide with an admin screen, it will present as "random page
      looks wrong AFTER I visited the theme editor once", which is a horrible bug to chase from a
      screenshot. Fix by scoping Puck's CSS to the builder subtree (or isolating the builder in an
      iframe/route segment that owns its own stylesheet), not by deleting the import.

### 📚 Marketplace IA research — the menu is SETTLED, don't re-litigate it (2026-07-17)

Researched Shopee / Tokopedia / TikTok Shop / Lazada Seller finance menus (sources in the research
transcript; Lazada's labels were unverifiable behind a `tbpass` redirect loop — do not cite them).
Conclusions, so nobody repeats this:

- **✅ NEVER render "Biaya Komisi" / "Biaya Layanan" / "Program Gratis Ongkir", not even as Rp 0.**
  They exist on marketplaces *only because the platform is a counterparty in the sale*. We charge a
  **subscription, not a take rate**. A line reading "Biaya Komisi: Rp 0" is worse than absent — it
  implies we could charge one and sends the merchant hunting for the catch. Same for "Diskon Komisi
  Platform", "Pinjaman Modal / SPinjam", and marketplace ads spend.
- **❌ REJECTED: "collapse Penghasilan into Saldo because TokoΦ has no escrow."** The premise is
  factually wrong about this codebase: `ledger.ts` defines `pending` as *held against orders that
  have not reached `selesai`* — the same order-completion mechanic a marketplace uses, not a
  payment-channel settlement lag. Penghasilan stays a distinct page.
- **❌ REJECTED: promoting Saldo's tabs (Mutasi / Penarikan / Rekening Bank) to nav rows.** The
  research proposed exactly the four tabs `/saldo` already has. The user ruled on this directly:
  *"saldo saya ya isi saldo actual beserta tab di dalaman"*. They stay inside.
- **✅ ACTED: "Tagihan & Langganan" REMOVED from the Keuangan menu (user's call, 2026-07-17).**
  Keuangan = money the shop **earned from shoppers**; Langganan = money the merchant **pays us**.
  Filing our invoice beside their revenue reads as a deduction from earnings — the take-rate model we
  are differentiating against. It also gave `/akun/langganan` a second nav door. The contextual
  cross-link (the "Langganan TokoΦ" card on `/keuangan`) stays.
- **🔁 Watch the faktur inversion.** On Shopee/TikTok, *Pusat Invoice* = the marketplace's invoice
  **to the seller** for fees. Our `/faktur/[number]` is **our** invoice to the merchant for the
  subscription. Same word, different object — do not "align" them.
- **Still genuinely open** (convention we lack, none of it built): withdrawal **auto-payout** toggle,
  ledger **export** + retention (Shopee keeps 24 months), and bank-account **name-match** verification
  against the verified identity (Tokopedia caps at 3 accounts). All are system work, not menu work.

**⚠️ THE SEED IS 15 DAYS STALE — this is why the charts look dead (2026-07-17).**
Last order in the DB is **2026-07-02**; today is **2026-07-17**. The seed is anchored to
`TODAY=2026-06-30` (CLAUDE.md) and wall-clock time has walked past it. Consequences on screen:
- `/keuangan/penghasilan?hari=7` → **completely empty**, correctly.
- 30 hari → only **15 of 30** days have sales; the chart draws a cliff to zero.
- The **"−42% vs 30 hari sebelumnya"** is NOT a business trend — the comparison period has 30 full
  days of data and the current one has 15. The delta is measuring the seed running out.
**Do not "fix" this in the page.** A real shop with no sales in 7 days must see an empty chart; that
is the feature. The fix is the SEED (re-anchor it to `now()`), and `SEED_FORCE=1 npm run seed`
**truncates the shared DB** — announce before running it. Until then the charts are honest about
thin data, and the page says so itself.

**✅ DONE 2026-07-17 — the demo no longer rots: `npm run seed:recent -w @tokophi/db`.**
Additive, idempotent, one store. Fills only days with zero orders, samples real destinations/couriers,
derives the ledger from `payments`. Run it whenever the charts look dead — **never** `SEED_FORCE=1`,
which truncates the shared DB and evicts every other agent. Ongkir/withdrawn/returned are now real.

**Still to build (system):**
- [ ] **`seed.ts` never writes `shipping_idr`** (`subtotal = total`, line ~60). That is the root cause
      of "Ongkir dibayar pembeli Rp 0", and `seed:recent` only fixes it going forward — the 685 old
      orders still carry 0, visible as bars with no ongkir cap before 3 Juli. **Do not backfill them
      naively:** `payments.amount` and the entire ledger derive from `total`, so adding ongkir to old
      rows either breaks `total = subtotal + shipping` or desyncs a Rp 203 juta balance. Fix it in the
      seed (write shipping, include it in total, let payments/ledger follow) — then a full re-seed is
      correct everywhere at once.
- [ ] **Held → released is not a real transition.** `pending` vs `available` is seeded, not earned:
      nothing flips a ledger entry when an order reaches `selesai`. Penghasilan *explains* a rule
      ("ditahan sampai pesanan selesai") that no code currently enforces. Build the transition, or
      the explanation becomes a lie the moment a seller watches an order complete.
- [ ] **Payout scheduling / withdrawal → ledger.** `requestPayout()` exists but writes no
      `withdrawn` row that these pages would read. Wire it, then `Sudah ditarik` stops being 0.
- [ ] **Seed the money paths** — at least one withdrawal, one return, and real `shipping_idr` — so
      the demo exercises the arithmetic instead of rendering three Rp 0 and a −42%.
- [ ] **Ongkir belongs in a margin, not a stat.** Today it is what the shopper paid. The number a
      seller actually wants is *paid − actual courier cost*; we only have the first half until the
      booking flow records what KiriminAja charged. Do not label it "profit" before then.
- [ ] **Biaya & potongan** — Indonesian marketplaces all show a fee breakdown (biaya layanan, biaya
      COD). We charge a subscription, not a take rate, so there is **nothing to show yet**. Left out
      on purpose: an empty "Potongan Rp 0" card invites the question "what fee?" and answers nothing.

---

## 📱 UI/UX mobile & admin — DECIDED IN PRINCIPLE, PARKED (2026-07-16)

> **Status: agreed, not started. Do not build without re-confirming — the last open decision is below.**
> Discussed with the user 2026-07-16. Shipped groundwork is listed at the end; this section is the
> plan for the part that is NOT built.

**The framing that settled it.** "Responsive vs a separate mobile app" is a false choice — UI has three
layers, and the real question is *which layer may differ*:

| Layer | May it differ on mobile? |
|---|---|
| **Navigation / shell** (how you move, what a thumb can reach) | **YES — this is the only layer that should fork** |
| **Screen layout** (table vs cards) | Responsive only — **already done**, see below |
| **Content & logic** (data, rules, actions) | **NEVER** — this is where drift is born |

**A separate mobile UI is rejected**, and this session produced the proof rather than the theory:
`composePickupAddress` existed in two copies and the seller was shown one pickup address while the
courier was handed another — *silently*. That was **one function**. Sixteen modules × two UIs is that
failure mode, industrialised. Also rejected: gestures/swipe (fragile, undiscoverable, expensive) and a
PWA/native shell — the latter only earns its cost if we want **push notifications for new orders**,
which is a genuine argument, but a separate project.

**Why the nav layer alone deserves the fork.** Navigation today is a hamburger at the **top-left** — the
hardest point on a 6.5" screen for a thumb. Every move costs a stretch → a drawer → a scan of 16 items.
Harmless on a desktop; a tax on every step on a phone.

**The seller's actual mobile jobs** (confirmed by the user — *not* my assumption, and the whole design
rests on it): **cek pesanan masuk · proses kirim · cek saldo · balas chat**. Explicitly **not** global
setup — that stays desktop work. A menu to reach everything else must still exist. Note the first two
are the *same screen* (Pesanan), so four jobs = three destinations.

**Proposed shell (below `md` only; desktop untouched):**

| Tab | Why it earns the most expensive space on the screen |
|---|---|
| **Beranda** | Antrian Kerja = "what do I have to do" — the real answer to "cek pesanan masuk" |
| **Pesanan** | where processing + shipping happen. **Badge = new-order count** |
| **Saldo** | money |
| **Obrolan** | **Badge = unread** |
| **Lainnya** | the other 16 menus — opens the **existing** `NavLinks` drawer the hamburger uses today |

**The badges are the point, not the bar.** The #1 job is *"cek"*. If checking requires **opening** a
screen, the design failed. Badges answer it without opening anything. Beranda and Pesanan only look
redundant: **Beranda = check, Pesanan = do.**

Cheap and reversible on purpose: "Lainnya" re-opens the drawer that already exists, so this is a
**relocation, not a rebuild** — zero new screens, zero new logic. The hamburger simply retires below `md`.

**Two traps to handle up front (verify with a screenshot, never assume):**
1. **The bar covers content** — a "Simpan" button or the last table row buried under it. Content needs
   bottom padding equal to the bar height.
2. **iPhone safe area** — without `env(safe-area-inset-bottom)` the bar collides with the home
   indicator. This is exactly what makes a web app feel *not* like an app.

**⚠️ OPEN DECISION — answer before building:** does **Beranda** stay a tab, or does a phone land
straight on **Pesanan** after login (freeing the slot for e.g. Produk)? Not decided.

**⚠️ OPEN SYSTEM QUESTION (raised, not decided):** the Pesanan mobile card intentionally **drops the
`…` dropdown** (Lihat detail / Batalkan) — the whole card is a tap target to the detail page, where the
full actions live. Consequence: **on a phone a seller cannot cancel an order from the list**; desktop
still can. That is a product decision, not CSS. Options: (a) leave it — cancel is destructive and the
detour reduces mis-taps on a small screen (my preference); (b) restore the dropdown for full parity.

**Already shipped (the responsive layer — reusable, adopt as you go):**
- `components/admin/tab-strip.tsx` — `TabStrip`, used by the 4 counted strips (Pesanan/Saldo/Blog/Diskon).
- `components/admin/responsive-table.tsx` — `ResponsiveTable` + `DataCard` + `DataRow`. Real `<Table>`
  from `md` up, cards below. Adopted by **Pesanan** + **Produk** (deliberately different shapes — Produk
  forced the `lead` checkbox slot and an unstyled `title`, which is how you learn a component is reusable
  rather than merely fitted to its first screen). It does **not** auto-convert a table: a good card has a
  hierarchy a table lacks, and only the screen knows which column leads.
- `scripts/audit-responsive.mjs` — `npm run audit:responsive -w @tokophi/admin`. 21 routes × 11 real
  device widths, fails on horizontal overflow. Currently **264/264 clean**; keep it that way.
- ⚠️ **What the audit cannot see:** it proved "nothing scrolls sideways" while Pesanan's tabs were
  rendering *on top of* the toolbar and Produk's price column was off-screen. **Passing it is not the
  same as being usable — look at the screens.**

**Not yet adopted:** the tables on Inventori / Pembelian / Pelanggan / CRM / Ulasan etc. Mechanical work;
the component is proven on two different shapes.

---

## 🧾 Deferred from the 2026-07-16 checkout/storefront polish

- **[ ] 🎨 Two APIs draw the same line, and `shadow-sm` means three different things** (counted
  2026-07-17 while de-carding the storefront; the decoration itself is fixed, this is the token layer
  underneath). Storefront only, checkout excluded — it is its own system.
  - **`ring-1 ring-line` (11 uses) vs `border border-line` (48 uses)** — same colour token, same visual
    result, two different mechanisms, picked per-file at random. Note they are NOT interchangeable:
    `ring` draws outside the box and does not affect layout, `border` occupies space. Any unification
    has to check each site for the 1px shift rather than sed it.
  - **`shadow-sm` currently means "static panel", "static slide" AND "a tile that lifts"** — three
    intents, one value. `rounded-md` (2×) and `shadow-md` (2×) are strays used nowhere else and follow
    no rule.
  - Four radii do the card job (`rounded-2xl` 15×, `rounded-xl` 14×, `rounded-lg` 19×, `rounded-md` 2×).
  - **Decide the rule first, then apply it** (e.g. "ring = non-layout emphasis, border = structural
    divider; one radius per role"). This is a token decision, and doing it as a find-and-replace is how
    you get a 1px reflow on 48 surfaces nobody screenshots.

- **[ ] 🧭 The blog ARTICLE has no breadcrumb and no `BreadcrumbList`** (2026-07-17, deliberate). Every
  other indexable page now has both, from one shared array (`src/lib/breadcrumb.ts`). The article was
  left alone because `blog/[handle].astro` argues explicitly for a **topic chip instead of a trail**
  ("nothing competes with the text"), and adding schema for a Beranda → Jurnal → Title hierarchy the
  shopper cannot see is precisely the drift the shared component was built to end. So it is a design
  decision, not an oversight: **either** give the article a visible trail and then the schema follows,
  **or** accept it forfeits the breadcrumb line Google shows on mobile SERPs for articles. Do not add
  the schema alone.
- **[ ] 🔎 JSON-LD still missing: `Organization`/`WebSite` (home), `BlogPosting` (articles),
  `ItemList` (category)** (audited 2026-07-17). The PDP's `Product` schema is good and — checked —
  **not fabricated**: `aggregateRating` is emitted only when `rating.count > 0`, availability comes
  from real stock, and an `AggregateOffer` appears only when variant prices genuinely differ. Match
  that bar: `BlogPosting` needs a real author + dates (we have them), `ItemList` needs the real product
  list. ⚠️ `sku: product.handle` on the PDP is a substitution, not a real SKU. Sitemap has no `lastmod`
  for products/pages (articles have one).

- **[ ] 🖼️ Images are ~241KB oversized — and the hero needs ART DIRECTION, not a `srcset` width list**
  (measured 2026-07-17, Lighthouse `image-delivery-insight`, mobile, live). Distinct from the
  first-paint waste already fixed in `Hero.astro`. What the numbers actually say:
  - **Hero (144KB of it):** *"larger than it needs to be (869x1080) for its displayed dimensions
    (910x512)"* on all three slides. Note the shape — it is **not** simply "too wide". A **16:9**
    source (1920×1080) rendered into a **390×512 portrait** box via `object-cover` has ~50% of its
    pixels cropped off the sides and thrown away, and at **dpr 3 it is simultaneously UNDER-resolved
    vertically** (needs 1536px tall, has 1080). A width-based `srcset` cannot express that: phones need
    a **differently cropped** image, which is `<picture>` + a media query. Getting this wrong in the
    obvious direction (just serve smaller) makes retina phones blurrier.
  - **Product cards (~97KB):** `451x600` / `600x600` sources rendered at `243x243` and `80x80`. This
    one *is* a plain `srcset`/`sizes` job.
  - ⚠️ **The blocker is the same for both: there is no variant pipeline.** Hero + product images are
    merchant-uploaded (`mediaUrl`, DB-driven), so nothing can be statically optimised at build time —
    generating variants means sharp at runtime, or a resize step at upload, or an image CDN. **Decide
    that before writing any `srcset`**, or it will only ever work for the seeded demo assets in
    `public/` — which is precisely the demo-shaped-assumption trap this repo keeps falling into.
- **[ ] ⚡ Static assets are cached for 4 HOURS — 284KB re-downloaded on every repeat visit**
  (measured 2026-07-17, `cache-insight`). Every `.webp` under `/hero/` and `/products/` comes back with
  `cacheLifetimeMs: 14400000`. These are content-addressed-ish immutable assets that change only on
  deploy; 4h means a shopper who browses today and returns tomorrow re-downloads the entire catalogue
  of images for nothing. Should be ~1y `immutable`, which needs a filename-hash story for the ones that
  can change. Config (Coolify/Traefik/Cloudflare or Astro headers), not code.
- **[ ] ⚡ 2,040ms of render-blocking — and `checkout.css` is loading on the HOMEPAGE**
  (measured 2026-07-17, `render-blocking-insight`). Two parts: the Google Fonts `css2?family=Inter…`
  request blocks for **852ms** (self-host or `preconnect`), and `checkout.SsN-LqBW.css` (11KB) is
  render-blocking **on the homepage**, where no checkout exists. ⚠️ **Verify that second one before
  acting** — if the checkout stylesheet really is on every page, that is a bundling bug worth more than
  the 11KB, and it may mean `CheckoutLayout`'s tokens are leaking into the storefront's cascade.

- **[ ] 🔴 The apex `tokophi.id` serves a 503 — nothing is routed to it** (found 2026-07-17, while
  measuring a11y on live; **pre-existing, not caused by that deploy**). `*.tokophi.id` is fine —
  `batik-nusantara.tokophi.id` returns 200 — and so are `tokophi.com`, `toko.tokophi.com`,
  `app.tokophi.com`. Only the **bare apex** fails, and the response is a 20-byte `text/plain` 503 from
  **Traefik**, not from Astro: no route is bound to that host, so the request never reaches the app.
  Decide what the apex should *be*: sellers live at `<slug>.tokophi.id`, so the apex has no tenant to
  resolve and never will — it should almost certainly **301 to the `tokophi.com` landing** rather than
  answer with a proxy error. Anyone typing the bare domain (or any link that drops the subdomain) hits
  a naked 503 today. Fix is a Coolify/Cloudflare route, not code.

- **[x] Lighthouse `robots-txt` scores 0 — INVESTIGATED, DELIBERATELY NOT FIXED** (2026-07-17). "Unknown
  directive" at `Content-Signal: search=yes,ai-train=no,use=reference`. **It is not our file**:
  `robots.txt.ts` emits 9 lines, live serves 70 — Cloudflare's **Managed robots.txt** prepends a Content
  Signals preamble and an AI-crawler block-list. Two things checked against Google's own spec rather
  than assumed: unknown lines are *"ignored by the robots.txt parser"* (so nothing is invalid —
  `Sitemap:` is itself such an extension), and the two `User-agent: *` groups are **merged**, *"all the
  rules … combined internally into a single group"*, so our `Disallow: /checkout` still applies. The
  only way to pass the audit is switching Managed robots.txt off in Cloudflare, which deletes an
  AI-training opt-out the injected text calls an **express reservation of rights under Art. 4 of EU
  Directive 2019/790**. Not worth 8 points on a linter. Rationale is in `robots.txt.ts` so nobody
  "fixes" it.

Parked deliberately while the checkout page was finished. Each is real, each was measured, and none is
a guess — the evidence is in `CHANGELOG.md` under the same date.

- **[x] `byCollection` reads `collection_products`** (2026-07-16). It inferred membership by
  slugifying a product's category TEXT and hoping it matched the handle; the table the Kategori editor
  writes was never read. Worst case found: **"Promo Gajian" is a MANUAL collection** — the merchant
  hand-picked 8 products and the shop rendered `filter(p => p.compareAt || p.bestseller)` instead, a
  guess overriding their curation on a page advertising a promo. Now 7 render (the 8 minus a draft),
  matching the DB exactly. `promo-gajian`/`produk-terlaris` left `VIRTUAL_COLLECTION_HANDLES` — they
  are real rows and only looked virtual because membership was invisible; `semua` alone remains.
- **[x] Draft products were on the shop** (2026-07-16, found while fixing the above). The catalog
  filtered `!= 'archived'`, and the enum is active|draft|archived — so 2 of the demo's 14 products were
  browsable, openable and cart-able while `/api/public/order` (correctly `= 'active'`) would reject
  them at the end. The shopper filled in name, address, kecamatan and payment to be told the product
  does not exist. `semua` 14 → 12.
- **[ ] `rate.cod` enforcement is committed but NOT exercised end-to-end.** `/api/public/order` now
  rejects a COD order whose live per-destination rate came back `cod:false`. Reviewed and typechecked
  only: proving it needs a KiriminAja quote for a district in an allow-listed province where SPX
  returns `cod:false`, and I did not find one. Until then the guard is untested code on the money path.
- **[ ] The stock decrement targets EVERY `inventory_levels` row for a variant, with no location
  filter** — while the check sums across them. Every variant has exactly 1 row today (96/96 verified),
  so it is correct now; the unique key is `(variant_id, location_id)`, so multi-location is a supported
  shape, and the day a variant has two rows this subtracts the full qty from each. The real question is
  *which location ships*, which is a design decision, not a patch.
- **[x] Kecamatan search is ranked** (2026-07-16). It had **no `order by` at all** — 7.030 districts,
  `limit 8`, whatever Postgres returned: "Semarang" put *Suti Semarang, Kabupaten Bengkayang,
  Kalimantan Barat* first. ⚠️ The obvious fix (exact district first) is ALSO wrong, and only measuring
  showed it: "Bandung" then ranks *Bandung, Kabupaten Tulungagung* — a village — above every district
  of Kota Bandung, because the village is literally named "Bandung" while Kota Bandung's districts are
  "Bandung Kidul", "Bandung Kulon"… Nobody typing "Bandung" means the village. So an exact **city**
  match outranks an exact district match, and `Kota` outranks `Kabupaten` (723 vs 6.307 — the kota are
  where the parcels are). Verified: Semarang/Bandung/Malang/Denpasar all return their own city's
  districts. LIKE wildcards are escaped too — a lone `%` matched all 7.030 rows.
- **[ ] The Store Builder does not validate section links against live targets.** The demo's
  `CategoryNav` linked `/kategori/outerwear` after that collection turned out to be `published=false`
  (fixed in the seed, but only because I knew). `getFooterNav`/`getMainNav` already drop dead links at
  render; the builder should refuse to save them, or warn.

---

## 🔴 The five that matter most

Not the biggest, not the newest — the ones where the product is currently **lying, leaking, or
unmeasurable**. Ordered.

1. **[x] `orders.courier` is recorded at checkout** (2026-07-16). `/api/public/order` now writes
   `courier: rate.code` on the order — the courier of the fresh server-side quote it matched (never the
   client's raw claim; a picked service not in the quote already rejects the order). So the per-courier
   COD return-rate report — the instrument the entire COD policy bets on — is now a `group by courier`
   instead of an impossibility. (Existing rows stay NULL; new checkouts populate it. Full shipment
   booking at checkout is still deferred — `awb`/`kaOrderId` are set when the seller books the pickup.)
2. **[ ] Verify the "SPX free return" claim with KiriminAja, in writing.** The whole SPX-only COD
   policy rests on it and **it is unverified**: free returns are a *Shopee Seller Center* benefit, we
   reach SPX through *KiriminAja* (a different contract), and the KiriminAja API has **no return field
   at all** (`KaRate` = service, service_name, service_type, cost, etd, cod, group). If returns are in
   fact billed through KiriminAja, the rationale collapses and we have restricted COD to one courier
   for nothing. **This is one email — the draft is ready below, just send it.**

   <details><summary>📧 Ready-to-send email to KiriminAja (2026-07-16)</summary>

   > **Kepada:** support / account manager KiriminAja
   > **Subjek:** Konfirmasi kebijakan retur COD untuk layanan SPX
   >
   > Halo tim KiriminAja,
   >
   > Kami mengintegrasikan COD (Cash on Delivery) via API KiriminAja dan ingin mengonfirmasi satu hal
   > soal **paket COD yang ditolak / gagal diantar**:
   >
   > 1. Untuk layanan **SPX (SPX Standard `type=1` dan SPX Economy `type=3`)** — jika penerima menolak
   >    paket COD, apakah **ongkos retur (pengembalian paket ke penjual) GRATIS** bagi penjual, atau
   >    **dibebankan** ke penjual?
   > 2. Apakah kebijakan retur ini **sama** untuk kurir lain yang tersedia di KiriminAja (JNE, J&T,
   >    SiCepat, dll), atau **berbeda per kurir**?
   > 3. Apakah biaya retur (jika ada) muncul di response API `KaRate`, atau ditagih terpisah di dashboard?
   >
   > Kami perlu kepastian tertulis karena ini menentukan kurir mana yang kami izinkan untuk COD.
   >
   > Terima kasih.

   **On the answer:** "retur gratis di SPX, dibebankan di kurir lain" → the SPX-only policy stands as-is.
   "retur dibebankan di SPX juga" → the rationale collapses; open COD to all couriers behind a buyer-paid
   fee pool (`platform_cod.fee_pct`, currently 0 and read by nothing — see the COD-fee item under P1).
   Record the reply verbatim in this file when it arrives.
   </details>
3. **[x] `invitePlatformAdmin` escalation — CLOSED** (verified in code 2026-07-15). Now
   `requirePlatformAdmin("owner")` (was `admin`-gated), `role` is whitelisted against
   `["support","admin","owner"]` (was `input.role || "admin"`, which accepted anything), and it
   audit-logs via `logPlatform`. An `admin` can no longer mint an `owner`. ⚠️ Residual (minor, tracked):
   it still seeds a fixed `DEV_PASSWORD` (`tokophi123`) for the new operator — acceptable only because
   there is no mailer to send an invite; replace with a random token when the mailer lands.
4. **[x] `lib/actions/billing.ts` is gated — CLOSED** (verified in code 2026-07-15). Both
   `createSubscriptionPayment` and `cancelSubscriptionInvoice` now call
   `requireCapability("settings:write", { allowSuspended: true })` as their first statement (was
   `getSession()` alone). `allowSuspended` is deliberate: a suspended store must still be able to pay its
   way back in — refusing that payment would lock a paying merchant out permanently.
5. **[~] Tests for the money/checkout paths — WRITTEN, but the money half does not run by default**
   (2026-07-15/18; re-measured 2026-07-20). **72 tests across 6 files** (was 1 file), and they caught three
   of the deep-audit bugs. But `npm test` reports **52 passed / 20 skipped**: `ledger-credit.test.ts` needs
   `TEST_DATABASE_URL` (a throwaway DB — **never the shared dev DB**) and **skips rather than fails**
   without it. Deliberate and well-documented in the file's own header. ⚠️ Still: the suite guarding the
   ledger is the one least likely to run, and the run says green either way. **There is no CI.**
   - **Pure-logic** (`packages/lib`): `validate.test.ts` (checkout input boundary — phone normalisation
     incl. the no-operator-prefix rule, name/email/address/kodepos/dest_id) + `billing.test.ts` (PPN
     round-trip, promo + annual-bonus quote, the trial→active→past_due→suspended lifecycle).
   - **COD gate** (`apps/admin/lib/cod-policy.test.ts`): the five-condition decision logic was extracted
     from `lib/cod.ts` (DB loader) into a pure `lib/cod-policy.ts` (`buildCodPolicy`, same split as
     `rbac-policy.ts` vs `rbac.ts`) and exercised with fixtures.
   - **Ledger + order state machine** (`apps/admin/lib/ledger-credit.test.ts`): run against a REAL
     throwaway Postgres, each test inside a transaction that is ALWAYS rolled back (full isolation, zero
     pollution — gated on `TEST_DATABASE_URL`; the suite SKIPS without it so plain `vitest run` stays
     green; it is NEVER the shared dev DB — see CLAUDE.md). Covers: a sale is booked only for a collected
     (`berhasil`) payment, at `amount_idr` not `total`, `pending` vs `available` by order status; **the
     "double-credit is a DB impossibility" claim is PROVEN** — a second raw sale insert is rejected by
     `ledger_one_sale_per_payment`; COD collected at the door; release honours `platform_payout.release_on`;
     the `retur` claw-back is an opposing entry that nets to zero, carries the sale's status (a pending
     sale reversed out of pending → available can never go negative), and is idempotent
     (`ledger_one_retur_per_order`). The state machine (`applyOrderStatusChange`, extracted from
     `setOrderStatus` so it is callable — same seam as `settleOrderLedger`) restores stock on **batal AND
     retur**, cannot double-restore (guarded on previous status), and fails a still-pending payment.
   - Setup: `docker exec <db> psql -U tokophi -d postgres -c 'CREATE DATABASE tokophi_test'` →
     `DATABASE_URL=…/tokophi_test npx drizzle-kit migrate` (in `packages/db`) →
     `TEST_DATABASE_URL=…/tokophi_test npx vitest run`. All behaviour-identical refactors; `tsc` clean.


## 🔴 DEV DB ONLY — the migration ledger is 21 behind its own schema (found 2026-07-30, NOT fixed)

`drizzle.__drizzle_migrations` holds **68 rows** (newest `0061_simple_invisible_woman`) against an
**83-entry** journal. Migrations `0062`–`0082` are physically applied — they arrived via `push` or by
hand — but unrecorded, and **6 ledger stamps belong to no journal entry** (branch migrations later
renumbered or dropped).

Consequence: `npm run migrate -w @tokophi/db` — the command AGENTS.md calls canonical — starts at
`0062_order_problem_flag` (`ALTER TABLE orders ADD COLUMN problem_at …`, no `IF NOT EXISTS`) and
**dies**. So nothing in `0062`–`0082` has ever been proven to apply through the migrator on this box,
which is exactly what the production deploy runs.

**The journal itself is clean** — `verify-migrations` is green: idx 0–82 contiguous, stamps strictly
increasing across the concurrent `0079`–`0082`, every entry has its `.sql` and vice versa. This is a
LEDGER problem, not a code one.

Fix (a DB write, so deliberately left for a human to run): insert the 21 missing stamps for what is
already applied and delete the 6 orphans, so the next `migrate` is a no-op — or rebuild the dev DB
from migrations and re-seed. **Announce before doing either; the dev DB is shared.**

---

## 📦 ORDER LIFECYCLE — first audit 2026-07-31; what is LEFT

Closed in `8edef84`: the COD-flag derivation (both directions), the `retur` credit hole, the explicit
transition table, and the `?bayar=` 500. **Confirmed CLEAN with evidence — do not re-audit:** the
double-restore guard, the three partial unique indexes, the derived balance, seven COD-consistency
invariants at zero violations, all five AWB writers, `createShipment`'s failure paths,
`requireCapability` on every mutating action, the CHILD-TABLE RULE on this surface, and the `/pesanan`
tab partition (`0+75+50+656+45 = 826 = count(*)`). What remains:

- [ ] **`createShipment` books a FUZZY-MATCHED destination with no warning.** `o.shipDistrictId ??
  resolveArea(o.city)[0].id` — and the comment above it claims the fallback "is flagged as a guess".
  It is not: `destinationGuessed` **does not exist anywhere in the repo** (grepped). `getShippingRates`
  does label it ("perkiraan dari nama kota") but `bulkGenerateResi` reads only `q.rates` and discards
  the destination string, so the bulk path books a guessed kecamatan with nothing on screen — and the
  COD province gate then resolves the province FROM that guess. SQL: **77 orders** have
  `ship_district_id IS NULL`, 5 of them live. Fix: return the flag and surface it in the toast and in
  `BulkResult`.
- [ ] **`markLabelsPrinted` reports success for rows it never touched** — `return { ok: true, done:
  numbers.length }` regardless of what the UPDATE matched under RLS, and it stamps `label_printed_at`
  on orders with no AWB. Fix: `.returning()` and report the real count.
- [ ] **`createOrderPayment` mints a live VA/QRIS bill for a `batal`/`retur`/`selesai` order** — money
  then arrives for a cancelled order, the callback stamps `financial_status='dibayar'` and fires a
  Purchase conversion, while the ledger correctly refuses to credit. Reuse the `shipmentLocked`
  predicate.
- [ ] **Two definitions of "the order's payment"**: the list orders by `paid_at desc nulls last`, the
  detail by `p.id desc`. On an order with more than one payment row they can name different methods —
  including COD vs VA, the exact fact the booking now hangs on.
- [ ] `getShippingRates` is gated on a session only, not a capability — a `gudang` user can burn live
  KiriminAja quota for any order in their store, unrated-limited.
- [ ] The inventory restore is a **fourth** hand-copy of the default-location-row expression and the
  only one with no tenant-boundary comment — and it is the copy reachable from `ka-tracking.ts`, which
  runs on the OWNER connection where the `locations` join gives no protection. AGENTS.md requires the
  comment.
- [ ] `resi` search does not escape LIKE wildcards (`?q=%` returns the full set). Cosmetic; the same
  bug `areas.ts` already fixed.

---

## 🛡️ SUPER ADMIN — first audit 2026-07-31; what is LEFT

Closed in `aa6cfeb`: the owner-password takeover, the frozen healthcheck clock, and the fixed
`tokophi123` for invited operators. **Confirmed CLEAN:** `requirePlatformAdmin` first in all 27
mutating actions with correct ranks, impersonation owner-only and audited, every destructive per-store
action trailed with `store_id`, and the money re-derived from SQL matching the screen (available
206.376.466 / pending 43.825.981 / GMV 276.825.960 — `store_stats` is genuinely not read). Also
CORRECTED: the long-standing `invitePlatformAdmin` privilege-escalation entry is **already fixed** —
it is owner-gated, role-whitelisted and audit-logged. What remains:

- [ ] **DECISION (owner): the impersonation token is replayable and outlives the operator.** It is
  2 minutes, audience-pinned and store-bound — but NOT single-use, so within that window the URL can
  be replayed or forwarded to mint several sessions, and it rides in a **query string** (proxy logs,
  history, `Referer`). The admin `session` it mints is an independent **7-day** cookie, so an
  impersonation session outlives the operator's own `platform_session` logout. Fix costs a login-flow
  change (single-use `jti`, or cap the minted session well under 7 days) — not decided here.

---

## 🧾 SELLER PROMO SCREENS — audited 2026-07-30; what is LEFT

Fixed in `a6809ad` + the follow-up: the `updateDiscount` interval regression, `nonaktif` in the
editor, the percentage ceiling, the flash-price ceiling, the exhausted-voucher badge, the stale
memos, and the landing-HTML claim. What remains:

- [x] **DECIDED 2026-07-30 — owner-only (`landing:html`).** Raw HTML now needs an owner-only
  capability, enforced only when the html actually changes so staff keep managing the rest of a
  landing. Deliberately NOT a regex sanitizer — a partial strip would restore the false confidence
  the old caption provided. A real sanitizer or a storefront CSP remains open, separately.
  ~~DECISION (owner): `/lp/<slug>` executes merchant-pasted `<script>`.~~ `set:html` emits into the
  SSR response body, so the browser PARSES it — a script tag runs. There is no sanitizer and no CSP.
  The write needs only `content:write`, which **`staff` holds in every tenant**, and the page carries
  the COD order form (name, WhatsApp, address). The false "tidak dijalankan" claim is corrected in
  both the admin caption and the storefront comment, so nothing lies any more — but the exposure is
  real. Options: narrow the capability to owner, add a real sanitizer (NOT a regex — a half-sanitizer
  restores exactly the false confidence just removed), or accept it explicitly. **Not decided here.**
- [ ] **`discounts.code` is unique ACROSS EVERY TENANT** (`discounts_code_unique` on `code` alone,
  no `store_id`). The first merchant to register `GAJIAN25` permanently blocks all other stores, which
  also makes the constraint an existence oracle over other tenants' codes — and Indonesian promo codes
  collide constantly (`GAJIAN`, `DISKON10`, `GRATISONGKIR`). Fix is `unique().on(storeId, code)` plus a
  migration; reads are already store-scoped so nothing else changes. Left out of this round because a
  unique-constraint migration wants the ledger drift resolved first.
- [ ] **"Estimasi Penghematan Pelanggan" is Rp90,3jt of fiction.** `diskon-client.tsx` multiplies
  `used_count` by a hardcoded `AVG_ORDER = 200.000`. `select sum(discount_idr) from orders` for the
  demo returns **0**, over 0 discounted orders. The real number is one query away (`orders.discount_idr`
  + `discount_usages`). Same class `lib/data/marketing.ts` was cleaned for. Fix or delete the tile.
- [ ] **`flash-sale-client.tsx` calls `Date.now()` in a render path** to decide "Terjadwal" vs
  "Berakhir" — the MERCHANT'S LAPTOP clock, which nothing disciplines, and a latent hydration mismatch
  (a direct violation of the determinism rule in AGENTS.md). Pass the booleans down from the server,
  which already computes them. (The app-container-vs-Postgres skew the earlier note worried about is
  structurally zero — same host, same kernel clock — so this is the clock that actually diverges.)
- [ ] **The flash editor's `pct` is computed against the position-0 variant** while the sale price is
  one flat number applied per variant with `min()`. On a multi-price product the merchant is shown a
  discount that applies to one variant and never sees the real one. Show the variant range and compute
  against the MAX. (No multi-price product exists yet — `having min(price) <> max(price)` → 0 rows.)
- [ ] **Three promo detail routes 500 on a malformed id** (`promo/html/[id]`, `diskon/[id]`,
  `flash-sale/[id]`) — the raw segment reaches `eq(x.id, id)` → `invalid input syntax for type uuid`.
  `/promo/[id]` guards with a UUID regex and documents why; lift it into a shared helper.
- [ ] **`actions/flash.ts` throws plain `Error` for user-facing rules**, which Next MASKS in production
  — so the merchant sees a digest, not the reason. `theme.ts` was converted to `{ok, error}` for
  exactly this; flash/promo/landing still throw. Convert the file.
- [ ] Smaller: an unlimited voucher renders "342 / 0" with a 0% bar; "Nonaktifkan" in the row menu is
  still disabled on a reason that is no longer true (the list status IS from the DB column now); the
  landing slug hint keeps showing the un-slugified text after save; `PromoHubCard` never calls
  `router.refresh()`, so Simpan stays enabled after a successful save; `lib/data/flash.ts` counts
  `flash_sale_items` through a join whose comment talks about query count, not tenancy (the
  CHILD-TABLE RULE wants the comment to name it as the boundary).

---

## 🏷️ FLASH SALE — audited end to end 2026-07-30; these are what is LEFT

The rule itself is sound: `min(variantPrice, flashPrice)` at all five sites, idempotent where applied
twice, no percentage anywhere, identical window predicate in both readers. Fixed in `2ee191c` +
`273b81d`: the PDP price trio, JSON-LD capping + `priceValidUntil`, the expired-tab reload, the
funnel's per-variant struck price, the sold-out card. What remains:

- [ ] **DECISION (owner, not a bug): a repriced cart is accepted silently.** `/api/public/order`
  re-prices from the live window and ignores `items[].price`. If a flash lapses between add-to-cart
  and Bayar, the shopper is charged MORE than the page quoted. `273b81d` makes them SEE the true
  number on the success page; it does not decide whether they should be STOPPED. The house pattern
  for the equivalent case exists — a shipping service missing from a fresh quote is REJECTED, never
  silently substituted — so refusing with "harga berubah, muat ulang keranjang" (409) would be
  consistent. Refuse-vs-accept costs a sale either way; it is a product call.
- [ ] **DECISION: a flash sale erases the merchant's own `compare_at_idr` from every surface.** The
  struck price becomes the pre-sale SELLING price (the defensible base — the blazer shows −32% off
  219.000, not −48% off its 289.000 list). Consequence: Google sees `g:price` drop 289.000 → 219.000
  when a sale starts and rise when it ends. Deliberate-looking, undocumented, worth a ruling.
- [ ] **Overlapping sales race the wrong clock.** `catalog.ts` keeps the lowest-priced row and takes
  THAT row's `endsAt`. If the cheaper sale ends first while a second, still-discounting sale runs on,
  the countdown hits zero and the banner vanishes while the product is still on sale. Fix: carry the
  latest window that still contains the winning price.
- [ ] **The seller's flash screens anchor on variant 0 and on the app clock.** `flash-editor.tsx`
  computes `pct` against the position-0 variant's price, so on a multi-price product the merchant is
  shown a discount that applies to one variant; `data/flash.ts` `isLive` uses Node `Date.now()` while
  both pricing readers use Postgres `now()` — container clock drift makes the badge and the till
  disagree.
- [ ] **Staleness windows, for the record:** the order API flips instantly (uncached, DB clock); every
  SSR surface is stale up to the 15 s catalog memo; the feed adds `Cache-Control: max-age=3600` on top
  (mitigated by `sale_price_effective_date`); `localStorage.cart` is stale indefinitely.
- [ ] **No demo product is both flash-priced and multi-variant** — all four flash products have zero
  `product_options`, and no product in the store has variants at differing prices. That is why this
  whole class survived: it is unreachable by clicking around the demo. Worth seeding one.

---

## 🆕 Opened 2026-07-30 — audited, NOT fixed

Four parallel audits over the storefront + `/tema` + `/promo` produced ~80 findings; that session
fixed the money paths and the Store Builder's page-type problem and left these. Every one was
confirmed by reading the code, running SQL, or driving a real browser — none is speculative.

### Security — ✅ ALL THREE CLOSED 2026-07-30 (`20ca7cc`)
- [x] **The link picker accepts `javascript:`** — closed by `safeHref()` at the five render sites (+ 6 hostile-input tests). (`components/theme/link-picker.tsx:160` — `pick()` with
  no scheme check; `saveTemplate` validates nothing) and it reaches four unsanitised storefront render
  sites: `Hero.astro:168`, `RichText.astro:55`, `ImageText.astro:63`, `BannerPromo.astro:14`,
  `CategoryNav.astro:69`. Owner/admin-only today, so it is self-XSS on the merchant's own shop — but
  it is already a stored-XSS vector against that store's shoppers. Fix: one shared `safeHref()` at the
  render sites (allow `/ # http: https: mailto: tel:`), not in the picker — the picker is UX.
- [x] **SVG upload is stored XSS on the admin origin.** — closed: `sandbox; default-src 'none'` on the SVG branch, `nosniff` on every response; verified against a running admin. `lib/image-store.ts:139` only checks
  `type.startsWith("image/")`, `saveImage` writes SVG byte-for-byte, and
  `app/api/uploads/[name]/route.ts:11` serves it as `image/svg+xml`, `immutable`, **no
  `Content-Disposition`, no CSP sandbox, no auth**. `media:write` is held by `staff` in every tenant,
  so any store's staff can host a payload on `app.tokophi.com` and send the link to another owner.
  Fix: `Content-Security-Policy: sandbox; default-src 'none'` + `X-Content-Type-Options: nosniff` on
  the SVG branch.
- [x] **`saveTemplate` writes unvalidated client JSON into jsonb** — closed: shape check at the boundary, plus renderer fallbacks (`MODE_FN[mode] ?? bestsellers`, `Array.isArray(slides)`) so a bad row degrades instead of 500-ing. (`lib/actions/theme.ts:165`). The
  repo already documented the consequence in `seed-templates.ts`: a typo'd `mode` makes
  `MODE_FN[mode](pool)` throw and **500s the whole storefront** — but the guard was added to the seed,
  not to the write path. Fix: validate `data.content[]` against `SectionConfigMap` before the update,
  plus a `?? bestsellers` fallback in `ProductGrid.astro:26`.

### `/promo` money path
- [ ] **`OrderFunnel` quotes a total the server does not charge** (`OrderFunnel.astro:234,236` =
  `goods + shipping`, full stop) while `/api/public/order` applies automatic free shipping and PPN.
  Live right now: `free_ship_enabled = t, free_ship_min_idr = 300000` on batik-nusantara.
- [ ] **`buildPackages` ignores the live flash price** (`lib/packages.ts:10`) — the landing sells at
  full price, the order charges the sale price, and the COD cash the courier collects differs from the
  number on the button.
- [ ] **`/thanks` prints arithmetic that does not add up** — "Subtotal 300.000 + Ongkir 23.000 →
  Total 300.000". Have the order API return `discount` and render "Gratis".
- [ ] `min_purchase_idr` is enforced server-side but has **no field in the editor**. Per-customer
  limit and product/collection eligibility are **not implemented at all** (no columns) — file them,
  do not fake them.

### ✅ CLOSED 2026-07-30 (`2cdc07d`) — re-verified against a running server, then fixed
- [x] **Testimoni's prev/next arrows were dead** — `closest("div")` includes the element itself, so the
  lookup returned the nav and missed the track (proven in Chromium: `scrollLeft` 0 before and after a
  click). Track also got `tabindex`/`role`, so testimonials 2..N are keyboard-reachable.
- [x] **`ProductCard`'s `level` prop was passed by none of its ten call sites** — every listing went
  `h1 → h3`, measured in the AX tree. Fixed at the shared listing.
- [x] **The sort control had no accessible name below 640px** (its only label is `hidden sm:inline`).
- [x] **`<title>` separator** `" — "` → the house `" - "`, all three layouts.
- [x] **`CategoryNav` could 500 a page** — `items.length` on an undefined prop; the one section left
  without the `?? []` its four siblings have.
- [x] **No preconnect to the uploads origin** — photos, logo and favicon all come from the admin app.
- [x] **NEW, and the two biggest: `mediaUrl()` was missing on paths the demo never exercises.** Every
  merchant image uploaded in the Store Builder 404'd on their own shop (six section render sites), and
  every social share of `/`, `/produk`, `/kontak`, `/halaman/*` carried a broken `og:image`. The
  **footer logo** was raw too — not in the audit, found by counting un-rewritten paths afterwards.

### Storefront honesty / correctness — STILL OPEN (re-verified 2026-07-30, all measured)
- [ ] **The trust strip advertises "QRIS & E-Wallet"** (`index.astro:111`) while all five
  `kind='ewallet'` rows are `enabled=f, active=f`. The COD badge two lines above **is** data-gated.
- [ ] **Category-Nav defaults publish three verified 404s** on every non-demo store
  (`registry.ts:417` → `/kategori/dress|atasan|bawahan`). Seed `items: []` and fall back to the
  store's live collections, as CollectionBento already does.
- [x] (closed — see above) ~~Testimoni's prev/next arrows are dead~~ (`Testimoni.astro:67` — `closest("div")` matches the
  nav itself, so the track is never found; proven in Chromium). The track is also unreachable by
  keyboard (no `tabindex`).
- [ ] The image-less hero renders **near-black**: the photo scrims are applied unconditionally over
  the brand gradient (`Hero.astro:122,125`).
- [ ] `SectionRenderer` has **no error boundary** — one bad section value 500s the page.

### The responsive gate itself is fragile (found 2026-07-30)
- [ ] `npm run audit:responsive` **takes ~23 minutes and prints nothing until the end**, so it reads as
  hung. Measured cause: 132 navigations × `waitUntil: "networkidle"` at ~7.9 s each vs ~4.3 s for
  `domcontentloaded`. The assertion is a LAYOUT measurement, not a network one — dropping to
  `domcontentloaded` + a short settle roughly halves it without weakening the check.
- [ ] **Its redirect-following preamble no longer does what its comment says.** It expects
  `GET /produk` to answer `301 → the primary domain`; `middleware.ts` explicitly skips that redirect
  for localhost, so with no `STORE_SLUG` the script dies at "server dev jalan?" on a plain 404. It only
  runs at all if you export `STORE_SLUG`. Document the env or fall back to a `Host` header — the
  script's own comment warns that "the storefront went weeks with its responsive gate face-down", and
  it is face-down again for a new reason.
- Last real run: `OK — 132 route×width combinations, no horizontal overflow.`

### SEO / a11y / performance
- [x] (closed — see above) ~~`<title>` separator~~ (`Layout.astro:38`, every page).
- [ ] Canonical **drops `?page`** (`Layout.astro:52`), so page 2 canonicalises to page 1.
- [ ] **3 × `<h1>`** on the homepage (one per hero slide); a builder homepage with no Hero has **none**.
- [ ] **Zero JSON-LD on the homepage** — no Organization, no WebSite/SearchAction (`/cari` exists).
- [ ] The **LCP hero image bypasses `imageSrcSet()`** (`Hero.astro:77`) — full-size original to a
  320px phone. Same for the category cover (`CategoryHero.astro:36`).
- [ ] **Render-blocking Google Fonts** — MEASURED on a dev server, throttled 1.6 Mbps / 150 ms at 390px:
  as-shipped `CLS 0.358`, fonts blocked `CLS 0.182`. Every shift entry named the same node — the hero
  copy container reflowing when Inter swaps under `text-balance`. Self-host the two woff2 with
  `font-display: swap` + preload, or add a `size-adjust` fallback. ⚠️ Dev-server numbers: treat the
  DELTA as the signal; the prod-build measurement has not been taken.
- [ ] **Header logo has no `width`/`height`** (the footer's does). `media.width/height` is already
  recorded at upload. Mechanism is clear; the shift was not observed (the logo 404'd during the audit),
  so do not hardcode a ratio the way `CategoryHero` does — read the real one.
- [x] (closed) ~~no preconnect to the uploads origin~~
- [x] (closed — see above) ~~`ProductCard` exposes a `level` prop~~ so a card under a page `<h1>` becomes `<h2>` — **no call
  site passes it**, so every listing goes `h1 → h3`.
- [x] (closed — see above) ~~The sort control has no accessible name below 640px~~ (`ProductListing.astro:135`).

### `/tema` remaining
- [ ] **No draft/published boundary and no autosave** — `page_templates` has no draft column, the
  builder wires only `onPublish`, and "Kembali ke Daftar Template" sits next to Publish and discards
  every unsaved edit with no confirm.
- [ ] The **Hero trust strip (`features`) is rendered but has no field** in the builder.
- [ ] Image picker says "maks 5MB"; the server rejects at 2MB (`image-store.ts:31`).
- [ ] Image picker gates upload on `theme:write`; the action requires `media:write`.
- [ ] `saveBrandColor` / `saveProductGalleryLayout` validate input **before** `requireCapability`.
- [ ] Builder chrome is English (Puck's own "Publish"/"Components"/"Outline") inside an Indonesian admin.
- [ ] The builder canvas cannot show the merchant's brand colour — `globals.css` pins the platform rose.

### `feat/meta-integration` (belongs to whoever owns that branch)
- [ ] `crypto.ts`: the AES key is an **unsalted single-round SHA-256** of a passphrase (passwords in
  this repo get salted scrypt); no AAD, so a ciphertext is **portable between tenants**; a missing key
  is swallowed as "no token" and the UI still reports "tersimpan"; the documented rotation story does
  not exist; `INTEGRATION_TOKEN_KEY` is in no env example, so every CAPI save fails in production.
- [ ] `/pemasaran` has **no read gate** — a `gudang` role can read the store's pixel IDs.
- [ ] Google advanced matching sends **raw email/phone** while Meta/TikTok send SHA-256, and the UI
  tells the merchant it is hashed.
- [ ] `InitiateCheckout` + `Purchase` never fire: `CheckoutLayout.astro` renders `<Analytics />` but
  not `<MarketingPixels />`.
- [ ] A stored CAPI token **cannot be deleted** from the UI, and nothing sends CAPI events at all.

---

## P0 — Foundation

- [x] **Backend** — local PostgreSQL 16 + Drizzle (`@tokophi/db`): **70 tables, 62 migrations
  (`0000`–`0061`), RLS on 46** (re-counted 2026-07-20; this line said 51/`0050`/45). All four surfaces read; all admin editors write; local auth (jose JWT) +
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

- [x] **`invitePlatformAdmin` escalation — CLOSED** (2026-07-15) — see the top-five list.
- [x] **`billing.ts` capability gate — CLOSED** (2026-07-15) — see the top-five list.
- [x] **Super-admin audit gaps — CLOSED** (2026-07-15). All the previously-silent privileged mutations
  now write to `platform_activity`: `setInvoiceStatus` (**money** — a manual "dibayar" is `logStore`d),
  `setStoreUserRole` (privilege change — logs the user + new role), `saveGateways` + `saveCodAllowed`
  (**platform payment / COD risk policy** — `logPlatform`d with the diff), and `createStore`. Joins
  `invitePlatformAdmin` (logged 2026-07-15) and the add/remove/reset user actions that already logged.
  `tsc` clean. An unlogged privileged mutation is indistinguishable from an attack; there are none left
  among the store-lifecycle / billing / settings actions.
- [ ] **The `support` platform role is unreachable** — **zero** actions accept it, including the ticket
  actions its own doc comment says it exists for. Either wire it or delete it.
- [ ] **Platform role checks are action-only** — the middleware and page guards check for *a* session,
  not a role, so a lower-privileged operator sees every screen and the buttons throw on click.
- [ ] **`/api/public/*` runs on the owner connection, outside RLS** — **the single largest RLS hole, on
  the most security-sensitive path in the system.** Tenant correctness at checkout rests on application
  code passing an explicit `store_id`. Options: a `store_id`-scoped read role for the public path, or an
  explicit, documented acceptance. Not a silent one.
- [x] **`POST /api/public/pay` deleted** (2026-07-16) — it was an unauthenticated route that took the
  `amount` FROM THE BODY and created a real VA/QRIS bill via AutoLaris, called by **nothing** (no
  storefront source read `PUBLIC_PAY_API`; the real flow creates the payment server-side inside
  `/api/public/order` with the server-computed amount). Removed the route file and the dangling
  `PUBLIC_PAY_API` from `.env.example`. **`/api/public/pay/callback` (the live AutoLaris callback) is
  untouched** — different route, still needed.
- [ ] **All rate limits are in-process** — they do not survive a restart and do not hold across replicas.
  `/api/track` in particular has no proof-of-work, signature or session check: a distributed script with
  a browser UA can inflate a store's funnel. Move to the Cloudflare edge.
- [x] **`AUTH_SECRET` insecure fallback is now impossible in production** (2026-07-16). A shared
  `@tokophi/lib/secret` (`authSecret()` / `authSecretBytes()`, zero-dep so it is edge-safe) resolves the
  key and **fails CLOSED**: in production a missing/short `AUTH_SECRET` **throws**; only in development
  does it return the well-known dev string. Wired into all 8 sites across the three apps (admin +
  super-admin middleware/auth/session/impersonate, storefront chat + recovery). The throw is **lazy** —
  it fires when the key is first used at runtime, never at module load — so `next build`/`astro build`
  (which run with `NODE_ENV=production` but WITHOUT the runtime `AUTH_SECRET`) still build (proven: an
  import-only load does not throw). Prod already sets a 64-char `AUTH_SECRET`, so runtime behaviour is
  unchanged; this only removes the silent forgeable-key path.
- [x] **Login rate limit on both panels** (2026-07-16) — `signIn` in `apps/admin/lib/actions/auth.ts`
  (15/min per IP) and `apps/super-admin/lib/actions/auth.ts` (10/min — the control plane, kept tighter)
  cap attempts by client IP (`cf-connecting-ip` → `x-forwarded-for`) via `@tokophi/lib/cache` `rateLimit`,
  BEFORE the scrypt password check. ⚠️ In-process — does not survive a restart or span replicas (the same
  known limitation as every rate limit here; Cloudflare-edge move still tracked below) — but far better
  than the previous NONE, and generous enough not to lock out a NAT'd office.
- [ ] **`platform_activity` has a `store_id` and no RLS.** Deliberate (it is our log *about* tenants), but
  it deserves a written decision + a comment, not a silent whitelist entry.

---

## P1 — Honesty debt

- [x] **The storefront `/blog` reads the DB** (2026-07-14). `src/data/content.ts` (`getArticles`/`getArticle`,
  per-tenant, short-TTL) + Medium-shaped `/blog/[handle]` + `/halaman/[handle]`. Every query hard-filters
  `status='terbit'` so a draft **404s** (proven). The hardcoded 4-article array is deleted; the merchant's
  Blog/Halaman editors now reach a shopper. (6 articles + 6 pages were `terbit` and unreachable before.)
- [x] **Per-store WhatsApp + tagline** (2026-07-15). Migration `0049` added `stores.whatsapp`/`tagline`
  (nullable). `DEFAULT_WHATSAPP = "6281234567890"` is **removed** — a store with no number renders **no**
  WhatsApp button (honest) rather than a shared dummy. The merchant sets both in admin → Pengaturan → Profil
  (`StoreProfileCard` + `saveStoreProfile`, normalises `08…`/`+62…` → `62…`). Merged + deployed + validated
  full-circle in a browser. **Email is still shared** — no per-store email column, and no mailer to use it,
  so it is not a live gap; deferred with the mailer.
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
- [x] **Stale source comments fixed** (2026-07-16) — `lib/data/analytics.ts`, `lib/data/funnel.ts` and
  `schema.ts` all claimed `analytics_events` had no writer and the tracker was "still to come". It has
  been written by `apps/storefront/src/pages/api/track.ts` since `b7ae0ff` (47k+ rows locally); the
  comments now say so. Comment-only, no runtime change.

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
- [~] **Custom domain for a merchant** — 📄 spec ([`CUSTOM_DOMAIN.md`](./CUSTOM_DOMAIN.md)); **slices 1–3 BUILT + deployed
  2026-07-15**, slice 4 (Cloudflare-for-SaaS cert issuance → `active`) blocked on the user (cost + a CNAME-target domain).
  **Built:** migration `0050` `store_domains` + RLS; `slugFromCustomDomain()` resolves an `active` host to a slug;
  `StoreInfo.primaryHost` + `primaryOrigin()` route canonical/`og:url`/sitemap to the primary; admin UI `DomainCard`
  (Pengaturan → Domain) adds a domain and **TXT-verifies ownership for real** (`node:dns` `resolveTxt`), showing copyable
  CNAME+TXT records. **HONEST GAP kept visible:** a verified domain rests at `provisioning` and the UI does NOT let the
  merchant flip it to `active` — a shopper is only served once a TLS cert exists, which is slice 4. Original design notes:
  `store_domains` table (a domain is a *process*, not a value — apex+www, states pending→active→error);
  **301** to the primary host, not `rel=canonical` (a canonical is a hint, a 301 is a directive) — GET/HEAD only,
  never `/api/*` (a 301 on POST drops the body → kills the checkout beacons); **Cloudflare for SaaS** over
  Traefik+LE (HTTP-01 needs the CNAME target grey-clouded, which publishes the origin IP); **TXT verification**
  before we serve anything (skip it and someone CNAMEs `bank-example.com` at us → TLS-valid phish under our name).
  Two seams already landed: `slugFromCustomDomain()` (now a real `store_domains` resolver) and **`primaryOrigin()`** in
  `apps/storefront/src/data/store.ts` — every canonical/og:url/sitemap already flows through it, so switching the
  subdomain→custom-domain primary is a one-line change. ⚠️ **Migration slot: `0050`** (spec says `0049`, taken by
  whatsapp/tagline). Riskiest UNVERIFIED thing: what SNI/Host Cloudflare presents to our origin for a custom
  hostname, given the zone is Full(strict) and the origin only has the `*.tokophi.com` Origin CA cert — needs a
  30-min throwaway-domain experiment before slice 4. **Slice 1 (pickup-ready):** migration `0050` + `store_domains`
  + RLS + `slugFromCustomDomain()` body + `StoreInfo.primaryHost` — verifiable with `curl -H 'Host: …'`, no DNS/CF/cost.
- [~] **Payment gateway — AutoLaris VA/QRIS** works end-to-end (6 channels live: QRIS + 5 VA, filtered on
  `enabled AND active` = we offer it AND the gateway accepts it on a live probe; e-wallets/retail refused by
  the vendor, so not rendered). Callback is idempotent. ⚠️ **ONE gap, BLOCKED ON THE VENDOR:** the callback
  (`apps/admin/app/api/public/pay/callback/route.ts`) authenticates with an **interim shared secret**
  (`X-Callback-Token`), NOT the real AutoLaris HMAC signature — the code says so and points at PROD_PLAN §7.
  Cannot be built until AutoLaris confirms the signing spec. Until then a leaked token = a forged
  "paid" callback. And `KIRIMINAJA_ENV`/the AutoLaris env default to **sandbox** — real tariffs are one env flip away.
- [x] **Custom-domain admin UI** (2026-07-15) — `DomainCard` in Pengaturan → Domain (`settings:write`, RLS via
  `withTenant`): states belum diverifikasi → menunggu DNS → menunggu aktivasi (provisioning) → aktif → error,
  copyable CNAME+TXT records, Bahasa Indonesia copy. `addDomain`/`verifyDomain`/`setPrimaryDomain`/`removeDomain`
  in `lib/actions/domain.ts`; reads via `listDomains()` (server action, so the client never imports `server-only`).
- [ ] **`product-detail` section** — a product template currently replaces only the *tail* of the PDP; the
  buy box is always kept, because no registry section can render it and a full replace would ship
  unbuyable product pages.
- [ ] **De-dup `apps/admin` onto `@tokophi/ui` + `@tokophi/lib`** and delete its local `components/ui` +
  `lib/format`. Super-admin already consumes the shared packages.
- [ ] **Diskon edit route** `/diskon/[id]` (create-only dialog today).
- [ ] Tiptap rich text (textarea + a decorative toolbar today) · video slot · MinIO/S3.

---

## ✅ P2.0 — Checkout input validation + the client-priced ongkir (DONE 2026-07-14)
> The rest of the theme: **the checkout trusted the browser**. Origin (fixed), COD province (fixed), weight (fixed) — and then the two that were still open: the ongkir **price** and every **typed field**.

**Done — `/api/public/order` is now the boundary, in full:**
- [x] **The ongkir is RE-QUOTED server-side.** `shipping.cost` from the body is not read at all (the field is gone from the storefront payload). `lib/shipping-quote.ts` is now the ONE function that produces a price — `/api/public/ongkir` and the order API call the same code (same origin, same DB weight, same platform∩store service scope) and the order stores **the price the server computed for the service the shopper picked**. A service that is not in the fresh quote → the order is **rejected**, never silently re-couriered. Posting `shipping:{cost:0}` now writes the real Rp13.700.
- [x] **…and the item prices too.** Same hole, bigger: `items[].price` was summed straight into `orders.subtotal_idr` + the line items, so `price: 0` bought the goods for nothing. Prices, titles and the variant now come from `product_variants`; an unknown/archived handle is refused.
- [x] **WhatsApp normalised, not rejected** (`@tokophi/lib/validate` `normalizePhone`): `0812…` / `812…` / `+62 812-…` / `62 812…` → **`62xxxxxxxxx`**. Structure only (after `62` it starts with `8`, national part 9–12 digits) — **no operator-prefix table**, which would one day refuse a real customer on a new prefix. Normalised on write from every path (checkout API, abandoned-cart capture, chat, seller pickup phone) and **backfilled** (migration `0048`: customers 26/26, orders 687/687, plus leads/followups/wa_messages/chat_visitors/customer_addresses). `waLink()` normalises too — `wa.me/08…` never opened a chat.
- [x] **Email: shape only, optional, NO domain whitelist** (there is no mailer; a gmail/yahoo allow-list would reject corporate/university/self-hosted buyers).
- [x] **Nama:** letters (incl. diacritics), spaces, `.`, `'`, `-` — `Nur'aini`, `M. Rizky`, `Siti binti Abdullah` all pass; digits/symbols are refused.
- [x] **Alamat:** letters AND digits (RT/RW and house numbers are the point) + ordinary punctuation; only junk is refused (emoji, control chars, one repeated character, < 10 chars).
- [x] **Kecamatan: no character rule.** The real check is that the `dest_id` **resolves in `kiriminaja_areas`** — that is what the parcel is booked against. Kota + Provinsi are now **derived from it** and the typed values are ignored (they were a claim; the COD gate already refused to trust them).
- [x] **Kode pos:** 5 digits, optional (still typeable for the ~4% of districts with no kelurahan data).
- [x] Client-side copies of the rules live in `checkout.astro` **for early feedback only** — the API re-normalises and re-validates everything.

**The rule to keep:** *over-validation is itself a bug.* A rejected legitimate name / new carrier prefix / unusual address costs a sale and nobody ever finds out. **Normalise generously, reject narrowly.**

## ✅ P1.9 — Shipping weight comes from the DB, not the browser (DONE 2026-07-14/16)
> **The bug (found 2026-07-14 by the user: "Mampang, Jakarta Selatan → SPX Standard Rp40rb"):** `checkout.astro` prices every parcel with **`weight: totalQty * 500`** — a fabricated 500 g per item. The real column `product_variants.weight_grams` exists and the Seller's product editor has always had a required "Berat (gram)" field — it was simply **NULL on all 96 variants**, so nobody noticed the checkout never read it.
>
> Measured on the live API (Surabaya → Mampang Prapatan, SPX Standard): 3.000 g → **Rp41.100** (what the user saw) · 1.500 g → Rp27.400 · **675 g (3 items at their REAL ~225 g) → Rp13.700**. Shoppers were being quoted **3× the true postage** — a silent conversion killer for an apparel store, and nobody would ever know why the carts were abandoned.
>
> ✅ **Done already:** weights backfilled (96 variants, 150–300 g, stable per-id; prod + local), dims set to 1×1×1 (volumetric negligible → the courier bills the ACTUAL weight, correct for apparel), and `seed.ts` now seeds weight deterministically (mulberry32 — never `Math.random()`).
>
> ❌ **Still open — and this is the important half:** the checkout still sends the weight **from the browser**. Filling the data is not enough if the client is still the one doing the arithmetic. **Weight is a price input, so it must be computed server-side**, exactly like the ongkir ORIGIN (now read from the seller's pickup address, not a client-posted city) and the COD PROVINCE (now read from the KiriminAja district id, not the buyer's typed text). Same lesson, third time: **a claim from the client is not a fact.** A script posting `weight: 100` for a 5 kg parcel gets the cheap quote and the **merchant eats the difference with the courier**.

- [x] `/api/public/ongkir` `op=rates` accepts `items: [{variantId, qty}]` and **sums
  `product_variants.weight_grams` itself** (`lib/shipping-weight.ts` `weightForCart`, shared by ongkir +
  the order re-quote via `shipping-quote.ts`); `body.weight` is not read at all and `checkout.astro` no
  longer sends it. Committed `1234dcc`.
- [x] Variants with a NULL weight → 500 g fallback **and a warning on the Seller's Produk list** (2026-07-16):
  `getProducts` flags each product with `bool_or(weight_grams is null)`; `produk-client.tsx` shows an amber
  **"Berat belum diisi"** on those rows/cards (grid + table). The fallback is now visible, not silent.
- [~] Weight required for new products — the editor already marks "Berat (gram)" required (the `*`) and the
  list now warns on the missing ones; a HARD server reject on save is deliberately NOT added (it would
  refuse legacy/CSV imports — same "over-validation is a bug" rule). The warning is the honest surfacing.

## 🟡 P1.8 — Healthcheck & watchdog (L1 + L1b BUILT + LIVE; L2/L3/alerts still open)
> **Why this is here:** on 2026-07-14 production went down **three times** and every deploy failed **silently for an hour** — and *every single one* was found only because someone happened to look. Nothing told us. That is the gap: not the bugs, the **absence of a witness**.
>
> **The FOUR failure shapes seen (design against these, not against a generic "is it up?"):**
> 1. **Containers created but never started.** Coolify built `admin`/`super-admin`/`storefront`, left them in `created` (exit 0, no logs, disk fine), and moved on. The site 503'd; `landing` stayed up (it has no deps — that design held). Recovery was a plain `docker start`.
> 2. **Deploy failing while the API answers "queued".** `npm ci` refused to run (lockfile out of sync — `playwright` in `package.json`, absent from the lock), so **every** build died at `RUN npm ci` for an hour. `POST /api/v1/deploy` kept returning `deployment queued`. Coolify's own `application_deployment_queues` table said `failed` the whole time — nobody was reading it.
> 3. **A migration that never applied.** The journal referenced `0046_good_dust` whose `.sql` was never committed → `drizzle-kit migrate` died → the `kelurahan` table never existed → `/api/public/ongkir op=kelurahan` 500'd on every checkout. **And the 500 surfaced in the browser as a CORS error** (an uncaught throw returns Next's own 500, which carries no CORS headers), so the message pointed at the wrong layer for hours.
> 4. **Disk full → Postgres crash-loop → a container that is `Up (unhealthy)` and 503ing** (2026-07-18, `e84449e`). Coolify retains **every per-deploy image**: 204 images / ~129 GB filled the VPS. Postgres hit `No space left on device` during its end-of-recovery checkpoint → PANIC → crash-loop ("database system is in recovery mode"). The SSR storefront **503'd for ~2h**. Freed ~130 GB, Postgres recovered on its own, no data loss. ⚠️ **L1 explicitly cannot heal this** — the container was never `created`/`exited`, it was `Up (unhealthy)`. The broom shipped; **the witness did not**.
>
> **Design (3 layers — one is not enough, each catches what the others cannot):**
> - **L1 — self-healing watchdog ON the box** (cron, 1 min): any of the 4 app containers in `created`/`exited` → `docker start` it. Fixes shape #1 with no human awake. **Needs no credentials — can be built today.** ⚠️ Does **not** touch shape #4: `Up (unhealthy)` is neither `created` nor `exited`.
> - **L1b — disk-cleanup safety-net** (BUILT, `e84449e`): `ops/tokophi-docker-cleanup.sh` prunes build cache + *unused* images, daily 03:30 UTC via `/etc/cron.d/tokophi-docker-cleanup`; DEPLOY.md §L1b. **Prevention only.** Keep it conservative — never `docker system prune -a` while containers are down, which would delete the running images.
>   - [ ] **It is installed BY HAND** and nothing in CI reinstalls it, so a VPS rebuild silently loses the protection. Add it to the DEPLOY.md re-install checklist.
>   - [ ] **It writes no heartbeat.** The watchdog writes `/var/run/tokophi-watchdog.last`; the cleanup writes nothing, so a silently-removed cron is indistinguishable from a healthy one.
>   - [ ] **Cap Coolify's per-deploy image retention at the source** — 204 images / 129 GB is the actual bug; the broom only sweeps after it.
> - **L2 — external probe** (must NOT run on the box; a watchdog on a dead box is worthless): the 5 public hosts **plus one endpoint that actually touches Postgres** — a container can be `healthy` while the DB is gone, so a static page proving 200 proves nothing. Suggested: `POST /api/public/ongkir {op:"search"}` (hits `kiriminaja_areas`). **Shape #4 raised its priority: it must also probe DISK %**, and it is now the *only* layer that would have caught a 2-hour outage. ⚠️ Note `7cc1ecc` made a missing `storeSlug` fatal — write the probe payload so it does not 400 on tenant resolution and read as "down".
> - **L3 — deploy-failure alarm** (shape #2): read Coolify's `application_deployment_queues` for `status='failed'`. Do not trust the deploy API's response.
>
> **Blocked on ONE decision from the user: where do alerts go?** Telegram (fastest to a phone; needs a @BotFather bot token + chat id in `~/.config/ai-local/secrets.env`), or email/SMTP. Until that exists, L1 can still ship (self-heal + `/var/log/tokophi-watchdog.log`) — it just heals in silence.

- [x] **L1 self-healing watchdog — BUILT + LIVE on the VPS** (2026-07-15). `ops/tokophi-watchdog.sh`
  (in the repo) installed at `/usr/local/bin/tokophi-watchdog.sh`, fired every minute by
  `/etc/cron.d/tokophi-watchdog`. It `docker start`s any of the 4 app containers (`admin`, `super-admin`,
  `storefront`, `landing`) found in `created`/`exited`, matched by the stable
  `<svc>-l7r4qaqcml4zigw1dc7iptun-` prefix. **Deliberately narrow:** never touches `postgres`/`backup`/
  `coolify`/`cron`, and never `migrate` (which is *supposed* to be `exited (0)` — starting it re-runs
  migrations); only acts on `created`/`exited`, leaving a `running`-but-unhealthy or `restarting`
  crash-loop to L2/L3. No credentials, no network. Writes a heartbeat to `/var/run/tokophi-watchdog.last`
  every run (an observable "the watchdog is alive" signal for L2, since the log stays quiet on a healthy
  box). **Proven end-to-end:** `docker stop landing` → watchdog → `running` again + HTTP 200 + a `HEAL`
  log line; cron firing confirmed via the heartbeat advancing + syslog `CRON … tokophi-watchdog.sh`.
  Survives a bad deploy because it lives on the **host**, not in an app container. ⚠️ Re-install after a
  full VPS reprovision: copy `ops/tokophi-watchdog.sh` + the cron.d line (see DEPLOY.md).
- [ ] **L2 external probe** incl. a DB-touching endpoint, off-box. Can now also read the L1 heartbeat
  (`/var/run/tokophi-watchdog.last`) to detect a dead watchdog / dead box.
- [ ] **L3 deploy-failure alarm** reading Coolify's queue table, not its API response
- [ ] **Alert channel** — user decision (Telegram bot token / SMTP). ⚠️ **This is what still blocks L2/L3:**
  L1 heals in silence; L2/L3 have nowhere to send an alert until this is chosen.

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

## Conversion tracking — three OWNER decisions, not engineering gaps

Found by the 2026-07-30 audit. Each is a product/legal call, so none was made unilaterally.

- [ ] **There is no consent layer. Anywhere.** Grepped the whole repo: no banner, no stored preference,
  no region check, no `gtag("consent", …)`, no Meta `data_processing_options`. `fbq`, `ttq` and `gtag`
  bootstrap in `<head>` and fire `PageView` on the first byte of every visit, before any interaction.
  For an Indonesia-only shop under UU PDP that is a defensible business decision — but it does not look
  like one anybody has *made*. For a single EU/UK visitor it is cookies + personal data (hashed
  email/phone, IP, UA, click ids) shared with three ad platforms with no lawful basis and no way to
  withdraw, and by Meta's and Google's own terms **the merchant carries that, not TokoΦ** — while being
  unable to comply, because we ship the tag. Minimum honest implementation, in order:
  (a) a per-store "does this shop serve EU/UK traffic?" setting; (b) a banner that stores a preference
  and **blocks the bootstrap** in `MarketingPixels.astro` until marketing consent exists — no consent,
  no script, which also covers Google Consent Mode's `denied` case without implementing it; (c) pass the
  stored preference through to GA4 MP `consent` and Meta `data_processing_options` so the server half
  agrees with the browser half. Note gtag's Consent Mode defaults to **granted** when never called, so a
  banner added later without a `consent default` call changes nothing.
- [ ] **PPN and the feed price.** Google requires tax-INCLUSIVE prices everywhere except US/CA; our feed
  emits the bare variant price and `/api/public/order` adds PPN on top when a store enables it. Making
  the feed inclusive fixes the spec and breaks the landing-page match, because the storefront shows the
  same ex-PPN number — Merchant Center's crawler compares the two. So this is a storefront-display
  decision first, a feed change second. **Latent today: zero stores have `tax_enabled`.** Nothing warns
  the merchant when they tick the box in Pengaturan → Pajak; that warning is the cheap half.
- [ ] **Every feed image is WebP, which Meta and TikTok both document as unsupported** (JPEG/PNG only;
  Google does accept WebP). `saveImage` converts every upload, the seeded catalog is `.webp`, and the
  `?w=` rendition route re-encodes to WebP — there is no JPEG rendition to point at. Fixing it means a
  second rendition format, so it is a storage/CDN decision, not a feed edit. Stated as a documented
  format mismatch: no rejection has been observed, because no merchant has connected a catalog yet.

Also open, smaller, and ours to do:

- [ ] `MarketingPixels.astro` ships all three vendor bootstraps even when one channel is configured, and
  ~2 KB of comments crossed back over the fence the file's own frontmatter note draws. The refactor it
  proposes (JSON data island + one bundled, minified, cacheable script) fixes both.
- [ ] `storeTrackingPixels()` is the only storefront read not wrapped in `cached()` — one Postgres
  round-trip on the SSR critical path of every page, including 404s and bots, for a row that changes
  twice in a store's lifetime.
- [ ] A refused COD parcel (`retur`) stays a reported Purchase forever. Nothing emits a refund or
  cancellation event to any provider, so ROAS is structurally overstated by the COD refusal rate. That
  is consistent with the signed-off "COD = purchase at the thanks page" rule, but it has no
  compensating half.
- [ ] `tracking_event_deliveries` keeps the shopper's IP, user agent and ad cookies with **no retention
  policy** — nothing ever deletes a row, and `SCHEMA.md` claims the payload holds "commerce facts ONLY".
  Pick a window (30 days covers every provider's own), delete on the cron tick, and fix the doc.
- [ ] `INTEGRATION_TOKEN_KEY` is absent from `.env.example` and `.env.coolify.example` (and
  `docker-compose.coolify.yml` forwards `${INTEGRATION_TOKEN_KEY:-}`, i.e. empty). It IS set in Coolify
  now, so production works — but a by-the-book redeploy from the examples silently disables every
  server-side conversion, and the merchant-facing error names an internal env var.

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
