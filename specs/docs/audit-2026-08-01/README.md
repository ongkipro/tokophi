# Audit 2026-08-01 — SEBUAH POTRET, BUKAN KEADAAN SEKARANG

> 🔴 **Baca ini dulu.** Setiap angka di direktori ini diukur terhadap `origin/main` @ **`86e3ec3`**
> (1 Agustus 2026). Sejak itu repo bergerak jauh — antara lain kredensial yang diadukan di sini sudah
> diperbaiki, penangguhan operator sudah punya kolomnya sendiri, dan pendaftaran mandiri sudah
> dibuka di belakang antrean peninjauan. **Jangan mengutip angka dari sini sebagai fakta hari ini.**
> Untuk keadaan sekarang: `specs/docs/STATUS.md`, `tasks/OPEN.md`, dan kode itu sendiri — aturan repo
> ini tetap berlaku, kalau dokumen dan disk bertentangan, **disk yang menang**.

## Kenapa ini ada di sini sekarang

Laporan ini hidup **hanya sebagai file tak ter-commit** di dua git worktree (`wt-report`, `wt-audit`)
sejak 1 Agustus — 540 KB, nol jejak di `main`, dan satu `git worktree remove --force` dari lenyap
selamanya. Inventaris worktree 6 Agustus menemukannya; ini penyelamatannya. Isinya tidak diedit,
tidak dirapikan, dan tidak "diperbarui" — mengubah angka lama akan menghapus justru yang membuatnya
berguna: catatan tentang apa yang benar pada satu tanggal, dan bagaimana orang tahu.

## Isinya

| berkas | apa |
|---|---|
| `REPORT.md` | laporan utama (84 KB) — ringkasan eksekutif, temuan, dan §11 yang mencatat di mana dua sumber saling bertentangan alih-alih diam-diam memilih satu |
| `FINDINGS-SOURCE.md` | catatan sesi terkonsolidasi; **otoritas atas setiap angka** di laporan |
| `ARCHITECTURE.md` · `CODE-HEALTH.md` · `CROSS-VALIDATION.md` | tiga aliran audit yang menyuapi laporan itu |
| `html/` | enam halaman dasbor buatan tangan atas isi yang sama |

⚠️ Halaman `html/` menarik Tailwind dari **CDN**, jadi ia butuh internet dan tidak akan pernah
di-build oleh apa pun di repo ini. Ia disimpan karena isinya kerja nyata, bukan karena ia bagian dari
produk — tak ada yang menautkannya, tak ada yang mengujinya, dan tak ada yang akan memberitahu kalau
ia rusak. Markdown-nya yang jadi pegangan.

## Metode yang dipakainya, dan kenapa itu layak ditiru

Sepuluh agen paralel, masing-masing di worktree sendiri dari satu commit dasar, dengan satu aturan
yang diambil dari `STATUS.md` repo ini: **verifikasi, atau katakan bahwa kamu tidak.** Klaim yang tak
bisa dicek ditandai UNVERIFIED dan dibiarkan bertanda. Itu sebabnya laporan ini masih bisa dipercaya
sebagai catatan sejarah meski angkanya sudah basi — ia mengaku persis di mana ia tidak tahu.
