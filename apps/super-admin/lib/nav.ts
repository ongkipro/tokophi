import { LayoutDashboard, Store, CreditCard, BarChart3, Settings, LifeBuoy, Banknote, History, ScrollText, type LucideIcon } from "lucide-react";
import { canOpenPath } from "./route-roles";

export type NavItem = { label: string; href: string; icon: LucideIcon };

export const NAV: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Toko", href: "/toko", icon: Store },
  { label: "Paket & Billing", href: "/paket", icon: CreditCard },
  { label: "Pencairan", href: "/pencairan", icon: Banknote },
  { label: "Tiket", href: "/tiket", icon: LifeBuoy },
  { label: "Analitik", href: "/analitik", icon: BarChart3 },
  { label: "Log Sistem", href: "/log-sistem", icon: ScrollText },
  { label: "Update Log", href: "/update-log", icon: History },
  { label: "Pengaturan", href: "/pengaturan", icon: Settings },
];

/**
 * The items this operator's rank can actually open.
 *
 * ⚠️ UX, NOT ENFORCEMENT — exactly like `useCan` on the seller side. The boundary is
 * `platformRouteGate` at the top of each page (and `platformGate` inside each action); this only
 * keeps a `support` operator from being offered a link that can do nothing but refuse. Deriving it
 * from the SAME `ROUTE_RULES` the gate reads is what stops the two drifting: a sidebar computed
 * from its own private list is how a screen ends up hidden but reachable, or offered but denied.
 */
export const navFor = (role: string | undefined): NavItem[] => NAV.filter((n) => canOpenPath(role, n.href));
