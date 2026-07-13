import "server-only";
import { schema, type PageTemplate } from "@tokophi/db";
import { withCurrentTenant, withTenant } from "@/lib/tenant";
import { and, asc, eq, ne, sql } from "drizzle-orm";

export type TemplateType = "homepage" | "category" | "product";

export const TEMPLATE_TYPES: TemplateType[] = ["homepage", "category", "product"];

export const TEMPLATE_TYPE_LABELS: Record<TemplateType, string> = {
  homepage: "Beranda",
  category: "Kategori",
  product: "Produk",
};

// One row of the /tema template manager: the template + how many storefront pages use it.
export type TemplateSummary = {
  id: string;
  type: TemplateType;
  name: string;
  isDefault: boolean;
  sectionCount: number;
  assignedCount: number; // collections (category) / products (product) pointing at it; 0 for homepage
  // A `category` template with no Grid Produk section lists NOTHING on the storefront — the
  // template replaces the hand-built category page wholesale, so the product list only exists if
  // the merchant put one there. Surfaced in /tema as a warning instead of failing silently.
  hasProductGrid: boolean;
  updatedAt: Date;
};

// A collection/product row in the assignment table: which template it currently uses
// (null = inherit the store's default template of that type — see the storefront contract
// in lib/actions/theme.ts).
export type TemplateAssignment = { id: string; name: string; templateId: string | null };

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

type PuckContent = { content?: { type?: string }[] } | null;

function sectionCount(sections: unknown): number {
  const content = (sections as PuckContent)?.content;
  return Array.isArray(content) ? content.length : 0;
}

function hasProductGrid(sections: unknown): boolean {
  const content = (sections as PuckContent)?.content;
  return Array.isArray(content) && content.some((s) => s?.type === "product-grid");
}

// All templates of the store (every type), with the number of collections/products assigned
// to each — powers the /tema template manager. Homepage templates always report 0 assignments
// (the homepage is picked by `is_default`, not by an FK).
export async function listTemplates(): Promise<TemplateSummary[]> {
  return withCurrentTenant(async (db) => {
    const [templates, collectionCounts, productCounts] = await Promise.all([
      db.select().from(schema.pageTemplates).orderBy(asc(schema.pageTemplates.createdAt)),
      db
        .select({ templateId: schema.collections.templateId, n: sql<number>`count(*)`.mapWith(Number) })
        .from(schema.collections)
        .where(sql`${schema.collections.templateId} is not null and ${schema.collections.archivedAt} is null`)
        .groupBy(schema.collections.templateId),
      db
        .select({ templateId: schema.products.templateId, n: sql<number>`count(*)`.mapWith(Number) })
        .from(schema.products)
        .where(sql`${schema.products.templateId} is not null and ${schema.products.status} <> 'archived'`)
        .groupBy(schema.products.templateId),
    ]);
    const used = new Map<string, number>();
    for (const r of [...collectionCounts, ...productCounts]) if (r.templateId) used.set(r.templateId, r.n);
    return templates.map((t) => ({
      id: t.id,
      type: t.type as TemplateType,
      name: t.name,
      isDefault: t.isDefault,
      sectionCount: sectionCount(t.sections),
      assignedCount: used.get(t.id) ?? 0,
      hasProductGrid: hasProductGrid(t.sections),
      updatedAt: t.updatedAt,
    }));
  });
}

// Assignment tables (/tema → tab Kategori / Produk).
export async function getCollectionAssignments(): Promise<TemplateAssignment[]> {
  return withCurrentTenant(async (db) => {
    const rows = await db
      .select({ id: schema.collections.id, name: schema.collections.title, templateId: schema.collections.templateId })
      .from(schema.collections)
      .where(sql`${schema.collections.archivedAt} is null`)
      .orderBy(asc(schema.collections.title));
    return rows;
  });
}

export async function getProductAssignments(): Promise<TemplateAssignment[]> {
  return withCurrentTenant(async (db) => {
    const rows = await db
      .select({ id: schema.products.id, name: schema.products.title, templateId: schema.products.templateId })
      .from(schema.products)
      .where(ne(schema.products.status, "archived"))
      .orderBy(asc(schema.products.title));
    return rows;
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
