# Katalog storefront — bar datar, dan filter yang hanya muncul kalau memang memilah

**Status:** done · branch `feat/catalog-flat-filters`
**Scope:** `apps/storefront/src/components/ProductListing.astro` (satu file; empat call site ikut
otomatis — `/kategori/[handle]`, `/produk`, `/cari`, dan section builder "Daftar Produk").
**Owner request, 2026-08-23:** *"bikin flat aja tanpa frame… like as shopify modern termasuk filter."*

## Yang diganti

Bar kontrol dulunya sebuah **kartu**: `rounded-[1.25rem]` + `border` + `bg-white/80` + `shadow-sm` +
`backdrop-blur` — bingkai mengelilingi dua kontrol. Isinya juga tiga hal yang tidak dibaca siapa pun:

| dihapus | alasan |
|---|---|
| pill "Katalog" | melabeli halaman katalog sebagai katalog |
| pill "12 / halaman" | ukuran halaman bukan keputusan pembeli |
| *"Urutan tersimpan di URL agar mudah dibagikan…"* | toko tidak menjelaskan skema URL-nya sendiri |
| *"Menampilkan 1–3 dari 3 produk di halaman ini"* | pada satu halaman ini hanya berdebat dengan dirinya sendiri |

Sekarang: **satu baris, garis rambut di bawahnya** — jumlah di kiri, urutkan di kanan. Rentang
`1–12 dari 22` hanya muncul kalau halamannya memang lebih dari satu; selain itu cukup `22 produk`.

## Filter — keberatan owner yang lama ITU spesifikasinya

Filter bar pernah ada dan **dihapus owner 2026-07-22**, dengan alasan yang ditulis di file itu
sendiri: *"a form-shaped band above every grid, earning far less than the weight it added… If
filtering comes back, it should come back as something a phone can use with one thumb."* Kalimat itu
dipakai sebagai spesifikasi, bukan sekadar sejarah:

1. **Facet diturunkan dari produk yang ada, bukan dideklarasikan.** Ukuran, Kategori, Harga, dan
   Promo hanya dirender kalau benar-benar memilah himpunan ini. Chip membawa jumlah, dihitung
   terhadap facet *lain* yang sedang aktif — chip berisi 0 tidak bisa diklik, bukan jalan buntu yang
   baru ketahuan setelah ditekan.
2. **🔴 LANTAI: tidak ada filter di bawah satu halaman penuh (`> PER_PAGE`).** Derivasi facet saja
   TIDAK cukup, dan ini ketahuan di browser: `/kategori/dress` (tiga produk) tetap menggambar
   "Ukuran S·M·L·XL" + "Promo", karena dengan tiga produk setiap ukuran memang memilah. Secara teknis
   benar — dan persis bar yang owner hapus: deretan kontrol di atas grid yang sudah terlihat utuh.
   Filter baru layak ruang begitu daftarnya tidak muat satu halaman.
3. **Tanpa pasangan angka min/max.** Harga adalah rentang preset yang diturunkan dari sebaran harga
   nyata (tangga "Rp0–100rb" tetap tiga chip mati di toko yang menjual batik Rp450rb). **Batasnya ikut
   di URL** (`?harga=100000-300000`), bukan indeks bucket — `?harga=2` akan berarti uang yang berbeda
   di halaman lain, dan tautan yang dibagikan jadi berbohong.
4. **Tanpa tombol "Terapkan" saat JS hidup.** Mencentang chip langsung navigasi. Tombolnya hanya ada
   di dalam `<noscript>`, tempat ia menjadi pembeda antara kontrol dan hiasan.

## Mekanisme: kenapa bukan shadcn/ui, dan kenapa bukan `<details>`

**shadcn/ui tidak bisa dipakai di sini sama sekali.** Storefront ini Astro tanpa integrasi React
(dicek: `apps/storefront/package.json` tidak punya `@astrojs/react` maupun `react`); shadcn/Base UI
hidup di `packages/ui` untuk dua aplikasi Next. Mengirim framework hanya untuk menggambar delapan chip
adalah regresi berbaju perbaikan. Chip = `<label>` + checkbox `sr-only` + `peer-checked:`. Nol JS,
bisa keyboard, jalan tanpa JS.

### `<details>` dicoba lebih dulu dan TIDAK bisa mengerjakan ini

Semantiknya lebih baik dan itu memang bentuk disclosure yang benar. Tapi kebutuhannya "tertutup di
ponsel, deret inline di desktop", dan itu atribut **`open`** — yang tidak bisa disetel CSS. Dua upaya
memaksanya, dua-duanya diukur dan **gagal**:

- `display` pada anak langsung — Chrome 131+ menyembunyikan isi lewat
  `::details-content { content-visibility: hidden }`, satu tingkat **di atas** anak itu, jadi
  deklarasinya mendarat di elemen yang tidak dipakai mekanisme collapse-nya;
- `::details-content { content-visibility: visible }` — juga tidak membukanya.

Sekarang: checkbox tanpa `name` (jadi tidak pernah ikut terkirim) + panel `div` biasa yang display-nya
dimiliki file ini di kedua lebar.

⚠️ **Harga jujurnya:** screen reader membacanya sebagai checkbox, bukan region yang bisa dibentang.
`<details>` akan membacanya benar. Itu ongkos melakukannya tanpa JS, dan ditulis di sini alih-alih
disamarkan.

## Tiga jebakan yang memakan waktu, tercatat supaya tidak diulang

1. 🔴 **PROPERTI DOM BUKAN BUKTI TAMPIL.** Panel yang tertutup mengembalikan `clientHeight: 412` dan
   `offsetParent` non-null — karena membaca subtree `content-visibility` justru **memaksa layout yang
   sedang diukur**. Selama dua putaran DOM "membuktikan" chip yang, di screenshot, tidak ada di
   halaman. **Screenshot yang menemukannya, dua kali.** Untuk klaim visual, ambil gambarnya.
2. 🔴 **SERVER LAMA MEMEGANG PORT-NYA.** File PID menyimpan PID yang salah, `kill` meleset, server
   lama tetap `LISTEN` di 4477 dan yang baru mati dengan `EADDRINUSE` — tertulis hanya di log. Dua
   kesimpulan "perbaikannya tidak jalan" sebenarnya mengukur build lama. **Setelah restart, buktikan
   penanda baru benar-benar tersaji** (`curl … | grep -c facet-toggle`), jangan percaya bahwa restart
   berhasil.
3. **Tombol Filter nyaris menutup dirinya sendiri.** Listener `change` yang didelegasikan mengirim
   form untuk checkbox APA PUN; `#facet-toggle` ada di form yang sama. Penjaganya `t.name` — sengaja,
   bukan kerapian: tanpa itu, menekan "Filter" me-reload halaman dan panelnya kembali tertutup.

## Verifikasi (browser sungguhan, 390 px dan 1280 px)

| # | klaim | hasil |
|---|---|---|
| ① | ketuk "Filter" di ponsel membuka panel, **tanpa** navigasi | `false → true`, URL tetap, 0 error JS |
| ② | centang "M" memfilter | `?ukuran=M` · `22 → 14 produk` · "Hapus filter" muncul |
| ③ | panel terbuka saat halaman dimuat dengan filter aktif | ya |
| ④ | "Hapus filter" mengosongkan query | ya |
| ⑤ | `/kategori/dress` (2 produk tayang) | **0 chip, 0 toggle**, teks `2 produk` |
| ⑥ | tanpa JS | 16 chip tetap dirender, "Terapkan" ada di `<noscript>` |

Tambahan: tidak ada overflow horizontal di 390 px; `npx astro check` **0 error / 14 hint** (baseline
tidak berubah).

⚠️ Kategori `dress` menampilkan **2** dari 3 baris `collection_products` karena satu produknya
berstatus `draft` — perilaku lama, bukan efek perubahan ini (diperiksa terhadap DB).

## Catatan lanjutan

- `?ukuran=…` pada kategori kecil tetap **diterapkan** meski chip-nya tidak dirender (lantai `>
  PER_PAGE`). Filternya bekerja dan "Hapus filter" tetap muncul, jadi ada jalan keluar — tapi tidak
  ada kontrol untuk mengubahnya di halaman itu. Disengaja: mengabaikan parameter diam-diam adalah
  kebohongan yang berbeda.
- Nilai ukuran seperti `115×115 cm` ikut muncul di deret Ukuran. Itu data merchant yang sah (kain),
  bukan cacat — jangan disaring dengan menebak "ini bukan ukuran".
