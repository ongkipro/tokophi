import {
  Boxes,
  ChartNoAxesCombined,
  ClipboardList,
  CreditCard,
  Tags,
  UsersRound,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@tokophi/ui/card";

const features = [
  {
    icon: Boxes,
    label: "Katalog",
    title: "Produk dan stok",
    copy: "Susun produk, variasi, harga, dan jumlah stok dari Dashboard Seller.",
  },
  {
    icon: Tags,
    label: "Struktur",
    title: "Kategori",
    copy: "Kelompokkan katalog agar pengelolaan seller dan penelusuran pembeli lebih teratur.",
  },
  {
    icon: ClipboardList,
    label: "Operasional",
    title: "Pesanan",
    copy: "Periksa detail dan status pesanan sebelum melanjutkan proses pemenuhan.",
  },
  {
    icon: CreditCard,
    label: "Transaksi",
    title: "Pembayaran",
    copy: "Gunakan kanal pembayaran yang disediakan Tokophi tanpa menyiapkan akun gateway sendiri.",
  },
  {
    icon: UsersRound,
    label: "Relasi",
    title: "Pelanggan dan promosi",
    copy: "Kelola pelanggan serta aktivitas promosi toko dalam ruang kerja yang sama.",
  },
  {
    icon: ChartNoAxesCombined,
    label: "Pemantauan",
    title: "Ringkasan toko",
    copy: "Lihat aktivitas operasional dan penjualan melalui ringkasan Dashboard Seller.",
  },
] as const;

export function FeatureIconGrid() {
  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3" data-motion-stagger>
      {features.map(({ icon: Icon, label, title, copy }) => (
        <Card
          key={title}
          className="min-h-64 rounded-none bg-surface py-7 ring-0"
          data-motion-item
        >
          <CardHeader className="gap-5 px-7">
            <div className="flex size-11 items-center justify-center rounded-lg bg-primary-soft text-primary-ink">
              <Icon aria-hidden="true" className="size-5" strokeWidth={1.7} />
            </div>
            <div>
              <p className="mb-2 font-mono text-[0.6875rem] font-bold tracking-[0.14em] text-primary-ink uppercase">
                {label}
              </p>
              <CardTitle className="text-[1.125rem] font-semibold text-ink">{title}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="mt-auto px-7 text-[0.9375rem] leading-7 text-ink-muted">
            {copy}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
