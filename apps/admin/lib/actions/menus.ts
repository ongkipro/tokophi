"use server";
import { schema } from "@tokophi/db";
import { and, eq, sql } from "drizzle-orm";
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

// A rejection the MERCHANT can act on is returned, never thrown: Next masks a thrown Error in
// production, so a caller would see an opaque digest. The mirror obligation is that every caller
// reads the result — a caller that awaits and ignores it reports success over a write that never
// happened, which is worse than the digest. Both files change together (AGENTS.md).
type MenuErrorCode = "invalid_request" | "not_found" | "save_failed";
type MenuError = { ok: false; code: MenuErrorCode; error: string };
export type CreateMenuResult = { ok: true; handle: string } | MenuError;
export type SaveMenuResult = { ok: true } | MenuError;

const NAV_TO_DB: Record<NavItemType, "home" | "collection" | "product" | "page" | "blog" | "url"> = {
  beranda: "home",
  koleksi: "collection",
  produk: "product",
  halaman: "page",
  blog: "blog",
  url: "url",
};
const NAV_TYPES = new Set<string>(Object.keys(NAV_TO_DB));

// The editor builds exactly two levels — `canHaveChildren` accepts only top-level rows and
// `canIndent` refuses an item that already has children (`components/admin/navigasi/tree-ops.ts`).
// So a third level cannot come from the screen; it can only come from a hand-made request.
const MAX_DEPTH = 2;
// Generous on purpose. A cap that refuses a real menu is a bug of its own; this one only stops a
// request that would insert rows one round-trip at a time until the transaction times out.
const MAX_ITEMS = 100;
const MAX_TITLE = 120;
const MAX_TARGET = 2_048;

/** A rule the caller can fix, as opposed to a failure only we can. */
class MenuRuleError extends Error {
  constructor(
    readonly code: Exclude<MenuErrorCode, "save_failed">,
    message: string,
  ) {
    super(message);
  }
}

function titleFrom(value: unknown, what: "Judul menu" | "Judul item menu"): string {
  const title = typeof value === "string" ? value.trim() : "";
  if (!title || title.length > MAX_TITLE) {
    throw new MenuRuleError("invalid_request", `${what} wajib diisi dan maksimal ${MAX_TITLE} karakter.`);
  }
  return title;
}

function itemsFrom(value: unknown, depth = 1, count = { value: 0 }): MenuItemInput[] {
  if (!Array.isArray(value) || depth > MAX_DEPTH) {
    throw new MenuRuleError("invalid_request", "Susunan item menu tidak valid.");
  }

  return value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new MenuRuleError("invalid_request", "Item menu tidak valid.");
    }
    if ((count.value += 1) > MAX_ITEMS) {
      throw new MenuRuleError("invalid_request", `Satu menu maksimal berisi ${MAX_ITEMS} item.`);
    }

    const item = raw as Record<string, unknown>;
    const title = titleFrom(item.title, "Judul item menu");
    const type = typeof item.type === "string" && NAV_TYPES.has(item.type) ? (item.type as NavItemType) : null;
    const target = typeof item.target === "string" ? item.target.trim() : null;
    if (!type || target === null || target.length > MAX_TARGET) {
      throw new MenuRuleError("invalid_request", "Item menu tidak valid.");
    }

    const children = item.children === undefined ? undefined : itemsFrom(item.children, depth + 1, count);
    return { title, type, target, children };
  });
}

function inputFrom(input: unknown): CreateMenuInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new MenuRuleError("invalid_request", "Data menu tidak valid.");
  }
  const raw = input as Record<string, unknown>;
  return { title: titleFrom(raw.title, "Judul menu"), items: itemsFrom(raw.items) };
}

/**
 * ⚠️ The handle is NOT re-validated against a pattern. It is looked up scoped to this store and a
 * miss is a typed `not_found` — which is the same check, and it cannot refuse a row that really
 * exists. A regex here would reject any handle an older seed or import happened to write, turning
 * a working Simpan into a permanent rejection with no way for the merchant to fix it.
 */
function handleFrom(value: unknown): string {
  const handle = typeof value === "string" ? value.trim() : "";
  if (!handle || handle.length > MAX_TITLE) {
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

/** `<stem>` or `<stem>-<n>`, never longer than the column's own limit. */
function handleCandidate(base: string, suffix?: number): string {
  const tail = suffix ? `-${suffix}` : "";
  const stem = base.slice(0, MAX_TITLE - tail.length).replace(/-+$/g, "") || "menu";
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
    if (!inserted) throw new Error("menu_items insert returned no row");
    if (item.children?.length) await insertItems(db, menuId, item.children, inserted.id);
  }
}

async function guard<T>(action: () => Promise<T>, fallback: string): Promise<{ ok: true; value: T } | MenuError> {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    if (error instanceof MenuRuleError) return { ok: false, code: error.code, error: error.message };
    // Ours, not theirs. The merchant gets one sentence they can act on; the container log keeps the
    // reason, because "Coba lagi" with no trace anywhere is a defect nobody can ever diagnose.
    console.error("menus action failed", error);
    return { ok: false, code: "save_failed", error: fallback };
  }
}

/**
 * Create the menu AND its initial items in one tenant transaction. Everything commits or nothing
 * does — an item that fails to insert takes the parent row with it, so the screen can never show a
 * menu the database does not have.
 *
 * 🔴 THE HANDLE IS ALLOCATED UNDER A LOCK, because reading the taken handles and then inserting is
 * check-then-insert: two transactions that read before either commits both pick the same string.
 * Measured on real PostgreSQL (two concurrent creates of one title, the second delayed inside the
 * transaction): without the lock both committed and the store was left with TWO menus on one
 * handle — after which `saveMenu`'s `limit(1)` edits an arbitrary one of them and the storefront's
 * `main-menu` lookup is a coin toss. With it: `promo` and `promo-2`, one row each.
 * The lock is transaction-scoped, so it is released by COMMIT or ROLLBACK with nothing to clean up,
 * and it is taken under the `tokophi_app` role (measured — the function is executable by PUBLIC).
 * It serialises menu CREATION for one store and nothing else.
 */
export async function createMenu(input: CreateMenuInput): Promise<CreateMenuResult> {
  const { storeId } = await requireCapability("content:write");
  const result = await guard(async () => {
    const parsed = inputFrom(input);
    return withTenant(storeId, async (db) => {
      // 4707 = this task's namespace, so the key cannot collide with another advisory-lock user.
      await db.execute(sql`select pg_advisory_xact_lock(4707, hashtext(${storeId}))`);

      const existing = await db
        .select({ handle: schema.menus.handle })
        .from(schema.menus)
        .where(eq(schema.menus.storeId, storeId));
      const taken = new Set(existing.map((menu) => menu.handle));
      const base = toHandle(parsed.title);
      let suffix: number | undefined;
      let handle = handleCandidate(base);
      while (taken.has(handle)) handle = handleCandidate(base, (suffix = (suffix ?? 1) + 1));

      const [menu] = await db
        .insert(schema.menus)
        .values({ storeId, name: parsed.title, handle })
        .returning({ id: schema.menus.id });
      if (!menu) throw new Error("menus insert returned no row");
      // THE TENANT BOUNDARY for the child writes below: `menu_items` has no `store_id` and no RLS,
      // so the only thing tying those rows to this store is that this parent was just INSERTed
      // inside this tenant transaction with this store's id. Do not hoist the child insert out.
      await insertItems(db, menu.id, parsed.items);
      return handle;
    });
  }, "Gagal membuat menu. Coba lagi.");

  if (!result.ok) return result;
  revalidatePath("/navigasi");
  return { ok: true, handle: result.value };
}

/** Replace the whole tree for one menu (delete + re-insert with parent_id + position). */
export async function saveMenu(input: SaveMenuInput): Promise<SaveMenuResult> {
  const { storeId } = await requireCapability("content:write");
  const result = await guard(async () => {
    const parsed = inputFrom(input);
    // Safe to read: `inputFrom` has already refused anything that is not a plain object.
    const handle = handleFrom(input.handle);
    return withTenant(storeId, async (db) => {
      // THE TENANT BOUNDARY: this read is RLS-protected AND filtered on storeId, and it is what
      // proves `menu.id` may be written to below. `menu_items` carries no `store_id` of its own.
      const [menu] = await db
        .select({ id: schema.menus.id })
        .from(schema.menus)
        .where(and(eq(schema.menus.storeId, storeId), eq(schema.menus.handle, handle)))
        .limit(1);
      // A save against a menu this store does not have used to `return` silently — the editor
      // showed "Menu disimpan" over a write that matched nothing.
      if (!menu) throw new MenuRuleError("not_found", "Menu tidak ditemukan. Muat ulang halaman ini.");

      await db
        .update(schema.menus)
        .set({ name: parsed.title })
        .where(and(eq(schema.menus.id, menu.id), eq(schema.menus.storeId, storeId)));
      await db.delete(schema.menuItems).where(eq(schema.menuItems.menuId, menu.id));
      await insertItems(db, menu.id, parsed.items);
    });
  }, "Gagal menyimpan menu. Coba lagi.");

  if (!result.ok) return result;
  revalidatePath("/navigasi");
  return { ok: true };
}
