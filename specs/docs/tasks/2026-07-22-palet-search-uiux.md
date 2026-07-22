# TASK — Palet pencarian: buang kostum "developer console", maksimalkan di ponsel

> **Status: ✅ DONE** · dibuka 2026-07-22 · branch `worktree-super-admin-overhaul`
> · commit awal `af8bd2e` (= `origin/main`)
>
> Ditulis **sebelum** koding. Baca **NEXT** paling bawah lebih dulu.
> Lanjutan dari [header ikon + palet ⌘K](./2026-07-22-header-ikon-palet-search.md).

## Permintaan pemilik (2026-07-22)

> sempurnakan ui/ux modal atau popup search-nya biar tidak terkesan AI development, dan maksimal
> ui/ux-nya di mobile juga

## Diagnosis — dan pengakuannya

Paduka benar, dan penyebabnya spesifik. Referensi yang Paduka beri ("seperti Coolify, Vercel") itu
tentang **pola interaksinya**. Saya menyalin **bahasa visualnya** juga — dan bahasa visual itu milik
*perkakas developer*, bukan toko fashion. Lima penanda yang bikin terasa "AI development":

1. **Deretan `kbd` ↑↓ ⏎ Esc** di kaki modal. Ini tanda tangan Raycast/Linear/Vercel. Pembeli hijab
   di Indonesia tidak menekan ⌘K, dan di ponsel — mayoritas trafik toko ini — baris itu **tak bisa
   dipakai sama sekali**, cuma memakan tinggi layar.
2. **Label mikro huruf besar abu-abu** ("KATEGORI", "PRODUK") — default, tanpa informasi.
3. **Ubin ikon 40×40 persegi** dengan glyph lucide. Persegi **memotong siluet** — dan siluet justru
   cara sebuah gamis dikenali.
4. **Kartu mengambang di 10vh dengan backdrop blur** — tampilan bawaan `cmdk`, sama di setiap situs
   yang memakainya.
5. **"Lihat semua hasil" sebagai tautan rata-kanan di footer bar** — di ponsel itu sudut paling jauh
   dari jempol.

⚠️ **Batasan dari repo, bukan dari selera saya:** `global.css` sengaja membuat `--font-display` =
`--font-sans` (Inter) — *"a display serif is BRAND VOICE, and brand voice belongs to the merchant"*.
Jadi **dilarang** menambah tipografi khas di sini; hierarki harus datang dari **berat, ukuran, dan
tracking**. Warna juga harus lewat token `brand-*`, yang `Layout.astro` isi per-toko dari
`catalog.brandShades` — palet yang meng-hardcode pink akan salah di enam toko lainnya.

## Arah desain

**Subjek:** toko fashion wanita Indonesia, dibuka dengan satu jempol di ponsel.
**Tugas tunggal komponen ini:** dari "aku mau dress" ke halaman produk, sesedikit mungkin gerakan.
**Tesis:** pertahankan interaksinya (overlay cepat, ketik-lalu-muncul), **buang kostumnya**. Ini
laci ruang ganti, bukan baris perintah.

| Penanda lama | Diganti dengan | Alasan |
|---|---|---|
| Kartu mengambang di semua ukuran | **Ponsel: sheet setinggi layar penuh** (`100dvh`, edge-to-edge, aman dari notch); desktop tetap kartu | Di ponsel, modal mengambang membuang tepi layar dan goyah saat keyboard naik |
| `kbd` ↑↓ ⏎ Esc | **dihapus seluruhnya** | Keyboard tetap jalan, cuma tak diiklankan. Mengiklankannya persis yang bikin terasa perkakas developer |
| Label huruf besar abu-abu | Label **beserta jumlahnya** ("Produk · 2"), berat sedang | Label harus memberi informasi, bukan menghias |
| Ubin persegi 40px | **Thumbnail potret 3:4**, sama seperti `ProductCard` | Garmen dikenali dari siluet; persegi memotongnya |
| Kategori sebagai baris daftar | **Pill dalam satu baris** | Pola yang sudah dikenal pembeli Indonesia (Tokopedia/Shopee), dan 3 baris jadi 1 |
| "Lihat semua" di footer kanan | **Baris terakhir daftar, selebar penuh** | Di jangkauan jempol, dan itu tempat Shopee menaruhnya |

**Elemen tanda tangan:** palet ini menampilkan **kosakata toko** (kategori sebagai pill + kartu
produk mini), bukan daftar perintah. Satu keberanian saja, sisanya tenang.

**Risiko yang saya ambil dan pertanggungjawabkan:** membuang seluruh petunjuk keyboard. Fungsinya
tetap ada; iklan-nya yang hilang. Bagi pembeli, ⌘K bukan fitur — bagi pengguna desktop yang
penasaran, ↑↓ ditemukan dengan menekannya.

## Scope

### IN
- Sheet penuh di ponsel (`100dvh`, `env(safe-area-inset-bottom)`, baris input menempel, hasil
  menggulir), kartu di `sm` ke atas.
- Tombol **"Batal"** (teks, bukan ikon ✕) di ponsel — target lebih besar dan lebih jelas.
- Baris produk: thumbnail potret 3:4, nama, kategori, harga, keadaan habis.
- Kategori jadi pill.
- "Lihat semua hasil untuk «…»" sebagai baris terakhir.
- Empty state yang mengarahkan, bukan cuma murung.
- Satu gerakan terorkestrasi (sheet naik / kartu memudar-membesar), hormati `prefers-reduced-motion`.

### OUT — dan alasannya
- **Tipografi display khusus.** Dilarang oleh `global.css`; brand voice milik merchant.
- **Riwayat pencarian.** Butuh penyimpanan di perangkat pembeli demi kenyamanan kecil; belum diminta.
- **Grid 2 kolom untuk keadaan idle.** Sempat direncanakan, lalu dibuang — dua tata letak berbeda
  dalam satu komponen membuatnya melompat saat pembeli mulai mengetik. *(Chanel: lepas satu aksesori.)*
- **Menambah halaman/artikel ke hasil.** Task terpisah; `catalog.search()` harus tetap produk-saja
  karena `/cari` merender grid produk.

## Rencana

- [x] 1. `SearchPalette.astro`: sheet penuh di ponsel / kartu di desktop, buang kaki `kbd`
- [x] 2. Baris hasil: thumbnail 3:4, hierarki dari berat & ukuran, pill kategori
- [x] 3. "Lihat semua" jadi baris terakhir; empty state mengarahkan
- [x] 4. Gerakan (sheet naik) + `prefers-reduced-motion`
- [x] 5. Verifikasi: `astro check` · build · **browser 320/360/1280** · keyboard naik · tanpa JS
- [x] 6. `npm run audit:responsive` tetap 132/132
- [x] 7. Commit · deploy · verifikasi artefak di produksi · tutup file ini

## Yang gampang salah

- ⚠️ **Input wajib ≥16px di sentuh** (`global.css`): di bawah itu iOS Safari men-zoom halaman dan
  tak pernah kembali. `text-base` sudah benar — jangan diperkecil demi estetika.
- ⚠️ **`100vh` salah di ponsel** — bilah URL membuatnya melebihi layar. Pakai `100dvh`.
- ⚠️ Saat keyboard naik, area hasil harus **menyusut**, bukan mendorong input keluar layar:
  `flex flex-col` + `min-h-0` pada area gulir.
- ⚠️ Jangan hardcode pink. `brand-*` diisi per-toko oleh `Layout.astro`.
- ⚠️ `<dialog>` punya `max-width`/`margin` bawaan — harus di-override untuk sheet penuh.

## Empat permintaan lain yang masuk di sesi yang sama

Dikerjakan bersama, dicatat di sini supaya satu file memuat seluruh pass UI/UX ini.

1. **Baris filter di listing DIHAPUS** (kategori · harga · promo · Terapkan). Pemilik menilainya
   memberat halaman; di halaman kategori ia menyusut jadi "Filter · Harga [min]–[max] · Terapkan",
   pita berbentuk formulir di atas setiap grid. **Param-nya ikut dibuang** — membiarkan
   `?kategori=`/`?min=`/`?max=`/`?promo=` tetap diparsing tanpa kontrol yang merendernya persis
   kontrol setengah-jadi yang repo ini terus bayar mahal. Urutkan + paginasi tetap.
2. **Tombol WhatsApp keluar dari footer.** Kolom kontak sekarang alamat · telepon · ikon sosmed.
   ⚠️ WhatsApp **tidak** hilang dari toko — peluncur chat mengambang dan `/kontak` tetap membukanya,
   dan ia tetap kanal tempat merchant ini benar-benar berjualan. Ini keputusan tata letak footer,
   bukan pergantian kanal: jangan "kembalikan" di sini.
3. **Dropdown kategori: hover → KLIK.** Ini pengurangan, bukan penambahan: seluruh tambalan yang
   dulu ada — kelas `.is-closed` yang tugasnya cuma mengalahkan aturan `:hover`, dan tes
   `dd.matches(":hover")` — ada karena hover-nya. Klik-tutup di bawah kursor yang diam dulu membuat
   tombolnya terasa mati. Hover juga kata kerja yang salah di layar sentuh. Sekarang: satu kelas,
   klik/klik-lagi/klik-luar/Escape, dan Escape mengembalikan fokus ke pemicunya.
4. **Menu drawer jadi 2 kolom.** Daftar satu-per-baris mendorong "Kontak" ke bawah lipatan di setiap
   ponsel — pembeli harus menggulir sebuah *menu*. Induk ber-dropdown tetap selebar penuh (ia membuka
   panel; panel yang mulai di tengah drawer tak punya tempat untuk thumbnail-nya).

## Yang diverifikasi (browser, 360 & 1280)

| Diuji | Hasil |
|---|---|
| Sheet ponsel | 360×780 di `top:0` — layar penuh, bukan kartu mengambang |
| Kartu desktop | **memeluk isi**: 533px untuk 6 baris, **225px untuk 1 hasil** |
| Kategori | pill (`Dress`), bukan baris daftar |
| "Lihat semua hasil untuk «dress»" | baris terakhir, selebar penuh |
| `kbd` hints | **0** — hilang seluruhnya |
| Baris filter listing | **0** kontrol tersisa; Urutkan tetap |
| Menu drawer | `138px 138px` — dua kolom |
| Footer | tombol WA hilang; alamat + telepon + sosmed tetap |
| Dropdown desktop | hover → **hidden** · klik → visible · klik lagi → hidden · Escape → hidden · `aria-expanded` benar |
| `astro check` / build | 0 error / hijau |

### Dua bug ditemukan saat mengerjakan

1. **Skrip patch saya gagal senyap.** Blok helper baru palet tak pernah tertulis (skrip Python-nya
   melempar sebelum menyimpan), lalu `render` baru memanggil fungsi yang tak ada → palet selalu jatuh
   ke cabang error meski API-nya 200. Ketahuan karena saya membuka paletnya, bukan karena build.
2. **Kartu desktop meregang ke tinggi maksimum.** UA style `<dialog>` = `position:fixed; inset:0;
   margin:auto`; `m-0` (perlu untuk sheet ponsel) membuang margin auto, jadi keempat inset yang masih
   0 **meregangkan** kotaknya dan `h-auto` jatuh ke `max-height` — tiga hasil di dalam kartu 704px.
   `sm:bottom-auto` melepas jangkar bawahnya.

---

## NEXT — sesudah task ini

- **"Lacak Pesanan"** masih task berikutnya yang paling wajar (nomor pesanan **+** HP).
- Kalau filter diminta kembali, ia harus datang sebagai sesuatu yang bisa dipakai satu jempol —
  bukan baris formulir desktop.
