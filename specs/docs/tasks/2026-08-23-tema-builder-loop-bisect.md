# Builder /tema/[id] crash di build produksi — bisect, akar masalah, dan kenapa dev tidak pernah melihatnya

**Status:** fixed · branch `fix/tema-builder-loop`
**Pemicu:** laporan owner 2026-08-23 — *"tenant belum bisa edit tema"*
**Dampak:** sejak **2026-08-15** (`d5bf796`), setiap tenant yang membuka builder `/tema/[id]` di
produksi mendapat *"Halaman ini gagal dimuat"* — React error **#185** (maximum update depth). Membuat
template masih bisa; **mengeditnya tidak**. Sembilan hari, semua tenant.

## Jalan menuju akar masalah (dan dua jalan buntu yang tercatat supaya tidak diulang)

1. **Jalan buntu ①: billing.** Reproduksi lokal pertama tertutup `SuspendedError` — `kopi-senja` di
   DB dev sudah lewat masa langganan, jadi semua tulisan ditolak *dengan benar*. Produksi diperiksa:
   14 toko semuanya lunas/comped — bukan itu. (Billing `kopi-senja` dipulihkan persis ke
   `2026-07-27 03:59:36.018+00` setelah selesai.)
2. **Jalan buntu ②: data tema.** Crash terjadi dengan prefill, tanpa prefill (env holder dimatikan),
   dengan konten milik sendiri 9 seksi, dan dengan/tanpa key `root` — **bukan data**, dan sama sekali
   bukan pekerjaan tema netral hari ini.
3. **Bisect pada BUILD PRODUKSI nyata** (dev menyesatkan — lihat bawah), commit per commit:

   | commit | tanggal | builder |
   |---|---|---|
   | `e0efd73^` | 11 Agu | ✅ render |
   | `d5bf796^` (`d20298e`) | 15 Agu | ✅ render |
   | **`d5bf796`** | **15 Agu** | ❌ **crash #185** |
   | `a414e4e^` = `c99679a` | 20 Agu | ❌ crash |
   | `main` (`5ac3228`) | 23 Agu | ❌ crash |

   Culprit eksak: **`d5bf796`** — "cross-domain audit remediation pass", bagian yang memasang wiring
   preview tema (`previewTheme` + `ThemeTokensDialog onPreviewChange`) ke dalam builder.
   (Refactor lint `a414e4e` / Task 5.11 **bukan** penyebabnya — dibuktikan dengan menukar file itu
   saja ke versi pra-refactor dan tetap crash.)

## Mekanisme loop-nya

`overrides.headerActions` milik Puck adalah **komponen inline** — identitasnya baru di setiap render
`BuilderClient`. Identitas baru = tipe komponen baru bagi React ⇒ dialog di dalamnya **remount**.
`ThemeTokensDialog` memanggil `onPreviewChange` dari **effect saat mount**. Handler lama
`setPreviewTheme(next)` menyimpan **objek identitas baru untuk nilai yang sama** ⇒ re-render ⇒
`headerActions` baru ⇒ remount dialog ⇒ effect mount lagi ⇒ selamanya ⇒ React #185.

**Perbaikannya satu ekspresi** — functional setState yang mengembalikan `prev` saat nilainya sama:

```ts
setPreviewTheme((prev) => (prev.font === next.font && prev.tone === next.tone ? prev : next));
```

React bail-out saat state identik ⇒ tidak ada re-render ⇒ rantainya putus di satu-satunya sisi yang
menanggung beban. Remount `headerActions` per render yang sesungguhnya (pemborosan, bukan bug) tidak
diubah di sini — perbaikan minimal untuk outage, bukan penataan ulang.

## 🔴 Kenapa SEMBILAN HARI tidak ada yang melihat: dev tidak menjalankan klien

Memori repo sudah mencatat *"admin `next dev` TAK hydrate"* — dan bisect ini mengukurnya lagi:
halaman yang sama **render mulus di `next dev`** dan **crash di `next start`**, karena crash-nya
loop **klien** dan dev tidak pernah menjalankan klien di app ini. Konsekuensi yang lebih tajam:
`d5bf796` sendiri mencantumkan verifikasi browser pada build produksi — tapi yang dibuka adalah
halaman **daftar** `/tema` dan dialognya, **bukan** builder `/tema/[id]`. Layar yang tidak dibuka
adalah layar yang tidak diverifikasi. **Untuk `apps/admin`, "sudah dicek di browser" hanya berarti
sesuatu jika: build produksi + `next start` + layar yang persis itu dibuka.**

## Verifikasi (build produksi, browser sungguhan, tenant sungguhan)

- Builder terbuka: kanvas Puck penuh, palet 13 seksi, 0 error console.
- **Prefill netral render di kanvas** (dibaca dari **iframe** Puck, bukan dokumen luar): "Judul utama
  toko kamu" + BELANJA SEKARANG + bento "Belanja per Koleksi" berpanel warna brand toko.
- **Publish menyimpan**: toast "Template tersimpan", baris DB `27 B / 0 seksi → 1680 B / 9 seksi`.
- `npx tsc --noEmit -p apps/admin` exit 0. Diff: **satu file, +13 baris (12-nya komentar)**.

### Jebakan instrumen yang tercatat dari sesi ini

- **Tombol "Publish" Puck bukan `<button>`** — ia `<span class="_Button…">`, jadi
  `getByRole("button")` dan `locator("button")` tidak menemukannya. Klik via `text=Publish`.
- **Kanvas builder ada di iframe** — `document.body.innerText` dokumen luar tidak memuat isi kanvas;
  probe pertama saya "lolos" karena `|| !!querySelector('iframe')` yang ceroboh.
- **`EADDRINUSE` dua kali lagi**: server lama memegang port 3210 dan satu putaran pengukuran menilai
  build yang salah (dev server menjawab saat saya mengira `next start`). Selalu buktikan siapa
  pemilik port sebelum membaca hasil.

## Sisa yang diketahui, sengaja tidak disentuh

- Remount `headerActions` per render (perilaku Puck dengan komponen inline) tetap ada — kini hanya
  inefisiensi kecil, bukan loop.
- `BrandColorDialog.onPreviewChange` memakai `setPreviewBrandColor` langsung — aman karena state-nya
  string (React bail-out natif pada nilai sama).
- Verifikasi produksi pasca-deploy terbatas pada "artefak yang sama, terbukti end-to-end lokal" —
  tidak ada kredensial tenant produksi untuk drive penuh di sana; batas ini dinyatakan, bukan
  disamarkan.
