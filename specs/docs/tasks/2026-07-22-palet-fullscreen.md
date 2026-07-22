# TASK — Palet pencarian: satu layar penuh di semua perangkat, latar terkunci

> **Status: ✅ DONE** · dibuka 2026-07-22 · branch `worktree-super-admin-overhaul`
> · commit awal `27b912f` (= `origin/main`)
>
> Lanjutan langsung dari [palet UI/UX](./2026-07-22-palet-search-uiux.md), yang sudah DONE + deployed.

## Permintaan pemilik (2026-07-22)

> ini search buat full 1 layar aja. biar background theme g scrolling. backgroundnya fixed hehehe.
> namun tetep adaptif secara theme, dinamic semua ukuran device, tablet, mobile, desktop

Tiga hal, dan ketiganya berbeda:
1. **Satu layar penuh di SEMUA ukuran** — bukan sheet di ponsel + kartu di desktop seperti sekarang.
2. **Latar tidak ikut menggulir** saat palet terbuka.
3. Tetap **adaptif**: ikut warna tiap toko, dan enak di ponsel, tablet, maupun desktop.

## Keadaan awal

Sesudah PR #34, palet = sheet `100dvh` di ponsel, **kartu** mulai `sm` (`sm:top-[8vh]`,
`sm:w-[min(38rem,…)]`, `sm:rounded-2xl`, `sm:bottom-auto`). Jadi tablet & desktop dapat kartu.

⚠️ **Kunci-gulir BUKAN bawaan `<dialog>`.** `showModal()` membuat sisa dokumen *inert* (tak bisa
diklik/di-tab), tapi **menggulir bukan interaksi dengan elemen** — perilaku roda-mouse/sentuh berbeda
antar mesin browser dan tidak boleh ditebak. **Diukur dulu di browser sungguhan sebelum ditambal**;
kalau memang bocor, kuncinya harus mengganti *scrollbar* yang hilang agar halaman tidak melompat saat
palet ditutup.

## Scope

### IN
- `<dialog>` jadi **viewport penuh di setiap lebar** — semua override `sm:` kartu dibuang.
- Isi ditaruh dalam **kolom terpusat** (`max-w-2xl`): di layar 1920px, input selebar 1900px itu bukan
  "memaksimalkan", itu kehilangan fokus. Ruang lebar dipakai untuk **napas**, bukan untuk merentang.
- Kunci gulir latar + kompensasi lebar scrollbar (kalau pengukuran membuktikan perlu).
- Padding vertikal naik bertingkat (ponsel rapat, tablet/desktop lega) — satu komponen, tiga postur.
- Warna tetap lewat token `brand-*` (diisi per-toko oleh `Layout.astro`).

### OUT — dan alasannya
- **Grid hasil 2–3 kolom di desktop.** Sempat dipertimbangkan sebagai "memaksimalkan ruang", lalu
  dibuang: enam hasil dalam tiga kolom terbaca sebagai halaman kategori, bukan sebagai pencarian —
  dan satu komponen dengan dua tata letak adalah dua komponen yang menunggu berselisih.
- **Backdrop blur.** Permukaannya sekarang buram penuh; backdrop di belakangnya tak pernah terlihat.
  Menyimpannya berarti membayar biaya rendering untuk sesuatu yang tak pernah tampak.

## Rencana

- [x] 1. **Ukur** apakah latar benar-benar menggulir di balik `<dialog>` modal (jangan tambal duga-duga)
- [x] 2. `<dialog>` viewport penuh di semua lebar; buang override kartu `sm:`
- [x] 3. Kolom terpusat `max-w-2xl` + ritme vertikal per breakpoint
- [x] 4. Kunci gulir + kompensasi scrollbar; lepas saat ditutup (termasuk saat ditutup lewat Esc)
- [x] 5. Verifikasi: 360 · 768 (tablet) · 1280 · 1920 · `astro check` · build
- [x] 6. `audit:responsive` 132/132 · commit · deploy · verifikasi di produksi

## Yang gampang salah

- ⚠️ `dialog.close()` **bukan** satu-satunya jalan tutup — Esc menutup secara native. Kunci gulir
  harus dilepas pada event **`close`**, bukan di dalam handler tombol, atau halaman terkunci selamanya.
- ⚠️ Menyembunyikan scrollbar menggeser layout. Ganti lebarnya dengan padding, atau halaman melompat
  saat palet ditutup.
- ⚠️ `100dvh` (bukan `100vh`) — bilah URL ponsel.
- ⚠️ Input tetap ≥16px di sentuh (iOS zoom, `global.css`).

## Hasil pengukuran — latar MEMANG menggulir

Diukur sebelum ditambal, di Chromium, palet terbuka, roda digulir 600px:

| | `scrollY` sebelum → sesudah | |
|---|---|---|
| desktop 1280 | 0 → **600** | ❌ latar menggulir |
| ponsel 390 | 0 → **600** | ❌ latar menggulir |

Jadi `showModal()` memang hanya membuat dokumen *inert* (tak bisa diklik/di-tab); **menggulir bukan
interaksi dengan elemen**, dan ia lolos. Kuncinya milik kita. Dan karena menyembunyikan scrollbar
mengambil lebarnya, lebar itu dikembalikan sebagai `padding-right` — kalau tidak, halaman melompat
saat palet ditutup. ⚠️ Dilepas pada event **`close`**, bukan di handler tombol: Escape menutup
`<dialog>` secara native dan tak pernah menjalankan kode tombol — halaman akan terkunci selamanya.

## Yang diverifikasi (empat ukuran, diukur)

| Perangkat | Kotak palet | Kolom baca | Latar | Lepas setelah Esc |
|---|---|---|---|---|
| ponsel 360 | `360×780 @0,0` | 360 | 0→0 ✅ | ✅ |
| tablet 768 | `768×1024 @0,0` | 672 | 0→0 ✅ | ✅ |
| desktop 1280 | `1280×900 @0,0` | 672 | 0→0 ✅ | ✅ |
| lebar 1920 | `1920×1080 @0,0` | 672 | 0→0 ✅ | ✅ |

Permukaannya penuh di setiap lebar; **kolom bacanya tetap 672px** — di 1920 sebuah input selebar
1900px bukan "memakai ruang", itu kehilangan mata di antara kaca pembesar dan kursor.

## Footer — permintaan yang masuk bersamaan

> presisikan juga width dengan body dan sesuaikan ui/ux

**Lebarnya ternyata sudah presisi** — diukur, bukan ditebak: di 1920 footer `320..1600`, header
`320..1600`; di 1280 keduanya `0..1280` dengan teks mulai di `24`. Sama persis. Jadi yang diperbaiki
adalah dua hal lain yang memang terlihat:

1. **Deskripsi toko terpotong di tengah kata** — "…dari masing-masing **da**". Kolom "Deskripsi
   singkat" di Seller berhenti di 160 karakter, jadi merchant yang menulis sampai mentok menyimpan
   kalimat yang putus. Sekarang dipotong di **batas kata** dengan "…", memakai helper `clamp` yang
   sudah ada di `Layout.astro` — **diangkat ke `src/lib/text.ts`**, bukan disalin, karena salinan
   kedua adalah cara keduanya mulai berbeda.
2. **Kolom Menu dua kali lebih tinggi dari tetangganya** (11 baris vs 4). Daftar kategorinya kini
   **2 kolom**, jadi 8 baris — footer ~110px lebih pendek dan keempat kolomnya terbaca sebagai satu
   baris, bukan satu kolom panjang dengan tiga kolom pendek diparkir di sebelahnya.

---

## NEXT

- Logo footer di lingkungan lokal 404 (server admin tidak jalan) sehingga alt-text-nya membungkus dua
  baris. Artefak lingkungan, bukan kode — di produksi logonya termuat.
