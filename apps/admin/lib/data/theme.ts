import "server-only";
import { db, schema, type PageTemplate } from "@tokophi/db";
import { withCurrentTenant, withTenant } from "@/lib/tenant";
import { isUuid } from "@/lib/uuid";
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
  // A `category` template with no product section lists NOTHING on the storefront. The template is
  // the page's BODY (CategoryHero — the h1, breadcrumb and cover — is always rendered by the page),
  // so the heading survives but the catalogue only exists if the merchant added Daftar Produk.
  // Surfaced in /tema as a warning instead of failing silently.
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

// ── THE PLATFORM DEFAULT, AS A STARTING CANVAS (T-9 follow-up, 2026-08-12) ────────────────────────
//
// A merchant opening a template with NOTHING in it starts from the platform default theme's sections
// instead of a blank drag-and-drop canvas — same holder store the storefront falls back to at render
// (decision B, apps/storefront theme-source.ts). Read-only prefill: nothing is written until the
// merchant presses Publish, and that goes through the ordinary saveTemplate path, which writes the
// merchant's OWN row. Copy-on-first-edit, not copy-at-provisioning — the recorded decision rejected
// row-copies ("the seed is not a migration").
//
// ⚠️ DELIBERATE CROSS-TENANT READ, on the bare owner `db` — the exception the tenant rule reserves
// for auth (lib/auth.ts reads store_users before a session exists) and the storefront. The holder is
// a PLATFORM-owned store (`suspendedAt` set, reserved slug, seed-platform-theme.ts), so this leaks no
// merchant's content to another merchant; RLS under `withCurrentTenant` could structurally never see
// another store's rows, which is exactly why this read cannot go through it.
export async function getPlatformDefaultSections(type: TemplateType): Promise<unknown> {
  const holderId = process.env.PLATFORM_DEFAULT_THEME_STORE_ID?.trim();
  // Unset = OFF (blank canvas, as before). Non-UUID would 22P02-throw and 500 the /tema editor —
  // a typo'd env must degrade to the blank canvas, never take the builder down.
  if (!holderId || !isUuid(holderId)) return null;
  const [row] = await db
    .select({ sections: schema.pageTemplates.sections })
    .from(schema.pageTemplates)
    .where(
      and(
        eq(schema.pageTemplates.storeId, holderId),
        eq(schema.pageTemplates.type, type),
        eq(schema.pageTemplates.isDefault, true),
      ),
    )
    .limit(1);
  const content = (row?.sections as PuckContent)?.content;
  return Array.isArray(content) && content.length > 0 ? row!.sections : null;
}

type PuckContent = { content?: { type?: string }[] } | null;

function sectionCount(sections: unknown): number {
  const content = (sections as PuckContent)?.content;
  return Array.isArray(content) ? content.length : 0;
}

function hasProductGrid(sections: unknown): boolean {
  // Either product section counts. `product-listing` ("Daftar Produk") is the CATALOGUE — the one a
  // category template should actually use — and this checked only `product-grid`, so the seeded
  // category default tripped its own warning and the hint pointed merchants back at the truncating
  // section this whole change exists to move them off.
  const content = (sections as { content?: { type?: string }[] } | null)?.content;
  return Array.isArray(content) && content.some((s) => s?.type === "product-grid" || s?.type === "product-listing");
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

// Design-token choices beyond the brand colour (stores.theme jsonb, migration 0092) — raw and
// untyped on purpose: resolveTheme (@tokophi/lib/theme) is the one validator, on read, everywhere.
// Same tenant caveat as getBrandColor: `stores` has no store_id (it IS the tenant), so filter
// explicitly by session storeId.
export async function getStoreTheme(storeId: string): Promise<unknown> {
  return withTenant(storeId, async (db) => {
    const [row] = await db
      .select({ theme: schema.stores.theme })
      .from(schema.stores)
      .where(eq(schema.stores.id, storeId))
      .limit(1);
    return row?.theme ?? null;
  });
}

// Product-page gallery layout (stores.product_gallery_layout) — same tenant caveat as getBrandColor:
// `stores` has no store_id (it IS the tenant), so filter explicitly by session storeId.
export async function getProductGalleryLayout(storeId: string): Promise<string> {
  return withTenant(storeId, async (db) => {
    const [row] = await db
      .select({ layout: schema.stores.productGalleryLayout })
      .from(schema.stores)
      .where(eq(schema.stores.id, storeId))
      .limit(1);
    return row?.layout ?? "thumbnail-left";
  });
}
