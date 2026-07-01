import {
  LayoutDashboard, ShoppingBag, Package, Users, TicketPercent,
  BarChart3, Settings, FileText, Newspaper, ListTree, type LucideIcon,
} from "lucide-react";

export type NavItem = { label: string; href: string; icon: LucideIcon; badge?: string };
export type NavGroup = { label?: string; items: NavItem[] };

// Shopify-core IA minus Themes & Apps/Plugins; content grouped under "Toko Online".
export const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard },
      { label: "Pesanan", href: "/pesanan", icon: ShoppingBag, badge: "7" },
      { label: "Produk", href: "/produk", icon: Package },
      { label: "Pelanggan", href: "/pelanggan", icon: Users },
      { label: "Diskon", href: "/diskon", icon: TicketPercent },
      { label: "Analitik", href: "/analitik", icon: BarChart3 },
    ],
  },
  {
    label: "Toko Online",
    items: [
      { label: "Halaman", href: "/halaman", icon: FileText },
      { label: "Blog", href: "/blog", icon: Newspaper },
      { label: "Navigasi", href: "/navigasi", icon: ListTree },
    ],
  },
  {
    items: [{ label: "Pengaturan", href: "/pengaturan", icon: Settings }],
  },
];

export const STORES = [
  { id: "s1", name: "Batik Nusantara", plan: "Bisnis" },
  { id: "s2", name: "Kopi Senja", plan: "Pemula" },
  { id: "s3", name: "GadgetKu Store", plan: "Bisnis" },
];
