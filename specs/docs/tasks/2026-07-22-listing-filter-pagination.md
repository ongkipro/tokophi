# TASK — Listing: filter + pagination (GitHub #16, sisa terakhir)

> **Status: 🟡 IN PROGRESS** · dibuka 2026-07-22 · branch `worktree-super-admin-overhaul`
> · commit awal `0f61e98` (= `origin/main`, tree bersih)
>
> File ini ditulis **sebelum** koding dan diperbarui **tiap langkah selesai**, supaya sesi yang mati
> mendadak (laptop mati 2026-07-22) bisa dilanjut presisi, bukan ditebak. Baca bagian
> **NEXT** paling bawah lebih dulu.

## Kenapa task ini

Issue #16 (audit front-end storefront) tinggal menyisakan **filter + pagination** — audit menyebutnya
"proyek, bukan polesan". Sisanya (pencarian `/cari`, sort ber-URL, `404.astro`, `/produk`,
`PageHeader`/`SectionHeading`, share PDP, schema artikel) sudah mendarat di PR #18–#26.

`ProductListing.astro` sekarang **merender SELURUH produk sekaligus** — tidak ada batas, tidak ada
filter. Pada katalog demo (14 produk) itu tak terasa; pada merchant sungguhan dengan 300 produk itu
satu halaman raksasa berisi 300 gambar.

**Yang bikin ini murah sekarang:** listing sudah SATU komponen bersama
(`components/ProductListing.astro`) yang dipakai `/produk`, `/kategori/[handle]`, dan `/cari`.
Satu edit, bukan tiga.

## Keadaan awal (diverifikasi, bukan dikutip)

| | |
|---|---|
| Branch | `worktree-super-admin-overhaul` @ `0f61e98`, sinkron dgn `origin/main`, tree bersih |
| Komponen | `apps/storefront/src/components/ProductListing.astro` — sudah punya `?sort=` server-side + `carryParams` |
| Pemakai | `pages/produk/index.astro`, `pages/kategori/[handle].astro:135`, `pages/cari.astro:55,59` |
| Data demo | store `batik-nusantara`: **14 produk**, 6 kategori (Busana Muslim, Bawahan, Atasan, Loungewear, Outerwear, Dress), harga **45.000–245.000** |
| Template | `page_templates` hanya punya baris `homepage` → `categoryTemplate()` = `null` → `/produk` **memang** merender `ProductListing` (bukan SectionRenderer). Aman diverifikasi di browser. |
| Canonical | `Layout.astro:55` **membuang query string** → semua URL berfilter/berhalaman sudah canonical ke halaman dasar. Jadi **tidak perlu** menyentuh `robots`/canonical untuk task ini. |

## Scope

### IN
- `?kategori=<handle>` — hanya dirender kalau produk yang masuk **melintasi >1 kategori** (otomatis
  hilang di `/kategori/[handle]`, muncul di `/produk` & `/cari`). Tak ada kontrol yang tak berguna.
- `?min=` / `?max=` — rentang harga IDR.
- `?promo=1` — hanya yang diskon (`compareAt > price`, rumus yang sama dengan badge `−%` di kartu).
- `?page=n` — **12 per halaman**, dipotong di server, tautan `<a>` sungguhan (bisa dirayapi), prev/next,
  di-clamp kalau di luar rentang.
- Ganti filter/sort ⇒ **balik ke halaman 1** (form GET tidak mengirim ulang `page`).
- Empty state **berfilter** ≠ empty state katalog kosong: "tidak ada yang cocok" + tombol Reset.
- Hitungan jujur: "Menampilkan X–Y dari N produk" — N = jumlah **setelah** filter.
- Jalan **tanpa JS** (form GET + tautan asli), sama seperti `?sort=` yang sudah ada.

### OUT — dan alasannya (jangan "diperbaiki" tanpa membaca ini)
- **Filter ukuran.** `products.sizes` itu **daftar label**, bukan ketersediaan — stok sungguhan ada di
  `product_variants.stock`. Filter "punya ukuran L" yang mengabaikan stok varian **berbohong** kepada
  pembeli ("ada L" padahal L habis). Data demo juga memuat `"115x115 cm"` sebagai "ukuran" hijab.
  Kalau mau dibangun, sumbernya harus varian + stok, bukan `sizes`.
- **Badge/filter "Stok habis"** — temuan #4 audit yang belum mendarat, task terpisah.
- **Infinite scroll** — tidak bisa dibagikan, hilang saat tombol back, dan memicu ulang
  `MutationObserver` milik `RevealGrid` (persis alasan sort dipindah ke server).
- **Pagination di level DB** — katalog di-load per-request lalu di-cache; memotong array di komponen
  jujur pada ukuran ini. Ditandai `// lazy:` beserta plafonnya di kode.

## Rencana

- [x] Baca kode + data, tetapkan scope (file ini)
- [ ] 1. `ProductListing.astro`: filter → sort → paginate, satu form GET, `carryParams` diperluas
- [ ] 2. Kontrol filter (kategori / harga / promo) + tombol Reset, hanya dirender kalau relevan
- [ ] 3. Komponen `Pagination.astro` (prev/next + nomor, `aria-current`, tap target ≥44px)
- [ ] 4. Empty state berfilter (bedakan dari katalog kosong)
- [ ] 5. Verifikasi: `npm run build -w @tokophi/storefront` + **browser sungguhan** (bukan cuma build hijau)
- [ ] 6. `npm run audit:responsive -w @tokophi/storefront` (gerbang responsif, 10 rute × 11 lebar)
- [ ] 7. Commit + PR + tutup file ini (status DONE + hash), ringkas ke CHANGELOG/WORKLOG, komentar di #16

## Cara verifikasi (perintah persis)

```bash
cd ~/projects/tokophi/.claude/worktrees/super-admin-overhaul
npm run build -w @tokophi/storefront          # harus hijau
npm run dev -w @tokophi/storefront            # catat PID-nya sendiri, JANGAN pkill astro
# lalu di browser (Host header = tenant):
#   http://batik-nusantara.localhost:4321/produk
#   /produk?page=2                 → 2 produk terakhir, prev aktif, next mati
#   /produk?kategori=dress         → 3 produk, hitungan ikut berubah
#   /produk?promo=1&sort=termurah  → sort + filter hidup bersamaan
#   /produk?min=100000&max=150000  → 4 produk
#   /produk?kategori=dress&page=9  → di-clamp, bukan halaman kosong
#   /cari?q=dress&kategori=…       → `q` TIDAK ikut hilang saat memfilter
```

⚠️ **Jangan** `SEED_FORCE=1 npm run seed` — agen lain memakai DB yang sama (AGENTS.md).

---

## NEXT

**Langkah 1** — mulai dari `apps/storefront/src/components/ProductListing.astro`: pindahkan urutan
kerjanya jadi *filter → sort → paginate* di frontmatter, sebelum menyentuh markup.
