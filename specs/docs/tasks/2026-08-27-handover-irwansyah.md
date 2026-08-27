# Handover — 2026-08-27 (untuk Irwansyah / kolaborator berikutnya)

**State of main:** `83e43ad` (PR #366). Deploys **505–519** semuanya `finished` dan terverifikasi di
produksi. Handover sebelumnya: `2026-08-24-handover-irwansyah.md` (kereta #335–#349 / deploy ≤504) —
dokumen ini menyambungnya, bukan menggantikannya.

**Repo visibility: PRIVATE** (ruling owner 2026-08-24 — jangan flip tanpa perintah eksplisit baru).

## Kereta merge sejak handover terakhir (#350–#366, deploy 505–519)

| PR | Deploy | Isi |
|---|---|---|
| #350 | (md) | EOD docs 2026-08-24 |
| #351 | 505 | **Legacy ledger credit = barang saja** (`greatest(subtotal−discount,0)`, 0104) — laporan owner: penarikan masih membawa ongkir; koreksi data prod via `ops/tokophi-legacy-credit-correction.sql` |
| #352 | 506 | `/tema` → **rasio gambar CARD produk** (1:1 / 4:5 / 2:3, `stores.theme.cardAspect`) |
| #353 | 507 | Dialog Galeri Produk jadi landscape (potret kepotong layar) |
| #354 | 508 | `/update-log` super-admin += rilis hari itu |
| #355 | 509 | **Role toko baru: Advertiser + Customer Service** (enum 0105; advertiser sengaja dapat `integrations:write` — pixel/CAPI memang pekerjaannya; picker peran ber-deskripsi; bug "Peran tidak valid" = allow-list server tertinggal, fixed). + Audit rekonsiliasi final dev+prod: 0/0/0 mismatch |
| #356 | 510 | **Referensi transfer di "Tandai lunas"** (ditulis dalam CAS yang sama) + alasan tolak/ref tampil di `/saldo` merchant + kolom `Keterangan` di ekspor CSV |
| #357 | 511 | Card storefront: **bocor baris-3 judul** fixed (`min-h` 44px > 2×19,25px clamp — jendela 5,5px) |
| #358 | 512 | Card disederhanakan: **tanpa rating di grid** (Stars tetap di PDP), `min-h` diganti struktur flex |
| #359 | 513 | Ritme jarak card 20/8/12px + antar-baris grid `gap-y-10 sm:gap-y-14` (⚠️ `gap-x` JANGAN diubah — aritmetika `sizes` diturunkan darinya) |
| #360 | 514 | **Hasil ⌘K jadi grid card** 2/3 kolom (2 bug ketangkap via drive: `block` mengalahkan `line-clamp-2` pada `display`; `sizes` harus kotak GAMBAR, bukan kolom) |
| #361 | 515 | Card menyatu semua permukaan (harga mengalir, `mt-auto` flooring dibuang — "janggal"), `/promo` ke `max-w-7xl` (card pas 296px = klaim `sizes`), **mega menu** gaya referensi (kolom link teks + 2 tile gambar; kurasi = urutan menu merchant; `sizes` tile 248px by construction via kolom `32rem` fixed) |
| #362 | 516 | **Thanks page payment UX**: VA box mono + Salin (fallback execCommand terbukti di http), QR **bisa diunduh** (`QRIS-<order>.png`; hint upload-dari-galeri), tutorial per metode via `<details>`. **E2E dengan pembayaran AutoLaris SUNGGUHAN**: QRIS `PHI-760912892PPL` (fee 2.168 = 0,7%×omset), VA BCA `PHI-761019151DD5` (flat 6.500) — jadwal fee terbukti live |
| #363 | 517 | **Presisi ads**: Google Ads `conversion` masih kirim TOTAL → fixed ke goods (guard `value-is-goods` +1, anchored bentuk objek karena `codeOnly` menginertkan literal); AM Meta/TikTok **byte-verified** dari antrean buffer (em/ph digest dihitung ulang independen); TikTok `user.phone` (Events API) vs `phone_number` (ttq.identify) dikonfirmasi vs dok v1.3 |
| #364 | 518 | `npm run dev` storefront MATI: token `<script>` literal dalam komentar skrip inline → Vite dev scanner memotong skrip (build lolos, dev mati). Kelas di-sweep: 0 lainnya |
| #365 | 519 | **Default tone = `netral` (background PUTIH)** — 3 sisi sinkron (DEFAULT_THEME, global.css `#fafafa/#262223/#6f676a/#e6e6e6` dihitung dari `generateNeutrals`, theme.test round-trip). Pilihan eksplisit selamat: batik (hangat) tetap cream; 14 toko prod tanpa pilihan flip putih — itu ruling-nya. Verifikasi prod: permata `#fafafa`, batik `#faf6f2` |
| #366 | (md) | **`specs/docs/PRICING.md`** — kartu harga (langganan, tabel fee admin + BASIS-nya, pencairan); subordinat ke FINANCE.md+kode, §5 memetakan tiap angka ke kode+guard. STATUS boundary 2026-08-27 |

## Kontrak yang WAJIB dipahami sebelum menyentuh area ini

1. **Uang**: `FINANCE.md` (peta) + `PRICING.md` (kartu harga). `payouts.note` di-key status terminal:
   `gagal` ⇒ alasan tolak, `selesai` ⇒ referensi transfer.
2. **Ads `value` = BARANG SAJA di semua destinasi** — termasuk Google Ads `conversion` (holdout
   terakhir, fixed #363). Guard: `value-is-goods.test.ts`. Validasi payload browser paling murah:
   dump `fbq.queue`/`dataLayer`/`ttq` (deferred loading menahannya) — jangan intercept network.
3. **Card/grid**: `gap-x` grid produk adalah input aritmetika `sizes` di `ProductCard.astro` —
   melebarkannya tanpa menurunkan ulang `sizes` membuat semua klaim lebar bohong. Row gap bebas.
4. **Tema**: default = `netral`. Toko yang memilih tone eksplisit tidak terpengaruh perubahan
   default apa pun (`toneChosen`). global.css harus selalu = derivasi
   `generateNeutrals(DEFAULT_BRAND_COLOR, DEFAULT_THEME.tone)` — theme.test.ts menjaganya.
5. **RBAC toko** 6 role: owner · admin · staff · gudang · **advertiser** (dapat
   `integrations:write` by design) · **cs**. Allow-list server `MANAGEABLE` di
   `apps/admin/lib/actions/users.ts` HARUS ikut melebar saat menambah role — UI saja tidak cukup
   ("Peran tidak valid").

## Jebakan yang terbayar minggu ini (jangan diulang)

- **EADDRINUSE menggigit 3× lagi**: verifikasi PID pemegang port via `ss -ltnp` SEBELUM percaya
  hasil drive — dua kali pengukuran membaca build lama.
- **Token `<script>`/`*/` literal di dalam komentar** (`.astro` inline script / block comment):
  deskripsikan dengan kata-kata. Build dan dev punya parser BERBEDA — lolos build ≠ lolos dev.
- **`block` + `line-clamp-2` sama-sama menyetel `display`** — yang menang yang terakhir di CSS;
  clamp mati diam-diam. Ukur `titleLines` di browser, jangan percaya kelasnya.
- **`sizes` mendeskripsikan kotak yang DIISI browser** (gambar), bukan kolom grid-nya — padding
  card membuat keduanya beda 12px.
- **`codeOnly()` menginertkan isi string literal** — guard yang meng-anchor nama event dalam string
  tidak akan pernah match; anchor ke bentuk objek/identifier, dan kolon butuh `\s*` dua sisi.
- **Resolver konflik BUILD-LOG**: file main utuh + sisipkan entry sendiri sesuai urutan
  newest-first (timestamp!), verifikasi 0 marker, JANGAN chain resolver+commit — terulang lagi.

## Terbuka / eksternal (tidak berubah dari handover 2026-08-24 kecuali dicatat)

1. UAT KiriminAja skenario 9 (cancel) masih menunggu AWB sandbox; sheet UAT + temuan defect sandbox
   siap kirim (`~/Downloads/UAT Mas Ongkie X Kiriminaja - FINAL.pdf/.docx`); daftarkan webhook
   `https://app.tokophi.com/api/public/kiriminaja/webhook` via set_callback.
2. GitHub Actions masih mati (billing) — CI di PR periode ini tidak membuktikan apa pun.
3. N33 (seed dims 1×1×1) · N35 (surface KIRIMINAJA_ENV) masih open.
4. Dua tagihan uji AutoLaris (#362) dibiarkan kedaluwarsa tanpa dibayar — order test-nya tinggal di
   dev DB sebagai jejak; ledger tak tersentuh.
5. ⚠️ **OVO enabled di produksi, tapi acceptance AutoLaris-nya BELUM diverifikasi ulang.** Probe
   lama (~2026-07) menjawab `rc=07` (ditolak) untuk semua e-wallet; kalau itu masih berlaku, pembeli
   yang memilih OVO mati di langkah terakhir checkout. Sebelum mengandalkan channel e-wallet mana
   pun: probe `create_payment` channel itu langsung ke AutoLaris — toggle DB tidak membuktikan sisi
   PSP. (QRIS + 5 VA terbukti hidup 2026-08-26 dengan pembayaran sungguhan.)

---

## Addendum 2026-08-28 — visibilitas & CI

- **Repo PRIVATE lagi** (perintah owner 2026-08-28, setelah public ~1 hari sejak 2026-08-27).
  Ruling standing kembali: **jangan flip visibility tanpa perintah eksplisit baru.**
- Selama jendela public, `ci.yml` hidup GRATIS dan terbukti bekerja: run sungguhan pertamanya
  menangkap `ts(18047)` di tile mega menu (fix #368, deploy 520), lalu **hijau di PR #368 dan di
  `main` (3m14s)**. ⚠️ **Dengan repo private, Actions kembali butuh billing (lapse) — CI mati lagi.**
  Memulihkan billing = CI hidup kembali tanpa perubahan apa pun; workflow-nya sudah terbukti jalan.
- Pelajaran pengukuran dari insiden itu (tercatat di BUILD-LOG 2026-08-27 10:10): **jangan
  menge-gate cek lewat pipe** (`… | tail` menelan exit code dan memotong baris errors) — jalankan
  telanjang, baca exit code, baru lognya.
- Anggap isi repo selama jendela public **terindeks** (termasuk IP VPS di docs & BUILD-LOG) —
  mitigasi opsional: allowlist firewall port SSH, placeholder IP untuk commit ke depan.
