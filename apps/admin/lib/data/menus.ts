import "server-only";
import { schema } from "@tokophi/db";
import { withCurrentTenant } from "@/lib/tenant";
import { asc, eq } from "drizzle-orm";
import type { NavMenu, NavItem, NavItemType } from "@/lib/mock/store";

const DB_TO_TYPE: Record<string, NavItemType> = {
  home: "beranda", collection: "koleksi", product: "produk", page: "halaman", blog: "blog", url: "url", catalog: "koleksi",
};

export async function getMenus(): Promise<NavMenu[]> {
  return withCurrentTenant(async (db) => {
    const menus = await db.select().from(schema.menus);
    const out: NavMenu[] = [];
    for (const m of menus) {
      const items = await db
        .select()
        .from(schema.menuItems)
        .where(eq(schema.menuItems.menuId, m.id))
        .orderBy(asc(schema.menuItems.position));
      const byParent = new Map<string, typeof items>();
      for (const it of items) {
        const k = it.parentId ?? "root";
        (byParent.get(k) ?? byParent.set(k, []).get(k)!).push(it);
      }
      const build = (key: string): NavItem[] =>
        (byParent.get(key) ?? []).map((it) => ({
          id: it.id,
          title: it.label,
          type: DB_TO_TYPE[it.type] ?? "url",
          target: it.target ?? "",
          children: byParent.has(it.id) ? build(it.id) : undefined,
        }));
      out.push({ handle: m.handle, title: m.name, isDefault: m.handle === "main-menu", items: build("root") });
    }
    // main-menu first, then footer
    return out.sort((a, b) => (a.handle === "main-menu" ? 0 : 1) - (b.handle === "main-menu" ? 0 : 1));
  });
}
