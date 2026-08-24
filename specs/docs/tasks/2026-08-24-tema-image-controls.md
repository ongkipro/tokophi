# /tema kontrol gambar — rasio galeri PDP, rasio kartu Navigasi Kategori, dan picker berhalaman dengan preview

**Status:** done · branch `feat/tema-image-controls`
**Pemicu:** permintaan owner 2026-08-24 (tiga bagian, satu lane).

## ① Rasio thumbnail utama galeri produk — 1:1 · 4:5 · 2:3

- **Penyimpanan: `stores.theme` jsonb, key `galleryAspect` — TANPA migrasi.** Kolom jsonb-nya sudah
  dikirim mentah ke PDP; `resolveGalleryAspect` (@tokophi/lib/theme) memvalidasi dengan aturan yang
  sama seperti font/tone: jsonb tidak dipercaya, nilai asing terdegradasi ke `1:1` (bentuk historis)
  dan tidak pernah membuat halaman toko crash.
- 🔴 **Konsekuensi yang WAJIB dijaga: setiap penulis `stores.theme` harus MERGE-PATCH.**
  `saveStoreTheme` dulu menulis `{font, tone}` utuh — begitu `galleryAspect` ikut tinggal di jsonb
  yang sama, setiap save "Tampilan" akan menghapusnya diam-diam. Keduanya (`saveStoreTheme`,
  `saveProductGalleryAspect`) kini read-modify-write di dalam txn tenant yang sama.
  **Terbukti end-to-end di build produksi:** simpan rasio 4:5 → simpan Tampilan → DB tetap
  `{"font":…, "tone":…, "galleryAspect":"4:5"}`.
- UI: dialog "Galeri Produk" di /tema mendapat baris "Rasio thumbnail utama" — tiga tombol dengan
  persegi panjang pratinjau yang bentuknya ADALAH rasionya. Dua aksi save berurutan dengan laporan
  kegagalan paruh kedua yang eksplisit ("Layout tersimpan, tapi rasio gagal: …").
- Storefront (`produk/[handle].astro`): kelas LITERAL via `GALLERY_ASPECT_CLASS` — Tailwind tidak
  bisa melihat `aspect-[${x}]` terinterpolasi. Berlaku untuk gambar utama & tile mode grid;
  **thumbnail rail tetap persegi** (rail adalah pemilih, bukan display; persegi menjaga ≥4 muat).
- **Terukur di browser:** kotak utama PDP `492×615` → rasio `0.800` (= 4:5 eksak).

## ② Rasio kartu Navigasi Kategori — 1:1 · 4:5 · 2:3 · 3:2 · 5:4

- Prop opsional `aspect` pada `CategoryNavConfig` (`@tokophi/sections`; default `"4:5"` = rasio yang
  selama ini di-hardcode, jadi template tersimpan tidak berubah). Field select "Rasio Gambar" di
  builder; `CategoryNav.astro` memetakan ke kelas literal, nilai asing jatuh ke 4:5.
- **Terukur di browser:** kartu `296×197` → rasio `1.500` (= 3:2 eksak) saat prop diset `3:2`.

## ③ Picker gambar builder — preview penuh saat klik + galeri berhalaman

- **Klik tile = mengintip, bukan commit.** Dulu satu klik langsung memilih dan menutup dialog —
  satu salah-ketuk di grid 3 kolom ponsel menerbitkan foto yang salah tanpa pernah melihatnya.
  Sekarang: tile → pane preview ukuran penuh (`object-contain` — melihat crop/tepi/teks aslinya
  adalah tujuannya, jadi tidak boleh di-cover-crop seperti tile) → "Pilih Gambar Ini" / "Kembali".
  Berlaku seragam untuk tab Galeri / Produk / Kategori; Upload tetap auto-pick (file itu dipilih
  eksplisit oleh merchant).
- **Galeri berhalaman:** aksi BARU `getMediaPage({offset, limit, q})` (24/halaman, cap 60; total
  disertakan) — `getMedia()` lama tidak diubah karena Files + dua editor memang butuh daftar penuh.
  Pencarian pindah ke server (melalui `likeContains` — `%`/`_` adalah wildcard dan ini kotak ketik
  merchant) supaya bisa menemukan baris yang belum dimuat halaman mana pun; debounce 300 ms.
  Tab Produk/Kategori tetap daftar penuh + filter klien (dibatasi katalog, bukan uploads).
- **Terbukti di build produksi** (galeri di-pad ke 55 baris, lalu dibersihkan): halaman-1 **24**
  tile → tombol "Muat lebih banyak (31 lagi)" → **48** → klik tile → pane preview → commit →
  dialog tertutup, nilai terpasang, **0 error JS**.

## Guard yang diubah SECARA SADAR: `product-ratio-locked.test.ts`

T-10 mengunci gambar produk ke 1:1 platform-wide. Permintaan owner hari ini membalik ruling itu
**hanya untuk galeri PDP**. Guard dipersempit, bukan dimatikan: ProductCard + ProductGrid tetap
terkunci penuh (tanpa prop ratio), dan PDP boleh non-persegi **hanya** lewat panggilan
`resolveGalleryAspect(` + peta `GALLERY_ASPECT_CLASS`, dengan tiap literal rasio muncul TEPAT sekali
(di peta). **Dua mutasi, dua merah**: (M1) 4:5 hardcoded di samping peta → merah; (M2) bypass
validator → semula HIJAU karena token import yang mati memuaskan pemeriksaan nama — diperketat ke
bentuk panggilan `resolveGalleryAspect\s*\(`, lalu merah.

## Verifikasi ringkas

vitest penuh **127 file / 1067 test** hijau (termasuk 8 test `resolveGalleryAspect` baru + guard yang
dipersempit) · `tsc` admin exit 0 · `astro check` 0 error / 14 hints (baseline) · dua rasio diukur
piksel di browser · merge-patch dibuktikan lewat urutan save nyata di build produksi · semua data
yang dibalik untuk verifikasi dipulihkan **terverifikasi hash** (`md5(sections)` identik; theme byte
identik) · user probe + 30 baris media pad dihapus.

## Batas yang dinyatakan

- Interaksi dialog & picker diverifikasi di build produksi lokal dengan tenant sungguhan; produksi
  menerima artefak yang sama (tidak ada kredensial tenant produksi untuk drive di sana).
- `BrandColorDialog.onPreviewChange` tidak disentuh (state string — React bail-out natif).
