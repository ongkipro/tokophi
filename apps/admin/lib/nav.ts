import { LayoutDashboard, ShoppingBag, Package, Users, TicketPercent, BarChart3, Megaphone, Settings, FileText, Newspaper, ListTree, MessagesSquare, LifeBuoy, Palette, FolderOpen, type LucideIcon } from "lucide-react";

export type NavChild = { label: string; href: string };
export type NavItem = { label: string; href: string; icon: LucideIcon; badge?: string; children?: NavChild[] };
export type NavGroup = { label?: string; items: NavItem[] };

// Shopify-core IA minus Themes & Apps/Plugins; Produk & Pelanggan have submenus.
export const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard },
      // Shopee's Pesanan submenu is four items; ours is three, because two of theirs
      // ("Pengiriman Massal", "Serah Terima Pesanan") are features TokoΦ does not have — a nav row
      // that opens onto nothing is worse than a nav row that isn't there. What is left are the two
      // views a seller actually lives in, as saved links onto the real list: the queue of parcels
      // to pack, and the pile of orders that went wrong.
      {
        label: "Pesanan", href: "/pesanan", icon: ShoppingBag, badge: "7",
        children: [
          { label: "Pesanan Saya", href: "/pesanan" },
          { label: "Perlu Dikirim", href: "/pesanan?tab=perlu_dikirim" },
          { label: "Pengembalian/Pembatalan", href: "/pesanan?tab=pengembalian" },
        ],
      },
      // Saldo is deliberately NOT in the sidebar. Shopify's restraint: the nav is for the WORK,
      // and money is not a place you navigate to — it is a thing you glance at. It lives in the
      // topbar chip (always visible, next to the avatar, the way every Indonesian seller tool does
      // it), and the chip opens onto /saldo. Another sidebar row would just be one more thing to
      // scan past.
      {
        label: "Produk", href: "/produk", icon: Package,
        children: [
          { label: "Kategori", href: "/produk/kategori" },
          { label: "Inventori", href: "/produk/inventori" },
          { label: "Pembelian", href: "/produk/pembelian" },
        ],
      },
      {
        label: "Pelanggan", href: "/pelanggan", icon: Users,
        children: [
          { label: "Segmen", href: "/pelanggan/segmen" },
          { label: "Ulasan", href: "/pelanggan/ulasan" },
        ],
      },
      {
        label: "CRM", href: "/crm", icon: MessagesSquare,
        children: [
          { label: "Follow-up WA", href: "/crm/followup" },
          { label: "Pipeline", href: "/crm/pipeline" },
          { label: "Template", href: "/crm/template" },
        ],
      },
      { label: "Diskon", href: "/diskon", icon: TicketPercent },
      { label: "Analitik", href: "/analitik", icon: BarChart3 },
      { label: "Pemasaran", href: "/pemasaran", icon: Megaphone },
    ],
  },
  {
    label: "Toko Online",
    items: [
      { label: "Tema", href: "/tema", icon: Palette },
      { label: "Halaman", href: "/halaman", icon: FileText },
      { label: "Blog", href: "/blog", icon: Newspaper },
      { label: "Files", href: "/files", icon: FolderOpen },
      { label: "Navigasi", href: "/navigasi", icon: ListTree },
    ],
  },
  {
    items: [
      { label: "Bantuan", href: "/bantuan", icon: LifeBuoy },
      { label: "Pengaturan", href: "/pengaturan", icon: Settings },
    ],
  },
];

// Fallback only — the topbar shows the real session store; STORES[0].plan is a default tier.
export const STORES = [
  { id: "s1", name: "Toko", plan: "Bisnis" },
  { id: "s2", name: "Kopi Senja", plan: "Pemula" },
  { id: "s3", name: "GadgetKu Store", plan: "Bisnis" },
];
