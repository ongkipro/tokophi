# TASK — Footer 30/20/20/30 · kategori jadi dropdown · email publik · burger menu

> **Status: ✅ DONE & DEPLOYED** · PR **#40** → `main` `f10b6ad`
> · container storefront `72209853286b` → **`31b3dcd731f6`**
>
> **Migrasi diverifikasi di sumbernya, bukan dari laporan `migrate`:**
> `information_schema` → `stores.email : text` ADA · `__drizzle_migrations` → 71 entri, stempel
> tertinggi `1784707158597` = persis milik `0070`. Jadi ia benar-benar dijalankan.
>
> **UI dioperasikan di produksi:** tombol tutup `44×44` · fokus masuk ke `#menu-close` · latar `0→0`
> · Tab ×12 terperangkap · Esc mengembalikan fokus ke burger & melepas kunci gulir · footer `450px`
> dengan kolom `24..371 / 403..624 / 656..877 / 909..1256` · `<details>` kategori tertutup lalu
> terbuka saat diklik · **0 console error**.
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


---

## Ronde 2 — burger menu: yang saya kirim tadi perilakunya, bukan tampilannya

Pemilik menegur: *"ini burger menu mobile belum"*. Benar, dan saya keliru menyebutnya selesai.

Ronde 1 memperbaiki **perilaku** — tombol 44px, fokus masuk, Tab terperangkap, kunci gulir, `<details>`.
Semuanya nyata dan perlu, dan **tak satu pun terlihat**. Dilihat dari produksi, drawer-nya masih:

- **dua pertiga kosong** — konten ±200px di panel 800px;
- **enam tautan teks yang semuanya tampak sama**, tanpa hierarki apa pun;
- dan isi paling berharga — kategori beserta foto dan jumlah produk — justru **saya sembunyikan**
  di balik `<details>` yang saya pasang sendiri.

Itu kekeliruan menilai, bukan kekeliruan mengetik: `<details>` benar untuk **footer** (sebuah direktori
— melipatnya menghemat tinggi kolom) dan salah untuk **menu toko**. Di toko, "apa yang kamu jual"
*adalah* navigasinya; menyembunyikannya di balik satu ketukan berarti menyembunyikan jawaban yang
justru dicari orang saat membuka menu.

### Yang berubah

| | Sebelum | Sesudah |
|---|---|---|
| Kategori | terlipat di `<details>` | **terlihat langsung** — 5 baris, foto 44px, jumlah produk, chevron |
| Struktur | satu daftar campur | tautan utilitas 2-up di atas · grup kategori di bawahnya |
| Dasar drawer | `<div>` **kosong** bergaris — sisa pil "Akun" yang dulu dihapus | telepon + email, hilang total kalau merchant belum mengisinya |
| Isi panel | ±200 / 800px | **608 / 800px** |

⚠️ Garis pemisah dengan ruang kosong di bawahnya adalah janji yang tidak ditepati panel itu. Ia sudah
menggantung di sana sejak pil "Akun" dicabut.

**Tanpa tombol WhatsApp di sini** — ia sengaja dikeluarkan dari footer atas permintaan pemilik, dan
peluncur chat mengambang sudah ada di setiap halaman.

### Diverifikasi (ponsel 390)

kategori terlihat langsung **7 tautan / 5 berfoto** · kontak di dasar **2** · `<details>` tersisa **0** ·
isi **608/800** · tombol tutup **44×44** · Tab ×14 **terperangkap** · 0 error.
Telepon & email diisi sementara untuk mengujinya, lalu **dikembalikan ke NULL**.


### Ronde 2 — ter-deploy & diverifikasi di produksi

PR **#42** → `main` `6e5102f` · container storefront `dc4a6de2b979` → **`2cdbb3b62a6c`**.

Drawer **dioperasikan langsung di situs live** (390px): kategori **7 tautan / 5 berfoto** ·
`<details>` tersisa **0** · isi panel **654 / 800px** · tombol tutup **44×44** · fokus masuk ke
`#menu-close` · latar **0→0** saat digulir 700px · Tab ×14 **terperangkap** · Esc mengembalikan fokus
ke burger dan melepas kunci gulir · **0 console error**. Kolom kontak di dasar terisi dari data toko
sungguhan, bukan dari contoh.
