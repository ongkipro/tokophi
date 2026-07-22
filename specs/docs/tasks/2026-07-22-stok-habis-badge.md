# TASK — Badge "Stok habis" di kartu produk (audit #16, temuan 4)

> **Status: 🟡 IN PROGRESS** · dibuka 2026-07-22 · branch `worktree-super-admin-overhaul`
> · commit awal `b3e353a` (= `origin/main`, tree bersih)
>
> Ditulis **sebelum** koding, diperbarui tiap langkah. Baca **NEXT** di bawah lebih dulu.
> Task sebelumnya: [`2026-07-22-listing-filter-pagination.md`](./2026-07-22-listing-filter-pagination.md).

## Kenapa task ini

Temuan 4 audit #16 punya dua bagian. Badge diskon `−%` sudah mendarat di `cfaa391`; **"Stok habis"
belum**. Kutipan auditnya: *"Produk habis juga tidak bisa dibedakan di grid dan baru ketahuan setelah
diklik."* Itu klik yang terbuang, dan di grid promo ia terlihat seperti penawaran yang bisa diambil.

Ini juga **prasyarat filter ukuran yang jujur**: begitu ketersediaan varian terbaca di listing,
"punya ukuran L" bisa dibangun dari stok varian, bukan dari `products.sizes` yang cuma daftar label.

## Keadaan awal (diverifikasi, bukan dikutip)

| | |
|---|---|
| Aturan stok | **SUDAH ADA, dua salinan** di `produk/[handle].astro:26` dan `:112` — `(p.variants ?? []).some(v => v.stock > 0) \|\| !p.variants?.length` |
| Sumber stok | `catalog.ts:288` — `inventory_levels.available` via `leftJoin`, `null → 0`. Ada di **setiap** produk katalog, bukan cuma PDP. |
| Kartu | `components/ProductCard.astro` dipakai **6 tempat** (listing, beranda, saran keranjang, PDP "produk serupa", `sections/ProductGrid`). Satu edit menutup semuanya. |
| PDP | Sudah menampilkan per-varian: "Stok habis untuk varian ini" / "Sisa N — segera habis" / "Stok tersedia (N)" (`:612`) |
| API pesanan | `/api/public/order:278` **menolak** `available < qty`, dan baris `inventory_levels` yang hilang dihitung 0 — jadi badge ini akan **sepakat dengan endpoint yang jadi otoritas**, bukan menebak |
| ⚠️ Data demo | **NOL produk habis.** 12 produk aktif, semua varian punya stok (terendah `rok-plisket`, 2 varian, total 12). Badge takkan terlihat tanpa manipulasi data sementara. |

## Scope

### IN
- **Angkat `inStock()` ke `data/catalog.ts`** sebagai satu-satunya sumber, lalu pakai dari PDP (2
  salinan yang sudah ada) **dan** kartu. Menambah salinan ketiga = persis fork yang bikin bug
  "Terbaru menampilkan produk terlama" bisa hidup di satu tempat setelah diperbaiki di tempat lain.
- Badge/overlay "Stok habis" di `ProductCard.astro` — terbaca screen reader (teks asli, bukan
  `aria-hidden`), dan gambarnya diredupkan supaya kebedaan itu terasa dari kejauhan, bukan cuma
  dibaca.
- **Badge diskon disembunyikan saat habis.** Mengiklankan "−30%" pada barang yang tak bisa dibeli itu
  bukan informasi, itu jebakan.
- Kartu **tetap** menautkan ke PDP: di sanalah penjelasannya, dan menghapus tautannya membuang
  halaman yang sudah punya peringkat.

### OUT — dan alasannya
- **Urutkan yang habis ke belakang.** Itu diam-diam melawan kontrol "Urutkan" yang baru saja dibikin
  jujur: pembeli memilih "Harga terendah" lalu melihat urutan yang bukan itu. (PDP "produk serupa"
  memang mengurutkan begitu — di sana tidak ada kontrol urutan yang bisa dibantah.)
- **Filter "sembunyikan yang habis".** Belum ada yang memintanya; badge sudah menjawab keluhan
  auditnya ("tak bisa dibedakan"). Menambah kontrol keempat ke bar filter demi keadaan yang jarang
  bukan pertukaran yang sepadan. Kalau nanti diminta: plumbing-nya sudah ada, satu checkbox + satu
  klausa, dan aturan "kontrol hanya dirender kalau bisa berbuat sesuatu" bikin ia sembunyi sendiri.
- **"Sisa N — segera habis" di kartu.** PDP menampilkannya **per varian**, yang benar. Di kartu ia
  jadi klaim agregat lintas varian, dan urgensi palsu lebih mahal daripada tidak ada urgensi.

## Rencana

- [x] 1. Ekspor `inStock()` dari `data/catalog.ts`; ganti 2 salinan di `produk/[handle].astro`
- [x] 2. Badge + peredupan di `ProductCard.astro`; sembunyikan badge diskon saat habis
- [x] 3. Verifikasi: build ✅ · `astro check` **0 error** ✅ · browser sungguhan ✅
- [~] 4. `npm run audit:responsive` — sedang jalan **selagi stok nol**, supaya sweep melihat kartu habis
- [ ] 5. Commit + tutup file ini + ringkas ke CHANGELOG/WORKLOG + komentar di #16

## Yang diverifikasi (diukur di browser, bukan diasumsikan)

| Diuji | Hasil |
|---|---|
| `/produk` dengan 2 produk dikosongkan | tepat **2 kartu** beroverlay "Stok habis", 10 lainnya bersih |
| Label "Stok habis" | teks asli di DOM, **bukan** di bawah `aria-hidden`, terbaca screen reader |
| `dress-midi-bunga` (satu-satunya produk diskon) | badge `−24%` **hilang** saat habis; harga coret & harga tetap tampil |
| Badge merchant "Promo" | **tetap** tampil (diredupkan) — itu data merchant, bukan klaim kita |
| Tautan ke PDP | tetap ada di kartu habis |
| PDP produk habis | tombol "Tambah ke Keranjang" **disabled**, `schema.org` → `OutOfStock` |
| PDP produk berstok | `schema.org` → `InStock` (kontrol — memastikan bukan konstanta) |
| 360px | overflow horizontal **0** |
| Console | 0 error baru (sisanya artefak lingkungan: logo `localhost:3000`, `celana-kulot.webp`) |

**Satu jebakan yang hampir lolos:** setelah `inStock` jadi **fungsi** yang diimpor, dua baris JSON-LD
di PDP masih berbunyi `${inStock ? "InStock" : "OutOfStock"}` — sebuah fungsi **selalu truthy**, jadi
markup Google akan selamanya bilang "InStock", termasuk untuk barang yang habis. Ketahuan karena
variabel lokalnya diganti nama jadi `available` (kalau namanya dibiarkan sama, ia justru *shadowing*
dan bugnya diam). Sekarang keduanya memakai `available`, dan diuji dua arah.

**Bonus temuan — bukan dari task ini, tapi dari task sebelumnya:** komentar penjelas perbaikan header
1024px ternyata saya tulis **di dalam daftar atribut `<input>`**. `astro build` menerimanya dan
produksi memang mengirim markup yang benar, tapi `astro check` melaporkan **24 error**. Lolos karena
setelah mengedit header saya menjalankan audit responsif + browser, **tapi tidak mengulang typecheck**
— browser membuktikan perbaikannya bekerja, ia tak bisa membuktikan berkasnya well-formed. Dua
pertanyaan berbeda. Sudah diperbaiki, `astro check` kembali **0 error**.

## ⚠️ Manipulasi data sementara — WAJIB dikembalikan

Data demo tak punya produk habis, jadi badge ini **tak bisa dilihat** tanpa mengosongkan stok satu
produk sebentar. Nilai asli dicatat dulu, lalu dipulihkan persis.

```bash
# 1. CATAT dulu (simpan keluarannya sebelum mengubah apa pun)
docker exec tokophi-db psql -U tokophi -d tokophi -tAc "select il.id, il.available from inventory_levels il join product_variants v on v.id=il.variant_id join products p on p.id=v.product_id where p.handle='rok-plisket';"

# 2. Kosongkan
docker exec tokophi-db psql -U tokophi -d tokophi -c "update inventory_levels il set available=0 from product_variants v, products p where v.id=il.variant_id and p.id=v.product_id and p.handle='rok-plisket';"

# 3. PULIHKAN dengan nilai dari langkah 1 — jangan tebak, jangan pukul rata
```

⚠️ **Jangan `npm run seed`** — DB ini dipakai bersama, dan seed men-TRUNCATE.

---

## NEXT

**Langkah 1** — ekspor `inStock()` dari `apps/storefront/src/data/catalog.ts` (di sebelah `Product`),
lalu tunjuk kedua pemakai di `produk/[handle].astro` ke sana sebelum menyentuh kartu.
