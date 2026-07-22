# TASK — Header ikon-saja + palet pencarian (⌘K) ala Vercel/Coolify

> **Status: 🟡 IN PROGRESS** · dibuka 2026-07-22 · branch `worktree-super-admin-overhaul`
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

- [ ] 1. `/api/search.ts` — JSON produk + kategori, tenant dari Host, hasil dibatasi
- [ ] 2. `SearchPalette.astro` — `<dialog>`, input berikon, hasil berkelompok, keyboard, semua keadaan
- [ ] 3. `Header.astro` — kotak cari → ikon; hapus tambalan `w-40/xl:w-52`; rapikan grup ikon + keranjang
- [ ] 4. `cari.astro` — kotak cari di halamannya sendiri (syarat, bukan tambahan)
- [ ] 5. Drawer mobile: search di dalamnya menyesuaikan (jangan ada dua kotak cari)
- [ ] 6. Verifikasi: build · `astro check` · **browser** (klik, ⌘K, `/`, ↑↓, Esc, tanpa-JS) · 360px
- [ ] 7. `npm run audit:responsive` tetap hijau · commit · tutup file ini · CHANGELOG/WORKLOG

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

---

## NEXT

**Langkah 1** — buat `apps/storefront/src/pages/api/search.ts` mengikuti pola `api/track.ts`
(tenant dari `Astro.locals`, tak pernah dari client), lalu baru sentuh komponen.
