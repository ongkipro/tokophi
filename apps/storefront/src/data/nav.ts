export type NavChild = { label: string; href: string };
export type NavItem = { label: string; href?: string; children?: NavChild[] };

export const MAIN_NAV: NavItem[] = [
  { label: "Beranda", href: "/" },
  { label: "Semua Produk", href: "/kategori/semua" },
  {
    label: "Kategori",
    children: [
      { label: "Dress", href: "/kategori/dress" },
      { label: "Atasan", href: "/kategori/atasan" },
      { label: "Bawahan", href: "/kategori/bawahan" },
      { label: "Busana Muslim", href: "/kategori/busana-muslim" },
      { label: "Outerwear", href: "/kategori/outerwear" },
      { label: "Loungewear", href: "/kategori/loungewear" },
    ],
  },
  { label: "Promo Gajian", href: "/kategori/promo-gajian" },
  { label: "Blog", href: "/blog" },
  { label: "Kontak", href: "/kontak" },
];
