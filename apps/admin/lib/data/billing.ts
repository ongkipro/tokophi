import "server-only";
import { schema } from "@tokophi/db";
import { computeBilling, type BillingState } from "@tokophi/lib/billing";
import { withCurrentTenant, type Tx } from "@/lib/tenant";

// Current store's subscription state (trial/active/past_due/suspended + countdown + next amount).
export async function getBilling(): Promise<BillingState | null> {
  return withCurrentTenant(async (db: Tx) => {
    const [s] = await db
      .select({
        trialEndsAt: schema.stores.trialEndsAt,
        currentPeriodEnd: schema.stores.currentPeriodEnd,
        firstInvoicePaid: schema.stores.firstInvoicePaid,
      })
      .from(schema.stores)
      .limit(1);
    return s ? computeBilling(s) : null;
  });
}
