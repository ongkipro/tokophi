import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { buildCodPolicy } from "./cod-policy";
import type { CodPolicy } from "./cod-policy";

// COD policy — the DB-LOADING half. The decision logic (the five conditions that must all agree) lives
// in the PURE `cod-policy.ts` (`buildCodPolicy`), which is unit-tested with fixtures. This file only
// reads the three rows and hands them over. See cod-policy.ts for the full "five switches" contract.
//
// This is the ONE place that answers "may this order be paid on delivery?" — do not re-implement the
// check elsewhere, and never `if (courier === "spx")`: widening COD stays a data change (codAllowed),
// not a deploy.

export { normProvince, buildCodPolicy } from "./cod-policy";
export type { CodRequest, CodPolicy, StoredService, CodPolicyInput } from "./cod-policy";

export async function getCodPolicy(storeId: string): Promise<CodPolicy> {
  const [[ss], [pc], couriers] = await Promise.all([
    db
      .select({ cod: schema.storeSettings.codEnabled })
      .from(schema.storeSettings)
      .where(eq(schema.storeSettings.storeId, storeId))
      .limit(1),
    db
      .select({
        enabled: schema.platformCod.enabled,
        maxAmountIdr: schema.platformCod.maxAmountIdr,
        allowedProvinces: schema.platformCod.allowedProvinces,
      })
      .from(schema.platformCod)
      .limit(1),
    db
      .select({
        courier: schema.platformCouriers.courier,
        services: schema.platformCouriers.services,
        enabled: schema.platformCouriers.enabled,
      })
      .from(schema.platformCouriers),
  ]);

  return buildCodPolicy({
    storeCodEnabled: ss?.cod,
    platformCod: pc ?? null,
    couriers,
  });
}
