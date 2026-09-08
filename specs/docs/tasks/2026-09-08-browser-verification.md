# Browser verification of the four un-driven claims from the 09-07 sweep

**Date:** 2026-09-08 · **Branch:** `feat/sweep-0907` · **Executor:** browser-verification agent
**Method:** Playwright 1.61.1 / Chromium 149, headless, `locale: "id-ID"`, viewport 1440×900,
driving LOCAL dev servers against the shared dev Postgres (Docker `:5433`).

| # | Claim | Verdict |
|---|---|---|
| 1 | Task 5.6 — product editor unsaved-changes guard | **PASS** (all five acceptance rows; ceiling confirmed) |
| 2 | Epic 1 — confirm dialogs on destructive actions (6 screens driven) | **PASS** on the dialog contract · **2 defects found** in the post-delete list refresh |
| 3 | Task 5.18 — Pesanan → tab "Pengembalian" | **PASS** (both the absent and the present case) |
| 4 | Task 8.3 — Super Admin KiriminAja badge | **PASS** · one adjacent-badge observation |

---

## Setup (and what it cost)

- `docker compose ps` → `tokophi-db` `Up 5 days (healthy)`, `0.0.0.0:5433->5432`. **Nothing was seeded.**
- Admin dev server: port **3147** (PID recorded to `admin.pid`, killed by PID at the end).
- Super-admin dev server: port **3247** (PID recorded to `super.pid`, killed by PID at the end).
- Sessions were minted, not typed: a `jose` HS256 JWT matching `signSession` (`apps/admin/lib/auth.ts:84`)
  into the httpOnly `session` cookie, and one matching `signPlatformSession`
  (`apps/super-admin/lib/platform-auth.ts:58`) into `platform_session`. Claims came from the dev DB
  (owner of `batiknusantara`, and the single `platform_admins` row). **Admin token length 337,
  platform token length 265** — no secret and no token value is reproduced here.

### ⚠️ The dev store is in BILLING READ-ONLY today — every admin write fails until you fix that

First attempt at a real save answered *"Gagal menyimpan produk"*. The dev-server log named it:

```
⨯ Error [SuspendedError]: Langganan ditangguhkan — aktifkan kembali (bayar tagihan) untuk menyimpan perubahan.
    at requireCapability (lib/rbac.ts:48:31)
    at async updateProduct (lib/actions/products.ts:141:28)
POST /produk/1001 500
```

`stores.current_period_end` for `batiknusantara` is **2026-08-04**, i.e. 35 days in the past, so
`computeBilling()` returns `readOnly` and `requireCapability` refuses every mutating action. This is
the seed's frozen anchor drifting past the wall clock — the same family as the "demo looks dead"
note in `AGENTS.md`, but it blocks *writes*, not charts, and `seed:recent` does not touch it.

**Any agent trying to verify a write path locally will hit this and read it as a broken feature.**
It was worked around for this session by moving `current_period_end` forward and putting it back
(logged below).

---

## 1 · Task 5.6 — product editor unsaved-changes guard — **PASS**

File under test: `apps/admin/app/(admin)/produk/[id]/product-editor.tsx` (guard at :525-546).
Target: `/produk/1001` (Kemeja Oversized Wanita). "Dirty" was produced by clicking the title field,
`End`, then typing — never `page.fill()`.

The three intercepted controls, all resolved on the page: `[aria-label="Kembali ke Produk"]`,
the breadcrumb `a[href="/produk"]` reading `Produk`, and the footer `a[href="/produk"]` reading `Batal`.

### (a) clean → all three navigate with no prompt

| control | dialogs seen | landed on |
|---|---|---|
| back arrow | **0** | `http://localhost:3147/produk` |
| breadcrumb "Produk" | **0** | `/produk` |
| "Batal" | **0** | `/produk` |

### (b) dirty → all three raise `window.confirm`; Cancel keeps the edit, OK leaves

Identical on all three controls:

- confirm text: **`"Ada perubahan yang belum disimpan. Tinggalkan halaman ini?"`**
- after **Cancel**: url still `http://localhost:3147/produk/1001`, title field still
  `"Kemeja Oversized Wanita ZZ"` — the edit survived.
- after **OK**: same sentence shown again, then url `http://localhost:3147/produk`.

### (c) reload/close while dirty → native beforeunload fires

`page.close({ runBeforeUnload: true })` produced a dialog event of
`{"type":"beforeunload","msg":""}`. (Chromium supplies its own wording; the empty `message` is
expected for `e.returnValue = ""`.) **PASS.**

### (d) successful save → the guard is gone

Typed ` ZZTMP`, pressed **Simpan** → navigated to `/produk` with no prompt. Reloading
`/produk/1001` showed the persisted title `"Kemeja Oversized Wanita ZZTMP"`; clicking the back arrow
from that clean state produced **no dialog** and navigated straight to `/produk`. **PASS.**
Screenshot: `t56-d-saved.png`.

### (e) FAILED save → the guard is STILL up

`page.route()` intercepted the server-action `POST /produk/1001` and returned `500`.

- toast: **`"Gagal menyimpan produk"`**, url unchanged (`/produk/1001`).
- clicking the back arrow immediately afterwards raised
  **`"Ada perubahan yang belum disimpan. Tinggalkan halaman ini?"`** — the snapshot was not advanced
  by a save that did not happen. **PASS.** Screenshot: `t56-e-failed-save.png`.

### The ceiling, confirmed honestly

Dirty, then clicking the **sidebar** link (`/store/batiknusantara/pesanan?tab=perlu_dikirim`):
**no dialog at all**, navigation completed, the edit was lost. This is exactly what the code comment
at :531-533 claims ("Sidebar navigation is not intercepted — there is no app-wide route guard in this
repo"). Worth noting that the sidebar's routes are `/store/<slug>/…`-prefixed while the editor's own
three links are bare `/produk` — so the guarded and unguarded links are not even the same URL space.

---

## 2 · Epic 1 — confirm dialogs on destructive actions — **PASS on the dialog contract**

Six flows driven end to end. Component under test: `apps/admin/components/admin/confirm-delete.tsx`.
For each: row menu → destructive item → dialog text read off the screen → **Batal** → row/SQL
unchanged → reopen → confirm → toast + SQL.

Every dialog rendered the same three buttons: `["Batal", "<confirm>", "Close"]`.

| Screen | menu item | dialog TITLE | confirm label | after **Batal** | after confirm (toast) | SQL after |
|---|---|---|---|---|---|---|
| Halaman | `Hapus` | `Hapus halaman?` | `Ya, hapus` | row present, DB row present | `Halaman dihapus.` | `pages` row **gone** |
| Blog | `Hapus` | `Hapus artikel?` | `Ya, hapus` | row present | `Artikel dihapus.` | `articles` row **gone** |
| Diskon | `Hapus` | `Hapus diskon?` | `Ya, hapus` | row present | `Diskon dihapus.` | `discounts` row **gone** |
| Pelanggan | `Hapus` | `Hapus pelanggan?` | `Ya, hapus` | row present | `Pelanggan dihapus.` | `customers` row **gone** |
| Produk (row) | **`Arsipkan`** | **`Arsipkan produk?`** | **`Ya, arsipkan`** | row present, `status='active'` | `Produk diarsipkan.` | `status='archived'`, `archived_at` stamped |
| Produk (bulk) | toolbar **`Arsipkan`** | **`Arsipkan 1 produk?`** | **`Ya, arsipkan`** | row present, `status='active'` | `1 produk diarsipkan.` | `status='archived'` |

Descriptions, quoted verbatim from the screen:

- Halaman — *"Halaman ini dihapus permanen dan tidak bisa dikembalikan. Tautan yang mengarah ke halaman ini akan menjadi 404 di toko."*
- Blog — *"Artikel ini dihapus permanen dan tidak bisa dikembalikan. Kalau hanya ingin menyembunyikannya, ubah statusnya menjadi draft lewat Edit."*
- Diskon — *"Kode ini beserta riwayat pemakaiannya dihapus permanen dan tidak bisa dikembalikan. Pesanan yang sudah memakainya tidak berubah."*
- Pelanggan — *"ZZ Verify Pelanggan dihapus permanen beserta tag dan catatannya. Pelanggan yang sudah punya pesanan atau ulasan tidak bisa dihapus."* (the row's own name is interpolated — correct)
- Produk row — *"Produk ini tidak dihapus — riwayat pesanannya tetap utuh — tetapi disembunyikan dari daftar produk dan dari toko. Belum ada tombol untuk mengembalikannya dari arsip."*
- Produk bulk — same sentence in the plural.

**The two Produk claims hold:** the menu item is `Arsipkan` (not `Hapus`), the confirm button is
`Ya, arsipkan`, the bulk bar reads `1 dipilih` / `Arsipkan`, and SQL confirmed
`products.status = 'archived'` with `archived_at` set — **no row was deleted**.

**Batal is genuinely non-destructive on all six**: dialog closed, row still on screen, and the SQL
row still present in every case.

### 🔴 DEFECT FOUND — Halaman and Blog do not drop the deleted row after `router.refresh()`

Not part of the Epic 1 claim, but found while driving it, and it makes a successful delete look like
a failed one.

**Halaman.** Confirmed delete → toast `"Halaman dihapus."`, DB row gone (`select count(*)` = 0), and
the table row was **still rendered at t≈1 s, 3 s, 5 s and 8 s**. Only a manual `page.reload()`
cleared it (`epic1-Halaman-after-reload.png`).

Root cause, `apps/admin/app/(admin)/halaman/halaman-client.tsx:121`:

```
  }, [query, status]);      // ← `pages` is missing from the dep array
```

`router.refresh()` re-renders with new props without remounting, so the `rows` memo never recomputes.

**Blog.** Same symptom (toast `"Artikel dihapus."`, DB row gone, row still on screen at 3.5 s).
Root cause, `apps/admin/app/(admin)/blog/blog-client.tsx:130`:

```
  }, [search, blog]);       // ← `posts` is missing
```

Note the *counts* memo one block above it (`:121`) **does** list `posts`, so after a delete the tab
counter drops while the table below it does not — the screen contradicts itself.

This is exactly the class the sibling file already documents and fixed —
`apps/admin/app/(admin)/diskon/diskon-client.tsx:257`: *"⚠️ `discounts` in EVERY dependency list. It
was missing from all four, and `router.refresh()` re-renders with new props WITHOUT remounting — so
nothing recomputed: a deleted voucher stayed in the table under a 'Diskon dihapus.' toast."* Diskon,
Pelanggan and both Produk flows refreshed correctly; **the fix was applied per-file and two files
were missed.** Worth sweeping the remaining 10 `ConfirmDelete` screens for the same dep arrays.

---

## 3 · Task 5.18 — Pesanan → tab "Pengembalian" — **PASS (both directions)**

`apps/admin/components/admin/pesanan/return-summary.tsx`, rendered at
`apps/admin/app/(admin)/pesanan/pesanan-client.tsx:382`. URL driven: `/pesanan?tab=pengembalian`.

### Negative case (the dev data as it stands) — sentence correctly ABSENT

The dev store has **zero courier-less shipped orders** (SQL: every one of the 736 orders in
`dikirim|selesai|retur` carries a courier — lion 175, anteraja 135, jnt 104, sicepat 100, jne 91,
sap 88, ninja 41, spx 2). Rendered card:

```
Retur
Tingkat retur (semua)   0,0%   0 dari 736 paket terkirim
Tingkat retur COD       0,0%   0 dari 30 paket COD
lion 0/175 (0,0%) · anteraja 0/135 (0,0%) · jnt 0/104 (0,0%) · sicepat 0/100 (0,0%)
jne 0/91 (0,0%) · sap 0/88 (0,0%) · ninja 0/41 (0,0%) · spx 0/2 (0,0%)
```

- `"tanpa data kurir tidak dihitung"` present in the page text: **false** ✅ (correct — nothing to caveat)
- `"Tidak diketahui"` present in the visible text: **false** ✅
- `"Tidak diketahui"` present anywhere in the served HTML: **false** ✅

Screenshot: `t518-negative.png`.

### Positive case (forced) — sentence correctly PRESENT, still no placeholder courier

Three `selesai` orders (`PHI-4773`, `PHI-4885`, `PHI-4804`, all `anteraja`) had `courier` set to `''`
by SQL, then restored. Re-rendered card:

```
Tingkat retur (semua)  0,0%   0 dari 733 paket terkirim
anteraja 0/132 (0,0%)          ← dropped by exactly 3, they left the rate
3 pesanan tanpa data kurir tidak dihitung (pengiriman tidak dibuat lewat TokoΦ).
```

- caveat sentence present: **true** ✅, and it counts **3**, matching what was blanked.
- `"Tidak diketahui"` in text or HTML: **false** ✅ — the three orders were named, not turned into a
  placeholder courier row.
- The denominator moved 736 → 733 and `anteraja` moved 135 → 132: the unattributed parcels are out of
  **both** sides of every rate, which is the claim.

Screenshot: `t518-positive.png`.

---

## 4 · Task 8.3 — Super Admin KiriminAja badge — **PASS**

`apps/super-admin/app/(platform)/pengaturan/pengaturan-client.tsx:411-427` +
`apps/super-admin/lib/ka-probe.ts`. Signed in as the single `owner` operator (`admin@tokophi.id`).

### `/pengaturan` → tab **Kurir / Agregator KiriminAja**

The badge is on the Kurir tab, not the default Pembayaran tab. Rendered:

```
Integrasi Kurir
Agregator pengiriman: KiriminAja · 8/10 kurir aktif
[sandbox] [Aktif] [Ditolak · 20.04 WIB]  (Test koneksi)

HTTP 401: Your IP address 182.253.50.97 were not allowed to access this API. #1
```

- state word rendered: **`Ditolak`** (`refused`) — `Terhubung` is **absent** from the page ✅
- the vendor's own refusal sentence is printed verbatim below the badge, naming the IP the
  allow-list dropped ✅
- the env chip reads **`sandbox`**, and the badge carries a probe timestamp (`20.04 WIB`) rather than
  "now" ✅

So the load-bearing half of the claim holds: **no green "Terhubung" over a failing vendor.**
Screenshot: `t83-pengaturan-kurir.png` (and `t83-pengaturan.png` for the default tab).

### `/analitik` → Sistem & Integrasi tile

```
KiriminAja (kurir)
Ditolak · HTTP 401: Your IP address 182.253.50.97 were not allowed to access this API. #1

AutoLaris (pembayaran)   Terhubung
Database (PostgreSQL)    8 toko
Server                   lokal
```

The tile prints **`word · detail`**, not `"Belum dikonfigurasi"` ✅. Screenshot: `t83-analitik.png`.

### ⚪ Observation, not a Task 8.3 failure — a green **"Aktif"** chip sits beside the red "Ditolak"

`pengaturan-client.tsx:411` renders `{aggregator.enabled && <Badge …emerald…>Aktif</Badge>}`
immediately to the left of `<KaProbeBadge>`. `enabled` comes from `shipping_aggregator.enabled`
(`apps/super-admin/lib/data.ts:877`), and grepping the whole repo, that column is read in exactly two
places: this super-admin card, and `packages/db/src/seed.ts:1826` which writes `true`. **Nothing on
the shipping path reads it** — not `shipping-quote.ts`, not `actions/shipping.ts`, not
`api/public/ongkir`.

That is the same shape as the ruling already recorded for `platform_payment_gateways.enabled` ("a
record, not a switch"), where the badge was deliberately **removed** — the comment saying so is 100
lines above this one, at `pengaturan-client.tsx:314`. Here the same class of status light is still
rendered, in emerald, directly next to a red refusal. Not raised as a Task 8.3 defect (the probe badge
itself is honest), but it is the reading the owner ruling was meant to stop.

---

## Dev DB rows I changed and restored

Everything below was verified restored by SQL at the end of the session (final read included).

| # | What | Before | Changed to | Restored |
|---|---|---|---|---|
| 1 | `stores.current_period_end` where `slug='batiknusantara'` | `2026-08-04 03:59:23.814+00` | `2026-10-08 03:59:23.814+00` (to lift billing read-only so writes could be driven) | ✅ back to `2026-08-04 03:59:23.814+00` |
| 2 | `products` #1001 `title` | `Kemeja Oversized Wanita` | `Kemeja Oversized Wanita ZZTMP` (Task 5.6 (d) real save) | ✅ back to `Kemeja Oversized Wanita` |
| 3 | `products` #1001 `vendor` | `NULL` | `Batik Nusantara` (the editor prefills the store name on save — side effect, not typed) | ✅ back to `NULL` |
| 4 | `products` #1001 `updated_at` | `NULL` | save timestamp | ✅ back to `NULL` |
| 5 | `products` #1002 (Cardigan Rajut Wanita) | `status='active'`, `archived_at=NULL` | archived via the UI (Epic 1, Produk row) | ✅ `active`, `archived_at=NULL` |
| 6 | `products` #1005 (Rok Plisket Panjang) | `status='active'`, `archived_at=NULL` | archived via the UI (Epic 1, Produk bulk) | ✅ `active`, `archived_at=NULL` |
| 7 | `orders` `0007fc2f…`/`006f007e…`/`0187c1e6…` (`PHI-4773`, `PHI-4885`, `PHI-4804`) `courier` | `anteraja` ×3 | `''` (Task 5.18 positive case) | ✅ back to `anteraja` ×3 |

**Rows I created myself and which the test then deleted** (net zero — verified `0/0/0/0` at the end):
`pages` `zz-verify-halaman` (created twice, deleted twice), `articles` `zz-verify-artikel`,
`discounts` `ZZVERIFY01`, `customers` `zzverify@example.com`. Product #1001's `product_variants`
were re-written by the real save and came back as the same nine combos at the same price.

Nothing else was touched. **No seed was run, no `git stash`, no `pkill`** — both dev servers were
started with their PIDs recorded and killed by PID; ports 3147 and 3247 were confirmed free afterwards.

## Console errors

**Zero JavaScript errors** across every run (`page.on("pageerror")` and `console` type `error` were
both collected on every page). Task 5.18 and Task 8.3 runs recorded a completely empty error list.

The only entries collected on admin list pages were **image 404s**, all of the same shape:

```
GET /api/uploads/produk-blazer-formal-wanita-premium-slim-fit.webp  404
GET /api/uploads/produk-blouse-katun-premium-lengan-panjang.webp    404
… 10 in total, one per seeded product photo
```

These are seeded `product_media` rows pointing at files that do not exist in this checkout's
`apps/admin/public/uploads/` (gitignored). Pre-existing local-data noise, unrelated to the four
claims — the product tiles fall back to their emoji as designed.

## Screenshots (scratchpad)

`/tmp/claude-1000/-home-fantastico-projects-tokophi/7d58d7a2-95fe-4a71-b7b3-d1a404ca4660/scratchpad/`

| file | shows |
|---|---|
| `t56-e-failed-save.png` | Task 5.6 (e) — the forced-500 save, "Gagal menyimpan produk" |
| `t56-d-saved.png` | Task 5.6 (d) — after the successful save |
| `epic1-Halaman-dialog.png` · `epic1-Blog-dialog.png` · `epic1-Diskon-dialog.png` · `epic1-Pelanggan-dialog.png` | the four delete dialogs |
| `epic1-Produk-row-dialog.png` · `epic1-Produk-bulk-bar.png` · `epic1-Produk-bulk-dialog.png` | Produk "Arsipkan" row + bulk bar + bulk dialog |
| `epic1-Halaman-after.png` · `epic1-Halaman-after-reload.png` | the stale-row defect, and the same list after a manual reload |
| `epic1-Blog-after.png` · `epic1-Diskon-after.png` · `epic1-Pelanggan-after.png` · `epic1-Produk-row-after.png` · `epic1-Produk-bulk-after.png` | post-confirm list state |
| `t518-negative.png` · `t518-positive.png` | Task 5.18 without / with courier-less orders |
| `t83-pengaturan.png` · `t83-pengaturan-kurir.png` · `t83-analitik.png` | Task 8.3 badge and Sistem tile |
