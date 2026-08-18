"use server";
import { schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
import { uniqueViolationConstraint } from "@tokophi/lib/pg-errors";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant, type Tx } from "@/lib/tenant";

type NavItemType = "beranda" | "koleksi" | "produk" | "halaman" | "blog" | "url";
export type MenuItemInput = {
  title: string;
  type: NavItemType;
  target: string;
  children?: MenuItemInput[];
};
export type CreateMenuInput = { title: string; items: MenuItemInput[] };
export type SaveMenuInput = CreateMenuInput & { handle: string };

type MenuErrorCode = "invalid_request" | "not_found" | "save_failed";
type MenuError = { ok: false; code: MenuErrorCode; error: string };
export type CreateMenuResult = { ok: true; handle: string } | MenuError;
export type SaveMenuResult = { ok: true } | MenuError;

const NAV_TO_DB: Record<
  NavItemType,
  "home" | "collection" | "product" | "page" | "blog" | "url"
> = {
  beranda: "home",
  koleksi: "collection",
  produk: "product",
  halaman: "page",
  blog: "blog",
  url: "url",
};
const NAV_TYPES = new Set<NavItemType>(
  Object.keys(NAV_TO_DB) as NavItemType[],
);
const HANDLE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MENU_HANDLE_UNIQUE = "menus_storeId_handle_unique";

class MenuRuleError extends Error {
  constructor(
    readonly code: Exclude<MenuErrorCode, "save_failed">,
    message: string,
  ) {
    super(message);
  }
}

function titleFrom(value: unknown): string {
  const title = typeof value === "string" ? value.trim() : "";
  if (!title || title.length > 120) {
    throw new MenuRuleError(
      "invalid_request",
      "Judul menu wajib diisi dan maksimal 120 karakter.",
    );
  }
  return title;
}

function itemsFrom(
  value: unknown,
  depth = 0,
  count = { value: 0 },
): MenuItemInput[] {
  if (!Array.isArray(value) || depth > 1) {
    throw new MenuRuleError("invalid_request", "Susunan item menu tidak valid.");
  }

  return value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new MenuRuleError("invalid_request", "Item menu tidak valid.");
    }
    count.value += 1;
    if (count.value > 100) {
      throw new MenuRuleError(
        "invalid_request",
        "Satu menu maksimal berisi 100 item.",
      );
    }

    const item = raw as Record<string, unknown>;
    const title = titleFrom(item.title);
    const type = item.type;
    const target =
      typeof item.target === "string" ? item.target.trim() : undefined;
    if (
      typeof type !== "string" ||
      !NAV_TYPES.has(type as NavItemType) ||
      target === undefined ||
      target.length > 2_048
    ) {
      throw new MenuRuleError("invalid_request", "Item menu tidak valid.");
    }

    const children =
      item.children === undefined
        ? undefined
        : itemsFrom(item.children, depth + 1, count);
    return { title, type: type as NavItemType, target, children };
  });
}

function inputFrom(input: unknown): CreateMenuInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new MenuRuleError("invalid_request", "Data menu tidak valid.");
  }
  const raw = input as Record<string, unknown>;
  return { title: titleFrom(raw.title), items: itemsFrom(raw.items) };
}

function handleFrom(value: unknown): string {
  const handle = typeof value === "string" ? value.trim() : "";
  if (!HANDLE.test(handle) || handle.length > 120) {
    throw new MenuRuleError("invalid_request", "Handle menu tidak valid.");
  }
  return handle;
}

function toHandle(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "menu"
  );
}

function handleCandidate(base: string, suffix?: number): string {
  const tail = suffix ? `-${suffix}` : "";
  const stem = base.slice(0, 120 - tail.length).replace(/-+$/g, "") || "menu";
  return `${stem}${tail}`;
}

async function insertItems(
  db: Tx,
  menuId: string,
  items: MenuItemInput[],
  parentId: string | null = null,
): Promise<void> {
  for (let position = 0; position < items.length; position += 1) {
    const item = items[position];
    const [inserted] = await db
      .insert(schema.menuItems)
      .values({
        menuId,
        parentId,
        label: item.title,
        type: NAV_TO_DB[item.type],
        target: item.target || null,
        position,
      })
      .returning({ id: schema.menuItems.id });
    if (!inserted) throw new Error("Menu item insert returned no row");
    if (item.children?.length) {
      await insertItems(db, menuId, item.children, inserted.id);
    }
  }
}

async function guard<T>(
  action: () => Promise<T>,
  fallback: string,
): Promise<{ ok: true; value: T } | MenuError> {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    if (error instanceof MenuRuleError) {
      return { ok: false, code: error.code, error: error.message };
    }
    return { ok: false, code: "save_failed", error: fallback };
  }
}

export async function createMenu(
  input: CreateMenuInput,
): Promise<CreateMenuResult> {
  const { storeId } = await requireCapability("content:write");
  const result = await guard(async () => {
    const parsed = inputFrom(input);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await withTenant(storeId, async (db) => {
          const existing = await db
            .select({ handle: schema.menus.handle })
            .from(schema.menus)
            .where(eq(schema.menus.storeId, storeId));
          const handles = new Set(existing.map((menu) => menu.handle));
          const base = toHandle(parsed.title);
          let suffix: number | undefined;
          let handle = handleCandidate(base);
          while (handles.has(handle)) {
            suffix = (suffix ?? 1) + 1;
            handle = handleCandidate(base, suffix);
          }

          const [menu] = await db
            .insert(schema.menus)
            .values({ storeId, name: parsed.title, handle })
            .returning({ id: schema.menus.id });
          if (!menu) throw new Error("Menu insert returned no row");
          // menuItems has no store_id/RLS. This fresh tenant-owned parent proves every
          // child inserted below belongs to the authenticated store.
          await insertItems(db, menu.id, parsed.items);
          return handle;
        });
      } catch (error) {
        if (
          uniqueViolationConstraint(error) !== MENU_HANDLE_UNIQUE ||
          attempt === 2
        ) {
          throw error;
        }
      }
    }
    throw new Error("Menu handle allocation exhausted");
  }, "Gagal membuat menu. Coba lagi.");

  if (!result.ok) return result;
  revalidatePath("/navigasi");
  return { ok: true, handle: result.value };
}

export async function saveMenu(
  input: SaveMenuInput,
): Promise<SaveMenuResult> {
  const { storeId } = await requireCapability("content:write");
  const result = await guard(async () => {
    const parsed = inputFrom(input);
    const handle = handleFrom((input as unknown as Record<string, unknown>)?.handle);
    return withTenant(storeId, async (db) => {
      const [menu] = await db
        .select({ id: schema.menus.id })
        .from(schema.menus)
        .where(
          and(
            eq(schema.menus.storeId, storeId),
            eq(schema.menus.handle, handle),
          ),
        )
        .limit(1);
      if (!menu) {
        throw new MenuRuleError("not_found", "Menu tidak ditemukan.");
      }

      await db
        .update(schema.menus)
        .set({ name: parsed.title })
        .where(
          and(
            eq(schema.menus.id, menu.id),
            eq(schema.menus.storeId, storeId),
          ),
        );
      await db
        .delete(schema.menuItems)
        .where(eq(schema.menuItems.menuId, menu.id));
      await insertItems(db, menu.id, parsed.items);
    });
  }, "Gagal menyimpan menu. Coba lagi.");

  if (!result.ok) return result;
  revalidatePath("/navigasi");
  return { ok: true };
}
