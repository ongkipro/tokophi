// Storefront header nav — read from the STORE'S OWN menu in the DB (`menus` / `menu_items`), i.e.
// exactly the tree the merchant builds in the admin's Navigasi editor.
//
// It used to be a hardcoded copy of @tokophi/data/menu, and the file even admitted it ("Live 'edit
// in admin UI → storefront' still needs the backend"). That backend exists now — the Navigasi editor
// persists the tree — so a merchant reordering their menu saw NOTHING change on their storefront.
// This closes that: the nav is per-tenant and dynamic.
//
// MAIN_MENU stays as the FALLBACK, not the source: a freshly provisioned store has no menu rows yet
// (provisionStore doesn't seed one), and a storefront with no navigation at all is worse than a
// sensible default.
//
// INVARIANT (as everywhere in src/data): no DB access at module scope — `astro build` stays DB-free.
import { db, schema } from "@tokophi/db";
import { asc, eq } from "drizzle-orm";
import { MAIN_MENU, type MenuItem } from "@tokophi/data/menu";
import { cached } from "./cache";
import { getPages } from "./content";

export type NavChild = { label: string; href: string };
export type NavItem = { label: string; href?: string; children?: NavChild[] };

/** The hardcoded default, used when a store has no menu of its own. */
const FALLBACK: NavItem[] = MAIN_MENU.map((it: MenuItem) => ({
  label: it.label,
  href: it.children && it.children.length > 0 ? undefined : it.href,
  children: it.children?.map((c) => ({ label: c.label, href: c.href })),
}));

export async function getMainNav(storeId: string): Promise<NavItem[]> {
  return cached(`nav:main:${storeId}`, async () => {
    const menuId = await resolveMainMenuId(storeId);
    if (!menuId) return FALLBACK;

    const rows = await db
      .select({
        id: schema.menuItems.id,
        parentId: schema.menuItems.parentId,
        label: schema.menuItems.label,
        target: schema.menuItems.target,
        position: schema.menuItems.position,
      })
      .from(schema.menuItems)
      .where(eq(schema.menuItems.menuId, menuId))
      .orderBy(asc(schema.menuItems.position));

    if (rows.length === 0) return FALLBACK;

    const byParent = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!r.parentId) continue;
      const list = byParent.get(r.parentId) ?? [];
      list.push(r);
      byParent.set(r.parentId, list);
    }

    return rows
      .filter((r) => !r.parentId)
      .map((r): NavItem => {
        const kids = (byParent.get(r.id) ?? []).map((c) => ({
          label: c.label,
          href: c.target ?? "#",
        }));
        return {
          label: r.label,
          // A parent with children is a dropdown trigger, not a link — its own target ("#" in the
          // seed) must never become an href, or clicking it navigates to nowhere.
          href: kids.length > 0 ? undefined : (r.target ?? "#"),
          children: kids.length > 0 ? kids : undefined,
        };
      });
  });
}

/**
 * The store's footer menu, as built in the admin's Navigasi editor — but with dead links removed.
 *
 * A menu item can outlive the page it points at: the seed's footer menu links to "FAQ", whose page
 * is still a DRAFT, so honouring the menu verbatim would put a link that 404s on every page of the
 * shop. The merchant chooses the ORDER and the LABELS; publication state decides what a shopper is
 * allowed to be sent to. So every `/halaman/<handle>` item is checked against the published pages
 * and dropped if it has no live target. Non-page links (a URL, /blog, …) pass through untouched —
 * we can't verify those and shouldn't pretend to.
 *
 * Falls back to listing the published pages when the store has no footer menu of its own.
 */
export async function getFooterNav(storeId: string): Promise<NavChild[]> {
  return cached(`nav:footer:${storeId}`, async () => {
    const published = new Set((await getPages(storeId)).map((p) => p.handle));

    const menus = await db
      .select({ id: schema.menus.id, handle: schema.menus.handle })
      .from(schema.menus)
      .where(eq(schema.menus.storeId, storeId));
    const footer = menus.find((m) => m.handle === "footer");

    if (footer) {
      const rows = await db
        .select({ label: schema.menuItems.label, target: schema.menuItems.target })
        .from(schema.menuItems)
        .where(eq(schema.menuItems.menuId, footer.id))
        .orderBy(asc(schema.menuItems.position));

      const live = rows
        .filter((r): r is { label: string; target: string } => !!r.target)
        .filter((r) => {
          if (!r.target.startsWith("/halaman/")) return true; // not a CMS page — can't verify
          return published.has(r.target.slice("/halaman/".length));
        })
        .map((r) => ({ label: r.label, href: r.target }));

      if (live.length > 0) return live;
    }

    // No footer menu (or every item was dead) → every published page, alphabetical.
    return (await getPages(storeId)).map((p) => ({ label: p.title, href: `/halaman/${p.handle}` }));
  });
}

/** The header menu for a store. Prefers handle 'main-menu'; otherwise the store's first menu. */
async function resolveMainMenuId(storeId: string): Promise<string | null> {
  const menus = await db
    .select({ id: schema.menus.id, handle: schema.menus.handle })
    .from(schema.menus)
    .where(eq(schema.menus.storeId, storeId));
  if (menus.length === 0) return null;
  const main = menus.find((m) => m.handle === "main-menu" || m.handle === "main");
  return (main ?? menus.find((m) => m.handle !== "footer") ?? menus[0]).id;
}
