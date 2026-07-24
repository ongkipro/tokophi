# TokoΦ — Sistem PROMO (voucher · flash sale · gratis ongkir · halaman PROMO)

> **Status:** SPEC (2026-07-24) — belum dibangun. Dibangun **bertahap** (P0→P5), tiap fase 1 PR + deploy + verifikasi.
> Prinsip: **satu halaman PROMO** menyatukan semua (banner dinamis + flash sale + voucher + produk diskon).
> Dokumen ini = kontrak. Kalau kode nanti berbeda, kode menang — perbarui dok ini.

---

## 1. Kenapa ini ada (state saat ini — GROUNDED)

| Yang sudah ada | Yang HILANG / MATI |
|---|---|
| Tabel `discounts` (code, kind `persen`/`nominal`/**`gratis_ongkir`**, value, minPurchaseIdr, usageLimit, startsAt/endsAt, status) | ⛔ **Kode diskon TIDAK diterapkan di checkout** — `/api/public/order` & `checkout.astro` tak memproses kode. Tabel + admin CRUD ada, tapi **kode tak berefek** (fitur mati). |
| Admin `/diskon` (CRUD kode) | ⛔ Diskon **tak bisa per-kategori/produk** (hanya global by min-purchase). |
| `discount_usages`, `usedCount` (kolom) | ⛔ Tak pernah ditulis (karena checkout tak apply). |
| `/promo` = **Landing Page 1-produk** (`promo_pages`/`landing_pages`: funnel hero+countdown) | ⛔ **Bukan** hub promo toko. Tak ada halaman PROMO gabungan. |
| `keranjang.astro` (cart), `checkout.astro` | ⛔ **Tak ada input voucher** di cart/checkout. |
| 8 `collections` (kategori nyata) | ⛔ Tak ada **flash sale** (diskon time-boxed) sama sekali. |

**Inti masalah:** semua "bahan" ada di DB, tapi **rantai penerapannya putus di checkout**, dan tak ada permukaan (halaman PROMO) yang menyatukan + menampilkannya ke pembeli. Ini yang disempurnakan.

## 2. Konsep — SATU halaman PROMO (1 halaman)

**PROMO = menu/halaman tersendiri** (BUKAN kategori). Fixed, ter-generate, label "PROMO" (contoh slug `/promo-gajian`, judul diatur merchant). Isinya **dinamis, diatur merchant**, satu kesatuan:

```
┌─ Halaman PROMO (/promo atau /promo-gajian) ─────────────────┐
│ [ BANNER DINAMIS ]  ← merchant atur judul/gambar/warna/CTA   │
│                                                             │
│ ⚡ FLASH SALE  ⏱ countdown 02:14:33                          │
│   [produk][produk][produk] harga coret + %off + stok bar    │
│                                                             │
│ 🎟 VOUCHER TOKO   [ HEMAT25  Salin ]  [ GRATISONGKIR Salin ] │
│   syarat: min belanja Rp150rb · s/d 31 Jul                  │
│                                                             │
│ 🏷 PRODUK DISKON (per kategori)                              │
│   Dress ▸ [..]  Hijab ▸ [..]                                │
└─────────────────────────────────────────────────────────────┘
```

Voucher yang tampil di sini **berlaku nyata** saat dimasukkan di **cart / checkout** → potong harga **atau** ongkir. Gratis ongkir juga bisa **otomatis** (ambang belanja, diatur merchant).

## 3. Data model (perubahan)

### 3.1 Perluas `discounts` (scoping + free-ship)
```
discounts += 
  scope        enum('all','category','product')  default 'all'   -- cakupan diskon
  collection_id uuid  null  → collections.id                     -- kalau scope=category
  product_id    uuid  null  → products.id                        -- kalau scope=product
  free_ship_threshold_idr money default 0                        -- (untuk kind=gratis_ongkir) 0 = tanpa syarat
```
`kind='gratis_ongkir'` sudah ada — tinggal diberi makna + wiring.

### 3.2 Flash sale — tabel baru `flash_sales` + `flash_sale_items`
```
flash_sales
  id, store_id, title, starts_at, ends_at, status enum('terjadwal','aktif','selesai'), created_at
flash_sale_items
  id, flash_sale_id → flash_sales.id
  product_id → products.id           (atau collection_id untuk seluruh kategori — lihat P3)
  sale_price_idr money               -- harga flash (override harga varian saat window aktif)
  stock_cap integer null             -- batas kuota flash (opsional)
```
Harga flash **override** harga produk **HANYA saat `now ∈ [starts_at, ends_at]`** — dihitung server, tak menyentuh `product_variants.price` asli.

### 3.3 Halaman PROMO — `store_settings` (atau tabel `promo_hub`)
```
promo_hub (1 baris per store)
  store_id (pk), enabled bool, slug text default 'promo',
  title text, subtitle text,
  banner_image text null, banner_bg text null, banner_cta_label text, banner_cta_href text,
  featured_collection_ids jsonb  -- kategori yang ditonjolkan di hub
  updated_at
```

### 3.4 Store-level gratis ongkir otomatis → `store_settings`
```
store_settings +=
  free_ship_enabled bool default false
  free_ship_min_idr money default 0     -- belanja ≥ ini → ongkir gratis otomatis (tanpa kode)
```

> Semua tabel baru **store-scoped → WAJIB RLS** (migration + `verify-rls` hijau). Ikuti pola `withTenant` + child-table rule.

## 4. Logika inti (yang HARUS benar)

- **Boundary = server.** Voucher divalidasi & diterapkan di **`/api/public/order`** (sama seperti ongkir/harga: klien UX, server otoritas). `checkout.astro`/cart hanya pratinjau. Kode yang tak valid/kadaluarsa/limit-habis/scope-tak-cocok **ditolak di server**, bukan dipercaya dari klien.
- **Urutan hitung:** subtotal (harga varian, atau **flash price** bila window aktif) → diskon produk/kategori/voucher `persen`/`nominal` → ongkir (re-quote server) → **gratis ongkir** (kode `gratis_ongkir` **atau** ambang `free_ship_min_idr`) menolkan/mengurangi ongkir → total.
- **Gratis ongkir = mengubah `orders.shipping_idr`**, dicatat sebagai potongan; **bukan** angka klien. Konsisten dgn aturan "ongkir dari server" di CLAUDE.md.
- **Flash price dihitung server** dari window waktu — tak ada harga flash yang "menggantung" setelah window tutup. Anti-hydration: countdown mulai dari nilai SSR.
- **Idempotensi kuota:** `usedCount`/`stock_cap` di-*increment* saat order sukses (dalam txn), dgn cek limit — hindari over-redeem balapan.
- **Jangan `if kategori === '...'`** — scope diskon & flash lewat data (`collection_id`/`product_id`), bukan hardcode.

## 5. Storefront UX

- **Halaman PROMO** (`/promo` atau slug merchant): banner dinamis → seksi flash sale (countdown + kartu produk harga-coret + progress stok) → voucher (chip + tombol Salin + syarat) → produk diskon per kategori. Semua **dari DB**, kosong kalau merchant tak set (bukan placeholder bohong).
- **Kartu produk** (grid/PDP): badge "Flash Sale"/"-25%" saat berlaku; harga coret.
- **Cart & Checkout:** input **"Kode voucher"** → pratinjau potongan (harga/ongkir) → server re-validasi saat submit. Gratis-ongkir-otomatis muncul sebagai baris "Ongkir GRATIS (belanja ≥ Rpxxx)".
- Semua teks Indonesia; uang `IDR()`; console-clean; responsif.

## 6. Admin UX (menu Diskon + PROMO)

- **Diskon** disempurnakan: tambah **scope** (Semua/Kategori/Produk), pilih kategori/produk, dan tipe **Gratis Ongkir** (+ ambang). Editor lama tetap, ditambah field.
- **Flash Sale**: sub-menu / tab di Diskon (atau di halaman PROMO admin) — buat jadwal (mulai/selesai) + pilih produk/kategori + harga flash + kuota.
- **Halaman PROMO (admin)**: aktif/nonaktif, judul/subjudul, **banner** (gambar/warna/CTA), kategori unggulan. Pratinjau + link "Lihat halaman PROMO".
- **Gratis ongkir otomatis**: toggle + ambang di Pengaturan → Pengiriman (atau di PROMO admin).
- RBAC: `discounts:write` untuk semua ini (atau `content:write` untuk banner PROMO).

## 7. Breakdown BERTAHAP (tiap fase = 1 PR + deploy + verifikasi)

- **P0 — Voucher aktif di checkout (fondasi, unblock semua).**
  Wire `discounts` di `/api/public/order`: validasi kode (aktif, window, limit, min-belanja, scope), terapkan `persen`/`nominal` ke subtotal + `gratis_ongkir` ke ongkir; tulis `discount_usages` + `usedCount` (txn). Input voucher di **checkout.astro** (pratinjau) + cart. **Acceptance:** kode nyata memotong total/ongkir di order yang tersimpan; kode invalid ditolak server.
- **P1 — Gratis ongkir otomatis (store-level).**
  `store_settings.free_ship_enabled/min_idr` + Pengaturan UI + apply di order API (ongkir→0 bila subtotal ≥ ambang) + baris di checkout. **Acceptance:** belanja ≥ ambang → ongkir 0 tanpa kode.
- **P2 — Diskon per kategori/produk.**
  `discounts.scope/collection_id/product_id` + editor Diskon (pilih cakupan) + apply hanya ke item yang cocok. **Acceptance:** diskon kategori hanya memotong item kategori itu.
- **P3 — Flash sale.**
  `flash_sales`+`flash_sale_items` (+RLS) + admin (jadwal/produk/harga/kuota) + harga flash server saat window aktif + badge/harga-coret storefront + countdown. **Acceptance:** harga turun saat window, kembali normal setelah tutup; countdown jalan.
- **P4 — Halaman PROMO (hub).**
  `promo_hub` (+RLS) + admin (banner dinamis/judul/kategori unggulan) + route storefront `/promo` (atau slug) merakit banner + flash sale + voucher + produk diskon. Menu "PROMO" di nav storefront. **Acceptance:** halaman PROMO menampilkan semua elemen dari DB, dinamis.
- **P5 — Poles & seed demo.**
  Seed demo: 1 flash sale aktif, 2 voucher (`HEMAT25`, `GRATISONGKIR`), gratis-ongkir ambang, halaman PROMO batik-nusantara terisi. UI polish, empty-states jujur, a11y, verifikasi end-to-end di browser (checkout benar-benar memotong).

## 8. Keputusan & pertanyaan terbuka

1. **Slug halaman PROMO:** tetap `/promo` (bentrok dgn admin "/promo"=Landing Page? itu ADMIN route, storefront terpisah — aman) atau `/promo-gajian`/`/promo/<slug>`? → **default `/promo`, judul/label diatur merchant.**
2. **Flash sale per kategori vs per produk:** P3 mulai **per produk**; per kategori (semua produk kategori) sebagai perluasan.
3. **Stack voucher:** 1 voucher per order (default) — hindari kombinasi rumit dulu. Gratis-ongkir-otomatis + 1 voucher harga = boleh (beda sumbu).
4. **`gratis_ongkir` via kode vs otomatis:** dukung KEDUANYA (kode `gratis_ongkir` P0; otomatis-ambang P1).
5. Nama tabel `promo_hub` vs kolom di `store_settings` — final saat P4 (hindari migration mubazir).

## 9. Prinsip anti-"fitur mati"
Tiap fase **di-exercise** (bukan cuma typecheck): checkout benar-benar memotong (browser + SQL), voucher invalid benar-benar ditolak. Kolom yang ditambah **harus dikonsumsi** di fase yang sama (hindari kolom yang tak dibaca — anti-pattern yang berulang di repo ini).

---

## 10. STATUS (per 2026-07-24) — branch `feat/promo-p1`

Built + **browser/SQL-verified** + committed (order of commits):
- **P0 voucher** — LIVE on `main` (#71). `applyDiscount` (lib/promo.ts) is the one place a code is priced; `/api/public/promo` previews; checkout has the voucher input. Demo codes: `NEWUSER50K` (Rp50rb) + `MEMBERVIP` (Rp100rb) usable; `GAJIAN25`/`ONGKIRGRATIS` expired in seed.
- **P1 automatic free shipping** — `store_settings.free_ship_enabled/free_ship_min_idr` (migration 0075). Pengaturan → Pengiriman card ("Gratis Ongkir Otomatis"). `/api/public/order` waives ongkir server-side when `subtotal ≥ min`; checkout shows "GRATIS". Voucher `gratis_ongkir` + auto both use `Math.max` (never double). Verified: ON→ongkir GRATIS total Rp349rb; OFF→Rp13.700 total Rp362.700.
- **P3 flash sale** — `flash_sales` + `flash_sale_items` (migration 0076, RLS on parent; child-table rule for items). `lib/flash.ts activeFlashPrices()` applied in the order re-pricing (Math.min, downward only). `getCatalog` folds the sale into `price`/`compareAt`/`flashEndsAt` → existing strikethrough + −% badge UI. Verified end-to-end: a real COD order for the Rp349rb dress on the live sale was charged **Rp199.000** (order + line item), not 349rb.
- **P4a /promo hub** — new `apps/storefront/src/pages/promo/index.astro`: hero + free-ongkir strip + copyable voucher chips + flash sale with live countdown + "Sedang Diskon" grid. Reads the same sources the order API prices from. Nav "Promo Gajian" repointed from `/kategori/promo-gajian` (a CATEGORY) to `/promo` (a MENU) in seed + Header + live DB.

**Demo data live in the shared DB** (batik-nusantara, store `908695b5-…`): flash sale "Promo Gajian" (id `ed0e213e-…`), 4 products (dress 199k, jumpsuit 179k, gamis 199k, blazer 149k), window now→+7d, status aktif. `free_ship_enabled=false` (honest default). NOTE: this is SQL-inserted, NOT in the seed (the main seed anchors to a fixed TODAY, so a fixed-date sale would rot) — P5 must add it to `seed:recent` (the now()-relative fresh-data path), not the anchored main seed.

### Remaining
- **P3c admin flash-sale editor** — list + editor (name, window, status, add products + sale price). RBAC `discounts:write`, `withTenant`, and the CHILD-TABLE RULE for `flash_sale_items` (read parent `flash_sales` in the same txn, bail if not tenant's). ⚠️ Admin `/promo` is TAKEN (landing pages) — put this under `/diskon` or a new `/flash-sale` route, NOT `/promo`.
- **P4b merchant-configurable hub banner/title** — currently defaulted in the page. Add `promo_hub` (or `store_settings` columns) + a small admin editor; wire into `promo/index.astro` (`TITLE` + hero copy/image).
- **P2 category/product-scoped vouchers** — DEPRIORITISED (YAGNI): flash sale already delivers "discounted products". Build only if a scoped voucher is actually wanted.
- **P5** — seed the demo into `seed:recent`; final a11y/empty-state polish; then merge/deploy in stages (P1→P3→P4a), watching each Coolify build land before the next (merge races).

### Gotchas found
- Storefront local tenant: `batik-nusantara.primaryHost = toko-demo.test`, so localhost redirects. Test with Chromium `--host-resolver-rules="MAP toko-demo.test 127.0.0.1"` + `http://toko-demo.test:4330`.
- Shared dev DB has migration drift — `npm run migrate` collides; apply new migration SQL directly (idempotent `IF NOT EXISTS`). The committed migration files are correct for main/prod.
- `Header.astro` shows 8 astro-check false-positives (unterminated-string quirk on `<style is:global>` after a `{/* */}` comment) — pre-existing, site renders fine.
