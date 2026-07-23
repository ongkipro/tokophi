# TASK — Burger menu minimalist (drill-down) + search full-layar kartu-grid

> **Status: 🟡 IN PROGRESS** · 2026-07-23 · branch `worktree-super-admin-overhaul`
> Referensi visual dari pemilik: menu minimalist ala Shopify Dawn · search full-layar grid.

## Permintaan pemilik (2026-07-23, dengan 2 gambar)

1. **Burger menu minimalist** — teks besar polos, tanpa thumbnail per baris; parent ("Shop") pakai
   chevron dan **drill-down** ke kategori; X di kiri-atas; strip produk di dasar.
2. **Search full-layar, menyesuaikan semua device** — "Recently viewed" + Clear, lalu **grid kartu
   2 kolom** dikelompokkan per kategori.

## Yang sudah beres dan DIPERTAHANKAN

- **Keyboard fix** (di commit belum-jadi ronde ini): tinggi palet ikut `visualViewport`, bukan `100dvh`.
  `dvh` tidak menyusut saat keyboard naik, jadi hasil di bawah garis keyboard tadinya nyangkut di
  ruang mati. Ini penyebab "search saat ketik kurang full". Sudah diperbaiki; tetap.

## Perubahan arah — dan mengapa referensi menang

Ronde lalu kategori dibuat **terlihat langsung** (foto + jumlah). Referensi baru justru **minimalist**:
teks besar, kategori di balik "Shop ›". Referensi paling baru + paling konkret menang. Pola ini persis
Shopify Dawn: link teks besar, parent ber-chevron menggeser ke sub-panel.

## Scope

### Menu
- X **kiri-atas**, tanpa lingkaran border, lebih besar.
- Link teks besar (~1.6rem), satu kolom, banyak ruang. Tanpa thumbnail per baris.
- Parent berkategori → baris ber-chevron; klik menggeser ke **sub-panel** kategori (tombol "← kembali"),
  keduanya di dalam `<dialog>`/drawer yang sama supaya fokus tetap terkurung.
- Dasar drawer: strip **2 kartu produk** (bestseller, server-rendered, data nyata).
- **TANPA pemilih mata uang** (referensi memuat pill IDR). TokoΦ IDR-only; pill statis = dekorasi,
  switcher = kontrol palsu — keduanya dilarang repo. Dicatat, tidak dibuat.

### Search
- Full-layar sudah; pertahankan + keyboard fix.
- Hasil & idle jadi **grid kartu 2 kolom** (foto besar, nama, harga, coret), bukan baris daftar.
- **"Terakhir dilihat"** (localStorage, dengan **Hapus**) di keadaan idle — dilacak dari PDP.
- Kategori tetap muncul (pill atau baris) saat mengetik.

### OUT
- Mata uang (di atas).
- Drill-down bertingkat >1 (kategori tak punya sub-kategori).

## Yang gampang salah
- ⚠️ Sub-panel yang tergeser masih `offsetParent !== null` → jebakan fokus harus mengecualikan panel
  non-aktif (`aria-hidden`), atau Tab bocor ke panel tersembunyi.
- ⚠️ Menutup drawer harus **reset ke panel utama**, atau buka lagi mendarat di sub-panel.
- ⚠️ `visualViewport` fix jangan sampai hilang saat menyentuh palet.
- ⚠️ Recently-viewed: cap 8, dedupe, JSON aman (try/catch), jangan pernah blokir render kalau korup.
- ⚠️ `astro check`, build, dan `audit:responsive` 132/132 sebelum commit.

---

## NEXT
Langkah 1 — menu minimalist + drill-down di `Header.astro`. Langkah 2 — recently-viewed (PDP + palet).
Langkah 3 — grid kartu di `SearchPalette.astro`. Verifikasi tiap langkah di browser 360/768/1280.
