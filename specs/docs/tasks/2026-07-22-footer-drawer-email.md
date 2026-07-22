# TASK — Footer 30/20/20/30 · kategori jadi dropdown · email publik · burger menu

> **Status: 🟡 IN PROGRESS** · 2026-07-22/23 · branch `worktree-super-admin-overhaul`
> · commit awal `463341c` (= `origin/main`)
>
> Lanjutan dari [palet layar penuh](./2026-07-22-palet-fullscreen.md).

## Permintaan pemilik

1. "kategori buat dropdown aja → jadi secara column footer ada 4 misal 30 20 20 30 (%). tapi
   betternya gimana kamu atur"
2. "column paling kanan → alamat dulu, baru contact + email jika perlu (masukan input email di
   pengaturan profile) → sosmed icon"
3. "sempurnakan juga burger menu ui/ux mobile"

## 🔴 Temuan terbesar: migrasi email HAMPIR tidak pernah diterapkan di produksi

`CLAUDE.md` memperingatkan bahwa migrasi ber-`when` di masa depan membuat drizzle **melewati** migrasi
berikutnya **sambil mencetak "applied successfully"**. Diperiksa sebelum deploy, dan memang armed:

| | stempel | |
|---|---|---|
| `0070` punya saya | `1784556403704` | 2026-07-20 14:06 |
| maks tercatat di **produksi** | `1784707098597` | 2026-07-22 07:58 |
| **akan dilewati?** | **YA** | |

Kalau dibiarkan: kolom `stores.email` tak pernah dibuat di produksi, migrate tetap melapor sukses, dan
form Seller yang baru meledak saat Simpan ditekan. Stempelnya dinaikkan ke atas milik produksi.

**Juga ditemukan:** DB dev bersama sedang drift — `npm run migrate` tersandung `0062` karena
`orders.problem_at` sudah ada (persis catatan CLAUDE.md soal migrasi branch lain yang ikut terpasang
di container bersama). **Pembukuan orang lain TIDAK diperbaiki**; kolomnya ditulis terarah dan
idempoten (`ADD COLUMN IF NOT EXISTS`) sesuai AGENTS.md.

## Keputusan desain

**Kolom footer 30/20/20/30 lewat track 10 kolom (3/2/2/3).** Bukan pembagian sembarang: ia
memasangkan dua blok **konten** dengan bobot sama di luar (siapa tokonya · cara menghubunginya) dan
menaruh dua **daftar tautan** di antaranya. Rangka simetris terbaca sebagai keputusan; empat
perempatan sama besar terbaca sebagai default. Angkanya juga menjawab isinya: 30% = 341px, cukup
untuk lima ikon sosmed 44px dalam satu baris; 20% = 227px, lewat dari ~155px yang dibutuhkan
"Kebijakan Pengembalian". Sepuluh kolom karena 30/20/20/30 habis dibagi sepuluh — track dua-belas
memaksa 3,6, dan pecahan yang harus dibulatkan adalah grid yang berdebat dengan angkanya sendiri.

**Urutan kolom kanan: alamat → telepon → email → sosmed.** Di mana toko berada didahulukan karena itu
yang paling lambat dibangun dan paling dulu dicek pembeli sebelum percaya toko asing; cara
menghubungi menyusul; profil sosmed terakhir karena ia menuntun **keluar** dari halaman.

**Email publik ≠ email login.** `users.email` adalah kredensial: unik lintas platform, dan
menerbitkannya berarti memasang identitas login di setiap halaman situs publik. `stores.email` adalah
korespondensi toko — sering inbox bersama, dan merchant justru ingin ia terbit. Validasinya memakai
`emailError()` yang sudah ada (bentuk saja, **tanpa whitelist domain** — daftar putih menolak alamat
korporat/kampus/self-hosted, yang justru bernilai lebih tinggi).

## Burger menu — diukur, bukan ditebak

| Diuji | Sebelum | Sesudah |
|---|---|---|
| Tombol tutup | **38×38** — di bawah lantai 44px audit #16 | **44×44** |
| Fokus saat dibuka | tetap di burger, **di luar** panel | masuk ke `#menu-close` |
| Tab 14× | — | ✅ terperangkap |
| Shift+Tab | — | ✅ tetap di dalam |
| Esc | menutup | menutup **+ fokus kembali** ke burger |
| Kunci gulir | `body` | `documentElement` + kompensasi scrollbar, sama seperti palet |
| Akordeon kategori | ~25 baris JS | **`<details>` native** |

⚠️ Drawer sudah lama mengaku `role="dialog" aria-modal="true"` **tanpa menegakkannya** — fokus tak
pernah masuk dan Tab bisa keluar. Mengumumkan modalitas yang tidak ditegakkan adalah kontrol
setengah-jadi yang repo ini terus bayar.

## Yang DIHAPUS (bukan diganti)

- Skrip akordeon drawer: chevron, kelas `hidden`, dan `aria-expanded` yang saling disinkronkan.
  `<details>` membuat ketiganya milik platform.
- `border-l` + indentasi kategori di footer.

---

## NEXT

- Verifikasi setelah deploy: **kolom `stores.email` benar-benar ada di produksi** — jangan percaya
  laporan migrate, tanyakan ke `information_schema`.
