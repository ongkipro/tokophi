// Storefront header nav — derived from the SHARED @indostore/data menu so it
// stays in sync with the admin menu builder automatically (single source of truth).
import { MAIN_MENU, type MenuItem } from "@indostore/data/menu";

export type NavChild = { label: string; href: string };
export type NavItem = { label: string; href?: string; children?: NavChild[] };

export const MAIN_NAV: NavItem[] = MAIN_MENU.map((it: MenuItem) => ({
  label: it.label,
  // parents (with children) act as dropdown triggers, not links
  href: it.children && it.children.length > 0 ? undefined : it.href,
  children: it.children?.map((c) => ({ label: c.label, href: c.href })),
}));
