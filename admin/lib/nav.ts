import {
  LayoutDashboard, ShoppingBag, Package, Users, TicketPercent,
  BarChart3, Settings, type LucideIcon,
} from "lucide-react";

export type NavItem = { label: string; href: string; icon: LucideIcon; badge?: string };

// Shopify-core IA minus Themes & Apps/Plugins.
export const NAV: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Pesanan", href: "/pesanan", icon: ShoppingBag, badge: "7" },
  { label: "Produk", href: "/produk", icon: Package },
  { label: "Pelanggan", href: "/pelanggan", icon: Users },
  { label: "Diskon", href: "/diskon", icon: TicketPercent },
  { label: "Analitik", href: "/analitik", icon: BarChart3 },
  { label: "Pengaturan", href: "/pengaturan", icon: Settings },
];

export const STORES = [
  { id: "s1", name: "Batik Nusantara", plan: "Bisnis" },
  { id: "s2", name: "Kopi Senja", plan: "Pemula" },
  { id: "s3", name: "GadgetKu Store", plan: "Bisnis" },
];
