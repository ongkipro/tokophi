import "server-only";
import { schema, type PageTemplate } from "@tokophi/db";
import { withCurrentTenant, withTenant } from "@/lib/tenant";
import { and, eq } from "drizzle-orm";

export type TemplateType = "homepage" | "category" | "product";

// ADR 0009 — Store Builder. `sections` (jsonb) stores Puck's native `Data` shape
// ({ content: [{type, props}], root }) as-is: Puck is the source of truth for that
// structure, so we don't re-encode it — the storefront renderer (apps/storefront) walks
// `data.content` directly. See lib/actions/theme.ts for the write side.

export async function getTemplatesByType(type: TemplateType): Promise<PageTemplate[]> {
  return withCurrentTenant(async (db) =>
    db.select().from(schema.pageTemplates).where(eq(schema.pageTemplates.type, type)),
  );
}

export async function getTemplate(id: string): Promise<PageTemplate | null> {
  return withCurrentTenant(async (db) => {
    const [row] = await db.select().from(schema.pageTemplates).where(eq(schema.pageTemplates.id, id)).limit(1);
    return row ?? null;
  });
}

// The store's single active homepage template, or null if the merchant hasn't saved one
// yet — the /tema page falls back to a blank Puck canvas in that case. Reads never write
// (see lib/tenant.ts); the first Save is what actually creates the row (lib/actions/theme.ts).
export async function getDefaultHomepage(): Promise<PageTemplate | null> {
  return withCurrentTenant(async (db) => {
    const [row] = await db
      .select()
      .from(schema.pageTemplates)
      .where(and(eq(schema.pageTemplates.type, "homepage"), eq(schema.pageTemplates.isDefault, true)))
      .limit(1);
    return row ?? null;
  });
}

// The store's brand hex (ADR 0009 colour panel), or null if unset — /tema falls back to
// DEFAULT_BRAND_COLOR (@tokophi/lib/colors) in that case. `stores` itself carries no `store_id`
// (it IS the tenant) so it isn't RLS-scoped — filter explicitly by session storeId, like
// lib/data/store.ts's getStoreName/getStoreSlug.
export async function getBrandColor(storeId: string): Promise<string | null> {
  return withTenant(storeId, async (db) => {
    const [row] = await db
      .select({ brandColor: schema.stores.brandColor })
      .from(schema.stores)
      .where(eq(schema.stores.id, storeId))
      .limit(1);
    return row?.brandColor ?? null;
  });
}
