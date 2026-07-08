import "server-only";
import { schema } from "@tokophi/db";
import { withCurrentTenant } from "@/lib/tenant";
import { desc } from "drizzle-orm";
import type { CustSegment } from "@/lib/mock/store";

export async function getSegments(): Promise<CustSegment[]> {
  return withCurrentTenant(async (db) => {
    const rows = await db.select().from(schema.customerSegments).orderBy(desc(schema.customerSegments.memberCount));
    return rows.map((r) => ({ id: r.id, name: r.name, count: r.memberCount, growth: r.growth, description: r.description ?? "" }));
  });
}
