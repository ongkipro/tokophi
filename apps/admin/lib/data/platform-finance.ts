import "server-only";
import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";

// Platform-level finance settings — GLOBAL, one row, owner-controlled from Super Admin. Read on the
// bare owner connection deliberately: this is platform config, not tenant data, and it is consulted
// by paths with no tenant context (the billing cron). Missing row = the migration's default: OFF.
export async function getSubscriptionPpnEnabled(): Promise<boolean> {
  const [row] = await db
    .select({ on: schema.platformFinance.subscriptionPpnEnabled })
    .from(schema.platformFinance)
    .where(eq(schema.platformFinance.id, 1))
    .limit(1);
  return row?.on ?? false;
}
