# PRICING — kartu harga TokoΦ (langganan, biaya admin pembayaran, pencairan)

> **Kartu harga, bukan mesin.** Angka di sini adalah harga yang berlaku per 2026-08-27; **mekanik,
> enforcement, dan kebenaran kanonik ada di [`FINANCE.md`](./FINANCE.md) + kode + test-nya**
> (`packages/lib/src/billing.ts` · `payment-fees.ts` · `order-finance.ts` ·
> `apps/admin/lib/ledger-credit.ts`). Kalau dokumen ini dan kode berbeda, kode menang dan dokumen
> ini bug — perbaiki. Mengubah HARGA = edit kode+test dulu (FINANCE.md §5 menyebut guard-nya),
> baru angka di sini mengikuti.

## 1. Langganan platform (seller → TokoΦ)

Satu paket, semua fitur. Harga adalah **DPP (belum termasuk PPN)**.

| Fase | Harga |
|---|---|
| Trial | **3 hari** gratis |
| Bulan pertama | **Rp50.000** |
| Bulan berikutnya | **Rp275.000/bulan** |
| Tahunan | **Rp2.700.000** (13 bulan sejak trial) |

- **PPN 11% langganan = toggle GLOBAL** (Super Admin → Pengaturan → Keuangan), **default OFF** saat
  launch — seller membayar DPP flat tanpa baris pajak. Saat ON, berlaku mulai invoice BERIKUTNYA;
  invoice yang sudah terbit tidak pernah ditulis ulang. PPN per-tenant tidak ada dan tidak dibangun.
- **VIP (`stores.comped`)** = bebas biaya langganan, keputusan Super Admin per toko.

## 2. Biaya admin pembayaran (pembeli → platform)

Ditambahkan ke total yang dibayar PEMBELI di checkout — **pembeli yang menanggung**, bukan seller.
Label di storefront selalu generik/white-label (tanpa merek PSP — ADR 0004).

| Metode | Biaya | Basis perhitungan |
|---|---|---|
| **COD** | **3%** + **PPN 11% atas fee-nya** | omset barang + ongkir yang ditagih |
| **QRIS** | **0,7%** | **omset barang** saja (bukan total bayar) |
| **Virtual Account BCA** | **Rp6.500** flat | per transaksi |
| **Virtual Account bank lain** (BNI/BRI/Mandiri/Permata/…) | **Rp3.000** flat | per transaksi |
| E-Wallet (OVO, DANA, ShopeePay, dll) | 3,0% | total bayar |
| Minimarket/retail | Rp4.000 flat | per transaksi |

- **Basis adalah bagian dari identitas fee** — QRIS dihitung dari omset, bukan dari payable; PPN
  barang milik seller TIDAK PERNAH masuk basis fee mana pun (tanpa pajak-atas-pajak).
- Tambah bank VA dengan harga sendiri = edit data `CHANNEL_FEE_OVERRIDES`, bukan logika baru.
- Channel yang aktif diatur Super Admin (`platform_payment_channels`); fee tampil ke pembeli di
  `/checkout` per metode yang dipilih, dan tercetak di thanks page ("Biaya admin").
- **Yang menagih fee ini adalah TokoΦ, bukan PSP** (Task 8.25 (a), 2026-09-17): tagihan ke PSP
  dibuat sebesar total checkout (pesanan + fee kita) sebagai grand total; fee PSP sendiri dipotong
  dari settlement kita. Pembeli membayar persis angka yang tampil di checkout. Margin platform per
  transaksi = fee kita − fee PSP. Detail: `FINANCE.md` §3.

## 3. Pembagian uang satu pesanan (siapa menerima apa)

> **Seller menerima: omset barang + PPN barang (miliknya untuk disetor).**
> **Platform menerima: ongkir yang ditagih (vs biaya kurir), fee COD, dan semua biaya admin.**

- Hak seller per pesanan = `omset (subtotal − diskon barang) + PPN barang − debit selisih ongkir`
  (debit hanya bila biaya kurir aktual melebihi ongkir yang ditagih pembeli).
- Contoh angka lengkap (COD + PPN eksklusif): lihat **FINANCE.md → Worked example**.

## 4. Pencairan dana (seller ← platform)

| Aturan | Nilai |
|---|---|
| Minimum penarikan | **Rp50.000** (`platform_payout.min_payout_idr`, bisa diubah Super Admin) |
| Dana bisa ditarik saat | pesanan **Selesai** (default aman; `release_on`) |
| Review | **manual oleh Super Admin** — Menunggu → Proses (transfer bank dimulai) → Tandai lunas |
| Bukti | referensi transfer dicatat saat Tandai lunas; tampil di `/saldo` merchant (`Ref: …`) |
| Penolakan | wajib alasan; saldo kembali penuh via entry penyesuaian; alasan tampil ke merchant |

Biaya pencairan: **tidak ada** (belum diberlakukan; bila kelak ada, ia harus masuk enforcement
dulu — bukan hanya tabel ini).

## 5. Sumber kebenaran per angka

| Angka | Kode yang meng-enforce | Guard |
|---|---|---|
| Langganan + PPN toggle | `billing.ts` `subscriptionCharge` | `billing.test.ts` |
| Fee QRIS/VA/e-wallet/retail | `payment-fees.ts` (`PAYMENT_FEES`, `CHANNEL_FEE_OVERRIDES`) | `payment-fees` pins |
| Fee COD + PPN fee | `order-finance.ts` `calculateOrderFinance` | `order-finance.test.ts` |
| Hak seller / ledger | `ledger-credit.ts` + view `order_seller_entitlements` | ledger suites |
| Min. penarikan & release | `platform_payout` (data, Super Admin → Pencairan) | `payout-transition.test.ts` |
