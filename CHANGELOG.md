# Changelog — TokoΦ

All notable changes. Dates are absolute. Phase: local backend done (Postgres + Drizzle, RBAC + RLS enforcing) · **rebranded to TokoΦ 2026-07-08** · focus = admin-client feature depth (VPS infra deferred).

## Unreleased — The seed stopped handing out one password, one keep-list entry that never protected anything, and 24 one-centimetre parcels

Three items in `packages/db`, all of them things a *new* deployment gets. ⚠️ **The seed is not a
migration**: not one existing row changed, and every claim below about production was measured
read-only before it was written down.

- 🔴 **N29 — the seed no longer mints a fixed password.** `const DEV_OWNER_PASSWORD = "tokophi123"` was
  hashed into the store owner, the platform operator, every demo store's owner and every registered
  demo customer. Now each account gets its own 60-bit `tempPassword()` and the run **prints them once**
  at the end — the only copy that will ever exist, and it is printed on a crash too (the owner and the
  operator are written in the first of ~1.500 un-transacted inserts). `SEED_OWNER_PASSWORD` pins them
  all to one string for local dev and **refuses a published default**.
  **`packages/lib/src/password.test.ts` no longer exempts `packages/db/src/seed.ts`** — its repo-wide
  sink scan now covers every tracked file with nothing carved out. Proven red by re-adding the constant.
  ⚠️ **Existing deployments are unchanged and still authenticate with `tokophi123`.** Rotating is a
  procedure, not a deploy: `specs/docs/tasks/2026-08-03-rotate-exposed-owners.md` §②/§③/§⑤. Measured
  there on 2026-08-03: 7 of 8 store owners plus the operator. **Rotate the accounts that were measured,
  never the table.** And the demo store's 219 orders are a DUMMY set (32 distinct phones across all
  219) — an earlier draft of this note called them real buyer data, which was wrong in the expensive
  direction.
- 🔴 **N42 — `SEED_FORCE=1` refuses instead of silently destroying operator config.** It now counts and
  prints every row nothing writes back — orders, customers, ledger entries, media, Store Builder
  templates, flash sales, the operator logins, the aggregator key, the gateway credentials, and the
  **encrypted CAPI tokens the seed does not write at all** — and stops unless `SEED_DESTROY_CONFIG=1`
  is set as well. It runs before EVERY truncate, not only under `SEED_FORCE`: that skip only counts
  `stores`, so a database with a rotated operator and no store yet would sail past it.
  ⚠️ **A longer keep-list is not the fix, and this was MEASURED, not reasoned.** With
  `store_tracking_channels`, `page_templates` and `flash_sales` added to it, Postgres still printed
  `truncate cascades to table "…"` for all three and emptied them — `cascade` follows their `store_id`
  FK. Two corrections to the same note: `kelurahan` **does** have a foreign key (to `kiriminaja_areas`,
  which is kept too — the rule is *no FK path out of the keep-list*, not *no foreign keys*), and the
  platform singletons have **none**, so a keep-list *would* save them; they are on the loss list because
  keeping them collides with `platform_admins_email_unique` on the reseed.
- 🔴 **N33 — every seeded product declared a 1 cm cube, and the BOOKING sends it.** Harmless for the
  quote (0,17 g volumetric never beats the actual weight, which is why it survived) but
  `createShipment` declares the same three columns to the courier, who re-measures at pickup and bills
  the merchant the difference. Both seeders now read `packages/db/src/product-dims.ts` — the folded
  polymailer per garment kind, 100 g … 1.062 g volumetric — and an unknown handle **throws** rather
  than defaulting. It is also what finally lets wave 7's dimension-aware quote (N30) fire on the demo.
  **Existing stores need a data fix and it is not in this release:**
  `ops/tokophi-n33-product-dimensions.sql`, dry-run only, ending in `rollback`, matching only the exact
  `1 AND 1 AND 1` fingerprint (24 rows on the dev database; a merchant's typed value and a NULL are
  both left alone).

## Unreleased — The control plane trusted a seven-day cookie, and there was no way to rotate its password

Three defects on the platform-operator identity surface, each measured against a running server before
and after. ⚠️ **Contract change other surfaces read:** `addStoreUser` now returns
`password: string | null` plus `outcome`; `apps/admin/lib/session-revocation.ts` **moved** to
`@tokophi/lib/session-revocation`; `platform_admins` gained `password_changed_at` (migration **0089** — it was 0088 until `ka/flow-audit` landed its own).

- 🔴 **`getPlatformSession()` never read the database.** It decoded the JWT and returned the claims,
  so `role` was whatever was true at login for the token's full seven days. Driven with ONE cookie
  held constant while the `platform_admins` row was mutated by SQL: **demoted owner → support still
  minted a new platform operator** (an owner-gated act); so did one whose **row was deleted**; so did
  one whose **password was rotated**. Four operator accounts from one cookie that should have been
  dead after the first. It now re-reads the row on every request, takes the rank from it, and fails
  closed — after: **one** account created, by the one request that was still legitimate.
  The decision lives in `platform-session.ts` (pure, tested); the layout redirects to a new
  `/api/auth/signout` route rather than `/login`, because a dead-but-valid cookie makes the layout and
  the edge middleware redirect at each other (`ERR_TOO_MANY_REDIRECTS`, measured — `apps/admin` hit
  the same wall one wave earlier and has the identical file).
- 🔴 **`addStoreUser` reported a password it had not written.** The mint was unconditional, the hash
  was written only when the `users` row was new, and `pw` came back either way — so linking an
  existing account produced a credential dialog for a string that verified against the stored hash as
  **false**. Now `password: null` + `outcome: "linked"`, and the caller says *"Akunnya sudah ada, jadi
  kata sandinya TIDAK berubah"* instead of announcing a handover that did not happen. **Not** fixed by
  rehashing: that would lock the person out of the store they already staff.
- 🔴 **There was no change-password path for `platform_admins` at all** — nothing wrote
  `password_hash` outside `invitePlatformAdmin`'s INSERT, so the super-admin credential exposed in a
  chat transcript could not be rotated through any UI. Avatar menu → **"Ubah kata sandi"**
  (`changePlatformPassword`): current password re-proved, ≥8 chars, must actually differ, audited to
  `platform_activity`, and it **revokes every other session** — migration 0089 puts 0087's trigger
  function on `platform_admins` too. Verified in two browsers: the tab that changed it stays in, the
  one holding the old password's session is bounced to `/login`, the old password no longer logs in.
- Runnable checks: `apps/super-admin/lib/platform-session.test.ts` (6),
  `apps/super-admin/lib/add-store-user.test.ts` (5, proved red against three mutations first), and a
  second DDL suite in `packages/lib/src/session-revocation.test.ts` for the new trigger.

## Unreleased — the gate built to stop the money suites skipping was, in a worktree, skipping

**Measured in `.claude/worktrees/w8-harness` before the fix: 263 passed / 36 skipped, exit 0** — green
— with all 22 `ledger-credit` tests among the skipped. With `DATABASE_URL` exported: 299 passed, 0
skipped. **After: 317 passed, 0 skipped, with no `.env` in the worktree and nothing exported.**

`test/db-setup.ts` (the vitest `globalSetup`) derives `<DATABASE_URL>_test`, creates it, migrates it
and so lets the ledger suites run by default. It read `<its own root>/.env` and nothing else — but
`.gitignore` is `.env*`, so **a git worktree can never carry one**, and this repo does nearly all of
its work in worktrees. It printed its banner and skipped, exactly what it was written to stop.

- **The fallback already existed, correctly, a few files over.** `apps/storefront/scripts/check-env.mjs`
  read the repo root *and* the main checkout three levels up (`<main>/.claude/worktrees/<name>`), with
  the worktree reason spelled out in its comment; db-setup had a private copy that did not. A private
  copy is how the weaker version of a rule survives the fix meant to catch it — see the 24-bit password
  mint. **The lookup is now one module, `@tokophi/lib/env-file`, and both import it.** It is `.mjs`, not
  `.ts`, because `apps/storefront/scripts/*` run under plain `node`.
- The 18 `packages/db` npm scripts still restate the same pair declaratively
  (`dotenv -e ../../.env -e ../../../../../.env`) — they are shell and cannot import a module. Named in
  `env-file.mjs` so the next layout change finds them.
- **Every existing contract is unchanged and was re-measured**: a resolved database name that does not
  end in `_test` still throws; an unreachable database still SKIPS with the loud banner at exit 0
  (a laptop without Docker gets a green run); `npm run test:db` still turns that skip into exit 1.
- `test/env-file.test.ts` is the check, and it was proved red first: delete the main-checkout entry
  from `envFiles()` and two tests fail; re-inline the lookup in either caller and the "one resolver"
  guard fails (it reads the files' CODE via `test/source-code.ts`, not their text).

### An SVG path made of NaN, and money formatters that printed "RpNaN"

`kpi-card.tsx` guarded its sparkline with `!data.length` while the byte-identical geometry in
`dashboard/money-strip.tsx` used `data.length < 2`. A one-element series divides by zero in
`(i / (data.length - 1))`, so the KPI card emitted `d="MNaN,30.0"` and
`area="MNaN,30.0 L88,32 L0,32 Z"`. **Reachable, not theoretical: on the 1st of any month `/analitik`'s
"Bulan Ini" resolves to exactly one day** (`inMonth(thisMonth)`), as does any store with a single row
in `daily_stats` — all four KPI cards then render a NaN path. Two copies with two guards *is* the bug,
so there is one `components/admin/sparkline.tsx` now (`area` prop for the KPI tiles' gradient, the only
difference the copies ever had) and `sparkline.test.ts` covers both the geometry and the de-duplication.

`@tokophi/lib/format` had no non-finite floor: `IDR(NaN)` → `"RpNaN"`, `IDR(Infinity, {compact})` →
`"RpInfinity M"`, `num(NaN)` → `"NaN"`, `share(NaN)` → `"NaN%"`, and `pct(NaN)` → `"NaN%"` **with the
sign dropped** — the one thing `pct` exists to guarantee. All four now return `NO_FIGURE` (`"—"`): a
figure with no source is a dash, never a number. ⚠️ **A real `0` is a measurement and still renders**
(`Number.isFinite(0)`), and `pct()` (delta) and `share()` (part of a whole) stay separate — that
distinction is what the *"Ditangguhkan 5 +83,3%"* incident cost. `format.test.ts` pins both.

⚠️ Still unfloored, deliberately out of this change's scope: `timeAgo(NaN)` → `"NaN hari lalu"`.

## Unreleased — A brand-new Seller was shown a header-only table and told to change a filter it never set

Driven in a browser as the owner of the seeded store with **0 products, 0 orders, 0 customers**
(`snack-rumahan-bu-tati`) — no row was created and none was changed. Two families, both of them
"the screen renders a SHAPE where it has no data", the same family as the dashboard that once read
*"Penjualan hari ini Rp0 · −100,0%"* above four orders placed that morning.

- **The dashboard's two silent cards.** "Pesanan Terbaru" rendered a `<table>` with five column
  headers and an empty `<tbody>`; "Aktivitas Langsung" rendered a card title over an empty `<ul>`.
  Both read as a query that failed. They now say what is missing and what brings it, in the same
  one-line form the sibling cards on that page already used. `/pemasaran`'s channel table did the
  same thing under a "Total 0" footer — fixed with it.
- **"No results" and "no rows" are different facts, and seven list screens conflated them.**
  `/produk`, `/produk/inventori`, `/produk/kategori`, `/blog`, `/halaman`, `/diskon` and `/pelanggan`
  all answered an empty store with search copy — *"Coba ubah kata kunci atau filter Anda"*, *"Coba
  kata kunci lain"*, *"Tidak ada … yang cocok"* — advice that cannot work, because there is no filter
  set and nothing to filter. Each now branches on the **unfiltered total**: first-run copy naming the
  next step (and, on `/produk`, the Tambah Produk button) when the store has nothing, the existing
  filter copy when a filter is what emptied the list. The filtered branch is unchanged.

**Accessibility, admin side** (the storefront's checkout was done in an earlier wave; the admin never
was). Measured per route, logged in, in a real browser:

- 🔴 **`/tema/[id]` had no `<h1>` at all** — and it is FULL_BLEED, so the sidebar and topbar are gone
  too. Every heading on it came from Puck and started at `<h2>`. Now carries an `sr-only` `<h1>`, the
  same floor and the same reasoning as the storefront's `index.astro`.
- **`/produk` went h1 → h3**, skipping a level — the grid cards' `<h3>` is the only `h3` in the admin.
  An `sr-only` `<h2>` now names the results region above both views.
- **Three unnamed destructive icon buttons**, all on `/promo/[id]`: the row-delete `X` on Manfaat
  Utama and on Poin masalah, and the chip-remove `X` on Ideal Untuk (its text is in the parent
  `<span>` — adjacency is not an accessible name). All three now carry one.
- **The topbar's unread dot was colour alone** — the bell's label read "Notifikasi" whether or not
  anything was waiting. It now names the count, the way `obrolan-client.tsx` already did.
- **Every `/pengaturan` switch was anonymous** (`ToggleRow` renders its `title` in a sibling `<p>`).
  One `aria-label` in that shared component names all of them.
- The store-builder's image-picker thumbnail computed **no accessible name at all** (an `<img alt="">`
  in one branch, an icon in the other).

Two guards, each proved RED before it was proved green:

- `apps/admin/lib/admin-h1-floor.test.ts` — every `page.tsx` under `app/(admin)` reaches an `<h1>`,
  by walking its local import graph plus its ancestor layouts. Uses `test/source-code.ts`; no comment
  stripper is hand-rolled. ⚠️ **The mutation proof is what earned this file its one exclusion**: the
  first version was green over a `/tema/[id]` with the heading deleted, because the graph leaks into
  `components/theme/sections/`, whose `Hero.tsx` emits an `<h1>` — for the storefront page being
  composed inside Puck's canvas, not for the admin screen. Excluded by name, and said so.
- `apps/admin/components/admin/dashboard-empty.test.tsx` — renders `RecentOrders`/`LiveActivity` with
  `[]` via `renderToStaticMarkup` and asserts there is no `<table>`/`<ul>` and there is an
  explanation, plus that the populated case still renders the table.

**Known, NOT fixed** (ranked, for whoever picks this up): ~40 form controls across the admin have no
programmatic label — the biggest cluster is the list-screen search boxes (placeholder-only) and the
Puck sidebar field overrides (`lib/theme/puck-field-overrides.tsx`); `CardTitle` is a `<div>`, so the
admin's 128 card headings are invisible to heading navigation; and the good/bad verdict on the
dashboard's money bars and the return-rate bar is carried by colour alone (the numbers beside them
are not).

## Unreleased — The demo store could not be shipped: 160 of 219 orders had no usable address

**Measured on production**: 219 orders, **one** store. 50 carried no `ship_address` /
`ship_district_id` / `ship_postcode` at all (pre-0042 rows); 108 had an address shorter than 15
characters; the whole store held **7 distinct kecamatan and 10 distinct addresses**, two of which were
`"Test ruma kami"` and `"Jsjsj rw rt dkdj"`. Nothing in that shape can be booked, and a demo where a
hundred parcels go to one kecamatan tests nothing.

`packages/db/src/backfill-ship-address.ts` (`npm run backfill:ship-address -w @tokophi/db`, with
`DRY_RUN=1` to print the plan and write nothing) repairs the snapshot. It is **UPDATE-only, on
`orders` only, and writes exactly seven columns**: `ship_recipient`, `ship_phone`, `ship_address`,
`ship_district_id`, `ship_postcode`, `city`, `province`. It never names `total_idr`, `subtotal_idr`,
`shipping_idr`, `tax_idr`, `courier`, `service_type`, `status` or `awb`, and touches no other table —
orders carry payments, line items and ledger entries, and a destination is not money.

- **It is NOT part of `seed-recent.ts`, deliberately.** That script's whole safety story is
  "INSERT-only, never truncates", and this is an UPDATE. It is also *downstream* of these rows —
  `seed-recent` samples its destinations **from `orders`**, so on production it was copying those 7
  districts and `"Test ruma kami"` into every new demo order. Repairing the rows fixes what it copies.
- **A row is repaired only when its snapshot cannot ship a parcel**: no address, under 15 characters,
  **no digit anywhere in it** (a street with no house number, no RT/RW and no block is not an address
  a rider can walk to — that is what caught `"Jalan maju"` and `"Jsjsj rw rt dkdj"`), a missing or
  unresolvable district/postcode, or a `city`/`province` that is not the pair **derived** from the
  district. Real addresses someone actually typed (`"Ngoto RT 01 Bangunharjo Sewon Bantul"`) are left
  alone. That predicate is also the idempotence proof: after a run nothing satisfies it, so a second
  run updates **0 rows** (verified on a production clone).
- **No district id is invented.** All 85 are real `kiriminaja_areas` ids, each **pinned to the district
  name it is expected to be** — if the reference table is re-imported and an id moves, the script fails
  instead of addressing parcels to another island. Every postcode is a real `kelurahan` row *under that
  district*, and the kelurahan in the address text is the one the postcode came from.
- **The SPX column is measured, not assumed.** Every candidate was quoted live against
  `shipping_price` from this store's pickup district (6138 Gubeng, Surabaya, sandbox, `courier:["spx"]`,
  1.000 g). ⚠️ **SPX quotes nothing to Bali** from that origin — surprising, and exactly why it is
  measured. The pool is bucketed so all four COD outcomes exist in the data: allowed province + SPX
  serves (**45 SPX orders**), allowed province where **SPX does not serve** (6 — Bawean, Karimunjawa,
  the Gunung Kidul south coast), province off the allow-list (50), and neither (5), plus 113 orders on
  a non-SPX rail. Result: **7 → 88 kecamatan, 4 → 31 provinces, 10 → 163 distinct addresses**, all six
  COD provinces populated.
- **The names and phones are the ones an over-eager validator has refused before** — `Nur'aini`,
  `M. Rizky`, `I Gusti Ngurah Rai`, `Abdul Ghofur Al-Rasyid`, `Anne-Marie Tobing`, `Aisyah Zahra’`, and
  carrier prefixes **0838 / 0881 / 0895 / 0851**. `packages/db/src/demo-addresses.test.ts` runs every
  generated name, phone and address through `@tokophi/lib/validate`: if the generator can emit
  something the checkout would reject, the demo is carrying rows a real order could never have created.
  The generator lives in the pure `demo-addresses.ts` for the same reason `cod-policy.ts` is split from
  `cod.ts` — the writer imports `./client`, which connects at module scope.
- ⚠️ **Not fixed, and not fixable by editing a destination: no order exceeds the COD cap.** The largest
  is **Rp1.814.000** against a Rp2.000.000 cap, so the "over the cap" refusal has no row to exercise it.
  Raising a total means writing a financial column, which this script refuses to do; testing that branch
  needs a real checkout above Rp2jt.

## Unreleased — an incomplete address can no longer buy anything: kode pos is required

**Kode pos was optional on both halves**, so a parcel could be booked with no postcode on it —
measured before the change: the form let Bayar through with the field empty and
`/api/public/order` wrote the order. It is required now in `@tokophi/lib/validate`
(`postcodeError("")` is an error), which the checkout form and the order API both read, so the API
refuses the same payload independently of the form — verified by posting straight at it.

**Required does NOT mean "the system derived it".** The cascade auto-fills the field wherever it can
answer honestly (one postcode in the district → filled on the district pick; several → filled on the
kelurahan pick) and the field is now **always editable**; the ~4% of districts with no kelurahan data,
and any failed lookup, leave it empty, editable, and explained by a hint under the field. Making it
required *only when derivable* would have been the over-validation bug `AGENTS.md` warns about.

Three things had to change for `required` to mean anything, and each was invisible:

- ⚠️ **`readOnly` silently cancels `required`** — a readonly input is barred from constraint
  validation (`willValidate: false`). The field was locked whenever the value was derived, so the
  attribute alone would have been a **no-op on exactly the two branches that auto-fill**. Lock removed;
  it also means a shopper who knows their own kodepos can now correct ours.
- **One writer, `setKodepos()`.** Six sites assigned `kodeposEl.value` directly, and a programmatic
  assignment fires neither `input` nor `change` — so it never cleared the custom validity a failed
  submit had set. A shopper who pressed Bayar empty, then picked a kelurahan that filled the field for
  them, would have been refused forever by a field that was now correct.
- **`kodepos` added to the `MISSING` map** — otherwise the one string a shopper sees is the browser's,
  in the browser's language.

Two quiet defects found and fixed in the same file, both measured against the previous build:

- **`loadKelurahan()` had no stale-response guard** (`loadRates()` beside it has always had one). Two
  kecamatan picked in quick succession: district A's postcode **55764** ended up on an order shipping
  to **Sewon (552)**, with the "Kirim ke" card reading it back as if it belonged there.
- **A recovered checkout's saved kodepos was re-applied from a `setTimeout(…, 600)` racing that same
  lookup.** A 2 s lookup wiped it (measured) — under the new rule, a returning shopper who cannot
  submit. The restore now happens inside the lookup, which is the only thing that knows when it is done.

Also: the kecamatan's "pilih dari daftar" refusal is now shown **inline** (`<p data-err>` +
`aria-invalid`) as well as in the bubble, and `#dest-search` carries `name="kecamatan"` — so when the
order API refuses with `field: "kecamatan"`, the response handler's
`form.querySelector('[name="…"]').focus()` finally finds something. It matched nothing before.

Checks in on-screen order: the kecamatan is validated **between Alamat and Kode Pos**, because it is
upstream — picking it is what fills the kodepos — so an empty kodepos no longer pre-empts the field
that would have filled it. `kelurahan` stays **optional** (unchanged): the local table's ids are BPS
codes carrying `id: null` on purpose, a wrong village id books the parcel to the wrong village, and
the order API ignores the field entirely.

Guarded by `apps/storefront/src/lib/checkout-kodepos.test.ts` (every assertion mutation-tested to go
red) and the updated `packages/lib/src/validate.test.ts`. The over-validation sweep was re-run in a
real browser on an `en-US` locale — 13 Indonesian names, prefixes 0838/0881/0895/0851, university /
self-hosted / plus-addressed emails, `Blok C2/14` and `RT.001/RW.009` addresses — all still pass, with
focus never yanked out of the field the shopper clicked into (37 assertions).



## Unreleased — the courier's own bill, and five status codes that meant nothing to us

**All 34 captured KiriminAja doc pages were read by flow and written up as `specs/docs/KIRIMINAJA.md`** —
the vendor contract, beside `FLOWS.md` §5 which owns the product flow. Comparing that summary against
the code produced everything below. ⚠️ 25 of the 34 pages give an HTTP verb and **no path**; every path
we call came from our own working code, and nothing here invents one.

**Two things the docs settle, recorded so they stop being re-raised:** there is **no standalone pickup
endpoint** — creating the express order *is* the pickup request (`method: "request_pickup"`), and
pickup vs drop-off is the per-package `drop` boolean; and **skipping the schedule endpoint is
explicitly allowed**, so our fixed tomorrow-10:00-WIB is a legitimate choice, not a defect.

### VA and COD are opposite directions, and we were treating them as one thing

One booking call carries two money flows, and all three response fields that tell them apart were
parsed and thrown away for both:

- **NON-COD** — *we* owe KiriminAja the shipping cost. `payment_method` defaults to `va`, so the
  booking answers with `payment_status` (unpaid | pending | paid) and a `qr_url`. **An unpaid booking
  never gets a waybill**: the parcel does not ship, the poller keeps finding nothing, and the order
  reads "dibooking" on every screen with nothing anywhere saying why. That silence was the defect.
- **COD** — the *buyer* pays the courier. The vendor **ignores** `payment_method` for COD packages and
  rejects the combination with code 4003, so we owe nothing and an "unpaid" reading there is noise.

Migration **0088** stores what the vendor returns, verbatim: `orders.ka_pickup_number` (which the
vendor's own docs also call the **payment id** — received on every booking since the integration
shipped and persisted nowhere), `ka_payment_status`, `ka_payment_url`, plus **`ka_shipping_cost_idr`,
the cost side of ongkir the DB had never held** (`shipping_idr` is what the *shopper* paid; a seller
may book a cheaper service and nothing recorded the gap).

**`apps/admin/lib/shipment-payment.ts` is the ONE place that separates the flows**, deciding from the
order's own COD flag (`payments.method = 'cod'`) — never from the vendor's fields, which the docs do
not define for a COD package. NULL means *no reading*, never *unpaid*. The order's shipping card now
shows "Ongkir ke kurir": red with a **Bayar** link only when it actually blocks; `unknown` renders
nothing. Browser-verified against the built app, and both test rows restored to NULL afterwards.

⚠️ **The migration was written by hand, not generated.** `drizzle-kit generate` diffs against the last
snapshot — **0082**, because 0083–0086 are hand-written and left none — so it re-emitted all of their
changes, including `ADD COLUMN` without `IF NOT EXISTS` for `stores.suspended_*` and the
discounts/purchase_orders unique constraints under **different names** than 0084 actually created.
Drizzle applies the pending batch in ONE transaction, so that would have failed and rolled back
everything behind it.

### Five documented status codes were silently unmapped

`outcomeFromTrackingCode` returned `null` — *fill the AWB, change nothing* — for **302** (pickup
canceled by seller), **310** / **311** (rejected; 311 is the **COD refusal**), **333** (destroyed by
courier) and **555** (confiscated by Customs), and mapped **110** ("pending *direct* pickup") to
`shipped`.

**333 and 555 are documented FINAL states.** Unmapped, the order never left `dikirim`, so the poller
re-queued it every 15 minutes forever — and the sweep takes a bounded batch per tick, ordered
AWB-less-first, so parcels that can *never* resolve accumulate at the head of the queue and starve the
ones with work outstanding. **110** falls inside the `106..200` transit range but is PRE-pickup, and
`RANK` is forward-only, so calling it `shipped` told the merchant and the buyer a parcel was moving
while it still sat at origin — permanently.

333/555 now map to `problem`, which deliberately does *not* change status (a destroyed parcel is
neither delivered nor returned, and whether it settles as `batal` is a refund decision that is not
this function's to make) but does raise `problem_at`/`problem_note`, so it is visible. 210/211/350
stay unmapped on purpose, with the reason in the code. **Guard:
`apps/admin/lib/ka-status-codes.test.ts` transcribes the vendor's whole 38-code table — 7 red before,
41 green after.**

### Filed, not fixed — N42 needs an owner decision because it moves money

**COD settlement is not modelled.** On `selesai` a COD merchant is credited the **gross** total
*including ongkir* as immediately-`available` money, while KiriminAja remits **net** of the shipping
cost it keeps. The balance overstates by (ongkir + COD fee) on every delivered COD order and the
platform pays the difference out of its own float. `ledger_kind` has no cost concept and
`platform_cod.fee_pct` is read by nothing. Half the prerequisite now exists
(`orders.ka_shipping_cost_idr`); whether the platform absorbs that cost or nets it out of the
merchant's credit changes what merchants are owed, so it is not a call an audit gets to make.

Also open: **N38** the label misses required fields (sorting code is blocked twice over — values come
from KiriminAja support, and it rides a webhook we do not receive); **N39** webhooks exist and are
unused, blocked on a registration path the docs do not give; **N40** our booking endpoint `v6.1` is
**marked deprecated by the vendor**; **N41** we cannot see courier holidays.


## Unreleased — the resi appears on its own; the UI was telling sellers to keep clicking

The shipping flow is four steps — **Proses** (`baru → diproses`) → **Atur pengiriman** (book with the
service the shopper paid for) → **Resi terbit** → **Cetak label** (with `label_printed_at` behind the
sudah/belum filter). All four already existed and work.

**Step 3 was being described as manual when it is not.** A booking returns `awb: null` — the waybill is
issued when a courier *accepts* the pickup — and `cron-tracking` fills `orders.awb` **on its own, every
15 minutes**, batch 100. The screens said *"Klik 'Ambil resi' lagi nanti"* and *"Klik 'Lacak' untuk
mengambil resi begitu terbit"*, so a seller had no way to know it would arrive without them, and sat
watching a queue. Three copy sites now say it appears by itself and that the buttons are the shortcut.

Also fixed while in that file: **`Filter` was declared inside the bulk-shipping screen's render**, so
every parent render created a new component type and React remounted the whole filter row — the class
`AGENTS.md` names (state lost, focus dropped mid-typing), on the screen where a merchant selects rows
in a table. Hoisted out: **8 eslint errors → 0** in that file.

## Unreleased — A real booking went through, and could not be cancelled

Owner-authorised end-to-end run of the resi chain, closing N32. `request_pickup` was accepted with the
schedule `createShipment` computes (**tomorrow 10:00 WIB**, `Asia/Jakarta`):

```
request_pickup → {"ok":true,"kaOrderId":"5758-E2E68072665","pickupNumber":"XID-5544692486"}
awbPending = true      ← awb is null on every fresh booking, exactly as documented
tracking       → "Tracking tidak tersedia"    (no waybill yet — correct)
cancel         → 🔴 "Paket tidak ditemukan"
```

🔴 **`cancelShipment` was sending the ORDER ID as the AWB.** KiriminAja's doc is explicit — *"awb: AWB
Number Already Obtained, **Not Order ID**"* — and the code built `o.awb ?? o.kaOrderId`. Every fresh
booking has `awb: null`, so the fallback fired on exactly the parcel a merchant had just created: the
shipment stayed live at the courier and the merchant was shown an error that reads like it never
existed. **That window — booked by mistake, seconds ago, waybill not yet issued — is precisely when
someone cancels.**

Cancel now takes `o.awb` and only `o.awb`; a booking with no waybill is refused **before** the network
call, naming the next step instead of quoting the vendor. The lib comment asserting
`AWB (= kj_order_id / resi we stored)` is corrected — a false equivalence in a comment is how the wrong
identifier gets reintroduced by someone who trusted it.

Guarded by `apps/admin/lib/cancel-shipment.test.ts`, proven red 4/4. It uses **`codeOnly` from
`test/source-code.ts`**: a hand-rolled stripper would have been the fifth copy of a defect this repo
has found four times — and it fails on the very comment that explains the fix. The lib assertion is
therefore **positive** (the correction must be present) rather than an absence check that the
explanation itself trips.

⚠️ **A live sandbox booking is outstanding** — `5758-E2E68072665`, pickup `XID-5544692486`, JNE REG23,
scheduled 2026-08-04 10:00 WIB. No waybill was issued while polling, so there was no AWB to cancel
with; that is the bug, met in person. It is sandbox and nothing will be collected, but voiding it needs
the KiriminAja dashboard.

Also filed: **N35** — nothing anywhere asserts which KiriminAja environment a deployed container is on,
and this run is the proof it matters: sandbox bookings and pickup numbers look exactly like production
ones.

## Unreleased — The apex said "Segera hadir" three times on a live, billing product

`tokophi.com` is the page ads point at. It carried **three** statements that TokoΦ had not launched —
the eyebrow pill ("Segera hadir"), the `<meta name="description">` ("Situsnya sedang disusun"), and the
lede ("Situsnya masih kami susun — panel adminnya kami kerjakan lebih dulu"). All three are gone.

**Untrue claims removed, with the evidence each was untrue:**
- **"Tinggal diaktifkan"** about QRIS / e-wallet / COD — the merchant has **no switch** for payment
  channels at all (ADR 0004; the client-facing Pembayaran tab was removed 2026-07-13 because nothing
  read it). The blurb now says the true and better thing: platform-managed, nothing to register.
- **"e-wallet"** — every e-wallet channel is seeded `enabled: false` (`packages/db/src/seed.ts`, "the
  6 confirmed active on sandbox (QRIS + 5 VA)"). Naming a channel a shopper cannot pick is a promise
  the checkout breaks. Dropped; QRIS + transfer bank + COD are real.
- **"pajak sudah ikut dihitung"** — `store_settings.tax_enabled` **defaults to false** and the order
  API only applies tax when it is on, so this was false for every store that never opened that setting.
- **`<title>` said "panel admin"** — forbidden in user-visible copy (📛 above), and it propagated into
  `og:`, `twitter:` and the JSON-LD `description`: one wrong word in five places, on the most-indexed
  string on the platform.
- **`© {year}`** — `new Date().getFullYear()` in a **static** build freezes at image-build time and is
  silently wrong from the next 1 Januari. The year is gone; a copyright line does not need one.
- The trial length is now read from `@tokophi/lib/billing` (`BILLING.TRIAL_DAYS`), not typed.

**Content that was being HIDDEN, on ordinary screens:** `@media (max-height: 720px)` `display: none`d
the three feature blurbs **and** the free-trial line. A 1366×768 laptop has a ~660px viewport — measured
in a browser — so a large share of visitors saw neither, with no scrollbar to suggest anything was
missing. A second rule hid the trial line on **every phone**, on the claim that "the CTAs already say
it"; they say "Daftar toko" and "Masuk". Both hides are gone: the layout now tightens, then scrolls.

⚠️ **`.shell` was `height: 100dvh; overflow: hidden`** — a hard box that CLIPPED with no scrollbar and no
keyboard route. That fails **WCAG 1.4.4** at 200% zoom. It is `min-height` now: still one screen where it
fits (verified: 768px and 660px viewports both render the whole page without scrolling), a scroll where
it does not. The three blurbs also moved **inside `<main>`** — they were siblings of it, so landmark
navigation skipped the only place the page says what the product does.

**New pages: `/privasi`, `/kontak`, `/404`.** The apex had no privacy policy, no contact, no company
identity and no 404 — which blocks Google/Meta Ads and leaves a UU PDP notice unpublished. Every factual
claim in `/privasi` was read out of this codebase and the source file is named next to it in a comment
(signup fields, scrypt hashing, the pre-order `checkout_sessions` capture, WhatsApp-not-email recovery,
what `api/track` actually stores, ad pixels only where the merchant enabled a channel, Singapore
hosting). Provider brands stay generic per ADR 0004.

🔴 **THE IDENTITY IS NOT IN THE CODE, AND MUST NOT BE INVENTED.** Nothing in this repo establishes the
operating entity, its registered address or a monitored support channel. `apps/landing/src/lib/identity.ts`
reads four build-time vars — `PUBLIC_LEGAL_NAME`, `PUBLIC_LEGAL_ADDRESS`, `PUBLIC_CONTACT_EMAIL`,
`PUBLIC_CONTACT_WHATSAPP` — with **no defaults on purpose**. While they are empty both pages print a
visible notice naming exactly what is missing and stating the document is not final. **A placeholder
rendered as text IS a published claim** — a reader cannot tell it from a real one. Set the four vars in
Coolify and the notice disappears with no code change. **The pages still need a lawyer's review** and
`/privasi` §6 (retention periods) is deliberately qualitative because no period is defined anywhere.

**Deliberately NOT done: no Terms of Service.** Drafting the contract between TokoΦ and a merchant it
already bills is not a thing to autocomplete, and Google Ads does not require one — a privacy policy plus
identity and contact is the pair that unblocks review. It belongs on the signup flow, not the apex.

`astro check` now runs for the landing app too (`npm run check:landing`, wired into root `test`) — it
never had before. The baseline was already clean, so every finding is 0/0/0 on both sides.

## Unreleased — `analytics_daily` had no writer outside the seed: the two screens a merchant opens every day were frozen on one store and empty on the other six

The Dashboard's money strip + chart and the whole of `/analitik` read `analytics_daily`. **The only
INSERT into that table in the entire repository was `packages/db/src/seed.ts`.** No cron, no order
hook, no backfill. Measured on the dev DB, 2026-08-03:

- **six of seven stores had ZERO rows.** `kopi-senja` holds 3 completed orders / Rp450.000 and its
  seller was told *"Belum ada penjualan pada periode ini."* Every store created through `/daftar` or
  the super-admin is in that state — i.e. every real merchant.
- **on the seeded store the rows stopped the day the seed ran**, so ONE screen contradicted itself:
  "Penjualan hari ini **Rp0**, −100,0% vs kemarin" and a chart labelled "30 Hari Terakhir" whose axis
  read **5 Jun → 2 Jul**, directly above "Pesanan Terbaru" listing orders placed that morning.

⚠️ `dashboard.ts` carried a comment about this gap concluding *"they do not visibly clash"*. It was
false, and it is the reassurance that let the bug live. Rewritten, not deleted.

**The shape: derive at read time.** `getDailyStats()` was the table's only reader, so this is one
function body — every downstream derivation keeps its `DayPoint[]` contract. A **cron** was rejected
(one more thing that stops silently; this repo has a documented history of exactly that, and a
stopped cron reproduces the bug being fixed). A **database view** was rejected (needs a destructive
migration to drop the table, and changes the RLS story; the query as written runs under
`withCurrentTenant` → `SET LOCAL ROLE tokophi_app`). Pointing each screen at `orders` was rejected:
it duplicates "what counts as revenue" across the chart, the KPIs, the tiles and the sparklines.

- **Revenue is `total_idr - tax_idr` on non-cancelled orders** — the SAME expression
  `getChannelSalesDaily` / `getRegionSales` / `getOrderStats` already use, so the chart total now
  equals the Sumber Penjualan total instead of contradicting it.
- **The series is DENSE** (`generate_series` LEFT JOIN the aggregates) and its last row is TODAY.
  `resolve()` slices it positionally, so a bare `GROUP BY` would make "7 hari terakhir" mean "the
  last 7 days that sold something".
- **`visitors` was NOT invented.** It has no source in `orders`, so it is counted from
  `analytics_events` (`type='visit'`) — the same rows `getVisitsKpi`/`getConversionKpi` already
  count, with `count(*)` so the two cannot disagree. A store the tracker has never written for gets
  0 and the UI renders **"—"**. Same for the funnel and the device split: real source or an honest
  empty state, never a number.
- ⚠️ **THE DAY IS WIB, AND THERE IS NOW ONE DEFINITION OF IT** — `apps/admin/lib/data/day-bucket.ts`.
  The container's `TimeZone` is UTC, so "hari ini" used to start at 07:00 WIB and every merchant's
  previous evening fell into "kemarin". All five day-bucketed queries (daily, hourly, channels,
  product sales, funnel, devices) go through `dayKey()`, because the client matches their date keys
  against each other with `Set.has` — a query bucketing differently stops reconciling *silently*.
  Assumes WIB for every store (`stores` has no timezone column; WITA/WIT merchants read a boundary
  1–2 h off theirs — stated, not hidden).

**What happened to the seeded rows:** the seed no longer writes them and nothing reads them. The
table is kept (dropping it is a destructive migration) and marked RETIRED in `schema.ts`. Rows in an
existing database are inert — they can no longer disagree with `orders`. **Do not restore the seed
insert.**

### Frozen date anchors still in runtime code (the twelve fixed earlier missed these four)

- **`dashboard.ts` "Bulan Ini" was `startsWith("2026-06")`**, "Bulan Lalu" `"2026-05"` — the seed's
  frame. On 3 August, choosing "Bulan Ini" showed **June**, driving five KPIs, the chart and six
  derived cards on `/` and `/analitik`. The month is now the month the series ends in, i.e. the
  server's today, arriving as a prop (SSR and the client cannot disagree).
- **`produk-client.tsx` compared against `TODAY` from the mock** (2026-06-30), so "7 hari terakhir"
  was a **41-day** window widening by a day per day. The clock is read in the data layer
  (`serverNowTs`) and handed down — not in the client (hydration mismatch) and not inline in the page
  (React Compiler's impure-in-render rule).
- **`hourlyFor` (mock) splattered a real daily total over 24 hours on a hard-coded curve**, on a page
  whose comment says "nothing on this page is synthesized". The intraday chart now buckets
  `orders.placed_at` by WIB hour; the 24 bars sum to the day's own total. No rows ⇒ zero bars.
- **`BLOG_CATEGORIES` (mock) drove the `/blog` tabs, their badges and the editor's picker.** It is
  the pair the seed writes for the demo store, so any other store saw two names it does not have and
  every badge read 0. All three now read the store's own `blogs` rows.
  - The picker was also a **dead control** — `blog` never left the editor's local state (it was not
    on `ArticleInput`), so moving an article to another blog showed a success toast and moved
    nothing. It persists now, via an id read back under RLS in the same txn (child-table rule).
  - **`createArticle` crashed on a store with no `blogs` row** (`blog!.id` on an empty result). Only
    the seed writes that table, and only for the demo store — so no merchant onboarded through
    `/daftar` or the super-admin could ever publish an article. A store with none now gets a "Blog".

### Verification

`npm run build:admin`, `npx tsc --noEmit -p apps/admin/tsconfig.json`, `npm test` (238 tests) all
clean; admin ESLint **41 problems (19 errors, 22 warnings)** — one fewer than main's 42, nothing added.
`npm run verify-rls` green (13/13).

**Driven in a browser against a scratch clone** (`pg_dump tokophi | psql tokophi_scratch_analytics`,
dropped afterwards), as two stores, every figure reconciled against SQL over the same window:

| | Hari ini | 7 hari | 30 hari | Bulan Ini | Bulan Lalu |
|---|---|---|---|---|---|
| **batik-nusantara** (screen) | Rp1.738.428 / 6 | Rp14.283.120 / 42 | Rp63.227.855 / 186 | Rp6.896.218 / 20 | Rp65.087.552 / 188 |
| **batik-nusantara** (SQL) | 1738428 / 6 | 14283120 / 42 | 63227855 / 186 | Aug 6896218 / 20 | Jul 65087552 / 188 |
| **kopi-senja** (screen) | Rp0 / 0 | Rp0 / 0 | Rp0 / 0 | Rp0 / 0 | Rp150.000 / 1 |
| **kopi-senja** (SQL) | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | Jul 150000 / 1 |

`kopi-senja` has **zero `analytics_daily` rows** — the case that rendered an empty dashboard before.
The "30 Hari Terakhir" axis reads **7 Jul → 3 Agu** (was 5 Jun → 2 Jul); "Bulan Ini" is August. 0
console errors on kopi-senja; the two on batik are `404 /api/uploads/produk-…webp` (the gitignored
uploads dir is not populated in a scratch environment), unrelated.

`apps/admin/lib/data/daily-stats.test.ts` — 13 checks. The pure half pins the range resolver; the
Postgres half runs the REAL exported query under `SET LOCAL ROLE tokophi_app` + the `app.store_id`
GUC, in rolled-back transactions. **Its failure path was exercised, not assumed**: flipping
`STORE_TZ` to `"UTC"` turns 3 of them red. `vitest.config.ts` gained the `@/` alias — without it no
suite could import `lib/data/*` at all, which is why this layer had no tests.

## Unreleased — The quote and the booking priced different parcels; the merchant paid the difference

Owner-authorised end-to-end run of the shipping chain. It found a money bug before it reached the
booking, so the run became the fix.

🔴 **`createShipment` has always sent `length/width/height` when it books. The QUOTE sent weight
alone** — `kaShippingPrice` had no dimension parameters at all. KiriminAja applies **volumetric weight
(w × l × h ÷ 6)** whenever it exceeds the actual weight, so the two calls described different boxes.

Measured on the live sandbox — one 1.000 g order, 6138 → 2107, SPX Reguler:

| request | quote |
|---|---|
| weight only — what the shopper was charged | **Rp13.700** |
| weight + 40×30×20 cm — what the booking cost | **Rp54.800** |
| weight 4.000 g (the volumetric those dims imply) | **Rp54.800** — identical, to the rupiah |

**Rp41.100 on one parcel, 4× the quoted price, absorbed by the merchant** on every bulky-light order.

**Fixed:** `weightForCart` and `weightForOrder` read `products.length_cm/width_cm/height_cm` (⚠️ they
hang off `products`, not `product_variants`) and return the max per axis — the same rule the booking
uses; `kaShippingPrice` forwards them; **they are part of the rate cache key**. Guarded by
`shipping-dimensions.test.ts`, proven red 5/5 against `origin/main`.

⚠️ **Two corrections to yesterday's audit, both mine.** The earlier note said dimensions were
"structurally impossible today" — it had checked `product_variants`, which carries only
`weight_grams`, and missed that `products` has had the columns all along. And the pickup schedule is
**not** naive: `createShipment` books tomorrow 10:00 WIB in `Asia/Jakarta` with the cut-off reasoning
written down; a first test script used `now + 1h` and was correctly refused.

**N32 is not fully closed.** `shipping_price` returns real services and `request_pickup` reaches the
API and validates our payload — it refused a bad schedule with a specific, correct error rather than
accepting it — but a successful booking was not completed. Runbook with the remaining steps:
`specs/docs/tasks/2026-08-03-shipping-e2e-runbook.md`.

**The shared DB was left exactly as found** (row counts identical; the one product whose dimensions
were set to 40×30×20 for the measurement is back at `1×1×1`).

## Unreleased — Shipping audited against KiriminAja's own docs: we do not bill volumetric, they do

Docs only. Every endpoint our code calls, cross-referenced against the captured official documentation
and probed against the LIVE sandbox — read-only calls, nothing booked.

🔴 **N30 — volumetric weight is never computed.** Their pricing doc is explicit that the dimensional
weight (`w × l × h ÷ 6`) is used when it exceeds the actual weight. We send a **floor**
(`max(Σ weight_grams, 1000)`), and `product_variants` has no dimension columns at all, so it is not
merely unimplemented — it is structurally impossible today. Measured live: **1.000 g → Rp14.000,
3.000 g → Rp42.000**; a 30×30×30 cm box is 4.500 g volumetric, so a bulky-light parcel is under-quoted
by ~**Rp28.000** and the merchant absorbs it with nothing on screen saying so.

**N31** — every quote carries `setting.cod_fee` / `minimum_cod_fee` / `cod_fee_amount` and nothing in
the repo reads any of them, so a COD merchant never sees the fee deducted from their payout.

**N32 — the resi chain has never been exercised.** Every link is correct on inspection (`createShipment`
writes `awb` only from `details[0].awb`, `cron/tracking` backfills it excluding the booking ref,
`ka-tracking.ts` routes the outcome through `applyOrderStatusChange`, three screens render it, with
"Ambil resi" and "Lacak" as manual paths) — but `orders.ka_order_id is not null` returns **0**. Not one
order has ever been booked; the 58 `dikirim` rows were seeded into that status. Finishing the check
means a real `request_pickup` against the sandbox, which creates a pickup record in the owner's account.

**Confirmed correct, do not re-check:** endpoint versions match the docs and genuinely vary per route;
`province` is a POST returning `datas` (a GET is refused); live sandbox auth returns 37 provinces.


## Unreleased — the `/checkout` h1 fix shipped without a guard; `check-h1-floor` now sweeps 10 routes

`check-h1-floor` is about the merchant-built **homepage** — it stages a `page_templates` row and asserts
the floor under it. So the `/checkout` fix landed covered by nothing, which is how this class comes back.

It now also sweeps the ten plain routes a shopper lands on. ⚠️ **`/checkout` and `/checkout/sukses` are
both in the list on purpose**: they share `CheckoutLayout`, so the tempting fix — a floor in the layout —
gives `sukses`, which already has a visible `<h1>`, a second one. One asserts the floor exists, the other
asserts the fix did not overshoot; only together do they pin it.

Proven red by deleting the `<h1>` and re-running: `FAIL /checkout has exactly 1 <h1> — h1 0`.

## Unreleased — Both login pages published a working credential; the control plane's was one of them

Verified live on production before the fix: `rich.tokophi.com/login` served `admin@tokophi.id` +
`tokophi123`, `app.tokophi.com/login` served `ongki@batiknusantara.id` + `tokophi123`. **Not
placeholders** — the seed creates those rows on deploy, so these were working logins on the public
internet, on the page that accepts them. `#133` fixed the half that MINTS (`createStore`); the account
the seed creates and the page advertised survived that fix.

⚠️ **It was FOUR sites, not two.** Besides the two `Dev: …` lines, **both email inputs carried a
`defaultValue` naming the account**. Deleting only the password line leaves the page publishing *which
account to attack* — and the login limiter is keyed on **IP, not account**, with **no failed login
written to any table**, so nothing would record that one specific operator was being tried. The
`placeholder` shows the shape without naming anyone.

**Guarded by `packages/lib/src/no-published-credentials.test.ts`**, a source scan over **every** app
file rather than a list of two — a list of two is exactly how the 24-bit mint survived its own guard in
`#137`. Proven red first: **4 of 5 tests fail** against `origin/main`.
⚠️ It **strips `//` and `/* */` comments before matching**, on purpose: `super-admin/lib/actions.ts`
legitimately names `tokophi123` while explaining the fix, and a guard that forbids describing the bug it
guards gets deleted the first time someone needs that sentence. **HTML comments are not stripped** —
`<!-- … -->` in an `.astro` file is served to the browser.

**Deliberately NOT done:** the seeded password is unchanged, so `tokophi123` still authenticates for
anyone who already knows it. Owner's call — rotating it touches the seed, and **the seed is not a
migration**, so existing deployments need a manual data fix. Filed as `NEXT.md` **N29**.

## Unreleased — Five browser checks, five invocation conventions, three phantom regressions

### 🧪 `npm run verify -w @tokophi/storefront` — one runner, one env contract

The storefront's five checks had each invented their own invocation: two different meanings of `T_URL`
(an origin in one file, a full PDP URL in another), an `H1_PORT` that was deliberately not `PORT`, four
default ports (4373 / 4374 / 4392 / none) and a `DATABASE_URL` requirement on one of them. Every one was
locally reasonable and the SET was not runnable. On **2026-08-02 a reviewer started one server, pointed
three of them at it and reported three regressions that did not exist.**

Fixed by CONVERGING them, not by wrapping them — a wrapper that papers over five conventions leaves five
conventions for the next person who runs one by hand. `scripts/check-env.mjs` now owns the contract:
**`CHECK_BASE_URL`** (an origin; the hostname selects the tenant, ADR 0009) and **`DATABASE_URL` from the
environment**. `T_URL` / `H1_PORT` / `DPR` are retired and **exit 1 if set** — silently running the
default while the caller believes they aimed elsewhere is exactly what produced the phantom three.

`scripts/run-checks.mjs` builds if the build is stale, starts **one** server, waits for a **200 for the
tenant host** (not merely for the port to answer — a 404 means every check below would be measuring
"Toko tidak ditemukan"), runs all five, prints a table and exits non-zero on any red. It signals **only
the process group it spawned**, including when a check throws or on Ctrl-C — never `pkill`, which in this
repo kills other agents' servers. A busy port fails in a second with the port number, never hangs.

**Three results, not two.** `SKIP` (exit 2) = the check does not APPLY to the data it was pointed at.
It is printed with its reason every run and never counted as a pass.

### 🔴 `check-pixel-defer` was red on clean `main`, forever — and its loudest claim was vacuous

It demanded `hosts.length === 3` while `store_tracking_channels` holds exactly one row
(`batik-nusantara | meta | t`), so no change set could ever make it green. **An alarm that is always on
is an alarm that is off** — the `verify-rls` lesson, which this repo paid for with two cross-tenant leaks
that shipped past a verifier that was already failing. It now reads the enabled channels for the tenant
the host resolves to and asserts what was always meant: each is stubbed synchronously, buffers an event
fired before its SDK exists, and loads on interaction — plus the reverse, that **nothing loads for a
channel that is switched off**. No channels at all ⇒ SKIP.

⚠️ And its "no vendor `<script src>` in the served HTML" claim — the one its own comment calls *THE
DETERMINISTIC CLAIM* — was fetched with `fetch(…, { headers: { host } })`. **Undici derives `Host` from
the URL and silently discards yours**, so that request arrived as `Host: 127.0.0.1`, resolved to no store
and was answered by the 404 page, which of course contains no vendor scripts. It had proved nothing since
the day it was written. Now `getAsTenant()` (node:http), and the 200 is asserted alongside the claim.
`check-h1-floor` had used node:http all along and said why; the others did not. That is what a per-file
convention costs.

## Unreleased — Every route on all three apps, driven in a browser

A sweep, not a read-through: enumerate routes from disk, cross-reference against the sidebar, then load
each one logged-in and record status, `<h1>` count, heading-level skips, console errors and horizontal
overflow at 390 px. **admin 40/40 and storefront 14/14 are now clean.**

**Routing was already clean and that is a result**: 0 dead nav links, 0 unreachable pages across all
three surfaces. The nine admin routes absent from the sidebar are all reached deliberately (the `/akun/*`
trio from the avatar menu, the six `*/baru` screens from their list page) — verified by grepping for a
link to each, not assumed.

🔴 **`/checkout` had no `<h1>` at all** — the one page a shopper hands their name, phone and address to,
and the only money-path page without one. Highest heading was `<h2>Ringkasan Pesanan`. Third instance of
the class after the builder homepage (N11) and the hero carousel (N14).

⚠️ **The fix is `sr-only`, and it is in the PAGE, not `CheckoutLayout`.** Not visible because the note
directly above it records that the visible "Checkout" title was removed deliberately on 2026-07-16. Not
in the layout because its other consumer, `checkout/sukses.astro`, already renders a visible `<h1>` — a
floor there would have given that page **two**, which is the N14 defect reintroduced by the fix for
N11's. Two consumers, one already correct: fix the one that is wrong.

**`/halaman/baru` had no `<h1>`** — `PageEditor` gated its heading on `{isEdit && …}`, so only the CREATE
screen lacked one, while `topBarTitle` was already computing `"Tambah halaman"` for that exact case. The
guard was hiding a string it had built. `article-editor.tsx` next door renders its own unconditionally.

**`/navigasi` and `/pemasaran` skipped h1→h3** — `<h3>` on pages with no `<h2>`. Tag changed, `className`
untouched: the size comes from `text-sm`, not the tag.

**Recorded so nobody re-chases them:** the `/api/uploads/*` 404s on six admin pages are **local only** —
`public/uploads/` is gitignored, and production mounts a named volume and serves all of them, so merchant
media survives a deploy. ⚠️ A dev-DB filename tested against the production server proves nothing; that
misread briefly looked like a broken store logo in production. The storefront's
`ERR_CONNECTION_REFUSED` is the admin origin absent from an isolated scan, and the single 390 px overflow
hit was `/sitemap.xml` — XML in a browser, a false positive of the check.

**super-admin: gating verified (all 7 routes 307 to login), screens NOT crawled.** It needs a platform
credential, and since `#133` that password is randomly minted and revealed once — obtaining one means
resetting a control-plane password on the shared DB. Filed as N28 rather than done badly.

## Unreleased — Validating wave 3, and one blog-order rule the storefront could not reach

An audit of `#133` rather than a new front beside it. Two things came out of it.

🔴 **`NEXT.md` was stale on FOUR entries — N19, N20, N21, N23 — all done in `52ef1de`, all still marked
open**, three tagged `NEW`. That file is what four other docs point a starting session at, so stale in
this direction means the next session rewrites finished work. It nearly did: N19 was picked precisely
because it looked untouched, and `seedCheckoutSessions` was already three lines from the bottom of the
file being opened to add it. **Close the entry in the same commit as the code.**

**Validated by running, not reading** — the repo's own rule is that an item is checked off because you
ran it. N19: 900 carts inserted, **second run inserted 0** (idempotent), and both kinds of `pulih` are
present — **rescued 89 vs straight-through 86** — so the metric trap `abandoned_at` exists for is
actually exercised; 175 recovered rows, 0 dangling `recovered_order_id`. N20 and N21 were validated by
**breaking them on purpose**: a fake section type produced the exact `not assignable to type 'never'`
error, and a capability added the careless way turned the RBAC census red. Both reverted.

⚠️ **The blog order was one rule in two places, and only one of them was fixed.** N23's
`publishedFirst()` (`published_at desc nulls last, title asc`) landed in `apps/admin/lib/data/`, **which
the storefront cannot import**, so `content.ts` kept its own bare `desc(publishedAt)`. That is the N17
shape one week later — a rule in the wrong package is a rule only one surface can obey. It now lives in
`packages/db/src/article-order.ts` and both apps call it; it imports `./schema` directly, never the
barrel, so it does not drag in `client.ts` and stays testable without a `DATABASE_URL`.

**Said plainly in the code: on the storefront query `nulls last` changes nothing today** — that query
filters `status='terbit'` and `publishedAtFor()` guarantees a published row has a date. What it buys is
determinism (`title asc` settles two posts published in the same second, which a bare `desc` leaves to
the query plan) and the removal of a correctness dependency on an invariant held in a *different app*.

The sweep that found it is mechanical and worth re-running: parse `schema.ts` for nullability, grep
every `desc(schema.X.Y)`, cross-reference. 31 sites → 2 candidates → 1 real. The class has now shipped
three times.


## Unreleased — The header shipped a 600 KB lie: bare `<img>` on every page, and a descriptor nobody could check

### 🖼️ `Header.astro`'s three catalog images were bare `<img>` — 74 490 B for five 44 px thumbnails (N22)

They render on **every page of the shop**, and with no `srcset` the browser has exactly one file to
fetch: the full-size original, whatever box it is painted into. Measured on a cold `/`, unique bytes over
real HTTP: **desktop 1440 DPR 1 133 612 → 59 122 B (−55,8 %)**, DPR 2 212 486 → 171 982 B (−19,1 %);
**mobile 412 DPR 1 62 704 → 45 108 B (−28,1 %)**, DPR 2 152 894 → 142 152 B (−7,0 %). Pure waste: the
same products' 200w/400w renditions were already on the wire for the product cards beside them.

Three sites, **three separate `sizes` derivations**, each from its own box and named as a constant with
the arithmetic written out — `44px` for the mega-menu thumb (`h-11 w-11 shrink-0`), `406px` for the
featured tile (the `max-w-7xl` container is pinned at 1280 for every viewport the `xl:flex` nav exists
at, so it is a constant, not a fraction), and `(min-width: 416px) 186px, calc((100vw - 44px) / 2)` for
the drawer's two-up grid. All three verified against the built server: 44 / 406 / 184 px.

⚠️ **A `max-w-*` is only a `sizes` if you can name the viewport at which it starts binding.** On the PDP
thumbnail rail it caps a `flex-1 basis-0` share and declaring the cap cost a whole rung (17 468 B); on
the drawer, the same class on a `w-full` element pinned to the viewport binds exactly at 416 px. Same
class, opposite answers.

⚠️ **The featured tile was NOT worth changing and the number is 0 B** — at 406 px it needs the 600 px
source at both DPRs, so it resolves byte-identically to the bare `<img>`. It carries the srcset anyway,
because on a merchant's own uploads the same markup ladders to 2000w for that 406 px box.

`check-pdp-srcset.mjs` **now FAILS** on a bare catalog `<img>` instead of printing it. The claim is
STRUCTURAL, not ratio-based: the mega menu (`xl:flex`) and the drawer (inside an `xl:hidden`) are never
both on screen, so one is always `display:none` at any viewport this check can adopt — and an `<img>`
with no srcset cannot be right at any width, so it needs no measurement to be judged. The store logo is
the one exemption (`data-logo`, now on the footer's copy too): an upload of unknown aspect ratio rendered
`h-9 w-auto` has a CSS width set by the file's own proportions, so a `sizes` for it would be a guess.

### 🔴 Every `w` descriptor on a static image was a constant, and three of the four were wrong (N24)

A `w` descriptor is the one field in a srcset candidate **the browser cannot verify** — it trusts the
number, picks on it, and paints whatever bytes arrive. `staticSrcSet` labelled the source original from a
per-directory constant. Read off disk with sharp, all 75 sources:

- `/products/` claimed **`800w`**; **14 of the 70 are 600 × 600** — and they are exactly the
  `<handle>.webp` of every product, i.e. the FIRST image, the one on every card, every menu thumbnail and
  every PDP. Over-claim 33 % on the most-rendered image in the catalogue.
- `/sections/` claimed **`1920w`** for **both** its files, and neither is: `denim-standard` is
  **1200 × 960** (over-claim 60 %) and `lookbook` is **2000 × 784** (under-claim). ⚠️ These had never
  been checked at all.
- `/hero/` claimed `1920w` and all three really are 1920 × 1080 — the only honest branch.
- All **150 generated renditions** are honest: every `-<N>w.webp` really is N px.

**Fixed by correcting the declaration, not by generating a rendition** — an `800w` from a 600 px source
is an upscale, which the generator refuses to do and which would be bytes for nothing.
`gen-image-widths.mjs` now writes `src/data/static-image-widths.ts`: each source's **real intrinsic
width** plus the renditions that **actually exist beside it**. `staticSrcSet` reads only that, and
`STATIC_WIDTHS` is deleted. That also retires the old "`STATIC_WIDTHS` and the script's `PLAN` must stay
identical" convention by making it structural — the ladder *is* the list of files that were generated, so
a rung with no file on disk (a 404 the browser may pick as its best candidate) can no longer be listed.
An image missing from the manifest gets **no** srcset: no claim beats a wrong one.

Byte impact today is **0** — this is honesty, not a saving. What it buys is that the next `sizes`
decision is made against a true number. Guarded by **`scripts/check-image-widths.mjs`**: sharp against
disk, no server and no browser, so it cannot flake.

## Unreleased — The abandoned-cart recovery link was never minted, because the mint was in the wrong app

`signRecoveryToken` was correct, store-bound and security-reviewed — and had **zero callers in all four
apps** for the life of the feature. It lived in `apps/storefront/src/lib/recovery.ts`, a path the ADMIN
cannot import, and the admin is the only surface that lists abandoned carts.

So the merchant's WhatsApp message carried `{nama, produk, toko}` and **no way back to the cart**, and
~50 lines of storefront code — `verifyRecoveryToken`, the "Selamat datang kembali" banner, the basket
restore, the field pre-fill — were live and unreachable. Nothing failed: a shopper who never returns is
indistinguishable from one who changed their mind. Four docs recorded it as working.

**A module's location is part of its contract.** The pair now lives in `@tokophi/lib/recovery` (with
`jose` declared rather than relied on via hoisting); the storefront keeps its import path via a
re-export. `getAbandonedCarts` mints per cart **that has a phone**, on `sessionId` (the row `id` would
verify fine and match no row), against `getStorefrontHost()` — the **active primary** custom domain,
else `<slug>.<base>`, agreeing with the storefront's `primaryOrigin()`.

⚠️ **`cartMessage` APPENDS the link when the template has no `{{link}}`, and that fallback is the fix.**
The seed is not a migration, so no existing store's body has a placeholder — substitution alone would
have shipped and changed nothing for a single live merchant.

⚠️ **`{{link}}` was deliberately kept OUT of the seed.** The same `keranjang` body is rendered by three
CRM screens working from `followups` rows, which have no checkout session and cannot mint a link — and
`fillTemplate` passes an unknown token through verbatim, so seeding it would have sent the literal string
`{{link}}` to a customer. Those three now pass `link: ""`.

⚠️ **`CHECKOUT_RECOVERY_SECRET` must be set on BOTH surfaces or neither** — they resolve it
independently, and a mismatch fails silently as a checkout that does not restore.

**Driven in a browser, because the restore path had never been run in one:** admin login → the real
`wa.me` body → that exact link → banner, cart (`1x Gamis Syari Polos`), name, phone and address all back,
session id reused; a second cart restored a subtotal matching `checkout_sessions.subtotal_idr` exactly.
Foreign-store, tampered and junk tokens all refused with the normal empty checkout, never a 500. The
shared dev DB was left untouched (the link was read from the RSC payload rather than clicking the button,
which would have written a `followups` row).

Guards: `packages/lib/src/recovery.test.ts` (round trip + three refusals), `apps/admin/lib/cart-message.test.ts`
(append vs substitute; no literal `{{link}}` can reach a customer), and **`apps/admin/lib/recovery-wired.test.ts`
— the mint has a caller**, which is the failure no unit test can see and the one that would have caught
this. `cartMessage` moved to a pure module so it is testable without a `DATABASE_URL`.


## Unreleased — Every store we provisioned got the owner password `tokophi123`

Audit wave 2: ten read-only agents against `origin/main` @ `86e3ec3`, one worktree each, then seven change
sets. The consolidated record is `specs/docs/audit-2026-08-01/FINDINGS-SOURCE.md`; the session handoff is
`specs/docs/tasks/2026-08-01-audit-wave-2.md`.

### 🔴 `createStore` hashed the new owner's password from a constant published in this repository

`apps/super-admin/lib/actions.ts:27,107` used `DEV_PASSWORD` — the string `tokophi123`, which appears in
this repo and in `AGENTS.md`. Onboard `budi@tokosaya.com` and anyone who knows that email address logs in
at `app.tokophi.com` as store **owner**: every order with the buyer's name, WhatsApp and full delivery
address, every customer record, and through `settings:write` the bank account and `requestPayout`.

`AGENTS.md` already carried the rule — *"Never mint a fixed password. Random per invite, revealed once"* —
and `invitePlatformAdmin`, **250 lines below in the same file**, was already fixed, with a comment
asserting the other paths were correct. **Instance patched, class missed.**

Random per store now, returned by the action and revealed once in a **persistent toast** — a toast and not
a dialog, because the handler `router.push`es immediately and a dialog would unmount, while `<Toaster>`
lives in the root layout. An action that returns a password the UI drops on the floor leaves the merchant
unable to log in at all. Proven on `tokophi_test`, rolled back: `verify('tokophi123') = false`,
`verify(minted) = true`. `no-fixed-password.test.ts` guards the **class** — any `hashPassword()` call that
receives something other than a freshly minted value, any minting action that fails to hand it back, any
write anchored to a frozen date. Proven red (3 of 5) before green.

⚠️ **The code fix does not repair an account already provisioned.** Check production for owners whose
`password_hash` verifies against `tokophi123` and rotate them — that is the only step that closes the
existing exposure.

🔴 **NOT fixed, needs a decision:** both login pages print the seeded dev credentials on screen, and the
seed genuinely creates those rows on deploy — so the control plane advertises a working credential on its
own login screen. Delete the hint or rotate the seeded password; it touches the seed and both apps.

### The same action stamped four columns with a frozen date while computing the trial from the clock

`createStore` wrote `2026-07-02` into `accounts.created_at`, `stores.created_at`,
`store_users.accepted_at` and `store_stats.updated_at` while deriving `trialEndsAt` from `now()` — one
row, two clocks. **A store was born ~30 days old with a 3-day trial and dropped out of `newSignups30d`
permanently on its first day.** All four are `defaultNow()`; the trial length reads `BILLING.TRIAL_DAYS`,
matching `provision.ts`.

## Unreleased — Twelve frozen "today" anchors, and one of them rewrote data on every save

The seed may be anchored to `2026-06-30`. The app is not. `AGENTS.md` records this class **twice already**
— the discount editor's `ADMIN_TODAY` made every voucher a merchant created born already expired, and the
super-admin healthcheck read a live store as −23 hari.

### 🔴 The write: re-saving a published article walked its date backwards

`actions/articles.ts` stamped `publishedAt = 2026-06-30`, and `fields()` is a full replace — the same
mechanic as the voucher bug, one file over. `updateArticle` now reads the row's current `publishedAt`
inside `withTenant` first, and **that read doubles as the tenant check**: a foreign id returns nothing and
the update is skipped, mirroring `updateDiscount`. Extracted to `lib/publish-date.ts` because a
`"use server"` module can only export async actions, so it could not otherwise be tested.

Proven against real Postgres, rolled back: three saves of an article truly published `2026-07-20 08:30`
landed on `2026-06-30` **every time** under the old code and stayed unchanged under the new; a draft's
first publish stamps today, where it used to stamp a date already in the past.

### The reads (ten)

A follow-up due today computed **+32**, so the CRM overdue filter `dueDays <= 0` could not fire for it;
customer-detail rendered "Pelanggan sejak −32 hari lalu"; the whole Seller activity feed read
"0 menit lalu", because `Math.max(0, ANCHOR - d)` clamped every event dated after the anchor.
`lib/mock/store.ts` and every `packages/db/src/seed*.ts` anchor stay frozen deliberately.

⚠️ **Keranjang Ditinggal drops from 796/340 to 6/143 on dev, and that is CORRECT.** Un-anchoring
`data/checkout.ts` moves `WINDOW_START` as well as the ages — the old window was a frozen `2026-06-02`
start with **no upper bound**, 60 days on 1 Agustus and growing, labelled "30 hari". The drop is a **data
gap, not a regression**: the seed's newest `ditinggal` row is `2026-07-15` and `seed:recent` inserts no
`checkout_sessions`. **Extend the seed. Do not re-anchor the app to make the demo look busy.**

Also: `markLabelsPrinted`'s caller toasted `printedNumbers.length` instead of the `.done` the action
returns from `.returning()` — the action was fixed in `#117` and its caller was not. The copy now branches
when the two differ, instead of lying in the other direction.

### Docs corrected: the abandoned-cart recovery link is never minted

`signRecoveryToken` has **zero callers** in all four apps and no `wa_templates` row contains a link
placeholder, so the merchant's WhatsApp message carries no way back and ~50 lines of storefront code — the
verifier, the "Selamat datang kembali" banner, the basket restore, the field pre-fill — are unreachable.
`REQUIREMENTS.md` SEC-13 said MET, `UI_INVENTORY.md` said "real DB", `CODE_MAP.md` said "mints/verifies",
`STATUS.md` said the links are signed and not guessable. SEC-13 now reads **`VACUOUSLY MET — NO LINK IS
EVER MINTED`**, which separates what is true (no raw-id path exists; the verifier is correct and
store-bound) from what is not. Wiring it is a P1 in `BACKLOG.md` with the four steps.

## Unreleased — The sixth default-location copy, on the one connection with no RLS

### 🔴 `/api/public/order` resolved a stock row without proving whose it was

`#127` routed five copies through `lib/inventory-location.ts` and left this one: the public order route
defined its own `defaultLocationRow(variantId)` with **no `store_id` predicate at all**. It is the worst
of the six — no session, the **OWNER connection with RLS off**, and `inventory_levels` has no `store_id`,
so the `locations` join **picks** a row without proving whose. `order by loc.is_default desc` will prefer
another store's default warehouse.

Routed through `defaultInventoryLevelId(db, variantId, store.id)` now, using the id the route already
resolves from `stores.slug`. `#127`'s contract says a `null` return is **ambiguous** — "not stocked yet"
and "not ours" are indistinguishable — so each of the three sites handles it by what it is: the pre-check
is a READ and refuses either way (ownership is proved separately, one query above); the `FOR UPDATE` gate
**refuses, never skips** (skipping would sell stock we cannot prove we have); and the decrement resolves
nothing at all now — the lock loop records `inventory_levels.id` in a spend map and the write targets that
id, so check and write are the same **row**, not the same expression re-evaluated. Stronger than before.

⚠️ **Correction to `#127`'s framing.** `NEXT.md` said seven copies and "only the last one carries the
tenant filter". There were **eight**, and that claim is false — `products.ts:91`/`:135` carry it too, and
the four join-based admin copies run inside `withTenant` where `locations` is RLS'd. The genuinely exposed
sites were **two**: `order-status.ts` (the courier webhook, owner connection) and this route.

### `desc()` is NULLS FIRST, so two screens named two payment methods for one order

Drizzle's `desc()` emits a bare `DESC`. `data/order-detail.ts:306` used `desc(payments.paidAt)` while
`data/orders.ts:234` used `paid_at desc nulls last` — and **both files carried comments asserting they
matched**, the detail one reading *"Must match the LIST's definition exactly … One order, one answer."*
One exported `latestPaymentFirst()` serves both, with a real-Postgres test proven red then green.

**Latent, not live:** 827 payments, 46 with `paid_at IS NULL`, **0** orders currently carrying both
shapes. ⚠️ **And it is NOT a money bug**, though an earlier draft said so: both comments claim this
ordering feeds `createShipment`'s cash-collection instruction and it does not —
`actions/shipping.ts:512` derives COD from `exists (select 1 from payments … method = 'cod')`, an
existence test no `ORDER BY` can affect. The comments now say so. The same two files have now been found
carrying two false comments each.

*Same class, lower stakes, still open:* `data/articles.ts:57` sorts every draft above every published post.

## Unreleased — 22 money tests that had never run on anyone's machine

`apps/admin/lib/ledger-credit.test.ts` skips without `TEST_DATABASE_URL`. It guards what only a database
can settle — that a double-credit is impossible (three partial unique indexes), and
`select sum(…) for update`, which Postgres rejects outright and which `tsc` cannot see inside a SQL
string. It ran only if a developer happened to export that variable by hand. Nobody did, and there is no
CI here, so **22 tests over the code that decides when a sale becomes withdrawable had never run**.

The skip was deliberate and well-meant — it kept `vitest run` green on a laptop with no test DB. The cost
was silence.

`test/db-setup.ts` (a vitest `globalSetup`) derives `<DATABASE_URL>_test`, creates that database if absent,
migrates it to head and exports `TEST_DATABASE_URL`. The container is already required to run the app:

```
before   16 files passed, 1 skipped   145 passed, 22 skipped
after    22 files passed              182 passed,  0 skipped
```

⚠️ **The guard is the point:** the resolved name **must** end in `_test` or setup throws. These suites seed
stores, orders and payments; they roll every transaction back, but pointing them at the shared dev database
must stay impossible. **Do not relax it.** An unreachable database still skips — with a banner naming the
reason and the command to fix it — so a machine without Docker gets a green run instead of a wall of noise;
`npm run test:db` turns that skip into a failure. Use it before a PR.

## Unreleased — The star rating was 30% of the homepage DOM

`dom-size` scored **0** at 992 elements. `NEXT.md` named two candidates and measurement killed **both**
before a line was written: deferring the carousel slides buys ~30 elements of a 106-element hero and costs
the crawler and the no-JS reader the copy; cutting what the default template seeds is **zero delta by
construction**, because the seed is not a migration and reaches new stores only.

Counted in Chromium at 412×915 DPR 2 instead. `Stars.astro` drew each rating as two layers of five
separate `<svg>` elements — **26 elements, twelve times per homepage: 312 elements, 30% of the page**. One
`<svg>` with five `<path>`s per layer, geometry moved into the `viewBox`, is **17**.

```
homepage DOM   1023 -> 915   (-10,6%)
/ HTML         213 192 -> 210 252 B
dist/client    0 delta
```

Verified by **pixel A/B** over 40 rating widgets: byte-identical at DPR 8 and DPR 2; at DPR 3, 8 of 40
differ by 1–2 pixels out of 45 288, max channel delta 5/255, all on the fractional-fill clip edge. (The
cross-validator's re-run found 36/36 identical at DPR 1 and 2 but **34 of 36** differing at DPR 3, at the
same sub-pixel magnitude — the two runs agree on magnitude and disagree on count. Recorded, not smoothed.)

**Honest limit:** 915 is under Lighthouse's 1400 median and still over its 800 p10 — the audit improves
without passing. The next largest repeats are the header and footer lucide icons.

## Unreleased — Three `<h1>`s on every homepage, and a 2000px original in a 66px tile

### 🔴 The homepage `<h1>` count was wrong in BOTH directions, and a third case fell between them

N11 fixed the *missing* `<h1>` (a Store Builder homepage with no Hero). This is the other half, N14:
`Hero.astro` rendered the heading **inside the slide loop**, so the seeded 3-slide carousel published
**three** on every store's homepage. Measured against a real build: `h1 3` → `h1 1`. Only one slide is
an `<h1>` now; the rest are a `<p>` sharing ONE heading-class constant, so the two tags stay
pixel-identical. The cross-fade is untouched — nothing is unmounted, nothing in the carousel script
selects `h1` (it drives `[data-hero-copy]`), and off-screen slides are `inert` either way.

⚠️ **A third defect was live between the two fixes.** `heroSlides()` deliberately keeps a slide with an
`imageUrl` and no heading (a pictorial hero), and N11's floor keys on `s.type === "hero"` — so on that
template the floor stood down *and* the hero rendered `<h1></h1>`. Measured on `origin/main` against
that shape: **`h1 2`, both empty**. So it is `HEADING_INDEX`, not slide 0, and the floor now goes
through `heroSlides()` too: **both halves ask the same question**, "is there a slide whose heading is
non-blank". CONTRACT: change one and they silently disagree — zero `<h1>` on a pictorial hero, or two
on an ordinary one, with build, lint and `astro check` green either way.

Guarded twice on purpose. `sections/h1-floor.test.ts` pins the PREMISE (Hero is still the only emitter;
both halves still key on the heading text) with no DB and no browser. `scripts/check-h1-floor.mjs`
stages a hero-less AND a heading-less template in the DB and counts the `<h1>`s in the rendered HTML —
a unit test cannot see a template that lives in the database.

### 🔴 The PDP gallery thumbnails had no `srcset` at all — the third time this class has cost bytes

The `<button data-thumb>` carried a full `data-srcset` ladder all along (it promotes it onto the main
image on click) while the visible `<img>` **inside** it rendered a bare `src`: the browser was handed
the full-size original for a 66 px tile. Same family as #119/#120 — markup valid, `astro check` green,
bytes wrong. Measured on `/produk/dress-midi-bunga`, 3 runs each, identical every run:
**153 940 → 30 782 B at DPR 1 (−80,0 %)** and **151 552 → 42 646 B at DPR 2 (−71,9 %)**.

⚠️ `sizes` is derived from the container padding + `gap-3` + **the thumbnail COUNT**, NOT from the
`max-w-[7rem]` class. `max-w` only CAPS a `flex-1 basis-0` tile, which measures **66 px** at n=5 on a
412 px phone — declaring the cap over-claims 1,7× and costs a whole rung: `sizes="112px"` pulls the
400w files for 60 114 B where the derived value pulls the 200w files for 42 646 B, **17 468 B for one
word**. Guarded by `scripts/check-pdp-srcset.mjs`, which asserts what the browser RESOLVES TO (nothing
over 3× the device pixels it fills) on a second, isolated selection — it does NOT read `currentSrc`
after the page load, because the spec lets Chromium satisfy the 66 px thumbnail out of the main
photo's already-fetched 800w copy, and the naive reading failed 5 runs in 6 against a correct build.

⚠️ **Still open, and the check PRINTS it rather than failing:** `Header.astro` renders bare `<img>` on
every page — 10 catalog images with no `srcset`, in a different file with separate `sizes` derivations.
*A check red for work nobody in this change can land is a check everyone learns to ignore.*

### The upload width ladder never offered the original

`WIDTHS` in `data/catalog.ts` and the allow-list in `apps/admin/app/api/uploads/[name]/route.ts` are
ONE decision in two files, and both stopped at **1200** while `saveImage` caps an upload at
`MAX_DIM = 2000`. Out-of-list widths 400, so 1200 was a hard ceiling: a `sizes="100vw"` merchant hero
on a 1920 px desktop got a 1200 px file stretched with the 2000 px original unreachable on disk. Both
now end at 2000. Safe only because the route never upscales — re-verified by calling the handler
directly: `?w=1200/1600/2000` on a 300 px source all return the original **byte-for-byte**, while the
same sharp pipeline with the guard removed enlarges 300 → 2000 px, so the guard is what stops it, not
sharp. `?w=2400` / `?w=999` / `?w=1` are still 400 — the allow-list still bounds the cache key space
at original + 6 widths.

## Unreleased — The default-location expression had five copies and one tenant filter

Working the `NEXT.md` queue (N9, N10, N11, N13). Two of its entries rested on claims that are not
true, and the measurements at the end overturned two more.

### 🔴 Four of the five copies had no tenant boundary

`inventory_levels` has no `store_id`, so RLS cannot scope it. The `locations` join **picks** a row; it
does not prove whose. Counted on `origin/main`: `purchases.ts` (2 copies), `inventory.ts` (1) and
`products.ts` (3) carried **zero** `locations.storeId` between them — only the raw-SQL copy in
`order-status.ts` was guarded. A `variantId` belonging to another store — a PO line, a bulk stock save
— therefore resolved to **their** shelf and the write landed there, with no error in either direction.

Now one helper, `apps/admin/lib/inventory-location.ts`, with `storeId` as a required parameter (one
call path — `order-status.ts` ← the courier webhook — runs on the OWNER connection and has no session
to read it from). `inventory-location.test.ts` scans the tree and fails on a sixth copy; confirmed it
flags the pre-change files.

⚠️ `defaultInventoryLevelId` returning `null` is **ambiguous** — "not stocked yet" and "not ours" look
identical. Skip on `null` unless you have separately proved ownership, as `updateProduct` does.

### `deleteLanding` reported success over a delete that matched nothing

It returned `void`, so the editor toasted "Landing dihapus" and navigated away regardless. A DELETE
matching zero rows is not an error — a foreign id is filtered out by RLS in silence, and so is a second
click on a stale tab. `.returning()` decides now; the caller reads it, in the same commit.

### A builder homepage with no Hero shipped zero `<h1>`

`Hero` is the only section that emits one. `index.astro` now renders `<h1 class="sr-only">{store.name}</h1>`
when the template holds no `hero` — hidden, because the merchant designed that page. Driven over HTTP
against a real build and the real DB: 1 `<h1>` without a hero, the hero's own with one.

⚠️ **Found, not fixed:** `Hero` emits one `<h1>` **per slide**, so every store's homepage currently
ships **three** (confirmed on production). Tracked as N14.

### Sitemap `<lastmod>` where the data supports it

`/halaman/*` now carries it — `pages.updated_at` exists and every save moves it. Products and
categories **cannot**: `products` has only `created_at` and `collections` has no timestamp column at
all, so the only date available is one that never changes, and Google distrusts an unreliable
`<lastmod>` for the whole document. The sitemap says so in the file. 55 URLs, 21 `<lastmod>`.

### The measurements (8 runs, production)

- **Desktop: median 100, range 90–100** (n=5), TBT 0 ms throughout — N3 answered. Run 1 is always the
  cold one; that is the whole of the old 66–92 spread.
- **Mobile: median 92, range 82–95** (n=3).
- 🔴 **N7 reversed.** The bimodality is real (TBT 0 → 395 ms) and it happens with **no vendor pixel
  bundle loading at all** — the only two scripts on the page are Cloudflare's. Removing the `scroll`
  trigger would cost real tracking and buy nothing.
- ✅ **N6 closed.** `unused-javascript` and `legacy-javascript` pass with **0 bytes** in all 8 runs, and
  its suggested cause was impossible: `dist/client/_astro/` holds one CSS file and **zero `.js`**.
- **N5 (`dom-size` 992) is now the only performance item with evidence behind it** —
  `mainthread-work-breakdown` 3,4 s against `bootup-time` 0,5 s is style/layout, not script.

## Unreleased — Pixels load on interaction now, and that is a trade the owner made

`requestIdleCallback` was firing at ~2 s on a fast connection, so all three vendor bundles still
executed inside Lighthouse's TBT window: mobile stuck at **75**, TBT **690 ms**, **600 ms** of it
third-party. The loader now waits for a real interaction (pointer/key/touch/scroll) with a **10 s**
backstop, and no `rIC` at all.

**The cost, stated plainly:** a visitor who lands and leaves inside 10 s *without touching the page* is
never counted as a PageView by Meta, Google or TikTok. That is real bounce data and it was traded
knowingly, on measured numbers. What is **not** lost: revenue attribution — a conversion is built from
the ORDER ROW on the server (ADR 0012), never from the browser, and a shopper who buys has by
definition interacted. `/api/track`, our own funnel analytics, is untouched and still fires on every
page view.

Made testable rather than asserted: `check-pixel-defer.mjs` now pins **0 vendor requests after 3 s with
no interaction**, which only became a deterministic claim once `rIC` was removed — idle fires whenever
it likes. Still green on the rest: stubs synchronous, no vendor `<script src>` in the served HTML,
events buffered while no SDK exists, all three loading after a click with GA's beacon going out.

## Unreleased — The srcset that was never promoted, and five sections that had none

Follow-up measurement of the PageSpeed work. Production mobile went **66 → 75** with the pixels on
(FCP 2.7 s → 1.6 s, LCP 2.8 s → 1.7 s), and `uses-responsive-images` still showed **277 KiB** wasted.
Two causes, both real:

### A srcset the browser never saw
The hero carousel defers slides 2..n (`data-src`, woken on idle). The `data-srcset` added in the
previous change was only promoted on the `<source>` element, never on the `<img>` itself — so waking a
slide set `src` with no srcset and the browser committed to the full 1920×1080 original. **74 KB + 32
KB wasted on one page**, on a phone, for images not yet on screen. This was a defect introduced by the
previous commit and found by measuring it rather than by re-reading it.

It is guarded now by `scripts/check-hero-srcset.mjs`, because this class is invisible to every static
check: the markup is right, `astro check` is green, and the bytes are still wrong. Only a browser sees
`currentSrc`. Verified at 412 px / DPR 2 — all three slides resolve to `-1024w`, **zero** full-size
originals requested.

### Five section components had no srcset at all
`ImageText`, `Lookbook`, `BannerPromo`, `CollectionBento` and `CategoryNav` each render an `<img>` and
none carried one — `/sections/denim-standard.webp` alone wasted **151 KiB**. Each now gets a `sizes`
derived from **its own layout** and named as a constant with the reasoning attached, because a wrong
`sizes` is worse than no srcset: the browser trusts it completely when picking a candidate.

## Unreleased — PageSpeed: the pixels were the page, and the font was the LCP

Measured with Lighthouse against production before and after. No guesses.

### Turning tracking on cost 24 points
Filling in Batik Nusantara's three ad channels (dummy ids) took **mobile 90 → 66** and Total Blocking
Time **130 ms → 770 ms**. The downloads were never the problem — Meta, Google and TikTok were already
`async`. The cost is parse + execute of three third-party bundles on the main thread during the paint.

`MarketingPixels.astro` now injects the vendor `<script>`s only at **idle-or-first-interaction**, while
every stub, queue and `init` stays synchronous. That is what makes it lossless: `fbq.queue`,
`dataLayer` and `ttq`'s method array are the vendors' own buffers, so a call made before the SDK
arrives replays in order. Whichever comes first — the browser going idle or the shopper touching the
page — because a shopper who interacts is a shopper who might convert.

Proven in a real browser (`scripts/check-pixel-defer.mjs`), not by typecheck: stubs exist
synchronously, **no vendor `<script src>` is in the served HTML**, three events fired while no SDK
exists are buffered (queue lengths grow), all three vendors load after a click, and GA's beacon
actually goes out (`en=page_view&tid=…`).

### The LCP element was an `<h1>` waiting on a font on someone else's origin
Google Fonts was render-blocking for **1.409 ms** in three layouts (Layout, CheckoutLayout,
LandingLayout) and the homepage's LCP was **82% render delay**. Inter is now self-hosted: one variable
file per subset covering 100–900, latin + latin-ext only, `preload`ed same-origin. LandingLayout had
also been asking for a weight (800) the other two never loaded, so a bold heading there was silently
synthesised; the variable file ends that too.

### A 1920×1080 hero delivered whole to a 412 px phone
`uses-responsive-images` scored **0**, wasting **461 KiB** on one page. `?w=` only works for
`/api/uploads/*`; for `public/` it is a meaningless query string on the same bytes. So the widths are
made real: `scripts/gen-image-widths.mjs` generates 153 renditions (867 KB total, idempotent, never
upscales) and `imageSrcSet` emits them. The mobile hero candidate is **9.9 KB against 66 KB**. All 30
srcset candidates across `/`, `/produk`, `/kategori` and `/promo` were checked for a 200 — a candidate
that 404s is a broken image, not a slow one.

### `/promo` was indexable and absent from the sitemap
It renders `index,follow` and it is a default navigation item — the one page whose whole job is to be
found when someone searches for a discount. Its children (`/promo/<handle>`) are `noindex,follow` ad
funnels and stay out: listing a noindex URL in a sitemap is a contradiction we would be publishing
about ourselves.

### Two findings that are NOT code, filed rather than faked
- **Static assets have no long cache TTL.** Astro middleware cannot fix it — the Node adapter's `sirv`
  serves `public/` before middleware runs. That was written, measured against a real build, found to
  have no effect, and reverted. It is a Cloudflare Cache Rule.
- **Cloudflare Email Obfuscation injects a render-blocking `email-decode.min.js`** — **1.621 ms**, the
  single largest blocker on the page, triggered by our own `mailto:` links. A zone setting.
- `robots-txt` scoring 0 stays untouched: the audit is behind the spec, and "fixing" it means deleting
  an AI-training opt-out asserted under EU Directive 2019/790. Already reasoned out in the file.

## Unreleased — A quota anyone could spend, a restore that trusted a join, and four 500s

### The one shipping door with no capability on it
`getShippingRates` checked only that a session existed. Every other mutating action in
`actions/shipping.ts` demands `orders:write`, and every call to this one is a **live KiriminAja rate
request** — real quota, one per invocation, loopable over the store's order numbers by anything that
can dispatch a `"use server"` action. It is also the read `createShipment` is paired with, so the two
were asking different questions about the same order. Now both take `orders:write`. (`gudang` holds
none, so it was already shut out of everything this would have let it price.)

### The inventory restore trusted a join to scope it
The `batal`/`retur` stock restore picks one row via `join locations loc … order by loc.is_default
desc`. `inventory_levels` has no `store_id`, so RLS cannot scope it, and this is the copy reachable
from `ka-tracking.ts` — which runs on the **owner** connection, RLS off entirely. The join only PICKED
a row; it never proved whose row it was, and `is_default desc` would happily prefer another store's
default location. `applyOrderStatusChange` already takes `storeId` as an argument; it now uses it.
Verified on the dev DB: scoped and unscoped select the identical row for real data, so the filter
changes nothing except what it makes impossible.

### `/diskon/1042` was a 500
Postgres throws `22P02` on a non-UUID string, so a mistyped id crashed the render instead of 404-ing.
`/promo/[id]` had worked this out and guarded itself with a private regex — and `promo/html/[id]`,
`diskon/[id]` and `flash-sale/[id]` beside it had not, which is what a private copy always costs. Now
`lib/uuid.ts`, used by all four. `/produk/…` takes the catalog **number** (ADR 0013), so merchants
genuinely do try this.

### The merchant saw a digest instead of the rule they broke
`actions/flash.ts` threw plain `Error` for four rules that are entirely the merchant's to fix
("Tanggal berakhir harus setelah tanggal mulai", a flash price at or above the product price). Next
**masks** a thrown Error in production, so all four arrived as an opaque digest. They are returned
now; genuine failures still throw, because a DB outage is not friendly advice next to the Simpan
button.

⚠️ The editor changed in the same commit, and had to: it awaited the action and **ignored the return**.
Returning instead of throwing would have made it report "Flash sale dibuat." over a save that never
happened — strictly worse than the bug being fixed.

### Storefront: page 2 of a listing declared itself a duplicate of page 1
The canonical dropped the whole query string — correct for the `?utm_source=…` this ad-landed traffic
is full of, wrong for `?page`, which is not tracking but a **different set of products**. For a
12-per-page catalogue that hid everything from the 13th product on from search. Paginated pages now
self-canonicalise via an allow-list (so a new tracking param does not have to be discovered and
banned); `page=1` still normalises to the bare path. Verified over HTTP: `?page=2` → `?page=2`,
`?page=1` → bare, `?utm_source=fb&page=3` → `?page=3`, `?page=abc` → bare.

### …and a title regression from the commit before this one, fixed
The previous change replaced the homepage's `"Beranda"` title with `stores.tagline`. On the dev store
that is 30 characters. **On production it is 150** — a full paragraph — so the shipped `<title>` ran to
~170 characters where Google cuts at ~60. `tagline` is unbounded free text and was never a title. It
is now used only when it is already title-shaped (≤60 chars), otherwise a short honest descriptor
("Belanja Online"); the full text still carries in the meta description, where the length belongs.
Verified both ways in a browser against a production-shaped 139-char tagline (the dev row was changed
in a transaction and **put back**).

Gates: `tsc` clean, `astro check` 0 errors, 145 tests, `verify-rls` green. No migration.

## Unreleased — Six quiet lies in the order pipeline

None of these threw, none failed a build, and none is reachable by clicking around the demo store —
its data avoids every one of them. They were found by grepping for claims and checking them against
SQL.

### The guess that said it was flagged, and wasn't
`createShipment`'s comment stated the city-name fallback "is flagged as a guess". `destinationGuessed`
existed **nowhere in the repo**. 77 orders on the dev DB carry no `ship_district_id`, so the branch was
live: a parcel booked to a fuzzy-matched kecamatan, silently, and the COD province gate then resolved
the province *from that guess*. `resolveArea("Surabaya")[0]` is "Bandar Surabaya, Lampung Tengah,
LAMPUNG".

It now returns the district it actually **matched** — the match, not the city searched, because that
is the only string in which the Lampung problem is visible. The order-detail screen raises a 20-second
warning naming it and telling the merchant to check before the courier collects.
`BulkResult.guessedDestination` carries one entry per order: a 50-order run is exactly where three
guesses disappear behind "50 pesanan dibooking".

### Reporting what we were asked to write, not what we wrote
`markLabelsPrinted` returned `done: numbers.length` whatever the UPDATE matched. An order number
belonging to another store is filtered out by RLS with **no error**, and counted as printed anyway.
Now `.returning()`, and `ok` means every row landed.

### A cancelled order could still be billed
`createOrderPayment` never looked at `orders.status`, so a `batal`/`retur` order could be given a real
VA at the gateway. The buyer pays, the callback marks it `berhasil`, and `creditSaleForPayment`
correctly skips terminal orders — money collected, **no sale credited**. Refusing at creation is the
only place that stops, because the callback is right to skip it. It now also refuses a second bill
while one is still `menunggu`: two open VAs are two ways to pay one order.

### Two definitions of "the order's payment"
The list ordered by `paid_at desc nulls last`, the detail by `p.id desc`. On an order with more than
one payment row they could name different methods — including **COD vs VA**, which is the fact
`createShipment` turns into a cash-collection instruction for a courier. One definition now, in both
files, each pointing at the other.

### The badge's clock was the merchant's laptop
`isLive` had just been moved to the server so the seller's Flash Sale list could not contradict the
till. The line directly below it still computed "Terjadwal" from `Date.now()` **in the browser**.
`isUpcoming` is now derived on the same `now` as `isLive`.

### `_` matched all 842 orders
Search terms went into `ILIKE '%…%'` unescaped. Never injection — everything is parameterised — but
`%` and `_` are wildcards and the merchant is typing a search box: the literal resi `SPX_123` also
matched `SPX0123`, and a bare `%` listed the whole shop. Fixed as a **class**, not an instance: the
identical regex had already been hand-written twice (`data/areas.ts`, `data/orders.ts`) and a third
site (`actions/taxonomy.ts`) was missed, so it is now one shared `@tokophi/lib/like` used by all
three, with a test pinning both directions — wildcards neutralised *and* ordinary Indonesian search
terms left untouched, because over-escaping would stop real order numbers matching.

### Storefront: the homepage had no structured data
`/produk`, `/blog` and every breadcrumb emitted JSON-LD; the page every crawler reaches first emitted
none. Organization + WebSite now ship there, and the `SearchAction` points at **`/cari?q=`** — verified
against `pages/cari.astro`, which reads exactly that param. Not `/produk?q=`: that route reads `sort`
and `page` only and would have silently rendered the unfiltered catalogue. The title also stopped
leading with "Beranda" (`Beranda - Batik Nusantara` → `Batik modern untuk hari-harimu - Batik
Nusantara`).

Gates: `tsc` clean (admin, super-admin, db, sections), `astro check` 0 errors, **145 tests**,
`verify-migrations` + `verify-rls` green. Homepage JSON-LD parsed out of the served HTML in a real
browser request, not asserted from source.

## Unreleased — Storefront: a total that jumped, a badge on the wrong courier, a keyboard trap

From the storefront audit — the half a shopper actually touches. Every item below was observed in
Chrome at 390 × 844, not inferred.

### 💸 The checkout showed a total it was going to change
Before an address is entered it printed "Ongkir **Rp 0**" and a Total with no shipping in it — on a
Rp 45.000 cart with real ongkir of Rp 11.100–19.000, the first number a shopper reads was 25–40% below
what they pay, in the sticky bar that is the first thing on a phone screen. Then it jumps when they
fill in their kecamatan, which is the classic abandonment moment. `/keranjang` already refuses to do
this ("Dihitung saat checkout") and its own comment explains why; the checkout contradicted its
sibling. Now "Dihitung" and "Belum lengkap" until a courier is picked.

### 🚚 "Tercepat" was landing on the slower service
The badge ranked on the FIRST integer of the ETD range, so "1-3" and "1-2" scored the same and the
winner was whichever appeared first in an unsorted list. Observed: SPX Economy "Estimasi 1-3 hari"
wearing both **Termurah** and **Tercepat**, directly above SPX Standard "1-2 hari" with no speed badge
at all. Anyone buying for a deadline picks the badge and gets the slow one. Now ranked on the upper
bound, then the lower.

### 🖼️ A failed image wrecked the page instead of degrading
Every image frame is already a tinted box with a fixed aspect ratio — but that fallback only rendered
when the `src` was EMPTY. When the fetch FAILED the browser painted its own broken-image glyph plus
unstyled alt text, which overflowed its frame and pushed the price and buy button ~1500 px down. Not
theoretical: merchant photos are `/api/uploads/…` served by the ADMIN app on another origin, so every
admin redeploy is a window where a shop's own product photos do not resolve. One capture-phase listener
now hides the failed image and reveals the frame that was always behind it.

### ⌨️ The closed mobile drawer was a keyboard trap
It is only slid out of view (`translate-x-full`) — still `display:flex`, still visible — so ~15
off-screen controls stayed in the tab order. Measured: the sixth Tab from the top of the homepage
landed on the close button OUTSIDE the viewport, then walked ten more invisible links. A keyboard user
could not get past the header. Now `inert` when closed (WCAG 2.4.3 / 2.4.11).

### Also
- The cart badge on `/checkout/sukses` still showed the pre-order count: `sukses.astro` clears the cart
  and fires `cart:updated`, but `CheckoutLayout`'s badge was a one-shot IIFE with no listener (the
  header's copy has both). A badge saying you still have a basket, on the page telling you the order
  went through.
- A single-variant product never said it was in stock. The positive line was left to the variant
  picker's JS, and a product with no options has no picker — so a 4-variant item said "Stok tersedia
  (17)" and a 1-variant item with 40 on hand said nothing. Scarcity is a reason to buy; silence is not.

Still open from that audit, recorded not fixed: no `aria-live` anywhere on the checkout (every changing
number changes silently), validation errors not associated via `aria-describedby`, the address cascade
has no combobox semantics, the variant picker groups are unlabelled, hero carousel dots are 10 × 6 px,
and hero body copy reaches 3.54:1 on its lightest slide. Plus the biggest performance win: seeded
imagery is excluded from `srcset`, so a 390 px phone downloads the desktop rendition (~600 KB of the
homepage's 821 KB).

## Unreleased — The payment webhook was rejecting every real payment

Four parallel audits away from the ad-tracking stack — the money in checkout, auth/RBAC/tenant
isolation, payments/saldo/ledger, and the storefront. The worst finding was not in any of the code
those audits set out to read; it was one missing query parameter.

### 🔴 In production, no prepaid payment could ever be confirmed
`/api/public/pay/callback` authenticates on `x-callback-token` or `?token=`, and it fails closed. All
**five** places that built the callback URL we hand AutoLaris built it bare — `alCreatePayment` sends
`callback_url` as a plain string and no headers, so there was no other way for the token to travel.
The secret IS set on the live stack, so every genuine callback got a **401**: `payments.status` stayed
`menunggu` for ever, orders never became `dibayar`, no ledger row was written, held conversions were
never released — and because platform invoices ride the same callback, `stores.current_period_end`
stopped advancing, so the platform would eventually suspend its own paying merchants. It could not be
caught locally: with no secret set, dev returns `true` and that branch is never exercised. One shared
`payCallbackUrl()` now builds it. Measured against a production-mode server: bare URL **401**, new URL
**200**, wrong token still **401**.

### 📦 Stock could go negative, and the lock was never going to stop it
The `FOR UPDATE` gate ran per cart LINE, not per variant, and every check ran before any decrement — so
two lines naming the same variant both read the same untouched `available`, both passed, and the
decrement subtracted twice. With 6 in stock, a posted cart of 2 × qty 5 committed an order for 10 and
left the row at **−4**: charged correctly, unshippable, and on COD the courier is already booked. Now
aggregated by variant before the lock, and locked in variant-id order so two shoppers buying the same
two variants in opposite order cannot deadlock.

### 🧾 PPN was charged on rupiah the shopper never paid
`computeTax` ran on the pre-discount subtotal. A 50% voucher on Rp1.000.000 collected Rp110.000 of PPN
where Rp55.000 was due — and wrote the wrong figure into `orders.tax_idr`, which is what the faktur is
built from. The base is now the goods after the voucher, on the server and in the checkout display.

### 👀 The success page hid the discount, then mislabelled the tax
`order.discount` was computed, returned, stored — and rendered nowhere. An order with automatic free
shipping printed "Subtotal 300.000 · Ongkir 25.000 · Total 300.000" with 25rb simply missing; on the
COD panel that is cash a courier will ask for. Worse, the inclusive-vs-exclusive PPN test was
`subtotal + ongkir + tax === total`, which any discount breaks — so a voucher flipped the label to
"**Termasuk** PPN" on tax that had been added on top. Both fixed. The gateway's admin fee is now named
too: the summary said Rp234.000 and the VA panel Rp238.000, six lines apart, and a shopper who
transferred the number they remembered underpaid the VA and was never confirmed.

### 🔑 A session could not be revoked
`role` and `storeId` were trusted from the 7-day JWT and nothing ever looked again. An owner demoted to
Staf, or removed from the store outright, kept full access for the rest of the week — and resetting the
password of a compromised account, the obvious way to lock someone out, ended nothing. `getSession()`
now re-reads `store_users` on every request. Exercised in a browser: demote → the owner-only tab is
gated on the next request; remove → bounced to login. (The first attempt at that redirect looped, because
middleware sees the still-valid JWT and sends `/login` back to `/`; the cookie has to actually be
deleted, which only a route handler can do.)

### ⚖️ Six ledger tests had been dead since migration 0081 — and they were right
`mkVariantWithStock` did not set `products.number`/`variant_seq_next`, NOT NULL with no default since
ADR 0013, so the whole `applyOrderStatusChange` suite errored on its own fixture. Because the file is
`describe.skip` without a `TEST_DATABASE_URL`, `vitest run` stayed green and said nothing. Fixed — and
one of the revived tests immediately caught a **real production bug**: `dikirim → diproses` was missing
from the state machine's `ALLOWED` table, so voiding a shipment on a dispatched order silently did
nothing. The AWB and courier were cleared while the status stayed "Dikirim", and with `kaOrderId` now
null the tracking poller could never move it either — the exact stuck state `actions/shipping.ts` says
it was written to prevent. **22/22 now pass.**

### Also
- A late `PAID` callback stamped `dibayar` on a **cancelled** order — money collected, never credited
  (the ledger correctly refuses terminal orders), and nothing in the product writes a refund. Now
  refused and logged as needing a decision.
- A replayed `EXPIRED` walked a **collected** payment back to `gagal` and nulled its `paid_at`, while
  the order stayed `dibayar` and the ledger kept the credit. Money received is not un-received by a
  webhook.
- `createOrderPayment` had no server-side guard against a second live bill on one order; the UI hid the
  button, but the UI is not the boundary. Two payable VAs, both matching `reff_id`.
- Super-admin: "Gratiskan 1 bulan" set `firstInvoicePaid`, **burning the Rp50rb first-month promo** — a
  goodwill gesture that billed the merchant Rp249.750 too much. "Perpanjang trial" on a paying store
  deleted the period they had already bought and re-armed the promo; it now refuses and says why. And
  the control plane's `run()` helper announced success for every action, including ones that refused.
- `payments` had no index on `trx_id`, `reff_id` or `order_id` — every gateway callback was two
  sequential scans (migration 0085).
- The COD-only ad funnel now mirrors the platform's COD cap and province allow-list, instead of walking
  a shopper into a 403 after they have filled the whole form on a surface with no other payment method.
- `npm run lint` was red on main with 28 errors and nothing runs it — `next build` does not, and there
  is no CI. Eight fixed; the remaining 20 are React Compiler rules, itemised in `BACKLOG.md`.

## Unreleased — The ad funnel recorded nothing, and three numbers were wrong

Five parallel audits of the Meta / Google / TikTok stack — delivery pipeline, provider payloads, catalog
feeds, storefront pixels, Seller UI — each checked against the live provider spec, the running code and
a real browser. The short version: **paid traffic was the one kind of traffic we did not measure.**

### 🚨 `/promo`, `/lp` and `/thanks` fired no events at all
`LandingLayout.astro` never rendered `MarketingPixels`. That is the layout for the direct-order ad
funnel and its conversion page — the exact pages a merchant buys traffic to. No PageView, no
ViewContent, no InitiateCheckout, no Purchase, no `ttclid` capture, while build, lint and `astro check`
stayed green. Same class of miss as the one CheckoutLayout's comment was written to prevent.

Before that could be fixed, the funnel had to stop putting the shopper's **name, WhatsApp number and
street address in the `/thanks` URL** — Meta prohibits PII in event parameters and reads the full URL as
`event_source_url`. They travel in `sessionStorage` now, read once and deleted.

### 💸 Conversions that were silently lost
A prepaid conversion was released only by the AutoLaris webhook: one un-retried delivery, no poll, no
manual path. And the enqueue runs after the order commits inside a `try/catch`, so one transient DB
error lost a COD conversion **permanently** — it also suppresses the browser pixel, which gates on it.
The cron now reconciles on every tick: release held rows whose order has since been paid, and back-fill
orders with no delivery row at all. Both proven against real rows in a rolled-back transaction.

### 📉 Numbers that were wrong
- **GA4 revenue was overstated by ongkir + PPN on every order.** GA4 defines `value` as price × quantity
  *without* shipping and tax, and gives both their own parameters; we sent the order total. Items also
  carried no price or quantity, which leaves GA4's item-scoped metrics structurally zero.
- **Google Ads counted every sale twice.** The GA4-shaped gtag event carried no `send_to`, so gtag
  broadcast it to the default group — including the `AW-` tag on the same page — and only one of the two
  copies had a `transaction_id`.
- **TikTok's `contents[].price` was the order total split by quantity**, so it disagreed with the same
  SKU's price in our own feed on every multi-unit order.
- **The browser hashed TikTok's phone without the `+`.** TikTok wants E.164; our server already sent the
  `+` form. Two digests for one person, matching nothing, forever.
- `age_group` defaulted to `adult` for every product the merchant left blank — a children's-wear shop
  published as adult apparel.

### 🧾 "Pendapatan dari saluran iklan" was fiction, in both directions
`orders.channel` had exactly one writer and it hard-coded `"organic"`. So a real store read **Rp0 from
ads forever**, including one whose pixel was live and converting — while the demo store showed a split
written by `Math.random()` in the seed. It is now derived at order creation from the shopper's own last
ad click (`_fbc` / `_gcl_aw` / `ttclid`, most recent wins; `_fbp`/`_ttp` ignored because they are set on
any visit). Last-click and first-party: it will not match Meta Ads Manager, and it does not claim to.

### 🗂️ Two catalog bugs that take a product off the shop
Deleting a product's **first** photo never reindexed `position`, and every reader keys on `position = 0`
— the product vanished from both feeds, the grid and its own PDP, permanently, because uploads land at
`max + 1`. And removing or renaming a variant that has ever been ordered left two rows at position 0,
which fans the product out through an INNER JOIN: every `<item>` and `<g:id>` emitted twice, which
Google rejects outright.

### 🧹 Found while screening
`astro check` had been reporting 8 errors and typechecking **none** of the storefront's 92 files since
2026-07-22 (a JSX comment sat between the attributes of `<header>`). And 16 migrations were unapplied on
the shared dev database: `0062` aborted on a column that had arrived via `push`, and drizzle runs a whole
pending batch in **one transaction**, so a single "already exists" rolls back every migration behind it.

Also: conversion rows now have a **30-day retention policy** (they carry the shopper's IP, UA and ad
cookies, and nothing had ever deleted one), and `storeTrackingPixels()` is cached like every other
storefront read instead of costing a Postgres round-trip on every page render.

**Three owner decisions are recorded in `BACKLOG.md`, not taken here:** there is no consent layer
anywhere in the repo, the feed price excludes PPN where Google requires it included, and every feed
image is WebP which Meta and TikTok document as unsupported.

## Unreleased — Pemasaran → Saluran Iklan stopped contradicting the merchant

Making the **Pelacakan** tab real left the **Saluran Iklan** tab lying. A merchant with Meta's pixel and
Conversions API live still opened Pemasaran and read *"Belum ada saluran iklan yang terhubung"*, saw
"Belum terhubung" on the Meta card, and found a permanently-disabled **"Hubungkan (belum tersedia)"**
button. Every one of those was true while Pelacakan was a row of placeholders; none of them was true any
more. A screen that contradicts the merchant's own configuration is worse than an empty one.

- Each channel card now shows what is **actually** set up, read from `store_tracking_channels`:
  **Pixel aktif** · **Pelacakan lengkap** (browser + server) · **Hanya sisi server** · Belum terhubung.
- The dead button became the action that exists — **"Atur pelacakan"** / **"Ubah pelacakan"**, which
  switches to the Pelacakan tab.
- The notice tells the truth in both directions: *"Pelacakan konversi aktif"* when something is wired,
  *"Pelacakan konversi belum diatur"* when nothing is.

**Spend, impressions and ROAS stay empty, deliberately.** Those numbers only exist inside the ad
platforms and TokoΦ does not pull them — the copy now says that plainly instead of implying a connection
is missing. Verified in a browser against the real config: Meta → "Pixel aktif", the other two → "Belum
terhubung", one "Ubah pelacakan" and two "Atur pelacakan", and the button moves to the right tab.

## Unreleased — Audit follow-ups: TikTok click id, lighter storefront, feed shape

### 🎯 TikTok's click id is finally captured
`ttclid` arrives ONCE, as a URL parameter on the landing page, and was being dropped — it is TikTok's
strongest match key, the role `_fbc` plays for Meta. It is now persisted on the first page a shopper
sees (28 days, TikTok's own attribution window), and travels with `_ttp` into the server-side event as
`user.ttclid` / `user.ttp`. Verified in a browser: `?ttclid=…` is stored and survives navigation.

### 🪶 ~9,8 KB removed from EVERY page of every storefront
`MarketingPixels` is in the head of both layouts, and an `is:inline` script ships **byte for byte** —
Astro does not minify it, so the 11,9 KB of explanatory comments inside it were downloaded by every
shopper on every page. The reasoning moved to the component's frontmatter (where it costs nothing) with
one-line pointers left in place: **11.885 → 2.086 bytes** of comments in the shipped script. Nothing was
deleted; the notes this repo depends on are all still there, on the other side of the fence.

The proper fix — a JSON data island plus a Vite-bundled, minified, cacheable script — is written down in
the frontmatter as its own change, because it is a refactor of a money-adjacent file.

### 📦 TikTok's gallery images were in Google's shape
TikTok documents `additional_image_link` as ONE field holding a comma-separated list (commas inside a URL
percent-encoded). We emitted Google's repeated-element form, so TikTok read at most the first image. The
feed builder now switches on a profile flag, guarded by a test.

### 🔗 Smaller corrections
- `/produk/<uuid>?tab=media` kept its query string through the canonicalising redirect; it was dropped.
- The Google Ads destination is validated against Google's documented `AW-…/label` shape on save — a typo
  there errors nowhere: gtag accepts any string and the conversion simply never appears.

### ⏸️ Left alone deliberately: PPN in the feed price
Google requires tax-inclusive prices outside the US/CA, and TokoΦ's PPN is **exclusive** by default
(added on top at checkout) while the storefront displays the ex-PPN price. Making the feed inclusive
would satisfy the spec and create a landing-page price mismatch; leaving it violates the spec. That is a
product decision about whether the storefront displays tax-inclusive prices, not a bug to patch quietly.
**No store in production has PPN enabled**, so it is latent — recorded in the handoff, not guessed at.

## Unreleased — Google Ads is real, TikTok's purchase event was off-spec

### 🔴 TikTok's purchase event name was not in TikTok's spec
We sent `CompletePayment`. TikTok's current standard-event list does not contain it — the purchase event
is **`Purchase`**, and their names are case-sensitive. Renamed in the browser **and** the server in the
same commit, deliberately: TikTok de-duplicates on `(event_source_id, event, event_id)`, so changing one
half alone would have made **every purchase count twice**.

### 🟢 Google Ads: it recorded nothing, now it records conversions
`gtag('event','purchase',…)` does not create a Google Ads conversion — Google documents it as its own
call with a `send_to` destination — and dynamic remarketing wants a different item shape from GA4's
(`id` + `google_business_vertical`, not `item_id`). We were sending GA4's shape to an `AW-` tag.

`store_tracking_channels.ads_send_to` (migration 0082) now holds the Google Ads destination
(`AW-123456789/AbC-D_efGh`) alongside the GA4 Measurement ID, so **a merchant can run both** — one field
could only ever serve one of them. Verified in a browser: `config G-…` and `config AW-…` both fire, GA4
gets `item_id`, Google Ads remarketing gets `id` + `google_business_vertical: retail`, and a purchase
fires `event conversion` with the label.

### 📐 Precision fixes on events we had just changed
- **Per-item quantity was the ORDER total.** GA4 `items[].quantity` and TikTok `contents[].quantity` used
  the sum of every line, so a 2-line order recorded **4 units**; 5 lines recorded 25. It is now sent only
  when the event describes one item, and TikTok gets `contents[].price` (per-item) alongside it.
- **InitiateCheckout was `num_items: 1` with no value.** It now reads the cart: real unit count and real
  total (verified: `num_items: 4`, `value: 549000` for 3 × Rp120.000 + Rp189.000).
- **A mixed cart downgraded the whole event to `product_group`**, so every exact id in it matched
  nothing. Lines are partitioned now and the exact ids win; a group id travels only when the cart has
  nothing more precise.
- **A product with no variant options reported the GROUP id forever** — there is no picker to correct it,
  and under the number scheme `itemGroupId` is never null. It now reports the exact item id. This was
  invisible locally: every dev store is still on the legacy scheme.
- **A flash sale reported a price above what checkout charges.** The picker overwrote the sale price with
  the raw variant price; it now applies the same `min(variant, flash)` cap the order endpoint uses — so
  the displayed price, the cart, the pixel and the feed finally agree.
- **A price-on-request product fired no ViewContent at all** (the id lived on a buy-box row it never
  renders). Moved to the price element, which every PDP has.
- **Meta's `event_source_url` and TikTok's `page.url` are documented as required** and were conditional;
  the payment-callback path supplied neither. Both are now always sent, falling back to the store's own
  storefront URL.
- **A sparse variant matrix left the buttons enabled** at the previous variant's price — a shopper could
  add a combination the order API would refuse. It now says so and disables the sale.
- One `safe()` wrapped all three pixel bootstraps, so a throw in the first killed the other two — the
  exact outage its own comment claimed to prevent. One guard per vendor now.
- `/produk/<huge number>` was a **500**, not a 404: `products.number` is `integer` and Postgres answers
  22003, a different error class from the 22P02 the route guards. Bounded. `/promo/<number>` got the same
  guard, since the new URL scheme teaches merchants to try it.

## Unreleased — Product URL is the catalog number, events report the exact variant

### 🔗 `/produk/1042` — the Seller's product URL is now the number, Shopify-style
Not the UUID. It is the number on the product list, it is **searchable in ⌘K** (`#1042` shows in the
subtitle), and it is the id a Merchant Center or Events Manager disapproval names — so it is the only id
a merchant can actually act on. Old UUID bookmarks redirect to it once. The UUID remains the primary key
and every foreign key; only the URL changed, and no server action's signature moved.

The param is classified in JS before any query touches it: `number` is `integer` and `id` is `uuid`, and
Postgres rejects the cross-type literal outright — which would surface as a **500**, not the 404 the page
intends. Verified in a browser: `/produk/1001` opens the right product, a UUID redirects, `/produk/abc`
and a foreign number both 404.

### 🎯 Events now report the EXACT variant the shopper selected — not the product group
This corrects a decision made two days ago on a wrong premise. We were sending the product-group id with
`content_type: "product_group"` for ViewContent and AddToCart, reasoning that a browsing shopper has not
chosen a variant. Checking the providers' own docs:
- **Meta forbids it**: *"Do not use `product_group` with AddToCart or Purchase"* — people buy specific
  products.
- **Google has no group concept at all** — `items[].item_id` must equal a Merchant Center offer id, so a
  group id matched nothing.
- And on our own PDP the premise was false: the variant picker pre-selects the first value of every
  option group, so a specific variant is always resolved.

Now the PDP ships each variant's exact catalog id inside the picker payload — computed server-side by the
same `retailerId()` helper, never composed in the browser — and the selection keeps it on the buy buttons.
Verified in a browser: switching colour then size moves the reported id `1001-1` → `1001-4` → `1001-6`,
and the cart records it so InitiateCheckout is exact for free. The group id survives as the fallback for a
sparse option matrix and for price-on-request products.

**`item_group_id` is unchanged and still the product number** — that IS the field whose value is shared
across variants. `content_ids` never was.

### 📊 Per-provider payloads corrected while we were in there
- **Quantity reaches the pixel.** AddToCart reported `1` no matter what the stepper said; it now reports
  the real quantity, and `value` is price × quantity (measured: Rp360.000 for 3 × Rp120.000) instead of 0.
- **TikTok was missing required top-level fields** — `content_type` and `content_ids` (both required for
  Video Shopping Ads); only the nested `contents[]` type was sent.
- **GA4 no longer records `value: 0`** on view_item / add_to_cart / begin_checkout. An omitted parameter
  is better than a zero that drags the reported average down.
- **Meta gets `value`/`currency` on ViewContent and AddToCart**, so it can optimise on revenue rather
  than event counts, and `num_items` on InitiateCheckout (the one event Meta documents it for).

## Unreleased — Catalog: products get a permanent number (ADR 0013)

### 🔢 Every product now has a system-generated id, and the ad platforms can finally rely on it
Products get a **per-store number** (`#1001`, `#1002`, …) and variants a per-product `seq`, both
allocated once and never reused. The catalog identifier becomes `{number}-{seq}` — so
`<g:id>1042-3</g:id>` in the feed and `content_ids: ["1042-3"]` in every conversion.

**Why it mattered:** the old id was the product HANDLE (`kemeja-linen`, or `kemeja-linen-2` for the
n-th variant), and Google/Meta/TikTok key a catalog item by the id we send. Renaming a product,
dragging a variant, deleting a sibling — or just **adding a second variant** — changed it, which all
three read as "that product was deleted and a new one appeared": performance history reset, retargeting
audiences cold, and no provider offers a re-key. Deleting the middle of three variants was worse than
that: the survivor silently inherited the deleted variant's catalog item.

Existing stores keep the old scheme (`stores.catalog_id_scheme`) because switching a live catalog is
one-way; **new stores start stable and never pay it.** A merchant switches when they choose, warned
about what resets.

### 📦 The feed itself was rebuilt — several of its defects were silent and expensive
One shared builder now serves **two endpoints**: `/feed/google.xml` (Google **and** Meta — both ingest
RSS 2.0 + the `g:` namespace) and a new `/feed/tiktok.xml` (TikTok needs `sku_id` and caps the category
at 3 levels). Fixed along the way:
- **A single control character in a product description could reject the ENTIRE feed** — XML 1.0
  forbids them and we only escaped `&<>"`. One paste out of Word took the whole catalog offline.
- **Multi-variant products on a flash sale published the wrong price** — the raw variant price while
  the PDP charged the sale price. Google calls that "Mismatched value (page crawl): price" and
  disapproves the item. `price` + `sale_price` are now emitted correctly for both discount shapes.
- **`availability` used `in_stock`**, which only Google documents; Meta and TikTok document `in stock`
  (with a space). Now the value all three accept.
- Photo-less products are no longer published as items every provider would reject (`image_link` is
  required by all three), and the Katalog Iklan card now counts what is actually publishable —
  previously it included drafts the feed never emitted.
- Added `sale_price`, `additional_image_link`, `product_type`, `gtin`/`mpn`/`identifier_exists`,
  option-3 support for `size`/`color`, plain-text descriptions with length caps, and `brand` from the
  merchant's own `vendor` instead of always the shop name.

### 🔐 Credentials: they can be tested, revoked, and no longer fail silently
- **"Uji koneksi"** per channel — a real probe that says whether the token is valid *and* reaches that
  pixel. Meta's uses an empty `data` array (auth is checked first) so it cannot create a conversion.
  Google's is labelled honestly: Measurement Protocol does **not** validate credentials, so it can only
  confirm the payload shape.
- **"Hapus token"** — the clear path existed in the action and was unreachable from the UI, so a
  merchant could never revoke a token an agency had pasted.
- `capiConfigured` now means "decryptable", not "a row exists" — after a key rotation the UI used to
  claim a token was stored while every conversion dead-lettered.
- Credential changes write an audit entry; retries are rate-limited and no longer requeue failures that
  can never succeed.
- **TikTok rate limits are no longer dead-lettered as permanent** (`40100`/`40132` arrive with a 4xx,
  and the body code was only parsed on 2xx) — a flash-sale burst used to lose every conversion in the
  window. And GA4 events older than 72 h are sent rather than dropped: Measurement Protocol accepts
  them and clamps the timestamp, so refusing to send was losing sales we could have reported.
- The Pelacakan tab is now **owner-only to READ**, not just to write.

## Unreleased — Conversion tracking: the merchant's OWN pixels, end to end (ADR 0012)

### 📈 Pemasaran → Pelacakan is real, and the conversions actually leave the building
Pelacakan used to be three disabled placeholder cards. It is now the real setup: the Seller pastes
**their own** Meta Pixel / GA4 Measurement ID / TikTok Pixel (public ids, plaintext) plus an optional
server-side token (Conversions API · Measurement Protocol · Events API) which is stored
**AES-256-GCM-encrypted** (`INTEGRATION_TOKEN_KEY`) and never returned to the browser — the UI only
learns *that* a token exists. Owner-only (`integrations:write`). The storefront then bootstraps exactly
those pixels per store (`MarketingPixels.astro`, tenant resolved from the Host) and fires PageView ·
ViewContent · AddToCart · InitiateCheckout · Purchase.

**Three decisions worth knowing before touching this:**
- **`content_ids` are the ids the product feed already emits** (`handle`, or `handle-{n}` per variant).
  ONE helper — `@tokophi/lib/tracking-ids` `retailerId()` — is called by both `/feed/google.xml` and the
  conversion payload, so a merchant who pasted the feed URL into Meta keeps ONE catalog instead of two.
- **Purchase comes from the order row, never the success page.** `tracking_event_deliveries` (0080) IS
  the queue; `api/cron/tracking-events` (new `cron-tracking-events` sidecar, 60 s) drains it with an
  atomic claim, bounded exponential backoff and a `dead_letter` state. **COD counts at order creation;
  prepaid counts when the payment callback confirms.**
- **Browser and server send the SAME `event_id`** (`purchase:{store_id}:{order_number}`, issued by the
  order API and echoed to the pixel) — that shared id is the only thing standing between one sale and
  two counted conversions.

Provider error bodies are redacted (`capi-sanitize.ts`) before they are stored or shown, because Meta
and TikTok echo the request — token included — back on a rejection. `verify-rls` green 48/49.

**Not built, deliberately:** Meta OAuth / asset discovery, catalog PUSH via the Catalog API (the pull
feed covers it), webhooks, super-admin cross-tenant health, and any consent gate (this repo has no
consent mechanism at all — see `TASKS.md`). **No live provider call has been made yet** — verification
so far is builds, unit tests, RLS and review.

## Unreleased — Promo/PDP money paths + `/tema` per page type

### 🏷️ `nonaktif` = OFF; the DATES are the schedule (contract change)
Both the voucher and flash-sale readers filtered `status = 'aktif'`, so a `terjadwal` flash sale
**never went live** (nothing ever promoted the row) and a `terjadwal` voucher was redeemable at
checkout while invisible on `/promo` and labelled "Terjadwal" in the seller list — three definitions
of "usable" for one row. Both now filter `status <> 'nonaktif'` **plus** the date window.

### 💸 Six places where the screen and the till disagreed
- `lib/actions/discounts.ts` anchored `starts_at`/`ends_at` to `ADMIN_TODAY = 2026-06-30`, so **every
  voucher a merchant created was born already expired**, and re-saving one moved its expiry backwards.
  Real clock now; a blank period writes `ends_at: NULL` (what the editor always promised).
- The voucher usage limit is re-checked **inside the order txn**, in the UPDATE's own WHERE. It was a
  bare `used_count + 1` over an unlocked read, so concurrent orders all drained the last slot; the
  loser now rolls the whole order back with a 409 (`VoucherExhausted`).
- A flash sale now reaches the **variant** rows (`Math.min` per row). It only hit the headline price,
  so a flash product with options showed the pre-sale price next to its own "-43%" badge while the
  order API charged the sale price.
- A sold-out product with no `product_options` kept an **enabled buy button** (server-rendered now) —
  5 of the demo's 22 active products are that shape. A non-existent option combination kept the
  PREVIOUS variant, so the page said "Beige / L" and the cart line said "Hitam / L".
- The PDP's hand-rolled price formatter emitted `Rp199.000` where the server's `IDR()` emits
  `Rp 199.000` (NBSP), so the price reflowed the moment JS touched it. Same `Intl` formatter now.

### 🏷️ `/promo` is a DEFAULT nav item now
The only link to the promo hub was inside the mega-menu's utility bar, gated on the store owning a
`promo-gajian` collection — and its LABEL was that collection's name while its href was `/promo`, so
it promised a category and delivered a different page. A store with live vouchers and a running flash
sale published an indexable hub with **zero inbound links**. `/promo` is now:
- a **seeded main-menu item labelled "Promo"** (was "Promo Gajian" — a collection name on a route), and
- part of the **fallback nav**, so every store gets it, including freshly provisioned ones.

**And the manual "Promo Gajian" COLLECTION is gone.** Its membership was literally
`seededProducts.slice(0, 8)` — an arbitrary first-eight with no relationship to what was actually
discounted, so it advertised "Promo" over full-price goods while genuinely reduced products sat
outside it. `/promo` computes the same idea from the real thing (flash sale ∪ markdowns ∪ vouchers ∪
free-ongkir) and cannot drift: on the demo it shows **100 product cards, 4 voucher codes and a live
countdown** where the collection showed 8 hand-picked items. The CAMPAIGN name lives on where it
belongs — the flash sale is still called "Promo Gajian" and it is the hub's `promo_hub_title`.
`/kategori/promo-gajian` now 404s.

It is an ordinary menu item: a merchant who does not want it deletes or renames it in Navigasi, and a
merchant-built menu wins over the fallback entirely. Not gated on "does this store have a promo right
now" — promos come and go all month, and a menu item that appears and vanishes underneath the merchant
is worse than one that sometimes leads to the honest empty state `/promo` already renders. The manual
"Promo Gajian" collection still exists at `/kategori/promo-gajian` and still shows in the collection
bento; only the nav entry changed. The duplicate utility-bar shortcut is gone.

### 🎨 Store Builder: three page types, three palettes
`page_templates.type` has been `homepage | category | product` since ADR 0009 and the builder offered
**the same eleven sections to all three** — it never received the type. `puckConfigFor(type)` now
narrows the palette from `SECTIONS_BY_TEMPLATE_TYPE`. The **palette** is narrowed, never the renderer,
so nothing already published disappears.
- **`CategoryHero` is always rendered.** A category template used to replace the entire page, costing
  it the `<h1>`, the breadcrumb and the cover while the BreadcrumbList JSON-LD kept publishing a trail
  nobody could see. The template is the page's **body**.
- **New: `product-listing` ("Daftar Produk")** — the real catalogue (server-side sort, 12-per-page
  pagination, one empty state), wrapping the same `ProductListing.astro` the hand-built page uses.
  The only product section on offer had been Grid Produk, a flat slice capped at `limit`, so building
  a category template **silently truncated the catalogue** and threw away sort + paging.
- **New: `faq` + `multicolumn`** — Shopify Dawn's "Collapsible content" and "Multicolumn", adapted.
  FAQ is native `<details>/<summary>` (no JS; keyboard + screen-reader accessible for free) and
  answers the questions that decide an Indonesian sale on the PDP tail. Both ship **empty** and render
  **nothing** until the merchant adds a row. Dawn's Newsletter was deliberately **not** ported: there
  is no mailer here, so the form would collect addresses nothing reads.
- `category` was the one template type never seeded — the demo could not show what one looks like
  while the builder let merchants create one. Seeded now, matching what Batik Nusantara renders live.
- Icon keys moved to `@tokophi/sections`, so the builder's picker is derived from the same allow-list
  the renderers use; an unknown key falls back to a neutral dot on both sides.
- Publish shows "Menyimpan…" (two clicks used to write twice) and Puck `permissions` refuse editing
  for a role without `theme:write` (it could edit the whole page and only find out at Publish).
- Hero slide default `ctaHref` was still `/kategori/dress`, a handle only the demo owns → 404 on every
  other store. Now `/kategori/semua`.

## Unreleased — Checkout: explain why COD is hidden

### 💬 COD unavailable → a reason, not silence
A store that turns COD on and then sees no COD option at checkout read it as broken. COD is genuinely
hidden until its chain is satisfied (courier = SPX, destination in the 6 allow-listed provinces, total
≤ Rp2 jt), but hiding it with **zero feedback** made "enabled but invisible" look like a defect. The
checkout now shows a single helper line (`#cod-hint`, written by `syncCod`) explaining the one unmet
condition — non-SPX courier ("pilih kurir SPX"), SPX not serving the route ("belum melayani rute ini"),
province off the allow-list, or over the cap. It is **not** a fake greyed-out COD row (a payment the
shopper can click but we would reject is still a lie), it never shows before a courier is picked, and it
disappears the moment COD becomes available. `/api/public/order` stays the boundary — this is UX only.
This reverses the earlier "hide silently, no excuse" decision at the user's request. Verified in a
browser against the live ongkir API.

## Unreleased — Admin shell: Promo nav group + mobile menu + ⌘K command palette

### 🧭 Sidebar "Promo" group, mobile drawer fixes, Vercel-style search
Diskon/Flash Sale/Landing Page collapsed into one **Promo** parent (Voucher · Flash Sale · Landing
Page); routes unchanged. Mobile drawer now **closes on a nav tap** (was covering the page it navigated
to) and the `TokoΦ` wordmark's Φ is no longer clipped. Search replaced with a **⌘K command palette**
(centered Dialog, keyboard-first, searches every admin page + the RLS-scoped pesanan/produk/pelanggan
index, works on mobile). Nav active-state also fixed for groups whose children don't share the parent's
path prefix (Promo; Keuangan→/saldo).

## Unreleased — PROMO system (voucher · free ongkir · flash sale · /promo hub)

### 🏷️ Unified promo page + seller tools (P0–P5)
Vouchers apply at checkout (P0); automatic free shipping by store threshold (P1, migration 0075); flash
sale with time-boxed price drops honored server-side + storefront strikethrough/countdown (P3, migration
0076); a unified `/promo` hub gathering banner + vouchers + flash sale + discounted products, with the
nav "Promo Gajian" repointed from a category to this page (P4a); a Seller flash-sale editor (P3c) and a
merchant-configurable hub banner (P4b, migration 0077); demo seeded into `seed:recent` (P5). All money
paths re-priced authoritatively in `/api/public/order`; every stage browser-verified.

## Unreleased — Cetak resi: sandbox preview

### 🖨️ Demo "Isi resi contoh" to preview label printing
"Cetak resi" is (correctly) disabled until a courier issues a real AWB — which never happens in
sandbox, so the print-label flow could never be seen. A sandbox-only **"Isi resi contoh (demo)"** button
in the shipment card stamps a clearly-marked placeholder AWB (`DEMO<order>`) onto `orders.awb`, enabling
"Cetak resi" so the thermal label + Code128-B barcode can be previewed. Guarded: `fillDemoResi` REFUSES
when `KIRIMINAJA_ENV=production` (a fake AWB is a label no courier can scan — the anti-pattern
`printLabel` guards) and the button only renders when `demoAllowed`. `trackShipment`/the poller overwrite
the DEMO value with the real waybill the moment KiriminAja returns one. No change to the real booking or
label logic.

## Unreleased — Landing Page (single-page COD, standalone + AI copy)

### 🎚️ Order-form field toggles (form_config)
Per-landing control over which OPTIONAL order-form elements show — **Email** (optional input →
customer.email), **Jumlah** (qty stepper, subtotal/ongkir/order all follow the qty), **Badge
Kepercayaan**, **Ringkasan Pesanan** — via a shared "Field Form" card in both editors (product-promo
and custom-HTML). The 4 core COD fields (Nama · WhatsApp · Alamat · Kecamatan) are always shown — hiding
them would break a COD order. Stored as `form_config` jsonb on both tables (migration 0069), resolved
against defaults by `@tokophi/lib/form-config` so an empty {} behaves exactly like the original fixed
form. The OrderFunnel renders the toggled fields and its script is null-safe when a section is hidden.
Verified in-browser: qty stepper updates the summary (Sage/M ×3 → Rp375.000), email field renders,
console clean.

### 🧩 Custom-HTML landing (`/lp/<slug>`) — paste your own design
A second landing kind: the merchant pastes their OWN full landing HTML (Seller → Landing Page → Landing
HTML Custom → Buat baru) and picks ONE product; the storefront renders the HTML verbatim, then
auto-appends the shared checkout bound to that product, plus a floating "Pesan Sekarang" CTA that scrolls
to it. Keyed by a merchant-chosen slug (`landing_pages`, migration 0067 + RLS 0068), so one product can
back several landings. The COD order funnel was extracted from `/promo/<handle>` into a shared
`OrderFunnel.astro` (+ `lib/packages.ts` for identical pricing) so both landing kinds POST the exact same
proven `/api/public/ongkir` + `/api/public/order` — no duplicated money path. Pasted `<script>` does not
execute (set:html / innerHTML semantics) — a conservative default for arbitrary markup. Verified
in-browser: inline-styled HTML renders, funnel appends, floating CTA works, console clean; `/promo`
regression-checked after the extraction.

### 🙏 Post-checkout redirect → `/thanks`
On a confirmed order the funnel now redirects to a standalone **thank-you page** (`/thanks?order=…&name=…
&total=…&pm=cod&…`) instead of an inline success block — matching the reference funnel. It reads order
details from the query string (display-only; the order is already committed server-side by
`/api/public/order`), carries the SERVER-priced `shipping`/`total` (not the tab's last estimate), shows
the order summary, and offers a prefilled **Konfirmasi via WhatsApp** button (the channel COD actually
closes on). `noindex,nofollow`. Verified in-browser.

### 🖥️ Standalone full landing (no site chrome) + AI-generated sales copy
`/promo/<handle>` now renders through `LandingLayout` — **no Header nav, no Footer, no Chat bubble**,
just a slim link-less store-name strip. A funnel holds attention on one product; the storefront menu is
the distraction it must not have. The body is now long-form direct-response: hero → **Masalah** (problem
+ agitation, amber card) → **Solusi** (brand card) → Manfaat → Ideal Untuk → Testimoni → **Garansi** →
order form. These sections come from `promo_pages.content` (jsonb, migration 0066).
**"Generate dengan AI"** in the editor shells out to the **Claude Code CLI** (`claude -p … --output-format
json`, via `execFile` — no API key to store, no SDK dep; the CLI carries its own auth) to write
headline/badge/problem/agitation/solution/benefits/ideal-for/guarantee from the product's own
name/description/category/price; the draft fills the form, the merchant reviews and Saves (never
auto-saved). Graceful when `claude` isn't on PATH ("Claude CLI tidak ditemukan"). Verified end-to-end:
the real prompt returns all 11 fields, parsed clean. Seller nav label is
now **"Landing Page"**. Verified in-browser: menu gone, all long-form sections render, console clean.

### 🚀 New feature — per-product direct-order landing (`/promo/<handle>`)
A merchant can turn one product into a single-page COD order funnel (petanisejahtera-style): product
info + Manfaat/Ideal-Untuk + testimoni + countdown/scarcity + the order form (Nama/WA/Alamat/Kecamatan
autocomplete) + live ringkasan, all on one page. **It is NOT a second checkout engine** — it POSTs the
same battle-tested `/api/public/ongkir` (area search + rates) and `/api/public/order` (creates the
order; RE-PRICES goods/ongkir/PPN and re-validates every field server-side; enforces the COD chain).
The client helpers (`normalizePhone`, request shapes, `variant = "option1 / option2"`) are ported
verbatim from `checkout.astro` so the two can't drift. COD-only for v1 (`channelCode:"cod"`); prepaid is
a payment-picker away. `robots="noindex"` + opt-in: no enabled row → the URL 404s (the product still
lives at `/produk/<handle>`).

### 🎛️ Seller — "Halaman Promo" editor (Toko Online group)
`/promo` lists active products with an on/off badge + copyable share link; `/promo/[id]` edits the
config (enable, headline/subheadline/badge overrides, Manfaat bullets, Ideal-Untuk chips, countdown
minutes, scarcity toggle). RBAC `content:write`; writes via `savePromoPage` (upsert, child-table rule:
the product is re-read under RLS before its id is written).

### 🗃️ DB — `promo_pages` (migration 0064 + RLS 0065)
One row per (store, product): `enabled`, `headline`/`subheadline`/`badge` (null → product fallback),
`benefits`/`ideal_for` (jsonb string[]), `countdown_minutes`, `show_scarcity`. RLS `tenant_isolation`
on `store_id`; `verify-rls` green (it now REQUIRES this policy). ⚠️ `generate` re-proposed the already
-applied 0062/0063 ALTERs (those migrations never refreshed the meta snapshot) — stripped from the
0064 `.sql`; the 0064 snapshot now carries them so future generates stay clean. Seed enables one demo
landing (`celana-kulot`). Verified in-browser: overrides + sections render, countdown counts, opt-in
404 gate holds, console clean. NOT exercised locally: live rates + order submit (needs
`KIRIMINAJA_API_KEY`, empty on this box — same limit as the cart checkout).

## 2026-07-22

### 🛍️ Front-end pass: sold-out badge · footer that belongs to the merchant · icon header + ⌘K palette

**"Stok habis" on the product card** (audit #16 finding 4, the half that never landed). The rule was
not rewritten — `inStock` already existed as two copies inside `produk/[handle].astro` and the card
was about to be a third; it now lives in `data/catalog.ts` and all three read it. It agrees with
`/api/public/order` by construction (both count a missing `inventory_levels` row as 0), and a product
with NO variant rows still counts as available — a merchant's brand-new product must not read "habis".
An overlay rather than a third corner pill, because it changes what the whole card means; the −%
badge is suppressed with it (a price cut on something nobody can buy is bait), while the merchant's
own badge stays — that is their data, not our claim.
⚠️ The refactor nearly shipped a silent SEO lie: with `inStock` now a FUNCTION, two JSON-LD lines
still using it as a boolean would have told Google every sold-out product was `InStock` forever.

**Footer: both nav columns are the merchant's now.** "Koleksi" (auto-derived, unorderable) and a
hardcoded "Belanja" were platform content living in a tenant's shop — the pattern `data/nav.ts`
keeps fixing. Column 2 is `getMainNav()`, column 3 `getFooterNav()`; neither can point at a 404
(unpublished categories and draft pages are already dropped). Contact, address and social icons move
into column 4; `SocialLinks.astro` is split out. A dropdown parent renders as a LABEL — its href is
stripped upstream, so linking it would emit `href="undefined"`.

**Header is icons; the magnifier opens a ⌘K palette.** Native `<dialog>` + `showModal()` for the
focus trap, Esc, inert background and `::backdrop`. Grouped results (Kategori + Produk with
thumbnail, price, sold-out) from `/api/search`, which projects the SAME `catalog.search()` `/cari`
renders — the two cannot disagree. Not rate-limited, deliberately: it reads a catalogue already
public on `/produk` and in `sitemap.xml`.
⚠️ **`/cari` had no search box of its own** — it leaned on the header form. Adding one there is a
precondition of the icon header, not a nicety: without it a JS-less visitor has nowhere to type and
a results page cannot be re-queried. The trigger stays an `<a href="/cari">` for the same reason.
**No account icon** — there are no shopper accounts by design, and the "Akun" pill was removed once
already for pointing at a fake login. The honest version is a "Lacak Pesanan" page, tracked separately.
Three browser-found defects fixed: Esc was eaten by the search input's native clear; the native ✕ sat
beside ours; and the cart badge, `hidden` at zero, could never appear because the counter script only
set `textContent`.

### 🔎 Storefront listing: filter + pagination — the last two items of audit #16
The product listing rendered **every** product, every time, and offered no way to narrow it. Both gaps
close in `ProductListing.astro`, so `/produk`, `/kategori/<handle>` and `/cari` get them from one edit.
- **Pagination**, 12 per page (12 divides the 2/3/4-column grid exactly, so no page ends on a ragged
  row). Real `<a>` links, `?page=` in the URL, page 1 is the bare URL, out-of-range is **clamped** to
  the last real page rather than 404'd or blank.
- **Filter**: `?kategori=`, `?min=`/`?max=`, `?promo=1` — each control rendered **only when it can do
  something** (category picker only if the products span >1 category, promo toggle only if something
  is discounted, price range only if there is a spread), and **a param whose control is not rendered
  is ignored, not applied** — otherwise `?kategori=x` empties a grid with no visible way back.
- **`RevealGrid` removed from this listing** (it still serves `/blog` + `/kategori`): stacked on real
  paging, a phone showed both "Muat lebih banyak" and "Halaman 2" — two lookalike controls, one of
  which cannot be linked to.
- **The filtered-empty state is not the empty-catalogue one** — "Belum ada produk" under someone's own
  filter blames the shop for the shopper's choice. The way out is Reset, not Beranda.
- ⚠️ **No size filter, deliberately.** `products.sizes` is a label list; stock lives per variant in
  `product_variants.stock`. "Punya ukuran L" that ignores variant stock claims a size we may not have.
- ⚠️ **`form.submit()` does not fire the `submit` event.** A GET form posts every named control, so a
  shared URL read `?kategori=dress&min=&max=&sort=terbaru`. `dropEmpties()` disables the empties first
  — and the sort auto-submit path calls it by hand, because the event never reaches it.

### 🔴 `audit:responsive` had been CRASHING, not passing
Since the demo store got an active primary custom domain (`store_domains` → `toko-demo.test`,
2026-07-15), middleware 301s every other host to it — a name no dev machine resolves — so the sweep died
on the first `page.goto` with `ERR_NAME_NOT_RESOLVED`. It never said "0 breaks"; it printed a stack
trace, in a script nothing runs on a schedule. **The storefront shipped for weeks with its responsive
gate face-down** — the same shape as `verify-rls` being red for weeks. The script now probes for the
redirect and maps that hostname back to the dev port inside the browser (`--host-resolver-rules`),
touching no DB row, and is a no-op where no custom domain is configured. Two listing routes added to
the sweep, including the filter bar in its most-populated state.

## 2026-07-20 / 21 — PRs #9–#26, ~10 verified production deploys (`main` → `036f05e`)

### 🔐 Security — four MORE cross-tenant holes, found by auditing the class
`e61df25` had patched the three call sites it happened to find. Enumerating **every** writer of a table
with no `store_id` found four more, all shipped: `media.ts` (`e9656fd` — `media:write` could delete
another store's product image; `product_media` has no `store_id` and `relrowsecurity = f`), plus
`deleteDiscount`, `createPurchaseOrder` and `syncChildren` (`30a3c71`). Also `cae0deb`: the two
`jwtVerify` calls `cb17372` claimed to have pinned but missed — including the gate on the platform
control plane. **The rule is now in AGENTS.md ("THE CHILD-TABLE RULE") and `verify-rls` gained check 5c**
so the class cannot grow unnoticed — its failure path was exercised, not assumed.

### 📦 Order state, inventory, resi
- `35db72d` — one writer for `orders.status`. ⚠️ Routing through the state machine was NOT sufficient:
  it treats only `batal`/`retur` as terminal **on purpose** (`selesai → retur` must stay legal for the
  ledger claw-back), so it would happily execute `selesai → diproses` and un-complete a delivered,
  cash-collected COD sale. The shipment refusal set is permanently wider; +2 tests pin exactly this.
- `dde9c09` — the tracking poller raced manual status changes; `createShipment` checked terminal against
  a **pre-network** read.
- `80fb83b` — the checkout checked stock across ALL locations and decremented ONE; `receivePurchaseOrder`
  was a read-then-write.
- `8cc7080` — a **partial** print run stamped un-labelled parcels as printed: they left the "belum
  dicetak" filter and silently never shipped.
- `3eefe02` — one non-JSON gateway reply aborted the whole tracking sweep; the poller could starve orders
  forever; the run summary went to `/dev/null`.
- `0746806` — migration **0062**: `orders.problem_at`/`problem_note`, a merchant-facing stuck-parcel flag.
  Same commit captures the **raw KiriminAja payload**, which is what makes the two open resi questions
  (#12) answerable from a single real booking instead of unanswerable forever.
- `d5fd5d4` — "Batalkan penerimaan": receiving a PO by mistake was a dead end. Guarded by a
  compare-and-swap, strictly stronger than a read-then-check.

### 🎨 Front-end
`cd8cefb` product search (`/cari`) · `4ab223c` responsive `srcset` via an on-demand resizer with an
**allow-listed** `?w=` (the allow-list is the security boundary: `?w=1` merely ignored is still a
cacheable URL, and a first pass using `Number(raw)` smuggled the unbounded key space back in through
`400.0`/`4e2`/`0400`) · `cb219f6` a 404 that recovers the sale · `092543a` URL-driven sort (the form
carries `q`, so sorting `/cari` does not throw the search away) · `3508da0` three primitives + the routes
`/produk`, `/kategori`, `404.astro` that did not exist · `076be02` + `7dedea8` migration **0063**: public
address (deliberately NOT the courier pickup address) + 5 social handles, and a redesigned footer whose
EMPTY state was verified first · `9249824` favicon accepts any raster format and becomes a real PNG ·
`bef9d75` skip link + reduced-motion · `66683c8` **dates were rendered in the runtime's timezone** — Node
said UTC, the browser said WIB, and the 7-hour gap also filed products under the wrong DAY in the server
HTML.

### 📐 Method
Deploys are verified by recording the container ID and only trusting one once it is **REPLACED**, then
reading the shipped HTML / DB columns — after a health-only check reported "rebuilt + healthy" about the
PREVIOUS build (DEPLOY.md). Core Web Vitals measured on prod mobile 3× (**LCP 348–552ms, CLS 0**) and
deliberately left alone. Five 🟢 REAL rows in STATUS.md were broken when written; each failed the same way
— the check stopped one layer short of the seam. **#15 closed as superseded**; the shared local-`main`
checkout was left untouched.

## 2026-07-18

### 🔍 Deep audit — money / order-state / shipping / security correctness (10 fixes)

A four-front deep audit (money+ledger, shipping+tracking+COD, inventory+fulfilment, auth+RBAC+RLS)
hunting LOGIC bugs and half-complete flows, not dead UI. Everything below is committed, and every
money/state path is left with a test or a rolled-back SQL check. Ordered by severity.

**Security / cross-tenant**
- `e61df25` — `updateProduct` / `updateCollection` / `deleteCollection` rewrote child tables that have
  NO `store_id` and NO RLS (`product_options`/`variants`/`inventory_levels`,
  `collection_products`/`conditions`) keyed on the client id, while the parent UPDATE silently no-op'd
  under RLS. A merchant could pass another store's id and delete/rewrite its options, variants,
  inventory, category membership. Each now reads the parent under RLS first and bails if it isn't ours
  (the guard `duplicateProduct` already used).
- `cb17372` — `/impersonate` accepted ANY session-shaped JWT signed with AUTH_SECRET (a stolen 7-day
  admin session could be exchanged for a fresh session). The impersonation token now carries a distinct
  audience (`tokophi:impersonate`) that `/impersonate` requires; `algorithms:["HS256"]` pinned on every
  `jwtVerify`. (Adding an audience to the long-lived SESSION tokens is deferred — it forces a mass
  re-login and wants a deliberate rollout.)
- `7cc1ecc` — `/api/public/order` + `/ongkir` resolved the tenant with `storeSlug || "batik-nusantara"`,
  silently attributing a slug-less request to the demo store. Both now fail closed.

**Money / order state**
- `9772246` — order status changes had no row lock and a weak guard: concurrent changes double-restored
  stock, `batal`↔`retur` restored twice, and a paid-then-cancelled order NEVER reversed its ledger
  credit (withdrawable money for a refunded order). Now `FOR UPDATE` + same-status/terminal guards, and
  `batal` reverses the credit like `retur` (reusing the one-reversal-per-order index). +3 ledger tests.
- `5f61034` — COD orders never reached `financial_status='dibayar'`, so the Perlu Dikirim tab + bulk
  shipping queue excluded them entirely — COD (the dominant channel) could not be shipped at all. The
  queues now treat COD as ready-to-ship (it's pay-on-delivery), and delivery marks it paid. +1 test.
- `521861d` — the `payments` row was inserted AFTER the order txn committed, so a DB blip left an order
  with no payment (COD uncollectable; AutoLaris untrackable → shopper retries → double bill). It is now
  created INSIDE the order transaction (AutoLaris enriched with gateway VA/trxId afterward).
- `9dc99bf` — the subscription auto-renewal cron billed the ex-PPN base while the manual path billed
  base + 11% PPN — under-collecting VAT on every automatic renewal. Aligned.

**Shipping / tracking**
- `ee8a458` — the tracking poller force-collapsed any unmapped status to "shipped", pinning a delivered
  parcel at `dikirim` forever (COD never collected/credited); it also read `status` as a number when
  KiriminAja may send text. Now unmapped → AWB-only (no forced status), text is accepted but can never
  auto-yield a money-moving outcome (delivered/returned) — those need the numeric code or a manual
  click. `createShipment` books at `diproses` (not `dikirim` before the AWB); `cancelShipment` resets
  status; `problem` parcels are logged + counted.

**Inventory**
- `b1f3603` — stock decrement/restore updated every location row of a variant (N× under multi-warehouse
  — a latent landmine); both now target the default-location row. Cancelling a *received* PO (which had
  already added stock) is now refused instead of silently deleting the record and stranding the stock.
- `bc2ebfd` — the bulk stock editor was last-write-wins on an absolute value, clobbering a sale that
  landed between page-load and save (resurrected sold units → oversell). Now optimistic: the client
  sends the loaded value, the server locks the row and skips it if it changed, and reports skips.

**Deferred (needs a product decision or a subsystem, not a drive-by):** promo-code discounts
(`discount_idr` is authored but never applied — a whole feature; the total stays internally
consistent); the fuzzy origin fallback when no pickup address is set (documented behaviour — the fix
is requiring a pickup address / rejecting orders, which could block checkout); session-token audience
(mass re-login); a merchant-facing `problem`-parcel flag (needs an `orders` column — logged for now).

### 🖼️ The Jurnal's images are editorial now — topic-true photos, not reused product crops

`seed-journal.ts` illustrated every article by cropping the store's catalogue shots
(`apps/admin/public/products/*.webp`) to the card's 3:2. That was honest-ish for a batik store but
literally wrong per article: **"Cara Mencuci Batik" showed a model wearing a dress**, "Baju Rajut
Melar?" showed a cardigan on a hanger. A journal illustrated by whatever product was nearest reads as
a placeholder.

Replaced with **15 dedicated editorial header images**, one per published article, committed at
`apps/admin/public/journal/<handle>.webp` (900×600 WebP q82, 28–80 KB, 670 KB total). Each matches its
topic — hands waxing batik with a canting, a batik cloth hand-washed in a basin, an office-batik
flatlay, knitwear folded flat on a shelf, a wrapped parcel for the shipping post. `makeImage` now
sources from `journal/<handle>.webp` instead of `products/`; the rest of the pipeline is unchanged
(same 3:2 crop, WebP q82, `media` row, `/api/uploads/` path — so the images still land in the Files
library exactly as a merchant upload would). The draft stays imageless (brand-tint fallback).

Verified: `seed:journal` re-runs clean (16 articles, 15 images, 45 KB avg), every `jurnal-*.webp`
serves `200 image/webp`, `/blog` renders all 15. Content is unchanged — it was already good.

## 2026-07-17

### 🖼️ The Blog editor's image control was a dead button — and it was hiding a bug that DELETED merchant text

Asked to fill the demo's journal with images, and found the feature it would have been faking.

**The "Gambar unggulan" card was a `<button>` with no `onClick`, no input and no handler.** Pure
decoration wearing a control's clothes. It also lied about the limit: *"PNG, JPG, atau WEBP hingga
5 MB"* while the server's cap is **2 MB** (`image-store.ts` `MAX_BYTES`). `ArticleInput` had no
`imageUrl` field at all, so `articles.image_url` could only ever be set by the seed — **no merchant
could give an article a picture, ever.**

**Worse, underneath it: opening an article and pressing Simpan DELETED its body.** `lib/data/articles.ts`
never selected `body`, so the editor fabricated one — `${post.excerpt}\n\n${post.title}` — and every
save writes the whole input back. The demo's `cara-merawat-rajut` holds **908 characters** the merchant
wrote; one click would have left ~60. A read layer that under-selects is not "missing a field", it is
a **silent delete on the next save**.

Both fixed: `sel` now takes `body` + `imageUrl`, the editor renders the real text, and the image card
uploads through **`uploadMedia` — the same action the Files library uses**, so one pipeline owns WebP
conversion, the 2 MB gate and the media row. The size hint now states the server's number.

**The storefront half.** Uploads are served by the ADMIN app; the storefront is a different origin, so
a raw `/api/uploads/…` path 404s there. `mediaUrl()` existed for products and the logo but not
articles. Applied **once, in the read layer** (`content.ts`) rather than at the four render sites (the
Jurnal card, `/blog`, the article page, its `og:image`) — a rule applied per call site is one new call
site from being forgotten, and `og:image` needs the absolute URL anyway.

**The demo's journal: 16 articles (15 published + 1 draft), 15 images, 228 KB total — 15 KB each.**
New `seed-journal.ts` puts every image **through the upload pipeline** (3:2 crop to the card's lock,
WebP q82, `media` row) instead of pointing at static `/products/*.webp` as the old 6 did. The demo is
now reproducible by hand: a merchant can rebuild every row with the editor. The draft is deliberate —
publishing is a security boundary and nothing else exercises it — and it has **no image**, because the
brand-tint fallback is a real state too.

⚠️ **A deploy break caught before shipping.** The `migrate` service does **not** mount
`tokophi-uploads`; only `admin` does. `seed-journal` writes FILES, so in production it would have
written 15 WebPs into an ephemeral container, exited, and left 15 media rows and 15 articles pointing
at images that 404 — while the deploy log said the journal seeded fine. The volume is now mounted on
`migrate` too.

**Verified end-to-end** (`astro check`/`tsc`/eslint all clean, then driven in a browser — and the dev
server lied first: `/files` was dead there, but hydrates correctly on **live**, so that was Turbopack
HMR, not a product bug):
- **Upload rules, against the real `image-store.ts`**: WebP 41 KB → 41 KB **byte-identical**; PNG
  325 KB → **40 KB**; JPG 67 KB → 40 KB; SVG passes through as SVG; WebP 2600px → resized 2000×2000
  q92; **PNG 25.79 MB rejected** (`file too large`); `.txt` rejected (`not an image`).
- **The editor, on a production build**: the real 889-char body loads (not the fabrication), the
  featured image shows, "Ganti" uploads a **PNG → WebP**, Simpan persists it, and **`media` went
  15 → 16** — it lands in Files like any other upload. Body still 889 after the save: lossless.
- **Storefront**: homepage Jurnal renders 3 uploaded images (naturalWidth 900), `/blog` lists 15, the
  **draft never appears in the HTML**, `og:image` is absolute, **zero 4xx** on `/api/uploads`, 0
  console errors. `RevealGrid` now actually runs on `/blog` for the first time (5 articles never
  exceeded its 9-item first page): "Menampilkan 9 dari 15 tulisan" → "Muat lebih banyak" → all 15,
  no broken images.

### ✅ Seven disabled stubs became real features — the admin no longer lies about what it can do

A frontend audit had turned every button with no backend into an honest disabled "segera hadir" stub
rather than a no-op that silently does nothing. This closes all seven of them. Each was typechecked +
linted and exercised at the SQL level (test rows always cleaned up — the shared DB stays honest).

- **CRM lead pipeline** (`cb1fbf2`) — the Kanban could read leads but every write was a stub. Added
  `createLead` / `setLeadStage` / `deleteLead` (`crm:write`, `withTenant`): "Tambah prospek" saves,
  the card menu moves a lead to any stage or deletes it. Source arrives display-cased ("WhatsApp") and
  is lowercased to the pgEnum on insert.
- **WhatsApp templates** (`6e3e45c`) — `createWaTemplate` / `updateWaTemplate` / `deleteWaTemplate`.
  One controlled dialog serves create + edit (mounted only while open, so fields seed fresh each time);
  Duplikat clones a row as "(salinan)"; the variable chips now append their token to the body.
- **Tambah Pelanggan** (`855f2ec`) — `createCustomer` (`customers:write`): a merchant logs a WA/walk-in
  buyer by hand. `registeredAt` stays NULL — a hand-added customer is a guest like any other (0044).
- **Hapus Pelanggan** (`050c00c`) — `deleteCustomer` hard-deletes but catches Postgres 23503 and
  refuses with "punya riwayat (pesanan/ulasan)". The FK constraints ARE the guard: only a truly
  unreferenced (just-added) customer deletes; anyone with history is protected by the DB itself.
- **Balas ulasan** (`b06be61`) — migration **0060** adds `reviews.reply` (nullable). `replyToReview`
  (`content:write`, empty clears to NULL). The PDP renders a "Balasan penjual" block under the review,
  **only for `status='terbit'`** — a hidden review's reply never leaks to a shopper.
- **Kelola pengguna staf** (`a234a86`) — Pengaturan → Pengguna was a mock list of three names. Now it
  reads real `store_users` (RLS-scoped) and writes: invite (creates the login user if new, scrypt temp
  password shown ONCE for WhatsApp hand-off — no mailer), change role, remove. Gated on `settings:write`,
  which **only the owner role has** (`rbac-policy`: admin = all caps minus `settings:write`) — staff can
  never manage staff. Owner protection: the owner's role can't change, they can't be removed, you can't
  remove yourself. ⚠️ **Writes use the OWNER connection deliberately** (documented in `lib/actions/users.ts`):
  `users` is a GLOBAL table (no `store_id`, no RLS) — the same table `auth.ts` and super-admin write on
  the owner connection; `tokophi_app` has no INSERT grant on it. The tenant boundary is held by scoping
  every `store_users` row to `session.storeId` from `requireCapability` (never a client value), exactly
  like super-admin's `createStore`. Verified at SQL level: a new member is visible to its own tenant's
  RLS read and invisible to another tenant's.
- **"Lihat di toko"** (`7709041`) — the category page builds the store's public URL server-side
  (`getStoreSlug(session.storeId)` → `systemDomainFor(slug)` → `https://<slug>.tokophi.id`, the same
  always-on origin the Domain settings card uses) and passes it to the client; `getCollections` now
  carries the `handle`. Opens `<base>/kategori/<handle>` in a new tab — but only for a PUBLISHED
  category (a draft would 404, so it's gated).

**DB CONTRACT:** migration 0060 adds `reviews.reply`. Run `npm run migrate -w @tokophi/db` after
pulling. RLS unaffected (`reviews` already store-scoped; `verify-rls` green). `leads`, `wa_templates`,
`reviews` and `store_users` are now WRITE surfaces for the admin.

### 📰 Jurnal on the homepage — a 9th section, and the merchant's articles finally reach the front page

The merchant writes articles in Dashboard Seller → Blog, and the only way a shopper ever found them
was to already know `/blog` existed. Now the homepage carries them.

**Built as a SECTION, not as markup in `index.astro`.** ADR 0009's registry has two halves — the
storefront's `SectionRenderer` and the admin's Puck config, sharing `@tokophi/sections`. Adding it as
a 9th type means the merchant can move it, retitle it, or remove it in the Store Builder like any
other. `Config<SectionConfigMap>` made that mandatory rather than optional: the moment `blog` joined
the map, **TypeScript refused to compile until both halves existed** — the registry is genuinely
exhaustive, which is the whole point of it.

**The section renders NOTHING until an article is published.** Not an empty state, not a "belum ada
tulisan" placeholder — this is the shopper's homepage, and an empty husk announcing an empty journal
is worse for the shop than silence. `/blog` keeps its empty state because a shopper went looking for
the journal *there*; nobody asked for one here. **Verified, not assumed**: a throwaway homepage
template on `kopi-senja` (0 published articles) rendered the page at 126 KB with zero trace of the
section — no heading, no cards, no husk. Template deleted afterwards.

**Position: above the closing CTA, not last.** "Bagian bawah" was the ask and this is it, but ending
the page on a row of articles sends the shopper off to *read* instead of to buy, and strands the
closing CTA mid-page where nothing concludes. Journal, then the ask — same reason Dawn does it.

**`ArticleCard.astro` extracted** and now used by BOTH `/blog` and this section (~40 lines of
duplicated markup deleted). `3ce6d6c` had already found this tile and `ProductCard` "do the same job
and had different radius, boundary technique and hover lift" and made them identical; two inline
copies is exactly how that drift restarts. The card takes a `level` prop (2 on `/blog`, under its
`<h1>`; 3 in this section, under the section's `<h2>`) — hard-coding either would skip a heading level
in the other, which is the outline a screen-reader user navigates by.

**Config is 3 fields, and two omissions are deliberate.** No `ctaHref` — the destination is always
`/blog`, which every store has; free-text hrefs are precisely how the defaults ended up pointing at
`/kategori/dress`, a handle only the demo owns. No article picker — pinned handles rot as the merchant
publishes, or point at a post they later unpublish. `limit` is a **select (2/3/4)**, not a number: a
free number invites 7, which is a broken grid discovered by publishing.

⚠️ **`seed-templates.ts`'s header was lying, and it is a dangerous lie.** It said the script "inserts
only when the store has no homepage template, so it is safe against a live DB and never clobbers what
a merchant has since edited". That stopped being true at `1c738d4` — **it UPSERTS; an existing
homepage is REPLACED** (the function body documents this properly; only the header was stale). Anyone
trusting that header would run `seed:templates` against a live store and wipe the arrangement the
merchant built. Corrected.

**Driven in a browser, 0 console errors**: homepage section order is now hero → category-nav →
rich-text → product-grid → product-grid → **Dari Jurnal** → closing CTA; 3 cards, newest first; the
1 **draft** article does not appear (publishing is a security boundary in `getArticles`, and the
homepage HTML contains no trace of it); `<h3>` in the section and `<h2>` on `/blog`; no horizontal
scroll at 390px; `/blog` still lists all 5 published articles after the refactor. `/tema` still loads
and the builder's sidebar now offers all 9 sections including **Jurnal**, with no React error.

### 🪤 A typo in an OPTIONAL field was holding the checkout hostage — the address went into the email box

Continuing the validation sweep after the language fix, and this one is worse than the language was.

**The shopper types `siti@gmail`** — an ordinary typo, missing `.com`. They click the **Alamat** box
and type their address. Measured, in a real browser, driving it like a human (click + type, not
`fill()`):

```
alamat = ""
email  = "siti@gmailJl. Melati No. 12 RT 03 RW 05"
```

**Their address was typed into the email field.** `Tab` was trapped too — focus would not leave email.
And **`email` is OPTIONAL**: a field nobody is required to fill was holding the entire checkout
hostage, at the exact moment the shopper was trying to give us their address.

**Cause:** the blur handler called `el.reportValidity()`, and **`reportValidity()` focuses the
control** — by spec. So leaving a field with a typo dragged the shopper straight back into it. This
file's own comment already warned that "reportValidity() drags the focus back… a shopper who meant to
fill it in last gets trapped in it" — it guarded the **empty** case and left the **invalid-format**
case wide open.

**Fix:** blur now calls `showFieldError()`, which writes an inline `<p data-err="…">` plus
`aria-invalid` **and never touches focus**. Focus-stealing survives only on **submit**, where it is
correct: they pressed Bayar, so taking them to the blocking field is the help they asked for.

⚠️ **A test using `page.fill()` cannot see this bug** — `fill()` sets the value directly. It only
appears when you click and type like a person, and then check *which field the text landed in*. That
is how it hid.

**Also swept, and the news is good — 40+ cases, all green, in a real browser.** The input rules do NOT
over-validate, which AGENTS.md calls a bug in its own right:
- **13 real Indonesian names pass** — `Nur'aini`, `M. Rizky`, `I Gusti Ngurah Rai`,
  `Abdul Ghofur Al-Rasyid`, `Aisyah Zahra’`, `Anne-Marie Tobing`, `Siti Aisyah binti Abdullah`.
- **Phone prefixes 0838 / 0881 / 0895 / 0851 pass** and normalise to `62…`. A hard-coded operator list
  would have refused these — the reason there isn't one.
- **Emails**: university (`.ac.id`), self-hosted and plus-addressed all pass; no domain allow-list.
- **Addresses**: `Blok C2/14`, `RT.001/RW.009`, `Dusun Krajan RT 2 RW 1` all pass; only junk is
  refused (emoji, one repeated char, under 10 chars).

**A real order still completes** — complaint shown, cleared on fix, `checkValidity()` true, POST,
`/checkout/sukses`, 0 console errors. Test order deleted: back to **794 rows, no orphans**.

### 🇮🇩 The checkout was scolding Indonesian shoppers in English — and our own Indonesian messages were dead code

`/checkout` still shipped four strings we never wrote: **"Please fill out this field."** (nama,
whatsapp, alamat) and **"Please select one of these options."** (ekspedisi). They are the **browser's**
native validation bubbles, and they follow the **browser's** language — `lang="id"` on the page does
nothing for them. An Indonesian shopper on an English-locale phone met English in an otherwise
Indonesian checkout, at the exact moment they were being told they had made a mistake. Our market is
Indonesia.

**The cause was worse than a missing translation.** The browser runs its constraint check **before**
the `submit` event: it found the empty `required` field, blocked the submit, and showed its own
bubble — so `form.addEventListener("submit")` **never ran**. Every Indonesian message that handler
already carried (`"Nama lengkap wajib diisi."`, written long ago) was **unreachable code**. The fix is
`<form novalidate>`: it disables only the automatic pre-submit gate, so our handler runs and
`checkValidity()`/`reportValidity()` still work when *we* call them.

- `labelMissing()` stamps our sentence on **every** empty control (`MISSING`, keyed by `name`) *before*
  anything reports. Labelling only the field being reported looks identical on screen and leaves every
  later field holding English — invisible until some other `reportValidity()` shows it.
- ⚠️ `setCustomValidity(msg)` keeps a control **invalid until cleared**, so `change`/`input` call
  `clearValidity(name)`. Without it, a field the shopper had already fixed would refuse to submit
  forever — a dead checkout, which is why the happy path below was driven end to end and not assumed.

**Proven on an `en-US` browser** (on an id-ID one the page looks perfect and the bug is invisible —
that is how it shipped): all four messages now read *"Nama lengkap wajib diisi."*, *"Nomor WhatsApp
wajib diisi."*, *"Alamat lengkap wajib diisi."*, *"Pilih ekspedisi pengiriman dulu."*, and **a real
order still completes** — complaint shown, complaint cleared on fix, `checkValidity()` true, POST to
`/api/public/order`, `/checkout/sukses`, 0 console errors. The order stored `courier=spx`,
`service_type=1`, `shipping_idr=14000` — matching the Rp14.000 on screen to the rupiah — and the phone
landed canonical as `628123456789`. Test order deleted afterwards: back to **794 rows, no orphans**.

### 📦 Pengiriman is ONE focused row — and the cheapest rate is never hidden behind a click

Two changes that pull in opposite directions and only work together.

**The view is now one row.** Pengiriman showed every fast rate: SPX Economy, SPX Standard, JNE Reguler,
JNE YES — four prices to arbitrate for a decision the shopper has no information to make. It now shows
the named default (**SPX Standard**, `spx`/type `1`); Economy, JNE and everyone else live in "Pilih
ekspedisi lain". If the route has no SPX, **JNE becomes the default and the box says so** — a
substitute in the default slot is what a shopper otherwise discovers when the parcel arrives under
someone else's label.

**But one row must never be a more expensive row.** Measured on a real route (Depok): the default sat
on SPX Standard **Rp15.700** while **AnterAja Regular Flat Rp9.000** — 74% cheaper — hid behind the
disclosure, with "Termurah" suppressed and nothing on screen hinting it existed. On Jayapura the gap
is **Rp95.932** (Jagopack Rp77.068 under JNE Rp173.000). The full list is now **prefetched in the
background** the moment the fast quote paints, and when it reveals something genuinely cheaper than
the default, that rate **earns the second row** and wears the badge. Two rows maximum, `all:true`
fired exactly once, and the disclosure never opens itself.

⚠️ **"Fetch one courier is lighter" is FALSE — measured, not assumed.** The obvious follow-on was to
quote `["spx"]` alone. Against the live API:

| scope | 1577→3512 | 1577→4821 | 1577→2145 |
|---|---|---|---|
| `["spx"]` | 407ms | 343ms | 119ms — **0 layanan** |
| `["spx","jne"]` | **264ms** | **220ms** | 203ms — 1 layanan |
| every courier | 5.106ms | 5.231ms | 5.097ms |

SPX alone is **not faster** (it lost 2 of 3 routes; both are noise around ~0.3s). The 5.5s is the slow
carriers, not JNE — the API fans out per courier. And on 2145 SPX returns **nothing**, so an spx-only
quote would need a SECOND call just to find the JNE fallback. Quoting the pair in one call is what
makes "no SPX here → JNE" free and instant. **`FAST_COURIERS` stays `["spx","jne"]`; what changed is
what we RENDER.** How many couriers you quote and how many rows you show are separate decisions.

**A bug this introduced, caught in the browser and closed:** the disclosure button did
`if (moreState === "loading") return`. That was safe when only a click could start a call — the box was
already open showing "Mengambil…". With a background prefetch, `loading` happens unprompted, so for
~5s the control was **dead on click**. It now opens and reports progress instead.

**Exercised, not typechecked** (`astro check` was green on all of the above): real browser, cold cache,
4 routes — Depok, Ngaglik, Wamena, Nambluong/Jayapura. First paint one row; ~5s later the cheaper rate
promotes itself with no click; substitute note correct where SPX is absent (and correctly hidden where
SPX serves the route — Wamena does); COD correctly vanishes for Papua; toggle closed/open is instant
with no refetch; **0 console errors** throughout.

### 🗂️ The kelurahan index existed only on this laptop — a fresh database shipped without it (0059)

An untracked `0046_good_dust.sql` was sitting in the worktree. It looked like leftover generator junk,
but it was the **only** place `kelurahan_district_idx` was defined — hand-written into a generated file,
given a number `0046_silky_king_cobra` already owned, and **never registered in `_journal.json`**. So
`npm run migrate` had never once applied it. The index was on this machine because someone had also
created it by hand; **any fresh database — including production — built the checkout without it.**

Measured on the dev DB, the query `kelurahanForDistrict()` runs on every kecamatan selection
(`apps/admin/lib/data/areas.ts:153`, called from `checkout.astro:1309`):

| | plan | time |
|---|---|---|
| with the index | Bitmap Index Scan | **0.25ms** |
| without it | Seq Scan, 78.744 rows discarded | **25.4ms** |

~100x, on a table of 78k rows, on the checkout's hot path. The index is now declared in `schema.ts`
where it belongs, so the generator owns it, and `0059` builds it. The stray file is deleted.

⚠️ **The generator's first output would have broken a fresh database.** `generate` also emitted
`ADD COLUMN` for `orders.service_type`, `orders.label_printed_at` and `stores.favicon_url` — columns
`0053`, `0055` and `0057` already create. The **meta snapshots had drifted**: they never recorded those
migrations, so drizzle-kit believed the columns were missing and cheerfully re-added them. On a fresh
DB that is `0053` adding the column and `0059` dying on the duplicate. This is almost certainly *why*
the index was hand-written in the first place — the generator's output was untrustworthy, so someone
routed around it and the migration silently never ran. The redundant ALTERs are dropped from `0059`;
`0059_snapshot.json` now records the true shape, and a follow-up `generate` reports **"No schema
changes"** — the drift is repaired, not worked around.

**Proven, not typechecked:** all 59 migrations replayed from zero into a throwaway database
(`tokophi_migtest`, dropped after) — applied clean, `kelurahan_district_idx` present, and all three
columns from 0053/0055/0057 still there. The shared `tokophi` DB was never touched.

### 🚚 Ongkir was 5.5s for every shopper. It is now ~0.6s — and Pengiriman is one box like Pembayaran

**The user was right and my first hypothesis was wrong.** Cold rate loads clustered at 5.29–5.43s
across four different destinations, which looked like a fixed cost or a timeout — so I assumed
filtering couriers could not help. Measured against the live KiriminAja API instead, same route:

| | every courier | `["spx","jne"]` |
|---|---|---|
| dest 3512 | **5.50s** (16 services) | **0.65s** (3 services) |
| dest 4821 | **5.45s** (14 services) | **0.54s** (3 services) |

**~10x.** KiriminAja aggregates **per courier** and the slowest carrier sets the pace, so every shopper
waited ~5.5s to price carriers they never asked about. And they paid it *every time*: each shopper has
a unique destination, so the 10-min rate cache is always cold for them — the ~120ms I kept seeing while
testing one address was a mirage.

**The checkout now quotes SPX+JNE up front and fetches the rest only when "Pilih ekspedisi lain" is
opened.** SPX because it is the only courier COD is allowed on (dropping it would silently take COD off
the default view); JNE for reach. Measured after: fast rates on screen in **2.3s** end-to-end (one
`all:false` call), the disclosure costing **5.2s** and firing exactly one `all:true` call, once.

⚠️ **The trap that would have killed the checkout.** `/api/public/order` re-quotes and **REJECTS** a
service missing from the fresh quote. Re-quoting with the checkout's fast scope would therefore reject
every SiCepat/AnterAja/J&T order — on a checkout that had just offered that courier. Re-quoting
unscoped would pay the full 5.5s *after* the shopper presses Bayar. It now scopes to **the one courier
they picked**: fast, and by construction always in the answer. Proved end-to-end by ordering
`lion-JAGOPACK` — a non-fast courier — and reading the row back: `courier=lion, ongkir=13000`, matching
the Rp13.000 on screen to the rupiah. (Test order deleted; 794 rows, no orphans.)

**Two lies the lazy load introduced, both caught by looking at the screen:**
- **"Termurah"/"Tercepat" badges** cannot be claimed while eight couriers sit unquoted — the badge
  would visibly jump the moment the list expanded. They are now suppressed until the full set is known
  (COD still shows immediately: it is a fact about that service, not a ranking). The old code's own
  comment had warned about exactly this.
- **"kami pilihkan ongkir termurah"** became false: it is the cheapest of *SPX+JNE*. Measured on a real
  route — Jagopack **Rp13.000** sitting behind the disclosure under a selected JNE Reguler **Rp21.000**.
  The note now says what we actually did and points at the rest.

**UI:** Pengiriman is now ONE box with hairline-divided rows — the same object as Pembayaran, which it
always should have been (same question: "pick one of these"). It was a bordered card for the default, a
separate bordered button, and a third bordered box of alternatives: three rectangles for one choice.
"Pilih ekspedisi lain" is now a row *inside* the box that opens its list, exactly like Transfer Bank
opens its banks, framed as one block when the chosen rate lives inside it.

Also: the disclosure's hint listed "JNE, SiCepat, AnterAja, J&T" — a hardcoded courier roster that
named JNE while JNE was already visible above it, and asserted couriers we had not quoted for that
route. Now neutral. And if SPX+JNE price nothing for a route, the full list loads automatically rather
than showing an empty box — slow beats broken.

### 💳 /checkout: the blue frame now fits the payment you picked, not the whole card

`has-[:checked]:border-[var(--co-accent)]` sat on the **outer** payment box, so choosing QRIS turned
the border of the entire card blue — a frame saying *"all of this is selected"* when one row was. Same
for Transfer Bank, e-wallet and COD. The frame moved onto the group that is actually chosen, sized to
it exactly; the outer box stays neutral grey.

Two details that decided the implementation:
- **`outline`, not `ring`.** An inset ring is painted **under** the element's own `divide-y`
  border-top, so the frame's top edge would have come out **grey on every row except the first**.
  An outline paints over the border. `-outline-offset-1` keeps it inside the box, so nothing reflows
  when it appears.
- **For Transfer Bank the frame wraps the parent row AND its open bank list** — that whole block *is*
  the one payment being chosen. The chosen bank inside keeps only its tint, so we never draw a frame
  inside a frame (the same restraint as the storefront de-carding above).

No stale highlight is possible: `sync()` already unchecks `va_bank` whenever the parent is deselected,
so a hidden panel can never keep the group lit.

Exercised in a browser through the real flow (kecamatan → rates → payment), not typechecked: QRIS
frames one row (65px), Transfer Bank frames parent+banks as **one** frame (290px) and picking a bank
inside adds **no** second frame, and COD — reached by selecting SPX Standard, the only courier that
unlocks it — frames its own row (64px). The outer border reads `rgb(227,227,227)` in every state.
0 console errors.

**The corners (follow-up).** An outline traces its own element's `border-radius`, and these rows had
none — so the frame met the card's rounded corner with a **square** one. Measured: card `8px`, row
`0px`. Now `7px`, **not 8**: `rounded-lg` is the card's OUTER radius and these rows sit inside its 1px
border, where the arc is 8−1; `rounded-lg` here would bulge past it.

⚠️ **`last:` is a trap here and `has-[+#cod-option[hidden]]:rounded-b-[7px]` is the fix.** `last:` means
`:last-child` **in the DOM**, and `#cod-option` stays in the DOM while hidden — so in the normal case
(COD unavailable until an SPX courier is picked) `last:` targets COD and the row the shopper actually
sees at the bottom keeps square corners. The `:has()` rule says *"I am last because the thing after me
is hidden"*, and it re-evaluates live. Verified by forcing a **non-SPX** courier: COD hides → Transfer
Bank takes the rounded bottom (7px); pick SPX → COD appears, Transfer Bank hands it back (0px) and COD
takes it. No JS involved. `last:` still covers the store with COD switched off, where it never renders.

⚠️ **The first probe was wrong and said everything passed.** Checkout auto-selects the first rate, which
is SPX Standard — so COD was *already visible* in both of my "before/after" runs and the hidden case was
never tested at all. The bug it was meant to catch would have shipped.

### 🛒 /checkout header: the cart now sits on the layout's right boundary

The cart was **40px inside** the 1080 box (`lg:px-10`), which on paper was the defensible choice — at
1440 it landed on x=1220, exactly where the **"Total" figure** in the summary ends, and symmetric with
the logo (both ~40px inside the box). Measured, not assumed.

But the header bar is **full-bleed white while its content is boxed at 1080**, so on a wide screen the
cart read as stranded mid-canvas rather than as the header's right-hand control: **460px of empty bar
to its right at 1920**. The user called it, and the layout boundary wins — it is the line the eye can
actually see (it is where the grey summary panel stops), whereas the alignment to the Total figure is
real but invisible. **Trade accepted deliberately: the cart no longer lines up with Total** (1260 vs
1220).

⚠️ `xl:pr-0`, **not** `lg:pr-0`. Between lg (1024) and 1080 the box is narrower than its max-width, so
its edge **is** the viewport edge — a flush cart would touch the side of the screen with zero gutter.
`lg:pr-6` holds a gutter until `xl`, by which point the box is centred with ≥100px of margin and flush
is safe. Verified at 11 widths: flush with the box edge at 1280/1440/1920 (1180/1260/1500), a 24px
gutter from 1024–1279, the page gutter below that, and **no overflow at any width**.

### ♿ Stock colours: all three failed AA, and only one was findable by an audit

Caught by re-running Lighthouse on the live PDP after the de-carding above — **accessibility had
dropped to 96**, and one of the two failures was **mine**: removing the white card from under the
reviews put `text-muted/70` onto the cream page at **2.84:1**. Exactly the footer trap again — an
**opacity, not a colour**, invisible to any palette audit. Now plain `text-muted` = 5.09:1.

The second failure was pre-existing and led somewhere worse. `#pdp-stock` was `text-emerald-600` on
cream = **3.40:1**. Checking its siblings rather than just the one Lighthouse named:

| state | was | ratio | now | ratio |
|---|---|---|---|---|
| in stock | `emerald-600` | 3.40 | `emerald-700` | **4.99** ✅ |
| low stock | `amber-600` | **2.98** | `amber-700` | **4.68** ✅ |
| out of stock | `red-600` | 4.44 | `red-700` | 5.97 (computed) |

⚠️ **Lighthouse could only ever see the emerald one.** These classes are applied **from JS**, and only
the in-stock branch runs on an in-stock product — the other two need a low/out-of-stock variant
selected. No page-load audit reaches them. The worst of the three was the amber at **2.98:1**: *"Sisa 3
— segera habis"* is the most urgent line on the page and was the least readable thing on it. Found by
computing the palette against the page background, not by re-running the tool.

Verified by driving **every colour × size combination** in a browser until each branch actually ran:
emerald 4.99, amber 4.68, 0 console errors. The red branch is **not** exercised and is honestly marked
as computed-only — **the seed contains no zero-stock variant anywhere**, so that state is currently
unreachable on this data.

### 🃏 Cards: stop drawing a box around everything (Dawn-like restraint)

Audited every card surface in the storefront and asked one question of each: does this box carry
MEANING (a clickable tile, a real elevated surface, a control) or is it decoration around content that
would read fine on the page? Dawn's discipline, applied. Checkout is untouched — it is deliberately its
own design system.

**Removed (decoration):**
- **`kontak`** — two `rounded-2xl border shadow-sm` cards on a page with exactly two blocks of content:
  100% card coverage. Nothing was elevated, nothing clickable, and the two-column grid already did the
  separating.
- **PDP reviews** — a `ring-1` white box for the average score, plus N more for the review items, all
  **nested inside the `border-t` reviews section that already delimits them**. Cards inside a card. The
  reviews are now an editorial list with hairline rules.
- **PDP hero photo** — `ring-1` around a photograph. A photo's own edge is its boundary.
- **`ProductCard`** — the image had `rounded-xl` **inside** a parent that is already `rounded-xl
  overflow-hidden`: invisible at the top, fighting the parent's clip at the bottom. Same-radius nesting
  is the textbook overuse tell.
- **`Testimoni`** — `ring-1 shadow-sm` on carousel slides already separated by gap + snap points. The
  white surface stays; the chrome goes.
- **Three empty states**, three different treatments (dashed-2xl, dashed-2xl, solid-2xl) each boxing a
  message with nothing to be separated *from*. All three now plain.

**Kept (meaningful):** `ProductCard`'s tile and the blog tile (clickable), the cart's sticky summary
(genuinely elevated — Dawn cards this too), Chat/mega-menu/drawer (real overlays where the shadow is
load-bearing), every form control and selection ring, and the Hero eyebrow pill (a ring earned by
sitting over photography).

**Consistency:** the blog tile and `ProductCard` do the same job — a clickable tile — and were
`rounded-2xl`+`border`+`shadow-sm`+`hover:shadow-lg` vs `rounded-xl`+`ring-1`+`hover:shadow-xl`. Now
identical. ⚠️ The deeper inconsistency is logged, not silently half-fixed: **`ring-1 ring-line` (11×)
and `border border-line` (48×) do the same job with the same colour via two different APIs**, chosen
per-file at random, and `shadow-sm` currently means three different things. That is a token decision,
not a find-and-replace — see BACKLOG.

Verified by screenshot at desktop + 390px, 0 console errors.

### 🧭 Breadcrumbs: one array now drives both the trail and the schema

The task said "add breadcrumbs". **They already existed** — as SIX hand-copied blocks of identical
markup (kategori, produk, halaman, blog/index, kontak, keranjang) — while `BreadcrumbList` schema
existed on exactly ONE page (the PDP). That split was the real bug, and it had already produced a
disagreement: **the PDP's schema claimed three crumbs ending in the product name, while the trail on
screen stopped at the category.** Schema and UI typed out separately will always drift.

Now `src/lib/breadcrumb.ts` (`Crumb[]` → `breadcrumbLd()`) + `components/Breadcrumb.astro` render from
**one array per page**. Verified on every page that the emitted JSON-LD and the visible trail are
character-for-character the same list.

Five a11y defects fixed once, in the shared component, instead of six times:
- `<nav>` had **no accessible name** — three anonymous "navigation" landmarks per page.
- The trail was a bare run of `<a>`/`<span>`. It is an ordered list; `<ol>`/`<li>` is what makes a
  screen reader say "list, 3 items" and announce position — the entire point of a breadcrumb.
- The `/` separators were real text, so they were **read aloud**: *"Beranda slash Dress slash"*. Now
  `aria-hidden` — unchanged visually, gone from the accessible name.
- The current page was an unmarked `<span>`; it now carries `aria-current="page"`.
- No wrapping: a long product name pushed the trail off the side of a 360px phone. Now `flex-wrap`.

Schema added to kategori, halaman, blog index and kontak (all indexable, all with a complete visible
trail). Deliberately NOT added to: `/keranjang` (now `noindex` — schema would be pointless), the
homepage (it is the root), and **the blog article**, which by design shows a topic chip rather than a
trail — a `BreadcrumbList` there would describe a hierarchy the shopper cannot see, which is the exact
failure this change exists to end. Logged in BACKLOG rather than quietly bent.

### 🔎 SEO: every store but the demo published the word "null" — and sold women's fashion

Four defects, all in the highest-visibility text a store has (the SERP snippet + the WhatsApp preview
card), all found by auditing rather than guessing. **Ground truth from the DB: 6 of the 7 seeded stores
have `tagline IS NULL`** — so this was the normal case, not an edge case, and two of them
(`gadget-murah-id`, `kopi-senja`) are a phone shop and a coffee shop.

- **`"null"` in the meta description.** `index.astro` interpolated `${store.tagline}` raw. The field's
  own type says *"`null` = the merchant has not written one. **Render NOTHING — never a platform
  default**"* — a documented contract, violated in the one string Google shows. Every store without a
  tagline published `Kopi Senja — null. …`.
- **The demo's vertical, hardcoded on every tenant** — `"Belanja dress, atasan, bawahan, busana muslim
  & outerwear wanita"` (homepage), `"tips fashion, perawatan kain, dan inspirasi gaya busana wanita"`
  (blog index), `"Koleksi busana wanita di …"` (category). A gadget store told Google it sells dresses.
  The homepage line now builds itself from the merchant's **own categories** — which is exactly what the
  hardcoded sentence was imitating. Verified: Batik gets *"Belanja Atasan, Bawahan, Busana Muslim,
  Dress."*, Kopi Senja gets its own name and no invented catalogue.
- **`/keranjang` had no `noindex`** while `/checkout` has had one since day one. ⚠️ A robots.txt
  `Disallow` is **not** the same guarantee and is in one way weaker: a disallowed URL can still be
  indexed **URL-only** from an inbound link, and the crawler forbidden from fetching it can never read
  the `noindex` that would have kept it out. `Layout` gained a `robots` prop; it emits nothing at all
  unless asked, since an absent tag already means `index,follow`.
- **Blog posts lost their og:image to a comment that had gone stale.** The comment said *"Layout emits
  no OG/Twitter tags at all today, so an article's imageUrl has nowhere to go"* — false since Layout
  gained the full og:/twitter: set. The comment outlived the fact and then **justified the gap it
  described**: every article shared to WhatsApp showed the store logo instead of its own hero photo.
  Now `image` + `type="article"` (it was defaulting to `website` on an article).

Verified per-tenant against 3 real stores on a dev server, not reasoned about: the `null` path, the
non-fashion path, `robots` present on /keranjang and **absent** on /, /kategori/* and /blog, and
og:image resolving absolute to the article's own photo.

### 🖼️ The hero downloaded every slide at first paint — 212KB of it invisible

`loading="lazy"` was on slides 2..n and **did nothing**, because lazy only defers images **below the
fold** and every slide is stacked at `inset-0` — dead centre of the viewport. Measured on live:
**278.6KB of hero on first paint, 212.6KB of it at `opacity: 0`** (hero-2 148KB + hero-3 64KB),
invisible for the first 5+ seconds and competing for bandwidth with the LCP image — which is slide 1,
the one image that actually needed the bandwidth. Identical on phone and desktop.

Now only slide 1 ships a `src` (so the LCP image stays in the HTML where the preload scanner finds
it — it is *not* gated behind JS). The rest carry `data-src` and are promoted on `load` → `requestIdleCallback`.
`show()` wakes its target before fading, plus the next one, so a dot clicked in the first moments
never cross-fades to a blank frame; the initial `show(0, false)` skips that prefetch, which would
otherwise have handed straight back the bandwidth this saves. **No-JS loses nothing** — the carousel
only ever advanced via JS, so slides 2..n were already unreachable without it.

Exercised in a browser, not just typechecked: at DOMContentLoaded exactly **one** hero request; after
idle all three present; dot 3 fades in decoded (`naturalWidth: 1920`, not blank); 0 console errors.

⚠️ **The "191KB oversized" framing in the old task was a different bug and is still open** — see
BACKLOG. Lighthouse wants a **portrait crop** for phones (a 16:9 source rendered into a 390×512 box
via `object-cover` throws away ~50% of its pixels), which is art direction via `<picture>`, not a
`srcset` width list — and merchant-uploaded heroes have no variant pipeline to draw on.

### ♿ Three real accessibility failures — each scored 0 on live, each now measured passing

Unlike the robots.txt audit below, these were **our bugs**, not the linter's:

- **`<aside id="mobile-drawer" role="dialog">`** — `aria-allowed-role` = 0. `<aside>` carries an
  implicit `complementary` role and ARIA forbids overriding it with `dialog`, so a screen reader was
  handed a contradiction: landmark or modal? Now a `<div>`, which has no implicit role and is
  therefore the right element to give one to. Nothing visual changed; the `aside` was only ever
  *looking* semantic. The JS finds it by `getElementById`, so the tag swap touches nothing — verified
  anyway in a real browser: opens, closes on Escape, 0 console errors.
- **Footer copyright `text-cream/45` = 4.05:1** — below AA. `global.css` already fixed `--color-muted`
  for exactly this reason; this one slipped through because it is an **opacity, not a colour**, so no
  palette audit could ever have seen it. Now `/70` = **7.7:1**. While there, measured *every* text node
  in the footer by compositing the alpha in-browser: all 23 pass (the `/50` labels sit at 4.63 — thin,
  but above the line, so left alone).
- **Cart link `aria-label="Keranjang"` vs visible "Keranjang 0"** — `label-content-name-mismatch` = 0.
  A voice-control user says *"click Keranjang"* and nothing happens: the name they can **see** is not
  the name the browser matched on. The `aria-label` is gone, so the name is now computed from the
  content — the visible text by definition, and the two can never drift apart again. The word itself
  moved from `hidden` to `sr-only` below `sm`: `hidden` removed it from the accessible name too,
  leaving every phone user a link named just **"0"**. Measured on a 390px viewport: `"Keranjang 0 item"`.

⚠️ **Method note.** The first contrast number this produced was **1.28:1** — nonsense. The computed
colour is `oklab(0.975 0.0026 0.0063 / 0.7)` and a regex pulling "RGB" out of that reads the *oklab*
components as channels. Contrast must be measured by letting the **browser** composite the alpha
(paint bg then fg on a canvas, read the pixel), never by parsing the string. `astro check` was clean
throughout all three, as it was for the `queueSave` outage.

### 🏷️ The struck-through price was cut off on every phone

`ProductCard`'s price row was `flex items-baseline gap-2` — **`nowrap`**. Measured on live at 360 / 390
/ 430: the row is 124 / 139 / 159px and the two prices need **176**, so "Rp 249.000" ran to x=208 inside
a box ending at 156 — **52px of it simply gone**. Not an edge case: a 2-up grid on a phone never gives
that row enough width, so the compare-at price was clipped on *every* promo card on *every* phone. The
PDP already wrapped; the card was the odd one out. Now `flex-wrap` with a tight `gap-y-0.5`, so a promo
card grows by one line rather than a paragraph. Verified after: `clips: false` at all three widths, and
the struck price ends at x=112 — inside the box.

### 🔍 Lighthouse says robots.txt is invalid. Lighthouse is wrong — investigated, deliberately unchanged

`robots-txt` scores **0** on live: *"Unknown directive"* at `Content-Signal: search=yes,ai-train=no,
use=reference`. **It is not our file.** `robots.txt.ts` emits 9 lines; live serves **70** — Cloudflare's
**Managed robots.txt** prepends a Content Signals preamble and an AI-crawler block-list (GPTBot,
ClaudeBot, CCBot, Google-Extended, Bytespider…). 3.8M+ domains run it.

Two things checked against [Google's own spec](https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec)
rather than assumed:
- **Unknown lines do not invalidate anything** — *"Rules other than `allow`, `disallow`, and
  `user-agent` are ignored by the robots.txt parser."* `Sitemap:` is itself such an extension.
- **The two `User-agent: *` groups are MERGED**, not first-wins — *"all the rules from the groups
  applicable to the specific user agent are combined internally into a single group."* This one
  mattered: had it been first-wins, Cloudflare's `Allow: /` would have **shadowed our
  `Disallow: /checkout`** and the checkout would be crawlable. It is not.

So the audit is behind the standard, not the file. The only way to pass it is switching Managed
robots.txt off in Cloudflare — deleting an AI-training opt-out the injected text calls an **express
reservation of rights under Article 4 of EU Directive 2019/790**. Trading that for 8 points on a linter
is a bad trade. The reasoning now lives in `robots.txt.ts` so the next person does not "fix" it, and the
file also warns that what you see at `/robots.txt` is not what that file emits.

### 📏 PageSpeed, measured on live — and four real failures it found

Google's PSI API was out of anonymous quota (429), so this is Lighthouse 12 against
`batik-nusantara.tokophi.id`, mobile: **Performance 87 · Accessibility 96 · Best Practices 100 ·
SEO 92**. LCP 3,3s · FCP 3,0s · **TBT 0ms · CLS 0** · SI 3,0s. Nothing blocks and nothing jumps — what
holds the score down is images, not code.

Four audits score **0**, all filed as tasks with the evidence:
- **robots.txt is invalid.** Line 30 `Content-Signal: search=yes,ai-train=no,use=reference` → *unknown
  directive*, so the whole file fails and SEO flags it.
- **Hero images ship 191KB more than they render** — hero-2 wastes **102KB**, hero-1 45KB, hero-3 44KB:
  the same 1920×1080 file goes to a 390px phone. The other half of the 2560-upscale finding — one asset
  for every screen, wrong at both ends.
- **`<aside role="dialog">`** — that role is not allowed on `<aside>`.
- **Footer `text-cream/45` = 4,05:1**, below AA. `global.css` already fixed `--color-muted` for exactly
  this reason; this one slipped through as an *opacity* rather than a colour.

### 📍 Kelurahan is a searchable list, like kecamatan — and a leftover `kelSelect` had killed the page

It was a native `<select>`; kecamatan is an input with a list that drops below it — **in flow, pushing the page down**. My first pass made kelurahan a floating `absolute` popup instead, which is a THIRD interaction model on one form: kecamatan pushes, kelurahan overlays. Now both are `position: static` (measured, identical) and opening the list grows the page 1713 → 2053px. Two reasons beyond
consistency. **A `<select>` on Android/iOS opens a full-screen wheel** — the shopper leaves the page to
answer an *optional* question, and Semarang Tengah has 11 kelurahan to scroll blind. And it made this
one field the only control on the checkout with its own interaction model.

**Lighter than kecamatan, not heavier:** the list is already in memory (`loadKelurahan` fetched it when
the district was picked), so opening and filtering costs **zero requests**. Kecamatan hits the API per
keystroke because it searches 7.030 rows; this filters ~11. Verified: click → 15 rows drop with no
request; type "Pek" → filters to "Pekunden" client-side; pick → `kodepos` fills to **50241** and the
"Kirim ke" summary reads *Kel. Pekunden, Semarang Tengah, Kota Semarang, Jawa Tengah 50241*.

⚠️ **The rewrite left two `kelSelect` references behind, and the page died.** `ReferenceError:
kelSelect is not defined` killed the whole checkout script — no kecamatan search, no rates, no order —
while **`astro check` reported 0 errors**. This is the exact failure CLAUDE.md warns about, and it took
a browser to see it. The recovery-link path was one of the two: it restored the picker by *postcode*,
which the old select's `value` happened to be. The picker holds names now, so it looks the name back up
and, when a code is ambiguous or absent, leaves the picker blank and keeps the kodepos — the code is
what ships, and a guessed name beside it only adds a chance to be wrong.

### 🔍 Checkout robots: `noindex,follow`, not `noindex,nofollow`

`noindex` is the whole intent — keep a per-shopper page out of the index. `nofollow` is a different
instruction ("treat every link here as untrusted") and the links are the merchant's own logo, cart and
policy pages. It cost nothing to be wrong until now, which is why it sat unnoticed: robots.txt already
disallows `/checkout`, so this tag is only read by crawlers that fetch anyway — exactly the ones you
want obeying `noindex` and nothing more.

## 2026-07-17

### 🏆 "Paling Dicari" was not the most wanted — the flag contradicted the sales column beside it

`catalog.bestsellers()` was `list.filter(p => p.bestseller)` — a merchant BOOLEAN. The demo flags
`hijab-voal` (**321** sold) and not `celana-kulot` (**869**) or `kemeja-oversized` (**818**), so the
shop's "most wanted" shelf was somebody's guess sitting next to the column that disproved it. And it
returned however many were ticked (3), so a 4-up row had a hole in it — `keranjang.astro` had already
grown a workaround topping the row up from the rest of the catalogue, which is the symptom of exactly
this. The registry's own comment claimed `mode:"terlaris"` "sorts the whole catalog by all-time
units_sold". **It did not.** Now it does: `units_sold` is loaded and `bestsellers()` sorts by it, so
`limit` means "the top N", the claim is true by construction, and the comment is finally honest. The
keranjang workaround is deleted — it was treating the symptom.

**The user asked me to flag more bestsellers. I did not**, and that is the point: flagging more would
have patched the row while leaving the shelf lying. Measured after: Paling Dicari renders
celana-kulot / kemeja-oversized / dress-midi-bunga / tunik-rayon — 869 / 818 / 652 / 565, the real top
four.

### 📐 The storefront's 1280 shell was never too wide — it was empty

"Tidak terlalu lebar?" — measured, and no: the shell already caps at 1280 (Shopify Dawn is 1200) at
every width to 2560. What made it *look* wide was **my own `columns: 3`**: chosen so 3 flagged
bestsellers filled a row, it produced **400px cards** — a folded hijab rendered 400×530. I optimised
for "the row isn't ragged" and paid in cards the size of doors. Now the /tema formula: **Paling Dicari
4×1** and a second grid **Produk Terbaru 4×2** (`terbaru` sorts by createdAt — honest by construction).
Cards 400 → **296px**, and the shell is full because there is finally enough in it. Narrowing the page
to hide a thin catalogue would have been fixing the mirror, not the face.

⚠️ **Found, not fixed:** the hero is full-bleed and its source is 1920×1080, so at 2560 it upscales
**1.33×** and goes soft — on the first thing anyone sees. Needs a larger asset + `srcset`, not a CSS
change. Also: with 12 active products and 4+8 slots the two grids overlap by two — a demo-catalogue
size artefact, not a bug.

### 🌱 `seed-templates` upserts — its idempotency was pinning production to the first shape that shipped

The demo's homepage template changed to 4×1 + 4×2 and **live kept rendering the old 8-at-400px grid**,
because the script only inserted when the store had no template — and prod already had one. The deploy
log said *"already has a homepage template — left untouched"*, which reads as success. It was a
one-way door: nothing written to that row after the first deploy could ever reach production.

The guard was copied from `seed-reviews` to stop a redeploy clobbering a merchant's work. **That threat
cannot happen here**: this file is hardcoded to `batik-nusantara` and touches nothing else — it cannot
reach a merchant. Now it upserts. Proven by running it twice: second run says `REPLACED`, and the row
reads `Paling Dicari limit=4 cols=4 | Produk Terbaru limit=8 cols=4`.

⚠️ **The cost, stated:** the demo's homepage is now replaced on every deploy. Edit it in the Store
Builder to demo the builder and the next deploy reverts it. Right trade for a demo whose template lives
in a seed file; wrong one for a real store — if this script is ever pointed at a merchant, restore the
guard first.

### 🎨 Payment icons: grey until selected — so blue means something again

Every payment row's icon was accent-tinted **at rest**. With three rows all wearing the brand blue, the
colour stopped saying "this one" and only said "payment" — and the checkout spends colour on exactly one
job: naming the control that is live. They now sit grey (`black/4%` + `--co-muted`) and turn blue only
when their radio is checked, via `group-has-[:checked]` on the row. No structural change — same rows,
same layout, same markup shape (user: *"jangan rubah ui/ux"*).

Measured, transition settled: at rest all three read `rgba(0,0,0,.04)` / `#6b7280`; select QRIS and only
the first goes `#eff6ff` / `#2563eb`; select Transfer Bank and the blue moves to it while QRIS returns to
grey. Exactly one lit at a time.

### 💳 Checkout: payment is hidden until the kecamatan is picked

The same gate Pengiriman already used, one step further on: you cannot choose HOW to pay before anyone
knows WHAT you pay — ongkir lands only after a district resolves. It matters beyond tidiness: COD's
availability is decided by the destination, so an unreachable COD row was being offered and then
withdrawn the moment the shopper picked their kecamatan. Better not to offer it than to take it away.

⚠️ **And it re-armed a trap I had already documented.** The payment radios carried `required`; a
required control inside a HIDDEN fieldset makes the browser refuse to submit with *"An invalid form
control with name='payment' is not focusable"* — the form dies with no visible error and the button
just does nothing. Removed; the submit handler already validates it ("Pilih metode pembayaran.")
where we can name what is missing. Verified: pressing Bayar with no kecamatan focuses the kecamatan
field and reports natively — no order posted, nothing silent.

## 2026-07-17

### ⏱️ The tracking poller was complete and had no trigger — scheduled it

A collaborator (`Admin@Admins-Mac-mini`, `db10557`) shipped the tracking poller — the **#1 blocker in
the shipping backlog**: `lib/ka-tracking.ts` + `api/cron/tracking`. Good work: forward-only status
rank (a replayed pull cannot drag a `selesai` order back to `dikirim`), reuses `applyOrderStatusChange`
so inventory/ledger/COD move exactly as on a manual change, never overwrites a real AWB with our own
booking ref echoed back, batch-capped at 100, fails closed without `CRON_SECRET`.

**Nothing scheduled it.** Only `cron/billing` has a sidecar; `cron/tracking` had a comment saying
"schedule it like cron/billing" and no scheduler. A poller that never runs is an AWB that never lands
— and the whole chain queues behind it, because **Pengiriman Massal has nothing to print until an AWB
exists**. Added the **`cron-tracking` sidecar, every 15 min** — deliberately its own container rather
than a second line in `cron`, which sleeps **86400s**: a shopper waiting on a resi cannot wait a day.

Reviewed for the class of bug 0058 was written for: the poller does `where number = …` with no store
filter, which is **safe** — `orders_number_unique` is UNIQUE **globally**, not per store, so a number
can only ever name one order. Checked rather than assumed.

⚠️ **Still unexercised.** No AWB has ever landed, so `awbFilled` has only ever been 0, and
`KIRIMINAJA_ENV` still defaults to **sandbox**. The status-code mapping is read off the docs, not
observed — tasked.

Also fixed a latent bug in **my own** `seed:recent`: it derived the next number via
`regexp_replace(number,'\D','','g')::int`, which on a REAL order (`PHI-202951778F2Y`) yields
2_029_517_782 — inside int4 by ~5%, and a slightly longer number dies with "integer out of range".
It only survived because this store has no real checkout orders yet. Now matched with
`number ~ '^PHI-[0-9]{1,6}$'` so seeded numbers stay in the seed's own range.

### 🛡️ RLS on `stores` (0058) — and the verifier that had been red so long nobody heard it

Follow-up to the cross-tenant leak below. The WHERE clauses fixed the two known callers; **this makes
the database enforce it**, because a rule 12 authors must remember is a rule that gets forgotten a
13th time.

`stores` is keyed by `id`, not `store_id`, so the policy reads `id = app_current_store_id()`.
Measured, not assumed: `tokophi_app` + GUC → **1 store** · no GUC → **0** (fails closed) · **owner →
all 7**, which is what keeps `provision` working (slug uniqueness — two shops would otherwise collide
on one subdomain) and the billing cron billing everybody. Safe because **no table in this DB uses
FORCE ROW LEVEL SECURITY**, so the owner always bypasses; `verify-rls` now asserts that too rather
than trusting it. Swept all 23 admin routes in a browser afterwards: **0 errors, shell intact**.

**The uncomfortable part: `verify-rls` had the exact bug it exists to catch.** Its own fixture was
`SELECT id, name FROM stores LIMIT 1`. Once the seed grew past one store, it started picking
**kopi-senja (0 products)** and comparing an *empty* store's rows against the *global* totals — so
`RLS VERIFY FAILED` had been permanent background noise. **Both leaks below shipped past a verifier
that was already red.** An alarm that is always on is an alarm that is off. The fixture now picks the
store that actually has data (deterministically) and takes ground truth `WHERE store_id = store.id`.
**11/11 green** — and it now asserts `stores` by hand, since check 5 derives its table list from
`store_id` columns and structurally cannot see it.

⚠️ Still true: **nothing runs `verify-rls` automatically.** That is precisely how it stayed red
unnoticed. Tasked.

### 🔴 SECURITY — Pengaturan showed another merchant's shop, and "Simpan" would have stolen its name

Found while wiring the logo uploader: the Profil Toko form, logged in as **Batik Nusantara**, rendered
**"Kopi Senja"** in the Nama toko field. Not a display quirk — a genuine cross-tenant read.

```ts
db.select({...}).from(schema.stores).limit(1)   // ← no WHERE, inside withCurrentTenant()
```

**RLS does not police `stores`.** That table is keyed by `id`, has **no `store_id` column**, and
`relrowsecurity = false`. So `limit(1)` returned an **arbitrary row** — whichever the planner felt
like. And `verify-rls` could never have caught it: it derives the store-scoped set from the catalog by
looking for a `store_id` column, so **`stores` is invisible to the guard built to protect us**.

Two shipped functions did this:
- **`getStoreProfile`** → the merchant read a stranger's shop **name, tagline and WhatsApp number**.
  Worse: `saveStoreProfile` writes with a *correct* `where id = storeId`. So pressing **"Simpan
  Perubahan" without touching a single field** would have renamed their own shop to the leaked one and
  overwritten their own WhatsApp. **A read leak that becomes a write corruption on the most innocent
  possible action.**
- **`getBilling`** → drives the sidebar badge, the past_due/suspended banner, `/akun/langganan` and the
  Keuangan card. Measured on screen: Batik Nusantara's owner saw **"Aktif · 11h"** — *Kopi Senja's*
  countdown. Their own is 19h. The **"Langganan ditangguhkan — mode baca-saja"** banner could have
  fired on a stranger's account.

Fixed with an explicit `where id = storeId` in both, and at the root: **`withCurrentTenant` now hands
the callback its `storeId`** (`fn(db, storeId)`) — the wrapper only ever gave you `db`, which is
*why* both authors reached for `limit(1)` and trusted RLS. The guidance now sits in `lib/tenant.ts`
where the next query gets written: **RLS is not a substitute for a WHERE clause on a table it does not
police.** Verified in a browser: Nama toko → Batik Nusantara, badge → 19h.

### 🖼️ Logo toko + Favicon — the column that had readers and no writer

`stores.logo_url` has been half-built the whole time: the storefront **reads** it everywhere
(`Header.astro` renders it, `Layout.astro` feeds the OG image, `checkout.astro` pulls it for branding)
and **nothing on earth wrote it** — no admin form, no super-admin action, not even the seed. Every shop
fell back to a wordmark forever and no screen admitted a logo was possible. **`favicon_url` (0057) did
not exist at all**, so every merchant's storefront served *TokoΦ's* icon — a shop on its own domain
wearing someone else's favicon reads as "this isn't really my site", the exact impression a white-label
builder is bought to avoid.

Both now upload from **Pengaturan → Profil Toko**, `settings:write` (Owner only). Exercised in a real
browser, not typechecked: PNG in → **WebP on disk** (2686 B / 2074 B) → row written → previews survive
a full reload. The favicon preview renders at **16px inside a mock browser tab**, because a mark that
reads fine at 200px can be an unrecognisable smudge at 16 and the merchant should learn that here
rather than from a shopper.

`saveImage` moved to **`lib/image-store.ts`** so the logo and product photos share one encoder — and
pointedly **not** exported from a `"use server"` file, where *every export becomes a callable action*:
that would have published an arbitrary-file-writer as an RPC endpoint. (Same family as the
`export type { OrderStatus }` line that took production down this session.) Type checks are UX on the
`<input accept=…>`; the real gate is server-side, because a hand-rolled POST ignores HTML attributes.

### 🧹 Cleanup: 5,4 GB of leaked dev servers, 642 lying ledger notes, and a demo that had gone stale

**⚠️ SHARED DB — 94 orders were ADDED to `batik-nusantara` (PHI-5201…PHI-5294).** Additive only:
nothing was truncated, no store_id changed, no other store touched. Your session is safe.

**1. 29 storefront dev servers were holding 5,8 GB of RAM.** Ports **4327 → 4355**, sequential, one
every ~10 minutes, the oldest running **10 hours** — the signature of an agent restarting `astro dev`,
failing to bind the previous port, and walking up the range. The machine had **2,6 GB free of 15,3 GB**.
Killed the 28 abandoned ones **by explicit PID** (never `pkill -f`, which would take a colleague's live
server with it), keeping the newest in case it was in use. **Free RAM went 2,6 GB → 8,1 GB.** This is
the "everything is slow" everyone has been feeling.

**2. `0056` — 642 ledger notes named an order number that no longer existed.** Migration `0052`
renamed every order to the PHI- prefix and **did not touch `ledger_entries.note`**, which embeds the
number as free text ("Penjualan INV-5188" for order PHI-5188). My migration, my omission. The Mutasi
screen looked fine because it JOINs `o.number` — but the **export** ships `Keterangan: r.note`
verbatim, so the CSV handed to an accountant named 642 orders that cannot be found. Re-derived from
`orders.number` rather than string-replacing the prefix, so any stale prefix converges. **642 → 0.**
The writers were always right (`ledger-credit.ts`, `seed.ts` build the note from `o.number` at insert),
so this repairs history only.

**3. `npm run seed:recent -w @tokophi/db` — the demo no longer rots.** `seed.ts` anchors to
`TODAY = 2026-06-30`; wall-clock time does not stop, so by 17 Juli the last order was 15 days old.
The blunt fix truncates the shared DB and evicts every other agent. This one only INSERTS, touches one
store, and is **idempotent by construction** (it fills only days with zero orders — the second run
correctly added nothing). Destinations, couriers and service types are **sampled from real rows**, never
invented: a made-up `ship_district_id` would not resolve in `kiriminaja_areas`, and dummy data that
cannot travel the real code path is a trap rather than a demo. The ledger is **derived from `payments`**
using seed.ts's own SQL — never written beside the orders.

| | before | after |
|---|---|---|
| Empty days in 30 | 15 | **0** |
| `hari=7` tab | **empty page** | 14 bars |
| Ongkir dibayar pembeli | Rp 0 | **Rp 1.960.424** |
| Sudah ditarik | Rp 0 | **Rp 23.500.000** |
| Ditarik kembali | Rp 0 | **Rp 873.513** |
| Omzet vs prev period | **−42%** (seed running out) | **+5%** (a real comparison) |

**Left deliberately untouched: the 685 old orders still have `shipping_idr = 0`**, visible as bars with
no teal ongkir cap before 3 Juli. Backfilling them would have been cosmetic vandalism: `seed.ts` writes
`total = subtotal`, and `payments.amount` + the whole ledger derive from `total`. Adding ongkir to old
rows would either break `total = subtotal + shipping` or desync a Rp 203 juta balance. **The durable
fix is `seed.ts` writing shipping in the first place** — tasked, not hacked.

### 🐛 Tema: the prefix that swallowed its own parent — sidebar gone, seller stranded

Reported as *"masuk editor, pas di back itu error, tampilan berantakan sidebar hilang"*. **It was
never about going back.** `/tema` was broken on plain load — the "before" and "after-back"
screenshots are pixel-identical. The back navigation was innocent; it just happened to be when you
looked.

`components/admin/admin-chrome.tsx`:

```ts
const FULL_BLEED_PREFIXES = ["/tema"];                              // ← the bug
const isFullBleed = PREFIXES.some((p) => pathname?.startsWith(p));  // "/tema".startsWith("/tema") = true
```

The intent (per its own comment) was the **Store Builder** — Puck needs the whole viewport and its
toolbar replaces the topbar. But a **prefix always eats its own index page**: the template LIST went
full-bleed too and lost the sidebar, the topbar and the billing banner. The seller landed on a page
with **no navigation of any kind** and no exit but the browser's back button — which is exactly why
it read as "error" rather than "missing sidebar".

Fixed by matching the builder **exactly** — `/^\/tema\/[^/]+$/`, one segment after `/tema`, never
`/tema` itself. Routes, not prefixes. Verified in a real browser across every path: `/tema` has its
shell back · the builder is **still** full-bleed (unbroken, all Puck panels render) · **back** →
shell · **"Kembali ke Daftar Template"** → shell · 0 page errors.

**My first hypothesis was wrong and worth recording:** `builder-client.tsx` does
`import "@measured/puck/puck.css"`, and that stylesheet genuinely **does** leak — it stays loaded
after navigating away (2 sheets on `/tema` → 3 after visiting the builder, never released). It looked
like an obvious culprit. It wasn't causing this: `/tema` was already broken before any Puck CSS
existed on the page. **The leak is real but currently harmless** — noted in BACKLOG rather than
"fixed" on suspicion.

### 🧭 Keuangan menu, checked against the market — and one row removed

Researched the Finance IA of Shopee / Tokopedia / TikTok Shop / Lazada Seller. Most of it **confirmed
the existing shape**; the valuable part was the one row it killed.

**Removed: "Tagihan & Langganan" from the Keuangan menu.** Keuangan is money the shop **earned from
shoppers**; Langganan is money the merchant **pays us**. Filing our invoice beside their revenue reads
as *a deduction from their earnings* — precisely the take-rate model TokoΦ does not have and is
differentiating against (we charge a subscription, never a commission). It also gave `/akun/langganan`
a **second nav door** beside the avatar menu's — the "many doors, one room" pattern this session
already deleted twice. The contextual cross-link stays where it has meaning: the "Langganan TokoΦ"
card on `/keuangan`. Keuangan is now **Ringkasan · Penghasilan · Saldo Saya**.

**Rejected, with reasons recorded** (BACKLOG, so nobody re-litigates): *"collapse Penghasilan into
Saldo — TokoΦ has no escrow"* is **factually wrong about this codebase** (`ledger.ts`: `pending` is
*held against orders that have not reached `selesai`* — the same order-completion mechanic a
marketplace uses, not a settlement lag). And *"promote Mutasi / Penarikan / Rekening Bank to nav
rows"* proposed exactly the four tabs `/saldo` already has — the user ruled on that directly.

**Independently confirmed** the earlier call to ship **no fee breakdown at all**: a line reading
"Biaya Komisi: Rp 0" is worse than absent — it implies we could charge one and sends the merchant
hunting for the catch.

### 📊 Keuangan gets real charts — and the charts immediately caught two lies

Charts were deliberately absent (CSS bars in a list). Adding them surfaced **two defects that only a
chart can expose**, both now fixed:

**1. `getEarnings` omitted empty days.** `group by day` emits only days that HAVE orders — harmless
in a list (each row names its date), a **lie in a chart**: Recharts joins 25 Juni straight to 28 Juni
as though adjacent, so a shop closed for three days renders as an unbroken trend. **The zero days ARE
the information.** Now zero-filled with `generate_series`, verified against Postgres: 30 rows,
15 genuinely empty. Bars, not an area line — an area chart *interpolates between* days and would draw
revenue at 3am Tuesday that never existed.

**2. Two pages in one menu disagreed about "Omzet 30 hari".** Ringkasan said **Rp 34.350.000 / 91
pesanan**; Penghasilan said **Rp 32.474.000 / 86**. The summary used a rolling `now() - 30 days`
(a **720-hour** window); the chart used 30 **calendar** days in Asia/Jakarta. Both queries were
"correct" and the section still lied — the rolling window reached into a partial 17 Juni the other
excluded. A merchant reconciling the two pages is exactly who finds this. **`WIN()`/`PREV_WIN()` now
define the window once**; calendar days win, because a seller thinks in days that start at midnight
WIB, not in 720-hour spans that slide with the clock. Both pages now read **Rp 32.474.000** — matched
to SQL, and matched *per tenant*: RLS correctly hides `kopi-senja` + `hijab-amara` (the raw table
totals 33.224.000 across all stores).

**Added:** `EarningsChart` (stacked omzet+ongkir, hari nol visible), `getChannelMix` → the existing
`ChannelChart` donut — attribution counted from `orders.channel`, never an invented weight vector.

**⚠️ The chart now draws a cliff to zero, and the cliff is REAL.** The seed's last order is
**2026-07-02**; today is **2026-07-17**. So the "7 hari" tab is legitimately **empty** and 30 hari is
half blank — the seed is anchored to `TODAY=2026-06-30` and real time has walked 17 days past it.
**The code is right; the seed is stale.** A real shop with no sales in 7 days *must* see empty — do
not patch the code to hide it. The page states its own coverage ("15 dari 30 hari ada penjualan.
Sisanya benar-benar kosong — bukan data yang hilang"). Re-seeding is a **shared-DB** action: announce
it first.

## 2026-07-16

### 💰 Keuangan — four pages that complete each other, not four doors onto one room

The first cut of this menu pointed **every row at a `/saldo` tab**: four labels, one room. That is the
anti-pattern "Perlu Dikirim" was deleted for. Each page now answers a question the others cannot —
**Keuangan** *is my money healthy?* · **Penghasilan** *what did I earn, and why isn't it cash yet?* ·
**Saldo Saya** *what can I withdraw today?* (its tabs stay inside it) · **Tagihan** *what do I pay TokoΦ?*

Penghasilan-vs-Saldo is the split Shopee and Tokopedia both make, and it is real rather than cosmetic:
earnings include money the platform still holds; a balance is only what you can take. *"I sold 47
orders, where is my money?"* is a question for Penghasilan — and *"ditahan sampai pesanan selesai"* is
the entire reason the page exists.

`lib/data/finance.ts` **reuses `getBalance()` and never re-derives it**: one place sums the ledger, and
a second copy of that arithmetic is a second version of the truth about someone's money.
`SALES = status not in ('batal','retur')` — counting a cancelled order as revenue is exactly what a
merchant reconciling against their bank statement would catch.

**⚠️ The three Rp 0 on this page are HONEST — check the seed, not the page.** Verified against SQL:
`ledger_entries` contains *only* `pending` (47 rows / 18.436.000) and `available` (209.374.000) — **no
withdrawal row and no return row exist**, and `orders.shipping_idr` is 0 for all 96 seeded orders. The
figures match the screen exactly. A finance screen that invents a number is worse than one that does
not exist, because the merchant will believe it. Where there is no prior period, the delta is **absent**
rather than "+100%". **UI only — the system (held→released transitions, payout→ledger) is in BACKLOG.**

Fixed alongside, in two places: **`<Card>` is already `flex flex-col`**, so `flex items-center` *on* the
card centres its contents horizontally (`items-center` is a column's **cross** axis). The row belongs
**inside** the card. Hit the Langganan card and the Pengiriman Massal bulk-action bar — both measured
flush-left after the fix. Typechecked green while visibly wrong; only the browser showed it.

### 📐 Checkout boxed at 1080, tablet rescued, fields tightened

**"Melebar banget"** — measured, and it was. `lg:grid-cols-2` gave each column a share of the
**viewport**, so at 1920 the columns were **960px each**: the recessed panel ate half a monitor and the
form's fields drifted 400px from the logo. A checkout is a form, and a form has a right size, not a
share. Now **580 + 480 inside a centred 1080 box**, and it stops growing there.

⚠️ **The tablet was worse and nobody had looked.** Between 640 and 1023 this is a single column and the
boxes were `w-full`, so at **768 one email field stretched 720px across the screen**. Every screenshot
in this session was 390 or 1440 — the tablet never entered the frame, and it took measuring 8 widths at
once to see it. Capped at 628 (= the same 580 of content plus its 48 of padding), centred. Header and
footer are boxed to the same grid, or the logo hangs where the fields under it are not.

**Fields tightened**: 3.5rem/1.5rem-of-top-padding read as slabs; now 3rem/1.25rem. Height and padding
are where "minimal" comes from, not a smaller word. ⚠️ **The 15px font is DESKTOP-ONLY and must stay
that way.** iOS Safari zooms the page when a focused control computes under 16px and never zooms back;
`global.css` enforces 16px under `pointer: coarse` with a specificity hack written precisely to beat
`.input-field`. So the `0.9375rem` is a reduction the touch guard silently overrides — **do not
"simplify" it to 15px everywhere**. Measured both ways on the LIVE site: mouse@1440 → 15px; touch@390 →
16px, 0 inputs under the threshold.

**Summary title** was `truncate` — ONE line. "Hijab Voal Segi Empat Motif Bunga Premium Ukuran Jumbo
Warna Dusty Pink" became "Hijab Voal Segi Empat Motif…" in a panel with room to spare, and an
Indonesian product title is routinely that long. `line-clamp-2` now gives two lines before clipping: a
long name keeps enough to be recognised, a short one still reads in full.

Verified on **live** (`batik-nusantara.tokophi.id`) at 8 real widths — 360/390/430/768/1024/1280/1440/
1920: box caps at 1080 from 1280 up; field 328/358/398 on phones, **580 on tablet (was 720)**, 516 on
desktop; logo↔field aligned at **every** width; no horizontal overflow anywhere.

⚠️ **A note on verification, because it bit four times today.** Greps lie about this page: Astro bundles
`<style>` blocks into a hashed CSS file, so `curl … | grep "min-height: 3rem"` returns 0 on a page that
is rendering it perfectly. Same family as the other three misreads this session (a `div` selector for a
`<button>`, measuring mid-transition, and a `main` ref stale by three days). **Only a real browser
against the real URL answers these questions.**


### 🧾 The thank-you page follows the CHECKOUT, and COD finally has an invoice

It sat inside `CheckoutLayout` — so it wore the checkout's white/blue chrome — while its **content was
still the storefront's**: 33 warm tokens (`bg-brand-*`, `text-muted` #736669, `border-line`) and 5
serif `font-display` headings, plus `text-cream`, `rounded-2xl` and a `shadow-brand-200/50` the palette
sweep could not even see because they are not `-brand-N` shaped. Two design systems on one page. Now
it is the checkout's throughout (user's call: *"iku ui/ux checkout bukan storefront"*). Verified: zero
storefront tokens remain.

**The two payment paths are genuinely different, and the page now says so.**
- **AutoLaris (VA / QRIS / retail code):** the money has **not moved**. This page *is* the invoice —
  nothing is emailed (there is no mailer), so the number they must act on is the point of the screen.
  Rebuilt on one `panel()`/`kv()` shape so a VA number, a payment code and a QR string cannot drift
  apart line by line, with "Total bayar" and the gateway link below them.
- **COD:** there is **no payment step at all**, and the page used to say nothing about it — a shopper
  holding a Rp393.000 order got one line, *"Bayar tunai ke kurir saat paket tiba"*, buried in a footnote
  next to the shipping address. Rendering "Selesaikan Pembayaran" there would invent a task that does
  not exist; rendering nothing left the only question they have unanswered. It now gets its own
  panel: *"Tidak ada pembayaran online untuk pesanan ini"* → **the exact cash amount, set large** →
  *"Serahkan ke kurir saat paket tiba"*, with the itemised invoice under it. The one thing a COD buyer
  needs is what to have in hand when the rider knocks, so that is the biggest thing in the box.

Neither footnote repeats its panel any more: COD's reads *"Tidak ada yang perlu dibayar sekarang"* —
the question a shopper actually stares at a "Pesanan diterima" screen asking — and the gateway's says
the instruction is on this page and **not** emailed, which is true and was worth saying.

Browser-verified on both paths: order number renders, VA panel shows "Selesaikan Pembayaran — BCA" with
the real VA, COD panel shows the Rp393.000 cash figure, the invoice totals match on both, the cart is
cleared, 0 console errors.


### 🧼 Checkout, second pass — clean white, and the exits are chosen rather than absent (user's calls)

- **Neutral surface, scoped to the checkout.** The shop is warm on purpose (`--color-cream` #faf6f2, a tinted paper); a checkout should be the opposite — white, quiet, out of the way, so the only colour left on screen is the merchant's brand on the one button that matters. Cream also made "white form vs recessed panel" a contrast between two nearly identical warm tones. `--co-panel` #f5f5f5 + `--co-line` #e3e3e3, declared in `CheckoutLayout` only: the storefront's cream is the shop's identity and none of this leaks into it. Surface is the platform's; colour stays the merchant's. Verified: header/form/footer `rgb(255,255,255)`, panel `rgb(245,245,245)`. The footer needed an explicit `bg-white` — without it `body { background: cream }` (unoverridable, see the layer note) left a tinted strip under an otherwise neutral page.
- **The logo links home; a cart link replaces "Pembayaran aman".** This reverses the earlier "the logo is inert" call. The tunnel argument still stands, but a shop's mark is the one thing every shopper expects to be clickable, and an unclickable one reads as broken rather than focused. The cart link (top-right, where a shopper looks for it) goes to `/keranjang` — the same destination as "Kembali ke keranjang" in the summary: one intent, two places, no third idea. The exits here are now **chosen, not absent**; what stays banned is the nav, because a mega menu is a shelf of destinations and this screen is not for browsing. "Pembayaran aman" is gone: it occupied the spot a shopper scans for their cart, and a platform asserting its own trustworthiness in a corner is the weakest place to spend that space — the padlock in the address bar already says it, better.
- **Breadcrumb and the "Checkout" title removed.** The reference has neither, and both told the shopper what they already know: the page reads Kontak → Alamat → Pengiriman → Pembayaran and the tab says Checkout. "Kolom bertanda * wajib diisi" went with them — the asterisks are on the labels, where they are actually read.
- **The address field grows with the address.** An Indonesian address is long (street, number, RT/RW, patokan) and `rows=2` on a phone is a two-line porthole the shopper must scroll *inside* while typing, unable to re-read what they wrote — the exact field a mis-delivery comes from. It now grows to fit, capped at 200px so it can never push the pay button off a long page. Verified on a real 390px touch context: 72px → 112px as a full address is typed. (Desktop stays 72px because the same address fits one line in a 576px column — correct, not a miss.)
- **No iOS zoom, measured rather than assumed:** every `input`/`select`/`textarea` on the page computes ≥16px — **0 fields under the threshold**. Safari zooms the whole page when a focused control is under 16px and never zooms back.

Regression after all of it: chrome gone, mobile bar at y=0 with the toggle + aria + label correct, both totals agree (Rp 378.000), no horizontal overflow at 1440 or 390, **0 console errors**.

### 🗂️ `CATEGORY_ORDER` — the last hardcoded allowlist, and it was hiding two other bugs

`catalog.ts` built `collections` (and therefore `findCollection`) from a constant list of the DEMO store's six handles. Any other merchant's real collections were **invisible to their own storefront**: no category grid, no dropdown, and `/kategori/<their-handle>` 404'd. Same family as the batik hero, the brand story, the display serif, the review text and the nav fallback — the demo's content living in a platform default. It is now derived from the store's own rows, filtered on `published` and `archived_at`.

**Two things the allowlist was concealing, both found by honouring the columns:**
- **The demo has been publishing a category its merchant switched off.** `outerwear` ships `published = false`; the allowlist named the handle and never read the column. Batik has **five** published categories, not six. `/kategori/outerwear` now correctly 404s.
- **…which exposed a dead link the bug had been masking:** batik's own seeded menu links "Outerwear". `getFooterNav` already states the principle — *the merchant chooses the ORDER and the LABELS; publication state decides what a shopper is allowed to be sent to* — and applies it to `/halaman/` links. `getMainNav` now applies it to `/kategori/` links: dead category links are dropped, and a dropdown left empty goes with them.

**Order: alphabetical by title (id-ID).** `collections` has **no ordering column** — no `position`, not even `created_at` — so there is nothing to honour and insertion order is a random uuid away from meaningless. Deliberately *not* the demo's old order, since reproducing that needs exactly the constant being removed. When a merchant wants their own order, the fix is a `position` column plus the Kategori editor, not a list in the storefront's source.

`VIRTUAL_COLLECTION_HANDLES` (`semua`/`promo-gajian`/`produk-terlaris`) is kept and exported — **not the old allowlist renamed**: it names *platform routes* `[handle].astro` computes for every tenant, and `[handle].astro` now types its `VIRTUAL` map against it so the two cannot drift. Excluding them from `catalog.collections` matters: batik has **real rows** for `promo-gajian` and `produk-terlaris`, so a naive "all collections" query would put a "0 produk" tile next to a page that renders products, and list "Promo Gajian" twice in the nav.

**My own seed shipped the same mistake and is fixed here too:** `seed-templates.ts` put an Outerwear tile on the demo's homepage template — I filtered the *products* by `status` and forgot to filter the *collections* by `published`, which is precisely what `CATEGORY_ORDER` was doing one layer down. Five tiles now. The row was re-seeded (mine, from today, unedited).

Verified per tenant, every rendered `/kategori/` link fetched: **batik** — template renders, nav unchanged (Beranda | Semua Produk | Kategori | Promo Gajian | Blog | Kontak), 8 links, **0 dead**, 0 console errors; **kopi-senja** — neutral fallback, 5-item nav, 2 links, 0 dead, 0 errors. Sitemap no longer lists `outerwear`, which the file's own comment calls a negative signal.

⚠️ **Found, NOT fixed — the next one in the family, and bigger:** `byCollection` matches `slugify(products.category)`, **not** `collection_products`. So a merchant's manual collection membership is invisible to the storefront, and any collection whose handle doesn't equal a product's slugified category text renders empty. It only works for batik because its category strings happen to slugify onto its handles.

### 💳 The order API could charge a shopper twice, and could oversell without leaving a trace

Four failures in `/api/public/order`, all on the write path, all **exercised against the live endpoint** — including a real two-client race.

- **No top-level try/catch → a double charge.** `alCreatePayment` does an unguarded `await res.json()` (`autolaris.ts`), so a network blip or a gateway's HTML 502 page **throws** instead of returning `{ok:false}` — and by that line the order, its line items and the stock decrement are **already committed**. The throw escaped as a CORS-less 500 (the storefront is on another origin), `checkout.astro`'s `.catch` showed the generic "Gagal terhubung ke server.", the shopper pressed Bayar again, and bought the same cart twice with stock decremented twice. `/api/public/ongkir` has wrapped its handler for precisely this reason since it shipped; the one that *writes* did not. Now: a handler wrapper answering **with CORS**, plus — the actual fix — `alCreatePayment` throwing is treated exactly like `rc=07`, taking the `payError` exit that already existed. To a shopper a throw and a decline are the same event: the payment did not start. The order stands, nothing is written twice.
- **Stock check and decrement were not atomic, and the oversell was invisible.** The check read `sum(available)` hundreds of lines before the decrement, so two orders for the last unit both passed and both wrote — and `GREATEST(… - qty, 0)` then **clamped the result at zero**, leaving stock reading 0, exactly as it would after one honest sale. The evidence of the oversell was destroyed by the same expression that caused it. Now the rows are `SELECT … FOR UPDATE`-locked, re-checked and decremented **inside the transaction**, and the clamp is gone: if this arithmetic can go negative, the lock is not working, and flooring it is how we stopped finding out.
- **customer ⋈ order ⋈ line items ⋈ stock were four unguarded statements.** A throw between any two left an order with partial line items and partially decremented stock — a half-order nothing records as half. Now one `db.transaction`. The AutoLaris call stays **outside** it: a network round-trip must never hold a DB transaction open.
- **`"WEB-" + Date.now().slice(-9)`** against the *global* `orders_number_unique` constraint — two orders in the same millisecond collided and the insert threw, which (before the wrapper) was a CORS-less 500 on a checkout. A 3-char base36 tail makes that need the same millisecond *and* 1-in-46,656, and the wrapper now answers honestly if it ever happens.

**Verified end-to-end, not typechecked** (`tsc` cannot see inside a Postgres transaction):
- One real order placed: orders 700→701, line items 1767→1768, customers 24→25, Rose/M stock **14→12** — exactly qty 2, decremented **once**. AutoLaris sandbox returned a real VA. Then removed, and the DB restored to the exact baseline (700/1767/24/14).
- **The race, two concurrent POSTs for the last unit:** A → **200** (order created), B → **409** *"Stok … tidak mencukupi (sisa 0)"*, stock settled at **0 — not negative, not clamped**. Before this change both would have succeeded and the oversell would have left no trace.
- Out-of-stock via the early pre-check → 400, nothing written. CORS present on error responses. The disabled-channel and bad-variant rejections from earlier today still hold.

⚠️ **Latent, not fixed:** the decrement still targets **every** `inventory_levels` row for a variant with no location filter, while the check sums across them. Every variant has exactly 1 row today (96/96 verified), so it is correct now — but the unique key is `(variant_id, location_id)`, so multi-location is a supported shape, and the day a variant has two rows this subtracts the full qty from each. The real question there is which location ships, which is a design decision, not a patch.

### 🧭 The header shipped Batik Nusantara's menu to every other store — the last "demo's taste" leak

`getMainNav` fell back to `MAIN_MENU` from `@tokophi/data/menu`, a hardcoded copy of the demo's categories, whenever a store had no `menus` rows. That is not an edge case: it is **6 of the 7 stores** in the DB, and — per the file's own comment — **every freshly provisioned store**, because `provisionStore` seeds no menu. So the first real merchant to sign up would get a "Kategori" dropdown reading Dress / Atasan / Bawahan / Busana Muslim / Outerwear / Loungewear, in **their** header, on **every page**. Measured on kopi-senja before the fix: `/kategori/dress` → **404**, `/kategori/atasan` → **404**.

Same bug as the batik hero in the fallback homepage, the brand story signed with someone else's name, the display serif in `global.css`, and the fabric-flavoured review text: the demo's content living in a platform default and leaking to every tenant. This was the last one I know of.

The fallback is now **derived from the store's own collections**, which is the shape `getFooterNav` already uses in the same file ("falls back to listing the published pages"). Only routes every tenant genuinely has stay hardcoded: `/`, `/blog`, `/kontak`, and `/kategori/semua` + `/kategori/promo-gajian` (virtual collections, measured 200 on both the demo and a store with an unrelated catalogue). **No collections → no "Kategori" dropdown at all** — a missing menu item is a smaller loss than a 404.

Verified per store, every header link fetched: **batik unchanged** (Beranda | Semua Produk | Kategori | Promo Gajian | Blog | Kontak — 13 links, 0 dead) because it has its own menu in the DB and this only touches the fallback; **kopi-senja and gadget-murah-id** now show 5 links, 0 dead, and no Kategori.

⚠️ **Inherited, not introduced:** the fallback reads `catalog.collections`, which is built from `CATEGORY_ORDER` — a hardcoded allowlist of the demo's six handles (`catalog.ts:83`). A future store whose real collections are not on that list gets an empty list, so it fails **safe** (no dropdown) rather than wrong (links into another shop). It does not bite today because the other six stores have zero collections. The real fix is for `catalog.collections` to read the store's own rows; tracked, not done here.

### 🏠 The demo's batik homepage is back — as SELLER data this time, and it finally exercises the Store Builder

`page_templates` had **zero rows**, platform-wide: the storefront's template renderer had never run against real data, and the demo's homepage looked good only because the batik content was hard-coded into the platform's fallback. Making that fallback neutral (earlier today) left the demo plain, because the content had nowhere to live. `seed-templates.ts` puts it where it belongs: Batik Nusantara's own `page_templates` row — hero (3 batik slides) → category-nav (6 real handles) → rich-text "Cerita Kami" → product-grid "Paling Dicari" → rich-text CTA. Standalone + idempotent like `seed-reviews.ts` (`npm run seed:templates -w @tokophi/db`): it inserts only when the store has no homepage template, so it is safe against a live DB and never clobbers what a merchant edited in the builder. Verified: batik renders all 5 sections, 0 broken images, 0 console errors — and `kopi-senja` still shows its own neutral fallback.

**The "Cerita Kami" paragraph is the whole point.** It used to be a first-person claim about batik and Indonesian women, hard-coded in the platform and rendered under *every* store's name. It is now one merchant's words, on one merchant's template, about their own goods.

**Typed against the real contract** (`StoredTemplateData` from `@tokophi/sections`, a type-only devDependency — the workspace symlink already existed, no install needed). This is not decoration: `sections` is jsonb and the DB validates nothing, and the two ways a hand-written template fails are both quiet. Proven by deliberately breaking it — a typo'd `mode` (`"terlariss"`) and a typo'd `type` (`"category-navv"`) are now **compile errors**, where before the first would 500 the whole storefront (`MODE_FN[mode](pool)` has no guard) and the second would render nothing at all (`SectionRenderer`'s switch has no `default`). Every `props.id` is unique, which Puck requires and never generates on load — without it the storefront still looks right while the *builder* silently breaks.

`columns: 3`, not 4, for Paling Dicari: `mode: "terlaris"` is `filter(p => p.bestseller)` — a boolean flag with **no sorting**, despite the registry comment claiming it "sorts the whole catalog by all-time units_sold". This store flags 3 of 14 products, so 4 columns rendered the ragged 3-of-4 row the old hand-built homepage had. Three columns gives those 3 real bestsellers one full row.

⚠️ **Found while verifying, NOT fixed — the same bug one layer deeper: the HEADER still ships the demo's menu to every other store.** `getMainNav` falls back to `MAIN_MENU` from `@tokophi/data/menu`, a hardcoded copy of Batik Nusantara's categories, whenever a store has no `menus` rows — which is **6 of 7 stores**, and, per the file's own comment, **every freshly provisioned store** (`provisionStore` seeds no menu). Measured on kopi-senja: `/kategori/dress` → **404**, `/kategori/atasan` → **404**, on every page of the shop. It has not bitten because those stores have no products and nobody shops them — but the first real merchant to sign up gets batik's menu with dead links in their header. The fix is the pattern `getFooterNav` **already uses in the same file** ("falls back to listing the published pages"): derive the fallback from the store's OWN collections instead of a constant.

### ✍️ Checkout: floating labels — the last visual delta to the Shopify reference

The label now lives **inside** the box: empty and unfocused it reads as the placeholder; on focus or content it shrinks up into the top padding. That is the reference's signature, and it is not only cosmetic — a bare placeholder disappears the moment you start typing, so a shopper reviewing a filled form has to infer what each box was for. Every control carries `placeholder=" "` (one space, **not** empty — `:placeholder-shown` does not match an absent attribute), and the label sits after the input so the sibling selector reaches it. A `<select>` always has a value, so its label is parked raised permanently (`.field-select`) rather than sitting on top of the current selection. Browser-verified with the transition settled: label rises 10px and shrinks 20px→15px on focus, **stays up** when filled and blurred, never overlaps the typed value, no overflow, no console errors, and the mobile bar/toggle/totals/sukses regression all still pass.

⚠️ **Where a placeholder carried REAL information it became helper text — it was NOT dropped.** Copying the reference exactly would have deleted hints an Indonesian address needs and a UK one does not:
- **"Nama jalan, no. rumah, RT/RW, patokan"** → helper under Alamat. An Indonesian address without RT/RW or a patokan is a parcel the rider phones about.
- **"Ketik kecamatan / kota"** → helper under Kecamatan. It was the *only* thing telling a shopper that box is a **search**; the ongkir quote depends on them picking a row (`dest_id`), not on what they typed.
- **"08xxxxxxxxxx"** → "Contoh: 0812 3456 7890". Kept as an example, not a rule — `normalizePhone` accepts `0812…`/`812…`/`+62…`/`62…` with any separators. Deliberately **not** "nomor aktif untuk konfirmasi pesanan": nothing in this codebase notifies anyone.

A label names a field; a hint teaches it. They are not the same job, and the floating label only does the first.

Also moved "Pembayaran diproses aman" from under the payment list to under the **heading** — the reference's placement, and the better one: it reassures before the shopper picks a method rather than after they already have.

### 🛡️ `/api/public/order` — three holes where the boundary was not actually the boundary

The file's own comment states the doctrine: *"Hiding the option at checkout is UX; this is the boundary."* Three things were not honouring it. All found by audit, all confirmed in the code, and the first two **exercised against the live endpoint** (`orders` count 700 → 700 across four POSTs — every rejection path writes nothing).

- **A payment channel the platform switched OFF was accepted.** The gate tested `AUTOLARIS_KNOWN_CHANNELS` — AutoLaris's *discovery roster* of everything they might support, not our decision. **9 of its 15 codes are disabled in `platform_payment_channels` right now** (ADR 0004: channels are a platform decision). So `POST channelCode:"ALFAMART"` passed, **the order was written and stock decremented**, then `alCreatePayment` returned rc=07 — and that path answers **HTTP 200 with `payError`**, so `checkout.astro` marks it settled and renders the success page. The shopper is told it worked; the merchant gets a pending order with no payment row that nobody can pay. Now gated on `enabled AND active`, the same list the storefront already reads. Verified: ALFAMART → `400 "Metode pembayaran tidak tersedia."`, VABCA → passes.
- **A named variant that did not match was silently swapped for the position-0 variant.** `(i.variant && vars.find(…)) || vars.sort(…)[0]` — the `||` fallback exists for legacy products with no variant rows, but it fired for **every** product. `i.variant` is a string the *browser* rebuilds and parks in localStorage, so a variant renamed in the Seller editor, reordered options, or a week-old cart all miss the exact-title match. The order then became "Rose / S": stock checked against the **wrong** variant (a sold-out one sails through), the wrong one decremented, wrong colour and size in the box, shopper never told. Now a named variant must match or the order is **rejected** — the same rule the shipping quote already follows for a picked service. Verified: a bogus variant → `400 "Varian … sudah tidak tersedia."`; the real one passes.
- **The live per-destination COD flag was computed and never read.** `rate.cod` is the *effective* answer for this actual route (KiriminAja's capability × platform `codAllowed` × the store switch). The gate consulted only `policy.reason()`, built from **stored config**, so it could not know the courier refuses COD to that district. Ongkir returns the false flag and checkout hides the option — but a direct `POST channelCode:"cod"` was accepted because `key("spx","1")` is on the allow-list, booking a parcel COD on a service that will not collect it there. One guard at the boundary. ⚠️ **Not exercised end-to-end** — it needs a live KiriminAja quote for a district that returns `cod:false`; typechecked and reviewed only.

Also: `AUTOLARIS_KNOWN_CHANNELS.find(…)!` in the response builder was a non-null assertion against a roster this endpoint **no longer validates against** — a channel enabled in the DB but missing from that list would have thrown *after* the payment was created. The channel's label/kind now come from the same row that authorised it.

⚠️ **Known and NOT fixed** (from the same audit — real, ranked, and worth doing next):
1. **No top-level try/catch.** `alCreatePayment` throws *after* the order insert, the line items and the inventory decrement → a CORS-less 500 → the storefront shows the generic "Gagal terhubung ke server." → the shopper presses Bayar again → **second order, stock decremented twice**. `/api/public/ongkir:31-38` already wraps its handler for exactly this reason; the order route does not.
2. **The write is not a transaction and the stock check is not atomic.** No `db.transaction`, no `FOR UPDATE`: two concurrent orders for the last unit both pass `available >= qty`, both insert, and `GREATEST(… - qty, 0)` clamps the result — so the oversell leaves **no trace in the data**.
3. **`number = "WEB-" + Date.now().toString().slice(-9)`** against a global unique constraint — a same-millisecond collision throws inside the insert.
4. **A merchant who unticks every shipping service gets every courier offered.** `saveStoreServices` deletes-then-inserts, so "none" leaves zero rows, and `shipping-quote.ts:123` reads zero rows as "never configured" → falls back to all platform couriers. The code cannot tell "not configured" from "deliberately none"; that needs a sentinel, not a row count.

### ⭐ Four shoppers were reciting each other's sentences on the demo's best-selling product

`seed-reviews.ts` drew each review body with `pool[floor(rnd() * pool.length)]` — independently, per (customer, product) pair. The 5★ tier held 7 sentences and ~55% of reviews land on 5★, so any product with more than a handful of delivered buyers repeated text **by pigeonhole, not by bad luck**: `hijab-voal` rendered **14 reviews with 10 distinct texts**, `dress-midi-bunga` had two named reviewers delivering the identical sentence word for word. Verbatim repetition is the single loudest "these reviews are fake" signal there is, and it was sitting on the demo we show people.

Now the pick is **without replacement, per product** — seeded from the bodies already in the DB, so a fresh run cannot hand a new reviewer a line that is on the page already. Uniqueness is per product on purpose: two products sharing a line is invisible to a shopper; two reviewers on one page sharing one is the whole problem. If a tier genuinely runs out we reuse rather than drop the review — the pair is real (that customer did receive that parcel), so only the wording repeats. Pools widened (5★ 7→14, 4★ 6→10, 3★ 4→7, 2★ 2→4) to keep that fallback unreachable at realistic volumes.

**The live DB was repaired too** — the script is idempotent and skips pairs that already have a review, so fixing the generator does not fix rows already written. A targeted pass rewrote **32 duplicate bodies across 13 products** (of 150 reviews), drawing an unused sentence from the *same* rating tier; ratings, statuses, dates and authorship untouched (distribution still 83/42/20/5). Verified in a browser: 0 duplicate review paragraphs on `dress-midi-bunga` and `hijab-voal`.

⚠️ **Corrected a false claim in that file:** the bodies were described as "generic enough for any product". They are not — every line is about **fabric, stitching and fit**. It has never bitten because only `batik-nusantara` has `selesai` orders, so only it gets reviews. The day a coffee roaster or a phone shop has a delivered order, this script would publish *"bahannya adem dan jatuhnya bagus di badan"* under their product. The fix then is **not more sentences** — it is to stop seeding reviews for stores whose goods we have never seen.

### 🔤 One typeface for every store — the display serif was the demo's taste, imposed in CSS

`global.css` said it out loud: *"Brand: elegant women's fashion (Batik Nusantara demo)"*, and `--font-display: Playfair Display` put an editorial serif on every heading of every storefront. Same bug as the batik copy in the fallback homepage, one layer down: **a display serif is brand voice, and brand voice belongs to the merchant, not the platform.** It flatters a fashion label and fights a coffee roaster or a phone shop — and six of our seven stores are not fashion. Both tokens now resolve to the same neutral sans (Inter); hierarchy comes from weight/size/tracking, which the markup already sets (verified: h1 56px/600 vs body 16px/400, unchanged). One less family to download, too — the Google Fonts request drops Playfair and picks up Inter 700.

⚠️ **`--font-display` and `.font-display` STAY — they are the seam, not dead weight.** `.font-display` is used 47× across 21 files, and the point is that a per-store font can later be injected there as a CSS custom property **exactly the way `--color-brand-*` already is** (`Layout.astro` writes `catalog.brandShades` into `:root`; that line is the whole mechanism). Deleting the token would mean re-threading 47 call sites the day the font picker lands. Until then it deliberately equals `--font-sans`.

### 🎭 `SECTION_DEFAULTS.hero` was the last default still shipping the demo store's finished homepage

Every sibling in the registry had already been turned into a prompt for this exact reason (`banner-promo`, `testimoni`, `image-text`, `marquee`, `rich-text` all carry the note). `hero` still carried three batik slides, a "Koleksi 2026" badge, and a **"Lihat Koleksi Dress"** button pointing at `/kategori/dress` — **200 on batik-nusantara, 404 on every other store** (measured against kopi-senja). It did double duty, which is what hid it: it was also the fallback homepage's hero. That half is fixed in `index.astro`; this is now only what a merchant sees after dragging a Hero onto the canvas, and a default there is a **prompt they replace**, never finished copy about someone else's goods. One slide, not three — a merchant adds slides when they have photos.

⚠️ **Corrected a comment that documented a bug which does not exist.** The `rich-text` note claimed `/kategori/semua` is "a collection NO store has … so the default CTA 404'd on every storefront including the demo", and the href was moved to `/` on that basis. **It is false** — `semua` is a virtual collection handled by `kategori/[handle].astro` and returns **200 on every store** (measured on both the demo and a store with an unrelated catalogue). What genuinely 404s is a *real* handle only the demo owns, like `/kategori/dress`. `/` stays as the default because home is a fine place for a brand CTA to point — not because the alternative is broken. Do not "re-fix" it.

### 🧾 Checkout redrawn to the Shopify layout — two zones, not six cards

Same fields, same flow, same server boundary; only the surface changed. A **white form column** and a **recessed summary panel** that bleeds to the right edge and runs the full height, one hairline between them. That relationship is most of what reads as "clean" in Shopify's checkout — ours had every section in its own `rounded-2xl` card floating on cream, which is six competing rectangles instead of two zones. Sections are now flat (heading + fields), headings are **bold sans, not `font-display`** (the serif is the shop's voice — a checkout is an instrument panel), inputs are taller/white/16px from **one** `.input-field` class, and the pay button is `rounded-lg` with no glow (it is the only action on screen; it has to be unmissable, not persuasive). `CheckoutLayout` owns the columns via a named `summary` slot, so the page hands it two pieces of content and never touches layout. The summary now lives **outside** the `<form>` — it holds no inputs since the pay button moved, and the script reaches it only by `getElementById`.

⚠️ **Three traps, all of which passed `astro check` clean:**
- **`bg-white` on `<body>` is a DEAD CLASS.** `global.css` sets `body { background: cream }` **unlayered**, and Tailwind v4 emits utilities inside `@layer utilities` — an unlayered rule beats every layered one *regardless of specificity*. Both columns rendered cream and the contrast the design is built on silently did not exist. Column backgrounds go on `<main>`/`<aside>`.
- **A `{/* … */}` JSX comment between `</head>` and `<body>` is not a comment** — Astro renders it as text, straight onto the top of the live page. Same class of bug as the HTML-comment warning already in this file, in the opposite direction. Use `<!-- -->` there. Ditto inside an element's attribute list: it corrupts the parse and the *next* text node starts being read as an expression.
- **The email input never used `.input-field`.** It carried a hand-rolled copy that had drifted — `bg-cream` not white, 14px not 16px, a different focus colour — so the first field a shopper meets was the one that looked unlike all the others, and it was the 14px case iOS zooms on and never zooms back.

### 🏠 Every store on the platform was serving Batik Nusantara's homepage under its own name

`index.astro` seeded its fallback hero from `SECTION_DEFAULTS.hero`, conflating two different jobs: the **builder seed** (placeholder copy a merchant is about to edit after dragging a Hero onto the canvas — batik-flavoured is harmless there) and **the fallback homepage a real shopper sees** on a store that never opened the builder. Nothing distinguished them, and **no store in the DB has a homepage template**, so *every* storefront rendered it. Verified live: `gadget-murah-id` (electronics, Jakarta) served a photo of a woman in batik, the headline "Batik Modern untuk Hari-Harimu", a **"Lihat Koleksi Dress"** button pointing at a `/kategori/dress` it does not have — and a brand story in quote marks **signed "Gadget Murah ID — Jakarta"**. That last one is why this was a bug and not a matter of taste: we were putting words in a real merchant's mouth about a business that is not theirs.

**The rule now: every word on the fallback is either a neutral platform verb or a value the MERCHANT wrote** (`stores.name`, `stores.tagline`). The hero is their name + their tagline, CTA "Mulai belanja" → `/kategori/semua` (a virtual collection every store has, unlike `/kategori/dress`), no invented "Koleksi 2026" badge. **The "Cerita Kami" brand story is deleted outright** — a first-person claim attributed to a real business is the one thing a platform can never write for them, and there is no honest neutral version ("we care about quality" signed by them is still us speaking as them). It comes back when the merchant writes one, as a rich-text section in the Store Builder, which already exists. Empty sections are no longer rendered as titled empty rooms, and "Favorit pelanggan **minggu ini**" is gone — `bestsellers()` sorts by all-time `units_sold` and does not window by date (the registry already carries this exact warning; the homepage was making the claim anyway).

**`Hero.astro` now honours a promise the registry has always made.** "empty imageUrl = brand-tinted gradient panel" was not true — the no-image slide carried no background at all and fell through to a flat `bg-ink` slab, identical on every store. It is now `brand-700 → ink`, so a merchant without a hero photo at least gets *their* colour. Deliberately not a pale shade: the copy on top is white and the scrim only darkens.

⚠️ **Known consequence:** the demo store (`batik-nusantara`) now renders the same neutral fallback, so it lost its batik hero. The fashion content belongs to a Store Builder template on *that store*, not to the platform's fallback — seeding it is the follow-up, and it would also make the demo prove the Store Builder path instead of bypassing it.

### 🛒 Checkout is a tunnel now, not a page of the shop — `CheckoutLayout` (Shopify's model, ADR 0009 §4)

Checkout wore the **same `Layout` as the catalogue**: a mega menu with category links, a cart pill, a footer, and the chat bubble — every one of them an exit, rendered at the most expensive point in the funnel. New `layouts/CheckoutLayout.astro` is the platform's chrome: **merchant logo + "Pembayaran aman", one footer line, nothing else**. The logo is deliberately **not a link** (on the storefront it goes home; here home is an exit). The only ways out are the breadcrumb and "Kembali ke keranjang", and both lead to the cart. `checkout/sukses.astro` moved to it too — for a VA/QRIS order the payment has **not** happened yet and the instruction is on that very page, so a mega menu there invites the shopper away from a number they still have to act on. Chat dropped from checkout (user's call). **Analytics stays** — blinding `/analitik` at the funnel's end would defeat the point. Also `noindex` on the page itself: robots.txt already disallows `/checkout` and stays the primary instruction, but that is a request and this is on the page, for crawlers that fetch anyway.

**The line, written down before it is cheap to lose: layout is the platform's, tokens are the merchant's.** Per-store variance at checkout is **logo + brand colour, and nothing else** — the same boundary Shopify draws with `checkoutBrandingUpsert`. **Checkout must never become a `page_templates` type**; the day it does, the one screen that takes money goes to drag-and-drop, and that cannot be walked back once a merchant uses it.

### 📱 The mobile checkout hid the total behind ~1.800px of scroll

On a 390px phone the summary stacked **last**: the total and the pay button sat near the bottom of a 2.206px page, so the shopper typed name, address and kecamatan having **never seen what they were about to pay**. Now the summary is a **collapsed bar at the top** (`order-first`) with the total always visible and the line items one tap away — Shopify's pattern, and the total is the one fact a shopper wants confirmed *before* typing. The pay button moved to **the bottom of the left column**, under Pembayaran, on every breakpoint: that is where Shopify puts it (reading order — the button is the last thing after the last decision), and it is what makes the top-summary possible at all, since a button living inside that card would have landed above the empty form. Page height 2.206 → 1.984px.

⚠️ **Two traps this hit, for whoever touches it next:** the summary body uses `hidden` as a **class, not the attribute** — Tailwind v4 preflight declares `[hidden] { display:none !important }`, which `lg:block` cannot beat, so the attribute version left the desktop summary permanently invisible. And the mobile bar's total is written **only** in `recompute()`, the same line as `#summary-total` — two totals that can disagree is worse than no total on the bar, because the shopper reads one and is charged the other.

Browser-verified at 1440 + 390 (not just `astro check`, which cannot see inside a `<script>`): chrome gone, desktop summary visible, bar at y=0 on mobile, toggle + aria + label correct, totals agree, no horizontal overflow, order number + VA render on `sukses`.

### 🌐 Domain topology: storefronts moved to `tokophi.id`, custom domains via Cloudflare-for-SaaS (`cname.tokophi.cc`)

The final split (decided with the user): **platform stays on `tokophi.com`** (landing = apex/www, Seller = `app.`, Super Admin = `rich.`), **every storefront's default address is now `<slug>.tokophi.id`** (the registered store name), and **merchant custom domains** attach through **`cname.tokophi.cc`** (Cloudflare-for-SaaS Custom Hostnames). Shipped end-to-end, browser-verified:

- **Cloudflare (via API):** `tokophi.id` zone activated (NS moved off Spaceship), `*.tokophi.id`+apex `A`→origin proxied, SSL `full`, Always-Use-HTTPS on. **Cloudflare for SaaS enabled** on `tokophi.cc`; fallback origin `cname.tokophi.cc` **active**. Pricing: first 100 custom hostnames free, then $0.10/hostname/mo.
- **Traefik (origin box):** two dynamic files added (`ops/tokophi-stores-id.yaml`, `ops/tokophi-com-to-id-redirect.yaml`) — one serves `<slug>.tokophi.id` (references the stable `tokophi-stores@docker` service; zero-downtime hot-reload, survives redeploys), one **301/308s the old `<slug>.tokophi.com` → `<slug>.tokophi.id`** (slug+path+query preserved) so `.id` is the single canonical storefront domain and `.com` links/QRs still work. `app.`/`rich.`/`toko.` untouched (higher-priority routers). Verified: `https://batik-nusantara.tokophi.id/` → 200 valid cert; `.com` → permanent-redirect → `.id`.
- **Coolify env:** `STOREFRONT_BASE_DOMAIN=tokophi.id` + `CUSTOM_DOMAIN_CNAME_TARGET=cname.tokophi.cc` set in Coolify's Laravel-encrypted store (via `/root/cf_env.py`, self-verifying) — applies on next redeploy. No storefront **code** change was needed to serve `.id` (the `slugFromFirstLabel` fallback resolves it).

### 🔒 Seller → Pengaturan → Domain: a system-locked default domain + a Shopify-style connect flow, hardened

The Domain card now leads with the **system domain** `<slug>.tokophi.id` — shown read-only with a lock ("Aktif otomatis · diatur sistem, tidak bisa diubah") and a Kunjungi link — because that address is derived from the store slug and a merchant must never be able to change or detach it. Below it, the **custom-domain** flow got a Shopify-style numbered tutorial (add → publish CNAME+TXT → verify → make primary), plus the apex/`www` + "email unaffected" notes. **Security hardening in `lib/actions/domain.ts`:** `addDomain` now refuses **every platform-owned zone** — `tokophi.id`/`tokophi.com`/`tokophi.cc` and any host under them (`PLATFORM_ZONES`, one place) — so a merchant can't squat `app.tokophi.com`, the `cname.tokophi.cc` fallback, or another store's `<slug>.tokophi.id`; and a **per-store cap** (`MAX_DOMAINS_PER_STORE=5`) guards the `UNIQUE(host)` space and the poller. (Ownership was already proven by a real TXT check, writes already gated by RBAC + RLS, and `store_domains.host` is DB-UNIQUE across the platform.)

### 💰 A **Keuangan** menu — reversing "money is not a place you navigate to"

`lib/nav.ts` carried a deliberate rule: *"Saldo is **deliberately NOT** in the sidebar. Shopify's restraint: the nav is for the WORK, and money is not a place you navigate to — it is a thing you glance at."* That reasoning is sound **for Shopify's market**. It is wrong for this one: **Shopee, Tokopedia and TikTok Shop Seller all put Keuangan in the sidebar**, so an Indonesian seller looks for it there and finds nothing. Reversed, and the reversal is written into the nav so it is not "fixed" back.

The topbar chip **stays** — the two do different jobs: the chip is the *glance*, the menu is the *work* (withdraw, see what is still held, fix the bank account).

```
Keuangan → /saldo
  ├ Saldo Saya          → /saldo            ├ Rekening Bank       → /saldo?tab=rekening
  ├ Dana Dalam Proses   → /saldo?tab=proses └ Tagihan & Langganan → /akun/langganan
  └ Penarikan Dana      → /saldo?tab=penarikan
```

**Every row opens a view that exists** — the rule that kept "Pengiriman Massal" and "Serah Terima" out of the nav until they were built. Verified per row, not assumed: each link lands on its **own** tab (`Mutasi (642)` / `Dana dalam proses (47)` / `Penarikan (0)` / `Rekening`), none silently falling back to the default. `Tagihan & Langganan` is a genuinely separate page **and a different kind of money** — what the seller *pays us*, not what they earn.

**Why this is not the "Perlu Dikirim" mistake** (removed in the same session): that one was a saved link to a tab **the parent row also pointed at** — three doors onto one room. Here the parent opens Mutasi and each child opens a *different* tab.

### 📦 Pengiriman Massal — bulk book, fetch the resi, print thermal labels (and "Perlu Dikirim" retires)

`/pesanan/massal`. Three verbs, in the order physics forces:
1. **Generate resi** — books each order with the service **the shopper paid for** (`orders.courier` + `service_type`). No rate picker: the order already knows, and asking the seller to re-choose is asking them to guess on someone else's money. A service no longer quoted is **rejected**, never silently swapped.
2. **Ambil resi** — polls KiriminAja; `trackShipment` persists the waybill once a courier issues it.
3. **Cetak resi** — one document of **100×150mm thermal labels** (`buildLabelHtml` per order, each carrying its own `@page`), one print dialog, then `label_printed_at` is stamped (migration **`0055`** — no print state existed anywhere before).

**Filters, all live against real data:** service group **1 Hari / Reguler / Ekonomi / Cargo / Next Day** (via `platform_couriers.services[].group` ⋈ `orders.service_type` — impossible before `0053`), **jasa kirim**, **status cetak**, and **isi** (bijian = 1 item / bundling = >1).

**Nav:** the **"Perlu Dikirim"** sub-item is **gone**. It was a saved link to `?tab=perlu_dikirim` — the same view the list already has a tab for, and the same one the parent row now points at (it is what the badge counts). Three doors onto one room; Pengiriman Massal takes the slot.

Deliberate, so nobody "fixes" them back: **sequential, not parallel** (each item books a REAL pickup — 50 at once risks rate-limiting mid-run, and a duplicate pickup is not a retry, it is a second parcel); **partial failure reported per order**, never summarised into "berhasil" (8 booked / 2 failed must say *which* two); **orchestration only** — it calls `createShipment`/`trackShipment` rather than re-implementing them, because a second copy of booking logic is how the seller's list and the courier's parcel end up disagreeing; **"ditandai dicetak", never "berhasil dicetak"** — we render the label, we cannot observe the printer (the CRM's "WA dibuka" rule).

⚠️ **Renders, not yet proven to ship.** Production has **0 AWBs**, so `Cetak resi` has had nothing to print — the page, filters and thermal document are verified (1400px, 0 page errors, real facet counts), the *parcel* is not. The remaining tasks are in `BACKLOG.md`; the honest first one is a real end-to-end run once a waybill lands.

### 🧭 Booking overwrote `orders.courier` with a display name — found the first time a booking ever succeeded

`createShipment` persisted `courier: input.serviceName`, so booking an order replaced a perfectly good code (`spx`) with a **display string** (`"SPX Standard"`). `orders.courier` is a **join key** — to `platform_couriers` (which carries `codAllowed` for the COD policy and the `group` behind the 1 day/reguler/ekonomi/cargo filter) and to the per-courier COD return report. `"SPX Standard"` matches none of them, so **every booked order silently dropped out of all of them** — corruption that is invisible precisely because a booked order is the one you stop looking at.

It surfaced the first time `kaCreateOrder` ever succeeded (2026-07-16 — the chain had never run end-to-end before; production had 0 AWBs and 0 `ka_order_id`). Two rows, one already incoherent: courier `"SAP Satria Reg"` carrying **JNE's** service type `REG23`, because the name was written while `service_type` was left behind.

- **Code**: `courier: input.service` (the code the action already receives), and `serviceType` moves with it — the seller may book a *different* service than the shopper picked, and leaving the old type behind pairs one courier with another's service.
- **Migration `0054`** repairs the rows, generically: it resolves **any** courier value matching a service `name` back to that service's code **and its real type**, straight from `platform_couriers`. No hardcoded order numbers — an older image still in flight can corrupt a third row tomorrow and this heals it too. Rehearsed by deliberately corrupting rows locally first: `"SPX Standard"`/`REG23` → `spx`/`1`, 0 left broken.

The booking itself is now **proven end-to-end** against KiriminAja (sandbox): `request_pickup` → `status: true`, pickup `XID-4775140108`. Two things that were only ever comments are now measured facts: **`composePickupAddress` is accepted** (`"Jl. Raya Gubeng No. 42, Kel. Gubeng, 60281"`), and **`awb` comes back `null`** — the waybill does not exist until a courier accepts the pickup, which is exactly why the UI says "resi menyusul" instead of spinning on it.

### 🚚 Orders remember WHICH service was bought — `courier` alone was a coin flip on the buyer's money

`orders.courier` said `spx`. It did not say **which** spx: SPX Standard (type `1`, group `regular`) and SPX Economy (type `3`, group `economy`) are different products at different prices. `/api/public/order` **already knew** — it matches the fresh quote on `courier`+`service_type` — and then threw the type away. The same omission `courier` itself had until `d562ee2`, one level down.

Two things were blocked on it, both of which the user asked for:
- **Auto-booking from the admin** cannot pick the service the *shopper paid for* while it only knows the courier — with two spx services it would be a coin flip on someone else's money.
- **The "1 day / reguler / ekonomi / cargo" filter** is `platform_couriers.services[].group`, reachable only via the service type. Unjoinable before this, so the filter could not exist at all.

Migration **`0053`** adds `orders.service_type`, and checkout now records `rate.type` beside `rate.code`.

**The backfill is DUMMY data, deliberately and temporarily.** 67 of 71 production orders carried **no courier at all** — they are seed fiction either way, and nothing is public yet (0 AWBs, no courier ever booked, no buyer holds a number), so giving them a plausible courier+service makes the demo coherent and gives the new filter something to filter. It obeys the platform's own COD rule (`lib/cod.ts`): COD may only ride **SPX**, the single courier with `codAllowed` — and production already agreed, all 4 COD orders were spx. Everything else is spread deterministically by order number across the enabled non-COD services. ⚠️ Safe **only** pre-launch: once a shopper picks a service, inventing one is fabricating what they chose — the same class of lie as the hardcoded `badge: "7"`. Never rerun on live data.

Rehearsed locally first: 700 orders, **0 NULL**, spread across `one_day`/`regular`/`economy`/`cargo`, and the `group` join resolves.

### 🏷️ One order prefix: `PHI-` — three generators were minting three, and one of them collided with invoices

Every order on the platform now reads `PHI-…`. It was minted by **three** generators with three prefixes for the **same entity**: `WEB-` (`/api/public/order`), `INV-` (seed, the demo store) and `ORD-` (seed, the other stores). A seller's list showed all three and nothing explained why.

Worse, **`INV-` was shared with subscription invoices** (`invoices.number` = `INV-9006`): `INV-4517` was an **order**, `INV-9006` a **bill** — different objects wearing the same badge, in a product where both appear in the same admin. Orders move to `PHI-`; **invoices keep `INV-`**, and the collision is gone.

Migration **`0052_order_number_phi.sql`** renames in place. It is destructive, so it was verified against production *before* being written:
- **Nothing outside `orders` holds a number** — 0 AWBs (no courier has ever booked one), and 0 rows in `platform_activity` / `support_messages` / `conversation_messages` mention one.
- **No suffix appears under two prefixes**, so `PHI-<suffix>` cannot collide with itself (`ORD-8000..8014`, `INV-4765..4821`, `WEB-020451793..202951778F2Y` — disjoint), and `orders.number` is `UNIQUE`, so a collision would abort the transaction rather than corrupt.
- **Rehearsed on the local DB first**: 685 `INV-` + 15 `ORD-` → **700 `PHI-`**, with `invoices` untouched at 16 `INV-`.

Done **now** precisely because nothing is public yet — the user's call, and the right one. After launch a buyer, a courier and an invoice all hold this string, and renaming it stops being a migration and becomes a broken promise. The seed generators moved too: without that, a reseed would mint `INV-`/`ORD-` all over again.

### 🔢 The sidebar's Pesanan badge counted nothing — it was the string `"7"`

`lib/nav.ts` carried `badge: "7"` as a **literal**. It had never counted anything, it was wrong for every store on the platform, and it would have stayed wrong forever — the exact shape of honesty debt this repo keeps digging out: a number that promises a fact it never checked. Ground truth on the demo store was **25**.

- **`getPerluDikirimCount()`** (`lib/data/orders.ts`) — a real `count(*)`, tenant-scoped, using **the same predicate as the `perlu_dikirim` tab** (`status in ('baru','diproses') and financial_status = 'dibayar'`) so the badge and the list it opens can never disagree.
- **`badge: "7"` → `badgeKey: "perluDikirim"`**; the count is fetched **once** in the admin layout and handed to both chrome surfaces (sidebar + the mobile drawer's `NavLinks`) — two copies of the query would be two chances to drift. `NavLinks` stays a client component and never reaches for data itself.
- **The nav item now links to `/pesanan?tab=perlu_dikirim`**, not the full list: a badge that says 25 and then shows you 700 orders is a broken promise the seller has to resolve by hand. "Pesanan Saya" (everything) is still one row below.
- **Hidden at zero** — a badge means "there is work here"; a grey `0` is noise that teaches the eye to skip the row.

Why *paid + unshipped* and not literally "unprocessed": `status in ('baru','diproses')` also contains the **unpaid** ones (the `belum_bayar` tab), and those are not the seller's move — they are waiting on the buyer. A badge counting work you cannot do is a badge that teaches people to ignore badges.

⚠️ **A vocabulary collision this exposed, left alone deliberately:** the Dashboard splits the same 25 into "Perlu dikirim" **15** (confirmed, awaiting shipment) + "Pesanan baru" **10** (unconfirmed), while the *tab* named `perlu_dikirim` means both (25). Same words, two meanings, in one product. The badge follows the **tab**, because that is where it lands — and it cross-checks against the Dashboard's own banner ("Rp 9.048.000 tertahan di **25** pesanan yang belum dikirim"). Renaming one of them is a product decision, not a fix to smuggle in here.

### 🧾 Pesanan on a phone: a table nobody could read → one card per order (`ResponsiveTable`)

A table is a desktop instrument — it trades width for the ability to compare rows down a column, and a phone has no width to trade. Ours degraded by **hiding** the trade rather than making one: the row ran off the right edge inside a scroller, so `audit:responsive` correctly excused it (overflow inside a horizontal scroller is clipped by its box, not the page) while a seller on a 390px screen saw `Pembeli: Thobr…` and a **Total column that was simply not there**. Passing the audit and being unusable are not the same thing.

New **`components/admin/responsive-table.tsx`**: `ResponsiveTable` keeps the real `<Table>` from `md` up and renders **cards** below it; `DataCard` + `DataRow` own the shell (breakpoint, frame, label/value rhythm, whole-card tap target). Pesanan adopts it first — each order is now one card: number + age + status badge + its primary action, the product thumbnails, then `Pembeli`, `Dibayar` (**the total, finally visible**) and `Jasa Kirim` as labelled rows.

The component deliberately does **not** auto-convert a table. A good card has a hierarchy a table does not — one thing to lead with, one number that matters, the rest as detail — and only the screen knows which column is which; a generic converter would emit six equal label/value pairs per row and be uniformly poor. The shell is shared so screens stay consistent; the content stays theirs. Breakpoint is `md`, not `sm`: at 640–767px a six-column table already reads badly even though it fits. Verified: screenshot at 390px, and the audit re-run — **264/264 still clean**.

### 👁️ Looking at the phone, not just measuring it — three defects the overflow audit could never catch

The audit proves one thing: nothing scrolls sideways. It says nothing about whether a screen is *usable*, so the screens got looked at (Playwright, 390px, real session). Three real defects, none of which overflow:

- **Pesanan: the tabs rendered ON TOP of the toolbar.** `<TabsList className="h-9 flex-wrap">` — the height pinned to one row while six counted labels wrapped to three. Invisible on a desktop, where they fit on one line. Now uses the new **`TabStrip`** (`components/admin/tab-strip.tsx`), which is the pattern the four counted strips (Pesanan, Saldo, Blog, Diskon) now share: scroll, never wrap (the trap above), never squeeze (a filter reading `Ra…` is not a filter).
- **A seller could not see their own money on a phone.** The topbar's balance chip was `hidden … sm:flex` — invisible below 640px, on the device they actually run the shop from. It shows at every width now. The bar cannot fit both it and the store name on a 360px phone, so the **name gives way**: a seller knows which shop is theirs, the name is still in this bar's dropdown and the sidebar — the balance was **nowhere**.
- **Dashboard tiles cut their own labels**: `truncate` in a 2-column mobile grid left "pesanan siap dipros…" and "Ulasan perlu diti…". Now `line-clamp-2` — a label you cannot finish reading is not a label. The 5-tile grid also left an orphan half-row; the last tile spans it when the count is odd.

Verified both ways: screenshots at 390px for the eye, and the audit re-run for the machine — **264/264 still clean**, so restoring the balance chip did not re-break the narrow widths it was competing for.

### 📱 The Seller dashboard on a phone: 30 broken route×width combinations → 0, and a gate so it stays that way

The admin had never been checked at phone widths, and "responsive" was an aspiration in the design notes rather than a fact. `apps/admin/scripts/audit-responsive.mjs` (`npm run audit:responsive -w @tokophi/admin`) is the storefront guard's twin — it logs in, sweeps **21 routes × 11 real device widths**, and fails on horizontal overflow, the one symptom that reliably means the layout broke. It found **30 breaks**, and they were only **two root causes**:

- **The topbar, at 320px, on every single screen** (24 of the 30). The row is `px-4` + Menu + store switcher + a 116px right cluster, and the store name's `max-w-[140px]` pushed it 40px past the viewport. The name now hides **below 360px only** (`max-[359px]:hidden`) — the 2-letter badge still identifies the store, the full name is one tap away in the same dropdown, and every phone people actually use (360/390/414) keeps it. `min-w-0` lets it truncate before it pushes.
- **`TabsList` strips whose labels carry counts** (6 of the 30): Saldo 452px (broke 360/390/414), Blog 388px (360/390), Diskon 372px (360). They now **scroll** instead of squeezing — the same rule as the storefront gallery, and exactly what the audit excuses. A category label crushed to `Ra…` is not a filter, and a landmark you cannot read is not a landmark. Fixed per-screen rather than in the shared `TabsList`: its triggers are `flex-1`, so an `overflow-x-auto` on the primitive would make them *shrink* instead of scroll, and it is used across both apps with no audit covering super-admin — the wrong place to be clever.

Verified by re-running the audit against a local build of the fix: **264/264 combinations clean**.

### 🚧 Self-serve signup is CLOSED while the platform is in development

New sellers can no longer register themselves. The gate is `SIGNUP_ENABLED` (unset = closed) and it **fails closed**, same posture as `authSecret()` — a forgotten env var can never quietly re-open the front door. It is enforced inside **`provisionStore()`**, the one function BOTH self-serve paths funnel through (`/daftar`'s `registerStore` **and** the Google OAuth callback's auto-provision) — closing only the page would have left the server action and the OAuth callback happily creating stores, which is the whole difference between a hidden control and a closed door. `/daftar` now explains the pause and links to `/login`; the Google callback redirects there instead of 500ing on the thrown `SignupClosedError`. **Signing in to an existing store is untouched**, and so is **super-admin's `createStore`** — a different path, so we can still onboard a merchant by hand. Re-open with `SIGNUP_ENABLED=true` + redeploy.

### 📦 The pickup address the rider actually reads — the kelurahan a seller picked was going nowhere

Pengaturan → Alamat Pengirim gained a kelurahan picker, but the value it captured **never reached the courier**, so the precision the field exists for was still thrown away:
- `sender_kelurahan_id` is deliberately left NULL (KiriminAja numbers kelurahan in their own scheme; writing our Kemendagri code there would be "wrong data wearing the costume of right data"), so `kelurahan_id` was never sent — correct, and
- `senderKelurahanName` was **not written into the address** either, despite the comment saying that was the plan. `kaCreateOrder` sent `address: s.senderAddress` raw.

Now `composePickupAddress()` (`lib/pickup-address.ts` — pure + client-safe, so there is exactly ONE implementation) builds the one string the rider reads — `Jl. …, Kel. …, 60281` — and the booking sends that. The card also gained a **Ringkasan alamat jemput**: the shopper gets an address summary at checkout, so the seller gets the same — rendered from the *same* function the booking uses, so what the rider will read is on screen rather than taken on trust. **Kode pos joins it** (migration `0051` → `store_settings.sender_postcode`): it is **not typed**, it follows the kelurahan the seller picks, is normalised to 5 digits (an odd value is dropped, never blocks the save — same rule as the sender phone), and is shown read-only under the picker. ⚠️ Grounded, not assumed: **`KaSender` has NO zipcode field** — `request_pickup` takes the sender's `kecamatan_id` (+ optional `kelurahan_id`) and a free-text `address`; `destination_zipcode` is the **buyer's** and was already wired from `orders.ship_postcode`. So the postcode only reaches the rider by riding in that address string — which is exactly what gives the new column a reader instead of making it another dead `sender_lat`/`sender_lng`.

### 🔗 Custom domain: the Shopify primary model + a beginner-proof DNS tutorial + a locked-domain ticket path

Refined the domain flow to the exact model a merchant expects:
- **One root + one www, and one is primary.** `addDomain` now caps by *kind* (`domainKind`): a store attaches at most one root/apex host and one `www.` host — a second of the same kind is refused. The seller marks one **Utama**; the storefront middleware now **301s every other host to it** — the non-primary of the root/www pair AND the `<slug>.tokophi.id` subdomain — GET/HEAD only, skipping `/api/*`, so there is never a duplicate storefront and old links still resolve. (No active custom domain → the redirect is a no-op, today's state.)
- **DNS records spelled out for non-technical sellers.** Each record now shows **Tipe · Nama/Host · Nilai** as separate copy fields, and the Name is made explicit — `@` (or empty) for the root domain, `www` for the www one, `_tokophi-verify` / `_tokophi-verify.www` for the TXT — the single thing beginners get wrong. Example host copy changed to `namadomaintokomu.com` for clarity.
- **A verified domain is locked; changing it goes through a ticket.** Once a domain reaches `provisioning`/`active` (ownership proven) the seller can no longer self-serve delete it — `removeDomain` refuses, and a new `requestDomainChange` opens a **support ticket** (super-admin acts). Protects a live storefront from being detached on a whim while keeping a clear, tracked path.

### 🔎 Super-admin: no privileged mutation is silent anymore (BACKLOG SEC-11)

An unlogged privileged mutation is indistinguishable from an attack, and five super-admin actions mutated and wrote **nothing** to `platform_activity`. Now they all do (`logStore` for store-scoped, `logPlatform` for platform-wide): `setInvoiceStatus` (**money** — a hand-flip to "dibayar" extends a store's paid period without a payment, so it is logged with the store + status), `setStoreUserRole` (a **privilege change** — promoting a user to `owner` grants owner-only powers; logged with the user's email + new role), `saveGateways` and `saveCodAllowed` (**platform payment / COD risk policy** — logged with the diff), and `createStore`. They join `invitePlatformAdmin` (logged the day before) and the add/remove/reset-user + payout actions that already logged. `tsc` clean; behaviour otherwise unchanged. No silent privileged mutation remains among the store-lifecycle / billing / settings actions.

### 🗑️ Deleted the dead `POST /api/public/pay` — an unauthenticated bill-minting endpoint called by nothing

It took the `amount` **from the request body** and created a real VA/QRIS bill via AutoLaris, with no auth, no order verification and no store scoping — the same "the browser decides the number" class the checkout was hardened against, on a route anyone could POST to. Nothing called it: no storefront source read `PUBLIC_PAY_API`, and the real flow creates the payment **server-side inside `/api/public/order`** with the server-computed amount. Removed the route file and the dangling `PUBLIC_PAY_API` from `.env.example`. **`/api/public/pay/callback` (the live AutoLaris callback) is untouched** — a different route, still needed.

### 🔑 `AUTH_SECRET` can no longer silently fall back to a public dev key in production

Every session JWT, impersonation token, recovery link and abuse hash was signed with `process.env.AUTH_SECRET ?? "dev-insecure-secret-change-me"` — so an unset secret in production would sign everything with a **public** string, making every session forgeable, silently. New shared `@tokophi/lib/secret` (`authSecret()` / `authSecretBytes()`, dependency-free so it is edge-safe for middleware) **fails CLOSED**: in production a missing or too-short `AUTH_SECRET` **throws**; only in development does it return the well-known dev key (dev data is disposable). Wired into all 8 call sites across the three apps. The throw is **lazy** — it fires when the key is first *used* at runtime, never at module load — because `next build` / `astro build` run with `NODE_ENV=production` but WITHOUT the runtime `AUTH_SECRET` (it is a runtime `environment:` var, not a build arg), and a load-time throw would break every build. Verified: an import-only load does not throw; a call in production-without-secret does. Production already sets a 64-char `AUTH_SECRET` (checked in all three containers), so runtime behaviour is unchanged — this only removes the silent forgeable-key path.

### 📦 Checkout completeness: the order records its courier, and the weight fallback is no longer silent

- **`orders.courier` is recorded at checkout.** `/api/public/order` now writes `courier: rate.code` — the courier of the fresh server-side quote it matched (never the client's raw claim; a service not in the quote already rejects the order). This is what the entire COD policy was betting on: the per-courier return-rate report is now a `group by courier` instead of an impossibility (700/700 orders had a NULL courier). Existing rows stay NULL; new checkouts populate it.
- **The 500 g weight fallback is now visible on the Seller's Produk list.** The server already sums `product_variants.weight_grams` for the ongkir quote (a variant with no weight falls back to 500 g); that fallback was silent. `getProducts` now flags each product with a weightless variant (`bool_or(weight_grams is null)`) and the Produk list shows an amber **"Berat belum diisi"** on it (grid + table) — "a silent fallback is the same lie in a smaller font". Also fixed a source comment in `shipping-weight.ts` that claimed this warning already existed when it didn't.

### 🚪 Login is rate-limited on both panels

Neither the merchant nor the operator login capped attempts — an unmetered password-guessing surface on both. `signIn` now rate-limits by client IP (`cf-connecting-ip` → `x-forwarded-for`) via `@tokophi/lib/cache`, **before** the scrypt check runs: the merchant panel at 15/min, the super-admin control plane a touch tighter at 10/min. It is in-process (does not survive a restart or span replicas — the same limitation as every rate limit here, and the Cloudflare-edge move is still tracked), but far better than the previous NONE, and generous enough not to lock out a NAT'd office on a few wrong passwords.

## 2026-07-15

### 🌐 Custom domain for a merchant — built, deployed, and honest about where it stops

A merchant can attach their own domain to their storefront. **Slices 1–3 are live on production**; slice 4 (a shopper actually served on the domain over TLS) is blocked on a platform decision and the UI **says so** rather than pretending.

- **Migration `0050` `store_domains`** (+ RLS): a domain is a *process*, not a value — states `pending → verifying → provisioning → active → error`, `UNIQUE(host)` across the whole platform (a host claimed by one store is refused for every other by the DB, not by an app check that could be forgotten), and a partial unique index on `(store_id) WHERE is_primary` makes two primaries impossible.
- **The storefront already resolves it.** `slugFromCustomDomain()` maps an `active` host → the store; `StoreInfo.primaryHost` + `primaryOrigin()` route every canonical / `og:url` / sitemap URL to the primary host, so switching a store's primary from its `<slug>.tokophi.com` subdomain to a custom domain is centralised in one function. A subdomain-only store keeps returning its request origin unchanged.
- **Admin UI — Pengaturan → Domain** (`DomainCard`, `settings:write`, all writes under `withTenant` so RLS is the tenant boundary): add a domain, copy its CNAME + TXT records, and **verify ownership for real** via `node:dns` `resolveTxt` (ENOTFOUND/ENODATA → "DNS belum terbaca", a normal state, not an error). Remove, and set-primary (only an `active` domain can be primary).
- **The honest stop.** Verifying ownership does **not** make the domain live — a TLS cert for a custom hostname is Cloudflare-for-SaaS territory and is **not built**. So a verified domain rests at `provisioning` and the UI shows "Menunggu aktivasi — sertifikat sedang disiapkan"; it does **not** offer a control to flip it to `active`, because the platform cannot yet serve a cert for it. A control must not claim what the system cannot do.

### 📞 Per-store WhatsApp + tagline — the shared dummy number is gone

- **Migration `0049`** added `stores.whatsapp` + `stores.tagline` (both nullable) and **removed `DEFAULT_WHATSAPP = "6281234567890"`** from the storefront. The canonical Indonesian dummy number used to ship as a live "Hubungi via WhatsApp" button on **every** store — a control that reached nobody. Now: no number → **no button** (honest), the merchant's own number → their button. (The migration's demo-number backfill was **removed before deploy** — on production, where `migrate` runs but `seed` does not, it would have put a fake live number on a real storefront.)
- **Pengaturan → Profil is a real editor now** (`StoreProfileCard` + `saveStoreProfile`). It was cosmetic — hardcoded `defaultValue`s including a placeholder WhatsApp `+62 812 3456 7890`, no save wiring, plus email/address/currency fields with no column behind them. Replaced with the fields that have a column *and* reach a shopper: name, tagline (storefront meta description + footer line), WhatsApp (normalised `08…`/`+62…` → `62…`; cleared = button removed, a valid action). The fake fields are dropped, not kept as fields that lie. Proven full-circle in a browser: set `0812 9000 1234` in admin → stored `6281290001234` → the storefront button becomes `wa.me/6281290001234`; a store with no number shows none.

### 🚀 Merged to `main` + deployed to production, validated

The day's storefront-honesty + checkout + custom-domain + WhatsApp work shipped to `tokophi.com` via a fast-forward `main` push + Coolify redeploy. **Two production landmines defused before deploy:** (1) `_journal.json` timestamps had to be monotonic or drizzle **silently skips** a migration → `stores.whatsapp` never created → storefront 500; verified monotonic. (2) the demo-WhatsApp backfill above. Validated in a real browser on `batik-nusantara.tokophi.com`: every key page HTTP 200 (so 0049/0050 applied cleanly), the "Kirim ke" checkout summary + og:image + per-tenant sitemap live, the dummy number gone, a full checkout money-path drive passed with **0 console errors**.

### ✅ First real test coverage on the money/checkout boundary, + two security gates verified closed

- **47 tests, up from 1 file.** `packages/lib/src/validate.test.ts` exercises the checkout input boundary — phone normalisation (every shape `08…`/`8…`/`+62…`/`62…`/`620…` → canonical `62xxx`, the deliberate **no-operator-prefix** rule proven by a valid unusual prefix, landline/too-short/too-long rejected), plus name / email (optional, no domain whitelist) / address / kodepos / dest_id. `billing.test.ts` exercises the subscription math — PPN base↔total round-trip, the Rp50rb-first-month promo + the annual bonus month, and the full `trial → active → past_due → suspended` lifecycle incl. VIP/comped and the 3-day grace staying writable.
- **The COD gate is now tested — "the ONE place that answers may this order be paid on delivery?".** Its decision logic was extracted from `apps/admin/lib/cod.ts` (which loads three rows from the DB) into a **pure** `apps/admin/lib/cod-policy.ts` (`buildCodPolicy`) — the same split as `rbac-policy.ts` (pure matrix) vs `rbac.ts` (server enforcement). `cod-policy.test.ts` then exercises all five conditions with fixtures: the platform/store switches, the cap (incl. a missing/negative total, which must reject rather than assume), the free-text province allow-list + its honorific-stripping normalisation, the SPX-only per-service allowance (JNE reports `cod:true` but is `codAllowed:false` → refused), and disabled/instant/legacy-string couriers. Behaviour-identical refactor: `getCodPolicy` is unchanged for its three importers (`/api/public/order`, `shipping-quote.ts`, `actions/shipping.ts`); `tsc --noEmit` clean.
- **The ledger and the order state machine are now tested against a real Postgres — 63 tests total (was 1).** `apps/admin/lib/ledger-credit.test.ts` runs each case inside a transaction that is ALWAYS rolled back, against a throwaway DB (gated on `TEST_DATABASE_URL`; the suite skips without it, so plain `vitest run` stays green; never the shared dev DB). It proves the invariants that live *below* the type system: a sale is booked only for a collected (`berhasil`) payment, at `amount_idr` not `total`, `pending`/`available` by order status; **"double-credit is a DB impossibility" is proven** — a second raw sale insert is rejected by the `ledger_one_sale_per_payment` unique index, not by app code; COD is collected at the door; release honours `platform_payout.release_on`; and the `retur` claw-back is an opposing entry that nets to zero, carries the sale's status (a pending sale reversed out of pending, so the withdrawable balance can never go negative), and is idempotent (`ledger_one_retur_per_order`). For the state machine, `applyOrderStatusChange` was extracted from `setOrderStatus` (so it is callable — same seam as `settleOrderLedger`) and tested to restore stock on **batal AND retur**, refuse to double-restore (guarded on the previous status), and fail a still-pending payment. All extractions are behaviour-identical; `tsc` clean. This closes BACKLOG top-five #5.
- **Two BACKLOG top-five security items verified already CLOSED in code (docs were stale).** `invitePlatformAdmin` is now `owner`-gated with a whitelisted role and an audit-log entry — an `admin` can no longer mint themselves an `owner` (the escalation the top-five warned about). `billing.ts` `createSubscriptionPayment` / `cancelSubscriptionInvoice` now call `requireCapability("settings:write", { allowSuspended: true })` — a `gudang` user can no longer raise or void the store's subscription invoice, and a suspended store can still pay its way back in. STATUS/BACKLOG reconciled.

### 🩺 L1 self-healing watchdog — live on the VPS (BACKLOG P1.8)

The first witness for the outages of 2026-07-14, when production 503'd three times and each was found only because a human happened to look. `ops/tokophi-watchdog.sh` is installed at `/usr/local/bin/tokophi-watchdog.sh` and runs **every minute** from `/etc/cron.d/tokophi-watchdog`. It `docker start`s any of the 4 app containers (`admin`, `super-admin`, `storefront`, `landing`) found in `created`/`exited` — that is exactly failure shape #1 (Coolify built the containers, left them `created`, moved on), whose recovery was a plain `docker start`, now automatic with no human awake. **Deliberately narrow:** it never touches `postgres`/`backup`/`coolify`/`cron`, and never `migrate` (which is *supposed* to sit at `exited (0)` — starting it re-runs migrations); it acts only on `created`/`exited`, leaving a `running`-but-unhealthy or `restarting` crash-loop to L2/L3. No credentials, no network. It lives on the **host**, not in a container, so it survives a bad deploy — the one time you need it most. Writes `/var/run/tokophi-watchdog.last` every run as a liveness signal (the log stays quiet on a healthy box). **Proven end-to-end:** `docker stop landing` → the watchdog brought it back to `running` + HTTP 200 with a `HEAL` log line; cron firing confirmed via the heartbeat advancing and syslog. Still open (BACKLOG P1.8): L2 off-box probe + L3 Coolify deploy-failure alarm + an alert channel — blocked on the user's Telegram/SMTP decision.

## 2026-07-14

### 🔒 Checkout: the browser no longer prices the order, and no longer decides what a valid customer is

**The ongkir is re-quoted server-side.** `/api/public/order` wrote `orders.shipping_idr` from whatever the client posted, so `shipping: { cost: 0 }` created an order with **free shipping** — and the merchant still paid the courier the real amount. The weight fix closed lying about the *input*; this closes lying about the *output*. `apps/admin/lib/shipping-quote.ts` is now the **one** function that produces a shipping price: `/api/public/ongkir` and the order API call the same code (seller's pickup origin ∩ platform couriers ∩ the merchant's per-service selection, weight summed from `product_variants.weight_grams`), and the order stores **the price the server computed for the service the shopper picked**. The client's number is not compared against ours — it is ignored, and the field is gone from the storefront payload. A picked service that is not in the fresh quote → **the order is rejected**, never silently moved to a different courier. ⚠️ Consequence: an order can now fail because KiriminAja is down. That is deliberate — a parcel we cannot price is a parcel we cannot ship, and the alternative is trusting the browser again.

**The item prices too** — same hole, bigger: `items[].price` was summed into `orders.subtotal_idr` and every line item, so a posted `price: 0` bought the goods for nothing. Prices, titles and the variant now come from `product_variants`; an unknown or archived handle is refused.

**Input validation + normalisation (BACKLOG P2.0)** — `@tokophi/lib/validate`, shared by the API (the boundary) and the checkout form (UX only). **Normalise generously, reject narrowly:** over-validation is itself a bug — a rule that rejects a real name, a new carrier prefix or an unusual address costs a sale and nobody ever finds out.
- **WhatsApp → canonical `62xxx`.** `0812…`, `812…`, `+62 812-…`, `62 812…`, with any spaces/dots/dashes, all normalise. Validation is **structural** (after `62` it starts with `8`; national part 9–12 digits) — deliberately **no operator-prefix table**, which would one day refuse a real customer holding a brand-new prefix, silently and permanently. Normalised on write from every path (order API, abandoned-cart capture, chat, the seller's pickup phone) and **backfilled** by migration `0048` (customers 26/26, `orders.ship_phone` 687/687, + leads/followups/wa_messages/chat_visitors/customer_addresses). `waLink()` normalises too: `wa.me/08124612804` never opened a chat — WhatsApp needs the country code.
- **Email: shape only, optional, no domain whitelist.** There is no mailer in this repo, so we never claim to send anything — and a gmail/yahoo allow-list would reject corporate, university and self-hosted addresses, i.e. the higher-value buyers.
- **Nama:** letters (diacritics included), spaces, `.` `'` `-` — `Nur'aini`, `M. Rizky`, `Siti Aisyah binti Abdullah` all pass. Digits and symbols are refused.
- **Alamat:** letters **and** digits (house number, RT/RW are the point) plus ordinary punctuation; only obvious junk is refused (emoji, control chars, one repeated character, under 10 chars).
- **Kecamatan: not character-validated at all.** It is picked from a list, so the real rule is that the `dest_id` **resolves in `kiriminaja_areas`** — the id the parcel is booked against. Kota + Provinsi are now **derived from it**; the typed values are ignored (they were a claim the COD gate already refused to trust).
- **Kode pos:** 5 digits, optional — stays typeable for the ~4% of districts with no kelurahan data.

Proven in a real browser with a real shopper UA (a normal order still goes through: SPX Standard Rp13.700, total Rp133.700, COD, `0812 4612 806` stored as `628124612806`), and at the API: `shipping.cost: 0` + `price: 1` → order written with **Rp13.700 ongkir and Rp240.000 of goods**; junk name / fake phone / landline / bad email / `-` address / 4-digit kodepos / non-existent `dest_id` / a service we never quoted → all rejected with a Bahasa message the form never had to see.

### 🛍️ Storefront: the pages that had no route, the menu that ignored the merchant, and a phone layout that broke

**Content that was published and unreachable.** The DB held **6 articles and 6 pages, all `terbit`** — written in the admin's Blog/Halaman editors — and **not one was reachable by a shopper**. `/blog` was a *fake*: 4 articles hardcoded into the `.astro` file, illustrated with product photos, every card `href="#"`. It never touched the database. `/blog/[handle]` and `/halaman/[handle]` did not exist at all. Now: `src/data/content.ts` (short-TTL cached, per tenant) + a Medium-shaped article page (3:2 feature image, share to Facebook/X/Pinterest + copy link) + CMS pages, linked from the footer. **Publication is a boundary, not a filter**: every query hard-filters `status='terbit'`, so a draft **404s** rather than leaking to a guessed handle. Proven: draft article and draft page both 404; Batik Nusantara's article requested via `Host: kopi-senja` → 404.

Deliberately **not** copied from Medium: clap/comment counters. `articles.comments` exists and is seeded (8, 12, …) but **there is no comment system** — a count nobody can open promises a feature that does not exist.

**The nav ignored the merchant.** The header menu was a hardcoded copy of `@tokophi/data/menu`; the file admitted it ("Live 'edit in admin UI → storefront' still needs the backend"). That backend has existed for months — the Navigasi editor writes `menus`/`menu_items` — and the storefront simply never read them, so **a merchant reordering their menu saw nothing change**. `getMainNav(storeId)` now reads the tenant's own tree (static menu kept as the fallback for freshly provisioned stores). Proven by editing a label in psql and watching the storefront follow. The footer follows the merchant's `footer` menu too — **but drops items whose page is not published**: the seeded menu links to *FAQ*, which is a draft, and honouring it verbatim would have put a 404 on every page of the shop.

**Mega menu.** The panel was centred on its own trigger, so a 62rem panel anchored to a word sitting far right hung off the left edge of the screen; it now anchors to the header container. Two behaviour bugs fixed with it: click-to-close did nothing (the CSS `:hover` rule outranked the class the JS removed), and the trigger→panel gap was *outside* the hover target, so moving the pointer into the panel closed it. Contents are real per-tenant catalog data — thumbnail + live product count per category, "Segera hadir" for an empty one, rather than sending a shopper to a blank grid.

**`/kategori/produk-terlaris` 404'd** — and it was a real bug, not a typo: `catalog.collections` is built from a 6-handle allowlist, so a collection that *exists in the DB* could not be found. The hero's own default CTA ("Lihat Produk Terlaris") shipped pointing at it.

**Checkout.** Kecamatan now drives the address: pick it and **Kota + Provinsi fill themselves** (readonly, so they cannot drift). This is not only convenience — `lib/data/areas.ts` already says a typed province is *a claim, not a fact*, and the COD gate derives the province from the district id precisely because a shopper could type "DKI Jakarta" and have the parcel go to Papua. Deriving the visible fields from the same id closes the gap in the UI too. **Kelurahan → kodepos** is new (below). Required fields marked; **email and kodepos are now optional** — the order route already accepted both empty, so the form had been *stricter than the system behind it*. And `required` on a **readonly** input is inert (the spec bars readonly fields from constraint validation), so the form could be submitted with **no destination at all** — enforced properly in the submit handler now.

**Cart** rebuilt Shopify-shaped: line items + a **sticky** summary (the checkout button never scrolls out of reach), product titles finally clickable, decrement-to-zero removes the line. No "spend Rp X more for free shipping" bar — **there is no free-shipping threshold in our data**, and the bar would have invented a promise checkout would not honour.

**Emoji → Lucide** across the whole storefront (0 emoji in rendered HTML, 7 pages checked). Emoji render as OS-coloured glyphs that ignore the brand palette and differ per device; a stroked icon inherits `currentColor`. Testimoni had been building its star rating out of **text `★`** — it now reuses the existing SVG `<Stars>`.

### 📮 Kelurahan → kodepos: the postal code cannot come from the kecamatan (migration `0046`)
A kodepos is assigned **per kelurahan**, not per kecamatan. 83% of kecamatan happen to have exactly one — but the other **17% are the dense urban ones where the orders are** (Kecamatan Semarang Tengah alone spans **11** kodepos). So it cannot be derived from the district the shopper picks for ongkir, and guessing one puts a wrong number on a real parcel.

New `kelurahan` table (**78,764 rows**), built by `packages/db/scripts/build-kelurahan.mjs` from the Kemendagri datasets (`cahyadsn/wilayah` + `wilayah_kodepos`). **The join is the hard part**: ongkir is quoted against a *KiriminAja district id*, the dataset is keyed by *Kemendagri codes*, and the two share no key — districts are matched by name **within the same city** (exact → KiriminAja's parenthetical aliases → tight bigram similarity), which keeps the search space to a dozen names rather than seven thousand. **95.8% of KiriminAja's 7030 districts resolve**; the remaining ~4% emit **no rows on purpose** and the checkout falls back to a typed kodepos for them. Verified end-to-end (Semarang Tengah → 15 kelurahan → kodepos fills) *and* on the degraded path (Dumoga Tengah → picker hidden, kodepos typable).

⚠️ KiriminAja's `destination_kelurahan_id` **cannot** be filled from this: it expects *KiriminAja's own* kelurahan id, and we hold Kemendagri codes. Only `destination_zipcode` is ours to send.

### 📱 Mobile: auto-zoom on every input, and a chat panel you could not close
- **iOS Safari zooms the page whenever a focused control's font-size is under 16px**, and never zooms back. Our fields were 14px (`text-sm`) — so **every checkout field and the chat composer** dumped the shopper into a zoomed, sideways-scrolling page mid-purchase. Fixed via **font size**, not the viewport: `user-scalable=no` "works" by disabling pinch-zoom for everyone (an accessibility failure) and iOS has ignored it since iOS 10. A specificity trap only measurement caught: the first rule fixed every `<input>` but left the address **textarea** and kelurahan **select** at 14px, because a bare element selector loses to `.input-field`.
- **The chat panel measured 587px tall at `y = -11` on an iPhone** — its header, and with it the **close button**, sat off the top of the screen: a shopper could open the chat and not get out. The message list now gives instead of the panel growing. `dvh`, not `vh`: on mobile the URL bar shows/hides and `vh` is frozen to the largest height, so a `vh`-clamped panel still overflows.

### 📐 Responsive locked down — `npm run audit:responsive -w @tokophi/storefront`
Sweeps **10 routes × 11 real device widths (320 → 1920) = 110 combinations** and fails on any horizontal overflow. Horizontal overflow is the one symptom that reliably means *the layout broke*, it is invisible in a screenshot at a single width, and it is exactly what a shopper feels on a phone. It caught two genuine breaks on the PDP gallery that the eye had missed — both classic CSS sizing traps:
- `flex-1` inside a **`flex-col`** sizes the *height*; the width then fell out of `aspect-[3/4]` and grew past the screen.
- below `md` the layout grid had **no explicit template**, so its single column was an *implicit `auto` track* — and an auto track is sized from its **content**, free to exceed the container. The thumbnail strip (5 × 64px + gaps = **368px**) duly pushed a 360px phone sideways. `grid-cols-1` (= `1fr`) is bounded by the available space; `min-w-0` releases the grid item's default `min-width: auto`.

Also: `RevealGrid` ("Muat lebih banyak") shows 3 rows and reveals 3 more — the limit is **computed from the grid's resolved column count**, so "3 rows" means 6 items on a phone and 12 on a desktop without the component knowing either number. Nothing is hidden server-side (the storefront is SEO-first and ad-landed, so a crawler still sees the whole grid).


### 📍 Ongkir is priced from the seller's pickup address — it wasn't, and the shopper was choosing the origin (`a68f7af`)
The pickup address (Pengaturan → Alamat) was **NULL on every column**, and the rate endpoint never read it anyway. Origin came from `resolveArea(body.originCity || "Yogyakarta")` — a **city name posted by the shopper's browser**, fuzzy-matched to whatever district came back first, with a hard-coded Yogyakarta behind it. Two bugs in one line, both of them money:
- **The seller's real warehouse was ignored.** A merchant shipping out of Surabaya quoted **Yogyakarta** rates on every order, while the courier collected the parcel from an address that had nothing to do with the price. Wrong in both directions, silently, forever.
- **The origin was client-supplied.** An untrusted string decided a price; a script could post any city and take the ongkir it liked. Same family as the COD province gate that was bypassable by typing a false city — **a fact the client asserts is not a fact**.

`sender_kecamatan_id` **is** a KiriminAja district id — the same currency as the shopper's `destinationId` — so the origin needs no resolution and cannot be guessed at. It is now read straight from the saved pickup address; `body.originCity` is **ignored entirely**. No pickup address → fall back to the store's *registered* city (still the shop's data, never the shopper's) and **say so** (`originFrom: "store-city"`), because a quote built on a fuzzy match is a guess and a guess must be visible as one. Seeded: **Gudang Batik Nusantara, Jl. Raya Gubeng No. 42 — district 6138, Gubeng, Surabaya** (+ lat/lng, also NULL, so same-day pricing had been falling back to hard-coded Yogyakarta coordinates too). The warehouse deliberately sits in a different city from the registered shop address: gudang ≠ kantor is normal here, and it makes a rate computed from the wrong origin *visible* instead of accidentally right.

**Proven, not assumed** — Surabaya → Coblong/Bandung, with the request deliberately posting `originCity: "Jakarta Pusat"`:
- `originFrom=pickup`, `origin=6138` — **the injected city was ignored**
- **the prices MOVED**, which is the whole point: SPX Standard Rp17.000 → **Rp17.700**, SPX Economy Rp12.700 → **Rp10.400**. The origin genuinely feeds the price; it is not merely stored.
- **the storefront agrees with the server, 8 of 8**: every price rendered on `/checkout` was compared against the API response in the same run — exact match, `originFrom=pickup`, 0 console errors. COD still SPX-only (pick a non-COD courier → "Bayar di Tempat" disappears; pick SPX → it returns).

⚠️ **The rates are real KiriminAja API calls, but `KIRIMINAJA_ENV` is `sandbox`** (`tdev.kiriminaja.com`, not `client.kiriminaja.com`). The numbers are genuine responses and genuinely origin-driven — they are **not production tariffs**. Flipping that env is the last step between this and real money, and an unset env in production silently talks to sandbox (STATUS #10).

### 🚚 COD is ON, end to end — and the checkout was ignoring the seller's shipping choices (`35b88a4`)
**COD now works from the seller's switch to the shopper's door.** Three things must agree, and they do: `platform_cod.enabled = true` with a **Rp2.000.000** cap and **6** allow-listed provinces (DI Yogyakarta, Jawa Tengah, Jawa Barat, DKI Jakarta, Banten, Jawa Timur) · `platform_couriers.services[].codAllowed` = **SPX only** (SPX Standard `type=1` + SPX Economy `type=3`; every other courier is `codAllowed=false` even where KiriminAja reports `cod=true`) · `store_settings.cod_enabled = true` for Batik Nusantara (default is **false**, migration 0038 — a merchant opts in). The five-condition gate in `apps/admin/lib/cod.ts` remains the single source of truth, and `/api/public/order` still **rejects** a COD order that fails any of them — the UI is UX, that endpoint is the boundary.
- **Seller side** (it existed; it had simply never been switched on): Pengaturan → **Pengiriman** → card **"Bayar di Tempat (COD)"** ("Tersedia lewat Shopee Express (SPX)."), and below it every Jasa Kirim row states its COD status — a green **COD** badge + "Mendukung COD — aktifkan COD di atas." on the two SPX services, "Tidak mendukung COD." on the rest (`components/admin/pengaturan/jasa-kirim-card.tsx`; `getCodEnabled`/`setCodEnabled`/`getStoreServices`/`saveStoreServices`).
- **Shopper side**, verified in a real browser (0 console errors): 10 shipping options render for a chosen destination and **only SPX Standard (Rp17.000) and SPX Economy (Rp12.700)** carry the COD badge. Pick AnterAja → "COD (Bayar di Tempat)" is absent from Pembayaran; pick SPX → it appears. The `cod` flag on a rate is the **effective** one (KiriminAja capability × platform per-service allowance × this store's `cod_enabled`), never the raw courier capability.

**The bug found on the way — a broken promise.** The Jasa Kirim card tells the seller *"Pilih layanan yang ditawarkan ke pembeli saat checkout"* and writes each pick to **`store_shipping_methods`**. `/api/public/ongkir` filtered on a **different column** — `store_settings.couriers`, the COURIER-level list — so **every service the seller had switched OFF was still offered at checkout**. The per-service table exists precisely because a courier-level list cannot express "I ship JNE Reguler but not JNE YES"; the admin moved to it and the storefront never followed. Measured on the live endpoint (Batik Nusantara, 11 services picked): **14 rates came back, 4 of them never enabled by the seller — Jagopack, Sicepat CARGO, BIGPACK, SAP One Day. After the fix: 10**, exactly the picked set KiriminAja prices for that route. The filter is now **(platform-enabled couriers) ∩ (merchant's per-service picks)**, keyed `"<courier>:<service_type>"` because a service_type is only unique within its courier. **No rows = the merchant never opened the card → fall back to courier-level**, rather than render a checkout with zero shipping options.

**And the fix that only held until someone re-seeded (`540af0a`).** Switching COD on writes `store_settings.cod_enabled` — but the seed inserted `store_settings` with **no `cod_enabled` at all**, so it fell back to the column default (FALSE, 0038): the next `npm run seed` silently switched COD back off and took a business decision with it. `store_shipping_methods` was **never seeded either** — zero rows, which `/api/public/ongkir` (correctly) reads as "the seller never opened the card" and answers with the courier-level fallback. So the hole `35b88a4` had just closed **reopened on every clean clone**, Jagopack and BIGPACK and all. The seed now *encodes the decision* instead of hoping the database remembers a click: Batik Nusantara ships with `cod_enabled: true` (the other six demo stores keep the default OFF — that keeps the toggle meaningful rather than decorative) and with all **11** services of every platform-enabled courier, both SPX among them, so COD is exercisable on a fresh database with no API key and no hand-clicking. Verified against a **forced re-seed**: `codAllowed` couriers = `spx` · `cod_enabled` = true · 11 merchant services (`spx` type=1 + type=3) · `/api/public/ongkir` → 10 rates, `cod=true` on the two SPX services only.

- ⚠️ **Still open, and stated rather than buried:** the **"SPX free return" claim is UNVERIFIED** and the entire SPX-only policy rests on it (it is a *Shopee Seller Center* benefit; we reach SPX through *KiriminAja*, a different contract whose API has no return field at all — one email settles it) · `orders.courier` is NULL on **~699/700** rows, so the **per-courier COD return rate — the metric this policy optimises for — cannot be computed**: the policy is a bet with no scoreboard · `platform_cod.fee_pct` is still **0** and read by nothing, and it is the lever that would open COD beyond SPX.
- 🎓 **`astro check` passes clean on bugs inside a client `<script>`.** A `ReferenceError: queueSave is not defined` in `checkout.astro` blocked the **entire rate load** — no rates → no COD → **no order at all** — while typecheck, lint and build were all green. Only running the page in a browser caught it. Same family as the `requestPayout()` `FOR UPDATE` bug: **money and checkout paths must be EXERCISED, not typechecked.**

### 🛒 Abandoned checkouts were not recorded AT ALL (migrations `0044` + `0045`, `d7fc92f`)
The largest pool of nearly-made sales in the product was invisible: there was **no cart table**. `checkout_sessions` now captures it — and the storefront writes the row **as the shopper types** (debounced beacons → `apps/storefront/src/pages/api/checkout-session.ts`), because **there is no "abandon" event to listen for: abandonment is the ABSENCE of an order.** A session that stops updating and never becomes one *is* the abandonment. An opportunistic sweep flips `aktif` → `ditinggal` after **60 minutes** of silence and stamps `abandoned_at`.
- **`0045` (`abandoned_at`) exists because a straight-through checkout ALSO ends as `pulih`.** Without it, a cart that sailed through and a cart that was genuinely **rescued** are indistinguishable afterwards — the naive `pulih/(pulih+ditinggal)` renders a **19,3%** "recovery rate", telling a shop it rescued every ordinary sale. Rescued means `abandoned_at IS NOT NULL AND recovered_at IS NOT NULL`. **A number that looks real and is wrong is worse than no number.**
- **The two rates on screen** (30-day window, `aktif` excluded from both sides — nobody has abandoned anything yet, the shopper is still typing): `abandonRate = ditinggal / (ditinggal + orders)` = **80,0%** · `recoveryRate = rescued / (rescued + ditinggal)` = **11,2%**. Verified counts for batik-nusantara (window anchored 2026-07-02): **ditinggal 792 · orders 198 · rescued 100**.
- **Recovery links are signed, store-bound, 7-day jose HS256 tokens** (`apps/storefront/src/lib/recovery.ts`), never the raw session id — a raw id in a URL is a bearer credential for a stranger's name, phone and address the moment the link is forwarded, screenshotted, or leaks through a `Referer` header.

### 👤 Guest vs registered — and two more fabrications removed (`9206220`)
- **Buying never requires an account, so "Tamu" is the NORMAL case, not a defect.** A registration wall in front of an Indonesian checkout is the most reliable way to lose the sale. `customers.registered_at IS NULL` = guest; the screen says so in words and styles **Tamu as neutral, Terdaftar as the extra**. Today: **7 terdaftar / 17 tamu**.
- **New screen `/pelanggan/keranjang`** — **792 abandoned carts that until this week were not recorded at all.** Sorted by what a merchant can act on: **has-phone first**, then basket value **decayed by age** (`subtotal / (1 + minutesAgo/1440)`) — a big cart from three weeks ago is not a better call than a fresh one. Tabs (Semua / Ada nomor WA / Belum dihubungi / Anonim) count with **true SQL totals**, not the loaded slice.
- **WhatsApp recovery:** one click opens `wa.me` with the `wa_templates` body filled server-side. It records **"WA dibuka", NOT "terkirim"** — wa.me cannot tell us whether the message was sent or read. **We do not display what we cannot observe.**
- 🎭 **The CRM was already chasing carts that did not exist.** "Keranjang ditinggal" follow-ups — chase *Dress Midi Motif Bunga*, chase *Gamis Syari Polos* — for baskets that **existed nowhere in the database**. It was sending merchants after ghosts. The seed now derives its 3 cart follow-ups from **real `checkout_sessions` rows**. Orphan cart follow-ups: **0**.
- 🎭 **The Pelanggan stat card claimed "Total Pelanggan 3.128 · +8,2% bulan ini".** The store has **24** customers, and **nothing anywhere computed a month-over-month change**.
- **Driven END-TO-END in a real browser, not typechecked:** real Chrome UA → add to cart → type name/WA/email/address into checkout → close the tab without submitting → the row lands with the **true basket** (Dress Midi Motif Bunga, Rp189.000) → aged → the sweep flips it to `ditinggal` and stamps `abandoned_at` at the moment it went quiet → it appears on `/pelanggan/keranjang` **with its WA number**. 0 console errors; both on-screen rates re-derived from SQL and reconciled exactly. (The bot gate correctly rejected a headless UA first — `x-capture=bot` — which is why the endpoint returns a reason header.)

### 🔒 Security: three fail-open holes closed (`0776e99`, `571ed17`)
- **`/api/cron/billing` failed OPEN.** The guard read `if (secret && provided !== secret)` — so with `CRON_SECRET` **unset there was no check at all**, on a route that is excluded from the auth middleware and walks **every store** to suspend it or raise an invoice against it. Anyone who guessed the path could bill the whole platform. It now **401s in production** when the secret is absent. This is the same fail-open shape already closed on the AutoLaris callback; it survived here because the guard *reads* as if it works — a missing secret quietly meant "no gate" instead of "no entry". **If it can move money, an absent secret must mean NO.**
- **Platform admin ROLES were never checked.** `platform_admins.role` was carried in the JWT and read by nothing: `requirePlatformAdmin()` only asked "is anyone logged in?". A `support` operator could **reject payouts, reset passwords and impersonate merchants**. Now ranked — `support` 1 < `admin` 2 < `owner` 3 — and compared. `impersonateStore` and `resetOwnerPassword` require **`owner`**.
- **Impersonation is now AUDITED** and owner-only. It previously required only "logged in" and left **no trace at all** — someone could read a merchant's orders and nothing recorded it.
- **`platform_payout.release_on` read nothing.** `settleOrderLedger` hardcoded `selesai` while migration 0040's own header claimed the rule was tunable without a deploy. An operator could flip the toggle, believe the policy had changed, and it had not. **A knob that moves nothing is worse than no knob.** It is read now — and the default stays `selesai`, because releasing at `dikirim` lets a merchant withdraw money for goods that can still come back.

### 🎭 The super-admin control plane was largely fiction — and it was giving away subscriptions (`571ed17`)
Screened every platform screen against the database. Most of the headline numbers were invented.
- **`store_stats`** — a rollup that **disagreed with the orders it claimed to summarise**, feeding GMV, order counts and product counts on *every* screen. Batik: rollup said Rp104,3jt / 502 orders; the `orders` table says Rp227,8jt / 642. Kopi Senja: rollup Rp42,6jt / 210 orders, reality **Rp450rb / 3**. It claimed 12–40 products for stores that have **zero**. No longer read anywhere.
- **`ship7d_avg` had no source at all** (`fulfillments` is empty; there is no shipments table) — and it drove a banner telling the operator to **give away a Rp275rb/mo subscription**: *"Volume tinggi (24/hari) — jadikan VIP gratis?"*. **A fabricated number was recommending that revenue be waived.**
- Also deleted: a **`mulberry32(4242)`** "Pertumbuhan MRR" chart compounding random 6–11%/month (the "+x% MoM" beside it was the slope of that noise) · five of six **delta chips** that were a literal `0` rendered as "▲ 0%" · a hardcoded **`churnRate: 0`** shown as a KPI · **two disagreeing MRR figures on one page** (Rp1.100.000 vs Rp875.000) · the legacy Pemula/Bisnis/Skala tiers, which `CLAUDE.md` forbids and which were still live in code.
- **Built instead:** "Uang Merchant yang Kami Pegang" — the merchant float, presented as a **LIABILITY, not revenue**. It is what we owe. Plus a "Perlu tindakan" worklist, a real bar chart from **paid** invoices, and trial→paid conversion derived from paid invoices rather than a flag that disagreed with them. Metrics we cannot support (churn, shipments/day, COD exposure, GMV/province, MoM deltas) are now **stated as unsupported instead of faked**.

### 📦 The order detail INVENTED the box a merchant was about to pack (`2a5ffc4`)
`/pesanan/[id]` fabricated, all from `hash(order.id)`: **the line items** (products picked from a mock array, quantities from bit-shifting the hash), the **ongkir** (`[0, 15_000, 20_000, 25_000][seed % 4]`), a **"Penyesuaian"** line back-solved as `total − subtotal − ongkir` so the invented items would reconcile to the order's real total, the **courier**, the **resi**, the **payment method**, the **street address** (`Jl. Merdeka No. {seed % 90}`) — and even the **barcode bars on the printed shipping label**, i.e. an unscannable barcode on a real parcel.

**A merchant opened an order to pack it and saw products the customer never bought.** All of it now comes from `order_line_items`, `payments`, `orders` and the address snapshot.

### 🧾 An order now carries the address it was SHIPPED TO (migration `0042`)
`orders.ship_recipient / ship_phone / ship_address / ship_postcode / ship_district_id`. Deliberately **a snapshot, not a lookup** back into `customer_addresses`: that address lives on the *customer* and changes. Without this, a buyer who moves house silently moves **every past order** with them — reprint an old label and the parcel goes to the wrong door. **The address belongs to the transaction, not the person.** `ship_district_id` is the same KiriminAja kecamatan the COD province gate already refuses to take the typed city's word over.

### 🏷️ The AWB printed on parcels was OUR OWN order id (`0b3cdda`)
`orders.awb` was written as `r.awb ?? r.kaOrderId` — so when KiriminAja returned no waybill (**the sandbox never issues one**), we stored our own booking reference (`5758-INV4534`) in the `awb` column and **printed it on the shipping label under "No. resi"**. Now only a waybill the courier actually returned lands in `awb`; the booking reference goes in `ka_order_id`, where it belongs; and `awb` stays NULL — with the UI saying `awbPending` — until a real one exists.

### 🛒 Pesanan rebuilt as a seller centre (`4b4775c`)
Shopee-style tabs (Semua · Belum Bayar · Perlu Dikirim · Dikirim · Selesai · Pengembalian/Pembatalan), a search box with a **field picker** (no. pesanan / nama pembeli / produk / no. resi), courier and payment filters, product-led rows. All filtering, search and paging is **server-side** — 685 orders never reach the browser.
- **The five status tabs are a strict PARTITION**: `0 + 24 + 23 + 595 + 43 = 685 = count(*)`. No order counted twice, none missed. Verified against SQL, tab by tab.
- **What the data said when "Belum Bayar" was checked rather than assumed:** the obvious definition (no successful payment) returns 43 rows — and **all 43 are cancelled orders whose payment failed**. Not one is an order a seller should chase. Scoped to orders that are *live* and unpaid, the honest answer is **0**, and the empty state says so instead of looking broken.

### 🌱 The seed was CRASHING silently — and everything after the crash never ran (`ab68abe`, `e81cfb8`)
- The seed reported success while **everything after the crash point was never inserted**. That is how `platform_payout` came to be a policy table with **zero rows** while the super-admin displayed a policy that did not exist in the database, and `min_payout_idr` silently fell back to a code default.
- **`customer_addresses` had a schema and ZERO rows** — which is precisely why the order detail invented street addresses. It now seeds 24.
- `orders` is now the single source of truth in the seed, so the dashboard stopped contradicting Saldo.

### 🎨 Storefront hero carousel — and the fork that could not render (`8fad2f9` → `5016bb3`)
Three slides, auto-advance, editable in Tema. It shipped first as a **fork** of the shared Puck config *inside the admin* — which meant the storefront could not render what the merchant built. Folded back into `@tokophi/sections` (`heroSlides()`, `HERO_INTERVAL_MS`) and the fork deleted. Two real bugs surfaced doing it: Puck portals its canvas into an iframe while the React root lives in the parent document, so React `onClick` **never fired** on the dots; and `[data-puck-component] * { pointer-events: none }` made them unclickable anyway. **The fork's dots had zero invocations.**
- Also: the first banner set had **garbled AI text baked into the images** — regenerated (`7e1580f`).

### 📖 Documentation rebuilt from the code and the database
`specs/PRD.md`, `specs/docs/UML.md`, `specs/docs/SCHEMA.md`, `specs/docs/STATUS.md`, `specs/docs/BACKLOG.md` rewritten, and **`specs/docs/REQUIREMENTS.md` created** (functional + non-functional requirements as *verifiable statements*, each with a query or grep that checks it — including the security invariants learned the hard way: money endpoints fail closed, the tenant boundary is RLS and not a hand-written `WHERE`, the ledger is append-only and the balance is derived, and **a number on screen must be traceable to a query**).
- **Corrections to the docs, again:** they said **54 tables** (there are **67**), migrations through **0036** or **0040** (there are **44**, through **`0043_chat`**), and **RLS on 32–39** (it is **43**). `SCHEMA.md` is now generated from `information_schema` / `pg_class`, not from memory.
- **New findings from this pass** (tracked, not yet fixed): **`invitePlatformAdmin` is `admin`-gated, takes `role` UNVALIDATED and is unlogged — so an `admin` can mint themselves an `owner`**, which quietly undoes the role check that landed this morning · **`lib/actions/billing.ts` has no capability gate**, so a `gudang` user can raise or void the store's subscription invoices · the platform `support` role is **unreachable** (zero actions accept it) · six privileged super-admin mutations write **nothing** to `platform_activity`, including `setInvoiceStatus` · the seed writes **legacy string** courier services, so **on a fresh local DB no service is COD-allowed and COD cannot be exercised at all** · there is **one test file in the entire repo**.
- All 8 Mermaid diagrams in `UML.md` were **rendered with mermaid-cli and verified**. A previous pass shipped four that silently failed to parse.

## 2026-07-13

### 📖 The definitive system documentation — `specs/docs/{SYSTEM_MAP,FLOWS,STATUS}.md`
- Written from the **code and the database**, not from the existing docs — which had drifted badly and, three times now, described features that were never built. Every claim is grounded in a file read or a catalog query; anything that could not be verified is labelled UNVERIFIED and says why.
- **`SYSTEM_MAP.md`** — all four surfaces, what each owns, the four (and only four) cross-surface edges, a route → data-layer → tables table per surface, where the RLS boundary actually sits, and a Mermaid graph + ER diagram of the core domain.
- **`FLOWS.md`** — six Mermaid sequence diagrams with the real function names and the actual guards: shopper checkout incl. the five-condition COD gate, the payment callback, the order lifecycle (and what each transition does to inventory *and* the ledger), the money path (sale → pending → available → payout → approval/rejection), the KiriminAja roster → ongkir → shipment chain, and how `app.store_id` + the `tokophi_app` role really enforce tenancy.
- **`STATUS.md`** — a brutal three-way inventory: 🟢 REAL (verified) · 🟡 SEEDED-BUT-COMPUTED (honest maths, demo rows — e.g. the funnel) · 🔴 FAKE / NOT WIRED (40 items, with the five worth fixing first).
- **Corrections found while writing it** — the docs said **54 tables** (it is **64**), migrations through **0040** (there are **42**, through `0041`), and **"RLS on 36 of 39, gaps in `media`/`payments`/`platform_activity`"** (it is **39 tables with RLS**; `0036` closed `media` + `payments`; **`platform_activity` is the only `store_id` table without RLS**, deliberately). `CLAUDE.md`/`AGENTS.md` still describe the **fee-bearer feature**, which does not exist — `packages/lib/src/payment-fees.ts` has **zero importers anywhere in the repo**.
- **New gaps surfaced by the audit** (tracked, not yet fixed): `/api/cron/billing` **fails OPEN when `CRON_SECRET` is unset** (`if (secret && provided !== secret)` — no secret, no check), the same class of bug that was deliberately closed on the pay callback · `platform_payout.release_on` is a super-admin toggle that **nothing reads** (`settleOrderLedger` hardcodes `selesai`) · `requirePlatformAdmin()` never checks `platform_admins.role`, so a `support` operator can reject payouts, reset passwords and impersonate — and **impersonation is not audit-logged** · `orders.courier` is NULL on **700/700** rows, so the COD return-rate card (the number the whole COD policy is betting on) collapses into one "Tidak diketahui" bucket · the storefront `/blog` is four hardcoded articles and every store shares one fake WhatsApp number.

### 💰 Saldo — a real ledger, and someone to approve the payout (migrations `0040` + `0041`)
- **`0040` — the book.** TokoΦ had been collecting payments on merchants' behalf while keeping **no record of what it owed them**. The Saldo chip was `sum(payments)` — Rp18,9jt — presented as if all of it were withdrawable, when two thirds was still held against unfinished orders. Now: one **signed** entry per movement (`sale` / `retur` / `payout` / `adjustment` × `pending` / `available`), **append-only**, balance **derived** and never stored. New tables `ledger_entries`, `payouts`, `platform_payout` (+ RLS on the first two — money is store-scoped merchant data).
- **Release on `selesai`, not `dikirim`** — deliberately the safe end. A parcel can only be *returned* after it shipped, so despatch-time release would let a merchant withdraw money for goods that come back; on COD the cash does not even exist yet at despatch.
- **`0041` — credit the book.** `0040` built the ledger and **nothing ever wrote a `sale` into it**: the withdraw path worked, the release/claw-back paths worked, on entries that were never created. Every merchant's balance read Rp0 no matter how much came in. A `sale` is now booked when the money is actually **collected** — a `payments` row reaching `berhasil`, and nowhere else. Includes an idempotent backfill.
- **COD is booked at the door, not at checkout.** With COD the platform holds *nothing* when the order is placed, so the payment stays `menunggu`; it becomes `berhasil` only when the order reaches `selesai` (`collectCodOnDelivery`) — the honest moment the cash exists. A refused parcel goes `batal`/`retur`, where the pending payment is **failed** — cash never collected, never booked.
- **Double-credit is a DB impossibility, not an app hope**: three partial unique indexes (`ledger_one_sale_per_payment`, `ledger_one_sale_per_order`, `ledger_one_retur_per_order`). Gateway callbacks retry; buttons get double-clicked.
- **The withdrawal race is closed.** `requestPayout` computes the balance **inside the same transaction under `FOR UPDATE`** — two concurrent requests would otherwise each read the same balance, each pass the check, and the merchant walks away with twice their money. Bank details are **snapshotted** onto the payout, so editing the account later cannot rewrite where past money went. Only an **owner** can withdraw (`settings:write`).
- **Super-admin `/pencairan`** — the payout queue finally has someone who can act on it: `processPayout` → `markPayoutPaid` (no ledger write — the merchant was already debited at request time; re-crediting would double-count), and **`rejectPayout`**, which posts an **opposing `adjustment` entry** rather than editing the sale. The reversal is computed from `Σ ledger_entries WHERE payout_id = ?` (not from `payouts.amount_idr`), so it is exact by construction and cannot over- or under-refund. `SELECT … FOR UPDATE` + a mandatory reason. All audit-logged.
- **`/saldo` moved out of the sidebar into the header** — the balance chip *is* the door. **Rekening Penarikan** now lives in Pengaturan, where merchants actually look for it.

### 🔄 Retur — COD's biggest cost was unmeasurable (migration `0039`)
- `orders.status` gains **`retur`** (+ `returned_at`, `return_reason`). The action existed in the state machine and there was **no button** — so a refused parcel could not be recorded at all, which meant the single most expensive thing about COD was invisible.
- `retur` **restores inventory** (the goods are back on the shelf, exactly like `batal` — missing this would have quietly shrunk real stock on every refused parcel), **fails any pending payment**, and **claws the credit back** with an opposing ledger entry carrying the **same status as the sale it reverses** — so returning a still-`pending` sale cannot drive the withdrawable balance negative.
- ⚠️ **`orders.courier` is NULL on every row**, because a regular checkout books no shipment — so the per-courier return-rate card cannot yet produce a per-courier number. And the **SPX free-return claim the COD policy rests on is UNVERIFIED**: it is a *Shopee Seller Center* benefit, we reach SPX through *KiriminAja* (a different contract), and the API exposes no return field at all.

### 🚚 Shipping + COD, end-to-end (migration `0038`)
- **The courier roster is now the real one.** Super-admin syncs it live from KiriminAja (`syncCouriersFromKiriminaja`) into `platform_couriers`, with per-service COD flags. ⚠️ KiriminAja has **no list-couriers endpoint**, so `kaServices()` prices **one hardcoded reference route** and harvests the services from the response — the roster is only as complete as that lane. Couriers KA stops offering are **disabled, never deleted** (old orders still reference them).
- **The COD policy is enforced, not merely stored.** `platform_cod.max_amount_idr` and `allowed_provinces` were in the schema and **nothing read them** — they bounded nothing. `lib/cod.ts` is now the one place that answers "may this be paid on delivery?", and **all five switches must agree**: platform on · merchant on · total ≤ cap · province allow-listed · the picked service may carry it.
- **Enforced at the API boundary, before any row is written.** Hiding the option at checkout is UX; `/api/public/order` is the boundary. A script POSTing `channelCode:"cod"` gets a **403 with no order created** — never a silently-downgraded order that hides a COD request as a "transfer".
- **The destination province is verified, not taken on trust.** It is derived from the **KiriminAja district id the ongkir quote was issued for** — never from `address.provinsi`, which the buyer types by hand and a hostile client can simply lie about ("DKI Jakarta", then ship to Papua). If COD is requested and the district cannot be verified, we **refuse**. Fail closed: an unverifiable destination is exactly what the allow-list exists to stop, and this is money.
- Two-level courier control: the platform sets the hard-enabled pool, the merchant picks a subset — `effective = (merchant ?? all) ∩ platform-enabled`.

### 📊 Every number is now a counted row (migration `0037`)
- **The funnel + device split are real counts.** They used to be hardcoded constants (`18.816 kunjungan`, `78/18/4`) — identical for every store. Now `GROUP BY` over `analytics_events`, day-bucketed so the range switcher actually changes them, and reconciling with the KPIs beside them **by construction** (`visit` events == `analytics_daily.visitors`, `purchase` == `.orders`). ⚠️ **Honest maths, demo rows** — the events are still overwhelmingly seeded.
- **The storefront now writes real events** (`apps/storefront/src/pages/api/track.ts`): 5 event types, `store_id` derived from the **Host** and never from the client, behind a bot-UA filter (empty UA = bot) and a per-IP window. ⚠️ Both guards are per-process in-memory — they do not hold across replicas.
- **Pemasaran stops inventing ad performance.** There is **no Meta/Google/TikTok integration anywhere in this codebase** — the only OAuth we have is Google *Sign-In*. Spend, impressions, ROAS and campaign lists were pure fabrication (a merchant could have raised a real ad budget on a return that never happened). The cards now read **"Belum terhubung"**, and the only ad-related figure we still show is the one we can actually count: orders and revenue *attributed* by `orders.channel`.
- **The dashboard is an action queue, not vanity metrics** — and the seed now makes `orders` the single source of truth, so the dashboard stopped contradicting Saldo.
- **The topbar notifications are counted**, not two hardcoded strings — one of which alerted the merchant about "Earphone TWS", a product from an old electronics catalogue that this fashion store never sold.
- Fixed: KPI deltas printed the wrong sign; `/api/track` had no rate limit; `/bantuan` hydration bug (`Date.now()` in a render path).

### 🔴 Security: RLS on `payments` + `media` (migration `0036`) — live and proven in production
- `payments` is **money**, written from the merchant admin, and had **no RLS**: tenant isolation rested entirely on application code. One forgotten `where` and store A could read or mutate store B's payments. Every other store-scoped table was already held by the database.
- The subtle part: `payments.store_id` was **nullable and NULL on every seeded row** (only production code ever set it). A nullable tenant key matches no policy — enabling RLS naively would have made every payment vanish from the app. The migration backfills `store_id` from the parent order, sets NOT NULL + FK, and only then enables RLS.
- **Proven on production data** as the non-owner `tokophi_app` role: the owning store sees its 60 payments, another store sees **0**, a query with no tenant context sees **0**, and a forged cross-tenant insert is rejected — `new row violates row-level security policy`. `verify-rls` is now 38/39 (`platform_activity` is a deliberate owner-only platform log).

### 🔴 Security: the payment callback now fails CLOSED
- `secretOk()` returned `true` when `AUTOLARIS_CALLBACK_SECRET` was missing, so a lost or mistyped env var would have silently opened the endpoint that marks orders **paid** and extends store subscriptions — with nothing but a `console.warn`. It now returns 401 in production (dev still runs without a secret). Verified live.

### Removed the client-admin "Pembayaran" tab
- It let a merchant choose payment channels and who bears the gateway fee — but **nothing read either value**. The storefront checkout reads the *platform's* channel list (ADR 0004: channels are a platform decision), and no pricing code has ever consulted `payment_fee_bearer`. The tab saved, toasted "berhasil", and changed nothing a shopper would see.
- The columns are kept (dropping them is a destructive migration). **A merchant-facing fee-bearer feature does not exist** — if it is wanted, it has to be built into checkout pricing, not merely stored. `AGENTS.md`/`CLAUDE.md` corrected: it described the feature as if it shipped.

### SEO hygiene — admin panels are noindex; `www` redirects to the apex
- **Both admin panels were crawlable after the cutover** (`app.tokophi.com/login` and `rich.tokophi.com/login` served 200 with no robots header, and `/robots.txt` redirected to `/login`). Now `noindex, nofollow` in **three layers** per app: `X-Robots-Tag` from `next.config.ts headers()` (covers `/api/*`, static assets, non-HTML), the same header stamped in `middleware.ts` (a redirect short-circuits before `headers()` runs), plus `metadata.robots` and `app/robots.ts`.
- **Merchant product photos stay indexable** — `/api/uploads/*` is carved out (`X-Robots-Tag: all` + `Allow:`). Those photos are served from the admin origin but embedded in public storefronts, so a blanket noindex would have removed every merchant's product photography from Google Images.
- **Storefronts and the landing page remain fully indexable** — verified live.
- **`www.tokophi.com` → 301 → `tokophi.com`**, path and query preserved (Traefik redirect router). Note: Coolify passes compose labels to Docker without docker-compose's `$$` → `$` unescaping, so the Traefik regex replacement must be written `${1}`, not `$${1}` — the escaped form shipped a literal `https://tokophi.com/${1}` in the `Location` header.

### Landing page — one screen, adaptive
- The front door now fits **a single viewport with no scrolling** at mobile, tablet, and desktop sizes (`100dvh`, not `100vh`). Where the content cannot fit — landscape phones — it is **cut rather than allowed to scroll**. Verified in production at six viewports in both light and dark: `scrollHeight == innerHeight`, `scrollWidth == innerWidth`, zero console errors.
- Copy rewritten around "Seluruh toko Anda, dalam satu panel."; every claim checked against the concept doc and the billing code. Added `robots.txt` and an auto-generated `sitemap.xml`.

### 🚀 `tokophi.com` is live — domain cutover + per-merchant storefronts
- **`<slug>.tokophi.com` serves that merchant's storefront**, from a single storefront container, with the tenant resolved from the `Host` header. Verified in production: `batik-nusantara.tokophi.com` → "Batik Nusantara", `kopi-senja.tokophi.com` → "Kopi Senja", an unknown slug → a clean 404.
- **The self-serve loop is closed:** a store signed up through the real `/daftar` form on production immediately had a working HTTPS storefront at its own subdomain — **no deploy, no DNS change, no manual configuration**. (Test tenant purged afterwards.)
- Surfaces: `tokophi.com` + `www` → the new **landing** app · `app.` → client admin · `rich.` → super-admin · `toko.` → demo store. Old `.sslip.io` hosts still routed as a fallback.
- **TLS:** Let's Encrypt cannot issue a wildcard over HTTP-01, so the per-merchant hosts are served with a **Cloudflare Origin CA certificate** (valid to 2041) installed as Traefik's default certificate. It is trusted **only by Cloudflare**, so every `tokophi.com` DNS record must stay **proxied** — which also means the origin IP is never exposed. Scheme `<slug>.tokophi.com` (one label deep) was chosen because Cloudflare's free Universal SSL covers only a single wildcard level.
- **Traefik router priority is load-bearing:** the wildcard rule also matches `app.`/`rich.`, and Traefik ranks routers by rule *length* by default — the regexp is longer, so without an explicit `priority=1` the storefront would have taken over the admin domain.

### Landing page (`apps/landing`)
- New static Astro app for the apex — "Segera hadir", with working **Masuk** / **Daftar toko** links. Deliberately has **no database and no dependency on Postgres**: the front door must be servable even when everything behind it is down.
- **Fixed a bug it shipped with:** the CTAs rendered `href=""` in production. A bare `ARG` with no `--build-arg` sets the env var to the *empty string*, not `undefined`, so the page's `??` fallback never fired — invisible in local dev, where the variable was simply absent.

### Self-serve signup + Google OAuth (P1.6)
- **`/daftar`** — public signup: one transaction creates account + owner user (scrypt) + store (`trial`, +3 days) + `store_users(owner)` + location + settings + stats + a `platform_activity(signup)` row (`apps/admin/lib/provision.ts`). Slug auto-dedupes; duplicate email rejected. Verified end-to-end against the real DB.
- **Google OAuth** — migration `0034` (`users.auth_provider`, `users.google_sub`), `/api/auth/google/{start,callback}` (jose + Google JWKS). Google on `/daftar` provisions a store; Google on `/login` with an unknown email is rejected (no silent store creation). Existing password users keep their `password_hash` when linking. **Feature-flagged** — with the env unset the button is hidden and the routes redirect. ⚠️ Not yet exercised against real Google credentials.

### Storefront: `Host`-header multi-tenant (ADR 0009 complete)
- **One storefront deploy now serves every store.** The module-level `STORE`/`STORE_ID` singletons are gone: an Astro middleware resolves the tenant from the request `Host` and puts `{store, catalog}` on `Astro.locals`; the catalog is memoized per store id (15s TTL, `STOREFRONT_CACHE_TTL_MS`).
- **Resolution order:** custom domain (seam — no column yet) → `<slug>.$STOREFRONT_BASE_DOMAIN` → first host label (the sslip box) → fallback `STORE_SLUG`. The fallback fires **only when the host names no store at all**; a host naming an unknown slug returns a clean 404 ("Toko tidak ditemukan") rather than serving another merchant's storefront. `RESERVED` labels (`www/app/rich/admin/api/cname/toko/…`) never resolve as a store slug.
- **Checkout branding** — `checkout.astro` renders the resolved store's `logo_url` (wordmark fallback when null).
- `astro build` remains **DB-free** (verified with `DATABASE_URL` unset), so the fast-start/zero-downtime property from 2026-07-10 is intact.

### Tema: named template variants
- `/tema` is now a **template manager** — create/rename/set-default/delete named templates per type (Beranda/Kategori/Produk) and assign one per kategori and per produk (with bulk apply). The Puck builder moved to `/tema/[id]`.
- **No migration needed** — `0031` already shipped `collections.template_id` + `products.template_id`. At most one default per `(store_id, type)`, enforced app-side; deleting a template NULLs any assignment pointing at it. All actions `requireCapability("theme:write")` + `withTenant`.
- ⏳ The storefront still renders only the **homepage** template; category/product template rendering is the next slice.

### 🔴 Security: RLS retrofit for support tickets (migration `0035`)
- `support_tickets` / `support_messages` shipped in migration `0030` — **after** the `0012` RLS migration — and had **no RLS at all**. `lib/actions/support.ts` used the bare **owner** connection with a hand-written `storeId` filter and no `requireCapability`: tenant isolation for tickets rested entirely on application code.
- **Fixed:** `support_messages.store_id` added + backfilled from the parent ticket (NOT NULL + FK); RLS + the standard `tenant_isolation` policy enabled on both tables. Admin reads moved to `lib/data/support.ts` under `withCurrentTenant`; writes go through `requireCapability("support:write")` + `withTenant`. **The database is the boundary now, not app code.**
- New capability `support:write`, granted to **all four roles** — anyone in a store must be able to ask for help; the tenant boundary is RLS, not the role. `requireCapability(cap, { allowSuspended })` lets a **suspended** store still open a ticket (otherwise it could not contact us about the billing problem that suspended it).
- **Verified in psql:** as `tokophi_app` with store A's `app.store_id`, store B's ticket returns 0 rows *even when fetched by primary key*, and inserting a row for store B raises `new row violates row-level security policy`. Super-admin (owner connection) still reads across stores.
- `verify-rls` no longer hand-maintains a table list — it derives the store-scoped set from the catalog (every table with a `store_id`) and **fails** if one lacks RLS. **36/39 green.** ⚠️ Newly surfaced: `media`, `payments`, `platform_activity` have a `store_id` and **no RLS** (`media` is merchant data) — whitelisted and tracked in BACKLOG.

### Storefront renders category/product templates
- Category and product pages now resolve a template (`collections.template_id` / `products.template_id` → the type's default → the hand-built page). One query per store, memoized in the existing catalog cache; the build stays DB-free. An empty template degrades to the fallback instead of rendering a blank page. A Grid Produk with no explicit collection scopes itself to the category being viewed (or the product's category, minus the product itself).
- **A product template replaces only the tail of the product page** — the buy box (galeri, harga, varian, Tambah ke Keranjang) and Ulasan always remain, because no section in the registry can render them and a full replace would ship product pages **with no way to buy**. A `product-detail` section is the proper fix (BACKLOG).
- `/tema` warns when a category template has no **Grid Produk** section — such a template lists no products at all.

### Docs
- **`specs/docs/CHAT_SPEC.md`** — shopper⇄merchant chat spec (separate tables from `support_*`, short-polling transport, anonymous-visitor JWT cookie, 7 slices). Nothing built yet; chat migration slot moved to `0036`.

## 2026-07-10

### Storefront → Astro SSR (zero-downtime deploys)
- **Converted the storefront from SSG-built-at-container-start to SSR** (`@astrojs/node` standalone, `output: 'server'`). The old image ran a full `astro build` at container start (~1–2 min), so every deploy had a window where the new container returned nothing / "not found" until the static build finished — the origin-side cause of deploy downtime.
- **Now:** the catalog is read from Postgres at **server boot** (module-level in `src/data/catalog.ts`), not during `astro build`. The image builds **without a DB** (bundling only) and the container starts in **seconds** (`node dist/server/entry.mjs`).
- **Dynamic routes** (`produk/[handle]`, `kategori/[handle]`) drop `getStaticPaths` → resolve per-request from `Astro.params` (real + virtual `semua`/`promo-gajian` collections; `404` on unknown handle).
- `apps/storefront/Dockerfile` builds at image time + runs the node server; `HOST=0.0.0.0`/`PORT=4327`. Compose storefront healthcheck `start_period` 120s → 30s.
- **Healthcheck fix**: `@astrojs/node` binds IPv4 `0.0.0.0` only, but busybox `wget localhost` resolves `::1` (IPv6) first → false "unhealthy" → Traefik 404 on the live box. Changed the storefront healthcheck to `http://127.0.0.1:4327/`. (The old `serve` bound dual-stack, so `localhost` had worked.)
- **Verified:** builds with `DATABASE_URL` unset; server boots ~1s and serves `/`, `/produk/<h>`, `/kategori/<h>`, `/kategori/semua` (200), unknown handles (404), `/_astro/*` assets (200). Still single-tenant (store by slug at boot); ADR 0009 `Host`-header multi-tenant builds on this base (TODO).

### Support tickets (2-sided) + super-admin manual billing + fixes
- **Support tickets** (migr 0030 `support_tickets` + `support_messages`): **client admin `/bantuan`** (list, open new, thread + reply + close; nav "Bantuan") ↔ **super-admin `/tiket`** (all tickets, status tabs perlu-dibalas/dibalas/selesai, reply as platform + close/reopen; nav "Tiket"). Chat-style thread both sides; store-scoped for merchants, cross-tenant for platform. Seeded 2 demo tickets.
- **Super-admin manual billing** (store detail → Kontrol langganan): **Buat tagihan (VA)** (`createManualInvoice` — reuse-or-create one AutoLaris VA subscription invoice, no duplicate, VA revealed in a dialog, audit-logged) + **Kirim pengingat bayar** (`sendPaymentReminder` — recorded to the store audit; email/WA comms deferred).
- **Image uploads → WebP**: 2MB client cap; server converts every raster to WebP via `sharp` (EXIF-rotate, ≤2000px, q82), SVG passthrough; served via public `/api/uploads/[name]` route (`next start` doesn't serve runtime files in `public/uploads`).
- **Subscription pay flow**: pick cycle → **Lanjutkan pembayaran** → pick platform channel (dialog) → VA/QRIS; no more instant-VA-on-click, no duplicate invoices (reuse pending, migr 0029 `invoices.channel/qr/payment_url`); invoice rows clickable → `/faktur/[number]` (unpaid resumes payment).
- **Seed fix**: billing lifecycle dates now relative to the real clock (`fromNow`) so segments don't lapse on deploy-date drift — Trial tab populated.

### Client-admin "Akun" section (split from Pengaturan)
- **New `/akun/*` route group** with a shared layout + tab nav (Profil · Keamanan · Langganan) — cohesive account UI, own header, active-tab highlight. Moved the 3 pages out of `/pengaturan/*`; Pengaturan is now store-settings only.
- **Profil page** (`/akun/profil`): identity card (avatar, name, email, role, store, joined) + editable name/email (`updateProfile`, email-uniqueness) + quick-link to Keamanan.
- **Top-right avatar menu** made functional: Profil / Keamanan / Langganan are real links (were dead) + Keluar.
- **Subscription badge moved under the logo** (sidebar): stable position (own bordered block above the nav) — no longer shifts on nav clicks; status dot + label + days; VIP → violet pill.

### Subscription billing: PPN 11% + payment history + printable faktur
- **PPN 11%**: plan prices are the DPP (ex-tax); merchant pays base + 11% PPN. `@tokophi/lib/billing` `PPN_RATE`/`withPpn()`/`baseFromTotal()`; `paySubscription` charges the PPN-inclusive total; seed invoices store totals (305.250 / 55.500). Langganan page + pay buttons show the breakdown + note; faktur itemizes Subtotal (DPP) + PPN 11% + Total. MRR stays at the DPP (VIP excluded).
- **Riwayat pembayaran** on the Langganan page: the store's own invoices (no. faktur, jenis, jumlah, status, tanggal) + total dibayar; `getMyInvoices` (owner conn, scoped to session store).
- **Printable faktur** `/faktur/[number]`: standalone print-ready invoice sheet (issuer TokoΦ, bill-to store/owner, line item, Subtotal/PPN/Total, LUNAS/menunggu, VA) + Cetak/Simpan-PDF (`window.print`, `print:hidden` chrome); ownership-scoped via `getFaktur`.

### Payment-gateway fees + grouped client-admin payment menu
- **Fee schedule** `@tokophi/lib/payment-fees` (white-label, per successful storefront txn): VA Rp4.000, e-wallet 2,4%, QRIS 1%, retail (Indomaret/Alfamart) Rp4.000; `paymentFee()` + `splitFee()`; `FeeBearer` (seller | buyer | split).
- **Client admin → Pengaturan → Pembayaran**: new **Biaya Pembayaran** card (fee table + who-bears picker Penjual/Pembeli/50:50, persisted to `store_settings.payment_fee_bearer`, migr 0028) **+** the payment methods menu rebuilt from mock flat toggles into a **grouped, functional** list (COD standalone, then QRIS / Virtual Account / E-Wallet / Minimarket collapsible with counts) that loads platform-enabled channels and persists the store's subset to `store_settings.payment_channels`. Tidied keterangan; dropped legacy tier badge.

### Super-admin store-control overhaul (billing segments + full per-store control)
> _(also 2026-07-09 below — kept together)_

## 2026-07-09

### Billing — single-plan subscription lifecycle (full, operational)
- **Model**: one plan "TokoΦ", **all features** (no tier-gating). Monthly: 3-day free trial → **Rp50rb** first month (promo) → **Rp275rb/month**. **Annual: Rp225rb/mo = Rp2.700.000/yr** (save Rp50rb/mo); paying annually straight from the trial grants a **bonus month → 13 months** (migr 0024 adds invoice `cycle`/`period_months`; callback extends by `addMonths`). `store` subscription fields (`trial_ends_at`/`current_period_end`/`first_invoice_paid`; migr 0022), `store_status += past_due`. `@tokophi/lib/billing` = pricing + `computeBilling()` (trial → active → past_due → 3-day grace → suspended).
- **Client admin**: real subscription in sidebar + `/pengaturan/langganan` (status, countdown, next amount incl promo) + **Bayar/Perpanjang/Aktifkan** → creates a real AutoLaris VA. New store → 3-day trial.
- **Pay + activation**: `paySubscription()` → AutoLaris VA + subscription invoice (`kind/reff/trx/va` cols, migr 0023); pay callback matches the subscription invoice → marks paid + extends `current_period_end` +1mo + `active`.
- **Enforcement**: `requireCapability` throws `SuspendedError` when past grace → all writes blocked (storefront + paying stay up); admin banner for past-due/suspended.
- **Super-admin**: MRR = Rp275rb × active; dashboard "Ringkasan Langganan" + "Status Toko" (aktif/trial/menunggak/ditangguhkan); `/paket` rebuilt = single-plan card + subscription-status breakdown + invoices; store detail shows real subscription state. **Toko list now shows the COMPUTED real-time status** (consistent with detail + enforcement). `getSubscriptionStats()` computes status counts from every store's lifecycle.
- **Analitik → "Keuangan & Analitik"**: finance KPIs (MRR/ARR/pendapatan diterima/GMV) + Ringkasan Pendapatan (lunas/menunggu/tahunan) + Corong Langganan + GMV per kota + **Sistem & Integrasi** status (KiriminAja/AutoLaris/DB/server) via `getFinanceStats()`/`getSystemStatus()`. Dropped legacy per-tier aggregates.
- **Annual plan** (Shopify-style): monthly Rp275rb OR **annual Rp2.700.000 (Rp225rb/mo, save Rp50rb/mo)**; paying annually straight from the trial → **13 months** (bonus). `quote(cycle, firstPaid)` + `addMonths()`; invoices `cycle`/`period_months` (migr 0024); langganan page has Bulanan + Tahunan buttons.
- **Billing cron** `/api/cron/billing` (CRON_SECRET-guarded, schedule daily): syncs stored status to the real-time lifecycle + auto-generates a monthly VA invoice for past-due/suspended stores with no pending subscription invoice. Verified: `{stores:7, statusSynced:1, invoicesCreated:2}`.

### Super-admin store-control overhaul (billing segments + full per-store control)
- **Store lifecycle segments** (migr 0026/0027): the store catalog is split into the 4 sessions **Trial → Bulan pertama (Rp50rb) → Reguler (Rp275rb) → VIP (gratis)**. `@tokophi/lib/billing` gains `storeSegment()` + `SEGMENT_META`; `computeBilling` handles `comped` (VIP → always active, no charge, never suspended/billed — admin `getBilling` + cron read `comped` too).
- **VIP / comp (the "hapus langganan" one-door control)**: `stores.comped/compedReason/compedAt` — super-admin bypasses billing for high-volume merchants hosted free. Store detail shows a VIP banner + **volume-based recommendations** (`store_stats.ship7dAvg`: high volume → suggest VIP, VIP gone quiet → suggest revert).
- **Toko list redesigned**: 4 segment tabs with counts; each row a 1-line summary (segment badge, status, health, GMV, **kiriman/hari 7d**, orders); row menu Jadikan/Cabut VIP; dropped legacy tier column/filter.
- **Store detail = full control**: Gratiskan 1 bulan (`compStore`), Perpanjang trial (`extendTrial`), Jadikan/Cabut VIP (`setStoreComped`), **Reset password owner** + **manage store users** (add/remove/role/reset-pw, one-time temp-password reveal — all scrypt-hashed), suspend/activate; **real per-store invoices** + an **audit log** (`platform_activity.storeId` + `admin` kind — every operator action is recorded).
- **Single-plan cleanup**: seed invoices → Rp275rb/Rp50rb (no more Bisnis/Skala/Pemula tiers), fixed legacy activity text; dashboard + paket show `TokoΦ`/segment, not tier badges. MRR excludes VIP.

### Super-admin Pengaturan redesign (2-column + grouped channels + courier services)
- **2-column layout** like the client-admin Pengaturan: sticky left rail (Pembayaran / Kurir / Tim Platform), content switches per section instead of one long scroll.
- **Payment channels grouped into collapsible sections** by kind — QRIS + COD standalone, then **Virtual Account** / **E-Wallet** / **Minimarket** accordions, each with an `N/M aktif` count + chevron (auto-open when something's enabled). Built on the existing kit (no new dep).
- **Non-active channels locked**: the green "Aktif di AutoLaris" badge comes only from **Sync** (probe `rc=00`), not the toggle; inactive channels show a muted "Belum aktif · Sync" badge with a disabled toggle so a channel AutoLaris rejects can't be offered (would break checkout). Banner shows `N/M channel aktif`.
- **Courier services as chips**: each KiriminAja courier lists its service levels (Reguler highlighted as primary; ekspres/kargo muted) + an `N/M kurir aktif` banner count.
- **Sync now upserts** probed channels (inserts roster codes missing from the DB, e.g. VA Danamon) so the list can't silently drop a channel.

### Super-admin Pengaturan + Analitik polish + integration tests
- **Pengaturan payment unified**: the separate "Gateway Pembayaran" + "Metode Pembayaran AutoLaris" cards are now **one "Pembayaran" section** styled exactly like the courier card — AutoLaris appears **once** as the PSP aggregator banner (Aktif badge + **Test koneksi** + **Sync**), followed by a single flat toggle list of COD + channels (each with an "Aktif di AutoLaris" badge), and one **Simpan** for the whole section. Removes the duplicate AutoLaris naming; precise parity with the ekspedisi list.
- **Analitik → "Server (VPS) · realtime"** card: CPU / RAM / uptime via `node:os` (`getServerMetrics()`; host-level inside the container), color-graded bars, beside the finance + integration status.
- **Integration active/configured rules extracted** to a pure, testable `@tokophi/lib/integration-status` module — `channelActiveFromRc` (AutoLaris `rc="00"` = active) + `isConfigured` (non-empty key); `autolaris`/`kiriminaja` now delegate to it so the "Aktif" badges + "Test koneksi" have one source of truth. Added **vitest** + `integration-status.test.ts` (5 cases) + root `test`/`test:watch` scripts.

### Two-level courier + payment control (super-admin → merchant → shopper)
- **Couriers**: shared roster `@tokophi/lib/couriers` (12 codes incl **SPX**); `platform_couriers` by code (super-admin enable) → client admin picks a subset (`store_settings.couriers`) → ongkir = (merchant ?? all) ∩ platform-enabled. Fixed hard-coded/mock courier list.
- **Payment channels**: `platform_payment_channels` (migr 0020) — super-admin toggle list + **Sync dari AutoLaris** (live-probe → auto-enable active); checkout offers only platform-enabled (`AUTOLARIS_KNOWN_CHANNELS` roster; validation loosened).

### Fixes
- **Impersonation** (super-admin "Buka panel admin" → client admin loaded empty): 3 layered prod-only bugs — cross-subdomain cookie (→ `/impersonate` token exchange), `ADMIN_URL` baked at build (→ runtime read), Node-runtime `req.url` leaking internal `localhost:3000` behind Traefik (→ relative-Location redirect). Verified E2E.
- **MRR chart** near-invisible (fill opacity 0.35 → 0.7).
- Order cancel now restores stock + fails pending payment; white-label courier labels; dropped inactive payment channels (BSI/DANA).

### Deploy infra (Docker + Coolify) + hosting decisions
- **Dev server live**: Vultr Singapore (8 vCPU/16GB AMD, `45.76.146.40`) provisioned via `vultr-cli` + **Coolify v4.1.2**. Hosting = 2-phase **DEV Vultr SG (credit) → PROD Hetzner SG** (migration trivial: Coolify+git+`pg_dump`+Cloudflare). Domain `tokophi.com` in Cloudflare (DNS not pointed). Edge=Cloudflare, origin=Traefik/Coolify (skip HAProxy).
- **Dockerized** for Coolify **Docker Compose** build pack: `apps/*/Dockerfile` (context=repo root; admin/super-admin `next start`, storefront SSG **builds at container start** then `serve`), `.dockerignore`, `docker-compose.coolify.yml` (postgres + one-off migrate/seed + 3 apps + healthchecks), `.env.coolify.example`. **Validated locally** (migrate+seed 7030 areas, all 3 apps serving).
- **Full gotchas/fixes runbook** → `specs/docs/DEPLOY.md` (Nixpacks fails on workspaces → Docker Compose; dummy `DATABASE_URL` at build; storefront build-at-start; migrate bypasses dotenv; RLS role needs superuser; Vultr no-Jakarta/IPv4-included vs Hetzner IPv4-fee; migration steps). New dotfiles skill `vultr`.

### Order-cancel consistency + WYSIWYG editor
- **Restore stock on cancel** + **fail pending payment on cancel** (`setOrderStatus`): cancelling a live order returns reserved stock (mirrors checkout decrement, guarded vs double-restore) and marks still-`menunggu` payments `gagal` so a cancelled order can't be paid later.
- **Rich-text editor (Tiptap, free/MIT)**: `RichTextEditor` (bold/italic/strike, H2/H3, lists, quote, link, undo/redo) replaces the plain textarea + fake toolbars in Halaman + Blog editors; stores HTML in `body`, SSR-safe.

### Packages + scaling prep + docs
- **De-dup**: KiriminAja + AutoLaris clients consolidated into `@tokophi/lib` (server-only `./kiriminaja` + `./autolaris` subpaths) — admin + super-admin now share one canonical client (deleted 4 duplicate files).
- **Pricing cache** (`@tokophi/lib/cache`): in-proc TTL cache wraps `kaShippingPrice` (10 min per route) — cuts KiriminAja rate-limit risk + latency under ad traffic (1st call 5.8s → cached 0.03s). KV/Redis-ready swap for prod.
- **Docs**: `UML.md` refreshed to the implemented state (commerce loop, express+instant shipping, data-layer, Cloudflare-native scaling topology sized for 50–100 clients / 10–30k traffic); `SYSTEM_GUIDE.md` §10 adds the scaling plan.

### Shipping — instant courier (same-day) E2E + UAT (insurance/COD/cancel) + product weight/dims
- **Instant courier** (GoSend/Grab/Borzo): grouped checkout (**📦 Ekspedisi** vs **⚡ Kirim Instan**, geolocation) + **create wired end-to-end** — checkout → pick instant → `kaCreateInstantOrder` dispatches a driver (verified: order + real instant order_id, status `dikirim`). Gotchas: `shipping_price` = `shipping_costs` (not total), top-level `order_prefix`, `service_type`, fresh price. Store coords via Pengaturan → **"Gunakan lokasi saat ini"** (geolocation).
- **UAT (Everpeaks) coverage** (per official `kiriminaja/node` SDK): `request_pickup` supports `insurance_amount`, `cod` (amount; only on `cod:true` services), `width/length/height` (volumetric). **Cancel/void** = `/api/mitra/v3/cancel_shipment {awb, reason≥5}`. Admin Buat Pengiriman: Asuransi + COD toggles + Batalkan.
- **Product weight & dimensions** (migration 0018): editor Berat (gram, prioritized + examples) + Dimensi P×L×T (cm, volumetric explainer); shipment sends real Σweight + max dims. Fix: editing a product no longer changes its handle/URL.
- **COD** recorded — storefront COD checkout writes a `method=cod` payment row; admin shows "COD (Bayar di Tempat)".
- QA: 6 key admin routes crawled → 0 console errors; 3 surfaces build clean; RLS verified.

## 2026-07-08

### Shipping — local KiriminAja area database (7k districts)
- Imported the KiriminAja district map (`districts-mapped.xlsx` → `packages/db/data/kiriminaja-areas.csv`, **7030 kecamatan / 37 provinces**) into a **`kiriminaja_areas`** reference table (migration 0017; `npm run seed:areas`; excluded from demo-reseed truncation). Its `id` = the KiriminAja area id (verified 5507=Semarang Barat, 6981=Danurejan/Yogya).
- `lib/data/areas.ts resolveArea()` — **local table first** (instant, no rate limit, offline) → live `get_address_by_name` fallback; wired into shipping rates/search/create-shipment + the public ongkir endpoint. Pricing + order creation still hit the live API.

### Commerce loop closed — storefront checkout creates a real DB order + linked payment
- New public endpoint `apps/admin/app/api/public/order` — the storefront checkout now **creates a real order** (upsert customer + `orders` + `order_line_items`) and, for non-COD, an **AutoLaris payment linked by `orderId`**. Runs as owner with an explicit `store_id`.
- **Checkout** posts the whole order → real order number **`WEB-…`**; the **sukses page** shows the real number + payment instruction. Storefront orders now **appear in the merchant admin** (Pesanan list + detail) with the linked payment.
- **Pay callback** syncs the linked order → `financialStatus = dibayar` when paid. Verified E2E: VA BCA checkout → `WEB-527789622` (order + line item + payment) → shown in admin → callback → payment berhasil + order dibayar.
- **Payment integrated in the merchant admin**: order detail "Buat Tagihan" (VA/QRIS/DANA, persisted+linked) + real payment status (`getOrderPayment`/`createOrderPayment`).

### Payments — AutoLaris payment gateway (platform-managed) + brand hidden from client
- **Single platform PSP = AutoLaris** (VA 6 banks / QRIS / DANA). `gateway_provider` enum += `autolaris` (migration 0016); seed drops Midtrans/Xendit/Duitku; `payments` table extended (trx_id/channel/va/qr/url/total/admin). Key in gitignored `.env.local` (`AUTOLARIS_API_KEY`/`AUTOLARIS_BASE`), never committed.
- **Super-admin** Pengaturan → Gateway Pembayaran: AutoLaris + live **"Test koneksi"** (`alTestConnection` creates a nominal QRIS bill, checks `rc=00`).
- **Client "tinggal pakai"**: storefront checkout payment channels (QRIS/VA/DANA — generic labels) → public no-auth endpoint `apps/admin/app/api/public/pay` (`create_payment`) → **sukses page shows the real VA number / QRIS / e-wallet instruction**; callback endpoint marks paid; `PUBLIC_PAY_API` env-driven. Verified E2E: VA BCA → real VA `1551410210002419`, total Rp188.500.
- **Brand hidden from client** (per request): removed **"KiriminAja"** (shipping) + **"AutoLaris"** (payment) from the merchant admin + storefront UI — merchants/shoppers see generic labels ("ongkir real-time", "Virtual Account BCA", "dikelola TokoΦ"). Super-admin (platform) still shows the provider brands.

### Shipping — tracking (Lacak) + order auto-status
- Buat Pengiriman advances the order to **"dikirim"**; the order-detail Pengiriman card shows a **"Terdaftar di KiriminAja"** badge + a **"Lacak"** button → `trackShipment()` polls `/api/mitra/tracking`, syncs the real courier AWB when assigned (sandbox returns not-yet-available for a freshly-created shipment — shown as a friendly "menunggu penjemputan"). Webhook-based status push is a prod item (needs a public URL).

### Shipping — real AWB creation working (Buat Pengiriman end-to-end)
- With a registered `KIRIMINAJA_ORDER_PREFIX` (gitignored), **Buat Pengiriman now creates a real KiriminAja pickup**. `request_pickup` package required a few more fields (found by iterating the sandbox validation): `item_name`, `shipping_cost` (= chosen rate cost), `cod`, `package_type_id`. The returned `kj_order_id`/resi is saved to `orders.awb`/`courier`; the order detail + printed label show the real resi/courier. Verified E2E: INV-4821 → "resi 5758-INV4821" persisted.

### Storefront — checkout with live KiriminAja ongkir
- New **public no-auth endpoint** `apps/admin/app/api/public/ongkir` (CORS) — `op=search` (area autocomplete) + `op=rates` (live `shipping_price`); the platform key stays server-side (never in the storefront bundle). `middleware.ts` excludes `/api/public/`.
- **Checkout** (`checkout.astro`): a **"Kecamatan Tujuan"** autocomplete → live courier list from KiriminAja → selecting a service updates **ongkir + total**; replaces the old static shipping radios. Verified E2E: Semarang Barat → 18 live services → Rp27rb ongkir, total recomputed.

### Shipping — KiriminAja config + create shipment + print label (roadmap #1–3)
- **Super-admin config + Test koneksi** — aggregator is now **KiriminAja** (enum `aggregator_provider` += `kiriminaja`, migration 0014); Pengaturan → Integrasi Kurir has a live **"Test koneksi"** (`kaTestConnection()` → `/api/mitra/province`, gated by `requirePlatformAdmin`). Verified: "Terhubung (sandbox) — 37 provinsi".
- **Store sender address** (migration 0015: `store_settings.sender_*`) — admin Pengaturan → Pengiriman has an **"Alamat Pengirim (KiriminAja)"** card: kecamatan autocomplete (`get_address_by_name`) + phone/address/lat-lng, persisted per store.
- **Buat Pengiriman** — the Cek Ongkir dialog gets a **"Buat"** per rate → `createShipment()` builds `request_pickup` (sender from settings + recipient resolved from the order) → saves **AWB/courier** on the order (`orders.awb/courier/ka_order_id`). `order_id` uses `KIRIMINAJA_ORDER_PREFIX` (default `TOKOPHI`) — **must be registered in the KA dashboard** (sandbox rejects unregistered prefixes with a clear hint).
- **Cetak label PDF** — the "Cetak" stub is now a real **100×150mm shipping label** (courier, barcode+resi/AWB, penerima/pengirim, isi, COD/total) → browser print → Save as PDF; uses the real AWB once a shipment exists.
- Verified E2E: sender saved (Yogyakarta), Buat reaches KiriminAja (blocked only on the registered prefix), label renders, Test koneksi green — all console-clean.

### Shipping — KiriminAja live rates (real courier API integration)
- **Real KiriminAja Mitra API integration** (platform-managed aggregator, ADR 0004). `apps/admin/lib/kiriminaja.ts` client — sandbox base `https://tdev.kiriminaja.com` + Bearer key (in gitignored `.env.local`, **not committed**; `.env.example` placeholder). Endpoints verified against the Postman collection (version prefix varies per endpoint: `shipping_price`=v6.1, `get_address_by_name`=v2, `province`/`tracking`=unversioned).
- **Client admin (order detail): "Cek Ongkir"** — `lib/actions/shipping.ts getShippingRates()` resolves the store city + order destination → KiriminAja district IDs (`get_address_by_name`) → live rates (`shipping_price`), shown in a dialog (courier, ETD, cost, COD badges). Verified E2E: order INV-4821 → **18 live services** (Yogyakarta→Semarang), console-clean.
- **Fix: `/pesanan/[id]` 404** — `getOrder` chained `.where()` after `.groupBy()` (landed as HAVING → 0 rows → every order detail 404'd). Now applies the filter before groupBy.
- **Next**: super-admin KiriminAja config + live "Test koneksi"; create-order (→ AWB/resi) + print shipping label PDF.

### Admin — functional global search (⌘K) + docs de-stale
- **Global search** (`lib/data/search.ts getSearchIndex()`, RLS-scoped: products/orders/customers) — the topbar search was cosmetic; now a real filter with a grouped dropdown (Produk/Pesanan/Pelanggan) linking to entity routes; ⌘K focuses, Esc/click-outside closes. Verified: "dress" → 3 product results.
- **Docs**: de-staled README/PRD/ARCHITECTURE/SCHEMA/BACKLOG/TASKS/AGENTS — 53→54 tables, migrations 0000–0016, `platform_admins` (0013); removed "writes pending/mock" (writes are done); BACKLOG marks variants / CSV / global search / super-admin control plane / storefront as done.

### Admin — CSV export (dead "Ekspor" buttons now work)
- New `lib/csv.ts exportCsv()` (client-side, UTF-8 BOM for Excel). Wired all 6 previously-inert **Ekspor** buttons to download the current data: **Pesanan** (filtered orders), **Pelanggan** (filtered customers), **Inventori** (products + live stock), **Analitik** + **Dashboard** (product performance), **Pemasaran** (ad-channel report incl. ROAS). Verified: `pesanan.csv` downloads with 60 rows + correct headers.

### Storefront — variant picker + fashion variant seed (end-to-end variants)
- **Seed**: all 14 Batik Nusantara (fashion niche) products now carry **real Warna × Ukuran variants** (`WARNA_BY_SLUG` × `STOREFRONT_META.sizes` → `product_options` + per-combo `product_variants` + inventory; position-0 = default so list/catalog/orders still read correctly).
- **Catalog** (`data/catalog.ts`) now reads each product's real `options` + `variants` (price/stock per combo), not just the default variant / legacy `products.sizes`.
- **Product page** (`produk/[handle].astro`) — legacy size buttons replaced with a **real variant picker**: one button group per option (Warna, Ukuran); selecting a combo resolves the variant and **live-updates price + a stock indicator** (Stok tersedia / Sisa N / Stok habis → disables add-to-cart). Falls back to legacy sizes for option-less products.
- **Cart is variant-aware**: add-to-cart stores the chosen combo; keranjang + checkout show "Varian: {combo}". Verified E2E: pick Sage/L on Dress Midi → stock "tersedia (32)", cart shows "Varian: Sage / L", console-clean. Storefront builds (29 pages).

### Admin — Real product variants (the deferred core commerce feature)
Schema already supported it (`product_options`, `product_variants` option1/2/3+sku+price, `inventory_levels`); the admin was the gap. Now fully wired:
- **Editor** (`produk/[id]/product-editor.tsx`) — the "Varian" section is a real, **adaptive TikTok-Shop/Shopee-style builder**: **locked to 2 option types** (e.g. Warna + Ukuran, "+" add hidden at 2), custom names, **chip values** (type + Enter to add, ✕ to remove, Backspace pops last), an auto-regenerating **cartesian variant matrix** with per-variant **SKU / harga / stok**, and a **"Terapkan ke semua"** bulk price/stock apply. Edits **hydrate** from saved variants. (`MAX_OPTIONS = 2`; data/actions still support 3 via option1/2/3.)
- **Product list** now shows the **"from" price (min variant)** + **total stock summed across variants** (`getProducts` aggregates) instead of only the default variant.
- **Data** (`lib/data/products.ts`) — `getProduct` returns `options[]` + `variants[]` (+ `hasVariants`); `Product` type extended.
- **Actions** (`lib/actions/products.ts`) — `ProductInput` gains `options`/`variants`; create inserts options + one variant per combo (+ inventory); **update reconciles by option-combo key** — matched variants update in place (keep stock/history), new combos insert, removed combos delete **only if not referenced by `order_line_items`** (else preserved).
- Verified E2E (Playwright → DB): create Ukuran×Warna → 6 variants + per-variant stock override persists; edit hydrates 6 rows; adding "Hijau" → 9 variants with the 6 originals matched (stock kept), **zero duplicates**. Build + console clean.

### Super Admin — store healthcheck + impersonation (connected to admin)
- **Multi-store seed**: 6 demo stores added alongside Batik Nusantara (accounts + owners + stats + invoices + orders), engineered for a realistic health spread (2 sehat / 2 perhatian / 3 bermasalah). The whole platform view (dashboard, plan/status distribution, invoices) is now real cross-store data.
- **Composite healthcheck** (`apps/super-admin/lib/health.ts`) — per-store verdict (Sehat/Perhatian/Bermasalah) + 0–100 score derived from DB signals: billing (overdue/failed invoices), activity (order recency), stock (out-of-stock products), subscription status. No live pings (single-machine local).
- **UI**: Toko list gets a Kesehatan column + health filter + Sehat/Perhatian/Bermasalah stat cards; store detail gets a Healthcheck panel (per-check breakdown + score bar); dashboard gets a "Kesehatan Platform" rollup + "Perlu perhatian" list.
- **Impersonation ("Buka panel admin")** — super-admin mints the admin session cookie for a store's owner (`lib/session.ts` + `lib/actions.ts`, shared `AUTH_SECRET`, localhost host-scoped cookie) and opens the admin (:3000) scoped to that store via RLS. Verified end-to-end (admin serves the impersonated owner, not Batik Nusantara). Admin app untouched.
- **Store lifecycle actions** — suspend/activate + change plan (super-admin's first mutations, owner connection cross-tenant). `verify-rls` still green; super-admin + admin builds clean; console-clean.

### Super Admin — functional control plane (provisioning, settings persistence, team, billing)
Audit found several read-only / fake-save surfaces; all now real writes (each gated by `requirePlatformAdmin()`), in `lib/actions.ts`:
- **Provisioning `createStore()`** — "Tambah toko" on the Toko page onboards a full tenant in one transaction (account + owner user + store + membership + location + settings + zeroed stats), status **Trial**, slug auto, owner password `tokophi123`; redirects to the new store. Was entirely missing.
- **Settings persistence `saveGateways()`/`saveCouriers()`** — the Pengaturan payment-gateway & courier toggles + Simpan now write `platform_payment_gateways`/`platform_couriers`/`platform_cod` (were `toast`-only fakes).
- **Platform team = real operators** — Tim Platform now reads `platform_admins` (`getPlatformAdmins()`) instead of a hardcoded array; "Undang" (`invitePlatformAdmin()`) inserts a real operator row.
- **Billing actions `setInvoiceStatus()`** — Paket invoice rows get a Tandai dibayar/menunggu/gagal menu (was display-only).
- Verified E2E (Playwright + DB): create store → trial store + owner persisted; toggle Duitku → `enabled=true`; invite → `platform_admins` row; mark INV-9006 → `dibayar`. Console-clean; reseeded to a pristine 7-store state.

### Super Admin — platform-admin auth (gaps closed) + impersonation-correct admin
- **Platform-admin auth**: `platform_admins` table (migration 0013) + seeded **admin@tokophi.id / tokophi123**; `lib/platform-auth.ts` uses a **distinct `platform_session` cookie** (separate from the admin `session` it mints for impersonation); login page + `signIn`/`signOut` + `middleware.ts` route protection. `requirePlatformAdmin()` now **gates** `impersonateStore`/`setStoreStatus`/`setStorePlan` (the earlier "unguarded" follow-up is resolved). Layout split into a server layout (reads session) + client `PlatformShell` (account menu + logout).
- **Admin reflects the session store**: `apps/admin/lib/data/store.ts getStoreName()` → the admin topbar store-switcher + dashboard greeting now show the *actual* store (so impersonating "Kopi Senja" shows Kopi Senja + owner Rangga + RLS-scoped data, not the hardcoded "Batik Nusantara"). Verified E2E via Playwright.
### Admin — full multi-store polish (store identity data-driven)
- **All "Batik Nusantara" identity hardcodes wired to the session store** via a `StoreProvider`/`useStoreName()` context (set once in the admin layout from `getStoreName()`): topbar store-switcher (now lists the active store only), dashboard greeting, **Pengaturan** (profile name + input), **product editor** vendor default, and **CRM** WhatsApp message fills (`crm/page` server-fetched; pipeline/followup via context/param). Verified impersonating Kopi Senja → Pengaturan + CRM show "Kopi Senja", zero "Batik Nusantara" leak.
- **NaN% fixed**: empty-store channel donut now shows `0%` instead of `NaN%` (guarded divide-by-zero in `channel-chart.tsx`).
- **Live activity feed is now real & per-store** (`lib/data/activity.ts getActivityFeed()`, RLS-scoped): derived from the store's own recent orders, signups, reviews, and low-stock — replacing the static mock. Verified impersonating Kopi Senja → feed shows its 3 orders ("Pelanggan dari Bandung…"), zero Batik product leak. (The "N pengunjung online" ticker stays a decorative realtime widget.)

### Rebrand: indostore → TokoΦ
- Full rename across the monorepo: display brand **TokoΦ** (φ symbol); identifiers `tokophi` (folder, npm scope `@indostore/*` → `@tokophi/*`, root pkg).
- **DB:** role `indostore_app` → `tokophi_app`; docker container/volume + Postgres user·pass·db → `tokophi`; `DATABASE_URL` updated. Owner login is now **ongki@batiknusantara.id / tokophi123**.
- Folder `~/projects/indostore` → `~/projects/tokophi` (git history kept); docs `~/Documents/Development/tokophi`. New **private** repo `ongkipro/tokophi` (old `ongkipro/indostore` abandoned).
- Added a **TokoΦ (Φ) favicon** (`app/icon.svg`, indigo) for admin + super-admin, replacing the create-next-app defaults.
- Verified: `migrate` + `seed` + `verify-rls` pass under `tokophi_app`; admin·super-admin·storefront build clean. Zero residual "indostore" across repo **and** external docs.

## 2026-07-04

### RLS runtime enforcement (local) — admin runs as the non-owner role
- **`apps/admin/lib/tenant.ts`** — `withCurrentTenant(fn)` (reads the session → runs inside `withTenant`) + re-exports `withTenant`. Every tenant query now runs in a transaction that sets `app.store_id` + `SET LOCAL ROLE tokophi_app`, so Postgres RLS **actually enforces at runtime** (the app process still connects as owner, but each tenant query drops to the restricted role — the exact VPS/PostgREST model).
- **All 14 admin `lib/data/*` reads** wrapped in `withCurrentTenant`; **all 13 `lib/actions/*` writes** wrapped in `withTenant(session.storeId, …)` (store_id from the RBAC session). `lib/auth.ts` (login, reads `store_users` pre-session) + super-admin (cross-tenant) + storefront (per-client build) intentionally stay on the owner connection.
- **`npm run verify-rls-app`** proves the actual `withTenant` path: own tenant reads its rows + writes/reads-back its own discount; a foreign tenant sees 0 of either; `WITH CHECK` blocks cross-store writes; cleanup ok. Playwright E2E: all admin pages render their data (customers 24 / inventori 14 / diskon 6 / …) with zero errors, and an in-app customer-note write persists — all through the restricted role. `build:admin`/`build:super`/storefront all clean.

### RBAC UI — role-aware controls
- **Client-safe policy** (`lib/rbac-policy.ts`) — the role→capability matrix + `can()` extracted so the UI and the server guard (`lib/rbac.ts`) share ONE source of truth.
- **`PermissionsProvider` + `useCan()` + `<Can>`** (`components/admin/permissions.tsx`) — role flows from the session (layout) to client components; the topbar shows a role badge (Pemilik/Admin/Staf/Gudang).
- **Gated across ALL admin editors** (write/delete/create controls hidden per role; server actions stay the security boundary): Produk (list+editor), Pengaturan (owner-only), Diskon, Halaman, Blog, Kategori (editors + list CTAs + row Hapus), Pelanggan (tag/catatan save), CRM follow-up (Tandai selesai), Segmen (Buat/Hapus), Pembelian (Buat PO / terima / batalkan), Inventori (Simpan stok), Navigasi (Simpan menu), Pesanan (advance status).
- **Verified** via Playwright across roles (owner/staff/gudang): e.g. Produk owner sees Simpan+Hapus, staff Simpan-only, gudang neither+no media; Diskon Buat = staff✓/gudang✗; Inventori & Pembelian = staff✗/gudang✓; owner all✓.

### M3 — RBAC + Row-Level Security (tenant isolation)
- **RBAC (`apps/admin/lib/rbac.ts`)** — capability model + role→capability matrix (owner=all · admin=all−settings · staff=shop ops (no product-delete / warehouse / settings) · gudang=inventori+pembelian only). `can(role, cap)` + `requireCapability(cap)` (returns the session JWT or throws `ForbiddenError`).
- **All 13 mutating action files gated** (`lib/actions/*`) — each mutation calls `requireCapability(...)`; store-scoped creates now take `store_id` from the session (removed the per-file "first store" helper).
- **RLS migration `0012_tenant_rls`** — non-owner `tokophi_app` role + grants, `app_current_store_id()` GUC reader, and `ENABLE ROW LEVEL SECURITY` + `tenant_isolation` policy (`USING` + `WITH CHECK` on `store_id`) across all **32 store-scoped tables**. Registered in the drizzle journal so `npm run migrate` applies it.
- **`withTenant(storeId, fn)`** (`packages/db/src/rls.ts`) — per-txn `set_config('app.store_id', …, true)` + `SET LOCAL ROLE tokophi_app`; ready for the VPS switch.
- **`npm run verify-rls`** proves isolation: right tenant → 14 products, wrong/no-GUC tenant → 0 (fail-closed), cross-tenant INSERT blocked by `WITH CHECK`. Verified; `build:admin` clean.
- At this stage RLS was policy-only (app connected as owner, bypassing it). **Superseded the same day** by the "RLS runtime enforcement" entry above — the admin now routes every read/write through `tokophi_app` via `withTenant`, so RLS enforces live. RBAC (app-layer) is enforced.

## 2026-07-03

### M3 — backend: local Postgres + Drizzle, super-admin live
- **Decision: prod backend = self-hosted PostgreSQL + PostgREST on a VPS (NOT Supabase).** Local dev already plain Postgres → same Drizzle migrations carry up, no rework. Reframed all docs + ADR 0007 + `.env.example` (dropped `NEXT_PUBLIC_SUPABASE_*`); Auth (JWT) / Storage (VPS/MinIO/S3) / RLS are self-hosted.
- **`@tokophi/db`** (Drizzle): 52 tables + 32 enums from SCHEMA.md, versioned migrations (`drizzle/0000..0002`), seed + reset. Root `docker-compose.yml` = PostgreSQL 16 @ :5433. **ADR 0007**.
- **super-admin wired to PostgreSQL**: new server-only `lib/data.ts`; `lib/mock.ts` slimmed to config; client pages split (`*-client.tsx` + server wrapper); all DB pages `dynamic="force-dynamic"`. Verified: build clean + parity + live-mutation test.
- **Schema deltas** for a faithful platform view: `stores.city`, `store_stats` rollup, `invoices.number`; `menu_items.parent_id` self-FK.
- **Per-client topology decided** — **ADR 0008** (one control plane + one multi-tenant admin + storefront-per-client on one shared DB). Docs refreshed: PRD, ARCHITECTURE (§9–10), UML (§1/§10 + provisioning sequence), SCHEMA, WORKLOG.
- **admin → DB (Produk)**: seeded catalog (14 products + variants/inventory/media, migration 0003 adds `products.emoji`/`units_sold`, `collections.emoji`); `apps/admin/lib/data/products.ts` (`getProducts`/`getProduct`); Produk list + editor now `force-dynamic` from Postgres (uuid routes). Verified parity + 0 console errors.
- **admin → DB (Diskon/Pelanggan/Kategori)**: seeded 24 customers, 6 discounts, 8 collections + 32 memberships; `lib/data/{discounts,customers,collections}.ts`; 6 more routes wired (list + detail/editor, server-wrapper + `*-client.tsx`, `force-dynamic`). Discount status/endsInDays + collection counts derived. Verified parity + 0 console errors.
- **admin → DB (Pesanan/orders)**: seeded 60 orders + 153 line-items + 60 payments (buildOrders parity, linked to customers/variants); `lib/data/orders.ts` (`getOrders`/`getOrder`); Pesanan list + detail wired (`/pesanan/INV-4819`, `force-dynamic`). Verified parity + 0 console errors.
- **admin → DB (Halaman/Blog)**: migration 0004 (`pages.template`/`views`, `articles.comments`); seeded 7 pages + 2 blogs/6 articles; `lib/data/{pages,articles}.ts`; Halaman + Blog list + editors wired (`force-dynamic`). Verified parity + 0 console errors.
- **admin → DB (Inventori/CRM)**: Inventori reuses `getProducts`; migration 0005 (`followups.last_message`); seeded 12 leads + 10 followups + 6 wa_templates; `lib/data/crm.ts`; 5 routes wired (Inventori + CRM overview/Follow-up/Pipeline/Template). Verified parity + 0 console errors.
- **admin → DB (Pembelian/Segmen/Ulasan)**: migration 0006 (`customer_segments.growth`, `reviews.product_name`/`emoji`); seeded 4 suppliers + 6 POs + items, 6 segments, 8 reviews; `lib/data/{purchases,segments,reviews}.ts`; 3 routes wired. Verified parity + 0 console errors.
- **admin → DB (Navigasi)**: seeded menus/menu_items (recursive, 2 menus / 17 items from canonical MAIN_MENU/FOOTER_MENU); `lib/data/menus.ts` reconstructs the `NavMenu[]` tree from flat menu_items; Navigasi builder wired (`force-dynamic`). Verified parity + 0 console errors.
- **admin → DB (Dashboard/Analitik)**: new `analytics_daily` rollup table (migration 0007) seeded with the 120-day series; refactored `lib/data/dashboard.ts` to pure functions (data passed in) + `lib/data/analytics.ts`; Dashboard + Analitik split into server-wrapper + `*-client.tsx` (`force-dynamic`), reading daily-stats/products/orders from DB (live-feed + funnel/region/ROAS breakdowns kept mock). Verified parity + 0 console errors.
- **admin → DB (Pemasaran) — ADMIN NOW 100% DB-BACKED**: migration 0008 (`ad_channels` +name/brand/pixel/aggregate/`campaigns` jsonb; `ad_metrics.channel_key` nullable); seeded 3 ad-channels + 11 per-province rollup rows; `lib/data/marketing.ts` (`getAdChannels`/`getProvinceStats`); Pemasaran split (server-wrapper + `pemasaran-client.tsx`, `force-dynamic`), sub-tabs threaded with props. Verified parity + 0 console errors. **All 16 admin modules read PostgreSQL** (54 tables).
- **Local media upload (product images)**: `lib/actions/media.ts` — `uploadProductImage` writes real files to `apps/admin/public/uploads/` (gitignored, 5MB image cap) + inserts a `product_media` row; `deleteProductImage` removes the row + file. Seed now loads 5 media rows/product (base + `-2..-5`); `getProduct` returns `media[]`; product editor Media section shows the real rows with an "Unggah" button + per-image delete. Verified via UI (upload → 5→6 tiles + row + file; delete → 6→5 + gone). VPS storage = MinIO/S3 later.
- **Local admin auth (login + session + route protection)**: migration 0011 (`users.password_hash`, scrypt); seeded owner **ongki@batiknusantara.id / tokophi123**. `lib/auth.ts` (verify/findLogin/jose-JWT session in httpOnly cookie), `lib/actions/auth.ts` (signIn/signOut), `app/login/page.tsx`, `middleware.ts` (edge JWT check → `/login`). Topbar shows the user + logout. Verified: unauth→/login, wrong-pw error, login→dashboard, logout. `AUTH_SECRET` env. Aligns with the VPS/PostgREST JWT plan; RBAC+RLS next.
- **Mutations — Pembelian PO builder · ALL ADMIN EDITORS NOW PERSIST**: `lib/actions/purchases.ts` — `createPurchaseOrder` (line items → `purchase_orders`+`po_items`), `receivePurchaseOrder` (status→diterima + adds each line qty to `inventory_levels`), `cancelPurchaseOrder` (delete). Rebuilt the PO dialog into a real line-item builder (product picker + qty + HPP + live total); wired row "Tandai diterima"/"Batalkan". Verified via UI (create PO ×7 → receive → stock 22→29 → cancel). **All 12 admin editors now persist writes** via server actions.
- **Mutations — CRM follow-up + Segmen persist**: `lib/actions/{crm,segments}.ts` (`"use server"`). CRM "Tandai selesai" writes `followups.status`; Segmen "Buat segmen" dialog creates a `customer_segments` row + card "Hapus" deletes it. Verified via UI (follow-up selesai 1→2; segment create + delete). **11 write operations now persist.** (Pembelian PO deferred — needs a real line-item builder.)
- **Mutations — Navigasi menu + Pelanggan tags/notes persist**: `lib/actions/{menus,customers}.ts` (`"use server"`). Navigasi "Simpan menu" replaces the whole `menu_items` tree (delete + recursive re-insert with parent_id/position); Pelanggan detail persists tags/notes (migration 0010 added `customers.tags` jsonb + `notes`, seeded `tags=["pelanggan",<segment>]`, added a Simpan button). Verified via UI (delete Kontak → 12→11 items; add tag/note). **9 write operations now persist.**
- **Mutations — order status + Inventori stock + Kategori persist**: `lib/actions/{orders,inventory,collections}.ts` (`"use server"`). Order detail's primary action advances status (baru→diproses→dikirim→selesai); Inventori tracks dirty rows + a "Simpan N perubahan" button writes stock to `inventory_levels`; Kategori editor persists the core collection (create/edit/delete). Verified via UI (INV-4789→diproses, stock 22→27, collection create+delete). **7 write operations now persist.**
- **Mutations — Diskon + Halaman + Blog create/edit/delete persist**: `lib/actions/{discounts,pages,articles}.ts` (`"use server"`) → Drizzle + `revalidatePath`; each editor's Simpan/Hapus wired (`useRouter`/`useTransition`). Diskon maps status+period→dates; new articles go to the store's first blog. Hard delete (no history FK). Verified via UI (create discount/page/article + delete). 4 editors now persist (Produk + these 3).
- **Mutations — Produk create/edit/delete persist**: `apps/admin/lib/actions/products.ts` (`"use server"`) → Drizzle insert/update on products+variant+inventory+media + `revalidatePath`; product editor Simpan/Hapus wired (`useRouter`/`useTransition`). Delete = archive (products referenced by order line-items); `getProducts` filters archived. Verified end-to-end via UI (create → edit price → delete). Establishes the write pattern for the remaining editors.
- **storefront → DB — ALL THREE SURFACES NOW READ POSTGRESQL**: migration 0009 enriches `products` (`sizes` jsonb, `badge`, `bestseller`, `rating_value`, `rating_count`) + seeds `description`/`compare_at`/collection blurbs; `apps/storefront/src/data/catalog.ts` rewritten to read `@tokophi/db` via top-level await (same exports → ~12 `.astro` consumers unchanged); `astro.config` surfaces `DATABASE_URL` + `ssr.external:["postgres"]`. `astro build` clean (29 pages from DB); home + product verified — 0 console errors, parity. **Reads are done end-to-end.** Next: mutations persist, self-hosted Auth + Storage + Postgres RLS.
- **docs perfected** — de-staled all docs to current backend state (no more "backend deferred / 51 tables / 9 modules"); AGENTS/PRD/ARCHITECTURE/GUIDE/UML/UI_INVENTORY/DATA_MODEL/TASKS/BACKLOG/README reflect 52 tables + super-admin + 12 admin modules; wiring pattern documented.
- storefront: product **ratings** (stars on cards + product-detail reviews summary) — data-driven from `catalog.ts`.

## 2026-07-01

### M1.5 — docs refresh + backlog
- Docs brought current (2026-07-02): PRD status/roadmap (+M1.5), README status, CONCEPT, UI_INVENTORY, and a new **BACKLOG.md** (prioritized P0–P3 task board from a full screening). AGENTS: ProductThumb/images/toast/Indonesian-slug conventions.

### M1 — Indonesian collection slug + product added-date filter
- Collection (Kategori) storefront slug is now Bahasa Indonesia: /kategori/ (was /collections/).
- Products carry a deterministic addedTs (date+time added). Product list shows "Ditambahkan <tgl>" on cards and a "Ditambahkan" column (date+time) in the table view, plus a date-range filter (Semua/7/30/90 hari). Helpers dateTimeShort/dateShort in lib/format.

### M1 — CRM (WhatsApp follow-up) + concept docs + channel model
- New CRM module (submenu): Overview, Follow-up WA (wa.me deep links + templates), Pipeline kanban, Template WA.
- Concept matured in docs/: CONCEPT.md, SCHEMA.md (backend-ready, proves backend-defer is safe), UI_INVENTORY.md.
- Channel model clarified: sales channel = Toko Online only; analytics attribution = Meta Ads / TikTok Ads / Google Ads / Organic / Other (Dashboard/Analitik "Sumber Penjualan", Pesanan "Sumber").

### M1 — Collection editor + SEO alignment
- Kategori upgraded to Shopify-style Collections: full editor at /produk/kategori/[id] (SSG) + /produk/kategori/baru — Manual/Otomatis type, automated conditions builder (all/any + field/operator/value), product members/preview, image, publish/channels/template, SEO. List rows -> editor; Buat kategori -> full page.
- SEO "Pratinjau mesin pencari" card moved into the main content column (col-span-2) across all 4 editors -> aligned with the content width, not full-width.

### M1 — Shopify-style submenus + province filter
- Sidebar submenus (expandable, auto-open in section): Produk → Kategori / Inventori / Pembelian; Pelanggan → Segmen / Ulasan. 5 new sub-pages (collections, inventory w/ stock stepper, purchase orders, customer segments, review moderation).
- Pemasaran: filter by Indonesian province (rescopes KPIs) + "Performa per Provinsi" table. Mock PROVINCES/AD_PROVINCES.
- Fix: DropdownMenuLabel -> plain <div> (Base UI Menu.GroupLabel threw "MenuGroupContext missing" when opened standalone) — fixes latent error across all dropdowns.

### M1 — Editor refinements
- SEO "Pratinjau mesin pencari" moved from the sidebar to a full-width card **below the content** in Blog/Halaman/Produk editors (Shopify-style; blog card renamed from "SEO").
- Product editor **"Tindakan lainnya" dropdown** (edit mode): Ubah kategori, Perbarui stok/inventori (set/tambah/kurangi + reason, live new stock), Buat pesanan pembelian (Purchase Order: pemasok/jumlah/biaya-unit/ETA + live total), + Duplikat/Arsipkan. Mock dialogs.

### M1 — Produk list UI/UX polish
- Status tabs w/ counts (Semua/Aktif/Draft/Stok Menipis) + clickable stat-card quick-filters; sort dropdown; active filter chips w/ clear.
- Bulk selection (grid hover-checkbox + list checkboxes) with a selection action bar (Jadikan Aktif/Draft, Hapus, Batal) + selected-row highlight.
- Richer grid cards (large image tile, price+stock inline, terjual count, Draft dim/overlay); refined list table (Kategori col, responsive).
- Mock: curated 2 drafts + 2 low-stock for meaningful tabs/badges. Console + build clean.

### M1 — Product editor
- **Full Shopify-style product editor** at `/produk/[id]` (edit, SSG per product via `generateStaticParams`) and `/produk/baru` (new): title + rich-text description, media, pricing (live margin/profit), inventory (SKU/barcode/qty + low-stock hint), variants toggle + builder, shipping, and sidebar (status Aktif/Draft, sales channels, organization/category/vendor/tags, SEO with Google preview + auto-slug). Delete in edit mode.
- Wired the Produk list: product cards + table rows navigate to the editor (stretched-link overlay so the ⋯ actions still work, console-clean); "Tambah Produk" now opens the full `/produk/baru` page (replaced the quick-add dialog). 31 routes; build + tsc + console clean.

### M1 — Marketing & analytics
- **Pemasaran** (new menu, Utama group) — ads + conversion tracking for **Meta / Google / TikTok**:
  - *Ringkasan* — blended spend/revenue/ROAS/conversions + spend-vs-revenue bar chart + channel comparison table (belanja/impresi/klik/CTR/CPC/konversi/pendapatan/ROAS).
  - *Saluran Iklan* — per-channel cards (connection status, ROAS/CPA, top campaigns, connect/manage).
  - *Pelacakan* — pixel/tracking setup (Meta Pixel + Conversions API, Google Tag GA4 + Google Ads conversion, TikTok Pixel + Events API).
- **Analitik expanded** — conversion funnel, sales by region (Indonesian cities), device split + new-vs-returning, and an ad-performance (ROAS) summary linking to Pemasaran.
- Mock added: `AD_CHANNELS`, `FUNNEL`, `REGION_SALES`, `DEVICE_SPLIT`, `NEW_VS_RETURNING`. 14 routes; build + tsc + console clean.

### M1 — Content section ("Toko Online")
- Screened real Shopify content structures via Shopify CLI (`shopify store execute`): `Page`, `Blog`/`Article`, `Menu` + `MenuItemType` enum — used to model the UI faithfully.
- **Halaman** — pages list + Shopify-style two-column editor (content, visibility, template, SEO Google-preview, auto-slug). Routes `/halaman`, `/halaman/baru`.
- **Blog** — posts list (blog tabs, authors, comments) + article editor (content, excerpt, featured image, tags, SEO). Routes `/blog`, `/blog/baru`.
- **Navigasi** — menu builder (Menu Utama/Footer, nested typed items, typed link picker, add/edit/delete in local state). Route `/navigasi`.
- Sidebar regrouped into `NAV_GROUPS` (Utama / Toko Online / Sistem).
- Mock data added: `PAGES`, `BLOG_POSTS` + `BLOG_CATEGORIES`, `MENUS` + `NavItem`/`NavMenu`/`NavItemType`.
- Fix: Base UI `nativeButton={false}` on `Button` rendered as `Link` (removed the dev-overlay "1 Issue" console error). Build + tsc + console all clean (13 routes).

### M1 — Core modules
- **Pesanan** — status tabs + counts, filters, table, detail Sheet (line items + timeline), pagination.
- **Produk** — stat cards, filters, grid/list toggle, product cards, add-product Dialog.
- **Pelanggan** — segment tabs, stat cards, sortable table, profile Sheet.
- **Diskon** — usage progress, status tabs, create-discount Dialog.
- **Analitik** — KPIs + sales trend + category bar chart + channel donut + top products (reuses dashboard components/data layer).
- **Pengaturan** — Tabs: Profil / Pembayaran / Pengiriman / Pajak / Pengguna (Indonesian couriers + e-wallets/QRIS/COD).
- Mock data extended: `CUSTOMERS`, `DISCOUNTS`.

### M0 — Scaffold + Dashboard
- Monorepo skeleton; `admin/` = Next.js 16 (App Router, Turbopack) + Tailwind v4 + shadcn/ui (Base UI) + Recharts + lucide + date-fns. Indigo brand accent.
- Admin shell: grouped sidebar, topbar (store switcher, search, notifications, account, dark-mode toggle), responsive drawer.
- **Dashboard** (flagship): KPI cards + SVG sparklines, Facebook-style date-range switcher (Hari ini/Kemarin/7d/30d/Bulan ini/Bulan lalu + compare-to-previous), sales area chart (current vs prev), live activity feed w/ realtime ticker, recent orders, top products, channel donut, order-status breakdown, monthly target.
- Deterministic seeded mock (`lib/mock/store.ts`, anchored `TODAY=2026-06-30`) + thin data layer (`lib/data/`) + `IDR`/id-ID formatting.

## Unreleased / next
- M2: sample Astro storefront; deepen admin interactions (submitting forms → state, detail pages).
- M3: self-hosted Postgres/PostgREST backend (auth + DB + RLS `store_id`) replacing the mock data layer.
- M4: payments/couriers integration, multi-store provisioning, storefront deploy pipeline.

## 2026-07-02 — Monorepo + Super Admin
- Restructured to a **monorepo** (npm workspaces): apps/admin + apps/super-admin + packages/ui (shared shadcn/Base UI) + packages/lib (formatters). Both apps build.
- **Super Admin** platform control plane (Dashboard/Toko/Paket & Billing/Analitik/Pengaturan) on the shared design system; 18 mock merchant stores; runs on :3001.
- Docs: AGENTS/README/PRD/BACKLOG updated for the monorepo + 3-surface model.
- Docs: PRD v0.3 (payments/shipping model + doc links), **UML.md** (Mermaid: components/ER/sequence/deployment/roles), **TASKS.md** (prototype task breakdown, Epics 0–6).
