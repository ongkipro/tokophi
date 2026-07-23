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

---

## Ronde 2 — hero + header ala Casaio (referensi pemilik, 5 gambar)

**Keputusan pemilik (ditanya, dijawab):** ikon kanan = **search + keranjang saja** (tanpa akun/mata
uang — keduanya kontrol palsu di sini); header transparan **hanya homepage**.

### Header — logo tengah, transparan→solid
- **Homepage:** `fixed` melayang di atas hero, transparan + teks putih; **solid saat scroll** (>80px)
  jadi bar cream seperti halaman lain. Halaman lain tetap `sticky` solid.
- Pembalikan warna lewat **satu `<style is:global>`** ber-kunci `#site-header[data-solid]` — tak ada
  child yang perlu tahu state-nya (spesifisitas > utility Tailwind yang di-override).
- ⚠️ **Logo di-center ABSOLUT, dan nav pindah ke BARIS KEDUA.** Grid `1fr auto 1fr` mengikat pusat ke
  lebar nav, jadi menu 6-item demo mendorong logo lepas dari tengah — dan menu satu-baris kiri
  (persis referensi 4-item) **menabrak** logo di 1024–1440 (diukur: tumpang −340px di 1024). Menu
  merchant panjangnya variabel; dua baris (search·logo·cart, lalu nav terpusat) selalu muat dan tetap
  centered-logo premium. Ini penyimpangan sadar dari tata-letak referensi demi ketahanan multi-tenant.
- Mega panel kini berlabuh di **baris nav** (`relative`), jatuh di bawahnya — bukan di bawah logo.
- Mobile: baris 1 saja (hamburger·search · logo · cart); nav ada di drawer.

### Hero
Sudah full-bleed + overlay + badge pill + headline besar + CTA pill putih — cocok dengan referensi.
**Badge kepercayaan di dalam hero** (referensi memuat "Fast & Easy Styling / 30 Day Money Back")
DITUNDA: butuh slot/field di `@tokophi/sections`, dan homepage sudah punya strip fitur (kurir/COD/
pembayaran) tepat di bawah hero. Bukan kontrol, jadi tak mendesak.

**TANPA announcement bar** (referensi mobile memuatnya): tak ada model data pengumuman; membuatnya =
menaruh kata-kata promo di mulut merchant. Dilewati.

### Diverifikasi (browser)
Home transparan @top · solid saat scroll · logo center 512/512·640/640·720/720 · mega buka di bawah
nav row · halaman produk `sticky` solid (`data-overlay` null) · mobile burger-kiri/logo-tengah/
cart-kanan, nav row tersembunyi · `astro check` 0 error. Gerbang responsif untuk seluruh batch berikut.

---

## Ter-DEPLOY & diverifikasi di produksi

PR **#44** → `main` `ba6e790` · container storefront `558078b880c5` → **`ca6ed163b000`**.

Dioperasikan di situs live (bukan dibaca HTML):
- **desktop 1280:** header transparan `data-solid=false` `position:fixed`, logo center **±0px**, overflow
  **0**, **solid saat scroll** ✅. (Menu produksi = Beranda · Shop▾ · Promo Gajian · Blog — 4 item, muat pas.)
- **mobile 390:** burger kiri (16px), logo center **±0px**; drawer teks 25.6px, strip 2 kartu, drill →
  5 kategori, sub-panel tampil; palet search `--sp-h` aktif.
- **0 pageerror.** `audit:responsive` 132/132 sebelum deploy; scan 8 device presisi (logo ±0px, overflow 0).

**Sisa (ditunda, dicatat):** search "recently viewed" + grid kartu 2-kolom dari referensi ke-2 —
keluhan inti "kurang full saat ketik" sudah tuntas lewat perbaikan keyboard.

---

## Ronde 3 — header SATU BARIS (pemilik minta setelah melihat produksi)

> "ini header kan 2 line → buat 1 line aja. kiri menu, tengah text logo/logo, kanan search dan keranjang icon"

Dua-baris ronde 2 dibuat karena menu 6-item demo menabrak logo di satu baris. Tapi **menu produksi
pemilik cuma 4 item** (Beranda · Shop · Promo Gajian · Blog) — muat pas di satu baris. Jadi kembali ke
satu baris seperti diminta: **kiri nav · tengah logo · kanan search+keranjang**.

Search pindah dari kiri ke kanan (menyatu dengan keranjang), sesuai permintaan.

⚠️ **Collision tetap dijaga untuk toko manapun:** nav inline hanya dari **`xl` (1280)**, bukan `lg`.
Diukur: menu 6-item demo menabrak logo **84px di 1024** kalau nav muncul di sana. Jadi 1024–1279 pakai
drawer (hamburger), nav inline dari 1280 ke atas — di mana bahkan menu panjang muat. Toko 4-item
pemilik akan tetap lega.

### Diverifikasi (6 ukuran)
Satu baris di semua · logo center **±0px** · overflow **0** · tumpang **0px** di setiap lebar ·
search sebelum cart · mega buka di bawah bar · 0 pageerror.

---

## Ronde 4 — CategoryNav: lingkaran kecil → banner besar + geser (pemilik)

> "di bawah hero itu kategori/collection, design ulang → max 4 banner besar, scroll kanan-kiri jika
>  lebih dari 4. sesuai area width theme, bukan full width."

`CategoryNav.astro` dulu avatar bulat 20–24px yang wrap dan terpusat. Sekarang **rak banner** ala
Shopify/Apple:
- Kartu gambar besar `aspect-[4/5]` + gradient bawah + nama; hover zoom.
- **≤4 mengisi baris** (`lg:w-[calc(25%-...)]`) dalam **lebar tema `max-w-7xl`** (bukan full-bleed —
  diukur di 1440: `80..1360`, capped).
- **>4 → geser** dengan `snap-x snap-mandatory`; kartu berikutnya **mengintip** jadi jelas bisa digeser.
- **Panah prev/next desktop** (mouse tak bisa swipe) — muncul hanya bila `items>4`, nonaktif di ujung
  (`disabled:opacity-0`). Ponsel/tablet tanpa panah (swipe).
- Tanpa jumlah produk (data `CategoryNavItem` = label/imageUrl/href saja — takkan dikarang).

⚠️ Dua jebakan yang diukur & diperbaiki:
1. `sync()` panah jalan **sebelum layout settle** (inline script saat parse) → prev tak ter-disable.
   Sekarang di `requestAnimationFrame` + `load` + per-`img load`.
2. **`scrollLeft` rest di 24px** (bukan 0) karena `px-6` track membuat snap-start menggeser →
   `scroll-pl-4 sm:scroll-pl-6` (scroll-padding = padding) supaya kartu pertama rest di 0 dan prev
   ter-disable di awal.

Diverifikasi: 1280 4-up + kartu ke-5 intip, klik next geser 1 kartu, prev disabled di awal / next
disabled di ujung; mobile peek + tanpa panah; 1440 dalam lebar tema; 0 pageerror; `astro check` 0 error.
