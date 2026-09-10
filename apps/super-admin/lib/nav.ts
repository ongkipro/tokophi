import { LayoutDashboard, Store, CreditCard, BarChart3, Settings, LifeBuoy, Banknote, History, ScrollText, type LucideIcon } from "lucide-react";
import { canOpenPath } from "./route-roles";

/**
 * The sidebar is grouped by the KIND of work, not flattened into one list of nine (admin-product-ux:
 * "separate daily operations, monitoring, configuration, governance; do not flatten them into one
 * menu"). The groups follow `ROUTE_RULES`' own reasons: the support desk and one store's context are
 * operations; revenue, the operator trail and release notes are monitoring; billing and platform
 * settings are configuration. `Dashboard` is the home and sits above the groups unlabelled.
 */
export type NavGroup = "Operasional" | "Pantau" | "Konfigurasi";
export type NavItem = { label: string; href: string; icon: LucideIcon; group?: NavGroup };

export const NAV_GROUPS: NavGroup[] = ["Operasional", "Pantau", "Konfigurasi"];

export const NAV: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Toko", href: "/toko", icon: Store, group: "Operasional" },
  { label: "Pencairan", href: "/pencairan", icon: Banknote, group: "Operasional" },
  { label: "Tiket", href: "/tiket", icon: LifeBuoy, group: "Operasional" },
  { label: "Analitik", href: "/analitik", icon: BarChart3, group: "Pantau" },
  { label: "Log Sistem", href: "/log-sistem", icon: ScrollText, group: "Pantau" },
  { label: "Update Log", href: "/update-log", icon: History, group: "Pantau" },
  { label: "Paket & Billing", href: "/paket", icon: CreditCard, group: "Konfigurasi" },
  { label: "Pengaturan", href: "/pengaturan", icon: Settings, group: "Konfigurasi" },
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
