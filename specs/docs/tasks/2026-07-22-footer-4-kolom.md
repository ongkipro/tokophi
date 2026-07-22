# TASK — Footer 4 kolom: brand · menu utama · menu merchant · kontak

> **Status: ✅ DONE** · dibuka 2026-07-22 · branch `worktree-super-admin-overhaul`
>
> Ditulis **sebelum** koding. Baca **NEXT** di bawah lebih dulu.
> Rantai task hari ini: [filter+pagination](./2026-07-22-listing-filter-pagination.md) →
> [badge stok habis](./2026-07-22-stok-habis-badge.md) → footer ini.

## Permintaan pemilik (verbatim, 2026-07-22)

> footer ui/ux cek → sempurnakan struktur, menu, navigasi mungkin jadi 4 column | column awal logo
> brands dan deskripsi, column 2 menu utama bisa setup dari navigasi utama, column 3 juga setup
> navigasi by merchant admin, column 4 alamat, sosmed, contact | sesuaikan ui/ux nya, jika perlu
> kasih icon

## Keadaan awal (dibaca dari kode + DB, bukan dikutip)

Footer sudah 4 kolom sejak `076be02`, tapi **isinya bukan yang diminta**:

| Kolom sekarang | Isi | Masalah |
|---|---|---|
| 1 (span 2 di `md`) | logo · tagline · **sosmed** · WA · telepon · alamat | Kolom ini memuat empat pekerjaan sekaligus |
| 2 "Koleksi" | `catalog.collections` — **diturunkan otomatis**, bukan menu merchant | Merchant tak bisa mengatur urutan/labelnya |
| 3 "Belanja" | **HARDCODE**: Beranda · Keranjang · Customer Service | Default platform yang bocor ke tiap tenant — pola yang `nav.ts` sudah berkali-kali perbaiki |
| 4 "Informasi" | **hardcode** "Jurnal" + `getFooterNav()` | Sebagian merchant, sebagian kita |

**Sumber data sudah ada, tinggal dipakai** (`src/data/nav.ts`):
- `getMainNav(storeId, collections)` → menu utama merchant (yang dipakai header), lengkap dengan
  dropdown; item kategori yang tak terbit sudah dibuang.
- `getFooterNav(storeId)` → menu footer merchant; item `/halaman/*` yang masih draft sudah dibuang,
  dan jatuh balik ke daftar halaman terbit kalau merchant belum bikin menu.

Isi nyata toko demo (diverifikasi via SQL):
- `main-menu` (12 item): Beranda · Semua Produk · **Kategori ▾** (Dress, Atasan, Bawahan, Busana
  Muslim, Loungewear — *Outerwear dibuang karena `published=false`*) · Promo Gajian · Blog · Kontak
- `footer` (5 item): Tentang Kami · Cara Pemesanan · Kebijakan Pengembalian · Kebijakan Privasi ·
  *FAQ dibuang karena halamannya draft*

## Scope

### IN
- **Kolom 1** — logo (atau nama toko) + deskripsi. Hanya identitas; tak ada lagi kontak/sosmed di sini.
- **Kolom 2 "Menu"** — `getMainNav()`, cermin menu header. Induk ber-dropdown (`target="#"`) dirender
  sebagai **label biasa, bukan tautan** — targetnya memang bukan halaman — dengan anaknya menjorok di
  bawahnya. Merender `#` sebagai link = tautan ke mana-mana.
- **Kolom 3 "Informasi"** — `getFooterNav()` apa adanya. **Hardcode "Jurnal" dibuang**: Blog sudah ada
  di menu utama, dan menyisipkan item milik kita ke dalam kolom milik merchant persis pola yang
  `nav.ts` sebut sebagai "konten demo yang hidup di default platform lalu bocor ke tiap tenant".
- **Kolom 4 "Hubungi kami"** — WhatsApp · telepon · alamat · ikon sosmed, semuanya pindah ke sini.
- **Kolom "Belanja" yang hardcode DIHAPUS** — Beranda sudah di menu utama, Keranjang ada di header,
  Customer Service jadi tombol WhatsApp di kolom 4.
- Ikon **hanya di tempat yang menambah makna** (alamat, telepon, WhatsApp, sosmed). Bukan di tiap
  tautan menu — ikon di semua baris berhenti jadi penanda dan mulai jadi derau.
- Setiap blok tetap **hilang total kalau kosong** — aturan yang sudah ada dan wajib dijaga: merchant
  yang belum mengisi apa pun dapat footer lebih pendek, bukan heading tanpa isi.

### OUT — dan alasannya
- **Kolom kategori terpisah.** Kategori sudah masuk lewat dropdown "Kategori" di menu utama;
  menampilkannya dua kali di satu footer adalah duplikasi, bukan navigasi.
- **Newsletter.** Sudah dihapus sebelumnya karena tak ada mailer — jangan dihidupkan lagi.
- **Kolom ke-5 / accordion di mobile.** Belum ada yang meminta; 4 kolom yang menumpuk rapi di ponsel
  sudah cukup dan tak menambah JS.
- **Mengubah editor Navigasi di Seller.** Dua menu (`main-menu`, `footer`) sudah bisa diatur di sana;
  task ini hanya membuat storefront memakainya.

## Rencana

- [x] 1. `Footer.astro`: susun ulang jadi 4 kolom sesuai di atas; pakai `getMainNav`
- [x] 2. Render item dropdown (induk = label, anak menjorok), rapikan hierarki visual
- [x] 3. Pindahkan sosmed + kontak + alamat ke kolom 4; ikon seperlunya
- [x] 4. Verifikasi: build + `astro check` + **browser** (desktop & 360px) + kontras AA
- [x] 5. Uji **toko kosong** — merchant tanpa sosmed/alamat/menu tak boleh dapat heading kosong
- [x] 6. `npm run audit:responsive` tetap hijau
- [x] 7. Commit + tutup file ini + CHANGELOG/WORKLOG

## Yang gampang salah di sini

- ⚠️ `getMainNav` mengembalikan induk **tanpa `href`** kalau ia punya anak. Merender `href={item.href}`
  begitu saja menghasilkan `href="undefined"`.
- ⚠️ Kontras di latar `ink`: `text-cream/45` **gagal AA** dan pernah lolos audit palet karena ia
  *opacity*, bukan warna. `/70` = 7.7:1. Jangan turunkan di bawah `/70`.
- ⚠️ Tap target ≥44px pada setiap tautan (`LINK` sudah `min-h-11`) — jangan hilang saat menyusun ulang.
- ⚠️ Jangan pernah memunculkan nomor/handle placeholder. Platform ini pernah menyiarkan
  `wa.me/6281234567890` di setiap halaman setiap toko. Kanal yang hilang itu jujur; kanal yang mati itu bohong.

## Yang diverifikasi (dibaca dari HTML yang dirender, bukan diasumsikan)

| Diuji | Hasil |
|---|---|
| Heading kolom | `Menu` · `Informasi` · `Hubungi kami` — kolom "Koleksi"/"Belanja" hilang |
| Kolom Menu | Beranda · Semua Produk · **grup "Kategori"** (Dress, Atasan, Bawahan, Busana Muslim, Loungewear) · Promo Gajian · Blog · Kontak |
| Outerwear | **tidak muncul** — koleksinya `published=false`, dibuang `getMainNav` |
| Kolom Informasi | 4 halaman terbit; **FAQ tidak muncul** karena halamannya draft |
| `href="undefined"` | **nihil** — induk dropdown dirender sebagai label, bukan tautan |
| Kontak | tombol WhatsApp + baris lokasi berikon tampil |
| Sosmed | 0 ikon saat kosong (benar); diuji dengan `@batiknusantara` sementara → 2 ikon, `@` terkupas untuk Instagram, URL TikTok tetap `@`, nama a11y "Instagram Batik Nusantara". **Dikembalikan ke NULL.** |
| `astro check` | 0 error |

`SocialLinks.astro` dipisah dari `Footer.astro` — ~50 baris path SVG yang menyembunyikan struktur
file. Ia **presentasi murni**: daftar profil datang sebagai prop, karena `Footer` tetap butuh jawaban
"ada sosmed atau tidak" untuk memutuskan apakah kolom 4 punya isi.

---

## NEXT — sesudah task ini

- Form Seller untuk mengisi alamat/telepon/sosmed masih dibangun (migrasi 0063 sudah ada kolomnya).
  Sampai itu jadi, kolom 4 di toko sungguhan hanya menampilkan baris kota.
- Kalau nanti diminta: footer bisa jadi accordion di ponsel. Sengaja tidak sekarang — 4 kolom yang
  menumpuk sudah terbaca dan tak menambah JS.
