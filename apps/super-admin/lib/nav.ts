import { LayoutDashboard, Store, CreditCard, BarChart3, Settings, type LucideIcon } from "lucide-react";

export type NavItem = { label: string; href: string; icon: LucideIcon };

export const NAV: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Toko", href: "/toko", icon: Store },
  { label: "Paket & Billing", href: "/paket", icon: CreditCard },
  { label: "Analitik", href: "/analitik", icon: BarChart3 },
  { label: "Pengaturan", href: "/pengaturan", icon: Settings },
];
