# PLAN — KiriminAja UAT (pra-IP produksi) + AutoLaris pindah ke Create Order digital

**Status:** DEVELOPED — hasil di bawah · branch `feat/ka-uat-autolaris`
**Hasil (2026-08-24):** ① webhook hint-only DIBANGUN (`api/public/kiriminaja/webhook` + `verifyKaHint`;
auth Bearer timing-safe fail-closed; 22 test hijau) ② simulasi **9/9** jalan — 8 booking sukses
(OID `5758-UAT1032453`…`5758-UAT8032517`, tabel lengkap di repo docs kiriminaja
`documents/11-tokophi-uat/01-uat-simulation-2026-08-24.md`), cancel menunggu AWB terbit (sandbox
belum menerbitkan waybill; N34 melarang cancel via OID) ③ **TEMUAN untuk KA**: sandbox booking
validator MENGABAIKAN skala berat — booking multi-kg pada harga quote-nya sendiri ditolak "Ongkir
tidak sesuai", parcel 2 kg justru DITERIMA pada harga 1 kg (OID `5758-E1kgprice150`); detail + bukti
di md repo docs ④ AutoLaris `submit` DIPROBE + DIIMPLEMENT: `channel_code` WAJIB (tanpa → rc=01),
`courir_id:1` = digital (biaya_kirim 0), `total` = grand_total (admin provider dipotong dari
settlement, TIDAK ditagihkan ke buyer — beda dari create_payment), instruksi bayar di `payment_info`
(VABCA → `va` terisi, QRIS → payload `qr`); `alCreateOrder()` baru + 3 caller dipindah + callback
dua-era (`trx_id` ∥ `transaction_id`).
**Sumber:** `~/Downloads/UAT Mas Ongkie X Kiriminaja.pdf` (UAT MITRA API — MAS ONGKIE, 11 Aug 2026,
status PASS/REVISION) · chat KiriminAja (9 skenario simulasi) · Postman AutoLaris H2H
(`documenter.getpostman.com/view/25938923/2sB2iwFuwz`).
⚠️ **Repo tetap PRIVATE** — ruling owner 2026-08-24 menggantikan perintah go-public sebelumnya.

## A. Matriks UAT KiriminAja ↔ integrasi kita

| # | UAT item | Endpoint | Kita punya | Gap |
|---|---|---|---|---|
| 1 | Get Courier Services | `/api/mitra/couriers` + `/api/mitra/courier_services` | `platform_couriers` sync (super-admin) | none — jalankan & screenshot |
| 2 | Pricing, berat aktual > volumetrik | `/api/mitra/v6.1/shipping_price` | `kaShippingPrice` via `shipping-quote.ts` (dims ikut sejak N30) | none |
| 3 | Pricing, volumetrik > aktual | idem | idem | none |
| 4–5 | Pickup request (2 varian berat) | `/api/mitra/v6.1/request_pickup` | `createShipment` (`packageRows` → max per axis; jadwal besok 10:00 WIB) | none |
| 6 | **Webhook AWB Creation** — minta Callback URL | callback dari KA | **TIDAK ADA** — kita polling `cron-tracking` 15 mnt | **BUILD**: endpoint webhook publik |
| 7 | Shipping Label | `/api/admin/labels` (PDF) | ada | none — screenshot |
| 8 | Response Final Status | tracking → `selesai` | `cron-tracking` + `applyOrderStatusChange` | none |
| 9 | Cancel (Void), opsional | `/api/mitra/v3/cancel` | `cancelShipment` (AWB-only, N34) | none — AWB harus terbit dulu |
| — | Instant (pricing/pickup/webhook) | — | tidak dipakai produk | SKIP, tandai "-" |

### 9 skenario simulasi (chat KA) → satu script runnable

`ops/kiriminaja-uat-sim.mjs` (BARU): drive SANDBOX (`tdev.kiriminaja.com`) memakai fungsi integrasi
kita (bukan curl lepas — yang diuji KA adalah *metode yang dipakai selama integrasi*):

| Sim | payment | berat dominan | asuransi |
|---|---|---|---|
| 1 | non-COD | aktual (mis. 5.000 g, 10×10×10) | – |
| 2 | non-COD | volumetrik (mis. 1.000 g, 40×30×20 ⇒ 4.000 g) | – |
| 3 | non-COD | aktual | ✔ |
| 4 | non-COD | volumetrik | ✔ |
| 5 | COD (SPX) | aktual | – |
| 6 | COD (SPX) | volumetrik | – |
| 7 | COD (SPX) | aktual | ✔ |
| 8 | COD (SPX) | volumetrik | ✔ |
| 9 | cancel salah satu OID (setelah AWB terbit; N34: kirim AWB, bukan OID) | | |

Output: tabel OID + `pickup_number` + harga per skenario → diisi ke kolom "Sample Order" UAT sheet;
bukti pricing per varian berat (quote vs booking sama — N30). Data DB tidak disentuh: script
membangun parcel sintetis lewat parameter eksplisit, order lokal probe ditandai dan dibersihkan.

### Yang harus DIBANGUN/DISEMPURNAKAN sebelum simulasi

1. **Webhook AWB** (`apps/admin/app/api/public/kiriminaja/webhook/route.ts`): terima callback KA
   (AWB creation + status), cocokkan `ka_order_id` → isi `orders.awb` idempoten (tulisan yang sama
   dengan `cron-tracking`; polling TETAP jalan sebagai jaring — webhook adalah percepatan, bukan
   pengganti). Validasi: hanya order dengan `ka_order_id` kita; payload asing di-log + 200 (KA
   retry). Callback URL utk UAT sheet: `https://app.tokophi.com/api/public/kiriminaja/webhook`.
2. **Asuransi end-to-end**: `createShipment` sudah punya `insurance?: boolean` →
   `insuranceAmount = subtotal`; quote mengirim `insurance: 0` selalu. Sim memanggil dengan
   asuransi eksplisit; TIDAK menambah UI baru (di luar scope UAT).
3. **Perbaiki seed dims 1×1×1 (N33)** — TIDAK diperlukan untuk sim (parcel sintetis), tetap open.

## B. AutoLaris → Create Order (`/api/h2h/submit`) dengan `courir_id = 1`

**Ruling owner:** AutoLaris = payment gateway SAJA; semua pengiriman via KiriminAja. Supaya order
terdeteksi **digital** di CMS AutoLaris, pakai endpoint **Create Order** (`/api/h2h/submit`) dengan
**`courir_id: 1`** (field vendor memang typo `courir_id`). Jangan pakai `create_payment` H2H lagi.

Fakta dari Postman (diverifikasi 2026-08-24 via collection JSON):
- `submit` body: `reff_id`, `channel_code`, `courir_id`, origin/destination, weight/dims,
  shipper/receiver, `callback_url`, `grand_total`, `cod_value`, `order_details[]`.
- Response: `rc/ket/data{channel_code, transaction_id, reff_id, biaya_kirim, biaya_cod,
  biaya_admin, biaya_asuransi, diskon, total, pickup_info…}`.
- ⚠️ **Ambigu yang harus diuji, bukan diasumsikan:** owner bilang "Channel_code ini g ada" — sample
  body `submit` justru MEMBAWA `channel_code`. Hipotesis: untuk order digital (`courir_id=1`)
  channel dipilih di sisi AutoLaris / tidak wajib. Uji di step 1 dengan nominal kecil; kalau
  `channel_code` tetap diterima, kirim channel pilihan shopper (perilaku sekarang dipertahankan).

Langkah:
1. **Probe kontrak** (script sekali-jalan, nominal kecil): `submit` dengan `courir_id:1`, ± `channel_code`,
   `order_details` = item langganan/order; catat respons (VA? QR? URL?) + bentuk callback-nya.
2. **Klien**: tambah `alCreateOrder()` di samping `alCreatePayment()`; pemanggil (checkout
   `payments.ts` + billing langganan) pindah ke `alCreateOrder` HANYA setelah probe membuktikan
   respons membawa instruksi bayar yang setara (VA/QR/URL). Callback route: cocokkan juga
   `transaction_id` (submit) selain `trx_id` (create_payment) — dua era harus hidup berdampingan.
3. **Fee schedule tidak berubah** (FINANCE.md tetap sumber): `biaya_admin` AutoLaris adalah biaya
   provider ke KITA; yang ditagihkan ke pembeli tetap jadwal platform.
4. Urutan merge: SETELAH PR #342 (finance) — file yang sama (`payments.ts`, billing) disentuh keduanya.

## C. Urutan eksekusi

1. Webhook endpoint + test (unit + curl payload sampel).
2. `ops/kiriminaja-uat-sim.mjs` → jalankan 9 skenario di sandbox → tabel OID.
3. Probe kontrak AutoLaris `submit` → putuskan channel_code → implement `alCreateOrder` + switch.
4. md hasil UAT ke repo docs `~/Documents/kiriminaja` (tabel skenario + OID + payload contoh).
5. Update `TASKS.md`, BUILD-LOG, STATUS; task md handover untuk Irwansyah; memori.
