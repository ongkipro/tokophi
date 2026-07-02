// Canonical navigation menus — the SINGLE source of truth shared by the
// merchant admin (menu builder) and the Astro storefront (header/footer).
// Editing here updates both surfaces on rebuild. (Live "edit in admin UI →
// storefront" still needs the backend/M3, which will persist these.)

export type MenuItemType =
  | "beranda"
  | "koleksi"
  | "produk"
  | "halaman"
  | "blog"
  | "url";

export type MenuItem = {
  id: string;
  label: string; // display text
  type: MenuItemType;
  href: string; // storefront target URL
  children?: MenuItem[];
};

// Header menu — shown in the storefront top nav (parent + dropdown children).
export const MAIN_MENU: MenuItem[] = [
  { id: "m1", label: "Beranda", type: "beranda", href: "/" },
  { id: "m2", label: "Semua Produk", type: "koleksi", href: "/kategori/semua" },
  {
    id: "m3",
    label: "Kategori",
    type: "url",
    href: "#",
    children: [
      { id: "m3a", label: "Dress", type: "koleksi", href: "/kategori/dress" },
      { id: "m3b", label: "Atasan", type: "koleksi", href: "/kategori/atasan" },
      { id: "m3c", label: "Bawahan", type: "koleksi", href: "/kategori/bawahan" },
      { id: "m3d", label: "Busana Muslim", type: "koleksi", href: "/kategori/busana-muslim" },
      { id: "m3e", label: "Outerwear", type: "koleksi", href: "/kategori/outerwear" },
      { id: "m3f", label: "Loungewear", type: "koleksi", href: "/kategori/loungewear" },
    ],
  },
  { id: "m4", label: "Promo Gajian", type: "koleksi", href: "/kategori/promo-gajian" },
  { id: "m5", label: "Blog", type: "blog", href: "/blog" },
  { id: "m6", label: "Kontak", type: "halaman", href: "/kontak" },
];

// Footer menu — informational links.
export const FOOTER_MENU: MenuItem[] = [
  { id: "f1", label: "Tentang Kami", type: "halaman", href: "/halaman/tentang-kami" },
  { id: "f2", label: "Cara Pemesanan", type: "halaman", href: "/halaman/cara-pemesanan" },
  { id: "f3", label: "Kebijakan Pengembalian", type: "halaman", href: "/halaman/kebijakan-pengembalian" },
  { id: "f4", label: "Kebijakan Privasi", type: "halaman", href: "/halaman/kebijakan-privasi" },
  { id: "f5", label: "FAQ", type: "halaman", href: "/halaman/faq" },
];
