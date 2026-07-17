# Changelog — TokoΦ

All notable changes. Dates are absolute. Phase: local backend done (Postgres + Drizzle, RBAC + RLS enforcing) · **rebranded to TokoΦ 2026-07-08** · focus = admin-client feature depth (VPS infra deferred).

## 2026-07-17

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

### 🤖 Checkout robots: `noindex,follow`, not `noindex,nofollow`

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
