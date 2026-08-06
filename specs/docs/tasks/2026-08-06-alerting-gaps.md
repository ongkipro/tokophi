# Apa yang gagal DIAM-DIAM, dan siapa yang seharusnya diberi tahu

**Ditulis 2026-08-06.** Setiap baris di bawah diukur pada tanggal itu, bukan diingat. Ini bukan daftar
bug — semuanya "berfungsi"; yang tidak ada adalah **seseorang yang diberi tahu saat berhenti
berfungsi**. Repo ini sudah membayar mahal untuk kelas yang sama dua kali: `verify-rls` merah
berminggu-minggu sampai orang belajar menggulir melewatinya (dua kebocoran lintas-tenant lolos di
belakangnya), dan `cron-tracking` yang mati membuat `awbFilled` nol selama seminggu tanpa ada yang
sadar.

> **Aturannya satu kalimat: alarm yang tak pernah dibaca sama dengan alarm yang mati.**
> Jadi setiap usulan di sini harus menyebut **siapa penerimanya** dan **di mana ia sudah pasti
> melihatnya** — bukan sekadar "dicatat di log".

## Yang sudah difile sebagai task

| | apa | ukuran |
|---|---|---|
| **N57** | Pendaftar baru masuk antrean review; tak ada yang diberi tahu. Dashboard merchant menjanjikan 1×24 jam, jejaknya cuma tarik (penghitung dashboard + `platform_activity`). | **M** |
| **N58** | Tidak ada mailer sama sekali — 0 dependency, `dig MX` kosong di kedua zona. Memblokir verifikasi email, reset password merchant, kirim invoice. | **L** |

## Yang belum difile — diukur 2026-08-06

### ⓐ Tidak ada CI. `main` bisa merah dan tak ada yang tahu. 🔴
`ls .github/workflows/` → **tidak ada**. Tidak ada satu pun yang menjalankan `npm test` selain manusia
di laptopnya. Buktinya bukan hipotetis: `apps/admin/lib/seller-entity-links.test.ts` **merah di
`origin/main` sejak `e6d557e`** dan masih merah saat dokumen ini ditulis — dua kegagalan, ter-merge,
tak ada yang memblokir. Hari yang sama `packages/lib/src/store-slug.test.ts` juga merah sejak #157
sampai #168 memperbaikinya, dan itu pun ketahuan karena kebetulan ada yang menjalankan suite lengkap.

**Penerima:** siapa pun yang membuka PR. **Tempat ia pasti melihat:** status check di PR itu sendiri.
**Termurah:** satu workflow `npm ci && npm test` di push+PR. Perhatikan suite ini butuh Postgres
(`test/db-setup.ts` membuat `<DATABASE_URL>_test`) — pakai service container, dan biarkan `test:db`
yang membuat DB tak terjangkau jadi GAGAL, bukan SKIP.

### ⓑ Env yang tak sampai ke container tidak berbunyi apa pun. 🔴
Terukur malam 5→6 Agustus: `SIGNUP_ENABLED=true` disimpan di Coolify jam 17:03 UTC, deployment #368
mulai 16:59 — Coolify memotret env **saat deployment dimulai**, jadi compose hasilnya berbunyi
`SIGNUP_ENABLED: ''`. Container sehat, semua host 200/307, `/daftar` tetap tertutup, dan **tidak ada
satu pun sinyal** yang mengatakan variabelnya tidak sampai. Ketahuan hanya karena ada yang membuka
`docker exec … printenv`.

Kelas yang sama sudah pernah terjadi: `SIGNUP_ENABLED` tidak diteruskan di `docker-compose.coolify.yml`
sampai #154 — set di Coolify, tak sampai ke mana-mana, `/daftar` tutup tanpa penjelasan.

**Termurah:** endpoint `/api/health/env` yang menyebut nama-nama env kritis dan status ADA/KOSONG
(jangan pernah nilainya), lalu dicek sesudah tiap deploy. Kalau mau selangkah lagi: kartu di Super
Admin → Analitik → Sistem sudah menampilkan sebagian, tinggal dilengkapi.

### ⓒ Empat `verify-*` ada, tak satu pun dijalankan otomatis. 🟠
`packages/db` menyediakan `verify-rls`, `verify-rls-app`, `verify-migrations`, `verify-ledger` —
keempatnya read-only dan aman terhadap produksi (`verify-ledger` sudah dinyatakan begitu di #163).
Tidak ada yang memanggilnya kecuali manusia yang ingat. `verify-rls` adalah pagar yang pernah merah
berminggu-minggu; `verify-migrations` adalah satu-satunya hal yang menangkap tabrakan nomor migrasi.

**Termurah:** ikut di ⓐ (CI) untuk yang tidak butuh produksi, plus satu cron mingguan untuk
`verify-ledger` terhadap produksi.

### ⓓ Login gagal tidak dicatat di mana pun. 🟠
`grep -rn "failed_login|loginFailed|login_attempts"` → **nol hasil**. Rate limit ada
(`login:admin:<ip>` 15/menit, `login:platform:<ip>` 10/menit, `signup:admin:<ip>` 5/10menit) tapi ia
`Map` **dalam proses**: reset tiap redeploy, tidak melintasi replika, dan menghitung **IP, bukan
akun**. Artinya satu merchant tertentu bisa diserang 15/menit per alamat sumber dan **tak ada tabel,
log, atau layar mana pun yang mencatat bahwa itu sedang terjadi**.

**Penerima:** operator platform. **Termurah:** satu baris `platform_activity` per N kegagalan
berturut-turut pada satu email — bukan per kegagalan (itu jadi banjir), dan jangan pernah menyimpan
kata sandinya.

### ⓔ Sidecar cron hanya bersuara ke `docker logs`. 🟠
`cron-tracking` (interval 900 detik) adalah yang membuat resi muncul sendiri. Komentarnya sendiri di
`docker-compose.coolify.yml:281` merekam `awbFilled` nol selama seminggu saat ia tidak jalan. Sekarang
ia mencetak timestamp tiap putaran — tapi hanya ke log container, yang tak seorang pun buka tanpa
alasan.

**Termurah:** simpan `last_run_at` + hasil putaran terakhir ke tabel platform, tampilkan di Super
Admin → Analitik → Sistem sebagai "terakhir jalan N menit lalu", dan jadikan merah kalau > 30 menit.
Nilainya: yang rusak diketahui sebelum merchant menelepon karena resinya tak terbit.

### ⓕ Tidak ada pemantauan uptime dari luar. 🟡
Jendela 503 saat container bertukar itu normal (60–90 detik) dan **memang bukan hal yang perlu
dialarmkan**. Yang tak ada adalah pembeda antara jendela itu dan mati sungguhan: tidak ada yang
memeriksa keempat host dari luar VPS. Cloudflare sudah ada di depan — Health Checks-nya bisa dipakai
tanpa menambah infrastruktur.

---

## Urutan yang saya sarankan

1. **ⓐ CI** — ia satu-satunya yang mencegah item lain lahir kembali, dan `main` merah *sekarang*.
2. **ⓑ cek env sesudah deploy** — kelas kesalahan ini sudah terjadi dua kali dalam satu minggu.
3. **N57** — janji 1×24 jam yang sedang berjalan di produksi.
4. **ⓓ + ⓔ** — keduanya kecil, dan keduanya tentang hal yang sudah pernah gagal diam-diam di sini.
5. **N58 / ⓕ** — keputusan lebih besar (provider, biaya), bukan pekerjaan sore.
