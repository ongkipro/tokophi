"use server";
import { schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";

type NavItemType = "beranda" | "koleksi" | "produk" | "halaman" | "blog" | "url";
const NAV_TO_DB: Record<NavItemType, "home" | "collection" | "product" | "page" | "blog" | "url"> = {
  beranda: "home", koleksi: "collection", produk: "product", halaman: "page", blog: "blog", url: "url",
};
type NavItem = { id: string; title: string; type: NavItemType; target: string; children?: NavItem[] };

// Replace the whole tree for one menu (delete + re-insert with parent_id + position).
export async function saveMenu(handle: string, items: NavItem[]): Promise<void> {
  const { storeId: sid } = await requireCapability("content:write");
  await withTenant(sid, async (db) => {
    const [menu] = await db.select({ id: schema.menus.id }).from(schema.menus).where(eq(schema.menus.handle, handle)).limit(1);
    if (!menu) return;
    await db.delete(schema.menuItems).where(eq(schema.menuItems.menuId, menu.id));
    const insert = async (list: NavItem[], parentId: string | null): Promise<void> => {
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        const [row] = await db
          .insert(schema.menuItems)
          .values({ menuId: menu.id, parentId, label: it.title, type: NAV_TO_DB[it.type] ?? "url", target: it.target || null, position: i })
          .returning();
        if (it.children?.length) await insert(it.children, row.id);
      }
    };
    await insert(items, null);
  });
  revalidatePath("/navigasi");
}
