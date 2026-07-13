"use server";
import { schema } from "@tokophi/db";
import type { Data } from "@measured/puck";
import { and, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";
import type { TemplateType } from "@/lib/data/theme";

// ADR 0009 — Store Builder.
//
// STOREFRONT CONTRACT (how a storefront page picks its template):
//   homepage  → the store's `page_templates` row with type='homepage' AND is_default=true.
//   category  → collections.template_id, else the store's type='category' row with is_default=true,
//               else the storefront's own hand-built fallback layout.
//   product   → products.template_id,    else the store's type='product'  row with is_default=true,
//               else the storefront's own hand-built fallback layout.
// At most one row per (store_id, type) has is_default=true — enforced app-side here
// (createTemplate / setDefaultTemplate), like the single-active-menu pattern.
// `sections` (jsonb) stores Puck's native `Data` shape as-is (see lib/data/theme.ts).

function revalidateTheme() {
  revalidatePath("/tema");
  revalidatePath("/kategori");
  revalidatePath("/produk");
}

const MAX_NAME = 60;

// Business-rule failures are RETURNED (`{ ok: false, error }`), like lib/actions/billing.ts —
// Next masks thrown Error messages in production, so a throw would never reach the merchant's
// toast. RuleError is the in-transaction carrier (throwing also rolls the txn back); the exported
// action catches it at the boundary. Auth/RBAC failures still throw — that IS the security
// boundary (lib/rbac.ts), not a user-facing rule.
export type ThemeResult = { ok: true } | { ok: false; error: string };
export type CreateTemplateResult = { ok: true; id: string } | { ok: false; error: string };

class RuleError extends Error {}

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof RuleError) return { ok: false, error: e.message };
  throw e;
}

function cleanName(name: string): string {
  const n = name.trim();
  if (!n) throw new RuleError("Nama template wajib diisi");
  if (n.length > MAX_NAME) throw new RuleError(`Nama template maksimal ${MAX_NAME} karakter`);
  return n;
}

// Create a named template of a given type. The first template of a type automatically becomes
// that type's default, so a fresh store never has an unresolvable fallback.
export async function createTemplate(type: TemplateType, name: string): Promise<CreateTemplateResult> {
  const { storeId } = await requireCapability("theme:write");
  try {
    const clean = cleanName(name);
    const id = await withTenant(storeId, async (db) => {
      const existing = await db
        .select({ id: schema.pageTemplates.id })
        .from(schema.pageTemplates)
        .where(eq(schema.pageTemplates.type, type));
      const [row] = await db
        .insert(schema.pageTemplates)
        .values({
          storeId,
          type,
          name: clean,
          sections: { content: [], root: {} },
          isDefault: existing.length === 0,
        })
        .returning({ id: schema.pageTemplates.id });
      return row.id;
    });
    revalidateTheme();
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function renameTemplate(id: string, name: string): Promise<ThemeResult> {
  const { storeId } = await requireCapability("theme:write");
  try {
    const clean = cleanName(name);
    await withTenant(storeId, async (db) => {
      const rows = await db
        .update(schema.pageTemplates)
        .set({ name: clean, updatedAt: new Date() })
        .where(eq(schema.pageTemplates.id, id))
        .returning({ id: schema.pageTemplates.id });
      if (rows.length === 0) throw new RuleError("Template tidak ditemukan");
    });
    revalidateTheme();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// Delete = hard delete (a template isn't referenced by history). Any collection/product still
// pointing at it is reset to NULL first (→ it falls back to the type's default template).
// A default template can only be deleted when it's the last one of its type — otherwise the
// merchant must promote another one first, so the fallback never dangles.
export async function deleteTemplate(id: string): Promise<ThemeResult> {
  const { storeId } = await requireCapability("theme:write");
  try {
    await withTenant(storeId, async (db) => {
      const [tpl] = await db
        .select()
        .from(schema.pageTemplates)
        .where(eq(schema.pageTemplates.id, id))
        .limit(1);
      if (!tpl) throw new RuleError("Template tidak ditemukan");
      if (tpl.isDefault) {
        const siblings = await db
          .select({ id: schema.pageTemplates.id })
          .from(schema.pageTemplates)
          .where(and(eq(schema.pageTemplates.type, tpl.type), ne(schema.pageTemplates.id, id)));
        if (siblings.length > 0) {
          throw new RuleError("Template default tidak bisa dihapus — jadikan template lain sebagai default dulu");
        }
      }
      await db.update(schema.collections).set({ templateId: null }).where(eq(schema.collections.templateId, id));
      await db.update(schema.products).set({ templateId: null }).where(eq(schema.products.templateId, id));
      await db.delete(schema.pageTemplates).where(eq(schema.pageTemplates.id, id));
    });
    revalidateTheme();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// Promote a template to its type's default (the fallback used when a collection/product has no
// explicit template; for `homepage` it IS the live homepage). Demotes every sibling of that type.
export async function setDefaultTemplate(id: string): Promise<ThemeResult> {
  const { storeId } = await requireCapability("theme:write");
  try {
    await withTenant(storeId, async (db) => {
      const [tpl] = await db
        .select({ type: schema.pageTemplates.type })
        .from(schema.pageTemplates)
        .where(eq(schema.pageTemplates.id, id))
        .limit(1);
      if (!tpl) throw new RuleError("Template tidak ditemukan");
      await db
        .update(schema.pageTemplates)
        .set({ isDefault: false })
        .where(and(eq(schema.pageTemplates.type, tpl.type), ne(schema.pageTemplates.id, id)));
      await db
        .update(schema.pageTemplates)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(eq(schema.pageTemplates.id, id));
    });
    revalidateTheme();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// Save the Puck canvas of any template (any type) — the /tema/[id] builder's "Publish".
export async function saveTemplate(id: string, data: Data): Promise<ThemeResult> {
  const { storeId } = await requireCapability("theme:write");
  try {
    await withTenant(storeId, async (db) => {
      const rows = await db
        .update(schema.pageTemplates)
        .set({ sections: data, updatedAt: new Date() })
        .where(eq(schema.pageTemplates.id, id))
        .returning({ id: schema.pageTemplates.id });
      if (rows.length === 0) throw new RuleError("Template tidak ditemukan");
    });
    revalidateTheme();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// Assignment: templateId = null → the collection/product inherits the type's default template.
// The template is re-read under RLS + type-checked first, so a foreign or wrong-type id can never
// be written into the FK.
async function assign(
  kind: "collection" | "product",
  ids: string[],
  templateId: string | null,
): Promise<ThemeResult> {
  const { storeId } = await requireCapability("theme:write");
  if (ids.length === 0) return { ok: true };
  const wantType: TemplateType = kind === "collection" ? "category" : "product";
  try {
    await withTenant(storeId, async (db) => {
      if (templateId) {
        const [tpl] = await db
          .select({ id: schema.pageTemplates.id })
          .from(schema.pageTemplates)
          .where(and(eq(schema.pageTemplates.id, templateId), eq(schema.pageTemplates.type, wantType)))
          .limit(1);
        if (!tpl) throw new RuleError("Template tidak ditemukan");
      }
      if (kind === "collection") {
        await db.update(schema.collections).set({ templateId }).where(inArray(schema.collections.id, ids));
      } else {
        await db.update(schema.products).set({ templateId }).where(inArray(schema.products.id, ids));
      }
    });
    revalidateTheme();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function assignCollectionTemplate(collectionId: string, templateId: string | null): Promise<ThemeResult> {
  return assign("collection", [collectionId], templateId);
}

export async function assignProductTemplate(productId: string, templateId: string | null): Promise<ThemeResult> {
  return assign("product", [productId], templateId);
}

// Bulk assign one template to many collections/products at once (the assignment table's
// "Terapkan ke terpilih"). `null` clears the assignment (→ inherit the type's default).
export async function assignTemplateBulk(
  kind: "collection" | "product",
  ids: string[],
  templateId: string | null,
): Promise<ThemeResult> {
  return assign(kind, ids, templateId);
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// Store-wide brand colour (ADR 0009 colour panel) — separate save from the templates since it
// lives on `stores`, not `page_templates` (a theme-wide setting, not per-page content).
export async function saveBrandColor(hex: string): Promise<void> {
  if (!HEX_COLOR.test(hex)) throw new Error("Format warna tidak valid — gunakan hex 6 digit, mis. #a85572");
  const { storeId } = await requireCapability("theme:write");
  await withTenant(storeId, async (db) => {
    await db.update(schema.stores).set({ brandColor: hex }).where(eq(schema.stores.id, storeId));
  });
  revalidatePath("/tema");
}
