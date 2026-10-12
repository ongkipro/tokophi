---
title: Status pesanan
seoTitle: "Arti Status Pesanan: Baru, Diproses, Dikirim, Selesai"
description: Arti setiap status pesanan di Dashboard Seller, tab yang menampilkannya, perpindahan yang diperbolehkan, serta dampaknya pada stok dan saldo.
routes: ["/pesanan"]
verified: 2026-10-12
---

## Arti setiap status

| Status | Artinya | Yang terjadi |
|---|---|---|
| **Baru** | Pesanan baru masuk. | Untuk pesanan QRIS atau VA, tunggu sampai dibayar. Kalau tidak dibayar dalam 24 jam, pesanan otomatis **Batal**. |
| **Diproses** | Anda sedang menyiapkan paket, atau kurir sudah dipesan. | Memesan kurir otomatis memindahkan pesanan Baru ke Diproses. |
| **Dikirim** | Paket sudah di tangan kurir. | Diperbarui otomatis dari data kurir, atau lewat tombol **Tandai dikirim**. |
| **Selesai** | Paket diterima pembeli. | Dana pindah ke **Saldo tersedia**. Diperbarui otomatis saat kurir melaporkan paket terkirim, atau lewat **Tandai selesai**. |
| **Batal** | Pesanan dibatalkan. | Stok kembali. Status akhir, tidak bisa diubah lagi. |
| **Retur** | Paket kembali ke Anda. | Stok kembali dan hasil penjualan ditarik dari saldo. Status akhir. |

## Tab di halaman Pesanan

| Tab | Isinya |
|---|---|
| Semua | Semua pesanan. |
| Belum Bayar | Pesanan QRIS atau VA yang belum dibayar. Jangan dikirim dulu. |
| Perlu Dikirim | Pesanan yang sudah dibayar, atau pesanan COD. Ini yang Anda kirim. |
| Dikirim | Paket dalam perjalanan. |
| Selesai | Paket sudah diterima. |
| Pengembalian/Pembatalan | Pesanan Batal dan Retur. |

## Perpindahan yang diperbolehkan

- **Baru** → Diproses, Dikirim, atau Batal
- **Diproses** → Dikirim, Selesai, Batal, atau Retur
- **Dikirim** → Selesai, Batal, atau Retur. Bisa kembali ke Diproses hanya bila pengirimannya dibatalkan.
- **Selesai** → Retur, hanya dari data kurir. Tidak ada tombol untuk ini; kalau pembeli mengembalikan paket yang sudah diterima, buka tiket di [**Bantuan**](https://app.tokophi.com/bantuan).
- **Batal** dan **Retur** adalah status akhir.

:::caution[Penting]
Menu **⋯ → Batalkan** di daftar pesanan langsung membatalkan pesanan tanpa konfirmasi, dan tidak membatalkan kurir yang sudah dipesan. Kalau kurir sudah dipesan, batalkan pengirimannya dulu di halaman detail pesanan. Pesanan QRIS atau VA yang tidak dibayar batal sendiri setelah 24 jam, selama statusnya masih **Baru**. Lihat [Tab dan status pesanan](/pesanan/tab-dan-status/).
:::
