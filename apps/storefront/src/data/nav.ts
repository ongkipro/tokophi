// Storefront header nav — read from the STORE'S OWN menu in the DB (`menus` / `menu_items`), i.e.
// exactly the tree the merchant builds in the admin's Navigasi editor.
//
// It used to be a hardcoded copy of @tokophi/data/menu, and the file even admitted it ("Live 'edit
// in admin UI → storefront' still needs the backend"). That backend exists now — the Navigasi editor
// persists the tree — so a merchant reordering their menu saw NOTHING change on their storefront.
// This closes that: the nav is per-tenant and dynamic.
//
// The FALLBACK is used when a store has no menu rows of its own — which is not an edge case: per
// `provisionStore`, that is EVERY freshly provisioned store, and 6 of the 7 stores in the DB today.
// A storefront with no navigation at all is worse than a sensible default, so a default there must be.
//
// ⚠️ It must not be a CONSTANT. It was `MAIN_MENU` from `@tokophi/data/menu` — a hardcoded copy of
// Batik Nusantara's categories — so every store without a menu served a "Kategori" dropdown reading
// Dress / Atasan / Bawahan / Busana Muslim / Outerwear / Loungewear. Measured on kopi-senja:
// `/kategori/dress` → **404**, `/kategori/atasan` → **404**, on every page of the shop. Same bug as
// the batik hero in the fallback homepage and the display serif in global.css: the demo's content
// living in a platform default and leaking to every tenant.
//
// It is now DERIVED from the store's own collections, and the shape of the fix is the one
// `getFooterNav` below already uses ("falls back to listing the published pages"). Only routes every
// tenant genuinely has are hardcoded: `/`, `/blog`, `/kontak`, and `/kategori/semua` +
// `/kategori/promo-gajian` — VIRTUAL collections `kategori/[handle].astro` always resolves (measured
// 200 on both the demo and a store with an unrelated catalogue).
//
// INVARIANT (as everywhere in src/data): no DB access at module scope — `astro build` stays DB-free.
import { db, schema } from "@tokophi/db";
import { asc, eq } from "drizzle-orm";
import { VIRTUAL_COLLECTION_HANDLES } from "./catalog";
import { cached } from "./cache";
import { getPages } from "./content";

export type NavChild = { label: string; href: string };
export type NavItem = { label: string; href?: string; children?: NavChild[] };

/** Just enough of `Collection` to build a menu — the caller passes `catalog.collections`. */
export type NavCollection = { handle: string; name: string };

/**
 * The default menu for a store that has not built one — every entry a route THIS store can serve.
 *
 * No collections → NO "Kategori" dropdown at all, rather than an empty one or (as before) six links
 * into another merchant's catalogue. A missing menu item is a smaller loss than a 404.
 */
function fallbackNav(collections: NavCollection[]): NavItem[] {
  const items: NavItem[] = [
    { label: "Beranda", href: "/" },
    // `/produk`, not `/kategori/semua`: the real listing page exists now (pages/produk/index.astro).
    // The virtual collection was standing in for it and is kept only so merchant-built menus that
    // already point at it keep resolving.
    { label: "Semua Produk", href: "/produk" },
  ];
  if (collections.length > 0) {
    items.push({
      label: "Kategori",
      // No `href`: a parent with children is a dropdown trigger, not a link.
      children: collections.map((c) => ({ label: c.name, href: `/kategori/${c.handle}` })),
    });
  }
  // **Promo is a DEFAULT nav item for every store**, and it is a ROUTE, not a collection.
  //
  // The old hardcoded "Promo Gajian" was rightly removed — that was a demo-only COLLECTION handle that
  // 404'd elsewhere. `/promo` is the opposite: a route every storefront serves, gathering the flash
  // sale, voucher codes, free-ongkir threshold and every discounted product (PROMO P4). Until now the
  // only link to it was gated on the store happening to own a `promo-gajian` collection, so a store
  // with live vouchers and a running flash sale published an indexable hub with **zero inbound links**.
  //
  // Not gated on "does this store have a promo right now": a merchant switches promos on and off all
  // month, and a menu item that appears and vanishes underneath them is worse than one that sometimes
  // leads to an honest empty state — which `/promo` already renders (`hasAnything`). This is a
  // FALLBACK anyway: the moment a merchant builds their own menu in Navigasi, theirs wins entirely,
  // so anyone who does not want it simply deletes it.
  items.push({ label: "Promo", href: "/promo" }, { label: "Blog", href: "/blog" }, { label: "Kontak", href: "/kontak" });
  return items;
}

/**
 * Is `/kategori/<handle>` a page THIS store can actually serve?
 *
 * Same principle `getFooterNav` applies to `/halaman/` links, for the same reason: a menu item can
 * outlive its target. The merchant chooses the ORDER and the LABELS; publication state decides what
 * a shopper is allowed to be sent to. The seed proves it is not hypothetical — the demo's main menu
 * links "Outerwear", whose collection ships `published = false`. That link 404s, on every page of
 * the shop. (It used to resolve only because `catalog.collections` was a hardcoded allowlist that
 * ignored the `published` column — i.e. the shop was publishing a category its merchant had
 * switched off, and the dead menu link was hidden behind that bug.)
 *
 * Only `/kategori/` links are checked. Everything else (a URL, /blog, /halaman/…) passes through —
 * we can't verify those here and shouldn't pretend to.
 */
function categoryLinkIsLive(href: string, live: Set<string>): boolean {
  if (!href.startsWith("/kategori/")) return true;
  return live.has(href.slice("/kategori/".length).replace(/\/$/, ""));
}

/**
 * @param collections the store's own collections (`catalog.collections`) — the fallback menu is
 *   built from them, and a store that HAS built a menu gets exactly that menu minus any category
 *   link with no live target (see `categoryLinkIsLive`).
 */
export async function getMainNav(storeId: string, collections: NavCollection[] = []): Promise<NavItem[]> {
  return cached(`nav:main:${storeId}`, async () => {
    const menuId = await resolveMainMenuId(storeId);
    if (!menuId) return fallbackNav(collections);

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

    if (rows.length === 0) return fallbackNav(collections);

    const byParent = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!r.parentId) continue;
      const list = byParent.get(r.parentId) ?? [];
      list.push(r);
      byParent.set(r.parentId, list);
    }

    // Every category this store can serve: its live collections + the virtual routes
    // (kategori/[handle].astro) that every tenant always resolves.
    const live = new Set<string>([...collections.map((c) => c.handle), ...VIRTUAL_COLLECTION_HANDLES]);

    return rows
      .filter((r) => !r.parentId)
      .map((r): NavItem => {
        const kids = (byParent.get(r.id) ?? [])
          .map((c) => ({ label: c.label, href: c.target ?? "#" }))
          .filter((c) => categoryLinkIsLive(c.href, live));
        return {
          label: r.label,
          // A parent with children is a dropdown trigger, not a link — its own target ("#" in the
          // seed) must never become an href, or clicking it navigates to nowhere.
          href: kids.length > 0 ? undefined : (r.target ?? "#"),
          children: kids.length > 0 ? kids : undefined,
          // A parent whose children were ALL dropped is not a dropdown any more — mark it for the
          // filter below rather than rendering a trigger that opens an empty panel.
          _dead: kids.length === 0 && (byParent.get(r.id)?.length ?? 0) > 0,
        } as NavItem & { _dead: boolean };
      })
      .filter((r) => {
        const { _dead } = r as NavItem & { _dead?: boolean };
        if (_dead) return false;
        return categoryLinkIsLive(r.href ?? "#", live);
      })
      .map(({ label, href, children }): NavItem => ({ label, href, children }));
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
