# Tema default platform berhenti menjadi tema Batik Nusantara

**Status:** kode selesai · branch `feat/neutral-platform-theme` · **butuh satu perbaikan data produksi (belum dijalankan)**
**Pemicu:** permintaan owner 2026-08-23 — *"buat template /tema untuk semua tenant… pakai tema Batik Nusantara"*

## Premisnya sudah terpenuhi, dan justru itu masalahnya

Permintaan awalnya adalah menerapkan tema Batik Nusantara ke semua tenant. **Itu sudah berlaku,
di kedua sisi**, dan diukur di produksi 2026-08-23:

| bagian | keadaan sebelum perubahan ini |
|---|---|
| env `PLATFORM_DEFAULT_THEME_STORE_ID` | terpasang, dan container storefront melihatnya |
| holder `tema-platform` | homepage **9 seksi / 3720 B** — **identik byte-per-byte** dengan `batiknusantara` |
| fallback storefront | menyala; `withPlatformFallback` mengisi tiap slot default yang kosong |
| kanvas `/tema` di Seller | sudah prefill dari holder (`getPlatformDefaultSections`), bukan kanvas kosong |
| tenant tanpa slot default sendiri | **11 dari 15** |

Hasilnya, dilihat di browser: **`she-store` — toko dengan NOL produk — menayangkan foto batik,
judul "Batik Modern untuk Hari-Harimu", subjudul "Siluet bersih, motif tulis…", dan tombol "LIHAT
KOLEKSI DRESS" menuju `/kategori/dress`, koleksi yang tidak dia punya.** `zanobyshop` sama. Sebelas
toko mengiklankan barang yang tidak mereka jual.

**Jadi menyalin lebih jauh — baris per tenant — akan memperburuk tiga hal sekaligus:** teks batik jadi
permanen (fallback masih bisa dicabut, baris tersalin tidak), merchant yang sudah menyesuaikan
(`permata-store`, `valoish-store`) kehilangan pekerjaannya, dan 11 salinan langsung menyimpang.

**Mekanismenya benar. Isinya yang salah.** Perbaikannya satu baris holder, dan 11 toko berubah
serentak tanpa satu pun baris tenant disentuh.

## Yang berubah

`packages/db/src/seed-platform-theme.ts` berhenti **menyalin** dari toko demo. Defaultnya sekarang
**ditulis** di `packages/db/src/platform-theme-default.ts`, dengan lima aturan:

1. **Tidak ada kata yang menyebut produk, kategori, atau niche.** Placeholder mengatakan *apa yang
   harus ditulis*, dengan suara yang sudah dipakai Store Builder ("Judul utama toko kamu").
2. **Setiap tautan adalah rute yang dimiliki semua toko** — hanya `/produk`. `/kategori/<handle>`
   adalah 404 di toko yang tidak punya handle itu, dan itulah yang dikirim ke sebelas toko.
3. **Tanpa gambar.** Semua gambar di `public/` milik demo batik. Hero, ImageText, dan Lookbook
   masing-masing merender panel bernuansa brand saat `imageUrl` kosong — komentarnya sendiri
   mengatakan itu (*"text on a near-white panel"*, *"never a broken frame"*).
4. **Seksi yang membaca data toko sendiri yang melakukan penyesuaian.** `category-nav` dengan `items`
   kosong menurunkan dari `catalog.collections`; `collection-bento`, dua `product-grid`, dan `blog`
   sudah store-scoped. Itu yang membuat satu baris holder muat untuk semua toko — **bukan** bahasa
   template, yang sengaja tidak diciptakan di sini.
5. 🔴 **`features` tetap kosong.** `@tokophi/sections` menyebutkan alasannya: *"never an over-promise
   like 'Gratis Ongkir' a store does not actually offer"*. Tema batik mengirim empat badge dan hanya
   **satu** yang benar untuk semua toko ("checkout tanpa perlu daftar akun" — guest checkout memang
   desain produknya). "Kirim ke Seluruh Indonesia" bergantung pilihan kurir merchant, "Transfer,
   Virtual Account, & QRIS" pada channel platform, dan "Bantuan via WhatsApp" pada nomor yang mungkin
   tidak pernah diisi. Default tidak boleh berjanji atas nama merchant.

**Struktur 9 seksi dipertahankan** — itu justru nilainya: merchant mendapat halaman yang sudah
berbentuk halaman, jadi pekerjaannya "ganti kata dan taruh foto", bukan "rakit beranda dari kanvas
kosong". Seksi yang tidak diinginkan tinggal satu klik dihapus di `/tema`.

Template `category` dan `product` **sudah netral sepenuhnya** di holder (diukur), jadi keduanya
direproduksi apa adanya, bukan dirancang ulang.

## Satu detail yang hanya kelihatan di browser

Draft pertama memberi CTA hero label "Lihat Semua Produk", dan hasilnya **dua tombol nyaris kembar**:
`LIHAT SEMUA PRODUK` di sebelah `LIHAT SEMUA`. Yang kedua bukan dari data — `Hero.astro`
merender tombol universal bawaan ke `/kategori/semua`. ⚠️ Dan mengosongkan `ctaLabel` **bukan**
solusinya: kedua tombol ada di dalam `{slide.ctaLabel && …}`, jadi hero akan kehilangan CTA sama
sekali. Labelnya diubah jadi "Belanja Sekarang".

## Penjaga

- `packages/db/src/platform-theme-default.test.ts` — **23 test**, menjaga apa yang boleh ada di
  dalam default: tanpa kata niche, tanpa tautan non-universal, tanpa gambar, `features` kosong,
  `category-nav` auto, kerangka 9 seksi utuh. **Lima mutasi, lima merah** (kata batik di judul ·
  tautan kategori di CTA · file gambar kembali · satu badge janji · `category-nav` dipatok).
- `packages/db/src/seed-platform-theme.test.ts` — **DIGANTI, bukan diperbaiki.** Dulu ia menjaga
  urutan `SOURCE_SLUGS`; cacat itu kini mustahil secara struktur, jadi menjaga loop yang sudah tidak
  ada akan menjadi test hijau tanpa objek. Sekarang ia menjaga klaim yang lebih kuat: **seeder tidak
  membaca konten toko mana pun**, bentuk query apa pun — plus mutation self-check yang menaruh
  mekanisme salin kembali.

## Verifikasi (browser sungguhan)

| toko | sebelum | sesudah |
|---|---|---|
| `kopi-senja` (0 produk, tanpa tema sendiri) | tema batik | `h1` **"Judul utama toko kamu"** · 0 kata batik · 0 gambar (0 rusak) · tanpa badge strip · 0 error JS |
| `batiknusantara` (punya tema sendiri) | — | **tidak berubah**: 11 seksi, 31 gambar, copy-nya sendiri, badge strip-nya sendiri |

Yang kedua adalah buktinya Decision B masih utuh: slot yang **terisi** tidak pernah disentuh fallback.

## 🔴 Perbaikan data produksi — WAJIB, dan BELUM dijalankan

**Seeder ini insert-if-absent** (sengaja: holder diedit lewat impersonasi Super Admin, dan redeploy
tidak boleh menimpanya). Holder produksi **sudah punya** baris `homepage`, jadi **deploy tidak akan
mengubah apa pun**. Sebelas toko akan tetap menayangkan tema batik sampai satu baris ini diperbarui:

```sql
-- Jalankan SETELAH branch ini merge. Satu baris, milik platform, bukan milik merchant mana pun.
-- Cadangkan dulu:  select sections from page_templates t join stores s on s.id=t.store_id
--                   where s.slug='tema-platform' and t.type='homepage';
update page_templates t
   set sections = $JSON$<isi PLATFORM_DEFAULT_HOMEPAGE>$JSON$::jsonb, updated_at = now()
  from stores s
 where s.id = t.store_id and s.slug = 'tema-platform' and t.type = 'homepage';
```

JSON-nya diproduksi dari sumbernya sendiri, jangan diketik ulang:

```bash
npx tsx -e 'import {PLATFORM_DEFAULT_HOMEPAGE} from "./packages/db/src/platform-theme-default.ts"; console.log(JSON.stringify(PLATFORM_DEFAULT_HOMEPAGE));'
```

⚠️ **DB dev bersama sudah diperbarui** (satu baris holder, dicadangkan lebih dulu) supaya agen lain
tidak melihat tema batik bocor ke tenant lokal. Produksi belum.

## Yang TIDAK diklaim

- Tidak ada baris `page_templates` milik merchant yang disentuh, di lingkungan mana pun.
- Toko yang sudah menyesuaikan homepage-nya (`permata-store`, `valoish-store` di produksi) tidak
  terpengaruh sama sekali — fallback hanya mengisi slot yang `NULL`.
- Ini tidak menyelesaikan "merchant butuh gambar". Default sengaja tanpa gambar; menyediakan
  pustaka foto netral adalah pekerjaan tersendiri.
