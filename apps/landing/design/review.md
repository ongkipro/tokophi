Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: design/renders/bayar-kirim-1440.png, design/renders/bayar-kirim-390.png, design/renders/cara-kerja-1440.png, design/renders/cara-kerja-390.png, design/renders/demo-1440.png, design/renders/demo-390.png, design/renders/fitur-1440.png, design/renders/fitur-390.png, design/renders/harga-1440.png, design/renders/harga-390.png, design/renders/home-1440.png, design/renders/home-390.png, design/shots/sf-checkout-bayar.png, design/shots/sf-checkout-s1-kecamatan.png, design/shots/sf-pdp-harga.png, design/shots/v6-pengaturan-kirim.png
References: design/refs/berdu/390.png, design/refs/lynk/1440.png, design/refs/lynk/390.png, design/refs/mayar/1440.png, design/refs/mayar/390.png, design/refs/orderonline/1440.png, design/refs/orderonline/390.png, design/refs/scalev/1440.png, design/refs/scalev/390.png, design/refs/shopify-id/1440.png, design/refs/shopify-id/390.png, design/refs/shopify-pricing/1440.png, design/shots/builder.png, design/shots/pemasaran.png, design/shots/pesanan_massal.png, design/shots/produk-editor.png, design/shots/produk.png, design/shots/saldo.png, design/shots/sf-checkout.png, design/shots/sf-pdp.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: d3050007d156a169
Images-SHA: 7141e09f4eda227a
Output-SHA: dce64240714cfefa

Paduka Ongki, verdict-nya **REVISE**. Satu screenshot rusak, beberapa crop terpotong atau tak terbaca di 390, dan satu angka bertabrakan dengan copy.

**Cara pemeriksaan:**
- Screenshot referensi (scalev, orderonline, Mayar, Shopify) saya buka sendiri.
- Render halaman TokoΦ dan source shots selalu gagal dibuka di sesi ini ("media removed: request limit"). Ketiga agen read-only melaporkan berhasil membuka semuanya (mayar 1440 04–08 tidak termasuk; saya buka sendiri). Jadi hampir semua baris halaman di bawah adalah laporan agen, belum saya lihat sendiri.
- Yang saya buka sendiri hanya file sumber PDP `storefront-produk-mobile-780.webp`, dan cacatnya memang ada di file itu. Render /demo-nya sendiri tetap tidak bisa saya buka.

### Per bagian
| Halaman / bagian | Generik atau authored | Pola referensi | Perbaikan |
|---|---|---|---|
| **Home** hero | authored | Mayar (panel asli di samping headline) | Di 1440 frame Produk melewati tepi konten (sekitar x=1375, padahal grid berakhir di 1304). Rapikan ke grid atau sekalian bleed penuh. |
| Fact row | authored | – | Kolom 2 satu baris lebih panjang dari yang lain. Pendekkan copy-nya. |
| Alur kerja | authored | Mayar | • Di 390, langkah 2 cuma strip 4 tile setinggi ~100px dengan label ~5px dan tanpa UI builder. Ganti crop hero + tile. <br>• Langkah 3: "10 kurir" bertabrakan dengan "Pilih ekspedisi lain (13)" di screenshot-nya. |
| Untuk yang beriklan | authored | – | • Di 1440 screenshot ~2× skala yang lain dan berbingkai ganda. <br>• Di 390 tertulis "Rp42.7 jt", sedangkan di tempat lain "Rp 42.674.978". |
| Semua fitur | authored | – | Header "Penjualan dan pembayaran" wrap, jadi garisnya ~23px lebih rendah dari empat kolom lain. |
| Siapa membayar apa | authored (pembeda utama dari kompetitor) | – | Kata "ongkir." menggantung sendirian di baris Ongkos kirim. |
| Harga (band gelap) | authored | orderonline (switch bulanan/tahunan, satu paket) | • Area gelap kosong di bawah daftar "Sudah termasuk". <br>• Di 390 banyak kata menggantung: "bulan.", "iklan", "berbeda". |
| Toko demo | authored | Shopify ID | Hero "Batik Modern untuk Hari-Harimu" sudah tampil di langkah 2. Pakai PDP di sini. |
| Penutup (semua halaman) | generik | – | Separuh kanan kosong di 1440. Isi dengan baris harga. |
| **/fitur** intro, Toko, Pengiriman, Pemasaran, Operasional | intro generik, bagian lain authored | – | • Intro: separuh kanan kosong. <br>• Toko: masalah tile strip yang sama di 390. <br>• Pengiriman dan Produk berhenti rata di tepi frame (2 dan 3 baris). Di 390 ada kartu berikutnya yang mengintip. <br>• Pemasaran: bingkai ganda, sama seperti di home. |
| **/cara-kerja** langkah + ponsel daftar | authored | berdu | Ponsel daftar hampir persegi (~335×355), jadi tidak terbaca sebagai ponsel. Pakai capture setinggi penuh. Baris "13 bulan" sudah benar sesuai `billing.ts`. |
| **/pembayaran-pengiriman** COD + Kurir | authored | Mayar | • Crop Jasa Kirim cuma Same Day/Next Day, jadi semua baris yang terlihat bertuliskan "Tidak mendukung COD", padahal halamannya menjual COD. <br>• Kartu COD dan Jasa Kirim di 390 teksnya ~5–7px. <br>• "Booking massal" tidak punya screenshot. |
| **/demo** dua ponsel | authored | Shopify ID | **Rusak:** header toko yang sticky menempel di tengah layar PDP, menutupi "Stok tersedia (41)". Ada juga pita kosong ~80px di atas layar dan bayangan di tepi kanan. |

### Referensi dan riset
- **Yang sudah sesuai:** pola klaim di samping screen asli dari Mayar terbawa. Stat row, testimoni, kata headline yang di-highlight, dan dinding logo sengaja tidak dipakai. Harga terlihat dengan switch bulanan/tahunan, cukup satu paket.
- **Yang belum:** Shopify isi bingkai ponselnya selalu layar utuh yang bersih. Bingkai ponsel kita malah berisi PDP rusak, crop persegi, dan strip tile.
- **Celah riset:** capture Lynk dan Shopify pricing isinya halaman blokir/404, dan DESIGN.md sudah menandainya Blocked dengan benar. Data analytics audiens juga belum ada.
- **Bingkai ponsel:** `Screen.astro:67` pakai bezel gelap 6px, sedangkan DESIGN.md hanya menyebut hairline 1px. Catat pengecualian ini di DESIGN.md, atau samakan salah satunya.
- **Klaim:** agen tidak menemukan klaim tanpa sumber, rating, atau eyebrow di bagian halaman yang bukan screenshot. Hati-hati kalau crop ulang: source shots masih memuat bintang 4,5 (PDP), tombol "Impor" (Produk), "VIP · gratis" (pengaturan kirim), dan komponen "Testimoni" (builder).

Rencana perbaikan delapan langkah ada di `/home/ongki/.claude/plans/you-review-a-web-quiet-dewdrop.md`. Belum ada yang saya ubah di repo, karena sesi ini masih mode plan.

Most important change: capture ulang screenshot halaman produk di /demo, karena header toko menempel di tengah layar dan menutupi baris stok, dan itu satu-satunya render yang benar-benar rusak di halaman yang argumennya "ini layar asli".
Verdict: REVISE