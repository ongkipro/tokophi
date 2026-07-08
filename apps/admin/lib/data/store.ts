import "server-only";
import { schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { withTenant, type Tx } from "@/lib/tenant";

// The current store's own name (by validated session storeId) — so the admin chrome reflects
// the store you're actually in (incl. an impersonated store from the super-admin), not a hardcode.
export async function getStoreName(storeId: string): Promise<string | null> {
  return withTenant(storeId, async (db: Tx) => {
    const [s] = await db.select({ name: schema.stores.name }).from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
    return s?.name ?? null;
  });
}
