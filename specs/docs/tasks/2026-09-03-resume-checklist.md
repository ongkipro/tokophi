# Resume checklist — 2026-09-03 (ditulis sebelum restart laptop owner)

**State of main:** `#378` merged · deploy **528 finished** · produksi sehat (toko/app 200, rich 307).
**CI:** hidup & gratis (repo PUBLIC) — hijau menggerbangkan #375–#378. **Worktree sesi:** `.claude/worktrees/ka`;
checkout utama `~/projects/tokophi` sinkron (FF) dengan origin/main.

## Menunggu OWNER (urut prioritas)

1. **Kredensial R2 (±5 mnt)** — sidecar `backup-offsite` sudah LIVE di produksi, jujur `offsite-UNCONFIGURED`
   + unhealthy sampai diisi. Langkah: CF → R2 → token **Object Read & Write** (harus account-scoped) →
   bucket **PRIVATE** → isi `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET` di
   Coolify → restart service. Prosedur + **runbook restore** di `DEPLOY.md`. Setelah terisi: verifikasi
   `offsite-ok` + **jalankan uji restore** ke DB throwaway (belum pernah — SLA-DRP §3 masih 🟡 karenanya).
2. **Kirim sheet UAT ke KiriminAja** — file siap di `~/Downloads/UAT Mas Ongkie X Kiriminaja - FINAL.pdf/.docx`.
   Ini kunci `KIRIMINAJA_ENV=production` (produksi masih sandbox: booking terlihat sehat, kurir tak pernah datang).
3. **Port Coolify (8000/6001/6002/8080 terbuka publik)** — pilih: allowlist IP owner ATAU tutup total + SSH tunnel.
   (Saran lama batasi 80/443 ke CF-range DITARIK — merusak ACME LE & domain kustom non-CF.)
4. Keputusan struktural zero-downtime (sekarang 7–8 dtk/deploy): lepas health-gating + retry ≈ nol · pecah
   app Dockerfile-type (rolling sejati) · blue-green 2 replika (RAM cukup, terukur).
5. Keputusan lama yang masih menggantung: 5.8 (scope TokoΦ Account) · 5.19 (bukti tertulis retur SPX) ·
   5.20 (kredensial OAuth uji) · migrasi Hetzner.

## Antrean ENGINEERING berikutnya (tanpa input owner)

- **Re-probe OVO siang WIB** (probe malam: `rc=68 EXT TIMEOUT` ×2; kontrol QRIS `rc=11` = indikasi maintenance
  PSP). OVO sudah DINONAKTIFKAN di produksi — nyalakan hanya setelah probe bersih. Payload probe yang valid:
  bentuk `alProbeChannels` + `expired` WIB (lihat fix #375).
- **Promo-AI mati di produksi** (spawn `claude` CLI; container tak punya) → migrasi ke Claude API (1 file,
  `runClaude` → fetch; butuh `ANTHROPIC_API_KEY` di env — juga input owner).
- P1 terbuka per root `TASKS.md`: 5.1, 5.4, 5.6, 5.7, 5.13, 5.14, 5.15, 5.18 (5.14/5.15 = obat kontradiksi
  antar-dokumen yang ditemukan audit 2026-09-01). P2: 6.3, 6.4, 6.6–6.8.
- Stage 7 (gerbang rilis) belum pernah dijalankan — prasyarat klaim rilis apa pun.

## Log ringkas kereta terakhir (#375–#378, deploy 525–528)

| PR | Deploy | Isi |
|---|---|---|
| #375 | 525 | `expiryStamp` dipatok WIB (AutoLaris baca `expired` sebagai WIB — dibuktikan live; tagihan tadinya diam-diam 17 jam) |
| #376 | 526 | **Irwansyah**: caveat SPX "diyakini/belum diverifikasi", seed COD via formula asli, fix ESM — direview: bersih, gaya rumah |
| #377 | — (527 gagal) | Sidecar `backup-offsite` (rclone→R2, ro-mount, `copy` bukan `sync`, retensi remote 30d, inert+unhealthy tanpa kredensial; dibuktikan vs MinIO) |
| #378 | 528 | Fix parser env Coolify (bentuk alternate-value ditolak validator kuncinya — `compose config` lolos; contoh di KOMENTAR pun berbahaya). Deploy 527 gagal AMAN — produksi tak tersentuh |

Jebakan baru minggu ini yang wajib diingat: **parser env Coolify ≠ compose** (validasi lokal perlu, tak cukup)
dan **contoh pola berbahaya di dalam komentar sama fatalnya dengan kode** (kelas #364, kini kena dua kali).
