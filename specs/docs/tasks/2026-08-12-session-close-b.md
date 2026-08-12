# Session close B — 2026-08-12 dini hari (lanjutan setelah #260): 6 PR lagi, produksi disentuh
# dengan izin, satu insiden dibuat dan dipulihkan

Babak pertama malam ini ditutup `2026-08-12-session-close.md` (#260, ~01:00 WIB). File ini menutup
babak keduanya (~01:00–04:40 WIB). Sesi peer bekerja paralel sepanjang malam (#261 #262 #263 #265
#266 #270 #272 #273 — slug rename, platform theme, screening, post-ship polish, order-finance);
file ini hanya merekam alur sesi INI. Base at close: `261e4c5`.

## Shipped babak B, urut merge — semua CI hijau (sha-bound watch)

| PR | apa | yang layak diingat |
|---|---|---|
| #264 | fix CI merah sejak #259 | Dua bagian yang N13 lupa: doc-counts (94 migrasi) + fixture `Product.lastModified`. Insidennya milik sesi ini sendiri, DAN verifikasinya cacat ganda: exit code termakan pipe `\| tail`, watch CI menempel ke run lama. **Aturan sejak itu: exit code tidak pernah lewat pipe; watch CI diikat ke sha.** |
| #267 | rekaman mutasi prod N41 | Dua SQL yang disetujui owner dieksekusi: `store_shipping_methods` demo 10→20 (`INSERT 0 10`, `spx:3` — rel COD terpilih lagi) · `reviews.product_id` backfill `UPDATE 8` → NULL 0. Plus probe `verify-ledger` prod (all green, rollback dikonfirmasi 0) — item "could not measure" terakhir screening #263 tutup. Termasuk ATRIBUSI txid 45536 yang audit paralel lihat tanpa tahu penulisnya. |
| #268 | seed kurir ikut operator + `saveCouriers` log | Forensik (arkeologi epoch seed + bracketing `xmin`): prod `idx=t, jtcargo=t, ninja=f` mustahil residu seed — keputusan operator. `COURIERS_OFF → ["ninja"]`; dan `saveCouriers` akhirnya menulis `platform_activity` (kelalaian yang membuat pertanyaannya sempat tak terjawab dari log). |
| #269 | salvage branch headless | Diambil: `ARCHITECTURE_RECOMMENDATIONS.md` (keputusan tetap-monorepo, dengan nota koreksi bertanggal) + rekonsiliasi `DEPLOY.md` (Watch Paths `!**/*.md` — alasan resmi commit md-only tidak build; cron hourly+flock diverifikasi di box). Dibuang: OPEN.md/README-nya (analisis basi 08-07, me-regress penutupan 08-12). |
| #271 | script cleanup live di-commit | Temuan #269: script hourly yang jalan di VPS **tak pernah di-commit** — `scp` dari repo akan MEN-DOWNGRADE box. Kini salinan byte-for-byte dari box; warning DEPLOY.md diganti nota resolusi bertanggal. |
| (branch, tanpa PR) | `docs/n40-v62-contract` @ `596ed83` | **Verdict N40: AMAN MIGRATE, one-line.** Kontrak v6.2 = v6.1 + field KA Credit opsional; nama field tujuan TIDAK berubah — probe wrong-type memaksa service Go sandbox membocorkan struct-nya (`destination_kecamatan_id`/`_kelurahan_id` persis nama yang kode kirim), dan **kedua sisi kontradiksi dokumen vendor sama-sama salah**. ~45 probe, NOL booking tercipta. Belum terbukti: bentuk respons sukses → fase-2 butuh SATU booking verifikasi dengan izin owner. Catatan: v6.2 balas error bisnis HTTP 400 (v6.1 pakai 200) — `ka()` sudah toleran. |

## Forensik & pengukuran ulang (dalam #267)

- **N29 berubah bentuk, urgensi TURUN**: prod kini 12 principal — 10 merchant signup riil (di luar
  scope rotasi, password pilihan sendiri) + 2 principal epoch-seed yang DUA-DUANYA sudah ditulis
  ulang pasca-seed (email operator bukan lagi `admin@tokophi.id`; owner demo juga diganti). Tujuh
  toko demo lama + `toko-tes` sudah tidak ada. Sisa aksi: owner jalankan §① runbook terhadap 2 akun
  itu bila ingin kepastian password. `tema-platform` yang ownerless = desain holder #262, bukan
  anomali — tapi query rotasi ber-key membership tidak akan menjangkaunya (tercatat).
- **HSTS raise di-SKIP atas instruksi owner** (task time-gated-nya tetap ter-file oleh sesi peer,
  bisa dihidupkan kapan pun).

## ⚠️ Insiden babak B — dibuat sendiri, dipulihkan penuh, diungkap

Saat mengerjakan #271, `cd` ke worktree tidak persist antar-perintah shell, sehingga
`git reset --hard origin/main` + commit berjalan di ROOT CHECKOUT dan menggeser `main` lokal stale
(yang by-konsensus tidak disentuh, #15-superseded). Pemulihan: commit di-cherry-pick ke branch yang
benar → PR #271; `main` root dikembalikan PERSIS ke `4696c45` via reflog; 4 file UIUX untracked
milik sesi lain selamat (untracked kebal reset); stash tak tersentuh. Kerugian yang diperkirakan:
nol (root hanya berisi untracked per handoff 08-11/08-12) — **tapi bila ada sesi yang menyimpan
MODIFIKASI tracked di root checkout sebelum ~04:15 WIB, itu ikut tersapu dan pemiliknya perlu
memeriksa.** Pelajaran: `pwd` + `git branch --show-current` sebelum SETIAP operasi destruktif;
jangan pernah `reset --hard` tanpa keduanya tercetak di output yang sama.

## Skor kumulatif satu malam (babak A + B, sesi ini saja)

13 PR merged (#253–#260, #264, #267–#269, #271), semua CI hijau · 2 mutasi produksi disetujui +
tereksekusi + terekam beratribusi · 3 forensik tuntas (intent kurir, N29, kontrak v6.2) · 1 bug
laten produksi ditemukan gratis (bulk "Cetak resi" tak pernah bisa jalan — `li.variant`, 42703,
fixed di #258) · 1 jebakan ops dijinakkan (script downgrade) · 2 insiden milik sendiri diperbaiki
dengan disclosure (CI merah #259; reset root) · antrean no-decision papan: KOSONG.

## Yang tersisa setelah malam ini

- **N40 fase-2** — one-line bump + 1 booking verifikasi sandbox; MENUNGGU izin owner (verdict +
  fixture siap di `docs/n40-v62-contract`).
- **Kunci owner**: token R2 (DR-1 — backup masih local-only, item paling bernilai berikutnya) ·
  credential `demo@tokophi.com`/impersonation (SEC-4 + profiling dashboard).
- **Keputusan owner**: N57 transport notifikasi signup · N58 mailer · parcel-size vs quantity ·
  N1 ADR impersonation · N16 DML `tokophi_app` · debris dev DB (N25 + kolom orphan + 7 stamp) ·
  N28 crawl · `idx:00`/`jtcargo:REG` di picked-set demo · devDep `eslint-plugin-astro` · narrow CF
  token · HSTS raise (di-skip, bisa dibuka lagi) · N29 §① double-check 2 akun.
- **Eksternal KiriminAja**: path registrasi webhook (N39) · endpoint `libur`.
