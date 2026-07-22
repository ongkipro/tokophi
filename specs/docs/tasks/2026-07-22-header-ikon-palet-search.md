# TASK — Header ikon-saja + palet pencarian (⌘K) ala Vercel/Coolify

> **Status: ✅ DONE** · dibuka 2026-07-22 · branch `worktree-super-admin-overhaul`
>
> Ditulis **sebelum** koding. Baca **NEXT** paling bawah lebih dulu.
> Rantai hari ini: [filter+pagination](./2026-07-22-listing-filter-pagination.md) →
> [badge stok habis](./2026-07-22-stok-habis-badge.md) → [footer 4 kolom](./2026-07-22-footer-4-kolom.md) → ini.

## Permintaan pemilik (2026-07-22)

> di header mirip shopify ada search, account, keranjang (pakai logo aja). search ini kalau di klik
> pakai teknologi search seperti coolify, vercel, etc → model modal dengan icon di dalamnya atau list
> produk, kategori, etc

## Keputusan yang sudah diambil: **ikon "account" TIDAK dibuat**

Toko ini tak punya akun pembeli, **dan itu disengaja**. `AGENTS.md`: membeli tidak pernah butuh akun,
`customers.registered_at IS NULL` = Tamu = kasus **normal, bukan cacat**; dinding registrasi di depan
checkout Indonesia adalah cara paling pasti kehilangan penjualan.

Pil "Akun" pernah ada dan **sudah dihapus** (`Header.astro:257`): halamannya form login palsu yang
menelan email + password lalu `preventDefault()`, memajang "Demo — sistem akun aktif setelah backend
terhubung" di toko live. Menambah ikonnya kembali = mengulang persis itu.

Ditanyakan ke pemilik dan dijawab: **lewati dulu, search + keranjang saja.** Versi jujurnya nanti
adalah **"Lacak Pesanan"** (nomor pesanan + nomor HP → status & resi) — fitur tersendiri dengan
permukaan keamanan sungguhan (nomor pesanan saja tak boleh cukup, atau siapa pun bisa menyisir
pesanan orang lain), jadi ia jadi task terpisah, bukan sisipan di sini.

## 🔴 Jebakan yang ditemukan saat membaca (ini yang mengubah bentuk task)

**`/cari` TIDAK punya kotak pencarian sendiri.** Ia mengandalkan form GET di header
(`cari.astro:6` menyebutnya sendiri). Jadi begitu kotak header diganti ikon:
- pengguna **tanpa JS** kehilangan satu-satunya tempat mengetik di seluruh situs, dan
- halaman **hasil pencarian** jadi tak punya cara memperbaiki kata kunci — halaman hasil tanpa kotak
  cari adalah kebuntuan.

Jadi menambahkan kotak cari ke `/cari` **bukan tambahan**, ia syarat supaya perubahan header ini
tidak jadi regresi.

## Scope

### IN
- **Header jadi ikon**: 🔍 cari · 🛒 keranjang (dengan badge jumlah). Kotak cari 208px lenyap dari
  baris header.
  - Efek samping bagus: itu menghapus 208px dari baris yang tadi meluber di 1024px, jadi **tambalan
    `w-40 … xl:w-52` ikut dihapus** — bukan disimpan sebagai komentar tentang field yang tak ada lagi.
- **Palet pencarian** dengan **`<dialog>` native**: fokus terperangkap, Esc menutup, `::backdrop`,
  semuanya dari platform. Bukan modal buatan tangan (rung 4 tangga "lazy senior dev").
  - Pemicu: klik ikon · **`⌘K` / `Ctrl+K`** · **`/`** (tak aktif saat sedang mengetik di field lain).
  - Isi: input dengan ikon di dalamnya, hasil **berkelompok — Produk (dengan thumbnail + harga) dan
    Kategori**, navigasi ↑↓/Enter, dan "Lihat semua hasil" → `/cari?q=`.
  - Keadaan: idle (produk terlaris sebagai titik awal, bukan kotak kosong) · mengetik · kosong ·
    gagal. **Semua ditulis**, bukan hanya jalur bahagia.
- **`/api/search.ts`** di storefront: tenant dari **Host header** (`Astro.locals`), **tak pernah** dari
  query. Membaca `catalog.search()` yang sudah di-cache per toko — **tanpa round-trip DB tambahan**.
- **Kotak cari di `/cari`** (lihat jebakan di atas) — dan itu pula yang membuat seluruh alur tetap
  hidup tanpa JS: ikon header adalah `<a href="/cari">` sungguhan; JS mencegat kliknya.

### OUT — dan alasannya
- **Ikon akun** — lihat di atas.
- **Rate limit di `/api/search`.** `track.ts` dan `checkout-session.ts` punya rate-limit karena mereka
  **menulis** (metrik bisnis / data pembeli). Search hanya membaca katalog yang **sudah publik** di
  `/produk` dan di `sitemap.xml`, dari cache in-memory per toko, tanpa DB. Memasang gerbang di sini
  cargo-cult: ia menambah kode dan tak melindungi apa pun. Yang dipasang: batas panjang `q` (100) dan
  batas jumlah hasil.
- **Indeks pencarian (Fuse/Algolia/Meili).** `catalog.search()` sudah ada, sudah accent-insensitive
  dan sudah berperingkat. Menambah dependensi untuk katalog seukuran ini adalah rung yang dilewati.
- **Riwayat pencarian / "terakhir dicari".** Butuh penyimpanan di perangkat pembeli demi kenyamanan
  kecil; belum diminta.

## Rencana

- [x] 1. `/api/search.ts` — JSON produk + kategori, tenant dari Host, hasil dibatasi
- [x] 2. `SearchPalette.astro` — `<dialog>`, input berikon, hasil berkelompok, keyboard, semua keadaan
- [x] 3. `Header.astro` — kotak cari → ikon; hapus tambalan `w-40/xl:w-52`; rapikan grup ikon + keranjang
- [x] 4. `cari.astro` — kotak cari di halamannya sendiri (syarat, bukan tambahan)
- [x] 5. Drawer mobile: search di dalamnya menyesuaikan (jangan ada dua kotak cari)
- [x] 6. Verifikasi: build · `astro check` · **browser** (klik, ⌘K, `/`, ↑↓, Esc, tanpa-JS) · 360px
- [x] 7. `npm run audit:responsive` tetap hijau · commit · tutup file ini · CHANGELOG/WORKLOG

## Yang gampang salah

- ⚠️ **Tanpa JS harus tetap bisa mencari.** Ikonnya `<a href="/cari">`, bukan `<button>`. Kalau ia
  `<button>` tanpa JS, ia tombol mati di setiap halaman toko.
- ⚠️ **`/` sebagai pemicu wajib mengabaikan saat fokus ada di input/textarea/contenteditable** — kalau
  tidak, mengetik "Jl. Melati" di checkout membuka palet di tengah alamat.
- ⚠️ **`<dialog>` + Astro:** `showModal()` bukan `show()` (hanya `showModal` yang memerangkap fokus dan
  memberi backdrop). Skrip `is:inline`, listener bukan atribut `onclick` (CSP).
- ⚠️ **Debounce fetch** (~150ms) dan **buang respons basi** — tanpa itu hasil ketikan lama bisa mendarat
  setelah yang baru dan menimpanya.
- ⚠️ Jangan pakai `Select` dari shadcn (itu urusan admin/Base UI) — ini Astro, HTML native.

## Yang diverifikasi (browser sungguhan, bukan build hijau)

| Diuji | Hasil |
|---|---|
| Klik ikon | palet terbuka, fokus langsung di input |
| Keadaan idle | "Paling dicari" + 6 produk — bukan kotak kosong |
| Ketik "dress" | grup **KATEGORI** (Dress) + **PRODUK** (Dress Midi, Jumpsuit Kulot) — sama persis dengan `/cari` |
| ↑↓ | menyorot baris, `aria-selected` ikut pindah |
| Enter | membuka baris tersorot; tanpa sorotan → `/cari?q=` |
| `Ctrl+K` | terbuka |
| `/` | terbuka — **dan diam** saat fokus di field (diketik "Jl. Melati/12" di checkout, isinya utuh) |
| `Esc` | menutup (lihat bug di bawah) |
| 360px | terbuka penuh, overflow **0** |
| **Tanpa JS** | ikon → `/cari` · halaman itu punya kotak ketik · submit → `/cari?q=dress`, 3 hasil |
| Latensi `/api/search` | **2 ms** hangat (yang lambat tadi murni *first-compile* dev server) |
| Nama a11y | ikon cari "Cari produk" · keranjang "Keranjang" saat kosong, "Keranjang 3 item" saat terisi |
| `astro check` | 0 error |

### Tiga bug ditemukan browser, semuanya diperbaiki

1. **`Esc` tidak menutup palet.** Di dalam `<input type="search">` Chromium memakai Escape pertama
   untuk **mengosongkan field** dan berhenti di situ — jadi palet tetap terbuka dan satu-satunya
   umpan balik yang pembeli lihat adalah kata kuncinya lenyap. Sekarang Escape ditangani di input.
2. **Dua tombol silang.** Tombol bawaan `type="search"` mendarat tepat di sebelah tombol tutup kita:
   dua glyph identik, satu berlabel 36px, satu tanpa label ~14px. Yang bawaan disembunyikan.
3. **Badge keranjang tak akan pernah muncul.** Saya menandainya `hidden` (badge "0" itu notifikasi
   bahwa tidak terjadi apa-apa), tapi skrip penghitungnya hanya mengisi `textContent` — tak pernah
   melepas `hidden`. Skripnya sekarang memiliki keduanya, dan unit "item" dipisah jadi anak `sr-only`
   supaya nama aksesibilitasnya berbunyi "Keranjang" saat kosong dan "Keranjang 3 item" saat terisi.

Thumbnail produk juga sempat gepeng (`size-10` di dalam flex) — sekarang `h-full w-full object-cover`.

---

## NEXT — sesudah task ini

1. **"Lacak Pesanan"** — versi jujur dari ikon akun. Nomor pesanan **+ nomor HP** (nomor pesanan saja
   tak boleh cukup) → status & resi. Butuh rate-limit sungguhan, tidak seperti `/api/search`.
2. Palet ini hanya mencari **produk + kategori**. Halaman (`/halaman/*`) dan artikel jurnal belum
   ikut; menambahkannya berarti `catalog.search()` harus tetap produk-saja dan endpoint yang
   menggabungkan — jangan ubah `search()` sendiri, `/cari` merender grid produk.
