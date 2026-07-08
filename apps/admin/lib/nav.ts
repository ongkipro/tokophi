import {
  LayoutDashboard, ShoppingBag, Package, Users, TicketPercent,
  BarChart3, Megaphone, Settings, FileText, Newspaper, ListTree,
  MessagesSquare, type LucideIcon,
} from "lucide-react";

export type NavChild = { label: string; href: string };
export type NavItem = { label: string; href: string; icon: LucideIcon; badge?: string; children?: NavChild[] };
export type NavGroup = { label?: string; items: NavItem[] };

// Shopify-core IA minus Themes & Apps/Plugins; Produk & Pelanggan have submenus.
export const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard },
      { label: "Pesanan", href: "/pesanan", icon: ShoppingBag, badge: "7" },
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
      { label: "Halaman", href: "/halaman", icon: FileText },
      { label: "Blog", href: "/blog", icon: Newspaper },
      { label: "Navigasi", href: "/navigasi", icon: ListTree },
    ],
  },
  {
    items: [{ label: "Pengaturan", href: "/pengaturan", icon: Settings }],
  },
];

// Fallback only — the topbar shows the real session store; STORES[0].plan is a default tier.
export const STORES = [
  { id: "s1", name: "Toko", plan: "Bisnis" },
  { id: "s2", name: "Kopi Senja", plan: "Pemula" },
  { id: "s3", name: "GadgetKu Store", plan: "Bisnis" },
];
