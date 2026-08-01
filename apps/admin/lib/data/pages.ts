import "server-only";
import { schema } from "@tokophi/db";
import { withCurrentTenant } from "@/lib/tenant";
import { desc, eq } from "drizzle-orm";
import type { CmsPage } from "@/lib/mock/store";

// ⚠️ THE REAL CLOCK. This was `ADMIN_TODAY = 2026-06-30`, the seed's frame, so anything created or
// touched after the seed was written rendered a NEGATIVE age. The seed may be anchored; the app is not.

function toPage(r: {
  id: string; title: string; handle: string; status: "terbit" | "draft"; template: string | null; views: number; updatedAt: Date;
}): CmsPage {
  return {
    id: r.id,
    title: r.title,
    handle: r.handle,
    published: r.status === "terbit",
    updatedDaysAgo: Math.round((Date.now() - r.updatedAt.getTime()) / 86_400_000),
    template: r.template ?? "page",
    views: r.views,
  };
}

export async function getPages(): Promise<CmsPage[]> {
  return withCurrentTenant(async (db) => {
    const rows = await db.select().from(schema.pages).orderBy(desc(schema.pages.updatedAt));
    return rows.map(toPage);
  });
}

export async function getPage(id: string): Promise<CmsPage | null> {
  return withCurrentTenant(async (db) => {
    const rows = await db.select().from(schema.pages).where(eq(schema.pages.id, id)).limit(1);
    return rows[0] ? toPage(rows[0]) : null;
  });
}
